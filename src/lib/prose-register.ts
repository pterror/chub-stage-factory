/*
 * prose-register.ts — instruction blocks for the LLM, paired with observation.ts.
 *
 * WHAT: A catalog of named "passage architectures" (rhetorical shapes the LLM
 *       can use to render a scene) plus a register doc (POV, tense, distance).
 *       `proseInstructions({architectures, register})` builds a single block
 *       a stage can prepend to its observations payload. The strings are
 *       deliberately verbatim — they're authored as if for the LLM, not as
 *       templates to be filled.
 *
 * WHY: Rule #9. The stage emits structured world data; this module gives the
 *       LLM the prose vocabulary. Stages don't write prose; they pick a
 *       register and let the model handle the rest.
 *
 * SHAPE:
 *   type ArchitectureName =
 *     | "accumulation" | "contrast_pair" | "zoom_out" | "fragment_cascade"
 *     | "focus_hold" | "body_then_world" | "appositive_fold"
 *     | "terminal_sense_shift" | "arrival_sequence" | "conditional_inversion";
 *   interface RegisterSpec {
 *     pov: "first" | "close-second" | "third";
 *     tense: "past" | "present";
 *     distance: "close" | "near" | "wide";
 *     extras?: string[];
 *   }
 *   PARSE_TIME_REGISTERS: Record<string, RegisterSpec>   // shorthands
 *   ARCHITECTURES: Record<ArchitectureName, { summary: string; example: string }>
 *   proseInstructions({architectures, register}): string
 */

export type ArchitectureName =
  | "accumulation"
  | "contrast_pair"
  | "zoom_out"
  | "fragment_cascade"
  | "focus_hold"
  | "body_then_world"
  | "appositive_fold"
  | "terminal_sense_shift"
  | "arrival_sequence"
  | "conditional_inversion";

export interface RegisterSpec {
  pov: "first" | "close-second" | "third";
  tense: "past" | "present";
  distance: "close" | "near" | "wide";
  extras?: string[];
}

export const PRESET_REGISTERS: Record<string, RegisterSpec> = {
  "close-2nd-past": { pov: "close-second", tense: "past", distance: "close" },
  "close-2nd-present": { pov: "close-second", tense: "present", distance: "close" },
  "1st-past": { pov: "first", tense: "past", distance: "close" },
  "wide-3rd-present": { pov: "third", tense: "present", distance: "wide" },
};

export const ARCHITECTURES: Record<ArchitectureName, { summary: string; example: string }> = {
  accumulation: {
    summary:
      "Stack short observations in series, each pulling focus a degree further from where the previous one ended. The reader's attention accretes; nothing resolves until the last clause.",
    example:
      "Cold floor. Cold tile. Cold seam between two tiles where her toe found a gap of grout.",
  },
  contrast_pair: {
    summary:
      "Two adjacent sentences (or clauses) that put a sensory or emotional pair into direct opposition without commentary.",
    example:
      "The room was warm. Her hands were not.",
  },
  zoom_out: {
    summary:
      "Begin at the body or an object; widen by one ring per sentence until the scene boundary.",
    example:
      "Her thumb. The cup. The countertop. The kitchen at the wrong hour. The house she had agreed to.",
  },
  fragment_cascade: {
    summary:
      "Permit incomplete sentences in rapid succession to mimic perception under stress or fatigue. Use sparingly.",
    example:
      "Door open. Light on. Wrong shoes by the wall. Not hers.",
  },
  focus_hold: {
    summary:
      "Stay on a single small detail for two or three sentences before allowing the scene to advance. The hold creates weight without exposition.",
    example:
      "The faucet dripped. It dripped again. Between the drips was the only quiet in the building.",
  },
  body_then_world: {
    summary:
      "Open with one interoceptive cue (breath, heat, ache), then move outward to one external cue, then back to action. Establishes embodiment before scene.",
    example:
      "Her jaw was clenched; she hadn't noticed. Sun on the back of her neck. She turned away from it.",
  },
  appositive_fold: {
    summary:
      "Use commas to fold a noun together with its description, letting modifiers do the work that an additional sentence would otherwise carry.",
    example:
      "She unwrapped the parcel, the one her mother had refused to address by name.",
  },
  terminal_sense_shift: {
    summary:
      "Switch sensory modality at the last clause of the paragraph: visual paragraph ends on smell, auditory paragraph ends on touch. The shift signals the next beat.",
    example:
      "The street, the streetlights, the late hour of the late season — and the metal of the railing, cold under her palm.",
  },
  arrival_sequence: {
    summary:
      "When a character enters a space, render the entrance as: threshold cue, body cue, then one detail that locates them in the scene's emotional weather. Three beats; no more.",
    example:
      "The door closed behind her. Her shoulders dropped a quarter-inch. The kitchen was already full of someone else's morning.",
  },
  conditional_inversion: {
    summary:
      "Lead with the dependent clause when the dependent clause carries the weight; lead with the main clause when the main clause is the surprise.",
    example:
      "If she had stayed five more minutes she would have heard him say it. She did not stay.",
  },
};

export function proseInstructions(opts: {
  architectures: readonly ArchitectureName[];
  register: RegisterSpec | keyof typeof PRESET_REGISTERS;
}): string {
  const reg =
    typeof opts.register === "string" ? PRESET_REGISTERS[opts.register] : opts.register;
  const arches = opts.architectures.map((n) => {
    const a = ARCHITECTURES[n];
    return `- **${n}** — ${a.summary}\n    e.g. ${a.example}`;
  });
  const extras = reg.extras?.length ? `\nExtras: ${reg.extras.join("; ")}.` : "";
  return [
    "<prose-instructions>",
    `Render the next passage in **${reg.pov} POV**, **${reg.tense} tense**, **${reg.distance} narrative distance**.${extras}`,
    "When the observations payload below applies, prefer the following passage architectures (use one or two; do not chain all of them):",
    ...arches,
    "Treat the observations as the *world's* state, not the prose. Do not list them. Do not narrate them as a status block. Let them surface through what the character does and notices.",
    "</prose-instructions>",
  ].join("\n");
}
