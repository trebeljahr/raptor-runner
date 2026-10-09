// Trailer shot recorder.
//
// Records one 1920x1080 60 fps MP4 per shot. The shots follow the vault's
// raptor-runner-trailer-shot-list: a calm midday run, the day turning to
// night, a full flower stretch, a storm building to a lightning strike, a
// rainbow after the rain, and one short look per outfit, each under a
// different sky so the outfit montage doubles as a tour of the day cycle.
//
// - Virtual clock. `?headless=1` (src/headlessRaf.ts) stops time unless this
//   script steps it, so every frame is rendered, captured and only then
//   advanced. Playback is smooth even when capture runs slower than real time.
// - Director. `?trailer=1` (src/trailer.ts) hides every DOM overlay, owns
//   all fourteen cosmetics, locks or sweeps the time of day, drives the
//   weather and jumps the cacti on autopilot. Collisions are off, so a
//   misjudged jump never ends a take.
// - Repeatable. Math.random is a PRNG seeded from the shot slug, so a
//   re-recorded shot gives the same cacti, clouds and bolts.
// - Headless only. Chromium runs without a window; nothing takes focus.
//
// Prereqs: a *dev* server (both flags are DEV-gated) and ffmpeg on PATH.
//
//   pnpm dev --port 51843 --strictPort
//   BASE_URL=http://localhost:51843 node scripts/record-trailer-shots.mjs
//
// Flags:
//   --list          print the shot list and exit
//   --shots=a,b     record only these slugs (keeps their NN- prefix)
//   --fps=60        output frame rate (default 60; 30 halves capture time)
//   --seconds=N     override every shot's length
//   --out=<dir>     output folder (default <main checkout>/trailer-clips/raw)

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { CHROME, mainCheckout } from "./lib/trailer-paths.mjs";

const VIEWPORT = { width: 1920, height: 1080 };

const argv = process.argv.slice(2);
const hasFlag = (name) => argv.includes(`--${name}`);
const flagValue = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const BASE = process.env.BASE_URL ?? "http://localhost:51843";
const OUT = resolve(flagValue("out") ?? resolve(mainCheckout(), "trailer-clips/raw"));
const FPS = Number(flagValue("fps") ?? 60);
const SECONDS = flagValue("seconds") ? Number(flagValue("seconds")) : null;

// Day phases, as fractions of one cycle (src/constants.ts CINEMATIC_PHASES).
const PHASE = {
  midday: 2 / 16,
  afternoon: 4 / 16,
  golden: 5.5 / 16,
  sunset: 6.5 / 16,
  blueHour: 7.5 / 16,
  midnight: 10 / 16,
  lateNight: 12 / 16,
  preDawn: 13.5 / 16,
  sunrise: 14.5 / 16,
  earlyGold: 15.5 / 16,
};

// Beats: in-page actions fired on a given second of the clip.
const strike = (page) => page.evaluate(() => window.__trailer.strike());
const rain = (mode) => (page) => page.evaluate((m) => window.__trailer.rain(m), mode);
const pterodactyl = (page) => page.evaluate(() => window.__trailer.pterodactyl());
const breather = (page) => page.evaluate(() => window.__trailer.breather());

const rainRamp = (to, seconds) => (page) =>
  page.evaluate(([to, s]) => window.__trailer.rainRamp(to, s), [to, seconds]);
const shootingStar = (page) => page.evaluate(() => window.__trailer.shootingStar());
const crash = (page) => page.evaluate(() => window.__trailer.crash());

// Outfit parade: every look is the same take (same seed, sky, cacti and
// jumps), so cutting between them at continuous clip times changes only
// the outfit.
const PARADE = {
  seed: "outfit-parade",
  phase: PHASE.afternoon,
  pterodactyls: false,
  score: 1841,
  lead: 2,
  seconds: 9,
};
const LOOKS = [
  ["bare", []],
  ["classic", ["party-hat", "thug-glasses", "bow-tie"]],
  ["cowboy", ["cowboy-hat", "bandana"]],
  ["top-hat", ["top-hat", "monocle", "gold-chain"]],
  ["wizard", ["wizard-hat"]],
  ["diadem", ["tiara"]],
  ["sombrero", ["sombrero", "bandana"]],
  ["pirate", ["pirate-tricorn", "eye-patch"]],
  ["crown", ["crown", "gold-chain"]],
  ["monocle", ["monocle", "bow-tie"]],
];

