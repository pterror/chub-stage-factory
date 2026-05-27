# `src/lib/` — REFERENCE

Terse API catalog. One line per exported symbol. Module ordering is bottom-up
(foundational first). Read `README.md` first for philosophy; this file is for
lookup after you know what you're looking for.

## `tags.ts` — [TAGS.md](./TAGS.md)

- `parseTerm(term): { negate, tag }` — split `"!claw"` into `{ negate: true, tag: "claw" }`.
- `class TagSet`
  - `new TagSet(initial?: Iterable<string>)`
  - `add(tag)`, `remove(tag)`, `has(tag)`
  - `hasAll(tags[])`, `hasAny(tags[])`
  - `matchesTerm(term)` — single term incl. negation
  - `matches(query[])` — AND
  - `matchesAny(query[])` — OR
  - `size()`, `toArray()`, `clone()`, `toJSON()`

## `body.ts` — [BODY.md](./BODY.md)

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

## `transformation.ts` — [TRANSFORMATION.md](./TRANSFORMATION.md)

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

## `equipment.ts` — [EQUIPMENT.md](./EQUIPMENT.md)

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

## `constraints.ts` — [CONSTRAINTS.md](./CONSTRAINTS.md)

- `interface Violation { source, constraint, failedTerms, context? }`
- `check(source, constraint, tags, context?): Violation | null`
- `checkAll(constraintsBySource, tags): Violation[]`
- `resolveUnequip(violations): string[]`
- `resolveDegrade(violations): Record<source, failedTerms>`

## `snapshots.ts` — [SNAPSHOTS.md](SNAPSHOTS.md)

- `interface SnapshotData { baseSlots, transformations }`
- `interface DiffResult { changed, slotsAdded, slotsRemoved, tagsAdded, tagsRemoved, tfsAdded, tfsRemoved }`
- `class Snapshots { constructor(body); save(name); restore(name); has(name); delete(name); list(); clear(); get(name); set(name, data); diff(name); toJSON(); static fromJSON(data, body) }`

## `rng.ts` — [RNG.md](./RNG.md)

- `class RngStream { next(); float(); range(lo, hi); pick(arr); pickN(arr, n, replace?); weightedPick(items); dice(notation); shuffle(arr) }`
- `class Rng { static fromSeed(seed); stream(name); mechanical; cosmetic; toJSON(); static fromJSON(data) }`

## `procgen.ts`

- `interface WeightedEntry<T> { value, weight }`
- `weightedPick(table, rng): T`
- `weightedPickN(table, n, rng, replace?=true): T[]`
- `interface GraphNode { id, neighbors, tags? }`
- `type Connectivity = "tree" | "mesh" | "ring" | "sparse" | "dense"`
- `interface NodeSpec { id, tags? }`
- `interface GraphConstraints { minDegree?, maxDegree?, mustInclude? }`
- `interface BuildGraphOptions { nodeCount, connectivity, constraints?, idPrefix?, rng }`
- `buildGraph(opts): GraphNode[]`
- `interface BuildGridOptions { width, height, wrap?, idPrefix? }`
- `buildGrid(opts): GraphNode[]`
- `type FieldSpec = { kind: "pick"; from } | { kind: "range"; min, max } | { kind: "int"; min, max } | { kind: "compose"; from } | { kind: "literal"; value }`
- `interface Template<T> { fields }`
- `instantiate<T>(template, rng): T`
- `randomId(rng, prefix?="id"): string`
- `pickName(table, rng): string`

## `stats.ts` — [STATS.md](./STATS.md)

- `type ModifierKind = "flat" | "mult" | "add" | "habituation"`
- `interface Modifier { id?, kind, value, source?, setpoint?, leakUp?, leakDown?, lastAppliedAt? }`
- `type TierFn<T> = (value) => T`
- `thresholdTiers(bands, fallback): TierFn`
- `class Stat<T> { constructor({ base, tiers?, modifiers? }); base; addModifier; removeModifier; clearModifiers; getModifiers; effective(now?); tier(now?); tick(now); toJSON() }`

## `effects.ts` — [EFFECTS.md](./EFFECTS.md)

