/*
 * Raptor Runner — flower patches.
 *
 * Small clusters of flowers spawned in the "breather" gaps that the
 * cactus spawner occasionally rolls. They scroll at ground speed
 * like cacti do (not at dune/parallax speed), live in front of the
 * dunes, and paint on top of the grass band.
 *
 * All flower bitmaps are preloaded at game init via IMAGE_SRCS so
 * spawning a patch is a cheap state-push — no fetch, no decode, no
 * frame-drop when a patch appears.
 *
 * Achievement "stop-and-smell-the-roses" fires once per save the
 * first time the raptor passes over a patch.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  FLOWER_MAX_HEIGHT_PX,
  FLOWER_MIN_HEIGHT_PX,
  FLOWER_PATCH_MAX_COUNT,
  FLOWER_PATCH_MIN_COUNT,
  FLOWER_PATCH_WIDTH_PX,
} from "../constants";
import { compactInPlace } from "../helpers";
import { FLOWER_KEYS, IMAGES } from "../images";
import { state } from "../state";

interface Flower {
  /** px offset from the patch's left edge. */
  dx: number;
  /** IMAGES[] key. */
  key: string;
  /** Display height in px. */
  h: number;
  /** Tiny rotation, in radians, for natural variance. */
  rot: number;
  /** Horizontal flip (0 or 1). */
  flip: number;
}

export interface FlowerPatch {
  /** Screen-space x of the patch's left edge. Scrolled left each
   *  frame; patch is removed when fully off-screen left. */
  x: number;
  /** Full patch width in px. */
  w: number;
  flowers: Flower[];
  /** True once the raptor's hitbox has passed through this patch —
   *  used to fire the achievement exactly once per patch. */
  crossed: boolean;
}

/** Factory that builds a patch positioned at a given on-screen x.
 *  The flower layout is pre-baked at spawn time so the draw loop
 *  can blit image elements directly — no per-frame randomness. */
export function makeFlowerPatch(x: number): FlowerPatch {
  const count =
    FLOWER_PATCH_MIN_COUNT +
    Math.floor(Math.random() * (FLOWER_PATCH_MAX_COUNT - FLOWER_PATCH_MIN_COUNT + 1));
  const flowers: Flower[] = [];
  for (let i = 0; i < count; i++) {
    flowers.push({
      dx: Math.random() * FLOWER_PATCH_WIDTH_PX,
      key: FLOWER_KEYS[Math.floor(Math.random() * FLOWER_KEYS.length)],
      h: FLOWER_MIN_HEIGHT_PX + Math.random() * (FLOWER_MAX_HEIGHT_PX - FLOWER_MIN_HEIGHT_PX),
      rot: (Math.random() - 0.5) * 0.2, // ±~0.1 rad wobble
      flip: Math.random() < 0.5 ? 1 : 0,
    });
  }
  // Draw back-to-front so taller flowers in the back don't cover
  // the shorter ones in front — sort by descending height means
  // tall-first, then short layered on top.
  flowers.sort((a, b) => b.h - a.h);
  return { x, w: FLOWER_PATCH_WIDTH_PX, flowers, crossed: false };
}

/** Advance every live patch by one frame and drop off-screen ones. */
export function updateFlowerPatches(_frameScale: number): void {
  if (!state.flowerPatches || state.flowerPatches.length === 0) return;
  // Shared integer dx — see state._frameScrollDx in state.ts. Keeps
  // the flower patches pixel-locked to the cacti + coins scrolling
  // at the same speed.
  const dx = state._frameScrollDx;
  for (const p of state.flowerPatches) p.x -= dx;
  compactInPlace(state.flowerPatches, (p) => p.x + p.w > -20);
}

/** Blit every patch. Runs inside the foreground pass so the grass
 *  tint and sky-light tint still apply. */
export function drawFlowerPatches(ctx: CanvasRenderingContext2D): void {
  if (!state.flowerPatches || state.flowerPatches.length === 0) return;
  const ground = state.ground;
  for (const p of state.flowerPatches) {
    for (const f of p.flowers) {
      const img = IMAGES[f.key];
      if (!img) continue;
      const aspect = img.width / img.height;
      const fw = f.h * aspect;
      const cx = p.x + f.dx;
      const cy = ground;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(f.rot);
      if (f.flip) ctx.scale(-1, 1);
      // Anchor the flower's stem base at y=0 (the ground line).
      ctx.drawImage(img, -fw / 2, -f.h, fw, f.h);
      ctx.restore();
    }
  }
}

/** Return the first patch the raptor is currently on top of, or
 *  null. Used by the first-patch achievement hook in main.ts. */
export function raptorCrossingPatch(raptorX: number, raptorW: number): FlowerPatch | null {
  if (!state.flowerPatches) return null;
  const rL = raptorX;
  const rR = raptorX + raptorW;
  for (const p of state.flowerPatches) {
    if (p.crossed) continue;
    const pL = p.x;
    const pR = p.x + p.w;
    if (rR >= pL && rL <= pR) return p;
  }
  return null;
}
