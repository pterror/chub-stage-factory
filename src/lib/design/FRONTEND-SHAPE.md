# Frontend shape — the "just good" roleplay frontend, in detail

> Extends `src/lib/COMPOSITION.md` §"Beyond chub-stage-factory: a roleplay frontend that is just good".
> Synthesized 2026-05-25 from session conversation.
> Implementation target: `examples/world-primary/`.

The COMPOSITION.md section names the *shape*. This doc names the *how*: the per-turn interaction loop, where the structure comes from, how the library's existing primitives map to the renderer/oracle split, the Chub host mechanism that makes the shape implementable as a stage, and the relationship to Chub's planned user-promptable tool-calling.

---

## The failure pattern this routes around

Modern RP frontends (SillyTavern, Risu, Agnaistic, Janitor, AI Dungeon's chat mode, et al.) are **chat frontends, not roleplay frontends**. They pipe text between user and LLM and model nothing. RP-ness lives entirely in the system prompt and the user's discipline. Specifically:

- The chat log is the world model. State is whatever the LLM re-derives from scrolling history. Anything durable (relationships, locations, inventory) drifts, contradicts, or gets forgotten when it falls out of context.
- Freeform text in, freeform text out. No structured affordances. The model parses intent every turn from prose, often wrongly.
- Turn-by-turn accretion. Each reply is appended; the prompt grows longer, more incoherent, more expensive. No compression, no snapshot, no replan.
- Lorebooks/Memory/World Info are keyword-triggered string injection — brittle, opaque, not addressable as structured data.
- The UI is optimised for "read the bot's reply," not "see the world." Interesting state is buried.

The frontend doesn't enforce mono-character or any other shape — it imposes *no* shape, which is the actual problem. The "RP frontend" is a chat box wearing different system prompts.

## The shape

The fix inherits from 30 years of IF/text-game design (Lilith's Throne, *not* TiTS — see below) and replaces the authored-prose layer with LLM rendering:

- **State is the protagonist.** Fiction renders over a state machine the user manipulates. Prose is downstream of state, not parallel to it.
- **Structured input is the fast path.** Verbs derived from `schema × current state` handle 90% of play deterministically.
- **Freeform is the escape hatch.** A text field routes through an LLM oracle for off-path intent. Preserves the LLM-as-sandbox advantage without making it the primary surface.
- **The LLM has two roles, sharply split:**
  - *Renderer.* `state + trigger + stub → prose`. Cannot mutate state.
  - *Oracle.* `state + freeform text → proposed state delta + render stub`. Never emits user-facing prose.
- **Single-shot prompts** assembled from state contributors, not from accumulated history. Chat history is one bounded contributor among many.
- **Chat log is a side panel** showing past rendered scenes. Not the input, not the state.

## Why TiTS is the anti-pattern, LT is the pattern

Trials in Tainted Space (TiTS), Flexible Survival, and Trap Quest all have the right *external* shape — state cascades, transformations stack, status effects shape what verbs work. They're prior art for "state is the protagonist." But **TiTS internally is flat prose functions** — every scene variant is hand-authored, and authorial labour pays for all combinatorics, which is why those games feel 40% empty when you push into corners.

Lilith's Throne is the corrective. Engine-driven combinatoric dispatch: scene state is a state machine (`SexType` verb tuple, `SexPace` and `Agency` as orthogonal axes, slot-map pose, arousal as tracked state). Authored prose lives in *slots* dispatched by state. The library's `scene.ts` already implements this (`SceneActionDef.prose: Partial<Record<Pace, [string, string, string]>>`).

The LLM-native move generalises further: the slot doesn't need three prose variants per pace. It can be a stub — a short directive describing what should happen with what tone — and the LLM renders rich prose conditioned on full current state at render time. This lifts the authoring ceiling entirely while keeping the engine-driven dispatch that makes LT feel like a world.

Counterfeit Monkey points at a stronger form (world model *is* the parseable grammar of objects), but that's a later wave; the load-bearing inheritance is LT's engine shape.

## The per-turn interaction loop

```
┌─────────────────────────────────────────────────────────────┐
│  1. Present state                                           │
│     - WorldStatePanel: location, present actors, salient    │
│       stats from current messageState                       │
│     - ScenePane: last rendered prose                        │
│     - ChatLogSidebar: past rendered scenes (collapsible)    │
├─────────────────────────────────────────────────────────────┤
│  2. Present affordances                                     │
│     - ActionSurface: structured verbs derived from          │
│       (schema × current state). A verb is shown iff its     │
│       preconditions hold against state.                     │
│     - FreeformInput: text field (escape hatch).             │
├─────────────────────────────────────────────────────────────┤
│  3a. Structured path (user clicks a verb)                   │
│     - Preconditions checked, state mutations applied        │
│       deterministically (or stochastically with explicit    │
│       dice). Cheap and predictable. No LLM call yet.        │
│  3b. Freeform path (user submits text)                      │
│     - intent.ts: deterministic grammar parses; on miss,     │
│       LlmPipeline.quietCall as oracle proposes a delta.     │
│     - Schema validates the delta. Sandbox policy decides:   │
│       strict (reject) | coerce (remap to nearest legal)     │
│       | extend (allow schema-extension within bounds).      │
│     - Approved delta is applied.                            │
├─────────────────────────────────────────────────────────────┤
│  4. Render                                                  │
│     - Conditional triggers evaluated against new state.     │
│     - For each firing trigger: ContextAssembler builds      │
│       prompt (state contributors + trigger event + stub),   │
│       single LlmPipeline call returns prose.                │
│     - ScenePane updates. Rendered scene appended to         │
│       ChatLogSidebar.                                       │
├─────────────────────────────────────────────────────────────┤
│  5. Loop. New state regenerates affordances for turn N+1.   │
└─────────────────────────────────────────────────────────────┘
```

The renderer cannot mutate state. The oracle cannot emit user-facing prose. This split is what keeps either role from drifting into the other's failure mode (LLM-renderer hallucinating new entities into existence; LLM-oracle padding state mutations with flavour text that bypasses the renderer).

## Where the structure comes from — five layers

| Layer | Author | Lifecycle | Examples |
|---|---|---|---|
| **1. Schema** | Library | Once | `Actor`, `Inventory`, `Scene`, `Predicate`, `Trigger` |
| **2. Instance** | Stage author (or procgen or LLM-synthesis) | `load()` | This world's specific rooms, NPCs, starting stats |
| **3. Derived affordances** | Runtime | Per-turn, automatic | Verb buttons computed from `schema × current state` |
| **4. Stubs** | Stage author | Per-trigger, authored | Short directives describing scenes the LLM expands |
| **5. Sandbox policy** | Stage author | Per-stage config | `strict` \| `coerce` \| `extend` for oracle deltas |

Nothing crosses layers. The library knows kinds, not instances. The stage author knows the instance, not the schema. The runtime knows the affordances but does not author them. The LLM owns prose generation and (within the oracle role) constrained delta proposal. Each layer's failure modes are isolated.

## Mapping to existing primitives

| Role | Implementation |
|---|---|
| State model | Three-layer `initState`/`messageState`/`chatState` from `chub-adapters.ts` |
| Scene state machine | `scene.ts` (`SceneAct`, `Pace`, `Agency`, `ScenePosition`, `SceneActionDef`) |
| Scene triggers | `trigger.ts` (`ConditionalTrigger`) + `predicate.ts` |
| Renderer LLM call | `generate.ts` + `context.ts` (`ContextAssembler` with state contributors) |
| Single-shot prompt assembly | `context.ts`; `chat-window.ts` is one bounded contributor, not the prompt |
| Renderer pipeline (wrapper) | `llm-pipeline.ts` (main call) |
| Oracle LLM call | `llm-pipeline.ts` (`quietCall` — output never enters chat log) |
| Stub format | `SceneActionDef.prose: Partial<Record<Pace, [string, string, string]>>` (LT-shape) — generalised below |

**Gaps the `world-primary` example fills** (each promotes from example wiring to library primitive on first reuse):

1. **`intent.ts`** (Wave 2B, narrow first cut). Deterministic verb-noun-prep grammar with synonym table + scope-resolution against current state; LLM fallback via `quietCall` on grammar miss. Returns `Intent { verb, target?, instrument?, modifier? } | null`.
2. **`patterns/render-trigger.ts`**. `renderTrigger({ trigger, assembler, pipeline, stub })` — when trigger fires, assemble context, call main LLM, return prose. Wires the implicit "trigger → render" path that the corpus implied but never codified.
3. **`patterns/freeform-pipeline.ts`**. `freeformPipeline({ intent, oracle, applyDelta, render, policy })` — freeform text → intent parse → (on miss) oracle proposes delta+stub → policy validates → apply → render. Wires the full escape-hatch loop.
4. **`src/lib/ui/`**. `WorldStatePanel`, `ActionSurface`, `ScenePane`, `ChatLogSidebar`, `FreeformInput` — the shell. (Existing Wave 2E UI primitives like TileGrid/StatBar are *game components*; this is the *shell* they sit inside.)

## Chub host mechanism: fullscreen stages

Chub stages can be **fullscreen** (PARC-style) — the stage iframe hijacks the entire host UI. This unblocks the shape entirely:

- Chat log is not a Chub-owned side panel; it's whatever the stage draws (or omits).
- Chub's chat box is not the user's only input affordance; structured buttons in the stage's iframe are genuinely primary.
- Chub becomes the host shell (auth, persistence backend, LLM endpoint). The stage *is* the frontend.

Two open questions about which path to take, deferred to the example's implementation:

- **Who drives the render LLM call?** Either still through Chub's `beforePrompt`/main-LLM/`afterResponse` cycle (cheap reuse of Chub's pipes), or stage-side via `LlmPipeline` directly against Chub's exposed LLM endpoint (skips `afterResponse`-coupled work, if any). The example will start with the former and measure friction.
- **What's load-bearing in `afterResponse`?** Determines whether bypassing it costs anything (persistence flush, rate limiting, billing). Investigate when wiring the example.

## Relationship to Chub's planned user-promptable tool-calling

Tool-calling Chub does not replace this design. The shapes optimise for different things:

| | Tool-calling Chub | World-primary |
|---|---|---|
| Authoring overhead | Zero (write a tool, done) | Schema commitment upfront |
| State model | Whatever the user builds (usually nothing) | Engine-enforced, library-typed |
| Who drives | LLM (decides when/how to call tools) | Engine (LLM proposes within constraints) |
| Affordance surface | Invisible (tools fire from prose) | Visible (buttons that mean things) |
| Render/decide separation | Conflated (ReAct-style traces) | Sharply split (renderer cannot mutate) |
| Invariant enforcement | None (LLM narrates around contradictions) | Engine rejects illegal state |
| Best for | Lightweight conversational RP with utilities | Long-running coherent worlds, compounding state |

**Tool-calling is a candidate substrate for the oracle role.** "LLM resolves freeform user input by proposing state mutations" is exactly tool-calling against the schema. Chub's feature gives our oracle path a cleaner implementation primitive than current `quietCall + structured-output-with-validation`. Adopting it strengthens the design, not replaces it.

The honest market bet: tool-calling will win lightweight conversational RP (bigger market). World-primary is for the "infinite TiTS / infinite FlexSurv / infinite CoC" use case — games where mechanical state compounds over hundreds of turns and the player wants coherence. We are not competing for the former.

## What `world-primary` demonstrates

In scope:

- A small hand-seeded world (2–3 locations, 2–3 NPCs, small inventory, 1–2 scene triggers, 1–2 stat-driven effects).
- The full shell (`src/lib/ui/`).
- `renderTrigger` driving scene resolution.
- `freeformPipeline` handling off-grammar input with `coerce` policy.
- Three-layer persistence, branch-aware via `setState`.
- Fullscreen iframe; stage-drawn chat-log side panel; Chub chat UI bypassed.

Deliberately out of scope (next example or next wave):

- Procgen instance generation (the "infinite X" demo with this shape).
- Sandbox policy `extend` (LLM dynamically extending schema within bounds).
- Salience-weighted observation context beyond defaults.
- Crescent port; non-Chub host adapters.

## Forward links

- `src/lib/INTENT.md` (to be written) — `intent.ts` API.
- `src/lib/patterns/render-trigger.ts`, `src/lib/patterns/freeform-pipeline.ts` (to be written).
- `src/lib/ui/` (to be written).
- `examples/world-primary/` (to be written).
- `src/lib/ROADMAP.md` Wave 2B / Wave 2E / Wave 2I — will reflect partial landings as these primitives ship.
