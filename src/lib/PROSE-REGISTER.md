# `prose-register.ts` — prose instruction builder

Builds the `<prose-instructions>` block that tells the LLM how to render prose:
which POV/tense/distance to use, and which passage architectures to prefer.
Pairs with `observation.ts`; stages emit world state as observations, this module
gives the model its writing job description.

## Concepts

A **register** is three orthogonal choices:
- `pov`: `"first"` | `"close-second"` | `"third"`
- `tense`: `"past"` | `"present"`
- `distance`: `"close"` (constant interiority) | `"near"` | `"wide"` (external only)

An **architecture** is a named passage shape (`"accumulation"`, `"contrast_pair"`,
`"zoom_out"`, etc. — 10 total). See `PROSE.md` for descriptions and examples.

No preset register catalog ships. Construct `RegisterSpec` inline at each callsite;
if a stage reuses one, declare it as a local `const` in its own module.

## API

- `type ArchitectureName` — union of 10 architecture keys (lines 38–48)
- `interface RegisterSpec { pov, tense, distance, extras? }` (lines 50–55)
- `ARCHITECTURES: Record<ArchitectureName, { summary, example }>` — verbatim LLM-facing descriptions (lines 57–118)
- `proseInstructions({ architectures, register }): string` — returns a `<prose-instructions>` XML block (lines 126–144)
- `proseRegisterContributor` — re-export of the `ContextAssembler` adapter from `context.ts` (line 124)

## Example

```ts
import { proseInstructions } from "./lib/prose-register";

const block = proseInstructions({
  architectures: ["body_then_world", "contrast_pair"],
  register: { pov: "close-second", tense: "present", distance: "close" },
});
// Prepend block to stageDirections alongside formatObservations(...).
```

## Gotchas

- `proseInstructions` is a snippet builder, not a transport. For stages that call
  the generator directly (custom `textGen`), paste the block into the system prompt
  of that call — don't rely on `stageDirections` delivery.
- `extras` is a free-text escape hatch for per-stage constraints
  (`"avoid the word 'feel'"`, `"no proper nouns"`).

## Related

- `PROSE.md` — human-readable mirror of the architecture catalog.
- `observation.ts` — the world-state side of the same pipeline.
- `chub-adapters.ts` — `emitStageDirections` combines both into one call.
- `context.ts` — canonical definition of `proseRegisterContributor`.
