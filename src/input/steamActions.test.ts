/*
 * Steam Input drift guards.
 *
 * Three artifacts must agree on the action vocabulary:
 *   1. src/input/steamActions.ts   (renderer copy — imported here)
 *   2. electron/steamInputActions.ts (main-process copy — read as text;
 *      importing it would race the compiled .js sibling that
 *      `pnpm electron:compile` drops next to it, which shadows the .ts
 *      under Vite's resolve order)
 *   3. game_actions_5035590.vdf    (the manifest uploaded to Steamworks)
 * Editing any one alone fails this suite. The VDF is scraped with
 * minimal regexes on purpose — no VDF parser dependency.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { familyFromSteamInputType, STEAM_ACTION_SETS, STEAM_DIGITAL_ACTIONS } from "./steamActions";

// Vitest runs with cwd at the repo root; happy-dom's URL polyfill
// mishandles file: resolution, so plain path joining it is.
const repoFile = (rel: string): string => readFileSync(join(process.cwd(), rel), "utf8");

const sorted = (xs: string[]): string[] => [...xs].sort();

const ACTION_NAMES = Object.values(STEAM_DIGITAL_ACTIONS) as string[];
const SET_NAMES = Object.values(STEAM_ACTION_SETS) as string[];

describe("familyFromSteamInputType", () => {
  const table: Array<[string, string]> = [
    ["PS3Controller", "playstation"],
    ["PS4Controller", "playstation"],
    ["PS5Controller", "playstation"],
    ["SwitchProController", "nintendo"],
    ["SwitchJoyConPair", "nintendo"],
    ["SwitchJoyConSingle", "nintendo"],
    ["XBox360Controller", "xbox"],
    ["XBoxOneController", "xbox"],
    ["SteamDeckController", "xbox"],
    ["SteamController", "generic"],
    ["GenericGamepad", "generic"],
    ["MobileTouch", "generic"],
    ["AppleMFiController", "generic"],
    ["AndroidController", "generic"],
    ["Unknown", "generic"],
    // Forward-compat: a device type this build has never heard of
    // must degrade to the neutral glyphs, not crash or mislabel.
    ["SomeFutureController", "generic"],
    ["", "generic"],
  ];
  for (const [inputType, family] of table) {
    it(`maps ${inputType || "(empty)"} to ${family}`, () => {
      expect(familyFromSteamInputType(inputType)).toBe(family);
    });
  }
});

describe("electron main-process copy stays in sync", () => {
  const source = repoFile("electron/steamInputActions.ts");

  const literalValues = (constName: string): string[] => {
    const block = source.match(new RegExp(`${constName}\\s*=\\s*\\{([^}]*)\\}`));
    if (!block) return [];
    return [...block[1].matchAll(/:\s*"([^"]+)"/g)].map((m) => m[1]);
  };

  it("declares the same digital action names", () => {
    expect(sorted(literalValues("STEAM_DIGITAL_ACTIONS"))).toEqual(sorted(ACTION_NAMES));
  });

  it("declares the same action set names", () => {
    expect(sorted(literalValues("STEAM_ACTION_SETS"))).toEqual(sorted(SET_NAMES));
  });
});

describe("game_actions_5035590.vdf stays in sync", () => {
  const vdf = repoFile("game_actions_5035590.vdf");

  // The quoted keys of every "Button" block are the digital actions.
  const buttonBlocks = [...vdf.matchAll(/"Button"\s*\{([^}]*)\}/g)].map((m) => m[1]);
  const buttonActions = buttonBlocks.map((block) =>
    [...block.matchAll(/"([^"#]+)"\s+"#/g)].map((m) => m[1]),
  );

  // Set keys sit directly under "actions", each immediately opening a
  // block that starts with "title".
  const setKeys = [...vdf.matchAll(/"(\w+)"\s*\{\s*"title"/g)].map((m) => m[1]);

  it("defines exactly the action sets the code requests", () => {
    expect(sorted(setKeys)).toEqual(sorted(SET_NAMES));
  });

  it("binds exactly the digital actions the code reads", () => {
    const union = new Set(buttonActions.flat());
    expect(sorted([...union])).toEqual(sorted(ACTION_NAMES));
  });

  it("keeps menu_toggle reachable from both sets", () => {
    // menu_toggle must resolve regardless of the active set, so the
    // pause toggle works in gameplay AND backs the player out of
    // menus. Steam action names are global; listing the action in
    // both Button blocks makes both default configs bind it.
    expect(buttonActions).toHaveLength(2);
    for (const block of buttonActions) {
      expect(block).toContain(STEAM_DIGITAL_ACTIONS.menuToggle);
    }
  });

  it("localizes every referenced token", () => {
    const english = vdf.match(/"english"\s*\{([^}]*)\}/);
    expect(english).not.toBeNull();
    const tokens = new Set([...vdf.matchAll(/"#(\w+)"/g)].map((m) => m[1]));
    expect(tokens.size).toBeGreaterThan(0);
    for (const token of tokens) {
      expect(english?.[1]).toMatch(new RegExp(`"${token}"\\s+"`));
    }
  });
});
