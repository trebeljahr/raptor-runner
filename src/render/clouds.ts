/*
 * Raptor Runner — cloud system.
 *
 * Four-arc puffball clouds that drift left at DUNE_SCROLL_SPEED,
 * morphing into flat overcast bands as rain intensity rises.
 */

import {
  CLOUD_DENSITY_DIVISOR,
  CLOUD_HEAVY_RAIN_SPACING,
  CLOUD_MIN_COUNT,
  CLOUD_MIN_SPACING_FLOOR_PX,
  CLOUD_MIN_SPACING_RATIO,
  CLOUD_RAIN_MULTIPLIER_MAX,
  VELOCITY_SCALE_DIVISOR,
} from "../constants";
import { randRange } from "../helpers";
import { state } from "../state";

export const CLOUD_BUMPS = [
  { dx: 0, rx: 12.5, ry: 10 },
  { dx: 10, rx: 12.5, ry: 22.5 },
  { dx: 25, rx: 12.5, ry: 17.5 },
  { dx: 40, rx: 15, ry: 10 },
];

export function drawPolygon(ctx: CanvasRenderingContext2D, poly: any[], opts: any) {
  if (!poly || poly.length === 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
  ctx.closePath();
  if (opts.fill) {
    ctx.fillStyle = opts.fill;
    ctx.fill();
  }
  if (opts.stroke) {
    ctx.strokeStyle = opts.stroke;
    ctx.lineWidth = opts.lineWidth || 2;
    ctx.stroke();
  }
  ctx.restore();
}

export function drawCloud(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.fillStyle = "#ffffff";
  for (const b of CLOUD_BUMPS) {
    ctx.beginPath();
    ctx.ellipse(x + b.dx * size, y, b.rx * size, b.ry * size, 0, Math.PI, 0, false);
    ctx.fill();
  }
}

/* Overcast geometry changes only on resize. Alpha belongs to the draw,
 * so storm fades reuse the same gradients at every intensity. */
type OvercastCache = {
  coverH: number;
  mainGrad: CanvasGradient;
  bandGrads: CanvasGradient[];
};
let _overcastCache: OvercastCache | null = null;

const BAND_LAYOUT = [
  { y: 0, h: 0.15, alpha: 0.25 },
  { y: 0.12, h: 0.2, alpha: 0.18 },
  { y: 0.28, h: 0.25, alpha: 0.12 },
  { y: 0.45, h: 0.2, alpha: 0.08 },
];

function buildOvercastGradients(
  ctx: CanvasRenderingContext2D,
  coverH: number,
  a: number,
): OvercastCache {
  const mainGrad = ctx.createLinearGradient(0, 0, 0, coverH);
  mainGrad.addColorStop(0, `rgba(55, 60, 65, ${0.98 * a})`);
  mainGrad.addColorStop(0.1, `rgba(60, 65, 70, ${0.95 * a})`);
  mainGrad.addColorStop(0.25, `rgba(70, 75, 80, ${0.8 * a})`);
  mainGrad.addColorStop(0.45, `rgba(85, 90, 95, ${0.5 * a})`);
  mainGrad.addColorStop(0.7, `rgba(100, 105, 110, ${0.2 * a})`);
  mainGrad.addColorStop(1, `rgba(115, 120, 125, 0)`);

  const bandGrads = BAND_LAYOUT.map((b) => {
    const y = b.y * coverH;
    const h = b.h * coverH;
    const ba = b.alpha * a;
    const grad = ctx.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, `rgba(80, 85, 90, ${ba})`);
    grad.addColorStop(1, `rgba(100, 105, 110, 0)`);
    return grad;
  });

  return {
    coverH,
    mainGrad,
    bandGrads,
  };
}

export function drawOvercastBands(ctx: CanvasRenderingContext2D, intensity: number) {
  if (intensity <= 0) return;
  const w = state.width;
  const coverH = state.height * 0.55;

  if (!_overcastCache || _overcastCache.coverH !== coverH) {
    _overcastCache = buildOvercastGradients(ctx, coverH, 1);
  }

  ctx.save();
  ctx.globalAlpha *= intensity;
  ctx.fillStyle = _overcastCache.mainGrad;
  ctx.fillRect(0, 0, w, coverH);
  for (let i = 0; i < BAND_LAYOUT.length; i++) {
    const b = BAND_LAYOUT[i]!;
    const y = b.y * coverH;
    const h = b.h * coverH;
    ctx.fillStyle = _overcastCache.bandGrads[i]!;
    ctx.fillRect(0, y, w, h);
  }
  ctx.restore();
}

