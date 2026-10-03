import { describe, expect, it } from "vitest";
import { FramePerformance } from "./framePerformance";

describe("frame cadence measurements", () => {
  it("reports display cadence rather than reciprocal CPU time", () => {
    const perf = new FramePerformance();
    for (let i = 0; i <= 120; i++) perf.record((i * 1000) / 60, 0.1, 1);
    expect(perf.summary().fps).toBeCloseTo(60);
    expect(perf.summary().p95).toBeCloseTo(1000 / 60);
    expect(perf.summary().render).toBeCloseTo(1);
  });
  it("keeps spikes visible but ages them out of a bounded window", () => {
    const perf = new FramePerformance();
    perf.record(1, 0, 0);
    for (let i = 1; i <= 120; i++) perf.record(1 + i * 50, 1, 2);
    expect(perf.summary()).toMatchObject({ p95: 50, max: 50, spikes: 120 });
    for (let i = 1; i <= 120; i++) perf.record(6001 + i * 10, 0.1, 0.2);
    expect(perf.summary()).toMatchObject({ fps: 100, p95: 10, max: 10, spikes: 0 });
    perf.reset();
    perf.record(10000, 0, 0);
    expect(perf.summary().max).toBe(0);
  });
});
