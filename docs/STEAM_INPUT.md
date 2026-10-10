# Steam Input

## What this is

Desktop builds running under Steam read the controller through the
Steam Input API as semantic, player-rebindable actions ("jump",
"select", "nav_up", ...) instead of raw button indices. Everywhere
else — web, mobile, itch/DRM-free desktop, Steam-less sessions — the
W3C Gamepad API path in `src/main.ts` runs exactly as before. That is
the load-bearing invariant: the W3C path is never modified, only
*skipped* while (and only while) fresh Steam Input snapshots with at
least one controller exist. Every Steam-side failure degrades to the
pre-Steam-Input behaviour within a quarter second.

Moving parts:

- `game_actions_5035590.vdf` (repo root) — the In-Game Actions file
  and the source of truth for action names. Copied into Steam's
  config directory for local testing; never shipped.
- `steam_input/` — the action manifest (`steam_input_manifest.vdf`)
  and one official layout per controller type. Generated from the
  In-Game Actions file by `pnpm steam:input`
  (`scripts/steam-input.mjs`); do not edit by hand.
  `scripts/release/publish-desktop.mjs` copies the folder into the
  root of every Steam depot, outside the signed macOS bundles.
- `electron/steamInputActions.ts` — action/set name constants for the
  main process, which owns every native handle and pushes ~60 Hz
  level-state snapshots to the renderer over IPC.
- `src/input/steamActions.ts` — the renderer's copy of the same names
  plus the device-type → glyph-family mapping.
- `src/steamInput.ts` — renderer snapshot cache (250 ms freshness
  window) and action-set switching.
- `src/input/steamActions.test.ts` — drift guard: the two constant
  copies and the VDF must agree, or `pnpm test` fails.

## Steamworks settings (app 5035590)

Steamworks has no upload for the In-Game Actions file. The manifest
and layouts ship in the depots, and Steamworks only names the path.

Steamworks → App 5035590 → Steamworks Settings → Application →
Steam Input:

- **Opt Controllers into Steam Input**: Xbox, PlayStation, Nintendo
  Switch, Generic and Any Future Devices are all ticked, so the
  action path is the default on every pad.
- **Steam Input Default Controller Configuration**: Custom
  Configuration, with the manifest path
  `steam_input/steam_input_manifest.vdf` (relative to the install
  directory).
- Touch configuration and Steam Deck touchscreen mode keep their
  defaults.

Publish the Steamworks change set after any change on that page.

The official layouts, identical on every controller type:

- **InGame set**: every face button → `jump`; d-pad up → `jump`
  (matches the keyboard's up-arrow-jumps); Start and Select (and
  equivalents) → `menu_toggle`.
- **Menus set**: d-pad **and** left-stick-as-dpad → `nav_up` /
  `nav_down` / `nav_left` / `nav_right`; A, X, Y positions →
  `select`; B position → `back`; Start and Select → `menu_toggle`.
  Binding the stick as a dpad here is what gives stick menu
  navigation — the game reads no axes on the Steam path.
- The Steam Controller has no d-pad, so its left trackpad click takes
  the d-pad's bindings.

To change a binding or add a controller type, edit `LAYOUT` or
`CONTROLLERS` in `scripts/steam-input.mjs`, run `pnpm steam:input`,
and upload a new Steam build. `pnpm test` fails when a layout leaves
an action unbound: the game skips the W3C path while Steam Input
reports a controller, so an unbound action is unreachable.

The layouts are written by the script, not exported from the Steam
configurator. Check each controller family once on a Steam install
after a layout change (see the test matrix below).

## Local testing recipe

1. Copy the manifest into Steam's config directory so the local
   client knows it without a partner-site round trip:
   `cp game_actions_5035590.vdf "<Steam install>/controller_config/game_actions_5035590.vdf"`
   (macOS: `~/Library/Application Support/Steam/controller_config/`,
   create the directory if missing), then restart Steam.
2. Steam must be running and logged into an account that owns app
   5035590.
3. Run `pnpm electron:preview`. The repo's `steam_appid.txt` carries
   the real app id (5035590) since the store went into beta;
   `STEAM_APP_ID` remains available as an override for testing
   against a different app id.
4. Watch the terminal for `[steam-input] init ok` followed (possibly
   seconds later) by `[steam-input] action handles resolved`. Until
   handles resolve, the game intentionally stays on the W3C gamepad
   path.
5. Open the Steam overlay's controller configurator: it should show
   the two sets with their localized titles ("In Game", "Menus").

## Verifying set switching

With a controller active, watch the configurator's active-set
indicator:

- Gameplay and the start screen → **In Game**.
- Open the pause menu, any sub-overlay (credits, achievements,
  imprint, about), or die (score card) → **Menus**.
- Close the overlay / restart the run → back to **In Game**.

The renderer re-derives the desired set every frame and only sends an
IPC on change, so a missed transition self-heals within one frame.

## Known limitation: glyphs and remaps

steamworks.js 0.4.0 exposes **no action-origin or glyph query APIs**.
Verified against `node_modules/steamworks.js/client.d.ts`: the
`input` namespace contains only `init`, `getControllers`,
`getActionSet`, `getDigitalAction`, `getAnalogAction`, `shutdown`,
and `Controller.getType()` — nothing that reports which physical
button an action is currently bound to, and nothing that returns
Valve's glyph art.

On-screen button prompts therefore follow `Controller.getType()` at
device-family granularity: a PS5 player sees PlayStation shapes, a
Switch player sees Nintendo letters. But the prompts are
remap-*unaware* — a player who moves "jump" to L1 in the Steam
configurator still sees the Cross glyph. For the store wizard's
"displays appropriate glyphs" question the honest answer is: yes
per device family via the Steam Input device type; no per binding.

`ShowBindingPanel` is equally absent from the binding, so in-game
rebinding is handled by deep link instead: the accessibility settings
show a "Controller bindings (Steam)" row (only while the Steam Input
path is live) that opens `steam://controllerconfig/<appid>` via the
OS — the Steam client resolves it to its own configurator (Big
Picture window on desktop, native overlay UI on Steam Deck).

Closing the remaining gaps (action origins for remap-aware prompts,
Valve glyph art, `GetCurrentActionSet` read-back) requires forking
steamworks.js and extending its Rust `input` module — upstream
master, checked 2026-08, exposes nothing beyond the 0.4.0 surface.

## Failure modes (manual test matrix)

| Scenario | Expected behaviour |
| --- | --- |
| Steam not running | No Steam init; W3C path, id-heuristic glyphs |
| itch / DRM-free build (no app id) | Steam code never touched; identical to before |
| `input.init()` throws | Caught; no frames; W3C path |
| Handles stay `0n` (manifest missing from the depot, or the Steamworks path not published) | Snapshots `available:false`; W3C path; resolution retried ~1/s, Steam path engages late if the manifest appears |
| Handles resolve but the layout for this controller type fails to load | Controller does nothing in game: the Steam path is live with no bindings. Check `Steam/logs/controller*.txt`, fix the layout, upload a new build |
| Steam Input disabled for the pad in Steam settings | `controllerCount: 0` frames; raw pad still visible to Chromium; W3C path |
| Launched outside Steam, Steam running | Full Steam path if the config loads; W3C fallback otherwise |
| Steam quits mid-session | Frames stale after 250 ms; primed handoff to W3C; auto-pause fires on the controllers-lost transition |
