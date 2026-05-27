/*
 * tits-body/Stage.tsx — Vey the alchemist.
 *
 * Mechanic: the player can drink tinctures that alter the body slot-by-slot
 * over time. Trajectories ramp the visible effect (nub -> tail), and
 * snapshots let the player undo to a prior body-state. Surfaces the full
 * effective tag map to the LLM as an observation.
 *
 * Primitives: bodyTransformationPattern (composer).
 * Philosophy: rule #4 (effective tags recomputed each read), rule #6
 * (trajectories are functions of elapsed, not counters).
 *
 * Persistence: body shard on chatState + forbidBranching. The body is
 * canon — swiping does NOT un-transform you. To undo, the player names a
 * snapshot via `<restore>baseline</restore>`, which is a deliberate
 * in-fiction act.
 */

import { ReactElement } from "react";
import { StageResponse, InitialData, Message } from "@chub-ai/stages-ts";
import { Registry } from "../../src/lib/registry";
import { TransformationDef } from "../../src/lib/transformation";
import { withPersistence } from "../../src/lib/persistence";
import { bodyTransformationPattern, type BodyTransformationBundle } from "../../src/lib/patterns/body-transformation";

interface MessageStateType { ticks: number; lastApplied?: string; [k: string]: unknown }
interface ChatStateType { [k: string]: unknown }
type InitStateType = null;
type ConfigType = null;

const TFS = new Registry<TransformationDef>({
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
});

export class TitsBodyStage extends withPersistence<ChatStateType, InitStateType, MessageStateType, ConfigType>() {
  p!: BodyTransformationBundle;

  constructor(data: InitialData<InitStateType, ChatStateType, MessageStateType, ConfigType>) {
    super(data);
    const ms = (data.messageState as Record<string, string | undefined> | null) ?? null;
    const cs = (data.chatState as Record<string, string | undefined> | null) ?? null;

    this.p = bodyTransformationPattern({
      messageState: ms,
      chatState: cs,
      initialSlots: {
        head: ["human", "horned!none", "hair-long"],
        torso: ["human", "skin-soft"],
        arms: ["human", "hands", "skin-soft"],
        legs: ["human", "feet", "skin-soft"],
        tail: [],
      },
      baselineSnapshot: "baseline",
      tfs: TFS,
      stageDirections: {
        architectures: ["body_then_world", "accumulation"],
        register: { pov: "close-second", tense: "present", distance: "close" },
        prefix:
          "Vey is the alchemist; the player is the subject of the tincture. To apply a tincture, " +
          "emit `<drink>cat_tail|dragon_horns|fur_torso</drink>`. To restore a baseline body, " +
          "emit `<restore>baseline</restore>`. The in_progress array shows partially-developed " +
          "TFs — render them as the gradual change they are.",
      },
    });
    this.layers = this.p.layers;
    this.initStore(() => this.p.store);
  }

  async beforePrompt(msg: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    return this.p.buildBeforePrompt(msg, this.bound) as Promise<Partial<StageResponse<ChatStateType, MessageStateType>>>;
  }

  async afterResponse(msg: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    return this.p.buildAfterResponse(msg, this.bound) as Promise<Partial<StageResponse<ChatStateType, MessageStateType>>>;
  }

  render(): ReactElement {
    const { body, tick, snaps } = this.p;
    const now = tick.n;
    return (
      <div style={{ padding: 12, fontFamily: "ui-monospace, monospace", color: "#ddd", background: "#111" }}>
        <h3 style={{ marginTop: 0 }}>Body — tick {now}</h3>
        <table style={{ borderCollapse: "collapse" }}>
          <tbody>
            {body.getSlots().map((s) => (
              <tr key={s}><td style={{ padding: "2px 8px", color: "#9ad" }}>{s}</td>
                <td style={{ padding: "2px 8px" }}>{body.getEffectiveTags(s).toArray().join(", ") || "—"}</td></tr>
            ))}
          </tbody>
        </table>
        <h4>Active transformations</h4>
        {body.getTransformations().length === 0 ? <em style={{ opacity: 0.5 }}>none</em> : (
          <ul>{body.getTransformations().map((tf) => (
            <li key={tf.id}><b>{tf.id}</b> on {tf.slot} — elapsed {now - tf.startTime}/{tf.duration ?? "∞"} — adding [{tf.addTags.join(", ")}]</li>
          ))}</ul>
        )}
        <div style={{ opacity: 0.7, fontSize: "0.85rem", marginTop: 8 }}>
          last applied: {tick.lastApplied ?? "—"} · snapshots: {snaps.list().join(", ") || "—"}
        </div>
      </div>
    );
  }
}
