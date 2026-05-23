/*
 * tits-body/Stage.tsx — Vey the alchemist.
 *
 * Mechanic: the player can drink tinctures that alter the body slot-by-slot
 * over time. Trajectories ramp the visible effect (nub -> tail), and
 * snapshots let the player undo to a prior body-state. Surfaces the full
 * effective tag map to the LLM as an observation.
 *
 * Primitives: body, transformation, snapshots, persistence.
 * Philosophy: rule #4 (effective tags recomputed each read), rule #6
 * (trajectories are functions of elapsed, not counters).
 *
 * Persistence: body shard on chatState + forbidBranching. The body is
 * canon — swiping does NOT un-transform you. To undo, the player names a
 * snapshot via `<restore>baseline</restore>`, which is a deliberate
 * in-fiction act.
 */

import { ReactElement } from "react";
import { StageBase, StageResponse, InitialData, Message } from "@chub-ai/stages-ts";
import { LoadResponse } from "@chub-ai/stages-ts/dist/types/load";
import { Body } from "../../src/lib/body";
import { TransformationDef, apply, applyTrajectories, getConflicts } from "../../src/lib/transformation";
import { Snapshots } from "../../src/lib/snapshots";
import { parseTags } from "../../src/lib/tag-parser";
import { emitStageDirections } from "../../src/lib/chub-adapters";
import { assembleObservations, ObservationSource } from "../../src/lib/observation";
import {
  PersistenceStore, createChubLayers, chubTreeHistory, snapshotHistory, forbidBranching,
  bindStore, mergeResponses, shard,
} from "../../src/lib/persistence";

interface MessageStateType { ticks: number; lastApplied?: string; [k: string]: unknown }
interface ChatStateType { [k: string]: unknown }
type InitStateType = null;
type ConfigType = null;

const TFS: Record<string, TransformationDef> = {
  cat_tail: {
    id: "cat_tail", slot: "tail",
    addTags: ["furred", "prehensile-mild", "tail-cat"], removeTags: [],
    baseDuration: 6, requiresTags: [], conflictsWithTags: ["tail-dragon"],
    conflicts: { "tail-dragon": "block", "*": "stack" },
    trajectory: (f) => f < 0.3 ? { addTags: ["nub"], removeTags: [] }
      : f < 0.7 ? { addTags: ["stubby-tail", "furred"], removeTags: ["nub"] }
      : { addTags: ["furred", "prehensile-mild", "tail-cat"], removeTags: ["nub", "stubby-tail"] },
    displayName: "feline tail tincture",
  },
  dragon_horns: {
    id: "dragon_horns", slot: "head",
    addTags: ["horned", "horns-dragon", "scaled-trace"], removeTags: ["horned!none"],
    baseDuration: 4, requiresTags: [], conflictsWithTags: [],
    conflicts: {},
    trajectory: (f) => f < 0.5 ? { addTags: ["horn-buds"], removeTags: ["horned!none"] }
      : { addTags: ["horned", "horns-dragon", "scaled-trace"], removeTags: ["horn-buds", "horned!none"] },
    displayName: "draconic horn tincture",
  },
  fur_torso: {
    id: "fur_torso", slot: "torso",
    addTags: ["furred"], removeTags: ["skin-soft"],
    baseDuration: 5, conflicts: {},
    displayName: "torso pelt tincture",
  },
};

export class TitsBodyStage extends StageBase<InitStateType, ChatStateType, MessageStateType, ConfigType> {
  body: Body;
  snaps: Snapshots;
  tick = { n: 0, lastApplied: undefined as string | undefined };
  applied: { id: string; at: number }[] = [];
  layers = createChubLayers();
  store!: PersistenceStore;
  bound!: ReturnType<typeof bindStore<ChatStateType, MessageStateType>>;

  constructor(data: InitialData<InitStateType, ChatStateType, MessageStateType, ConfigType>) {
    super(data);
    this.body = new Body({
      head: ["human", "horned!none", "hair-long"],
      torso: ["human", "skin-soft"],
      arms: ["human", "hands", "skin-soft"],
      legs: ["human", "feet", "skin-soft"],
      tail: [],
    });
    this.snaps = new Snapshots(this.body);
    this.snaps.save("baseline");

    this.layers = createChubLayers({
      messageState: (data.messageState as Record<string, string | undefined> | null) ?? null,
      chatState: (data.chatState as Record<string, string | undefined> | null) ?? null,
    });
    this.store = new PersistenceStore({
      tick: shard("tick", this.tick,
        (i) => ({ n: i.n, lastApplied: i.lastApplied }),
        (d: { n: number; lastApplied?: string }) => ({ n: d.n, lastApplied: d.lastApplied }),
        this.layers.messageStateBackend, chubTreeHistory()),
      body: shard("body", this.body,
        (i) => i.toJSON(),
        (d: ReturnType<Body["toJSON"]>) => Body.fromJSON(d),
        this.layers.chatStateBackend, forbidBranching(snapshotHistory())),
      snaps: shard("snaps", this.snaps,
        (i) => i.toJSON(),
        (d: ReturnType<Snapshots["toJSON"]>) => Snapshots.fromJSON(d, this.body),
        this.layers.chatStateBackend, forbidBranching(snapshotHistory())),
    });
    this.bound = bindStore<ChatStateType, MessageStateType>(this.store, { layers: this.layers });
  }

