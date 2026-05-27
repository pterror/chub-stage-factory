# RNG — seeded deterministic PRNG with named streams

`Rng` wraps an xoshiro128\*\* generator with multi-stream splitting. The
top-level `Rng` holds a seed string; `stream(name)` derives an independent
`RngStream` from that seed so that mechanical rolls never perturb cosmetic
output and vice versa.

Used everywhere a stage needs reproducible randomness: combat, loot drops,
animation jitter, proc-gen, name picking.

## Concepts

`Rng` is the serializable root. `RngStream` is the stateful cursor you
actually call. Two streams derived from the same `Rng` seed with different
names produce independent sequences.

Conventional stream names: `mechanical` (game-affecting rolls), `cosmetic`
(animation, prose variation). Both are pre-aliased on `Rng`.

## API [`src/lib/rng.ts`](./rng.ts#L56-L179)

- `Rng.fromSeed(seed)` — construct from a string seed
- `rng.stream(name)` — get or create a named stream (lazy, idempotent)
- `rng.mechanical` / `rng.cosmetic` — convenience aliases for the two conventional streams
- `rng.toJSON()` / `Rng.fromJSON(data)` — serialize/restore the full stream state

- `stream.next()` — raw uint32
- `stream.float()` — `[0, 1)`
- `stream.range(lo, hi)` — inclusive integer range
- `stream.pick(arr)` — uniform random element
- `stream.pickN(arr, n, replace?)` — sample without replacement by default
- `stream.weightedPick(items)` — `{value, weight}[]`
- `stream.dice(notation)` — `"2d6+1"` notation
- `stream.shuffle(arr)` — returns a shuffled copy; does not mutate

## Gotchas

- `pick([])` throws. `weightedPick` throws if total weight ≤ 0.
- `pickN(arr, n)` without `replace` throws if `n > arr.length`.
- Streams are created on first access; only streams that have been accessed
  are included in `toJSON()`. Restoring from JSON only recreates the
  streams that were saved.
