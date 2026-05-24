/*
 * world-primary/Stage.tsx — the "just good" RP frontend shape.
 *
 * Demonstrates the design in src/lib/design/FRONTEND-SHAPE.md end-to-end:
 *
 *   - World state as primary (hand-seeded state machine: 3 locations,
 *     3 NPCs, small inventory schema, 2 ConditionalTriggers).
 *   - Structured verbs as fast path (ActionSurface: verbs derived from
 *     schema × state).
 *   - Freeform input as escape hatch (FreeformInput → freeformPipeline).
 *   - Renderer/oracle split (renderTrigger for prose, quietCall for oracle).
 *   - Single-shot prompt assembly (ContextAssembler).
 *   - Chat log as side panel (ChatLogSidebar).
 *   - Fullscreen iframe; Chub chat UI bypassed.
 *
 * Persistence (three-layer):
 *   - initState  — null (world seeded in constructor).
 *   - chatState  — log entries (append-only, survives swipes).
 *   - messageState — branch-aware turn state (location, NPC relations,
 *     inventory, trigger cooldowns, last prose).
 *
 * Primitives composed:
 *   - ContextAssembler / systemInstructionsContributor
 *   - LlmPipelineRunner
 *   - ConditionalTrigger / TriggerSet
 *   - renderTrigger (patterns/render-trigger.ts)
 *   - freeformPipeline (patterns/freeform-pipeline.ts)
 *   - WorldStatePanel, ActionSurface, ScenePane, ChatLogSidebar, FreeformInput
 */

import { ReactElement } from "react";
import { StageBase, StageResponse, InitialData, Message } from "@chub-ai/stages-ts";
import { LoadResponse } from "@chub-ai/stages-ts/dist/types/load";

import { ContextAssembler, systemInstructionsContributor } from "../../src/lib/context";
import { LlmPipelineRunner } from "../../src/lib/llm-pipeline";
import { TriggerSet, type ConditionalTrigger } from "../../src/lib/trigger";
import { Rng } from "../../src/lib/rng";
import { renderTrigger, type RenderStub } from "../../src/lib/patterns/render-trigger";
import { freeformPipeline, type OracleDelta } from "../../src/lib/patterns/freeform-pipeline";
import { type SchemaParser } from "../../src/lib/generate";

import { WorldStatePanel } from "../../src/lib/ui/WorldStatePanel";
import { ActionSurface, type VerbEntry } from "../../src/lib/ui/ActionSurface";
import { ScenePane } from "../../src/lib/ui/ScenePane";
import { ChatLogSidebar, type LogEntry } from "../../src/lib/ui/ChatLogSidebar";
import { FreeformInput } from "../../src/lib/ui/FreeformInput";

/* ------------------------------------------------------------------ *
 * World schema                                                        *
 * ------------------------------------------------------------------ */

interface Location {
  id: string;
  name: string;
  description: string;
  exits: Record<string, string>; // direction → location id
  npcs: string[];                // npc ids present here
  items: string[];               // item ids present here
}

interface Npc {
  id: string;
  name: string;
  description: string;
  relation: number;              // -100..100; 0 = neutral
  tags: string[];
}

interface ItemDef {
  id: string;
  name: string;
  description: string;
}

/* ------------------------------------------------------------------ *
 * State types                                                         *
 * ------------------------------------------------------------------ */

interface WorldMessageState {
  locationId: string;
  relations: Record<string, number>; // npc id → relation score
  inventory: string[];               // item ids held by player
  turnCount: number;
  lastProse: string;
  triggerState: { lastFiredAt: Record<string, number>; fired: Record<string, true> };
  flags: Record<string, boolean>;
}

interface WorldChatState {
  log: LogEntry[];
}

type WorldInitState = null;
type WorldConfig = null;

/* ------------------------------------------------------------------ *
 * World data (seeded at construct time)                               *
 * ------------------------------------------------------------------ */

