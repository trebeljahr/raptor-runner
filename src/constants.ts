/*
 * Raptor Runner — constants. Physics, visual thresholds, localStorage
 * keys, sprite anchor tables, sky palette. Dependency-graph leaf:
 * imports nothing from the rest of the game, safe to import anywhere.
 */

// ── Core physics & pacing ─────────────────────────────────
export const INITIAL_BG_VELOCITY = 7;
export const GRAVITY = 0.1;
export const JUMP_CLEARANCE_MULTIPLIER = 1.65;
// Score points per full day/night cycle. Sized so pure-day and
// pure-night bands each stay at 5 points per band regardless of how
// many transition bands sit between them.
export const SKY_CYCLE_SCORE = 80;
export const SKY_UPDATE_INTERVAL_FRAMES = 10;

// ── Gameplay & Physics ──────────────────────────────────────
export const RAPTOR_WIDTH_RATIO = 1 / 3;
export const VELOCITY_SCALE_DIVISOR = 1000;
export const DOWNWARD_ACCEL_DIVISOR = 10;
export const SPEED_INCREMENT = 0.1;
export const MAX_BG_VELOCITY = 17;
// Minimum spawn gap between cacti, in raptor-widths — floor at a
// fresh run.
export const CACTUS_SPAWN_GAP_BASE = 1.2;
// How much the floor grows as bgVelocity climbs from INITIAL to MAX.
// Keeps back-to-back doubles from spawning at terminal velocity.
// Floor = BASE at t=0, BASE+FACTOR at t=1 (1.2w → 1.5w).
export const CACTUS_SPAWN_GAP_SPEED_FACTOR = 0.3;
// Max extra gap on top of the floor, in raptor-widths. Adds variance
// so pacing isn't metronomic — average lands at ~1.7w (floor 1.2 +
// mean top-up 0.5).
export const CACTUS_SPAWN_GAP_RANDOM_MAX = 1.0;
// Random span shrinkage at terminal velocity. 0.58 = span collapses
// to 42% of its starting size at max speed, so late game reads
// denser than early game.
export const CACTUS_SPAWN_GAP_RANDOM_SHRINK = 0.58;

// ── Cactus-spawn breathers (designed rest areas) ──────────
// Periodically the spawner skips a normal gap for a long empty
// stretch filled with a flower field — a designed rest area.
// Distance-driven: a breather fires every N meters of score so
// the cadence stays stable even as bgVelocity ramps up.
export const CACTUS_BREATHER_INTERVAL_METERS = 500;
// Length of each rest area in seconds-of-travel (measured against
// bgVelocity so it feels consistent at any speed).
export const CACTUS_BREATHER_MIN_SECONDS = 4;
export const CACTUS_BREATHER_MAX_SECONDS = 6;

// ── Score / distance scoring ──────────────────────────────
// Score is "meters run" — a continuous distance counter that grows
// proportionally to bgVelocity. One meter ≈ one unit of bgVelocity
// over one 60 fps second. Derived so that at the default ~1.7w
// cactus gap and 1000 px reference width, ≈10 meters elapse per
// cactus passed (so 100 cacti cleared ≈ 1000 m).
export const METERS_PER_BG_UNIT_PER_FRAME = 1 / 60;
export const JUMP_BUFFER_MS = 100;
export const JUMP_VIBRATION_MS = 15;
export const FRAME_DELAY_SPEED_RANGE = 15;

// ── Ground Rendering ───────────────────────────────────────
export const GROUND_HEIGHT_RATIO = 1 / 10;
export const GROUND_BAND_HEIGHTS_PX = [5, 10, 20, 200];
// Top band is desert-yellow topsoil; flower-field rest areas
// overlay it with GRASS_FIELD_COLOR inside grassFields x-ranges.
export const GROUND_BAND_COLORS = ["#ebc334", "#ebab21", "#ba8c27", "#EDC9AF"];
/** Green for the top ground band inside a flower-field rest area. */
export const GRASS_FIELD_COLOR = "#7fb844";

// ── Flower patches ─────────────────────────────────────────
// Scenic clusters spawned inside breather gaps. A patch is 3–7
// flowers along the grass line.
export const FLOWER_PATCH_MIN_COUNT = 3;
export const FLOWER_PATCH_MAX_COUNT = 7;
export const FLOWER_MIN_HEIGHT_PX = 34;
export const FLOWER_MAX_HEIGHT_PX = 58;
export const FLOWER_PATCH_WIDTH_PX = 220;

// ── Collectible coins (breather rest-area pickups) ────────
export const COIN_SCORE_VALUE = 1;
/** Persistent shop balance per pickup — separate from COIN_SCORE_VALUE
 *  so the in-run and cross-run currencies can rebalance independently. */
export const COIN_BANK_REWARD = 1;
/** Fixed count (not spacing-based) so the rising-pitch chain always
 *  has the same number of steps. */
export const COIN_COUNT_PER_FIELD = 10;
/** Coin spacing in raptor-widths. Tight ribbon centred in the field
 *  so the pitch chain plays out as a quick run — at 0.5 the sprites
 *  overlap by ~⅓ of their width. Clamped if the ribbon would exceed
 *  the breather width. */
export const COIN_SPACING_RATIO = 0.5;
/** Coin height as a fraction of raptor height. */
export const COIN_SIZE_RATIO = 0.28;
/** Coin-center hover height above ground as a fraction of raptor
 *  height. 0.65 ≈ upper-chest / shoulder — grabbable without jumping,
 *  airborne enough to read as worth reaching for. */
