/*
 * world.ts — graph of places (Wave 2B).
 *
 * WHAT: A `World` is a directed graph of `Room`s, each with named exits and a
 *       set of located entity ids. Entities (actors, items, scenery) are
 *       tracked by id in a single location index; `locate`, `move`, `where`,
 *       and `entitiesAt` are the manipulators. `scope(observerId)` returns
 *       the set of exit names + room-mate entity ids visible from the
 *       observer's current room — the input `parseIntent` consumes.
 *
 *       Composes with `intent.ts` (scope feed), `predicate.ts` (exit `gate`
 *       evaluated through caller-supplied resolvers; world acts as the
 *       `getLocation` source), `inventory.ts` (carry-class transitions
 *       triggered by callers on `move`), `scene.ts` (Scene participants are
 *       located here), and `observation.ts` (World is an ObservationSource).
 *
 * WHY: Surfaced by `examples/world-primary/Stage.tsx`, which hand-rolls every
 *      concept here: room records with exits, a current-location field,
 *      ad-hoc scope set construction per turn. Also the missing piece called
 *      out in `intent.ts`'s header ("`world.ts` scope integration"). Required
 *      first by parser-IF stages (Zork-shape, CCA-shape, HHGTTG-shape) and
 *      by Wave 3 composers `worldExplorationPattern`, `subjectSandboxPattern`,
 *      `slotAssignmentPattern`, `spatialPropagationPattern`.
 *
 *      Rule #1 (tag-based identity): entities are bare ids; the world does
 *      not know what kind they are. Rule #4 (pure calculator): no scheduler,
 *      no timeline, no prose generation. Rule #3 (detect vs resolve):
 *      `move` returns events, the caller dispatches.
 *
 * SHAPE:
 *   interface Room { id; name; description; exits; tags? }
 *   interface Exit { to; gate?; hidden? }
 *   type WorldEvent =
 *     | { kind: "entered";  entityId; roomId; from? }
 *     | { kind: "exited";   entityId; roomId; to?   }
 *     | { kind: "located";  entityId; roomId        }
 *     | { kind: "detached"; entityId; from          }
 *   interface ScopeOptions { includeCarried?; revealFlag?; includeSelf? }
 *   class World implements ObservationSource<unknown>
 *     constructor(init?: { rooms?; locations? })
 *     addRoom(room): this
 *     getRoom(id): Room | null
 *     rooms(): Room[]
 *     connect(a, dir, b, reverseDir?, opts?): this
 *     locate(entityId, roomId): WorldEvent[]
 *     detach(entityId): WorldEvent | null
 *     where(entityId): string | null
 *     entitiesAt(roomId): string[]
 *     move(entityId, direction, resolvers?): WorldEvent[] | null
 *     scope(observerId, opts?): Set<string>
 *     exitsFrom(roomId, opts?): Record<string, Exit>
 *     describe(roomId, opts?): string
 *     toJSON(); static fromJSON(data)
 */

import type { Predicate, Refs, Resolvers } from "./predicate";
import { evaluate as evalPredicate } from "./predicate";
import type { Channel, Evaluator, Key, ObservationSource } from "./observation";

export interface Exit {
  /** Destination room id. */
  to: string;
  /** Optional gate predicate. Evaluated by caller-supplied resolvers
   *  on `move()`; on failure `move` returns null. Skipped if absent. */
  gate?: Predicate<unknown>;
  /** Excluded from `scope` and `exitsFrom` unless an opt-in reveal hook
   *  passes. Default omitted. */
  hidden?: boolean;
}

export interface Room {
  id: string;
  name: string;
  description: string;
  /** Map direction-name → Exit. Direction is an arbitrary string; the
   *  conventional set is n/s/e/w/ne/nw/se/sw/up/down/in/out, matching
   *  the synonyms shipped by `intent.ts`. */
  exits: Record<string, Exit>;
  /** Free-form room tags for stage queries (e.g. "indoors", "haunted"). */
  tags?: string[];
}

export type WorldEvent =
  | { kind: "entered"; entityId: string; roomId: string; from?: string }
  | { kind: "exited"; entityId: string; roomId: string; to?: string }
  | { kind: "located"; entityId: string; roomId: string }
  | { kind: "detached"; entityId: string; from: string };

export interface ScopeOptions {
  /** Iterates ids the observer is carrying (e.g. inventory). Returned ids
   *  are unioned into scope without coupling to inventory.ts. */
  includeCarried?: (observerId: string) => Iterable<string>;
  /** Per-exit reveal predicate. Hidden exits are included only when this
   *  returns true. Default treats hidden as hidden. */
  revealFlag?: (exit: Exit, direction: string) => boolean;
  /** Include the observer's own id in the returned scope. Default false —
   *  parser-IF "examine me" works on a dedicated alias the caller adds. */
  includeSelf?: boolean;
}

