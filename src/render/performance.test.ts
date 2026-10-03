import { afterEach, describe, expect, it, vi } from "vitest";
import { Stars } from "../entities/stars";
import { drawRareEvent, drawUfoBeam } from "../effects/rareEvents";
import { state } from "../state";
import { drawOvercastBands, invalidateCloudsCache } from "./clouds";

function fakeContext() {
  const alphas: number[] = [];
  const ctx: any = {
    globalAlpha: 0.5,
    save: () => alphas.push(ctx.globalAlpha),
    restore: () => {
      ctx.globalAlpha = alphas.pop();
    },
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn(),
    drawImage: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    bezierCurveTo: vi.fn(),
    stroke: vi.fn(),
  };
  return ctx;
}

afterEach(() => {
  state.activeRareEvent = null;
  invalidateCloudsCache();
  vi.restoreAllMocks();
});

describe("render work under effects", () => {
  it("culls the oversized star dome and caches haze without losing parent alpha", () => {
    state.width = 1280;
    state.height = 720;
    state.starRotation = 0;
    const offscreen = fakeContext();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(offscreen);
    const stars = new Stars();
    stars.opacity = 1;
    stars.milkyWay = [];
    stars.mwHazePuffs = [{ x: 100, y: 100, radius: 80, brightness: 0.1 }];
    const sample = stars.field[0];
    stars.field = [
      { ...sample, x: 100, y: 100 },
      { ...sample, x: -1000, y: 100 },
      { ...sample, x: 100, y: 2000 },
    ];
    const ctx = fakeContext();
    stars.draw(ctx);
    expect(ctx.arc).toHaveBeenCalledTimes(1);
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    expect(ctx.createRadialGradient).not.toHaveBeenCalled();
    expect(ctx.globalAlpha).toBe(0.5);
    // Cull after rotation, not in the unrotated dome coordinates.
    state.starRotation = Math.PI;
    ctx.arc.mockClear();
    stars.draw(ctx);
    expect(ctx.arc).not.toHaveBeenCalled();
  });
  it("reuses overcast gradients throughout intensity fades, rebuilding on resize", () => {
    state.width = 1280;
    state.height = 720;
    const ctx = fakeContext();
    for (let i = 1; i <= 100; i++) drawOvercastBands(ctx, i / 100);
    expect(ctx.createLinearGradient).toHaveBeenCalledTimes(5);
    expect(ctx.globalAlpha).toBe(0.5);
    state.height = 800;
    drawOvercastBands(ctx, 1);
    expect(ctx.createLinearGradient).toHaveBeenCalledTimes(10);
  });
  it("reuses all five comet tail gradients across frames", () => {
    state.width = 1280;
    state.height = 720;
    state.activeRareEvent = { id: "comet", age: 2, life: 8, x: 700, y: 250 };
    const bake = fakeContext();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(bake);
    const ctx = fakeContext();
    for (let i = 0; i < 100; i++) drawRareEvent(ctx);
    expect(bake.createLinearGradient).toHaveBeenCalledTimes(5);
    expect(ctx.createLinearGradient).not.toHaveBeenCalled();
  });

  it("blits a cached UFO beam throughout hover rather than making moving gradients", () => {
    state.width = 1280;
    state.height = 720;
    state.ground = 648;
    state.activeRareEvent = { id: "ufo", age: 2, life: 20, x: 700, y: 250, beam: true };
    const bake = fakeContext();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(bake);
    const ctx = fakeContext();
    for (let i = 0; i < 100; i++) {
      state.activeRareEvent.y = 250 + Math.sin(i) * 5;
      drawUfoBeam(ctx);
    }
    expect(bake.createLinearGradient).toHaveBeenCalledTimes(1);
    expect(ctx.createLinearGradient).not.toHaveBeenCalled();
    expect(ctx.drawImage).toHaveBeenCalledTimes(100);
    expect(ctx.globalAlpha).toBe(0.5);
  });
});
