import { describe, expect, it } from "vitest";
import { highContrast, setHighContrastMode } from "./highContrast";

describe("highContrast", () => {
  it("enables the flag and stamps the body attribute", () => {
    setHighContrastMode(true);
    expect(highContrast()).toBe(true);
    expect(document.body.dataset.highContrast).toBe("true");
  });

  it("disables the flag and removes the body attribute", () => {
    setHighContrastMode(true);
    setHighContrastMode(false);
    expect(highContrast()).toBe(false);
    expect(document.body.dataset.highContrast).toBeUndefined();
  });

  it("treats non-boolean truthy input as off", () => {
    // The Game setter validates, but the module itself must not
    // stamp the attribute for junk handed over via window.Game.
    setHighContrastMode("yes" as unknown as boolean);
    expect(highContrast()).toBe(false);
    expect(document.body.dataset.highContrast).toBeUndefined();
  });
});