export const COIN_BASE_Y_ABOVE_GROUND_RATIO = 0.65;
/** Clearance at each field edge (raptor-widths) where coins don't
 *  spawn, so pickups never fight the cactus jump/death beat. */
export const COIN_FIELD_EDGE_MARGIN_RAPTOR_WIDTHS = 1.25;
/** Bob amplitude (px). Small enough to stay within the raptor's
 *  AABB so the coin is always collectible on contact. */
export const COIN_BOB_AMPLITUDE_PX = 6;
export const COIN_BOB_FREQUENCY_HZ = 1.2;
/** Pop-fade frames after a pickup. Short — reads as a snap. */
export const COIN_COLLECT_FADE_FRAMES = 6;
/** Glint cadence — slower than bob so the rhythms don't beat. */
export const COIN_SPARKLE_FREQUENCY_HZ = 0.9;
export const COIN_GLINT_SIZE_RATIO = 0.22;
export const COIN_GLINT_MAX_ALPHA = 1.0;
/** Count of ambient twinkle sparkles around each coin (off-phase
 *  per-coin so neighbours don't flash in sync). */
export const COIN_AMBIENT_TWINKLE_COUNT = 5;
export const COIN_TWINKLE_FREQUENCY_HZ = 1.8;
export const COIN_COLLECT_BURST_COUNT = 16;
export const COIN_COLLECT_SPARK_LIFE_MIN_SEC = 0.18;
export const COIN_COLLECT_SPARK_LIFE_MAX_SEC = 0.32;
export const COIN_COLLECT_SPARK_SPEED_MIN = 140;
export const COIN_COLLECT_SPARK_SPEED_MAX = 300;
/** Chain-end chord gain, lower than base pickup (0.35) so the chord
 *  doesn't blow out when it layers on the tenth already-pitched cue. */
export const COIN_CHAIN_END_GAIN = 0.25;
/** Pitch step per coin in a streak. At 0.07 over 10 coins the chain
 *  lands at 1.63× — a confident rise below the cap so the chain-end
 *  chord can sit on top without clipping. */
export const COIN_STREAK_PITCH_STEP = 0.07;
export const COIN_STREAK_MAX_PITCH = 1.7;
/** Safety-net streak reset when no coin is picked up for this long.
 *  The real source of truth is the explicit per-field reset in
 *  spawnCoinsInRange; this just covers idle walks between fields. */
export const COIN_STREAK_RESET_MS = 1500;
/** Diamond (end-of-field gem) scale vs regular coin size. Big
 *  enough to read as a separate reward at a glance, small enough
 *  to stay within the raptor's pickup envelope. */
export const DIAMOND_SIZE_SCALE = 1.6;
/** Persistent bank payout for a diamond pickup. 10× COIN_BANK_REWARD
 *  — the payoff for completing the full 10-coin chain in a field. */
export const DIAMOND_BANK_REWARD = 10;
/** Sparkle count around the diamond — denser than a coin's ambient
 *  twinkles so the gem reads as the flashier end-of-chain reward.
 *  Each sparkle carries its own phase so the edge never flickers
 *  in lockstep. */
export const DIAMOND_SPARKLE_COUNT = 10;
/** Sparkle orbit radius as a fraction of the diamond's width. ~0.7
 *  keeps most sparkles along the silhouette edge rather than
 *  drifting into open sky. */
export const DIAMOND_SPARKLE_ORBIT_RATIO = 0.7;

// ── Celestial Bodies (Sun & Moon) ──────────────────────────
// Phases expressed as band-index / SKY_COLORS.length so anchors
// stay in lockstep with the palette.
export const SUN_PHASE_CENTER = 2 / 16;
export const MOON_PHASE_CENTER = 10 / 16;
export const CELESTIAL_ARC_HALF_WIDTH = 0.25;
export const CELESTIAL_ARC_EXTENSION = 0.18;
export const CELESTIAL_ARC_HEIGHT_RATIO = 0.7;
export const SUN_MIN_RADIUS_PX = 21;
export const SUN_RADIUS_SCALE = 0.03;
export const MOON_MIN_RADIUS_PX = 13;
export const MOON_RADIUS_SCALE = 0.0192;
export const MOON_SYNODIC_CYCLE = 30;
/** Day-cycle offset before mapping to moon phase. A fresh save's first
 *  night shows a visible waxing crescent instead of a new moon. */
export const MOON_PHASE_OFFSET_DAYS = 2;

// ── Gamepad / controller ─────────────────────────────────
// Indices per the Standard Gamepad mapping:
// https://www.w3.org/TR/gamepad/#remapping
// We accept every face button for "select" / "jump" so ABXY vs
// Cross/Circle/Square/Triangle vs Switch-Pro's BA-swap all land
// without hardware detection.

/** Jump buttons during gameplay. Every face button + D-pad up. */
export const GAMEPAD_JUMP_BUTTONS = [0, 1, 2, 3, 12];

/** Pause-menu toggle. Index 8 = Back/Select/Share/View/−,
 *  9 = Start/Options/+, 16 = Guide/Home/PS/Xbox, 17 = extra meta
 *  on some oddball pads. All four so the player can use whichever
 *  "system" button sits under their thumb. */
