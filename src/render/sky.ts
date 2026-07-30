/*
 * Raptor Runner — sky rendering.
 *
 * Day/night cycle detection, sun/moon arc computation and drawing,
 * sky gradient painting, and the foreground tint factor that applies
 * a sky-color wash over the foreground canvas.
 */

import { contexts } from "../canvas";
import {
  CELESTIAL_ARC_EXTENSION,
  CELESTIAL_ARC_HALF_WIDTH,
  CELESTIAL_ARC_HEIGHT_RATIO,
  MOON_MIN_RADIUS_PX,
  MOON_PHASE_CENTER,
  MOON_RADIUS_SCALE,
  NIGHT_COLOR,
  SKY_COLORS,
  SUN_MIN_RADIUS_PX,
  SUN_PHASE_CENTER,
  SUN_RADIUS_SCALE,
} from "../constants";
import { lerpColor, rgb } from "../helpers";
import { highContrast } from "../highContrast";
import { state } from "../state";

/*
 * Sprite caches for sun + moon halos. createRadialGradient bakes in
 * absolute (cx, cy) coordinates — reusing a gradient at a different
 * screen position is a no-op. The fix is to rasterize the halo once
 * to an offscreen canvas keyed by radius, then drawImage it each
 * frame at the celestial arc position. Radius only changes on
 * window resize, so cache miss is rare.
 */
let _sunHaloSprite: HTMLCanvasElement | null = null;
let _sunHaloRadius = -1;

// Moon halo sprite cache. Baked at illum=1 (the inner/mid gradient
// stops 0.45 and 0.14 go into the canvas unmodulated); drawMoon
// blits it with `globalAlpha *= illum` so the full-moon bloom is
// bright and the new moon is invisible for free, without rebuilding
// the radial gradient every frame. The halo *colour* is a hard-coded
// constant [220, 230, 250] (not time-of-sky like the sun's), so one
// sprite per radius is enough.
let _moonHaloSprite: HTMLCanvasElement | null = null;
let _moonHaloRadius = -1;

function bakeSunHaloSprite(r: number): HTMLCanvasElement {
  const haloR = r * 3;
  const size = Math.ceil(haloR * 2);
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const cx = c.getContext("2d");
  if (!cx) return c;
  const mid = size / 2;
  // Baked at alpha = 1.0; caller multiplies via globalAlpha.
  const g = cx.createRadialGradient(mid, mid, r * 0.5, mid, mid, haloR);
  g.addColorStop(0, "rgba(255, 240, 200, 1)");
  g.addColorStop(0.5, "rgba(255, 230, 180, 0.45)");
  g.addColorStop(1, "rgba(255, 220, 160, 0)");
  cx.fillStyle = g;
  cx.beginPath();
  cx.arc(mid, mid, haloR, 0, Math.PI * 2);
  cx.fill();
  return c;
}

/**
 * Invalidate the sun + moon halo sprite caches. Called on resize so
 * the next frame rebakes at the new radius.
 */
export function invalidateSkyCache(): void {
  _sunHaloSprite = null;
  _sunHaloRadius = -1;
  _moonHaloSprite = null;
  _moonHaloRadius = -1;
  // Force the next computeSkyGradient to rebake — the viewport or
  // sky palette just changed under us.
  _skyCacheR = -1;
  _skyCacheG = -1;
  _skyCacheB = -1;
  _skyCacheW = -1;
  _skyCacheH = -1;
}

/**
 * Bake the moon halo radial gradient into an offscreen canvas sized
 * to the full halo reach (2.6 × moon radius). The gradient stops
 * match the live-draw values at illum=1 — callers modulate with
 * globalAlpha = illum so every phase gets the correct brightness
 * without rebuilding the gradient.
 */
function bakeMoonHaloSprite(r: number): HTMLCanvasElement {
  const haloR = r * 2.6;
  const size = Math.ceil(haloR * 2);
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const cx = c.getContext("2d");
  if (!cx) return c;
  const mid = size / 2;
  const g = cx.createRadialGradient(mid, mid, r * 0.3, mid, mid, haloR);
  g.addColorStop(0, "rgba(220, 230, 250, 0.45)");
  g.addColorStop(0.5, "rgba(220, 230, 250, 0.14)");
  g.addColorStop(1, "rgba(220, 230, 250, 0)");
  cx.fillStyle = g;
  cx.beginPath();
  cx.arc(mid, mid, haloR, 0, Math.PI * 2);
  cx.fill();
  return c;
}

// ── Night detection (derived from SKY_COLORS) ───────────────

