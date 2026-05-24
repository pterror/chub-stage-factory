# Prior-Art Mining: TiTS & Lilith's Throne scene systems

> Mined 2026-05-24 as prior art for chub-stage-factory primitives library.
> Captured verbatim from the mining run; informs the Wave 2A `scene.ts` primitive design.

---

Both repos cloned to `/tmp/scene-research/{LT,TiTS}/`. LT is Java; TiTS is ActionScript 3. Their architectures are radically different — LT is engine-driven combinatoric dispatch, TiTS is hand-written branching prose. Both are useful as opposite poles.

## 1. Scene authoring shape

**LT.** Scenes are not data; they are Java classes. Each "action" is a `SexAction` subclass anonymously instantiated as a `public static final` field. See `/tmp/scene-research/LT/src/com/lilithsthrone/game/sex/sexActions/baseActions/PenisVagina.java:53` — `TEASE_PENIS_OVER_VAGINA = new SexAction(...) { @Override public String getDescription() { … } }`. There are ~60 files in `sexActions/baseActions/` named by part-pair (`ClitAnus.java`, `PenisMouth.java`, `FingerVagina.java`…). Each file holds many `SexAction` instances for that part-pair (tease/insert/thrust/withdraw/orgasm).

**TiTS.** Scenes are flat AS3 functions in `/tmp/scene-research/TiTS/includes/*.as` (~48 files at top level, plus zone subdirs `mhenga/`, `myrellion/`…). Pattern: `public function vaginalFap():void { clearOutput(); output("…"); … addButton(…); }`. See `/tmp/scene-research/TiTS/includes/masturbation.as:660` for `vaginalFap()`. Every scene is bespoke prose with inline body-part guards (`if(pc.hasVagina())`). No engine-level scene composition.

## 2. Combinatorics resolution

**LT.** Driven by `Sex.java` (`/tmp/scene-research/LT/src/com/lilithsthrone/game/sex/Sex.java`, ~9k lines). The action menu is computed each turn by iterating *every* registered `SexAction`, checking `isBaseRequirementsMet()` plus position-level `isActionBlocked()` (`AbstractSexPosition.java:91`). Position routing is via slot-pair lookup: `getSexInteractions(slotA, slotB)` returns the legal action preset pair (`AbstractSexPosition.java:32-37` docstring). Within an action, output is selected by a `switch(SexPace)` over 6 paces, each branch calling `UtilText.returnStringAtRandom(...)` over 3 prose variants — see `PenisVagina.java:84-110`. So the resolution shape is: **(slot×slot) → action set → action.isApplicable(actor,target) → switch(pace) → random(prose[])**.

**TiTS.** No dispatch table. Each scene is its own decision tree of `if(pc.hasCock() && pc.cockTotal() >= 2)` predicates (`/tmp/scene-research/TiTS/includes/masturbation.as:180+`). Scene selection happens at menu construction: `availableFaps()` returns an array of `FapCommandContainer{text, func}`, each gated by a hand-written body predicate (`masturbation.as:108-340`). Combinatorial coverage is paid for in author labor, not engine.

## 3. Body-part scoping

**LT.** Two enums — `SexAreaPenetration` and `SexAreaOrifice` — both implement `SexAreaInterface` (`/tmp/scene-research/LT/src/com/lilithsthrone/game/sex/SexAreaInterface.java`). The interface is small: `isOrifice()`, `getName(owner)`, `isFree(owner)`, `getRelatedCoverableArea(owner)`, `getRelatedInventorySlot(owner)`, `getSexDescription(pastTense, performer, performerPace, target, targetPace, targetArea)`. `SexType` (`SexType.java:23`) is just `(participant, performingArea, targetedArea)` — exactly the `(actor, verb-as-area-pair)` shape you want. Body parts elsewhere live as enum-valued fields on `Body` (`PenisType`, `VaginaType`, modifiers like `OrificeModifier`, `Capacity`).

**TiTS.** Method-based: `pc.hasCock()`, `pc.hasVagina()`, `pc.hasCuntTail()`, `pc.hasTailCock()`, `pc.cockTotal()`, `pc.biggestTitSize()`, `pc.cockThatFits(capacity)`. No tag system — exhaustive boolean accessors on `Creature.as`. This is the messy way.

## 4. Consent / agency modeling

