/*
 * physics/Stage.tsx — throw-objects sandbox in Mara's atelier.
 *
 * Mechanic: an open studio room with three obstacles. The LLM can throw
 * an object by emitting `<throw>x,y,vx,vy</throw>`; the stage simulates
 * a bouncing AABB until it stops or leaves the room, returning the
 * trajectory + final position as observation data.
 *
 * Primitives: physics (AABB collision, SpatialHash, resolvePositional),
 * rng (cosmetic spin jitter), observation, persistence.
 * Philosophy: rule #5 (explicit tick loop), rule #4 (pure helpers).
 *
 * Persistence: rng on initState + noHistory (seed is immutable); tick +
 * lastTraj on messageState + chubTreeHistory (swiping really re-rolls
 * the throw, which is what you want for a physics sandbox).
 */

import { ReactElement } from "react";
import { StageBase, StageResponse, InitialData, Message } from "@chub-ai/stages-ts";
import { LoadResponse } from "@chub-ai/stages-ts/dist/types/load";
import { AABB, SpatialHash, aabbOverlap, resolvePositional } from "../../src/lib/physics";
import { Rng } from "../../src/lib/rng";
import { parseTags } from "../../src/lib/tag-parser";
import { emitStageDirections } from "../../src/lib/chub-adapters";
import { assembleObservations, ObservationSource } from "../../src/lib/observation";
import {
  PersistenceStore, createChubLayers, chubTreeHistory, noHistory,
  bindStore, mergeResponses, shard,
} from "../../src/lib/persistence";

interface TrajectoryStep { x: number; y: number; bounced: boolean }
interface MessageStateType { ticks: number; lastTraj?: TrajectoryStep[]; [k: string]: unknown }
type ChatStateType = null;
type InitStateType = { [k: string]: unknown };
type ConfigType = null;

const ROOM: AABB = { x: 0, y: 0, w: 200, h: 120 };
const OBSTACLES: { name: string; aabb: AABB }[] = [
  { name: "workbench", aabb: { x: 60, y: 40, w: 80, h: 20 } },
  { name: "shelf", aabb: { x: 0, y: 90, w: 50, h: 12 } },
  { name: "pillar", aabb: { x: 170, y: 20, w: 12, h: 80 } },
];

export class PhysicsStage extends StageBase<InitStateType, ChatStateType, MessageStateType, ConfigType> {
  hash = new SpatialHash<{ name: string; aabb: AABB }>(32);
  rng = Rng.fromSeed("mara-studio");
  tick = { n: 0, lastTraj: undefined as TrajectoryStep[] | undefined };
  lastResult?: { hit: string[]; final: AABB; steps: TrajectoryStep[] };
  layers = createChubLayers();
  store!: PersistenceStore;
  bound!: ReturnType<typeof bindStore<ChatStateType, MessageStateType>>;

  constructor(data: InitialData<InitStateType, ChatStateType, MessageStateType, ConfigType>) {
    super(data);
    for (const o of OBSTACLES) this.hash.insert(o, o.aabb);
    this.layers = createChubLayers({
      messageState: (data.messageState as Record<string, string | undefined> | null) ?? null,
      initState: (data.initState as Record<string, string | undefined> | null) ?? null,
    });
    this.store = new PersistenceStore({
      rng: shard("rng", this.rng,
        (i) => i.toJSON(),
        (d: ReturnType<Rng["toJSON"]>) => Rng.fromJSON(d),
        this.layers.initStateBackend, noHistory()),
      tick: shard("tick", this.tick,
        (i) => ({ n: i.n, lastTraj: i.lastTraj }),
        (d: { n: number; lastTraj?: TrajectoryStep[] }) => ({ n: d.n, lastTraj: d.lastTraj }),
        this.layers.messageStateBackend, chubTreeHistory()),
    });
    this.bound = bindStore<ChatStateType, MessageStateType>(this.store, { layers: this.layers });
  }

