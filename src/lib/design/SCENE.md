# Wave 2A SCENE design
> Synthesized 2026-05-24 from src/lib/mining/SCENE.md + ROADMAP Wave 2A spec.
> Implementation-ready: concrete API, key decisions made, file layout fixed.
---

## API surface

```ts
// AreaTag is just a string tag from tags.ts — body parts tag themselves.
// Queried at scene time via Body.getEffectiveTags(slot).
type AreaTag = string;
type ActorId = string;
type ActorRef = "self" | "partner" | "player" | { id: ActorId };

// LT's SexType — the verb tuple. Data, not class.
interface SceneAct {
  participant: ActorRef;
  performingArea: AreaTag;
  targetedArea: AreaTag;
}

// LT's SexPace — orthogonal to verb, mutable per actor mid-scene.
enum Pace {
  SubResisting   = "sub-resisting",
  SubNormal      = "sub-normal",
  SubEager       = "sub-eager",
  DomGentle      = "dom-gentle",
  DomNormal      = "dom-normal",
  DomRough       = "dom-rough",
}

// LT's SexControl — capability to act; separate from willingness (Pace).
enum Agency {
  None            = "none",           // no self-direction
  Self            = "self",           // solo acts only
  OngoingOnly     = "ongoing-only",   // may not initiate, may continue
  Partial         = "partial",        // limited penetrations allowed
  Full            = "full",           // unrestricted
}

// Pose system — position is a map of actor → slot.
interface SceneSlot {
  id: string;
  tags: AreaTag[];                    // e.g. ["standing", "against-wall"]
}
type ScenePosition = Map<ActorId, SceneSlot>;

// Action definition — the tagged registry entry, authored as data.
interface SceneActionDef {
  id: string;
  performingArea: AreaTag;
  targetedArea: AreaTag;
  requires: Predicate<SceneState>;    // from predicate.ts — body-tag predicates, stat checks, etc.
  // pace-keyed prose: 3-string array per pace level; stage may override.
  prose: Partial<Record<Pace, [string, string, string]>>;
  arousalBase?: number;               // magnitude passed to EffectStore on application
  tags?: string[];                    // e.g. ["penetrative", "oral"]
}

// Ongoing-action matrix — LT's 3-level nested map, ported directly.
// ongoing.get(receiver)?.get(targetedArea)?.get(performer) = SceneAct
type OngoingMap = Map<ActorId, Map<AreaTag, Map<ActorId, SceneAct>>>;

interface SceneState {
  participants: ScenePosition;
  ongoing: OngoingMap;
  pace: Map<ActorId, Pace>;
  agency: Map<ActorId, Agency>;
  arousal: Map<ActorId, number>;      // 0..1; caps trigger orgasm
  flags: Map<string, number>;         // generic escape hatch (LT's genericFlags)
  tick: number;
}

// Runtime scene instance.
class Scene {
  readonly state: SceneState;

  constructor(
    position: ScenePosition,
    agency: Map<ActorId, Agency>,
    pace: Map<ActorId, Pace>,
  );

  // Query legal actions for a performer targeting a receiver given current state.
  availableActions(
    performer: ActorId,
    receiver: ActorId,
    registry: Registry<SceneActionDef>,
    body: Map<ActorId, Body>,         // from body.ts
  ): SceneActionDef[];

  // Perform an action; updates ongoing map + arousal; pushes to Timeline.
  perform(
    act: SceneAct,
    receiver: ActorId,
    def: SceneActionDef,
    rng: RngStream,
    timeline: Timeline<SceneEvent>,
  ): SceneOutcome;

  // Withdraw an ongoing act (e.g. pull-out).
  withdraw(performer: ActorId, receiver: ActorId, targetedArea: AreaTag): void;

  // Tick arousal decay / cap checks; returns fired orgasm events.
  tick(now: number, effects: Map<ActorId, EffectStore>): SceneEvent[];

  // Transition slot for one participant.
  reposition(actorId: ActorId, slot: SceneSlot): void;

  toJSON(): unknown;
  static fromJSON(data: unknown): Scene;
}

interface SceneOutcome {
  prose: string;           // selected + resolved prose string
  arousalDelta: number;
  orgasm: boolean;
  events: SceneEvent[];
}

type SceneEvent =
  | { kind: "act-performed"; performer: ActorId; receiver: ActorId; def: SceneActionDef; pace: Pace }
  | { kind: "orgasm"; actor: ActorId; cumData?: { orifice: AreaTag; volume: number } }
  | { kind: "pace-changed"; actor: ActorId; from: Pace; to: Pace }
  | { kind: "scene-ending"; reason: "natural" | "interrupted" };

// Post-hook consequence registry — TiTS's BasePregnancyHandler shape, ported
// as registered functions over typed events (NOT subclasses).
class SceneConsequenceRegistry {
  on(event: SceneEvent["kind"], handler: (evt: SceneEvent, scene: Scene) => void): void;
  emit(evt: SceneEvent, scene: Scene): void;
  // Ships with built-in ordering: stretching → affection → pregnancy → per-NPC endSex.
  // Handlers registered at the same priority run in registration order.
  onWithPriority(
    event: SceneEvent["kind"],
    priority: number,
    handler: (evt: SceneEvent, scene: Scene) => void,
  ): void;
}
```

