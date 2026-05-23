/*
 * rng.ts — seeded xoshiro128** with multi-stream splitting.
 *
 * WHAT: A deterministic PRNG. The top-level `Rng` has a base seed and spawns
 *       named streams. Conventional streams: `mechanical` (combat rolls, drops),
 *       `cosmetic` (animation jitter, prose choice). Stages create more as
 *       they need them — perturbing cosmetic output never disturbs mechanical
 *       outcomes.
 *
 * WHY: Rule #7 (seeded streams). Plus rule #4: a stream is a mutable holder
 *       you keep on the stage; effective state of the world is reproducible
 *       given the seed + the action log.
 *
 * SHAPE:
 *   class Rng
 *     static fromSeed(seedString): Rng
 *     stream(name): RngStream
 *     get mechanical(): RngStream
 *     get cosmetic(): RngStream
 *     toJSON(): { seed, streams: Record<name, [s0,s1,s2,s3]> }
 *     static fromJSON(data): Rng
 *   class RngStream
 *     next(): number       // uint32
 *     float(): number      // [0,1)
 *     range(lo, hi): number// integer in [lo, hi]
 *     pick<T>(arr): T
 *     pickN<T>(arr, n, replace?): T[]
 *     weightedPick<T>(items: {value: T, weight: number}[]): T
 *     dice(notation): number   // "2d6+1"
 *     shuffle<T>(arr): T[]     // returns a shuffled copy
 */

function hashSeed(s: string): number {
  // FNV-1a then mix.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function splitMix32(state: { v: number }): number {
  state.v = (state.v + 0x9e3779b9) >>> 0;
  let z = state.v;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  return (z ^ (z >>> 16)) >>> 0;
}

function seedFour(s0: number): [number, number, number, number] {
  const st = { v: s0 };
  return [splitMix32(st), splitMix32(st), splitMix32(st), splitMix32(st)];
}

export class RngStream {
  constructor(public state: [number, number, number, number]) {}

  next(): number {
    // xoshiro128** by Blackman & Vigna.
    const [s0, s1, s2, s3] = this.state;
    const result = (Math.imul(Math.imul(s1, 5) << 7 | (Math.imul(s1, 5) >>> 25), 9) >>> 0);
    const t = (s1 << 9) >>> 0;
    let n0 = s0;
    let n1 = s1;
    let n2 = s2 ^ s0;
    let n3 = s3 ^ s1;
    n2 = (n2 ^ t) >>> 0;
    n3 = ((n3 << 11) | (n3 >>> 21)) >>> 0;
    n0 = (n0 ^ n3) >>> 0;
    n1 = (n1 ^ n2) >>> 0;
    this.state = [n0, n1, n2, n3];
    return result >>> 0;
  }

  float(): number {
    // 24 bits of precision.
    return (this.next() >>> 8) / (1 << 24);
  }

  /** Inclusive integer range [lo, hi]. */
  range(lo: number, hi: number): number {
    if (hi < lo) [lo, hi] = [hi, lo];
    const span = hi - lo + 1;
    return lo + Math.floor(this.float() * span);
  }

  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error("pick: empty array");
    return arr[this.range(0, arr.length - 1)];
  }

  pickN<T>(arr: readonly T[], n: number, replace = false): T[] {
    if (replace) return Array.from({ length: n }, () => this.pick(arr));
    if (n > arr.length) throw new Error("pickN: n > arr.length without replacement");
    const pool = [...arr];
    const out: T[] = [];
    for (let i = 0; i < n; i++) {
      const idx = this.range(0, pool.length - 1);
      out.push(pool[idx]);
      pool.splice(idx, 1);
    }
    return out;
  }

  weightedPick<T>(items: readonly { value: T; weight: number }[]): T {
    let total = 0;
    for (const it of items) total += Math.max(0, it.weight);
    if (total <= 0) throw new Error("weightedPick: total weight <= 0");
    let r = this.float() * total;
    for (const it of items) {
      r -= Math.max(0, it.weight);
      if (r <= 0) return it.value;
    }
    return items[items.length - 1].value;
  }

  /** Dice notation: "NdS", "NdS+M", "NdS-M". */
  dice(notation: string): number {
    const m = /^\s*(\d+)\s*d\s*(\d+)\s*([+-]\s*\d+)?\s*$/i.exec(notation);
    if (!m) throw new Error(`dice: bad notation "${notation}"`);
    const n = parseInt(m[1], 10);
    const s = parseInt(m[2], 10);
    const mod = m[3] ? parseInt(m[3].replace(/\s+/g, ""), 10) : 0;
    let total = mod;
    for (let i = 0; i < n; i++) total += this.range(1, s);
    return total;
  }

  shuffle<T>(arr: readonly T[]): T[] {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.range(0, i);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
}

export class Rng {
  private _seed: string;
  private _streams: Map<string, RngStream> = new Map();

  private constructor(seed: string) {
    this._seed = seed;
  }

  static fromSeed(seed: string): Rng {
    return new Rng(seed);
  }

  stream(name: string): RngStream {
    let s = this._streams.get(name);
    if (s) return s;
    const baseHash = hashSeed(`${this._seed}::${name}`);
    s = new RngStream(seedFour(baseHash || 1));
    this._streams.set(name, s);
    return s;
  }

  get mechanical(): RngStream {
    return this.stream("mechanical");
  }
  get cosmetic(): RngStream {
    return this.stream("cosmetic");
  }

  toJSON(): { seed: string; streams: Record<string, [number, number, number, number]> } {
    const streams: Record<string, [number, number, number, number]> = {};
    for (const [k, v] of this._streams) streams[k] = [...v.state] as [number, number, number, number];
    return { seed: this._seed, streams };
  }

  static fromJSON(data: { seed: string; streams: Record<string, [number, number, number, number]> }): Rng {
    const r = new Rng(data.seed);
    for (const [k, st] of Object.entries(data.streams)) r._streams.set(k, new RngStream([...st]));
    return r;
  }
}
