import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { state } from "../state";
import { resetRain, shouldRainForCycle, spawnRain, updateRain } from "./weather";

/*
 * shouldRainForCycle is the deterministic weather scheduler — given
 * a day-cycle index, return whether this cycle should be rainy. The
 * comment in the source claims "exactly 1 cycle in 10" is rainy, but
 * the implementation ALSO guarantees every 50th cycle rains, which
 * means every 5th block of 10 has 2 rainy cycles (the block slot +
 * the 50-multiple override). These tests pin down the actual
 * behaviour so future refactors don't silently shift it.
 */

describe("shouldRainForCycle", () => {
  it("is deterministic — same input gives same output", () => {
    for (let i = 0; i < 200; i++) {
      expect(shouldRainForCycle(i)).toBe(shouldRainForCycle(i));
    }
  });

  it("cycle 0 never rains (treated as the starting cycle)", () => {
    expect(shouldRainForCycle(0)).toBe(false);
  });

  it("every multiple of 50 after 0 rains", () => {
    for (const cycle of [50, 100, 150, 200, 500, 1000]) {
      expect(shouldRainForCycle(cycle), `cycle ${cycle} should rain (50-multiple override)`).toBe(
        true,
      );
    }
  });

  it("every block of 10 contains at least one rainy cycle", () => {
    // Lower bound — the game promises rain at least every ~10 cycles
    // so the player doesn't wait a lifetime for weather.
    for (let block = 0; block < 100; block++) {
      const start = block * 10;
      let rainyInBlock = 0;
      for (let c = start; c < start + 10; c++) {
        if (shouldRainForCycle(c)) rainyInBlock++;
      }
      expect(
        rainyInBlock,
        `block ${block} (cycles ${start}-${start + 9}) had 0 rainy cycles`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it("blocks whose slot does NOT line up with cycle-0 have exactly 1 rainy cycle", () => {
    // The slot for block 0 is (0*7 + 3) % 10 = 3, so cycle 3 rains.
    // Block 0 has no 50-multiple override → exactly 1 rainy cycle.
    // Same for most blocks; the exception is every 5th block (block 5,
    // block 10, …) whose first cycle IS a 50-multiple.
    const start = 0;
    let count = 0;
    for (let c = start; c < start + 10; c++) {
      if (shouldRainForCycle(c)) count++;
    }
    expect(count).toBe(1);
  });

  it("blocks aligned with a 50-multiple get 2 rainy cycles (block + slot)", () => {
    // Block 5 = cycles 50-59. Slot = (5*7+3) % 10 = 8 → cycle 58.
    // Plus cycle 50 rains via the override. Total: 2 rainy cycles.
    let count = 0;
    for (let c = 50; c < 60; c++) if (shouldRainForCycle(c)) count++;
    expect(count).toBe(2);
    expect(shouldRainForCycle(50)).toBe(true);
    expect(shouldRainForCycle(58)).toBe(true);

    // Block 10 = cycles 100-109. Slot = (10*7+3) % 10 = 3 → cycle 103.
    // Plus cycle 100 rains via the override.
    let count10 = 0;
    for (let c = 100; c < 110; c++) if (shouldRainForCycle(c)) count10++;
    expect(count10).toBe(2);
    expect(shouldRainForCycle(100)).toBe(true);
    expect(shouldRainForCycle(103)).toBe(true);
  });

  it("average rain frequency over 1000 cycles is ~11% (1-in-9ish, not exactly 1-in-10)", () => {
    // Baseline: 1 in 10 from the block slots = 100 rainy.
    // Plus: every 50th after 0 = 19 additional rainy cycles (cycles 50,
    // 100, ..., 950), SOMETIMES overlapping with an already-rainy slot.
    // The observed rate over 0..999 is ~119/1000 = 11.9%.
    let count = 0;
    for (let c = 0; c < 1000; c++) if (shouldRainForCycle(c)) count++;
    expect(count).toBeGreaterThanOrEqual(100);
    expect(count).toBeLessThanOrEqual(130);
  });

  it("never rains on consecutive cycles (ensures dry breathing room)", () => {
    // A nice gameplay property: rain isn't back-to-back. Verifies the
    // slot hash + 50-override combo can't produce adjacent rainy cycles.
    for (let c = 0; c < 1000; c++) {
      if (shouldRainForCycle(c) && shouldRainForCycle(c + 1)) {
        throw new Error(`consecutive rainy cycles at ${c} and ${c + 1}`);
      }
    }
  });
});

// Count equal elapsed time at different refresh rates without expiring drops.

describe("rain emission and reuse", () => {
  beforeEach(() => {
    resetRain();
    state.width = 1200;
    state.ground = 600;
    state.rainIntensity = 0.125;
  });
  afterEach(() => resetRain());

  it.each([30, 60, 120, 144, 240])("spawns 30 drops per second at %i Hz in light rain", (hz) => {
    for (let i = 0; i < hz; i++) spawnRain(60 / hz);
    expect(state.rainParticles.length).toBeGreaterThanOrEqual(29);
    expect(state.rainParticles.length).toBeLessThanOrEqual(30);
  });
  it("does not spawn on a zero-length frame or carry emission through a reset", () => {
    spawnRain(0);
    expect(state.rainParticles).toHaveLength(0);
    spawnRain(1);
    resetRain();
    spawnRain(1);
    expect(state.rainParticles).toHaveLength(0);
  });
  it("recycles expired drops without moving survivors twice", () => {
    state.rainIntensity = 1;
    spawnRain(1);
    const drops = [...state.rainParticles];
    drops[0].y = state.ground + 1;
    const nextY = drops[1].y + drops[1].vy * 0.01;
    updateRain(0.01);
    expect(state.rainParticles).toHaveLength(3);
    expect(drops[1].y).toBeCloseTo(nextY);
    spawnRain(0.25);
    expect(state.rainParticles[3]).toBe(drops[0]);
  });
  it("caps exceptional bursts and discards excess work instead of queuing it", () => {
    state.rainIntensity = 1;
    spawnRain(1e6);
    expect(state.rainParticles).toHaveLength(2048);
    updateRain(100);
    spawnRain(0);
    expect(state.rainParticles).toHaveLength(0);
  });
});
