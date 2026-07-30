/*
 * Raptor Runner — particle effects.
 *
 * Four short-lived particle systems live here:
 *
 *   • Confetti — fires when a cosmetic unlocks (party hat, thug
 *                glasses, bow tie). Each burst spawns ~70 pieces at
 *                the raptor's head with random-direction velocities,
 *                gentle gravity, and tumbling rotation.
 *
 *   • Dust     — fires when the raptor lands after being airborne.
 *                Called from the Raptor entity's `onLand` callback.
 *                Two bursts per landing, one under each foot.
 *
 *   • Ash      — fires when a lightning bolt strikes a dune cactus.
 *                Mix of dark ash chunks and glowing ember particles
 *                that fade to nothing over ~0.4-0.7 seconds.
 *
 *   • Shooting stars — fire periodically across the night sky from
 *                the second day/night cycle onward, using a pre-baked
 *                trail sprite (canvas → ImageBitmap upgrade) so the
 *                first star doesn't stall the frame with lazy
 *                gradient/canvas setup.
 *
 * The `maybeSpawnShootingStar` path is the only one that needs to
 * fire an achievement (`first-shooting-star`), so the module accepts
 * an optional `onAchievementUnlock` setter — main.ts wires it up
 * during init, keeping the module free of bare `unlockAchievement`
 * references.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  COIN_COLLECT_BURST_COUNT,
  COIN_COLLECT_SPARK_LIFE_MAX_SEC,
  COIN_COLLECT_SPARK_LIFE_MIN_SEC,
  COIN_COLLECT_SPARK_SPEED_MAX,
  COIN_COLLECT_SPARK_SPEED_MIN,
  CONFETTI_BURST_COUNT,
  CONFETTI_DRAG,
  CONFETTI_GRAVITY_PX_S2,
  DUST_BURST_MAX,
  DUST_BURST_MIN,
  DUST_GRAVITY_PX_S2,
  SHOOTING_STAR_LIFETIME_MAX_SEC,
  SHOOTING_STAR_LIFETIME_MIN_SEC,
  SHOOTING_STAR_RAIN_THRESHOLD,
  SHOOTING_STAR_SPAWN_RATE,
  SHOOTING_STAR_SPEED_SCALE,
} from "../constants";
import { drawFourPointStar } from "../entities/coins";
import { compactInPlace, randRange } from "../helpers";
import { reduceMotion } from "../reducedMotion";
import { state } from "../state";

// ══════════════════════════════════════════════════════════════════
// Achievement bridge
// ══════════════════════════════════════════════════════════════════

type AchievementCallback = (id: string) => void;

let onAchievementUnlock: AchievementCallback | null = null;

/** Register the achievement-unlock hook. Called once from main.ts's
 *  init so particle spawners can fire the `first-shooting-star`
 *  achievement without importing from the main module. */
export function setParticlesAchievementHandler(cb: AchievementCallback | null): void {
  onAchievementUnlock = cb;
}

// ══════════════════════════════════════════════════════════════════
// Shooting stars (easter egg)
//
// Spawned only from the SECOND night onward. Each shooting star is a
// pre-rendered trail sprite (baked once into an offscreen canvas)
// that we translate + rotate + drawImage per frame — avoids any
// per-frame gradient compile or path building, so the first shooting
// star doesn't stall the frame.
// ══════════════════════════════════════════════════════════════════

export const SHOOTING_STAR_TRAIL_LEN = 140;
export const SHOOTING_STAR_TRAIL_H = 8;

// Baked trail sprite. Populated ONCE at init time (see
// bakeShootingStarSprite below) so the first shooting star doesn't
// trigger any lazy canvas/context/gradient setup on the hot path.
// Prefer an ImageBitmap (GPU-backed, fast drawImage) when available,
// fall back to the canvas element.
let shootingStarSprite: HTMLCanvasElement | ImageBitmap | null = null;

/**
 * Warm-up draw: an invisible (globalAlpha = 0) drawImage pass that
 * primes any lazy GPU upload / texture bind path in the supplied
 * main canvas ctx. Without this, the first real draw on some
 * browsers can still hitch a frame. No-op if the sprite hasn't been
 * baked yet.
 */
