/*
 * Raptor Runner — weather particle system.
 *
 * Currently scoped to the rain layer: deterministic per-cycle rain
 * scheduling, multi-depth rain-drop spawning, update + draw.
 *
 * Lightning (bolt generation, flash overlay) and rainbow (post-storm
 * spawn + draw) still live in src/main.ts because they couple back
 * into dune-cactus world-rendering and into the achievements system
 * through `unlockAchievement("rainbow")`. Both will migrate here
 * once the sky/world render code splits out and the achievement
 * unlock function itself moves into src/achievements.ts.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { audio } from "../audio";
import {
  LIGHTNING_BOLT_MAX_SEGMENTS,
  LIGHTNING_BOLT_MIN_SEGMENTS,
  LIGHTNING_FLASH_PROBABILITY,
  LIGHTNING_INTENSITY_THRESHOLD,
  LIGHTNING_MAX_COOLDOWN_MS,
  LIGHTNING_MIN_COOLDOWN_MS,
  RAIN_SPAWN_DENSITY_DIVISOR,
  THUNDER_DELAY_MAX_MS,
  THUNDER_DELAY_MIN_MS,
} from "../constants";
import { hapticThunder } from "../haptic";
import { compactInPlace } from "../helpers";
import { reduceMotion } from "../reducedMotion";
import { duneHeight } from "../render/world";
import { state } from "../state";

/**
 * Deterministic rain check: within each block of 10 cycles, a single
 * "rain slot" is picked via a simple hash so rain lands on exactly
 * one cycle per block. Additionally, every 50th cycle (after 0) is
 * guaranteed rainy — so every 5th block has 2 rainy cycles (the block
 * slot + the 50-multiple override), and every other block has 1.
 * Averaged over 1000 cycles the rain rate is ~12%.
 *
 * The "block" derivation means the pattern is stable across reloads
 * once a given cycle index is reached — no RNG fork, no save-file
 * fiddling to force rain, just predictable weather as a function of
 * the total day-night cycle counter.
 *
 * Verified by src/effects/weather.test.ts.
 */
export function shouldRainForCycle(cycleIndex: number): boolean {
  if (cycleIndex % 50 === 0 && cycleIndex > 0) return true;
  const block = Math.floor(cycleIndex / 10);
  // Simple hash to pick which cycle in the block rains
  const rainSlot = (block * 7 + 3) % 10;
  return cycleIndex % 10 === rainSlot;
}

/**
 * Spawn new rain particles for this frame. Density scales with
 * `frameScale` so the visual rate stays constant regardless of
 * actual frame rate. Each drop picks one of three depth layers
 * (far / mid / near) for parallax: farther drops are shorter,
 * fainter, and fall slower; nearer drops are longer, brighter,
 * and fall faster.
 */
export function spawnRain(frameScale: number): void {
  const count = Math.ceil(
    (state.width / RAIN_SPAWN_DENSITY_DIVISOR) * frameScale * state.rainIntensity,
  );
  for (let i = 0; i < count; i++) {
    const r = Math.random();
    let len: number;
    let vy: number;
    let vx: number;
    let layer: 0 | 1 | 2;
    if (r < 0.3) {
      // Far — small, faint, slow
      len = 5 + Math.random() * 3;
      vy = 400 + Math.random() * 100;
      vx = -40 - Math.random() * 20;
      layer = 0;
    } else if (r < 0.7) {
      // Mid — medium
      len = 10 + Math.random() * 5;
      vy = 600 + Math.random() * 200;
      vx = -60 - Math.random() * 30;
      layer = 1;
    } else {
      // Near — large, bright, fast
      len = 15 + Math.random() * 10;
      vy = 800 + Math.random() * 300;
      vx = -80 - Math.random() * 40;
      layer = 2;
    }
    // Precompute the streak delta. Velocity is constant for the
    // particle's lifetime so there's no reason to run atan2/cos/sin
    // per frame inside drawRain — this kills ~3 transcendental calls
    // per drop per frame at peak density.
    const vmag = Math.sqrt(vx * vx + vy * vy);
    const dx = (vx / vmag) * len;
    const dy = (vy / vmag) * len;
    state.rainParticles.push({
      x: Math.random() * (state.width + 100) - 50,
      y: -10 - Math.random() * 30,
      vx,
      vy,
      len,
      dx,
      dy,
      layer,
    });
  }
}

