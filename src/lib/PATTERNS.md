# PATTERNS — composable recipes for the seven target use cases

Each recipe is a ~80-line skeleton you paste into `src/Stage.tsx` and edit.
Comments mark where stage-specific authoring goes. None of these compile
on their own (they assume `import` lines and that `MessageStateType` etc.
are typed by you); see `Stage.tsx` for the surrounding boilerplate.

The recipes are deliberately repetitive: each one starts from the same
`extends StageBase` shape so the LLM can match against whichever one is
closest to the design.

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

## 7. Physics

For "did the bullet hit the wall" / "can the player move here" / soft-body
particles. Not a physics engine; enough for stage-level checks.

```ts
import { AABB, Circle, SpatialHash, aabbOverlap, resolvePositional, verletStep } from "./lib/physics";

walls: AABB[] = [
  { x: 0, y: 100, w: 200, h: 8 },
  { x: 90, y: 0, w: 8, h: 100 },
];
hash = new SpatialHash<AABB>(32);

async load() {
  for (const w of this.walls) this.hash.insert(w, w);
  return { success: true, initState: null, chatState: null };
}

tryMove(player: AABB, dx: number, dy: number): AABB {
  const moved: AABB = { ...player, x: player.x + dx, y: player.y + dy };
  const hits = this.hash.query(moved);
  for (const w of hits) {
    if (!aabbOverlap(moved, w)) continue;
    const adj = resolvePositional(moved, w);
    moved.x += adj.ax;
    moved.y += adj.ay;
  }
  return moved;
}

// Verlet particle (e.g. a tail tip):
tailTip = { p: { x: 0, y: 0 }, prev: { x: 0, y: 0 } };
tickTail(dt: number) {
  const next = verletStep(this.tailTip.p, this.tailTip.prev, { x: 0, y: 200 }, dt, 0.05);
  this.tailTip = next;
}
```