export const _isNightBand = SKY_COLORS.map(
  (c) => c[0] === NIGHT_COLOR[0] && c[1] === NIGHT_COLOR[1] && c[2] === NIGHT_COLOR[2],
);

/** The magenta-pink sunset/sunrise bands — `[220, 90, 120]` in the
 *  SKY_COLORS palette. Used to gate the rainbow: once the "red"
 *  transition hits, the rainbow reads as muddy against the warm-pink
 *  backdrop, so we don't spawn new ones then AND we kill any live one
 *  that outlives into the magenta. Golden hour (bands 5 / 15) remains
 *  valid rainbow territory — bright enough to carry the arc. */
export const _isMagentaBand = SKY_COLORS.map((c) => c[0] === 220 && c[1] === 90 && c[2] === 120);

/** True when the current phase is unambiguously rainbow-friendly:
 *  pure day bands or golden hour. Excludes night, blue-hour, and
 *  the magenta sunset/sunrise transition itself — plus the half of
 *  each band that's already heading into magenta. */
export function isRainbowPhase(bandIndex: number, bandT: number): boolean {
  if (_isNightBand[bandIndex] || _isMagentaBand[bandIndex]) return false;
  const n = SKY_COLORS.length;
  const next = (bandIndex + 1) % n;
  // Second half of the band is bleeding into the next one — block
  // rainbow spawns when the next band would cancel it, so we don't
  // briefly show a rainbow that vanishes a frame later.
  if (bandT > 0.5 && (_isNightBand[next] || _isMagentaBand[next])) return false;
  const prev = (bandIndex - 1 + n) % n;
  if (bandT < 0.5 && (_isNightBand[prev] || _isMagentaBand[prev])) return false;
  return true;
}

/** True when bandIndex (+ fractional bandT) is in the dark zone:
 *  solid-night bands, plus the dark half of each adjacent twilight. */
export function isNightPhase(bandIndex: number, bandT: number) {
  if (_isNightBand[bandIndex]) return true;
  const next = (bandIndex + 1) % SKY_COLORS.length;
  if (_isNightBand[next] && bandT > 0.5) return true;
  const prev = (bandIndex - 1 + SKY_COLORS.length) % SKY_COLORS.length;
  if (_isNightBand[prev] && bandT < 0.5) return true;
  return false;
}

// Daytime band indices (for night-survival tracking).
export const _isDayBand = _isNightBand.map((night, i) => {
  if (night) return false;
  const prev = (i - 1 + SKY_COLORS.length) % SKY_COLORS.length;
  const next = (i + 1) % SKY_COLORS.length;
  return !_isNightBand[prev] && !_isNightBand[next];
});

// ── Tint factor ─────────────────────────────────────────────

/** Strength of the foreground sky-light tint. Quadratic ramp so
 *  twilight stays subtle and night reaches ~2/3 of full strength. */
export function tintStrength() {
  const sky = state.currentSky;
  const dayBlue = SKY_COLORS[0];
  const dx = sky[0] - dayBlue[0];
  const dy = sky[1] - dayBlue[1];
  const dz = sky[2] - dayBlue[2];
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const t = Math.min(1, distance / 250);
  const s = 0.05 + t * t * 0.32;
  // The tint blends silhouettes toward the sky colour — exactly the
  // figure/ground separation high-contrast mode exists to protect,
  // and it peaks at night when obstacles are hardest to read. Halve
  // it at the source so every consumer (both source-atop washes and
  // the per-sprite tintFactor) stays consistent.
  return highContrast() ? s * 0.5 : s;
}

/** Per-channel multiply factor that the global tint applies. */
export function tintFactor() {
  const sky = state.currentSky;
  const s = tintStrength();
  return [255 + (sky[0] - 255) * s, 255 + (sky[1] - 255) * s, 255 + (sky[2] - 255) * s];
}

// ── Celestial arc ───────────────────────────────────────────

/**
 * Returns {visible, x, y, t} for a celestial body whose visible arc
 * is centered on cycle `phaseCenter` and lasts half a cycle.
 */
export function celestialArc(phaseCenter: number, halfWidth: number) {
  let rel = (((state.smoothPhase % 1) + 1) % 1) - phaseCenter;
  if (rel > 0.5) rel -= 1;
  if (rel < -0.5) rel += 1;
  const extension = halfWidth * CELESTIAL_ARC_EXTENSION;
  if (rel < -halfWidth - extension || rel > halfWidth + extension) {
    return { visible: false, x: 0, y: 0, t: 0, alpha: 0 };
  }
  const t = (rel + halfWidth) / (halfWidth * 2);
  const x = state.width * (1 - t);
  const arcH = state.height * CELESTIAL_ARC_HEIGHT_RATIO;
  const y = state.ground - 4 * arcH * t * (1 - t);
  return { visible: true, x, y, t, alpha: 1 };
}

