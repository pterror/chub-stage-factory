# turnCombatPattern — action + combat-turn + effects + rng + timeline composer

Wires `Combatant[]` + `runRound` + per-combatant `EffectStore` + `Rng` +
`Timeline<CombatEvent>` with split persistence (turn counter on messageState,
combatant HP on chatState + `forbidBranching`). Provides `buildBeforePrompt`
(combat-state observation → stage directions) and `buildAfterResponse`
(action-tag parse → AP reset → effects tick → `runRound` → ended check).

## Purpose

Every turn-combat stage re-derives the same round loop: AP reset → effects tick
→ `runRound` → push events to timeline → check ended → strip tags → merge
system message. `turnCombatPattern` collapses that wiring; the stage keeps only
combatant definitions, action defs, the `chooseFor` callback, and rendering.

## API [`src/lib/patterns/turn-combat.ts`](./turn-combat.ts)

```ts
interface TurnCombatBundleInit {
  messageState: Record<string, string | undefined> | null;
  chatState: Record<string, string | undefined> | null;
  combatants: Combatant[];
  effectDefs: Registry<EffectDef>;
  rngSeed: string;
  chooseFor: (actor: Combatant, world: World) => TurnChoice | null;
  apResets: Record<string, number>;   // AP to restore per combatant id each round
  actionTagName?: string;             // default "action"
  validActions: string[];
  defaultAction: string;
  stageDirections: { architectures?; register?; prefix? };
}

interface TurnCombatBundle {
  combatants: Combatant[];
  combatantsHolder: { cs: Combatant[]; ended?: "pc-down" | "enemy-down" };
  turn: { n: number; choice: string };
  events: Timeline<CombatEvent>;
  rng: Rng;
  layers: ReturnType<typeof createChubLayers>;
  store: PersistenceStore;
  buildBeforePrompt(msg, bound): Promise<Partial<StageResponse<...>>>;
  buildAfterResponse(msg, bound): Promise<Partial<StageResponse<...>>>;
}

function turnCombatPattern(init: TurnCombatBundleInit): TurnCombatBundle
```

- **`chooseFor`** — called once per combatant per round. The `"pc"` branch should read
  `this.p.turn.choice` (the action queued by the previous LLM response).
- **`apResets`** — AP values restored at the start of each round, keyed by `c.id`.
  Combatants not listed keep their current AP.
- **`effectDefs`** — used for `EffectStore.fromJSON` on chatState restore. Must contain
  all effects that can appear on any combatant.
- **`combatantsHolder.ended`** — set to `"pc-down"` or `"enemy-down"` once combat is
  over. `buildAfterResponse` skips `runRound` if `ended` is set.
- Ended detection: `"pc-down"` when the combatant with id `"pc"` reaches `hp <= 0`;
  `"enemy-down"` when all non-`"pc"` combatants are at `hp <= 0`.

## Example

```ts
const combatants = buildCombatants();
const chooseFor = (actor, world) => {
  if (actor.id === "pc") { ... return { action: SWING, target, profile: ATTACK }; }
  ...
};

this.p = turnCombatPattern({
  messageState: ms, chatState: cs, combatants, effectDefs: EFFECT_DEFS,
  rngSeed: "my-scene", chooseFor,
  apResets: { pc: 3, enemy: 2 },
  validActions: ["swing", "guard"], defaultAction: "swing",
  stageDirections: { ... },
});
this.initStore(() => this.p.store);
```

## Gotchas

- `chooseFor` captures `this.p` via closure — define it after `this.p` is assigned.
  The example does this by declaring `chooseFor` before calling `turnCombatPattern`
  and reading `this.p.turn.choice` lazily inside it.
- Combatant state (HP, effects) is persisted on `chatState` with `forbidBranching`.
  A swipe re-narrates the round but does NOT restore HP. This is intentional: the
  duellist is a persistent person.
- The round does not run if `combatantsHolder.ended` is truthy — `buildAfterResponse`
  still strips tags and merges, but skips `runRound`.
