import { describe, it, expect } from "vitest";
import { Rng, RngStream } from "./rng";

describe("RngStream.weightedPick", () => {
  it("is deterministic with a seeded stream", () => {
    const rng = Rng.fromSeed("test-seed");
    const stream = rng.stream("test");
    const items = [
      { value: "a", weight: 1 },
      { value: "b", weight: 2 },
      { value: "c", weight: 3 },
    ];
    // Draw 10 picks; results must be identical on a fresh stream with the same seed.
    const draws = Array.from({ length: 10 }, () => stream.weightedPick(items));

    const rng2 = Rng.fromSeed("test-seed");
    const stream2 = rng2.stream("test");
    const draws2 = Array.from({ length: 10 }, () => stream2.weightedPick(items));

    expect(draws).toEqual(draws2);
  });

  it("throws on empty (or zero-weight) distribution", () => {
    const stream = new RngStream([1, 2, 3, 4]);
    expect(() => stream.weightedPick([])).toThrow("weightedPick: total weight <= 0");
    expect(() => stream.weightedPick([{ value: "x", weight: 0 }])).toThrow(
      "weightedPick: total weight <= 0"
    );
  });
});

describe("RngStream.pick", () => {
  it("is roughly uniform across a large sample", () => {
    const stream = new RngStream([0xdeadbeef, 0xcafebabe, 0x12345678, 0x87654321]);
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    const n = 3000;
    const pool = ["a", "b", "c"] as const;
    for (let i = 0; i < n; i++) {
      counts[stream.pick(pool)]++;
    }
    // Each bucket should be within 15% of n/3 = 1000.
    for (const key of pool) {
      expect(counts[key]).toBeGreaterThan(850);
      expect(counts[key]).toBeLessThan(1150);
    }
  });

  it("throws on empty array", () => {
    const stream = new RngStream([1, 2, 3, 4]);
    expect(() => stream.pick([])).toThrow("pick: empty array");
  });
});
