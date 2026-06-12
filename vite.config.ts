import { rmSync } from "node:fs";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { ATTRIBUTION_SECTIONS, renderAttributionHTML } from "./src/credits";

// Build target selector. `VITE_TARGET=capacitor npm run build` produces
// the native-mobile bundle: the PWA service worker is skipped (Workbox's
// navigateFallback conflicts with the capacitor:// scheme) and only the
// main HTML entry is emitted (about/imprint become in-app overlays on
// mobile, not separate navigable pages).
// `VITE_TARGET=electron` produces the desktop bundle: relative asset
// paths (because the packaged app loads via file://, where a vite-
// injected `/assets/...` resolves to the filesystem root and 404s) and
// no PWA (service workers don't register under file:// anyway).
const TARGET = process.env.VITE_TARGET ?? "web";
const IS_CAPACITOR = TARGET === "capacitor";
const IS_ELECTRON = TARGET === "electron";
const USE_RELATIVE_BASE = IS_CAPACITOR || IS_ELECTRON;

/**
 * Build-time injection of the shared credits/attributions into
 * index.html (credits overlay) and imprint.html (Credits & Asset
 * Sources block). Both pages ship as plain static HTML — no runtime
 * module has to execute for the attributions to appear, so the
 * content is crawlable and doesn't flash in on page load.
 *
 * Source of truth: src/credits.ts. Change an entry there and both
 * pages pick it up on the next build.
 *
 * Runs in dev (transformIndexHtml fires on every served HTML request)
 * and in prod (runs once per emitted HTML).
 */
function creditsBuildInjectPlugin(): Plugin {
  const overlayHTML = renderAttributionHTML(ATTRIBUTION_SECTIONS);
  const imprintHTML = renderAttributionHTML(ATTRIBUTION_SECTIONS, {
    // Imprint nests the attribution subsections under the existing
    // "Credits & Asset Sources" <h2>, so we emit <h3>s underneath.
    headingLevel: "h3",
    // No <section class="credits-section"> wrapper — the imprint's
    // CSS styles headings and lists directly.
    sectionWrap: false,
    // The imprint's <ul> elements have no class; they inherit the
    // default page styling defined in the imprint's <style> block.
    listClass: null,
    // Match the inline style the original handwritten <h3>s used.
    headingInlineStyle: "font-size: 1rem; margin-top: 1rem; margin-bottom: 0.3rem; color: #222;",
    // Keep single-item sections (Music, Engine & code) as <ul><li> so
    // the imprint's bullet styling stays consistent across sections.
    listAlways: true,
  });

  const OVERLAY_MARKER = '<div id="credits-attribution-sections"></div>';
  const IMPRINT_MARKER = '<div id="imprint-attribution-sections"></div>';

  return {
    name: "credits-build-inject",
    // Run before vite's built-in HTML processing so downstream plugins
    // see the final markup.
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        const name = ctx.filename;
        if (name.endsWith("imprint.html")) {
          return html.replace(
            IMPRINT_MARKER,
            `<div id="imprint-attribution-sections">${imprintHTML}</div>`,
          );
        }
        if (name.endsWith("index.html")) {
          return html.replace(
            OVERLAY_MARKER,
            `<div id="credits-attribution-sections">${overlayHTML}</div>`,
          );
        }
        return html;
      },
    },
  };
}

/**
 * The press-kit screenshots in public/press/ are web-only content:
 * Capacitor and Electron don't even emit the pages that reference
 * them, but Vite copies publicDir wholesale, which would add ~2.5 MB
 * to every native package. Prune the copied directory from native
 * bundles after the build writes out.
 */
function pruneNativePressAssetsPlugin(): Plugin {
  return {
    name: "prune-native-press-assets",
    apply: "build",
    closeBundle() {
      if (!USE_RELATIVE_BASE) return;
      rmSync(resolve(__dirname, "dist", "press"), {
        recursive: true,
        force: true,
      });
    },
  };
}