/**
 * Invalidate the overcast gradient cache. Called on window resize so
 * the next frame rebuilds with the new height.
 */
export function invalidateCloudsCache(): void {
  _overcastCache = null;
}

export function drawCloudMorphed(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  ri: number,
) {
  const r = Math.round(255 - ri * 135);
  const g = Math.round(255 - ri * 130);
  const b = Math.round(255 - ri * 125);
  ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
  if (ri < 0.01) {
    for (const bmp of CLOUD_BUMPS) {
      ctx.beginPath();
      ctx.ellipse(x + bmp.dx * size, y, bmp.rx * size, bmp.ry * size, 0, Math.PI, 0, false);
      ctx.fill();
    }
    return;
  }
  for (const bmp of CLOUD_BUMPS) {
    const rx = bmp.rx * (1 + ri * 7) * size;
    const ry = bmp.ry * (1 - ri * 0.7) * size;
    const dx = bmp.dx * (1 - ri * 0.6) * size;
    ctx.beginPath();
    ctx.ellipse(x + dx, y, rx, Math.max(ry, 3 * size), 0, Math.PI, 0, false);
    ctx.fill();
  }
  if (ri > 0.3) {
    const bandAlpha = (ri - 0.3) * 0.5;
    ctx.fillStyle = `rgba(${r - 10}, ${g - 10}, ${b - 10}, ${bandAlpha})`;
    const bandW = 100 * size * ri;
    const bandH = 6 * size;
    ctx.beginPath();
    ctx.ellipse(x, y - bandH * 0.3, bandW, bandH, 0, Math.PI, 0, false);
    ctx.fill();
  }
}

export function cloudVisualWidth(size: number, scale: number) {
  const base = state.rainIntensity > 0.3 ? 240 : 70;
  return base * size * scale;
}

export function targetCloudCount() {
  const base = Math.max(CLOUD_MIN_COUNT, Math.round(state.width / CLOUD_DENSITY_DIVISOR));
  const density = state._cloudDensity || 1;
  const rainMult = 1 + state.rainIntensity * CLOUD_RAIN_MULTIPLIER_MAX;
  return Math.round(base * Math.max(density, rainMult));
}

export function minCloudSpacing() {
  const base = Math.max(CLOUD_MIN_SPACING_FLOOR_PX, state.width * CLOUD_MIN_SPACING_RATIO);
  return state.rainIntensity > CLOUD_HEAVY_RAIN_SPACING ? base * CLOUD_HEAVY_RAIN_SPACING : base;
}

export function makeCloudObject(xAbsolute: number) {
  const yMin = 40;
  const yMax = Math.max(180, state.ground * 0.55);
  const size = randRange(0.55, 1.2) * (state.width / VELOCITY_SCALE_DIVISOR);
  const scale = 2;
  return { x: xAbsolute, y: yMin + Math.random() * (yMax - yMin), size, scale };
}

export function trySpawnCloud() {
  const candidate = makeCloudObject(0);
  const visualWidth = cloudVisualWidth(candidate.size, candidate.scale);
  let rightmost = Number.NEGATIVE_INFINITY;
  for (const c of state.clouds) {
    if (c.x > rightmost) rightmost = c.x;
  }
  const spawnX = state.width + visualWidth * 0.5;
  if (rightmost > Number.NEGATIVE_INFINITY && spawnX - rightmost < minCloudSpacing()) return false;
  candidate.x = spawnX;
  state.clouds.push(candidate);
  return true;
}

export function seedClouds() {
  state.clouds = [];
  const count = targetCloudCount();
  const gap = state.width / count;
  for (let i = 0; i < count; i++) {
    const baseX = gap * (i + 0.5);
    const jitter = (Math.random() - 0.5) * gap * 0.4;
    const cloud = makeCloudObject(baseX + jitter);
    state.clouds.push(cloud);
  }
}
