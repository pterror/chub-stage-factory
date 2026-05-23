# `src/lib/` — REFERENCE

Terse API catalog. One line per exported symbol. Module ordering is bottom-up
(foundational first). Read `README.md` first for philosophy; this file is for
lookup after you know what you're looking for.

## `tags.ts`

- `parseTerm(term): { negate, tag }` — split `"!claw"` into `{ negate: true, tag: "claw" }`.
- `class TagSet`
  - `new TagSet(initial?: Iterable<string>)`
  - `add(tag)`, `remove(tag)`, `has(tag)`
  - `hasAll(tags[])`, `hasAny(tags[])`
  - `matchesTerm(term)` — single term incl. negation
  - `matches(query[])` — AND
  - `matchesAny(query[])` — OR
  - `size()`, `toArray()`, `clone()`, `toJSON()`

## `body.ts`

- `interface TransformationInstance { id, slot, addTags, removeTags, startTime, duration?, source? }`
- `interface PermanentPatch { slot, addTags?, removeTags? }`
- `type ApplyResult = { success: true } | { success: false; reason: string }`
- `class Body`
  - `new Body(initialSlots?)`
  - `hasSlot(s)`, `getSlots()`, `getBaseTags(s)`, `setBaseTags(s, tags)`
  - `addSlot(s, tags?)`, `removeSlot(s)`
  - `getEffectiveTags(s): TagSet` — recomputes every call
  - `getAllEffectiveTags(): Map<slot, TagSet>`
  - `applyTransformation(tf)`, `removeTransformation(id)`, `hasTransformation(id)`
  - `getTransformation(id)`, `getTransformations()`, `getTransformationsForSlot(s)`
  - `applyPermanent(patch)` — dissolve into base tags
  - `tick(now): TransformationInstance[]` — returns expired
  - `toJSON()`, `static fromJSON(data)`

## `transformation.ts`

- `type RelationKind = string`
- `interface TrajectoryStep { addTags, removeTags }`
- `type Trajectory = (elapsedFraction, elapsed) => TrajectoryStep`
- `interface TransformationDef { id, slot, addTags, removeTags, baseDuration?, requiresTags?, conflictsWithTags?, conflicts?, trajectory?, displayName?, description? }`
- `interface ConflictRecord { existingId, existingTf, incomingSays, existingSays }`
- `type CanApply = { ok: true } | { ok: false; reason; detail }`
- `getRelationship(def, otherId): RelationKind | null`
- `canApply(def, body): CanApply`
- `getConflicts(def, body): ConflictRecord[]` — two-perspective; stage policy resolves
- `apply(def, body, now, durationOverride?): TransformationInstance | null`
- `applyTrajectories(body, now)` — rewrite instance tags via def.trajectory
- `fromDict(data): TransformationDef`

## `equipment.ts`

- `type OnConflict = "unequip" | "degrade" | "adapt" | "destroy" | "prompt" | "custom"`
- `interface EquipmentDef { id, slot, constraints, onConflict, degradePenalties?, adaptAlternatives?, grantsTags?, displayName?, description? }`
- `interface EquipmentInstance { def, equippedAt, snapshotTags }`
- `type FitKind = "comfortable" | "tight" | "rides_up" | "too_loose" | "broken"`
- `interface FitReport { fit, failedTerms, added, removed }`
- `canEquip(def, body): CanEquip`
- `checkConstraints(def, body): null | { adapted, alternative } | Violation`
- `fit(inst, body): FitReport`
- `class Loadout { constructor(body); equip(def, now); unequip(slot); getEquipped(slot); getAllEquipped(); checkAllConstraints(); fit(slot); resolveViolations(); toJSON(); static fromJSON(data, body, defs) }`
- `fromDict(data): EquipmentDef`

## `constraints.ts`

- `interface Violation { source, constraint, failedTerms, context? }`
- `check(source, constraint, tags, context?): Violation | null`
- `checkAll(constraintsBySource, tags): Violation[]`
- `resolveUnequip(violations): string[]`
- `resolveDegrade(violations): Record<source, failedTerms>`

## `snapshots.ts`