export const GAMEPAD_MENU_TOGGLE_BUTTONS = [8, 9, 16, 17];
// Back-compat aliases.
export const GAMEPAD_MENU_BUTTON = 9;
export const GAMEPAD_HOME_BUTTON = 16;

/** Activate the focused menu item: A/X/Y. B is excluded — it's the
 *  universal "back" face button on every vendor. */
export const GAMEPAD_MENU_SELECT_BUTTONS = [0, 2, 3];
/** "Back" / close current sub-overlay. B/Circle/(Switch Pro A) + D-pad
 *  left. Japan-region PlayStation inverts circle/cross, accepted. */
export const GAMEPAD_MENU_BACK_BUTTONS = [1, 14];

/** D-pad menu navigation. Left-stick Y is also read separately so
 *  pads without a usable D-pad can still walk the focus ring. */
export const GAMEPAD_MENU_UP_BUTTONS = [12];
export const GAMEPAD_MENU_DOWN_BUTTONS = [13];
// Left/right only meaningful in side-by-side sub-overlays (reset-
// confirm). The main menu treats all four as prev/next.
export const GAMEPAD_MENU_LEFT_BUTTONS = [14];
export const GAMEPAD_MENU_RIGHT_BUTTONS = [15];

/** Stick press threshold + deadzone, separated for hysteresis so a
 *  stick resting near the edge doesn't rapid-fire navigations. */
export const GAMEPAD_STICK_PRESS_THRESHOLD = 0.6;
export const GAMEPAD_STICK_DEADZONE = 0.25;

// ── Cinematic / filming mode (F9) ────────────────────────
// Phases are (band_index + offset) / SKY_COLORS.length. Keys 1–9+0
// cover every named moment in the 16-band cycle.
export const CINEMATIC_PHASES = [
  { key: "1", phase: 2 / 16, label: "Midday (sun zenith)" },
  { key: "2", phase: 4 / 16, label: "Afternoon" },
  { key: "3", phase: 5.5 / 16, label: "Golden hour" },
  { key: "4", phase: 6.5 / 16, label: "Sunset" },
  { key: "5", phase: 7.5 / 16, label: "Blue hour" },
  { key: "6", phase: 10 / 16, label: "Midnight (moon zenith)" },
  { key: "7", phase: 12 / 16, label: "Late night" },
  { key: "8", phase: 13.5 / 16, label: "Pre-dawn blue hour" },
  { key: "9", phase: 14.5 / 16, label: "Sunrise" },
  { key: "0", phase: 15.5 / 16, label: "Early morning gold" },
] as const;

// ── Dunes & Parallax ──────────────────────────────────────
export const DUNE_SCROLL_SPEED = 0.08;
export const DUNE_BASE_HEIGHT_RATIO = 0.09;
export const DUNE_CACTUS_MIN_HEIGHT_PX = 18;
export const DUNE_CACTUS_HEIGHT_RANGE_PX = 20;
export const DUNE_CACTUS_MIN_SPACING_PX = 80;
export const DUNE_CACTUS_SPACING_RANGE_PX = 200;
export const CLOUD_PARALLAX_DIVISOR = 2000;

// ── Cloud Spawning ─────────────────────────────────────────
export const CLOUD_DENSITY_DIVISOR = 380;
export const CLOUD_MIN_COUNT = 3;
export const CLOUD_RAIN_MULTIPLIER_MAX = 2;
export const CLOUD_MIN_SPACING_RATIO = 0.22;
export const CLOUD_MIN_SPACING_FLOOR_PX = 220;
export const CLOUD_HEAVY_RAIN_SPACING = 0.3;
export const CLOUD_SPAWN_INTERVAL = 8;

// ── Stars & Night Sky ──────────────────────────────────────
export const STAR_AREA_PER_STAR_PX2 = 8000;
export const STAR_MIN_COUNT = 80;
export const STAR_BRIGHT_PROBABILITY = 0.15;
export const STAR_TWINKLE_PROBABILITY = 0.65;
export const MILKY_WAY_STAR_COUNT = 220;
export const MILKY_WAY_TILT = -Math.PI / 7;
export const MILKY_WAY_LENGTH_SCALE = 1.6;
export const MILKY_WAY_THICKNESS_RATIO = 0.22;
export const STAR_ROTATION_PER_CYCLE = Math.PI * 0.1;
export const STAR_PIVOT_HEIGHT_RATIO = -1.5;

// ── Weather (Rain & Lightning) ─────────────────────────────
export const RAIN_SPAWN_DENSITY_DIVISOR = 300;
export const RAIN_FADE_IN_RATE = 0.008;
// Higher rate = snappier fade. 0.035 ≈ ~30 frames for 1→0 (≈500 ms
// at 60 fps), down from ~50 frames (~850 ms) at 0.02. The drizzle
// tail was outstaying its welcome — user feedback was that the
// post-storm trickle lingered into the rainbow window.
export const RAIN_FADE_OUT_RATE = 0.035;
export const RAIN_AUDIO_MAX_VOLUME = 0.2;
export const LIGHTNING_INTENSITY_THRESHOLD = 0.8;
export const LIGHTNING_FLASH_PROBABILITY = 0.002;
export const LIGHTNING_MIN_COOLDOWN_MS = 5000;
export const LIGHTNING_MAX_COOLDOWN_MS = 10000;
export const THUNDER_DELAY_MIN_MS = 100;
export const THUNDER_DELAY_MAX_MS = 600;
export const LIGHTNING_BOLT_MIN_SEGMENTS = 8;
export const LIGHTNING_BOLT_MAX_SEGMENTS = 13;

