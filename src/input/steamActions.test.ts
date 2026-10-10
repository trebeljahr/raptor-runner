/*
 * Steam Input drift guards.
 *
 * Three artifacts must agree on the action vocabulary:
 *   1. src/input/steamActions.ts   (renderer copy — imported here)
 *   2. electron/steamInputActions.ts (main-process copy — read as text;
 *      importing it would race the compiled .js sibling that
 *      `pnpm electron:compile` drops next to it, which shadows the .ts
 *      under Vite's resolve order)
 *   3. game_actions_5035590.vdf    (the In-Game Actions file)
 *   4. steam_input/                (the action manifest and official
 *      layouts shipped in the Steam depots, generated from 3 by
 *      scripts/steam-input.mjs)
 * Editing any one alone fails this suite. The VDF is scraped with
 * minimal regexes on purpose — no VDF parser dependency.
 */

import { readdirSync, readFileSync } from "node:fs";
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

  // Which actions belong to which set. The union test above cannot
  // see an action drifting BETWEEN the blocks — the code reads an
  // action while its set is active, so e.g. `select` moving into the
  // InGame block would keep the union intact while menu navigation
  // silently dies under Steam. menu_toggle is deliberately in both:
  // it must resolve regardless of the active set, so the pause toggle
  // works in gameplay AND backs the player out of menus.
  const A = STEAM_DIGITAL_ACTIONS;
  const EXPECTED_SET_BUTTONS: Record<string, string[]> = {
    [STEAM_ACTION_SETS.inGame]: [A.jump, A.menuToggle],
    [STEAM_ACTION_SETS.menus]: [
      A.navUp,
      A.navDown,
      A.navLeft,
      A.navRight,
      A.select,
      A.back,
      A.menuToggle,
    ],
  };

  it("binds each set's Button block exactly as the code expects", () => {
    // Set keys and Button blocks are scraped independently but occur
    // in the same document order, so index-pairing them is sound for
    // any well-formed manifest.
    expect(setKeys).toHaveLength(buttonActions.length);
    setKeys.forEach((set, i) => {
      expect(sorted(buttonActions[i]), `Button block of set ${set}`).toEqual(
        sorted(EXPECTED_SET_BUTTONS[set] ?? []),
      );
    });
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

describe("steam_input/ stays in sync", () => {
  // Layouts repeat keys ("group", "preset"), so a block is a list of
  // pairs rather than an object.
  type Block = Array<[string, string | Block]>;
  const parse = (text: string): Block => {
    const tokens = [...text.matchAll(/"((?:[^"\\]|\\.)*)"|([{}])/g)];
    let at = 0;
    const block = (): Block => {
      const pairs: Block = [];
      while (at < tokens.length) {
        const key = tokens[at++];
        if (key[2] === "}") return pairs;
        const value = tokens[at++];
        pairs.push([key[1], value[2] === "{" ? block() : value[1]]);
      }
      return pairs;
    };
    return block();
  };
  const blocks = (pairs: Block, key: string): Block[] =>
    pairs
      .filter(([name, value]) => name === key && typeof value !== "string")
      .map(([, v]) => v as Block);
  const text = (pairs: Block, key: string): string | undefined =>
    pairs.find(([name, value]) => name === key && typeof value === "string")?.[1] as
      | string
      | undefined;

  const source = blocks(parse(repoFile("game_actions_5035590.vdf")), "In Game Actions")[0];
  const manifest = blocks(
    parse(repoFile("steam_input/steam_input_manifest.vdf")),
    "Action Manifest",
  )[0];
  const layouts = blocks(manifest, "configurations")[0].map(
    ([type, entries]) => [type, text(blocks(entries as Block, "0")[0], "path") ?? ""] as const,
  );

  // Steam resolves action handles from the manifest once it ships, so
  // an action added to the In-Game Actions file alone would never fire.
  it("carries the In-Game Actions file's actions and strings unchanged", () => {
    expect(blocks(manifest, "actions")).toEqual(blocks(source, "actions"));
    expect(blocks(manifest, "localization")).toEqual(blocks(source, "localization"));
  });

  it("lists every layout file in the folder, and nothing else", () => {
    const onDisk = readdirSync(join(process.cwd(), "steam_input")).filter(
      (name) => name !== "steam_input_manifest.vdf",
    );
    expect(sorted(layouts.map(([, path]) => path))).toEqual(sorted(onDisk));
  });

  // An opted-in controller has no fallback: the game skips the browser
  // gamepad path while Steam Input reports a controller, so an action
  // a layout leaves unbound is unreachable on that controller type.
  for (const [type, path] of layouts) {
    it(`${path} binds every action of every set`, () => {
      const layout = blocks(parse(repoFile(`steam_input/${path}`)), "controller_mappings")[0];
      expect(text(layout, "controller_type")).toBe(type);
      expect(blocks(layout, "actions")).toEqual(blocks(source, "actions"));

      const groups = new Map(blocks(layout, "group").map((group) => [text(group, "id"), group]));
      const presets = blocks(layout, "preset");
      expect(sorted(presets.map((preset) => text(preset, "name") ?? ""))).toEqual(
        sorted(SET_NAMES),
      );

      const claimed = new Set<string>();
      for (const preset of presets) {
        const set = text(preset, "name") ?? "";
        const declared = blocks(blocks(blocks(source, "actions")[0], set)[0], "Button")[0].map(
          ([name]) => name,
        );
        const bound = new Set<string>();
        for (const [id] of blocks(preset, "group_source_bindings")[0]) {
          expect(claimed.has(id), `group ${id} is used by two sets`).toBe(false);
          claimed.add(id);
          const group = groups.get(id);
          expect(group, `group ${id} of set ${set}`).toBeDefined();
          for (const [, input] of blocks(group ?? [], "inputs")[0]) {
            const bindings = JSON.stringify(input).match(/game_action [^"]+/g) ?? [];
            expect(bindings.length).toBeGreaterThan(0);
            for (const binding of bindings) {
              const [, boundSet, action] = binding.split(" ");
              expect(boundSet).toBe(set);
              expect(declared).toContain(action);
              bound.add(action);
            }
          }
        }
        expect(sorted([...bound]), `actions bound in set ${set}`).toEqual(sorted(declared));
      }
      expect(claimed.size).toBe(groups.size);
    });
  }
});
