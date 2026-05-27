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
import { World, worldResolvers } from "../../src/lib/world";

import { WorldStatePanel } from "../../src/lib/ui/WorldStatePanel";
import { ActionSurface, type VerbEntry } from "../../src/lib/ui/ActionSurface";
import { ScenePane } from "../../src/lib/ui/ScenePane";
import { ChatLogSidebar, type LogEntry } from "../../src/lib/ui/ChatLogSidebar";
import { FreeformInput } from "../../src/lib/ui/FreeformInput";
import type {
  StageIntrospect,
  VerbDescriptor,
  StageDescriptor,
  InvocationResult,
} from "../../src/lib/introspect";

/* ------------------------------------------------------------------ *
 * World schema                                                        *
 * ------------------------------------------------------------------ */

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

/** NPC ids — used to distinguish NPCs from items in world.entitiesAt(). */
const NPC_IDS = new Set(Object.keys(NPCS));
/** Item ids — used to distinguish items from NPCs in world.entitiesAt(). */
const ITEM_IDS = new Set(Object.keys(ITEMS));

const world = new World();
world
  .addRoom({ id: "village-square", name: "Village Square",  description: "The dusty heart of a small settlement. A well stands in the centre; smoke curls from the inn to the north.", exits: {} })
  .addRoom({ id: "inn",            name: "The Ember Inn",   description: "Low-beamed, candle-lit. The smell of stew and old wood. Travellers murmur at corner tables.",              exits: {} })
  .addRoom({ id: "market",         name: "Market Stalls",   description: "A handful of weathered stalls. Cloth banners snap in the wind. Prices are handwritten on slate.",          exits: {} })
  .connect("village-square", "north", "inn",            "south")
  .connect("village-square", "east",  "market",         "west");

// Place NPCs.
world.locate("elder-mira",     "village-square");
world.locate("innkeeper-holt", "inn");
world.locate("merchant-vas",   "market");

// Place items (room items — player inventory is tracked in messageState).
world.locate("map-fragment", "village-square");
world.locate("candle",       "inn");
world.locate("rope",         "market");
world.locate("lantern",      "market");

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
 * Verb → player-text translation                                      *
 * ------------------------------------------------------------------ *
 * Stage.invokeVerb feeds these strings into beforePrompt as the
 * synthesised player message. The freeform pipeline's intent parser
 * (with the synonym table set up below) then re-parses them into
 * structured intents — so verb invocation and freeform typing both
 * traverse the same code path. */
