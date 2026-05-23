/*
 * actor.ts — bundled entity primitive + bulk-collection form.
 *
 * WHAT: An Actor is a single named thing in the world: id + name +
 *       Body + Inventory + per-stat Map + optional location + optional
 *       owner (for slavery/pet/ownership) + sparse affinity map (pairwise
 *       relationship scores) + free-form TagSet. Methods are thin: most
 *       behavior lives on the composed primitives (Body, Inventory, Stat).
 *
 *       ActorPool is the bulk-collection form. Conceptually it is
 *       `Registry<Actor>` but copies the shape rather than extending
 *       because (a) query helpers `byTag` / `byLocation` are first-class
 *       and (b) `toJSON`/`fromJSON` need a deps dict (item defs, etc.)
 *       to round-trip per-Actor primitives, which doesn't fit
 *       Registry's generic `Record<id,T>` symmetry.
 *
 * WHY: Bundling is justified because every FC/CoC/LT-shape stage will
 *      scale to 100+ actors. The bulk form is required from day one.
 *      `owner: ActorId` unifies slavery / pet / familiar mechanics
 *      across game shapes — it's an actor field, not a separate
 *      primitive. `affinity: Map<ActorId, number>` IS the
 *      RelationshipScore primitive that was ruled out — sparse, lives
 *      on the actor, no special module needed.
 *
 *      Rule #2 (def/instance): an Actor is the instance; defs are
 *      held by composed primitives (ItemDef, StatInit). Rule #4
 *      (pure calculator + mutable holder): Actor is the holder.
 *
 * SHAPE:
 *   type ActorId = string
 *   class Actor
 *     id; name; body; inventory; location?; owner?;
 *     stats: Map<string, Stat>
 *     affinity: Map<ActorId, number>
 *     tags: TagSet
 *     constructor(init: ActorInit)
 *     getStat(name); setStat(name, stat); hasStat(name)
 *     getAffinity(other); setAffinity(other, value); adjustAffinity(other, delta)
 *     toJSON(): ActorJSON
 *     static fromJSON(data, deps): Actor
 *   class ActorPool
 *     actors: Map<ActorId, Actor>
 *     add(a); get(id); require(id); has(id); delete(id); size()
 *     forEach(fn); filter(pred); map(fn)
 *     all(): Actor[]
 *     byTag(tag): Actor[]
 *     byOwner(ownerId): Actor[]
 *     byLocation(loc): Actor[]
 *     toJSON(): Record<ActorId, ActorJSON>
 *     static fromJSON(data, deps): ActorPool
 */

import { Body } from "./body";
import { Inventory, ItemDef } from "./inventory";
import { Stat, StatInit } from "./stats";
import { TagSet } from "./tags";

export type ActorId = string;
export type StatName = string;

export interface ActorInit {
  id: ActorId;
  name: string;
  body?: Body;
  inventory?: Inventory;
  stats?: Iterable<[StatName, Stat]> | Record<StatName, Stat>;
  location?: string;
  owner?: ActorId;
  affinity?: Iterable<[ActorId, number]> | Record<ActorId, number>;
  tags?: Iterable<string> | TagSet;
}

export interface ActorJSON {
  id: ActorId;
  name: string;
  body: ReturnType<Body["toJSON"]>;
  inventory: ReturnType<Inventory["toJSON"]>;
  stats: Record<StatName, ReturnType<Stat["toJSON"]>>;
  location?: string;
  owner?: ActorId;
  affinity: Record<ActorId, number>;
  tags: string[];
}

/** Deps required to round-trip an Actor's composed primitives. */
export interface ActorDeps {
  /** Tier function lookup for stat restoration; keyed by stat name. */
  statTiers?: Record<StatName, StatInit["tiers"]>;
  /** Item defs to re-register on each restored Inventory (Inventory.fromJSON
   *  carries them itself, but this is here for forward-compat / parity with
   *  Loadout's deps shape). */
  itemDefs?: ItemDef[];
}

function isIterableEntries<K, V>(x: unknown): x is Iterable<[K, V]> {
  return !!x && typeof x === "object" && Symbol.iterator in (x as object);
}

export class Actor {
  id: ActorId;
  name: string;
  body: Body;
  inventory: Inventory;
  stats: Map<StatName, Stat>;
  location?: string;
  owner?: ActorId;
  affinity: Map<ActorId, number>;
  tags: TagSet;