- `type StackingPolicy = "replace" | "extend" | "stack" | "highest"`
- `interface EffectMagnitudes { stats?, tagsAdd?, tagsRemove?, abilities? }`
- `interface EffectDef { id, targets, baseMagnitudes?, duration?, trajectory?, stacking?, dispelTags? }`
- `interface EffectInstance { id, def, startTime, count }`
- `class EffectStore { apply(def, now); remove(id); dispelByTag(tag); active(); magnitudesFor(id, now); totalMagnitudes(now); tick(now); toJSON(); static fromJSON(data, defs) }`

## `fsm.ts` — [FSM.md](./FSM.md)

- `interface TransitionObj<E> { to?, push?, pop?, emit? }`
- `type Transition<E> = TransitionObj<E> | void`
- `interface StateDef<C, E> { parent?, enter?, exit?, on? }`
- `class Fsm<C, E> { constructor(initial, ctx, states?); ctx; defineState(name, def); current(); path(); stack(); dispatch(event, data?): E[]; reset(initial?); toJSON(); static fromJSON(data, ctx, states?) }`

## `inventory.ts` — [INVENTORY.md](./INVENTORY.md)

- `type CarryClass = "fixed" | "explicit" | "habitual"`
- `interface ItemDef { id, carryClass, portable, counted, defaultSpot?, channels?, size?, tags?, displayName?, description? }`
- `interface Stack { defId, count }`
- `interface SpotMeta { disorder, lastAccessed, capacity? }`
- `interface ItemDef { ..., weight?, bulk? }` — weight/bulk are optional; compared against SpotMeta capacities
- `interface SpotMeta { ..., weightCapacity?, bulkCapacity? }`
- `class Inventory { register(def); getDef(id); ensureSpot(name, meta?); spots(); contents(spot); meta(spot); add(spot, defId, n=1); remove(spot, defId, n=1); move(from, to, defId, n=1); find(defId); touch(spot, now); accessibility(defId, spot, now); capacityOK(spot, itemDef, count=1): boolean; capacityViolation(spot, itemDef, count=1): {kind, overBy}|null; resolveLeaveLocation(stress, now, actorSpots, rng?); toJSON(); static fromJSON(data) }`

## `grid-inventory.ts` — [GRID-INVENTORY.md](./GRID-INVENTORY.md)

- `type Rot = 0 | 1 | 2 | 3`
- `interface Placement { defId, x, y, rot, count }`
- `class GridInventory { constructor(width, height); setShape(defId, shape); getShape(defId); rotated(shape, rot); placements(); canPlace(defId, x, y, rot, count?); place(p); remove(idx); occupancy(); toJSON(); static fromJSON(data) }`

## `action.ts` — [ACTION.md](./ACTION.md)

- `interface ActionDef<A, T, W> { id, costs, range?, targetFilter?, effects, cooldown?, tags?, displayName?, description? }`
- `interface ActorWithResources { resources?, cooldowns?, position? }`
- `type ValidateResult = { ok: true } | { ok: false; reason; ... }` (insufficient_resource, on_cooldown, out_of_range, filter_failed)
- `validateAction(def, actor, target?, world?, now?): ValidateResult`
- `payCosts(actor, costs): boolean`
- `markCooldown(actor, def, now)`, `isOnCooldown(actor, def, now)`

## `combat-turn.ts` — [COMBAT-TURN.md](./COMBAT-TURN.md)

- `interface Combatant { id, initiative, hp, resources?, cooldowns?, position?, stats?, tags?, effects? }`
- `interface AttackProfile { damage, type, crit?, accuracy?, critMultiplier? }`
- `type CombatEvent = turn_start | action_chosen | action_invalid | costs_paid | missed | dodged | hit | effect_applied | downed | turn_end`
- `interface World { combatants: Combatant[] }`
- `initiativeOrder(combatants, rng?): Combatant[]`
- `resolveDamage(attacker, target, profile, rng): { final, crit, dodged, missed }`
- `interface TurnChoice { action, target?, profile? }`
- `runTurn(actor, choose, world, now, rng): CombatEvent[]`
- `runRound(combatants, choose, world, now, rng): CombatEvent[]`

## `combat-realtime.ts` — [COMBAT-REALTIME.md](./COMBAT-REALTIME.md)