const LOCATIONS: Record<string, Location> = {
  "village-square": {
    id: "village-square",
    name: "Village Square",
    description: "The dusty heart of a small settlement. A well stands in the centre; smoke curls from the inn to the north.",
    exits: { north: "inn", east: "market" },
    npcs: ["elder-mira"],
    items: ["map-fragment"],
  },
  "inn": {
    id: "inn",
    name: "The Ember Inn",
    description: "Low-beamed, candle-lit. The smell of stew and old wood. Travellers murmur at corner tables.",
    exits: { south: "village-square" },
    npcs: ["innkeeper-holt"],
    items: ["candle"],
  },
  "market": {
    id: "market",
    name: "Market Stalls",
    description: "A handful of weathered stalls. Cloth banners snap in the wind. Prices are handwritten on slate.",
    exits: { west: "village-square" },
    npcs: ["merchant-vas"],
    items: ["rope", "lantern"],
  },
};

const NPCS: Record<string, Npc> = {
  "elder-mira": {
    id: "elder-mira",
    name: "Elder Mira",
    description: "A silver-haired woman with careful eyes. She watches the square from a stone bench.",
    relation: 10,
    tags: ["elder", "wise"],
  },
  "innkeeper-holt": {
    id: "innkeeper-holt",
    name: "Holt",
    description: "A broad man who moves quietly for his size. He keeps the inn without fuss.",
    relation: 5,
    tags: ["innkeeper", "pragmatic"],
  },
  "merchant-vas": {
    id: "merchant-vas",
    name: "Vas",
    description: "Quick-eyed, expensively dressed for the market, smells faintly of cinnamon.",
    relation: 0,
    tags: ["merchant", "shrewd"],
  },
};

const ITEMS: Record<string, ItemDef> = {
  "map-fragment": { id: "map-fragment", name: "Map Fragment", description: "Half a hand-drawn map. The other half is missing." },
  "candle":       { id: "candle",       name: "Tallow Candle", description: "A short candle. Provides light for a few hours." },
  "rope":         { id: "rope",         name: "Coil of Rope",  description: "Twenty feet of hempen rope." },
  "lantern":      { id: "lantern",      name: "Oil Lantern",   description: "A brass lantern with oil remaining." },
};

/* ------------------------------------------------------------------ *
 * Triggers                                                            *
 * ------------------------------------------------------------------ */

type TriggerEffect =
  | { kind: "npc-greeting";  npcId: string }
  | { kind: "darkness-falls" };

type TriggerState = WorldMessageState;

const TRIGGERS: ConditionalTrigger<TriggerState, TriggerEffect>[] = [
  {
    id: "elder-greeting",
    when: { kind: "and", clauses: [
      { kind: "located-at", target: "player", location: "village-square" },
      { kind: "not", inner: { kind: "world-flag", flag: "elder-greeted" } },
    ]},
    probability: 1,
    effect: { kind: "npc-greeting", npcId: "elder-mira" },
    oneShot: true,
  },
  {
    id: "darkness-falls",
    when: { kind: "stat", target: "player", stat: "turnCount", op: ">", value: 10 },
    probability: 0.3,
    effect: { kind: "darkness-falls" },
    cooldown: 5 * 60_000, // 5 minutes real time between fires
  },
];

const TRIGGER_STUBS: Record<string, RenderStub> = {
  "elder-greeting": {
    tone: "warm, slightly guarded",
    beats: [
      "Elder Mira notices the player's arrival in the square",
      "She rises from the bench and offers a brief, measured greeting",
      "She hints that the village has been unsettled of late without elaborating",
    ],
    lengthHint: "two short paragraphs",
    pov: "close third on the player",
  },
  "darkness-falls": {
    tone: "ominous, atmospheric",
    beats: [
      "The light dims unexpectedly — cloud or something else",
      "A brief unsettling moment; the world seems to hold its breath",
    ],
    lengthHint: "one paragraph",
    pov: "close third on the player",
  },
};

/* ------------------------------------------------------------------ *
 * Oracle delta schema                                                 *
 * ------------------------------------------------------------------ */