## Composition with existing primitives

- **`tags.ts`** — `AreaTag` is a string tag. `Body.getEffectiveTags(slot)` returns a `TagSet`; `SceneActionDef.requires` uses `{ kind: "tag-on" }` predicates against those tag sets. Clothing displacement queries check `AreaTag` against `equipment.ts` coverable-area metadata. Body parts tag themselves; scene logic queries the tag, not the part identity.
- **`predicate.ts`** — `SceneActionDef.requires` IS a `Predicate<SceneState>`. All action legality checks are predicate evaluations. Multi-actor DP checks are `{ kind: "and" }` over the ongoing map.
- **`trigger.ts`** — Escalation events (orgasm threshold, pace-shift) are `ConditionalTrigger<SceneState, SceneEvent>` evaluated each tick. Ships as a `TriggerSet` on the `Scene` instance.
- **`timeline.ts`** — `Scene.perform` and `Scene.tick` push `SceneEvent` payloads to a `Timeline<SceneEvent>`. The timeline IS an `ObservationSource`; scene state surfaces in `stageDirections` with no hand-wiring.
- **`observation.ts`** — `Scene.state` exposes an `ObservationSource` implementation. The scene's ongoing map, pace, and arousal levels surface on the `interoceptive` and `visual` channels via `assembleObservations`.
- **`inventory.ts`** / **`equipment.ts`** — `SceneActionDef.requires` can include `{ kind: "has-item" }` for toy-gating. `AreaTag` to `getRelatedInventorySlot` analog: body slot tags carry coverable-area metadata so scene logic can auto-query clothing displacement without coupling to specific item IDs.
- **`body.ts`** — `Body.getEffectiveTags(slot)` is the source of truth for what AreaTags a participant has at scene time. Multi-slot actors (tails, extra limbs) just expose more `AreaTag`-tagged slots — no special case.
- **`effects.ts`** — Arousal and orgasm are modeled as `EffectDef` entries applied to each actor's `EffectStore`. Asymmetric kinetics (fast ramp, slow decay post-orgasm) come from `trajectory`. Stacking policy is `"extend"` for sustained acts. Dispel on orgasm uses a `dispelTags: ["building-arousal"]` convention.
- **`action.ts`** — `SceneActionDef` is a domain extension of `ActionDef` (same costs / requires / effects shape). `Scene.availableActions` parallels `validateAction` — returns reasons when blocked, not a boolean.

## File layout

```
src/lib/scene.ts                  # primitive — Scene class + types (~400-500 LOC)
src/lib/SCENE.md                  # per-convention pattern doc (post-implementation)
src/lib/patterns/scene.ts         # Wave 2A composer — wires scene + body + actor + tag-parser
src/lib/design/SCENE.md           # this file — design doc (pre-implementation)
```

`scene.ts` imports: `tags.ts`, `body.ts`, `predicate.ts`, `trigger.ts`, `timeline.ts`, `observation.ts`, `effects.ts`, `action.ts`. No circular deps; all imports flow downstream.

## Key decisions made

| Question | Decision |
|---|---|
| One file per area-pair vs tagged registry | **Tagged registry.** 60-file fan-out is the anti-pattern (SCENE.md §11). `Registry<SceneActionDef>` keyed by id; actions declare their area pairs as data fields. |
| `SceneAct` as data vs class | **Data (interface).** TS-friendly; serializable; composes with `Predicate` naturally. |
| Pace mutable mid-scene per actor | **Yes.** LT demonstrates pace-shift prose branches work per-actor. `Map<ActorId, Pace>` in `SceneState`. |
| Ongoing-action map shape | **Port LT's 3-level nested map** (`Map<receiver, Map<area, Map<performer, SceneAct>>>`). Exact DP-matrix shape; allows multi-penetrator queries without a flat-key scan. |
| Agency (capability) vs Pace (willingness) | **Both, orthogonal.** LT proves they're independent axes. `Agency` gates what an actor may initiate; `Pace` drives prose register. Neither collapses into the other. |
| Post-scene consequences | **`SceneConsequenceRegistry` with registered handler functions.** TiTS's per-species-subclass shape is the right pattern, wrong granularity. Port as registered functions subscribed to typed `SceneEvent`s. Composes with existing `Registry` primitive. |
| Prose variants | **3-string array per (act × pace) as default; stage may override per action.** `UtilText.returnStringAtRandom` is the correct shape; LT's `UtilText.parse` is NOT ported. |
| String-template parser for `[actor.pronoun]` | **Design our own clean variant.** Positional actor pronoun slots resolved at prose-selection time. Template references are role names (`{performer.pronoun}`, `{receiver.name}`), not raw class paths. Parser is ~30 LOC in `scene.ts`; no coupling to `GameCharacter`. |
| `CorruptionLevel` morality thresholds on actions | **Not ported.** Kink politics stay with the consumer; the primitive is provenance-neutral. |

