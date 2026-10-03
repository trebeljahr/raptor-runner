import { beforeEach, describe, expect, it, vi } from "vitest";
import { Raptor } from "./raptor";
import { state } from "../state";

vi.mock("../audio", () => ({ audio: { playStep: vi.fn() } }));

beforeEach(() => {
  state.width = 1000;
  state.ground = 500;
  state.bgVelocity = 5;
});

describe("raptor resizing", () => {
  it.each([-8, 8])("preserves height and velocity during a height-only resize (%s)", (velocity) => {
    const land = vi.fn();
    const raptor = new Raptor(land, vi.fn());
    raptor.y = raptor.ground - 75;
    raptor.velocity = velocity;
    const oldPolygon = raptor.collisionPolygon().map((point) => ({ ...point }));
    state.ground += 200;
    raptor.resize();
    expect(raptor.ground - raptor.y).toBeCloseTo(75);
    expect(raptor.velocity).toBe(velocity);
    expect(raptor.collisionPolygon()[0].y).toBeCloseTo(oldPolygon[0].y + 200);
    expect(land).not.toHaveBeenCalled();
  });

  it.each([-8, 8])("scales the airborne trajectory with width (%s)", (velocity) => {
    const raptor = new Raptor(vi.fn(), vi.fn());
    raptor.y = raptor.ground - 75;
    raptor.velocity = velocity;
    const acceleration = raptor.downwardAcceleration;
    state.width /= 2;
    state.ground = 300;
    raptor.resize();
    expect(raptor.ground - raptor.y).toBeCloseTo(37.5);
    expect(raptor.velocity).toBeCloseTo(velocity / 2);
    raptor.update(1);
    expect(raptor.velocity).toBeCloseTo((velocity + acceleration) / 2);
    expect(raptor.ground - raptor.y).toBeCloseTo((75 - velocity - acceleration) / 2);
  });

  it("keeps a grounded raptor on the new floor", () => {
    const raptor = new Raptor(vi.fn(), vi.fn());
    state.width = 500;
    state.ground = 250;
    raptor.resize();
    expect(raptor.y).toBe(raptor.ground);
    expect(raptor.velocity).toBe(0);
  });
});
