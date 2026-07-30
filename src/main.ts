/*
 * Raptor Runner — vanilla canvas + requestAnimationFrame rewrite.
 *
 * Architecture:
 *   • All drawing is done on a single <canvas id="game-canvas"> that
 *     sits behind the UI overlays (start screen, menu, imprint, cog).
 *   • The raptor sprite is a separate <img id="raptor-sprite"> positioned
 *     absolutely over the canvas. The browser handles GIF animation for
 *     free — we just translate the element each frame.
 *   • Music and jump SFX are native <audio> elements controlled directly
 *     from the HTML layer via the Game API. No p5.sound.
 *   • Input: pointerdown on canvas (covers mouse + touch + pen),
 *     keydown on window (Space/W/Up to jump, Enter to restart).
 *   • The game loop is a plain requestAnimationFrame. `state.paused` is
 *     used to gate update() without stopping render() so the canvas
 *     stays visible while the menu/start-screen is open.
 *
 * Public API (exposed on window.Game):
 *   Game.onReady(cb)         – invoked once assets are loaded
 *   Game.start()             – unpauses the game (call after the user
 *                              clicks the Start Game button)
 *   Game.pause() / resume()  – called when menus open/close
 *   Game.isStarted()         – true after Game.start() has been called
 *   Game.setMuted(muted: boolean)     – controls both music and jump SFX
 *   Game.isMuted()
 *
 * TypeScript port notes:
 *   • The original 5,400-line game.js was copied here verbatim under
 *     `@ts-nocheck`, then split incrementally into src/constants.ts,
 *     src/state.ts, src/audio.ts, src/entities/, src/effects/,
 *     src/render/, etc. The split has now progressed far enough that
 *     `@ts-nocheck` is gone — main.ts is fully typed against the
 *     project's strict tsconfig. Further extractions still happen
 *     when a coherent subsystem can move out without dragging the
 *     remaining cross-cutting state with it.
 */
import "./styles/base.css";
import { ACHIEVEMENTS, ACHIEVEMENTS_BY_ID } from "./achievements";
import { audio } from "./audio";
import { contexts, initCanvas } from "./canvas";
// ScoreCardWorker import moved into src/render/scoreCard.ts.
import {
  BOW_TIE_SCORE_THRESHOLD,
  CACTUS_BREATHER_INTERVAL_METERS,
  CINEMATIC_PHASES,
  CLOUD_PARALLAX_DIVISOR,
  CLOUD_SPAWN_INTERVAL,
  DELTA_TIME_CLAMP,
  DUNE_CACTUS_MIN_SPACING_PX,
  DUNE_CACTUS_SPACING_RANGE_PX,
  DUNE_SCROLL_SPEED,
  GAME_OVER_FADE_RATE,
  GAMEPAD_JUMP_BUTTONS,
  GAMEPAD_MENU_DOWN_BUTTONS,
  GAMEPAD_MENU_LEFT_BUTTONS,
  GAMEPAD_MENU_RIGHT_BUTTONS,
  GAMEPAD_MENU_TOGGLE_BUTTONS,
  GAMEPAD_MENU_UP_BUTTONS,
  GAMEPAD_STICK_DEADZONE,
  GAMEPAD_STICK_PRESS_THRESHOLD,
  GRASS_FIELD_COLOR,
  GROUND_BAND_COLORS,
  GROUND_BAND_HEIGHTS_PX,
  GROUND_HEIGHT_RATIO,
  INITIAL_BG_VELOCITY,
  LIGHTNING_MIN_COOLDOWN_MS,
  METERS_PER_BG_UNIT_PER_FRAME,
  MOON_PHASE_CENTER,
  PARTY_HAT_SCORE_THRESHOLD,
  RAIN_AUDIO_MAX_VOLUME,
  RAIN_FADE_IN_RATE,
  RAIN_FADE_OUT_RATE,
  RAINBOW_LIFETIME_SEC,
  RAINBOW_MAX_OPACITY,
  RAINBOW_SPAWN_CHANCE,
  REVIVE_FIRST_COST,
  REVIVE_INVULN_FRAMES,
  REVIVE_SECOND_COST,
  SKY_COLORS,
  SKY_CYCLE_SCORE,
  SKY_UPDATE_INTERVAL_FRAMES,
  STAR_ROTATION_PER_CYCLE,
  THUG_GLASSES_SCORE_THRESHOLD,
  UNLOCKED_BOW_TIE_KEY,
  UNLOCKED_PARTY_HAT_KEY,
  UNLOCKED_THUG_GLASSES_KEY,
  VELOCITY_SCALE_DIVISOR,
  WEAR_BOW_TIE_KEY,
  WEAR_PARTY_HAT_KEY,
  WEAR_THUG_GLASSES_KEY,
} from "./constants";
import {
  COSMETICS,
  COSMETICS_BY_ID,
  type CosmeticSlot,
  equipCosmetic,
  grantCosmetic,
  migrateLegacyCosmetics,
  purchaseCosmetic,
  setCosmeticsAchievementHandler,
  shopInventory,
  unequipSlot,
} from "./cosmetics";
import {
  bakeShootingStarSprite,
  drawAsh,
  drawCoinSparks,
  drawConfetti,
  drawDust,
  drawShootingStars,
  maybeSpawnShootingStar,
  setParticlesAchievementHandler,
  spawnAsh,
  spawnCoinCollectBurst,
  spawnConfettiBurst,
  spawnDust,
  updateAsh,
  updateCoinSparks,
  updateConfetti,
  updateDust,
  updateShootingStars,
  warmShootingStarSprite,
} from "./effects/particles";
import {
  drawRareEventFg,
  drawRareEventSky,
  drawUfoBeam,
  maybeSpawnRareEvent,
  RARE_EVENTS,
  setDuneHeightProvider,
  setRareEventsAchievementHandler,
  stopActiveRareEventAudio,
  updateRareEvent,
  warmMeteorSprites,
} from "./effects/rareEvents";
import {
  _generateBoltPath,
  drawLightning,
  drawRain,
  shouldRainForCycle,
  spawnRain,
  updateLightning,
  updateRain,
} from "./effects/weather";
import { Cactuses } from "./entities/cactus";
import { clearCoins, collectCoins, drawCoins, updateCoins } from "./entities/coins";
import { drawFlowerPatches, raptorCrossingPatch, updateFlowerPatches } from "./entities/flowers";
import { Raptor } from "./entities/raptor";
import { Stars } from "./entities/stars";
import { hapticDeath } from "./haptic";
import {
  compactInPlace,
  lerpColor,
  moonPhaseFromCycles,
  type Polygon,
  polygonsOverlap,
  randRange,
} from "./helpers";
import { IMAGE_SRCS, IMAGES } from "./images";
import { applyPadFamilyBodyClass, familyFromGamepadId, type PadFamily } from "./input/padFamily";
import {
  familyFromSteamInputType,
  STEAM_ACTION_SETS,
  STEAM_DIGITAL_ACTIONS,
  type SteamActionSetName,
} from "./input/steamActions";
import {
  hydratePersistence,
  loadBoolFlag,
  loadCareerRuns,
  loadCoinsBalance,
  loadCoinsCollected,
  loadEquippedCosmetics,
  loadHighScore,
  loadOwnedCosmetics,
  loadRareEventsSeen,
  loadTotalDayCycles,
  loadTotalJumps,
  loadTotalNightsSurvived,
  loadUnlockedAchievements,
  saveBoolFlag,
  saveCareerRuns,
  saveCoinsBalance,
  saveCoinsCollected,
  saveEquippedCosmetics,
  // (below: existing imports from this module continue)
  saveHighScore,
  saveOwnedCosmetics,
  saveRareEventsSeen,
  saveTotalDayCycles,
  saveTotalJumps,
  saveTotalNightsSurvived,
  saveUnlockedAchievements,
} from "./persistence";
import {
  cloudVisualWidth,
  drawCloudMorphed,
  drawOvercastBands,
  drawPolygon,
  invalidateCloudsCache,
  seedClouds,
  targetCloudCount,
  trySpawnCloud,
} from "./render/clouds";
import { generateScoreCardBlob } from "./render/scoreCard";
import {
  _isDayBand,
  computeSkyGradient,
  drawMoon,
  drawSun,
  invalidateSkyCache,
  isNightPhase,
  isRainbowPhase,
  tintStrength,
} from "./render/sky";
import { duneHeight, initDunes, spawnDuneCactus } from "./render/world";
import {
  unlockAchievement as reportAchievementToServices,
  submitScore as reportScoreToServices,
} from "./services/gameServices";
import { state } from "./state";
import { pushAchievementToSteam, reconcileWithSteam } from "./steamBridge";
import { getFreshSteamFrame, initSteamInput, syncSteamActionSet } from "./steamInput";
import { track, trackPageview } from "./telemetry";

// Fire the single pageview for this session. Gated inside
// trackPageview() — no-ops in dev, Electron, Capacitor, and on
// any host other than the production domain.
trackPageview();

// ══════════════════════════════════════════════════════════════════
// Constants
//
// Pure numeric/string/key constants live in src/constants.ts and are
// imported at the top of this file. The catalog-shaped constants
// (ACHIEVEMENTS, CACTUS_VARIANTS, IMAGE_SRCS) still live here until
// they move into their own dedicated modules.
// ══════════════════════════════════════════════════════════════════

// The ACHIEVEMENTS catalog and ACHIEVEMENTS_BY_ID lookup live in
// src/achievements.ts. The unlockAchievement() function below still
// lives here until state and GameAPI are split out.

// Raptor sprite constants (RAPTOR_NATIVE_W/H, RAPTOR_FRAMES,
// RAPTOR_IDLE_FRAME, RAPTOR_CROWN, RAPTOR_SNOUT, RAPTOR_FRAME_DELAY_*,
// RAPTOR_COLLISION_INSET) live in src/constants.ts and are imported
// at the top of this file.

// CACTUS_VARIANTS (sprite + collision catalog) lives in
// src/cactusVariants.ts.

// The 16-band day/night palette (SKY_COLORS) and NIGHT_COLOR live in
// _isNightBand / _isDayBand / isNightPhase / tintStrength /
// tintFactor / celestialArc / drawSun / drawMoon /
// computeSkyGradient all live in src/render/sky.ts.

// IMAGE_SRCS (key → path) and IMAGES (runtime dictionary) live in
// src/images.ts. The preloader later in this file populates IMAGES.

// ══════════════════════════════════════════════════════════════════
// Math + collision helpers
//
// Pure helpers (lerp, lerpColor, rgb, rgba, randRange, clamp,
// polygonsOverlap, pointInPolygon, segmentsIntersect, cross,
// shrinkPolygon) live in src/helpers.ts and are imported at the top
// of this file. tintStrength / tintFactor stay here because they
// read state.currentSky.
// ══════════════════════════════════════════════════════════════════

// tintStrength / tintFactor / helpers all imported at the top.

// ══════════════════════════════════════════════════════════════════
// Audio (native HTMLAudioElement — no p5.sound)
//
// The audio singleton lives in src/audio.ts and is imported at the
// top of this file. The Sound-of-Silence achievement invalidation
// (previously inline in audio.setMuted) is now wired as a callback
// during init() below.
// ══════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════
// Game state
//
// The `state` singleton lives in src/state.ts and is imported at
// the top of this file. It's a flat mutable object; every subsystem
// reads and writes the same reference.
// ══════════════════════════════════════════════════════════════════

// These are populated in init() which runs before any game code
// reads them. The `null as unknown as T` cast avoids hundreds of
// null-checks in the game loop while keeping the declared type
// correct for consumer code.
let canvas = null as unknown as HTMLCanvasElement;
let ctx = null as unknown as CanvasRenderingContext2D;
let skyCanvas = null as unknown as HTMLCanvasElement;
let _skyCtx = null as unknown as CanvasRenderingContext2D;
let fgCanvas = null as unknown as HTMLCanvasElement;
let fgCtx = null as unknown as CanvasRenderingContext2D;
let deathCanvas = null as unknown as HTMLCanvasElement;
let deathCtx = null as unknown as CanvasRenderingContext2D;
let deathSnapshotReady = false;
let _rafId = 0;
let raptor = null as unknown as Raptor;
let cactuses = null as unknown as Cactuses;
let stars = null as unknown as Stars;

// ══════════════════════════════════════════════════════════════════
// Entities
// ══════════════════════════════════════════════════════════════════

// The Raptor class lives in src/entities/raptor.ts. Its two
// side-effect hooks (onLand for dust spawning, onJump for rare-event
// rolls) are passed at construction time in init() below.

// Cactus + Cactuses classes live in src/entities/cactus.ts.
// Cactuses takes a raptor instance + two callbacks (achievement
// unlock, cosmetic burst spawner) at construction time in init().

// ════════════════════════════════════════════════════════════════
// Stars + Milky Way
//
// The night sky is a "dome" that we rotate around a pivot point
// far above the visible viewport. Star positions are generated
// once across an area wider/taller than the viewport so that as
// the dome rotates, stars enter from one edge and exit the other
// without empty patches appearing at the corners.
//
// The Milky Way is a denser band of small stars + a soft haze
// strip drawn along a tilted line. It lives in the same rotated
// frame so it drifts in/out with the rest of the sky.
// ════════════════════════════════════════════════════════════════

// The Stars class lives in src/entities/stars.ts.

// ════════════════════════════════════════════════════════════════
// Shooting stars (easter egg)
//
// Spawned only from the SECOND night onward. Each shooting star
// is a pre-rendered trail sprite (baked once into an offscreen
// canvas) that we translate + rotate + drawImage per frame —
// avoids any per-frame gradient compile or path building, so
// the first shooting star doesn't stall the frame.
// ════════════════════════════════════════════════════════════════

// Shooting star spawning/update/baking lives in src/effects/particles.ts.

// Confetti / dust / ash particle systems live in
// src/effects/particles.ts.

// RARE_EVENTS catalog, maybeSpawnRareEvent, and updateRareEvent
// live in src/effects/rareEvents.ts. The achievement unlock hook
// and the dune-height provider are registered during init() above.
// All rare event code (catalog, spawn, update, draw) lives in
// src/effects/rareEvents.ts.
// ── Rain weather system ────────────────────────────────────────

// loadTotalDayCycles / saveTotalDayCycles live in src/persistence.ts.

// shouldRainForCycle / spawnRain / updateRain / drawRain live in
// src/effects/weather.ts. Lightning and rainbow still live in this
// file because they're entangled with dune-cactus rendering and
// achievement unlocks — they'll migrate once the render code
// splits out.

// updateLightning / _generateBoltPath / _drawBolt / drawLightning
// live in src/effects/weather.ts.

// Rainbow pre-bake cache. The rainbow is a big radial-gradient
// ring; filling it every frame was dropping the frame rate for
// the full ~6-second rainbow lifetime. The cache stores the
// ring bitmap at full alpha — we blit with globalAlpha each
// frame to get the fade in/out. Invalidated (re-rendered) when
// any of the position/size inputs change.
let _rainbowCache: HTMLCanvasElement | null = null;
let _rainbowCacheKey = "";

/** Return the pre-baked rainbow bitmap, re-rendering if any of
 *  the geometric inputs changed (viewport resize, ground shifting
 *  from HUD toggles, etc.). */
function ensureRainbowCache(): HTMLCanvasElement | null {
  const cx = state.width * 0.7;
  const cy = state.ground + state.height * 0.15;
  const outerR = state.height * 0.55;
  const thickness = Math.max(15, state.width * 0.025);
  const innerR = outerR - thickness;
  const key = `${state.width}|${state.height}|${cx}|${cy}|${outerR}|${innerR}`;
  if (_rainbowCache && _rainbowCacheKey === key) return _rainbowCache;
  const canvas =
    _rainbowCache ?? (typeof document !== "undefined" ? document.createElement("canvas") : null);
  if (!canvas) return null;
  canvas.width = state.width;
  canvas.height = state.height;
  const g = canvas.getContext("2d");
  if (!g) return null;
  g.clearRect(0, 0, canvas.width, canvas.height);
  // Render at FULL alpha. globalAlpha at blit time handles fade.
  const grad = g.createRadialGradient(cx, cy, innerR, cx, cy, outerR);
  grad.addColorStop(0, "rgba(148, 0, 211, 1)"); // violet
  grad.addColorStop(0.17, "rgba(75, 0, 200, 1)"); // indigo
  grad.addColorStop(0.33, "rgba(30, 130, 255, 1)"); // blue
  grad.addColorStop(0.5, "rgba(30, 200, 30, 1)"); // green
  grad.addColorStop(0.67, "rgba(255, 240, 30, 1)"); // yellow
  grad.addColorStop(0.83, "rgba(255, 140, 0, 1)"); // orange
  grad.addColorStop(1, "rgba(255, 30, 30, 1)"); // red
  g.fillStyle = grad;
  g.beginPath();
  g.arc(cx, cy, outerR, Math.PI, 0);
  g.arc(cx, cy, innerR, 0, Math.PI, true);
  g.closePath();
  g.fill();
  _rainbowCache = canvas;
  _rainbowCacheKey = key;
  return _rainbowCache;
}

// drawShootingStars lives in src/effects/particles.ts.

// Sun + Moon rendering lives in src/render/sky.ts.

// Cloud system lives in src/render/clouds.ts.
// Dunes (duneHeight, spawnDuneCactus, initDunes) live in
// src/render/world.ts.

// computeSkyGradient lives in src/render/sky.ts.

// Score card rendering lives in src/render/scoreCard.ts.

// ══════════════════════════════════════════════════════════════════
// Update + render
// ══════════════════════════════════════════════════════════════════