  async load(): Promise<Partial<LoadResponse<InitStateType, ChatStateType, MessageStateType>>> {
    await this.store.load();
    const { chatState, messageState } = await this.bound.initial();
    return { success: true, error: null, initState: null, chatState, messageState };
  }

  async setState(state: MessageStateType): Promise<void> {
    await this.bound.setState(state);
  }

  private tryApply(id: string, now: number): { ok: boolean; reason?: string } {
    const def = TFS[id]; if (!def) return { ok: false, reason: "no-such-tf" };
    const confs = getConflicts(def, this.body);
    for (const c of confs) {
      if (c.incomingSays === "block" || c.existingSays === "block") return { ok: false, reason: `block:${c.existingId}` };
      if (c.incomingSays === "replace") this.body.removeTransformation(c.existingId);
    }
    const inst = apply(def, this.body, now);
    if (!inst) return { ok: false, reason: "canApply-failed" };
    this.applied.push({ id, at: now });
    return { ok: true };
  }

  private observationSources(now: number): ObservationSource<{ now: number }>[] {
    return [
      {
        id: "body-state", channels: ["interoceptive"],
        salience: () => Math.min(1, this.body.getTransformations().length / 3 + 0.3),
        habituationTau: 4,
        properties: { interoceptive: {
          slots: () => {
            const out: Record<string, string[]> = {};
            for (const [slot, tags] of this.body.getAllEffectiveTags()) out[slot] = tags.toArray();
            return out;
          },
          in_progress: () => this.body.getTransformations().map((tf) => ({
            id: tf.id, slot: tf.slot, elapsed: now - tf.startTime, duration: tf.duration, current_tags: tf.addTags,
          })),
        } },
      },
    ];
  }

  async beforePrompt(msg: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    this.tick.n += 1;
    const now = this.tick.n;
    applyTrajectories(this.body, now);
    this.body.tick(now);
    const observed = assembleObservations(this.observationSources(now), { now }, { now, maxCount: 2 });
    const stageDirections = emitStageDirections({
      observations: observed,
      architectures: ["body_then_world", "accumulation"],
      register: { pov: "close-second", tense: "present", distance: "close" },
      prefix:
        "Vey is the alchemist; the player is the subject of the tincture. To apply a tincture, " +
        "emit `<drink>cat_tail|dragon_horns|fur_torso</drink>`. To restore a baseline body, " +
        "emit `<restore>baseline</restore>`. The in_progress array shows partially-developed " +
        "TFs — render them as the gradual change they are.",
    });
    return mergeResponses({ stageDirections }, await this.bound.beforePrompt(msg));
  }

  async afterResponse(botMessage: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    const now = this.tick.n;
    const r1 = parseTags<Record<string, unknown>>(botMessage.content, { drink: { kind: "string", enum: Object.keys(TFS) } });
    const r2 = parseTags<Record<string, unknown>>(r1.stripped, { restore: { kind: "string" } });
    if (typeof r1.parsed.drink === "string" && r1.parsed.drink) {
      const res = this.tryApply(r1.parsed.drink as string, now);
      if (res.ok) this.tick.lastApplied = r1.parsed.drink as string;
    }
    if (typeof r2.parsed.restore === "string" && r2.parsed.restore) {
      this.snaps.restore(r2.parsed.restore as string);
      this.applied = [];
    }
    const stripped = r2.stripped !== botMessage.content ? r2.stripped : null;
    return mergeResponses({ modifiedMessage: stripped }, await this.bound.afterResponse(botMessage));
  }

  render(): ReactElement {
    const now = this.tick.n;
    return (
      <div style={{ padding: 12, fontFamily: "ui-monospace, monospace", color: "#ddd", background: "#111" }}>
        <h3 style={{ marginTop: 0 }}>Body — tick {now}</h3>
        <table style={{ borderCollapse: "collapse" }}>
          <tbody>
            {this.body.getSlots().map((s) => (
              <tr key={s}><td style={{ padding: "2px 8px", color: "#9ad" }}>{s}</td>
                <td style={{ padding: "2px 8px" }}>{this.body.getEffectiveTags(s).toArray().join(", ") || "—"}</td></tr>
            ))}
          </tbody>
        </table>
        <h4>Active transformations</h4>
        {this.body.getTransformations().length === 0 ? <em style={{ opacity: 0.5 }}>none</em> : (
          <ul>{this.body.getTransformations().map((tf) => (
            <li key={tf.id}><b>{tf.id}</b> on {tf.slot} — elapsed {now - tf.startTime}/{tf.duration ?? "∞"} — adding [{tf.addTags.join(", ")}]</li>
          ))}</ul>
        )}
        <div style={{ opacity: 0.7, fontSize: "0.85rem", marginTop: 8 }}>
          last applied: {this.tick.lastApplied ?? "—"} · snapshots: {this.snaps.list().join(", ") || "—"}
        </div>
      </div>
    );
  }
}
