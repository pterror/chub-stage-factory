# Prior-Art Mining: Synergy Patterns Beyond Our 8

> Mined 2026-05-24 as prior art for chub-stage-factory primitives library.
> Captured verbatim from the mining run; informs the Wave 2I synergy pattern catalog expansion.

---

## Confirmation / contradiction of existing 8

- **`hierarchical-summarization`** — strongly confirmed. AI Dungeon's Memory System is the canonical implementation: "auto-generated summary of a small set of your previous story actions" appended into a running **Story Summary** Plot Component. SillyTavern's `Summarize` extension does single-level rolling summaries — flatter than ours; AID's two-tier (Memories → Story Summary) actually matches our sketch more closely.
- **`cache-by-key`** — confirmed by SillyTavern World Info "Selective" entries (string/regex key → cached payload), NovelAI Lorebook keys, AID Story Cards. Universal.
- **`fallback-chain`** — partially confirmed: SillyTavern's vectorized WI entries fall back to keyword if embeddings miss; AID's "if Summary+WI+Remember <50%, fill with history" is a budget-based fallback.
- **`llm-constrained-by-procgen`** — confirmed: character cards, scenario, Plot Essentials are all procgen-supplied constraints. NovelAI **Phrase Bias** is a sharper version (procgen sets token-level constraints, not just text).
- **`procgen-validates-llm`** — under-represented in these systems. SillyTavern Objectives' "Task Check" is the closest analog (LLM judges, but procgen schedules the check). True deterministic validation is rare in this ecosystem.
- **`llm-narrates-programmatic-tracks`** / **`programmatic-narrates-llm-decides`** — Objectives extension fits the first (procgen owns the goal list, LLM narrates progress). AID Scripting's `inputModifier` → LLM → `outputModifier` fits both directions.
- **`seed-from-player`** — implicit everywhere (Persona, character creation); no system foregrounds it as a pattern.

## New patterns to add to the catalog

1. **`recursive-key-expansion`** — One LLM/procgen output's text is re-scanned for keys that trigger *more* injected entries, bounded by depth + token budget. Source: SillyTavern WI **recursion** (Max Recursion Steps, "Delay until recursion", "Prevent further recursion"); NovelAI **cascading activation** (scans Memory/AN/other entries, not just story). Composes with `cache-by-key` by making the cache reactive to its own hits.

2. **`positional-injection-depth`** — Entries declare not just *what* to inject but *where* (depth N from end, role=system/user/assistant, before/after char defs, top/bottom of AN). Source: SillyTavern WI position field; AID's "Front Memory" (last-action slot) and Author's Note (~depth 3). Generalizes `llm-constrained-by-procgen` by making position itself a procgen output.

3. **`inclusion-group-mutex`** — Multiple eligible candidates in the same group; exactly one wins by weight or order. Source: SillyTavern WI **Inclusion Groups**. Composes with `cache-by-key` to provide variation without duplication (e.g., one of N flavor lines per scene).

