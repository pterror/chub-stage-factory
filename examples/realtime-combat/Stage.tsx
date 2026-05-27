/*
 * realtime-combat/Stage.tsx — arena drone fight.
 *
 * Mechanic: a small bounded arena. The player is at the centre; a swarm of
 * drones spirals in. The LLM emits `<shoot>dx,dy</shoot>` to fire a
 * projectile in a direction (normalised); the stage runs N physics ticks
 * between messages and returns the resulting events.
 *
 * Primitives: combat-realtime (RealtimeWorld + AttackDef), physics (under
 * the hood), rng (cosmetic spread), persistence.
 * Philosophy: rule #5 (tick(dt) returns events), rule #2 (Attacks are
 * instances of AttackDefs).
 *
 * Persistence: world (combatants only) + tick on messageState +
 * chubTreeHistory — swiping re-rolls one beat of arena combat. rng on
 * initState + noHistory. (RealtimeWorld has no built-in toJSON; we
 * serialize combatants inline as the only mutable state worth keeping.)
 */

import { ReactElement } from "react";
import { StageResponse, InitialData, Message } from "@chub-ai/stages-ts";
import { AttackDef, RealtimeWorld, type RealtimeEvent } from "../../src/lib/combat-realtime";
import { Rng } from "../../src/lib/rng";
import { realtimeCombatPattern } from "../../src/lib/patterns/realtime-combat";
import { parseTags } from "../../src/lib/tag-parser";
import { emitStageDirections } from "../../src/lib/chub-adapters";
import { assembleObservations } from "../../src/lib/observation";
import {
  PersistenceStore, createChubLayers, chubTreeHistory, noHistory,
  mergeResponses, shardOf, shard, withPersistence,
} from "../../src/lib/persistence";

interface MessageStateType { ticks: number; hp: number; [k: string]: unknown }
type ChatStateType = null;
type InitStateType = { [k: string]: unknown };
type ConfigType = null;

const BULLET: AttackDef = {
  id: "bullet", shape: "circle", duration: 1.5, pierces: 1, damage: 6, effects: [],
  hitFilter: (owner, target) => target.team !== owner.team,
};

const ARENA = { w: 240, h: 160 };
const ARENA_BOUNDS = { minX: 0, maxX: ARENA.w, minY: 0, maxY: ARENA.h };

export class RealtimeCombatStage extends withPersistence<ChatStateType, InitStateType, MessageStateType, ConfigType>() {
  combat = realtimeCombatPattern({ seed: 48, bounds: ARENA_BOUNDS, rngSeed: "arena" });
  tick = { n: 0, hp: 30 };
  layers = createChubLayers();

  constructor(data: InitialData<InitStateType, ChatStateType, MessageStateType, ConfigType>) {
    super(data);
    this.combat.world.add({ id: "you", pos: { x: ARENA.w / 2, y: ARENA.h / 2 }, vel: { x: 0, y: 0 }, radius: 6, team: "p", hp: this.tick.hp });
    for (let i = 0; i < 3; i++) this.spawnDrone(i);

    this.layers = createChubLayers({
      messageState: (data.messageState as Record<string, string | undefined> | null) ?? null,
      initState: (data.initState as Record<string, string | undefined> | null) ?? null,
    });
    this.initStore(() => new PersistenceStore({
      rng: shardOf("rng", this.combat.rng, (d) => Rng.fromJSON(d), this.layers.initStateBackend, noHistory()),
      tick: shard("tick", this.tick,
        (i) => ({ n: i.n, hp: i.hp }),
        (d: { n: number; hp: number }) => ({ n: d.n, hp: d.hp }),
        this.layers.messageStateBackend, chubTreeHistory()),
      world: shard("world", this.combat.world,
        (w) => w.toJSON(),
        (d: ReturnType<RealtimeWorld["toJSON"]>) => {
          const fresh = RealtimeWorld.fromJSON(d);
          this.combat.world.combatants.clear();
          for (const [id, c] of fresh.combatants) this.combat.world.combatants.set(id, c);
          return this.combat.world;
        },
        this.layers.messageStateBackend, chubTreeHistory()),
    }));
  }

