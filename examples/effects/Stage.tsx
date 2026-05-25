/*
 * effects/Stage.tsx — Klio the apothecary.
 *
 * Mechanic: a brewing bench. The player asks for a tincture; the LLM names
 * an effect (via [[apply:id]] tags); the stage applies it to "the player"
 * with the right stacking policy and trajectory. `tick` per turn drains
 * expired effects.
 *
 * Primitives: effects, tag-parser, chub-adapters, persistence.
 * Philosophy: rule #3 (effects.tick returns the expired set; the stage
 * decides what to do with it), rule #6 (elapsed = now - startTime).
 *
 * Persistence: store shard on messageState + chubTreeHistory — effects
 * are per-branch so a swipe really does explore an alternate brew.
 */

import { ReactElement } from "react";
import { StageResponse, InitialData, Message } from "@chub-ai/stages-ts";
import { EffectDef, EffectStore, EffectMagnitudes } from "../../src/lib/effects";
import { Registry } from "../../src/lib/registry";
import { Timeline, summarize } from "../../src/lib/timeline";
import { parseTags } from "../../src/lib/tag-parser";
import { emitStageDirections } from "../../src/lib/chub-adapters";
import { assembleObservations, ObservationSource } from "../../src/lib/observation";
import {
  PersistenceStore, createChubLayers, chubTreeHistory, mergeResponses, counterShard, shardOf,
  withPersistence,
} from "../../src/lib/persistence";

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
  effectStore = new EffectStore();
  tick = { n: 0 };
  events = new Timeline<string>({ id: "tincture-events", channels: ["interoceptive"], windowSize: 20, habituationTau: 2 });
  layers = createChubLayers();

  constructor(data: InitialData<InitStateType, ChatStateType, MessageStateType, ConfigType>) {
    super(data);
    this.layers = createChubLayers({
      messageState: (data.messageState as Record<string, string | undefined> | null) ?? null,
    });
    this.initStore(() => new PersistenceStore({
      tick: counterShard("tick", this.tick, this.layers.messageStateBackend, chubTreeHistory()),
      effects: shardOf("effects", this.effectStore, (d) => EffectStore.fromJSON(d, TINCTURES.toJSON()), this.layers.messageStateBackend, chubTreeHistory()),
    }));
  }

  private observationSources(now: number): ObservationSource<{ now: number }>[] {
    return [
      {
        id: "active-effects", channels: ["interoceptive"],
        salience: () => Math.min(1, this.effectStore.active().length / 3), habituationTau: 3,
        properties: { interoceptive: {
          active: () => this.effectStore.active().map((i) => {
            const m: EffectMagnitudes = this.effectStore.magnitudesFor(i.id, now) ?? {};
            return {
              id: i.id,
              remaining: i.def.duration != null ? Math.max(0, i.def.duration - (now - i.startTime)) : null,
              stacks: i.count, stats: m.stats ?? {}, tags: m.tagsAdd ?? [],
            };
          }),
        } },
      },
      {
        id: "tincture-menu", channels: ["visual"], salience: () => 0.3, habituationTau: 20,
        properties: { visual: {
          available: () => TINCTURES.entries().map(([id, def]) => ({ id, stacking: def.stacking, duration: def.duration })),
        } },
      },
    ];
  }

  async beforePrompt(msg: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    this.tick.n += 1;
    const now = this.tick.n;
    const expired = this.effectStore.tick(now);
    for (const e of expired) this.events.push(`expired:${e.id}`, now);

    const observed = assembleObservations(
      [...this.observationSources(now), this.events],
      { now }, { now, maxCount: 3 },
    );
    const stageDirections = emitStageDirections({
      observations: observed,
      architectures: ["focus_hold", "body_then_world"],
      register: { pov: "close-second", tense: "present", distance: "close" },
      prefix:
        "Klio is the apothecary. To apply a tincture to the player, emit a tag like " +
        "`<apply>adrenaline</apply>` or `<dispel>calm</dispel>` (the tag bodies are stripped " +
        "from what the user sees). Available tincture ids and their stacking are in the " +
        "visual observation.",
    });
    return mergeResponses({ stageDirections }, await this.bound.beforePrompt(msg));
  }

  async afterResponse(botMessage: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    const now = this.tick.n;
    const r1 = parseTags<Record<string, unknown>>(botMessage.content, { apply: { kind: "string" } });
    const r2 = parseTags<Record<string, unknown>>(r1.stripped, { dispel: { kind: "string" } });
    const applyId = typeof r1.parsed.apply === "string" ? (r1.parsed.apply as string).trim() : "";
    const tincture = applyId ? TINCTURES.get(applyId) : undefined;
    if (tincture) {
      this.effectStore.apply(tincture, now);
      this.events.push(`applied:${applyId}`, now);
    }
    const dispelTag = typeof r2.parsed.dispel === "string" ? (r2.parsed.dispel as string).trim() : "";
    if (dispelTag) {
      const dispelled = this.effectStore.dispelByTag(dispelTag);
      for (const d of dispelled) this.events.push(`dispelled:${d.id}`, now);
    }
    const stripped = r2.stripped !== botMessage.content ? r2.stripped : null;
    return mergeResponses({ modifiedMessage: stripped }, await this.bound.afterResponse(botMessage));
  }

  render(): ReactElement {
    const now = this.tick.n;
    const active = this.effectStore.active();
    return (
      <div style={{ padding: 12, fontFamily: "ui-monospace, monospace", color: "#ddd", background: "#111" }}>
        <h3 style={{ marginTop: 0 }}>Klio&apos;s bench — tick {now}</h3>
        <h4>Active effects</h4>
        {active.length === 0 ? <em style={{ opacity: 0.5 }}>none</em> : (
          <ul>
            {active.map((i) => {
              const remaining = i.def.duration != null ? Math.max(0, i.def.duration - (now - i.startTime)) : "∞";
              const mag = this.effectStore.magnitudesFor(i.id, now);
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
{summarize(this.events.window(20), (e, at) => `${e}@${at}`) || "—"}
        </pre>
      </div>
    );
  }
}
