/*
 * intent.ts — player command extraction (Wave 2B narrow first cut).
 *
 * WHAT: `parseIntent(input, scope, options?)` extracts a structured
 *       `Intent { verb, target?, instrument?, modifier? }` from raw
 *       player text using a deterministic verb-noun-prep grammar with a
 *       synonym table and scope-resolution against current world objects.
 *       On grammar miss, `LlmFallback.quietCall` (when supplied) is
 *       invoked as an oracle to propose an Intent from the same input.
 *       Returns `null` when neither layer produces a result.
 *
 *       Design rules honoured:
 *       - Rule #1 (tag-based identity): verbs, instruments, and targets
 *         are plain strings supplied by the stage author, not an enum.
 *       - Rule #4 (pure calculator): no state held here. Scope resolution
 *         is a read on the caller-supplied `scope` set.
 *       - North star 4 (provenance-neutral): LLM fallback is optional;
 *         the grammar layer works standalone. Callers that want pure
 *         determinism pass no `fallback`.
 *
 * WHY: Surfaced from FRONTEND-SHAPE.md §"Gaps the world-primary example
 *      fills": "Deterministic verb-noun-prep grammar with synonym table
 *      + scope-resolution; LLM fallback via `quietCall` on grammar miss.
 *      Returns `Intent { verb, target?, instrument?, modifier? } | null`."
 *      First required by `examples/world-primary/`. Intended to be
 *      extended in full Wave 2B (`world.ts` scope integration, richer
 *      grammar from HHGTTG/Zork prior art).
 *
 * SHAPE:
 *   interface Intent { verb; target?; instrument?; modifier? }
 *   interface SynonymTable { verbs?: Record<alias, canonical>;
 *                            nouns?: Record<alias, canonical> }
 *   interface LlmFallback { quietCall(prompt: string): Promise<string> }
 *   interface ParseIntentOptions { synonyms?; fallback?; scopePrompt? }
 *   parseIntent(input, scope, options?): Promise<Intent | null>
 *   parseIntentSync(input, scope, synonyms?): Intent | null
 */

export interface Intent {
  /** Canonical verb: "go", "take", "examine", "talk", "use", etc. */
  verb: string;
  /** Primary target noun — resolved against scope when possible. */
  target?: string;
  /** Secondary noun (instrument, "use X WITH Y" / "give X TO Y"). */
  instrument?: string;
  /** Adverbial modifier ("quietly", "quickly", etc.). */
  modifier?: string;
}

export interface SynonymTable {
  /** Maps alias verb → canonical verb. E.g. "grab" → "take". */
  verbs?: Record<string, string>;
  /** Maps alias noun → canonical noun. E.g. "door" → "oak-door". */
  nouns?: Record<string, string>;
}

export interface LlmFallback {
  /** Called on grammar miss. The prompt includes the raw input, the
   *  scope, and a JSON schema for the expected output. The caller is
   *  responsible for schema-validating and retrying if desired. */
  quietCall(prompt: string): Promise<string>;
}

export interface ParseIntentOptions {
  synonyms?: SynonymTable;
  /** When set, grammar miss routes here. Result is parsed as JSON
   *  matching `Intent`. If the result still fails to parse, returns
   *  null. */
  fallback?: LlmFallback;
  /** Optional prefix appended to the fallback prompt — use it to
   *  describe the world context. Defaults to listing the scope set. */
  scopePrompt?: string;
}

/* ---------------------------------------------------------------- *
 * Built-in synonym table (universal IF conventions)               *
 * ---------------------------------------------------------------- */

const DEFAULT_VERB_SYNONYMS: Record<string, string> = {
  // go / move
  walk: "go",
  move: "go",
  travel: "go",
  head: "go",
  enter: "go",
  exit: "go",
  leave: "go",
  // take / pick up
  grab: "take",
  pick: "take",
  collect: "take",
  get: "take",
  // look / examine
  look: "examine",
  inspect: "examine",
  study: "examine",
  check: "examine",
  observe: "examine",
  read: "examine",
  view: "examine",
  // talk / speak
  talk: "talk",
  speak: "talk",
  ask: "talk",
  tell: "talk",
  greet: "talk",
  chat: "talk",
  // use / interact
  use: "use",
  apply: "use",
  activate: "use",
  open: "use",
  close: "use",
  push: "use",
  pull: "use",
  // give / drop
  give: "give",
  offer: "give",
  hand: "give",
  drop: "drop",
  put: "drop",
  place: "drop",
  throw: "drop",
  // wait / rest
  wait: "wait",
  rest: "wait",
  // attack / fight
  attack: "attack",
  fight: "attack",
  hit: "attack",
  strike: "attack",
};

/* ---------------------------------------------------------------- *
 * Grammar parser                                                   *
 * ---------------------------------------------------------------- */

/**
 * Tokenise, strip filler words, resolve synonyms, and attempt to
 * extract (verb, target?, instrument?, modifier?) from the token list.
 *
 * Grammar handled (in priority order):
 *   VERB                                 → { verb }
 *   VERB NOUN                            → { verb, target }
 *   VERB NOUN PREP NOUN                  → { verb, target, instrument }
 *   VERB NOUN PREP NOUN MODIFIER         → { verb, target, instrument, modifier }
 *
 * Prepositions that signal an instrument argument:
 *   with, using, via, by, on, in, into, onto, to, at, from
 *
 * Adverbs are matched at the tail if they appear in a known list:
 *   quietly, quickly, slowly, carefully, gently, forcefully
 */

