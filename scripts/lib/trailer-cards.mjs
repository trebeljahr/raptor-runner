// Trailer title cards and end cards, rendered to PNG in headless Chromium.
//
// Homebrew's ffmpeg ships without drawtext, and a PNG imports into any NLE,
// so text is laid out in HTML with the game's own display font (Unbounded)
// and screenshot. Card backgrounds are the game's own sky gradients
// (SKY_COLORS in src/constants.ts) over a dune silhouette, so a card reads
// as a moment of the day cycle rather than a slide.
//
// Kinds:
//   intertitle   opaque card, centred text; used as a cut between shots.
//                Black by default; `sky`: day | gold | dusk | night | storm
//   art          opaque full-frame artwork (`background`, `position`, `fit`),
//                optionally with the wordmark (`logo`) and call to action (`lines`)
//   glass        transparent, a frosted panel with one line of text; goes
//                over blurred night-sky footage as a title card
//   fill         opaque solid colour (`color`); as a title with fades, a flash
//   lower-third  transparent, bottom left, on a dark band for contrast
//   end-logo     transparent, the designed wordmark PNG (`logo`, `align`)
//   end-cta      transparent, the call to action plate (`lines`, `align`)

import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import { CHROME } from "./trailer-paths.mjs";

const WHITE = "#fffaf0";
const GOLD = "#ffd36b"; // the coin
const LOGO_INK = "#3b2a1c"; // outline colour of the designed wordmark
const LOGO_CREAM = "#fbecc8";

const rgb = ([r, g, b]) => `rgb(${r}, ${g}, ${b})`;
// Bands from SKY_COLORS: day, golden hour, sunset magenta, blue hour, night.
const DAY = [80, 180, 205];
const GOLDEN = [240, 170, 70];
const MAGENTA = [220, 90, 120];
const BLUE_HOUR = [40, 65, 130];
const NIGHT = [21, 34, 56];
const SKIES = {
  day: { top: [44, 132, 170], bottom: DAY, kicker: WHITE },
  gold: { top: MAGENTA, bottom: GOLDEN, kicker: WHITE },
  dusk: { top: BLUE_HOUR, bottom: MAGENTA, kicker: GOLD },
  night: { top: NIGHT, bottom: BLUE_HOUR, kicker: GOLD, stars: true },
  storm: { top: [34, 40, 48], bottom: [78, 88, 100], kicker: GOLD },
};

const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

const page = (fontUrl, w, h, body, css) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
@font-face { font-family: Unbounded; font-weight: 200 900; src: url("${fontUrl}") format("woff2"); }
html, body { margin: 0; width: ${w}px; height: ${h}px; background: transparent; overflow: hidden; }
body { font-family: Unbounded, sans-serif; font-weight: 800; color: ${WHITE}; }
${css}
</style></head><body>${body}</body></html>`;

/** Two rolling dune layers along the bottom, like the game's parallax. */
const DUNES = `<svg class="dunes" viewBox="0 0 1920 300" preserveAspectRatio="none">
  <path d="M0 150 C240 90 420 120 640 140 S1080 70 1320 110 S1720 150 1920 100 V300 H0Z" fill="rgba(0,0,0,.14)"/>
  <path d="M0 220 C300 170 520 200 760 215 S1220 160 1500 190 S1800 220 1920 200 V300 H0Z" fill="rgba(0,0,0,.22)"/>
