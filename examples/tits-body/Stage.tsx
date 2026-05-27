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
import { bodyTransformationPattern, type BodyTransformationBundle } from "../../src/lib/patterns/character/body-transformation";

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

    // Map raw tag strings to player-facing descriptions.
    const TAG_LABELS: Record<string, string> = {
      human: "human",
      "horned!none": "no horns",
      "hair-long": "long hair",
      "skin-soft": "soft skin",
      hands: "hands",
      feet: "feet",
      furred: "covered in fur",
      "prehensile-mild": "gently prehensile",
      "tail-cat": "cat tail",
      nub: "just a small nub",
      "stubby-tail": "a stubby tail",
      horned: "horned",
      "horns-dragon": "draconic horns",
      "scaled-trace": "faint scale markings",
      "horn-buds": "horn buds forming",
    };

    // Map slot ids to display names.
    const SLOT_LABELS: Record<string, string> = {
      head: "Head",
      torso: "Torso",
      arms: "Arms",
      legs: "Legs",
      tail: "Tail",
    };

    // Map active transformation ids to in-progress prose.
    const TF_PROGRESS: Record<string, (elapsed: number, duration: number | null | undefined) => string> = {
      cat_tail: (e, d) => {
        const f = d ? e / d : 0;
        if (f < 0.3) return "A small nub is growing at the base of your spine.";
        if (f < 0.7) return "A stubby, furred tail has emerged and is still lengthening.";
        return "A full cat tail sways behind you.";
      },
      dragon_horns: (e, d) => {
        const f = d ? e / d : 0;
        if (f < 0.5) return "Horn buds are pushing through your scalp.";
        return "Draconic horns have fully emerged, with faint scales at their base.";
      },
      fur_torso: () => "Soft fur is spreading across your torso.",
    };

    function describeSlot(slot: string): string {
      const tags = body.getEffectiveTags(slot).toArray();
      const labeled = tags
        .map((t) => TAG_LABELS[t])
        .filter((l): l is string => l !== undefined && l !== "human" && l !== "no horns" && l !== "soft skin" && l !== "hands" && l !== "feet");
      if (labeled.length === 0) return "Unchanged.";
      return labeled.join(", ");
    }

    const activeTfs = body.getTransformations();
    const hasSnapshots = snaps.list().filter((s) => s !== "baseline").length > 0;

    return (
      <div style={{ padding: 12, fontFamily: "sans-serif", color: "#ddd", background: "#1a1a1a", maxWidth: 480 }}>
        <h3 style={{ marginTop: 0, fontSize: "1rem", color: "#c9a9e8" }}>Your body</h3>

        {body.getSlots().map((slot) => {
          const desc = describeSlot(slot);
          const unchanged = desc === "Unchanged.";
          return (
            <div key={slot} style={{ marginBottom: 6 }}>
              <span style={{ fontSize: "0.75rem", color: "#888", textTransform: "uppercase", letterSpacing: "0.05em" }}>{SLOT_LABELS[slot] ?? slot}</span>
              <span style={{ marginLeft: 8, fontSize: "0.9rem", color: unchanged ? "#555" : "#ddd", fontStyle: unchanged ? "italic" : "normal" }}>{desc}</span>
            </div>
          );
        })}

        {activeTfs.length > 0 && (
          <>
            <h4 style={{ fontSize: "0.85rem", color: "#888", marginBottom: 4, marginTop: 12 }}>Changing now</h4>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {activeTfs.map((tf) => {
                const elapsed = now - tf.startTime;
                const progress = TF_PROGRESS[tf.id];
                const text = progress ? progress(elapsed, tf.duration) : `${tf.displayName ?? tf.id} — taking effect.`;
                return <li key={tf.id} style={{ fontSize: "0.85rem", color: "#bbb", marginBottom: 3 }}>{text}</li>;
              })}
            </ul>
          </>
        )}

        {hasSnapshots && (
          <div style={{ marginTop: 10, fontSize: "0.8rem", color: "#7a7" }}>
            You can ask Vey to restore your previous body.
          </div>
        )}
      </div>
    );
  }
}
