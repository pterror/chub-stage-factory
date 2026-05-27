# `snapshots.ts` — named save/restore/diff for a Body

Captures a `Body`'s base tags and active transformation stack under a string
name, restores them on demand, and diffs a named snapshot against the current
state. Scoped to `Body` only; stages that want to snapshot inventory or stats
compose their own equivalent.

## API

- `interface SnapshotData { baseSlots: Record<slot, string[]>; transformations: TransformationInstance[] }` (lines 35–38)
- `interface DiffResult { changed, slotsAdded[], slotsRemoved[], tagsAdded: Record<slot, string[]>, tagsRemoved: Record<slot, string[]>, tfsAdded[], tfsRemoved[] }` (lines 40–48)
- `class Snapshots` (lines 59–178)
  - `constructor(body: Body)`
  - `save(name): void` — capture current body state under `name`
  - `restore(name): boolean` — restore body to snapshot; returns `false` if not found
  - `has(name): boolean`, `delete(name): boolean`, `list(): string[]`, `clear(): void`
  - `get(name): SnapshotData | undefined`, `set(name, data): void`
  - `diff(name): DiffResult | { error: string }` — compare named snapshot to current
  - `toJSON(): { snaps: Record<name, SnapshotData> }`
  - `static fromJSON(data, body): Snapshots` — caller must supply the live body

## Example

```ts
import { Snapshots } from "./lib/snapshots";

const snaps = new Snapshots(actor.body);
snaps.save("pre-tf");

body.applyTransformation({ id: "bind-wrists", slot: "wrists", addTags: ["bound"], startTime: now });

const d = snaps.diff("pre-tf");
// d.tfsAdded: ["bind-wrists"]
// d.tagsAdded: { wrists: ["bound"] }

snaps.restore("pre-tf"); // body back to original
```

## Gotchas

- `restore` clears ALL active transformations before re-applying the snapshot's
  list — there is no merge; it is a full replacement.
- `fromJSON` requires the caller to supply the same live `Body` instance the
  snapshots were saved against; the body reference is not serialized.
- `diff` compares base tags only (not effective tags). Transformation trajectories
  that modify tags at runtime are not reflected in `tagsAdded`/`tagsRemoved`.
