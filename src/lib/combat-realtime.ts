/*
 * combat-realtime.ts — tick-based combat (projectiles, melee swings, AoEs).
 *
 * WHAT: Combatants have a position + velocity; Attacks are spawned with a
 *       lifetime, an owner, a hit-filter, and a list of effects. Each tick:
 *         1. integrate combatant positions
 *         2. rebuild spatial hash
 *         3. step each attack (move/expand), find candidate targets via
 *            spatial query, apply effects to those passing the hit filter
 *         4. age attacks; drop expired
 *       Returns RealtimeEvent[] for the stage to render or feed into prose.
 *
 * WHY: Rule #5 (`tick(dt)` returns events), rule #2 (Attacks are instances
 *       referencing a def), rule #7 (RNG-driven hit jitter goes through the
 *       mechanical stream).
 *
 * SHAPE:
 *   interface RealtimeCombatant { id; pos; vel; radius; team?; hp; tags? }
 *   interface AttackDef { id; shape: "circle" | "aabb" | "segment";
 *     duration; pierces?; effects: EffectDef[]; hitFilter?: (owner, target) => bool }
 *   interface Attack { id; def; owner; bounds; vel?; bornAt; hits: Set<id> }
 *   class RealtimeWorld
 *     constructor(cellSize=64)
 *     combatants: Map<id, RealtimeCombatant>
 *     attacks: Attack[]
 *     spawnAttack(def, owner, initial): Attack
 *     tick(dt, now): RealtimeEvent[]
 */

import { EffectDef } from "./effects";
import { AABB, Circle, Segment, SpatialHash, circleAabbOverlap, segmentAabb } from "./physics";

export interface RealtimeCombatant {
  id: string;
  pos: { x: number; y: number };
  vel: { x: number; y: number };
  radius: number;
  team?: string;
  hp: number;
  tags?: string[];
}

export interface AttackDef {
  id: string;
  shape: "circle" | "aabb" | "segment";
  duration: number;
  /** How many distinct combatants the attack can hit before expiring (default 1; 0 = unlimited). */
  pierces?: number;
  effects: EffectDef[];
  hitFilter?: (owner: RealtimeCombatant, target: RealtimeCombatant) => boolean;
  damage?: number;
}

export interface Attack {
  id: string;
  def: AttackDef;
  owner: string;
  bounds: { circle?: Circle; aabb?: AABB; segment?: Segment };
  vel?: { x: number; y: number };
  bornAt: number;
  hits: Set<string>;
}

export type RealtimeEvent =
  | { kind: "moved"; combatant: string; from: { x: number; y: number }; to: { x: number; y: number } }
  | { kind: "attack_spawned"; attackId: string; owner: string }
  | { kind: "attack_hit"; attackId: string; target: string; damage: number }
  | { kind: "attack_expired"; attackId: string }
  | { kind: "downed"; combatant: string };

export class RealtimeWorld {
  combatants: Map<string, RealtimeCombatant> = new Map();
  attacks: Attack[] = [];
  private _hash: SpatialHash<RealtimeCombatant>;
  private _attackSeq = 0;

  constructor(public cellSize = 64) {
    this._hash = new SpatialHash<RealtimeCombatant>(cellSize);
  }

  add(c: RealtimeCombatant): void {
    this.combatants.set(c.id, c);
  }

  spawnAttack(
    def: AttackDef,
    owner: string,
    initial: { bounds: Attack["bounds"]; vel?: { x: number; y: number } },
    now: number,
  ): Attack {
    const a: Attack = {
      id: `${def.id}#${++this._attackSeq}`,
      def,
      owner,
      bounds: initial.bounds,
      vel: initial.vel,
      bornAt: now,
      hits: new Set(),
    };
    this.attacks.push(a);
    return a;
  }

