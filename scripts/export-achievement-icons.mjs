#!/usr/bin/env node
/*
 * export-achievement-icons.mjs — rasterize the in-game achievement icons
 * into the 64x64 achieved/unachieved pairs the Steamworks partner backend
 * wants, one pair per achievement in src/achievements.ts.
 *
 * The catalog stores icons two ways (see AchievementDefinition):
 *   iconHTML  — inline SVG fragment on a 24x24 viewBox
 *   iconImage — pixel-art sprite under public/assets/
 * SVG fragments are wrapped in a real <svg> document (asset references
 * inlined as data URIs, since rsvg-convert resolves nothing relative) and
 * rendered with rsvg-convert. Sprites are composited with ImageMagick's
 * point filter so the pixel-art stays crisp, matching the
 * `image-rendering: pixelated` treatment in the game UI.
 *
 * Both variants get the sand card background the icons were designed
 * against (--color-sand-contrast, the unlocked-tile color in legacy.css) —
 * Steam's achievement icons are JPGs, so transparency is not an option.
 * The unachieved variant is the same image desaturated, which is the
 * de-facto standard on Steam.
 *
 * Output: steam-assets/achievements/<API_NAME>.jpg (+ _locked.jpg), with
 * PNG masters alongside, named by the Steam API name from toSteamApiName()
 * so files match the partner-backend entries one to one.
 *
 * Usage:
 *   node scripts/export-achievement-icons.mjs
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = resolve(ROOT, "public", "assets");
const OUT = resolve(ROOT, "steam-assets", "achievements");

// Matches --color-sand-contrast in src/styles/base.css — the tile the
// icons sit on in the unlocked achievements list.
const BACKGROUND = "#fbebc6";
const SIZE = 64;
// The in-game tile pads the icon 4px inside a 48px box; keep the ratio.
const PAD_SCALE = 1 - (2 * 4) / 48;

// achievements.ts is TypeScript with no imports, so a single-file
// transpile is enough to load the catalog here. esbuild ships nested
// under vite in this repo's pnpm layout.
function esbuildBin() {
  const candidates = [
    resolve(ROOT, "node_modules", ".bin", "esbuild"),
    resolve(ROOT, "node_modules", "vite", "node_modules", ".bin", "esbuild"),
  ];
  const hit = candidates.find(existsSync);
  if (!hit) throw new Error("esbuild not found — run pnpm install first");
  return hit;
}

async function loadCatalog(tmp) {
  const outfile = join(tmp, "achievements.mjs");
  execFileSync(esbuildBin(), [
    resolve(ROOT, "src", "achievements.ts"),
    "--format=esm",
    `--outfile=${outfile}`,
  ]);
  const mod = await import(pathToFileURL(outfile).href);
  return mod.ACHIEVEMENTS;
}

// Mirrors toSteamApiName() in src/steamBridge.ts. Duplicated rather than
// imported because steamBridge.ts pulls in window-typed modules that
// don't transpile standalone.
const toSteamApiName = (id) => "ACH_" + id.replace(/-/g, "_").toUpperCase();

/** Inline every assets/ reference as a data URI so librsvg can see it. */
function inlineAssets(fragment) {
  return fragment.replace(/href="assets\/([^"]+)"/g, (_, file) => {
    const path = resolve(ASSETS, file);
    if (!existsSync(path)) throw new Error(`missing asset: ${file}`);
    const b64 = readFileSync(path).toString("base64");
    return `href="data:image/png;base64,${b64}" style="image-rendering:pixelated"`;
  });
}

function svgDocument(fragment) {
  const inner = inlineAssets(fragment);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 24 24">` +
    `<rect width="24" height="24" fill="${BACKGROUND}"/>` +
    `<g transform="translate(12 12) scale(${PAD_SCALE}) translate(-12 -12)">${inner}</g>` +
    `</svg>`
  );
}

function renderSvg(fragment, dest, tmp) {
  const svgPath = join(tmp, "icon.svg");
  writeFileSync(svgPath, svgDocument(fragment));
  execFileSync("rsvg-convert", ["-w", String(SIZE), "-h", String(SIZE), "-o", dest, svgPath]);
}

function renderSprite(assetFile, dest) {
  const path = resolve(ASSETS, assetFile.replace(/^assets\//, ""));
  if (!existsSync(path)) throw new Error(`missing asset: ${assetFile}`);
  const inner = Math.round(SIZE * PAD_SCALE);
  execFileSync("magick", [
    "-size",
    `${SIZE}x${SIZE}`,
    `xc:${BACKGROUND}`,
    "(",
    path,
    "-filter",
    "point",
    "-resize",
    `${inner}x${inner}`,
    ")",
    "-gravity",
    "center",
    "-composite",
    dest,
  ]);
}

function deriveVariants(pngPath, base) {
  // Steam's own locked style: same art, no color.
  execFileSync("magick", [pngPath, "-colorspace", "Gray", `${base}_locked.png`]);
  execFileSync("magick", [pngPath, "-quality", "92", `${base}.jpg`]);
  execFileSync("magick", [`${base}_locked.png`, "-quality", "92", `${base}_locked.jpg`]);
}

const tmp = mkdtempSync(join(tmpdir(), "ach-icons-"));
try {
  const catalog = await loadCatalog(tmp);
  mkdirSync(OUT, { recursive: true });

  for (const ach of catalog) {
    const api = toSteamApiName(ach.id);
    const base = join(OUT, api);
    const png = `${base}.png`;

    if (ach.iconImage) renderSprite(ach.iconImage, png);
    else if (ach.iconHTML) renderSvg(ach.iconHTML, png, tmp);
    else throw new Error(`${ach.id}: no icon defined`);

    deriveVariants(png, base);
    console.log(`  ${api}`);
  }

  console.log(
    `\n  wrote ${catalog.length} achieved/unachieved pairs to steam-assets/achievements/`,
  );
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