- `interface RealtimeCombatant { id, pos, vel, radius, team?, hp, tags? }`
- `interface AttackDef { id, shape, duration, pierces?, effects, hitFilter?, damage? }`
- `interface Attack { id, def, owner, bounds, vel?, bornAt, hits }`
- `type RealtimeEvent = moved | attack_spawned | attack_hit | attack_expired | downed | out-of-bounds`
- `interface ArenaBounds { minX, maxX, minY, maxY }`
- `class RealtimeWorld { combatants; attacks; bounds?; constructor(cellSize=64, bounds?); add(c); spawnAttack(def, owner, initial, now); tick(dt, now): RealtimeEvent[]; toJSON(); static fromJSON(data) }` — combatants clamped, attacks outside bounds culled with `out-of-bounds` event; attacks are NOT serialized (transient, reference stage-side AttackDef objects)

## `physics.ts` — [PHYSICS.md](./PHYSICS.md)

- Types: `Vec2`, `AABB`, `Circle`, `Segment`
- `aabbOverlap(a, b)`, `aabbContains(a, p)`, `circleOverlap(a, b)`, `circleAabbOverlap(c, a)`, `segmentAabb(s, a)`
- `class SpatialHash<T> { constructor(cellSize); insert(item, bounds); clear(); query(bounds) }`
- `resolvePositional(a, b): { ax, ay, bx, by }`
- `resolveImpulse(av, bv, normal, restitution?): { av, bv }`
- `verletStep(p, prev, accel, dt, damping?): { p, prev }`

## `observation.ts` — [OBSERVATION.md](./OBSERVATION.md)

- `type Channel = string`, `type Key = string`, `type Evaluator<S, V>`
- `interface ObservationSource<S> { id, channels, available?, salience, properties, habituationTau? }`
- `interface AssembledObservation { id, channels, salience, values }`
- `interface AssembleOptions { now, maxCount?, lastEmittedAt? }`
- `assembleObservations(sources, state, opts): AssembledObservation[]`
- `formatObservations(observed): string` — fenced JSON block
- `asContributor(sources, options?): ContextContributor` — wraps one source or an array (alias of `observationContributor` from `context.ts`)

## `registry.ts`

- `class Registry<T>`
  - `constructor(initial?: Iterable<[string, T]> | Record<string, T>)`
  - `register(id, value): this`, `get(id)`, `require(id)`, `has(id)`
  - `size()`, `delete(id)`, `keys()`, `values()`, `entries()`
  - `filter(pred): T[]`, `map(fn): U[]`
  - `with(id, value): Registry<T>` — immutable add/overwrite
  - `toJSON(): Record<string, T>`, `static fromJSON(data)`
- `class PlaceholderRegistry<T> extends Registry<T>`
  - `registerPlaceholder(id, placeholder): this`
  - `replace(id, real): void` — resolves any pending `waitFor`
  - `isPlaceholder(id): boolean`
  - `waitFor(id, timeoutMs?): Promise<T>` — resolves immediately if real

## `actor.ts`

- `type ActorId = string`
- `type StatName = string`
- `interface ActorInit { id, name, body?, inventory?, stats?, location?, owner?, affinity?, tags? }`
- `interface ActorJSON { id, name, body, inventory, stats, location?, owner?, affinity, tags }`
- `interface ActorDeps { statTiers?, itemDefs? }`
- `class Actor`
  - `id; name; body; inventory; stats; location?; owner?; affinity; tags`
  - `constructor(init: ActorInit)`
  - `getStat(name)`, `setStat(name, stat)`, `hasStat(name)`
  - `getAffinity(other)`, `setAffinity(other, value)` — value=0 removes (sparse)
  - `adjustAffinity(other, delta): number`
  - `toJSON(): ActorJSON`, `static fromJSON(data, deps?): Actor`
- `class ActorPool`
  - `actors: Map<ActorId, Actor>`
  - `constructor(initial?: Iterable<Actor>)`
  - `add(a)`, `get(id)`, `require(id)`, `has(id)`, `delete(id)`, `size()`
  - `forEach(fn)`, `filter(pred)`, `map(fn)`, `all()`
  - `byTag(tag)`, `byOwner(ownerId)`, `byLocation(loc)`
  - `toJSON(): Record<ActorId, ActorJSON>`, `static fromJSON(data, deps?): ActorPool`

## `timeline.ts`

