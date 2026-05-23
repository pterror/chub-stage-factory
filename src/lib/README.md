# `src/lib/` — primitives for Chub stages

A vendored, dependency-free toolbox for building Chub stages. Not a framework. Stages still
`extends StageBase` from `@chub-ai/stages-ts`; this directory is a pile of small composable modules
you reach for so you don't reinvent inventory, body-state, combat, or LLM-bridge plumbing each time.

If you are the LLM building a stage: skim this file first, then `REFERENCE.md` to find the right
primitive, then the matching recipe in `PATTERNS.md`. Touch raw `StageBase` only when no primitive
fits.

## Nine rules every primitive follows

These rules are load-bearing. They make the modules orthogonal, replaceable, and (most importantly)
easy for a stage author to compose without reading the implementation.

### 1. Tag-based identity (no hardcoded enums)

Identity is a user-defined `string` tag, not a member of an enum. A slot is `"head"` because
the stage author wrote `"head"`, not because the library shipped `enum Slot { Head, ... }`.

Anti-example: `enum BodyPart { Head, Hand, Foot, Tail }`. The day someone wants `"tentacle"`,
they have to fork the library.

### 2. Definition vs instance

Every authored thing has a `Def` (data) and an instance (a reference + runtime state). `ItemDef`
is the recipe; an `Inventory` holds `Stack { defId, count }`. A `TransformationDef` is the
blueprint; a `Body` holds the applied instance with elapsed time.

Anti-example: storing rich item state in a class that also contains gameplay rules. Save-load
breaks; rules can't change without migrating every saved instance.

### 3. Detect vs resolve

Primitives surface violations as plain data; resolution is a separate, replaceable policy.
`checkConstraints` returns violation records; `resolveUnequip` is a strategy among others, and
either can be swapped out.

Anti-example: `equipment.equip()` silently unequipping a conflicting item. Now the stage can't
say "ask the user instead" without rewriting the primitive.

### 4. Pure-function calculators + mutable holders

Effective state is recomputed on read. `body.getEffectiveTags(slot)` walks the transformation
stack every call. There is no cache to invalidate, no "dirty" bit, no observer chain.

Anti-example: `body.cachedEffective[slot]` with a `markDirty()` that the rest of the codebase
must remember to call.

### 5. Explicit ticks, no global scheduler

Each subsystem advances by `tick(dt)` and returns the events it produced (expired effects,
fired attacks). The stage decides when to tick what. `scheduler.ts` exists to compose them if
the stage wants a single event queue, but using it is optional.

Anti-example: a singleton `GameLoop` that auto-runs everything and you have to register into.

### 6. Time = f(now - startTime), never a counted-down counter

Duration tracking stores `startTime`; "elapsed" is `now - startTime`. Save-load is trivial;
pausing the clock is one place; trajectories of the form `(elapsed) => Magnitudes` are natural.

Anti-example: `remaining -= dt` on every tick. Pause/resume requires storing whether-paused;
trajectory functions need to know what fraction has elapsed and have to compute it from your
internal counter anyway.

### 7. Seeded streams (separate mechanical from cosmetic)

`rng.mechanical` for damage rolls and hit chance; `rng.cosmetic` for flavour text choice and
particle jitter. Replays reproduce mechanical outcomes even when cosmetic seeds drift.

Anti-example: `Math.random()` everywhere. Replays drift, A/B testing is impossible, and a
cosmetic re-render perturbs the next attack roll.

### 8. Tier functions over raw thresholds

Every quantitative stat exposes a `tier(value) => label`. Game logic and UI consult tiers
("starving", "comfortable", "stuffed"), not the underlying number. Rebalancing changes one
function, not every callsite.

Anti-example: `if (hunger > 80) prose = "ravenous"; else if (hunger > 60) ...` scattered
across the stage.

### 9. Observation sources are the stage→LLM bridge

When the stage tells the LLM about the world, it does not pre-bake prose. It emits structured
`ObservationSource` payloads — channel-keyed evaluable properties, salience scores, habituation
state — and a short register doc telling the LLM how to render them. The LLM is the prose
engine; the stage is the world model.

Anti-example: the stage assembling `"You are starving and your left hand is cold and..."` and
appending it to `stageDirections`. The LLM is now competing with prose, not generating it.

## What the library deliberately is NOT

- Not a framework. No required base class beyond `StageBase` (which the SDK requires anyway).
- Not a UI kit. No React components. Use plain JSX in your `render()`.
- Not a physics engine. `physics.ts` is enough for "did the bullet hit the wall," not for cloth.
- Not a save system. Use `messageState` / `chatState` as the SDK intends; primitives serialize
  trivially because they're plain data plus mutable holders.
- Not an event bus. Subsystems return events as arrays; the stage decides what to dispatch.

## File-shape contract

Each `*.ts` file under `src/lib/`:

1. Starts with a top-comment block: **what** the module is, **why** it exists (which rule it
   serves), and the **shape** of its public surface (one-line per exported type/function).
2. Is ≤ ~400 LOC. Larger primitives split into adjacent files (e.g. `combat-turn.ts` /
   `combat-realtime.ts`).
3. Exports named values only. No default exports.
4. Has no runtime dependencies outside the standard library + (where unavoidable) React/SDK
   types for the glue modules.
5. Returns errors as data (`Result`-style discriminated unions) for parser-style APIs;
   throws only for programmer errors (assert-violations).

If you are writing or modifying a primitive and find yourself reaching for a singleton,
a global clock, a cache, or a hardcoded enum — stop. One of the nine rules above is being
violated and the API will rot.