export default defineConfig({
  // Capacitor and Electron both load the bundle off a non-http(s)
  // scheme (capacitor:// and file:// respectively), so vite-injected
  // absolute paths like `/assets/main-*.js` don't resolve. On the web
  // we keep "/" so the service worker and the hosted site continue to
  // work unchanged.
  base: USE_RELATIVE_BASE ? "./" : "/",
  define: {
    // Compile-time flag so gameplay code can branch on mobile without
    // pulling in any Capacitor symbols at import time.
    __IS_CAPACITOR__: JSON.stringify(IS_CAPACITOR),
  },
  server: {
    // Narrow the file-watcher to source files only. Without this,
    // Vite reloads the page every time we save a shell script, the
    // package.json, the Android/iOS native projects, or the Electron
    // main — none of which affect the running page. The repo-wide
    // watcher was also wasting inotify slots on two sibling worktrees.
    watch: {
      ignored: [
        "**/android/**",
        "**/ios/**",
        "**/electron/**",
        "**/scripts/**",
        "**/release/**",
        "**/dist/**",
        "**/.claude/**",
        "**/node_modules/**",
      ],
    },
  },
  plugins: [
    creditsBuildInjectPlugin(),
    pruneNativePressAssetsPlugin(),
    react(),
    tailwindcss(),
    // The PWA service worker is web-only. Skipped on Capacitor to
    // avoid a Workbox navigateFallback vs. capacitor:// scheme
    // conflict that otherwise serves a stale /index.html, and on
    // Electron because service workers don't register under file://
    // (the injected registerSW.js just 404s and adds noise).
    ...(USE_RELATIVE_BASE
      ? []
      : [
          VitePWA({
            registerType: "autoUpdate",
            injectRegister: "auto",
            manifest: {
              name: "Raptor Runner",
              short_name: "Raptor",
              description:
                "A pixel-art homage to the Chrome 'No Internet' dinosaur game, with a full day/night cycle and a starry sky.",
              start_url: "/",
              scope: "/",
              display: "standalone",
              orientation: "landscape",
              background_color: "#50b4cd",
              theme_color: "#50b4cd",
              categories: ["games", "entertainment"],
              icons: [
                {
                  src: "assets/icon-192.png",
                  sizes: "192x192",
                  type: "image/png",
                  purpose: "any",
                },
                {
                  src: "assets/icon-192.png",
                  sizes: "192x192",
                  type: "image/png",
                  purpose: "maskable",
                },
                {
                  src: "assets/icon-512.png",
                  sizes: "512x512",
                  type: "image/png",
                  purpose: "any",
                },
                {
                  src: "assets/icon-512.png",
                  sizes: "512x512",
                  type: "image/png",
                  purpose: "maskable",
                },
                {
                  src: "assets/apple-touch-icon.png",
                  sizes: "180x180",
                  type: "image/png",
                  purpose: "any",
                },
              ],
            },
            workbox: {
              globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest,mp3}"],
              // PWA manifest icons are injected separately by vite-plugin-pwa
              // (without a __WB_REVISION__ query). If the glob scan also picks
              // them up it adds a second entry WITH revision, and Workbox's
              // addToCacheList refuses the conflict. Excluding them here lets
              // the manifest-side injection be the only source of truth.
              // press/ holds the full-res press-kit screenshots (~2.5 MB) —
              // keep them out of the precache so installing the PWA doesn't
              // download marketing assets the game never loads.
              globIgnores: [
                "**/icon-192.png",
                "**/icon-512.png",
                "**/apple-touch-icon.png",
                "press/**",
              ],
              navigateFallback: "/index.html",
              // Standalone pages and direct navigations to press images
              // must bypass the SPA fallback, otherwise the service worker
              // serves the game shell instead.
              navigateFallbackDenylist: [
                /^\/about\.html$/,
                /^\/imprint\.html$/,
                /^\/landing\.html$/,
                /^\/press\.html$/,
                /^\/privacy\.html$/,
                /^\/press\//,
              ],
              cleanupOutdatedCaches: true,
              skipWaiting: true,
              clientsClaim: true,
              // Audio files and large images — allow larger precache entries
              maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
            },
            devOptions: {
              enabled: false,
            },
          }),
        ]),
  ],
  build: {
    rollupOptions: {
      // On mobile we only ship the main entry — about/imprint become
      // in-app overlays. Desktop additionally gets the pages its
      // in-game overlays iframe (about/imprint) plus privacy; the
      // marketing pages (landing/press) are web-only since they
      // reference the press screenshots that native builds prune.
      // On the web we keep everything as separate pages so the
      // existing navigation and SEO remain unchanged.
      input: IS_CAPACITOR
        ? {
            main: resolve(__dirname, "index.html"),
          }
        : IS_ELECTRON
          ? {
              main: resolve(__dirname, "index.html"),
              about: resolve(__dirname, "about.html"),
              imprint: resolve(__dirname, "imprint.html"),
              privacy: resolve(__dirname, "privacy.html"),
            }
          : {
              main: resolve(__dirname, "index.html"),
              about: resolve(__dirname, "about.html"),
              imprint: resolve(__dirname, "imprint.html"),
              landing: resolve(__dirname, "landing.html"),
              press: resolve(__dirname, "press.html"),
              privacy: resolve(__dirname, "privacy.html"),
            },
    },
  },
  worker: {
    format: "es",
  },
});
