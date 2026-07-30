/*
 * Steam Input action names — main-process copy.
 *
 * MUST stay in sync with src/input/steamActions.ts and with the
 * "Button" blocks in game_actions_5035590.vdf (repo root). The
 * renderer cannot share this module directly: `pnpm electron:compile`
 * derives its rootDir from the files it is given, so importing across
 * the src/ boundary would widen that root, shift the emitted output
 * layout, and break `path.join(__dirname, "preload.js")` in main.ts.
 * src/input/steamActions.test.ts enforces the sync — editing one copy
 * (or the VDF) alone fails `pnpm test`.
 *
 * Dependency-free and side-effect-free by design.
 */

export const STEAM_ACTION_SETS = {
  inGame: "InGame",
  menus: "Menus",
} as const;

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