// ── Shooting Stars ─────────────────────────────────────────
export const SHOOTING_STAR_SPAWN_RATE = 0.018;
export const SHOOTING_STAR_SPEED_SCALE = 0.9;
export const SHOOTING_STAR_LIFETIME_MIN_SEC = 0.9;
export const SHOOTING_STAR_LIFETIME_MAX_SEC = 1.5;
export const SHOOTING_STAR_RAIN_THRESHOLD = 0.1;

// ── Particle Effects ───────────────────────────────────────
export const CONFETTI_BURST_COUNT = 70;
export const CONFETTI_GRAVITY_PX_S2 = 900;
export const CONFETTI_DRAG = 0.985;
export const DUST_BURST_MIN = 8;
export const DUST_BURST_MAX = 12;
export const DUST_GRAVITY_PX_S2 = 200;
export const RAINBOW_LIFETIME_SEC = 6;
export const RAINBOW_MAX_OPACITY = 0.55;
export const RAINBOW_SPAWN_CHANCE = 0.5;

// ── Game Over & Timing ─────────────────────────────────────
export const GAME_OVER_FADE_RATE = 0.01;
export const DELTA_TIME_CLAMP = 1 / 20;

// ── Revive ─────────────────────────────────────────────────
// Revive price curve (per run): first revive is cheap, second
// marks up 2.5×, then doubles from there. 50 → 125 → 250 → 500 →
// 1000 … Cheap first revive keeps the option friendly for new
// players; the step-up at revive #2 signals "this stacks fast".
export const REVIVE_FIRST_COST = 50;
export const REVIVE_SECOND_COST = 125;
// ~2 seconds at 60fps. Long enough to clear the killing obstacle
// AND settle onto the ground before the next collision check — the
// prior 60-frame window occasionally dropped the player right back
// into the cactus silhouette if the revive fired mid-fall.
export const REVIVE_INVULN_FRAMES = 120;

// ── localStorage keys (namespaced under `raptor-runner:*`) ─
export const HIGH_SCORE_KEY = "raptor-runner:highScore";
export const MUTED_KEY = "raptor-runner:muted";
export const MUSIC_MUTED_KEY = "raptor-runner:musicMuted";
export const JUMP_MUTED_KEY = "raptor-runner:jumpMuted";
export const RAIN_MUTED_KEY = "raptor-runner:rainMuted";
// Per-channel SFX mutes. Missing values load as "not muted" so every
// channel defaults to ON on first launch.
export const FOOTSTEPS_MUTED_KEY = "raptor-runner:footstepsMuted";
export const COINS_MUTED_KEY = "raptor-runner:coinsMuted";
export const UI_MUTED_KEY = "raptor-runner:uiMuted";
export const EVENTS_MUTED_KEY = "raptor-runner:eventsMuted";
export const THUNDER_MUTED_KEY = "raptor-runner:thunderMuted";
export const TOTAL_JUMPS_KEY = "raptor-runner:totalJumps";
export const UNLOCKED_PARTY_HAT_KEY = "raptor-runner:unlocked:partyHat";
export const UNLOCKED_THUG_GLASSES_KEY = "raptor-runner:unlocked:thugGlasses";
export const WEAR_PARTY_HAT_KEY = "raptor-runner:wear:partyHat";
export const WEAR_THUG_GLASSES_KEY = "raptor-runner:wear:thugGlasses";
export const UNLOCKED_BOW_TIE_KEY = "raptor-runner:unlocked:bowTie";
export const WEAR_BOW_TIE_KEY = "raptor-runner:wear:bowTie";
export const CAREER_RUNS_KEY = "raptor-runner:careerRuns";
export const ACHIEVEMENTS_KEY = "raptor-runner:achievements";
export const TOTAL_DAY_CYCLES_KEY = "raptor-runner:totalDayCycles";
/** Lifetime nights survived across ALL runs — drives the
 *  "Insomniac" achievement (10 total), which moved from a per-run
 *  goal to a career goal so it rewards cumulative playtime. */
export const TOTAL_NIGHTS_KEY = "raptor-runner:totalNightsSurvived";
export const RARE_EVENTS_SEEN_KEY = "raptor-runner:rareEventsSeen";
// ── Coin economy ───────────────────────────────────────────
export const COINS_BALANCE_KEY = "raptor-runner:coinsBalance";
/** Persistent lifetime total of coins PICKED UP — never decremented
 *  by spending. Drives the "coin hoarder" achievement and could
 *  back stats displays later. */
export const COINS_COLLECTED_KEY = "raptor-runner:coinsCollected";
/** JSON array of owned cosmetic ids (buys + score unlocks). */
export const OWNED_COSMETICS_KEY = "raptor-runner:ownedCosmetics";
/** JSON object {head, eyes, neck, back} → cosmetic id or null. */
export const EQUIPPED_COSMETICS_KEY = "raptor-runner:equippedCosmetics";