**LT.** Consent is *layered*: (a) `SexControl` enum (`SexControl.java`) gates *what* an actor can do — `NONE`/`SELF`/`ONGOING_ONLY`/`ONGOING_PLUS_LIMITED_PENETRATIONS`/`FULL`. (b) `SexPace` (`SexPace.java`) carries *willingness* — `SUB_RESISTING`, `SUB_NORMAL`, `SUB_EAGER`, `DOM_GENTLE`, `DOM_NORMAL`, `DOM_ROUGH`. Submissive vs dominant flips prose entirely (see `PenisVagina.java:84-130`). (c) Per-sex flag `selfActionsBlockedPlayer/Partner` (`SexFlags.java:17`). (d) Engine-level guard at `Sex.java:403` auto-bans rape-play at scene start to avoid jarring resistance with no setup.

**TiTS.** Effectively binary at the boundary: `configFemZilFight(consensual:Boolean)` (`/tmp/scene-research/TiTS/includes/mhenga/zilFemale.as:139`) picks which prose function runs. No engine concept of consent — it's just which `addButton` was clicked.

## 5. Pose / position

**LT.** First-class: `AbstractSexPosition` + `SexSlot` (`positions/slots/`: `SexSlotAgainstWall`, `AllFours`, `BreedingStall`, `Stocks`, `LyingDown`, `Sitting`, `Standing`…). Each character occupies a `SexSlot`; the position holds `Map<GameCharacter, SexSlot>`. Slots carry `SexSlotTag`s. Action legality is `(slotA, slotB) → SexActionPresetPair` (see `AbstractSexPosition.java:32-37` JavaDoc). Transitions: actions of `SexActionType.POSITIONING` (in `baseActionsMisc/PositioningMenu`) mutate the slot map. Position-dependent prose is implicit because actions are scoped per position via `getPositioningClasses()` / `getSpecialClasses()` (`AbstractSexPosition.java:73-79`).

**TiTS.** No pose model. Poses are sentences inside prose ("rolled onto her back", "all fours") and persist only in the author's head.

## 6. Intensity / escalation

**LT.** Multi-axis: `SexPace` (per-character, mutable mid-scene); per-character `ArousalLevel`/`LustLevel`; `ArousalIncrease.THREE_NORMAL` etc. attached to every `SexAction` (`PenisVagina.java:56` — third+fourth ctor args). Orgasm fires at arousal cap, gated by `mutualOrgasmsAllowed` (`SexFlags.java:20`). Escalation comes from arousal monotone + pace transitions + ongoing-action tracking (`Main.sex.getOngoingActionsMap(receiver)`).

**TiTS.** Per-scene `pc.lust()` increments inline (`masturbation.as:524: pc.lust(5)`), then `pc.orgasm()` called at scene end (`masturbation.as:620`). No engine-level escalation curve.

## 7. Items / props in scope

**LT.** Each `SexAreaInterface` exposes `getRelatedInventorySlot(owner)` and `getRelatedCoverableArea(owner)` (`SexAreaInterface.java:21`), so clothing displacement is auto-queryable. `AbstractClothing` + `DisplacementType` enum drive scene-time strip-state. Items used as toys appear as ongoing-action targets.

**TiTS.** Item-scoped scenes: `if (pc.hasItem(new MagicMilker(), 1))` (`masturbation.as:22`). The item *is* the scene branch. No abstraction.

## 8. Multi-actor scenes

**LT.** Position holds N slots (`maximumSlots` on `AbstractSexPosition`). Action prose handles 3rd-party via `[npc3.…]` parser tokens. See `PenisVagina.java:32` — `getOngoingCharacters(receiver)` queries who is also penetrating; the DP fork is the `if(!getOngoingCharacters(...).isEmpty())` branch in `getDescription()` (line 78), which then parses with a 3-character context list `Util.newArrayListOfValues(performer, target, getPrimaryDPPerformer(target))`. The matrix extends via the "ongoing action map": `Map<receiver, Map<orifice, Map<performer, penetration>>>`.

**TiTS.** Hand-written. Threesome scenes are separate functions (`tailCockCeliseFaps`, `masturbation.as:638`). No matrix.

## 9. Outcome / consequence

**LT.** Hooked at scene-end. `Sex.endSex()` (`Sex.java:1035`) calls `applyEndSexEffects()` (line 1453) which walks orgasm/cum data and triggers pregnancy, stretching (`getEndSexStretchingDescription`, line 1267), affection changes (`removeEndSexAffection`, line 282), then each NPC's `((NPC)participant).endSex()` (line 1222). Pregnancy uses cum tracked per-orifice during sex.

