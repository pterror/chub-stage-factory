# COMPOSITION — patterns as first-class composers

This document records the library's positioning stance: the compositional approach must be strictly more powerful than any monolithic framework. It is the philosophical complement to `README.md` (rules) and `PATTERNS.md` (recipes).

## What monoliths win on today

Existing framework-shaped stages (PARC's Skit/Module/Faction/Actor bundles, AI-Dungeon-class engines, single-class extends-from-base setups) have real strengths a composition-first library has to match:

1. **Entry-point ergonomics.** "Make a Skit" is one named thing you grab. "Compose body + inventory + scheduler + observation + tag-parser + prose-register + four shards" is fourteen.
2. **Coherent defaults.** Monoliths pick paradigm, layer, and wiring for you. Composers ask the author to choose.
3. **Domain-noun mapping.** `Faction`, `Module`, `Skit`, `Actor` are nouns the author already thinks in. Our `EffectStore` / `PersistenceStore` / `Shard` are mechanics-nouns.
4. **Less to learn at the door.** One framework concept, vs. N primitives plus their composition rules.
5. **Implicit coherence.** Within the framework, things compose because the framework guarantees it. Composition-from-pieces depends on the author wiring correctly.

## Where composition already wins

Things a framework cannot do at all, or only by major refactor:

1. **Unbounded combinatorics.** Combinations the framework author did not anticipate. PARC cannot ship realtime combat without a major refactor; this library composes it from existing primitives today.
2. **Per-piece paradigm choice.** Persistence layer per shard. Engine swap per subsystem. Branch-aware here, canon there, immutable elsewhere — all in one stage.
3. **Cross-genre reuse.** `Body`, `Inventory`, `Effects` work in any genre. A framework's `Skit` only works for skit-shaped scenes.
4. **Replaceable internals.** Don't like the turn-combat resolver? Replace just that. With a monolith you replace everything or nothing.

## The unlock: patterns become first-class composable artifacts

A pattern is not documentation. A pattern is a callable composer — a function from domain choices to a wired-up bundle of primitives, importable like a primitive, but internally pure composition with no hidden state or hardcoded behavior.

```ts
// src/lib/patterns/skit.ts (illustrative; not yet implemented)
function skitPattern<S>({
  kind,
  actors,
  outcomes,
  prompt,
  register,
}: SkitConfig): ComposedSubsystem<S> {
  // Returns { state, observations, hooks: { beforePrompt, afterResponse }, shards }
  // Internals: just composition of body/inventory/effects/scheduler/observation/tag-parser
  //            primitives with sensible defaults. No private state. No new mechanics.
}
```

With this layer the author can:

- **Use the pattern as-is** for the entry-point ergonomics — as easy as adopting a framework.
- **Pass overrides** for per-knob customization — strictly more flexible than a framework.
- **Compose multiple patterns** in one stage — unique to this library; frameworks fight you here.
- **Drop to raw primitives** when no pattern fits — ceiling-less.

`PATTERNS.md` stops being just docs. Each recipe gets a callable composer at `src/lib/patterns/<name>.ts`. The recipe is the documentation for the composer; the composer is the implementation of the recipe. Both ship together.

At the import statement the author chooses their abstraction level:

```ts
import { Body } from "lib/body";                                  // raw primitive
import { transformationStoryPattern } from "lib/patterns/transformation-story";  // wired bundle
```

## What this means concretely for the library

- **Every PATTERNS.md recipe gets a paired `.ts` composer.** Adding a pattern means adding both the recipe entry and the composer file. They are kept in sync by construction (the same PR adds both).
- **Domain-noun "primitives" we'd otherwise be tempted to ship as monoliths become patterns instead.** `Skit`, `Faction`, `Module`, `Actor`-as-bundle, `Scene`-as-bundle — each is a pattern, not a primitive. The "monolith feel" at the import statement is preserved; the substance underneath is pure composition.
- **The 7-games examples become catalogs of patterns they use**, not "here's a hand-wired stage." Example: Zork-shape = `worldExplorationPattern` + `combatPattern({ engine: "turn" })` + `dialoguePattern` + `scorePattern`. LT-shape = `sandboxPattern` + `scenePattern` + `factionPattern`. Each pattern is a one-line import; the stage code shrinks to a paragraph.
- **A new author starts by reading PATTERNS.md**, grabs the one or two patterns closest to their concept, layers overrides. Same workflow as picking a framework — better, because they can mix patterns across "different genres" without a framework boundary fighting them.
- **As the library grows, what grows fastest is the patterns layer.** Primitives are bounded (a finite set of mechanically distinct things exists). Patterns are unbounded (every composition combo a community wants is a candidate pattern).

## Faction, RelationshipScore, etc.

This positioning also answers questions like "should we ship a `Faction` primitive?" — no, because Faction reduces to `Stat.tier()` plus a content-gate predicate. Ship instead as a `factionPattern` composer that wires those existing pieces. The author still imports one name; the library still ships one symbol; nothing under the hood is a new mechanic.

The decision rule for any candidate addition:

- **Architecturally distinct + earns its keep** → ship as a primitive.
- **Reduces to composition of existing primitives** → ship as a pattern.
- **Doesn't recur enough to name** → ship as a PATTERNS.md recipe entry without a composer (yet).

Note: "doesn't recur" is a description of the current library state, not "wait for a use case." If a pattern is architecturally distinct it ships regardless. The library is supply-driven; demand does not gate.

## The honesty tax

The pattern layer only works if patterns are ruthlessly pure composition. A "pattern" that hides logic is just a framework wearing a hat.

Tests for every pattern source file:

- Approximately 90% wiring (constructing primitives, registering shards, composing hooks) plus 10% sensible defaults.
- No private state held by the pattern itself. Any state lives in the primitives the pattern composes.
- No new mechanics. If a pattern needs behavior no primitive offers, that behavior is a missing primitive — extract it first.
- The implementation file is readable in one sitting; if it isn't, the pattern is doing too much and probably wraps two patterns that should be separate.

When the temptation arises to bake logic into a pattern, the right move is always: extract a primitive, then the pattern composes it.

## Status

This positioning is current as of 2026-05-23; the patterns layer (`src/lib/patterns/`) is not yet implemented. Adoption plan tracked in repository `TODO.md`.