interface WorldDelta {
  /** New location id; undefined = no move. */
  newLocationId?: string;
  /** NPC relation changes: npc id → delta (-10..10). */
  relationDeltas?: Record<string, number>;
  /** Items added to player inventory. */
  itemsAdded?: string[];
  /** Items removed from player inventory. */
  itemsRemoved?: string[];
  /** Flags to set. */
  setFlags?: Record<string, boolean>;
}

const parseOracleDelta: SchemaParser<OracleDelta<WorldDelta>> = (text) => {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]);
    if (typeof o !== "object" || o === null) return null;
    const delta: WorldDelta = {};
    if (typeof o.newLocationId === "string") delta.newLocationId = o.newLocationId;
    if (typeof o.relationDeltas === "object" && o.relationDeltas !== null) {
      delta.relationDeltas = o.relationDeltas;
    }
    if (Array.isArray(o.itemsAdded)) delta.itemsAdded = o.itemsAdded.filter((x: unknown) => typeof x === "string");
    if (Array.isArray(o.itemsRemoved)) delta.itemsRemoved = o.itemsRemoved.filter((x: unknown) => typeof x === "string");
    if (typeof o.setFlags === "object" && o.setFlags !== null) delta.setFlags = o.setFlags;
    return { delta, stub: o.stub ?? undefined };
  } catch {
    return null;
  }
};

/* ------------------------------------------------------------------ *
 * Stage                                                               *
 * ------------------------------------------------------------------ */

export class WorldPrimaryStage extends StageBase<WorldInitState, WorldChatState, WorldMessageState, WorldConfig> {

  private assembler: ContextAssembler;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private runner!: LlmPipelineRunner<any>;
  private triggers: TriggerSet<TriggerState, TriggerEffect, unknown>;

  // Ephemeral render state (not persisted; re-derived each render).
  private currentProse = "";
  private log: LogEntry[] = [];
  private isProcessing = false;

  // Mutable message state snapshot — updated on setState / beforePrompt.
  private ms: WorldMessageState = {
    locationId: "village-square",
    relations: {
      "elder-mira": 10,
      "innkeeper-holt": 5,
      "merchant-vas": 0,
    },
    inventory: [],
    turnCount: 0,
    lastProse: "",
    triggerState: { lastFiredAt: {}, fired: {} },
    flags: {},
  };

  constructor(data: InitialData<WorldInitState, WorldChatState, WorldMessageState, WorldConfig>) {
    super(data);

    // Restore persisted state.
    if (data.messageState) {
      this.ms = { ...this.ms, ...data.messageState };
      this.currentProse = this.ms.lastProse ?? "";
    }
    if (data.chatState?.log) {
      this.log = data.chatState.log;
    }

    this.assembler = new ContextAssembler({ budget: 4000 });
    this.assembler.register(
      systemInstructionsContributor(
        [
          "You are a literary narrator for an interactive text world.",
          "You render scenes, NPC dialogue, and atmosphere based on structured world state.",
          "Write in close-third person, present tense, literary prose — vivid but economical.",
          "Do not introduce new facts beyond what the world state provides.",
          "Do not break the fourth wall or mention game mechanics.",
        ].join("\n"),
      ),
    );

    this.triggers = TriggerSet.fromJSON<TriggerState, TriggerEffect, unknown>(
      TRIGGERS,
      this.ms.triggerState,
    );
  }

  async load(): Promise<Partial<LoadResponse<WorldInitState, WorldChatState, WorldMessageState>>> {
    return {
      success: true,
      error: null,
      initState: null,
      chatState: { log: this.log },
      messageState: this.ms,
    };
  }

  async setState(state: WorldMessageState): Promise<void> {
    if (!state) return;
    this.ms = { ...this.ms, ...state };
    this.currentProse = this.ms.lastProse ?? "";
    // Re-attach trigger state.
    this.triggers = TriggerSet.fromJSON<TriggerState, TriggerEffect, unknown>(
      TRIGGERS,
      this.ms.triggerState,
    );
  }

