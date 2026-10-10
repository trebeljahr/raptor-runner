/*
 * Generates steam_input/ — the Steam Input action manifest and one official
 * controller layout per controller type — from game_actions_5035590.vdf.
 *
 * Steamworks ("Custom Configuration") reads the manifest from the install
 * directory of every depot, so scripts/release/publish-desktop.mjs copies the
 * folder into each depot root. The layouts are written by hand here instead of
 * exported from the Steam configurator so that all controller types stay
 * identical and reviewable; src/input/steamActions.test.ts checks the output.
 *
 *   node scripts/steam-input.mjs           rewrite steam_input/
 *   node scripts/steam-input.mjs --check   fail when steam_input/ is stale
 */

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = "game_actions_5035590.vdf";
const OUTPUT = "steam_input";
const MANIFEST = "steam_input_manifest.vdf";

// A VDF block is a list of [key, value] pairs because keys repeat ("group", "preset").
function parse(text) {
  const tokens = [...text.matchAll(/"((?:[^"\\]|\\.)*)"|([{}])/g)];
  let at = 0;
  const block = () => {
    const pairs = [];
    while (at < tokens.length) {
      const key = tokens[at++];
      if (key[2] === "}") return pairs;
      const value = tokens[at++];
      pairs.push([key[1], value[2] === "{" ? block() : value[1]]);
    }
    return pairs;
  };
  return block();
}

function print(pairs, depth = 0) {
  const tab = "\t".repeat(depth);
  return pairs
    .map(([key, value]) =>
      typeof value === "string"
        ? tab + '"' + key + '"\t\t"' + value + '"\n'
        : tab + '"' + key + '"\n' + tab + "{\n" + print(value, depth + 1) + tab + "}\n",
    )
    .join("");
}

const child = (pairs, key) => {
  const found = pairs.find(([name]) => name === key);
  if (!found) throw new Error('Missing "' + key + '" in ' + SOURCE);
  return found[1];
};

const actionsFile = child(parse(readFileSync(SOURCE, "utf8")), "In Game Actions");
const actions = child(actionsFile, "actions");
const localization = child(actionsFile, "localization");

// Mirrors the browser gamepad path in src/constants.ts: every face button and
// d-pad up jump; the confirm and cancel face buttons differ only in menus.
const face = (a, b, x, y) => ({ button_a: a, button_b: b, button_x: x, button_y: y });
const cross = {
  dpad_north: "nav_up",
  dpad_south: "nav_down",
  dpad_west: "nav_left",
  dpad_east: "nav_right",
};
const system = { button_escape: "menu_toggle", button_menu: "menu_toggle" };
// The game reads no analog actions, so the stick walks menus as a d-pad.
const LAYOUT = {
  InGame: [
    {
      source: "button_diamond",
      mode: "four_buttons",
      inputs: face("jump", "jump", "jump", "jump"),
    },
    { source: "dpad", mode: "dpad", inputs: { dpad_north: "jump" } },
    { source: "switch", mode: "switches", inputs: system },
  ],
  Menus: [
    {
      source: "button_diamond",
      mode: "four_buttons",
      inputs: face("select", "back", "select", "select"),
    },
    { source: "dpad", mode: "dpad", inputs: cross },
    { source: "joystick", mode: "dpad", inputs: cross, settings: [["requires_click", "0"]] },
    { source: "switch", mode: "switches", inputs: system },
  ],
};

// Controller type → the source that plays the d-pad. The Steam Controller has
// no physical d-pad; its left trackpad clicks as one.
const CONTROLLERS = {
  controller_xbox360: "dpad",
  controller_xboxone: "dpad",
  controller_xboxelite: "dpad",
  controller_ps4: "dpad",
  controller_ps5: "dpad",
  controller_ps5_edge: "dpad",
  controller_switch_pro: "dpad",
  controller_switch2_pro: "dpad",
  controller_switch_joycon_pair: "dpad",
  controller_neptune: "dpad",
  controller_steamcontroller_gordon: "left_trackpad",
  controller_generic: "dpad",
};

const declared = Object.fromEntries(
  actions.map(([set, body]) => [set, child(body, "Button").map(([name]) => name)]),
);

function layoutFile(type, dpadSource) {
  const groups = [];
  const presets = [];
  for (const [set, entries] of Object.entries(LAYOUT)) {
    const sources = [];
    for (const entry of entries) {
      const id = String(groups.length);
      const inputs = Object.entries(entry.inputs).map(([input, action]) => {
        if (!declared[set]?.includes(action))
          throw new Error(set + " does not declare action " + action);
        return [
          input,
          [
            [
              "activators",
              [["Full_Press", [["bindings", [["binding", "game_action " + set + " " + action]]]]]],
            ],
          ],
        ];
      });
      groups.push([
        "group",
        [
          ["id", id],
          ["mode", entry.mode],
          ["inputs", inputs],
          ...(entry.settings ? [["settings", entry.settings]] : []),
        ],
      ]);
      sources.push([id, (entry.source === "dpad" ? dpadSource : entry.source) + " active"]);
    }
    presets.push([
      "preset",
      [
        ["id", String(presets.length)],
        ["name", set],
        ["group_source_bindings", sources],
      ],
    ]);
  }
  const strings = localization.map(([language, tokens]) => [
    language,
    language === "english"
      ? [
          ["title", "Raptor Runner"],
          ["description", "Official layout. Every face button jumps."],
          ...tokens,
        ]
      : tokens,
  ]);
  return print([
    [
      "controller_mappings",
      [
        ["version", "3"],
        ["revision", "1"],
        ["title", "#title"],
        ["description", "#description"],
        ["controller_type", type],
        ["major_revision", "0"],
        ["minor_revision", "0"],
        ["actions", actions],
        ["localization", strings],
        ...groups,
        ...presets,
        ["settings", []],
      ],
    ],
  ]);
}

const fileFor = (type) => type.replace(/^controller_/, "steam_input_") + ".vdf";
const files = {
  [MANIFEST]: print([
    [
      "Action Manifest",
      [
        [
          "configurations",
          Object.keys(CONTROLLERS).map((type) => [type, [["0", [["path", fileFor(type)]]]]]),
        ],
        ["actions", actions],
        ["localization", localization],
      ],
    ],
  ]),
};
for (const [type, dpadSource] of Object.entries(CONTROLLERS))
  files[fileFor(type)] = layoutFile(type, dpadSource);

if (process.argv.includes("--check")) {
  const onDisk = readdirSync(OUTPUT).sort();
  const stale = Object.keys(files).filter(
    (name) => !onDisk.includes(name) || readFileSync(join(OUTPUT, name), "utf8") !== files[name],
  );
  const extra = onDisk.filter((name) => !(name in files));
  if (stale.length || extra.length) {
    throw new Error(
      "steam_input/ is stale; run node scripts/steam-input.mjs. Changed: " +
        [...stale, ...extra].join(", "),
    );
  }
} else {
  // This directory contains only generated files.
  rmSync(OUTPUT, { recursive: true, force: true });
  mkdirSync(OUTPUT);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(OUTPUT, name), content);
  console.log("Wrote " + Object.keys(files).length + " files to " + OUTPUT + "/");
}
