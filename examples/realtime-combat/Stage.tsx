/*
 * realtime-combat/Stage.tsx — arena drone fight.
 *
 * Mechanic: a small bounded arena. The player is at the centre; a swarm of
 * drones spirals in. The LLM emits `<shoot>dx,dy</shoot>` to fire a
 * projectile in a direction (normalised); the stage runs N physics ticks
 * between messages and returns the resulting events.
 *
 * Primitives: combat-realtime (RealtimeWorld + AttackDef), physics (under
 * the hood), rng (cosmetic spread), scheduler (could orchestrate waves —
 * stubbed to "spawn one per turn").
 * Philosophy: rule #5 (tick(dt) returns events), rule #2 (Attacks are
 * instances of AttackDefs).
 */

import { ReactElement } from "react";
import { StageBase, StageResponse, InitialData, Message } from "@chub-ai/stages-ts";
import { LoadResponse } from "@chub-ai/stages-ts/dist/types/load";
import { RealtimeWorld, AttackDef, RealtimeEvent, RealtimeCombatant } from "../../src/lib/combat-realtime";
import { Rng } from "../../src/lib/rng";
import { parseTags } from "../../src/lib/tag-parser";
import { emitStageDirections } from "../../src/lib/chub-adapters";
import { assembleObservations, ObservationSource } from "../../src/lib/observation";

interface MessageStateType {
  ticks: number; hp: number;
  combatants?: Array<Omit<RealtimeCombatant, 'vel'> & { vel: { x: number; y: number } }>;
  rng?: { seed: string; streams: Record<string, [number, number, number, number]> };
}
type ChatStateType = null; type InitStateType = null; type ConfigType = null;

const BULLET: AttackDef = {
  id: "bullet", shape: "circle", duration: 1.5, pierces: 1, damage: 6, effects: [],
  hitFilter: (owner, target) => target.team !== owner.team,
};

const ARENA = { w: 240, h: 160 };
const ARENA_BOUNDS = { minX: 0, maxX: ARENA.w, minY: 0, maxY: ARENA.h };

export class RealtimeCombatStage extends StageBase<InitStateType, ChatStateType, MessageStateType, ConfigType> {
  world = new RealtimeWorld(48, ARENA_BOUNDS);
  rng = Rng.fromSeed("arena");
  msg: MessageStateType = { ticks: 0, hp: 30 };
  events: RealtimeEvent[] = [];

  constructor(data: InitialData<InitStateType, ChatStateType, MessageStateType, ConfigType>) {
    super(data);
    if (data.messageState) this.msg = { ...this.msg, ...data.messageState };
    this.world.add({ id: "you", pos: { x: ARENA.w / 2, y: ARENA.h / 2 }, vel: { x: 0, y: 0 }, radius: 6, team: "p", hp: this.msg.hp });
    for (let i = 0; i < 3; i++) this.spawnDrone(i);
  }

  private spawnDrone(i: number) {
    const angle = (i / 3) * Math.PI * 2;
    const r = 90;
    const cx = ARENA.w / 2, cy = ARENA.h / 2;
    const px = cx + Math.cos(angle) * r;
    const py = cy + Math.sin(angle) * r;
    this.world.add({
      id: `drone-${i}-${this.rng.cosmetic.next()}`,
      pos: { x: px, y: py },
      vel: { x: (cx - px) * 0.2, y: (cy - py) * 0.2 },
      radius: 4, team: "e", hp: 4,
    });
  }

  async load(): Promise<Partial<LoadResponse<InitStateType, ChatStateType, MessageStateType>>> {
    return { success: true, error: null, initState: null, chatState: null };
  }
  async setState(state: MessageStateType): Promise<void> {
    if (!state) return;
    this.msg = { ...this.msg, ...state };
    // Restore combatant positions and RNG for swipe-safety.
    if (state.combatants) {
      this.world = new RealtimeWorld(48, ARENA_BOUNDS);
      for (const c of state.combatants) this.world.add({ ...c });
    }
    if (state.rng) this.rng = Rng.fromJSON(state.rng);
  }