  async load(): Promise<Partial<LoadResponse<InitStateType, ChatStateType, MessageStateType>>> {
    await this.store.load();
    await this.bound.initial();
    return {
      success: true, error: null,
      initState: (this.layers.mirror.initState as InitStateType | null) ?? null,
      chatState: null,
      messageState: (this.layers.mirror.messageState as MessageStateType | null) ?? null,
    };
  }

  async setState(state: MessageStateType): Promise<void> {
    await this.bound.setState(state);
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
      if (proj.x < ROOM.x) { proj.x = ROOM.x; vx = -vx * 0.6; bounced = true; }
      if (proj.x + proj.w > ROOM.x + ROOM.w) { proj.x = ROOM.x + ROOM.w - proj.w; vx = -vx * 0.6; bounced = true; }
      if (proj.y < ROOM.y) { proj.y = ROOM.y; vy = -vy * 0.6; bounced = true; }
      if (proj.y + proj.h > ROOM.y + ROOM.h) { proj.y = ROOM.y + ROOM.h - proj.h; vy = -vy * 0.6; bounced = true; }
      const candidates = this.hash.query(proj);
      for (const c of candidates) {
        if (!aabbOverlap(proj, c.aabb)) continue;
        const adj = resolvePositional(proj, c.aabb);
        proj.x += adj.ax; proj.y += adj.ay;
        if (Math.abs(adj.ax) > Math.abs(adj.ay)) vx = -vx * 0.5; else vy = -vy * 0.5;
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
        id: "room", channels: ["visual"], salience: () => 0.5, habituationTau: 20,
        properties: { visual: {
          room: () => ({ w: ROOM.w, h: ROOM.h }),
          obstacles: () => OBSTACLES.map((o) => ({ name: o.name, ...o.aabb })),
        } },
      },
      {
        id: "last-throw", channels: ["visual"],
        salience: () => (this.lastResult ? 1 : 0), habituationTau: 0,
        properties: { visual: {
          hit: () => this.lastResult?.hit ?? [],
          ended_at: () => this.lastResult?.final ?? null,
          steps_count: () => this.lastResult?.steps.length ?? 0,
        } },
      },
    ];
  }

  async beforePrompt(msg: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    this.tick.n += 1;
    const observed = assembleObservations(this.observationSources(), { now: this.tick.n }, { now: this.tick.n, maxCount: 3 });
    const stageDirections = emitStageDirections({
      observations: observed,
      architectures: ["arrival_sequence", "fragment_cascade"],
      register: { pov: "third", tense: "present", distance: "wide" },
      prefix:
        "Mara is the studio's keeper. The player throws objects in her atelier. To throw, " +
        "emit `<throw>x,y,vx,vy</throw>` (room is 200x120 wide; obstacles in the visual). " +
        "Narrate the throw using the `hit` list and `ended_at` position — do not invent " +
        "trajectories.",
    });
    return mergeResponses({ stageDirections }, await this.bound.beforePrompt(msg));
  }

  async afterResponse(botMessage: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    const r = parseTags<Record<string, unknown>>(botMessage.content, { throw: { kind: "list" } });
    if (Array.isArray(r.parsed.throw) && r.parsed.throw.length === 4) {
      const [x, y, vx, vy] = (r.parsed.throw as string[]).map(Number);
      if ([x, y, vx, vy].every((n) => Number.isFinite(n))) {
        this.lastResult = this.simulate(x, y, vx, vy);
        this.tick.lastTraj = this.lastResult.steps;
      }
    }
    const stripped = r.stripped !== botMessage.content ? r.stripped : null;
    return mergeResponses({ modifiedMessage: stripped }, await this.bound.afterResponse(botMessage));
  }

  render(): ReactElement {
    return (
      <div style={{ padding: 12, fontFamily: "ui-monospace, monospace", color: "#ddd", background: "#111" }}>
        <h3 style={{ marginTop: 0 }}>Atelier — tick {this.tick.n}</h3>
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
