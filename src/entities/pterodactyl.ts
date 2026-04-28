/*
 * Raptor Runner — pterodactyl flying obstacle.
 *
 * Alternative obstacle to the cacti. Uses a 5×5 sprite sheet (22
 * frames, last 3 slots empty) for a full flap cycle. Sprite is drawn
 * horizontally flipped so the head leads the scroll (feels like it's
 * flying toward the raptor).
 *
 * Every frame has its own collision polygon: body-only, excluding
 * wing tips, so the hit feels fair when a well-timed jump grazes the
 * wingspan. Because wing position changes which part of the frame
 * the body occupies, per-frame polygons are load-bearing — a single
 * generic polygon would either under-cover frames where the body
 * sits high (wings down) or over-cover frames where the body sits
 * low (wings up).
 *
 *   • Pterodactyl   — single obstacle: world x/y/w/h, current frame,
 *                     cached polygon. Advances animation in update().
 *   • Pterodactyls  — spawn manager: called from the cactus spawn
 *                     path when a roll hits PTERODACTYL_SPAWN_CHANCE,
 *                     so flyers replace the occasional cactus rather
 *                     than layering on top of them.
 */

import type { NormalizedPoint } from "../cactusVariants";
import {
  PTERODACTYL_FLIGHT_HEIGHT_RATIO,
  PTERODACTYL_FRAME_DELAY_MS,
  PTERODACTYL_FRAME_H,
  PTERODACTYL_FRAME_W,
  PTERODACTYL_FRAMES,
  PTERODACTYL_HEIGHT_SCALE,
  PTERODACTYL_LOW_FLIGHT_HEIGHT_RATIO,
  PTERODACTYL_LOW_FLIGHT_SIZE_SCALE,
  PTERODACTYL_SHEET_COLS,
} from "../constants";
import { compactInPlace, type Polygon } from "../helpers";
import { IMAGES } from "../images";
import { state } from "../state";
import type { Raptor } from "./raptor";

/** Per-frame collision polygons in normalized (0..1) frame coords.
 *  Auto-generated from assets/pterodactyl-sprite.png via
 *  `sprite-tools collision --tolerance 10 --alpha 64`; re-run after
 *  swapping the sheet. Each polygon is an RDP-simplified contour of
 *  the largest opaque region in the frame. alpha=64 (not the default
 *  10) because the sheet has faint anti-aliased bleed pixels at the
 *  top of some cells that would otherwise steal the "first connected
 *  region" from the actual pterodactyl body. Source sprites face
 *  right (same direction as the raptor's scroll), so no flip is
 *  applied at draw time and these coords map 1:1. */
