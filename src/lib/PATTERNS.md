# PATTERNS — composable recipes for the seven target use cases

Each recipe is a ~80-line skeleton you paste into `src/Stage.tsx` and edit.
Comments mark where stage-specific authoring goes. None of these compile
on their own (they assume `import` lines and that `MessageStateType` etc.
are typed by you); see `Stage.tsx` for the surrounding boilerplate.

The recipes are deliberately repetitive: each one starts from the same
`extends StageBase` shape so the LLM can match against whichever one is
closest to the design.

---

## 0. Persistence wiring (read this first)

Every recipe below has stateful primitives. The pattern for hooking them
into Chub's three state layers is uniform: build a `PersistenceStore` in
the constructor, call `store.load()` + `bound.initial()` in `load()`,
delegate `setState()` to `bound.setState`, and compose your prose work
with `bound.beforePrompt` / `bound.afterResponse` via `mergeResponses`.

```ts
import {
  PersistenceStore, createChubLayers, chubTreeHistory, snapshotHistory,
  forbidBranching, noHistory, bindStore, mergeResponses, shard,
} from "./lib/persistence";

class MyStage extends StageBase<Init, Chat, Msg, Cfg> {
  inv = new Inventory(); body = new Body({...}); rng = Rng.fromSeed("...");
  layers = createChubLayers();
  store!: PersistenceStore;
  bound!: ReturnType<typeof bindStore<Chat, Msg>>;

  constructor(data) {
    super(data);
    // ...register defs, seed initial state...
    this.layers = createChubLayers({
      messageState: data.messageState as any, chatState: data.chatState as any, initState: data.initState as any,
    });
    this.store = new PersistenceStore({
      inv: shard("inv", this.inv, (i) => i.toJSON(), (d: ReturnType<Inventory["toJSON"]>) => Inventory.fromJSON(d),
        this.layers.messageStateBackend, chubTreeHistory()),       // per-branch
      body: shard("body", this.body, (i) => i.toJSON(), (d: ReturnType<Body["toJSON"]>) => Body.fromJSON(d),
        this.layers.chatStateBackend, forbidBranching(snapshotHistory())), // canon
      rng: shard("rng", this.rng, (i) => i.toJSON(), (d: ReturnType<Rng["toJSON"]>) => Rng.fromJSON(d),
        this.layers.initStateBackend, noHistory()),                // set-once
    });
    this.bound = bindStore<Chat, Msg>(this.store, { layers: this.layers });
  }

  async load() {
    await this.store.load();
    const { chatState, messageState } = await this.bound.initial();
    return { success: true, error: null, initState: null, chatState, messageState };
  }
  async setState(s) { await this.bound.setState(s); }
  async beforePrompt(msg) {
    /* your prose work — produce stageDirections, modifiedMessage, etc. */
    return mergeResponses({ stageDirections }, await this.bound.beforePrompt(msg));
  }
  async afterResponse(msg) {
    /* your post-response work */
    return mergeResponses({ modifiedMessage }, await this.bound.afterResponse(msg));
  }
}
```

In the recipes below, the persistence wiring is elided after recipe 1.
Refer back to this section for the boilerplate.

## 0-hoc. `withPersistence` — eliminate the boilerplate entirely

All 8 examples use `withPersistence` instead of writing `load` and `setState`
by hand. If your `load()` does not need to run any custom logic before
`store.load()`, use the HOC.

**When to use:** any stage that follows the standard pattern (constructor wires
shards, `load` hydrates, `setState` delegates). If `load()` needs a custom
hydration order, fall back to the manual recipe above.

```ts
import { withPersistence, mergeResponses } from "./lib/persistence";
import { inventoryPattern, type InventoryBundle } from "./lib/patterns/inventory";

// Replace `extends StageBase<I, C, M, Ch>` with:
export class MyStage extends withPersistence<ChatStateType, InitStateType, MessageStateType, ConfigType>() {
  p!: InventoryBundle;   // or whatever primitives your stage composes

  constructor(data: InitialData<InitStateType, ChatStateType, MessageStateType, ConfigType>) {
    super(data);
    const ms = (data.messageState as Record<string, string | undefined> | null) ?? null;
    this.p = inventoryPattern({ messageState: ms, stageDirections: STAGE_DIRECTIONS });
    // ... register items, spots, etc. ...
    this.initStore(() => this.p.store);   // ← call at end of constructor
  }

  // load() and setState() are inherited — do not implement them.

  async beforePrompt(msg: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    return this.p.buildBeforePrompt(msg, this.bound) as Promise<Partial<StageResponse<ChatStateType, MessageStateType>>>;
  }

  async afterResponse(msg: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    return mergeResponses({}, await this.bound.afterResponse(msg));
  }
}
```

`withPersistence` wires `load → store.load() → bound.initial()` and reads all
three state-layer mirrors so `initState` / `chatState` / `messageState` are
correctly populated regardless of which backends your shards use. See
`src/lib/persistence/with-persistence.ts` for the full implementation and the
`WHEN NOT TO USE` note.

Reference: `src/lib/persistence/with-persistence.ts`

## 0a. Def catalogs — `Registry<T>` over `Record<Id, T>`

Every recipe below declares a def catalog (TFS, MODS, EFFECT_DEFS,
ITEM_DEFS, ACTION_DEFS). For static catalogs use `Registry<T>`:

```ts
import { Registry } from "./lib/registry";
const TFS = new Registry<TransformationDef>()
  .register("cat_tail", { /* ... */ } as TransformationDef);
const def = TFS.require("cat_tail");
TFS.keys();  // for parseTags enum
TFS.values();
```

For dynamic catalogs (grow mid-chat, LLM invents items) wrap in a
Shard and pick paradigm. For LLM-authored content invented during
generation, use `PlaceholderRegistry<T>` — `registerPlaceholder(id, stub)`,
`replace(id, real)`, `waitFor(id, timeoutMs?)`. See `REGISTRY.md`.

## 0b. Event feeds — `Timeline<E>` over `events: E[]`

Recipes 4, 5, 6 (and any other with `events.push(...)`) want a
`Timeline<E>` instead. It owns the buffer, time/count windowing, and
implements `ObservationSource<unknown>` directly so the "last N
events" channel is one entry in `sources` rather than a hand-rolled
source. See `TIMELINE.md`.

## 0c. Reputation / faction

A `Stat` with `tier()` from `stats.ts` is the reputation score;
gated content is a predicate over the tier label. No separate
Faction primitive — it reduces.

---

## 1. Inventory