**TiTS.** Inline at end of scene function: `processTime(45 + rand(5)); pc.orgasm(); celise.orgasm();` then `addButton(0,"Next",mainGameMenu)` (`masturbation.as:644`). Pregnancy is dispatched through `BasePregnancyHandler` subclasses (`/tmp/scene-research/TiTS/classes/GameData/Pregnancy/Handlers/`) — each species has its own handler registered to `PregnancyManager`. This *is* a clean post-hook pattern worth porting.

## 10. REUSABLE patterns

- **`SexType = (participant, performingArea, targetedArea)` as the verb tuple.** This *is* your `(actor, target, verb)`. Adopt directly (`SexType.java:23`).
- **`SexAreaInterface` with `isOrifice/isPenetration`, `getRelatedCoverableArea`, `getRelatedInventorySlot`.** Tag-driven analog already matches our `tags.ts` — body parts expose enough metadata that scene logic queries the tag, not the part identity.
- **Slot-pair → action-set dispatch** (`AbstractSexPosition.java:32`). Generalize: `(poseSlot(actor), poseSlot(target)) → ActionSet`. Cleaner than "what poses exist" — the position *is* the slot map.
- **`SexPace` as orthogonal axis to action.** Each action carries one `getDescription()` with `switch(pace)` inside. Adopt as `Intensity × Pace` enum independent of verb.
- **`returnStringAtRandom(a, b, c)` over 3 prose variants per (action × pace).** Cheap variety; deterministic seed makes it testable.
- **`SexControl` ladder** for what an actor *can do* vs what they *want to do* — split agency-capability from agency-willingness.
- **Ongoing-action map** `Map<receiver, Map<orifice, Map<performer, penetration>>>` — exact data structure for DP/multi-actor matrix extension (`PenisVagina.java:36, 49`).
- **Per-scene flags map** `Map<String, Integer> genericFlags` (`SexFlags.java:21`) — escape hatch for scene-specific bookkeeping without bloating the schema.
- **TiTS `BasePregnancyHandler` registry.** Decouple consequence-type from scene; each handler subscribes to "cum-in-orifice" events. Port as post-scene reducer plugins.
- **TiTS `FapCommandContainer{text, func, ttHeader, ttBody}`** — menu entries as data, including tooltip. Useful for editor UI.
- **LT scene-end pipeline**: stretching → affection → pregnancy → per-NPC `endSex()` (`Sex.java:1035-1453`). A clear post-hook ordering convention.

## 11. NOT REUSABLE

- **One Java file per part-pair (`PenisVagina.java`, `FingerAnus.java`…).** 60-file fan-out is a maintenance scar of static-class dispatch; in TS we'd use a tagged registry.
- **LT's monolithic `Sex.java` (9k+ lines, 80+ imports).** All state and dispatch in one god-object — exactly what tags+registry aim to dissolve.
- **`SexFlags.java:25-50` named-character flags** (`braxCumOnChest`, `pixDemandedPromise`). Per-NPC engine fields are hardcoded gameplay; keep as scene-local data.
- **TiTS's inline-everything style.** `pc.hasCock() && !pc.isTaur() && pc.cockThatFits(...)` chains embed taxonomy in prose. Anti-pattern for a primitive.
- **AS3 `output()`-as-side-effect.** Scenes-as-effectful-functions don't compose. Return structured outcome instead.
- **LT's `[npc.her]` / `[npc2.namePos]` string-template parser.** Useful idea, but their implementation (`UtilText.parse`, `ParserTag`) is heavily coupled to `GameCharacter`. Reimplement the *concept* (positional actor pronoun slots) cleanly.
- **`CorruptionLevel.ONE_VANILLA` thresholds on actions** (`PenisVagina.java:55`). Embedding morality scoring in the action constructor pins kink politics into the primitive — leave that to the consumer.
- **LT's `Class<?>` lists for position composition** (`AbstractSexPosition.java:50-51`). Reflection-as-config; we can use plain tag arrays.
- **TiTS per-species handler classes for pregnancy.** Right *shape* (post-hook), wrong *granularity* (subclassing) — port as registered functions, not subclasses.
- **`SexParticipantType.NORMAL/CATCHER/PITCHER`** enum is too LT-specific; the participant role belongs to pose/slot, not to verb.

Sources: Innoxia/liliths-throne-public, LordSembor/Trials-in-Tainted-Space.
