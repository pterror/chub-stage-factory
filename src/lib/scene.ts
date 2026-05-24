/*
 * scene.ts — combinatoric action composition for erotic-RPG-shape stages.
 *
 * WHAT: A `Scene` is the runtime instance of a multi-actor scene. Participants
 *       occupy `SceneSlot`s in a `ScenePosition` map; each actor has a `Pace`
 *       (willingness register) and `Agency` (capability ladder). A tagged
 *       `Registry<SceneActionDef>` is the action catalog — each action declares
 *       its `(performingArea, targetedArea)` pair as data and gates legality
 *       through a `Predicate<SceneState>`. `availableActions(performer,
 *       receiver, registry, body)` walks the registry and returns the legal
 *       subset. `perform(act, receiver, def, rng, timeline)` executes the act:
 *       writes the ongoing-action matrix (LT's 3-level nested map), selects
 *       pace-keyed prose with positional role substitution, applies an
 *       arousal delta to the receiver, pushes a `SceneEvent` to the supplied
 *       Timeline, and returns a structured `SceneOutcome`. `tick(now,
 *       effects)` advances arousal trajectories, fires orgasm events when
 *       caps are crossed, and returns the events for the caller to dispatch.
 *
 *       `SceneConsequenceRegistry` is the post-hook layer. Handlers register
 *       for a `SceneEvent["kind"]` at a priority; emission walks them in
 *       priority order (lower fires first), then by registration order
 *       within a priority. Default priorities follow LT's `Sex.endSex`
 *       ordering: stretching=10, affection=20, pregnancy=30, per-NPC=40.
 *
 * WHY: Erotic-RPG scene composition is the most under-theorized axis in the
 *      catalog; only deep prior art exists in messy game sources. LT proves
 *      that (slot × slot) → action set → switch(pace) → returnStringAtRandom
 *      generalizes; TiTS proves that hand-written prose-with-inline-guards
 *      does not. We adopt LT's data shapes (`SexType` verb tuple, ongoing
 *      DP matrix, `SexPace`/`SexControl` orthogonal axes, `genericFlags`
 *      escape hatch) and reject its execution shape (one Java file per
 *      part-pair, 9k-line `Sex.java` god-object, `UtilText.parse` coupled
 *      to `GameCharacter`).
 *
 *      Rule #1 (tag-based identity): `AreaTag` is a string tag. Rule #2
 *      (def/instance): `SceneActionDef` is the def, `SceneAct` is the
 *      verb instance, `Scene` is the runtime holder. Rule #3 (detect vs
 *      resolve): `availableActions` returns the legal set; the caller
 *      decides what to present. Rule #9 (stage→LLM bridge): scene state
 *      surfaces through Timeline + ObservationSource without hand-wiring.
 *
 * SHAPE:
 *   type AreaTag = string
 *   type ActorRef = "self" | "partner" | "player" | { id }
 *   interface SceneAct { participant; performingArea; targetedArea }
 *   enum Pace { SubResisting, SubNormal, SubEager, DomGentle, DomNormal, DomRough }
 *   enum Agency { None, Self, OngoingOnly, Partial, Full }
 *   interface SceneSlot { id; tags: AreaTag[] }
 *   type ScenePosition = Map<ActorId, SceneSlot>
 *   interface SceneActionDef
 *     { id; performingArea; targetedArea;
 *       requires: Predicate<SceneState>;
 *       prose: Partial<Record<Pace, [string, string, string]>>;
 *       arousalBase?: number; tags?: string[] }
 *   type OngoingMap = Map<ActorId, Map<AreaTag, Map<ActorId, SceneAct>>>
 *   interface SceneState
 *     { participants; ongoing; pace; agency; arousal; flags; tick }
 *   interface SceneOutcome { prose; arousalDelta; orgasm; events }
 *   type SceneEvent
 *     | { kind: "act-performed"; performer; receiver; def; pace }
 *     | { kind: "orgasm"; actor; cumData? }
 *     | { kind: "pace-changed"; actor; from; to }
 *     | { kind: "scene-ending"; reason }
 *   class Scene implements ObservationSource<unknown>
 *     constructor(position, agency, pace)
 *     state: SceneState
 *     availableActions(performer, receiver, registry, body): SceneActionDef[]
 *     perform(act, receiver, def, rng, timeline): SceneOutcome
 *     withdraw(performer, receiver, targetedArea): boolean
 *     tick(now, effects?): SceneEvent[]
 *     reposition(actorId, slot): void
 *     setPace(actorId, pace, timeline?): void
 *     toJSON(); static fromJSON(data)
 *   class SceneConsequenceRegistry
 *     on(event, handler): this
 *     onWithPriority(event, priority, handler): this
 *     emit(evt, scene): void
 *   renderProse(template, roles): string
 */

