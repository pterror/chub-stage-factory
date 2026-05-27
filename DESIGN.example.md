# DESIGN — example (inventory / Pak the shopkeeper)

> This is a filled-in example of `DESIGN.md` using the `examples/inventory`
> stage as the case study. Use it as a reference when filling in your own
> `DESIGN.md`. The headings below match `DESIGN.md` exactly.

---

## Identity

| Field | Value |
|-------|-------|
| Name | Pak's Stall |
| Tagline | A secondhand shop with a very particular shopkeeper |
| Tags | slice-of-life, inventory, shopkeeper, cozy |
| Visibility | PUBLIC |
| Position | ADJACENT |

## Concept

Pak is a pack-rat shopkeeper running a cramped secondhand stall. The player
character is a regular — they browse, chat, sometimes pick things up or trade.
Pak fusses over the stall's state: nothing goes missing without him noticing,
and the disorder of each spot telegraphs how rushed the day has been.

The experience is low-stakes and grounded: object permanence is the mechanic.
The player can trust that if they set something on the counter, it will still
be there on the next message. The LLM gets an authoritative JSON observation
block; it writes the prose. No combat, no urgency — just a place to be.

## User-facing UI

A monospace sidebar panel listing every spot (counter, under-counter,
hanging-hook, back-room, pak-pocket) with the items currently there, their
stack counts, and an accessibility score (0–1) that reflects spot disorder and
time since last interaction. Rendered by `InventoryStage.render()`.

No interactive controls — the panel is read-only. The player acts through
natural-language chat; the LLM describes Pak moving things in response.

See `examples/inventory/Stage.tsx` lines 77–112 for the render implementation.

## LLM interaction model

- **beforePrompt behavior:** The `inventoryPattern` composer builds a JSON
  observation block describing every spot's contents and accessibility scores.
  It is injected as `stageDirections` via `buildBeforePrompt`. The system prompt
  tells the model the block is ground truth and to translate spot IDs into prose
  (never name them verbatim). See `src/lib/patterns/inventory.ts`.
- **afterResponse behavior:** `bound.afterResponse` advances the tick counter
  (stored in `messageState.ticks`) and writes the updated state back through
  `PersistenceStore`. No parsing of the model's reply — the inventory only
  changes when the stage itself calls `inv.add` / `inv.remove`.
- **Parsing strategy:** None. Inventory mutations are driven by stage logic
  (triggered by user intent already parsed upstream), not by extracting tags
  from the model's reply.
- **Error handling:** If `messageState` is missing or malformed on load, the
  constructor re-registers all items from scratch (no `??` panic). The
  `PersistenceStore` treats a missing shard as the empty initial state.

## State

### initState (immutable, set at chat creation)

| Field | Type | Meaning |
|-------|------|---------|
| *(none)* | — | initState is null; all state is per-message or per-chat |

### messageState (per-message, rewindable)

| Field | Type | Meaning |
|-------|------|---------|
| `ticks` | `number` | Turn counter; drives accessibility decay |
| *(inventory snapshot)* | `unknown` | Serialised `Inventory` via the `inv` shard |

The `inv` shard uses `chubTreeHistory()` so swipe-to-branch correctly forks
the inventory — exploring alternate item movements is a first-class affordance.

### chatState (per-chat, not rewindable)

| Field | Type | Meaning |
|-------|------|---------|
| *(none)* | — | chatState is null for this example |

## Config (user-tweakable)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| *(none)* | — | — | No user-facing config in the inventory example |

## Primitives used

| Primitive | Used for |
|-----------|----------|
| `Inventory` (`src/lib/inventory.ts`) | Spot/item/stack management, accessibility scoring |
| `inventoryPattern` (`src/lib/patterns/inventory.ts`) | Composer: wires `Inventory` → `PersistenceStore` → observation block |
| `withPersistence` (`src/lib/persistence/with-persistence.ts`) | HOC eliminating `load` / `setState` boilerplate |
| `mergeResponses` (`src/lib/persistence/chub.ts`) | Merges `beforePrompt` / `afterResponse` return values |

Recipe (closest): **inventory** (`src/lib/PATTERNS.md` §1)

## Test scenarios

1. **Initial load** — `test-init.json` has no prior `messageState`. After
   `load()`, the counter should have brass-compass + ledger; under-counter
   should have 4 ration bars; hanging-hook should have the lantern.
2. **Spot disorder visible** — `under-counter` has `disorder: 0.5`. The
   accessibility score for the ration bar should be noticeably lower than the
   accessibility score for the lantern on the clean hanging-hook.
3. **State round-trips** — serialise `messageState` after one tick, pass it
   back as `InitialData.messageState`, call `load()` again. The inventory
   contents and tick counter should be identical.

## Out of scope

- Player picking up / dropping items via parsed LLM output. All mutations are
  stage-driven; this example does not parse the model's reply.
- Trade or economy mechanics (prices, currency).
- Multi-scene or location transitions (`resolveLeaveLocation` is not called).

## Open decisions resolved in Phase 1

- **Persist on messageState, not chatState** — using `chubTreeHistory()` so
  swipe-based branching works. If the player backtracks a message, the
  inventory reverts. Chosen because item position is a conversation-scoped fact
  (like dialogue), not a permanent-world fact.
- **No config** — disorder values and item registration are authored directly
  in `Stage.tsx`. A config surface would only be useful once the stage ships
  as a reusable template, which is out of scope for a reference example.
- **LLM never names spot IDs** — `STAGE_DIRECTIONS.prefix` instructs the model
  to translate ("under the counter" not "under-counter"). Enforced by prompt
  convention, not parsing.