// ── Accessibility settings ─────────────────────────────────
// All keys are declared up front — even the ones whose effects
// aren't wired yet — so DURABLE_KEYS in persistence.ts and the
// settings UI share one source of truth from day one instead of
// each later feature inventing its own key ad hoc.
/** UI text scale multiplier (see TEXT_SCALE_MIN/MAX below). */
export const TEXT_SCALE_KEY = "raptor-runner:textScale";
/** One of REDUCE_MOTION_VALUES. "system" defers to the OS-level
 *  prefers-reduced-motion media query; "on"/"off" override it. */
export const REDUCE_MOTION_KEY = "raptor-runner:reduceMotion";
export const HIGH_CONTRAST_KEY = "raptor-runner:highContrast";
// Volumes are linear gains stored as numbers in 0..1. Master scales
// everything; the per-channel keys mirror the per-channel mute
// flags above so the two systems stay symmetrical.
export const MASTER_VOLUME_KEY = "raptor-runner:masterVolume";
export const MUSIC_VOLUME_KEY = "raptor-runner:musicVolume";
export const JUMP_VOLUME_KEY = "raptor-runner:jumpVolume";
export const RAIN_VOLUME_KEY = "raptor-runner:rainVolume";
export const THUNDER_VOLUME_KEY = "raptor-runner:thunderVolume";
export const FOOTSTEPS_VOLUME_KEY = "raptor-runner:footstepsVolume";
export const COINS_VOLUME_KEY = "raptor-runner:coinsVolume";
export const UI_VOLUME_KEY = "raptor-runner:uiVolume";
export const EVENTS_VOLUME_KEY = "raptor-runner:eventsVolume";

/** Allowed values for REDUCE_MOTION_KEY. Order matters only for UI
 *  presentation (system first, as the default). */
export const REDUCE_MOTION_VALUES = ["system", "on", "off"] as const;
export type ReduceMotionSetting = (typeof REDUCE_MOTION_VALUES)[number];

// Text scale bounds. 1 is the as-designed size; the ceiling stops a
// scaled-up menu from overflowing the panel on small landscape
// phones (the tightest layout we ship). The floor is also 1 —
// shrinking below the designed size never helps readability, so
// the setting only goes up.
export const TEXT_SCALE_MIN = 1;
export const TEXT_SCALE_MAX = 1.5;
export const TEXT_SCALE_DEFAULT = 1;
/** The sizes offered in the settings UI. The Game setter accepts
 *  any value in [MIN, MAX] (stored values are clamped, not
 *  snapped), but the menu presents these fixed steps because a
 *  continuous slider makes "put it back how it was" hard. */
export const TEXT_SCALE_PRESETS = [1, 1.15, 1.3, 1.5] as const;

// ── Cosmetic unlock thresholds (single-run scores) ─────────
// Thresholds are in meters (score-as-distance). ≈1000 m is a
// comfortable early-run goal (100 cacti at the default spacing),
// with 1500 / 2000 stepping the reward ladder further.
export const PARTY_HAT_SCORE_THRESHOLD = 1000;
export const BOW_TIE_SCORE_THRESHOLD = 1500;
export const THUG_GLASSES_SCORE_THRESHOLD = 2000;

// ── Raptor sprite sheet ────────────────────────────────────
export const RAPTOR_NATIVE_W = 578;
export const RAPTOR_NATIVE_H = 212;
export const RAPTOR_ASPECT = RAPTOR_NATIVE_H / RAPTOR_NATIVE_W;
export const RAPTOR_FRAMES = 12;
export const RAPTOR_IDLE_FRAME = 11;
// Animation cadence. frameDelay lerps between MAX (initial slow
// pace) and MIN (terminal velocity). Step SFX fire on frames 0 and
// 6 of the 12-frame walk cycle, so any retune here auto-retimes
// the footfalls at the same ratio.
export const RAPTOR_FRAME_DELAY_MIN = 24;
export const RAPTOR_FRAME_DELAY_MAX = 42;
export const RAPTOR_COLLISION_INSET = 4;

// ── Pterodactyl (flying obstacle) ─────────────────────────
// 5×5 grid layout on the sprite sheet with frames 22-24 empty
// (last row only has 2 sprites). Frames cycle through the
// full flap animation; sprite is drawn horizontally flipped so
// the pterodactyl faces the raptor (head leads the scroll).
export const PTERODACTYL_SHEET_COLS = 5;
export const PTERODACTYL_SHEET_ROWS = 5;
export const PTERODACTYL_FRAMES = 22;
export const PTERODACTYL_FRAME_W = 456;
export const PTERODACTYL_FRAME_H = 360;
/** Height relative to raptor height. ~1.05 puts the sprite at
 *  roughly the raptor's own silhouette size, which reads as a
 *  same-scale aerial threat without dominating the screen. */
export const PTERODACTYL_HEIGHT_SCALE = 1.05;
/** Ground-clearance of the sprite bottom edge, in raptor heights.
 *  1.10 lands the body at roughly the same height as the coins that
 *  hover above large cacti (COIN_BASE_Y_ABOVE_GROUND_RATIO plus the
 *  isLarge 1.4× gap multiplier in spawnCoinAboveCactus). Keeps the
 *  flyer in the same visual band players already associate with
 *  "reward at the top of a tall jump". */
export const PTERODACTYL_FLIGHT_HEIGHT_RATIO = 1.1;
/** Animation cadence (ms per frame). ~55ms ≈ 18 fps — snappy enough
 *  for the flap to read as active flight without blurring into a
 *  buzz at a full 22-frame cycle. */