- `interface SnapshotData { baseSlots, transformations }`
- `interface DiffResult { changed, slotsAdded, slotsRemoved, tagsAdded, tagsRemoved, tfsAdded, tfsRemoved }`
- `class Snapshots { constructor(body); save(name); restore(name); has(name); delete(name); list(); clear(); get(name); set(name, data); diff(name); toJSON(); static fromJSON(data, body) }`

## `rng.ts`

- `class RngStream { next(); float(); range(lo, hi); pick(arr); pickN(arr, n, replace?); weightedPick(items); dice(notation); shuffle(arr) }`
- `class Rng { static fromSeed(seed); stream(name); mechanical; cosmetic; toJSON(); static fromJSON(data) }`

## `stats.ts`

- `type ModifierKind = "flat" | "mult" | "add" | "habituation"`
- `interface Modifier { id?, kind, value, source?, setpoint?, leakUp?, leakDown?, lastAppliedAt? }`
- `type TierFn<T> = (value) => T`
- `thresholdTiers(bands, fallback): TierFn`
- `class Stat<T> { constructor({ base, tiers?, modifiers? }); base; addModifier; removeModifier; clearModifiers; getModifiers; effective(now?); tier(now?); tick(now); toJSON() }`

## `effects.ts`

- `type StackingPolicy = "replace" | "extend" | "stack" | "highest"`
- `interface EffectMagnitudes { stats?, tagsAdd?, tagsRemove?, abilities? }`
- `interface EffectDef { id, targets, baseMagnitudes?, duration?, trajectory?, stacking?, dispelTags? }`
- `interface EffectInstance { id, def, startTime, count }`
- `class EffectStore { apply(def, now); remove(id); dispelByTag(tag); active(); magnitudesFor(id, now); totalMagnitudes(now); tick(now); toJSON(); static fromJSON(data, defs) }`

## `scheduler.ts`

- `interface ScheduledEvent<T> { at, type, data? }`
- `type Handler<S> = (event, state, scheduler) => ScheduledEvent[] | void`
- `class Scheduler<S> { constructor(state); schedule(ev); on(type, handler); peek(); size(); clear(); tickTo(now): ScheduledEvent[]; toJSON(); static fromJSON(data, state, handlers?) }`

## `fsm.ts`

- `interface TransitionObj<E> { to?, push?, pop?, emit? }`
- `type Transition<E> = TransitionObj<E> | void`
- `interface StateDef<C, E> { parent?, enter?, exit?, on? }`
- `class Fsm<C, E> { constructor(initial, ctx, states?); ctx; defineState(name, def); current(); path(); stack(); dispatch(event, data?): E[]; reset(initial?); toJSON(); static fromJSON(data, ctx, states?) }`

## `inventory.ts`

- `type CarryClass = "fixed" | "explicit" | "habitual"`
- `interface ItemDef { id, carryClass, portable, counted, defaultSpot?, channels?, size?, tags?, displayName?, description? }`
- `interface Stack { defId, count }`
- `interface SpotMeta { disorder, lastAccessed, capacity? }`
- `interface ItemDef { ..., weight?, bulk? }` — weight/bulk are optional; compared against SpotMeta capacities
- `interface SpotMeta { ..., weightCapacity?, bulkCapacity? }`
- `class Inventory { register(def); getDef(id); ensureSpot(name, meta?); spots(); contents(spot); meta(spot); add(spot, defId, n=1); remove(spot, defId, n=1); move(from, to, defId, n=1); find(defId); touch(spot, now); accessibility(defId, spot, now); capacityOK(spot, itemDef, count=1): boolean; capacityViolation(spot, itemDef, count=1): {kind, overBy}|null; resolveLeaveLocation(stress, now, actorSpots, rng?); toJSON(); static fromJSON(data) }`

## `grid-inventory.ts`

- `type Rot = 0 | 1 | 2 | 3`
- `interface Placement { defId, x, y, rot, count }`
- `class GridInventory { constructor(width, height); setShape(defId, shape); getShape(defId); rotated(shape, rot); placements(); canPlace(defId, x, y, rot, count?); place(p); remove(idx); occupancy(); toJSON(); static fromJSON(data) }`

