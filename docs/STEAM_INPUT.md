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

- `game_actions_5035590.vdf` (repo root) — the In-Game Actions
  manifest. Uploaded to Steamworks / copied for local testing; never
  shipped inside the app.
- `electron/steamInputActions.ts` — action/set name constants for the
  main process, which owns every native handle and pushes ~60 Hz
  level-state snapshots to the renderer over IPC.
- `src/input/steamActions.ts` — the renderer's copy of the same names
  plus the device-type → glyph-family mapping.
- `src/steamInput.ts` — renderer snapshot cache (250 ms freshness
  window) and action-set switching.
- `src/input/steamActions.test.ts` — drift guard: the two constant
  copies and the VDF must agree, or `pnpm test` fails.

## Partner-site upload (app 5035590)

1. Steamworks → App 5035590 → Steamworks Settings → Application →
   Steam Input.
2. Under "In-Game Actions File", upload `game_actions_5035590.vdf`.
3. Create the default configuration in the configurator:
   - **InGame set**: face buttons → `jump`; Start/Select (and
     equivalents) → `menu_toggle`; d-pad up → `jump` (matches the
     keyboard's up-arrow-jumps).
   - **Menus set**: d-pad **and** left-stick-as-dpad → `nav_up` /
     `nav_down` / `nav_left` / `nav_right`; confirm face button →
     `select`; cancel face button → `back`; Start/Select →
     `menu_toggle`. Binding the stick as a dpad here is what gives
     stick menu navigation — the game reads no axes on the Steam
     path.
4. Set the configuration as the official default for the app and
   publish it.
5. Publish the Steamworks change set. Expect propagation delay —
   clients can take a while (up to hours) to pick up a new in-game
   actions file; restarting Steam usually hurries it along.

## Local testing recipe

1. Copy the manifest into Steam's config directory so the local
   client knows it without a partner-site round trip:
   `cp game_actions_5035590.vdf "<Steam install>/controller_config/game_actions_5035590.vdf"`
   (macOS: `~/Library/Application Support/Steam/controller_config/`,
   create the directory if missing), then restart Steam.
2. Steam must be running and logged into an account that owns app
   5035590.
3. Run `STEAM_APP_ID=5035590 pnpm electron:preview`. The env override
   is required: the repo's `steam_appid.txt` still says 480 and is
   handled in a separate task — do not edit it.
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

## Failure modes (manual test matrix)

| Scenario | Expected behaviour |
| --- | --- |
| Steam not running | No Steam init; W3C path, id-heuristic glyphs |
| itch / DRM-free build (no app id) | Steam code never touched; identical to before |
| `input.init()` throws | Caught; no frames; W3C path |
| Handles stay `0n` (VDF not uploaded/loaded) | Snapshots `available:false`; W3C path; resolution retried ~1/s, Steam path engages late if the manifest appears |
| Steam Input disabled for the pad in Steam settings | `controllerCount: 0` frames; raw pad still visible to Chromium; W3C path |
| Launched outside Steam, Steam running | Full Steam path if the config loads; W3C fallback otherwise |
| Steam quits mid-session | Frames stale after 250 ms; primed handoff to W3C; auto-pause fires on the controllers-lost transition |