import type { Body } from "./body";
import type { EffectStore } from "./effects";
import type { ActorRef, Predicate, Refs, Resolvers } from "./predicate";
import { evaluate as evalPredicate } from "./predicate";
import type { Registry } from "./registry";
import type { RngStream } from "./rng";
import type { Timeline } from "./timeline";
import type { Channel, Evaluator, Key, ObservationSource } from "./observation";

export type AreaTag = string;
export type ActorId = string;

/** Re-export of `ActorRef` from predicate.ts for ergonomic imports. */
export type { ActorRef };

/** LT's `SexType` — the verb tuple. Data, not class; freely serializable. */
export interface SceneAct {
  participant: ActorRef;
  performingArea: AreaTag;
  targetedArea: AreaTag;
}

/** LT's `SexPace` — orthogonal to verb. Drives prose register. Mutable per
 *  actor mid-scene. */
export enum Pace {
  SubResisting = "sub-resisting",
  SubNormal = "sub-normal",
  SubEager = "sub-eager",
  DomGentle = "dom-gentle",
  DomNormal = "dom-normal",
  DomRough = "dom-rough",
}

/** LT's `SexControl` — capability to act, distinct from willingness (`Pace`). */
export enum Agency {
  None = "none",
  Self = "self",
  OngoingOnly = "ongoing-only",
  Partial = "partial",
  Full = "full",
}

/** Pose slot. Pure data; promote to a class only if slot-presets gain
 *  behavior (see design doc open question). */
export interface SceneSlot {
  id: string;
  tags: AreaTag[];
}

export type ScenePosition = Map<ActorId, SceneSlot>;

/** Tagged-registry entry. Authored as data; legality is a `Predicate`,
 *  not a method. */
export interface SceneActionDef {
  id: string;
  performingArea: AreaTag;
  targetedArea: AreaTag;
  /** Predicate over `SceneState` — evaluated with `Refs{self=performer,
   *  partner=receiver}` and the scene's resolvers. AND with the engine's
   *  built-in agency + ongoing checks; the predicate is the stage-author
   *  layer. */
  requires?: Predicate<SceneState>;
  /** Pace-keyed prose; each entry is 3 variants for
   *  `returnStringAtRandom`. Stage may omit paces it doesn't author —
   *  unauthored paces fall back to nearest. */
  prose: Partial<Record<Pace, [string, string, string]>>;
  /** Magnitude added to the receiver's arousal on perform. 0..1 scale. */
  arousalBase?: number;
  /** Free-form tags: "penetrative", "oral", "anal", "toy-use", etc. */
  tags?: string[];
}

/** LT's 3-level nested ongoing-action map. Get(receiver) → Map<area,
 *  Map<performer, SceneAct>>. Enables `getOngoingCharacters(receiver,
 *  area)` queries without flat-key scans. */
export type OngoingMap = Map<ActorId, Map<AreaTag, Map<ActorId, SceneAct>>>;