  private spawnDrone(i: number) {
    const angle = (i / 3) * Math.PI * 2;
    const r = 90;
    const cx = ARENA.w / 2, cy = ARENA.h / 2;
    const px = cx + Math.cos(angle) * r;
    const py = cy + Math.sin(angle) * r;
    this.combat.world.add({
      id: `drone-${i}-${this.combat.rng.cosmetic.next()}`,
      pos: { x: px, y: py }, vel: { x: (cx - px) * 0.2, y: (cy - py) * 0.2 },
      radius: 4, team: "e", hp: 4,
    });
  }

  private shoot(dx: number, dy: number, now: number) {
    const you = this.combat.world.combatants.get("you"); if (!you) return;
    const m = Math.hypot(dx, dy) || 1;
    const nx = dx / m, ny = dy / m;
    this.combat.spawnAttack(BULLET, "you", {
      bounds: { circle: { x: you.pos.x, y: you.pos.y, r: 3 } },
      vel: { x: nx * 220, y: ny * 220 },
    }, now);
  }

  async beforePrompt(msg: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    this.tick.n += 1;
    const observed = assembleObservations(
      [...this.combat.observationSources(), this.combat.events],
      { now: this.tick.n }, { now: this.tick.n, maxCount: 3 },
    );
    const stageDirections = emitStageDirections({
      observations: observed,
      architectures: ["fragment_cascade", "terminal_sense_shift"],
      register: { pov: "close-second", tense: "present", distance: "close" },
      prefix:
        "An arena (240×160). Drones circle, closing. To fire a bullet from your position, emit " +
        "`<shoot>dx,dy</shoot>` (direction; will be normalised). Render the auditory events " +
        "as the prose; don't invent hits the events don't show. " +
        "An `out-of-bounds` event means the projectile left the arena — narrate it as a miss.",
    });
    return mergeResponses({ stageDirections }, await this.bound.beforePrompt(msg));
  }

  async afterResponse(botMessage: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    const now = this.tick.n;
    const r = parseTags<Record<string, unknown>>(botMessage.content, { shoot: { kind: "list" } });
    if (Array.isArray(r.parsed.shoot) && r.parsed.shoot.length === 2) {
      const [dx, dy] = (r.parsed.shoot as string[]).map(Number);
      if (Number.isFinite(dx) && Number.isFinite(dy)) this.shoot(dx, dy, now);
    }
    this.combat.events.clear();
    for (let i = 0; i < 5; i++) {
      this.combat.tick(0.1, now + i * 0.1);
    }
    if (now % 3 === 0) this.spawnDrone(now);
    const you = this.combat.world.combatants.get("you");
    if (you) this.tick.hp = you.hp;
    const stripped = r.stripped !== botMessage.content ? r.stripped : null;
    return mergeResponses({ modifiedMessage: stripped }, await this.bound.afterResponse(botMessage));
  }