- `interface TimelineEvent<E> { at, payload }`
- `interface TimelineObservationOptions<E> { id?, channels?, channel?, key?, windowSize?, saliencePer?, habituationTau?, render? }`
- `class Timeline<E> implements ObservationSource<unknown>`
  - `constructor(opts?)`
  - `push(payload, at?)`, `pushAll(events)`
  - `since(t)`, `until(t)`, `between(t0, t1)`, `window(n)`, `windowSince(t, n?)`
  - `all()`, `count()`, `last()`, `clear(beforeTime?): number`
  - `id`, `channels`, `salience`, `properties`, `habituationTau?` — ObservationSource surface
  - `toJSON(): TimelineEvent<E>[]`, `static fromJSON(data, opts?)`
  - `asContributor({ window, id?, priority?=30, optional?=true, render? }): ContextContributor`
- `summarize(events, render): string` — newline-joined; debug pane only

## `predicate.ts`

- `type ActorRef = "self" | "partner" | "player" | { id: string }`
- `type CompareOp = ">" | "<" | "==" | "!=" | ">=" | "<="`
- `type Predicate<S>` — tagged union: `tag-on`, `stat`, `stat-tier`, `has-item`, `located-at`, `actor-relation`, `since`, `world-flag`, `and`, `or`, `not`, `custom`
- `interface Refs<A> { self?, partner?, player?, byId? }`
- `interface Resolvers<S, A> { getTag?, getStat?, getStatTier?, hasItem?, getLocation?, getRelation?, sinceEvent?, getFlag?, customs? }`
- `evaluate<S, A>(p, state, refs, resolvers?): boolean`
- `evaluateAll<S, A>(ps, state, refs, resolvers?): boolean`
- `P` — compact builder namespace: `tagOn`, `stat`, `statTier`, `hasItem`, `locatedAt`, `relation`, `since`, `flag`, `and`, `or`, `not`, `custom`

## `trigger.ts`

- `interface ProbabilityModifier<S> { when: Predicate<S>; mult: number }`
- `type Probability<S> = number | { base, modifiers } | ((state) => number)`
- `interface ConditionalTrigger<S, E> { id, when, probability, effect, cooldown?, oneShot? }`
- `interface TriggerSetState { lastFiredAt, fired }`
- `class TriggerSet<S, E, A> { triggers; resolvers; constructor(triggers, resolvers?); evaluate(state, refs, rng, now?): E[]; reset(id?); toJSON(); static fromJSON(triggers, data, resolvers?) }`

## `prose-register.ts` — [PROSE-REGISTER.md](PROSE-REGISTER.md)

- `type ArchitectureName` (10 entries; see PROSE.md)
- `interface RegisterSpec { pov, tense, distance, extras? }`
- `ARCHITECTURES: Record<ArchitectureName, { summary, example }>`
- `proseInstructions({architectures, register: RegisterSpec}): string`
- `proseRegisterContributor(opts)` — re-export of context.ts factory
- (no preset catalog ships; construct `RegisterSpec` inline at the callsite)

## `chat-window.ts`

- `type Turn = Message` (re-export of `@chub-ai/stages-ts` Message)
- `interface ChatWindowOptions { id?, priority?=80, size, summarizeOlder? }`
- `class ChatWindow implements ContextContributor`
  - `id; priority; size`
  - `constructor(opts)`
  - `push(turn): Turn[]` — rolled-out turns (also fed to `summarizeOlder`)
  - `pushAll(turns)`, `turns(): readonly Turn[]`, `last()`, `count()`, `clear()`
  - `contribute(ctx): Section | null` — `<recent-turns>` block
  - `toJSON(): Turn[]`, `static fromJSON(data, opts): ChatWindow`

## `context.ts`

- `interface Section { id, content, tokens, optional? }`
- `interface AssemblyContext { budget, turnInputMessage?, stage? }`
- `interface ContextContributor { id, priority, contribute(ctx): Section | null }`
- `estimateTokens(text): number` — coarse `chars / 4` heuristic
- `class ContextAssembler`
  - `contributors: ContextContributor[]; budget: number`
  - `constructor({ budget?=4000, contributors? })`
  - `register(c): this` — replaces by id
  - `unregister(id): boolean`
  - `assemble(ctx?): string` — drop-then-allocate: required always; optional fills budget
