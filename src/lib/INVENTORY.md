# Inventory — spot-based item storage with carry-class semantics

`Inventory` manages items distributed across named spots (`"pocket"`,
`"hand"`, `"backpack-main"`, `"kitchen-counter"`, …). Each spot tracks
disorder and last-access time; together they produce an accessibility
score the stage can threshold or tier.

Used by `actor.ts` and any stage that models item carrying, scene-change
retention, or location-based objects.

## Concepts

**Spots** are named containers. An `ItemDef` registers what an item is;
a `Stack` is what lives in a spot: `{ defId, count }`.

**CarryClass** controls behavior on scene change (`resolveLeaveLocation`):
- `"fixed"` — always stays (furniture, scenery)
- `"explicit"` — stays unless the stage moves it; follows actor if already in an actor spot
- `"habitual"` — follows probabilistically; high stress and low accessibility increase loss chance

**Accessibility** is a computed score (higher = easier to reach) based on
spot disorder, recency of access, and whether a habitual item is in its
default spot. Tier it with `thresholdTiers` from `stats.ts`.

**Capacity** is checked but not enforced: `capacityOK` / `capacityViolation`
return results; the stage decides whether to refuse, narrate, or swap.

## API [`src/lib/inventory.ts`](./inventory.ts#L92-L321)

- `inv.register(def)` — add an `ItemDef` to the catalog
- `inv.getDef(id)` — look up a registered def
- `inv.ensureSpot(name, meta?)` — create spot if absent; update meta if supplied
- `inv.spots()` — list all spot names
- `inv.contents(spot)` — copy of stacks in that spot
- `inv.meta(spot)` — `SpotMeta | undefined`
- `inv.add(spot, defId, n=1)` — merge into existing stack if item is `counted`
- `inv.remove(spot, defId, n=1)` — returns count actually removed
- `inv.move(from, to, defId, n=1)` — remove then add; returns count moved
- `inv.find(defId)` — `{ spot, count }[]` across all spots
- `inv.touch(spot, now)` — update `lastAccessed` for accessibility
- `inv.accessibility(defId, spot, now)` — unitless score; higher = easier
- `inv.capacityOK(spot, itemDef, count=1)` — boolean; does not mutate
- `inv.capacityViolation(spot, itemDef, count=1)` — `{ kind, overBy } | null`
- `inv.resolveLeaveLocation(stress, now, actorSpots, rng?)` — `{ kept, left }` by spot
- `inv.toJSON()` / `Inventory.fromJSON(data)`

## Gotchas

- `remove` returns the count actually removed, which may be less than `n`
  if the spot has fewer items. It does not throw on under-removal.
- `resolveLeaveLocation` uses `Math.random()` if no `RngStream` is
  supplied — pass one for deterministic results.
- Capacity checks only apply to axes where both the spot has a capacity
  set *and* the item def has the corresponding field (`weight`/`bulk`).
  Missing either side = no constraint.