  async beforePrompt(
    msg: Message,
  ): Promise<Partial<StageResponse<WorldChatState, WorldMessageState>>> {
    // Initialise runner lazily (generator is available after construction).
    if (!this.runner) {
      this.runner = new LlmPipelineRunner(
        { state: {} },
        this.assembler,
        this.generator,
      );
    }

    this.ms.turnCount += 1;
    this.isProcessing = true;

    const playerText = msg.content ?? "";
    const location = LOCATIONS[this.ms.locationId];

    // Build scope from current location.
    const scope = new Set<string>([
      ...Object.keys(location.exits),
      ...location.npcs,
      ...location.items,
      ...this.ms.inventory,
    ]);

    // Run freeform pipeline.
    let newProse = "";
    try {
      const result = await freeformPipeline<WorldDelta>({
        text: playerText,
        scope,
        generator: this.generator,
        parseOptions: {
          synonyms: {
            verbs: { move: "go", walk: "go", travel: "go" },
            nouns: Object.fromEntries(
              [
                ...Object.values(LOCATIONS).map((l) => [l.name.toLowerCase(), l.id]),
                ...Object.values(NPCS).map((n) => [n.name.toLowerCase(), n.id]),
                ...Object.values(ITEMS).map((it) => [it.name.toLowerCase(), it.id]),
              ],
            ),
          },
          fallback: { quietCall: (p) => this.runner.runQuiet(p) },
        },
        oraclePrompt: (text, sc) => [
          `World state: player is in "${location.name}". Exits: ${Object.entries(location.exits).map(([d, to]) => `${d}→${LOCATIONS[to]?.name ?? to}`).join(", ")}.`,
          `Present NPCs: ${location.npcs.map((id) => NPCS[id]?.name ?? id).join(", ") || "none"}.`,
          `Player inventory: ${this.ms.inventory.map((id) => ITEMS[id]?.name ?? id).join(", ") || "empty"}.`,
          `Visible: ${[...sc].join(", ")}.`,
          ``,
          `Player input: "${text}"`,
          ``,
          "Propose a world state delta as JSON. Fields:",
          '  newLocationId?: string (must be a valid location id if present)',
          '  relationDeltas?: Record<npcId, number> (-10 to 10)',
          '  itemsAdded?: string[] (valid item ids)',
          '  itemsRemoved?: string[] (valid item ids)',
          '  setFlags?: Record<string, boolean>',
          '  stub?: { tone?: string; beats?: string[]; lengthHint?: string }',
          "Reply with ONLY the JSON object.",
        ].join("\n"),
        oracleSchema: parseOracleDelta,
        validateDelta: (d) => {
          if (d.newLocationId && !LOCATIONS[d.newLocationId]) return false;
          return true;
        },
        coerceDelta: (d) => {
          if (d.newLocationId && !LOCATIONS[d.newLocationId]) {
            const { newLocationId: _, ...rest } = d;
            return rest;
          }
          return d;
        },
        applyDelta: (d) => this.applyDelta(d),
        policy: "coerce",
        render: async (stub, intent) => {
          // If we got a grammar intent for movement, apply it deterministically.
          if (intent?.verb === "go" && intent.target && LOCATIONS[intent.target]) {
            this.ms.locationId = intent.target;
          } else if (intent?.verb === "take" && intent.target && location.items.includes(intent.target)) {
            this.ms.inventory.push(intent.target);
          } else if (intent?.verb === "examine") {
            // Examine doesn't change state; just a render hook.
          } else if (intent?.verb === "talk" && intent.target) {
            // Boost relation slightly.
            const npcId = intent.target;
            if (this.ms.relations[npcId] !== undefined) {
              this.ms.relations[npcId] = Math.min(100, (this.ms.relations[npcId] ?? 0) + 2);
            }
          }

          // Evaluate triggers.
          const rng = Rng.fromSeed(`world-primary-${this.ms.turnCount}`).stream("mechanical");
          const triggerResolvers = {
            getLocation: (_actor: unknown, state: WorldMessageState) => state.locationId,
            getStat: (_actor: unknown, stat: string, state: WorldMessageState) =>
              stat === "turnCount" ? state.turnCount : undefined,
            getFlag: (flag: string, state: WorldMessageState) =>
              state.flags[flag] ?? undefined,
          };
          this.triggers.resolvers = triggerResolvers;
          const firedEffects = this.triggers.evaluate(
            this.ms,
            { player: "player" },
            rng,
            Date.now(),
          );
          this.ms.triggerState = this.triggers.toJSON();

          // Render trigger prose for the first fired effect.
          let triggerProse = "";
          for (const effect of firedEffects) {
            if (effect.kind === "npc-greeting") {
              this.ms.flags["elder-greeted"] = true;
              const trigStub = TRIGGER_STUBS["elder-greeting"];
              triggerProse = await renderTrigger({ stub: trigStub, assembler: this.assembler, runner: this.runner });
              break;
            } else if (effect.kind === "darkness-falls") {
              const trigStub = TRIGGER_STUBS["darkness-falls"];
              triggerProse = await renderTrigger({ stub: trigStub, assembler: this.assembler, runner: this.runner });
              break;
            }
          }

          // Main scene prose.
          const renderStub = stub ?? {
            tone: "grounded, literary",
            beats: intent
              ? [`Player ${intent.verb}${intent.target ? ` ${intent.target}` : ""}`]
              : ["Describe what happens as a result of the player's action"],
            lengthHint: "one paragraph",
            pov: "close third on the player",
          };
          const mainProse = await renderTrigger({
            stub: renderStub,
            assembler: this.assembler,
            runner: this.runner,
          });

          return [triggerProse, mainProse].filter(Boolean).join("\n\n");
        },
      });

      newProse = result.prose;
    } catch (err) {
      newProse = "(Something went wrong processing your action.)";
    }

    this.isProcessing = false;
    this.currentProse = newProse;
    this.ms.lastProse = newProse;

    // Append to log.
    const logEntry: LogEntry = {
      id: `turn-${this.ms.turnCount}`,
      prose: newProse,
      turnLabel: `Turn ${this.ms.turnCount}`,
    };
    this.log = [...this.log, logEntry];

    return {
      stageDirections: null,
      messageState: { ...this.ms },
      chatState: { log: this.log },
      modifiedMessage: null,
      systemMessage: null,
      error: null,
    };
  }

