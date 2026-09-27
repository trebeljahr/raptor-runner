import { defineConfig } from "vitest/config";

/*
 * Vitest configuration.
 *
 * - happy-dom environment so tests can touch window.localStorage, window,
 *   document, and (eventually) a minimal canvas. Faster than jsdom; enough
 *   for the pure-logic + persistence tests we're writing now.
 * - Collocated tests: src/**\/*.test.ts lives next to the module under test.
 * - Coverage via v8 (Node's built-in profiler) — no Babel/Istanbul overhead.
 */
export default defineConfig({
  // Mirror vite.config.ts's compile-time defines so tests can import
  // modules (like src/persistence.ts) that reference them without the
  // global being undefined at runtime. Tests run in a pure-web env,
  // so __IS_CAPACITOR__ is always false here.
  define: {
    __IS_CAPACITOR__: JSON.stringify(false),
  },
  test: {
    environment: "happy-dom",
    // Node 25+ ships a native globalThis.localStorage getter that
    // returns undefined unless --localstorage-file is set. Vitest only
    // copies happy-dom globals onto keys the Node global doesn't
    // already own (localStorage isn't in its override list), so the
    // native getter wins and window.localStorage is undefined. Turning
    // Web Storage off in the workers lets happy-dom's Storage through.
    // No-op on Node 24, where the feature is still opt-in.
    execArgv: ["--no-experimental-webstorage"],
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      reportsDirectory: "coverage",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.d.ts",
        "src/main.ts", // orchestration layer, covered by manual QA
        "src/workers/**", // worker runs inside OffscreenCanvas
      ],
    },
  },
});
