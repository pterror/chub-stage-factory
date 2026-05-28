/*
 * patterns/slot-assignment.ts — "worker X assigned to room slot Y" composer.
 *
 * WHAT: `slotAssignmentPattern(init)` models the facility-management mechanic
 *       of assigning worker actors to room slots. Each slot is a room id +
 *       slot name pair; each slot may carry a `Predicate<S>` constraint that
 *       the candidate actor must satisfy before the assignment is accepted.
 *
 *         - `assign(actorId, roomId, slotName, state, refs)` — validates the
 *           constraint predicate (if any), then records the assignment.
 *           Returns `{ ok: true }` on success or `{ ok: false; reason }` on
 *           constraint failure. No world move is performed here — the caller
 *           decides whether to also `world.locate(actorId, roomId)`.
 *         - `unassign(actorId)` — remove actor from their current slot.
 *         - `slotFor(actorId)` — look up the slot an actor is assigned to.
 *         - `actorsAt(roomId, slotName?)` — actors in a room, optionally
 *           filtered by slot name.
 *         - `isSlotFull(roomId, slotName)` — true when capacity is reached.
 *           Capacity defaults to 1; the caller supplies it per-slot def.
 *
 *       Uses the world's room graph to validate that `roomId` is registered
 *       and can optionally call `world.locate` to co-locate the actor.
 *
 * WHY: Facility-management-shape (#20) requires: room-graph (world), worker
 *      actors, per-slot capacity, per-slot constraints (predicate). This
 *      composer collapses the boilerplate of the assignment ledger + constraint
 *      validation so the stage author writes the facility logic, not the
 *      data-structure plumbing.
 *
 *      Composes: actor (worker ids), predicate (per-slot constraint gate),
 *      world (rooms as the slot namespace).
 *
 * SHAPE:
 *   interface SlotDef<S> { roomId; slotName; capacity?; constraint?: Predicate<S> }
 *   type AssignmentKey = `${roomId}:${slotName}`
 *   interface SlotAssignmentInit<S>
 *     { world; slotDefs; resolvers? }
 *   interface AssignResult
 *     | { ok: true }
 *     | { ok: false; reason: "constraint-failed" | "slot-full" | "unknown-room" }
 *   interface SlotAssignmentBundle<S>
 *     { world; slotDefs;
 *       assign(actorId, roomId, slotName, state, refs): AssignResult;
 *       unassign(actorId): void;
 *       slotFor(actorId): { roomId; slotName } | null;
 *       actorsAt(roomId, slotName?): string[];
 *       isSlotFull(roomId, slotName): boolean; }
 *   function slotAssignmentPattern<S>(init): SlotAssignmentBundle<S>
 */

import { type Refs, type Resolvers, evaluate as evalPredicate } from "../../predicate";
import type { Predicate } from "../../predicate";
import { type World } from "../../world";

export interface SlotDef<S = unknown> {
  roomId: string;
  slotName: string;
  /** Max actors in this slot. Default 1. */
  capacity?: number;
  /** Optional gate predicate. Candidate actor is `refs.self`. */
  constraint?: Predicate<S>;
}

export type AssignResult =
  | { ok: true }
  | { ok: false; reason: "constraint-failed" | "slot-full" | "unknown-room" };

export interface SlotAssignmentInit<S = unknown> {
  world: World;
  slotDefs: readonly SlotDef<S>[];
  /** Resolvers forwarded to predicate evaluation for constraint checks. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolvers?: Resolvers<S, any>;
}

export interface SlotAssignmentBundle<S = unknown> {
  world: World;
  slotDefs: readonly SlotDef<S>[];
  /**
   * Attempt to assign `actorId` to `roomId:slotName`.
   * Validates: room exists, slot capacity not exceeded, constraint passes.
   * Does NOT call `world.locate` — the caller co-locates if desired.
   */
  assign(actorId: string, roomId: string, slotName: string, state: S, refs: Refs<string>): AssignResult;
  /** Remove `actorId` from their current slot (no-op if unassigned). */
  unassign(actorId: string): void;
  /** Return the slot `actorId` is currently in, or null. */
  slotFor(actorId: string): { roomId: string; slotName: string } | null;
  /**
   * Return actor ids assigned in `roomId`. When `slotName` is supplied,
   * returns only actors in that specific slot.
   */
  actorsAt(roomId: string, slotName?: string): string[];
  /** True when the slot has no remaining capacity. */
  isSlotFull(roomId: string, slotName: string): boolean;
}

export function slotAssignmentPattern<S = unknown>(
  init: SlotAssignmentInit<S>,
): SlotAssignmentBundle<S> {
  /** actor id → { roomId, slotName } */
  const assignments = new Map<string, { roomId: string; slotName: string }>();
  /** "roomId:slotName" → Set<actorId> */
  const slots = new Map<string, Set<string>>();

  const key = (roomId: string, slotName: string): string => `${roomId}:${slotName}`;

  const bucket = (roomId: string, slotName: string): Set<string> => {
    const k = key(roomId, slotName);
    let s = slots.get(k);
    if (!s) { s = new Set(); slots.set(k, s); }
    return s;
  };

  const defFor = (roomId: string, slotName: string): SlotDef<S> | undefined =>
    init.slotDefs.find((d) => d.roomId === roomId && d.slotName === slotName);

  const assign = (
    actorId: string,
    roomId: string,
    slotName: string,
    state: S,
    refs: Refs<string>,
  ): AssignResult => {
    if (!init.world.getRoom(roomId)) return { ok: false, reason: "unknown-room" };

    const def = defFor(roomId, slotName);
    const capacity = def?.capacity ?? 1;
    const slot = bucket(roomId, slotName);
    if (!slot.has(actorId) && slot.size >= capacity) return { ok: false, reason: "slot-full" };

    if (def?.constraint) {
      const actorRefs: Refs<string> = { ...refs, self: actorId };
      if (!evalPredicate(def.constraint, state, actorRefs, init.resolvers ?? {})) {
        return { ok: false, reason: "constraint-failed" };
      }
    }

    // Remove from previous slot if any.
    const prev = assignments.get(actorId);
    if (prev) bucket(prev.roomId, prev.slotName).delete(actorId);

    assignments.set(actorId, { roomId, slotName });
    slot.add(actorId);
    return { ok: true };
  };

  const unassign = (actorId: string): void => {
    const prev = assignments.get(actorId);
    if (!prev) return;
    bucket(prev.roomId, prev.slotName).delete(actorId);
    assignments.delete(actorId);
  };

  const slotFor = (actorId: string): { roomId: string; slotName: string } | null =>
    assignments.get(actorId) ?? null;

  const actorsAt = (roomId: string, slotName?: string): string[] => {
    if (slotName !== undefined) return [...bucket(roomId, slotName)];
    const out: string[] = [];
    for (const [k, s] of slots) {
      if (k.startsWith(`${roomId}:`)) out.push(...s);
    }
    return out;
  };

  const isSlotFull = (roomId: string, slotName: string): boolean => {
    const def = defFor(roomId, slotName);
    const capacity = def?.capacity ?? 1;
    return bucket(roomId, slotName).size >= capacity;
  };

  return {
    world: init.world,
    slotDefs: init.slotDefs,
    assign,
    unassign,
    slotFor,
    actorsAt,
    isSlotFull,
  };
}
