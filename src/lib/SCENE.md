# Scene — combinatoric action composition

`Scene` is the runtime instance of a multi-actor erotic-RPG scene. Actions
live in a tagged `Registry<SceneActionDef>` — one entry per verb, area
pair declared as data. Per-actor `Pace` (willingness) and `Agency`
(capability) are orthogonal; both are mutable mid-scene. The ongoing
matrix `Map<receiver, Map<area, Map<performer, SceneAct>>>` ports LT's
3-level DP lookup directly, so multi-penetrator queries are O(1) per axis
without flat-key scans.

Use across every erotic-RPG-shape stage: CoC-shape, TiTS-shape, LT-shape,
Pregnancy-sim-shape, Subject-life-sim-shape.

## Action authoring

```ts
import { Registry } from "./lib/registry";
import { type SceneActionDef, Pace } from "./lib/scene";
import { P } from "./lib/predicate";

const ACTIONS = new Registry<SceneActionDef>()
  .register("kiss", {
    id: "kiss",
    performingArea: "mouth",
    targetedArea: "mouth",
    requires: P.tagOn("partner", "mouth"),
    prose: {
      [Pace.SubNormal]: [
        "{performer.name} leans up and kisses {receiver.name} softly.",
        "{performer.name} brushes {performer.pronoun} lips against {receiver.name}'s.",
        "{performer.name} tilts {performer.pronoun} head up for a tentative kiss.",
      ],
      [Pace.DomRough]: [
        "{performer.name} pulls {receiver.name} into a bruising kiss.",
        "{performer.name} crushes {performer.pronoun} mouth against {receiver.name}'s.",
        "{performer.name} bites at {receiver.name}'s lower lip.",
      ],
    },
    arousalBase: 0.05,
    tags: ["oral"],
  });
```

Author only the paces you need; the engine falls to the nearest neighbor
on the sub→dom continuum for unauthored paces.

## Engine loop

```ts
import { Scene, Agency, Pace } from "./lib/scene";
import { Timeline } from "./lib/timeline";
import { Rng } from "./lib/rng";

const scene = new Scene({
  position: new Map([
    ["pc",  { id: "lying-down", tags: ["lying", "supine"] }],
    ["npc", { id: "on-top",     tags: ["mounting"] }],
  ]),
  agency: new Map([["pc", Agency.Full], ["npc", Agency.Full]]),
  pace:   new Map([["pc", Pace.SubEager], ["npc", Pace.DomNormal]]),
});

const timeline = new Timeline<SceneEvent>({ windowSize: 8 });
const rng = Rng.fromSeed("scene-1");

const legal = scene.availableActions("npc", "pc", ACTIONS, bodies);
const def = legal.find((d) => d.id === "kiss")!;
const outcome = scene.perform(
  { participant: { id: "npc" }, performingArea: "mouth", targetedArea: "mouth" },
  "pc", def, rng.mechanical, timeline,
  { performer: { name: "Alice", pronoun: "her" }, receiver: { name: "Bob" } },
);
// outcome.prose, outcome.arousalDelta, outcome.events
```

`availableActions` walks the registry; legality is (agency gate) ∧
(performer exposes `performingArea` tag) ∧ (receiver exposes
`targetedArea` tag) ∧ (`def.requires` predicate). The per-actor body
map fills the `tag-on` resolver automatically; stage-author resolvers
passed at construction handle the rest of the predicate DSL.

## Tick loop

```ts
const fired = scene.tick(now, effectsByActor);
for (const evt of fired) {
  timeline.push(evt);
  consequences.emit(evt, scene);
}
```

Sustained acts contribute a `stats.arousal` delta through each actor's
`EffectStore.totalMagnitudes` — wire an `EffectDef` with a `trajectory`
that ramps up while the act is ongoing, and `dispelTags:
["building-arousal"]` so the orgasm event clears the ramp. The cap
crossing fires the `orgasm` event and resets arousal to 0; the
`SceneConsequenceRegistry` handler chain decides what that means.