  /** Click-to-shoot: player clicks a point in the arena SVG; we fire from
   *  the player combatant toward that point. Routes through the existing
   *  shoot() helper so the physics path is identical to LLM <shoot> tags.
   *
   *  Primitive gap: this bypasses beforePrompt/afterResponse — the shot fires
   *  but the LLM is not prompted to narrate it. A StageIntrospect
   *  invokeVerb("shoot", {dx,dy}) path would close this gap.
   */
  private handleArenaClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const clickX = ((e.clientX - rect.left) / rect.width) * ARENA.w;
    const clickY = ((e.clientY - rect.top) / rect.height) * ARENA.h;
    const you = this.combat.world.combatants.get("you");
    if (!you) return;
    const dx = clickX - you.pos.x;
    const dy = clickY - you.pos.y;
    this.shoot(dx, dy, this.tick.n);
  };

  private renderEventLine(e: RealtimeEvent): string | null {
    switch (e.kind) {
      case "attack_hit":    return `Hit! ${e.target} takes ${e.damage} dmg`;
      case "downed":        return e.combatant === "you" ? "You go down." : "Drone destroyed.";
      case "out-of-bounds": return "Shot flies wide.";
      case "attack_spawned": return "Fired.";
      default: return null;
    }
  }

  render(): ReactElement {
    const you = this.combat.world.combatants.get("you");
    const drones = [...this.combat.world.combatants.values()].filter((c) => c.team === "e" && c.hp > 0);
    const recentEvents = this.combat.events.all().slice(-6)
      .map(({ payload }) => this.renderEventLine(payload))
      .filter((l): l is string => l !== null);

    return (
      <div style={{ padding: 12, fontFamily: "system-ui, sans-serif", color: "#e8e8e8", background: "#111", maxWidth: 520 }}>
        {/* Header — HP bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
          <span style={{ fontSize: "0.9rem", color: "#9ad", fontWeight: 600 }}>Arena</span>
          <div style={{ flex: 1, height: 6, background: "#333", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.max(0, (this.tick.hp / 30) * 100)}%`, background: this.tick.hp > 15 ? "#5c9" : this.tick.hp > 8 ? "#da7" : "#d44", transition: "width 0.2s" }} />
          </div>
          <span style={{ fontSize: "0.8rem", color: this.tick.hp > 15 ? "#7c9" : "#e77", minWidth: 50 }}>HP {this.tick.hp}/30</span>
          <span style={{ fontSize: "0.75rem", color: "#555" }}>{drones.length} drone{drones.length !== 1 ? "s" : ""}</span>
        </div>

        {/* Interactive arena */}
        <div style={{ position: "relative", marginBottom: 8 }}>
          <svg
            width={480} height={320} viewBox={`0 0 ${ARENA.w} ${ARENA.h}`}
            style={{ background: "#0e0e16", border: "1px solid #333", borderRadius: 4, cursor: "crosshair", display: "block" }}
            onClick={this.handleArenaClick}
          >
            <rect x={1} y={1} width={ARENA.w - 2} height={ARENA.h - 2} fill="none" stroke="#223" strokeWidth={2} />
            {[...this.combat.world.combatants.values()].map((c) =>
              c.team === "e" ? (
                <g key={c.id}>
                  <circle cx={c.pos.x} cy={c.pos.y} r={c.radius + 3} fill="none" stroke={c.hp > 0 ? "#f774" : "#0000"} strokeWidth={1} />
                  <circle cx={c.pos.x} cy={c.pos.y} r={c.radius} fill={c.hp > 0 ? "#c44" : "#2a2"} />
                </g>
              ) : (
                <g key={c.id}>
                  <circle cx={c.pos.x} cy={c.pos.y} r={c.radius + 4} fill="none" stroke="#5af4" strokeWidth={1} />
                  <circle cx={c.pos.x} cy={c.pos.y} r={c.radius} fill="#4af" />
                </g>
              )
            )}
            {this.combat.world.attacks.map((a) => a.bounds.circle && (
              <circle key={a.id} cx={a.bounds.circle.x} cy={a.bounds.circle.y} r={a.bounds.circle.r} fill="#ff8" opacity={0.9} />
            ))}
            {you && (
              <text x={you.pos.x} y={you.pos.y - 10} textAnchor="middle" fill="#7af" fontSize={6}>you</text>
            )}
          </svg>
          <div style={{ position: "absolute", bottom: 6, right: 8, color: "#444", fontSize: "0.7rem", pointerEvents: "none" }}>
            click to shoot
          </div>
        </div>

        {/* Event feed — prose not JSON */}
        {recentEvents.length > 0 && (
          <div style={{ background: "#0a0a0a", border: "1px solid #222", borderRadius: 4, padding: "6px 10px", fontSize: "0.8rem", color: "#bbb", maxHeight: 90, overflowY: "auto" }}>
            {recentEvents.map((line, i) => <div key={i}>{line}</div>)}
          </div>
        )}
      </div>
    );
  }
}