function update(now: number) {
  state.frame++;

  // ── Delta-time / frame-rate independence ────────────────────
  // Every per-frame integration in the game (raptor physics,
  // cactus and cloud drift, star/smoothPhase advance, sky-color
  // lerp, star opacity fade) was originally written assuming a
  // steady 60fps step. `frameScale` is "how many 60fps frames
  // this actual frame represents", so multiplying any of those
  // integrations by it makes the game run at the same real-time
  // speed on a 60Hz display, a 120Hz one, or a 30fps one.
  //
  // We clamp the upper bound at 1/20s (≈3 frames at 60fps) so a
  // browser tab-switch or long GC pause doesn't teleport the
  // raptor through a cactus when the loop resumes.
  const prevNow = state.lastNow || now;
  const rawDtSec = (now - prevNow) / 1000;
  state.lastNow = now;
  const dtSec = Math.min(Math.max(rawDtSec, 0), DELTA_TIME_CLAMP);
  const frameScale = dtSec * 60; // 1.0 at 60fps, 0.5 at 120fps

  // Continuous, monotonic day-phase. Drives the sky color, the
  // sun/moon arc, and the star rotation so they all stay locked
  // together.
  const speedMult = state.bgVelocity / INITIAL_BG_VELOCITY;
  state.smoothPhase += (speedMult / (SKY_CYCLE_SCORE * 60)) * frameScale;

  // Cinematic phase lock — freeze the day/night cycle at a
  // specific point so a shot can be recomposed without the
  // sky drifting between takes.
  if (state.cinematicPhaseLock !== null) {
    state.smoothPhase = state.cinematicPhaseLock;
  }

  // Rain cycle tracking: detect when we enter a new day cycle.
  const cycleIndex = Math.floor(state.smoothPhase);
  if (cycleIndex > state.lastCycleIndex && state.lastCycleIndex >= 0) {
    state.totalDayCycles += 1;
    saveTotalDayCycles(state.totalDayCycles);
    // Moon phase: realistic ~29.5 day synodic month
    state.moonPhase = moonPhaseFromCycles(state.totalDayCycles);
    // Start rain at cycle boundaries; duration is 0.3–1.2 day cycles
    if (!state.isRaining && shouldRainForCycle(state.totalDayCycles)) {
      state.isRaining = true;
      state.rainEndPhase = state.smoothPhase + 0.3 + Math.random() * 0.9;
      // Mark that the player witnessed this storm's beginning — a
      // prerequisite for the rainy-day achievement when it ends.
      state._runSawRainStart = true;
    }
  }
  state.lastCycleIndex = cycleIndex;

  // Full-moon achievement fires at the moon's zenith — the player
  // should actually see the moon overhead, not just be in a cycle
  // where it happens to be full. smoothPhase grows monotonically,
  // so floor(smoothPhase - MOON_PHASE_CENTER) is a counter that
  // increments once each time the moon crests.
  const moonZenithCycle = Math.floor(state.smoothPhase - MOON_PHASE_CENTER);
  if (moonZenithCycle > state.lastMoonZenithCycle && Math.abs(state.moonPhase - 0.5) < 0.02) {
    unlockAchievement("full-moon");
  }
  state.lastMoonZenithCycle = moonZenithCycle;

  // End rain when duration expires. Only grant the achievement if
  // the storm actually started during the current run — continuing
  // through an inherited post-death storm doesn't qualify.
  if (state.isRaining && state.smoothPhase >= state.rainEndPhase) {
    state.isRaining = false;
    if (!state.gameOver && state._runSawRainStart) {
      unlockAchievement("rainy-day");
    }
  }

  // Smooth rain intensity transition (0→1 fade in, 1→0 fade out)
  const raining = state.isRaining;
  const targetIntensity = raining ? 1 : 0;
  // Fade in slower than fade out for natural feel
  const fadeRate = raining ? RAIN_FADE_IN_RATE : RAIN_FADE_OUT_RATE;
  state.rainIntensity += (targetIntensity - state.rainIntensity) * fadeRate * frameScale;
  if (state.rainIntensity < 0.005) state.rainIntensity = 0;
  if (state.rainIntensity > 0.995) state.rainIntensity = 1;

  // Spawn rain proportional to intensity
  if (state.rainIntensity > 0.01) spawnRain(frameScale);
  updateRain(dtSec);
  updateLightning(frameScale, now);

  // Rainbow: rare chance after rain fades out during daytime /
  // golden hour. isRainbowPhase() excludes night, blue-hour, AND
  // the magenta sunset/sunrise bands — an arc spawned against the
  // warm red transition reads as muddy, so we cap the window at
  // golden hour (band 5 pre-sunset, band 15 post-sunrise).
  if (
    !state.gameOver &&
    !raining &&
    state.rainIntensity < 0.1 &&
    state.rainIntensity > 0 &&
    !state.rainbow
  ) {
    const phase = ((state.smoothPhase % 1) + 1) % 1;
    const bandF = phase * SKY_COLORS.length;
    const bi = Math.floor(bandF);
    const bandT = bandF - bi;
    if (isRainbowPhase(bi, bandT)) {
      // Debug rain stop: always rainbow. Natural: 50% chance.
      if (state._debugRainStop || Math.random() < RAINBOW_SPAWN_CHANCE) {
        state.rainbow = { age: 0, life: RAINBOW_LIFETIME_SEC };
        unlockAchievement("rainbow");
      }
      state._debugRainStop = false;
    }
  }
  // Update rainbow — age it, AND kill it immediately if the sky
  // phase leaves the rainbow-friendly zone (e.g. sunset red creeps
  // in while an arc is still on screen). Prevents the "rainbow
  // hanging in a magenta sky" look the user called out.
  if (state.rainbow) {
    state.rainbow.age += dtSec;
    if (state.rainbow.age >= state.rainbow.life) {
      state.rainbow = null;
    } else {
      const phase = ((state.smoothPhase % 1) + 1) % 1;
      const bandF = phase * SKY_COLORS.length;
      const bi = Math.floor(bandF);
      const bandT = bandF - bi;
      if (!isRainbowPhase(bi, bandT)) state.rainbow = null;
    }
  }

  // Rain audio: fade volume with intensity
  if (state.rainIntensity > 0.01 && !audio._isRainPlaying) audio.startRain();
  else if (state.rainIntensity < 0.01 && audio._isRainPlaying) audio.stopRain();
  if (audio.rain && audio._isRainPlaying) {
    audio.rain.volume = RAIN_AUDIO_MAX_VOLUME * state.rainIntensity;
  }

  // Slow rotation of the night-sky dome, tied to the cycle phase
  // so every night repeats the same visible arc. The rotation wraps
  // from its max angle back to zero at phase 1 → 0, which happens
  // during solid daylight when stars are fully faded out — so the
  // discontinuity is never visible.
  //
  // The total rotation per cycle is intentionally small (~18°):
  // because the pivot sits ~1.5 screen-heights above the viewport,
  // a star at screen-center is ~2h from the pivot, so even a
  // modest rotation traces a long arc. At 0.1π/cycle the drift
  // across a single night is ~7.5° — enough to see the sky move,
  // not enough to drift stars off before the night ends.
  const wrappedPhase = ((state.smoothPhase % 1) + 1) % 1;
  state.starRotation = wrappedPhase * STAR_ROTATION_PER_CYCLE;

  // Day/night cycle driven by smoothPhase (continuous), not score
  // (discrete) — so the sun/moon position never jumps when the
  // player passes a cactus.
  const phase = ((state.smoothPhase % 1) + 1) % 1;
  const bandF = phase * SKY_COLORS.length;
  const bandIndex = Math.floor(bandF);
  const bandT = bandF - bandIndex;
  const nextBand = (bandIndex + 1) % SKY_COLORS.length;

  // Stars fade in when the sky is genuinely dark — solid-night
  // bands plus the dark half of each twilight transition.
  state.isNight = isNightPhase(bandIndex, bandT);

  // Night-survival tracking for the "survive N nights"
  // achievements. Two-phase detection:
  //   1. When isNight goes true → false, mark a pending night
  //      (the raptor survived through the dark).
  //   2. Only count it + fire achievements once the sky is
  //      solidly in daytime (bands 0-4) — i.e. fully past the
  //      sunrise phase — so the toast appears when the sun is
  //      clearly out, not mid-transition.
  if (state._wasInNight && !state.isNight && !state.gameOver) {
    state._pendingNights = (state._pendingNights || 0) + 1;
  }
  if ((state._pendingNights ?? 0) > 0 && _isDayBand[bandIndex] && !state.gameOver) {
    const gained = state._pendingNights!;
    state.runNightsSurvived += gained;
    // Career total — persisted so "Insomniac" accumulates across
    // every run. Save is fire-and-forget; the next game-over also
    // re-saves if it hits a higher number.
    state.totalNightsSurvived += gained;
    saveTotalNightsSurvived(state.totalNightsSurvived);
    state._pendingNights = 0;
    if (state.runNightsSurvived >= 1) {
      unlockAchievement("first-night");
    }
    // "Insomniac" moved from per-run to career: 10 nights TOTAL
    // across all runs you've ever played.
    if (state.totalNightsSurvived >= 10) {
      unlockAchievement("ten-nights");
    }
    // "Marathon Sleeper" is now a per-run challenge at 5 nights —
    // the 20-in-one-run ask was effectively unreachable, so the
    // bar drops to something a careful player can actually clear
    // in one sitting. id stays "twenty-nights" for save-file
    // compatibility.
    if (state.runNightsSurvived >= 5) {
      unlockAchievement("twenty-nights");
    }
  }
  state._wasInNight = state.isNight;

  if (state.frame % SKY_UPDATE_INTERVAL_FRAMES === 0) {
    // Throttled to every N frames — distance-based score no longer
    // gates this (it changes every frame now, which would defeat
    // the throttle); SKY_UPDATE_INTERVAL_FRAMES is low enough that
    // band transitions still read as smooth.
    let target = lerpColor(SKY_COLORS[bandIndex], SKY_COLORS[nextBand], bandT);
    // Overcast sky during rain — lerp toward dark gray proportional to intensity.
    if (state.rainIntensity > 0) {
      target = lerpColor(target, [55, 60, 68], 0.7 * state.rainIntensity);
    }
    // 0.2-per-60fps-frame lerp, scaled to the real frame delta
    // (multiplied by SKY_UPDATE_INTERVAL_FRAMES because we're in
    // the throttled branch that only runs every N frames).
    const lerpT = Math.min(1, 0.2 * frameScale);
    state.currentSky = lerpColor(
      state.currentSky as [number, number, number],
      target as [number, number, number],
      lerpT,
    );
    computeSkyGradient();
    state.lastSkyScore = state.score;
  }

  stars.update(state.isNight, frameScale);
  // Shooting-star easter egg: only runs from the 2nd night onward.
  // Don't spawn new shooting stars or rare events on the death screen.
  if (!state.gameOver) maybeSpawnShootingStar(frameScale);
  updateShootingStars(dtSec);
  // Confetti particles from cosmetic unlocks.
  updateConfetti(dtSec);
  updateDust(dtSec);
  updateAsh(dtSec);
  updateCoinSparks(dtSec);
  if (!state.gameOver) updateRareEvent(dtSec);

  if (!state.gameOver) {
    // Distance score: meters run. Accumulates every frame, scaled
    // by bgVelocity so a faster raptor earns score faster (but the
    // same meters-per-cactus ratio, since the cactus spawn gap is
    // also velocity-linked). Threshold crossings fire achievement
    // and cosmetic unlocks using the pre/post floor comparison so
    // integer boundaries (e.g. 1000) trip exactly once per run.
    const prevScoreFloor = Math.floor(state.score);
    state.score += state.bgVelocity * frameScale * METERS_PER_BG_UNIT_PER_FRAME;
    const currScoreFloor = Math.floor(state.score);
    if (currScoreFloor !== prevScoreFloor) {
      const crossed = (n: number): boolean => prevScoreFloor < n && currScoreFloor >= n;
      // score-25 now fires on cactus count — see the
      // runCactiCleared block below cactuses.update().
      if (crossed(PARTY_HAT_SCORE_THRESHOLD)) {
        unlockAchievement("party-time");
        if (!state.ownedCosmetics["party-hat"]) {
          grantCosmetic("party-hat", { forceEquip: true });
          const crown = raptor.currentCrownPoint();
          spawnConfettiBurst(crown.x, crown.y);
        }
      }
      if (crossed(BOW_TIE_SCORE_THRESHOLD)) {
        unlockAchievement("dinosaurs-forever");
        if (!state.ownedCosmetics["bow-tie"]) {
          grantCosmetic("bow-tie", { forceEquip: true });
          const crown = raptor.currentCrownPoint();
          spawnConfettiBurst(crown.x, crown.y);
        }
      }
      if (crossed(THUG_GLASSES_SCORE_THRESHOLD)) {
        unlockAchievement("score-250");
        if (!state.ownedCosmetics["thug-glasses"]) {
          grantCosmetic("thug-glasses", { forceEquip: true });
          const crown = raptor.currentCrownPoint();
          spawnConfettiBurst(crown.x, crown.y);
        }
      }
    }

    // Compute the shared integer scroll delta for THIS frame BEFORE
    // any entity updates. Every world-scrolling entity reads the
    // same state._frameScrollDx so they move in lockstep — no
    // per-entity round-off means no inter-cactus "dance" as the
    // sub-pixel remainders drift in and out of phase.
    const _rawScrollDx = state.bgVelocity * (state.width / VELOCITY_SCALE_DIVISOR) * frameScale;
    state._scrollResidualX += _rawScrollDx;
    const _intScrollDx = Math.round(state._scrollResidualX);
    state._scrollResidualX -= _intScrollDx;
    state._frameScrollDx = _intScrollDx;

    raptor.update(now, frameScale);
    cactuses.update(now, frameScale);
    // "Getting The Hang Of It" fires the frame the 25th cactus
    // finishes scrolling off the left edge. Kept outside the
    // filter loop in cactus.ts so the achievement hook stays here
    // with the other unlock triggers.
    if (state.runCactiCleared >= 25) unlockAchievement("score-25");
    // Flowers scroll at ground speed like cacti. Spawn happens
    // inside Cactuses' breather roll so empty stretches read as
    // a scenic break, not dead grass.
    updateFlowerPatches(frameScale);
    updateCoins(frameScale);
    // Coin pickups happen BEFORE the cactus-collision check so a
    // coin that overlaps an incoming cactus is still grabbable on
    // the frame the raptor dies — the pickup reads as "last coin
    // before the fall" rather than getting swallowed by the
    // game-over branch.
    collectCoins(raptor, (coin, cx, cy) => {
      // The rising-pitch chain is specifically the 10-coin field
      // ribbon's cue — not "any coin while the raptor happens to
      // be over grass". A cactus-top coin that lines up with a
      // flower-field's x-range would otherwise slot into the chain
      // and break the per-field count. Keying off the coin's own
      // `fieldCoin` flag makes the chain cue strictly a field
      // reward: every other coin (cactus tops, debug spawns, any
      // future one-offs) plays the flat base-pitch chime.
      audio.playCoinCollect(coin.fieldCoin);
      // Last coin in the field layers the chain-end chord on top
      // of the regular pickup — "ding ding ding … diiing ✨".
      if (coin.lastInField) audio.playCoinChainEnd();
      spawnCoinCollectBurst(cx, cy);
      // Lifetime counter. Grows monotonically across runs; drives
      // the "Scrooge McRaptor" achievement at 1,000. Saved every
      // pickup because a crash mid-run shouldn't lose the grind.
      state.coinsCollected = (state.coinsCollected ?? 0) + 1;
      saveCoinsCollected(state.coinsCollected);
      if (state.coinsCollected >= 1000) unlockAchievement("coin-hoarder");
    });
    // Grass-field spans scroll at the same rate as the foreground
    // (ground speed), then fall off the left edge once they've
    // fully passed. Each span was pushed by a breather roll; it
    // marks where the top ground band should render green.
    if (state.grassFields && state.grassFields.length > 0) {
      const dx = state.bgVelocity * (state.width / VELOCITY_SCALE_DIVISOR) * frameScale;
      for (const g of state.grassFields) {
        g.startX -= dx;
        g.endX -= dx;
      }
      compactInPlace(state.grassFields, (g) => g.endX > 0);
    }
    // First-patch achievement. Scan once per frame; short-
    // circuits as soon as a hit is found, and crossed flags make
    // this O(1) on the steady state after the first patch.
    const crossed = raptorCrossingPatch(raptor.x, raptor.w);
    if (crossed) {
      crossed.crossed = true;
      unlockAchievement("stop-and-smell");
    }

    // Collision: raptor concave polygon vs each obstacle polygon.
    // Pterodactyls go first so a frame where the raptor clips both
    // a flyer and a cactus (unlikely but possible during a debug
    // force-spawn that overlaps existing cacti) attributes the
    // death to the flyer — matches the visual "the wing hit me"
    // reading.
    // Post-revive invulnerability: short-circuit while the grace
    // window is active so the player can phase past the obstacle
    // they just died to.
    if (!state.noCollisions && state.frame >= state.invulnerableUntilFrame) {
      // Broad phase: raptor AABB vs obstacle AABB. Most obstacles
      // on screen aren't near the raptor — skipping their (up to
      // 284-vertex) polygon rebuild + segment-test is the whole
      // reason we split the check. raptorPoly is built lazily so
      // frames with no close obstacle pay nothing for the shrink.
      const rx = raptor.x;
      const rRight = rx + raptor.w;
      const ry = raptor.y;
      const rBottom = ry + raptor.h;
      let raptorPoly: Polygon | null = null;
      const flyers = cactuses.pterodactyls.pteros;
      const cacti = cactuses.cacti;
      let hitObstacle: { collisionPolygon(): Polygon } | null = null;
      for (let pass = 0; pass < 2 && !hitObstacle; pass++) {
        const arr = pass === 0 ? flyers : cacti;
        for (let i = 0; i < arr.length; i++) {
          const c = arr[i];
          if (c.x + c.w < rx || c.x > rRight || c.y + c.h < ry || c.y > rBottom) {
            continue; // AABBs disjoint — narrow phase would be wasted.
          }
          if (raptorPoly === null) raptorPoly = raptor.collisionPolygon();
          if (polygonsOverlap(raptorPoly, c.collisionPolygon())) {
            hitObstacle = c;
            break;
          }
        }
      }
      if (hitObstacle) {
        state.gameOver = true;
        state.gameOverFrame = state.frame;
        audio.playHit();
        audio.pauseMusicForGameOver();
        // Kill any rare-event looping audio (UFO hover, Santa,
        // comet whoosh). updateRareEvent stops being called the
        // instant state.gameOver flips, so the sample would
        // otherwise loop forever into the next run — see
        // stopActiveRareEventAudio for the full rationale.
        stopActiveRareEventAudio();
        if (!audio.muted) hapticDeath();
        // Gamepad rumble — heavy jolt on death. Deferred via
        // setTimeout(0) so the blocking playEffect IPC doesn't
        // steal frame time from the death animation.
        setTimeout(() => {
          try {
            const gp = navigator.getGamepads?.()[0];
            gp?.vibrationActuator?.playEffect("dual-rumble", {
              duration: 150,
              weakMagnitude: 0.8,
              strongMagnitude: 1.0,
            });
          } catch (_) {}
        }, 0);
        commitRunScore();
        // Bump the career run counter and unlock the
        // "first-run" / "century-runner" milestones. Only count
        // once per actual run — further deaths after a revive
        // are part of the same run, not new career starts.
        if (state.revivesUsedThisRun === 0) {
          state.careerRuns += 1;
          saveCareerRuns(state.careerRuns);
          if (state.careerRuns >= 1) unlockAchievement("first-run");
          if (state.careerRuns >= 100) unlockAchievement("century-runner");
        }
        // Sound-of-silence is awarded for surviving a full
        // run (any length) with audio muted the whole time.
        // We ignore trivial zero-jump runs so the player
        // can't game it by instantly dying.
        if (state._runMutedThroughout && state.runJumps >= 5) {
          unlockAchievement("sound-of-silence");
        }
        // Notify any listeners (e.g. the shell's share button)
        // that a game-over just happened. Fired exactly once per
        // run, directly from the transition instead of via a poll.
        for (const cb of GameAPI._gameOverCbs) {
          try {
            cb();
          } catch (_e) {
            /* ignore listener errors */
          }
        }
      }
    } // end noCollisions guard

    // Clouds drift — slower than the ground but a bit faster than
    // the first-pass fix, so the parallax reads as "distant sky"
    // without feeling sluggish.
    for (const cloud of state.clouds) {
      cloud.x -= state.bgVelocity * (state.width / CLOUD_PARALLAX_DIVISOR) * frameScale;
      cloud.y += randRange(-0.2, 0.2) * frameScale;
    }
    // Parallax layer offsets.
    state.duneOffset += state.bgVelocity * DUNE_SCROLL_SPEED * frameScale;
    // Age struck dune cacti; discard dead/offscreen; spawn new on right.
    if (state.duneCacti) {
      for (const dc of state.duneCacti) {
        if (dc.struck) dc.struckAge = (dc.struckAge || 0) + dtSec;
      }
      compactInPlace(state.duneCacti, (dc) => !dc.dead && dc.wx - state.duneOffset > -dc.w * 3);
      const rightEdge = state.duneOffset + state.width + 100;
      if (!state._nextDuneCactusX || state._nextDuneCactusX < rightEdge) {
        const wx =
          (state._nextDuneCactusX || rightEdge) +
          DUNE_CACTUS_MIN_SPACING_PX +
          Math.random() * DUNE_CACTUS_SPACING_RANGE_PX;
        state.duneCacti.push(spawnDuneCactus(wx));
        state._nextDuneCactusX = wx;
      }
    }
    // Keep clouds until they've fully drifted past the left edge.
    compactInPlace(state.clouds, (c) => {
      const w = cloudVisualWidth(c.size, c.scale);
      return c.x > -w && c.x < state.width + w * 2;
    });
    // Maintain a constant cloud density: if we're below the target
    // count AND the rightmost cloud is far enough away to avoid
    // visual stacking, add a new cloud just past the right edge.
    // trySpawnCloud() enforces the min-spacing constraint itself.
    if (state.clouds.length < targetCloudCount() && state.frame % CLOUD_SPAWN_INTERVAL === 0) {
      trySpawnCloud();
    }
  } else {
    state.gameOverFade = Math.min(state.gameOverFade + GAME_OVER_FADE_RATE * frameScale, 1);
  }
}