export const PTERODACTYL_FRAME_DELAY_MS = 55;
/** Probability that a cactus spawn is replaced by a pterodactyl
 *  instead. ~12% → roughly 1 in 8 obstacles is a flyer. */
export const PTERODACTYL_SPAWN_CHANCE = 0.12;
/** Among flyer spawns, the chance the flyer takes the LOW flight
 *  path — cruising at cactus-coin height so the player has to jump
 *  OVER it instead of running underneath. Two-variant mix keeps the
 *  obstacle vocabulary rich without adding a brand-new entity. */
export const PTERODACTYL_LOW_FLIGHT_CHANCE = 0.35;
/** Low flight height — sits low enough that the wings-up frames
 *  don't punish well-timed jumps. Lower than the coin-above-small-
 *  cactus band so the flap cycle's tallest silhouette still clears
 *  a normal jump arc. */
export const PTERODACTYL_LOW_FLIGHT_HEIGHT_RATIO = 0.18;
/** Size multiplier applied to the low-flight variant on top of
 *  PTERODACTYL_HEIGHT_SCALE. Smaller silhouette pairs with the
 *  lower flight band — reads as a different, nimbler flyer and
 *  keeps wings-up frames from looming over jump arcs. */
export const PTERODACTYL_LOW_FLIGHT_SIZE_SCALE = 0.8;

// Per-frame head reference points, extracted by scanning each frame
// of assets/raptor-sheet.png for the topmost opaque pixel (crown)
// and the rightmost opaque pixel on the upper head band (snout tip).
// Normalized to native 578×212 — multiply by raptor w/h at runtime.
export const RAPTOR_CROWN: ReadonlyArray<readonly [number, number]> = [
  [0.86332, 0.16038], // frame 0
  [0.86678, 0.16509], // frame 1
  [0.88062, 0.17925], // frame 2
  [0.8737, 0.17453], // frame 3
  [0.86851, 0.16038], // frame 4
  [0.86851, 0.15566], // frame 5
  [0.86505, 0.16509], // frame 6
  [0.86851, 0.16981], // frame 7
  [0.87024, 0.17925], // frame 8
  [0.87543, 0.16981], // frame 9
  [0.87197, 0.16509], // frame 10
  [0.86851, 0.15566], // frame 11
];

export const RAPTOR_SNOUT: ReadonlyArray<readonly [number, number]> = [
  [0.98097, 0.25943], // frame 0
  [0.98616, 0.26415], // frame 1
  [0.99135, 0.27358], // frame 2
  [0.99827, 0.26415], // frame 3
  [0.99135, 0.25943], // frame 4
  [0.98789, 0.25472], // frame 5
  [0.98097, 0.25943], // frame 6
  [0.98616, 0.26887], // frame 7
  [0.99135, 0.27358], // frame 8
  [0.99827, 0.26415], // frame 9
  [0.99135, 0.25943], // frame 10
  [0.98616, 0.25472], // frame 11
];

// Per-frame correction for the NECK anchor. Cosmetic draws derive
// cx/cy from the crown plus a fixed offset — right on average but
// wrong per-frame because the throat bends on a slightly delayed
// cycle from the head bob. These are zero-mean deltas (measured
// neck motion minus crown motion) that pin the bandana to the
// throat instead of following the head.
export const RAPTOR_NECK_CORRECTION: ReadonlyArray<readonly [number, number]> = [
  [+0.0036, -0.00079], // frame 0
  [+0.00187, -0.00078], // frame 1
  [-0.01197, +0.00393], // frame 2
  [-0.00332, +0.00393], // frame 3
  [+0.00187, -0.00079], // frame 4
  [+0.00187, -0.00078], // frame 5
  [+0.0036, -0.00078], // frame 6
  [+0.00187, -0.00078], // frame 7
  [+0.00014, +0.00393], // frame 8
  [-0.00159, -0.00078], // frame 9
  [+0.00014, -0.0055], // frame 10
  [+0.00187, -0.00078], // frame 11
];