// ── Draw sun ────────────────────────────────────────────────

export function drawSun(ctx: CanvasRenderingContext2D) {
  const arc = celestialArc(SUN_PHASE_CENTER, CELESTIAL_ARC_HALF_WIDTH);
  if (!arc.visible) return;
  const r = Math.max(SUN_MIN_RADIUS_PX, state.width * SUN_RADIUS_SCALE);
  const elevation = Math.max(0, 1 - (Math.abs(arc.t - 0.5) * 2) ** 4);
  const cZenith: [number, number, number] = [255, 250, 235];
  const cMid: [number, number, number] = [255, 200, 110];
  const cHorizon: [number, number, number] = [220, 60, 25];
  let core: [number, number, number], _halo: [number, number, number];
  if (elevation > 0.5) {
    const k = (elevation - 0.5) * 2;
    core = lerpColor(cMid, cZenith, k) as [number, number, number];
    _halo = lerpColor(
      [255, 180, 100] as [number, number, number],
      [255, 230, 170] as [number, number, number],
      k,
    ) as [number, number, number];
  } else {
    const k = elevation * 2;
    core = lerpColor(cHorizon, cMid, k) as [number, number, number];
    _halo = lerpColor(
      [225, 70, 30] as [number, number, number],
      [255, 180, 100] as [number, number, number],
      k,
    ) as [number, number, number];
  }

  ctx.save();
  const ri = state.rainIntensity;
  if (ri > 0.05) {
    const haloR = r * 3;
    const ha = 0.18 * ri;
    if (_sunHaloSprite == null || _sunHaloRadius !== r) {
      _sunHaloSprite = bakeSunHaloSprite(r);
      _sunHaloRadius = r;
    }
    // drawImage the baked halo, modulated by per-frame alpha ha.
    ctx.save();
    ctx.globalAlpha = ha;
    ctx.drawImage(_sunHaloSprite, arc.x - haloR, arc.y - haloR, haloR * 2, haloR * 2);
    ctx.restore();
    ctx.globalAlpha = 0.2 + 0.8 * (1 - ri);
    ctx.fillStyle = rgb(core);
    ctx.beginPath();
    ctx.arc(arc.x, arc.y, r, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = rgb(core);
    ctx.beginPath();
    ctx.arc(arc.x, arc.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ── Draw moon ───────────────────────────────────────────────

export function drawMoon(ctx: CanvasRenderingContext2D) {
  const arc = celestialArc(MOON_PHASE_CENTER, CELESTIAL_ARC_HALF_WIDTH);
  if (!arc.visible) return;
  const r = Math.max(MOON_MIN_RADIUS_PX, state.width * MOON_RADIUS_SCALE);
  const core: [number, number, number] = [250, 250, 252];
  // Halo colour [220, 230, 250] is baked into the cached
  // _moonHaloSprite — no local constant needed here.

  const ph = state.moonPhase;
  const illum = (1 - Math.cos(ph * Math.PI * 2)) / 2;
  const waxing = ph < 0.5;
  const gibbous = illum > 0.5;
  const isFull = illum > 0.99;

  ctx.save();
  ctx.globalAlpha = arc.alpha * (0.2 + 0.8 * (1 - state.rainIntensity));

  // Halo — scales with illumination so the new moon has no glow
  // and the full moon blooms. The baked sprite carries the
  // radial-gradient shape and colour at illum=1; we modulate the
  // brightness per frame via globalAlpha so the lunar-cycle bloom
  // doesn't pay a createRadialGradient on every frame.
  if (illum > 0.01) {
    if (_moonHaloSprite == null || _moonHaloRadius !== r) {
      _moonHaloSprite = bakeMoonHaloSprite(r);
      _moonHaloRadius = r;
    }
    const haloR = r * 2.6;
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = prev * illum;
    ctx.drawImage(_moonHaloSprite, arc.x - haloR, arc.y - haloR, haloR * 2, haloR * 2);
    ctx.globalAlpha = prev;
  }

  // Build the lit-region path once. Used both to fill the moon
  // and as the clip region for craters. No full disc + shadow
  // overlay this time: the sky just shows through the shadow side,
  // so a crescent reads as a thin sliver of moon instead of a full
  // disc with a semi-transparent shadow painted over half of it.
  ctx.beginPath();
  if (isFull) {
    ctx.arc(arc.x, arc.y, r, 0, Math.PI * 2);
  } else {
    // Horizontal semi-axis of the terminator ellipse. |cos(ph*2π)|
    // is the correct projection — 0 at quarter phases, r at
    // new/full.
    const termRx = r * Math.abs(Math.cos(ph * Math.PI * 2));
    if (waxing) {
      // Lit side is on the RIGHT. Sweep top → right → bottom, then
      // the terminator ellipse back up to the top.
      ctx.arc(arc.x, arc.y, r, -Math.PI * 0.5, Math.PI * 0.5);
      ctx.ellipse(arc.x, arc.y, termRx, r, 0, Math.PI * 0.5, -Math.PI * 0.5, !gibbous);
    } else {
      // Lit side is on the LEFT.
      ctx.arc(arc.x, arc.y, r, Math.PI * 0.5, Math.PI * 1.5);
      ctx.ellipse(arc.x, arc.y, termRx, r, 0, -Math.PI * 0.5, Math.PI * 0.5, !gibbous);
    }
  }

  // Fill the lit region with the moon's core colour.
  ctx.fillStyle = rgb(core);
  ctx.fill();

  // Craters — clipped to the same lit-region path so they don't
  // bleed over onto the sky.
  ctx.save();
  ctx.clip();
  ctx.fillStyle = `rgba(200, 200, 210, 0.15)`;
  const craters = [
    { dx: -0.25, dy: -0.3, cr: 0.18 },
    { dx: 0.3, dy: 0.15, cr: 0.22 },
    { dx: -0.1, dy: 0.35, cr: 0.14 },
    { dx: 0.15, dy: -0.2, cr: 0.1 },
    { dx: -0.35, dy: 0.1, cr: 0.12 },
    { dx: 0.05, dy: 0.05, cr: 0.08 },
  ];
  for (const c of craters) {
    ctx.beginPath();
    ctx.arc(arc.x + c.dx * r, arc.y + c.dy * r, c.cr * r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.restore();
}

// ── Sky gradient ────────────────────────────────────────────

// Cache key for the current baked sky gradient. If the sky colour
// (rounded to integer RGB, since that's what the fillStyle ends
// up with anyway) and viewport dimensions haven't changed, the
// offscreen canvas already holds the exact fill we'd recompute —
// skip the createLinearGradient + fullscreen fillRect.
//
// This matters because main.ts calls computeSkyGradient() on every
// score change in addition to the 10-frame throttled tick, so a
// 10-coin pickup field triggers ~10 redundant rebuilds in a second
// on top of the ~6 throttled ones. With this cache, the throttled
// tick only pays the gradient cost when currentSky has actually
// drifted since the last compile — every redundant call becomes a
// cheap RGB compare.
let _skyCacheR = -1;
let _skyCacheG = -1;
let _skyCacheB = -1;
let _skyCacheW = -1;
let _skyCacheH = -1;

export function computeSkyGradient() {
  const skyCanvas = contexts.skyCanvas;
  const skyCtx = contexts.sky;
  if (!skyCanvas || !skyCtx) return;
  const w = state.width;
  const h = state.height;
  const sky = state.currentSky;
  const r = Math.round(sky[0]);
  const g = Math.round(sky[1]);
  const b = Math.round(sky[2]);
  if (
    r === _skyCacheR &&
    g === _skyCacheG &&
    b === _skyCacheB &&
    w === _skyCacheW &&
    h === _skyCacheH &&
    skyCanvas.width === w &&
    skyCanvas.height === h
  ) {
    // Cache hit — baked sky already matches state. Skip the
    // createLinearGradient + fullscreen fillRect.
    return;
  }
  if (skyCanvas.width !== w) skyCanvas.width = w;
  if (skyCanvas.height !== h) skyCanvas.height = h;
  const horizonR = Math.round(r + (255 - r) * 0.45);
  const horizonG = Math.round(g + (255 - g) * 0.45);
  const horizonB = Math.round(b + (255 - b) * 0.45);
  const grad = skyCtx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, `rgb(${r}, ${g}, ${b})`);
  grad.addColorStop(1, `rgb(${horizonR}, ${horizonG}, ${horizonB})`);
  skyCtx.fillStyle = grad;
  skyCtx.fillRect(0, 0, w, h);
  _skyCacheR = r;
  _skyCacheG = g;
  _skyCacheB = b;
  _skyCacheW = w;
  _skyCacheH = h;
}
