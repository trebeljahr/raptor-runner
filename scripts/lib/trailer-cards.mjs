// Trailer title cards and end cards, rendered to PNG in headless Chromium.
//
// Homebrew's ffmpeg ships without drawtext, and a PNG imports into any NLE,
// so text is laid out in HTML with the game's own display font (Unbounded)
// and screenshot. Colours follow the title screen: dark brown ink, the cream
// of the menu buttons, and the amber of the ground band.
//
// Kinds:
//   intertitle   opaque ink card, centred text; used as a cut between shots
//   lower-third  transparent, bottom left, on a dark band for contrast
//   end-logo     transparent, the "Raptor Runner" wordmark above the middle
//   end-cta      transparent, the call to action under the wordmark
//   end          opaque all-in-one end card on key art

import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import { CHROME } from "./trailer-paths.mjs";

const INK = "#2a1d12";
const CREAM = "#f8ecd0";
const AMBER = "#e8ae3c";

const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

const page = (fontUrl, w, h, body, css) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
@font-face { font-family: Unbounded; font-weight: 200 900; src: url("${fontUrl}") format("woff2"); }
html, body { margin: 0; width: ${w}px; height: ${h}px; background: transparent; overflow: hidden; }
body { font-family: Unbounded, sans-serif; font-weight: 800; color: ${CREAM}; }
${css}
</style></head><body>${body}</body></html>`;

/** The wordmark: cream letters with a thick ink outline, as on the key art. */
const wordmark = (size) => `
  font-size: ${size}px; line-height: 1.02; font-weight: 900; letter-spacing: -0.01em;
  color: ${CREAM}; -webkit-text-stroke: ${Math.round(size * 0.075)}px ${INK};
  paint-order: stroke fill; text-align: center;`;

/** Ink card: small amber kicker over one big cream line, both centred. */
function intertitle({ text, kicker }) {
  return {
    css: `
      body { background: ${INK}; }
      .c { position: absolute; inset: 0; display: flex; flex-direction: column;
           align-items: center; justify-content: center; padding: 0 140px; }
      .k { font-size: 38px; font-weight: 700; letter-spacing: 0.18em; color: ${AMBER};
           text-transform: uppercase; margin-bottom: 30px; padding-left: 0.18em; }
      .t { font-size: 104px; line-height: 1.08; text-align: center; letter-spacing: -0.01em; }
      .rule { width: 132px; height: 10px; border-radius: 5px; background: ${AMBER}; margin-top: 44px; }`,
    body: `<div class="c">${kicker ? `<div class="k">${esc(kicker)}</div>` : ""}<div class="t">${esc(text)}</div><div class="rule"></div></div>`,
    opaque: true,
  };
}

/** Lower third on a dark band, so it reads over noon sky and night alike. */
function lowerThird({ text, kicker }) {
  return {
    css: `
      .band { position: absolute; left: 0; right: 0; bottom: 0; height: 360px;
              background: linear-gradient(to top, rgba(20,12,6,.72), rgba(20,12,6,.38) 55%, transparent); }
      .l3 { position: absolute; left: 112px; bottom: 104px; padding-left: 28px;
            border-left: 10px solid ${AMBER}; }
      .k  { font-size: 32px; font-weight: 700; letter-spacing: 0.16em; color: ${AMBER};
            text-transform: uppercase; margin-bottom: 8px; }
      .t  { font-size: 76px; line-height: 1.05; text-shadow: 0 3px 14px rgba(0,0,0,.8); }`,
    body: `<div class="band"></div><div class="l3">${kicker ? `<div class="k">${esc(kicker)}</div>` : ""}<div class="t">${esc(text)}</div></div>`,
  };
}

/** Wordmark centred, a little above the middle, with a soft shadow. */
function endLogo({ text = "Raptor Runner" }) {
  return {
    css: `
      .logo { position: absolute; left: 0; right: 0; top: 38%; transform: translateY(-50%);
              ${wordmark(196)}
              filter: drop-shadow(0 12px 36px rgba(0,0,0,.55)); }`,
    body: `<div class="logo">${esc(text)}</div>`,
  };
}

/** Call to action under the wordmark: a cream button plate and a small line. */
function endCta({ lines }) {
  const [cta, ...rest] = lines;
  return {
    css: `
      .c { position: absolute; left: 0; right: 0; top: 63%; display: flex;
           flex-direction: column; align-items: center; gap: 26px; }
      .plate { background: ${CREAM}; color: ${INK}; font-size: 60px; font-weight: 800;
               padding: 22px 60px 24px; border: 7px solid ${INK}; border-radius: 18px;
               box-shadow: 0 12px 40px rgba(0,0,0,.45); }
      .sub { font-size: 34px; font-weight: 600; color: ${CREAM};
             text-shadow: 0 2px 12px rgba(0,0,0,.95); }`,
    body: `<div class="c"><div class="plate">${esc(cta)}</div>${rest.map((l) => `<div class="sub">${esc(l)}</div>`).join("")}</div>`,
  };
}

/** All-in-one end card: key art under a dark scrim, wordmark, call to action. */
function endCard({ background, lines, text = "Raptor Runner" }) {
  const [cta, ...rest] = lines;
  return {
    css: `
      body { background: ${INK}; }
      .bg { position: absolute; inset: 0; background: url("${background}") center / cover;
            filter: saturate(.75) blur(6px); transform: scale(1.04); }
      .scrim { position: absolute; inset: 0;
               background: radial-gradient(ellipse at center, rgba(20,12,6,.35), rgba(20,12,6,.8)); }
      .c { position: absolute; inset: 0; display: flex; flex-direction: column;
           align-items: center; justify-content: center; gap: 40px; }
      .logo { ${wordmark(180)} }
      .cta { font-size: 64px; }
      .sub { font-size: 36px; font-weight: 600; color: ${AMBER}; }`,
    body: `<div class="bg"></div><div class="scrim"></div><div class="c">
      <div class="logo">${esc(text)}</div>
      ${cta ? `<div class="cta">${esc(cta)}</div>` : ""}
      ${rest.map((l) => `<div class="sub">${esc(l)}</div>`).join("")}
    </div>`,
    opaque: true,
  };
}

const KINDS = {
  intertitle,
  "lower-third": lowerThird,
  "end-logo": endLogo,
  "end-cta": endCta,
  end: endCard,
};

/**
 * Render every card to `outFile`.
 * @param {{ outFile: string, kind: string, [k: string]: any }[]} jobs
 *   `background` is an absolute path
 */
export async function renderCards(jobs, { width, height, font }) {
  const dir = await mkdtemp(join(tmpdir(), "trailer-cards-"));
  const browser = await chromium.launch({
    headless: true,
    args: [`--window-size=${width},${height}`, "--hide-scrollbars"],
    ...(existsSync(CHROME) ? { executablePath: CHROME } : {}),
  });
  try {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const tab = await ctx.newPage();
    for (const [i, job] of jobs.entries()) {
      const make = KINDS[job.kind];
      if (!make) throw new Error(`unknown card kind "${job.kind}"`);
      const spec = make({
        ...job,
        background: job.background && pathToFileURL(job.background).href,
      });
      const html = join(dir, `card-${i}.html`);
      await writeFile(html, page(pathToFileURL(font).href, width, height, spec.body, spec.css));
      await tab.goto(pathToFileURL(html).href);
      await tab.evaluate(() => document.fonts.ready);
      await tab.screenshot({ path: job.outFile, omitBackground: !spec.opaque });
    }
  } finally {
    await browser.close();
    await rm(dir, { recursive: true, force: true });
  }
}