const FILLER_WORDS = new Set([
  "the", "a", "an", "some", "my", "your", "his", "her", "its", "our", "their",
  "this", "that", "these", "those",
  "please", "kindly", "now",
]);

const INSTRUMENT_PREPS = new Set([
  "with", "using", "via", "by", "on", "in", "into", "onto", "to", "at", "from",
  "toward", "towards",
]);

const KNOWN_MODIFIERS = new Set([
  "quietly", "quickly", "slowly", "carefully", "gently", "forcefully",
  "loudly", "softly", "hastily", "cautiously",
]);

function tokenise(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function resolveNoun(token: string, scope: ReadonlySet<string>, nounSynonyms?: Record<string, string>): string {
  // Direct scope match.
  if (scope.has(token)) return token;
  // Synonym → canonical, then scope check.
  const canonical = nounSynonyms?.[token];
  if (canonical && scope.has(canonical)) return canonical;
  // Return as-is (scope check is advisory, not blocking).
  return canonical ?? token;
}

export function parseIntentSync(
  input: string,
  scope: ReadonlySet<string>,
  synonyms?: SynonymTable,
): Intent | null {
  const tokens = tokenise(input).filter((t) => !FILLER_WORDS.has(t));
  if (tokens.length === 0) return null;

  const verbSynonyms = { ...DEFAULT_VERB_SYNONYMS, ...(synonyms?.verbs ?? {}) };

  // First token must be a verb (or a synonym).
  const rawVerb = tokens[0];
  const verb = verbSynonyms[rawVerb] ?? rawVerb;

  if (tokens.length === 1) {
    return { verb };
  }

  // Check last token for a modifier.
  let tail = tokens.length;
  let modifier: string | undefined;
  if (KNOWN_MODIFIERS.has(tokens[tokens.length - 1])) {
    modifier = tokens[tokens.length - 1];
    tail -= 1;
  }

  const bodyTokens = tokens.slice(1, tail);
  if (bodyTokens.length === 0) {
    return { verb, modifier };
  }

  // Look for an instrument preposition.
  const prepIdx = bodyTokens.findIndex((t) => INSTRUMENT_PREPS.has(t));

  if (prepIdx < 0) {
    // No preposition — everything left is the target noun phrase.
    const target = resolveNoun(bodyTokens.join("-"), scope, synonyms?.nouns);
    return { verb, target, modifier };
  }

  const targetPhrase = bodyTokens.slice(0, prepIdx).join("-");
  const instrumentPhrase = bodyTokens.slice(prepIdx + 1).join("-");

  return {
    verb,
    target: targetPhrase ? resolveNoun(targetPhrase, scope, synonyms?.nouns) : undefined,
    instrument: instrumentPhrase ? resolveNoun(instrumentPhrase, scope, synonyms?.nouns) : undefined,
    modifier,
  };
}

/** Fallback prompt template. Returns a JSON-schema directive suitable
 *  for `LlmFallback.quietCall`. */
function buildFallbackPrompt(
  input: string,
  scope: ReadonlySet<string>,
  scopePrompt?: string,
): string {
  const scopeList = scopePrompt ?? `Available objects/exits: ${[...scope].join(", ") || "(none)"}`;
  return [
    `The player typed: "${input}"`,
    scopeList,
    "",
    "Parse the player's intent into JSON with these optional fields:",
    '  {"verb":"<canonical verb>","target":"<noun or null>","instrument":"<noun or null>","modifier":"<adverb or null>"}',
    "Use null for absent fields. Reply with ONLY the JSON object, no commentary.",
    "If the intent is entirely unclear, reply with null.",
  ].join("\n");
}

function parseIntentFromJson(text: string): Intent | null {
  const m = /(\{[\s\S]*\}|null)/.exec(text.trim());
  if (!m) return null;
  if (m[1] === "null") return null;
  try {
    const o = JSON.parse(m[1]);
    if (typeof o !== "object" || o === null) return null;
    if (typeof o.verb !== "string" || !o.verb) return null;
    return {
      verb: o.verb,
      target: typeof o.target === "string" && o.target ? o.target : undefined,
      instrument: typeof o.instrument === "string" && o.instrument ? o.instrument : undefined,
      modifier: typeof o.modifier === "string" && o.modifier ? o.modifier : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Parse player input into a structured `Intent`.
 *
 * Deterministic grammar runs first. On miss (returns null), routes to
 * `options.fallback.quietCall` when supplied. Returns null when both
 * layers fail.
 */
export async function parseIntent(
  input: string,
  scope: ReadonlySet<string>,
  options: ParseIntentOptions = {},
): Promise<Intent | null> {
  const grammarResult = parseIntentSync(input, scope, options.synonyms);
  if (grammarResult !== null) return grammarResult;

  if (!options.fallback) return null;

  const prompt = buildFallbackPrompt(input, scope, options.scopePrompt);
  try {
    const raw = await options.fallback.quietCall(prompt);
    return parseIntentFromJson(raw);
  } catch {
    return null;
  }
}