// ---------------------------------------------------------------------------
// THE SHOT LIST.
//
//   phase     time of day the shot opens on (PHASE.*)
//   rate      day cycles per second the sky sweeps forward (0 = locked)
//   moon      moon phase (0 new, 0.5 full)
//   stand     { x, clouds }: freeze the world and stand the raptor at x
//             (fraction of the width) while clouds race
//   obstacles false: an open desert, no cacti, pterodactyls or coins
//   pterodactyls false: cacti only
//   raptorAt  pin the raptor's x (fraction of the width, < 0 off screen)
//   hud       keep the game's overlays (score, game over); starts the run
//             with the real Start Game button
//   score     the run's distance in meters at the start
//   cursor    { from, target, start, duration, click }: after the game over,
//             a drawn cursor eases to the named button and clicks it
//   outfit    cosmetic ids to wear (src/cosmetics.ts)
//   rain      "off" | "build" | "full" weather at the start of the lead
//   lead      game seconds run (not recorded) before the first frame, so
//             stars, rain and clouds have settled
//   speed     pinned scroll speed (7 = fresh run, 17 = top speed)
//   seed      random seed name (default: the slug); shots sharing a seed
//             with the same settings play out identically
//   setup     actions fired at the start of the lead
//   beats     actions fired at a given second of the clip
// ---------------------------------------------------------------------------
export const SHOTS = [
  {
    slug: "calm-midday",
    describe: "Cold open: bare raptor, midday sun, jumps the first cacti",
    phase: PHASE.midday,
    lead: 2.5,
    seconds: 8,
  },
  {
    slug: "timelapse",
    describe: "Time-lapse: the raptor runs an open desert while a full day turns",
    phase: PHASE.afternoon,
    rate: 1 / 7,
    moon: 0.5,
    obstacles: false,
    speed: 8,
    lead: 0.5,
    seconds: 8,
    // The game's own shooting stars fall too; these make sure the short
    // night in the time-lapse shows a few.
    beats: [1.5, 2.0, 2.6, 3.1, 3.5].map((at) => ({ at, run: shootingStar })),
  },
  {
    slug: "flower-field",
    describe: "A full flower stretch: cacti thin out, coins, the diamond at the end",
    phase: PHASE.afternoon,
    setup: [breather],
    lead: 3,
    seconds: 11,
  },
  {
    slug: "storm",
    describe: "One storm, start to finish: rain builds, two strikes, it clears, a rainbow",
    phase: PHASE.midday + 0.03,
    lead: 1,
    seconds: 20,
    beats: [
      { at: 0.2, run: rainRamp(1, 6.5) },
      { at: 7.4, run: strike },
      { at: 9.8, run: strike },
      { at: 11.2, run: rainRamp(0, 4.5) },
    ],
  },
  {
    slug: "night-stars",
    describe: "Midnight: full moon, star field, shooting stars, a pterodactyl overhead",
    phase: PHASE.midnight - 0.02,
    rate: 0.003,
    moon: 0.5,
    lead: 4,
    seconds: 9,
    beats: [
      { at: 0.6, run: shootingStar },
      { at: 2.4, run: shootingStar },
      { at: 3.2, run: pterodactyl },
      { at: 5.0, run: shootingStar },
      { at: 7.2, run: shootingStar },
    ],
  },
  {
    slug: "sunset-pterodactyl",
    describe: "Sunset: pterodactyls overhead, coins grabbed underneath",
    phase: PHASE.sunset,
    outfit: ["party-hat", "thug-glasses", "bow-tie"],
    lead: 2,
    seconds: 6,
    beats: [{ at: 0.2, run: pterodactyl }],
  },
  {
    slug: "sunrise",
    describe: "Sunrise mood shot, slow drift into early gold",
    phase: PHASE.sunrise - 0.02,
    rate: 0.004,
    moon: 0.5,
    lead: 3,
    seconds: 8,
  },
  {
    slug: "night-plate",
    describe: "Card background: night sky with shooting stars, raptor off screen",
    phase: PHASE.midnight - 0.03,
    rate: 0.004,
    moon: 0.5,
    obstacles: false,
    raptorAt: -2,
    speed: 7,
    lead: 4,
    seconds: 14,
    beats: [0.5, 2.1, 3.4, 5.0, 6.6, 8.1, 9.5, 11.2, 12.6].map((at) => ({ at, run: shootingStar })),
  },
  {
    slug: "game-over",
    describe: "HUD on: a long run ends on a cactus, the score card comes up",
    hud: true,
    phase: PHASE.golden,
    outfit: ["cowboy-hat", "bandana"],
    score: 1841,
    lead: 2,
    seconds: 7,
    beats: [{ at: 1.2, run: crash }],
  },
  {
    // The parade's last look, run on until it ends on a cactus: the same
    // take as the parade up to the crash, so it cuts on seamlessly.
    slug: "parade-finale",
    describe: "Outfit parade, last look, run on into a crash and the game-over screen",
    ...PARADE,
    outfit: LOOKS.at(-1)[1],
    seconds: 13,
    beats: [{ at: 8.4, run: crash }],
    // After the crash a cursor glides to "Play again" and clicks it.
    cursor: { from: [0.7, 0.86], target: "Play again", start: 0.7, duration: 1.2, click: 2.1 },
  },
  ...LOOKS.map(([name, outfit]) => ({
    slug: `parade-${name}`,
    describe: `Outfit parade: ${outfit.join(", ") || "no outfit"}`,
    outfit,
    ...PARADE,
  })),
];

// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Reject after `ms`: a stalled page or screenshot must not hang a run. */
function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, rej) => {
      timer = setTimeout(() => rej(new Error(`stalled: ${label} (${ms / 1000}s)`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function pumpUntil(page, predicate, timeoutMs = 120000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await page.evaluate(predicate)) return;
    await page.evaluate((dt) => window.__rafStep?.(dt), 1000 / FPS);
    await sleep(30);
  }
  throw new Error(`timed out waiting for ${predicate.toString().slice(0, 80)}`);
}

async function stage(page, shot) {
  await page.goto(`${BASE}/?headless=1&trailer=1`, {
    waitUntil: "domcontentloaded",
    timeout: 120000, // a cold Vite server optimizes deps on first load
  });
  await pumpUntil(
    page,
    () => !!window.__trailer && window.Game?.getLoadingState().status === "ready",
  );
  await page.evaluate(() => document.getElementById("boot-splash")?.remove());
  // HUD shots start the way a player does, so the start screen closes and
  // the score and game-over overlays behave as in the shipped game.
  if (shot.hud) {
    await page.getByRole("button", { name: "Start Game", exact: true }).click();
    await page.evaluate((dt) => window.__trailer.step(dt), 1000 / FPS);
  }
  await page.evaluate(
    ({ shot }) => {
      window.__reseed();
      const T = window.__trailer;
      T.begin({ hud: !!shot.hud });
      T.outfit(shot.outfit ?? []);
      T.setPhase(shot.phase, { rate: shot.rate ?? 0 });
      if (shot.speed) T.speed(shot.speed);
      if (shot.rain) T.rain(shot.rain);
      if (shot.moon !== undefined) T.moon(shot.moon);
      if (shot.stand) T.stand(shot.stand.x, shot.stand.clouds);
      if (shot.obstacles === false) T.obstacles(false);
      if (shot.pterodactyls === false) T.pterodactyls(false);
      if (shot.raptorAt !== undefined) T.raptorAt(shot.raptorAt);
      if (shot.score) T.score(shot.score);
    },
    { shot: { ...shot, setup: undefined, beats: undefined } },
  );
  for (const run of shot.setup ?? []) await run(page);
  await page.evaluate(({ ms, dt }) => window.__trailer.advance(ms, dt), {
    ms: shot.lead * 1000,
    dt: 1000 / FPS,
  });
}

const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);

/**
 * Scripted pointer after a game over: a drawn arrow (headless screenshots
 * show no system cursor) eases from `from` (viewport fractions) to the
 * button named `target`, while real mouse events move with it so hover and
 * press styles fire, then clicks. Returns the click point on the click frame.
 */
async function moveCursor(page, c, state, sinceGameOver) {
  const t = sinceGameOver - c.start;
  if (t < 0) return null;
  if (!state.box) {
    state.box = await page.getByRole("button", { name: c.target, exact: true }).boundingBox();
    if (!state.box) throw new Error(`cursor target "${c.target}" not found`);
    await page.evaluate(() => {
      const el = document.createElement("div");
      el.id = "trailer-cursor";
      el.style.cssText =
        "position:fixed;left:0;top:0;width:34px;height:46px;z-index:2147483647;" +
        "pointer-events:none;transform-origin:4px 4px;transition:none;" +
        "filter:drop-shadow(0 3px 4px rgba(0,0,0,.45))";
      el.innerHTML =
        '<svg viewBox="0 0 24 32" width="34" height="46"><path d="M2 2 L2 26 L8.5 20 L13 30 L17 28 L12.5 18.5 L21 18.5 Z" fill="#fff" stroke="#111" stroke-width="2" stroke-linejoin="round"/></svg>';
      document.body.appendChild(el);
    });
  }
  const { width, height } = VIEWPORT;
  const [fx, fy] = [c.from[0] * width, c.from[1] * height];
  const tx = state.box.x + state.box.width * 0.55;
  const ty = state.box.y + state.box.height * 0.55;
  const k = easeInOut(Math.min(1, t / c.duration));
  const x = fx + (tx - fx) * k;
  const y = fy + (ty - fy) * k;
  await page.mouse.move(x, y);
  const pressed = t >= c.click && t < c.click + 0.12;
  await page.evaluate(
    ({ x, y, pressed }) => {
      const el = document.getElementById("trailer-cursor");
      el.style.left = `${x - 4}px`;
      el.style.top = `${y - 4}px`;
      el.style.transform = pressed ? "scale(0.86)" : "scale(1)";
    },
    { x, y, pressed },
  );
  if (t >= c.click && !state.clicked) {
    state.clicked = true;
    await page.mouse.down();
    return { x: Math.round(x), y: Math.round(y) };
  }
  if (state.clicked && !state.released && t >= c.click + 0.12) {
    state.released = true;
    await page.mouse.up();
  }
  return null;
}

/** Step + capture `seconds` of footage, firing beats on their frame. */
async function record(page, shot, file) {
  const cdp = await page.context().newCDPSession(page);
  const ffmpeg = spawn(
    "ffmpeg",
    [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "image2pipe",
      "-framerate",
      String(FPS),
      "-c:v",
      "mjpeg",
      "-i",
      "-",
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-crf",
      "14",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      file,
    ],
    { stdio: ["pipe", "inherit", "inherit"] },
  );
  const done = new Promise((res, rej) => {
    ffmpeg.on("error", rej);
    ffmpeg.on("close", (code) => (code === 0 ? res() : rej(new Error(`ffmpeg exited ${code}`))));
  });
  // Handled here so an encoder that dies mid-take (killed from outside)
  // fails this attempt, which is then retried, instead of the whole run.
  let encoderError = null;
  done.catch((err) => {
    encoderError = err;
  });
  ffmpeg.stdin.on("error", (err) => {
    encoderError = err;
  });

  const frames = Math.round((SECONDS ?? shot.seconds) * FPS);
  const pending = [...(shot.beats ?? [])].sort((a, b) => a.at - b.at);
  // Gameplay events by clip second, saved next to the clip so sound
  // effects in the edit file can land on the exact pickup or strike.
  const events = [];
  const last = {};
  let gameOverAt = null;
  const pointer = shot.cursor ? { box: null, clicked: false, released: false } : null;
  const pose = []; // per frame: [run-cycle frame, height above ground]
  try {
    for (let f = 0; f < frames; f++) {
      const t = f / FPS;
      while (pending.length && pending[0].at <= t) await pending.shift().run(page);
      const ev = await withTimeout(
        page.evaluate((dt) => window.__trailer.step(dt), 1000 / FPS),
        30000,
        `step to frame ${f}`,
      );
      if (ev) {
        pose.push([ev.frame, ev.air]);
        if (ev.over && !last.over) {
          events.push({ t: Number(t.toFixed(3)), kind: "gameover" });
          gameOverAt = t;
        }
        if (ev.grass !== !!last.grass && f > 0) {
          events.push({ t: Number(t.toFixed(3)), kind: ev.grass ? "field-on" : "field-off" });
        }
        last.grass = ev.grass;
        if (ev.clip && !last.clip) {
          events.push({
            t: Number(t.toFixed(3)),
            kind: "clip",
            what: ev.clip,
            air: ev.air,
            speed: ev.speed,
          });
        }
        last.clip = ev.clip;
        last.over = ev.over;
        for (const kind of ["coins", "jumps", "strikes"]) {
          if (last[kind] !== undefined && ev[kind] > last[kind])
            events.push({ t: Number(t.toFixed(3)), kind });
          last[kind] = ev[kind];
        }
      }
      if (pointer && gameOverAt !== null) {
        const click = await moveCursor(page, shot.cursor, pointer, t - gameOverAt);
        if (click) events.push({ t: Number(t.toFixed(3)), kind: "click", ...click });
      }
      const { data } = await withTimeout(
        cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 95, optimizeForSpeed: true }),
        30000,
        `screenshot of frame ${f}`,
      );
      if (encoderError) throw encoderError;
      if (!ffmpeg.stdin.write(Buffer.from(data, "base64"))) {
        await Promise.race([
          new Promise((r) => ffmpeg.stdin.once("drain", r)),
          done.catch(() => {}),
        ]);
      }
    }
  } catch (err) {
    ffmpeg.kill("SIGKILL");
    await cdp.detach().catch(() => {});
    throw err;
  }
  ffmpeg.stdin.end();
  await done;
  await cdp.detach();
  await writeFile(file.replace(/\.mp4$/, ".events.json"), `${JSON.stringify(events, null, 1)}\n`);
  await writeFile(file.replace(/\.mp4$/, ".pose.json"), `${JSON.stringify({ fps: FPS, pose })}\n`);
  return frames;
}

