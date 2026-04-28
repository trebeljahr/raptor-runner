/*
 * Raptor Runner — cactus entities.
 *   • Cactus   — single obstacle: sprite, world x/y/w/h, cached
 *                collision polygon.
 *   • Cactuses — spawn manager: scrolls, retires off-screen cacti,
 *                decides the next gap, drops flower-field breathers
 *                and one coin per cactus (sole score source).
 * Score/achievement progression lives in the coin-pickup callback
 * in main.ts, not here.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { CACTUS_VARIANTS, type CactusVariant } from "../cactusVariants";
import {
  CACTUS_BREATHER_INTERVAL_METERS,
  CACTUS_BREATHER_MAX_SECONDS,
  CACTUS_BREATHER_MIN_SECONDS,
  CACTUS_SPAWN_GAP_BASE,
  CACTUS_SPAWN_GAP_RANDOM_MAX,
  CACTUS_SPAWN_GAP_RANDOM_SHRINK,
  CACTUS_SPAWN_GAP_SPEED_FACTOR,
  FLOWER_PATCH_WIDTH_PX,
  INITIAL_BG_VELOCITY,
  MAX_BG_VELOCITY,
  PTERODACTYL_LOW_FLIGHT_CHANCE,
  PTERODACTYL_SPAWN_CHANCE,
  SPEED_INCREMENT,
  VELOCITY_SCALE_DIVISOR,
} from "../constants";
import { compactInPlace, type Polygon } from "../helpers";
import { IMAGES } from "../images";
import { state } from "../state";
import { spawnCoinAboveCactus, spawnCoinsInRange, spawnCoinUnderPterodactyl } from "./coins";
import { makeFlowerPatch } from "./flowers";
import { Pterodactyls } from "./pterodactyl";
import type { Raptor } from "./raptor";

export class Cactus {
  x: number;
  y: number;
  w: number;
  h: number;
  img: HTMLImageElement | undefined;
  aspectRatio: number;
  private _polyCache: Polygon | null = null;
  /** Pre-allocated polygon buffer — same length as variant.collision,
   *  reused on every collisionPolygon() call so we never allocate N
   *  {x,y} objects per frame. The sprite-traced polygons go up to
   *  284 points, so this matters. */
  private _polyBuffer: Polygon;

  constructor(
    public variant: CactusVariant,
    private raptor: Raptor,
  ) {
    this.img = IMAGES[variant.key];
    this.aspectRatio = variant.w / variant.h;
    this.h = raptor.h * variant.heightScale;
    this.w = this.h * this.aspectRatio;
    this.x = state.width;
    this.y = state.ground - this.h;
    this._polyBuffer = variant.collision.map(() => ({ x: 0, y: 0 }));
  }

  /** Rebind h/w and the bottom edge to the new state.ground after a
   *  viewport resize so the cactus doesn't visibly jump. */
  resize(): void {
    this.h = this.raptor.h * this.variant.heightScale;
    this.w = this.h * this.aspectRatio;
    this.y = state.ground - this.h;
    this._polyCache = null;
  }

  update(_frameScale = 1): void {
    // Shared integer dx computed once per frame in main.ts —
    // eliminates inter-entity rounding drift that made back-to-back
    // cacti appear to "dance" as their sub-pixel phases differed.
    this.x -= state._frameScrollDx;
    this._polyCache = null;
  }

  collisionPolygon(): Polygon {
    if (this._polyCache) return this._polyCache;
    const norm = this.variant.collision;
    const x = this.x;
    const y = this.y;
    const w = this.w;
    const h = this.h;
    const buf = this._polyBuffer;
    for (let i = 0; i < norm.length; i++) {
      const p = buf[i];
      p.x = x + norm[i][0] * w;
      p.y = y + norm[i][1] * h;
    }
    this._polyCache = buf;
    return buf;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.img)
      ctx.drawImage(
        this.img,
        Math.round(this.x),
        Math.round(this.y),
        Math.round(this.w),
        Math.round(this.h),
      );
  }
}

export class Cactuses {
  cacti: Cactus[] = [];
  pterodactyls: Pterodactyls;
  /** Distance-from-last-cactus before the next spawn. Set once per
   *  spawn by _rollNextGap() and read (not recomputed) every frame
   *  — the old getter design re-rolled every frame and collapsed
   *  breathers down to normal gaps on the next tick. */
  private _nextGap = 0;
  /** Debug: force the NEXT spawn to be a pterodactyl regardless of
   *  the probability roll. Consumed (and reset) inside spawn(). */
  private _forcePteroNext = false;

  constructor(private raptor: Raptor) {
    this.pterodactyls = new Pterodactyls(raptor);
    this._rollNextGap();
  }