function render() {
  // === Background pass (no tint) =================================
  // Sky background (single blit of the cached gradient buffer).
  if (skyCanvas) ctx.drawImage(skyCanvas, 0, 0);

  // Stars + Milky Way (fade in only at night).
  // Stars fade out during rain — overcast sky blocks them.
  if (state.rainIntensity < 1) {
    if (state.rainIntensity > 0) {
      ctx.save();
      ctx.globalAlpha = 1 - state.rainIntensity;
      stars.draw(ctx);
      ctx.restore();
    } else {
      stars.draw(ctx);
    }
  }
  // Shooting stars (easter egg, second night onward).
  drawShootingStars(ctx);
  drawUfoBeam(ctx);

  // Sun + moon ride parabolic arcs across the sky. Drawn at full
  // brightness — they're light sources, not lit objects, and they
  // sit behind the foreground because the foreground gets drawn
  // on top of them below.
  drawSun(ctx);
  drawMoon(ctx);

  // Comet/meteor draw ON TOP of sun, moon, and stars.
  drawRareEventSky(ctx);

  // Lightning — drawn on the BACKGROUND ctx so the flash + bolt
  // read as "distant sky lighting up the scene", with the
  // raptor and cacti silhouetted in front of it. The previous
  // placement was after the fg composite, which front-lit
  // everything including the raptor, obscuring the gameplay.
  drawLightning(ctx);

  // Rainbow — drawn in the background so foreground elements
  // (ground, cacti, raptor, clouds, dunes) all render on top.
  //
  // Pre-bake to an offscreen canvas the first frame a new
  // rainbow is visible. The per-frame cost of filling a huge
  // radial-gradient ring at full viewport scale was measurable
  // (multi-ms on integrated GPUs) — the player experienced it
  // as a sustained frame-rate drop for the whole rainbow life.
  // Caching the ring as a static bitmap drops the per-frame
  // cost to a single drawImage plus a globalAlpha scalar for
  // the fade in / out.
  if (state.rainbow) {
    const rb = state.rainbow;
    // biome-ignore lint/suspicious/noImplicitAnyLet: auto-suppressed during biome 2.x bump
    let alpha;
    if (rb.age < 1) alpha = rb.age;
    else if (rb.age < 3) alpha = 1;
    else alpha = 1 - (rb.age - 3) / 3;
    alpha = Math.max(0, Math.min(1, alpha)) * RAINBOW_MAX_OPACITY;
    if (alpha > 0) {
      const cache = ensureRainbowCache();
      if (cache) {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.drawImage(cache, 0, 0);
        ctx.restore();
      }
    }
  }

  // === Foreground pass (rendered on offscreen canvas, then       =
  // === uniformly sky-tinted, then composited onto the main pass) =
  fgCtx.clearRect(0, 0, state.width, state.height);

  // Render order (reworked so only the dunes get the extra-strong
  // "distance" tint — clouds + UFO/Santa now end up with the same
  // final sky tint as the raptor, keeping them visible at night /
  // during storms instead of washing out):
  //   1. Dunes + dune cacti + tumbleweed
  //   2. Extra dune-tint pass — source-atop at this point only
  //      hits dune pixels because nothing else is on fgCtx yet
  //   3. Clouds (in front of dunes, no extra dune-tint applied)
  //   4. UFO / Santa via destination-over so they land UNDER the
  //      clouds + dunes (preserves the "clouds pass in front" read)
  //      while skipping the dune-tint pass entirely
  //   5. Flowers, ground, cacti, raptor, dust, ash
  //   6. Final sky-light tint — hits everything at normal strength

  // 1. Parallax dunes — drawn procedurally from noise each frame.
  {
    const off = state.duneOffset;
    const groundY = state.ground;
    const step = 4;
    // Dune color blended with sky for atmospheric depth
    const sky = state.currentSky;
    const dr = Math.round(200 * 0.65 + sky[0] * 0.35);
    const dg = Math.round(168 * 0.65 + sky[1] * 0.35);
    const db = Math.round(120 * 0.65 + sky[2] * 0.35);
    fgCtx.fillStyle = `rgb(${dr}, ${dg}, ${db})`;
    fgCtx.beginPath();
    fgCtx.moveTo(0, state.height);
    for (let sx = 0; sx <= state.width; sx += step) {
      const y = groundY - duneHeight(sx, off);
      fgCtx.lineTo(sx, y);
    }
    fgCtx.lineTo(state.width, state.height);
    fgCtx.closePath();
    fgCtx.fill();

    // Dune cacti + tumbleweed in 3 depth layers:
    // depth 1 cacti → tumbleweed (depth 2) → depth 3 cacti
    const _drawDuneCacti = (targetDepth: number) => {
      if (!state.duneCacti) return;
      for (const dc of state.duneCacti) {
        if (dc.dead || dc.depth !== targetDepth) continue;
        const sx = dc.wx - off;
        if (sx < -dc.w * 2 || sx > state.width + dc.w * 2) continue;
        const duneY = groundY - duneHeight(sx, off);
        const img = IMAGES[dc.key];
        if (!img) continue;
        fgCtx.save();
        if (dc.struck) {
          fgCtx.filter = "brightness(0.1) saturate(0)";
          if (dc.struckAge > 0.8) {
            const fadeT = Math.min(1, (dc.struckAge - 0.8) / 0.6);
            fgCtx.globalAlpha = 1 - fadeT;
            if (Math.random() < 0.3) spawnAsh(sx, duneY, dc.w, dc.h);
            if (fadeT >= 1) {
              dc.dead = true;
              fgCtx.restore();
              continue;
            }
          }
        }
        fgCtx.drawImage(
          img,
          Math.round(sx - dc.w / 2),
          Math.round(duneY + dc.h * 0.15 - dc.h),
          Math.round(dc.w),
          Math.round(dc.h),
        );
        fgCtx.restore();
      }
    };
    _drawDuneCacti(1); // behind tumbleweed
    // Tumbleweed at depth 2
    const _re = state.activeRareEvent;
    if (_re && _re.id === "tumbleweed") {
      const twImg = IMAGES.tumbleweed;
      if (twImg) {
        fgCtx.save();
        fgCtx.translate(_re.x, _re.y);
        fgCtx.rotate(_re.rot || 0);
        fgCtx.drawImage(twImg, -10, -10, 20, 20);
        fgCtx.restore();
      }
    }
    _drawDuneCacti(3); // in front of tumbleweed
  }

  // 2. Extra sky tint on dunes + dune cacti only — stronger than
  //    the foreground tint so they feel more distant. Runs now
  //    (before clouds / UFO / Santa / foreground) so source-atop
  //    only lands on dune pixels.
  {
    const sky = state.currentSky;
    const strength = Math.min(1, tintStrength() * 1.8);
    fgCtx.save();
    fgCtx.globalCompositeOperation = "source-atop";
    fgCtx.fillStyle = `rgba(${sky[0]}, ${sky[1]}, ${sky[2]}, ${strength})`;
    fgCtx.fillRect(0, 0, state.width, state.height);
    fgCtx.restore();
  }

  // 3. Clouds — drawn pure white here, the final sky-tint pass
  //    below picks up the sky color and washes them toward it at
  //    normal strength (not the stronger dune tint).
  for (const cloud of state.clouds) {
    drawCloudMorphed(fgCtx, cloud.x, cloud.y, cloud.size * cloud.scale, state.rainIntensity);
  }
  fgCtx.save();
  fgCtx.globalCompositeOperation = "destination-over";
  drawRareEventFg(fgCtx);
  fgCtx.restore();

  // Flower patches — painted between the grass band and the
  // cacti so cacti and the raptor layer on top if they overlap.
  // Flowers also pick up the final sky-light tint at the end of
  // this pass so they read as part of the foreground atmosphere.
  drawFlowerPatches(fgCtx);
  drawCoins(fgCtx);
  // Collect bursts on top of the coin layer so the expanding
  // ring + sparkle particles aren't clipped by cacti/raptor
  // rendered later. Coins sit inside rest-area flower fields,
  // so there's nothing meaningful in front of them anyway.
  drawCoinSparks(fgCtx);

  // Ground bands. Default top band is desert-yellow; grass-field
  // rest-area spans overlay the top band in green afterwards.
  let bandY = 0;
  for (let i = 0; i < GROUND_BAND_COLORS.length; i++) {
    fgCtx.fillStyle = GROUND_BAND_COLORS[i];
    fgCtx.fillRect(0, state.ground + bandY, state.width, GROUND_BAND_HEIGHTS_PX[i]);
    bandY += GROUND_BAND_HEIGHTS_PX[i];
  }
  // Grass-field overlays — paint the top band green only where a
  // flower-field rest area is currently on screen. Clipped to the
  // visible x-range so off-screen span data doesn't draw.
  if (state.grassFields && state.grassFields.length > 0) {
    fgCtx.fillStyle = GRASS_FIELD_COLOR;
    for (const g of state.grassFields) {
      const sx = Math.max(0, g.startX);
      const ex = Math.min(state.width, g.endX);
      if (ex > sx) {
        fgCtx.fillRect(sx, state.ground, ex - sx, GROUND_BAND_HEIGHTS_PX[0]);
      }
    }
  }

  // Ash — drawn BEFORE cacti + raptor so the debris cloud from a
  // lightning-struck cactus sits behind other cacti and the
  // raptor silhouette instead of smearing over them. Also means
  // ash picks up the same sky-light tint the foreground gets,
  // so it reads as part of the scene rather than a foreground
  // particle layer.
  drawAsh(fgCtx);

  // Cacti.
  cactuses.draw(fgCtx);

  // Raptor — flashes at ~7.5Hz during post-revive invulnerability
  // so the player can tell the grace window is active.
  if (state.frame < state.invulnerableUntilFrame) {
    fgCtx.save();
    fgCtx.globalAlpha = Math.floor(state.frame / 4) % 2 === 0 ? 0.45 : 1;
    raptor.draw(fgCtx);
    fgCtx.restore();
  } else {
    raptor.draw(fgCtx);
  }
  drawDust(fgCtx);

  // Sky-light tint applied ONLY where the foreground has drawn
  // pixels. `source-atop` performs alpha blending only over
  // existing dest pixels, leaving transparent areas untouched —
  // so the tint doesn't bleed into the sky region around the
  // raptor or above the cacti.
  {
    const sky = state.currentSky;
    const strength = tintStrength();
    fgCtx.save();
    fgCtx.globalCompositeOperation = "source-atop";
    fgCtx.fillStyle = `rgba(${sky[0]}, ${sky[1]}, ${sky[2]}, ${strength})`;
    fgCtx.fillRect(0, 0, state.width, state.height);
    fgCtx.restore();
  }

  // Composite the tinted foreground over the background.
  ctx.drawImage(fgCanvas, 0, 0, fgCanvas.width, fgCanvas.height, 0, 0, state.width, state.height);

  // Confetti — drawn AFTER the tinted foreground so the
  // colors pop at any time of day (no sky-tint washing them
  // out). Only alive when a cosmetic was just unlocked.
  drawConfetti(ctx);

  // Overcast bands — persistent layered cloud cover during rain.
  drawOvercastBands(ctx, state.rainIntensity);

  // Grey wash-out overlay proportional to rain intensity.
  if (state.rainIntensity > 0) {
    ctx.fillStyle = `rgba(50, 55, 60, ${state.rainIntensity * 0.15})`;
    ctx.fillRect(0, 0, state.width, state.height);
  }

  drawRain(ctx);

  // Score text lives in the DOM now (see #score-display in
  // index.html), not on the canvas. That means it doesn't appear
  // in the death-snapshot that feeds the share card, and it can
  // pick up the same pill styling as the top-right icon cluster.

  // Debug: draw the raptor and cactus collision polygons on top of
  // everything so the player can see what the collision tests are
  // actually checking against.
  if (state.showHitboxes) {
    drawPolygon(ctx, raptor.collisionPolygon(), {
      stroke: "rgba(255, 80, 80, 0.95)",
      fill: "rgba(255, 80, 80, 0.18)",
    });
    for (const c of cactuses.cacti) {
      drawPolygon(ctx, c.collisionPolygon(), {
        stroke: "rgba(80, 200, 255, 0.95)",
        fill: "rgba(80, 200, 255, 0.18)",
      });
    }
    for (const p of cactuses.pterodactyls.pteros) {
      drawPolygon(ctx, p.collisionPolygon(), {
        stroke: "rgba(180, 255, 120, 0.95)",
        fill: "rgba(180, 255, 120, 0.18)",
      });
    }
  }

  // Capture a pristine snapshot of the canvas the first frame
  // after the player dies — before the Game Over overlay is
  // drawn on top of it. Used by the share card as its
  // background, so the card literally shows the scene the
  // player just died in.
  if (state.gameOver && !deathSnapshotReady && canvas && deathCanvas) {
    deathCanvas.width = canvas.width;
    deathCanvas.height = canvas.height;
    deathCtx.setTransform(1, 0, 0, 1, 0, 0);
    deathCtx.drawImage(canvas, 0, 0);
    deathSnapshotReady = true;
  }

  // Game-over overlay: just a dim scrim. The DOM score-card
  // panel (shown by the shell on Game.onGameOver) handles the
  // "Game Over" / score / personal best / restart hint text
  // now, so the canvas only needs to provide the dark fade
  // underneath it for contrast.
  if (state.gameOver) {
    ctx.fillStyle = `rgba(0, 0, 0, ${state.gameOverFade * 0.6})`;
    ctx.fillRect(0, 0, state.width, state.height);
  }
}

// ── Debug performance instrumentation ──────────────────────────
// When ?debug=true, tracks per-frame timings and draws an
// overlay with FPS + frame budget breakdown. Updated every 30
// frames to avoid the readout itself costing performance.
const perf: {
  enabled: boolean;
  samples: Array<{ update: number; render: number; total: number }>;
  maxSamples: number;
  lastDisplay: {
    fps: number;
    update: number | string;
    render: number | string;
    total: number | string;
  };
  frameCount: number;
} = {
  enabled: false,
  samples: [],
  maxSamples: 60,
  lastDisplay: { fps: 0, update: 0, render: 0, total: 0 },
  frameCount: 0,
};

function drawPerfOverlay() {
  if (!perf.enabled || !ctx) return;
  if (++perf.frameCount % 30 === 0 && perf.samples.length > 0) {
    const n = perf.samples.length;
    let sumU = 0,
      sumR = 0,
      sumT = 0;
    for (const s of perf.samples) {
      sumU += s.update;
      sumR += s.render;
      sumT += s.total;
    }
    perf.lastDisplay = {
      fps: Math.round(1000 / (sumT / n)),
      update: (sumU / n).toFixed(2),
      render: (sumR / n).toFixed(2),
      total: (sumT / n).toFixed(2),
    };
    perf.samples.length = 0;
  }
  const d = perf.lastDisplay;
  const lines = [
    `FPS: ${d.fps}`,
    `Update: ${d.update} ms`,
    `Render: ${d.render} ms`,
    `Frame:  ${d.total} ms`,
  ];
  ctx.save();
  ctx.font = "bold 11px monospace";
  ctx.textBaseline = "top";
  const x = 10,
    y = state.height - 70;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(x - 4, y - 4, 150, lines.length * 15 + 8);
  ctx.fillStyle = "#0f0";
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], x, y + i * 15);
  }
  ctx.restore();
}

function loop(now: number) {
  pollGamepad();
  const t0 = performance.now();
  let tUpdate = t0;
  if (!state.paused) {
    update(now || t0);
    tUpdate = performance.now();
  }
  render();
  const tRender = performance.now();
  if (perf.enabled) {
    perf.samples.push({
      update: tUpdate - t0,
      render: tRender - tUpdate,
      total: tRender - t0,
    });
    drawPerfOverlay();
  }
  _rafId = requestAnimationFrame(loop);
}

// ══════════════════════════════════════════════════════════════════
// Lifecycle
// ══════════════════════════════════════════════════════════════════

// ── Persistent high score (localStorage) ──────────────────────────

/** Read the saved personal best. Returns 0 if storage is
 *  unavailable (private mode, denied permission) or unparseable. */
// loadHighScore / saveHighScore / loadCareerRuns / saveCareerRuns /
// loadUnlockedAchievements / saveUnlockedAchievements all live in
// src/persistence.ts.

/** Unlock an achievement by id. Silently no-ops if the id is
 *  unknown or already unlocked. Fires the onAchievementUnlock
 *  callbacks so the shell can show a toast. */
function unlockAchievement(id: string) {
  const def = ACHIEVEMENTS_BY_ID[id];
  if (!def) return;
  if (state.unlockedAchievements[id]) return;
  state.unlockedAchievements[id] = true;
  saveUnlockedAchievements(state.unlockedAchievements);
  track("achievement_unlock", { id });
  // Celebratory stinger paired with the toast. Fires exactly once
  // per achievement — the idempotency guard above ensures repeat
  // calls during the same run don't retrigger the chime.
  audio.playAchievement();
  // Mirror to Steam. Fire-and-forget: no-op in the browser build,
  // silent when Steam isn't running. Next successful init reconcile
  // will recover anything that fails here.
  pushAchievementToSteam(id);
  // Mirror to Game Center / Play Games Services. Also a no-op until
  // the Capacitor adapter is wired up with a real plugin — see
  // src/mobile/gameServices.ts and docs/GAME_SERVICES.md.
  reportAchievementToServices(id);
  for (const cb of GameAPI._achievementCbs) {
    try {
      cb(def);
    } catch (_e) {
      /* ignore listener errors */
    }
  }
}

