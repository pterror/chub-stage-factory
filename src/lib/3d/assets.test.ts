/*
 * assets.test.ts — AssetCache initial-state + disposal-after-empty tests.
 *
 * Three.js loaders require a DOM (Image / fetch with absolute URLs) that
 * jsdom in vitest does not consistently provide; in-flight loads cannot be
 * exercised headlessly. Real-asset loading is exercised by the `_3d-demo`
 * example in-browser. These tests cover the surface that is testable
 * without a real loader invocation.
 */

import {describe, it, expect} from "vitest";
import {AssetCache, defaultAssetCache} from "./assets";

describe("AssetCache", () => {
  it("starts empty", () => {
    const c = new AssetCache();
    expect(c.stats().count).toBe(0);
    expect(c.getCached("/nope.glb")).toBeUndefined();
  });

  it("disposeAll is a no-op on an empty cache", () => {
    const c = new AssetCache();
    expect(() => c.disposeAll()).not.toThrow();
    expect(c.stats().count).toBe(0);
  });

  it("disposeUrl is a no-op for missing url", () => {
    const c = new AssetCache();
    expect(() => c.disposeUrl("/missing.png")).not.toThrow();
  });

  it("defaultAssetCache exists and is an AssetCache", () => {
    expect(defaultAssetCache).toBeInstanceOf(AssetCache);
  });

  it("stats reports zero bytes when empty", () => {
    const c = new AssetCache();
    expect(c.stats().estimatedBytes).toBe(0);
  });
});
