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
import type {
  StageIntrospect,
  VerbDescriptor,
  StageDescriptor,
  InvocationResult,
} from "../../src/lib/introspect";

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

export class PhysicsStage extends withPersistence<ChatStateType, InitStateType, MessageStateType, ConfigType>() implements StageIntrospect {
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

  /** Click-to-throw: routes through invokeVerb so the LLM narrates the throw
   *  and state is persisted via the normal lifecycle. */
  private handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * ROOM.w;
    const svgY = ((e.clientY - rect.top) / rect.height) * ROOM.h;
    void this.invokeVerb("throw", { x: svgX, y: svgY });
  };

  /* ---------------- StageIntrospect ----------------
   * availableVerbs / describe / invokeVerb — lets explore-stage.mjs and any
   * UX layer drive the stage without reaching into internals.
   * invokeVerb synthesises a Message and calls beforePrompt so LLM narration
   * and state persistence happen on every click-throw, not just LLM-emitted
   * <throw> tags.
   * ------------------------------------------------- */

  availableVerbs(): VerbDescriptor[] {
    return [
      {
        name: "throw",
        label: "Throw object",
        description: "Launch an object from the atelier centre toward the target point (x, y).",
        args: [
          { name: "x", type: "number", required: true, description: "Target X in room coordinates (0–200)." },
          { name: "y", type: "number", required: true, description: "Target Y in room coordinates (0–120)." },
        ],
        group: "action",
      },
    ];
  }

  describe(): StageDescriptor {
    const last = this.lastResult;
    const endpoint = last?.steps.at(-1);
    const hits = last?.hit ?? [];
    return {
      summary:
        `Mara's atelier (200×120). Tick ${this.tick.n}. ` +
        (last
          ? `Last throw: hit [${hits.join(", ") || "nothing"}]; ended at (${Math.round(endpoint?.x ?? 0)}, ${Math.round(endpoint?.y ?? 0)}).`
          : "No throw yet."),
      details: {
        tick: this.tick.n,
        lastHits: hits,
        lastEndpoint: endpoint ? { x: endpoint.x, y: endpoint.y } : null,
        obstacles: OBSTACLES.map((o) => o.name),
      },
      verbCount: 1,
    };
  }

  async invokeVerb(name: string, args?: Record<string, unknown>): Promise<InvocationResult> {
    if (name !== "throw") {
      return { ok: false, error: `unknown verb "${name}"` };
    }
    const x = typeof args?.x === "number" ? args.x : null;
    const y = typeof args?.y === "number" ? args.y : null;
    if (x === null || y === null) {
      return { ok: false, error: 'verb "throw" requires numeric args x and y' };
    }
    const cx = ROOM.w / 2, cy = ROOM.h / 2;
    const dx = x - cx, dy = y - cy;
    const speed = 80;
    const m = Math.hypot(dx, dy) || 1;
    const vx = (dx / m) * speed, vy = (dy / m) * speed;
    const msg: Message = {
      anonymizedId: "0",
      content: `throw ${Math.round(x)},${Math.round(y)},${Math.round(vx)},${Math.round(vy)}`,
      isBot: false,
      promptForId: "1",
      identity: "12345",
      isMain: true,
    };
    try {
      const resp = await this.beforePrompt(msg);
      return {
        ok: resp?.error == null,
        message: msg.content,
        error: resp?.error ?? undefined,
        messageState: resp?.messageState,
      };
    } catch (err) {
      const e = err as Error;
      return { ok: false, error: `beforePrompt threw: ${e.message}` };
    }
  }

  render(): ReactElement {
    const last = this.lastResult;
    const endpoint = last?.steps.at(-1);
    const hitList = last?.hit ?? [];

    return (
      <div style={{ padding: 12, fontFamily: "system-ui, sans-serif", color: "#e8e8e8", background: "#111", maxWidth: 440 }}>
        <h3 style={{ marginTop: 0, fontSize: "1rem", color: "#9ad", letterSpacing: "0.05em" }}>
          Mara&apos;s Atelier
        </h3>

        {/* Interactive throw canvas */}
        <div style={{ position: "relative", marginBottom: 8 }}>
          <svg
            width={400} height={240} viewBox={`0 0 ${ROOM.w} ${ROOM.h}`}
            style={{ background: "#1c1c24", border: "1px solid #444", borderRadius: 4, cursor: "crosshair", display: "block" }}
            onClick={this.handleSvgClick}
          >
            {/* Obstacles with labels */}
            {OBSTACLES.map((o) => (
              <g key={o.name}>
                <rect x={o.aabb.x} y={o.aabb.y} width={o.aabb.w} height={o.aabb.h} fill="#3a3a4a" stroke="#555" strokeWidth={0.5} />
                <text x={o.aabb.x + o.aabb.w / 2} y={o.aabb.y + o.aabb.h / 2 + 2} textAnchor="middle" fill="#777" fontSize={5}>{o.name}</text>
              </g>
            ))}
            {/* Trajectory */}
            {last?.steps.map((s, i) => (
              <circle key={i} cx={s.x + 3} cy={s.y + 3} r={s.bounced ? 2 : 1} fill={s.bounced ? "#fb8" : "#6bf"} opacity={0.7} />
            ))}
            {/* Landing spot */}
            {endpoint && (
              <circle cx={endpoint.x + 3} cy={endpoint.y + 3} r={3} fill="none" stroke="#fb8" strokeWidth={1} />
            )}
            {/* Throw origin */}
            <circle cx={ROOM.w / 2} cy={ROOM.h / 2} r={3} fill="#5af" opacity={0.6} />
          </svg>
          <div style={{ position: "absolute", bottom: 6, right: 8, color: "#555", fontSize: "0.7rem", pointerEvents: "none" }}>
            click to throw
          </div>
        </div>

        {/* Result summary */}
        {last ? (
          <div style={{ fontSize: "0.85rem", color: "#aaa" }}>
            {hitList.length > 0
              ? <span>Struck <b style={{ color: "#fb8" }}>{hitList.join(", ")}</b>{endpoint ? ` · came to rest at (${Math.round(endpoint.x)}, ${Math.round(endpoint.y)})` : ""}</span>
              : <span style={{ color: "#888" }}>Missed everything{endpoint ? ` · stopped at (${Math.round(endpoint.x)}, ${Math.round(endpoint.y)})` : ""}</span>
            }
          </div>
        ) : (
          <div style={{ fontSize: "0.85rem", color: "#555", fontStyle: "italic" }}>Click anywhere in the atelier to throw</div>
        )}
      </div>
    );
  }
}