- `observationContributor(sources, { id?, priority?=50, optional?=true, state?, assembleOptions? })`
- `timelineContributor(timeline, { id?, priority?=30, optional?=true, window, render? })`
- `chatWindowContributor(window)` — identity (ChatWindow IS one)
- `proseRegisterContributor({ id?, priority?=70, optional?=false, architectures, register })`
- `systemInstructionsContributor(text, { id?, priority?=100, optional?=false })`
- `turnInputContributor({ id?, priority?=90, optional?=false })`

## `tag-parser.ts` — [TAG-PARSER.md](./TAG-PARSER.md)

- `type FieldKind = "string" | "int" | "float" | "bool" | "list"`
- `interface FieldSpec { kind, required?, max?, enum?, default? }`
- `type Schema = Record<tagName, FieldSpec>`
- `interface ParseError { tag, reason }`
- `interface ParseResult<T> { ok, parsed, stripped, errors }`
- `parseTags(text, schema, opts?: { stripUnknown? }): ParseResult`
- `parseTagsBatch(text, schemas[], opts?): ParseResult[]` — single pass; each schema strips from prior's output

## `classifier.ts` — [CLASSIFIER.md](./CLASSIFIER.md)

- `interface Score { label, score }`
- `type Classifier = (text, labels) => Promise<Score[]>`
- `interface LlmClassifierOpts { temperature?, hypothesis? }`
- `llmClassifier(generator, opts?): Classifier`
- `interface LocalPipe { (text, labels) => Promise<{ labels, scores }> }`
- `localTransformerClassifier(pipe): Classifier`

## `generate.ts`

- `type SchemaParser<T> = (response: string) => T | null`
- `interface GenerateOptions<T> { prompt, generator, schema?, retries?=3, cacheKey?, cache?: PlaceholderRegistry<T>, maxTokens?=500, onRetry? }`
- `generate<T>(opts): Promise<T>` — retries with self-correcting prompt on schema parse failure; throws after retries exhausted
- `interface GenerativeRegistryOptions<T> { base, generator, promptFor, schema, retries?, maxTokens?, placeholderFor? }`
- `interface GenerativeRegistry<T> { base: PlaceholderRegistry<T>; getOrGenerate(id): Promise<T> }`
- `generativeRegistry<T>(opts): GenerativeRegistry<T>` — cache-by-key + auto-generate-on-miss; concurrent calls for same id coalesce

## `chub-adapters.ts` — [CHUB-ADAPTERS.md](CHUB-ADAPTERS.md)

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
- `counterShard(name, box: { n: number }, backend, history): Shard<number>` — shard a pure integer counter; box must contain only `n`
- `layerShards(layer: { backend, history?: () => History }, entries: Record<string, SaveableState>): Record<string, Shard>` — group shards that share a backend+history; `history` is a factory called once per entry; spread result into PersistenceStore constructor. Net savings only for 3+ multi-line shard entries.

## `replay.ts` — [REPLAY.md](REPLAY.md)

- `interface LogEntry<K, D> { at, kind, data }`
- `type Dispatcher<S, E> = (state, entry) => S`
- `class Replay<S, E> { constructor(initial, dispatch); record(entry); log(); replay(); replayUpTo(time); toJSON() }`
- `reconstruct(initial, log, dispatch): S`

## `scene.ts` (Wave 2A)

- `interface SceneAct { id, verb, description?, requires?, tags? }`
- `interface Pace { id, label, description? }`
- `interface Agency { id, label, description? }`
- `interface SceneSlot { id, actorRef: ActorRef, role?, tags? }`
- `interface ScenePosition { id, label, description?, tags? }`
- `interface SceneActionDef { id, label, slots, acts, paces?, positions?, agencies?, tags?, displayName?, description? }`
- `interface SceneEvent { kind: string; [key: string]: unknown }`
- `class SceneConsequenceRegistry { register(priority, handler); evaluate(event, state, refs): void }`
- `evalPredicate<S>(p, state, refs, resolvers?): boolean` — re-export shim over `predicate.ts`
- `getOngoingPerformers(scene): ActorRef[]`
- `class Scene` — combinatoric action composer; body-tag-aware outcome resolution

## `predicate.ts` — additive Wave 2I extensions

- `kind: "regex"` — `{ kind: "regex"; target: ActorRef; field: string; pattern: string }` — regex match against a string field on the resolved actor/state
- `kind: "glob"` — `{ kind: "glob"; target: ActorRef; field: string; pattern: string }` — glob match against a string field