export function warmShootingStarSprite(ctx: CanvasRenderingContext2D): void {
  if (!shootingStarSprite) return;
  ctx.save();
  ctx.globalAlpha = 0;
  ctx.drawImage(shootingStarSprite, 0, 0, 1, 1);
  ctx.restore();
}

export function bakeShootingStarSprite(): void {
  const c = document.createElement("canvas");
  // Internal 2× resolution for crisp rendering at any scale.
  const sc = 2;
  c.width = SHOOTING_STAR_TRAIL_LEN * sc;
  c.height = SHOOTING_STAR_TRAIL_H * sc;
  const sctx = c.getContext("2d");
  if (!sctx) return;
  sctx.scale(sc, sc);
  sctx.imageSmoothingEnabled = true;
  // Trail: head at the RIGHT edge, fading toward the LEFT.
  const grad = sctx.createLinearGradient(SHOOTING_STAR_TRAIL_LEN, 0, 0, 0);
  grad.addColorStop(0, "rgba(255, 255, 255, 1)");
  grad.addColorStop(0.25, "rgba(255, 255, 255, 0.75)");
  grad.addColorStop(1, "rgba(255, 255, 255, 0)");
  sctx.strokeStyle = grad;
  sctx.lineCap = "round";
  sctx.lineWidth = 3;
  sctx.beginPath();
  sctx.moveTo(SHOOTING_STAR_TRAIL_LEN - 2, SHOOTING_STAR_TRAIL_H / 2);
  sctx.lineTo(4, SHOOTING_STAR_TRAIL_H / 2);
  sctx.stroke();
  // Bright head dot.
  sctx.fillStyle = "#ffffff";
  sctx.beginPath();
  sctx.arc(SHOOTING_STAR_TRAIL_LEN - 2, SHOOTING_STAR_TRAIL_H / 2, 3, 0, Math.PI * 2);
  sctx.fill();
  // Start with the canvas as the sprite so the game can draw
  // immediately. Upgrade to an ImageBitmap (faster drawImage) as
  // soon as createImageBitmap resolves.
  shootingStarSprite = c;
  if (typeof createImageBitmap === "function") {
    createImageBitmap(c).then(
      (bitmap) => {
        shootingStarSprite = bitmap;
      },
      () => {
        /* keep the canvas fallback */
      },
    );
  }
}

export function maybeSpawnShootingStar(frameScale: number): void {
  // Reduce motion must not change what a player can EARN: skipping
  // spawns entirely would make the "Make A Wish" achievement (fired
  // below on the first star of a run) permanently unobtainable —
  // including for players whose OS sets prefers-reduced-motion
  // without them ever touching the in-game setting. So stars still
  // spawn, but drift instead of streak: a fraction of the normal
  // speed keeps them off the "fast peripheral motion" list the
  // preference exists to avoid, while the run counter and
  // achievement path stay identical.
  const reduced = reduceMotion();
  if (Math.floor(state.smoothPhase) < 1) return;
  if (!state.isNight) return;
  if (state.rainIntensity > SHOOTING_STAR_RAIN_THRESHOLD) return; // no shooting stars in overcast
  // Per-frame spawn chance — averaged roughly one new shooting star
  // per second of real-time night.
  const chance = SHOOTING_STAR_SPAWN_RATE * frameScale;
  if (Math.random() > chance) return;
  const w = state.width;
  const h = state.height;
  // Spawn in the upper-right corner, flying diagonally toward the
  // bottom-left. In canvas coords (y-down) that's angles between 3π/4
  // (straight down-left) and a bit shallower.
  const startX = w * randRange(0.6, 1.08);
  const startY = h * randRange(-0.05, 0.3);
  const speed = Math.max(w, h) * SHOOTING_STAR_SPEED_SCALE * (reduced ? 0.3 : 1);
  const angle = randRange(Math.PI * 0.68, Math.PI * 0.82);
  state.shootingStars.push({
    x: startX,
    y: startY,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    age: 0,
    life: randRange(SHOOTING_STAR_LIFETIME_MIN_SEC, SHOOTING_STAR_LIFETIME_MAX_SEC),
  });
  state.runShootingStars += 1;
  if (state.runShootingStars === 1 && onAchievementUnlock) {
    onAchievementUnlock("first-shooting-star");
  }
}