Spot-based stacks; carry-class semantics; accessibility-aware retrieval. The
stage's job is to define spots and items; the library handles the rest.

```ts
import { Inventory } from "./lib/inventory";

// In your Stage class:
inventory = new Inventory();

async load() {
  this.inventory
    .register({ id: "keys", carryClass: "habitual", portable: true, counted: false, defaultSpot: "pocket-l" })
    .register({ id: "phone", carryClass: "habitual", portable: true, counted: false, defaultSpot: "pocket-r" })
    .register({ id: "mug", carryClass: "explicit", portable: true, counted: true, defaultSpot: "kitchen-counter" })
    .register({ id: "fridge", carryClass: "fixed", portable: false, counted: false });

  this.inventory.ensureSpot("pocket-l").ensureSpot("pocket-r")
    .ensureSpot("kitchen-counter", { disorder: 0.3 })
    .ensureSpot("backpack");

  this.inventory.add("pocket-l", "keys");
  this.inventory.add("pocket-r", "phone");
  this.inventory.add("kitchen-counter", "mug");
  return { success: true, initState: null, chatState: null };
}

// At scene change, decide what comes with the actor:
onLeaveLocation(stress: number, now: number) {
  const onBody = new Set(["pocket-l", "pocket-r", "backpack"]);
  return this.inventory.resolveLeaveLocation(stress, now, onBody);
}

// Surface inventory to the LLM as an observation source (see recipe 5).
```

---

## 2. TiTS-style body transformation

Slots have base tags; transformations stack additively; conflicts surface
two-perspective so the stage decides. Trajectories let TFs ramp over time.

```ts
import { Body } from "./lib/body";
import { Snapshots } from "./lib/snapshots";
import {
  TransformationDef, apply, canApply, getConflicts, applyTrajectories,
} from "./lib/transformation";

// Stage fields:
body = new Body({
  head:  ["human", "horned!none", "hair"],
  torso: ["human", "skin-soft"],
  arms:  ["human", "hands", "skin-soft"],
  legs:  ["human", "feet", "skin-soft"],
  tail:  [],
});
snaps = new Snapshots(this.body);

// Author transformations as data:
TFS: Record<string, TransformationDef> = {
  cat_tail: {
    id: "cat_tail", slot: "tail",
    addTags: ["furred", "prehensile-mild", "tail-cat"], removeTags: [],
    baseDuration: 60 * 60, // ramps over an hour
    requiresTags: [], conflictsWithTags: ["tail-dragon"],
    conflicts: { "*": "stack" },
    trajectory: (f) => f < 0.3
      ? { addTags: ["nub"], removeTags: [] }
      : { addTags: ["furred", "prehensile-mild", "tail-cat"], removeTags: ["nub"] },
  },
  // ...your TFs here
};

async someTfApplied(now: number) {
  const tf = this.TFS.cat_tail;
  const conflicts = getConflicts(tf, this.body);
  // policy: skip on block, replace on replace, otherwise apply
  for (const c of conflicts) {
    if (c.incomingSays === "block" || c.existingSays === "block") return null;
    if (c.incomingSays === "replace") this.body.removeTransformation(c.existingId);
  }
  return apply(tf, this.body, now);
}

tickBody(now: number) {
  this.body.tick(now);          // expire finished TFs
  applyTrajectories(this.body, now); // ramp ongoing ones
}
```

---

## 3. Cyberpunk arbitrary-slot modding (interoperable with TF)

Equipment composes with transformations because both speak in tags. A
deck-jack mod requires a `neural-port` tag on the head; a TF that adds
`neural-port` makes the mod equippable; a TF that adds `flesh-only` makes it
break.

```ts
import { EquipmentDef, Loadout, fromDict as eqFromDict } from "./lib/equipment";

loadout = new Loadout(this.body);

MODS: Record<string, EquipmentDef> = {
  deckjack: eqFromDict({
    id: "deckjack", slot: "head",
    constraints: ["neural-port", "!flesh-only"],
    onConflict: "degrade",
    degradePenalties: { hackSpeed: 0.4 },
    grantsTags: ["jacked-in-capable"],
  }),
  monocular: eqFromDict({
    id: "monocular", slot: "head",
    constraints: ["socket-right"],
    onConflict: "unequip",
    adaptAlternatives: [["socket-left"]],
  }),
};

equipMod(id: string, now: number) {
  const def = this.MODS[id];
  return this.loadout.equip(def, now);
}

// After any TF change, recheck:
tickEquipment(now: number) {
  const result = this.loadout.resolveViolations();
  // Hand `result.unequipped` / `result.degraded` / `result.prompted` to LLM
  // via observation sources; let prose render the consequence.
  return result;
}
```

---

## 4. Turn-based combat

Initiative-ordered turns dispatched through `runRound`. The stage supplies a
`choose(actor, world)` policy; everything else is in `lib/combat-turn.ts`.

```ts
import { ActionDef } from "./lib/action";
import { Combatant, World, runRound, AttackProfile } from "./lib/combat-turn";
import { Rng } from "./lib/rng";

rng = Rng.fromSeed("battle-1");
combatants: Combatant[] = [
  { id: "you",   initiative: 12, hp: 30, resources: { ap: 3 }, stats: { dodge: 0.1, armor: 1 } },
  { id: "guard", initiative:  8, hp: 20, resources: { ap: 2 }, stats: { dodge: 0.05, armor: 2 } },
];

ATTACK: AttackProfile = { damage: 6, type: "slash", crit: 0.1, accuracy: 0.85 };
SWING: ActionDef<Combatant, Combatant, World> = {
  id: "swing", costs: { ap: 1 }, range: 1, effects: [],
  targetFilter: (a, t) => t.hp > 0 && t.id !== a.id,
};

async runOneRound(now: number) {
  const world: World = { combatants: this.combatants };
  const events = runRound(this.combatants, (actor, w) => {
    const target = w.combatants.find((c) => c.id !== actor.id && c.hp > 0);
    return target ? { action: this.SWING, target, profile: this.ATTACK } : null;
  }, world, now, this.rng.mechanical);
  // Render `events` via observation; do NOT bake them into prose.
  return events;
}
```

---

## 5. Buffs / debuffs / effects

`EffectStore` per combatant; `tick(now)` drains expired. Trajectories shape
ramp-up; stacking policies decide what happens when the same buff is applied
twice.

