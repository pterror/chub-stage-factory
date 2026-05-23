/*
 * effects/Stage.tsx — Klio the apothecary.
 *
 * Mechanic: a brewing bench. The player asks for a tincture; the LLM names
 * an effect (via [[apply:id]] tags); the stage applies it to "the player"
 * with the right stacking policy and trajectory. `tick` per turn drains
 * expired effects.
 *
 * Primitives: effects, stats, scheduler, tag-parser, chub-adapters.
 * Philosophy: rule #3 (effects.tick returns the expired set; the stage
 * decides what to do with it), rule #6 (elapsed = now - startTime).
 */

import { ReactElement } from "react";
import { StageBase, StageResponse, InitialData, Message } from "@chub-ai/stages-ts";
import { LoadResponse } from "@chub-ai/stages-ts/dist/types/load";
import { EffectDef, EffectStore, EffectMagnitudes } from "../../src/lib/effects";
import { Scheduler } from "../../src/lib/scheduler";
import { parseTags } from "../../src/lib/tag-parser";
import { emitStageDirections } from "../../src/lib/chub-adapters";
import { assembleObservations, ObservationSource } from "../../src/lib/observation";

interface MessageStateType {
  ticks: number;
  pcTag?: string;
}
type ChatStateType = null;
type InitStateType = null;
type ConfigType = null;

const TINCTURES: Record<string, EffectDef> = {
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
};

export class EffectsStage extends StageBase<InitStateType, ChatStateType, MessageStateType, ConfigType> {
  store = new EffectStore();
  scheduler = new Scheduler<{ store: EffectStore }>({ store: this.store });
  msg: MessageStateType = { ticks: 0 };
  events: string[] = [];

  constructor(data: InitialData<InitStateType, ChatStateType, MessageStateType, ConfigType>) {
    super(data);
    if (data.messageState) this.msg = { ...this.msg, ...data.messageState };
  }

  async load(): Promise<Partial<LoadResponse<InitStateType, ChatStateType, MessageStateType>>> {
    return { success: true, error: null, initState: null, chatState: null };
  }

  async setState(state: MessageStateType): Promise<void> {
    if (state) this.msg = { ...this.msg, ...state };
  }

  private observationSources(now: number): ObservationSource<{ now: number }>[] {
    return [
      {
        id: "active-effects",
        channels: ["interoceptive"],
        salience: () => Math.min(1, this.store.active().length / 3),
        habituationTau: 3,
        properties: {
          interoceptive: {
            active: () => this.store.active().map((i) => {
              const m: EffectMagnitudes = this.store.magnitudesFor(i.id, now) ?? {};
              return {
                id: i.id,
                remaining: i.def.duration != null ? Math.max(0, i.def.duration - (now - i.startTime)) : null,
                stacks: i.count,
                stats: m.stats ?? {},
                tags: m.tagsAdd ?? [],
              };
            }),
          },
        },
      },
      {
        id: "tincture-menu",
        channels: ["visual"],
        salience: () => 0.3,
        habituationTau: 20,
        properties: {
          visual: {
            available: () => Object.entries(TINCTURES).map(([id, def]) => ({
              id, stacking: def.stacking, duration: def.duration,
            })),
          },
        },
      },
    ];
  }

  async beforePrompt(_userMessage: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    const now = ++this.msg.ticks;
    // Drain expired
    const expired = this.store.tick(now);
    for (const e of expired) this.events.push(`expired:${e.id}@${now}`);

    const observed = assembleObservations(this.observationSources(now), { now }, { now, maxCount: 3 });
    const stageDirections = emitStageDirections({
      observations: observed,
      architectures: ["focus_hold", "body_then_world"],
      register: "close-2nd-present",
      prefix:
        "Klio is the apothecary. To apply a tincture to the player, emit a tag like " +
        "`<apply>adrenaline</apply>` or `<dispel>calm</dispel>` (the tag bodies are stripped " +
        "from what the user sees). Available tincture ids and their stacking are in the " +
        "visual observation.",
    });
    return { stageDirections, messageState: this.msg };
  }

  async afterResponse(botMessage: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    const now = this.msg.ticks;
    const r1 = parseTags<Record<string, unknown>>(botMessage.content, { apply: { kind: "string" } });
    const r2 = parseTags<Record<string, unknown>>(r1.stripped, { dispel: { kind: "string" } });
    const applyId = typeof r1.parsed.apply === "string" ? (r1.parsed.apply as string).trim() : "";
    if (applyId && TINCTURES[applyId]) {
      this.store.apply(TINCTURES[applyId], now);
      this.events.push(`applied:${applyId}@${now}`);
    }
    const dispelTag = typeof r2.parsed.dispel === "string" ? (r2.parsed.dispel as string).trim() : "";
    if (dispelTag) {
      const dispelled = this.store.dispelByTag(dispelTag);
      for (const d of dispelled) this.events.push(`dispelled:${d.id}@${now}`);
    }
    return {
      messageState: this.msg,
      modifiedMessage: r2.stripped !== botMessage.content ? r2.stripped : null,
      systemMessage: null, error: null, chatState: null, stageDirections: null,
    };
  }

  render(): ReactElement {
    const now = this.msg.ticks;
    const active = this.store.active();
    return (
      <div style={{ padding: 12, fontFamily: "ui-monospace, monospace", color: "#ddd", background: "#111" }}>
        <h3 style={{ marginTop: 0 }}>Klio&apos;s bench — tick {now}</h3>
        <h4>Active effects</h4>
        {active.length === 0 ? <em style={{ opacity: 0.5 }}>none</em> : (
          <ul>
            {active.map((i) => {
              const remaining = i.def.duration != null ? Math.max(0, i.def.duration - (now - i.startTime)) : "∞";
              const mag = this.store.magnitudesFor(i.id, now);
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
{this.events.slice(-20).join("\n") || "—"}
        </pre>
      </div>
    );
  }
}
