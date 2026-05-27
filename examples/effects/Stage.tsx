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
import { withPersistence } from "../../src/lib/persistence";
import { effectsPattern, type EffectsBundle } from "../../src/lib/patterns/combat/effects";

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
    const { effectStore, tick } = this.p;
    const now = tick.n;
    const active = effectStore.active();

    // Map effect ids to player-readable names and prose lines.
    const EFFECT_PROSE: Record<string, { name: string; feel: (dur: number | string, tags: string[]) => string }> = {
      adrenaline: {
        name: "Adrenaline rush",
        feel: (dur, tags) =>
          `Your heart pounds${tags.includes("focus") ? ", mind sharp" : ""}. ${dur === "∞" ? "Lasts until dispelled." : `Fades in ${dur} turn${dur === 1 ? "" : "s"}.`}`,
      },
      fireward: {
        name: "Fire ward",
        feel: (dur) =>
          `A faint warmth clings to your skin, blunting heat. ${dur === "∞" ? "Persistent." : `Wanes in ${dur} turn${dur === 1 ? "" : "s"}.`}`,
      },
      nightroot: {
        name: "Nightroot poison",
        feel: (dur, tags) =>
          `Your limbs feel heavy${tags.includes("sluggish") ? ", movements sluggish" : ""}. ${dur === "∞" ? "Lingers." : `Clears in ${dur} turn${dur === 1 ? "" : "s"}.`}`,
      },
      calm: {
        name: "Calm draught",
        feel: (dur) =>
          `A cool stillness settles over you. ${dur === "∞" ? "Indefinite." : `Holds for ${dur} turn${dur === 1 ? "" : "s"}.`}`,
      },
    };

    return (
      <div style={{ padding: 12, fontFamily: "sans-serif", color: "#ddd", background: "#1a1a1a", maxWidth: 480 }}>
        <h3 style={{ marginTop: 0, fontSize: "1rem", color: "#9ad" }}>Klio&apos;s Apothecary</h3>
        {active.length === 0
          ? <p style={{ color: "#666", fontStyle: "italic", fontSize: "0.9rem" }}>No tinctures are active.</p>
          : (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {active.map((i) => {
                const remaining = i.def.duration != null ? Math.max(0, i.def.duration - (now - i.startTime)) : "∞";
                const mag = effectStore.magnitudesFor(i.id, now);
                const tags = mag?.tagsAdd ?? [];
                const prose = EFFECT_PROSE[i.id];
                return (
                  <li key={i.id} style={{ marginBottom: 8 }}>
                    <div style={{ fontWeight: "bold", fontSize: "0.9rem" }}>
                      {prose?.name ?? i.id}
                      {i.count > 1 && <span style={{ color: "#aaa", fontWeight: "normal", marginLeft: 4 }}>×{i.count}</span>}
                    </div>
                    <div style={{ color: "#bbb", fontSize: "0.85rem" }}>
                      {prose ? prose.feel(remaining, tags) : `Remaining: ${String(remaining)} turns.`}
                    </div>
                  </li>
                );
              })}
            </ul>
          )
        }
      </div>
    );
  }
}