export interface SceneState {
  participants: ScenePosition;
  ongoing: OngoingMap;
  pace: Map<ActorId, Pace>;
  agency: Map<ActorId, Agency>;
  /** 0..1; crossing 1 fires `orgasm` event in `tick` and clamps to 0. */
  arousal: Map<ActorId, number>;
  /** LT's `genericFlags` escape hatch — stage-specific bookkeeping without
   *  schema bloat. */
  flags: Map<string, number>;
  /** Monotonic tick counter; useful as deterministic prose-variant key. */
  tick: number;
}

export interface SceneOutcome {
  prose: string;
  arousalDelta: number;
  orgasm: boolean;
  events: SceneEvent[];
}

export interface OrgasmCumData {
  orifice: AreaTag;
  volume: number;
}

export type SceneEvent =
  | {
      kind: "act-performed";
      performer: ActorId;
      receiver: ActorId;
      def: SceneActionDef;
      pace: Pace;
    }
  | { kind: "orgasm"; actor: ActorId; cumData?: OrgasmCumData }
  | { kind: "pace-changed"; actor: ActorId; from: Pace; to: Pace }
  | { kind: "scene-ending"; reason: "natural" | "interrupted" };

/* ──────────────────────────────────────────────────────────────────────
 * Prose template resolver
 *
 * Positional role substitution. Templates reference role names
 * (`{performer.pronoun}`, `{receiver.name}`), not raw class paths.
 * Coupling to a `GameCharacter` shape (LT's `ParserTag`) is the
 * anti-pattern; here roles are a plain `Record<string, Record<string,
 * string>>` the caller supplies.
 *
 * Syntax: `{role}` → `roles[role]` (toString if non-string)
 *         `{role.field}` → `roles[role][field]`
 * Unresolved references pass through verbatim — failing loudly via
 * visible braces beats silently dropping prose chunks.
 * ────────────────────────────────────────────────────────────────────── */

export type ProseRoles = Record<string, Record<string, string> | string>;

const TEMPLATE_RE = /\{([a-zA-Z0-9_]+)(?:\.([a-zA-Z0-9_]+))?\}/g;

export function renderProse(template: string, roles: ProseRoles): string {
  return template.replace(TEMPLATE_RE, (whole, role: string, field?: string) => {
    const r = roles[role];
    if (r === undefined) return whole;
    if (typeof r === "string") return field === undefined ? r : whole;
    if (field === undefined) {
      // bare {role} on an object — emit the "name" field if present.
      return r.name ?? whole;
    }
    const v = r[field];
    return v === undefined ? whole : v;
  });
}

/* ──────────────────────────────────────────────────────────────────────
 * Pace fallback ladder
 *
 * Authors may write prose for only the paces they care about. When a pace
 * isn't authored, fall to the nearest neighbor on the sub→dom continuum.
 * ────────────────────────────────────────────────────────────────────── */

const PACE_ORDER: Pace[] = [
  Pace.SubResisting,
  Pace.SubNormal,
  Pace.SubEager,
  Pace.DomGentle,
  Pace.DomNormal,
  Pace.DomRough,
];

function resolveProseForPace(
  prose: Partial<Record<Pace, [string, string, string]>>,
  pace: Pace,
): [string, string, string] | null {
  if (prose[pace]) return prose[pace]!;
  const idx = PACE_ORDER.indexOf(pace);
  if (idx < 0) return null;
  // Spiral outward.
  for (let d = 1; d < PACE_ORDER.length; d++) {
    const left = idx - d;
    const right = idx + d;
    if (left >= 0 && prose[PACE_ORDER[left]]) return prose[PACE_ORDER[left]]!;
    if (right < PACE_ORDER.length && prose[PACE_ORDER[right]])
      return prose[PACE_ORDER[right]]!;
  }
  return null;
}

/* ──────────────────────────────────────────────────────────────────────
 * Agency gate
 *
 * Maps `Agency` capability ladder to "may this performer initiate THIS
 * action right now?" — taking into account whether the act extends an
 * already-ongoing action (continuation is allowed under `OngoingOnly`).
 * ────────────────────────────────────────────────────────────────────── */