// loadTotalJumps / saveTotalJumps / loadBoolFlag / saveBoolFlag all
// live in src/persistence.ts.

/** Called once the player dies. Checks if this run's score beat
 *  the stored personal best and, if so, saves it and flags the
 *  run for celebration on the game-over overlay. */
function commitRunScore() {
  // Floor before comparing + saving — state.score is a continuous
  // meter counter that carries fractional-meter precision the
  // display side doesn't care about. Persisting the raw float
  // surfaced as an ugly "2183.4567 m" on the menu's personal-best
  // line; keeping the stored value integer matches the HUD which
  // already Math.floor's the live score.
  const floored = Math.floor(state.score);
  if (floored > state.highScore) {
    state.highScore = floored;
    state.newHighScore = true;
    saveHighScore(state.highScore);
  } else {
    state.newHighScore = false;
  }
  // Report every finished run's score to the platform leaderboard.
  // The service keeps the best — submitting a lower score is fine and
  // expected. No-op on web/desktop + on mobile until the adapter is
  // wired up.
  reportScoreToServices(state.score);
  track("run_end", {
    score: floored,
    coins: state.runCoins,
    nights: state.runNightsSurvived,
    jumps: state.runJumps,
    duration_ms: Math.round(performance.now() - _runStartMs),
    new_best: state.newHighScore,
  });
}

/** performance.now() at the start of the current run, captured in
 *  initRunState. commitRunScore subtracts from performance.now()
 *  to report run length to telemetry. Kept module-local so no
 *  state-shape churn (and no localStorage persistence — run length
 *  is strictly a telemetry-time computation). */
let _runStartMs = 0;

/** Reset per-run tracking state. Called from both start()
 *  (first run) and resetGame() (subsequent runs) so the
 *  initialization is identical regardless of code path. */
function initRunState() {
  _runStartMs = performance.now();
  track("run_start");
  state.runJumps = 0;
  state.runCactiCleared = 0;
  state.runNightsSurvived = 0;
  state._pendingNights = 0;
  state.runShootingStars = 0;
  state._wasInNight = false;
  state.revivesUsedThisRun = 0;
  state.runCoins = 0;
  state.invulnerableUntilFrame = 0;
  // Rainy Day achievement: gate on whether the player witnessed
  // the rain START during this run. A continuation run that begins
  // already-raining (because soft-reset preserves weather across
  // deaths) leaves this false — so surviving until THIS storm ends
  // is not enough; only a storm that started during the current
  // run counts. Flips true in the rain-start handler below.
  state._runSawRainStart = false;
  // Sound of Silence: snapshot the mute state right now.
  // If the player unmutes at any point during the run,
  // setMuted() flips this to false. Checked at game-over.
  state._runMutedThroughout = !!audio?.muted;
}

/** Reset game state for a new run.
 *
 *  `hard = false` (default, post-death soft restart):
 *    Preserves the ambient day/night/weather cycle so the world
 *    keeps running uninterrupted — player doesn't feel like the
 *    universe rewinds every time they die to a cactus. Only
 *    per-run things (score, velocity, particles, dust) reset.
 *
 *  `hard = true` (explicit return-to-home / progress reset):
 *    Nukes everything. New cycle, fresh sky, no inherited weather.
 */
function resetGame(hard = false) {
  state.gameOver = false;
  state.gameOverFade = 0;
  state.gameOverFrame = 0;
  state.newHighScore = false;
  state.score = 0;
  state.bgVelocity = INITIAL_BG_VELOCITY;
  state.lastNow = null;
  // Bring music back up after the game-over fade — respects the
  // current mute flags, so a muted player stays silent.
  audio.resumeMusicOnRunStart();
  // Nudge the audio layer in case a prior pause-menu cycle left
  // the Web Audio context suspended or the rain element paused.
  // Without this, music/rain/SFX could stay silent across runs
  // until the player toggled mute off and back on.
  audio.ensureLiveSession();
  // Ephemeral per-frame particle pools: always cleared (the death
  // animation snapshot burned them out visually, starting fresh is
  // correct regardless of hard/soft).
  state.shootingStars = [];
  state.confetti = [];
  state.dust = [];
  state.ash = [];
  // Belt-and-braces: the death-site handler already stops these,
  // but resetGame is also reachable from the "reset progress"
  // debug path and the start-of-next-run transition, so double-
  // dispatching the stop keeps a lingering loop from surviving an
  // edge case where the death handler didn't run (e.g. cinematic
  // mode, noCollisions).
  stopActiveRareEventAudio();
  state.activeRareEvent = null;
  state.rainParticles = [];
  state.lightning = { alpha: 0, nextAt: 0 };
  state.flowerPatches = [];
  clearCoins();
  audio.resetCoinStreak();
  // Cut the game-over tally sequence if it's still firing — quick
  // restarts would otherwise layer the previous run's "ding ding
  // diiing" over the fresh run's gameplay audio.
  audio.stopCoinFill();
  state.grassFields = [];
  // First breather of the new run fires at ~INTERVAL meters. The
  // gate is score-based now, so just re-anchor the next-at marker
  // to the start-of-run score (0).
  state._nextBreatherAtScore = CACTUS_BREATHER_INTERVAL_METERS;
  if (hard) {
    // Full reset — tear down the ambient cycle too.
    state.currentSky = [...SKY_COLORS[0]];
    state.lastSkyScore = -1;
    state.smoothPhase = 0;
    state.isRaining = false;
    state.rainIntensity = 0;
    state.rainEndPhase = 0;
    state.rainbow = null;
    state.lastCycleIndex = -1;
    state.lastMoonZenithCycle = -1;
    audio.stopRain();
    // Cloud density reroll: 20% cloudless, 50% normal, 30% extra cloudy
    const cdRoll = Math.random();
    state._cloudDensity = cdRoll < 0.2 ? 0 : cdRoll < 0.7 ? 1 : 2;
  }
  // Note: soft reset keeps state.isRaining, state.rainIntensity,
  // state.smoothPhase, state.currentSky, state.rainbow,
  // state.lastCycleIndex, state._cloudDensity, and the in-flight
  // rain audio playing — the world keeps going. The rain-achievement
  // guard in initRunState() catches the edge case where a run
  // starts already-raining.
  initRunState();
  // Fresh dunes and cacti each run.
  initDunes();
  // Next game-over will capture a fresh snapshot.
  deathSnapshotReady = false;
  seedClouds();
  if (raptor) {
    raptor.velocity = 0;
    raptor.y = raptor.ground;
    raptor.frame = 0;
    raptor.lastFrameAdvanceAt = 0;
  }
  if (cactuses) cactuses.clear();
  stars = new Stars();
  computeSkyGradient();
  // Notify any listeners (e.g. the shell's share button) that
  // the game has transitioned back to a fresh state.
  for (const cb of GameAPI._gameResetCbs) {
    try {
      cb();
    } catch (_e) {
      /* ignore listener errors */
    }
  }
}

function maybeResetAfterGameOver() {
  if (!state.gameOver) return;
  // Visual + audio feedback on every restart attempt, before the
  // cooldown check — so even a too-early press still gives the
  // player confirmation that their input registered.
  (window as unknown as { __rrPulsePlayAgain?: () => void }).__rrPulsePlayAgain?.();
  if (state.frame - state.gameOverFrame > 30) {
    resetGame();
  }
}

function onResize() {
  state.width = window.innerWidth;
  state.height = window.innerHeight + 1;
  state.groundHeight = state.height * GROUND_HEIGHT_RATIO;
  state.ground = state.height - state.groundHeight;

  if (canvas && ctx) {
    // HiDPI/retina: back the canvas at dpr × logical size so drawing
    // stays crisp on retina screens, but cap dpr at 2 to avoid the
    // 9× pixel fill-rate on 3× Windows HiDPI displays. Then scale the
    // context so drawing code still works in logical coordinates.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(state.width * dpr);
    canvas.height = Math.round(state.height * dpr);
    canvas.style.width = state.width + "px";
    canvas.style.height = state.height + "px";
    ctx.setTransform(1, 0, 0, 1, 0, 0); // reset
    ctx.scale(dpr, dpr);
    // Bilinear smoothing stays on — the raptor and cacti are
    // vector-ish art, not true pixel art, so nearest-neighbour gives
    // ugly jagged edges.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "medium";
  }

  // Resize the offscreen foreground canvas to match the main one
  // (in device pixels, with a matching scale transform).
  if (fgCanvas && fgCtx) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    fgCanvas.width = Math.round(state.width * dpr);
    fgCanvas.height = Math.round(state.height * dpr);
    fgCtx.setTransform(1, 0, 0, 1, 0, 0);
    fgCtx.scale(dpr, dpr);
    fgCtx.imageSmoothingEnabled = true;
    fgCtx.imageSmoothingQuality = "medium";
  }

  if (raptor) raptor.resize();
  // Re-anchor every currently-alive obstacle (cacti + pterodactyls)
  // to the new state.ground so they don't visibly jump when the
  // viewport dimensions change (most obvious when toggling fullscreen).
  if (cactuses && raptor) {
    cactuses.resize();
  }
  if (stars) stars = new Stars();
  state.clouds = [];
  // Overcast gradient cache is keyed by coverH — dimensions changed,
  // throw it out so drawOvercastBands rebuilds with the new size.
  invalidateCloudsCache();
  // Sun/moon halo sprites are keyed by radius (= f(state.width)),
  // which just changed.
  invalidateSkyCache();
  initDunes();
  computeSkyGradient();
}

// ══════════════════════════════════════════════════════════════════
// Input
// ══════════════════════════════════════════════════════════════════

function onPointerDown(e: PointerEvent) {
  // Any user gesture is a cheap, valid opportunity to un-suspend
  // the audio context if the browser policy orphaned it. SKIPPED
  // while the game is paused — pauseGameplaySounds() suspended the
  // context on purpose so the UFO loop, Santa bells, comet tail
  // etc. fall silent during the menu. Resuming here would
  // immediately un-suspend on the first click inside the menu.
  if (!state.paused) audio.ensureLiveSession();
  if (!state.started || state.paused) return;
  // If the touch started on an overlay control (cog, sound, menu),
  // let the browser handle it — those elements live above the canvas
  // in the DOM tree so they'd get their own click events anyway, but
  // pointerdown on the canvas fires first on some browsers when the
  // touch overlaps the canvas area.
  if (e.target !== canvas) return;
  e.preventDefault();
  if (state.gameOver) {
    maybeResetAfterGameOver();
  } else {
    if (!raptor.jump()) raptor.bufferJump(performance.now());
  }
}

function onKeyDown(e: KeyboardEvent) {
  // Nudge audio back to life on every keypress — see onPointerDown
  // for the "skip while paused" rationale (menu keys would
  // otherwise immediately un-suspend the context we just told to
  // suspend).
  if (!state.paused) audio.ensureLiveSession();
  // ESC is reserved for the menu overlay — let it through.
  if (e.key === "Escape") return;

  // F9 toggles cinematic / filming mode.
  if (e.code === "F9") {
    e.preventDefault();
    toggleCinematicMode();
    return;
  }

  // While cinematic mode is active, intercept extra keys for
  // phase / weather / cosmetic control.
  if (state.cinematicMode && handleCinematicKey(e)) {
    e.preventDefault();
    return;
  }

  // Before the game has started, Space/Enter acts as "Start Game".
  //
  // Two escape hatches before we hijack the keypress:
  //   1. If an interactive control has focus (cog, sound toggle,
  //      fullscreen, a menu item, anything a player can tab to) let
  //      the browser fire that button's native Space/Enter click.
  //      Without this, focusing the cog and hitting Space would
  //      silently start the game instead of opening the menu — the
  //      button press gets eaten by preventDefault + __onStartKey.
  //   2. If the settings menu is open, the overlay is modal; Space
  //      or Enter should never fall through to "start the game".
  //      Menu buttons handle themselves via path 1; this covers the
  //      edge case where focus has drifted to <body>.
  if (!state.started) {
    if (e.code === "Space" || e.code === "Enter" || e.code === "NumpadEnter") {
      const active = document.activeElement as HTMLElement | null;
      const isInteractive =
        !!active &&
        active !== document.body &&
        (active.tagName === "BUTTON" ||
          active.tagName === "A" ||
          active.getAttribute("role") === "button");
      if (isInteractive) return;
      const rrIsMenuOpen = (window as any).__rrIsMenuOpen;
      if (typeof rrIsMenuOpen === "function" && rrIsMenuOpen()) return;
      e.preventDefault();
      if (typeof (window as any).__onStartKey === "function") {
        (window as any).__onStartKey();
      }
    }
    return;
  }

  if (state.paused) return;

  // ── Game-over score card: keyboard navigation ─────────────
  // All four arrow keys cycle [Revive · Share · Play again] —
  // ←/↑ go previous, →/↓ go next. Matches the expectation that
  // "arrow key" means "navigate" on a focused row regardless of
  // axis. Enter/Space activate the focused button; the previous
  // "ArrowUp also activates" shortcut is gone because it fought
  // with the new up-navigation and the select path is still one
  // key away (Enter / Space) for every thumb position. Escape
  // returns to the start screen — same destination as the
  // gamepad B / Circle path below.
  if (state.gameOver) {
    const w = window as any;
    if (e.code === "ArrowLeft" || e.code === "ArrowUp") {
      if (w.__rrScoreCardFocusPrev) {
        e.preventDefault();
        w.__rrScoreCardFocusPrev();
        return;
      }
    }
    if (e.code === "ArrowRight" || e.code === "ArrowDown") {
      if (w.__rrScoreCardFocusNext) {
        e.preventDefault();
        w.__rrScoreCardFocusNext();
        return;
      }
    }
    if (e.code === "Enter" || e.code === "NumpadEnter") {
      e.preventDefault();
      if (w.__rrScoreCardSelect) w.__rrScoreCardSelect();
      else maybeResetAfterGameOver();
      return;
    }
    if (e.code === "Space" || e.code === "KeyW") {
      e.preventDefault();
      if (w.__rrScoreCardSelect) w.__rrScoreCardSelect();
      else maybeResetAfterGameOver();
      return;
    }
    if (e.code === "Escape") {
      e.preventDefault();
      if (w.__rrScoreCardHome) w.__rrScoreCardHome();
      return;
    }
  }

  const isJumpKey = e.code === "Space" || e.code === "KeyW" || e.code === "ArrowUp";
  if (isJumpKey) {
    e.preventDefault();
    if (!raptor.jump()) raptor.bufferJump(performance.now());
    return;
  }

  if (e.code === "Enter" || e.code === "NumpadEnter") {
    e.preventDefault();
    maybeResetAfterGameOver();
  }
}

// ══════════════════════════════════════════════════════════════════
// Public API
// ══════════════════════════════════════════════════════════════════

/* eslint-disable @typescript-eslint/no-explicit-any */
type GameCallback = (...args: any[]) => void;