/** FNV-1a hash of the slug, used as the shot's random seed. */
function seedFor(slug) {
  let h = 0x811c9dc5;
  for (const c of slug) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
  return h >>> 0;
}

function printList() {
  console.log(`\nTrailer shots — ${VIEWPORT.width}x${VIEWPORT.height} @ ${FPS} fps → ${OUT}\n`);
  for (const [i, s] of SHOTS.entries()) {
    const extras = [s.outfit?.join("+"), s.rain && `rain ${s.rain}`].filter(Boolean).join(", ");
    console.log(
      `  ${String(i + 1).padStart(2, "0")}-${s.slug}  ${SECONDS ?? s.seconds}s${extras ? `  ${extras}` : ""}`,
    );
    console.log(`      ${s.describe}`);
  }
  console.log("");
}

async function main() {
  if (hasFlag("list")) {
    printList();
    return;
  }
  const only = flagValue("shots")
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const shots = SHOTS.map((shot, index) => ({ shot, index })).filter(
    ({ shot }) => !only || only.includes(shot.slug),
  );
  if (shots.length === 0)
    throw new Error(`--shots matched nothing. Known: ${SHOTS.map((s) => s.slug).join(", ")}`);

  await mkdir(OUT, { recursive: true });
  console.log(`Base URL: ${BASE}\nOutput:   ${OUT}\nFPS:      ${FPS}`);

  // Same browser as pnpm test:browser: the installed Chrome when present
  // (new headless mode, no window), else Playwright's bundled Chromium.
  const browser = await chromium.launch({
    headless: true,
    args: ["--mute-audio", "--window-size=1920,1080", "--hide-scrollbars"],
    ...(existsSync(CHROME) ? { executablePath: CHROME } : {}),
  });
  try {
    for (const { shot, index } of shots) {
      // A take can stall inside headless Chrome (a screenshot that never
      // returns); it then times out and is recorded again from scratch.
      let done = false;
      for (let attempt = 1; attempt <= 3 && !done; attempt++) {
        // Fresh context per shot: empty localStorage, so every take starts
        // from the same new save.
        const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
        await context.addInitScript(
          (seed) => {
            localStorage.setItem("raptor-runner:muted", "1");
            // mulberry32: same slug, same cacti, clouds and bolts every take.
            let a = seed >>> 0;
            // Reseeded just before the run starts: how many frames load-time
            // pumping draws from the stream depends on wall time.
            window.__reseed = () => {
              a = seed >>> 0;
            };
            Math.random = () => {
              a = (a + 0x6d2b79f5) >>> 0;
              let t = a;
              t = Math.imul(t ^ (t >>> 15), t | 1);
              t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
              return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
            };
          },
          seedFor(shot.seed ?? shot.slug),
        );
        const page = await context.newPage();
        page.on("pageerror", (e) => console.warn(`  [page error] ${shot.slug}: ${e.message}`));
        const started = Date.now();
        try {
          await withTimeout(stage(page, shot), 300000, `staging ${shot.slug}`);
          const file = `${OUT}/${String(index + 1).padStart(2, "0")}-${shot.slug}.mp4`;
          const frames = await record(page, shot, file);
          const info = await page.evaluate(() => window.__trailer.info());
          const secs = ((Date.now() - started) / 1000).toFixed(0);
          console.log(
            `  ✓ ${relative(process.cwd(), file)} (${frames} frames, ${secs}s wall; coins ${info.coins}, rain ${info.rain.toFixed(2)}${info.rainbow ? ", rainbow" : ""})`,
          );
          done = true;
        } catch (err) {
          if (attempt === 3) throw err;
          console.warn(`  ! ${shot.slug}: ${err.message}; retrying (${attempt}/3)`);
        } finally {
          await context.close().catch(() => {});
        }
      }
    }
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
