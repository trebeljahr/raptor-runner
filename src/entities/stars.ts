/*
 * Raptor Runner — star field + Milky Way entity.
 *
 * The night sky is a "dome" rotated around a pivot point far above
 * the visible viewport. Star positions are generated once across an
 * area wider/taller than the viewport so that as the dome rotates,
 * stars enter from one edge and exit the other without empty patches
 * appearing at the corners.
 *
 * The Milky Way is a denser band of small stars + a few soft haze
 * "puffs" drawn along a tilted line. It lives in the same rotated
 * frame so it drifts in/out with the rest of the sky.
 *
 * This module is a clean leaf: it reads from `state` but never writes
 * to it, takes its drawing context as a parameter (`draw(ctx)`), and
 * has no dependency on the rest of the game loop. Update pace is
 * driven by `isNight` (fades the opacity in/out) and `frameScale`.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  MILKY_WAY_LENGTH_SCALE,
  MILKY_WAY_STAR_COUNT,
  MILKY_WAY_THICKNESS_RATIO,
  MILKY_WAY_TILT,
  STAR_AREA_PER_STAR_PX2,
  STAR_BRIGHT_PROBABILITY,
  STAR_MIN_COUNT,
  STAR_PIVOT_HEIGHT_RATIO,
  STAR_TWINKLE_PROBABILITY,
} from "../constants";
import { type RgbTuple, randRange, rgba } from "../helpers";
import { state } from "../state";

interface FieldStar {
  x: number;
  y: number;
  size: number;
  brightness: number;
  twinklePhase: number;
  twinkleRate: number;
  twinkleDepth: number;
  color: number[];
  flash: boolean;
}

interface MilkyWayStar {
  x: number;
  y: number;
  size: number;
  brightness: number;
}

interface MilkyWayHazePuff {
  x: number;
  y: number;
  radius: number;
  brightness: number;
}

export class Stars {
  opacity = 0;
  field: FieldStar[] = [];
  milkyWay: MilkyWayStar[] = [];
  mwHazePuffs: MilkyWayHazePuff[] = [];
  mwTilt = 0;
  mwCenterX = 0;
  mwCenterY = 0;
  mwLength = 0;
  mwThickness = 0;

  constructor() {
    // Generate stars over an area much larger than the viewport so
    // the rotation transform never sweeps the visible area empty.
    // The rotation pivot sits 1.5 screen-heights above the viewport,
    // so even small rotation angles move stars along long arcs —
    // the field needs to extend far enough in every direction to
    // cover where stars rotate in from.
    const w = state.width;
    const h = state.height;
    const padX = w * 1.2;
    const padY = h * 1.2;
    const fieldW = w + padX * 2;
    const fieldH = h * 0.8 + padY * 2;
    // Density: roughly one star per 8000 px² of star-field area —
    // lower density than before because the field is much larger and
    // we don't want to overwhelm the sky with pinpricks.
    const count = Math.max(STAR_MIN_COUNT, Math.floor((fieldW * fieldH) / STAR_AREA_PER_STAR_PX2));
    for (let i = 0; i < count; i++) {
      // ~15% of stars are "bright" — noticeably bigger and at full
      // brightness. The rest are background dimmer pinpricks.
      const bright = Math.random() < STAR_BRIGHT_PROBABILITY;
      // ~65% of stars twinkle. Dimmer ones twinkle more so the
      // pulsing reads against the dark sky.
      const twinkles = Math.random() < STAR_TWINKLE_PROBABILITY;
      // Color variation: 85% white, 10% warm, 5% cool
      const colorRoll = Math.random();
      const color =
        colorRoll < 0.85 ? [255, 255, 255] : colorRoll < 0.95 ? [255, 240, 220] : [220, 230, 255];
      // ~5% of twinkling stars get sharp "flash" spikes
      const flash = twinkles && Math.random() < 0.05;
      this.field.push({
        x: -padX + Math.random() * fieldW,
        y: -padY + Math.random() * fieldH,
        size: bright ? randRange(4, 6.5) : randRange(1.6, 3.5),
        brightness: bright ? randRange(0.92, 1.0) : randRange(0.45, 0.85),
        twinklePhase: Math.random() * Math.PI * 2,
        twinkleRate: twinkles ? randRange(0.02, 0.06) : 0,
        twinkleDepth: twinkles ? randRange(0.3, 0.7) : 0,
        color,
        flash,
      });
    }

    // Milky Way: a tilted band of small stars + a few soft "puffs"
    // of haze along the band. Stars are distributed with a Gaussian
    // density across the band so the edges fade naturally rather
    // than ending in a hard rectangle.
    this.mwTilt = MILKY_WAY_TILT;
    this.mwCenterX = w * 0.55;
    this.mwCenterY = h * 0.28;
    this.mwLength = Math.max(w, h) * MILKY_WAY_LENGTH_SCALE;
    this.mwThickness = h * MILKY_WAY_THICKNESS_RATIO;
    const mwCos = Math.cos(this.mwTilt);
    const mwSin = Math.sin(this.mwTilt);
    const mwStarCount = MILKY_WAY_STAR_COUNT;
    for (let i = 0; i < mwStarCount; i++) {
      const along = (Math.random() - 0.5) * this.mwLength;
      // Box-Muller-ish: average two uniforms for a roughly Gaussian
      // distribution across the band's thickness, so star density
      // peaks in the middle and tapers smoothly to nothing at the
      // edges. Squared bias toward the center.
      const u = (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
      const across = u * (this.mwThickness * 0.5);
      // Long-axis intensity also tapers off toward the band ends.
      const endFade = 1 - (Math.abs(along) / (this.mwLength / 2)) ** 2;
      if (endFade < 0.05) continue;
      const x = this.mwCenterX + along * mwCos - across * mwSin;
      const y = this.mwCenterY + along * mwSin + across * mwCos;
      this.milkyWay.push({
        x,
        y,
        size: randRange(0.5, 1.6),
        brightness: randRange(0.35, 0.8) * endFade,
      });
    }

    // A few soft haze "puffs" placed along the band — drawn as
    // radial gradients in draw(). Position them at evenly spaced
    // points along the centerline with small random jitter so the
    // glow looks irregular instead of beaded.
    const puffCount = 7;
    for (let i = 0; i < puffCount; i++) {
      const t = (i + 0.5) / puffCount - 0.5;
      const along = t * this.mwLength * 0.95 + (Math.random() - 0.5) * this.mwLength * 0.05;
      const across = (Math.random() - 0.5) * this.mwThickness * 0.15;
      const x = this.mwCenterX + along * mwCos - across * mwSin;
      const y = this.mwCenterY + along * mwSin + across * mwCos;
      const endFade = 1 - (Math.abs(along) / (this.mwLength / 2)) ** 2;
      this.mwHazePuffs.push({
        x,
        y,
        radius: this.mwThickness * randRange(0.55, 0.9),
        brightness: 0.1 * endFade,
      });
    }
  }

  update(isNight: boolean, frameScale = 1): void {
    if (isNight) this.opacity = Math.min(1, this.opacity + 0.005 * frameScale);
    else this.opacity = Math.max(0, this.opacity - 0.005 * frameScale);
  }

  /**
   * Apply the rotation transform around the celestial pivot. The
   * pivot sits well above the visible viewport so that on-screen
   * stars all trace gentle, near-parallel arcs (rather than spinning
   * around a visible center point).
   */
  private _applyRotation(ctx: CanvasRenderingContext2D): void {
    const px = state.width * 0.5;
    const py = state.height * STAR_PIVOT_HEIGHT_RATIO;
    ctx.translate(px, py);
    ctx.rotate(state.starRotation);
    ctx.translate(-px, -py);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.opacity <= 0) return;
    const starWhite: RgbTuple = [255, 255, 255];
    const mwStar: RgbTuple = [235, 235, 255];
    const mwHaze1: RgbTuple = [220, 225, 255];
    const mwHaze2: RgbTuple = [200, 210, 245];
    const mwHazeOuter: RgbTuple = [180, 190, 230];

    ctx.save();
    this._applyRotation(ctx);

    // Soft Milky Way haze: a few overlapping radial-gradient puffs
    // along the band. Radial gradients fade smoothly to transparent
    // at their edge so the band feels diffuse rather than rectangular.
    for (const puff of this.mwHazePuffs) {
      const a = puff.brightness * this.opacity;
      if (a <= 0.001) continue;
      const grad = ctx.createRadialGradient(puff.x, puff.y, 0, puff.x, puff.y, puff.radius);
      grad.addColorStop(0, rgba(mwHaze1, a));
      grad.addColorStop(0.6, rgba(mwHaze2, a * 0.4));
      grad.addColorStop(1, rgba(mwHazeOuter, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(puff.x, puff.y, puff.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Milky Way star points.
    for (const s of this.milkyWay) {
      ctx.fillStyle = rgba(mwStar, s.brightness * this.opacity);
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
    }

    // Foreground star field. Stars with a non-zero twinkleDepth
    // pulse softly via a sin wave; flash stars spike sharply.
    for (const s of this.field) {
      let twinkle = 1;
      if (s.twinkleDepth) {
        const raw = 0.5 + 0.5 * Math.sin(s.twinklePhase + state.frame * s.twinkleRate);
        twinkle = s.flash
          ? 0.4 + 1.1 * raw ** 8 // sharp bright spikes
          : 1 - s.twinkleDepth * raw;
      }
      const a = s.brightness * twinkle * this.opacity;
      // Size pulsing: ±20% modulated by twinkle
      const r = (s.size / 2) * (1 + 0.2 * (twinkle - 0.5));
      ctx.fillStyle = rgba((s.color || starWhite) as unknown as RgbTuple, Math.min(a, 1));
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}