export const PTERODACTYL_COLLISION: ReadonlyArray<ReadonlyArray<NormalizedPoint>> = [
  [
    [0.3268, 0.4722],
    [0.3947, 0.5194],
    [0.9825, 0.4944],
    [0.7719, 0.5806],
    [0.7982, 0.6083],
    [0.7632, 0.6361],
    [0.557, 0.6222],
    [0.6075, 0.6833],
    [0.557, 0.6528],
    [0.5592, 0.7056],
    [0.4189, 0.6056],
    [0.2325, 0.6222],
    [0.0044, 0.5278],
    [0.2675, 0.5194],
    [0.3246, 0.475],
  ], // frame 0 (15 pts)
  [
    [0.3268, 0.4722],
    [0.3947, 0.5194],
    [0.6447, 0.5167],
    [0.9825, 0.6194],
    [0.7149, 0.65],
    [0.5548, 0.6222],
    [0.6075, 0.6833],
    [0.5592, 0.6528],
    [0.5658, 0.7083],
    [0.4298, 0.6139],
    [0.25, 0.6694],
    [0.0088, 0.6361],
    [0.2588, 0.5389],
    [0.3246, 0.475],
  ], // frame 1 (14 pts)
  [
    [0.3268, 0.4722],
    [0.3947, 0.5194],
    [0.4781, 0.5056],
    [0.7675, 0.5889],
    [0.9605, 0.7389],
    [0.5987, 0.6222],
    [0.5526, 0.625],
    [0.6075, 0.6833],
    [0.5592, 0.6528],
    [0.5636, 0.7083],
    [0.443, 0.6194],
    [0.2632, 0.7139],
    [0.0219, 0.7333],
    [0.2456, 0.5639],
    [0.3487, 0.5583],
    [0.2654, 0.5528],
    [0.3246, 0.475],
  ], // frame 2 (17 pts)
  [
    [0.3268, 0.4722],
    [0.6382, 0.5917],
    [0.7917, 0.6],
    [0.7632, 0.6361],
    [0.6754, 0.6222],
    [0.8991, 0.8694],
    [0.5636, 0.6222],
    [0.6009, 0.6944],
    [0.557, 0.6528],
    [0.557, 0.7056],
    [0.4561, 0.625],
    [0.2917, 0.7583],
    [0.068, 0.8556],
    [0.25, 0.5972],
    [0.3662, 0.5583],
    [0.2654, 0.5528],
    [0.3246, 0.475],
  ], // frame 3 (17 pts)
  [
    [0.3311, 0.4694],
    [0.6118, 0.5861],
    [0.7961, 0.6],
    [0.6535, 0.6222],
    [0.8487, 0.9417],
    [0.5899, 0.6444],
    [0.6053, 0.6889],
    [0.557, 0.6528],
    [0.5614, 0.7056],
    [0.4868, 0.6278],
    [0.1075, 0.925],
    [0.2566, 0.6083],
    [0.3684, 0.5611],
    [0.2675, 0.5556],
    [0.3289, 0.4722],
  ], // frame 4 (15 pts)
  [
    [0.3377, 0.4667],
    [0.5921, 0.5806],
    [0.7917, 0.5889],
    [0.7654, 0.625],
    [0.6382, 0.6194],
    [0.7039, 0.7278],
    [0.7719, 0.9972],
    [0.6184, 0.6944],
    [0.5592, 0.65],
    [0.557, 0.7028],
    [0.4781, 0.625],
    [0.3706, 0.7111],
    [0.3355, 0.7944],
    [0.2851, 0.8056],
    [0.1711, 0.9861],
    [0.261, 0.6167],
    [0.3706, 0.5583],
    [0.2675, 0.5556],
    [0.3355, 0.4694],
  ], // frame 5 (19 pts)
  [
    [0.3311, 0.4667],
    [0.5943, 0.5806],
    [0.7961, 0.5861],
    [0.636, 0.6167],
    [0.6974, 0.7361],
    [0.7346, 0.9972],
    [0.6096, 0.6972],
    [0.557, 0.65],
    [0.5614, 0.7028],
    [0.4846, 0.625],
    [0.2895, 0.8139],
    [0.1974, 0.9972],
    [0.2193, 0.7222],
    [0.261, 0.6111],
    [0.3684, 0.5583],
    [0.2675, 0.5556],
    [0.3289, 0.4694],
  ], // frame 6 (17 pts)
  [
    [0.3377, 0.4639],
    [0.6162, 0.5833],
    [0.7982, 0.5833],
    [0.6425, 0.6167],
    [0.6974, 0.7278],
    [0.7171, 0.9972],
    [0.6118, 0.6889],
    [0.557, 0.65],
    [0.557, 0.7],
    [0.4715, 0.6222],
    [0.2895, 0.8111],
    [0.2171, 0.9972],
    [0.2193, 0.7167],
    [0.2632, 0.5861],
    [0.3662, 0.5556],
    [0.2675, 0.5556],
    [0.3355, 0.4667],
  ], // frame 7 (17 pts)
  [
    [0.3377, 0.4611],
    [0.3991, 0.5139],
    [0.5768, 0.5083],
    [0.6535, 0.5861],
    [0.7961, 0.5722],
    [0.6732, 0.6111],
    [0.7039, 0.675],
    [0.7171, 0.9667],
    [0.6689, 0.7333],
    [0.5548, 0.6167],
    [0.6075, 0.675],
    [0.557, 0.6472],
    [0.568, 0.7],
    [0.4627, 0.6194],
    [0.3596, 0.6778],
    [0.3355, 0.7556],
    [0.261, 0.8139],
    [0.2193, 0.9722],
    [0.2127, 0.6722],
    [0.2654, 0.5194],
    [0.3355, 0.4639],
  ], // frame 8 (21 pts)
  [
    [0.3311, 0.4611],
    [0.3947, 0.5111],
    [0.5855, 0.4611],
    [0.6886, 0.5861],
    [0.7939, 0.5639],
    [0.6974, 0.6028],
    [0.7368, 0.9111],
    [0.6798, 0.6917],
    [0.614, 0.6194],
    [0.5526, 0.6194],
    [0.6075, 0.675],
    [0.557, 0.6472],
    [0.5592, 0.6972],
    [0.4386, 0.6139],
    [0.2741, 0.7333],
    [0.2061, 0.9306],
    [0.2083, 0.6278],
    [0.2588, 0.4861],
    [0.3289, 0.4639],
  ], // frame 9 (19 pts)
  [
    [0.5746, 0.3944],
    [0.7259, 0.5694],
    [0.7961, 0.5611],
    [0.7478, 0.6028],
    [0.7807, 0.8139],
    [0.6798, 0.6056],
    [0.557, 0.6139],
    [0.6075, 0.6722],
    [0.5592, 0.6444],
    [0.568, 0.6972],
    [0.4868, 0.6222],
    [0.3465, 0.6056],
    [0.3092, 0.6722],
    [0.2478, 0.6806],
    [0.1754, 0.8417],
    [0.1754, 0.6694],
    [0.2632, 0.4306],
    [0.4211, 0.5083],
    [0.5088, 0.4778],
    [0.5724, 0.3972],
  ], // frame 10 (20 pts)
  [
    [0.5592, 0.3556],
    [0.7961, 0.5583],
    [0.8158, 0.7167],
    [0.7303, 0.5889],
    [0.557, 0.6139],
    [0.6075, 0.6722],
    [0.557, 0.6444],
    [0.5658, 0.6972],
    [0.4825, 0.6194],
    [0.3333, 0.575],
    [0.3004, 0.6306],
    [0.2193, 0.6417],
    [0.1491, 0.7667],
    [0.1645, 0.6],
    [0.2829, 0.3861],
    [0.4298, 0.5056],
    [0.557, 0.3583],
  ], // frame 11 (17 pts)
  [
    [0.5373, 0.325],
    [0.7478, 0.425],
    [0.8443, 0.6083],
    [0.8004, 0.5556],
    [0.761, 0.5972],
    [0.557, 0.6139],
    [0.6075, 0.6694],
    [0.557, 0.6444],
    [0.5592, 0.6944],
    [0.3355, 0.5389],
    [0.2917, 0.5806],
    [0.2346, 0.5556],
    [0.1184, 0.675],
    [0.2237, 0.4139],
    [0.3114, 0.35],
    [0.4474, 0.5],
    [0.5351, 0.3278],
  ], // frame 12 (17 pts)
  [
    [0.6338, 0.2694],
    [0.7851, 0.325],
    [0.8662, 0.4194],
    [0.6952, 0.3972],
    [0.5987, 0.4667],
    [0.557, 0.5611],
    [0.7961, 0.5694],
    [0.5548, 0.6139],
    [0.6075, 0.6694],
    [0.557, 0.6444],
    [0.5592, 0.6944],
    [0.3575, 0.5389],
    [0.2697, 0.55],
    [0.2522, 0.4639],
    [0.0965, 0.5139],
    [0.2105, 0.3583],
    [0.3355, 0.3167],
    [0.4474, 0.4889],
    [0.5066, 0.3],
    [0.6316, 0.2722],
  ], // frame 13 (20 pts)
  [
    [0.6952, 0.2194],
    [0.8618, 0.3],
    [0.682, 0.3417],
    [0.5526, 0.5556],
    [0.7961, 0.575],
    [0.557, 0.6139],
    [0.6075, 0.6694],
    [0.557, 0.6444],
    [0.5702, 0.6944],
    [0.3575, 0.5389],
    [0.2697, 0.55],
    [0.3289, 0.4583],
    [0.25, 0.4028],
    [0.0965, 0.4083],
    [0.2675, 0.2833],
    [0.3487, 0.3111],
    [0.4518, 0.475],
    [0.4912, 0.2944],
    [0.693, 0.2222],
  ], // frame 14 (19 pts)
  [
    [0.7281, 0.1167],
    [0.8268, 0.1306],
    [0.6711, 0.2667],
    [0.6491, 0.3833],
    [0.5877, 0.4306],
    [0.5504, 0.5528],
    [0.7982, 0.5806],
    [0.5548, 0.6167],
    [0.6075, 0.6722],
    [0.5592, 0.6444],
    [0.568, 0.6972],
    [0.3596, 0.5417],
    [0.2697, 0.5528],
    [0.3158, 0.4639],
    [0.3947, 0.5083],
    [0.386, 0.4583],
    [0.2763, 0.3333],
    [0.125, 0.2417],
    [0.1842, 0.2111],
    [0.2939, 0.2417],
    [0.4561, 0.4611],
    [0.4803, 0.2972],
    [0.5724, 0.1917],
    [0.7259, 0.1194],
  ], // frame 15 (24 pts)
  [
    [0.7675, 0.0361],
    [0.6557, 0.2528],
    [0.6491, 0.3806],
    [0.5855, 0.4333],
    [0.5504, 0.5556],
    [0.7982, 0.5861],
    [0.557, 0.6167],
    [0.6075, 0.6722],
    [0.557, 0.6472],
    [0.5702, 0.6972],
    [0.3575, 0.5417],
    [0.2675, 0.55],
    [0.3355, 0.4583],
    [0.3947, 0.5111],
    [0.3882, 0.4528],
    [0.1557, 0.1417],
    [0.2632, 0.1833],
    [0.4583, 0.4611],
    [0.4825, 0.3083],
    [0.557, 0.1889],
    [0.7654, 0.0389],
  ], // frame 16 (21 pts)
  [
    [0.761, 0.0056],
    [0.6557, 0.3083],
    [0.6601, 0.3944],
    [0.5943, 0.4444],
    [0.5526, 0.5583],
    [0.7982, 0.5944],
    [0.557, 0.6167],
    [0.6075, 0.675],
    [0.557, 0.6472],
    [0.568, 0.7],
    [0.3509, 0.5389],
    [0.2675, 0.55],
    [0.3136, 0.4667],
    [0.386, 0.4917],
    [0.1776, 0.0917],
    [0.4518, 0.4833],
    [0.5724, 0.2],
    [0.7588, 0.0083],
  ], // frame 17 (18 pts)
  [
    [0.8092, 0.0694],
    [0.6864, 0.45],
    [0.6162, 0.475],
    [0.5592, 0.5611],
    [0.7982, 0.6028],
    [0.5548, 0.6194],
    [0.6075, 0.6778],
    [0.557, 0.65],
    [0.5702, 0.7],
    [0.3596, 0.5444],
    [0.2719, 0.5583],
    [0.2719, 0.5083],
    [0.3355, 0.4611],
    [0.1864, 0.3083],
    [0.1228, 0.1694],
    [0.4364, 0.5083],
    [0.807, 0.0722],
  ], // frame 18 (17 pts)
  [
    [0.8575, 0.1417],
    [0.7018, 0.4917],
    [0.6338, 0.5],
    [0.5658, 0.5694],
    [0.7982, 0.6083],
    [0.557, 0.6194],
    [0.6075, 0.6778],
    [0.5592, 0.65],
    [0.568, 0.7028],
    [0.3509, 0.5417],
    [0.2719, 0.5583],
    [0.3004, 0.4833],
    [0.1645, 0.375],
    [0.0811, 0.2333],
    [0.4298, 0.5111],
    [0.8553, 0.1444],
  ], // frame 19 (16 pts)
  [
    [0.9364, 0.3],
    [0.7127, 0.5583],
    [0.5833, 0.5778],
    [0.7719, 0.5861],
    [0.7895, 0.6194],
    [0.557, 0.6194],
    [0.6075, 0.6806],
    [0.557, 0.6528],
    [0.568, 0.7028],
    [0.3925, 0.575],
    [0.2303, 0.5444],
    [0.0285, 0.3778],
    [0.4145, 0.5167],
    [0.9342, 0.3028],
  ], // frame 20 (14 pts)
  [
    [0.9693, 0.425],
    [0.7193, 0.5944],
    [0.6162, 0.5806],
    [0.7697, 0.5861],
    [0.7982, 0.6056],
    [0.7741, 0.6306],
    [0.5548, 0.6222],
    [0.6075, 0.6806],
    [0.557, 0.6528],
    [0.568, 0.7056],
    [0.4035, 0.5944],
    [0.2259, 0.6],
    [0.0044, 0.4806],
    [0.2763, 0.5056],
    [0.3465, 0.4667],
    [0.3947, 0.5167],
    [0.4956, 0.5139],
    [0.9671, 0.4278],
  ], // frame 21 (18 pts)
];