## `context.ts` — additive Wave 2I extensions

- `Section.position?: 'top' | 'bottom' | { depth: number }` — injection position relative to other sections
- `Section.role?: 'system' | 'user' | 'assistant'` — chat-role tagging for providers that support role-tagged messages

## `llm-pipeline.ts` (Wave 2I)

- `interface LlmPipeline<S> { state, inputModifier?, contextModifier?, outputModifier?, quietCall? }`
- `class LlmPipelineRunner<S> { constructor(pipeline, generator); runTurn(playerInput): Promise<TurnResult> }`

## `embeddings.ts` (Wave 2I)

- `interface EmbeddingService { embed(text): Promise<number[]>; embedBatch(texts): Promise<number[][]>; similarity(a, b): number }`
- `localTransformerEmbeddings(modelName?): EmbeddingService` — transformers.js adapter (lazy-imported)
- `apiEmbeddings({ endpoint, key? }): EmbeddingService` — HTTP adapter

## `world.ts` — [WORLD.md](./WORLD.md) (Wave 2B)

- `interface RoomInit { id, displayName?, description?, tags? }`
- `interface ExitDef { direction, targetId, locked?, tags? }`
- `class World`
  - `addRoom(init): this`, `getRoom(id)`, `hasRoom(id)`
  - `addExit(fromId, exit): this`
  - `locate(actorId, roomId): this`, `locationOf(actorId): string | null`
  - `move(actorId, direction): { ok: true; to: string } | { ok: false; reason: string }`
  - `scope(actorId): string[]` — ids of rooms + actors visible from actor's location
  - `exits(roomId): ExitDef[]`, `adjacent(roomId): string[]`
  - `toJSON()`, `static fromJSON(data): World`
- `worldResolvers(world): Resolvers` — predicate resolver shim for world-flag / located-at kinds

## `patterns/scene.ts` (Wave 2A)

- `scenePattern(opts)` — composer wiring `scene.ts` primitive + `body.ts` + `actor.ts` + `tag-parser.ts`; the erotic-RPG scene resolver

## `patterns/inventory.ts`

- `inventoryPattern(opts)` — composes `Inventory` + `observation` + `chub-adapters` + prose-register snippet; standard item-management bundle

## `patterns/effects.ts`

- `effectsPattern(opts)` — composes `EffectStore` + `Stats` + `Scheduler` + `Timeline`; status-effect lifecycle with stat application and expiry

## `patterns/turn-combat.ts`

- `turnCombatPattern(opts)` — composes `Action` + `combat-turn` + `EffectStore` + `Stats` + `Rng` + `Timeline`; full turn-based combat loop

## `patterns/realtime-combat.ts`

- `realtimeCombatPattern(opts)` — composes `RealtimeWorld` + `physics` + `Scheduler` + `Rng` + `Timeline`; tick-driven projectile/collision combat

## `patterns/body-transformation.ts`

- `bodyTransformationPattern(opts)` — composes `Body` + `transformation` + `tags` + `snapshots` + `Timeline` + `observation`; gradual / staged body-change with trajectory support

## `patterns/cyber-slots.ts`

- `cyberSlotsPattern(opts)` — composes `Equipment` + `Body` + `transformation` + `constraints` + `tags` + `observation`; cybernetic implant / augmentation slot system

## `patterns/physics.ts`

- `physicsPattern(opts)` — composes `physics` + `Rng` + `observation`; spatial-hash + collision wrapper for 2D stages

## `patterns/dialogue.ts`

- `dialoguePattern(opts)` — composes `Fsm` with say/choices semantics; predicate-gated transitions for branching NPC dialogue trees

## `patterns/score.ts`

- `scorePattern(opts)` — composes `Stats` + `Timeline`; tier-based unlock conditions and score tracking

## `patterns/faction.ts`

- `factionPattern(opts)` — composes `Stats` (reputation = Stat with tier) + predicate content gates; no new primitive needed

## `patterns/skit.ts`

- `skitPattern(opts)` — PARC's Skit shape as composition: scene + observation + outcome-resolution + actor

## `patterns/sandbox.ts`

- `sandboxPattern(opts)` — composes `world` + `actor` + `intent` + `procgen` for free-roam Zelda/Skyrim-style stages

## `patterns/world-exploration.ts` (Wave 2B)