  async afterResponse(
    _msg: Message,
  ): Promise<Partial<StageResponse<WorldChatState, WorldMessageState>>> {
    return {
      messageState: { ...this.ms },
      chatState: { log: this.log },
    };
  }

  private applyDelta(delta: WorldDelta): void {
    if (delta.newLocationId) this.ms.locationId = delta.newLocationId;
    if (delta.relationDeltas) {
      for (const [id, change] of Object.entries(delta.relationDeltas)) {
        if (this.ms.relations[id] !== undefined) {
          this.ms.relations[id] = Math.max(-100, Math.min(100, (this.ms.relations[id] ?? 0) + change));
        }
      }
    }
    if (delta.itemsAdded) {
      for (const id of delta.itemsAdded) {
        if (!this.ms.inventory.includes(id)) this.ms.inventory.push(id);
      }
    }
    if (delta.itemsRemoved) {
      this.ms.inventory = this.ms.inventory.filter((id) => !delta.itemsRemoved!.includes(id));
    }
    if (delta.setFlags) {
      Object.assign(this.ms.flags, delta.setFlags);
    }
  }

  private deriveVerbs(): VerbEntry[] {
    const location = LOCATIONS[this.ms.locationId];
    const verbs: VerbEntry[] = [];

    // Movement verbs.
    for (const [dir, targetId] of Object.entries(location.exits)) {
      const target = LOCATIONS[targetId];
      verbs.push({
        id: `go-${dir}`,
        label: `Go ${dir} → ${target?.name ?? targetId}`,
        enabled: !this.isProcessing,
        onClick: () => {
          // Handled via beforePrompt; we synthesise a message.
          this.isProcessing = true;
        },
        hint: `Move ${dir} to ${target?.name ?? targetId}`,
      });
    }

    // NPC interaction verbs.
    for (const npcId of location.npcs) {
      const npc = NPCS[npcId];
      if (!npc) continue;
      verbs.push({
        id: `talk-${npcId}`,
        label: `Talk to ${npc.name}`,
        enabled: !this.isProcessing,
        onClick: () => { /* wired via Chub message flow */ },
        hint: `Speak with ${npc.name}`,
      });
    }

    // Item verbs.
    for (const itemId of location.items) {
      const item = ITEMS[itemId];
      if (!item) continue;
      const held = this.ms.inventory.includes(itemId);
      verbs.push({
        id: `examine-${itemId}`,
        label: `Examine ${item.name}`,
        enabled: !this.isProcessing,
        onClick: () => { /* wired via Chub message flow */ },
      });
      if (!held) {
        verbs.push({
          id: `take-${itemId}`,
          label: `Take ${item.name}`,
          enabled: !this.isProcessing,
          onClick: () => { /* wired via Chub message flow */ },
        });
      }
    }

    return verbs;
  }