```ts
import { EffectStore, EffectDef } from "./lib/effects";

ADRENALINE: EffectDef = {
  id: "adrenaline", duration: 30, stacking: "extend",
  targets: { stats: ["dodge", "damage"], tags: ["focus"] },
  baseMagnitudes: { stats: { dodge: 0.2, damage: 1 }, tagsAdd: ["focus"] },
  trajectory: (f) => f > 0.7 ? { stats: { dodge: 0.05, damage: 0 } } : {},
  dispelTags: ["calm"],
};

effectsByCombatant = new Map<string, EffectStore>();

applyEffect(target: string, def: EffectDef, now: number) {
  let s = this.effectsByCombatant.get(target);
  if (!s) { s = new EffectStore(); this.effectsByCombatant.set(target, s); }
  return s.apply(def, now);
}

tickAllEffects(now: number) {
  for (const [id, store] of this.effectsByCombatant) {
    const expired = store.tick(now);
    // events.push(...) for each expiry; surface in observation
  }
}

dispelByCalm(now: number) {
  for (const store of this.effectsByCombatant.values()) store.dispelByTag("calm");
}
```

---

## 6. Realtime combat

`RealtimeWorld` integrates positions, runs spatial-hash broadphase, applies
hit filters, and returns events. No render loop — call `tick(dt, now)` on
each `beforePrompt`/`afterResponse` or from a `requestAnimationFrame` in
`render()`.

```ts
import { RealtimeWorld, AttackDef } from "./lib/combat-realtime";

world = new RealtimeWorld(64);

async load() {
  this.world.add({ id: "you",   pos: { x: 0, y: 0 },   vel: { x: 0, y: 0 }, radius: 8, team: "p", hp: 30 });
  this.world.add({ id: "drone", pos: { x: 100, y: 0 }, vel: { x: -20, y: 0 }, radius: 6, team: "e", hp: 5 });
  return { success: true, initState: null, chatState: null };
}

PROJECTILE: AttackDef = {
  id: "bullet", shape: "circle", duration: 1.5, pierces: 1, damage: 4,
  effects: [], hitFilter: (owner, target) => target.team !== owner.team,
};

shoot(ownerId: string, dirX: number, dirY: number, now: number) {
  const owner = this.world.combatants.get(ownerId)!;
  this.world.spawnAttack(this.PROJECTILE, ownerId, {
    bounds: { circle: { x: owner.pos.x, y: owner.pos.y, r: 2 } },
    vel: { x: dirX * 200, y: dirY * 200 },
  }, now);
}

tickWorld(dt: number, now: number) {
  return this.world.tick(dt, now); // RealtimeEvent[]
}
```

---

## 8. bulkTick over ActorPool (Wave 2C preview)

Composes `ActorPool` + `Scheduler` + `Timeline`. Foundation for FC-shape weekly tick.

```ts
import { ActorPool } from "./lib/actor";
import { Scheduler } from "./lib/scheduler";
import { Timeline } from "./lib/timeline";

pool: ActorPool;
scheduler: Scheduler;
timeline = new Timeline<ActorEvent>();

tickWeek(now: number) {
  const events: ActorEvent[] = [];
  this.actorPool.forEach(actor => {
    const actorEvents = actor.tick(now);
    events.push(...actorEvents);
  });
  for (const evt of events) {
    this.timeline.append(evt, now);
  }
  return events;
}
```

When to use: any managerial stage where N actors advance simultaneously per turn (FC-shape arcology, LT-shape city, FS-shape outbreak simulation). `timeline` then feeds the LLM as an `ObservationSource` summarizing what happened this tick.

---

## 9. generativeRegistry — "LLM-on-demand catalog"

Wrap `PlaceholderRegistry<T>` with `generate.ts`'s `generativeRegistry` helper. Placeholders register immediately so gameplay continues; real defs swap in async. Used for stages where the LLM invents new content mid-chat (cyberware in composite-showcase, frames in Warframe-shape, encounters in CoC-shape).

```ts
import { generativeRegistry } from "./lib/generate";

// On stage init:
const MODS = generativeRegistry<EquipmentDef>({
  generate: (id, hint) => textGen({ prompt: `Invent a cyberware mod: ${hint}`, schema: EquipmentDefSchema }),
  placeholder: (id) => ({ id, slot: "head", constraints: [], grantsTags: [], pending: true }),
  shard: shard("mods", ...),
});

// During gameplay, player emits <invent>deckjack|neural</invent>:
MODS.registerPlaceholder("deckjack", { hint: "neural" }); // immediately visible, pending=true
// textGen fires async; on completion:
// MODS.replace("deckjack", realDef);   — next turn the real def is live
```

When to use: anywhere content is invented mid-session and must be consistent on revisit. The "LLM invents it once, serves it forever" pattern. Pairs with `synergy/cache-by-key.ts`.

---

## 10. buildGraph for room / faction / lineage networks

`procgen.buildGraph(...)` produces a topology usable for room graphs (Wave 2B `world.ts`), faction relationships (LT-shape), and family lineages (FC-shape). Same primitive, three semantic interpretations.

```ts
import { buildGraph } from "./lib/procgen";

// Room graph (Wave 2B):
const roomGraph = buildGraph({ nodeCount: 12, connectivity: "sparse", constraints: { maxDegree: 4 } });

// Faction relationship graph (LT-shape):
const factionGraph = buildGraph({ nodeCount: 6, connectivity: "mesh", constraints: { symmetric: true } });

// Family lineage (FC-shape):
const lineage = buildGraph({ nodeCount: 20, connectivity: "tree" });
```

`buildGraph` returns `{ nodes: NodeId[], edges: [NodeId, NodeId][] }`. The stage assigns semantic meaning to nodes (rooms, factions, persons). The same topology primitives handle all three because graph structure is provenance-neutral.

---

## 11. Predicate-gated trigger

Declare a `TriggerSet` with several `ConditionalTrigger`s using the predicate DSL. One combat trigger, one social trigger, one environmental trigger — all evaluated in the same pass.