export interface WorldJSON {
  rooms: Room[];
  locations: [string, string][];
}

interface WorldInit {
  rooms?: Iterable<Room>;
  locations?: Iterable<[string, string]>;
}

/* ──────────────────────────────────────────────────────────────────────
 * World
 * ────────────────────────────────────────────────────────────────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class World implements ObservationSource<any> {
  private readonly roomsById: Map<string, Room> = new Map();
  /** entityId → roomId. */
  private readonly locationOf: Map<string, string> = new Map();
  /** roomId → set of entity ids located there. Mirrors `locationOf`. */
  private readonly contentsOf: Map<string, Set<string>> = new Map();

  // ObservationSource fields.
  readonly id: string = "world";
  readonly channels: Channel[] = ["visual"];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly salience: Evaluator<any, number>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly properties: Record<Channel, Record<Key, Evaluator<any>>>;

  constructor(init: WorldInit = {}) {
    if (init.rooms) for (const r of init.rooms) this.addRoom(r);
    if (init.locations) {
      for (const [eid, rid] of init.locations) {
        if (!this.roomsById.has(rid)) {
          throw new Error(`World: cannot pre-locate "${eid}" — room "${rid}" not registered`);
        }
        this.locationOf.set(eid, rid);
        this.bucket(rid).add(eid);
      }
    }

    this.salience = () => (this.roomsById.size === 0 ? 0 : 0.5);
    this.properties = {
      visual: {
        rooms: () => this.rooms().map((r) => ({ id: r.id, name: r.name })),
        locations: () => Object.fromEntries(this.locationOf),
      },
    };
  }

  /* ── rooms ────────────────────────────────────────────────────────── */

  addRoom(room: Room): this {
    this.roomsById.set(room.id, room);
    if (!this.contentsOf.has(room.id)) this.contentsOf.set(room.id, new Set());
    return this;
  }

  getRoom(id: string): Room | null {
    return this.roomsById.get(id) ?? null;
  }

  rooms(): Room[] {
    return [...this.roomsById.values()];
  }

  /** Add a directional exit from `a` to `b`. When `reverseDir` is provided,
   *  also adds the back-edge from `b` to `a`. Both rooms must already be
   *  registered (programmer-error guard). */
  connect(
    a: string,
    dir: string,
    b: string,
    reverseDir?: string,
    opts?: Partial<Exit>,
  ): this {
    const roomA = this.roomsById.get(a);
    const roomB = this.roomsById.get(b);
    if (!roomA) throw new Error(`World.connect: unknown room "${a}"`);
    if (!roomB) throw new Error(`World.connect: unknown room "${b}"`);
    roomA.exits[dir] = { to: b, ...opts };
    if (reverseDir) roomB.exits[reverseDir] = { to: a, ...opts };
    return this;
  }

  /* ── locations ────────────────────────────────────────────────────── */

  /** Place an entity at a room. If already located elsewhere, emits an
   *  `exited`/`entered` pair; if previously detached, emits `located`. */
  locate(entityId: string, roomId: string): WorldEvent[] {
    if (!this.roomsById.has(roomId)) {
      throw new Error(`World.locate: unknown room "${roomId}"`);
    }
    const prev = this.locationOf.get(entityId);
    if (prev === roomId) return [];
    this.locationOf.set(entityId, roomId);
    if (prev !== undefined) this.contentsOf.get(prev)?.delete(entityId);
    this.bucket(roomId).add(entityId);
    if (prev === undefined) {
      return [{ kind: "located", entityId, roomId }];
    }
    return [
      { kind: "exited", entityId, roomId: prev, to: roomId },
      { kind: "entered", entityId, roomId, from: prev },
    ];
  }

  /** Remove an entity's location entirely. Returns the event or null if
   *  the entity wasn't located. */
  detach(entityId: string): WorldEvent | null {
    const prev = this.locationOf.get(entityId);
    if (prev === undefined) return null;
    this.locationOf.delete(entityId);
    this.contentsOf.get(prev)?.delete(entityId);
    return { kind: "detached", entityId, from: prev };
  }

  where(entityId: string): string | null {
    return this.locationOf.get(entityId) ?? null;
  }

  entitiesAt(roomId: string): string[] {
    const set = this.contentsOf.get(roomId);
    return set ? [...set] : [];
  }

  /** Traverse an exit. Returns the events emitted, or null when:
   *   - the entity has no current location,
   *   - the current room has no such direction,
   *   - the exit is gated and the gate predicate fails.
   *  Hidden exits are still traversable; reveal logic lives in `scope`. */
  move(
    entityId: string,
    direction: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolvers?: Resolvers<unknown, any>,
  ): WorldEvent[] | null {
    const from = this.locationOf.get(entityId);
    if (from === undefined) return null;
    const room = this.roomsById.get(from);
    const exit = room?.exits[direction];
    if (!exit) return null;
    if (exit.gate) {
      const refs: Refs<string> = { self: entityId, player: entityId };
      if (!evalPredicate(exit.gate, undefined, refs, resolvers ?? {})) return null;
    }
    return this.locate(entityId, exit.to);
  }

  /* ── queries ──────────────────────────────────────────────────────── */

  scope(observerId: string, opts: ScopeOptions = {}): Set<string> {
    const out = new Set<string>();
    const roomId = this.locationOf.get(observerId);
    if (roomId === undefined) {
      if (opts.includeSelf) out.add(observerId);
      if (opts.includeCarried) for (const id of opts.includeCarried(observerId)) out.add(id);
      return out;
    }
    const room = this.roomsById.get(roomId);
    if (room) {
      for (const [dir, exit] of Object.entries(room.exits)) {
        if (exit.hidden && !(opts.revealFlag?.(exit, dir) ?? false)) continue;
        out.add(dir);
      }
    }
    for (const eid of this.contentsOf.get(roomId) ?? []) {
      if (eid === observerId && !opts.includeSelf) continue;
      out.add(eid);
    }
    if (opts.includeSelf) out.add(observerId);
    if (opts.includeCarried) for (const id of opts.includeCarried(observerId)) out.add(id);
    return out;
  }

  /** Visible-or-all exits from a room. Honours `hidden` unless asked otherwise
   *  or a reveal-hook is supplied. Skips gated exits when `resolvers` is given
   *  and the gate fails. */
  exitsFrom(
    roomId: string,
    opts: {
      includeHidden?: boolean;
      revealFlag?: (exit: Exit, direction: string) => boolean;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      resolvers?: Resolvers<unknown, any>;
    } = {},
  ): Record<string, Exit> {
    const room = this.roomsById.get(roomId);
    if (!room) return {};
    const out: Record<string, Exit> = {};
    for (const [dir, exit] of Object.entries(room.exits)) {
      if (exit.hidden && !opts.includeHidden && !(opts.revealFlag?.(exit, dir) ?? false)) continue;
      if (exit.gate && opts.resolvers) {
        const refs: Refs<string> = {};
        if (!evalPredicate(exit.gate, undefined, refs, opts.resolvers)) continue;
      }
      out[dir] = exit;
    }
    return out;
  }

  /** Convenience: concatenate room description with a flat entity list.
   *  Stages that want richer rendering build their own from `getRoom` +
   *  `entitiesAt`. */
  describe(roomId: string, opts: { includeEntities?: boolean } = {}): string {
    const room = this.roomsById.get(roomId);
    if (!room) return "";
    const parts: string[] = [room.description];
    if (opts.includeEntities !== false) {
      const ents = this.entitiesAt(roomId);
      if (ents.length > 0) parts.push(`Here: ${ents.join(", ")}.`);
    }
    return parts.join("\n\n");
  }

  /* ── persistence ──────────────────────────────────────────────────── */

  toJSON(): WorldJSON {
    return {
      rooms: this.rooms(),
      locations: [...this.locationOf.entries()],
    };
  }

  static fromJSON(data: WorldJSON): World {
    return new World({ rooms: data.rooms, locations: data.locations });
  }

  /* ── internal ─────────────────────────────────────────────────────── */

  private bucket(roomId: string): Set<string> {
    let s = this.contentsOf.get(roomId);
    if (!s) {
      s = new Set();
      this.contentsOf.set(roomId, s);
    }
    return s;
  }
}

/* ──────────────────────────────────────────────────────────────────────
 * Convenience: resolver factory
 *
 * Lets a stage plug World into the predicate-resolver bundle without
 * importing internals. Use as:
 *
 *   const resolvers = { ...stageResolvers, ...worldResolvers(world) };
 *
 * Composes with `Resolvers<S, ActorRef>` from predicate.ts; supplies
 * `getLocation` keyed by entity id.
 * ────────────────────────────────────────────────────────────────────── */

export function worldResolvers(world: World): {
  getLocation: (actor: string) => string | undefined;
} {
  return {
    getLocation: (actor: string) => world.where(actor) ?? undefined,
  };
}