const GameAPI = {
  _ready: false as boolean,
  _readyCb: null as GameCallback | null,
  _gameOverCbs: [] as GameCallback[],
  _gameResetCbs: [] as GameCallback[],
  _achievementCbs: [] as GameCallback[],

  onReady(cb: GameCallback) {
    // Defer to a microtask so the callback never fires synchronously
    // from inside the consumer's module init. ui.ts calls
    // Game.onReady(onGameReady) during its top-level execution; if
    // main.ts has already flipped _ready=true by that point, a
    // synchronous invocation here would run onGameReady before
    // ui.ts's remaining const declarations have been reached —
    // tripping a ReferenceError/TDZ on any module-level const
    // referenced downstream (startRaptorStage, SOUND_SETTINGS_CALLBACKS).
    if (this._ready) queueMicrotask(cb);
    else this._readyCb = cb;
  },

  onGameOver(cb: GameCallback) {
    if (typeof cb === "function") this._gameOverCbs.push(cb);
  },
  onGameReset(cb: GameCallback) {
    if (typeof cb === "function") this._gameResetCbs.push(cb);
  },

  onAchievementUnlock(cb: GameCallback) {
    if (typeof cb === "function" && !this._achievementCbs.includes(cb)) {
      this._achievementCbs.push(cb);
    }
  },

  /** Full achievement catalog with unlocked status. Used by
   *  the Achievements menu overlay. Returns a shallow copy so
   *  callers can't mutate the source. */
  getAchievements() {
    return ACHIEVEMENTS.map((a) => ({
      id: a.id,
      title: a.title,
      desc: a.desc,
      iconHTML: a.iconHTML || null,
      iconImage: a.iconImage || null,
      unlocked: !!state.unlockedAchievements[a.id],
      secret: !!a.secret,
    }));
  },

  start() {
    if (state.started) return;
    state.started = true;
    state.paused = false;
    const cdRoll = Math.random();
    state._cloudDensity = cdRoll < 0.2 ? 0 : cdRoll < 0.7 ? 1 : 2;
    // Reset per-run state identically to resetGame() so the
    // very first run after page load starts clean.
    initRunState();
  },

  pause() {
    state.paused = true;
    // Silence every non-music sound while the menu/pause is open:
    // UFO hover loop, Santa bells, any in-flight SFX tail, and the
    // rain ambience. Music is left playing — see audio.ts for the
    // full rationale.
    audio.pauseGameplaySounds();
  },

  resume() {
    if (!state.started) return;
    // Clear the delta-time timestamp so the first post-resume
    // frame doesn't see a huge elapsed time and teleport
    // everything forward.
    state.lastNow = null;
    audio.resumeGameplaySounds();
    state.paused = false;
  },

  isStarted() {
    return state.started;
  },

  isPaused() {
    return state.paused;
  },

  setMuted(muted: boolean) {
    audio.setMuted(muted);
  },

  isMuted() {
    return audio.muted;
  },

  /** True when the player has explicitly saved a mute/unmute
   *  choice (either this session or a previous one). The Start
   *  Game handler uses this to decide whether to auto-unmute on
   *  first visit or honour a returning visitor's saved preference. */
  hasSavedMutePreference() {
    return audio.hasSavedPreference;
  },

  unlockAudio() {
    audio.unlockAudio();
  },

  playClick() {
    audio.playClick();
  },

  /** Same UI click tap the menu system uses for every button. Exposed
   *  so index.html can call it from the start-button handler — keeps
   *  start + menu + game-over feedback audibly identical without any
   *  caller having to reach directly into the audio module. */
  playMenuTap() {
    audio.playMenuTap();
  },

  setMusicMuted(muted: boolean) {
    audio.setMusicMuted(muted);
  },

  isMusicMuted() {
    return audio.musicMuted;
  },

  setJumpMuted(muted: boolean) {
    audio.setJumpMuted(muted);
  },

  isJumpMuted() {
    return audio.jumpMuted;
  },

  setRainMuted(muted: boolean) {
    audio.setRainMuted(muted);
  },

  isRainMuted() {
    return audio.rainMuted;
  },

  // ── Finer SFX channel toggles ───────────────────────────
  // Each pair mirrors the music/jump/rain shape: setter +
  // getter, persisted via audio.ts. The menu UI wires one
  // toggle per pair so the player can silence, say, just the
  // coin-collect chain without losing the jump or rain audio.
  setFootstepsMuted(muted: boolean) {
    audio.setFootstepsMuted(muted);
  },
  isFootstepsMuted() {
    return audio.footstepsMuted;
  },
  setCoinsMuted(muted: boolean) {
    audio.setCoinsMuted(muted);
  },
  isCoinsMuted() {
    return audio.coinsMuted;
  },
  setUiMuted(muted: boolean) {
    audio.setUiMuted(muted);
  },
  isUiMuted() {
    return audio.uiMuted;
  },
  setEventsMuted(muted: boolean) {
    audio.setEventsMuted(muted);
  },
  isEventsMuted() {
    return audio.eventsMuted;
  },
  setThunderMuted(muted: boolean) {
    audio.setThunderMuted(muted);
  },
  isThunderMuted() {
    return audio.thunderMuted;
  },

  isDebug() {
    return state.debug;
  },

  /** Current run's score — meters run, as a floored integer. */
  getScore() {
    return Math.floor(state.score);
  },

  /** Debug helper — overwrite the current run's score. Used by
   *  the debug menu's score editor so testers can verify unlock
   *  / personal-best / share-card behavior without waiting for
   *  natural cactus passes. */
  setScore(n: number) {
    const next = Math.max(0, Math.floor(Number(n) || 0));
    state.score = next;
    // Fire any meters-threshold achievements the player just
    // skipped over so debug-setting the score to e.g. 6000
    // unlocks everything in one go. score-25 is deliberately
    // excluded — it's a cactus-count achievement now, not a
    // meters one; testers can trigger it via _setRunCactiCleared.
    if (next >= PARTY_HAT_SCORE_THRESHOLD) unlockAchievement("party-time");
    if (next >= BOW_TIE_SCORE_THRESHOLD) unlockAchievement("dinosaurs-forever");
    if (next >= THUG_GLASSES_SCORE_THRESHOLD) unlockAchievement("score-250");
    // Also trigger cosmetic unlocks if thresholds are met.
    if (!state.unlockedPartyHat && next >= PARTY_HAT_SCORE_THRESHOLD) {
      state.unlockedPartyHat = true;
      state.wearPartyHat = true;
      saveBoolFlag(UNLOCKED_PARTY_HAT_KEY, true);
      saveBoolFlag(WEAR_PARTY_HAT_KEY, true);
    }
    if (!state.unlockedThugGlasses && next >= THUG_GLASSES_SCORE_THRESHOLD) {
      state.unlockedThugGlasses = true;
      state.wearThugGlasses = true;
      saveBoolFlag(UNLOCKED_THUG_GLASSES_KEY, true);
      saveBoolFlag(WEAR_THUG_GLASSES_KEY, true);
    }
    if (!state.unlockedBowTie && next >= BOW_TIE_SCORE_THRESHOLD) {
      state.unlockedBowTie = true;
      state.wearBowTie = true;
      saveBoolFlag(UNLOCKED_BOW_TIE_KEY, true);
      saveBoolFlag(WEAR_BOW_TIE_KEY, true);
    }
  },

  /** Best score persisted in localStorage across all runs. */
  getHighScore() {
    return state.highScore;
  },

  /** True while a game-over overlay is showing for a run that
   *  broke the previous personal best. */
  isNewHighScore() {
    return state.newHighScore;
  },

  /** True if the player is currently looking at the game-over
   *  screen. Used by the shell to decide when to show the
   *  "Share your score" button. */
  isGameOver() {
    return state.gameOver;
  },

  /** Reset to a fresh run right now. Safe to call any time
   *  during a game-over state; the short death animation
   *  cooldown is still applied inside maybeResetAfterGameOver. */
  restartFromGameOver() {
    maybeResetAfterGameOver();
  },

  /** Current coin cost of a mid-run revive. Starts cheap, marks
   *  up to REVIVE_SECOND_COST on the second pull, then doubles
   *  from there: 50 → 125 → 250 → 500 → 1000 … */
  getReviveCost(): number {
    const n = state.revivesUsedThisRun;
    if (n === 0) return REVIVE_FIRST_COST;
    return REVIVE_SECOND_COST * 2 ** (n - 1);
  },

  /** True iff the player is currently dead and can afford the
   *  current revive cost. Drives the UI's Revive button state. */
  canRevive(): boolean {
    if (!state.gameOver) return false;
    return state.coinsBalance >= GameAPI.getReviveCost();
  },

  /** Spend coins to un-die: deducts the current cost, clears
   *  game-over, grants a ~1s invulnerability window so the
   *  raptor can phase past the obstacle that killed it, and
   *  increments the revive counter for the next cost tier.
   *  Returns true on success, false if the player can't afford
   *  it or isn't in a game-over state. */
  revive(): boolean {
    if (!GameAPI.canRevive()) return false;
    const cost = GameAPI.getReviveCost();
    state.coinsBalance -= cost;
    saveCoinsBalance(state.coinsBalance);
    state.gameOver = false;
    state.gameOverFade = 0;
    state.gameOverFrame = 0;
    // Put the raptor back on solid ground with zero velocity —
    // otherwise it'd still be tumbling mid-jump from the hit.
    if (raptor) {
      raptor.velocity = 0;
      raptor.y = raptor.ground;
      raptor.frame = 0;
      raptor.lastFrameAdvanceAt = 0;
    }
    state.invulnerableUntilFrame = state.frame + REVIVE_INVULN_FRAMES;
    state.revivesUsedThisRun += 1;
    // Belt-and-braces: the death handler paused music + killed
    // rare-event loops. Reverse both so the revived run feels
    // alive instead of entering a silent void.
    audio.resumeMusicOnRunStart();
    audio.ensureLiveSession();
    stopActiveRareEventAudio();
    state.activeRareEvent = null;
    // Let the next death capture a fresh score-card snapshot
    // instead of showing the now-obsolete one from this death.
    deathSnapshotReady = false;
    // Positive feedback cue (same chime as a shop purchase —
    // coins-out → reward feels cohesive).
    audio.playShopPurchase();
    return true;
  },

  /** Manually drive one update+render tick. Used by cinematic mode
   *  when rAF is throttled (hidden tabs). */
  _tick() {
    loop(performance.now());
  },

  /** Cinematic helper: snap rain state instantly. */
  _forceRain(on: boolean) {
    state.isRaining = !!on;
    state.rainIntensity = on ? 1 : 0;
    if (on) {
      state.rainEndPhase = state.smoothPhase + 100;
    } else {
      state.rainParticles = [];
      state.lightning = { alpha: 0, nextAt: 0 };
    }
  },

  /** Cinematic helper: force all cosmetics at once. */
  _forceCosmetics(hat: boolean, glasses: boolean, bow: boolean) {
    state.unlockedPartyHat = !!hat;
    state.wearPartyHat = !!hat;
    state.unlockedThugGlasses = !!glasses;
    state.wearThugGlasses = !!glasses;
    state.unlockedBowTie = !!bow;
    state.wearBowTie = !!bow;
  },

  /** Debug helper: kick off a flower-field breather on the next
   *  frame instead of waiting for the cactus counter to reach
   *  the randomised threshold. Makes it easy to eyeball the
   *  rest-area layout (coin spacing, buffer symmetry, etc.)
   *  without running through ~40 cacti first. */
  _forceBreather() {
    if (cactuses) cactuses.forceBreather();
  },

  /** Debug helper: arm the next spawn to be a pterodactyl (and
   *  fire it this frame). Lets testers eyeball the flyer's
   *  height, per-frame hitbox, and animation cadence without
   *  hoping the 12% roll hits. */
  _spawnPterodactyl() {
    if (cactuses) cactuses.forcePterodactyl();
  },

  /** Debug helper: set the current run's "cacti cleared" count
   *  directly. score-25 fires from the meters-update path once
   *  this reaches 25, so setting it to 25 (or higher) unlocks
   *  the achievement on the next frame without running through
   *  the cacti by hand. */
  _setRunCactiCleared(n: number) {
    state.runCactiCleared = Math.max(0, Math.floor(Number(n) || 0));
  },

  /** Debug helper: force a game-over immediately without needing
   *  an actual collision. Lets the shell test the share card
   *  flow end to end. */
  _forceGameOver() {
    if (state.gameOver) return;
    state.gameOver = true;
    state.gameOverFrame = state.frame;
    commitRunScore();
    for (const cb of GameAPI._gameOverCbs) {
      try {
        cb();
      } catch (_e) {
        /* ignore */
      }
    }
  },

  /** Reset the game back to its idle pre-start state: paused,
   *  not-started, fresh score and entities. The shell pairs this
   *  with re-showing the start screen when the player picks
   *  "Back to home screen" from the menu. */
  returnToHome() {
    // Hard reset — returning to the home screen should feel like
    // a fresh boot, not a paused continuation. Clears sky / weather
    // / smoothPhase so the next Start Game doesn't begin mid-storm.
    resetGame(true);
    state.started = false;
    state.paused = true;
  },

  /** Compose a 1200×630 "share your score" PNG on an offscreen
   *  canvas, using whatever sky/time-of-day and cosmetics the
   *  player had on during the run they just finished. Resolves
   *  to a Blob the shell can hand to navigator.share or a
   *  download link. */
  generateScoreCard() {
    return generateScoreCardBlob(deathSnapshotReady);
  },

  isShowingHitboxes() {
    return state.showHitboxes;
  },

  setShowHitboxes(on: boolean) {
    state.showHitboxes = !!on;
  },

  toggleShowHitboxes() {
    state.showHitboxes = !state.showHitboxes;
    return state.showHitboxes;
  },

  isNoCollisions() {
    return state.noCollisions;
  },

  toggleNoCollisions() {
    state.noCollisions = !state.noCollisions;
    return state.noCollisions;
  },

  isPerfOverlay() {
    return perf.enabled;
  },

  togglePerfOverlay() {
    perf.enabled = !perf.enabled;
    return perf.enabled;
  },

  isRaining() {
    return state.isRaining;
  },

  /** Debug: trigger or stop a rain cycle with natural duration. */
  toggleRain() {
    if (state.isRaining) {
      // Stop current rain immediately — force rainbow
      state.isRaining = false;
      state.rainEndPhase = 0;
      state._debugRainStop = true;
    } else {
      // Start a natural-length rain cycle
      state.isRaining = true;
      state.rainEndPhase = state.smoothPhase + 0.3 + Math.random() * 0.9;
      state._runSawRainStart = true;
    }
    return state.isRaining;
  },

  /** Debug: trigger a specific rare event by id. */
  triggerEvent(id: string) {
    const evt = RARE_EVENTS.find((e) => e.id === id);
    if (!evt) return false;
    state.activeRareEvent = {
      id: evt.id,
      age: 0,
      life: evt.duration,
      x: state.width + 50,
      y: state.height * (0.1 + Math.random() * 0.3),
    };
    // Mirror the SFX fire in maybeSpawnRareEvent so debug triggers
    // sound the same as natural spawns.
    if (evt.id === "ufo") audio.playUfo();
    else if (evt.id === "santa") audio.playSanta();
    else if (evt.id === "comet") audio.playComet();
    if (!state._rareEventsSeen[evt.id]) {
      state._rareEventsSeen[evt.id] = 1;
      saveRareEventsSeen(state._rareEventsSeen);
      unlockAchievement(evt.achievement);
    }
    return true;
  },

  /** List available rare event IDs for debug. */
  getEventIds() {
    return RARE_EVENTS.map((e) => e.id);
  },

  /** Debug: advance to next day cycle and update moon phase. Jump
   *  the sky phase to the moon's zenith so the full-moon gate in
   *  the main loop can fire this same cycle without the player
   *  having to wait half a day for the sky to catch up to the
   *  phase anchor. */
  advanceMoonPhase() {
    state.totalDayCycles += 1;
    saveTotalDayCycles(state.totalDayCycles);
    state.moonPhase = moonPhaseFromCycles(state.totalDayCycles);
    // Jump to the moon zenith so the debug view immediately shows
    // the moon overhead — and the normal zenith-crossing detector
    // below will fire the achievement on the next frame.
    state.smoothPhase = Math.floor(state.smoothPhase) + MOON_PHASE_CENTER;
    state.lastCycleIndex = Math.floor(state.smoothPhase);
    state.lastMoonZenithCycle = Math.floor(state.smoothPhase - MOON_PHASE_CENTER) - 1;
    return state.moonPhase;
  },

  // ── Accessory unlock state (legacy shims) ──────────────────
  //
  // Source of truth for all cosmetic state is the new
  // ownedCosmetics / equippedCosmetics maps — see the shop API
  // block below. These three pairs are back-compat shims so any
  // code still calling isPartyHatActive() etc. keeps working.

  isPartyHatUnlocked() {
    return !!state.ownedCosmetics["party-hat"];
  },
  isThugGlassesUnlocked() {
    return !!state.ownedCosmetics["thug-glasses"];
  },
  isBowTieUnlocked() {
    return !!state.ownedCosmetics["bow-tie"];
  },

  /** Active = owned AND currently equipped in the matching slot. */
  isPartyHatActive() {
    return state.equippedCosmetics.head === "party-hat";
  },
  isThugGlassesActive() {
    return state.equippedCosmetics.eyes === "thug-glasses";
  },
  isBowTieActive() {
    return state.equippedCosmetics.neck === "bow-tie";
  },

  setWearPartyHat(on: boolean) {
    if (!this.isPartyHatUnlocked()) return false;
    if (on) equipCosmetic("party-hat");
    else if (state.equippedCosmetics.head === "party-hat") unequipSlot("head");
    return this.isPartyHatActive();
  },
  setWearThugGlasses(on: boolean) {
    if (!this.isThugGlassesUnlocked()) return false;
    if (on) equipCosmetic("thug-glasses");
    else if (state.equippedCosmetics.eyes === "thug-glasses") unequipSlot("eyes");
    return this.isThugGlassesActive();
  },
  setWearBowTie(on: boolean) {
    if (!this.isBowTieUnlocked()) return false;
    if (on) equipCosmetic("bow-tie");
    else if (state.equippedCosmetics.neck === "bow-tie") unequipSlot("neck");
    return this.isBowTieActive();
  },

  togglePartyHat() {
    return this.setWearPartyHat(!this.isPartyHatActive());
  },
  toggleThugGlasses() {
    return this.setWearThugGlasses(!this.isThugGlassesActive());
  },
  toggleBowTie() {
    return this.setWearBowTie(!this.isBowTieActive());
  },

  // ── Shop + equip API ───────────────────────────────────────
  //
  // Generic path for any cosmetic (classics + shop items). The
  // UI (src/ui.ts) calls these to drive the shop grid and the
  // grouped equip menu.

  /** Current persistent coin balance (buys come out of this). */
  getCoinsBalance() {
    return state.coinsBalance;
  },

  /** Coins picked up during the current run. Resets on resetGame.
   *  Drives the top-left HUD counter and the game-over card's
   *  "this run → total" fill animation. */
  getRunCoins() {
    return state.runCoins;
  },

  /** Fire the "coins pouring into the wallet" audio sequence used
   *  by the game-over card while the balance number tweens up.
   *  Delegates to audio.playCoinFillAnim so the tally's timers +
   *  source handles live in one place — resetGame calls
   *  audio.stopCoinFill() to cut the whole sequence on restart. */
  playCoinFillAnim(count: number, durationMs = 1200): void {
    audio.playCoinFillAnim(count, durationMs);
  },

  /** Every cosmetic ever declared, in registry order. UI pairs
   *  this with ownsCosmetic / isCosmeticEquipped to render
   *  buy / owned / equipped state per row. */
  getAllCosmetics() {
    return COSMETICS;
  },

  /** Shop inventory — the subset of COSMETICS that can be bought
   *  (price > 0, not a score-unlock classic). Fresh array per
   *  call so callers can sort freely. */
  getShopInventory() {
    return shopInventory();
  },

  ownsCosmetic(id: string) {
    return !!state.ownedCosmetics[id];
  },

  /** Which cosmetic id is currently equipped in the given slot,
   *  or null if the slot is empty. */
  getEquippedCosmetic(slot: CosmeticSlot) {
    return state.equippedCosmetics[slot];
  },

  isCosmeticEquipped(id: string) {
    const def = COSMETICS_BY_ID[id];
    if (!def) return false;
    return state.equippedCosmetics[def.slot] === id;
  },

  /** Attempt to purchase. Returns:
   *    "ok"       purchased, balance deducted
   *    "owned"    already in inventory
   *    "poor"     can't afford (skipped when state.debug is on)
   *    "unknown"  bad id
   *
   *  In debug mode the coin cost is waived so testers can grab
   *  every cosmetic without grinding — still goes through the
   *  "unknown" / "owned" checks so the shop UI state stays
   *  honest (a second buy on an already-owned item is still
   *  "owned", not "ok"). */
  buyCosmetic(id: string) {
    if (state.debug) {
      const def = COSMETICS_BY_ID[id];
      if (!def) return "unknown" as const;
      if (state.ownedCosmetics[id]) return "owned" as const;
      grantCosmetic(id);
      track("shop_purchase", { id, debug: true });
      return "ok" as const;
    }
    const result = purchaseCosmetic(id);
    if (result === "ok") track("shop_purchase", { id });
    return result;
  },

  /** Play the shop-purchase chime. Exposed as a Game API method
   *  so ui.ts doesn't have to import audio directly — matches the
   *  "UI talks to the game layer through window.Game only" rule
   *  documented at the top of src/ui.ts. */
  playShopPurchase() {
    audio.playShopPurchase();
  },

  /** Play the achievement-unlock stinger. The unlock flow fires
   *  this directly from unlockAchievement() below, but we expose
   *  it on the API too so tests / scripted toasts can trigger
   *  the cue without having to re-derive the trigger conditions. */
  playAchievement() {
    audio.playAchievement();
  },

  /** Equip a cosmetic the player owns (displacing whatever was
   *  in that slot). No-op if not owned. */
  equipCosmetic(id: string) {
    equipCosmetic(id);
  },

  /** Leave the given slot empty. */
  unequipSlot(slot: CosmeticSlot) {
    unequipSlot(slot);
  },

  getTotalJumps() {
    return state.totalJumps;
  },

  /** Debug: wipe saved career jumps, unlock bits, and wear
   *  preferences so the raptor reverts to its naked state. */
  /** Wipe all persistent progress — jumps, cosmetic unlocks,
   *  career runs, achievements, high score, coin balance, and
   *  shop inventory / equipped slots — back to a fresh-install
   *  state. Debug-only affordance. */
  resetAllProgress() {
    state.totalJumps = 0;
    state.highScore = 0;
    state.careerRuns = 0;
    state.unlockedPartyHat = false;
    state.unlockedThugGlasses = false;
    state.wearPartyHat = false;
    state.wearThugGlasses = false;
    state.unlockedAchievements = {};
    saveTotalJumps(0);
    saveHighScore(0);
    saveCareerRuns(0);
    saveUnlockedAchievements({});
    saveBoolFlag(UNLOCKED_PARTY_HAT_KEY, false);
    saveBoolFlag(UNLOCKED_THUG_GLASSES_KEY, false);
    saveBoolFlag(WEAR_PARTY_HAT_KEY, false);
    saveBoolFlag(WEAR_THUG_GLASSES_KEY, false);
    state.unlockedBowTie = false;
    state.wearBowTie = false;
    saveBoolFlag(UNLOCKED_BOW_TIE_KEY, false);
    saveBoolFlag(WEAR_BOW_TIE_KEY, false);
    state.totalDayCycles = 0;
    saveTotalDayCycles(0);
    state.totalNightsSurvived = 0;
    saveTotalNightsSurvived(0);
    state._rareEventsSeen = {};
    saveRareEventsSeen({});
    // Shop state — wipe the coin balance, every owned cosmetic,
    // and every equipped slot. These maps were added after the
    // original reset was written, so missing them here left a
    // "reset" raptor still wearing a full outfit with a full
    // wallet on the next page load.
    state.coinsBalance = 0;
    state.coinsCollected = 0;
    state.ownedCosmetics = {};
    state.equippedCosmetics = { head: null, eyes: null, neck: null };
    saveCoinsBalance(0);
    saveCoinsCollected(0);
    saveOwnedCosmetics({});
    saveEquippedCosmetics(state.equippedCosmetics);
  },

  /** Remove all event listeners and stop the game loop. Call
   *  when the game is being torn down (e.g. page navigation). */
  destroy() {
    if (_rafId) {
      cancelAnimationFrame(_rafId);
      _rafId = 0;
    }
    window.removeEventListener("resize", onResize);
    window.removeEventListener("orientationchange", onResize);
    window.removeEventListener("keydown", onKeyDown);
    if (canvas) canvas.removeEventListener("pointerdown", onPointerDown);
  },
};
export type GameAPI = typeof GameAPI;
(window as any).Game = GameAPI;