## Open questions to resolve at implementation time

- **Serialization shape for the ongoing-action map.** 3-level nested `Map` doesn't JSON round-trip cleanly. Options: (a) flatten to `{ receiver, area, performer, act }[]` for JSON, reconstruct on load; (b) replace inner `Map<performer, SceneAct>` with a flat `Record<performer, SceneAct>` (no nesting cost). Decide at impl; either is <5 LOC change to `toJSON`.
- **Prose variant seeding.** `returnStringAtRandom` needs a deterministic seed per scene-tick to be testable. Options: `RngStream.mechanical` keyed by `(actId, tick)` for deterministic replay; or per-scene-instance `RngStream` reseeded on scene start. The latter is simpler and testable.
- **`SceneSlot` as class or tagged interface.** Currently `interface SceneSlot { id, tags }`. If slots need behavior (querying LT's `SexSlotTag` equivalent for valid action presets), promote to a class. Otherwise keep as interface — it's pure data.

## Cross-primitive interactions

- **Scene-end consequence pipeline.** `SceneConsequenceRegistry` fires in priority order: **stretching → affection → pregnancy → per-NPC endSex** (porting LT's `Sex.endSex` ordering at `Sex.java:1035-1453`). Handlers are registered at priorities 10/20/30/40 by convention; stage authors may register in-between.
- **Body-tag changes during scene (stretching).** Orgasm consequence handlers MAY call `Body.applyPermanent` to update base tags on a slot. This flows back to `Body` immediately; subsequent `availableActions` calls in the same scene tick see the updated tags. No special scene-to-body channel — existing `Body.applyPermanent` is sufficient.
- **Pregnancy consequence handler.** Registered at priority 30. On `"orgasm"` event with `cumData.orifice` matching a fertile AreaTag, the handler calls `procgen.recombine({ parents, traitPool, mutations })` (Wave 1.5 amendment) to produce offspring genotype. The handler is authored by the stage, not baked into `scene.ts`.

## Anti-patterns we WILL NOT replicate

From SCENE.md §11:

- **One Java/TS file per area-pair.** 60-file fan-out from static-class dispatch; tagged registry dissolves this entirely.
- **Monolithic `Sex.java` (9k+ lines).** God-object with all state and dispatch. `Scene` class stays bounded by the ~400-500 LOC target; consequence logic lives in registered handlers outside the class.
- **Named-character flags hardcoded on engine types** (`braxCumOnChest`). Per-NPC engine fields are gameplay, not primitive. Kept in `flags: Map<string, number>` escape hatch at the stage's discretion.
- **`output()`-as-side-effect.** Scenes return structured `SceneOutcome`; prose is selected and returned, never printed. The LLM renders; the primitive does not.
- **LT's `UtilText.parse` / `ParserTag`.** Coupled to `GameCharacter`. We implement the concept (positional actor pronoun slots) cleanly at ~30 LOC.
- **`SexParticipantType.NORMAL/CATCHER/PITCHER` enum.** Participant role belongs to slot, not verb. `SceneSlot.tags` encodes role semantics if needed.
- **TiTS per-species pregnancy subclasses.** Correct shape (post-hook), wrong granularity. Registered functions only.
- **AS3 inline body predicates** (`pc.hasCock() && !pc.isTaur() && pc.cockThatFits(...)`). Taxonomy in prose is the anti-pattern; all guards are `Predicate<SceneState>` against tag queries on `Body`.

## Estimated LOC + complexity

`scene.ts` target: **~420-480 LOC.**

Breakdown:
- Type definitions + enums: ~60 LOC
- `Scene` constructor + state management: ~60 LOC
- `availableActions` (predicate eval loop over registry): ~50 LOC
- `perform` (ongoing map update + prose selection + `SceneOutcome`): ~80 LOC
- `tick` (arousal deltas + orgasm check + `TriggerSet.evaluate`): ~60 LOC
- `reposition` + `withdraw`: ~20 LOC
- `SceneConsequenceRegistry`: ~50 LOC
- Prose template resolver (positional role substitution): ~30 LOC
- `toJSON` / `fromJSON`: ~50 LOC

Push factors: multi-actor DP prose (adds ~30 LOC to `perform` for the `getOngoingCharacters` fork) and clothing-displacement querying in `availableActions` (adds ~20 LOC). These could push total to ~530 LOC; both are contained sections and could be extracted to helpers without changing the public API.

`src/lib/patterns/scene.ts` is a separate composer file (~100 LOC), not counted here.