```ts
import { TriggerSet, type ConditionalTrigger } from "./lib/trigger";
import { type Predicate } from "./lib/predicate";

// Shared state shape passed to evaluate()
interface GameState {
  player: { location: string; hp: number; tags: string[] };
  world: { flags: Record<string, unknown>; lastEventAt: Record<string, number> };
  npcs: Record<string, { tags: string[]; obedience: number; hp: number }>;
}

// Combat: grue attacks player in darkness with no protection
const grueAttack: ConditionalTrigger<GameState, { kind: "grue-attack" }> = {
  id: "grue-attack",
  when: {
    kind: "and", clauses: [
      { kind: "world-flag", flag: "in-darkness", value: true },
      { kind: "tag-on", target: "player", tag: "grue-protected" },  // will be negated below
    ],
  } as Predicate<GameState>,
  // simpler: negate the protection check
  // In practice: { kind: "and", clauses: [darkFlag, { kind: "not", inner: grueProtTag }] }
  probability: 0.8,
  effect: { kind: "grue-attack" },
};

// Social: faction approaches when reputation is high and cooldown has passed
const factionApproach: ConditionalTrigger<GameState, { kind: "faction-approach"; faction: string }> = {
  id: "faction-approach",
  when: {
    kind: "and", clauses: [
      { kind: "stat", target: { id: "arcology" }, stat: "reputation", op: ">", value: 70 },
      { kind: "since", event: "last-faction-encounter", op: ">", duration: 7 * 24 * 60 * 60 * 1000 },
    ],
  },
  probability: 0.3,
  effect: { kind: "faction-approach", faction: "trade-guild" },
  cooldown: 48 * 60 * 60 * 1000,  // 48h between firings
};

// Environmental: fire risk when room overheats
const fireRisk: ConditionalTrigger<GameState, { kind: "fire-start"; location: string }> = {
  id: "fire-risk",
  when: {
    kind: "and", clauses: [
      { kind: "world-flag", flag: "room.heat-output-exceeds-capacity", value: true },
      { kind: "not", inner: { kind: "world-flag", flag: "fire-suppression-active", value: true } },
    ],
  },
  probability: 0.05,   // 5% per tick
  effect: { kind: "fire-start", location: "current-room" },
};

const triggers = new TriggerSet<GameState, { kind: string }>([grueAttack, factionApproach, fireRisk]);

// Each tick / beforePrompt:
function evaluateTriggers(state: GameState, rng: RngStream) {
  const fired = triggers.evaluate(state, rng);
  // fired: array of effect payloads for all triggers that resolved true + passed probability roll
  for (const effect of fired) {
    // dispatch effect to your handler
  }
}
```

When to use: any "X chance under Y conditions" mechanic — combat events, faction dynamics, environmental hazards, relationship triggers, pregnancy complications, facility incidents.

---

## 12. Spatial propagation

Events propagate room-to-room through the world graph using `spatialPropagationPattern`. Fire starts in one room, spreads to adjacencies each tick.

```ts
import { type World } from "./lib/world";
import { TriggerSet, type ConditionalTrigger } from "./lib/trigger";
import { Scheduler } from "./lib/scheduler";

interface PropagationState {
  sourceRoom: string;
  adjacentRooms: string[];
  roomFlags: Record<string, Record<string, unknown>>;
}

// Spread trigger: fire jumps to an adjacent room if not suppressed
const fireSpread: ConditionalTrigger<PropagationState, { kind: "fire-spread"; to: string }> = {
  id: "fire-spread",
  when: {
    kind: "and", clauses: [
      { kind: "world-flag", flag: "source-on-fire", value: true },
      { kind: "not", inner: { kind: "world-flag", flag: "adjacent-suppressed", value: true } },
    ],
  },
  probability: 0.4,   // 40% chance per adjacent room per tick
  effect: { kind: "fire-spread", to: "" },  // 'to' filled at dispatch time
};

function propagateFire(world: World, burningRooms: Set<string>, scheduler: Scheduler, now: number) {
  const newlyBurning: string[] = [];
  for (const roomId of burningRooms) {
    const adjacents = world.exits(roomId).map(e => e.destination);
    for (const adj of adjacents) {
      if (burningRooms.has(adj)) continue;
      const state: PropagationState = {
        sourceRoom: roomId,
        adjacentRooms: adjacents,
        roomFlags: { "source-on-fire": { value: true }, "adjacent-suppressed": { value: world.flag(adj, "fire-suppression") } },
      };
      const spread = new TriggerSet([{ ...fireSpread, effect: { kind: "fire-spread", to: adj } }]);
      const fired = spread.evaluate(state as any, scheduler.rng);
      if (fired.length > 0) newlyBurning.push(adj);
    }
  }
  for (const r of newlyBurning) burningRooms.add(r);
  return newlyBurning;
}
```

When to use: fire spread, plague propagation (FS-shape), gossip diffusion (LT-shape), faction territory shift, contamination (Lobotomy variant), wildfire in wilderness sandboxes.

---

## 13. Slot assignment

Worker-to-room slot assignment with constraint predicates. Assignment is only valid when the worker satisfies the slot's predicate.

```ts
import { ActorPool, type Actor } from "./lib/actor";
import { evaluate, type Predicate } from "./lib/predicate";

interface SlotDef {
  id: string;
  roomId: string;
  capacity: number;
  requires: Predicate<Actor>;  // constraint on the assigned worker
}

interface Assignment {
  slotId: string;
  actorId: string;
}

const SLOTS: SlotDef[] = [
  {
    id: "reactor-tech",
    roomId: "reactor",
    capacity: 2,
    requires: { kind: "stat", target: "self", stat: "engineering", op: ">=", value: 3 },
  },
  {
    id: "medical-bay",
    roomId: "medbay",
    capacity: 3,
    requires: { kind: "tag-on", target: "self", tag: "medic-trained" },
  },
];

const assignments: Assignment[] = [];

function assignWorker(pool: ActorPool, actorId: string, slotId: string): "ok" | "invalid" | "full" {
  const slot = SLOTS.find(s => s.id === slotId)!;
  const actor = pool.get(actorId)!;
  if (!evaluate(slot.requires, actor, { self: actor })) return "invalid";
  const current = assignments.filter(a => a.slotId === slotId).length;
  if (current >= slot.capacity) return "full";
  assignments.push({ slotId, actorId });
  return "ok";
}

function validateAssignments(pool: ActorPool): Assignment[] {
  // Re-evaluate all — worker stats may have changed
  return assignments.filter(a => {
    const slot = SLOTS.find(s => s.id === a.slotId)!;
    const actor = pool.get(a.actorId)!;
    return evaluate(slot.requires, actor, { self: actor });
  });
}
```