export class Pterodactyl {
  x: number;
  y: number;
  w: number;
  h: number;
  frame = 0;
  private _lastAdvance = 0;
  img: HTMLImageElement | undefined;
  private _polyCache: Polygon | null = null;
  /** Stable object pool — MAX-sized, never shrunk. Paired with
   *  `_polyView` (a resized reference array) so flap-cycle frame
   *  switches across varying vertex counts stay allocation-free
   *  without hitting the JS "shrink-then-grow leaves empty slots"
   *  trap. */
  private _polyPool: Polygon = Array.from(
    {
      length: Math.max(...PTERODACTYL_COLLISION.map((f) => f.length)),
    },
    () => ({ x: 0, y: 0 }),
  );
  private _polyView: Polygon = [];

  constructor(
    private raptor: Raptor,
    /** True for the low-flight variant (jump-over height instead of
     *  the default run-under height). Persisted on the instance so
     *  resize() can recompute the same y-band after a viewport
     *  change. */
    public readonly isLowFlight: boolean = false,
  ) {
    this.img = IMAGES.pterodactylSprite;
    const sizeScale = isLowFlight ? PTERODACTYL_LOW_FLIGHT_SIZE_SCALE : 1;
    this.h = raptor.h * PTERODACTYL_HEIGHT_SCALE * sizeScale;
    this.w = this.h * (PTERODACTYL_FRAME_W / PTERODACTYL_FRAME_H);
    this.x = state.width;
    const heightRatio = isLowFlight
      ? PTERODACTYL_LOW_FLIGHT_HEIGHT_RATIO
      : PTERODACTYL_FLIGHT_HEIGHT_RATIO;
    this.y = state.ground - this.h - raptor.h * heightRatio;
    // Randomise entry frame so two back-to-back spawns don't sync their
    // flap cycles — avoids a distracting "two metronomes" read when a
    // debug spawn fires mid-cycle.
    this.frame = Math.floor(Math.random() * PTERODACTYL_FRAMES);
  }