function verbToPlayerText(name: string, args?: Record<string, unknown>): string | null {
  if (name === "freeform") {
    const t = args?.text;
    if (typeof t !== "string") return null;
    return t;
  }
  if (name === "look") return "look";
  if (name.startsWith("go-")) {
    const dir = name.slice("go-".length);
    return `go ${dir}`;
  }
  if (name.startsWith("talk-")) {
    const npcId = name.slice("talk-".length);
    return `talk to ${npcId}`;
  }
  if (name.startsWith("examine-")) {
    const itemId = name.slice("examine-".length);
    return `examine ${itemId}`;
  }
  if (name.startsWith("take-")) {
    const itemId = name.slice("take-".length);
    return `take ${itemId}`;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Stage                                                               *
 * ------------------------------------------------------------------ */

export class WorldPrimaryStage
  extends StageBase<WorldInitState, WorldChatState, WorldMessageState, WorldConfig>
  implements StageIntrospect {

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
    const location = world.getRoom(this.ms.locationId) ?? { id: this.ms.locationId, name: this.ms.locationId, description: "", exits: {} };

    // Sync player's location into world (world is module-level; ms is branch-aware).
    world.locate("player", this.ms.locationId);

    // Build scope via world — exits + room-mates + carried items.
    const scope = world.scope("player", {
      includeCarried: () => this.ms.inventory,
    });

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
                ...world.rooms().map((r) => [r.name.toLowerCase(), r.id]),
                ...Object.values(NPCS).map((n) => [n.name.toLowerCase(), n.id]),
                ...Object.values(ITEMS).map((it) => [it.name.toLowerCase(), it.id]),
              ],
            ),
          },
          fallback: { quietCall: (p) => this.runner.runQuiet(p) },
        },
        oraclePrompt: (text, sc) => {
          const exits = world.exitsFrom(this.ms.locationId);
          const roomEntities = world.entitiesAt(this.ms.locationId).filter(e => e !== "player");
          const presentNpcIds = roomEntities.filter(e => NPC_IDS.has(e));
          return [
          `World state: player is in "${location.name}". Exits: ${Object.entries(exits).map(([d, ex]) => `${d}→${world.getRoom(ex.to)?.name ?? ex.to}`).join(", ")}.`,
          `Present NPCs: ${presentNpcIds.map((id) => NPCS[id]?.name ?? id).join(", ") || "none"}.`,
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
        ].join("\n");
        },
        oracleSchema: parseOracleDelta,
        validateDelta: (d) => {
          if (d.newLocationId && !world.getRoom(d.newLocationId)) return false;
          return true;
        },
        coerceDelta: (d) => {
          if (d.newLocationId && !world.getRoom(d.newLocationId)) {
            const { newLocationId: _, ...rest } = d;
            return rest;
          }
          return d;
        },
        applyDelta: (d) => this.applyDelta(d),
        policy: "coerce",
        render: async (stub, intent) => {
          // If we got a grammar intent for movement, apply it deterministically.
          if (intent?.verb === "go" && intent.target) {
            // Route through world.move (resolves direction or room id).
            const events = world.move("player", intent.target, worldResolvers(world));
            if (events) {
              const entered = events.find(e => e.kind === "entered");
              if (entered && "roomId" in entered) this.ms.locationId = entered.roomId;
            }
          } else if (intent?.verb === "take" && intent.target && ITEM_IDS.has(intent.target) && world.where(intent.target) === this.ms.locationId) {
            this.ms.inventory.push(intent.target);
            world.detach(intent.target);
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
          const { getLocation } = worldResolvers(world);
          const triggerResolvers = {
            getLocation: (actor: unknown) => typeof actor === "string" ? getLocation(actor) : undefined,
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
      console.error("[world-primary] action processing failed:", err);
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
    if (delta.newLocationId) {
      world.locate("player", delta.newLocationId);
      this.ms.locationId = delta.newLocationId;
    }
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

  /* ---------------- StageIntrospect ----------------
   * The single source of truth for the verb namespace. Both the
   * ActionSurface buttons and scripts/explore-stage.mjs read from
   * availableVerbs(); invokeVerb routes the chosen verb back into
   * beforePrompt as a synthesised player message so all state changes
   * flow through the normal lifecycle.
   * ------------------------------------------------- */

  availableVerbs(): VerbDescriptor[] {
    if (this.isProcessing) return [];
    const out: VerbDescriptor[] = [];
    const exits = world.exitsFrom(this.ms.locationId);
    const roomEntities = world.entitiesAt(this.ms.locationId).filter((e) => e !== "player");

    for (const [dir, exit] of Object.entries(exits)) {
      const target = world.getRoom(exit.to);
      out.push({
        name: `go-${dir}`,
        label: `Go ${dir} → ${target?.name ?? exit.to}`,
        description: `Move ${dir} to ${target?.name ?? exit.to}`,
        group: "move",
      });
    }
    for (const npcId of roomEntities.filter((e) => NPC_IDS.has(e))) {
      const npc = NPCS[npcId];
      if (!npc) continue;
      out.push({
        name: `talk-${npcId}`,
        label: `Talk to ${npc.name}`,
        description: `Speak with ${npc.name}.`,
        group: "talk",
      });
    }
    for (const itemId of roomEntities.filter((e) => ITEM_IDS.has(e))) {
      const item = ITEMS[itemId];
      if (!item) continue;
      const held = this.ms.inventory.includes(itemId);
      out.push({
        name: `examine-${itemId}`,
        label: `Examine ${item.name}`,
        group: "item",
      });
      if (!held) {
        out.push({
          name: `take-${itemId}`,
          label: `Take ${item.name}`,
          group: "item",
        });
      }
    }
    out.push({
      name: "look",
      label: "Look around",
      description: "Describe the current location.",
      group: "observe",
    });
    out.push({
      name: "freeform",
      label: "Freeform input",
      description: "Send any prose; routed through the freeform pipeline.",
      args: [{ name: "text", type: "string", required: true, description: "What you say or do." }],
      group: "freeform",
    });
    return out;
  }

  describe(): StageDescriptor {
    const location = world.getRoom(this.ms.locationId);
    const roomEntities = world.entitiesAt(this.ms.locationId).filter((e) => e !== "player");
    const presentNpcs = roomEntities.filter((e) => NPC_IDS.has(e)).map((id) => NPCS[id]?.name ?? id);
    const roomItems = roomEntities.filter((e) => ITEM_IDS.has(e)).map((id) => ITEMS[id]?.name ?? id);
    const inv = this.ms.inventory.map((id) => ITEMS[id]?.name ?? id);
    const verbs = this.availableVerbs();
    return {
      summary:
        `Location: ${location?.name ?? this.ms.locationId}. ` +
        `Turn ${this.ms.turnCount}. ` +
        `Present: ${presentNpcs.length ? presentNpcs.join(", ") : "no one"}. ` +
        `Items here: ${roomItems.length ? roomItems.join(", ") : "none"}. ` +
        `Inventory: ${inv.length ? inv.join(", ") : "empty"}.`,
      details: {
        locationId: this.ms.locationId,
        turnCount: this.ms.turnCount,
        presentNpcIds: roomEntities.filter((e) => NPC_IDS.has(e)),
        roomItemIds: roomEntities.filter((e) => ITEM_IDS.has(e)),
        inventory: this.ms.inventory,
        relations: this.ms.relations,
        flags: this.ms.flags,
        lastProse: this.ms.lastProse,
      },
      verbCount: verbs.length,
    };
  }

  async invokeVerb(name: string, args?: Record<string, unknown>): Promise<InvocationResult> {
    const text = verbToPlayerText(name, args);
    if (text == null) {
      return { ok: false, error: `unknown verb "${name}"` };
    }
    const msg: Message = {
      anonymizedId: "0",
      content: text,
      isBot: false,
      promptForId: "1",
      identity: "12345",
      isMain: true,
    };
    try {
      const resp = await this.beforePrompt(msg);
      return {
        ok: resp?.error == null,
        message: text,
        prose: this.currentProse,
        error: resp?.error ?? undefined,
        messageState: resp?.messageState,
        chatState: resp?.chatState,
      };
    } catch (err) {
      const e = err as Error;
      return { ok: false, error: `beforePrompt threw: ${e.message}` };
    }
  }

  /** Render-side wrapper: derive button entries from availableVerbs and
   *  wire each onClick to invokeVerb. */
  private deriveVerbs(): VerbEntry[] {
    const verbs = this.availableVerbs();
    return verbs
      .filter((v) => v.name !== "freeform") // freeform is the text input, not a button
      .map((v) => ({
        id: v.name,
        label: v.label ?? v.name,
        enabled: v.enabled !== false && !this.isProcessing,
        hint: v.description,
        onClick: () => { void this.invokeVerb(v.name); },
      }));
  }

  render(): ReactElement {
    const location = world.getRoom(this.ms.locationId) ?? { id: this.ms.locationId, name: this.ms.locationId, description: "", exits: {} };
    const roomEntities = world.entitiesAt(this.ms.locationId).filter(e => e !== "player");

    const presentNpcs = roomEntities.filter(e => NPC_IDS.has(e)).map((id) => {
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

          {/* Freeform input — routes through StageIntrospect.invokeVerb,
              which synthesises a Message and calls beforePrompt directly.
              In a Chub-hosted deploy, this duplicates the chat box; here
              it gives the stage a self-contained input path (also used by
              scripts/explore-stage.mjs via the "freeform" verb). */}
          <FreeformInput
            disabled={this.isProcessing}
            placeholder="Or type anything…"
            onSubmit={(text) => { void this.invokeVerb("freeform", { text }); }}
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