## Consequence pipeline

```ts
import { SceneConsequenceRegistry, CONSEQUENCE_PRIORITY } from "./lib/scene";

const consequences = new SceneConsequenceRegistry()
  .onWithPriority("orgasm", CONSEQUENCE_PRIORITY.stretching, (evt, scene) => {
    // Body.applyPermanent on the affected slot, gated by cumulative penetration count.
  })
  .onWithPriority("orgasm", CONSEQUENCE_PRIORITY.affection, (evt) => {
    actors.get(evt.actor).adjustAffinity(otherId, +2);
  })
  .onWithPriority("orgasm", CONSEQUENCE_PRIORITY.pregnancy, (evt) => {
    if (!evt.cumData) return;
    procgen.recombine({ parents, traitPool, mutations });
  });
```

Handlers run in priority order (lower first), then by registration
order within a priority. Default slots mirror LT's `Sex.endSex`
pipeline: stretching=10, affection=20, pregnancy=30, per-actor=40.
Stage authors register in-between freely.

## Composition

- With `Timeline`: `perform` and `tick` push `SceneEvent`s; the timeline
  is already an `ObservationSource`, so recent acts surface in
  `stageDirections` without hand-wiring.
- With `observation`: `Scene` itself implements `ObservationSource` on
  the `interoceptive` (arousal, pace) and `visual` (participants,
  ongoing) channels. Drop it into the sources list directly.
- With `Body`: `Body.getEffectiveTags(slot)` is the source of truth for
  what `AreaTag`s a participant exposes. Multi-slot actors (tails, extra
  limbs) just expose more tagged slots — no special case.
- With `predicate` / `trigger`: action gates ARE `Predicate<SceneState>`;
  escalation events are `ConditionalTrigger<SceneState, SceneEvent>`
  evaluated each tick.
- With `effects`: arousal trajectory is an `EffectDef` with a
  `trajectory(elapsedFraction) => { stats: { arousal: ... } }`; stacking
  policy `"extend"` for sustained acts.
- With `procgen.recombine`: pregnancy consequence handler is the canonical
  call site (post-Wave 1.5).

## Persistence

```ts
import { shardOf, chubTreeHistory } from "./lib/persistence";

scene: shardOf(
  "scene", this.scene,
  (d) => Scene.fromJSON(d, this.resolvers),
  this.layers.messageStateBackend, chubTreeHistory(),
),
```

`messageState + chubTreeHistory` is the right default — scene state is
branchy per-swipe. Use `chatState + forbidBranching` only when scene
outcomes are canonical history (rare; usually consequences advance state
that lives elsewhere).

The ongoing matrix flattens to a row list for JSON round-trip; the
3-level nested Map doesn't survive `JSON.stringify` cleanly.

## Anti-patterns

- **One file per area-pair.** LT's `PenisVagina.java` / `FingerAnus.java`
  fan-out is static-class dispatch's maintenance scar. Tagged registry
  dissolves it.
- **Monolithic `Sex.java`-style god-object.** Scene state stays bounded;
  consequence logic lives outside the class in registered handlers.
- **`output()`-as-side-effect.** `perform` returns a structured
  `SceneOutcome`; prose is selected and returned, never printed.
- **TiTS per-species pregnancy subclasses.** Correct shape (post-hook),
  wrong granularity. Registered functions only.
- **AS3 inline body predicates** (`pc.hasCock() && !pc.isTaur()`).
  Taxonomy in prose is the anti-pattern; all guards are
  `Predicate<SceneState>` against tag queries on `Body`.

## Related

- `predicate.ts` — action gate DSL.
- `trigger.ts` — orgasm-threshold / pace-shift escalation events.
- `timeline.ts` — event sink + ObservationSource.
- `effects.ts` — arousal trajectory.
- `body.ts` — `AreaTag` source of truth.
- `registry.ts` — action catalog shape.
- `design/SCENE.md` — implementation-ready design + key decisions.
- `mining/SCENE.md` — TiTS + LT prior-art analysis.