## `action.ts`

- `interface ActionDef<A, T, W> { id, costs, range?, targetFilter?, effects, cooldown?, tags?, displayName?, description? }`
- `interface ActorWithResources { resources?, cooldowns?, position? }`
- `type ValidateResult = { ok: true } | { ok: false; reason; ... }` (insufficient_resource, on_cooldown, out_of_range, filter_failed)
- `validateAction(def, actor, target?, world?, now?): ValidateResult`
- `payCosts(actor, costs): boolean`
- `markCooldown(actor, def, now)`, `isOnCooldown(actor, def, now)`

## `combat-turn.ts`

- `interface Combatant { id, initiative, hp, resources?, cooldowns?, position?, stats?, tags?, effects? }`
- `interface AttackProfile { damage, type, crit?, accuracy?, critMultiplier? }`
- `type CombatEvent = turn_start | action_chosen | action_invalid | costs_paid | missed | dodged | hit | effect_applied | downed | turn_end`
- `interface World { combatants: Combatant[] }`
- `initiativeOrder(combatants, rng?): Combatant[]`
- `resolveDamage(attacker, target, profile, rng): { final, crit, dodged, missed }`
- `interface TurnChoice { action, target?, profile? }`
- `runTurn(actor, choose, world, now, rng): CombatEvent[]`
- `runRound(combatants, choose, world, now, rng): CombatEvent[]`

## `combat-realtime.ts`

- `interface RealtimeCombatant { id, pos, vel, radius, team?, hp, tags? }`
- `interface AttackDef { id, shape, duration, pierces?, effects, hitFilter?, damage? }`
- `interface Attack { id, def, owner, bounds, vel?, bornAt, hits }`
- `type RealtimeEvent = moved | attack_spawned | attack_hit | attack_expired | downed | out-of-bounds`
- `interface ArenaBounds { minX, maxX, minY, maxY }`
- `class RealtimeWorld { combatants; attacks; bounds?; constructor(cellSize=64, bounds?); add(c); spawnAttack(def, owner, initial, now); tick(dt, now): RealtimeEvent[]; toJSON(); static fromJSON(data) }` — combatants clamped, attacks outside bounds culled with `out-of-bounds` event; attacks are NOT serialized (transient, reference stage-side AttackDef objects)

## `physics.ts`

- Types: `Vec2`, `AABB`, `Circle`, `Segment`
- `aabbOverlap(a, b)`, `aabbContains(a, p)`, `circleOverlap(a, b)`, `circleAabbOverlap(c, a)`, `segmentAabb(s, a)`
- `class SpatialHash<T> { constructor(cellSize); insert(item, bounds); clear(); query(bounds) }`
- `resolvePositional(a, b): { ax, ay, bx, by }`
- `resolveImpulse(av, bv, normal, restitution?): { av, bv }`
- `verletStep(p, prev, accel, dt, damping?): { p, prev }`

## `observation.ts`

- `type Channel = string`, `type Key = string`, `type Evaluator<S, V>`
- `interface ObservationSource<S> { id, channels, available?, salience, properties, habituationTau? }`
- `interface AssembledObservation { id, channels, salience, values }`
- `interface AssembleOptions { now, maxCount?, lastEmittedAt? }`
- `assembleObservations(sources, state, opts): AssembledObservation[]`
- `formatObservations(observed): string` — fenced JSON block

## `prose-register.ts`

- `type ArchitectureName` (10 entries; see PROSE.md)
- `interface RegisterSpec { pov, tense, distance, extras? }`
- `ARCHITECTURES: Record<ArchitectureName, { summary, example }>`
- `proseInstructions({architectures, register: RegisterSpec}): string`
- (no preset catalog ships; construct `RegisterSpec` inline at the callsite)

## `tag-parser.ts`

- `type FieldKind = "string" | "int" | "float" | "bool" | "list"`
- `interface FieldSpec { kind, required?, max?, enum?, default? }`
- `type Schema = Record<tagName, FieldSpec>`
- `interface ParseError { tag, reason }`
- `interface ParseResult<T> { ok, parsed, stripped, errors }`
- `parseTags(text, schema, opts?: { stripUnknown? }): ParseResult`
- `parseTagsBatch(text, schemas[], opts?): ParseResult[]` — single pass; each schema strips from prior's output