- `worldExplorationPattern(opts)` — composes `world` + `actor` + `intent` + `observation`; parser-IF movement + scope-aware observation

## `patterns/bulk-tick.ts` (Wave 2C) — [BULK-TICK.md](./patterns/BULK-TICK.md)

- `type TickEventProcessor<E> = (actor, now) => E[]`
- `interface BulkTickBundleInit<E> { pool, processActor, timeline? }`
- `interface BulkTickBundle<E> { pool, timeline, tick(now?): E[], report(events, render): string, tickAndReport(render, now?): { events, report } }`
- `bulkTickPattern<E>(init): BulkTickBundle<E>` — forEach + collect + push + render loop; domain logic in `processActor`

## `patterns/managerial.ts` (Wave 2C) — [MANAGERIAL.md](./patterns/MANAGERIAL.md)

- `interface ManagerialInit<P, E> { timeline, generator, reportPrompt, applyPolicy, advance, renderEvent?, reportMaxTokens? }`
- `interface ManagerialBundle<P, E> { applyPolicy(fields), tick(pool, now): E[], renderReport(events, now): Promise<string>, lastTickEvents, timeline }`
- `managerialPattern<P, E>(init): ManagerialBundle<P, E>` — policy-issue + bulk-tick + LLM report-render loop

## `patterns/form.ts` (Wave 2D) — [FORM.md](./patterns/FORM.md)

- `interface FormAesthetics { displayName, description?, colorPrimary?, colorSecondary?, iconTag? }`
- `interface FormLore { origin?, faction?, archetype?, proseRegister? }`
- `interface FormInit { id, body, stats, abilities, aesthetics, lore? }`
- `interface Form { id, actor: Actor, abilities: Registry<ActionDef>, aesthetics, lore }`
- `formPattern(init): Form` — assembles Body + Stats + ActionDef set + aesthetics into a pilotable Form

## `patterns/form-collection.ts` (Wave 2D) — [FORM-COLLECTION.md](./patterns/FORM-COLLECTION.md)

- `formCollectionPattern(opts)` — `PlaceholderRegistry<Form>` wrapper; collection grows via gameplay; `unlock(id, form)` resolves placeholders

## `patterns/grafting.ts` (Wave 2D) — [GRAFTING.md](./patterns/GRAFTING.md)

- `interface GraftingOptions { forms, learnedLibrary, subsumableCost?, consumeOnSubsume?, helminthVersion?, abilityScaling?, slot4Lock?, invigorations?, provenanceTracking?, maxConfigSlots? }`
- `interface GraftingBundle { hooks: { subsume(formId, abilityId): InjectionRecord, inject(req): FormConfig, replace(req): FormConfig, listLearned(): AbilityDef[], listInjected(formId): FormConfig[] } }`
- `graftingPattern(opts): GraftingBundle` — Helminth-style ability transfer with provenance, slot-4 lock, and helminthVersion transform

## `patterns/puppet.ts` (Wave 2D) — [PUPPET.md](./patterns/PUPPET.md)

- `puppetPattern(opts)` — actor-piloting-actor; player's true-self pilots a form Actor; identity/memory on pilot, body/abilities on form

## `patterns/lineage.ts` — [LINEAGE.md](./patterns/LINEAGE.md)

- `lineagePattern(opts)` — procgen.buildGraph (tree) + Actor affinity-with-parent; `listDescendants`, `findAncestor`, `computeInbreedingCoefficient`

## `patterns/daily-vignette.ts` — [DAILY-VIGNETTE.md](./patterns/DAILY-VIGNETTE.md)

- `dailyVignettePattern(opts)` — `generate` + `observation` + `Timeline` + scheduler; one well-grounded vignette per game-day tick with continuity from past events

## `patterns/slot-assignment.ts` — [SLOT-ASSIGNMENT.md](./patterns/SLOT-ASSIGNMENT.md)

- `slotAssignmentPattern(opts)` — ActorPool + slot constraint predicates + ConditionalTrigger; "worker X assigned to room slot Y" relation

## `patterns/spatial-propagation.ts` — [SPATIAL-PROPAGATION.md](./patterns/SPATIAL-PROPAGATION.md)

- `spatialPropagationPattern(opts)` — World graph + ConditionalTrigger + Scheduler; room-to-room event spread (fire, infection, gossip, faction territory)