export function updateShootingStars(dtSec: number): void {
  if (state.shootingStars.length === 0) return;
  // Walk once — update each star, rebuild the array only if
  // something actually expires. Keeps the hot path GC-free in the
  // common case.
  let expired = 0;
  for (const s of state.shootingStars) {
    s.x += s.vx * dtSec;
    s.y += s.vy * dtSec;
    s.age += dtSec;
    if (s.age >= s.life || s.x < -120 || s.y > state.height + 120) {
      s.dead = true;
      expired += 1;
    }
  }
  if (expired > 0) {
    compactInPlace(state.shootingStars, (s: any) => !s.dead);
  }
}

export function drawShootingStars(ctx: CanvasRenderingContext2D): void {
  if (state.shootingStars.length === 0) return;
  const sprite = shootingStarSprite;
  if (!sprite) return;
  for (const s of state.shootingStars) {
    const t = s.age / s.life;
    const alpha = Math.sin(Math.PI * t);
    if (alpha <= 0) continue;
    const angle = Math.atan2(s.vy, s.vx);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(s.x, s.y);
    ctx.rotate(angle);
    // Sprite's RIGHT edge is the head — draw it so that edge lands
    // at the translated origin (the star's world pos).
    ctx.drawImage(
      sprite,
      -SHOOTING_STAR_TRAIL_LEN,
      -SHOOTING_STAR_TRAIL_H / 2,
      SHOOTING_STAR_TRAIL_LEN,
      SHOOTING_STAR_TRAIL_H,
    );
    ctx.restore();
  }
}

// ══════════════════════════════════════════════════════════════════
// Confetti burst
//
// Fires when a cosmetic unlocks. Each burst spawns ~70 pieces at the
// raptor's head with short random-direction velocities, gentle
// gravity, and a tumbling rotation. Particles auto-expire after
// ~1.1–1.9 seconds.
// ══════════════════════════════════════════════════════════════════

const CONFETTI_COLORS = [
  "#ff4d6d",
  "#ffb703",
  "#06d6a0",
  "#118ab2",
  "#8338ec",
  "#ffd60a",
  "#ff7b00",
  "#ef476f",
];

export function spawnConfettiBurst(worldX: number, worldY: number): void {
  // Reduced motion keeps the unlock celebration (it's feedback, not
  // just juice) but damps it hard: a quarter of the pieces at gentler
  // speeds reads as a puff instead of an explosion.
  const reduced = reduceMotion();
  const count = reduced ? Math.round(CONFETTI_BURST_COUNT / 4) : CONFETTI_BURST_COUNT;
  for (let i = 0; i < count; i++) {
    const angle = randRange(-Math.PI, 0); // upward hemisphere
    const speed = reduced ? randRange(120, 280) : randRange(180, 520);
    state.confetti.push({
      x: worldX,
      y: worldY,
      vx: Math.cos(angle) * speed + randRange(-40, 40),
      vy: Math.sin(angle) * speed,
      rot: randRange(0, Math.PI * 2),
      vrot: randRange(-8, 8),
      size: randRange(6, 11),
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      age: 0,
      life: randRange(1.1, 1.9),
    });
  }
}

export function updateConfetti(dtSec: number): void {
  if (state.confetti.length === 0) return;
  let expired = 0;
  for (const p of state.confetti) {
    p.vx *= CONFETTI_DRAG;
    p.vy += CONFETTI_GRAVITY_PX_S2 * dtSec;
    p.x += p.vx * dtSec;
    p.y += p.vy * dtSec;
    p.rot += p.vrot * dtSec;
    p.age += dtSec;
    if (p.age >= p.life || p.y > state.height + 40) {
      p.dead = true;
      expired += 1;
    }
  }
  if (expired > 0) {
    compactInPlace(state.confetti, (p: any) => !p.dead);
  }
}