export function updateRain(dtSec: number): void {
  if (state.rainParticles.length === 0) return;
  let expired = 0;
  for (const p of state.rainParticles) {
    p.x += p.vx * dtSec;
    p.y += p.vy * dtSec;
    if (p.y > state.ground) {
      p.dead = true;
      expired++;
    }
  }
  if (expired > 0) {
    compactInPlace(state.rainParticles, (p: any) => !p.dead);
  }
}

// One strokeStyle + one lineWidth per depth layer. Variation within a
// layer (random opacity jitter per drop) was only ±~10% and cost a
// string rebuild + sync point per particle — swapping it for fixed
// per-layer colors is effectively invisible at 200+ drops but turns
// the draw into 3 strokes instead of N.
const RAIN_LAYER_STYLES = [
  { lw: 0.6, stroke: "rgba(180, 210, 240, 0.13)" }, // far
  { lw: 1.0, stroke: "rgba(180, 210, 240, 0.24)" }, // mid
  { lw: 1.8, stroke: "rgba(180, 210, 240, 0.40)" }, // near
];

export function drawRain(ctx: CanvasRenderingContext2D): void {
  if (state.rainParticles.length === 0) return;
  ctx.save();
  ctx.lineCap = "round";
  const gnd = state.ground;
  // Build one path per layer, stroke each once — moves the per-
  // particle stroke() out of the hot loop.
  for (let li = 0; li < 3; li++) {
    let hasAny = false;
    ctx.lineWidth = RAIN_LAYER_STYLES[li].lw;
    ctx.strokeStyle = RAIN_LAYER_STYLES[li].stroke;
    ctx.beginPath();
    for (const p of state.rainParticles) {
      if ((p as any).layer !== li) continue;
      if (p.y >= gnd) continue;
      let endX = p.x + (p as any).dx;
      let endY = p.y + (p as any).dy;
      if (endY > gnd) {
        const t = (gnd - p.y) / (endY - p.y);
        endX = p.x + (endX - p.x) * t;
        endY = gnd;
      }
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(endX, endY);
      hasAny = true;
    }
    if (hasAny) ctx.stroke();
  }
  ctx.restore();
}

// ══════════════════════════════════════════════════════════════════
// Lightning
// ══════════════════════════════════════════════════════════════════

export function updateLightning(frameScale: number, now: number) {
  if (state.lightning.alpha > 0) {
    state.lightning.alpha = Math.max(0, state.lightning.alpha - 0.015 * frameScale);
  }
  // Random chance for new flash — only at full intensity, not during transitions
  if (
    state.rainIntensity > LIGHTNING_INTENSITY_THRESHOLD &&
    now > state.lightning.nextAt &&
    Math.random() < LIGHTNING_FLASH_PROBABILITY * frameScale
  ) {
    state.lightning.alpha = 0.7 + Math.random() * 0.2;
    state.lightning.nextAt =
      now +
      LIGHTNING_MIN_COOLDOWN_MS +
      Math.random() * (LIGHTNING_MAX_COOLDOWN_MS - LIGHTNING_MIN_COOLDOWN_MS);
    // Generate a jagged bolt path — preferring cacti as targets
    const result = _generateBoltPath();
    state.lightning.bolt = result.path;
    // Bake the jagged bolt + branches (with expensive shadowBlur)
    // to an offscreen canvas exactly once per strike. drawLightning
    // then composites it per frame via drawImage + globalAlpha,
    // turning ~30–45 frames of shadow-blurred strokes into a single
    // image blit.
    _renderBoltToCache(result.path);
    // If the bolt struck a cactus, blacken it
    // Blacken the struck dune cactus (they scroll slowly enough
    // for the visual to read).
    if (result.struckDuneCactus) {
      result.struckDuneCactus.struck = true;
      result.struckDuneCactus.struckAge = 0;
    }
    // Delay thunder after the flash — random 0.1–0.6s simulating
    // varying strike distances (~35–200m away).
    const thunderDelay =
      THUNDER_DELAY_MIN_MS + Math.random() * (THUNDER_DELAY_MAX_MS - THUNDER_DELAY_MIN_MS);
    setTimeout(() => audio.playThunder(), thunderDelay);
    if (!audio.muted) hapticThunder();
    // Gamepad rumble — medium rumble for thunder.
    try {
      const gp = navigator.getGamepads?.()[0];
      if (gp?.vibrationActuator) {
        gp.vibrationActuator.playEffect("dual-rumble", {
          duration: 80,
          weakMagnitude: 0.5,
          strongMagnitude: 0.3,
        });
      }
    } catch (_) {}
  }
}

