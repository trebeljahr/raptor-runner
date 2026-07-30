/*
 * Steam Input action names — renderer-side copy.
 *
 * Steam Input replaces raw button indices with named actions the
 * player can rebind in the Steam controller configurator. The names
 * here must match the "Button" blocks of the in-game actions manifest
 * (game_actions_5035590.vdf at the repo root, uploaded to the
 * Steamworks partner site — see docs/STEAM_INPUT.md).
 *
 * The Electron main process resolves the same names to native handles.
 * Its copy lives in electron/steamInputActions.ts and cannot simply be
 * imported from here: `pnpm electron:compile` derives its rootDir from
 * the files it is given, so an import crossing the src/ boundary would
 * shift the emitted output layout and break the packaged main-process
 * entry. steamActions.test.ts pins both copies to each other and to
 * the VDF, so drift fails `pnpm test` instead of silently unbinding a
 * controller.
 */

import type { PadFamily } from "./padFamily";

export const STEAM_ACTION_SETS = {
  inGame: "InGame",
  menus: "Menus",
} as const;

export type SteamActionSetName = (typeof STEAM_ACTION_SETS)[keyof typeof STEAM_ACTION_SETS];

export const STEAM_DIGITAL_ACTIONS = {
  jump: "jump",
  menuToggle: "menu_toggle",
  navUp: "nav_up",
  navDown: "nav_down",
  navLeft: "nav_left",
  navRight: "nav_right",
  select: "select",
  back: "back",
} as const;

export type SteamDigitalActionName =
  (typeof STEAM_DIGITAL_ACTIONS)[keyof typeof STEAM_DIGITAL_ACTIONS];

/**
 * Map a steamworks.js `Controller.getType()` string to the glyph
 * family used for on-screen button prompts (pad-family-* body class,
 * see src/input/padFamily.ts).
 *
 * Compared as raw strings, not against the library's InputType enum:
 * that enum is an ambient const enum in a .d.ts, so it has no runtime
 * value to import — and string comparison survives library upgrades
 * that add new members. Anything unrecognized falls back to the
 * neutral glyph set.
 *
 * This mapping matters precisely because Steam Input is active: the
 * emulated pad Steam shows to Chromium always claims to be an Xbox
 * 360 controller, so the Gamepad.id regex would label every device
 * xbox. Steam's own device type is the only truthful source here.
 */
export function familyFromSteamInputType(inputType: string): PadFamily {
  switch (inputType) {
    case "PS3Controller":
    case "PS4Controller":
    case "PS5Controller":
      return "playstation";
    case "SwitchProController":
    case "SwitchJoyConPair":
    case "SwitchJoyConSingle":
      return "nintendo";
    case "XBox360Controller":
    case "XBoxOneController":
    case "SteamDeckController":
      return "xbox";
    default:
      return "generic";
  }
}
