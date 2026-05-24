# `src/lib/design/` — implementation-ready design docs

Synthesized 2026-05-24 from `src/lib/mining/*.md` + the relevant ROADMAP wave specs. Each file is the bridge between abstract spec and code: concrete API surface, key decisions made, footgun mitigations encoded as defaults, open questions deferred to implementation time.

Future foremen implementing a wave should read the corresponding design doc as their primary spec, the mining doc as supporting prior art, and the ROADMAP wave section for cross-wave context.

| File | Informs | LOC |
|------|---------|-----|
| `SCENE.md` | Wave 2A `scene.ts` primitive | 221 |
| `GRAFTING.md` | Wave 2D `graftingPattern` composer (Warframe-shape) | 222 |
| `VORONOI.md` | Wave 2E `VoronoiInfluenceMap<E>` UI primitive | 118 |
| `R3F-SCENE.md` | Wave 2F `src/lib/3d/scene.tsx` integration | 127 |
| `CONTROLLERS.md` | Wave 2H character controller patterns (6 controllers) | 342 |
| `SYNERGY-EXTENSIONS.md` | Wave 2I `LlmPipeline` primitive + 14 new synergy patterns | 244 |

Each design doc surfaces ROADMAP impacts (LOC corrections, new primitive proposals, additive extensions to existing primitives). Those impacts are folded into ROADMAP in the same commit that creates this index.