export function _generateBoltPath() {
  // Always target a visible dune cactus if one exists.
  // biome-ignore lint/suspicious/noImplicitAnyLet: auto-suppressed during biome 2.x bump
  let targetX;
  let struckDuneCactus = null;
  const off = state.duneOffset || 0;
  const visibleDuneCacti = (state.duneCacti || []).filter((dc) => {
    const sx = dc.wx - off;
    return sx > 20 && sx < state.width - 20 && !dc.struck;
  });
  if (visibleDuneCacti.length > 0) {
    const dc = visibleDuneCacti[Math.floor(Math.random() * visibleDuneCacti.length)];
    targetX = dc.wx - off;
    struckDuneCactus = dc;
  } else {
    targetX = state.width * (0.35 + Math.random() * 0.55);
  }
  // If targeting a dune cactus, end at the cactus top; otherwise ground.
  const endY = struckDuneCactus
    ? state.ground - duneHeight(targetX, state.duneOffset) - struckDuneCactus.h * 0.85
    : state.ground;
  const startX = targetX + (Math.random() - 0.5) * state.width * 0.15;
  const segments =
    LIGHTNING_BOLT_MIN_SEGMENTS +
    Math.floor(Math.random() * (LIGHTNING_BOLT_MAX_SEGMENTS - LIGHTNING_BOLT_MIN_SEGMENTS + 1));
  const points: { x: number; y: number; branch?: { x: number; y: number }[] }[] = [
    { x: startX, y: -10 },
  ];
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const isLast = i === segments;
    // Converge toward targetX; final point lands exactly on target
    const baseX = startX + (targetX - startX) * t;
    const jitter = isLast ? 0 : (Math.random() - 0.5) * state.width * 0.08 * (1 - t);
    const x = baseX + jitter;
    const y = isLast ? endY : Math.min(t * endY, endY);
    points.push({ x, y });
    // 35% chance of a branch
    if (i > 2 && i < segments - 1 && Math.random() < 0.35) {
      const branchLen = 2 + Math.floor(Math.random() * 4);
      const branch = [];
      let bx = x,
        by = y;
      const dir = Math.random() < 0.5 ? -1 : 1;
      for (let j = 0; j < branchLen; j++) {
        bx += dir * (15 + Math.random() * 30);
        by += 10 + Math.random() * 25;
        if (by > endY) by = endY; // clamp to ground
        branch.push({ x: bx, y: by });
      }
      points[points.length - 1].branch = branch;
    }
  }
  return { path: points, struckDuneCactus };
}

// Drop shadowBlur from 15 to 10. Blur cost scales ~quadratically with
// radius (each pixel's shadow sums over an (2r+1)² kernel), so 10 vs
// 15 is roughly (10/15)² ≈ 44% of the work per stroke. The visual
// difference at ~0.3s flash duration is imperceptible.
const BOLT_SHADOW_BLUR = 10;

export function _drawBolt(
  ctx: CanvasRenderingContext2D,
  points: any[],
  lineWidth: number,
  alpha: number,
) {
  ctx.save();
  ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = `rgba(180, 200, 255, ${alpha * 0.8})`;
  ctx.shadowBlur = BOLT_SHADOW_BLUR;

  // Main bolt — one stroke, one shadow pass.
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();

  // All branches folded into a SINGLE path with moveTo/lineTo pairs
  // so the shadow pass fires once for the whole branch network
  // instead of once per branch. Previously each branch was its own
  // beginPath + stroke() which triggered a separate shadowBlur
  // computation — a typical 5-branch bolt paid 6 shadow passes per
  // _drawBolt call. Folded into one, the per-call shadow cost
  // drops to 2 regardless of branch count.
  let hasBranches = false;
  ctx.beginPath();
  ctx.lineWidth = lineWidth * 0.5;
  for (const p of points) {
    if (p.branch) {
      hasBranches = true;
      ctx.moveTo(p.x, p.y);
      for (const bp of p.branch) ctx.lineTo(bp.x, bp.y);
    }
  }
  if (hasBranches) ctx.stroke();

  ctx.restore();
}