  resize(): void {
    const sizeScale = this.isLowFlight ? PTERODACTYL_LOW_FLIGHT_SIZE_SCALE : 1;
    this.h = this.raptor.h * PTERODACTYL_HEIGHT_SCALE * sizeScale;
    this.w = this.h * (PTERODACTYL_FRAME_W / PTERODACTYL_FRAME_H);
    const heightRatio = this.isLowFlight
      ? PTERODACTYL_LOW_FLIGHT_HEIGHT_RATIO
      : PTERODACTYL_FLIGHT_HEIGHT_RATIO;
    this.y = state.ground - this.h - this.raptor.h * heightRatio;
    this._polyCache = null;
  }

  update(now: number, _frameScale = 1): void {
    // Uses the shared integer dx (see state._frameScrollDx) so the
    // flyer advances in lockstep with cacti + coins, eliminating
    // the inter-entity pixel stutter.
    this.x -= state._frameScrollDx;
    if (now - this._lastAdvance > PTERODACTYL_FRAME_DELAY_MS) {
      this.frame = (this.frame + 1) % PTERODACTYL_FRAMES;
      this._lastAdvance = now;
    }
    this._polyCache = null;
  }

  collisionPolygon(): Polygon {
    if (this._polyCache) return this._polyCache;
    const norm = PTERODACTYL_COLLISION[this.frame] ?? PTERODACTYL_COLLISION[0];
    const n = norm.length;
    const x = this.x;
    const y = this.y;
    const w = this.w;
    const h = this.h;
    const pool = this._polyPool;
    const view = this._polyView;
    for (let i = 0; i < n; i++) {
      const p = pool[i];
      p.x = x + norm[i][0] * w;
      p.y = y + norm[i][1] * h;
      view[i] = p;
    }
    view.length = n;
    this._polyCache = view;
    return view;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.img) return;
    const col = this.frame % PTERODACTYL_SHEET_COLS;
    const row = Math.floor(this.frame / PTERODACTYL_SHEET_COLS);
    const srcX = col * PTERODACTYL_FRAME_W;
    const srcY = row * PTERODACTYL_FRAME_H;
    // Source sprites already face right (same direction the raptor
    // runs), so no flip is needed — the pterodactyl reads as hovering
    // in place with its head forward, which matches the raptor's
    // point of view as obstacles scroll past.
    ctx.drawImage(
      this.img,
      srcX,
      srcY,
      PTERODACTYL_FRAME_W,
      PTERODACTYL_FRAME_H,
      Math.round(this.x),
      Math.round(this.y),
      Math.round(this.w),
      Math.round(this.h),
    );
  }
}

export class Pterodactyls {
  pteros: Pterodactyl[] = [];

  constructor(private raptor: Raptor) {}

  /** Called by the cactus spawn path when a replacement roll hits —
   *  see Cactuses.spawn() in src/entities/cactus.ts. Lets the cactus
   *  gap/breather logic stay the source of truth for pacing.
   *  `isLow` picks the lower flight band (coin-height jump-over
   *  instead of the default run-under). */
  spawn(isLow = false): Pterodactyl {
    const p = new Pterodactyl(this.raptor, isLow);
    this.pteros.push(p);
    return p;
  }

  update(now: number, frameScale = 1): void {
    for (const p of this.pteros) p.update(now, frameScale);
    compactInPlace(this.pteros, (p) => p.x >= -p.w);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const p of this.pteros) p.draw(ctx);
  }

  resize(): void {
    for (const p of this.pteros) p.resize();
  }

  clear(): void {
    this.pteros = [];
  }
}
