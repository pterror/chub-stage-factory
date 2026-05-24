# `src/lib/mining/` — prior-art research

Read-only research reports captured during the design of chub-stage-factory primitives. Each file is the verbatim output of a focused mining run against an external system. They preserve research that would otherwise be lost to conversation rot, and inform specific waves of the library roadmap.

Future foremen designing or implementing a wave referenced below should read the corresponding mining file before writing code — these reports contain concrete patterns to port, anti-patterns to avoid, footgun catalogs, and version-stability notes that the abstract ROADMAP spec doesn't capture.

| File | Topic | Informs |
|------|-------|---------|
| `SYNERGY.md` | SillyTavern / NovelAI / AI Dungeon synergy patterns | Wave 2I synergy pattern catalog expansion (14 new candidates) |
| `SCENE.md` | TiTS + Lilith's Throne scene composition | Wave 2A `scene.ts` primitive design |
| `GRAFTING.md` | Warframe Helminth subsume mechanics | Wave 2D `grafting` pattern (Warframe-shape) |
| `VORONOI.md` | Lord-Raven's `memoria` map renderer | Wave 2E `VoronoiInfluenceMap` UI primitive |
| `RAPIER.md` | Rapier kinematic character controllers | Wave 2H controller patterns (FPS, third-person, etc.) |
| `R3F.md` | React Three Fiber embedded-use best practices | Wave 2F `src/lib/3d/scene.tsx` integration |

Mined 2026-05-24.
