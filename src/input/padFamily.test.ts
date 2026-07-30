import { afterEach, describe, expect, it } from "vitest";
import { applyPadFamilyBodyClass, familyFromGamepadId } from "./padFamily";

/*
 * Gamepad.id is a free-form driver/browser artifact, so the family
 * heuristic is exercised against id strings observed on real hardware
 * across Chrome / Firefox / Safari rather than synthetic inputs. The
 * interesting cases are the collisions: "XInput" appearing on
 * non-Microsoft pads, and "Wireless Controller" being both Sony's
 * DualShock 4 id and part of Microsoft's official product name.
 */

describe("familyFromGamepadId", () => {
  it("detects Xbox pads", () => {
    expect(familyFromGamepadId("Xbox 360 Controller (XInput STANDARD GAMEPAD)")).toBe("xbox");
    expect(
      familyFromGamepadId("Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b12)"),
    ).toBe("xbox");
    expect(familyFromGamepadId("Xbox Wireless Controller Extended Gamepad")).toBe("xbox");
  });

  it("detects PlayStation pads", () => {
    // Chrome's DualShock 4 id carries no Sony marketing name at all —
    // only the 054c vendor id identifies it.
    expect(
      familyFromGamepadId("Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)"),
    ).toBe("playstation");
    expect(familyFromGamepadId("DualSense Wireless Controller")).toBe("playstation");
    expect(familyFromGamepadId("54c-9cc-Sony Computer Entertainment Wireless Controller")).toBe(
      "playstation",
    );
  });

  it("falls back to the weak 'Wireless Controller' fragment for the bare DualShock id", () => {
    // Safari strips vendor ids; the DS4 shows up as just its USB
    // product string.
    expect(familyFromGamepadId("Wireless Controller Extended Gamepad")).toBe("playstation");
    expect(familyFromGamepadId("Wireless Controller")).toBe("playstation");
  });

  it("detects Nintendo pads", () => {
    expect(
      familyFromGamepadId("Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)"),
    ).toBe("nintendo");
    expect(familyFromGamepadId("Joy-Con (L) (Vendor: 057e Product: 2006)")).toBe("nintendo");
    expect(familyFromGamepadId("Nintendo Switch Pro Controller")).toBe("nintendo");
  });

  it("lets a named vendor outrank an XInput mention", () => {
    expect(familyFromGamepadId("Pro Controller (XInput STANDARD GAMEPAD Vendor: 057e)")).toBe(
      "nintendo",
    );
    expect(familyFromGamepadId("DualShock 4 (XInput STANDARD GAMEPAD)")).toBe("playstation");
  });

  it("falls back to generic for unrecognized pads", () => {
    expect(familyFromGamepadId("USB Gamepad (STANDARD GAMEPAD Vendor: 0810 Product: e501)")).toBe(
      "generic",
    );
    expect(familyFromGamepadId("8BitDo SN30 Pro (Vendor: 2dc8 Product: 6101)")).toBe("generic");
    expect(familyFromGamepadId("")).toBe("generic");
  });
});

describe("applyPadFamilyBodyClass", () => {
  const familyClasses = (): string[] =>
    Array.from(document.body.classList).filter((c) => c.startsWith("pad-family-"));

  afterEach(() => {
    applyPadFamilyBodyClass(null);
  });

  it("keeps exactly one pad-family class when the family changes", () => {
    // The CSS reveals one <kbd> variant per family class, so a stale
    // class from a previously connected pad would show two glyphs.
    applyPadFamilyBodyClass("xbox");
    expect(familyClasses()).toEqual(["pad-family-xbox"]);
    applyPadFamilyBodyClass("playstation");
    expect(familyClasses()).toEqual(["pad-family-playstation"]);
  });

  it("clears every pad-family class when passed null", () => {
    applyPadFamilyBodyClass("generic");
    applyPadFamilyBodyClass(null);
    expect(familyClasses()).toEqual([]);
  });

  it("leaves unrelated body classes alone", () => {
    document.body.classList.add("gamepad-connected");
    applyPadFamilyBodyClass("nintendo");
    applyPadFamilyBodyClass(null);
    expect(document.body.classList.contains("gamepad-connected")).toBe(true);
    document.body.classList.remove("gamepad-connected");
  });
});
