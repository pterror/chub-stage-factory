/*
 * physics.test.ts — Rapier 3D physics determinism + basic API smoke test.
 *
 * These tests run headless under vitest. They exercise the WASM init path,
 * basic body lifecycle, and the determinism guarantee.
 */

import {describe, it, expect, beforeAll} from "vitest";
import {initRapier, Physics3DWorld, isRapierReady} from "./physics";

beforeAll(async () => {
  await initRapier();
}, 10000);

describe("initRapier", () => {
  it("is ready after init", () => {
    expect(isRapierReady()).toBe(true);
  });

  it("is idempotent", async () => {
    const a = await initRapier();
    const b = await initRapier();
    expect(a).toBe(b);
  });
});

describe("Physics3DWorld", () => {
  it("registers and removes bodies", () => {
    const world = new Physics3DWorld();
    expect(world.bodyCount()).toBe(0);
    const id = world.addSphere(0.5, {position: {x: 0, y: 5, z: 0}});
    expect(world.bodyCount()).toBe(1);
    world.remove(id);
    expect(world.bodyCount()).toBe(0);
    world.dispose();
  });

  it("falls under gravity", () => {
    const world = new Physics3DWorld();
    const id = world.addSphere(0.5, {position: {x: 0, y: 10, z: 0}});
    const initial = world.getTransform(id)!;
    for (let i = 0; i < 30; i++) world.step();
    const after = world.getTransform(id)!;
    expect(after.position.y).toBeLessThan(initial.position.y);
    world.dispose();
  });

  it("static plane stops a falling sphere", () => {
    const world = new Physics3DWorld();
    world.addStaticPlane({x: 0, y: 1, z: 0}, {x: 0, y: 0, z: 0});
    const id = world.addSphere(0.5, {position: {x: 0, y: 5, z: 0}}, {restitution: 0});
    for (let i = 0; i < 240; i++) world.step();
    const t = world.getTransform(id)!;
    // Sphere should have settled near y=0.5 (radius above plane). Allow slack.
    expect(t.position.y).toBeGreaterThan(0);
    expect(t.position.y).toBeLessThan(2);
    world.dispose();
  });

  it("is deterministic across two identical runs", () => {
    function run(): {x: number; y: number; z: number} {
      const w = new Physics3DWorld();
      w.addStaticPlane({x: 0, y: 1, z: 0}, {x: 0, y: 0, z: 0});
      const id = w.addSphere(
        0.4,
        {position: {x: 0.1, y: 4, z: 0}, linvel: {x: 1.5, y: 0, z: 0.7}},
        {restitution: 0.6},
      );
      for (let i = 0; i < 120; i++) w.step(1 / 60);
      const t = w.getTransform(id)!;
      w.dispose();
      return t.position;
    }
    const a = run();
    const b = run();
    expect(a.x).toBeCloseTo(b.x, 4);
    expect(a.y).toBeCloseTo(b.y, 4);
    expect(a.z).toBeCloseTo(b.z, 4);
  });

  it("castRay finds the ground", () => {
    const world = new Physics3DWorld();
    world.addStaticPlane({x: 0, y: 1, z: 0}, {x: 0, y: 0, z: 0});
    world.step(); // Rapier needs at least one step before queries see colliders
    const hit = world.castRay({x: 0, y: 5, z: 0}, {x: 0, y: -1, z: 0});
    expect(hit).not.toBeNull();
    expect(hit!.point.y).toBeLessThan(1);
    world.dispose();
  });

  it("applyImpulse changes velocity", () => {
    const world = new Physics3DWorld({gravity: {x: 0, y: 0, z: 0}});
    const id = world.addSphere(0.5, {position: {x: 0, y: 0, z: 0}});
    world.applyImpulse(id, {x: 10, y: 0, z: 0});
    for (let i = 0; i < 10; i++) world.step();
    const t = world.getTransform(id)!;
    expect(t.position.x).toBeGreaterThan(0);
    world.dispose();
  });
});
