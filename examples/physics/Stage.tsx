/*
 * physics/Stage.tsx — throw-objects sandbox in Mara's atelier.
 *
 * Mechanic: an open studio room with three obstacles. The LLM can throw
 * an object by emitting `<throw>x,y,vx,vy</throw>`; the stage simulates
 * a bouncing AABB until it stops or leaves the room, returning the
 * trajectory + final position as observation data.
 *
 * Primitives: physics (AABB collision, SpatialHash, resolvePositional),
 * rng (cosmetic spin jitter), observation.
 * Philosophy: rule #5 (explicit tick loop), rule #4 (pure helpers).
 */

import { ReactElement } from "react";
import { StageBase, StageResponse, InitialData, Message } from "@chub-ai/stages-ts";
import { LoadResponse } from "@chub-ai/stages-ts/dist/types/load";
import { AABB, SpatialHash, aabbOverlap, resolvePositional } from "../../src/lib/physics";
import { Rng } from "../../src/lib/rng";
import { parseTags } from "../../src/lib/tag-parser";
import { emitStageDirections } from "../../src/lib/chub-adapters";
import { assembleObservations, ObservationSource } from "../../src/lib/observation";

interface MessageStateType {
  ticks: number; lastTraj?: TrajectoryStep[];
  rng?: { seed: string; streams: Record<string, [number, number, number, number]> };
}
type ChatStateType = null; type InitStateType = null; type ConfigType = null;

interface TrajectoryStep { x: number; y: number; bounced: boolean }

const ROOM: AABB = { x: 0, y: 0, w: 200, h: 120 };
const OBSTACLES: { name: string; aabb: AABB }[] = [
  { name: "workbench", aabb: { x: 60, y: 40, w: 80, h: 20 } },
  { name: "shelf", aabb: { x: 0, y: 90, w: 50, h: 12 } },
  { name: "pillar", aabb: { x: 170, y: 20, w: 12, h: 80 } },
];

export class PhysicsStage extends StageBase<InitStateType, ChatStateType, MessageStateType, ConfigType> {
  hash = new SpatialHash<{ name: string; aabb: AABB }>(32);
  rng = Rng.fromSeed("mara-studio");
  msg: MessageStateType = { ticks: 0 };
  lastResult?: { hit: string[]; final: AABB; steps: TrajectoryStep[] };

  constructor(data: InitialData<InitStateType, ChatStateType, MessageStateType, ConfigType>) {
    super(data);
    for (const o of OBSTACLES) this.hash.insert(o, o.aabb);
    if (data.messageState) this.msg = { ...this.msg, ...data.messageState };
  }

  async load(): Promise<Partial<LoadResponse<InitStateType, ChatStateType, MessageStateType>>> {
    return { success: true, error: null, initState: null, chatState: null };
  }
  async setState(state: MessageStateType): Promise<void> {
    if (!state) return;
    this.msg = { ...this.msg, ...state };
    // Restore RNG state so cosmetic jitter is replay-consistent after swipes.
    if (state.rng) this.rng = Rng.fromJSON(state.rng);
  }

  private simulate(x: number, y: number, vx: number, vy: number): { hit: string[]; final: AABB; steps: TrajectoryStep[] } {
    const proj: AABB = { x, y, w: 6, h: 6 };
    const steps: TrajectoryStep[] = [{ x: proj.x, y: proj.y, bounced: false }];
    const hit: string[] = [];
    const dt = 0.1;
    const friction = 0.92;
    for (let i = 0; i < 60; i++) {
      proj.x += vx * dt;
      proj.y += vy * dt;
      let bounced = false;
      // Walls
      if (proj.x < ROOM.x) { proj.x = ROOM.x; vx = -vx * 0.6; bounced = true; }
      if (proj.x + proj.w > ROOM.x + ROOM.w) { proj.x = ROOM.x + ROOM.w - proj.w; vx = -vx * 0.6; bounced = true; }
      if (proj.y < ROOM.y) { proj.y = ROOM.y; vy = -vy * 0.6; bounced = true; }
      if (proj.y + proj.h > ROOM.y + ROOM.h) { proj.y = ROOM.y + ROOM.h - proj.h; vy = -vy * 0.6; bounced = true; }
      // Obstacles via spatial hash
      const candidates = this.hash.query(proj);
      for (const c of candidates) {
        if (!aabbOverlap(proj, c.aabb)) continue;
        const adj = resolvePositional(proj, c.aabb);
        proj.x += adj.ax; proj.y += adj.ay;
        if (Math.abs(adj.ax) > Math.abs(adj.ay)) vx = -vx * 0.5; else vy = -vy * 0.5;
        // cosmetic jitter
        vx += this.rng.cosmetic.float() * 0.4 - 0.2;
        bounced = true;
        if (!hit.includes(c.name)) hit.push(c.name);
      }
      vx *= friction; vy *= friction;
      steps.push({ x: Number(proj.x.toFixed(2)), y: Number(proj.y.toFixed(2)), bounced });
      if (Math.abs(vx) < 0.5 && Math.abs(vy) < 0.5) break;
    }
    return { hit, final: { ...proj }, steps };
  }

