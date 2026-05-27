# chub-stage-factory

A workspace for building [Chub](https://chub.ai) stages. It ships a library of
game-state primitives (`src/lib/`), composable pattern recipes (`src/lib/PATTERNS.md`),
8 working reference examples (`examples/`), build and deploy scripts, and a
Claude Code workflow that takes you from blank spec to deployed stage.

Structurally forked from [CharHubAI/extension-template](https://github.com/CharHubAI/extension-template);
the "clone-me" framing has been replaced by the two-phase workflow below.

---

## What is a Chub stage?

A stage is a TypeScript class (`StageBase`) that runs alongside a Chub AI chat.
It receives every message before the model sees it (`beforePrompt`) and every
reply before the user sees it (`afterResponse`), maintaining game state across
the conversation. Stages can render a sidebar UI and push system prompts
describing the current world state to the model. See the
[Chub stages docs](https://docs.chub.ai/docs/stages) for the platform side.

---

## Quick start

```bash
# 1. Enter the dev environment (provides node 21 + bun via Nix)
nix develop

# 2. Install deps and start the picker UI
bun install
bun run dev
# Opens a browser with a picker listing every reference example.

# 3. Build a specific example to verify the pipeline
node scripts/build-example.mjs inventory

# 4. Run an example in headless mode (no browser)
node scripts/run-stage.mjs inventory
```

---

## I want to build a new stage

**With Claude Code (recommended):**

Open this directory in Claude Code and read `CLAUDE.md`. The two-phase workflow
walks you through co-designing a spec in `DESIGN.md` (Phase 1) and then running
`/loop` to let Claude build and iterate autonomously (Phase 2).

**Without Claude Code (manual path):**

1. Copy a reference example that is close to what you want:
   ```bash
   cp -r examples/inventory examples/my-stage
   ```
2. Edit `examples/my-stage/Stage.tsx` — the primitives you need are in `src/lib/`.
   See `src/lib/PATTERNS.md` for recipe skeletons.
3. Update `examples/my-stage/chub_meta.yaml` and `scenario.yaml` with your
   stage's name and description.
4. Add your example to `examples/registry.ts` so the dev picker finds it.
5. Build and deploy:
   ```bash
   node scripts/build-example.mjs my-stage
   STAGE_ID_MY_STAGE=<chub-id> CHUB_AUTH_TOKEN=<token> \
     node scripts/deploy-example.mjs my-stage
   ```

Fill in `DESIGN.md` either way — it doubles as a deploy checklist.
See `DESIGN.example.md` for a filled-in example.

---

## What's in here

```
src/lib/              # Primitives (one file per domain)
  inventory.ts        # Spot-based stacks with carry-class semantics
  body.ts             # Part-tracked body with transformation stacking
  equipment.ts        # Equipment x transformation tag interop
  combat-turn.ts      # Initiative-ordered turn combat
  combat-realtime.ts  # Tick-based spatial combat
  effects.ts          # Buffs / debuffs / status effects
  physics.ts          # AABB / circle collision
  persistence/        # PersistenceStore, withPersistence HOC, Chub state layers
  patterns/           # High-level composers (inventoryPattern, scenePattern, ...)
  ...                 # 20+ additional modules; each has a companion .md

src/lib/PATTERNS.md   # 20 composable recipes — start here when choosing primitives

examples/             # 8+ self-contained working stages (one per recipe)
  inventory/          # Simplest — spot-based shopkeeper
  turn-combat/        # Initiative-ordered combat
  tits-body/          # Body transformation
  cyber-slots/        # Equipment x transformation
  effects/            # Buffs / debuffs
  physics/            # Collision sandbox
  realtime-combat/    # Tick-based spatial
  composite-showcase/ # Cyberpunk clinic combining most primitives
  world-primary/      # World-state-primary RP frontend shape
  registry.ts         # Central index (add your example here)
  README.md           # Example index + build/deploy reference

scripts/              # build-example.mjs, build-all-examples.mjs,
                      # deploy-example.mjs, run-stage.mjs

scenarios/            # Scenario fixtures for integration testing
```

---

## References

- Chub stages docs: <https://docs.chub.ai/docs/stages>
- Upstream extension template: <https://github.com/CharHubAI/extension-template>
- Design spec template: `DESIGN.md` / `DESIGN.example.md`
- Pattern recipes: `src/lib/PATTERNS.md`
- Roadmap: `ROADMAP.md`
- UX audit: `UX-AUDIT-2026-05-27.md`

`LICENSE.txt` carries over from the upstream extension template.