// ══════════════════════════════════════════════════════════════════
// Init
// ══════════════════════════════════════════════════════════════════

function preloadImages() {
  return Promise.all(
    Object.entries(IMAGE_SRCS).map(
      ([key, src]) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            IMAGES[key] = img;
            resolve();
          };
          img.onerror = () => {
            console.warn(`Failed to load ${src}`);
            IMAGES[key] = undefined;
            resolve();
          };
          img.src = src;
        }),
    ),
  );
}

/**
 * Warm the GPU texture cache for every loaded image by drawing it
 * once to a tiny offscreen canvas. Without this, the first
 * in-game drawImage of a sprite that hasn't been used yet (UFO,
 * Santa sleigh, reindeer, tumbleweed, cosmetic overlays) triggers
 * a texture upload stall — a frame hitch big enough to kill the
 * player when a rare event first spawns mid-run.
 *
 * Cacti and the raptor sprite don't need this because they're
 * drawn from frame 1 and warm naturally.
 */
function warmImageTextures() {
  const warm = document.createElement("canvas");
  warm.width = 2;
  warm.height = 2;
  const wctx = warm.getContext("2d");
  if (!wctx) return;
  for (const key of Object.keys(IMAGES)) {
    const img = IMAGES[key];
    if (!img) continue;
    try {
      wctx.drawImage(img, 0, 0, 2, 2);
    } catch {
      /* ignore — warm is best-effort */
    }
  }
}

// ══════════════════════════════════════════════════════════════════
// Cinematic / filming mode (F9)
// ══════════════════════════════════════════════════════════════════

const CINEMATIC_HUD_ID = "cinematic-hud";

function toggleCinematicMode() {
  state.cinematicMode = !state.cinematicMode;
  if (state.cinematicMode) {
    state._preCinematicNoCollisions = state.noCollisions;
    state.noCollisions = true;
    document.body.classList.add("cinematic-mode");
    if (!state.started) {
      GameAPI.start();
    } else if (state.paused) {
      GameAPI.resume();
    }
    ensureCinematicHUD();
    updateCinematicHUD();
  } else {
    state.cinematicPhaseLock = null;
    state.noCollisions = state._preCinematicNoCollisions;
    document.body.classList.remove("cinematic-mode");
    const hud = document.getElementById(CINEMATIC_HUD_ID);
    if (hud) hud.remove();
  }
}

function handleCinematicKey(e: KeyboardEvent): boolean {
  if (e.code === "Digit0" || e.key === "0") {
    state.cinematicPhaseLock = null;
    updateCinematicHUD();
    return true;
  }
  for (const p of CINEMATIC_PHASES) {
    if (e.key === p.key) {
      const baseCycle = Math.floor(state.smoothPhase);
      state.cinematicPhaseLock = baseCycle + p.phase;
      state.smoothPhase = state.cinematicPhaseLock;
      state.lastCycleIndex = baseCycle;
      // Snap sky color instantly (bypass the gradual lerp).
      const frac = state.smoothPhase % 1;
      const bandIndex = Math.floor(frac * SKY_COLORS.length);
      const bandT = frac * SKY_COLORS.length - bandIndex;
      const nextBand = (bandIndex + 1) % SKY_COLORS.length;
      state.currentSky = lerpColor(SKY_COLORS[bandIndex], SKY_COLORS[nextBand], bandT);
      computeSkyGradient();
      updateCinematicHUD();
      return true;
    }
  }
  switch (e.code) {
    case "KeyR":
      GameAPI.toggleRain();
      updateCinematicHUD();
      return true;
    case "KeyL":
      forceCinematicLightning();
      updateCinematicHUD();
      return true;
    case "KeyH":
      state.unlockedPartyHat = true;
      state.wearPartyHat = !state.wearPartyHat;
      updateCinematicHUD();
      return true;
    case "KeyG":
      state.unlockedThugGlasses = true;
      state.wearThugGlasses = !state.wearThugGlasses;
      updateCinematicHUD();
      return true;
    case "KeyB":
      state.unlockedBowTie = true;
      state.wearBowTie = !state.wearBowTie;
      updateCinematicHUD();
      return true;
    case "KeyM":
      state.cinematicShowHUD = !state.cinematicShowHUD;
      updateCinematicHUD();
      return true;
  }
  return false;
}

function forceCinematicLightning() {
  state.lightning.alpha = 0.85;
  state.lightning.nextAt = performance.now() + LIGHTNING_MIN_COOLDOWN_MS;
  const result = _generateBoltPath();
  if (result?.path) (state.lightning as any).bolt = result.path;
}

function ensureCinematicHUD() {
  if (document.getElementById(CINEMATIC_HUD_ID)) return;
  const hud = document.createElement("div");
  hud.id = CINEMATIC_HUD_ID;
  hud.setAttribute("aria-hidden", "true");
  document.body.appendChild(hud);
}

function updateCinematicHUD() {
  const hud = document.getElementById(CINEMATIC_HUD_ID);
  if (!hud) return;
  hud.style.display = state.cinematicShowHUD ? "block" : "none";
  if (!state.cinematicShowHUD) return;
  let phaseLabel = "natural";
  if (state.cinematicPhaseLock !== null) {
    const frac = state.cinematicPhaseLock % 1;
    const nearest = CINEMATIC_PHASES.find((p) => Math.abs(frac - p.phase) < 0.005);
    phaseLabel = nearest ? nearest.label : frac.toFixed(2);
  }
  const cosmetics =
    [
      state.unlockedPartyHat && state.wearPartyHat ? "hat" : null,
      state.unlockedThugGlasses && state.wearThugGlasses ? "glasses" : null,
      state.unlockedBowTie && state.wearBowTie ? "bow" : null,
    ]
      .filter(Boolean)
      .join(" ") || "none";
  hud.innerHTML =
    '<div class="cinematic-hud-title">● CINEMATIC MODE</div>' +
    '<div class="cinematic-hud-row">Time: <b>' +
    phaseLabel +
    "</b></div>" +
    '<div class="cinematic-hud-row">Rain: <b>' +
    (state.isRaining ? "on" : "off") +
    "</b></div>" +
    '<div class="cinematic-hud-row">Cosmetics: <b>' +
    cosmetics +
    "</b></div>" +
    '<div class="cinematic-hud-keys">' +
    "<div><kbd>1-9</kbd> time &nbsp; <kbd>0</kbd> natural</div>" +
    "<div><kbd>R</kbd> rain &nbsp; <kbd>L</kbd> lightning</div>" +
    "<div><kbd>H</kbd> hat &nbsp; <kbd>G</kbd> glasses &nbsp; <kbd>B</kbd> bow</div>" +
    "<div><kbd>M</kbd> hide hud &nbsp; <kbd>F9</kbd> exit</div>" +
    "</div>";
}

// ══════════════════════════════════════════════════════════════════
// Gamepad / controller support
// ══════════════════════════════════════════════════════════════════

const _gamepad = {
  connected: false,
  // 18 slots covers every Standard Mapping index (0-16) plus one
  // vendor-specific extra (17). Padded with false so a smaller
  // reported buttons[] still indexes cleanly.
  prevButtons: new Array(18).fill(false) as boolean[],
  // Analog stick direction state for debounced menu navigation.
  // -1 = held up past threshold, +1 = held down, 0 = at rest
  // (somewhere inside the deadzone → re-arm for the next press).
  stickDir: 0 as -1 | 0 | 1,
};

/**
 * Face-button layout detection.
 *
 * The W3C Gamepad Standard Mapping places the "bottom" face
 * button at index 0 and "right" at 1 — regardless of the
 * label the vendor stamps on the plastic. On Xbox and PS
 * pads, the on-pad label A / Cross (= confirm) sits at the
 * bottom (index 0) and B / Circle (= cancel) sits at the
 * right (index 1). On Nintendo Switch Pro + Joy-Con, those
 * two face labels are swapped: the A button (= confirm) is
 * on the RIGHT (index 1) and B (= cancel) is on the BOTTOM
 * (index 0).
 *
 * Without per-pad detection, a Nintendo player reaching for
 * "A" to confirm presses button 1, which our menu code
 * would interpret as "back / cancel" under the standard
 * layout. Felt like A and B were flipped. They weren't — we
 * just had to swap which index means "confirm" vs "back"
 * based on the pad vendor.
 *
 * Detection uses the Gamepad.id string. The Gamepad API
 * emits e.g.:
 *   "Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)"
 *   "Joy-Con (L) (Vendor: 057e Product: 2006)"
 * Nintendo's USB vendor id is 057e; we also match common
 * readable fragments for browser stacks that strip the vendor
 * numbers.
 *
 * Override via URL query: `?gamepad=nintendo` or
 * `?gamepad=standard` — handy when the heuristic misses a
 * clone or a third-party controller (8BitDo etc.) that
 * follows one layout or the other.
 */
const _gamepadLayoutForce = (() => {
  try {
    const p = new URLSearchParams(window.location.search).get("gamepad");
    if (p === "nintendo" || p === "standard") return p;
  } catch {
    /* no-op */
  }
  return null as "nintendo" | "standard" | null;
})();
function faceLayout(gp: Gamepad): "nintendo" | "standard" {
  if (_gamepadLayoutForce) return _gamepadLayoutForce;
  return /057e|nintendo|joy.?con|switch pro/i.test(gp.id) ? "nintendo" : "standard";
}

/**
 * Prompt-glyph family for the W3C path. The URL override that pins
 * routing pins the display too: forcing the Nintendo layout must
 * flip the displayed letters, or the hint would name buttons the
 * routing ignores. `?gamepad=standard` only pins routing —
 * "standard" spans both Xbox- and PlayStation-labeled pads, so the
 * id heuristic still picks which labels to show.
 */
function w3cPadFamily(gp: Gamepad): PadFamily {
  return _gamepadLayoutForce === "nintendo" ? "nintendo" : familyFromGamepadId(gp.id);
}

/**
 * Per-frame controller intent, decoupled from the input source.
 *
 * pollGamepad() reads EITHER Steam Input snapshots (desktop builds
 * running under Steam, see src/steamInput.ts) OR the W3C Gamepad API,
 * normalizes whichever it read into this record, and dispatches the
 * navigation branches from it. Plain fields are edges (fire once per
 * press); the Held/scroll fields are level-state for continuous
 * scrolling.
 */
type PadIntent = {
  jump: boolean;
  menuToggle: boolean;
  select: boolean;
  /** Cancel including d-pad left — closes sub-overlays, backs out of
   *  menus. The game-over card needs LEFT for navigation, hence the
   *  separate face-only variant below. */
  back: boolean;
  /** Cancel via the face button alone (game-over card). On the Steam
   *  path both variants map to the semantic `back` action — d-pad
   *  left is a separate nav_left action there, so LEFT cannot exit
   *  the card by construction. */
  backFace: boolean;
  /** Focus-navigation edges: d-pad press or analog-stick flick. */
  navUp: boolean;
  navDown: boolean;
  navLeft: boolean;
  navRight: boolean;
  /** D-pad-only edges for the focus walk inside scrollable
   *  sub-overlays, where a stick flick must keep free-scrolling
   *  instead of grabbing the focus ring. */
  stepUp: boolean;
  stepDown: boolean;
  /** D-pad held: per-frame scroll fallback at the focus ring's edge. */
  navUpHeld: boolean;
  navDownHeld: boolean;
  /** Free-scroll levels. On the W3C path: stick held past the scroll
   *  threshold. On the Steam path the stick is bound to the nav
   *  actions in the default configuration, so these engage from held
   *  nav after a repeat delay instead — the mid-ring escape hatch the
   *  raw stick provides on the W3C path (without it, content between
   *  two focusables that never hits the ring edge would be
   *  unreachable there). */
  scrollUp: boolean;
  scrollDown: boolean;
};

// Edge detection for Steam frames. Snapshots carry level state, so
// edges are derived renderer-side against the previous frame —
// exactly the prevButtons pattern of the W3C path.
const _steamPrev: Record<string, boolean> = {};
// Handoff priming, both directions. The first poll after an input-
// source switch only seeds the incoming path's prev-state from the
// current levels and emits nothing — a button held across the
// handoff must neither misfire nor double-fire.
let _steamNeedsPrime = true;
let _w3cNeedsPrime = false;
// The action set the renderer last asked Steam for. A change re-primes
// the Steam edge state: an action absent from the outgoing set reads
// false, so a face button held across a Menus→InGame switch would
// otherwise resurface as a fresh jump edge once the switched set's
// levels arrive.
let _steamDesiredSet: SteamActionSetName | null = null;
// Held-repeat delay for the Steam path's free-scroll intents, in
// polls (~a third of a second at 60 Hz) — past any deliberate single
// step, short enough to sweep long credits sections comfortably.
const STEAM_NAV_SCROLL_HOLD_FRAMES = 20;
let _steamNavUpHeldFrames = 0;
let _steamNavDownHeldFrames = 0;