export function drawConfetti(ctx: CanvasRenderingContext2D): void {
  if (state.confetti.length === 0) return;
  // Perf: a 70-piece burst + any stacked bursts was paying 140+
  // save()/restore() pairs per frame in the old loop, and each
  // save() snapshots every context field (transform, alpha,
  // fillStyle, shadow, composite op, etc.). On lower-end hardware
  // that was the dominant cost of the whole effect at spawn time.
  //
  // The new loop snapshots the base transform once via
  // getTransform() (captures the DPR scale + any parent transform
  // without needing to hardcode DPR here) and composes each
  // particle's translate + rotate into a single setTransform per
  // piece. globalAlpha + fillStyle are tracked inline so we only
  // issue a setter when the value actually changes; confetti are
  // spawned batched by color in random order, so this nets a
  // small but real reduction in state-change traffic too.
  const base = ctx.getTransform();
  const ba = base.a,
    bb = base.b,
    bc = base.c,
    bd = base.d,
    be = base.e,
    bf = base.f;
  let lastAlpha = -1;
  let lastColor = "";
  for (const p of state.confetti) {
    const t = p.age / p.life;
    const alpha = t < 0.85 ? 1 : Math.max(0, 1 - (t - 0.85) / 0.15);
    if (alpha !== lastAlpha) {
      ctx.globalAlpha = alpha;
      lastAlpha = alpha;
    }
    if (p.color !== lastColor) {
      ctx.fillStyle = p.color;
      lastColor = p.color;
    }
    // Inlined 2D-affine multiply:  base * translate(p.x,p.y) * rotate(p.rot).
    // The per-particle matrix (cos, sin, -sin, cos, px, py) lives in
    // canvas-user-space; composing with `base` keeps the DPR scale
    // (ctx.scale(dpr, dpr) applied in the canvas setup path) intact
    // across the setTransform call.
    const cos = Math.cos(p.rot);
    const sin = Math.sin(p.rot);
    ctx.setTransform(
      ba * cos + bc * sin,
      bb * cos + bd * sin,
      ba * -sin + bc * cos,
      bb * -sin + bd * cos,
      ba * p.x + bc * p.y + be,
      bb * p.x + bd * p.y + bf,
    );
    // Rectangular confetti piece, 3:2 aspect (wider than tall).
    const h = (p.size * 2) / 3;
    ctx.fillRect(-p.size / 2, -h / 2, p.size, h);
  }
  // Restore the base transform and default alpha so nothing
  // downstream (post-render overlays, game-over scrim, etc.) inherits
  // the last particle's state.
  ctx.setTransform(ba, bb, bc, bd, be, bf);
  ctx.globalAlpha = 1;
}

// ══════════════════════════════════════════════════════════════════
// Dust particles (landing puff)
// ══════════════════════════════════════════════════════════════════

/**
 * Spawn a puff of dust at (x, y). `scale` is a multiplier applied to
 * the count, per-particle size, and x-jitter width — letting callers
 * dial in a subtle per-footstep puff (scale < 1) versus a fuller
 * two-feet-hit-the-ground landing burst (scale > 1) while sharing one
 * particle template. Speed stays constant so the animation duration
 * feels identical across scales (you just see more / larger motes).
 */
export function spawnDust(x: number, y: number, scale = 1): void {
  const baseCount =
    DUST_BURST_MIN + Math.floor(Math.random() * (DUST_BURST_MAX - DUST_BURST_MIN + 1));
  // Half density under reduced motion — the landing still reads
  // (one or two motes ground the raptor visually) without the
  // constant scatter of full footstep dust.
  const density = reduceMotion() ? 0.5 : 1;
  const count = Math.max(1, Math.round(baseCount * scale * density));
  const jitter = 12 * scale;
  for (let i = 0; i < count; i++) {
    const angle = Math.PI + Math.random() * Math.PI; // upper hemisphere fan
    const speed = 30 + Math.random() * 70;
    state.dust.push({
      x: x + (Math.random() - 0.5) * jitter,
      y,
      vx: Math.cos(angle) * speed,
      vy: -Math.abs(Math.sin(angle)) * speed * 0.5,
      size: (3 + Math.random() * 4) * scale,
      age: 0,
      life: 0.2 + Math.random() * 0.15,
    });
  }
}