4. **`sticky-cooldown-delay-timers`** — Temporal lifecycle on cached entries: sticky (stays N turns after activation), cooldown (locked for N after firing), delay (can't fire until turn N). Source: SillyTavern WI **Timed Effects**. New primitive class — turn-counter state machines layered on `cache-by-key`.

5. **`recency-frequency-eviction`** — When budget is tight, rank candidate entries by recency-of-trigger × frequency-of-trigger and admit greedily. Source: AID Story Cards ("sorted and prioritized... as many as will fit"). A specific eviction policy our `fallback-chain` doesn't currently specify.

6. **`force-activate-with-budget-cap`** — A binary "always on if it fits" flag, distinct from selective/keyed entries; if budget exhausted it silently drops. Source: NovelAI **Force Activation**; SillyTavern "Constant" entries. Different from cache hit because it never depends on input.

7. **`subcontext-group-budgeting`** — A *category* of entries is concatenated and treated as one unit for context insertion with its own internal token budget and order. Source: NovelAI **Subcontext** toggle. Composes with `hierarchical-summarization` by giving each level its own budget envelope.

8. **`triple-hook-pipeline`** (input/context/output modifiers) — Three deterministic stages wrap each LLM call: pre-LLM rewrite of player input, hidden rewrite of the assembled context, post-LLM cleanup of generation. Source: AID Scripting (`inputModifier`, `contextModifier`, `outputModifier`) plus `state` object for persistence. This is the canonical envelope for procgen↔LLM interleaving; our 8 don't name the *shape* of the wrapper.

9. **`quiet-generation-sub-call`** — A side LLM call whose output never enters the chat log; used to fetch decisions, classifications, or summaries. Source: SillyTavern **Quiet Mode** (used by Summarize, Objectives task-check, Image-gen prompt synthesis); STscript `/gen quiet=true`. Different from a regular call because outputs are routed to procgen state, not the transcript. This is the missing "agentic sub-call" primitive.

10. **`scripted-quick-reply-macro`** — Author-defined macros that mix slash-commands, variable reads, and LLM sub-calls; user (or autofire trigger) invokes a chain. Source: SillyTavern **STScript / Quick Replies**, also `Guided-Generations`. Generalizes `programmatic-narrates-llm-decides` into a user-extensible DSL.

11. **`semantic-recall-overlay`** — Top-K vector retrieval over chat history / files / WI runs *alongside* keyed retrieval; both feed the same prompt budget. Source: SillyTavern **Vector Storage / Data Bank RAG**, deprecated Smart Context (ChromaDB), `sillytavern-character-memory` (auto-extract structured memories → Data Bank). Distinct from `cache-by-key` because the key is the *embedding of recent context*, not a string match.

12. **`scheduled-self-check`** (a.k.a. "every-N-turn LLM audit") — A periodic procgen-driven sub-call that asks the LLM to evaluate state (task done? scene changed? mood shift?). Source: SillyTavern Objectives **Task Check Frequency**. Composes `procgen-validates-llm` with `quiet-generation-sub-call`.

13. **`character-filtered-activation`** — Entries restricted to fire only when a specific speaker / persona is active. Source: SillyTavern WI **Character Filters** + per-character lorebooks; NovelAI per-category settings. A scope primitive missing from our list.

14. **`override-slots`** (a.k.a. "card-supplied prompt overrides") — Procgen content can override system prompt, jailbreak, or post-history block, not just append to it. Source: SillyTavern character card's **Main Prompt override** and **Post-History Instructions**; NovelAI Memory field. Distinct from injection because it *replaces*.

## Cross-cutting observations

- **Failure modes** consistently mentioned: WI **leakage** (one entry's traits bleed onto unrelated characters — Griffin model), **key saturation** (over-broad keys eat budget), **tokenization quirks** (emoji = 2 tokens, compound words split unexpectedly), **recursion runaway**, and Objective task-check firing on empty task lists. Mitigations: token budgets, recursion caps, inclusion groups, mutex timers. Our catalog should probably name **`budget-poisoning`** and **`key-collision`** as anti-patterns paired with the patterns that cause them.
- **No system** in this set implements deterministic `procgen-validates-llm` with hard rejection + retry; everything uses soft LLM-as-judge. This is genuinely novel territory for chub-stage-factory.
- The **`triple-hook-pipeline` + `quiet-generation-sub-call` + `state`-object** trio (AID Scripting) is the most general substrate; our 8 patterns can all be re-expressed inside it. Worth adopting as the framing primitive.

## Sources

- SillyTavern World Info, character design, extensions, Objective, STScript docs
- SillyTavern Vector Storage / RAG (DeepWiki), Data Bank docs
- NovelAI Lorebook docs + unofficial KB (tapwavezodiac)
- AI Dungeon Memory System, Context composition docs
- latitudegames/Scripting (AID script hooks)
- AID World Info research sheet (valahraban)
- Guided-Generations Quick Reply set
- sillytavern-character-memory
