#!/usr/bin/env node
/*
 * make-steam-capsules.mjs — cut every Steam store capsule from the two
 * key-art sources in public/press/.
 *
 * Steam wants six differently-shaped images and rejects anything off-size,
 * so cropping by hand once per art revision gets old fast. This regenerates
 * the whole set into steam-assets/ (gitignored — derived output, like
 * release/).
 *
 * Two sources, because no single crop covers both orientations:
 *   keyart-landscape.jpeg  2752x1536  -> header, small, main, page background
 *   keyart-portrait.jpeg   1536x2752  -> vertical, library capsule
 *
 * The CROPS table's `top` offsets are hand-picked to keep both the wordmark
 * and the raptor inside the frame. They are in SOURCE pixels, so they only
 * hold for art at the dimensions above — re-derive them if the art is
 * regenerated at another size. `verifySubjects` re-checks the wordmark and
 * raptor survive rather than trusting the numbers.
 *
 * Note the capsule sizes below are DOUBLE what most guides state; Valve
 * resized them for hi-DPI. See docs/PRESS_ASSETS.md.
 *
 * Usage:
 *   node scripts/make-steam-capsules.mjs
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PRESS = resolve(ROOT, "public", "press");
const OUT = resolve(ROOT, "steam-assets");

const LANDSCAPE = resolve(PRESS, "keyart-landscape.jpeg");
const PORTRAIT = resolve(PRESS, "keyart-portrait.jpeg");

// Where the wordmark and the raptor sit in each source, in source pixels.
// Measured, not guessed: the wordmark is the dense near-black mass, the
// raptor the low-saturation mid-tone mass.
const SUBJECTS = {
  [LANDSCAPE]: { wordmark: [302, 782], raptor: [846, 1104] },
  [PORTRAIT]: { wordmark: [432, 950], raptor: [1485, 1974] },
};

const CROPS = [
  // name                 w     h    source      top offset (null = centre)
  ["header_capsule", 920, 430, LANDSCAPE, 90],
  ["small_capsule", 462, 174, LANDSCAPE, 240],
  ["main_capsule", 1232, 706, LANDSCAPE, null],
  ["page_background", 1438, 810, LANDSCAPE, null],
  ["vertical_capsule", 748, 896, PORTRAIT, 300],
  ["library_capsule", 600, 900, PORTRAIT, 200],
];

function identify(file) {
  const out = execFileSync("magick", ["identify", "-format", "%w %h", file], {
    encoding: "utf8",
  });
  const [w, h] = out.trim().split(/\s+/).map(Number);
  return { w, h };
}

/** Largest crop of `src` matching the target ratio, plus the offset used. */
function cropBox(srcW, srcH, tw, th, top) {
  const target = tw / th;
  if (srcW / srcH > target) {
    const w = Math.round(srcH * target);
    return { w, h: srcH, x: Math.round((srcW - w) / 2), y: 0 };
  }
  const h = Math.round(srcW / target);
  return { w: srcW, h, x: 0, y: top ?? Math.round((srcH - h) / 2) };
}

/** Fail loudly if a crop would slice the wordmark or the raptor. */
function verifySubjects(src, box) {
  const s = SUBJECTS[src];
  if (!s) return [];
  const problems = [];
  for (const [label, [a, b]] of Object.entries(s)) {
    if (a < box.y || b > box.y + box.h) {
      problems.push(`${label} (y ${a}-${b}) falls outside crop y ${box.y}-${box.y + box.h}`);
    }
  }
  return problems;
}

if (!existsSync(LANDSCAPE) || !existsSync(PORTRAIT)) {
  console.error(
    "missing key art in public/press/ — expected keyart-landscape.jpeg and keyart-portrait.jpeg",
  );
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

let failed = 0;
for (const [name, tw, th, src, top] of CROPS) {
  const { w: sw, h: sh } = identify(src);
  const box = cropBox(sw, sh, tw, th, top);

  const problems = verifySubjects(src, box);
  for (const p of problems) console.warn(`  WARN  ${name}: ${p}`);
  if (problems.length) failed++;

  const dest = resolve(OUT, `${name}.png`);
  execFileSync("magick", [
    src,
    "-crop",
    `${box.w}x${box.h}+${box.x}+${box.y}`,
    "+repage",
    "-resize",
    `${tw}x${th}!`,
    "-strip",
    dest,
  ]);

  const trimW = sw - box.w;
  const trimH = sh - box.h;
  const pct = Math.max(trimW / sw, trimH / sh) * 100;
  console.log(
    `  ${name.padEnd(18)} ${String(tw).padStart(4)}x${String(th).padEnd(4)}` +
      `  from ${src.endsWith("portrait.jpeg") ? "portrait " : "landscape"}` +
      `  trim ${trimW}w/${trimH}h (${pct.toFixed(1)}%)`,
  );
}

console.log(`\n  wrote ${CROPS.length} files to steam-assets/`);
if (failed) {
  console.error(`  ${failed} crop(s) clipped a subject — check the warnings above`);
  process.exit(1);
}