  private observationSources(): ObservationSource<{ now: number }>[] {
    return [
      {
        id: "world",
        channels: ["visual"],
        salience: () => 1,
        habituationTau: 0,
        properties: {
          visual: {
            combatants: () => [...this.world.combatants.values()].map((c) => ({
              id: c.id, team: c.team, hp: c.hp,
              pos: { x: Math.round(c.pos.x), y: Math.round(c.pos.y) },
            })),
            attacks: () => this.world.attacks.length,
          },
        },
      },
      {
        id: "events",
        channels: ["auditory"],
        salience: () => Math.min(1, this.events.length / 6),
        habituationTau: 1,
        properties: { auditory: { last: () => this.events.slice(-15) } },
      },
    ];
  }

  private shoot(dx: number, dy: number, now: number) {
    const you = this.world.combatants.get("you"); if (!you) return;
    const m = Math.hypot(dx, dy) || 1;
    const nx = dx / m, ny = dy / m;
    this.world.spawnAttack(BULLET, "you", {
      bounds: { circle: { x: you.pos.x, y: you.pos.y, r: 3 } },
      vel: { x: nx * 220, y: ny * 220 },
    }, now);
  }

  async beforePrompt(_userMessage: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    const now = ++this.msg.ticks;
    const observed = assembleObservations(this.observationSources(), { now }, { now, maxCount: 3 });
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
    this.msg.combatants = [...this.world.combatants.values()].map((c) => ({ ...c, pos: { ...c.pos }, vel: { ...c.vel } }));
    this.msg.rng = this.rng.toJSON();
    return { stageDirections, messageState: this.msg };
  }

  async afterResponse(botMessage: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    const now = this.msg.ticks;
    const r = parseTags<Record<string, unknown>>(botMessage.content, { shoot: { kind: "list" } });
    if (Array.isArray(r.parsed.shoot) && r.parsed.shoot.length === 2) {
      const [dx, dy] = (r.parsed.shoot as string[]).map(Number);
      if (Number.isFinite(dx) && Number.isFinite(dy)) this.shoot(dx, dy, now);
    }
    // Simulate ~0.5s in 5 ticks; out-of-bounds attacks are auto-culled by RealtimeWorld.
    this.events = [];
    for (let i = 0; i < 5; i++) this.events.push(...this.world.tick(0.1, now + i * 0.1));
    // out-of-bounds events are included in this.events; stage surfaces them to LLM via observations.
    // Spawn another drone every 3 turns
    if (now % 3 === 0) this.spawnDrone(now);
    const you = this.world.combatants.get("you");
    if (you) this.msg.hp = you.hp;
    return { messageState: this.msg, modifiedMessage: r.stripped !== botMessage.content ? r.stripped : null };
  }

  render(): ReactElement {
    return (
      <div style={{ padding: 12, fontFamily: "ui-monospace, monospace", color: "#ddd", background: "#111" }}>
        <h3 style={{ marginTop: 0 }}>Arena — tick {this.msg.ticks} — HP {this.msg.hp}</h3>
        <svg width={480} height={320} viewBox={`0 0 ${ARENA.w} ${ARENA.h}`} style={{ background: "#1a1a22", border: "1px solid #444" }}>
          {[...this.world.combatants.values()].map((c) => (
            <circle key={c.id} cx={c.pos.x} cy={c.pos.y} r={c.radius} fill={c.team === "p" ? "#7df" : c.hp > 0 ? "#f77" : "#444"} />
          ))}
          {this.world.attacks.map((a) => a.bounds.circle && (
            <circle key={a.id} cx={a.bounds.circle.x} cy={a.bounds.circle.y} r={a.bounds.circle.r} fill="#ff8" />
          ))}
        </svg>
        <pre style={{ background: "#000", padding: 8, marginTop: 8, maxHeight: 160, overflow: "auto" }}>
{this.events.map((e) => JSON.stringify(e)).join("\n") || "—"}
        </pre>
      </div>
    );
  }
}