  render(): ReactElement {
    const location = LOCATIONS[this.ms.locationId] ?? {
      id: this.ms.locationId, name: this.ms.locationId, description: "", exits: {}, npcs: [], items: [],
    };

    const presentNpcs = location.npcs.map((id) => {
      const npc = NPCS[id];
      if (!npc) return null;
      const rel = this.ms.relations[id] ?? 0;
      return {
        id: npc.id,
        name: npc.name,
        stats: { relation: rel > 0 ? `+${rel}` : `${rel}` },
        tags: npc.tags,
      };
    }).filter(Boolean) as import("../../src/lib/ui/WorldStatePanel").ActorEntry[];

    const playerStats: Record<string, string> = {
      turn: String(this.ms.turnCount),
      inventory: this.ms.inventory.length
        ? this.ms.inventory.map((id) => ITEMS[id]?.name ?? id).join(", ")
        : "empty",
    };

    const verbs = this.deriveVerbs();

    return (
      <div style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        flexDirection: "row",
        background: "#0e0e0e",
        overflow: "hidden",
      }}>
        {/* Left panel — world state */}
        <div style={{
          width: "240px",
          minWidth: "240px",
          display: "flex",
          flexDirection: "column",
          padding: "12px",
          gap: "10px",
          borderRight: "1px solid rgba(255,255,255,0.08)",
          overflowY: "auto",
        }}>
          <WorldStatePanel
            location={location.name}
            locationDescription={location.description}
            actors={presentNpcs}
            stats={playerStats}
          />
        </div>

        {/* Centre — scene prose + input */}
        <div style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          padding: "16px",
          gap: "12px",
          minWidth: 0,
        }}>
          {/* Verb buttons */}
          <ActionSurface
            verbs={verbs}
            columns={3}
            style={{ flexShrink: 0 }}
          />

          {/* Scene prose */}
          <ScenePane
            prose={this.currentProse}
            placeholder="The world waits for your move."
            style={{ flex: 1, minHeight: 0 }}
          />

          {/* Freeform input — wired to beforePrompt via Chub message flow */}
          <FreeformInput
            disabled={this.isProcessing}
            placeholder="Or type anything…"
            onSubmit={(_text) => {
              // In a Chub stage the player's message routes through Chub's
              // chat box → beforePrompt. The FreeformInput here is a UI
              // affordance whose submit the stage author would wire to
              // Chub's message injection API (not available in this adapter).
              // For the dev runner, the text box is functional via beforePrompt.
            }}
            style={{ flexShrink: 0 }}
          />
        </div>

        {/* Right — chat log sidebar */}
        <ChatLogSidebar
          entries={this.log}
          initialCollapsed={false}
        />
      </div>
    );
  }
}