  tick(dt: number, now: number): RealtimeEvent[] {
    const events: RealtimeEvent[] = [];

    // 1. Integrate combatants.
    for (const c of this.combatants.values()) {
      const from = { x: c.pos.x, y: c.pos.y };
      c.pos.x += c.vel.x * dt;
      c.pos.y += c.vel.y * dt;
      if (from.x !== c.pos.x || from.y !== c.pos.y)
        events.push({ kind: "moved", combatant: c.id, from, to: { x: c.pos.x, y: c.pos.y } });
    }

    // 2. Rebuild spatial hash.
    this._hash.clear();
    for (const c of this.combatants.values()) {
      this._hash.insert(c, { x: c.pos.x - c.radius, y: c.pos.y - c.radius, w: c.radius * 2, h: c.radius * 2 });
    }

    // 3. Step attacks.
    const surviving: Attack[] = [];
    for (const a of this.attacks) {
      if (a.vel) {
        if (a.bounds.circle) {
          a.bounds.circle.x += a.vel.x * dt;
          a.bounds.circle.y += a.vel.y * dt;
        } else if (a.bounds.aabb) {
          a.bounds.aabb.x += a.vel.x * dt;
          a.bounds.aabb.y += a.vel.y * dt;
        } else if (a.bounds.segment) {
          a.bounds.segment.x1 += a.vel.x * dt;
          a.bounds.segment.x2 += a.vel.x * dt;
          a.bounds.segment.y1 += a.vel.y * dt;
          a.bounds.segment.y2 += a.vel.y * dt;
        }
      }
      const query = this._attackAabb(a);
      const candidates = this._hash.query(query);
      const owner = this.combatants.get(a.owner);
      let hitsLeft = a.def.pierces === 0 ? Infinity : a.def.pierces ?? 1;
      for (const target of candidates) {
        if (target.id === a.owner) continue;
        if (a.hits.has(target.id)) continue;
        if (!this._collides(a, target)) continue;
        if (owner && a.def.hitFilter && !a.def.hitFilter(owner, target)) continue;
        const damage = a.def.damage ?? 0;
        target.hp -= damage;
        a.hits.add(target.id);
        events.push({ kind: "attack_hit", attackId: a.id, target: target.id, damage });
        if (target.hp <= 0) events.push({ kind: "downed", combatant: target.id });
        hitsLeft -= 1;
        if (hitsLeft <= 0) break;
      }

      const age = now - a.bornAt;
      if (age >= a.def.duration || hitsLeft <= 0) events.push({ kind: "attack_expired", attackId: a.id });
      else surviving.push(a);
    }
    this.attacks = surviving;
    return events;
  }

  private _attackAabb(a: Attack): AABB {
    if (a.bounds.circle)
      return { x: a.bounds.circle.x - a.bounds.circle.r, y: a.bounds.circle.y - a.bounds.circle.r, w: a.bounds.circle.r * 2, h: a.bounds.circle.r * 2 };
    if (a.bounds.aabb) return { ...a.bounds.aabb };
    if (a.bounds.segment) {
      const s = a.bounds.segment;
      const x = Math.min(s.x1, s.x2);
      const y = Math.min(s.y1, s.y2);
      return { x, y, w: Math.abs(s.x2 - s.x1) || 1, h: Math.abs(s.y2 - s.y1) || 1 };
    }
    return { x: 0, y: 0, w: 0, h: 0 };
  }

  private _collides(a: Attack, target: RealtimeCombatant): boolean {
    const tBox: AABB = {
      x: target.pos.x - target.radius,
      y: target.pos.y - target.radius,
      w: target.radius * 2,
      h: target.radius * 2,
    };
    if (a.bounds.circle) return circleAabbOverlap(a.bounds.circle, tBox);
    if (a.bounds.aabb) {
      const b = a.bounds.aabb;
      return !(b.x + b.w <= tBox.x || tBox.x + tBox.w <= b.x || b.y + b.h <= tBox.y || tBox.y + tBox.h <= b.y);
    }
    if (a.bounds.segment) return segmentAabb(a.bounds.segment, tBox);
    return false;
  }
}
