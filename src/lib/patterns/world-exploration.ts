/*
 * patterns/world-exploration.ts — Parser-IF composer: world + actor + intent + observation.
 *
 * WHAT: `worldExplorationPattern(init)` wires the classic parser-IF turn loop:
 *
 *         1. `scope(playerId)` — exits + co-located entity ids (+ carried items
 *            via `includeCarried` hook) fed to intent parser.
 *         2. `parseIntent(text, playerId)` — deterministic grammar, LLM fallback.
 *         3. `look(playerId)` — formatted room description + entity list + visible
 *            exits. Safe to call after every move.
 *         4. `move(playerId, direction, resolvers?)` — delegates to `world.move`;
 *            returns events or null (caller decides prose).
 *         5. The bundle implements `ObservationSource<unknown>` via `world` so
 *            the stage can hand it directly to `assembleObservations`.
 *
 * WHY: Colossal Cave Adventure (#1), Zork (#2), HHGTTG (#3) all share the same
 *      primitive wiring. `worldExplorationPattern` collapses the boilerplate of
 *      scope-feeding, intent parsing, and room-look so each IF stage author
 *      writes the puzzle/puzzle-gate logic, not the plumbing.
 *
 *      Enables CCA-shape (#1), Zork-shape (#2), HHGTTG-shape (#3).
 *
 * SHAPE:
 *   interface WorldExplorationInit
 *     { world; actorPool; parseOptions?; scopeOpts?;
 *       timeline?: Timeline<WorldEvent>; resolvers? }
 *   interface WorldExplorationBundle
 *     { world; actorPool; timeline;
 *       scope(playerId): Set<string>;
 *       parseIntent(text, playerId): Promise<Intent | null>;
 *       look(playerId): string;
 *       move(playerId, dir, resolvers?): WorldEvent[] | null;
 *       logEvents(events: WorldEvent[]): void; }
 *   function worldExplorationPattern(init): WorldExplorationBundle
 */

import { type ActorPool } from "../actor";
import { parseIntent, type Intent, type ParseIntentOptions } from "../intent";
import { type Resolvers } from "../predicate";
import { Timeline } from "../timeline";
import { type World, type WorldEvent, type ScopeOptions, worldResolvers } from "../world";

export interface WorldExplorationInit {
  world: World;
  actorPool: ActorPool;
  /** Forwarded to `parseIntent`. */
  parseOptions?: ParseIntentOptions;
  /** Options forwarded to `world.scope` (e.g. `includeCarried`). */
  scopeOpts?: ScopeOptions;
  /** Bring-your-own timeline. Created if absent. */
  timeline?: Timeline<WorldEvent>;
  /**
   * Stage-author resolvers merged with `worldResolvers(world)` on every
   * `move` call so gate predicates can reference world state.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolvers?: Resolvers<unknown, any>;
}

export interface WorldExplorationBundle {
  world: World;
  actorPool: ActorPool;
  timeline: Timeline<WorldEvent>;
  /** Scope set for `playerId` — exits + co-located entity ids. */
  scope(playerId: string): Set<string>;
  /** Parse freeform text against the player's current scope. */
  parseIntent(text: string, playerId: string): Promise<Intent | null>;
  /**
   * Return a formatted room description for `playerId`'s current room:
   * description, visible exits, and co-located entity ids.
   */
  look(playerId: string): string;
  /**
   * Move `playerId` one step in `direction`. Returns WorldEvents or null
   * (unknown direction / failed gate). Caller decides the prose.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  move(playerId: string, direction: string, resolvers?: Resolvers<unknown, any>): WorldEvent[] | null;
  /** Push WorldEvents from `move` / `world.locate` etc. to the timeline. */
  logEvents(events: WorldEvent[]): void;
}

export function worldExplorationPattern(init: WorldExplorationInit): WorldExplorationBundle {
  const timeline = init.timeline ?? new Timeline<WorldEvent>({ windowSize: 64 });
  const baseResolvers = { ...init.resolvers, ...worldResolvers(init.world) };

  const scope = (playerId: string): Set<string> =>
    init.world.scope(playerId, init.scopeOpts);

  const parseIntentFn = (text: string, playerId: string): Promise<Intent | null> =>
    parseIntent(text, scope(playerId), init.parseOptions);

  const look = (playerId: string): string => {
    const roomId = init.world.where(playerId);
    if (!roomId) return "You are nowhere.";
    const room = init.world.getRoom(roomId);
    if (!room) return "Unknown room.";
    const exits = Object.keys(init.world.exitsFrom(roomId));
    const entities = init.world
      .entitiesAt(roomId)
      .filter((id) => id !== playerId);
    const parts: string[] = [room.description];
    if (exits.length > 0) parts.push(`Exits: ${exits.join(", ")}.`);
    if (entities.length > 0) parts.push(`You can see: ${entities.join(", ")}.`);
    return parts.join("\n");
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const move = (playerId: string, direction: string, resolvers?: Resolvers<unknown, any>): WorldEvent[] | null => {
    const merged = resolvers ? { ...baseResolvers, ...resolvers } : baseResolvers;
    return init.world.move(playerId, direction, merged);
  };

  const logEvents = (events: WorldEvent[]): void => {
    const now = Date.now();
    for (const ev of events) timeline.push(ev, now);
  };

  return {
    world: init.world,
    actorPool: init.actorPool,
    timeline,
    scope,
    parseIntent: parseIntentFn,
    look,
    move,
    logEvents,
  };
}