  /** Roll one "normal" gap (floor + random top-up). Factored out
   *  so breathers can tack a normal gap onto their post-field
   *  buffer without duplicating the math. */
  private _rollNormalGap(): number {
    // 0 at a fresh run, 1 at terminal velocity. Clamped for debug
    // speeds beyond MAX.
    const t = Math.min(
      1,
      Math.max(
        0,
        (state.bgVelocity - INITIAL_BG_VELOCITY) / (MAX_BG_VELOCITY - INITIAL_BG_VELOCITY),
      ),
    );
    const floorGap = this.raptor.w * (CACTUS_SPAWN_GAP_BASE + t * CACTUS_SPAWN_GAP_SPEED_FACTOR);
    const randSpan =
      this.raptor.w *
      CACTUS_SPAWN_GAP_RANDOM_MAX *
      Math.max(0, 1 - t * CACTUS_SPAWN_GAP_RANDOM_SHRINK);
    return floorGap + Math.random() * randSpan;
  }

  private _rollNextGap(): void {
    if (state.score >= state._nextBreatherAtScore) {
      // ── BREATHER ──
      // Next flower field fires CACTUS_BREATHER_INTERVAL_METERS after
      // this one. Score-gated (not count-gated) so the cadence stays
      // ~1 per 500 meters regardless of bgVelocity.
      state._nextBreatherAtScore = state.score + CACTUS_BREATHER_INTERVAL_METERS;
      this._queueBreather();
      return;
    }

    // ── NORMAL GAP ──
    this._nextGap = this._rollNormalGap();
  }

  /** Build one breather: push the grass-field span, tile flower
   *  patches, scatter coins, and set _nextGap so the next cactus
   *  only spawns after the full field + symmetric empty buffer has
   *  scrolled past.
   *
   *  Geometry (world-space, last cactus at x=state.width):
   *    state.width + state.width + bufferPx = fieldStartX
   *    fieldStartX + fieldPx                = fieldEndX
   *    fieldEndX + bufferPx                 → next cactus
   */
  private _queueBreather(): void {
    const seconds =
      CACTUS_BREATHER_MIN_SECONDS +
      Math.random() * (CACTUS_BREATHER_MAX_SECONDS - CACTUS_BREATHER_MIN_SECONDS);
    // bgVelocity is a per-frame multiplier; ×60 → approx px/sec.
    const pxPerSec = state.bgVelocity * (state.width / VELOCITY_SCALE_DIVISOR) * 60;
    const fieldPx = seconds * pxPerSec;
    const bufferPx = this._rollNormalGap();

    const fieldStartX = 2 * state.width + bufferPx;
    const fieldEndX = fieldStartX + fieldPx;

    state.grassFields = state.grassFields || [];
    state.grassFields.push({ startX: fieldStartX, endX: fieldEndX });

    // Patches spaced at ≈40% of their width so neighbours overlap
    // by ~60% (carpet, not clusters), jittered ±30% to break tiling.
    state.flowerPatches = state.flowerPatches || [];
    const patchSpacingPx = FLOWER_PATCH_WIDTH_PX * 0.4;
    let x = fieldStartX;
    while (x + FLOWER_PATCH_WIDTH_PX <= fieldEndX) {
      state.flowerPatches.push(makeFlowerPatch(x));
      x += patchSpacingPx * (0.7 + Math.random() * 0.6);
    }

    spawnCoinsInRange(fieldStartX, fieldEndX, this.raptor);

    this._nextGap = fieldEndX + bufferPx;
  }

  /** Debug helper — arm the threshold so the next spawn is a breather. */
  forceBreather(): void {
    state._nextBreatherAtScore = Math.min(state._nextBreatherAtScore, state.score);
    // Force the gap-to-next "already elapsed" so spawn fires next frame.
    this._scrollSinceLastSpawn = Math.max(this._scrollSinceLastSpawn, this._nextGap);
  }

  /** Distance scrolled since the last spawn. Tracked here (instead
   *  of derived from the last cactus' x) so the spawn check survives
   *  a breather that empties the cacti array before the next spawn. */
  private _scrollSinceLastSpawn = 0;
  /** True if the previous spawn was a pterodactyl. We use this to
   *  force at least one cactus between back-to-back flyers so they
   *  don't arrive as a "two-ptero wall" that the player can't clear
   *  without a perfectly-timed double jump they haven't learned yet. */
  private _prevSpawnWasPtero = false;