function pollGamepad() {
  const w = window as unknown as {
    __rrIsMenuOpen?: () => boolean;
    __rrToggleMenu?: () => void;
    __rrCloseMenu?: () => void;
    __rrMenuBack?: () => void;
    __rrMenuFocusNext?: () => void;
    __rrMenuFocusPrev?: () => void;
    __rrMenuSelect?: () => void;
    __rrScoreCardFocusNext?: () => void;
    __rrScoreCardFocusPrev?: () => void;
    __rrScoreCardSelect?: () => void;
    __rrScoreCardFocusInitial?: () => void;
    __rrScoreCardHome?: () => void;
    __rrSubOverlayOpen?: () => boolean;
    __rrActiveScrollable?: () => {
      scrollBy(dx: number, dy: number): void;
    } | null;
    __rrCloseActiveSubOverlay?: () => boolean;
    __rrSubOverlayFocusNext?: () => void;
    __rrSubOverlayFocusPrev?: () => void;
    __rrSubOverlaySelect?: () => void;
    __rrSubOverlayFocusStep?: (dir: 1 | -1) => boolean;
    __rrSubOverlayFocusAtEdge?: (dir: 1 | -1) => boolean;
    __rrSubOverlayFocusEntered?: () => boolean;
    __onStartKey?: () => void;
  };

  let intent: PadIntent;
  let usingSteam = false;

  const sf = getFreshSteamFrame();
  if (sf?.available && sf.controllerCount > 0) {
    // ── Steam Input path ─────────────────────────────────────
    // While fresh frames with a controller exist, the W3C read is
    // SKIPPED entirely: Steam exposes an emulated Xbox pad to
    // Chromium alongside the real device, so consuming both would
    // double-fire every press — and the emulated pad's id ("Xbox 360
    // Controller (XInput STANDARD GAMEPAD)") would poison the
    // id-based family/layout heuristics for, say, a PS5 pad. The
    // moment frames go stale (Steam quit, handles lost, controllers
    // released) the untouched W3C path below resumes.
    usingSteam = true;
    _w3cNeedsPrime = true;
    // Steam's own device type beats the Gamepad.id regex — through
    // the emulated pad every controller would read as xbox.
    applyPadFamilyBodyClass(familyFromSteamInputType(sf.inputType));
    if (_steamNeedsPrime) {
      for (const name of Object.values(STEAM_DIGITAL_ACTIONS)) {
        _steamPrev[name] = sf.digital[name] === true;
      }
      _steamNavUpHeldFrames = 0;
      _steamNavDownHeldFrames = 0;
      // Source-switch primes clear after one seed. Set-switch primes
      // hold until the snapshot is stamped with the requested set:
      // the IPC round trip plus the main-process poll grid means the
      // switched set's levels arrive a frame or two later, and
      // seeding from a pre-switch snapshot would let a held button
      // through as a fresh edge anyway. Unstamped frames (older main
      // process during dev) degrade to the one-frame prime.
      if (
        _steamDesiredSet === null ||
        sf.activeSet === undefined ||
        sf.activeSet === _steamDesiredSet
      ) {
        _steamNeedsPrime = false;
      }
      return;
    }
    const level = (name: string): boolean => sf.digital[name] === true;
    const edge = (name: string): boolean => level(name) && !_steamPrev[name];
    const A = STEAM_DIGITAL_ACTIONS;
    // Repeat counters for the delayed free-scroll fallback (see
    // STEAM_NAV_SCROLL_HOLD_FRAMES).
    _steamNavUpHeldFrames = level(A.navUp) ? _steamNavUpHeldFrames + 1 : 0;
    _steamNavDownHeldFrames = level(A.navDown) ? _steamNavDownHeldFrames + 1 : 0;
    // No layout swap here: with Steam Input, `select` means select
    // and `back` means back — Valve's per-device default configs and
    // the player's own rebinds absorb vendor button layouts.
    intent = {
      jump: edge(A.jump),
      menuToggle: edge(A.menuToggle),
      select: edge(A.select),
      back: edge(A.back),
      backFace: edge(A.back),
      navUp: edge(A.navUp),
      navDown: edge(A.navDown),
      navLeft: edge(A.navLeft),
      navRight: edge(A.navRight),
      stepUp: edge(A.navUp),
      stepDown: edge(A.navDown),
      navUpHeld: level(A.navUp),
      navDownHeld: level(A.navDown),
      scrollUp: _steamNavUpHeldFrames > STEAM_NAV_SCROLL_HOLD_FRAMES,
      scrollDown: _steamNavDownHeldFrames > STEAM_NAV_SCROLL_HOLD_FRAMES,
    };
    // Cursor-hide + prev-state update, mirroring the W3C loop below.
    let anySteamEdge = false;
    for (const name of Object.values(A)) {
      const nowPressed = level(name);
      if (nowPressed && !_steamPrev[name]) anySteamEdge = true;
      _steamPrev[name] = nowPressed;
    }
    if (anySteamEdge) document.body.classList.add("pad-active");
  } else {
    // ── W3C Gamepad path ─────────────────────────────────────
    _steamNeedsPrime = true;
    // Short-circuit when no gamepad is attached. `navigator.getGamepads()`
    // can be surprisingly expensive on some platforms (driver poll) even
    // when no devices are connected. The `gamepadconnected` listener
    // flips _gamepad.connected back to true on attach, so the poll
    // resumes transparently. Saves ~0.1–0.5ms per frame on Windows.
    if (!_gamepad.connected) return;
    let gp: Gamepad | undefined;
    try {
      const pads = navigator.getGamepads();
      for (let i = 0; i < pads.length; i++) {
        if (pads[i]) {
          gp = pads[i]!;
          break;
        }
      }
    } catch (_) {
      return;
    }
    if (!gp) return;

    // Family follows the pad actually being read (first non-null
    // slot), not connect-event order — with two pads attached the
    // prompts must describe the pad that drives input, and this
    // self-heals when the family-source pad disconnects while
    // another remains. Mirrors the per-frame Steam-branch call above.
    applyPadFamilyBodyClass(w3cPadFamily(gp));

    const prev = _gamepad.prevButtons;
    const btns = gp.buttons;
    const axes = gp.axes || [];
    const stickY = axes.length > 1 ? axes[1] : 0;

    if (_w3cNeedsPrime) {
      // Steam Input just went away mid-session — seed prev-state and
      // stick hysteresis from the live pad and emit nothing.
      for (let i = 0; i < prev.length; i++) {
        prev[i] = i < btns.length && (btns[i].value > 0.5 || btns[i].pressed);
      }
      _gamepad.stickDir =
        stickY <= -GAMEPAD_STICK_PRESS_THRESHOLD
          ? -1
          : stickY >= GAMEPAD_STICK_PRESS_THRESHOLD
            ? 1
            : 0;
      _w3cNeedsPrime = false;
      return;
    }

    const justPressed = (idx: number): boolean => {
      if (idx >= btns.length) return false;
      const nowPressed = btns[idx].value > 0.5 || btns[idx].pressed;
      return nowPressed && !prev[idx];
    };
    const anyJustPressed = (indices: readonly number[]): boolean => {
      for (const i of indices) if (justPressed(i)) return true;
      return false;
    };
    // Continuous-state button helper for scrolling — edge-detect
    // is wrong here because we want held buttons to keep scrolling
    // frame after frame.
    const anyPressed = (indices: readonly number[]): boolean => {
      for (const idx of indices) {
        if (idx >= btns.length) continue;
        if (btns[idx].value > 0.5 || btns[idx].pressed) return true;
      }
      return false;
    };

    // ── Analog stick navigation (debounced) ──────────────────
    // axes[1] on Standard Mapping is the left-stick Y axis. -1 is
    // full up, +1 is full down, with a small neutral band around 0.
    // We edge-detect: each time the stick crosses the press
    // threshold we emit exactly ONE navigation event; the stick has
    // to return inside the deadzone before the next event fires.
    // Without hysteresis a stick resting slightly past threshold
    // would rapid-fire through the whole menu.
    let stickPress: -1 | 0 | 1 = 0;
    if (_gamepad.stickDir === 0) {
      if (stickY <= -GAMEPAD_STICK_PRESS_THRESHOLD) {
        _gamepad.stickDir = -1;
        stickPress = -1;
      } else if (stickY >= GAMEPAD_STICK_PRESS_THRESHOLD) {
        _gamepad.stickDir = 1;
        stickPress = 1;
      }
    } else if (Math.abs(stickY) < GAMEPAD_STICK_DEADZONE) {
      _gamepad.stickDir = 0;
    }

    // Per-pad face-button routing. See faceLayout(): Nintendo
    // pads swap the physical A/B positions relative to the
    // Standard Mapping indices. Selecting the arrays per-poll
    // means a player hot-swapping an Xbox pad for a Switch Pro
    // pad mid-session gets the right behaviour immediately —
    // no remount required.
    const layout = faceLayout(gp);
    const selectButtons = layout === "nintendo" ? [1, 2, 3] : [0, 2, 3];
    const backButtons = layout === "nintendo" ? [0, 14] : [1, 14];
    // Face-cancel alone, without d-pad left — the game-over card
    // uses LEFT as a navigation key (wraps to the previous action),
    // so hooking its close to backButtons would make every LEFT
    // press snap the player off the score card.
    const faceCancel = layout === "nintendo" ? [0] : [1];

    intent = {
      jump: anyJustPressed(GAMEPAD_JUMP_BUTTONS),
      menuToggle: anyJustPressed(GAMEPAD_MENU_TOGGLE_BUTTONS),
      select: anyJustPressed(selectButtons),
      back: anyJustPressed(backButtons),
      backFace: anyJustPressed(faceCancel),
      navUp: anyJustPressed(GAMEPAD_MENU_UP_BUTTONS) || stickPress === -1,
      navDown: anyJustPressed(GAMEPAD_MENU_DOWN_BUTTONS) || stickPress === 1,
      navLeft: anyJustPressed(GAMEPAD_MENU_LEFT_BUTTONS),
      navRight: anyJustPressed(GAMEPAD_MENU_RIGHT_BUTTONS),
      stepUp: anyJustPressed(GAMEPAD_MENU_UP_BUTTONS),
      stepDown: anyJustPressed(GAMEPAD_MENU_DOWN_BUTTONS),
      navUpHeld: anyPressed(GAMEPAD_MENU_UP_BUTTONS),
      navDownHeld: anyPressed(GAMEPAD_MENU_DOWN_BUTTONS),
      scrollUp: stickY < -0.3,
      scrollDown: stickY > 0.3,
    };

    // Cursor-hide: any just-pressed pad button flips the body into
    // "pad-active" mode, which CSS uses to hide the mouse cursor. A
    // pointermove listener (wired in init) drops it again the moment
    // the player reaches for the mouse — so both input devices "win"
    // whichever was last used, no unplug needed. gp.buttons is a
    // per-poll snapshot, so updating prev before dispatch is
    // equivalent to updating it after — the intent above already
    // captured this frame's edges.
    for (let i = 0; i < btns.length && i < prev.length; i++) {
      const nowPressed = btns[i].value > 0.5 || btns[i].pressed;
      if (nowPressed && !prev[i]) {
        document.body.classList.add("pad-active");
      }
      prev[i] = nowPressed;
    }
  }

  const subOverlayOpen = !!w.__rrSubOverlayOpen?.();
  const menuOpen = !!w.__rrIsMenuOpen?.();

  if (subOverlayOpen) {
    // ── Sub-overlay (credits / achievements / imprint / about) ─
    // Hybrid navigation. The left stick free-scrolls the overlay's
    // scrollable child (or the iframe inside for imprint / about),
    // continuous while held: 14 px per frame ≈ 840 px/sec = one
    // screen in ~1 second, which lines up with feel-right scroll
    // speed for controller users. The d-pad instead walks the focus
    // ring — credits links and the achievements "View on Steam"
    // button sit INSIDE the scroll container, and a scroll-only
    // d-pad left them mouse/keyboard-only. System buttons and the
    // "cancel" face button close the overlay — the universal "back"
    // affordance on every vendor.
    const scrollable = w.__rrActiveScrollable?.();
    if (scrollable) {
      const scrollPx = 14;
      // D-pad: one focus step per press (edge-detected). At the
      // ring's boundary the d-pad falls back to per-frame scrolling
      // while held — the ring is sparse (achievements has a single
      // in-list button; imprint / about have none at all), so
      // without the fallback a pad-only player could never reach
      // the content between and beyond the focusables. An empty
      // ring reports "at edge" and a missing hook falls through to
      // scrolling, both reproducing the pre-focus-walk behaviour.
      const upScroll = intent.stepUp
        ? !w.__rrSubOverlayFocusStep?.(-1)
        : intent.navUpHeld && (w.__rrSubOverlayFocusAtEdge?.(-1) ?? true);
      const downScroll = intent.stepDown
        ? !w.__rrSubOverlayFocusStep?.(1)
        : intent.navDownHeld && (w.__rrSubOverlayFocusAtEdge?.(1) ?? true);
      // One scrollBy per direction per frame, however many sources
      // agree — stick free-scroll and the d-pad edge fallback must
      // not stack into double speed.
      if (intent.scrollUp || upScroll) scrollable.scrollBy(0, -scrollPx);
      if (intent.scrollDown || downScroll) scrollable.scrollBy(0, scrollPx);
      // Confirm activates the focused link / button, same meaning
      // as in the button-modal branch — but only once the d-pad has
      // actually entered the ring. These overlays open with focus
      // parked on the excluded ✕ close button and the remembered
      // ring index may be stale from another overlay (the shop), so
      // an unentered confirm would click an invisible target —
      // worst case a credits link opening an external page.
      if (intent.select && w.__rrSubOverlayFocusEntered?.()) {
        w.__rrSubOverlaySelect?.();
      }
    } else {
      // No scrollable content → this is a modal dialog (reset-
      // confirm). Wire d-pad in all four directions to button
      // navigation, and the confirm button to click the focused
      // button. The helpers self-heal if the user clicked with a
      // mouse and focus drifted off the overlay — the next
      // gamepad press snaps focus back into the dialog.
      if (intent.navUp || intent.navLeft) {
        w.__rrSubOverlayFocusPrev?.();
      }
      if (intent.navDown || intent.navRight) {
        w.__rrSubOverlayFocusNext?.();
      }
      if (intent.select) {
        w.__rrSubOverlaySelect?.();
      }
    }
    // Close triggers. Universally "back" across vendors:
    //   • Any system / menu button (Start / Back / Select / ±).
    //   • back: the "cancel" face button at the vendor's
    //     A-is-confirm position plus D-pad left (semantic `back`
    //     action on the Steam path).
    if (intent.menuToggle || intent.back) {
      w.__rrCloseActiveSubOverlay?.();
    }
  } else if (menuOpen) {
    // ── In-menu navigation ─────────────────────────────────
    // Select vs back are layout-aware on the W3C path (see
    // faceLayout above): on Nintendo the physical labels A and B
    // are at swapped Standard Mapping indices, so we swap which
    // index we treat as "confirm" vs "cancel". The on-pad label
    // meaning stays stable for the player.
    if (intent.navUp) {
      w.__rrMenuFocusPrev?.();
    }
    if (intent.navDown) {
      w.__rrMenuFocusNext?.();
    }
    if (intent.select) {
      w.__rrMenuSelect?.();
    }
    // Stepwise back: close any open dropdown first, only then
    // the menu itself. Console convention.
    if (intent.back) {
      w.__rrMenuBack?.();
    }
    // System buttons (Start / Options / etc.) dismiss the menu
    // outright regardless of dropdown state — that's the
    // "resume gameplay now" path, not a back-navigation.
    if (intent.menuToggle) {
      w.__rrCloseMenu?.();
    }
  } else if (state.gameOver) {
    // ── Game-over score card navigation ────────────────────
    // Every direction cycles [Revive, Share, Play again]: D-pad
    // left/up = previous, right/down = next, plus the left-stick
    // flick for players who default to analog. Confirm activates
    // the focused button; the old "any face button = restart"
    // shortcut used to skip past the Revive offer, which felt bad
    // on controller.
    const prevNav = intent.navLeft || intent.navUp;
    const nextNav = intent.navRight || intent.navDown;
    if (prevNav) w.__rrScoreCardFocusPrev?.();
    if (nextNav) w.__rrScoreCardFocusNext?.();
    if (intent.select) {
      w.__rrScoreCardSelect?.();
    }
    // Back / cancel to start screen — the face-cancel button only
    // (backFace), never d-pad LEFT, which navigates on this card.
    if (intent.backFace) {
      w.__rrScoreCardHome?.();
    }
    // System buttons still open the main menu from the card.
    if (intent.menuToggle) {
      w.__rrToggleMenu?.();
    }
  } else {
    // ── Gameplay ───────────────────────────────────────────
    if (intent.jump) {
      if (!state.started) {
        w.__onStartKey?.();
      } else {
        if (!raptor.jump()) raptor.bufferJump(performance.now());
      }
    }
    // Any system button opens the menu — including on the start
    // screen, so the player can change settings before kicking
    // off a run. A (jump) and the d-pad start the game; the menu
    // button always does the menu. Accepting all four covers
    // different vendors' idea of "the menu button" — Xbox
    // View/Menu, PS Options/Share, Switch Pro +/−, etc.
    if (intent.menuToggle) {
      w.__rrToggleMenu?.();
    }
  }

  // Steam action sets follow the UI mode. Recomputed every frame so
  // a missed transition self-heals within one poll; cheap because
  // syncSteamActionSet only sends IPC on change. The start screen
  // intentionally stays on InGame — its needs are exactly jump
  // (start a run) and menu_toggle.
  if (usingSteam) {
    const desiredSet =
      subOverlayOpen || menuOpen || state.gameOver
        ? STEAM_ACTION_SETS.menus
        : STEAM_ACTION_SETS.inGame;
    if (desiredSet !== _steamDesiredSet) {
      _steamDesiredSet = desiredSet;
      // Re-prime the edge state across the switch — see
      // _steamDesiredSet for why.
      _steamNeedsPrime = true;
    }
    syncSteamActionSet(desiredSet);
  }
}

/**
 * Pause (by opening the menu — the menu IS pause) when controller
 * input goes away mid-run. Idempotent: !paused implies the menu is
 * closed, so the toggle can only ever open it, and a second call
 * while paused no-ops. Shared by the browser gamepaddisconnected
 * handler and the Steam Input controllers-lost transition.
 */
function autoPauseOnControllerLoss(): void {
  if (state.started && !state.paused && !state.gameOver) {
    (window as unknown as { __rrToggleMenu?: () => void }).__rrToggleMenu?.();
  }
}