// Per-frame silhouette polygons for the raptor, normalized to the
// native 578×212 frame. Generated from assets/raptor-sheet.png via
// `sprite-tools collision --tolerance 10`, then clipped to x >= 0.32
// so only the thick tail-base (≈30% closest to the body) counts
// toward the hit box. The thin tail-tip reads as unfair on a graze,
// so it's dropped; the meaty hip-side stays in since a square hit
// there visibly lands on the body. The runtime scales each point by
// the raptor's world w/h and shrinks by RAPTOR_COLLISION_INSET for a
// forgiving envelope.
export const RAPTOR_COLLISION: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [
    [0.32, 0.2137],
    [0.7872, 0.3679],
    [0.8564, 0.1651],
    [0.9689, 0.2311],
    [0.974, 0.2925],
    [0.8408, 0.3443],
    [0.7664, 0.5708],
    [0.7543, 0.7689],
    [0.7111, 0.8066],
    [0.7439, 0.934],
    [0.7837, 0.8255],
    [0.7561, 0.9481],
    [0.8114, 0.9906],
    [0.7145, 0.9104],
    [0.6696, 0.6226],
    [0.5433, 0.7736],
    [0.5277, 0.8679],
    [0.5744, 0.8679],
    [0.4862, 0.9009],
    [0.4723, 0.8396],
    [0.5087, 0.8821],
    [0.6073, 0.6085],
    [0.5415, 0.4623],
    [0.32, 0.2543],
  ], // frame 0
  [
    [0.32, 0.2072],
    [0.7751, 0.3726],
    [0.8529, 0.1745],
    [0.974, 0.2358],
    [0.9792, 0.2972],
    [0.8374, 0.3632],
    [0.7682, 0.5755],
    [0.7457, 0.7877],
    [0.6955, 0.8066],
    [0.6765, 0.7264],
    [0.6661, 0.9104],
    [0.6834, 0.9575],
    [0.7197, 0.8632],
    [0.6903, 0.9717],
    [0.7336, 0.9906],
    [0.673, 0.9906],
    [0.654, 0.6462],
    [0.5554, 0.7877],
    [0.5519, 0.8774],
    [0.5986, 0.8443],
    [0.5052, 0.9245],
    [0.4965, 0.8774],
    [0.5311, 0.9151],
    [0.6107, 0.6085],
    [0.4862, 0.3868],
    [0.32, 0.2588],
  ], // frame 1
  [
    [0.32, 0.2317],
    [0.5415, 0.3443],
    [0.7924, 0.3821],
    [0.8339, 0.2217],
    [0.8806, 0.1792],
    [0.9896, 0.2925],
    [0.8495, 0.3538],
    [0.7664, 0.5896],
    [0.7422, 0.7925],
    [0.6886, 0.8066],
    [0.7007, 0.6368],
    [0.6782, 0.6085],
    [0.6228, 0.8632],
    [0.6367, 0.9434],
    [0.6661, 0.8491],
    [0.6401, 0.967],
    [0.6817, 0.9906],
    [0.628, 0.9906],
    [0.6159, 0.8066],
    [0.5415, 0.9434],
    [0.5675, 0.9104],
    [0.5623, 0.75],
    [0.6159, 0.6226],
    [0.5138, 0.434],
    [0.32, 0.2962],
  ], // frame 2
  [
    [0.32, 0.2175],
    [0.7751, 0.3726],
    [0.8737, 0.1745],
    [0.9983, 0.2736],
    [0.8564, 0.3396],
    [0.7682, 0.5755],
    [0.7422, 0.783],
    [0.6869, 0.7877],
    [0.7042, 0.6179],
    [0.6834, 0.5991],
    [0.6038, 0.7783],
    [0.6246, 0.8491],
    [0.6574, 0.7736],
    [0.628, 0.8632],
    [0.6384, 0.9906],
    [0.5882, 0.9906],
    [0.5779, 0.8349],
    [0.6211, 0.6226],
    [0.5173, 0.4292],
    [0.3478, 0.2642],
    [0.32, 0.2569],
  ], // frame 3
  [
    [0.32, 0.2388],
    [0.5433, 0.3302],
    [0.7907, 0.3679],
    [0.8685, 0.1604],
    [0.9879, 0.2877],
    [0.8408, 0.3585],
    [0.7664, 0.5755],
    [0.7595, 0.7406],
    [0.6886, 0.8255],
    [0.6799, 0.9009],
    [0.7215, 0.9717],
    [0.6349, 0.816],
    [0.6471, 0.5991],
    [0.5433, 0.8349],
    [0.5519, 0.9292],
    [0.5934, 0.8585],
    [0.5554, 0.9717],
    [0.5952, 0.9906],
    [0.5467, 0.9906],
    [0.5346, 0.8302],
    [0.5969, 0.6226],
    [0.526, 0.4387],
    [0.32, 0.2568],
  ], // frame 4
  [
    [0.32, 0.2304],
    [0.7751, 0.3632],
    [0.8685, 0.1557],
    [0.9758, 0.2264],
    [0.981, 0.2877],
    [0.8547, 0.3208],
    [0.7664, 0.5708],
    [0.7215, 0.8868],
    [0.7664, 0.9387],
    [0.6747, 0.8632],
    [0.6644, 0.6085],
    [0.6367, 0.5943],
    [0.5138, 0.8066],
    [0.5087, 0.9009],
    [0.5554, 0.8868],
    [0.5069, 0.9151],
    [0.5225, 0.9906],
    [0.4965, 0.9906],
    [0.5087, 0.7925],
    [0.583, 0.6179],
    [0.5363, 0.4528],
    [0.3478, 0.2547],
    [0.32, 0.2518],
  ], // frame 5
  [
    [0.32, 0.2184],
    [0.7872, 0.3726],
    [0.8651, 0.1651],
    [0.9689, 0.2311],
    [0.974, 0.2925],
    [0.8478, 0.3396],
    [0.7682, 0.5708],
    [0.7474, 0.783],
    [0.7111, 0.8066],
    [0.7439, 0.934],
    [0.7837, 0.8255],
    [0.7561, 0.9481],
    [0.8114, 0.9906],
    [0.7145, 0.9104],
    [0.6696, 0.6226],
    [0.5433, 0.7736],
    [0.5277, 0.8679],
    [0.5744, 0.8679],
    [0.5035, 0.9198],
    [0.4706, 0.8443],
    [0.5069, 0.8868],
    [0.6073, 0.6085],
    [0.5311, 0.4481],
    [0.32, 0.2575],
  ], // frame 6
  [
    [0.32, 0.209],
    [0.7751, 0.3774],
    [0.8547, 0.1792],
    [0.974, 0.2406],
    [0.9792, 0.3019],
    [0.8391, 0.3679],
    [0.7682, 0.5802],
    [0.7457, 0.783],
    [0.6938, 0.8066],
    [0.6782, 0.717],
    [0.6661, 0.9104],
    [0.6851, 0.9528],
    [0.7197, 0.8632],
    [0.6903, 0.9717],
    [0.7336, 0.9906],
    [0.6747, 0.9906],
    [0.654, 0.6462],
    [0.5554, 0.7877],
    [0.5536, 0.8774],
    [0.5986, 0.8443],
    [0.5052, 0.9245],
    [0.4965, 0.8774],
    [0.5381, 0.9009],
    [0.609, 0.6132],
    [0.4862, 0.3868],
    [0.32, 0.2588],
  ], // frame 7
  [
    [0.32, 0.2317],
    [0.5415, 0.3443],
    [0.7924, 0.3821],
    [0.8702, 0.1792],
    [0.9896, 0.2925],
    [0.8581, 0.3396],
    [0.7682, 0.5849],
    [0.7388, 0.7925],
    [0.6886, 0.8066],
    [0.7024, 0.6226],
    [0.6782, 0.6085],
    [0.6228, 0.8726],
    [0.6367, 0.9434],
    [0.6661, 0.8491],
    [0.6401, 0.967],
    [0.6817, 0.9906],
    [0.6263, 0.9906],
    [0.6159, 0.8066],
    [0.5433, 0.9481],
    [0.5675, 0.9198],
    [0.5623, 0.7547],
    [0.6159, 0.6226],
    [0.5138, 0.434],
    [0.32, 0.2962],
  ], // frame 8
  [
    [0.32, 0.2193],
    [0.7751, 0.3774],
    [0.8754, 0.1698],
    [0.9983, 0.2736],
    [0.8564, 0.3396],
    [0.7682, 0.5802],
    [0.7422, 0.7925],
    [0.6869, 0.7972],
    [0.7024, 0.6368],
    [0.6817, 0.6038],
    [0.6038, 0.7783],
    [0.6246, 0.8491],
    [0.6574, 0.7736],
    [0.628, 0.8632],
    [0.6384, 0.9906],
    [0.5934, 0.9906],
    [0.5779, 0.8302],
    [0.6211, 0.6226],
    [0.5709, 0.5896],
    [0.5173, 0.4292],
    [0.3478, 0.2642],
    [0.32, 0.2569],
  ], // frame 9
  [
    [0.32, 0.2304],
    [0.7751, 0.3679],
    [0.872, 0.1651],
    [0.9879, 0.2877],
    [0.8426, 0.3585],
    [0.7664, 0.5755],
    [0.7595, 0.7406],
    [0.6886, 0.8255],
    [0.6782, 0.9009],
    [0.7197, 0.9623],
    [0.6349, 0.816],
    [0.6471, 0.5991],
    [0.5433, 0.8349],
    [0.5519, 0.9292],
    [0.5934, 0.8585],
    [0.5536, 0.9623],
    [0.5952, 0.9906],
    [0.5484, 0.9906],
    [0.5329, 0.8349],
    [0.5969, 0.6226],
    [0.526, 0.4387],
    [0.3478, 0.2594],
    [0.32, 0.2544],
  ], // frame 10
  [
    [0.32, 0.2304],
    [0.7751, 0.3632],
    [0.8685, 0.1557],
    [0.974, 0.2264],
    [0.9792, 0.2877],
    [0.8547, 0.3208],
    [0.7889, 0.4953],
    [0.7249, 0.8208],
    [0.7215, 0.9057],
    [0.7647, 0.9292],
    [0.6713, 0.8585],
    [0.6644, 0.6085],
    [0.6367, 0.5943],
    [0.5156, 0.8019],
    [0.5104, 0.9009],
    [0.5554, 0.8868],
    [0.5069, 0.9151],
    [0.5242, 0.9953],
    [0.4965, 0.9953],
    [0.5087, 0.7925],
    [0.5848, 0.6179],
    [0.5363, 0.4528],
    [0.3478, 0.2547],
    [0.32, 0.2518],
  ], // frame 11
];