function isOngoing(
  state: SceneState,
  performer: ActorId,
  receiver: ActorId,
  targetedArea: AreaTag,
): boolean {
  return Boolean(state.ongoing.get(receiver)?.get(targetedArea)?.get(performer));
}

function agencyPermits(
  agency: Agency,
  performer: ActorId,
  receiver: ActorId,
  def: SceneActionDef,
  state: SceneState,
): boolean {
  switch (agency) {
    case Agency.None:
      return false;
    case Agency.Self:
      return performer === receiver;
    case Agency.OngoingOnly:
      return isOngoing(state, performer, receiver, def.targetedArea);
    case Agency.Partial:
      // Permitted if not a fresh penetrative initiation, or if already ongoing.
      if (isOngoing(state, performer, receiver, def.targetedArea)) return true;
      return !(def.tags?.includes("penetrative") ?? false);
    case Agency.Full:
      return true;
  }
}

/* ──────────────────────────────────────────────────────────────────────
 * Scene
 * ────────────────────────────────────────────────────────────────────── */

export interface SceneInit {
  position: ScenePosition;
  agency: Map<ActorId, Agency>;
  pace: Map<ActorId, Pace>;
  arousal?: Map<ActorId, number>;
  flags?: Map<string, number>;
  /** Resolvers passed to `evalPredicate` when checking `SceneActionDef.requires`.
   *  The engine fills `getTag` from `Body.getEffectiveTags` automatically when
   *  the per-actor body map is supplied to `availableActions`; other resolver
   *  hooks are stage-author concern. */
  resolvers?: Resolvers<SceneState, ActorId>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class Scene implements ObservationSource<any> {
  readonly state: SceneState;
  /** Stage-author resolvers for non-tag predicate kinds; tag-on is filled
   *  automatically from the per-call body map. */
  resolvers: Resolvers<SceneState, ActorId>;

  // ObservationSource fields.
  readonly id: string = "scene";
  readonly channels: Channel[] = ["interoceptive", "visual"];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly salience: Evaluator<any, number>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly properties: Record<Channel, Record<Key, Evaluator<any>>>;

  constructor(init: SceneInit) {
    this.state = {
      participants: new Map(init.position),
      ongoing: new Map(),
      pace: new Map(init.pace),
      agency: new Map(init.agency),
      arousal: new Map(init.arousal ?? []),
      flags: new Map(init.flags ?? []),
      tick: 0,
    };
    for (const id of this.state.participants.keys()) {
      if (!this.state.arousal.has(id)) this.state.arousal.set(id, 0);
    }
    this.resolvers = init.resolvers ?? {};

    this.salience = () => {
      if (this.state.participants.size === 0) return 0;
      let maxA = 0;
      for (const v of this.state.arousal.values()) if (v > maxA) maxA = v;
      // Mid-scene: floor of 0.4 so it doesn't vanish at start; arousal raises it.
      return Math.min(1, 0.4 + 0.6 * maxA);
    };
    this.properties = {
      interoceptive: {
        arousal: () => Object.fromEntries(this.state.arousal),
        pace: () => Object.fromEntries(this.state.pace),
      },
      visual: {
        participants: () =>
          [...this.state.participants.entries()].map(([id, slot]) => ({
            id,
            slot: slot.id,
            slotTags: slot.tags,
          })),
        ongoing: () => serializeOngoing(this.state.ongoing),
      },
    };
  }

  /** Walk the registry; return defs whose area pair, agency gate, and
   *  `requires` predicate all pass for `(performer, receiver)`. The per-actor
   *  body map supplies tag-on resolution; pass an empty map to skip body-tag
   *  predicates. */
  availableActions(
    performer: ActorId,
    receiver: ActorId,
    registry: Registry<SceneActionDef>,
    body: Map<ActorId, Body>,
  ): SceneActionDef[] {
    const performerAgency = this.state.agency.get(performer) ?? Agency.None;
    const refs: Refs<ActorId> = { self: performer, partner: receiver };
    const resolvers = this.buildResolvers(body);
    const out: SceneActionDef[] = [];
    for (const def of registry.values()) {
      if (!agencyPermits(performerAgency, performer, receiver, def, this.state))
        continue;
      // Body-tag gate: performer must expose the performingArea tag on some
      // slot; receiver must expose the targetedArea tag. Skipped when no
      // body provided for that actor.
      const pb = body.get(performer);
      if (pb && !actorHasAreaTag(pb, def.performingArea)) continue;
      const rb = body.get(receiver);
      if (rb && !actorHasAreaTag(rb, def.targetedArea)) continue;
      if (def.requires) {
        if (!evalPredicate(def.requires, this.state, refs, resolvers)) continue;
      }
      out.push(def);
    }
    return out;
  }

  /** Execute an act. Writes the ongoing map, selects pace-keyed prose,
   *  applies arousal delta to the receiver, pushes a Timeline event, and
   *  returns a structured outcome. */
  perform(
    act: SceneAct,
    receiver: ActorId,
    def: SceneActionDef,
    rng: RngStream,
    timeline: Timeline<SceneEvent>,
    roles?: ProseRoles,
  ): SceneOutcome {
    const performer = refToId(act.participant, receiver);
    // Write the ongoing matrix.
    let byArea = this.state.ongoing.get(receiver);
    if (!byArea) {
      byArea = new Map();
      this.state.ongoing.set(receiver, byArea);
    }
    let byPerformer = byArea.get(act.targetedArea);
    if (!byPerformer) {
      byPerformer = new Map();
      byArea.set(act.targetedArea, byPerformer);
    }
    byPerformer.set(performer, act);

    // Apply arousal delta to receiver. Clamp at [0, 1] — orgasm fires in tick.
    const base = def.arousalBase ?? 0;
    const prev = this.state.arousal.get(receiver) ?? 0;
    const next = Math.min(1, Math.max(0, prev + base));
    this.state.arousal.set(receiver, next);

    // Prose selection: switch(pace) → returnStringAtRandom over 3 variants.
    const pace =
      this.state.pace.get(performer) ?? this.state.pace.get(receiver) ?? Pace.DomNormal;
    const variants = resolveProseForPace(def.prose, pace);
    let prose = "";
    if (variants) {
      const chosen = variants[rng.range(0, variants.length - 1)];
      prose = renderProse(chosen, roles ?? {});
    }

    const event: SceneEvent = {
      kind: "act-performed",
      performer,
      receiver,
      def,
      pace,
    };
    timeline.push(event);
    this.state.tick += 1;

    return {
      prose,
      arousalDelta: next - prev,
      orgasm: false, // detected/fired in tick, not here
      events: [event],
    };
  }

  /** Remove an ongoing entry (e.g. pull-out). Returns true if anything was
   *  removed. */
  withdraw(performer: ActorId, receiver: ActorId, targetedArea: AreaTag): boolean {
    const byArea = this.state.ongoing.get(receiver);
    const byPerformer = byArea?.get(targetedArea);
    if (!byPerformer?.delete(performer)) return false;
    if (byPerformer.size === 0) byArea!.delete(targetedArea);
    if (byArea!.size === 0) this.state.ongoing.delete(receiver);
    return true;
  }

  /** Advance the scene clock: read sustained-act trajectories from each
   *  actor's EffectStore (if supplied), fire orgasm events on cap crossings,
   *  and return the events fired for the caller to push to Timeline /
   *  dispatch to a `SceneConsequenceRegistry`. */
  tick(now: number, effects?: Map<ActorId, EffectStore>): SceneEvent[] {
    const fired: SceneEvent[] = [];
    // Folder over sustained-act effects: each actor's EffectStore.totalMagnitudes
    // contributes a `stats.arousal` delta per tick. The stage author wires the
    // EffectDef trajectory; the scene just reads the summed magnitude and
    // applies it.
    if (effects) {
      for (const [actorId, store] of effects) {
        const mag = store.totalMagnitudes(now);
        const delta = mag.stats?.arousal ?? 0;
        if (delta === 0) continue;
        const prev = this.state.arousal.get(actorId) ?? 0;
        const next = Math.min(1, Math.max(0, prev + delta));
        this.state.arousal.set(actorId, next);
      }
    }
    // Orgasm detection: cap-cross → fire event + reset arousal + dispel
    // building-arousal effects via the store's tag dispel.
    for (const [actorId, arousal] of this.state.arousal) {
      if (arousal < 1) continue;
      fired.push({ kind: "orgasm", actor: actorId });
      this.state.arousal.set(actorId, 0);
      effects?.get(actorId)?.dispelByTag("building-arousal");
    }
    this.state.tick += 1;
    return fired;
  }

  reposition(actorId: ActorId, slot: SceneSlot): void {
    this.state.participants.set(actorId, slot);
  }

  /** Mutate an actor's Pace and emit a `pace-changed` event for any wiring
   *  that needs it (consequence registry, prose adjustments). Returns the
   *  event so the caller may push to Timeline. */
  setPace(actorId: ActorId, pace: Pace, timeline?: Timeline<SceneEvent>): SceneEvent | null {
    const from = this.state.pace.get(actorId);
    if (from === pace) return null;
    this.state.pace.set(actorId, pace);
    const evt: SceneEvent = {
      kind: "pace-changed",
      actor: actorId,
      from: from ?? Pace.DomNormal,
      to: pace,
    };
    timeline?.push(evt);
    return evt;
  }

  /** Build the predicate resolver bundle. The tag-on resolver is supplied
   *  by the per-call body map; everything else inherits from the
   *  stage-author resolvers passed at construction. */
  private buildResolvers(body: Map<ActorId, Body>): Resolvers<SceneState, ActorId> {
    return {
      ...this.resolvers,
      getTag: (actor: ActorId, tag: string) => {
        const b = body.get(actor);
        if (!b) return false;
        return actorHasAreaTag(b, tag);
      },
      getFlag: (flag: string, state: SceneState) => state.flags.get(flag),
    };
  }

  /** Convenience accessor: who is performing on (receiver, area)? LT's
   *  `getOngoingCharacters` analog; used for DP prose branches. */
  getOngoingPerformers(receiver: ActorId, targetedArea: AreaTag): ActorId[] {
    const byPerformer = this.state.ongoing.get(receiver)?.get(targetedArea);
    return byPerformer ? [...byPerformer.keys()] : [];
  }

  toJSON(): SceneJSON {
    return {
      participants: [...this.state.participants.entries()].map(([id, slot]) => ({
        id,
        slot,
      })),
      ongoing: serializeOngoing(this.state.ongoing),
      pace: Object.fromEntries(this.state.pace),
      agency: Object.fromEntries(this.state.agency),
      arousal: Object.fromEntries(this.state.arousal),
      flags: Object.fromEntries(this.state.flags),
      tick: this.state.tick,
    };
  }

  static fromJSON(
    data: SceneJSON,
    resolvers?: Resolvers<SceneState, ActorId>,
  ): Scene {
    const position: ScenePosition = new Map(
      data.participants.map(({ id, slot }) => [id, slot] as [ActorId, SceneSlot]),
    );
    const scene = new Scene({
      position,
      agency: new Map(Object.entries(data.agency) as [ActorId, Agency][]),
      pace: new Map(Object.entries(data.pace) as [ActorId, Pace][]),
      arousal: new Map(Object.entries(data.arousal)),
      flags: new Map(Object.entries(data.flags)),
      resolvers,
    });
    // Restore ongoing matrix.
    for (const row of data.ongoing) {
      scene.perform; // referenced to keep tree-shake-friendly
      let byArea = scene.state.ongoing.get(row.receiver);
      if (!byArea) {
        byArea = new Map();
        scene.state.ongoing.set(row.receiver, byArea);
      }
      let byPerformer = byArea.get(row.targetedArea);
      if (!byPerformer) {
        byPerformer = new Map();
        byArea.set(row.targetedArea, byPerformer);
      }
      byPerformer.set(row.performer, row.act);
    }
    scene.state.tick = data.tick;
    return scene;
  }
}

/* ──────────────────────────────────────────────────────────────────────
 * Serialization shape
 *
 * Ongoing matrix flattens to a row list for JSON round-trip — the
 * 3-level nested Map doesn't survive `JSON.stringify` cleanly.
 * ────────────────────────────────────────────────────────────────────── */

export interface OngoingRow {
  receiver: ActorId;
  targetedArea: AreaTag;
  performer: ActorId;
  act: SceneAct;
}

export interface SceneJSON {
  participants: { id: ActorId; slot: SceneSlot }[];
  ongoing: OngoingRow[];
  pace: Record<ActorId, Pace>;
  agency: Record<ActorId, Agency>;
  arousal: Record<ActorId, number>;
  flags: Record<string, number>;
  tick: number;
}

function serializeOngoing(map: OngoingMap): OngoingRow[] {
  const out: OngoingRow[] = [];
  for (const [receiver, byArea] of map) {
    for (const [targetedArea, byPerformer] of byArea) {
      for (const [performer, act] of byPerformer) {
        out.push({ receiver, targetedArea, performer, act });
      }
    }
  }
  return out;
}

/* ──────────────────────────────────────────────────────────────────────
 * Helpers
 * ────────────────────────────────────────────────────────────────────── */

function refToId(ref: ActorRef, fallback: ActorId): ActorId {
  if (typeof ref === "string") {
    // "self" / "partner" / "player" — caller MUST resolve; default to fallback.
    return fallback;
  }
  return ref.id;
}

function actorHasAreaTag(body: Body, tag: AreaTag): boolean {
  for (const slot of body.getSlots()) {
    if (body.getEffectiveTags(slot).has(tag)) return true;
  }
  return false;
}

/* ──────────────────────────────────────────────────────────────────────
 * SceneConsequenceRegistry
 *
 * TiTS's `BasePregnancyHandler` pattern, ported as registered functions
 * over typed `SceneEvent`s — NOT subclasses. Default priority slots
 * follow LT's `Sex.endSex` ordering.
 * ────────────────────────────────────────────────────────────────────── */

export type SceneEventHandler = (evt: SceneEvent, scene: Scene) => void;

interface HandlerEntry {
  priority: number;
  /** Monotonic registration counter — preserves registration order within a
   *  priority bucket without depending on Map iteration semantics. */
  seq: number;
  handler: SceneEventHandler;
}

/** Default priorities; lower fires first.
 *  Mirrors LT's `Sex.endSex` pipeline. */
export const CONSEQUENCE_PRIORITY = {
  stretching: 10,
  affection: 20,
  pregnancy: 30,
  perActor: 40,
} as const;

export class SceneConsequenceRegistry {
  private readonly byKind: Map<SceneEvent["kind"], HandlerEntry[]> = new Map();
  private nextSeq = 0;

  on(kind: SceneEvent["kind"], handler: SceneEventHandler): this {
    return this.onWithPriority(kind, CONSEQUENCE_PRIORITY.perActor, handler);
  }

  onWithPriority(
    kind: SceneEvent["kind"],
    priority: number,
    handler: SceneEventHandler,
  ): this {
    const list = this.byKind.get(kind) ?? [];
    list.push({ priority, seq: this.nextSeq++, handler });
    list.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
    this.byKind.set(kind, list);
    return this;
  }

  emit(evt: SceneEvent, scene: Scene): void {
    const list = this.byKind.get(evt.kind);
    if (!list) return;
    for (const entry of list) entry.handler(evt, scene);
  }
}