## `patterns/subject-sandbox.ts` — [SUBJECT-SANDBOX.md](./patterns/SUBJECT-SANDBOX.md)

- `subjectSandboxPattern(opts)` — world + actor + scheduler + scene + predicate-triggers + dailyVignettePattern + Timeline; first-person life-sim where player IS the subject

## `ui/voronoi-influence-map.tsx` (Wave 2E)

- `VoronoiInfluenceMap<E>` — React SVG component; circles-with-radii + intersection lines + clipped Voronoi cells; prop-customizable theme/colors/interaction-callbacks

## `ui/voronoi-utils.ts` (Wave 2E)

- `createCirclePolygon(cx, cy, r, sides?): [number, number][]`
- `clipPolygonWithConvex(subject, clip): [number, number][]` — Sutherland-Hodgman
- `isPointInsidePolygon(pt, poly): boolean`
- `polygonBBox(poly): { x, y, w, h }`
- `lerp(a, b, t): number`
- `cubicEase(t): number`
- Hash-seeded sine helpers for deterministic jitter

## `3d/` — [3d/README.md](3d/README.md)

### `3d/scene.tsx` (Wave 2F)

- `ThreeSceneProps` — R3F canvas + lifecycle binding props
- `ThreeSceneHandle` — imperative handle exposed via `useImperativeHandle`
- `ThreeScene` — R3F wrapper component; mounts inside chub-stage `render()` lifecycle

## `3d/loader.tsx` (Wave 2F)

- `DefaultLoader` — Suspense fallback component for async asset loads

## `3d/use-three-handle.ts` (Wave 2F)

- `useThreeHandle(ref, handle)` — factory hook; wires `useImperativeHandle` for `ThreeSceneHandle`

## `3d/index.ts` (Wave 2F)

- Re-exports: `ThreeScene`, `ThreeSceneProps`, `ThreeSceneHandle`, `DefaultLoader`, `useThreeHandle`

## `patterns/synergy/*.ts` (Wave 2I — 14 composers)

- `recursive-key-expansion.ts` — `recursiveKeyExpansionPattern` — expands short cache-key prefixes into full structural keys; prevents key-collision across pattern families
- `positional-injection-depth.ts` — `positionalInjectionDepthPattern` — assigns `Section.position` depth values to contributors based on priority ordering
- `inclusion-group-mutex.ts` — `inclusionGroupMutexPattern` — groups context entries into mutually-exclusive inclusion groups so only one entry per group activates per turn
- `sticky-cooldown-delay-timers.ts` — `stickyCooldownDelayTimersPattern` — per-key activation cooldowns + minimum-display-duration timers for persistent UI entries
- `recency-frequency-eviction.ts` — `recencyFrequencyEvictionPattern` — LRU-style eviction over a context entry pool weighted by recency + frequency scores
- `force-activate-with-budget-cap.ts` — `forceActivateWithBudgetCapPattern` — forces a set of high-priority entries into context up to a hard token budget cap
- `subcontext-group-budgeting.ts` — `subcontextGroupBudgetingPattern` — assigns per-group token budgets so one verbose group can't starve the others
- `triplehook-pipeline.ts` — `triplehookPipelinePattern` — wires `LlmPipeline` input/context/output hooks as a unified stage envelope
- `quiet-generation-sub-call.ts` — `quietGenerationSubCallPattern` — fires a secondary `quietCall` inside `LlmPipeline` for mechanical state extraction without surfacing prose to the player
- `scripted-quick-reply-macro.ts` — `scriptedQuickReplyMacroPattern` — `MacroStep<S>` union (`quiet | show | set`) sequenced into a scripted reply; bypasses full generation for canned flows
- `semantic-recall-overlay.ts` — `semanticRecallOverlayPattern` — vector-similarity retrieval over `EmbeddingService`; injects relevant past entries into context as an overlay section
- `scheduled-self-check.ts` — `scheduledSelfCheckPattern` — periodic `quietCall` that evaluates world-state invariants and emits correction deltas into the next turn's context
- `character-filtered-activation.ts` — `characterFilteredActivationPattern` — gates context-entry activation on which character is speaking; prevents cross-character bleed
- `override-slots.ts` — `overrideSlotsPattern` — named override slots in `ContextAssembler` that stage authors can fill at runtime to preempt default contributor output