</svg>`;

/** Deterministic star field for the night card. */
function stars() {
  let a = 7;
  const rand = () => {
    a = (a * 16807) % 2147483647;
    return a / 2147483647;
  };
  return Array.from({ length: 90 }, () => {
    const s = 1 + rand() * 2.4;
    return `<i style="left:${(rand() * 100).toFixed(2)}%;top:${(rand() * 62).toFixed(2)}%;width:${s.toFixed(1)}px;height:${s.toFixed(1)}px;opacity:${(0.35 + rand() * 0.6).toFixed(2)}"></i>`;
  }).join("");
}

/**
 * Title card. Default: black, as in the Mesozoic Protocol trailer, with the
 * wordmark's cream for the line and the coin's gold for the kicker and
 * rule; cut in and out with short fades to black. `sky` (day | gold | dusk
 * | night | storm) swaps the black for one of the game's sky gradients.
 */
function intertitle({ text, kicker, sky }) {
  const s = sky ? SKIES[sky] : null;
  if (sky && !s) throw new Error(`unknown card sky "${sky}" (${Object.keys(SKIES).join(", ")})`);
  const lines = esc(text).replace(/\n/g, "<br>");
  if (!s) {
    return {
      css: `
        body { background: #000; }
        .c { position: absolute; inset: 0; display: flex; flex-direction: column;
             align-items: center; justify-content: center; padding: 0 120px; }
        .k { font-size: 34px; font-weight: 700; letter-spacing: 0.3em; color: ${GOLD};
             text-transform: uppercase; margin-bottom: 30px; padding-left: 0.3em; }
        .t { font-size: 96px; line-height: 1.1; letter-spacing: 0.02em; text-transform: uppercase;
             text-align: center; color: ${LOGO_CREAM}; }
        .rule { width: 120px; height: 8px; border-radius: 4px; background: ${GOLD}; margin-top: 40px; }`,
      body: `<div class="c">${kicker ? `<div class="k">${esc(kicker)}</div>` : ""}<div class="t">${lines}</div><div class="rule"></div></div>`,
      opaque: true,
    };
  }
  return {
    css: `
      body { background: linear-gradient(to bottom, ${rgb(s.top)}, ${rgb(s.bottom)}); }
      .dunes { position: absolute; left: 0; right: 0; bottom: 0; width: 100%; height: 300px; }
      .stars i { position: absolute; border-radius: 50%; background: #fff; }
      .c { position: absolute; inset: 0 0 90px; display: flex; flex-direction: column;
           align-items: center; justify-content: center; padding: 0 140px; }
      .k { font-size: 36px; font-weight: 700; letter-spacing: 0.2em; color: ${s.kicker};
           text-transform: uppercase; margin-bottom: 28px; padding-left: 0.2em;
           text-shadow: 0 2px 12px rgba(0,0,0,.35); }
      .t { font-size: 104px; line-height: 1.08; text-align: center; letter-spacing: -0.01em;
           text-shadow: 0 4px 24px rgba(0,0,0,.35); }`,
    body: `${s.stars ? `<div class="stars">${stars()}</div>` : ""}${DUNES}<div class="c">${kicker ? `<div class="k">${esc(kicker)}</div>` : ""}<div class="t">${lines}</div></div>`,
    opaque: true,
  };
}

/**
 * Full-frame artwork. `fit: "cover"` crops to fill. `fit: "width"` shows a
 * wide piece whole (e.g. the 3840x1240 Steam library hero) along the bottom;
 * `extend` (a CSS background, e.g. a gradient matched to the art's top edge)
 * fills the frame above it, and the art's top edge fades into it.
 */
function art({
  background,
  position = "center",
  fit = "cover",
  extend = "#7fd6ee",
  logo,
  lines,
  align = "right",
  logoTop = "22%",
  logoWidth = 820,
  ctaTop = "42%",
}) {
  const base =
    fit === "width"
      ? {
          css: `
        body { background: ${extend}; }
        .img { position: absolute; left: 0; bottom: 0; width: 100%;
               -webkit-mask-image: linear-gradient(to bottom, transparent, #000 22%); }`,
          body: `<img class="img" src="${background}">`,
        }
      : {
          css: `body { background: url("${background}") ${position} / cover no-repeat; }`,
          body: "",
        };
  // Optional wordmark and call to action baked into the same frame, so an
  // end card can be revealed (or cut to) with its text already in place.
  const parts = [base];
  if (logo) parts.push(endLogo({ logo, align, top: logoTop, width: logoWidth }));
  if (lines) parts.push(endCta({ lines, align, top: ctaTop }));
  return {
    css: parts.map((p) => p.css).join("\n"),
    body: parts.map((p) => p.body).join(""),
    opaque: true,
  };
}

/** Lower third on a dark band, so it reads over noon sky and night alike. */
function lowerThird({ text, kicker }) {
  return {
    css: `
      .band { position: absolute; left: 0; right: 0; bottom: 0; height: 360px;
              background: linear-gradient(to top, rgba(10,16,30,.7), rgba(10,16,30,.35) 55%, transparent); }
      .l3 { position: absolute; left: 112px; bottom: 104px; padding-left: 28px;
            border-left: 10px solid ${GOLD}; }
      .k  { font-size: 32px; font-weight: 700; letter-spacing: 0.16em; color: ${GOLD};
            text-transform: uppercase; margin-bottom: 8px; }
      .t  { font-size: 76px; line-height: 1.05; text-shadow: 0 3px 14px rgba(0,0,0,.8); }`,
    body: `<div class="band"></div><div class="l3">${kicker ? `<div class="k">${esc(kicker)}</div>` : ""}<div class="t">${esc(text)}</div></div>`,
  };
}

/**
 * Frosted glass panel with a line of text (`\n` breaks it), centred. Laid over blurred
 * night-sky footage (a clip cut with `look.blur`), it reads as the game's
 * own sky behind glass.
 */
function glass({ text }) {
  return {
    css: `
      .g { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
           width: max-content; max-width: 1760px; padding: 54px 96px 60px; border-radius: 40px;
           background: linear-gradient(160deg, rgba(255,255,255,.16), rgba(255,255,255,.06));
           border: 2px solid rgba(255,255,255,.26);
           box-shadow: 0 24px 80px rgba(4,8,20,.35), inset 0 1px 0 rgba(255,255,255,.25);
           font-size: 84px; line-height: 1.12; text-align: center; letter-spacing: -0.01em;
           color: ${WHITE}; text-shadow: 0 3px 18px rgba(4,8,20,.45); }`,
    body: `<div class="g">${esc(text).replace(/\n/g, "<br>")}</div>`,
  };
}

// Horizontal anchor of the end-card column: "center" or "right".
const column = (align) => (align === "right" ? "left: 50%; right: 3%;" : "left: 0; right: 0;");

/** The designed wordmark PNG, with a soft shadow. */
function endLogo({ logo, align = "center", top = "36%", width = 1100 }) {
  if (!logo) throw new Error("end-logo needs `logo` (the wordmark PNG)");
  return {
    css: `
      .w { position: absolute; ${column(align)} top: ${top}; transform: translateY(-50%);
           display: flex; justify-content: center; }
      .w img { width: ${width}px; max-width: 100%;
               filter: drop-shadow(0 14px 30px rgba(0,0,0,.35)); }`,
    body: `<div class="w"><img src="${logo}"></div>`,
  };
}

/** Call to action: a plate in the wordmark's own cream and outline colours. */
function endCta({ lines, align = "center", top = "66%" }) {
  const [cta, ...rest] = lines;
  return {
    css: `
      .c { position: absolute; ${column(align)} top: ${top}; display: flex;
           flex-direction: column; align-items: center; gap: 22px; }
      .plate { background: ${LOGO_CREAM}; color: ${LOGO_INK}; font-size: 58px; font-weight: 800;
               padding: 20px 58px 22px; border: 7px solid ${LOGO_INK}; border-radius: 22px;
               box-shadow: 0 12px 34px rgba(0,0,0,.3); }
      .sub { font-size: 32px; font-weight: 600; color: ${WHITE};
             text-shadow: 0 2px 10px rgba(0,0,0,.85); }`,
    body: `<div class="c"><div class="plate">${esc(cta)}</div>${rest.map((l) => `<div class="sub">${esc(l)}</div>`).join("")}</div>`,
  };
}

/** A solid colour frame, e.g. a white flash laid over a cut. */
function fill({ color = "#fff" }) {
  return { css: `body { background: ${color}; }`, body: "", opaque: true };
}

const KINDS = {
  fill,
  intertitle,
  art,
  "lower-third": lowerThird,
  glass,
  "end-logo": endLogo,
  "end-cta": endCta,
};

/**
 * Render every card to `outFile`.
 * @param {{ outFile: string, kind: string, [k: string]: any }[]} jobs
 *   `logo` and `background` are absolute paths
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
        logo: job.logo && pathToFileURL(job.logo).href,
        background: job.background && pathToFileURL(job.background).href,
      });
      const html = join(dir, `card-${i}.html`);
      await writeFile(html, page(pathToFileURL(font).href, width, height, spec.body, spec.css));
      await tab.goto(pathToFileURL(html).href);
      await tab.evaluate(() => document.fonts.ready);
      await tab.evaluate(() =>
        Promise.all([...document.images].map((img) => img.decode().catch(() => {}))),
      );
      await tab.screenshot({ path: job.outFile, omitBackground: !spec.opaque });
    }
  } finally {
    await browser.close();
    await rm(dir, { recursive: true, force: true });
  }
}
