/*
 * Raptor Runner — game state singleton. Mutable object every
 * subsystem reads/writes: viewport, physics, day/night cycle,
 * particles, rain, cosmetics, career counters. Dep-graph leaf —
 * imports only from constants.ts. Particle arrays are typed `any[]`
 * for the initial port; to be tightened as consumers are split out.
 */

import { INITIAL_BG_VELOCITY, SKY_COLORS } from "./constants";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface GameState {
  // ── Viewport dimensions ─────────────────────────────
  width: number;
  height: number;
  groundHeight: number;
  ground: number;

  // ── Physics / scoring ───────────────────────────────
  bgVelocity: number;
  score: number;
  /** Personal best, persisted to localStorage under HIGH_SCORE_KEY.
   *  Loaded once at init, updated on game-over if the current run
   *  beat it. */
  highScore: number;
  /** True for the run that just broke the previous record — drives
   *  the game-over overlay celebration. */
  newHighScore: boolean;

  // ── Run lifecycle ───────────────────────────────────
  gameOver: boolean;
  gameOverFade: number;
  gameOverFrame: number;
  gameOverAt: number;
  started: boolean;
  paused: boolean;
  frame: number;
  /** How many times the player has revived in the current run.
   *  Drives the escalating cost (base * 2^n). Reset on resetGame. */
  revivesUsedThisRun: number;
  /** Coins picked up in the current run. Drives the HUD counter
   *  (separate from the persistent `coinsBalance`) and the
   *  "this run → total" fill animation on the game-over card.
   *  Reset on resetGame. */
  runCoins: number;
  /** The frame number at which post-revive invulnerability ends.
   *  Collision checks short-circuit while state.frame < this value. */
  invulnerableUntilFrame: number;

  // ── Day/night cycle ─────────────────────────────────
  /** Current interpolated sky color — a mutable 3-tuple shared across
   *  the sky, cloud, and tint rendering paths. */
  currentSky: number[];
  lastSkyScore: number;
  isNight: boolean;
  /** Continuous version of (score / SKY_CYCLE_SCORE), smoothed every
   *  frame so the sun/moon arc and star rotation move smoothly even
   *  though score is integer-stepped. */
  smoothPhase: number;
  /** Monotonic frame-based angle used to rotate the night-sky dome
   *  (stars + Milky Way) gently across the screen. */
  starRotation: number;

  /** Timestamp of the previous update() call, used to derive the
   *  per-frame delta-time for frame-rate independence. Reset to null
   *  on pause/reset so the first post-resume frame doesn't see a
   *  huge stale delta. */
  lastNow: number | null;
  /** Integer-pixel scroll distance applied to every world-scrolling
   *  entity (cactus / ptero / coin / flower / dunes) on the current
   *  frame. Computed ONCE per tick from `bgVelocity * frameScale`
   *  with a sub-pixel residual (_scrollResidualX) carrying the
   *  fractional remainder forward — so all entities move by the same
   *  integer each frame, eliminating the per-entity round-off
   *  "stutter" players saw when two cacti drifted in and out of
   *  phase relative to each other. */
  _frameScrollDx: number;
  _scrollResidualX: number;

  // ── Career & per-run counters ──────────────────────
  /** Total jumps the player has ever performed. Persists across
   *  sessions via localStorage (TOTAL_JUMPS_KEY). */
  totalJumps: number;
  /** Jumps in the current run only. Resets on resetGame(). */
  runJumps: number;
  /** Cacti the raptor has successfully scrolled past in the current
   *  run. Incremented when a cactus is retired off the left edge
   *  (which only happens if it didn't collide with the raptor first).
   *  Resets on resetGame(). Drives the "Getting The Hang Of It"
   *  achievement at 25 cleared — a rhythm-of-jumps milestone, not a
   *  distance one. */
  runCactiCleared: number;
  /** Nights fully survived in the current run — incremented on
   *  night → day transitions while the raptor is still alive.
   *  Drives the "Marathon Sleeper" achievement (5 nights in one
   *  run). */
  runNightsSurvived: number;
  /** Lifetime total of nights survived across every run ever.
   *  Persists via TOTAL_NIGHTS_KEY. Drives the "Insomniac"
   *  achievement (10 total nights), which was moved from a per-run
   *  goal to a career goal so it rewards accumulated playtime. */
  totalNightsSurvived: number;
  /** Previous-frame night flag used to detect night → day edges. */
  _wasInNight: boolean;
  runShootingStars: number;

  careerRuns: number;
  /** Unlocked achievement IDs, persisted as JSON in localStorage. */
  unlockedAchievements: { [id: string]: true };
  /** Was the player muted for the ENTIRE current run? Flipped false
   *  the instant the mute toggle is touched mid-run. */
  _runMutedThroughout: boolean;
  /** Did a rain cycle start during the current run? Gates the
   *  rainy-day achievement so a soft-reset mid-storm doesn't credit
   *  the player with the next run's survival. */
  _runSawRainStart: boolean;

  // ── Legacy cosmetic flags for the three score-unlock classics.
  // Source of truth for the shop system is ownedCosmetics /
  // equippedCosmetics below; these are kept in lockstep so existing
  // Game API shims (isPartyHatActive etc.) stay honest.
  unlockedPartyHat: boolean;
  wearPartyHat: boolean;
  unlockedThugGlasses: boolean;
  wearThugGlasses: boolean;
  unlockedBowTie: boolean;
  wearBowTie: boolean;

  // ── Coin economy (persistent, shop-driven) ─────────
  /** Persistent lifetime coin balance — earned by coin pickups,
   *  spent at the cosmetics shop. */
  coinsBalance: number;
  /** Persistent lifetime total of coins the player has ever picked
   *  up. Never decremented (unlike coinsBalance which drops on
   *  purchase); monotonically grows for the life of the save. */
  coinsCollected: number;
  /** Set of owned cosmetic ids. Includes score-unlocked classics
   *  (party-hat, thug-glasses, bow-tie) once earned and everything
   *  the player has purchased. */
  ownedCosmetics: { [id: string]: true };
  /** Currently-equipped cosmetic per slot, or null for "nothing". */
  equippedCosmetics: {
    head: string | null;
    eyes: string | null;
    neck: string | null;
  };

  // ── Particle / effect arrays ───────────────────────
  /* eslint-disable @typescript-eslint/no-explicit-any */
  shootingStars: any[];
  confetti: any[];
  dust: any[];
  ash: any[];
  activeRareEvent: any | null;
  _rareEventsSeen: { [id: string]: number };
  moonPhase: number;
  clouds: any[];
  duneOffset: number;

  // ── Dune parallax (populated by initDunes) ─────────
  duneCacti: any[];
  _nextDuneCactusX: number;

  // ── Flower patches (front-foreground decoration) ───
  flowerPatches: any[];

  // ── Collectible coins (spawned inside flower breathers) ──
  coins: any[];
  /** Short-lived sparkle particles emitted when a coin is collected.
   *  Radiate outward from the coin center and fade out in <1s. */
  coinSparks: any[];

  // ── Grass-field spans (rest-area top-band overlay) ────────
  /** X-ranges where the top ground band renders green instead of
   *  desert-yellow. Pushed per breather, scrolled with the cacti,
   *  dropped on left-edge exit. */
  grassFields: { startX: number; endX: number }[];

  // ── Breather / rest-area pacing ────────────────────
  /** Score (meters) at which the next breather fires — bumped by
   *  CACTUS_BREATHER_INTERVAL_METERS whenever one triggers. Lets
   *  the cadence stay stable even as bgVelocity ramps up. */
  _nextBreatherAtScore: number;

  // ── Rain weather ───────────────────────────────────
  totalDayCycles: number;
  lastCycleIndex: number;
  /** Cycle whose moon-zenith we've already credited for the
   *  "Lunar Glory" achievement. Increments each time smoothPhase
   *  crosses MOON_PHASE_CENTER, so the unlock fires when the player
   *  actually sees the full moon overhead — not at the cycle
   *  boundary, when it's still below the horizon. */
  lastMoonZenithCycle: number;
  isRaining: boolean;
  rainIntensity: number;
  rainEndPhase: number;
  rainParticles: any[];
  lightning: { alpha: number; nextAt: number; bolt?: any };
  rainbow: { age: number; life: number } | null;
  _cloudDensity: number;

  // ── Debug helpers (toggled via ?debug=true or menu) ─
  debug: boolean;
  showHitboxes: boolean;
  noCollisions: boolean;
  _debugRainStop?: boolean;
  _pendingNights?: number;

  // ── Cinematic / filming mode (F9) ─────────────────────
  cinematicMode: boolean;
  cinematicPhaseLock: number | null;
  cinematicShowHUD: boolean;
  _preCinematicNoCollisions: boolean;
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export const state: GameState = {
  width: 0,
  height: 0,
  groundHeight: 0,
  ground: 0,
  bgVelocity: INITIAL_BG_VELOCITY,
  score: 0,
  highScore: 0,
  newHighScore: false,
  gameOver: false,
  gameOverFade: 0,
  gameOverFrame: 0,
  gameOverAt: 0,
  started: false,
  paused: true,
  frame: 0,
  revivesUsedThisRun: 0,
  runCoins: 0,
  invulnerableUntilFrame: 0,
  currentSky: [...SKY_COLORS[0]],
  lastSkyScore: -1,
  isNight: false,
  smoothPhase: 0,
  starRotation: 0,
  lastNow: null,
  _frameScrollDx: 0,
  _scrollResidualX: 0,
  totalJumps: 0,
  runJumps: 0,
  runCactiCleared: 0,
  runNightsSurvived: 0,
  totalNightsSurvived: 0,
  _wasInNight: false,
  runShootingStars: 0,
  careerRuns: 0,
  unlockedAchievements: {},
  _runMutedThroughout: false,
  _runSawRainStart: false,
  unlockedPartyHat: false,
  wearPartyHat: true,
  unlockedThugGlasses: false,
  wearThugGlasses: true,
  unlockedBowTie: false,
  wearBowTie: true,
  coinsBalance: 0,
  coinsCollected: 0,
  ownedCosmetics: {},
  equippedCosmetics: { head: null, eyes: null, neck: null },
  shootingStars: [],
  confetti: [],
  dust: [],
  ash: [],
  activeRareEvent: null,
  _rareEventsSeen: {},
  moonPhase: 0,
  clouds: [],
  duneOffset: 0,
  duneCacti: [],
  _nextDuneCactusX: 0,
  flowerPatches: [],
  coins: [],
  coinSparks: [],
  grassFields: [],
  // First breather fires at CACTUS_BREATHER_INTERVAL_METERS meters;
  // reset to the same value at the start of each run via resetGame.
  _nextBreatherAtScore: 500,
  totalDayCycles: 0,
  lastCycleIndex: -1,
  lastMoonZenithCycle: -1,
  isRaining: false,
  rainIntensity: 0,
  rainEndPhase: 0,
  rainParticles: [],
  lightning: { alpha: 0, nextAt: 0 },
  rainbow: null,
  _cloudDensity: 1,
  debug: false,
  showHitboxes: false,
  noCollisions: false,
  cinematicMode: false,
  cinematicPhaseLock: null,
  cinematicShowHUD: true,
  _preCinematicNoCollisions: false,
};