  private observationSources(): ObservationSource<{ now: number }>[] {
    return [
      {
        id: "room",
        channels: ["visual"],
        salience: () => 0.5,
        habituationTau: 20,
        properties: { visual: { room: () => ROOM, obstacles: () => OBSTACLES } },
      },
      {
        id: "last-throw",
        channels: ["visual"],
        salience: () => (this.lastResult ? 0.9 : 0),
        habituationTau: 1,
        properties: {
          visual: {
            hit: () => this.lastResult?.hit ?? [],
            final: () => this.lastResult?.final,
            n_steps: () => this.lastResult?.steps.length ?? 0,
            ended_at: () => this.lastResult?.steps[this.lastResult.steps.length - 1],
          },
        },
      },
    ];
  }

  async beforePrompt(_userMessage: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    const now = ++this.msg.ticks;
    const observed = assembleObservations(this.observationSources(), { now }, { now, maxCount: 2 });
    const stageDirections = emitStageDirections({
      observations: observed,
      architectures: ["arrival_sequence", "fragment_cascade"],
      register: "wide-3rd-present",
      prefix:
        "Mara is the studio's keeper. The player throws objects in her atelier. To throw, " +
        "emit `<throw>x,y,vx,vy</throw>` (room is 200x120 wide; obstacles in the visual). " +
        "Narrate the throw using the `hit` list and `ended_at` position — do not invent " +
        "trajectories.",
    });
    this.msg.rng = this.rng.toJSON();
    return { stageDirections, messageState: this.msg };
  }

  async afterResponse(botMessage: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    const r = parseTags<Record<string, unknown>>(botMessage.content, { throw: { kind: "list" } });
    if (Array.isArray(r.parsed.throw) && r.parsed.throw.length === 4) {
      const [x, y, vx, vy] = (r.parsed.throw as string[]).map(Number);
      if ([x, y, vx, vy].every((n) => Number.isFinite(n))) {
        this.lastResult = this.simulate(x, y, vx, vy);
        this.msg.lastTraj = this.lastResult.steps;
      }
    }
    return { messageState: this.msg, modifiedMessage: r.stripped !== botMessage.content ? r.stripped : null };
  }

  render(): ReactElement {
    return (
      <div style={{ padding: 12, fontFamily: "ui-monospace, monospace", color: "#ddd", background: "#111" }}>
        <h3 style={{ marginTop: 0 }}>Atelier — tick {this.msg.ticks}</h3>
        <svg width={400} height={240} viewBox="0 0 200 120" style={{ background: "#222", border: "1px solid #444" }}>
          {OBSTACLES.map((o) => (
            <rect key={o.name} x={o.aabb.x} y={o.aabb.y} width={o.aabb.w} height={o.aabb.h} fill="#555" />
          ))}
          {this.lastResult?.steps.map((s, i) => (
            <circle key={i} cx={s.x + 3} cy={s.y + 3} r={s.bounced ? 1.5 : 0.8} fill={s.bounced ? "#fb8" : "#8fc"} />
          ))}
        </svg>
        <div style={{ marginTop: 8 }}>
          {this.lastResult ? <>hit: <b>{this.lastResult.hit.join(", ") || "—"}</b> · steps: {this.lastResult.steps.length}</> : <em>no throws yet</em>}
        </div>
      </div>
    );
  }
}
