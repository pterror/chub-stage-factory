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
import { StageResponse, InitialData, Message } from "@chub-ai/stages-ts";
import { type AABB } from "../../src/lib/physics";
import { Rng } from "../../src/lib/rng";
import { physicsPattern, type PhysicsSimResult, type TrajectoryStep } from "../../src/lib/patterns/physics";
import { parseTags } from "../../src/lib/tag-parser";
import { emitStageDirections } from "../../src/lib/chub-adapters";
import { assembleObservations } from "../../src/lib/observation";
import {
  PersistenceStore, createChubLayers, chubTreeHistory, noHistory,
  mergeResponses, shard, shardOf, withPersistence,
} from "../../src/lib/persistence";

interface MessageStateType { ticks: number; lastTraj?: TrajectoryStep[]; [k: string]: unknown }
type ChatStateType = null;
type InitStateType = { [k: string]: unknown };
type ConfigType = null;

const ROOM: AABB = { x: 0, y: 0, w: 200, h: 120 };
const OBSTACLES = [
  { name: "workbench", aabb: { x: 60, y: 40, w: 80, h: 20 } },
  { name: "shelf",     aabb: { x: 0,  y: 90, w: 50, h: 12 } },
  { name: "pillar",    aabb: { x: 170, y: 20, w: 12, h: 80 } },
];

export class PhysicsStage extends withPersistence<ChatStateType, InitStateType, MessageStateType, ConfigType>() {
  phys = physicsPattern({ room: ROOM, obstacles: OBSTACLES, rngSeed: "mara-studio" });
  tick = { n: 0, lastTraj: undefined as TrajectoryStep[] | undefined };
  lastResult?: PhysicsSimResult;
  layers = createChubLayers();

  constructor(data: InitialData<InitStateType, ChatStateType, MessageStateType, ConfigType>) {
    super(data);
    this.layers = createChubLayers({
      messageState: (data.messageState as Record<string, string | undefined> | null) ?? null,
      initState: (data.initState as Record<string, string | undefined> | null) ?? null,
    });
    this.initStore(() => new PersistenceStore({
      rng: shardOf("rng", this.phys.rng, (d) => Rng.fromJSON(d), this.layers.initStateBackend, noHistory()),
      tick: shard("tick", this.tick,
        (i) => ({ n: i.n, lastTraj: i.lastTraj }),
        (d: { n: number; lastTraj?: TrajectoryStep[] }) => ({ n: d.n, lastTraj: d.lastTraj }),
        this.layers.messageStateBackend, chubTreeHistory()),
    }));
  }

  async beforePrompt(msg: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    this.tick.n += 1;
    const observed = assembleObservations(
      this.phys.observationSources(this.lastResult),
      { now: this.tick.n }, { now: this.tick.n, maxCount: 3 },
    );
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
        this.lastResult = this.phys.simulate(x, y, vx, vy);
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
