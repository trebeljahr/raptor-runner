import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
const port = process.env.RR_TEST_PORT;
if (!port) throw new Error("Run browser tests with pnpm test:browser");
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 40_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1280, height: 800 },
    serviceWorkers: "block",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: {
      args: ["--mute-audio"],
      ...(existsSync(chrome) ? { executablePath: chrome } : {}),
    },
  },
  webServer: {
    command: `node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
});