  constructor(init: ActorInit) {
    if (!init.id) throw new Error("Actor: id is required");
    if (!init.name) throw new Error("Actor: name is required");
    this.id = init.id;
    this.name = init.name;
    this.body = init.body ?? new Body();
    this.inventory = init.inventory ?? new Inventory();
    this.stats = new Map(
      isIterableEntries<StatName, Stat>(init.stats)
        ? init.stats
        : init.stats
        ? Object.entries(init.stats as Record<string, Stat>)
        : [],
    );
    this.location = init.location;
    this.owner = init.owner;
    this.affinity = new Map(
      isIterableEntries<ActorId, number>(init.affinity)
        ? init.affinity
        : init.affinity
        ? Object.entries(init.affinity as Record<string, number>)
        : [],
    );
    this.tags = init.tags instanceof TagSet ? init.tags.clone() : new TagSet(init.tags ?? []);
  }

  getStat(name: StatName): Stat | undefined {
    return this.stats.get(name);
  }

  setStat(name: StatName, stat: Stat): this {
    this.stats.set(name, stat);
    return this;
  }

  hasStat(name: StatName): boolean {
    return this.stats.has(name);
  }

  /** Returns 0 for unrecorded pairs (sparse default). */
  getAffinity(other: ActorId): number {
    return this.affinity.get(other) ?? 0;
  }

  /** Setting to 0 removes the entry to preserve sparseness. */
  setAffinity(other: ActorId, value: number): this {
    if (value === 0) this.affinity.delete(other);
    else this.affinity.set(other, value);
    return this;
  }

  adjustAffinity(other: ActorId, delta: number): number {
    const next = this.getAffinity(other) + delta;
    this.setAffinity(other, next);
    return next;
  }

  toJSON(): ActorJSON {
    const stats: Record<StatName, ReturnType<Stat["toJSON"]>> = {};
    for (const [k, v] of this.stats) stats[k] = v.toJSON();
    const affinity: Record<ActorId, number> = {};
    for (const [k, v] of this.affinity) affinity[k] = v;
    return {
      id: this.id,
      name: this.name,
      body: this.body.toJSON(),
      inventory: this.inventory.toJSON(),
      stats,
      location: this.location,
      owner: this.owner,
      affinity,
      tags: this.tags.toArray(),
    };
  }

  static fromJSON(data: ActorJSON, deps: ActorDeps = {}): Actor {
    const body = Body.fromJSON(data.body);
    const inventory = Inventory.fromJSON(data.inventory);
    const stats = new Map<StatName, Stat>();
    for (const [name, statData] of Object.entries(data.stats)) {
      stats.set(
        name,
        new Stat({
          base: statData.base,
          modifiers: statData.modifiers,
          tiers: deps.statTiers?.[name],
        }),
      );
    }
    return new Actor({
      id: data.id,
      name: data.name,
      body,
      inventory,
      stats,
      location: data.location,
      owner: data.owner,
      affinity: data.affinity,
      tags: data.tags,
    });
  }
}

export class ActorPool {
  readonly actors: Map<ActorId, Actor> = new Map();

  constructor(initial?: Iterable<Actor>) {
    if (initial) for (const a of initial) this.actors.set(a.id, a);
  }

  add(a: Actor): this {
    this.actors.set(a.id, a);
    return this;
  }

  get(id: ActorId): Actor | undefined {
    return this.actors.get(id);
  }

  require(id: ActorId): Actor {
    const a = this.actors.get(id);
    if (!a) throw new Error(`ActorPool: no actor with id "${id}"`);
    return a;
  }

  has(id: ActorId): boolean {
    return this.actors.has(id);
  }

  delete(id: ActorId): boolean {
    return this.actors.delete(id);
  }

  size(): number {
    return this.actors.size;
  }

  forEach(fn: (actor: Actor) => void): void {
    for (const a of this.actors.values()) fn(a);
  }

  filter(pred: (actor: Actor) => boolean): Actor[] {
    const out: Actor[] = [];
    for (const a of this.actors.values()) if (pred(a)) out.push(a);
    return out;
  }

  map<U>(fn: (actor: Actor) => U): U[] {
    const out: U[] = [];
    for (const a of this.actors.values()) out.push(fn(a));
    return out;
  }

  all(): Actor[] {
    return [...this.actors.values()];
  }

  byTag(tag: string): Actor[] {
    return this.filter((a) => a.tags.has(tag));
  }

  byOwner(ownerId: ActorId): Actor[] {
    return this.filter((a) => a.owner === ownerId);
  }

  byLocation(loc: string): Actor[] {
    return this.filter((a) => a.location === loc);
  }

  toJSON(): Record<ActorId, ActorJSON> {
    const out: Record<ActorId, ActorJSON> = {};
    for (const [id, a] of this.actors) out[id] = a.toJSON();
    return out;
  }

  static fromJSON(data: Record<ActorId, ActorJSON>, deps: ActorDeps = {}): ActorPool {
    const pool = new ActorPool();
    for (const aData of Object.values(data)) pool.add(Actor.fromJSON(aData, deps));
    return pool;
  }
}
