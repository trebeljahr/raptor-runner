import { describe, expect, it } from "vitest";
import { reduceMotion, setReduceMotionMode } from "./reducedMotion";

// happy-dom's matchMedia never reports prefers-reduced-motion as
// matching, so "system" resolves to false here — which is exactly
// the OS-default a fresh player sees.

describe("reducedMotion", () => {
  it("forces the effective flag on and stamps the body attribute", () => {
    setReduceMotionMode("on");
    expect(reduceMotion()).toBe(true);
    expect(document.body.dataset.reduceMotion).toBe("on");
  });

  it("forces the effective flag off and stamps the body attribute", () => {
    setReduceMotionMode("off");
    expect(reduceMotion()).toBe(false);
    expect(document.body.dataset.reduceMotion).toBe("off");
  });

  it("system mode removes the attribute and defers to the media query", () => {
    setReduceMotionMode("on");
    setReduceMotionMode("system");
    expect(document.body.dataset.reduceMotion).toBeUndefined();
    expect(reduceMotion()).toBe(false);
  });
});