// Offscreen canvas that caches the rendered bolt so drawLightning
// can composite via drawImage instead of redrawing the shadow-
// blurred strokes every frame. Sized to the bolt's bounding box
// (plus a shadow-radius pad) per strike — much smaller than the
// viewport, so clear + shadowBlur both touch far fewer pixels.
let _boltCache: HTMLCanvasElement | null = null;
let _boltCacheCtx: CanvasRenderingContext2D | null = null;
// dx / dy = where on the MAIN canvas to blit the cache. The cache's
// internal coordinates are shifted by -dx / -dy so the bolt's
// world-space endpoints (which are in state.width-scaled pixels)
// land at the correct offsets inside the cache.
let _boltCacheDx = 0;
let _boltCacheDy = 0;

function _getBoltBBox(points: any[]): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const include = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  for (const p of points) {
    include(p.x, p.y);
    if (p.branch) for (const bp of p.branch) include(bp.x, bp.y);
  }
  // Pad by 2× the shadow-blur radius so the glow has room to fade
  // out within the cache — +line half-width for the thicker strokes.
  const pad = BOLT_SHADOW_BLUR * 2 + 4;
  const x = Math.floor(minX - pad);
  const y = Math.floor(minY - pad);
  const w = Math.ceil(maxX - minX + pad * 2);
  const h = Math.ceil(maxY - minY + pad * 2);
  return { x, y, w, h };
}

/** Bake the main bolt + bright core (with their shadow blur) into
 *  the offscreen cache at full alpha. Cache is sized to the bolt's
 *  bounding box — a typical bolt spans maybe ⅓ the viewport width
 *  and full height, so ~⅓ the clear + shadow work a full-viewport
 *  cache would do. Per-frame fade is handled by drawLightning's
 *  globalAlpha. Called once when a new strike fires. */
function _renderBoltToCache(points: any[]): void {
  if (!points.length) return;
  const bbox = _getBoltBBox(points);
  if (bbox.w <= 0 || bbox.h <= 0) return;
  if (!_boltCache) {
    _boltCache = document.createElement("canvas");
    _boltCacheCtx = _boltCache.getContext("2d");
  }
  if (!_boltCacheCtx) return;
  if (_boltCache.width !== bbox.w || _boltCache.height !== bbox.h) {
    _boltCache.width = bbox.w;
    _boltCache.height = bbox.h;
  }
  _boltCacheDx = bbox.x;
  _boltCacheDy = bbox.y;
  const c = _boltCacheCtx;
  // Resizing a canvas already clears it; clearRect is only needed
  // when we REUSE an existing cache at the same size. Cheap either way.
  c.clearRect(0, 0, bbox.w, bbox.h);
  // Translate so the bolt's world-space coords land inside the
  // bounding-box-sized cache.
  c.save();
  c.translate(-bbox.x, -bbox.y);
  _drawBolt(c, points, 3, 1);
  _drawBolt(c, points, 1.2, 1);
  c.restore();
}

export function drawLightning(ctx: CanvasRenderingContext2D) {
  if (state.lightning.alpha <= 0) return;
  // White flash overlay (dims faster than bolt). Suppressed under
  // reduced motion: the full-screen luminance spike is the
  // photosensitivity concern, while the bolt itself is small, local,
  // and doubles as the storm's gameplay-visible weather cue — so the
  // bolt keeps rendering either way.
  const flashAlpha = reduceMotion() ? 0 : Math.max(0, state.lightning.alpha - 0.3) * 0.5;
  if (flashAlpha > 0) {
    ctx.fillStyle = `rgba(255, 255, 255, ${flashAlpha})`;
    ctx.fillRect(0, 0, state.width, state.height);
  }
  // Blit the pre-baked bolt with the current alpha as a single
  // drawImage call. dx/dy are the bolt's bounding-box origin on the
  // main canvas. Falls back to the live renderer if the cache
  // isn't ready yet (first frame of a strike, or pre-init).
  if (state.lightning.bolt) {
    if (_boltCache) {
      ctx.save();
      ctx.globalAlpha = state.lightning.alpha;
      ctx.drawImage(_boltCache, _boltCacheDx, _boltCacheDy);
      ctx.restore();
    } else {
      _drawBolt(ctx, state.lightning.bolt, 3, state.lightning.alpha);
      _drawBolt(ctx, state.lightning.bolt, 1.2, Math.min(1, state.lightning.alpha * 1.5));
    }
  }
}