// ── 16-band day/night sky palette ──────────────────────────
// 5 day + golden + sunset + blue-hour + 5 night + blue-hour +
// sunrise + golden. Golden bridges the luminance gap between
// day-blue and magenta so no step in the chain lands on the
// desaturated grey axis.
export const SKY_COLORS: ReadonlyArray<readonly [number, number, number]> = [
  [80, 180, 205], // 0  blue (day)
  [80, 180, 205], // 1  blue (day)
  [80, 180, 205], // 2  blue (day)
  [80, 180, 205], // 3  blue (day)
  [80, 180, 205], // 4  blue (day)
  [240, 170, 70], // 5  golden hour (pre-sunset)
  [220, 90, 120], // 6  magenta-pink (sunset)
  [40, 65, 130], // 7  blue hour (post-sunset)
  [21, 34, 56], // 8  night
  [21, 34, 56], // 9  night
  [21, 34, 56], // 10 night
  [21, 34, 56], // 11 night
  [21, 34, 56], // 12 night
  [40, 65, 130], // 13 blue hour (pre-sunrise)
  [220, 90, 120], // 14 magenta-pink (sunrise)
  [240, 170, 70], // 15 golden hour (post-sunrise)
];

export const NIGHT_COLOR: readonly [number, number, number] = [21, 34, 56];