When to use: Facility-management-shape (#20) room staffing, FC-shape (#8) slave job assignments, Warframe-shape (#9) loadout slots, any "actor must satisfy constraint to occupy role" mechanic.

---

## 14. Daily vignette

One well-grounded vignette per game-day tick using `dailyVignettePattern`. Continuity flows through Timeline events from past vignettes.

```ts
import { Timeline } from "./lib/timeline";
import { Scheduler } from "./lib/scheduler";

interface DayContext {
  subjectId: string;
  dayNumber: number;
  recentEvents: string[];    // pulled from timeline
  subjectState: {
    location: string;
    mood: string;
    activeConditions: string[];
  };
}

interface VignetteEvent {
  day: number;
  summary: string;
  mechanicalEffects: string[];
}

timeline = new Timeline<VignetteEvent>();
scheduler = new Scheduler();

async function generateDailyVignette(
  ctx: DayContext,
  generate: (prompt: string) => Promise<{ prose: string; effects: string[] }>,
  now: number,
): Promise<VignetteEvent> {
  const recentSummary = ctx.recentEvents.slice(-5).join("\n");

  const result = await generate(
    `Day ${ctx.dayNumber}. Subject is at ${ctx.subjectState.location}, mood: ${ctx.subjectState.mood}.\n` +
    `Active conditions: ${ctx.subjectState.activeConditions.join(", ")}.\n` +
    `Recent history:\n${recentSummary}\n\n` +
    `Write one vignette scene for today. Extract any mechanical effects (stat changes, condition gains/losses) as a list.`
  );

  const evt: VignetteEvent = {
    day: ctx.dayNumber,
    summary: result.prose,
    mechanicalEffects: result.effects,
  };
  this.timeline.append(evt, now);
  return evt;
}
```

When to use: Pregnancy-sim-shape (#17), Subject-life-sim-shape (#19), dating-sim, slow-life farming sim, any shape where the content unit is "one meaningful day in a subject's life."

---

## 15. Lineage tracking

Parent-child graph queries and inbreeding coefficient calculation using `lineagePattern` over `procgen.buildGraph`.

```ts
import { buildGraph } from "./lib/procgen";
import { ActorPool, type Actor } from "./lib/actor";

interface LineageNode {
  actorId: string;
  parentIds: string[];
  generation: number;
}

const lineageNodes = new Map<string, LineageNode>();

function registerOffspring(actorId: string, parentIds: string[]): void {
  const maxParentGen = Math.max(
    0,
    ...parentIds.map(p => lineageNodes.get(p)?.generation ?? 0)
  );
  lineageNodes.set(actorId, { actorId, parentIds, generation: maxParentGen + 1 });
}

function getAncestors(actorId: string, depth = Infinity): Set<string> {
  const visited = new Set<string>();
  function walk(id: string, remaining: number) {
    if (remaining <= 0) return;
    for (const parentId of lineageNodes.get(id)?.parentIds ?? []) {
      visited.add(parentId);
      walk(parentId, remaining - 1);
    }
  }
  walk(actorId, depth);
  return visited;
}

function commonAncestors(a: string, b: string): Set<string> {
  const aAnc = getAncestors(a);
  const bAnc = getAncestors(b);
  return new Set([...aAnc].filter(x => bAnc.has(x)));
}

function inbreedingCoefficient(a: string, b: string): number {
  const shared = commonAncestors(a, b);
  if (shared.size === 0) return 0;
  // Wright's path coefficient approximation: sum 0.5^(path length) over shared ancestors
  let f = 0;
  for (const anc of shared) {
    const dA = pathLength(a, anc);
    const dB = pathLength(b, anc);
    if (dA !== null && dB !== null) f += Math.pow(0.5, dA + dB + 1);
  }
  return Math.min(1, f);
}

function pathLength(from: string, to: string): number | null {
  // BFS through parentIds
  const queue: [string, number][] = [[from, 0]];
  while (queue.length > 0) {
    const [cur, dist] = queue.shift()!;
    if (cur === to) return dist;
    for (const p of lineageNodes.get(cur)?.parentIds ?? []) queue.push([p, dist + 1]);
  }
  return null;
}
```

When to use: Breeding-sim-shape (#18) offspring generation, FC-shape (#8) dynasty tracking, LT-shape (#6) noble lineages.

---

## 16. Subject sandbox loop

Player-as-subject life-sim loop using `subjectSandboxPattern`. Player IS the focal actor in a world of NPC relationships; open multi-location navigation with daily-vignette content.

```ts
import { ActorPool, type Actor } from "./lib/actor";
import { type World } from "./lib/world";
import { TriggerSet } from "./lib/trigger";
import { Timeline } from "./lib/timeline";
import { Scheduler } from "./lib/scheduler";

interface SubjectState {
  player: Actor;
  currentLocation: string;
  day: number;
  npcRelations: Map<string, { affinity: number; lastInteraction: number }>;
}

// Relationship trigger: NPC approaches player when affinity is high
const npcApproach = new TriggerSet([{
  id: "npc-approach",
  when: {
    kind: "and", clauses: [
      { kind: "actor-relation", subject: { id: "npc" }, object: "player", relation: "affinity", op: ">", value: 60 },
      { kind: "since", event: "last-npc-interaction", op: ">", duration: 24 * 60 * 60 * 1000 },
    ],
  },
  probability: 0.4,
  effect: { kind: "npc-initiates-scene" },
  cooldown: 12 * 60 * 60 * 1000,
}]);

async function subjectLoop(
  state: SubjectState,
  world: World,
  pool: ActorPool,
  timeline: Timeline<unknown>,
  scheduler: Scheduler,
  generate: (ctx: unknown) => Promise<string>,
  now: number,
) {
  // 1. Evaluate conditional triggers for today's events
  const triggered = npcApproach.evaluate(state as any, scheduler.rng);

  // 2. Generate the day's vignette, grounded in state + triggers
  const vignette = await generate({
    player: state.player,
    location: world.describe(state.currentLocation),
    day: state.day,
    triggeredEvents: triggered,
    recentHistory: timeline.window(5),
  });

  // 3. Apply mechanical effects; record to timeline
  timeline.append({ day: state.day, prose: vignette, triggered }, now);

  // 4. Advance scheduler; tick NPCs
  scheduler.advance(24 * 60 * 60 * 1000, now);
  pool.forEach(npc => npc.tick(now));

  state.day += 1;
  return vignette;
}
```

When to use: Subject-life-sim-shape (#19), Pregnancy-sim-shape (#17), dating-sim, any shape where the player is the subject of a life rather than a manager of systems.

---

## 17. Scene composition (Wave 2A)

Wire `scenePattern` from `patterns/scene.ts` for combinatoric body-tag-aware erotic-RPG scenes. Full design and slot/verb/act authoring guide: `src/lib/design/SCENE.md`.

```ts
import { scenePattern } from "./lib/patterns/scene";
// See design/SCENE.md for SceneActionDef authoring and SceneConsequenceRegistry usage.
```

When to use: CoC-shape, TiTS-shape, LT-shape, any stage where scene outcomes depend on actor body tags × partner tags × pose × consent × intensity.

---

## 18. VoronoiInfluenceMap (Wave 2E)

Drop-in React SVG component for influence-zone visualization. Full design and prop reference: `src/lib/UI-VORONOI.md`.

```tsx
import { VoronoiInfluenceMap } from "./lib/ui/voronoi-influence-map";
// See UI-VORONOI.md for entity type, radius, color, and interaction-callback props.
```

When to use: faction territory display, NPC awareness radii, threat zones, spatial audio coverage, any "overlapping circles of influence" visualization.

---

## 19. ThreeScene basic usage (Wave 2F)

Embed an R3F canvas inside `render()` via `ThreeScene`. Full design and owns/exposes/configures split: `src/lib/3D-SCENE.md`.

```tsx
import { ThreeScene } from "./lib/3d";
// See 3D-SCENE.md for ref handle, camera-rig wiring, and Suspense asset loading.
```

When to use: any stage requiring 3D rendering (dungeon-crawler-shape, ARPG-shape, walking-sim-shape, spacesim-shape).

---

## 20. LlmPipeline wrapper (Wave 2I)

Wrap every LLM call in a composable input→context→output→quiet envelope using `LlmPipelineRunner`. Full design and all 14 synergy pattern composers: `src/lib/LLM-PIPELINE.md`.

```ts
import { LlmPipelineRunner } from "./lib/llm-pipeline";
// See LLM-PIPELINE.md for pipeline composition and which synergy patterns wire in here.
```

When to use: any stage wanting unified state threading across all LLM calls; prerequisite for most Wave 2I synergy composers.

---

## 7. Physics

For "did the bullet hit the wall" / "can the player move here" / soft-body
particles. Not a physics engine; enough for stage-level checks. The
`physicsPattern` helper pre-indexes static obstacles into a `SpatialHash` and
returns a `simulate` helper for bounded projectile traces.

```ts
import { physicsPattern } from "./lib/patterns/physics";

const p = physicsPattern({
  obstacles: [
    { id: "north-wall", aabb: { x: 0, y: 100, w: 200, h: 8 } },
    { id: "door-frame", aabb: { x: 90, y: 0, w: 8, h: 100 } },
  ],
});

// Trace a projectile (returns hit list and final position):
const result = p.simulate(ox, oy, vx, vy);

// Or query the hash directly:
const hits = p.hash.query(movedAABB);
```

When to use: any stage with positional collision — realtime combat (pair with
recipe 6), dungeon tile movement, projectile tracing, soft-body particle
chains. Also available as the `physicsPattern` extract composer:
`src/lib/patterns/physics.ts`.

---

## 21. Dialogue — FSM with predicate-gated choices

Predicate-gated state machine for structured conversation trees. States carry
a `say` string and a `choices` list; each choice has an optional
`Predicate<S>` guard filtered at display time.

```ts
import { dialoguePattern } from "./lib/patterns/dialogue";

const d = dialoguePattern({
  states: [
    { id: "intro", say: "Who are you?", choices: [
      { id: "friend", label: "A friend.", next: "trust" },
      { id: "enemy",  label: "Your enemy.", next: "combat" },
    ]},
    { id: "trust",   say: "Then come in.", choices: [] },
    { id: "combat",  say: "Guards!",       choices: [] },
  ],
  initial: "intro",
});

// Display filtered choices to the player:
const visible = d.availableChoices(gameState, refs, resolvers);
// Advance the FSM:
const nextSay = d.choose("friend", extraData);
```

When to use: Zork-shape (#2), any NPC with branching conversation that must
respect world-state conditions (reputation gate, item requirement, tag check).
Pair with `factionPattern` to gate choices on standing.

---

## 22. Score — stat + tier-based unlocks

Named `Stat` bundled with a `Timeline` of score events and a list of
`ScoreUnlock` entries. Unlocks fire when the tier threshold is newly crossed.

```ts
import { scorePattern } from "./lib/patterns/score";

const s = scorePattern({
  name: "karma",
  tiers: [{ label: "neutral", min: 0 }, { label: "hero", min: 100 }],
  unlocks: [{ tier: "hero", reward: { id: "blessing", kind: "tag-grant" } }],
});

s.award(10, "saved the orphan", now);      // increments + records event
const tier = s.tier();                      // "neutral" | "hero"
const newUnlocks = s.check();              // any newly crossed thresholds
```

When to use: karma/morality systems, achievement progression, leaderboard
stages (Zork-shape #2 points), any "unlock X when score crosses Y" mechanic.
Pair with `factionPattern` when reputation is faction-specific.

---

## 23. Faction — per-faction reputation with content gates

One `Stat` per faction plus a `gate(factionId, tier, state, refs)` predicate
constructor. Content is gated by calling `gate` and evaluating the result.

```ts
import { factionPattern } from "./lib/patterns/faction";

const f = factionPattern({
  factions: [
    { id: "guild", tiers: [{ label: "hostile", min: -100 }, { label: "friendly", min: 50 }] },
  ],
});

f.adjust("guild", +20);                    // mutates reputation stat
const standing = f.tierOf("guild");        // "hostile" | "friendly"

// Gate content on standing:
const pred = f.gate("guild", "friendly", gameState, refs);
// evaluate pred with the predicate DSL to decide whether to show content
```

When to use: LT-shape (#6), any multi-faction political stage. The `0c.
Reputation / faction` note at the top of this file describes the design
rationale. `factionPattern` is the assembled composer; prefer it over
hand-rolling `Stat` + `tier()`.

---

## 24. Skit — PARC scene + observation + outcome resolution

Composes `scenePattern` + `Actor` + `assembleObservations` into the PARC Skit
ergonomic. One call produces a scene with its observation feed attached.

```ts
import { skitPattern } from "./lib/patterns/skit";

const skit = skitPattern({
  actors: [playerActor, npcActor],
  actions: ACTION_DEFS,
  stageDirections: STAGE_DIRECTIONS,
});

// On each turn, observation sources are pre-wired:
const { sources, dispatch, resolveOutcome } = skit;
```

When to use: any stage that wants the full PARC Skit ergonomic
(actor + scene + observation) without hand-assembling the three separately.
The `src/lib/design/SCENE.md` authoring guide covers `SceneActionDef` defs;
the skit pattern wires the plumbing.

---

## 25. Form — pilotable character entity (Wave 2D)

Assembles a complete character-in-its-own-right from Body + Stats + abilities
+ aesthetics + lore. A Form is not a body delta; it is a pilotable entity with
its own appearance, capabilities, and narrative identity.

```ts
import { formPattern } from "./lib/patterns/form";

const frame = formPattern({
  id: "excalibur",
  body: new Body({ torso: ["human", "armored"] }),
  stats: { strength: new Stat({ base: 80 }), speed: new Stat({ base: 60 }) },
  abilities: [SLASH_DEF, RADIAL_BLIND_DEF],
  aesthetics: { color: "#b8860b", silhouette: "tall" },
  lore: "First Warframe. Blueprint from the Orokin era.",
});
```

When to use: Warframe-shape (#9), any stage where multiple distinct
"characters" exist as first-class pilotable objects rather than body-state
deltas. Pair with `formCollectionPattern` and `puppetPattern`.

---

## 26. FormCollection — PlaceholderRegistry with unlock progression (Wave 2D)

Wraps `PlaceholderRegistry<Form>` with an `unlock(id, form)` surface and
pre-seeded placeholder stubs. Placeholders are visible immediately; real Forms
swap in on unlock or procgen completion.

```ts
import { formCollectionPattern } from "./lib/patterns/form-collection";

const collection = formCollectionPattern({
  placeholders: ["volt", "mag", "ash"],   // stubs seeded immediately
});

// On acquisition:
collection.unlock("volt", await generateForm("volt"));

// Enumerate available forms:
collection.list();        // returns resolved Forms only
collection.listAll();     // includes pending placeholders
```

When to use: Warframe-shape (#9), any stage with a collect-and-unlock
progression where content is generated lazily. Pairs with `graftingPattern`
(recipe 27) and `puppetPattern` (recipe 28).

---

## 27. Grafting — Helminth-style ability transfer with provenance (Wave 2D)

Ability subsume → inject pipeline with slot-lock enforcement and full
`InjectionRecord` provenance tracking. Composes `Registry` +
`PlaceholderRegistry`; persistence is the stage's responsibility via Shard.

```ts
import { graftingPattern } from "./lib/patterns/grafting";

const helminth = graftingPattern({
  forms: collection.registry,          // PlaceholderRegistry<Form>
  learnedLibrary: ABILITY_REGISTRY,    // Registry<AbilityDef>
  consumeOnSubsume: true,
  helminthVersion: (def) => ({ ...def, damage: def.damage * 0.75 }),
  slot4Lock: true,
});

helminth.hooks.subsume("excalibur", "radial-blind");
helminth.hooks.inject({ sourceFormId: "excalibur", abilityId: "radial-blind",
  targetFormId: "volt", configSlot: 1, abilitySlot: 2 });
const configs = helminth.hooks.listInjected("volt");
```

When to use: Warframe-shape (#9) Helminth room, any stage with cross-character
ability transfer + provenance. Ad-hoc return shape (no turn loop) — call hooks
at player-action time, not each tick.

---

## 28. Puppet — actor piloting another actor (Wave 2D)

The player's true-self `Actor` pilots a form `Actor`. True-self persists
memory, inventory, and relationships; the form holds appearance, body, and
abilities. `equip` / `unequip` switch the active form; `active` always
resolves to the correct surface to show the LLM.

```ts
import { puppetPattern } from "./lib/patterns/puppet";

const puppet = puppetPattern({
  pilot: trueSelfActor,
  forms: collection.registry,
});

puppet.equip("excalibur");     // switch active form
const display = puppet.active; // form Actor if equipped, pilot Actor if not
puppet.unequip();              // revert to bare true-self
```

When to use: Warframe-shape (#9), any stage where the player inhabits
successive "shells" while maintaining a persistent inner identity. Pairs with
`formCollectionPattern` and `graftingPattern`.

---

## 29. Managerial — policy-issue + report-rendering loop (Wave 2C)

Player issues typed policy directives; each tick the subsystem renders a prose
report from `Timeline` events via `Timeline.summarize`. Enables the
"arcology manager" ergonomic of FC-shape.

```ts
import { managerialPattern } from "./lib/patterns/managerial";

const mgr = managerialPattern({
  policyFields: POLICY_SCHEMA,    // typed fields the player can set
  timeline,
  actors: pool,
});

// On player directive:
mgr.applyPolicy({ productionTarget: "food", laborQuota: 0.6 });

// After bulkTick (recipe 8):
const report = mgr.renderReport(tickEvents, now);
// Surface report as stageDirections; let LLM narrate.
```

When to use: FC-shape (#8), FS-shape, any stage where the player sets
high-level policy and receives turn reports rather than issuing individual
actions. Pair with `bulkTickPattern` (recipe 8) — managerial renders what
bulk-tick produced.

---

## 30. Sandbox — free-roam open-world turn loop

Full open-world composer: world + actor + intent parsing + procgen. One call
per player turn handles scope, intent, look, and move.

```ts
import { sandboxPattern } from "./lib/patterns/sandbox";

const sb = sandboxPattern({
  world, pool, procgen, intentParser,
  includeCarried: true,
});

// Each turn:
const scope  = sb.scope(playerId);
const intent = await sb.parseIntent(playerText, playerId);
const desc   = sb.look(playerId);
if (intent.kind === "move") sb.move(playerId, intent.destination);
```

When to use: CoC-shape (#4), LT-shape (#6), any exploration stage without a
fixed scene flow. If the player IS the subject rather than the explorer, use
`subjectSandboxPattern` (recipe 16) instead.

---

## 31. WorldExploration — parser-IF turn loop

Classic parser-IF: deterministic grammar → LLM fallback on miss. Scope,
intent, look, move — same surface as sandbox but with an explicit grammar
layer and `look` returning formatted room + entity list + visible exits.

```ts
import { worldExplorationPattern } from "./lib/patterns/world-exploration";

const we = worldExplorationPattern({ world, pool, grammar: GRAMMAR_DEFS });

const scope  = we.scope(playerId);
const intent = await we.parseIntent(playerText, playerId); // grammar first
const look   = we.look(playerId);                           // formatted description
```

When to use: Zork-shape (#2), any stage where a deterministic grammar should
handle standard verbs (take, drop, examine, go N) and the LLM only sees
failures. If open-world with no grammar, use `sandboxPattern` (recipe 30).

---

## Synergy patterns (Wave 2I)

Synergy patterns are `ComposedSubsystem`-shaped composers that plug into
`LlmPipelineRunner`. They do not have their own tick loop; the pipeline calls
their `hooks.beforePrompt` / `hooks.afterResponse` for you. See
`src/lib/LLM-PIPELINE.md` for wiring and `src/lib/patterns/synergy/types.ts`
for the `ComposedSubsystem<S>` shape.

Each pattern below is one paragraph: what it does and when to reach for it.

**`cacheByKey`** — LLM output cached by structural id (AID Story Card
pattern). Once generated for a key, the same payload is served from cache on
every future activation. Reach for it when content is invented mid-session and
must be consistent on revisit (cyberware defs, NPC lore, procgen room
descriptions). Pairs with `generativeRegistry` (recipe 9).

**`characterFilteredActivation`** — context entry activates only when a
specific character is in focus (SillyTavern WI Character Filter). Reach for it
when stage has multiple NPCs whose lore entries should only inject when that
NPC is actively present in the scene.

**`fallbackChain`** — deterministic grammar first; LLM fallback on grammar
miss. Reach for it when intent parsing must be fast for standard verbs but
graceful for novel phrasing. The pattern wraps both layers and appends a
second LLM call only on failure. See also `worldExplorationPattern` (recipe
31) which embeds this chain.

**`forceActivateWithBudgetCap`** — always-on context section with a hard token
cap (NovelAI Force Activation). Reach for it when a section must appear in
every prompt but must not crowd out dynamic content. Mitigates
`budget-poisoning`.

**`hierarchicalSummarization`** — per-actor mini-reports merged into a single
executive summary. Reach for it when `managerialPattern` (recipe 29) tick
reports grow long: each actor produces a one-liner, the pattern collapses them.

**`inclusionGroupMutex`** — mutually exclusive activation groups (SillyTavern
Inclusion Groups). Reach for it when multiple context entries should never
co-activate; prevents `key-collision` anti-pattern.

**`llmConstrainedByProcgen`** — procgen lays a structured skeleton; LLM fills
prose into the slots. Reach for it when output must satisfy structural
constraints (scene beats, stat rolls, spatial layout) but prose is LLM's.

**`llmNarratesProgrammaticTracks`** — procgen owns the event/goal list; LLM
narrates. Reach for it when mechanical events are deterministic but their
prose rendering should be expressive (AID Scripting pattern).

**`overrideSlots`** — SillyTavern Main-Prompt / System-Prompt override
surface. Reach for it when a stage needs to replace (not append) the base
system prompt for a sub-scene without touching the pipeline's main prompt.

**`positionalInjectionDepth`** — inject a context entry at a specific position
in the message history (SillyTavern WI depth field). Reach for it when
recency of a fact matters more than its static priority; memory "fades" as it
moves further from the current turn.

**`procgenValidatesLlm`** — LLM proposes a value; deterministic validator
accepts or rejects with a reason; rejected proposals re-prompt with the failure
appended. Reach for it when LLM output must satisfy hard constraints
(valid item id, legal move, schema).

**`programmaticNarratesLlmDecides`** — LLM picks from a constrained action
menu; prose describes the choice. Reach for it when you want LLM agency over
*which* action but deterministic resolution of *what it does* (AID output-
modifier pattern).

**`quietGenerationSubCall`** — hidden LLM sub-call whose output is injected
into context before the main generation (SillyTavern Quiet Mode). Reach for it
when you need LLM-extracted structured data (intent, tags, entity list) without
exposing the extraction call in the visible message.

**`recencyFrequencyEviction`** — AID Story Card prioritization: entries scored
by recency of activation + frequency of match, lowest-scored evicted when
budget is tight. Reach for it when the context has a large WI catalog and
needs principled eviction rather than FIFO.

**`recursiveKeyExpansion`** — a WI entry's activation triggers evaluation of
its own body for further keys (SillyTavern WI recursion). Reach for it when
lore entries cross-reference each other and you want transitive activation.

**`scheduledSelfCheck`** — periodic LLM self-check on a Scheduler tick:
"does current state satisfy objective?" Returns a boolean + reason.
Reach for it when a stage needs autonomous goal tracking without per-turn
inference overhead.

**`scriptedQuickReplyMacro`** — SillyTavern STScript / Quick Reply macro
runner. Executes a scripted sequence of stage directives as a single player
action. Reach for it when a stage has power-user shortcuts that chain multiple
mechanical effects.

**`seedFromPlayer`** — LLM extracts a structured seed/spec from freeform
player character-creation prose, then the stage uses the seed to bootstrap
procgen. Reach for it at stage init when player input is the source of truth
for world parameters.

**`semanticRecallOverlay`** — vector-similarity recall over Timeline events
(SillyTavern Vector Storage). Reach for it when timeline is long and only
thematically relevant events should surface; replaces recency-only windowing.

**`stickyCooldownDelayTimers`** — SillyTavern WI Timed Effects: sticky entries
that expire after N turns, delay entries that activate after M turns. Reach for
it when temporary conditions (status effects, scene beats) should appear in
context for exactly the right window.

**`subcontextGroupBudgeting`** — NovelAI Subcontext composer: assigns per-group
token budgets before `ContextAssembler` runs. Reach for it as the primary
mitigation for `budget-poisoning` when multiple subsystems compete for context
space.

**`triplehookPipeline`** — convenience wrapper for `LlmPipelineRunner` that
pre-wires the AID triple-hook shape (input modifier → context → output
modifier). Reach for it when the stage's pipeline matches that canonical shape
exactly, to avoid writing the wiring by hand.

---

## Return shapes

Three composer return shapes coexist across the library. See
[`RETURN-SHAPES.md`](./patterns/RETURN-SHAPES.md) for the discriminant: when
to use `*Bundle`, `ComposedSubsystem<S>`, or ad-hoc.

---

## Anti-patterns

### `budget-poisoning`

Naive context construction adds entries one-by-one without any budget awareness. Each contributor appends unconditionally; when the total exceeds the model's context window, the assembler truncates the tail. Verbose contributors (Timeline windows, observation dumps) crowd out high-priority contributors (system instructions, turn input). Result: chaotic, uncontrolled section competition.

**Mitigation:** use `ContextAssembler` with explicit `priority` and `optional` flags so required sections are protected, and apply `subcontextGroupBudgetingPattern` to assign per-group token caps before assembly.

### `key-collision`

Multiple context entries or cache keys share a prefix or overlapping regex, causing them to activate together when only one was intended. In `PlaceholderRegistry` this causes concurrent `waitFor` resolution races; in `TriggerSet` it causes multiple triggers firing on the same predicate match.

**Mitigation:** use `inclusionGroupMutexPattern` to declare mutually exclusive activation groups, and prefer `kind: "glob"` or `kind: "regex"` predicate kinds (Wave 2I additions to `predicate.ts`) over loose string-prefix matching so match boundaries are explicit.

