/*
 * App Store screenshots at the exact pixel sizes App Store Connect accepts.
 *
 *   pnpm build && node scripts/store-screenshots.mjs [device ...]
 *
 * Renders the production web build in headless Chrome, drives the
 * cinematic mode (F9) to fixed times of day, weather and cosmetics, and
 * writes landscape PNGs to store-screenshots/<device>/. The canvas is the
 * same one the iOS and Mac apps show; only the browser chrome differs, and
 * none is visible during a run.
 *
 * Devices (landscape, width x height in pixels):
 *   iphone-6.9   2868x1320  required iPhone set (6.9-inch)
 *   ipad-13      2752x2064  required iPad set (13-inch)
 *   mac          2880x1800  Mac App Store (16:10)
 *   iphone-duo-outer 2034x1398, iphone-duo-inner 2853x2007  optional
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { chromium } from "@playwright/test";

const DEVICES = {
  "iphone-6.9": { width: 956, height: 440, scale: 3, touch: true },
  "ipad-13": { width: 1376, height: 1032, scale: 2, touch: true },
  mac: { width: 1440, height: 900, scale: 2, touch: false },
  "iphone-duo-outer": { width: 678, height: 466, scale: 3, touch: true },
  "iphone-duo-inner": { width: 951, height: 669, scale: 3, touch: true },
};

// Keys are the cinematic-mode bindings in src/main.ts (handleCinematicKey).
const SCENES = [
  { name: "01-midday", keys: ["1"] },
  { name: "02-sunset", keys: ["4"] },
  { name: "03-night", keys: ["6"] },
  { name: "04-storm", keys: ["5", "r"], settleMs: 2500, after: ["l"] },
  { name: "05-cosmetics", keys: ["3"], cosmetics: true },
  { name: "06-sunrise", keys: ["9"] },
];

const requested = process.argv.slice(2);
for (const name of requested) {
  if (!DEVICES[name])
    throw new Error(`Unknown device ${name}. Known: ${Object.keys(DEVICES).join(", ")}`);
}
const devices = requested.length ? requested : Object.keys(DEVICES);
if (!existsSync("dist/index.html")) throw new Error("Run pnpm build first.");

async function freePort() {
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = 49152 + Math.floor(Math.random() * 16383);
    const free = await new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.listen(candidate, "127.0.0.1", () => server.close(() => resolve(true)));
    });
    if (free) return candidate;
  }
  throw new Error("No free preview port after three attempts");
}

const port = await freePort();
const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ],
  { stdio: "ignore" },
);
const baseURL = `http://127.0.0.1:${port}/`;
for (let i = 0; ; i++) {
  try {
    if ((await fetch(baseURL)).ok) break;
  } catch {}
  if (i > 100) throw new Error("Preview server did not start");
  await new Promise((r) => setTimeout(r, 100));
}

const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({
  args: ["--mute-audio"],
  ...(existsSync(chrome) ? { executablePath: chrome } : {}),
});
try {
  for (const device of devices) {
    const spec = DEVICES[device];
    const outDir = path.join("store-screenshots", device);
    await mkdir(outDir, { recursive: true });
    for (const scene of SCENES) {
      const context = await browser.newContext({
        viewport: { width: spec.width, height: spec.height },
        deviceScaleFactor: spec.scale,
        hasTouch: spec.touch,
        isMobile: spec.touch,
        serviceWorkers: "block",
      });
      await context.addInitScript((cosmetics) => {
        localStorage.setItem("raptor-runner:muted", "1");
        if (!cosmetics) return;
        // The cinematic H/G/B keys flip legacy flags the renderer no longer
        // reads, so dress the raptor through the save instead.
        localStorage.setItem(
          "raptor-runner:ownedCosmetics",
          JSON.stringify(["party-hat", "thug-glasses", "bow-tie"]),
        );
        localStorage.setItem(
          "raptor-runner:equippedCosmetics",
          JSON.stringify({ head: "party-hat", eyes: "thug-glasses", neck: "bow-tie" }),
        );
      }, !!scene.cosmetics);
      const page = await context.newPage();
      await page.goto(baseURL);
      await page.getByRole("button", { name: "Start Game", exact: true }).waitFor();
      await page.locator("#boot-splash").waitFor({ state: "detached" });
      await page.keyboard.press("F9");
      await page.keyboard.press("m");
      for (const key of scene.keys) await page.keyboard.press(key);
      // Let the run scroll so cacti and dunes are on screen.
      await page.waitForTimeout(scene.settleMs ?? 4000);
      for (const key of scene.after ?? []) await page.keyboard.press(key);
      if (scene.after) await page.waitForTimeout(120);
      const file = path.join(outDir, `${scene.name}.png`);
      await page.screenshot({ path: file });
      console.log(`${file} ${spec.width * spec.scale}x${spec.height * spec.scale}`);
      await context.close();
    }
  }
} finally {
  await browser.close();
  server.kill();
}
