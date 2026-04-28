import { describe, expect, it } from "vitest";
import { ACHIEVEMENTS, ACHIEVEMENTS_BY_ID } from "./achievements";

/*
 * Achievements catalog is static data — the interesting test is
 * invariant preservation: no duplicate ids, every entry has the fields
 * the rest of the game reads, and the lookup table is consistent with
 * the array.
 *
 * These tests catch accidental copy-paste mistakes when adding new
 * achievements (e.g. leaving two entries with the same id).
 */

describe("ACHIEVEMENTS catalog", () => {
  it("has at least one entry", () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThan(0);
  });

  it("every id is unique", () => {
    const seen = new Set<string>();
    for (const a of ACHIEVEMENTS) {
      expect(seen.has(a.id), `duplicate id: ${a.id}`).toBe(false);
      seen.add(a.id);
    }
  });

  it("every id is a non-empty kebab-case string", () => {
    const kebabRe = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    for (const a of ACHIEVEMENTS) {
      expect(a.id, "empty id").not.toBe("");
      expect(kebabRe.test(a.id), `not kebab-case: ${a.id}`).toBe(true);
    }
  });

  it("every entry has a non-empty title and desc", () => {
    for (const a of ACHIEVEMENTS) {
      expect(a.title, `missing title for ${a.id}`).toBeTruthy();
      expect(a.desc, `missing desc for ${a.id}`).toBeTruthy();
    }
  });

  it("every entry has either iconHTML or iconImage (or neither) — never both", () => {
    // iconHTML: inline SVG fragment; iconImage: path to a bitmap.
    // The render layer branches on which one is set — supplying both
    // is ambiguous.
    for (const a of ACHIEVEMENTS) {
      const hasHtml = !!a.iconHTML;
      const hasImage = !!a.iconImage;
      expect(hasHtml && hasImage, `both iconHTML and iconImage set for ${a.id}`).toBe(false);
    }
  });

  it("iconImage paths point into /assets", () => {
    for (const a of ACHIEVEMENTS) {
      if (a.iconImage) {
        expect(
          a.iconImage.startsWith("assets/"),
          `iconImage doesn't point at /assets: ${a.id} → ${a.iconImage}`,
        ).toBe(true);
      }
    }
  });

  it("secret flag is boolean or undefined (no truthy-but-non-boolean)", () => {
    for (const a of ACHIEVEMENTS) {
      if ("secret" in a && a.secret !== undefined) {
        expect(typeof a.secret).toBe("boolean");
      }
    }
  });
});

describe("ACHIEVEMENTS_BY_ID lookup", () => {
  it("has one entry per catalog id", () => {
    expect(Object.keys(ACHIEVEMENTS_BY_ID).length).toBe(ACHIEVEMENTS.length);
  });

  it("every lookup resolves to the same object in the catalog", () => {
    for (const a of ACHIEVEMENTS) {
      expect(ACHIEVEMENTS_BY_ID[a.id]).toBe(a);
    }
  });

  it("unknown ids return undefined (prototype-free lookup)", () => {
    // Object.create(null) means 'toString' / 'constructor' / 'hasOwnProperty'
    // do NOT accidentally resolve to Object.prototype methods.
    expect(ACHIEVEMENTS_BY_ID.toString).toBeUndefined();
    expect(ACHIEVEMENTS_BY_ID.hasOwnProperty).toBeUndefined();
    expect(ACHIEVEMENTS_BY_ID.__proto__).toBeUndefined();
  });
});