## `classifier.ts`

- `interface Score { label, score }`
- `type Classifier = (text, labels) => Promise<Score[]>`
- `interface LlmClassifierOpts { temperature?, hypothesis? }`
- `llmClassifier(generator, opts?): Classifier`
- `interface LocalPipe { (text, labels) => Promise<{ labels, scores }> }`
- `localTransformerClassifier(pipe): Classifier`

## `chub-adapters.ts`

- `interface HookCtx<C, M> { state, chatState?, now }`
- `type Hook<C, M> = (msg, ctx) => Promise<Partial<StageResponse<C, M>>>`
- `composeBeforePrompt(...hooks): Hook`
- `composeAfterResponse(...hooks): Hook`
- `emitStageDirections({observations, architectures?, register?, prefix?}): string`
- `type Reducer<S, T> = (state, parsed, errors) => void`
- `parseAndApply(text, pairs, state): { stripped, results }`
- re-exports from `persistence/`: `chubTreeHistory`, `createChubLayers`, `bindStore`, `mergeResponses`, `shard`

## `persistence/`

The state-persistence layer. See `persistence/README.md` for the recipe
table and full example.

### `persistence/backend.ts`
- `interface SaveBackend { load(key), save(key, data), remove(key) }`
- `type LayerGet`, `type LayerSet`
- `initStateBackend(get, set): SaveBackend`
- `chatStateBackend(get, set): SaveBackend`
- `messageStateBackend(get, set): SaveBackend`
- `tee(...backends): SaveBackend` — fan out writes; read from first
- `debounced(inner, ms): SaveBackend` — coalesce writes per key
- `rolling(inner, n, prefix): SaveBackend` — keep N most-recent keys

### `persistence/history.ts`
- `type MomentId = string`
- `interface Moment<M> { id, parentId?, payload }`
- `interface History<M> { moments, cursor, commit, navigate, state, children, parent, siblings, root }`
- `snapshotHistory<M>(): History<M>` — full payload per moment, tree
- `diffHistory<M>(base): History<M>` — diff per moment vs parent
- `forbidBranching(h): History<M>` — commits overwrite cursor in place
- `bounded(h, n): History<M>` — prune to ~n moments on overflow
- `persisted(h, backend, key): History<M>` — autosave cursor payload
- `noHistory<M>(): History<M>` — single moment; navigation is a no-op

### `persistence/store.ts`
- `interface SaveableState<M> { serialize, deserialize }`
- `asSaveable(instance, toJSON, fromJSON): SaveableState<M>` — bridge existing primitives
- `asSaveableClass(instance, fromJSON): SaveableState<M>` — infer M from `instance.toJSON()` return type; no annotation needed
- `interface Shard<M> { name, state, backend, history }`
- `class PersistenceStore { load(), commit(), saveSlot(name), loadSlot(name), listSlots(), navigateAll(idMap) }`

### `persistence/chub.ts`
- `chubTreeHistory<M>(): History<M>` — default branch-aware history for messageState shards
- `createChubLayers(seed?): { mirror, initStateBackend, chatStateBackend, messageStateBackend, reset }`
- `bindStore(store, { layers }): { setState, beforePrompt, afterResponse, initial }`
- `mergeResponses(a, b)` — compose Partial<StageResponse>s
- `shard(name, instance, toJSON, fromJSON, backend, history): Shard<M>` — one-liner constructor
- `shardOf(name, instance, fromJSON, backend, history): Shard<M>` — infer-friendly variant; calls `instance.toJSON()` automatically; use when `fromJSON` takes only the serialized data

## `replay.ts`

- `interface LogEntry<K, D> { at, kind, data }`
- `type Dispatcher<S, E> = (state, entry) => S`
- `class Replay<S, E> { constructor(initial, dispatch); record(entry); log(); replay(); replayUpTo(time); toJSON() }`
- `reconstruct(initial, log, dispatch): S`
