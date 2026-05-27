/*
 * effects/Stage.tsx — Klio the apothecary.
 *
 * Mechanic: a brewing bench. The player asks for a tincture; the LLM names
 * an effect (via [[apply:id]] tags); the stage applies it to "the player"
 * with the right stacking policy and trajectory. `tick` per turn drains
 * expired effects.
 *
 * Primitives: effectsPattern (composer).
 * Philosophy: rule #3 (effects.tick returns the expired set; the stage
 * decides what to do with it), rule #6 (elapsed = now - startTime).
 *
 * Persistence: store shard on messageState + chubTreeHistory — effects
 * are per-branch so a swipe really does explore an alternate brew.
 */

import { ReactElement } from "react";
import { StageResponse, InitialData, Message } from "@chub-ai/stages-ts";
import { EffectDef } from "../../src/lib/effects";
import { Registry } from "../../src/lib/registry";
import { summarize } from "../../src/lib/timeline";
import { withPersistence } from "../../src/lib/persistence";
import { effectsPattern, type EffectsBundle } from "../../src/lib/patterns/effects";

interface MessageStateType { ticks: number; [k: string]: unknown }
type ChatStateType = null;
type InitStateType = null;
type ConfigType = null;

const TINCTURES = new Registry<EffectDef>({
  adrenaline: {
    id: "adrenaline", stacking: "extend", duration: 6,
    targets: { stats: ["dodge", "damage"], tags: ["focus"] },
    baseMagnitudes: { stats: { dodge: 0.2, damage: 1 }, tagsAdd: ["focus"] },
    trajectory: (f) => f > 0.7 ? { stats: { dodge: -0.1, damage: 0 } } : {},
    dispelTags: ["calm"],
  },
  fireward: {
    id: "fireward", stacking: "highest", duration: 10,
    targets: { stats: ["resist_fire"] },
    baseMagnitudes: { stats: { resist_fire: 0.5 } },
    trajectory: (f) => ({ stats: { resist_fire: 0.5 * (1 - f * 0.5) } }),
  },
  nightroot: {
    id: "nightroot", stacking: "stack", duration: 8,
    targets: { stats: ["poison"], tags: ["sluggish"] },
    baseMagnitudes: { stats: { poison: 2 }, tagsAdd: ["sluggish"] },
  },
  calm: {
    id: "calm", stacking: "replace", duration: 4,
    targets: { tags: ["calm"] },
    baseMagnitudes: { tagsAdd: ["calm"] },
  },
});

export class EffectsStage extends withPersistence<ChatStateType, InitStateType, MessageStateType, ConfigType>() {
  p!: EffectsBundle;

  constructor(data: InitialData<InitStateType, ChatStateType, MessageStateType, ConfigType>) {
    super(data);
    const ms = (data.messageState as Record<string, string | undefined> | null) ?? null;
    this.p = effectsPattern({
      messageState: ms,
      tinctures: TINCTURES,
      stageDirections: {
        architectures: ["focus_hold", "body_then_world"],
        register: { pov: "close-second", tense: "present", distance: "close" },
        prefix:
          "Klio is the apothecary. To apply a tincture to the player, emit a tag like " +
          "`<apply>adrenaline</apply>` or `<dispel>calm</dispel>` (the tag bodies are stripped " +
          "from what the user sees). Available tincture ids and their stacking are in the " +
          "visual observation.",
      },
    });
    this.initStore(() => this.p.store);
  }

  async beforePrompt(msg: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    return this.p.buildBeforePrompt(msg, this.bound) as Promise<Partial<StageResponse<ChatStateType, MessageStateType>>>;
  }

  async afterResponse(msg: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    return this.p.buildAfterResponse(msg, this.bound) as Promise<Partial<StageResponse<ChatStateType, MessageStateType>>>;
  }

  render(): ReactElement {
    const { effectStore, tick, events } = this.p;
    const now = tick.n;
    const active = effectStore.active();
    return (
      <div style={{ padding: 12, fontFamily: "ui-monospace, monospace", color: "#ddd", background: "#111" }}>
        <h3 style={{ marginTop: 0 }}>Klio&apos;s bench — tick {now}</h3>
        <h4>Active effects</h4>
        {active.length === 0 ? <em style={{ opacity: 0.5 }}>none</em> : (
          <ul>
            {active.map((i) => {
              const remaining = i.def.duration != null ? Math.max(0, i.def.duration - (now - i.startTime)) : "∞";
              const mag = effectStore.magnitudesFor(i.id, now);
              return (
                <li key={i.id}>
                  <b>{i.id}</b> ×{i.count} — remaining {String(remaining)} — {JSON.stringify(mag?.stats ?? {})} {mag?.tagsAdd?.join(",")}
                </li>
              );
            })}
          </ul>
        )}
        <h4>Recent events</h4>
        <pre style={{ background: "#000", padding: 8, maxHeight: 200, overflow: "auto" }}>
{summarize(events.window(20), (e, at) => `${e}@${at}`) || "—"}
        </pre>
      </div>
    );
  }
}