  spawn(): void {
    // Roll to replace this spawn with a pterodactyl. Always force a
    // cactus (not another flyer) immediately after a pterodactyl so
    // the player gets at least one ground obstacle to reset their
    // rhythm — two pteros back-to-back leaves no space to recover
    // from a misread flap cycle. Exception: the debug force-spawn
    // (_forcePteroNext) still honours the request.
    let pteroRoll = this._forcePteroNext;
    if (!pteroRoll && !this._prevSpawnWasPtero) {
      pteroRoll = Math.random() < PTERODACTYL_SPAWN_CHANCE;
    }
    this._forcePteroNext = false;
    if (pteroRoll) {
      // ~35% of pterodactyls spawn at the LOW (coin-height) flight
      // band instead of the default tall one. Low flyers force a
      // duck-style "stay on the ground and time it" read; the tall
      // ones stay the "jump-over" threat players already know. A
      // coin rides directly beneath the flyer (centred on its x
      // when it reaches the raptor) so the choice to avoid the
      // ptero doubles as a coin-grab opportunity.
      const isLow = Math.random() < PTERODACTYL_LOW_FLIGHT_CHANCE;
      const p = this.pterodactyls.spawn(isLow);
      // One coin below the flyer, positioned at ground-hover height
      // so the raptor collects it by running underneath without
      // jumping. skipped when the flyer itself is low — the body
      // would overlap the coin and turn a pickup into a death.
      if (!isLow) {
        spawnCoinUnderPterodactyl(p.x, p.w, this.raptor);
      }
      this._scrollSinceLastSpawn = 0;
      this._prevSpawnWasPtero = true;
      // Breather cadence is score-gated now — no per-obstacle counter
      // to bump here, the gate in _rollNextGap does the work.
      this._rollNextGap();
      return;
    }
    const variant = CACTUS_VARIANTS[Math.floor(Math.random() * CACTUS_VARIANTS.length)];
    const cactus = new Cactus(variant, this.raptor);
    this.cacti.push(cactus);
    this._prevSpawnWasPtero = false;
    // Under the coins-only scoring model, clearing a cactus no longer
    // grants points directly — the reward is the coin sitting in the
    // jump arc above it. Spawn that coin here, using the cactus's
    // final dimensions so variants and heightScale all line up.
    // heightScale ≥ 0.85 covers the three tall variants (0.9/0.95/1.0);
    // for those the coin lifts twice as far above the cactus so the
    // grab window actually lives at the raptor's peak-of-arc instead
    // of inside the cactus-clearance envelope.
    const isLarge = variant.heightScale >= 0.85;
    spawnCoinAboveCactus(cactus.x, cactus.y, cactus.w, this.raptor, isLarge);
    this._scrollSinceLastSpawn = 0;
    // Decide the gap to the cactus after this one.
    this._rollNextGap();
  }

  /** Debug helper — arm the next spawn to be a pterodactyl and force
   *  the gap "already elapsed" so it fires next frame. Mirrors
   *  forceBreather(). */
  forcePterodactyl(): void {
    this._forcePteroNext = true;
    this._scrollSinceLastSpawn = Math.max(this._scrollSinceLastSpawn, this._nextGap);
  }

  update(now: number, frameScale = 1): void {
    // Accumulate this frame's scroll BEFORE the spawn check. Uses
    // the shared integer dx so the spawn timing stays in lockstep
    // with the visible entity motion — both sides drained from the
    // same residual in main.ts.
    this._scrollSinceLastSpawn += state._frameScrollDx;

    if (this._scrollSinceLastSpawn >= this._nextGap) {
      const isFirstSpawn =
        this.cacti.length === 0 && this.pterodactyls.pteros.length === 0 && this._nextGap === 0;
      this.spawn();
      if (!isFirstSpawn) {
        state.bgVelocity = Math.min(state.bgVelocity + SPEED_INCREMENT, MAX_BG_VELOCITY);
      }
    }

    for (const c of this.cacti) c.update(frameScale);
    this.pterodactyls.update(now, frameScale);

    // Retire cacti once they've fully left the screen. Every retired
    // cactus counts as "cleared" — the collision path sets gameOver
    // before a cactus can reach this filter, so a cactus that makes
    // it here is one the raptor successfully jumped. Score/cosmetic
    // thresholds still fire from the meters-based block in main.ts;
    // this counter only drives the "25 cacti jumped" achievement.
    const before = this.cacti.length;
    compactInPlace(this.cacti, (c) => c.x >= -c.w);
    const retired = before - this.cacti.length;
    if (retired > 0) state.runCactiCleared += retired;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const c of this.cacti) c.draw(ctx);
    // Pterodactyls fly above the cactus line, so drawing them after
    // the cacti can't produce a wrong-order visible overlap — and it
    // keeps the whole obstacle layer in one place for z-order clarity.
    this.pterodactyls.draw(ctx);
  }

  resize(): void {
    for (const c of this.cacti) c.resize();
    this.pterodactyls.resize();
  }

  clear(): void {
    this.cacti = [];
    this.pterodactyls.clear();
    this._scrollSinceLastSpawn = 0;
    this._forcePteroNext = false;
    // Reset the gap too so the first cactus of the next run
    // spawns immediately (matches the pre-fix "!last → spawn"
    // behaviour at run-start, just without the bug where that
    // path also fired mid-breather after the last cactus
    // scrolled off-screen).
    this._nextGap = 0;
  }
}
