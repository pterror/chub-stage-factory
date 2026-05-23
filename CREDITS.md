# CREDITS

`src/lib/` borrows directly from work I have access to in other repos.
Concrete attributions:

## Frond (GDScript) — direct port

`src/lib/tags.ts`, `body.ts`, `transformation.ts`, `equipment.ts`,
`constraints.ts`, and `snapshots.ts` are TypeScript ports of the GDScript
module at `~/git/rhizone/playmate/scripting/frond-gdscript/`. The library's
nine rules (tag identity, def/instance, detect-vs-resolve, pure calculators,
explicit ticks, time = `f(now - start)`, seeded streams, tier functions,
observation sources) are the same rules Frond is built on. Authored under
the playmate project (MIT). Phase 6 extensions (transformation trajectories,
equipment acquisition snapshots + `fit()`, asymmetric habituation on stats,
grid-inventory overlay) are additions specific to this repo.

## existence — design insights, not code

`~/git/paragarden/existence/`. No code is copied. Generalized insights
informing the library:

- **Spot-based inventory with carry-class drift** (`existence/js/items.js`,
  `clothing.js`): the distinction between fixed / explicit / habitual items
  and the "habitual items follow the actor probabilistically" mechanic in
  `inventory.ts.resolveLeaveLocation`. existence's specific spots and prose
  are not carried over.
- **Channel-keyed observation sources** (`existence/docs/design/senses.md`,
  `prose-generation.md`): the structured-not-prose stage→LLM bridge in
  `observation.ts`, plus the salience-with-habituation pattern.
- **Tier functions over thresholds** (existence-wide): codified as
  `stats.ts.thresholdTiers` and rule #8.

Anti-imports (deliberately not generalized from existence): the
neurochemistry model, the anti-fantasy framing, the identity-dimension
graph, and the CART-style habit learner. These are existence-specific and
out of scope for a stage primitives library.

## CharHubAI / extension-template — skeleton

The repository's `src/main.tsx`, `src/App.tsx`, `src/TestRunner.tsx`,
`public/`, `package.json`, and `.github/workflows/*` are from
[CharHubAI/extension-template](https://github.com/CharHubAI/extension-template).
`src/Stage.tsx` was the template's example stage and is left intact for the
two-phase workflow's `/design-stage` then `/build-stage` to overwrite.

## Licensing

All upstream sources are MIT-licensed. `src/lib/` is therefore distributable
under MIT as part of this repository.