async function init() {
  // Debug mode is gated on `import.meta.env.DEV` (true only for
  // `npm run dev` / `dev:web` / `dev:desktop`). Production bundles
  // from `vite build` get DEV=false, which makes the URL query
  // a dead knob — no way for a player on raptor.trebeljahr.com
  // to flip on hitboxes, noCollisions, score-edit, or the debug
  // menu rows by appending `?debug=true`. Rollup/Vite's dead-code
  // elimination also strips the debug branches from the prod
  // bundle, so debug-only helpers don't even ship.
  try {
    // `import.meta.env.DEV` (no optional chain so Vite statically
    // replaces it with the literal boolean at build time — the
    // whole debug block dead-codes out in prod).
    const devBuild = import.meta.env.DEV === true;
    const params = new URLSearchParams(window.location.search);
    state.debug = devBuild && params.get("debug") === "true";
    if (state.debug) {
      document.body.setAttribute("data-debug", "true");
      state.showHitboxes = false;
      state.noCollisions = true;
      perf.enabled = false;
    }
  } catch (_e) {
    /* no-op */
  }

  // Populate the shared contexts bag from src/canvas.ts, then alias
  // the local let-variables so the existing render code (which
  // still references bare `ctx`, `skyCtx`, etc.) keeps working.
  // Once the render code moves into its own modules, these aliases
  // and the outer `let` declarations will be deleted.
  if (!initCanvas("game-canvas")) return;
  canvas = contexts.mainCanvas!;
  ctx = contexts.main!;
  skyCanvas = contexts.skyCanvas!;
  _skyCtx = contexts.sky!;
  fgCanvas = contexts.fgCanvas!;
  fgCtx = contexts.fg!;
  deathCanvas = contexts.deathCanvas!;
  deathCtx = contexts.death!;

  audio.init();
  // Break the audio → state hard dependency: invalidate the
  // Sound-of-Silence streak when the player un-mutes mid-run.
  audio.setUnmuteDuringRunHandler(() => {
    if (state?.started && !state.gameOver) {
      state._runMutedThroughout = false;
    }
  });
  // Register the achievement hook for particles (used by
  // maybeSpawnShootingStar to fire the `first-shooting-star`
  // unlock). unlockAchievement itself still lives in this file.
  setParticlesAchievementHandler((id) => unlockAchievement(id));
  // Cosmetics layer fires first-purchase / fully-equipped /
  // shop-cleaned-out through this same bridge.
  setCosmeticsAchievementHandler((id) => unlockAchievement(id));
  // Wire the rare-events module: achievement callback for
  // "ufo-sighting"/"santa-spotted"/etc, plus the dune-height
  // provider for tumbleweed / UFO abduction / meteor impact
  // positioning. _duneHeight still lives in this file.
  setRareEventsAchievementHandler((id) => unlockAchievement(id));
  setDuneHeightProvider((x, off) => duneHeight(x, off));

  // Load the player's saved mute preference into the audio object's
  // state, without triggering .play() yet (browser autoplay
  // policies require a user gesture). The saved value will be
  // applied for real on the first Start Game click, which IS a
  // user gesture.
  // On Capacitor, copy any key that was evicted from localStorage
  // but still lives in @capacitor/preferences back into localStorage
  // before the sync load block below reads it. No-op on web (resolves
  // immediately). See src/mobile/durable.ts for why this exists.
  await hydratePersistence();

  const savedMuted = audio.loadSavedMuted();
  if (savedMuted != null) {
    audio.muted = savedMuted;
    audio.hasSavedPreference = true;
  }

  // Load the player's saved personal best (if any) so the start
  // screen and game-over overlay can show it.
  state.highScore = loadHighScore();
  // Load the cumulative jump count + the two accessory unlock
  // bits. wearX defaults to true so a newly-unlocked accessory
  // shows up immediately; returning players get whatever they
  // last saved.
  state.totalJumps = loadTotalJumps();
  state.totalNightsSurvived = loadTotalNightsSurvived();
  state.totalDayCycles = loadTotalDayCycles();
  // Derive the initial moon phase from saved cycle count — otherwise
  // a returning player renders at ph=0 (invisible new moon) until the
  // next day-cycle boundary, even if they were mid-cycle last session.
  state.moonPhase = moonPhaseFromCycles(state.totalDayCycles);
  state._rareEventsSeen = loadRareEventsSeen();
  state.careerRuns = loadCareerRuns();
  state.unlockedAchievements = loadUnlockedAchievements();
  // Bidirectional reconcile with Steam. Runs in the background so
  // the game doesn't block on IPC during startup. Remote unlocks
  // discovered here are merged silently into localStorage (no toast
  // flood on first launch). No-op in the browser build.
  reconcileWithSteam(state.unlockedAchievements, (id) => {
    state.unlockedAchievements[id] = true;
    saveUnlockedAchievements(state.unlockedAchievements);
  });
  // `html.has-steam` gates every Steam-specific UI row (View on
  // Steam Store / Friends on Steam / achievements "View on Steam"
  // button). We only add the class when Steam actually initialized
  // — a DRM-free / Steam-unavailable desktop build stays
  // clean instead of dangling dead menu rows. Async because
  // isSteam() round-trips through IPC; the menu refreshes on
  // open so the visibility flip applies without a rerender hack.
  const electron = typeof window !== "undefined" ? window.electronAPI : undefined;
  if (electron && typeof electron.isSteam === "function") {
    electron
      .isSteam()
      .then((ok) => {
        if (ok) document.documentElement.classList.add("has-steam");
      })
      .catch(() => {
        /* no-op — absence of the class is the correct default */
      });
  }
  state.unlockedPartyHat = loadBoolFlag(UNLOCKED_PARTY_HAT_KEY, false);
  state.unlockedThugGlasses = loadBoolFlag(UNLOCKED_THUG_GLASSES_KEY, false);
  state.wearPartyHat = loadBoolFlag(WEAR_PARTY_HAT_KEY, true);
  state.wearThugGlasses = loadBoolFlag(WEAR_THUG_GLASSES_KEY, true);
  state.unlockedBowTie = loadBoolFlag(UNLOCKED_BOW_TIE_KEY, false);
  state.wearBowTie = loadBoolFlag(WEAR_BOW_TIE_KEY, true);
  // Coin economy: balance, owned, equipped. Migration bridges the
  // legacy unlock flags above into the new maps the first time a
  // returning player loads with the shop present — idempotent on
  // subsequent boots.
  state.coinsBalance = loadCoinsBalance();
  state.coinsCollected = loadCoinsCollected();
  state.ownedCosmetics = loadOwnedCosmetics();
  state.equippedCosmetics = loadEquippedCosmetics();
  migrateLegacyCosmetics();

  onResize();
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", onResize);

  await preloadImages();
  // Pre-upload every sprite to the GPU now so the first drawImage
  // of a rare-event sprite doesn't cause a texture-upload hitch
  // mid-run (previously killed the player when the UFO spawned).
  warmImageTextures();

  // Re-init dunes now that images are loaded so background cacti
  // don't "plop in" on the first frame (onResize already called
  // initDunes, but IMAGES were still empty at that point).
  initDunes();

  // Pass the landing-dust and rare-event-roll hooks into the raptor
  // so src/entities/raptor.ts has no dependency on module-local
  // helpers. Both are defined later in this file.
  // Foot-position offsets as fractions of raptor width. Extracted
  // by eyeballing the sprite: two distinct contact points that the
  // feet cycle between during the run.
  const FOOT_LEFT_OFFSET = 0.51;
  const FOOT_RIGHT_OFFSET = 0.73;
  raptor = new Raptor(
    () => {
      // Landing from a jump: both feet plant together, and we want
      // the puff to read as beefier than a single running step.
      spawnDust(raptor.x + raptor.w * FOOT_LEFT_OFFSET, state.ground, 1.3);
      spawnDust(raptor.x + raptor.w * FOOT_RIGHT_OFFSET, state.ground, 1.3);
    },
    () => {
      // First-jump achievement fires here now that score is
      // distance-based (a fresh run crosses 1 m almost immediately,
      // so gating off the score was effectively a no-op). Idempotent
      // — safe to call every jump.
      unlockAchievement("first-jump");
      maybeSpawnRareEvent();
    },
    (foot) => {
      // Per-step dust during the run cycle. Smaller than a landing
      // puff so the screen doesn't fill with motes at terminal
      // velocity (~7 steps/s), but still reads as the feet kicking
      // up a trail.
      const offset = foot === "left" ? FOOT_LEFT_OFFSET : FOOT_RIGHT_OFFSET;
      spawnDust(raptor.x + raptor.w * offset, state.ground, 0.55);
    },
  );
  cactuses = new Cactuses(raptor);
  stars = new Stars();
  computeSkyGradient();

  // Eagerly bake the shooting-star trail sprite BEFORE the
  // first frame so the first star to spawn doesn't pay a
  // canvas / gradient compile cost on the hot path.
  bakeShootingStarSprite();
  if (ctx) warmShootingStarSprite(ctx);
  // Pre-bake meteor head + trail sprites so the first meteor's
  // streak frame doesn't pay a sprite-bake + gradient-compile cost
  // (previously caused the "extinction event" lag spike).
  warmMeteorSprites();

  // Warm ctx.shadowBlur on the live game canvas by drawing a
  // tiny throwaway stroke with shadow on, off-screen. Chromium's
  // Skia pipeline compiles a shader on first use of shadowBlur —
  // previously caused a visible hitch on the very first lightning
  // flash (when drawLightning uses shadowBlur: 15 on the bolt).
  //
  // Same trick for gradients: first createRadialGradient and first
  // multi-stop createLinearGradient also compile shaders on use.
  // Previously caused a hitch on the meteor (extinction event)
  // first spawn, when the streak head glow and trail fill the
  // render with fresh gradients.
  if (ctx) {
    ctx.save();
    ctx.shadowBlur = 15;
    ctx.shadowColor = "rgba(180,200,255,0.8)";
    ctx.strokeStyle = "rgba(255,255,255,1)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-50, -50);
    ctx.lineTo(-40, -40);
    ctx.stroke();
    ctx.restore();

    // Warm radial-gradient shader with the same color-stop profile
    // used by the meteor head glow (white → orange → transparent).
    const rg = ctx.createRadialGradient(-100, -100, 0, -100, -100, 12);
    rg.addColorStop(0, "rgba(255, 255, 220, 1)");
    rg.addColorStop(0.4, "rgba(255, 180, 50, 0.6)");
    rg.addColorStop(1, "rgba(255, 80, 0, 0)");
    ctx.fillStyle = rg;
    ctx.fillRect(-200, -200, 30, 30);

    // Warm multi-stop linear-gradient shader (4 stops — same shape
    // as the meteor trail) and a 2-stop variant covering the
    // common case used elsewhere (sky gradient, lightning bolt).
    const lg4 = ctx.createLinearGradient(-100, -100, -50, -50);
    lg4.addColorStop(0, "rgba(255, 220, 80, 0.8)");
    lg4.addColorStop(0.3, "rgba(255, 120, 20, 0.4)");
    lg4.addColorStop(0.7, "rgba(220, 50, 0, 0.15)");
    lg4.addColorStop(1, "rgba(150, 30, 0, 0)");
    ctx.fillStyle = lg4;
    ctx.fillRect(-200, -200, 30, 30);

    // Warm ctx.filter with the exact string we use for the
    // lightning-struck dune cactus in _drawDuneCacti (brightness
    // + saturate). Skia compiles a filter-chain shader on first
    // use of a specific filter expression; without warming, the
    // first struck cactus paints with a visible hitch right when
    // the lightning flash is still on screen.
    //
    // We need an image to drawImage through the filter. Any
    // already-loaded sprite works — raptor-idle is tiny and
    // guaranteed loaded by this point (see warmImageTextures
    // above).
    const warmImg = IMAGES.raptorIdle || IMAGES.raptorSheet;
    if (warmImg) {
      // Also do the fgCtx in case it has a separate shader cache.
      for (const c of [ctx, fgCtx]) {
        if (!c) continue;
        c.save();
        c.filter = "brightness(0.1) saturate(0)";
        c.globalAlpha = 0.01; // imperceptible paint off-screen
        c.drawImage(warmImg, -500, -500, 4, 4);
        c.restore();
      }
    }

    // Pre-bake the rainbow bitmap. The rainbow cache allocates a
    // full-screen canvas + a 7-stop radial gradient; paying that
    // on the first post-rain frame was producing a visible hitch
    // exactly when the rainbow was supposed to appear. Bake it at
    // init so the first actual use is a cached drawImage.
    ensureRainbowCache();

    // Warm a 3-stop gradient-stroke on a bezier curve — matches
    // the comet tail shape. First strokeStyle-with-gradient on a
    // curved path compiles a Skia shader; without this warm, the
    // first comet spawn drops a frame right as the tail appears.
    ctx.save();
    const cometWarmGrad = ctx.createLinearGradient(-300, -300, -100, -300);
    cometWarmGrad.addColorStop(0, "rgba(200,225,255,0.75)");
    cometWarmGrad.addColorStop(0.35, "rgba(130,180,250,0.3)");
    cometWarmGrad.addColorStop(1, "rgba(70,120,210,0)");
    ctx.strokeStyle = cometWarmGrad;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(-300, -300);
    ctx.bezierCurveTo(-250, -280, -200, -320, -100, -300);
    ctx.stroke();
    ctx.restore();
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("keydown", onKeyDown);

  // Gamepad connection tracking. Tagging <body> lets CSS reveal the
  // in-menu gamepad-button hint (body.gamepad-connected, see
  // legacy.css) — gated further on :not(.cap) so the hint stays
  // hidden on mobile where gamepads are rare and the row would take
  // valuable vertical space in the menu.
  window.addEventListener("gamepadconnected", (e: GamepadEvent) => {
    _gamepad.connected = true;
    document.body.classList.add("gamepad-connected");
    // Prompt-glyph family is applied per-frame by pollGamepad from
    // whichever pad it actually reads (see w3cPadFamily) — deriving
    // it here from the just-connected pad would let a second, idle
    // pad hijack the prompts away from the pad that drives input.
    console.log("Gamepad connected:", e.gamepad.id);
  });
  window.addEventListener("gamepaddisconnected", () => {
    _gamepad.connected = false;
    _gamepad.prevButtons.fill(false);
    document.body.classList.remove("gamepad-connected");
    // A player who unplugs the pad is switching back to mouse/keys
    // — drop the cursor-hide class so the cursor reappears even if
    // the user hasn't touched the mouse yet.
    document.body.classList.remove("pad-active");
    console.log("Gamepad disconnected");
    // If that was the last pad, pause instead of letting the run
    // die unattended — a controller running out of battery mid-run
    // shouldn't cost the player their score, and Steam's
    // full-controller-support criteria expect disconnects to be
    // handled. Another pad may still be attached (the departed one
    // shows up as a null slot), so only act when all are gone.
    let padsRemain = false;
    try {
      padsRemain = navigator.getGamepads().some(Boolean);
    } catch (_) {
      // getGamepads can throw (see pollGamepad); pausing is the
      // safe default when we cannot tell what remains.
    }
    // Family glyphs clear only when the last pad leaves — while
    // another pad remains attached, the poller re-derives the family
    // from the pad it now reads on the next frame.
    if (!padsRemain) applyPadFamilyBodyClass(null);
    if (!padsRemain) autoPauseOnControllerLoss();
  });

  // Steam Input (desktop under Steam only): subscribe to the main-
  // process snapshot stream that pollGamepad() consumes. A no-op in
  // web/mobile builds (no electronAPI) and on Steam-less desktop
  // sessions (no frames ever arrive), where the W3C path runs
  // exactly as before. Controller loss goes through the same guard
  // as gamepaddisconnected: when a Steam-owned controller unplugs,
  // Steam also removes the emulated pad and BOTH notifications fire
  // — the guard's idempotence makes the second one a no-op.
  initSteamInput({ onControllersLost: autoPauseOnControllerLoss });

  // Cursor visibility arbiter: whichever input type fires LAST
  // wins. pollGamepad() adds .pad-active on any button just-press
  // (hides the cursor); this listener drops it on any real mouse
  // movement (shows the cursor again). Touch events don't count —
  // touch taps ARE pointer events but touch screens don't benefit
  // from a visible cursor, and the auto-hide keeps the canvas
  // clean. `passive: true` so scroll performance isn't touched.
  //
  // Idle-hide: after `MOUSE_IDLE_HIDE_MS` without real mouse motion
  // we add `body.mouse-idle` so the cursor fades into the canvas
  // while the player is actively running (one fewer distraction on
  // the scrolling ground). The next pointermove / pointerdown
  // clears it. Touch pointerType never triggers the timer; touch
  // devices don't render a cursor in the first place.
  const MOUSE_IDLE_HIDE_MS = 1500;
  let _mouseIdleTimer: ReturnType<typeof setTimeout> | null = null;
  const armMouseIdle = () => {
    if (_mouseIdleTimer !== null) clearTimeout(_mouseIdleTimer);
    _mouseIdleTimer = setTimeout(() => {
      document.body.classList.add("mouse-idle");
    }, MOUSE_IDLE_HIDE_MS);
  };
  window.addEventListener(
    "pointermove",
    (e) => {
      if (e.pointerType === "mouse") {
        document.body.classList.remove("pad-active");
        document.body.classList.remove("mouse-idle");
        armMouseIdle();
      }
    },
    { passive: true },
  );
  window.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType === "mouse") {
        document.body.classList.remove("mouse-idle");
        armMouseIdle();
      }
    },
    { passive: true },
  );

  // Click-feedback delegate: any interactive UI element the
  // player can activate gets a brief scale wiggle + synthesized
  // tap sound. Listens on document so the feedback fires
  // everywhere the same way — main pause menu, sub-overlays
  // (credits / achievements / imprint / about), the × close
  // buttons on those overlays, the play-again button on the
  // game-over panel, and the "Press Enter / ● to restart" hint.
  //
  // CAPTURE PHASE (third arg) rather than bubble — several button
  // handlers already call e.stopPropagation() to keep the click
  // from reaching the overlay backdrop (which would re-trigger
  // the close action). stopPropagation in a bubble-phase ancestor
  // kills any later bubble-phase listener, so a document-level
  // bubble listener never saw those clicks. Capture phase fires
  // top-down before stopPropagation can take effect.
  //
  // The `.tapped` class runs the CSS animation once (@keyframes
  // menu-item-tap). Remove + reflow + re-add so consecutive
  // activations always retrigger (Chromium won't replay a
  // running animation on a class that just stays present).
  document.addEventListener(
    "click",
    (e) => {
      const target = (e.target as HTMLElement | null)?.closest(
        ".menu-item, .sound-settings-summary, .imprint-close, .play-again-btn, .score-card-hint",
      ) as HTMLElement | null;
      if (!target) return;
      pulseTapFeedback(target);
    },
    { capture: true },
  );

  function pulseTapFeedback(el: HTMLElement): void {
    audio.playMenuTap();
    el.classList.remove("tapped");
    // Force a reflow so the animation restart picks up.
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    void el.offsetWidth;
    el.classList.add("tapped");
    window.setTimeout(() => el.classList.remove("tapped"), 200);
  }

  // Expose a window helper so the game-over reset path (which
  // doesn't fire a DOM click event on the play-again button
  // when the trigger comes from keyboard Enter, Space/Jump, or
  // gamepad A) can still visually pulse the button. Called from
  // maybeResetAfterGameOver.
  (
    window as unknown as {
      __rrPulsePlayAgain?: () => void;
    }
  ).__rrPulsePlayAgain = () => {
    const btn = document.getElementById("play-again-btn");
    if (btn) pulseTapFeedback(btn);
  };

  // Pause the game when the tab/window loses focus. Without this
  // the raptor runs blind in the background, the player comes
  // back, and finds the run already dead to a cactus they never
  // saw. Common practice in platformers: freeze on background,
  // require an explicit user action to resume.
  //
  // Strategy: on hidden, Game.pause() and open the settings menu
  // so the player returns to a visible "paused" affordance instead
  // of a silently-frozen canvas. On visible, do NOTHING — leave
  // the game paused with the menu up. Same pattern the Capacitor
  // native lifecycle uses for mobile background/foreground.
  //
  // visibilitychange covers tab-switch, window minimise, and
  // screen-lock on most platforms; the window-blur fallback
  // catches the case where another window on top has focus but
  // the tab itself is still "visible" (e.g. a docked DevTools
  // getting focus). Both route through the same handler.
  function onFocusLost(): void {
    if (!state.started) return;
    if (state.gameOver) return; // already in a stopped state
    if (state.paused) return; // already paused, don't stomp the menu
    GameAPI.pause();
    const w = window as unknown as {
      __rrIsMenuOpen?: () => boolean;
      __rrToggleMenu?: () => void;
    };
    if (w.__rrIsMenuOpen && !w.__rrIsMenuOpen()) {
      w.__rrToggleMenu?.();
    }
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      onFocusLost();
    } else {
      // Tab became visible again. Browsers sometimes auto-pause
      // <audio> elements while hidden / throttled, and the
      // rampVolume rAF chain stops firing — both can leave music
      // silently paused or stuck at volume 0. ensureLiveSession
      // checks that intent and retries play/ramp if the watchdog
      // flag says music should be on. Also covers the Web Audio
      // ctx in case the browser suspended it for idle reasons.
      if (!state.paused) audio.ensureLiveSession();
    }
  });
  window.addEventListener("blur", onFocusLost);
  // Regaining window focus is a second reliable recovery hook.
  // Same guard as visibilitychange — skip while the game is
  // paused, so un-focusing into the menu and tabbing back doesn't
  // wake SFX that should stay silent until the menu closes.
  window.addEventListener("focus", () => {
    if (!state.paused) audio.ensureLiveSession();
  });

  // Start the rAF loop. The game stays paused (state.paused = true)
  // until Game.start() is called by the Start button click handler.
  _rafId = requestAnimationFrame(loop);

  // Capacitor wire-up. Gated on __IS_CAPACITOR__ so Rollup drops the
  // dynamic import and the entire src/mobile/ tree from the web
  // bundle. The async work is fire-and-forget: a slow lock or a
  // missing plugin must never block the first frame.
  if (__IS_CAPACITOR__) {
    import("./mobile/bridge")
      .then(({ initMobile, hideSplash }) => {
        initMobile({
          onBackButton: () => {
            const w = window as any;
            if (w.__rrIsMenuOpen?.()) {
              w.__rrCloseMenu?.();
              return true;
            }
            w.__rrToggleMenu?.();
            return true;
          },
          // Backgrounded: freeze the game. Audio is already gated on
          // state.paused via the visibilitychange hook; pausing is
          // enough.
          onPause: () => {
            GameAPI.pause();
          },
          // Returning from background: DO NOT auto-resume — leave
          // the game paused and show the menu, so the player isn't
          // killed by a cactus that appeared while they were away.
          onResume: () => {
            GameAPI.pause();
            const w = window as any;
            if (w.__rrIsMenuOpen && !w.__rrIsMenuOpen()) {
              w.__rrToggleMenu?.();
            }
          },
        });
        // Dismiss the native splash now that the rAF loop is running
        // and has rendered at least the first frame. 300ms fade hides
        // any remaining asset-decode jitter.
        hideSplash();
      })
      .catch(() => {
        /* ignore — missing bridge must not break the web game */
      });
  }

  GameAPI._ready = true;
  if (GameAPI._readyCb) {
    const cb = GameAPI._readyCb;
    GameAPI._readyCb = null;
    cb();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