export function updateDust(dtSec: number): void {
  if (state.dust.length === 0) return;
  let expired = 0;
  for (const p of state.dust) {
    p.vy += DUST_GRAVITY_PX_S2 * dtSec; // light gravity
    p.vx *= 0.96;
    p.vy *= 0.96;
    p.x += p.vx * dtSec;
    p.y += p.vy * dtSec;
    p.age += dtSec;
    if (p.age >= p.life) {
      p.dead = true;
      expired++;
    }
  }
  if (expired > 0) {
    compactInPlace(state.dust, (p: any) => !p.dead);
  }
}

export function drawDust(ctx: CanvasRenderingContext2D): void {
  if (state.dust.length === 0) return;
  for (const p of state.dust) {
    const t = p.age / p.life;
    const a = 1 - t;
    ctx.fillStyle = `rgba(220, 200, 160, ${a * 0.8})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * (1 - t * 0.3), 0, Math.PI * 2);
    ctx.fill();
  }
}

// ══════════════════════════════════════════════════════════════════
// Ash particles (lightning-struck dune cactus dissolution)
// ══════════════════════════════════════════════════════════════════

export function spawnAsh(screenX: number, screenY: number, w: number, h: number): void {
  const baseCount = 12 + Math.floor(Math.random() * 8);
  // Half density under reduced motion, same reasoning as dust.
  const count = reduceMotion() ? Math.max(1, Math.round(baseCount / 2)) : baseCount;
  for (let i = 0; i < count; i++) {
    state.ash.push({
      x: screenX + (Math.random() - 0.5) * w,
      y: screenY - Math.random() * h,
      vx: 2 + Math.random() * 5,
      vy: -3 + Math.random() * 6,
      size: 0.8 + Math.random() * 1.2,
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 1,
      age: 0,
      life: 0.4 + Math.random() * 0.3,
      ember: Math.random() < 0.25, // 25% glow as embers
    });
  }
}

export function updateAsh(dtSec: number): void {
  if (state.ash.length === 0) return;
  let expired = 0;
  for (const p of state.ash) {
    p.vx *= 0.99;
    p.vy += 15 * dtSec; // light gravity
    p.x += p.vx * dtSec;
    p.y += p.vy * dtSec;
    p.rot += p.vrot * dtSec;
    p.age += dtSec;
    if (p.age >= p.life) {
      p.dead = true;
      expired++;
    }
  }
  if (expired > 0) compactInPlace(state.ash, (p: any) => !p.dead);
}

export function drawAsh(ctx: CanvasRenderingContext2D): void {
  if (state.ash.length === 0) return;
  for (const p of state.ash) {
    const t = p.age / p.life;
    const a = 1 - t;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    if (p.ember) {
      const glow = t < 0.5 ? 1 : 1 - (t - 0.5) * 2; // bright then fade
      ctx.fillStyle = `rgba(${200 + Math.round(55 * glow)}, ${100 + Math.round(80 * glow)}, 20, ${a * 0.9})`;
    } else {
      ctx.fillStyle = `rgba(25, 20, 15, ${a * 0.8})`;
    }
    ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
    ctx.restore();
  }
}

// ══════════════════════════════════════════════════════════════════
// Coin collect sparkles
//
// A short golden-white burst emitted when the raptor grabs a coin.
// Each spark is a 4-point star (same shape as the ambient glint on
// the coin) radiating outward from the pickup center with linear
// velocity, per-frame drag, and no gravity — so the burst "freezes"
// into a soft dust-cloud rather than falling, which reads as magic
// rather than debris. Also paints a single expanding ring flash for
// the first ~120ms so the eye catches the grab even on a busy frame.
// ══════════════════════════════════════════════════════════════════

/** Drag factor per frame (at 60fps) — shared by every spark. Lower
 *  = faster deceleration. 0.90 gives a satisfying quick stop. */
const COIN_SPARK_DRAG_PER_FRAME = 0.9;

export function spawnCoinCollectBurst(x: number, y: number): void {
  // Ring flash: a single non-particle entry with kind="ring" that
  // lives alongside the sparks in the same array. Cheap to render
  // and one-shot per pickup.
  state.coinSparks.push({
    kind: "ring",
    x,
    y,
    age: 0,
    life: 0.13,
    startRadius: 4,
    endRadius: 28,
  });
  // Under reduced motion keep the ring (it's the pickup cue and
  // stays local to the coin) but halve the radiating sparks.
  const sparkCount = reduceMotion()
    ? Math.max(1, Math.round(COIN_COLLECT_BURST_COUNT / 2))
    : COIN_COLLECT_BURST_COUNT;
  for (let i = 0; i < sparkCount; i++) {
    const angle = (i / sparkCount) * Math.PI * 2 + randRange(-0.15, 0.15);
    const speed = randRange(COIN_COLLECT_SPARK_SPEED_MIN, COIN_COLLECT_SPARK_SPEED_MAX);
    state.coinSparks.push({
      kind: "spark",
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: randRange(3, 6),
      age: 0,
      life: randRange(COIN_COLLECT_SPARK_LIFE_MIN_SEC, COIN_COLLECT_SPARK_LIFE_MAX_SEC),
    });
  }
}

export function updateCoinSparks(dtSec: number): void {
  if (state.coinSparks.length === 0) return;
  // Per-frame drag: convert the 60fps constant to whatever dt we got.
  // At 60fps, dtSec ≈ 1/60 and the multiplier equals COIN_SPARK_DRAG_PER_FRAME.
  const dragThisStep = COIN_SPARK_DRAG_PER_FRAME ** (dtSec * 60);
  let expired = 0;
  for (const p of state.coinSparks) {
    p.age += dtSec;
    if (p.kind === "spark") {
      p.x += p.vx * dtSec;
      p.y += p.vy * dtSec;
      p.vx *= dragThisStep;
      p.vy *= dragThisStep;
    }
    if (p.age >= p.life) {
      p.dead = true;
      expired++;
    }
  }
  if (expired > 0) compactInPlace(state.coinSparks, (p: any) => !p.dead);
}

export function drawCoinSparks(ctx: CanvasRenderingContext2D): void {
  if (state.coinSparks.length === 0) return;

  // Snapshot base transform once so drawFourPointStar can compose
  // per-star setTransform calls without wiping the DPR scale.
  // Same pattern as drawCoins / drawConfetti — avoids the
  // save/restore + translate/scale stack that the old loop paid
  // per spark.
  const base = ctx.getTransform();
  const ba = base.a,
    bb = base.b,
    bc = base.c,
    bd = base.d,
    be = base.e,
    bf = base.f;

  let lastAlpha = -1;
  let fillStyleSet = false;

  for (const p of state.coinSparks) {
    const t = p.age / p.life;
    if (p.kind === "ring") {
      // Expanding ring flash: thin gold stroke, fades fast. Rings
      // are one-per-coin-collect (rare enough that the save/restore
      // here isn't in a hot loop) and need different fill/stroke
      // settings anyway, so keep the simple path. Reset the
      // transform to base after in case a prior spark left a
      // star-scaled matrix behind.
      const radius = p.startRadius + (p.endRadius - p.startRadius) * t;
      const alpha = Math.max(0, 1 - t);
      ctx.save();
      ctx.setTransform(ba, bb, bc, bd, be, bf);
      ctx.globalAlpha = alpha * 0.85;
      ctx.strokeStyle = "rgba(255, 230, 140, 1)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      lastAlpha = -1; // save/restore wiped our globalAlpha tracking
      fillStyleSet = false;
      continue;
    }
    // Spark: hold full alpha for ~35% of its life, then fade to zero.
    // Front-loads the brightness so the burst feels like a snap
    // rather than a lingering cloud.
    const alpha = t < 0.35 ? 1 : Math.max(0, 1 - (t - 0.35) / 0.65);
    if (alpha <= 0) continue;
    // Shrink as it fades so the silhouette doesn't pop out.
    const size = p.size * (1 - t * 0.5);
    if (size <= 0) continue;
    if (!fillStyleSet) {
      ctx.fillStyle = "#fff";
      fillStyleSet = true;
    }
    if (alpha !== lastAlpha) {
      ctx.globalAlpha = alpha;
      lastAlpha = alpha;
    }
    drawFourPointStar(ctx, ba, bb, bc, bd, be, bf, p.x, p.y, size);
  }

  // Restore base transform + default alpha so downstream draws
  // aren't affected by the last spark/ring's state.
  ctx.setTransform(ba, bb, bc, bd, be, bf);
  ctx.globalAlpha = 1;
}
