/*
 * Raptor Runner — UI chrome module.
 *
 * Start screen, menu overlay, imprint/about/credits/achievements
 * overlays, sound toggle, cog button, landscape guard, keyboard
 * shortcuts, score-display ticker, share-your-score flow. Talks to
 * the game layer exclusively through the public `window.Game` API
 * defined in src/main.ts. No direct references to canvas / audio /
 * state internals live here.
 *
 * Lifted out of an inline <script> block in index.html so that
 * index.html's Content-Security-Policy can drop 'unsafe-inline'
 * from script-src. The underlying behaviour is unchanged; the only
 * surgery on the way out was:
 *   - remove the IIFE wrapper (module scope covers the same need)
 *   - replace literal "%VITE_STEAM_STORE_URL%" with
 *     `import.meta.env.VITE_STEAM_STORE_URL` so Vite's normal env
 *     substitution handles it instead of the bespoke HTML-level
 *     replacement that was never actually plumbed in
 *
 * The whole module is now type-checked under strict mode. The cross-
 * module bridges (window.Game, window.__rr*, window.__onStartKey)
 * are typed in src/window.d.ts. Game-API consumers capture
 * `const game = window.Game; if (!game) return;` at the top of
 * any handler that depends on it — by the time those run, the
 * onReady gate has fired, but the capture keeps TypeScript honest.
 */

import { REDUCE_MOTION_VALUES, TEXT_SCALE_PRESETS } from "./constants";
import {
  type AccessibilitySettingsCallbacks,
  refreshAccessibilitySettings,
} from "./ui/react/mountAccessibilitySettings";
import { refreshAchievements } from "./ui/react/mountAchievements";
import { refreshCosmeticsMenu } from "./ui/react/mountCosmeticsMenu";
import { refreshCredits } from "./ui/react/mountCredits";
import { refreshDebugSettings } from "./ui/react/mountDebugSettings";
import { refreshAboutOverlay, refreshImprintOverlay } from "./ui/react/mountIframeOverlay";
import { refreshMenuList } from "./ui/react/mountMenuList";
import { refreshScoreCardActions } from "./ui/react/mountScoreCardActions";
import { refreshShop } from "./ui/react/mountShop";
import { refreshSoundSettings } from "./ui/react/mountSoundSettings";
import { refreshStartScreen } from "./ui/react/mountStartScreen";

// Desktop "challenge a friend" store-link. Sourced from a Vite env
// var; falls back to the web URL when not set. The env name is
// store-neutral now — use VITE_DESKTOP_STORE_URL pointing at whichever
// store channel ships the build (itch.io, Steam, App Store once
// released). The legacy VITE_STEAM_STORE_URL is still honoured as a
// fallback so existing .env.local overrides keep working.
const STEAM_STORE_URL: string =
  import.meta.env.VITE_DESKTOP_STORE_URL ||
  import.meta.env.VITE_STEAM_STORE_URL ||
  "https://raptor.trebeljahr.com";

// These four elements are required by index.html and are present
// before this module runs (the script is loaded after the elements
// in the markup, and the start screen / menu overlay / cog / sound
// toggle are static structural chrome that never get torn down).
// Failing fast with `!` here keeps the rest of the module readable
// at the use sites.
const cog = document.getElementById("settings-cog")!;
const overlay = document.getElementById("menu-overlay")!;

// The top block of menu-item buttons — Steam Friends, Steam Store,
// Quit, Fullscreen — all live inside the React <MenuList> component
// now. Their click handlers are defined below in MENU_LIST_CALLBACKS
// and routed through the callback props. The fullscreen label state
// lives in this module so the Electron main-process IPC round-trip
// stays synchronous from the React component's POV: the label reads
// a local cache that refreshFullscreenState() updates on menu-open.

let fullscreenState = true; // mirror of Electron window state
async function refreshFullscreenState() {
  if (!window.electronAPI || typeof window.electronAPI.isFullscreen !== "function") {
    return;
  }
  try {
    fullscreenState = !!(await window.electronAPI.isFullscreen());
    syncMenuList();
  } catch (_) {}
}

function handleQuitClick() {
  if (window.electronAPI && typeof window.electronAPI.quit === "function") {
    window.electronAPI.quit().catch((err: unknown) => {
      console.warn("Quit IPC failed:", err);
      try {
        window.close();
      } catch {
        /* noop */
      }
    });
    return;
  }
  try {
    window.close();
  } catch {
    /* noop */
  }
}

async function handleFullscreenClick() {
  if (!window.electronAPI || typeof window.electronAPI.setFullscreen !== "function") {
    return;
  }
  try {
    fullscreenState = !!(await window.electronAPI.setFullscreen(!fullscreenState));
    syncMenuList();
    // The fullscreen transition churns the window and on some
    // Electron versions silently drops focus to <body>. Restore
    // focus to the rendered button so the gamepad / keyboard user
    // keeps their menu position. Look the button up by label text
    // because React may have remounted the element during the
    // syncMenuList() above — caching a stale reference would leak
    // into nothing.
    requestAnimationFrame(() => {
      const btn = Array.from(document.querySelectorAll<HTMLElement>(".menu-panel .menu-item")).find(
        (el) => el.textContent?.includes("Fullscreen"),
      );
      if (btn) focusKbd(btn);
    });
  } catch (_) {}
}
const topSoundBtn = document.getElementById("sound-toggle")!;
const fullscreenBtn = document.getElementById("fullscreen-toggle");
const imprintOverlay = document.getElementById("imprint-overlay")!;
const aboutOverlay = document.getElementById("about-overlay");
// Iframe src is lazily flipped from "about:blank" on first open —
// ui.ts holds the flag, the React component reads the current value
// via the iframeSrc prop.
let aboutIframeSrc = "about:blank";
let imprintIframeSrc = "about:blank";
let aboutLoaded = false;
const achievementsOverlay = document.getElementById("achievements-overlay");
const startScreen = document.getElementById("start-screen")!;
let imprintLoaded = false;
let assetsReady = false;

// The start button lives inside the React <StartScreen> component, so
// we look it up by id whenever we need to touch it (the rendered
// element is stable across re-renders because the id doesn't change,
// but capturing a module-level reference at parse time would race
// the React mount). Used by the tap-animation toggle + the initial
// boot sync so keyboard / click paths both replay the same keyframes.
function getStartBtn() {
  return document.getElementById("start-btn");
}

const START_SCREEN_CALLBACKS = {
  onStart: () => triggerStart(),
  getHighScore: () => window.Game?.getHighScore?.() || 0,
  getAssetsReady: () => assetsReady,
};

function syncStartScreen() {
  refreshStartScreen(START_SCREEN_CALLBACKS);
}

// ───────── Boot splash fade-out ─────────
function hideBootSplash() {
  const el = document.getElementById("boot-splash");
  if (!el) return;
  el.classList.add("fade-out");
  const remove = () => {
    if (el.parentNode) el.parentNode.removeChild(el);
  };
  el.addEventListener("transitionend", remove, { once: true });
  // Failsafe in case transitionend never fires
  setTimeout(remove, 1500);
}

// ───────── Start screen ─────────
function onGameReady() {
  assetsReady = true;
  hideBootSplash();
  // Flip the React <StartScreen> from loading to ready. The button's
  // label / disabled / class all follow assetsReady + getHighScore()
  // — no imperative label poke needed.
  syncStartScreen();
  // No auto-focus here — the pulse animation is enough of an
  // attention cue, and auto-focusing on launch put the button
  // in its sky-blue hover state before the user had interacted.
  // The button still takes keyboard focus naturally the moment
  // the player hits Tab / Enter / Space.

  // window.Game is guaranteed assigned by the time onReady fires —
  // main.ts sets it before invoking the ready callback. Capturing it
  // locally satisfies TS's narrowing inside the event-handler closures
  // below without sprinkling optional chains everywhere.
  const game = window.Game;
  if (!game) return;

  // Wire the share panel to the game's onGameOver /
  // onGameReset events now that the API is ready.
  if (game.onGameOver) {
    game.onGameOver(showScoreCard);
    game.onGameReset(hideScoreCard);
  }
  // Achievement toasts.
  if (game.onAchievementUnlock) {
    game.onAchievementUnlock(showAchievementToast);
  }

  // Initial sync of the start-screen raptor cosmetics with
  // whatever the player has unlocked + toggled on.
  refreshStartRaptorCosmetics();
  // Sync the sound button with the actual mute state now
  // that the Game API is fully loaded.
  refreshSoundUI();
  // Accessibility rows read persisted values through window.Game —
  // repaint them now that those values are hydrated.
  syncAccessibilityUI();

  // If the user previously chose to have sound on, try to
  // start music immediately. Browsers may block autoplay
  // without a user gesture — that's fine, the first click
  // anywhere will unlock it via the interaction handlers.
  if (game.hasSavedMutePreference?.() && !game.isMuted()) {
    // Re-apply the unmuted state to trigger music.play()
    game.setMuted(false);
  }
}
// The game module (main.ts) calls Game.onReady(cb) when assets
// are loaded. Guard in case it hasn't parsed yet.
function registerReady() {
  if (window.Game && typeof window.Game.onReady === "function") {
    window.Game.onReady(onGameReady);
  } else {
    // main.ts may still be loading (it's deferred) — retry soon.
    setTimeout(registerReady, 30);
  }
}
registerReady();

// ───────── Live score readout (DOM) ─────────
const scoreDisplay = document.getElementById("score-display");
const scoreValueEl = document.getElementById("score-value");
const scoreCoinValueEl = document.getElementById("score-coin-value");
let displayedScore = 0;
let displayedCoins = 0;
let lastAriaScore = -1;
let lastAriaCoins = -1;
let scoreLoopRunning = false;
// When true, scoreLoop stops auto-tracking getRunCoins() so the
// game-over fill animation can drain the HUD counter down to 0 in
// sync with the end-card balance filling up. Cleared when the fill
// completes or the HUD is next shown fresh.
let coinDrainOverride = false;

function scoreLoop() {
  if (!scoreLoopRunning) return;
  const game = window.Game;
  if (game?.getScore) {
    const target = game.getScore();
    const diff = target - displayedScore;
    if (Math.abs(diff) > 0.01) {
      // Ease toward target at ~18% per 60fps frame. Under
      // 0.5 away, snap so the final value is exact.
      displayedScore += diff * 0.18;
      if (Math.abs(target - displayedScore) < 0.5) {
        displayedScore = target;
      }
      if (scoreValueEl) scoreValueEl.textContent = String(Math.floor(displayedScore));
    }
    // Update the aria-label only when the REAL score
    // changes, not on every tween frame, so assistive
    // tech doesn't get spammed with intermediate values.
    if (target !== lastAriaScore && scoreDisplay) {
      const coinsForLabel = game.getCoinsBalance?.() ?? 0;
      scoreDisplay.setAttribute("aria-label", `Score: ${target} meters, ${coinsForLabel} coins`);
      lastAriaScore = target;
      lastAriaCoins = coinsForLabel;
    }
  }
  // HUD coin counter — per-run coins collected (reset at run start).
  // The persistent balance lives on the game-over card and the shop;
  // the HUD shows what you earned THIS run so the number feels owned
  // by the current attempt. Tweens independently from the score so a
  // pickup pop reads as a quick count-up instead of snapping.
  // Skip this chase entirely while the game-over fill is draining
  // the HUD — that animation writes to the element directly, and
  // re-chasing getRunCoins() would instantly undo each drain step.
  if (!coinDrainOverride && game && game.getRunCoins && scoreCoinValueEl) {
    const target = game.getRunCoins();
    const diff = target - displayedCoins;
    if (Math.abs(diff) > 0.01) {
      displayedCoins += diff * 0.22;
      if (Math.abs(target - displayedCoins) < 0.5) displayedCoins = target;
      scoreCoinValueEl.textContent = String(Math.floor(displayedCoins));
    }
    if (target !== lastAriaCoins && scoreDisplay && lastAriaScore >= 0) {
      scoreDisplay.setAttribute(
        "aria-label",
        `Score: ${lastAriaScore} meters, ${target} coins this run`,
      );
      lastAriaCoins = target;
    }
  }
  requestAnimationFrame(scoreLoop);
}
function showScoreDisplay() {
  displayedScore = 0;
  // Per-run coins start at 0 each run — HUD opens on 0 and ticks
  // up with pickups, no stale carry-over from the prior attempt.
  displayedCoins = window.Game?.getRunCoins?.() ?? 0;
  // Fresh run → hand the HUD back to scoreLoop's auto-chase. The
  // previous game-over's drain leaves the override pinned so the
  // HUD stays at 0 while the card is up; this is the release point.
  coinDrainOverride = false;
  if (scoreValueEl) scoreValueEl.textContent = "0";
  if (scoreCoinValueEl) scoreCoinValueEl.textContent = String(displayedCoins);
  if (scoreDisplay) scoreDisplay.hidden = false;
  if (!scoreLoopRunning) {
    scoreLoopRunning = true;
    requestAnimationFrame(scoreLoop);
  }
}
function hideScoreDisplay() {
  if (scoreDisplay) scoreDisplay.hidden = true;
  displayedScore = 0;
  displayedCoins = 0;
  if (scoreValueEl) scoreValueEl.textContent = "0";
  if (scoreCoinValueEl) scoreCoinValueEl.textContent = "0";
  scoreLoopRunning = false;
}

function startGame() {
  const game = window.Game;
  if (!assetsReady || !game || game.isStarted()) return;
  // The click/keypress is a user gesture — unlock the Web Audio
  // context and re-apply the mute state so music starts if
  // the user previously chose to have sound on.
  if (game.unlockAudio) game.unlockAudio();
  // Desktop default: if the player has never saved a mute
  // preference, start unmuted. Web default stays muted (to
  // respect browser autoplay expectations — a web page
  // blasting music on open is unexpected). Desktop games are
  // expected to play sound out of the box.
  if (
    window.electronAPI?.isDesktop &&
    game.hasSavedMutePreference &&
    !game.hasSavedMutePreference() &&
    game.setMuted
  ) {
    game.setMuted(false);
  } else if (game.setMuted) {
    game.setMuted(game.isMuted());
  }
  refreshSoundUI();
  // Hide the start screen first, then tell the game to run.
  startScreen.classList.add("hidden");
  game.start();
  showScoreDisplay();
}

// Start button wrapper. Uses the shared click-feedback system
// (same tap sound + scale-down wiggle as every menu button and
// the play-again button) rather than a bespoke playClick +
// start-btn-wiggle pair. Keeps the entire UI consistent.
// Gated on the settings menu being closed so a stray Space-
// fired click on Start never bypasses an open modal.
function triggerStart() {
  if (overlay.classList.contains("open")) return;
  const game = window.Game;
  if (!assetsReady || !game || game.isStarted()) return;
  game.playMenuTap?.();
  // Retrigger-safe: remove + force reflow + re-add so rapid
  // keyboard repeats still replay the animation cleanly. The
  // button is rendered by React, so look it up fresh each call
  // instead of capturing a stale reference.
  const btn = getStartBtn();
  if (btn) {
    btn.classList.remove("tapped");
    void btn.offsetWidth;
    btn.classList.add("tapped");
    window.setTimeout(() => {
      const b = getStartBtn();
      b?.classList.remove("tapped");
    }, 200);
  }
  startGame();
}
// The start button's own onClick goes through the React component
// (StartScreen.tsx) and delegates to triggerStart via START_SCREEN_CALLBACKS.
// Expose a hook so the main.ts keydown handler can trigger
// Start Game from Space/Enter on the start screen.
window.__onStartKey = triggerStart;

// ───────── Landscape guard ─────────
const isLikelyTouchDevice = () =>
  window.matchMedia("(pointer: coarse)").matches || window.navigator.maxTouchPoints > 0;
const isMobileDevice = () =>
  isLikelyTouchDevice() && Math.min(window.innerWidth, window.innerHeight) <= 1200;
const isMobilePortrait = () => isMobileDevice() && window.innerHeight > window.innerWidth;

function refreshRotateGuard() {
  document.body.classList.toggle("needs-rotate", isMobilePortrait());
}
refreshRotateGuard();
window.addEventListener("resize", refreshRotateGuard);
window.addEventListener("orientationchange", refreshRotateGuard);

// ───────── Imprint overlay ─────────
// The sheet is rendered by <IframeOverlay>. Lazy iframe src: the
// page isn't fetched until the user actually wants to see it.
function openImprint() {
  if (!imprintLoaded) {
    imprintIframeSrc = "imprint.html";
    imprintLoaded = true;
  }
  refreshImprintOverlay({
    callbacks: { onClose: closeImprint },
    iframeSrc: imprintIframeSrc,
  });
  imprintOverlay.classList.add("open");
  window.Game?.pause();
}
function closeImprint() {
  imprintOverlay.classList.remove("open");
  // Every path into the imprint overlay goes through the
  // settings menu (cog → Imprint). When the player hits
  // "back" (× / Esc / B-button) they expect to land back on
  // the menu — not be dumped into the live game with no way
  // to retrace their steps. openMenu() handles the Game.pause
  // side-effect, so no explicit resume is needed here.
  openMenu();
}
imprintOverlay.addEventListener("click", (e) => {
  if (e.target === imprintOverlay) closeImprint();
});

// ───────── About overlay ─────────
// Same iframe pattern as imprint — lazy src assignment on
// first open, hidden in-frame "Back to the game" link,
// pauses the game while visible.
function openAbout() {
  if (!aboutLoaded) {
    aboutIframeSrc = "about.html";
    aboutLoaded = true;
  }
  refreshAboutOverlay({
    callbacks: { onClose: closeAbout },
    iframeSrc: aboutIframeSrc,
  });
  aboutOverlay?.classList.add("open");
  if (window.Game?.isStarted?.()) {
    window.Game.pause();
  }
}
function closeAbout() {
  aboutOverlay?.classList.remove("open");
  // Back to the menu we came from. openMenu handles its own
  // pause gating (no-op when the game isn't started).
  openMenu();
}
if (aboutOverlay) {
  aboutOverlay.addEventListener("click", (e) => {
    if (e.target === aboutOverlay) closeAbout();
  });
}

// ───────── Credits overlay ─────────
// Rendered by <Credits> — static content pulled from src/credits.ts
// at runtime, so works identically on web, Electron, and Capacitor.
const creditsOverlay = document.getElementById("credits-overlay");
function openCredits() {
  if (!creditsOverlay) return;
  refreshCredits({ onClose: closeCredits });
  creditsOverlay.classList.add("open");
  if (window.Game?.isStarted?.()) {
    window.Game.pause();
  }
}
function closeCredits() {
  if (!creditsOverlay) return;
  creditsOverlay.classList.remove("open");
  // Credits is only reachable via the menu — re-open it so
  // the "back" affordance (× / Esc / gamepad B) lands the
  // player on the menu they came from, not the live game.
  openMenu();
}
if (creditsOverlay) {
  creditsOverlay.addEventListener("click", (e) => {
    if (e.target === creditsOverlay) closeCredits();
  });
}

// ───────── Achievements overlay ─────────
function openAchievements() {
  refreshAchievements({ onClose: closeAchievements });
  if (achievementsOverlay) achievementsOverlay.classList.add("open");
  if (window.Game?.isStarted?.()) {
    window.Game.pause();
  }
}
function closeAchievements() {
  if (achievementsOverlay) achievementsOverlay.classList.remove("open");
  // Always route back to the menu — that's where every
  // entry into this overlay originates, and the "back"
  // affordance is expected to retrace steps.
  openMenu();
}
if (achievementsOverlay) {
  achievementsOverlay.addEventListener("click", (e) => {
    if (e.target === achievementsOverlay) closeAchievements();
  });
}

// ───────── Sound button ─────────
// The per-channel toggle rows inside the pause menu's sound settings
// are rendered by the React <SoundSettings> component — see
// src/ui/react/SoundSettings.tsx. Labels read live muted state from
// window.Game on every render. We still own the click → Game API
// setter → sync refresh chain here so the component stays a dumb
// renderer and the refresh is centralised (topSoundBtn outside the
// menu also updates on every change).

/** Callbacks passed to <SoundSettings>. Each toggles one channel's
 *  muted flag through the Game API then triggers syncSoundUI() so
 *  every surface that displays that state (the React tree + the
 *  top-right mute button) repaints from the new value. */
const SOUND_SETTINGS_CALLBACKS = {
  onToggleSound: () => {
    if (!window.Game?.setMuted) return;
    window.Game.setMuted(!window.Game.isMuted());
    syncSoundUI();
  },
  onToggleMusic: () => {
    if (!window.Game?.setMusicMuted) return;
    window.Game.setMusicMuted(!window.Game.isMusicMuted());
    syncSoundUI();
  },
  onToggleJumpSound: () => {
    if (!window.Game?.setJumpMuted) return;
    window.Game.setJumpMuted(!window.Game.isJumpMuted());
    syncSoundUI();
  },
  onToggleRainSound: () => {
    if (!window.Game?.setRainMuted) return;
    window.Game.setRainMuted(!window.Game.isRainMuted());
    syncSoundUI();
  },
  onToggleThunder: () => {
    if (!window.Game) return;
    window.Game.setThunderMuted?.(!window.Game.isThunderMuted?.());
    syncSoundUI();
  },
  onToggleFootsteps: () => {
    if (!window.Game) return;
    window.Game.setFootstepsMuted?.(!window.Game.isFootstepsMuted?.());
    syncSoundUI();
  },
  onToggleCoinsSound: () => {
    if (!window.Game) return;
    window.Game.setCoinsMuted?.(!window.Game.isCoinsMuted?.());
    syncSoundUI();
  },
  onToggleUiSound: () => {
    if (!window.Game) return;
    window.Game.setUiMuted?.(!window.Game.isUiMuted?.());
    syncSoundUI();
  },
  onToggleEventsSound: () => {
    if (!window.Game) return;
    window.Game.setEventsMuted?.(!window.Game.isEventsMuted?.());
    syncSoundUI();
  },
};

function syncSoundUI() {
  const muted = window.Game ? window.Game.isMuted() : true;
  topSoundBtn.classList.toggle("muted", muted);
  topSoundBtn.setAttribute("aria-pressed", String(!muted));
  topSoundBtn.setAttribute("aria-label", muted ? "Unmute" : "Mute");
  refreshSoundSettings(SOUND_SETTINGS_CALLBACKS);
}

// Kept for external callers (e.g. the top-right HUD mute button).
function refreshSoundUI() {
  syncSoundUI();
}

function toggleSound() {
  if (!window.Game?.setMuted) return;
  // Ensure Web Audio context is unlocked on this user gesture
  if (window.Game.unlockAudio) window.Game.unlockAudio();
  window.Game.setMuted(!window.Game.isMuted());
  syncSoundUI();
}

// ───────── Accessibility settings ─────────
// Same architecture as the sound settings above, but the rows are
// DATA rather than a fixed component: <AccessibilitySettings> renders
// one control per descriptor in this table, so a future setting
// (volume sliders, colorblind palettes, …) is a new entry here plus
// its Game API pair — no component or markup restructuring. Each
// set() routes through window.Game (which persists) and then
// re-renders so every label/control repaints from the stored value.

/** 0..1 → "85%" readout shared by all volume sliders. */
const formatPercent = (v: number) => `${Math.round(v * 100)}%`;

const ACCESSIBILITY_SETTINGS_CALLBACKS: AccessibilitySettingsCallbacks = {
  rows: [
    {
      kind: "select",
      id: "text-scale",
      label: "Text size",
      options: TEXT_SCALE_PRESETS.map((v) => ({
        value: String(v),
        label: `${Math.round(v * 100)}%`,
      })),
      get: () => {
        // Snap the displayed choice to the nearest preset: the Game
        // setter accepts any value in range (a build that allowed a
        // continuous slider may have stored e.g. 1.2), and a <select>
        // with an unlisted value would render blank.
        const current = window.Game?.getTextScale?.() ?? 1;
        let nearest: number = TEXT_SCALE_PRESETS[0];
        for (const preset of TEXT_SCALE_PRESETS) {
          if (Math.abs(preset - current) < Math.abs(nearest - current)) nearest = preset;
        }
        return String(nearest);
      },
      set: (v: string) => {
        const n = Number.parseFloat(v);
        if (Number.isFinite(n)) window.Game?.setTextScale?.(n);
        syncAccessibilityUI();
      },
    },
    {
      kind: "select",
      id: "reduce-motion",
      label: "Reduce motion",
      options: REDUCE_MOTION_VALUES.map((v) => ({
        value: v,
        label: v.charAt(0).toUpperCase() + v.slice(1),
      })),
      get: () => window.Game?.getReduceMotion?.() ?? "system",
      set: (v: string) => {
        window.Game?.setReduceMotion?.(v);
        syncAccessibilityUI();
      },
    },
    {
      kind: "toggle",
      id: "high-contrast",
      label: "High contrast",
      get: () => window.Game?.isHighContrast?.() === true,
      set: (v: boolean) => {
        window.Game?.setHighContrast?.(v);
        syncAccessibilityUI();
      },
    },
    // ── Volume sliders ──────────────────────────────────────
    // Grouped rather than one slider per channel: master + music +
    // ambience + a single "effects" level that fans out to every
    // Web-Audio SFX channel (jump, footsteps, coins, UI, events,
    // thunder). The nine per-channel MUTE toggles in the sound
    // settings section stay the fine-grained control; sliders at
    // that granularity would be noise for most players.
    {
      kind: "slider",
      id: "master-volume",
      label: "Volume",
      min: 0,
      max: 1,
      step: 0.05,
      format: formatPercent,
      get: () => window.Game?.getMasterVolume?.() ?? 1,
      set: (v: number) => {
        window.Game?.setMasterVolume?.(v);
        syncAccessibilityUI();
      },
    },
    {
      kind: "slider",
      id: "music-volume",
      label: "Music",
      min: 0,
      max: 1,
      step: 0.05,
      format: formatPercent,
      get: () => window.Game?.getMusicVolume?.() ?? 1,
      set: (v: number) => {
        window.Game?.setMusicVolume?.(v);
        syncAccessibilityUI();
      },
    },
    {
      kind: "slider",
      id: "effects-volume",
      label: "Effects",
      min: 0,
      max: 1,
      step: 0.05,
      format: formatPercent,
      // The group reads the jump channel as its representative value —
      // this slider is the only writer of the six channels, so they
      // only diverge if a future build adds per-channel sliders.
      get: () => window.Game?.getJumpVolume?.() ?? 1,
      set: (v: number) => {
        window.Game?.setJumpVolume?.(v);
        window.Game?.setFootstepsVolume?.(v);
        window.Game?.setCoinsVolume?.(v);
        window.Game?.setUiVolume?.(v);
        window.Game?.setEventsVolume?.(v);
        window.Game?.setThunderVolume?.(v);
        syncAccessibilityUI();
      },
    },
    {
      kind: "slider",
      id: "rain-volume",
      label: "Rain",
      min: 0,
      max: 1,
      step: 0.05,
      format: formatPercent,
      get: () => window.Game?.getRainVolume?.() ?? 1,
      set: (v: number) => {
        window.Game?.setRainVolume?.(v);
        syncAccessibilityUI();
      },
    },
  ],
};

function syncAccessibilityUI() {
  refreshAccessibilitySettings(ACCESSIBILITY_SETTINGS_CALLBACKS);
}

// ───────── Fullscreen button ─────────
function isFullscreen() {
  const doc = document as Document & {
    webkitFullscreenElement?: Element | null;
    mozFullScreenElement?: Element | null;
    msFullscreenElement?: Element | null;
  };
  return !!(
    doc.fullscreenElement ||
    doc.webkitFullscreenElement ||
    doc.mozFullScreenElement ||
    doc.msFullscreenElement
  );
}
function refreshFullscreenUI() {
  if (!fullscreenBtn) return;
  const on = isFullscreen();
  fullscreenBtn.classList.toggle("is-fullscreen", on);
  fullscreenBtn.setAttribute("aria-pressed", String(on));
  fullscreenBtn.setAttribute("aria-label", on ? "Exit fullscreen" : "Enter fullscreen");
}
// Vendor-prefixed Fullscreen API methods aren't in lib.dom.d.ts;
// browsers that need them are old enough that we just probe
// dynamically. The `as any` reads stay scoped here.
type LegacyFullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void>;
  mozRequestFullScreen?: () => Promise<void>;
  msRequestFullscreen?: () => Promise<void>;
};
type LegacyFullscreenDocument = Document & {
  webkitExitFullscreen?: () => Promise<void>;
  mozCancelFullScreen?: () => Promise<void>;
  msExitFullscreen?: () => Promise<void>;
};
async function toggleFullscreen() {
  try {
    if (!isFullscreen()) {
      const el = document.documentElement as LegacyFullscreenElement;
      const req =
        el.requestFullscreen ||
        el.webkitRequestFullscreen ||
        el.mozRequestFullScreen ||
        el.msRequestFullscreen;
      if (req) await req.call(el);
    } else {
      const doc = document as LegacyFullscreenDocument;
      const exit =
        doc.exitFullscreen ||
        doc.webkitExitFullscreen ||
        doc.mozCancelFullScreen ||
        doc.msExitFullscreen;
      if (exit) await exit.call(doc);
    }
  } catch (_e) {
    /* User-cancelled or not allowed — silently ignore. */
  }
}
if (fullscreenBtn) {
  fullscreenBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFullscreen();
  });
  // Keep the button in sync whenever fullscreen state
  // changes, including via the browser's own Esc-to-exit.
  const fsEvents = [
    "fullscreenchange",
    "webkitfullscreenchange",
    "mozfullscreenchange",
    "MSFullscreenChange",
  ];
  for (const ev of fsEvents) {
    document.addEventListener(ev, refreshFullscreenUI);
  }
}

// ───────── Menu overlay ─────────
function refreshMenuHighscore() {
  const hsEl = document.getElementById("menu-highscore");
  const hsVal = document.getElementById("menu-highscore-value");
  if (!hsEl || !hsVal || !window.Game?.getHighScore) return;
  const hs = Math.floor(window.Game.getHighScore() || 0);
  if (hs > 0) {
    hsVal.textContent = String(hs);
    hsEl.hidden = false;
  } else {
    hsEl.hidden = true;
  }
}

// Track the element that had focus before an overlay opened,
// so we can restore it when the overlay closes.
let _menuPriorFocus: HTMLElement | null = null;

function openMenuBase() {
  _menuPriorFocus = document.activeElement as HTMLElement | null;
  overlay.classList.add("open");
  cog.setAttribute("aria-expanded", "true");
  refreshSoundUI();
  refreshHitboxesUI();
  refreshRainUI();
  refreshNoCollisionsUI();
  refreshPerfUI();
  refreshEasterEggUI();
  refreshScoreEditor();
  refreshMenuHighscore();
  // Re-render the React menu list so it re-reads live state
  // (install-availability, fullscreen label, etc.).
  syncMenuList();
  // Refresh the fullscreen toggle label so it's honest if the
  // player hit ESC or Cmd-Ctrl-F outside the menu. No-op on web.
  refreshFullscreenState();
  // Toggle a "pre-game" class on the panel so items that only
  // make sense mid-run (Back to home screen, Resume game,
  // Press Esc hint) are hidden on the start screen.
  const panel = overlay.querySelector(".menu-panel");
  if (panel) {
    if (window.Game?.isStarted?.()) {
      panel.classList.remove("pre-game");
    } else {
      panel.classList.add("pre-game");
    }
  }
  // Only pause an already-running game. Before the player
  // has hit Start Game, there's nothing to pause.
  if (window.Game?.isStarted?.()) {
    window.Game.pause();
  }
}

function closeMenu() {
  overlay.classList.remove("open");
  cog.setAttribute("aria-expanded", "false");
  // Restore focus to the element that opened the menu.
  if (_menuPriorFocus && typeof _menuPriorFocus.focus === "function") {
    _menuPriorFocus.focus();
    _menuPriorFocus = null;
  }
  // Only resume if the player is actually in a started game.
  // Before Start Game, there's nothing to resume — the rAF
  // loop still renders the start screen behind the menu.
  if (window.Game?.isStarted?.()) {
    window.Game.resume();
  }
}

// Public openMenu — also resets the focus index to the first
// visible item on every open so the gamepad user lands
// somewhere predictable. Delays the focus set until after the
// panel layout settles (pre-game toggle, score editor refresh,
// etc.) so offsetParent is accurate when we pick the first
// visible item.
function openMenu() {
  openMenuBase();
  _menuFocusIdx = 0;
  requestAnimationFrame(() => focusMenuIndex(0));
}

function toggleMenu() {
  if (overlay.classList.contains("open")) {
    closeMenu();
  } else {
    openMenu();
  }
}

// Small shims so the Capacitor bridge (src/mobile/bridge.ts) and
// the gamepad poller in src/main.ts can route through the same
// menu code the cog button uses. Zero-cost on the web build —
// the Capacitor bridge is only imported inside __IS_CAPACITOR__
// guard, and the gamepad poller no-ops if no pad is attached.
window.__rrIsMenuOpen = () => overlay.classList.contains("open");
window.__rrToggleMenu = toggleMenu;
window.__rrCloseMenu = closeMenu;
/**
 * Stepwise "back" for the pause menu. The gamepad B button
 * and D-pad left route through this so the back motion
 * unwinds UI one level at a time instead of nuking the
 * whole menu:
 *   1. If any <details> dropdown inside the menu is open,
 *      close THAT and park focus on its summary.
 *   2. Otherwise close the menu itself.
 * Matches what console menu systems conventionally do —
 * B collapses the innermost open thing, not the entire
 * screen.
 */
window.__rrMenuBack = () => {
  const openDetails = overlay.querySelector("details[open]");
  if (openDetails) {
    openDetails.removeAttribute("open");
    const summary = openDetails.querySelector("summary");
    if (summary && typeof summary.focus === "function") {
      summary.focus();
    }
    return;
  }
  closeMenu();
};

// ── Sub-overlay helpers for gamepad support ────────
// The sub-overlays (credits / achievements / imprint /
// about / reset-confirm) all share the .imprint-overlay
// class and the .open toggle. Only one is open at a time.
// These two helpers let the gamepad poller in src/main.ts
// (a) scroll whichever sub-overlay is open by driving the
// overlay's scrollable child, and (b) close it on cancel
// buttons without knowing which overlay is active.
/**
 * Resolve a scroll handle for the currently open sub-overlay.
 * Covers three content shapes the overlays use:
 *   • .credits-scroll      — same-origin scrollable div
 *   • .achievements-scroll — same-origin scrollable div
 *   • <iframe>             — cross-document (same-origin in
 *                            practice), scroll via contentWindow
 * Returns an object with a scrollBy(dx, dy) method so the
 * caller doesn't have to branch on element type, or null if
 * no scrollable sub-overlay is open.
 */
window.__rrActiveScrollable = () => {
  const overlays = document.querySelectorAll(".imprint-overlay.open");
  if (!overlays.length) return null;
  const active = overlays[0];
  const scroll = active.querySelector(".credits-scroll, .achievements-scroll");
  if (scroll) {
    return {
      scrollBy(dx: number, dy: number) {
        scroll.scrollBy(dx, dy);
      },
    };
  }
  const iframe = active.querySelector("iframe");
  if (iframe) {
    return {
      scrollBy(dx: number, dy: number) {
        try {
          iframe.contentWindow?.scrollBy?.(dx, dy);
        } catch (_) {
          /* cross-origin somehow — give up gracefully */
        }
      },
    };
  }
  // Open sub-overlay with no scrollable content (reset-confirm).
  // Returning null lets the caller still detect "sub-overlay
  // active" via __rrSubOverlayOpen below.
  return null;
};
/** True if any sub-overlay is currently open. Used by the
 *  gamepad poller to decide which nav mode to run even when
 *  the overlay has no scrollable content (e.g. reset-confirm). */
window.__rrSubOverlayOpen = () => !!document.querySelector(".imprint-overlay.open");
/** Click the close button of the active sub-overlay. Routes
 *  through the overlay's existing click handler so any
 *  Game.resume() / state-restore hooks fire correctly. */
window.__rrCloseActiveSubOverlay = () => {
  const active = document.querySelector(".imprint-overlay.open");
  if (!active) return false;
  const closeBtn = active.querySelector<HTMLElement>(".imprint-close");
  if (closeBtn && typeof closeBtn.click === "function") {
    closeBtn.click();
    return true;
  }
  return false;
};

// ── Gamepad nav inside sub-overlays ─────
// Shop (buy / equip) and reset-confirm (yes / no) have
// interactive buttons rather than scrollable content, so the
// gamepad poller routes d-pad/face-button presses to focus-walk
// helpers instead of the scroll path used by credits/achievements.
// The scrollable overlays aren't button-free either, though:
// credits embeds attribution links and achievements has the
// "View on Steam" button, all nested inside the scroll container
// — the same ring (and the FocusStep/FocusAtEdge hooks below)
// makes those reachable by pad too.
// The .imprint-close ✕ is excluded from the ring because the
// "cancel" face button already closes the overlay; including it
// would steal a d-pad slot for no gain.
function getActiveSubOverlayButtons(): HTMLElement[] {
  const active = document.querySelector(".imprint-overlay.open");
  if (!active) return [];
  // Walk the action buttons (not the cards around them) — the focus
  // ring belongs on the button the player would actually press. Poor
  // / can't-afford shop buttons use aria-disabled, not disabled, so
  // they stay in the nav ring: the player can still see what's
  // locked behind what price, pressing the face button is a no-op.
  // a[href] covers the credits links; anchors inside the imprint /
  // about iframes live in a separate document, so those overlays
  // still come back empty (pure scroll surfaces).
  const all = active.querySelectorAll<HTMLElement>("button:not(.imprint-close), a[href]");
  const list: HTMLElement[] = [];
  for (const el of all) {
    if ("disabled" in el && (el as HTMLButtonElement).disabled) continue;
    if (!el.offsetParent) continue;
    list.push(el);
  }
  return list;
}
let _subOverlayFocusIdx = 0;
function focusSubOverlayIndex(idx: number) {
  const items = getActiveSubOverlayButtons();
  if (!items.length) return;
  _subOverlayFocusIdx = ((idx % items.length) + items.length) % items.length;
  const target = items[_subOverlayFocusIdx];
  // Route through focusKbd so the .kbd-focus class lands alongside
  // :focus-visible. Programmatic .focus() calls don't always trip
  // :focus-visible (Chromium drops it on certain code paths), and
  // the new sky-deep shop-item-action focus highlight is gated on
  // either signal — without the class fallback the selected card
  // would render identically to an unfocused one.
  focusKbd(target);
  target.scrollIntoView({ block: "nearest" });
}
function currentSubOverlayFocusIdx() {
  const items = getActiveSubOverlayButtons();
  if (!items.length) return 0;
  const active = document.activeElement;
  const matchIdx = active instanceof HTMLElement ? items.indexOf(active) : -1;
  if (matchIdx !== -1) return matchIdx;
  return Math.min(Math.max(0, _subOverlayFocusIdx), items.length - 1);
}
window.__rrSubOverlayFocusNext = () => {
  focusSubOverlayIndex(currentSubOverlayFocusIdx() + 1);
};
window.__rrSubOverlayFocusPrev = () => {
  focusSubOverlayIndex(currentSubOverlayFocusIdx() - 1);
};
window.__rrSubOverlaySelect = () => {
  const items = getActiveSubOverlayButtons();
  if (!items.length) return;
  const idx = currentSubOverlayFocusIdx();
  const target = items[idx];
  // Skip press on aria-disabled buttons (poor shop rows). Click()
  // would fire and bubble to any parent handlers otherwise.
  if (!target || target.getAttribute("aria-disabled") === "true") return;
  if (typeof target.click === "function") target.click();
};
// Whether the focus ring holds real focus right now. The scrollable
// overlays (credits / achievements) open with focus parked on the
// excluded ✕ close button, and the remembered ring index above may be
// stale from a different overlay — so the poller gates confirm on
// this check there: Select's index fallback must not click a target
// nobody can see. The modal overlays (shop / reset-confirm) place
// visible focus on open and keep the fallback as mouse-drift
// self-healing instead.
window.__rrSubOverlayFocusEntered = (): boolean => {
  const items = getActiveSubOverlayButtons();
  if (!items.length) return false;
  const active = document.activeElement;
  return active instanceof HTMLElement && items.includes(active);
};
// Non-wrapping focus walk for the SCROLLABLE sub-overlays
// (credits / achievements). Unlike the Next/Prev pair above, a
// step past either end reports false instead of wrapping — the
// poller uses that (and FocusAtEdge for held buttons) to fall
// back to scrolling the container, so the d-pad can still sweep
// through long stretches of non-interactive content. Wrapping
// would trap a pad-only reader between the focusables.
window.__rrSubOverlayFocusStep = (dir: 1 | -1): boolean => {
  const items = getActiveSubOverlayButtons();
  if (!items.length) return false;
  const active = document.activeElement;
  const cur = active instanceof HTMLElement ? items.indexOf(active) : -1;
  // Ring not entered yet (overlays park focus on the excluded ✕
  // close button on open, and mouse clicks can drop it on body):
  // either direction lands on the first item so the entry point
  // is predictable.
  if (cur === -1) {
    focusSubOverlayIndex(0);
    return true;
  }
  const next = cur + dir;
  if (next < 0 || next >= items.length) return false;
  focusSubOverlayIndex(next);
  return true;
};
window.__rrSubOverlayFocusAtEdge = (dir: 1 | -1): boolean => {
  const items = getActiveSubOverlayButtons();
  // No focusables (imprint / about iframes, or every ring item
  // hidden on this build) → always "at edge" so held d-pad keeps
  // scrolling exactly as it did before the focus walk existed.
  if (!items.length) return true;
  const active = document.activeElement;
  const cur = active instanceof HTMLElement ? items.indexOf(active) : -1;
  if (cur === -1) return false;
  const next = cur + dir;
  return next < 0 || next >= items.length;
};

// ── Gamepad navigation ──────────────────────────────
// Walks the focus ring across the menu's visible buttons/
// links. The three filters here together define "visible
// AND interactable right now":
//
//   1. Not disabled.
//   2. offsetParent is truthy — skips items under a
//      display:none ancestor (the .pre-game / .in-game-only
//      / .debug-only gates).
//   3. Not inside a closed <details>. Browsers DO hide the
//      children of a collapsed <details>, but the mechanism
//      varies (content-visibility, UA-internal, etc.) and
//      offsetParent isn't reliably null for every element
//      inside a closed summary. Without this explicit check,
//      gamepad up/down walked THROUGH the folded dropdown's
//      hidden items instead of jumping to the row after the
//      summary.
//
// Include .sound-settings-summary too — it's a <summary>,
// not a .menu-item, but functionally IS a navigable button
// (it toggles the collapsible). Without it, gamepad nav
// skipped right past the "Sound Settings" row and the
// player couldn't fold it open/closed with a controller.
function getNavigableMenuItems(): HTMLElement[] {
  const all = overlay.querySelectorAll<HTMLElement>(
    ".menu-item, .sound-settings-summary, .menu-group-summary",
  );
  const list: HTMLElement[] = [];
  for (const el of all) {
    // `disabled` only exists on form-control subtypes (HTMLButtonElement
    // et al). The selector above also matches <summary>s, which don't
    // have it — guard via `in`.
    if ("disabled" in el && (el as HTMLButtonElement).disabled) continue;
    if (!el.offsetParent) continue;
    // Collapsed <details> — summaries themselves are fine
    // to navigate TO, but items INSIDE a closed details
    // aren't reachable visually and must not appear in
    // the nav list.
    const closestDetails = el.closest("details");
    if (closestDetails && !closestDetails.open && el.tagName.toLowerCase() !== "summary") {
      continue;
    }
    list.push(el);
  }
  return list;
}
let _menuFocusIdx = 0;
/** Focus an element and force the keyboard-focus highlight.
 *  Programmatic `.focus()` doesn't always trip `:focus-visible`
 *  (most notably: after an Electron fullscreen transition rebuilds
 *  the native window, the element gets `:focus` but not
 *  `:focus-visible`, and the blue highlight never comes back).
 *  The `focusVisible: true` option fixes it on modern browsers;
 *  the `.kbd-focus` class covers everywhere else. The class is
 *  cleared on blur or on the next real mouse click, so mouse
 *  users don't see a stuck highlight. */
function focusKbd(target: HTMLElement) {
  try {
    target.focus({ focusVisible: true } as FocusOptions);
  } catch {
    target.focus();
  }
  target.classList.add("kbd-focus");
  const clearOnBlur = () => {
    target.classList.remove("kbd-focus");
    target.removeEventListener("blur", clearOnBlur);
  };
  target.addEventListener("blur", clearOnBlur);
}
function focusMenuIndex(idx: number) {
  const items = getNavigableMenuItems();
  if (!items.length) return;
  _menuFocusIdx = ((idx % items.length) + items.length) % items.length;
  const target = items[_menuFocusIdx];
  focusKbd(target);
  target.scrollIntoView({ block: "nearest" });
}
/**
 * Resolve the current menu-focus position from live state
 * instead of trusting the stored _menuFocusIdx. Handles two
 * cases the stored index couldn't cover:
 *   - Focus drifted off the menu entirely (user clicked
 *     outside the panel, browser gave focus to body, etc.).
 *     __rrMenuFocusNext / Prev from a controller should
 *     snap back into the menu, not silently no-op.
 *   - The set of visible items changed (pre-game class,
 *     the sound-settings dropdown opening / closing)
 *     invalidating a stored index that used to be in range.
 *
 * Returns the index of the currently-focused menu item in
 * the live items array, or the clamped stored index if
 * focus is elsewhere.
 */
function currentMenuFocusIdx() {
  const items = getNavigableMenuItems();
  if (!items.length) return 0;
  const active = document.activeElement as HTMLElement | null;
  const matchIdx = active ? items.indexOf(active) : -1;
  if (matchIdx !== -1) return matchIdx;
  // Focus is off-menu or on an item that isn't navigable
  // anymore. Clamp the stored index into the new range.
  return Math.min(Math.max(0, _menuFocusIdx), items.length - 1);
}
window.__rrMenuFocusNext = () => {
  focusMenuIndex(currentMenuFocusIdx() + 1);
};
window.__rrMenuFocusPrev = () => {
  focusMenuIndex(currentMenuFocusIdx() - 1);
};
window.__rrMenuSelect = () => {
  const items = getNavigableMenuItems();
  if (!items.length) return;
  const idx = currentMenuFocusIdx();
  const target = items[idx];
  if (target && typeof target.click === "function") {
    target.click();
  }
};

// Keep _menuFocusIdx in sync with mouse clicks. Without
// this, a post-click focus-loss recovery (e.g. after a
// fullscreen transition below) would snap focus back to
// the top of the menu instead of the row the player was
// actually interacting with.
//
// Doubles as the centralised tap-sound trigger for every menu
// button: cosmetic equip, debug toggles, per-channel sound
// mutes, the Shop entry, sub-panel summaries. Each button's own
// click handler stays focused on behaviour; the audio feedback
// lives here so it's uniform and can't drift per-item.
overlay.addEventListener("click", (e) => {
  const target = e.target instanceof Element ? e.target : null;
  const t = target?.closest<HTMLElement>(
    ".menu-item, .sound-settings-summary, .menu-group-summary",
  );
  if (!t) return;
  const items = getNavigableMenuItems();
  const idx = items.indexOf(t);
  if (idx !== -1) _menuFocusIdx = idx;
  window.Game?.playMenuTap?.();
});

// Focus watchdog: if the window regains focus while the
// menu is open but keyboard focus has fallen to <body>,
// snap it back into the menu. Covers the three scenarios
// that leak focus out from under the gamepad user:
//   • Electron fullscreen transitions — macOS moves the
//     window to a new Space, Electron re-fires focus on
//     the body element.
//   • Alt-tab away and back.
//   • Any browser-triggered defocus (DevTools open,
//     system notification stealing focus).
// This listener runs on every focus event, not just
// fullscreen, so the recovery is uniform across all
// those cases.
window.addEventListener("focus", () => {
  if (!overlay.classList.contains("open")) return;
  const active = document.activeElement;
  if (active && active !== document.body) return;
  focusMenuIndex(currentMenuFocusIdx());
});

overlay.addEventListener("click", (e) => {
  // Click outside the panel closes the menu.
  if (e.target === overlay) closeMenu();
});

// "Back to home screen" — reset the game, close the menu, and
// re-show the start screen with its current personal-best badge.
function handleHomeClick() {
  if (window.Game?.returnToHome) {
    window.Game.returnToHome();
  }
  // Close menu without a Game.resume() side-effect, since we
  // just moved the game back to its paused pre-start state.
  overlay.classList.remove("open");
  cog.setAttribute("aria-expanded", "false");
  // Re-show the start screen. Refresh its high-score badge in
  // case the player just set a new personal best this run.
  startScreen.classList.remove("hidden");
  onGameReady();
  hideScoreDisplay();
}

// ───────── PWA Install button ─────────
let deferredInstallPrompt: any = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  syncMenuList();
});
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  syncMenuList();
});
async function handleInstallClick() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  syncMenuList();
  if (outcome === "accepted") closeMenu();
}

// Steam overlay IPC helpers — desktop-only but the call is safe
// no-op elsewhere (electronAPI is undefined on web and mobile).
function handleSteamStoreClick() {
  if (window.electronAPI && typeof window.electronAPI.openSteamOverlayUrl === "function") {
    window.electronAPI.openSteamOverlayUrl(STEAM_STORE_URL);
  }
}
function handleSteamFriendsClick() {
  if (window.electronAPI && typeof window.electronAPI.openSteamOverlay === "function") {
    window.electronAPI.openSteamOverlay("Friends");
  }
}

// Callbacks table for the React <MenuList>. Each entry is either a
// direct open-overlay / close-menu delegation or a thin wrapper
// around a Game-API / electron IPC call.
const MENU_LIST_CALLBACKS = {
  onClose: () => closeMenu(),
  onHome: handleHomeClick,
  onAchievements: () => {
    closeMenu();
    openAchievements();
  },
  onResetProgress: () => openResetConfirm(),
  onInstall: handleInstallClick,
  onAbout: () => {
    closeMenu();
    openAbout();
  },
  onCredits: () => {
    closeMenu();
    openCredits();
  },
  onImprint: () => {
    closeMenu();
    openImprint();
  },
  onSteamStore: handleSteamStoreClick,
  onSteamFriends: handleSteamFriendsClick,
  onFullscreen: handleFullscreenClick,
  onQuit: handleQuitClick,
  getInstallAvailable: () => deferredInstallPrompt != null,
  getFullscreenLabel: () => "Fullscreen: " + (fullscreenState ? "on" : "off"),
};

function syncMenuList() {
  refreshMenuList(MENU_LIST_CALLBACKS);
}

cog.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleMenu();
});
topSoundBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleSound();
});

// ───────── Debug body (only visible under body[data-debug="true"]) ─────────
// All rows inside the <details id="debug-settings"> are rendered by
// the React <DebugSettings> component — see
// src/ui/react/DebugSettings.tsx. ui.ts keeps the action handlers
// in a single callbacks table + a syncDebugSettings() dispatcher so
// the component re-renders any time a toggle flips.

const DEBUG_SETTINGS_CALLBACKS = {
  onToggleHitboxes: () => {
    window.Game?.toggleShowHitboxes?.();
    syncDebugSettings();
  },
  onToggleRain: () => {
    if (window.Game?.toggleRain) {
      window.Game.toggleRain();
      closeMenu();
    }
  },
  onToggleNoCollisions: () => {
    if (window.Game?.toggleNoCollisions) {
      window.Game.toggleNoCollisions();
      syncDebugSettings();
    }
  },
  onTogglePerf: () => {
    if (window.Game?.togglePerfOverlay) {
      window.Game.togglePerfOverlay();
      syncDebugSettings();
    }
  },
  onScoreInputChange: (raw: string) => {
    if (!window.Game?.setScore) return;
    const n = Math.max(0, Math.floor(Number(raw) || 0));
    window.Game.setScore(n);
    // Sync the HUD's displayed value so it snaps to the
    // new number instead of slowly tweening up.
    if (scoreValueEl) scoreValueEl.textContent = String(n);
    displayedScore = n;
  },
  onTriggerUfo: () => {
    if (window.Game?.triggerEvent) {
      window.Game.triggerEvent("ufo");
      closeMenu();
    }
  },
  onTriggerSanta: () => {
    if (window.Game?.triggerEvent) {
      window.Game.triggerEvent("santa");
      closeMenu();
    }
  },
  onTriggerTumbleweed: () => {
    if (window.Game?.triggerEvent) {
      window.Game.triggerEvent("tumbleweed");
      closeMenu();
    }
  },
  onTriggerComet: () => {
    if (window.Game?.triggerEvent) {
      window.Game.triggerEvent("comet");
      closeMenu();
    }
  },
  onTriggerMeteor: () => {
    if (window.Game?.triggerEvent) {
      window.Game.triggerEvent("meteor");
      closeMenu();
    }
  },
  onAdvanceMoon: () => {
    if (window.Game?.advanceMoonPhase) {
      window.Game.advanceMoonPhase();
      closeMenu();
    }
  },
  onForceBreather: () => {
    if (window.Game?._forceBreather) {
      window.Game._forceBreather();
      closeMenu();
    }
  },
  onSpawnPterodactyl: () => {
    if (window.Game?._spawnPterodactyl) {
      window.Game._spawnPterodactyl();
      closeMenu();
    }
  },
};

function syncDebugSettings() {
  refreshDebugSettings(DEBUG_SETTINGS_CALLBACKS);
}

// Thin wrappers kept for the openMenuBase call sites that still
// trigger per-area refreshes. Each now just pings the React tree
// to re-read the current Game-API state.
function refreshHitboxesUI() {
  syncDebugSettings();
}
function refreshRainUI() {
  syncDebugSettings();
}
function refreshNoCollisionsUI() {
  syncDebugSettings();
}
function refreshPerfUI() {
  syncDebugSettings();
}

// ───────── Accessory toggles (party hat / thug glasses) ─────────
// Both entries are hidden in the markup by default and only
// shown once the player actually unlocks them — or always in
// debug mode for testing.
const cosmeticsGroup = document.getElementById("cosmetics");
const _cosmeticsList = document.getElementById("cosmetics-list");
const menuShopBtn = document.getElementById("menu-shop");
const menuShopBalanceValue = document.getElementById("menu-shop-balance-value");
const shopOverlay = document.getElementById("shop-overlay");

// Start-screen raptor stage. Each <img class="start-raptor-cosmetic">
// has a data-slot attribute; refreshStartRaptorCosmetics() reads
// the Game API for the currently-equipped cosmetic in that slot
// and sets the img's src + hidden state accordingly. Called after
// every equip/unequip so the preview matches the live game.
const startRaptorStage = document.getElementById("start-raptor-stage");

// Idle-frame (frame 11) anchors, mirroring RAPTOR_CROWN / RAPTOR_SNOUT
// and the BACK/NECK corrections in src/constants.ts. The stage shares
// the raptor sprite's 578:212 aspect ratio, so normalised fractions
// map directly to stage percentages and the preview picks up the
// same anchors as the canvas draw path in src/entities/raptor.ts.
const _IDLE_CROWN = { x: 0.86851, y: 0.15566 };
const _IDLE_SNOUT = { x: 0.98616, y: 0.25472 };
const _IDLE_NECK_CORRECTION = { x: 0.00187, y: -0.00078 };

// The three score-unlock classics bypass the generic placeholder
// draw path in raptor.ts and use slightly smaller scales. Mirror
// those here so party-hat/thug-glasses/bow-tie render identically
// on the start screen.
type CosmeticDraw = {
  scale?: number;
  rotation?: number;
  offset?: { x?: number; y?: number };
};
const _CLASSIC_DRAW: Record<string, CosmeticDraw> = {
  "party-hat": { scale: 0.25, rotation: -0.35 },
  "thug-glasses": { scale: 0.07 },
  "bow-tie": { scale: 0.06, rotation: -0.15 },
};

function refreshStartRaptorCosmetics() {
  if (!startRaptorStage || !window.Game) return;
  const slots: Array<"head" | "eyes" | "neck"> = ["head", "eyes", "neck"];
  for (const slot of slots) {
    const img = startRaptorStage.querySelector(
      `.start-raptor-cosmetic[data-slot="${slot}"]`,
    ) as HTMLImageElement | null;
    if (!img) continue;
    const id = window.Game.getEquippedCosmetic?.(slot);
    const url = id ? _spriteUrlForId(id) : null;
    if (url && id) {
      if (img.getAttribute("src") !== url) img.src = url;
      if (img.dataset.cosmeticId !== id) img.dataset.cosmeticId = id;
      img.hidden = false;
      _applyStartCosmeticTransform(img, slot, id);
    } else {
      // Nothing equipped, or equipped item has no sprite yet.
      if (img.dataset.cosmeticId) delete img.dataset.cosmeticId;
      img.hidden = true;
    }
  }
}

// Compute and apply the inline transform for a single start-screen
// cosmetic image, mirroring src/entities/raptor.ts::_drawCosmeticPlaceholder
// at the idle frame. Every number here has a direct counterpart in
// the canvas draw path — keep them in sync if that logic changes.
function _applyStartCosmeticTransform(
  img: HTMLImageElement,
  slot: "head" | "eyes" | "neck",
  id: string,
) {
  const def = window.Game?.getAllCosmetics?.().find((c: { id: string }) => c.id === id);
  const draw = def?.draw ?? _CLASSIC_DRAW[id] ?? {};
  let cx = 0;
  let cy = 0;
  let rot = 0;
  let widthFrac: number | null = null;
  let heightFrac: number | null = null;
  let apX = 0.5;
  let apY = 0.5;
  if (slot === "head") {
    cx = _IDLE_CROWN.x - 0.01;
    cy = _IDLE_CROWN.y + 0.04;
    heightFrac = draw.scale ?? 0.3;
    rot = draw.rotation ?? -0.35;
    // Bottom-centre of the sprite anchors to the crown.
    apX = 0.5;
    apY = 1.0;
  } else if (slot === "eyes") {
    cx = _IDLE_CROWN.x + (_IDLE_SNOUT.x - _IDLE_CROWN.x) * 0.5 - 0.012;
    cy = _IDLE_CROWN.y + (_IDLE_SNOUT.y - _IDLE_CROWN.y) * 0.5 + 0.013;
    widthFrac = draw.scale ?? 0.1;
    // atan2 must use pixel deltas, so scale dy by the raptor aspect.
    const RAPTOR_ASPECT = 212 / 578;
    const rideAngle = Math.atan2(
      (_IDLE_SNOUT.y - _IDLE_CROWN.y) * RAPTOR_ASPECT,
      _IDLE_SNOUT.x - _IDLE_CROWN.x,
    );
    rot = draw.rotation ?? rideAngle - 0.25;
  } else {
    // neck
    cx = _IDLE_CROWN.x - 0.02 + _IDLE_NECK_CORRECTION.x;
    cy = _IDLE_CROWN.y + 0.2 + _IDLE_NECK_CORRECTION.y;
    widthFrac = draw.scale ?? 0.08;
    rot = draw.rotation ?? -0.15;
  }
  if (draw.offset?.x != null) cx += draw.offset.x;
  if (draw.offset?.y != null) cy += draw.offset.y;
  img.style.left = (cx * 100).toFixed(3) + "%";
  img.style.top = (cy * 100).toFixed(3) + "%";
  if (widthFrac != null) {
    img.style.width = (widthFrac * 100).toFixed(3) + "%";
    img.style.height = "auto";
  } else {
    img.style.height = (heightFrac! * 100).toFixed(3) + "%";
    img.style.width = "auto";
  }
  img.style.transform =
    `translate(${(-apX * 100).toFixed(2)}%, ${(-apY * 100).toFixed(2)}%) ` +
    `rotate(${rot.toFixed(4)}rad)`;
  img.style.transformOrigin = `${(apX * 100).toFixed(2)}% ${(apY * 100).toFixed(2)}%`;
}

/** id → sprite URL. Kept in module scope so both the shop grid
 *  and the start-raptor-stage can use it. Null for unknown ids or
 *  cosmetics whose sprite hasn't been registered yet (placeholder
 *  path kicks in). */
function _spriteUrlForId(id: string): string | null {
  const def = window.Game?.getAllCosmetics?.().find((c: { id: string }) => c.id === id);
  if (!def?.spriteKey) return null;
  const map: Record<string, string> = {
    partyHat: "assets/party-hat.png",
    thugGlasses: "assets/thug-glasses.png",
    bowTie: "assets/bow-tie.png",
    cowboyHat: "assets/cosmetics/cowboy-hat.png",
    topHat: "assets/cosmetics/top-hat.png",
    wizardHat: "assets/cosmetics/wizard-hat.png",
    pirateTricorn: "assets/cosmetics/pirate-tricorn.png",
    tiara: "assets/cosmetics/tiara.png",
    monocle: "assets/cosmetics/monocle.png",
    eyePatch: "assets/cosmetics/eye-patch.png",
    goldChain: "assets/cosmetics/gold-chain.png",
    sombrero: "assets/cosmetics/sombrero.png",
    bandana: "assets/cosmetics/bandana.png",
    crown: "assets/cosmetics/crown.png",
  };
  return map[def.spriteKey] ?? null;
}

function refreshEasterEggUI() {
  if (!window.Game) return;
  renderCosmeticsMenu();
  refreshShopMenuBalance();
  refreshStartRaptorCosmetics();
}

/** Callbacks passed to <CosmeticsMenu>. Equip / unequip fire the
 *  Game API mutation then trigger renderCosmeticsMenu() to repaint
 *  the React tree and refreshStartRaptorCosmetics() to update the
 *  (non-React) start-screen raptor preview. */
const COSMETICS_MENU_CALLBACKS = {
  onEquipCosmetic: (id: string) => {
    window.Game?.equipCosmetic?.(id);
    renderCosmeticsMenu();
    refreshStartRaptorCosmetics();
  },
  onUnequipSlot: (slot: "head" | "eyes" | "neck") => {
    window.Game?.unequipSlot?.(slot);
    renderCosmeticsMenu();
    refreshStartRaptorCosmetics();
  },
};

/**
 * Rebuild the cosmetics section of the menu. Called on every
 * menu-open and after any equip change so the React tree stays in
 * sync with the latest state.
 *
 * The outer <details id="cosmetics"> stays hidden until at least
 * one cosmetic is owned — no empty header at the start of a fresh
 * save. Per-slot sections, option buttons, thumbnails, and the
 * "None" row are all rendered by <CosmeticsMenu> in React.
 */
function renderCosmeticsMenu() {
  const game = window.Game;
  if (!cosmeticsGroup || !game) return;
  const all = game.getAllCosmetics?.() ?? [];
  const owned = all.filter((c: { id: string }) => game.ownsCosmetic?.(c.id));
  cosmeticsGroup.hidden = owned.length === 0;
  refreshCosmeticsMenu(COSMETICS_MENU_CALLBACKS);
}

// ───────── Shop ─────────
/** Update the coin chip on the main menu's Shop button. The shop
 *  overlay itself is rendered by the React <Shop> component
 *  (src/ui/react/Shop.tsx), which reads the balance on each render.
 *  This function covers the chip that lives OUTSIDE the shop, so the
 *  menu button shows the right number even when the shop's closed. */
function refreshShopMenuBalance() {
  if (!window.Game) return;
  const n = window.Game.getCoinsBalance?.() ?? 0;
  if (menuShopBalanceValue) menuShopBalanceValue.textContent = String(n);
}

/** Called from the React <Shop> component whenever a buy or equip
 *  succeeds. Updates the bits of UI that live OUTSIDE the shop:
 *  the main menu's Shop-button coin chip and the start-screen
 *  raptor preview (so a just-equipped cosmetic shows up on the
 *  raptor behind the overlay). */
function onShopChange() {
  refreshShopMenuBalance();
  refreshStartRaptorCosmetics();
}

function openShop() {
  if (!shopOverlay) return;
  // Shop is a full-screen modal — always pause the game underneath.
  // Reached in two paths: (a) menu → Shop (menu already paused us,
  // but it calls Game.resume() on closeMenu just before we open),
  // or (b) direct hotkey opens from gameplay. Either way pause is
  // the right move.
  try {
    window.Game?.pause?.();
  } catch {}
  refreshShopMenuBalance();
  refreshShop({ onClose: closeShop, onShopChange });
  shopOverlay.classList.add("open");
  // Land gamepad/keyboard focus on the first shop card so d-pad has
  // something to step from. React's root.render() commits async, so
  // poll for up to a few frames until the cards appear.
  _subOverlayFocusIdx = 0;
  tryFocusSubOverlay(6);
}
function tryFocusSubOverlay(attempts: number) {
  const items = getActiveSubOverlayButtons();
  if (items.length) {
    focusSubOverlayIndex(0);
    return;
  }
  if (attempts > 0) {
    requestAnimationFrame(() => tryFocusSubOverlay(attempts - 1));
  }
}
function closeShop() {
  if (!shopOverlay) return;
  shopOverlay.classList.remove("open");
  // Return to the pause menu rather than resuming the run. Shop is
  // always reached from the menu; closing should step back one
  // level, not skip straight back to gameplay. openMenu() re-pauses
  // (no-op if already paused) so the game stays frozen while the
  // menu shows.
  openMenu();
}

if (menuShopBtn) {
  menuShopBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeMenu();
    openShop();
  });
}
if (shopOverlay) {
  shopOverlay.addEventListener("click", (e) => {
    // Click on the backdrop (the overlay itself, not the sheet)
    // closes the shop, matching other full-screen overlays.
    if (e.target === shopOverlay) closeShop();
  });
}
// ESC closes the shop if it's open.
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && shopOverlay?.classList.contains("open")) {
    closeShop();
    e.stopPropagation();
  }
});
// ───────── Reset-progress confirmation ─────────
const resetOverlay = document.getElementById("reset-confirm-overlay");
const resetYes = document.getElementById("reset-confirm-yes");
const resetNo = document.getElementById("reset-confirm-no");

function openResetConfirm() {
  if (resetOverlay) resetOverlay.classList.add("open");
  _subOverlayFocusIdx = 0;
  tryFocusSubOverlay(3);
}
function closeResetConfirm() {
  if (resetOverlay) resetOverlay.classList.remove("open");
}
function doReset() {
  window.Game?.resetAllProgress();
  refreshEasterEggUI();
  if (achievementsOverlay?.classList.contains("open")) {
    refreshAchievements({ onClose: closeAchievements });
  }
  const pbEl = document.getElementById("personal-best");
  if (pbEl) pbEl.textContent = "Personal best: 0";
  // High-score badge on the start screen is inside <StartScreen>
  // and reads getHighScore() each render, so a sync is enough.
  syncStartScreen();
  closeResetConfirm();
  closeMenu();
}
if (resetYes) resetYes.addEventListener("click", doReset);
if (resetNo) resetNo.addEventListener("click", closeResetConfirm);
if (resetOverlay) {
  resetOverlay.addEventListener("click", (e) => {
    if (e.target === resetOverlay) closeResetConfirm();
  });
}

// Debug: live-editable score input — rendered inside <DebugSettings>
// and wired through DEBUG_SETTINGS_CALLBACKS.onScoreInputChange.
// refreshScoreEditor() stays as a thin wrapper since openMenuBase
// still calls it; each invocation triggers a React remount so a
// re-opened menu shows the current score.
function refreshScoreEditor() {
  syncDebugSettings();
}

// ───────── Keyboard ─────────
// ESC toggles the menu (or closes imprint first if it's open).
// We use a capture-phase listener on document so this runs before
// main.ts' window-level keydown handler.
document.addEventListener(
  "keydown",
  (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (achievementsOverlay?.classList.contains("open")) {
        closeAchievements();
      } else if (creditsOverlay?.classList.contains("open")) {
        closeCredits();
      } else if (aboutOverlay?.classList.contains("open")) {
        closeAbout();
      } else if (imprintOverlay.classList.contains("open")) {
        closeImprint();
      } else {
        toggleMenu();
      }
    }
  },
  true,
);

// Initial UI sync.
refreshSoundUI();
syncAccessibilityUI();

// ───────── Share your score ─────────
// The PNG slot (#score-card-slot + #score-card-preview) stays vanilla
// so the blob lifecycle can keep its imperative shape. The action
// buttons (revive / share / play-again / hint) render through the
// React <ScoreCardActions> component — see src/ui/react/
// ScoreCardActions.tsx. All cross-render state lives here and is
// pushed into React via syncScoreCardActions().
const scoreCardOverlay = document.getElementById("score-card-overlay");
const sharePanel = document.getElementById("score-card-panel");
const scoreCardImg = document.getElementById("score-card-preview") as HTMLImageElement | null;
const originalShareLabel = "Share your score";
let currentCardBlob: Blob | null = null;
let currentCardUrl: string | null = null;
let shareInFlight = false;
let shareLabel = originalShareLabel;
let reviveCost: number | null = null;
// The player's current coin balance, shown under the revive button
// so they can see "you have N coins" without dismissing the offer.
// Null means the score card isn't visible (or revive is hidden).
let reviveBalance: number | null = null;
// True iff the player can currently afford the revive. Flips to
// false when the 5s window elapses (expireReviveOffer) — the button
// stays rendered, just in its disabled "poor" state.
let reviveAffordable = false;
// Bumped on every startReviveOffer so React remounts the revive
// button and the CSS drain animation replays from its from-frame.
// The vanilla code achieved the same thing with a manual
// `void reviveBtn.offsetHeight` reflow between classList toggles.
let reviveKey = 0;

function syncScoreCardActions() {
  refreshScoreCardActions({
    reviveCost,
    reviveBalance,
    reviveAffordable,
    reviveKey,
    shareLabel,
    onRevive: handleReviveClick,
    onShare: handleShareClick,
    onRestart: doRestart,
  });
}

function clearCard() {
  if (currentCardUrl) {
    URL.revokeObjectURL(currentCardUrl);
    currentCardUrl = null;
  }
  currentCardBlob = null;
  if (scoreCardImg) scoreCardImg.removeAttribute("src");
}

const scoreCardSlot = document.getElementById("score-card-slot");

function showScoreCard() {
  const game = window.Game;
  if (!sharePanel || !scoreCardImg || !game) return;
  // Open the panel with the spinner visible immediately —
  // no waiting for the worker to finish composing the
  // image. The spinner is swapped for the real image once
  // the worker returns.
  clearCard();
  if (scoreCardSlot) scoreCardSlot.classList.remove("loaded");
  sharePanel.classList.add("visible");
  if (scoreCardOverlay) scoreCardOverlay.classList.add("visible");
  shareLabel = originalShareLabel;
  startReviveOffer();
  // Land initial focus on the most-interesting button — Revive when
  // offered, otherwise Play Again. Deferred to the next frame so
  // React has mounted the buttons into the DOM by the time we try
  // to focus one.
  requestAnimationFrame(() => {
    (window as any).__rrScoreCardFocusInitial?.();
  });
  // Defer card generation by two animation frames so the
  // death snapshot is captured in render() before the
  // worker asks for it.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      game
        .generateScoreCard()
        .then((blob) => {
          if (!blob || !sharePanel.classList.contains("visible")) {
            return;
          }
          currentCardBlob = blob;
          currentCardUrl = URL.createObjectURL(blob);
          scoreCardImg.onload = () => {
            if (scoreCardSlot) scoreCardSlot.classList.add("loaded");
          };
          scoreCardImg.src = currentCardUrl;
        })
        .catch((e) => {
          console.warn("score card failed", e);
        });
    });
  });
}

// ───────── Achievement toasts ─────────
const achievementToastStack = document.getElementById("achievement-toasts");
// Shared renderer for achievement icons. Supports two
// shapes from main.ts's ACHIEVEMENTS table:
//   - { iconHTML }  — inline multi-colour SVG fragment
//                     (drawn inside a 24×24 viewBox).
//   - { iconImage } — path to a sprite under /assets,
//                     rendered as a plain <img>. Used
//                     for the party-hat / thug-glasses
//                     cosmetics so the reward preview
//                     is literally the thing you unlock.
// Both input fields come from static strings in main.ts,
// so it's safe to use innerHTML for the SVG fragment.
type AchievementToast = {
  id: string;
  title: string;
  desc: string;
  iconHTML: string | null;
  iconImage: string | null;
  unlocked: boolean;
  secret: boolean;
};
function buildAchievementIconNode(ach: AchievementToast) {
  if (ach?.iconImage) {
    const img = document.createElement("img");
    img.src = ach.iconImage;
    img.alt = "";
    img.setAttribute("aria-hidden", "true");
    img.className = "achievement-icon-image";
    return img;
  }
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = ach?.iconHTML || "";
  return svg;
}

function showAchievementToast(ach: AchievementToast) {
  const game = window.Game;
  if (!achievementToastStack || !ach || !game) return;
  const el = document.createElement("div");
  el.className = "achievement-toast";
  const iconWrap = document.createElement("div");
  iconWrap.className = "achievement-toast-icon";
  iconWrap.appendChild(buildAchievementIconNode(ach));
  el.appendChild(iconWrap);

  const body = document.createElement("div");
  body.className = "achievement-toast-body";
  const kicker = document.createElement("div");
  kicker.className = "achievement-toast-kicker";
  // Show n/m counter
  const allAch = game.getAchievements ? game.getAchievements() : [];
  const unlocked = allAch.filter((a) => a.unlocked).length;
  kicker.textContent = `Achievement Unlocked (${unlocked}/${allAch.length})`;
  const title = document.createElement("div");
  title.className = "achievement-toast-title";
  title.textContent = ach.title;
  const desc = document.createElement("div");
  desc.className = "achievement-toast-desc";
  desc.textContent = ach.desc;
  body.appendChild(kicker);
  body.appendChild(title);
  body.appendChild(desc);
  el.appendChild(body);

  achievementToastStack.appendChild(el);
  // Entry animation fires from the CSS `toast-in`
  // keyframe the instant the element is in the DOM —
  // no explicit class toggle needed.
  // Slide out after a few seconds and remove from DOM
  // once the leave animation is done.
  setTimeout(() => {
    el.classList.add("leaving");
    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 420);
  }, 4200);
}

function hideScoreCard() {
  if (sharePanel) sharePanel.classList.remove("visible");
  if (scoreCardOverlay) scoreCardOverlay.classList.remove("visible");
  if (scoreCardSlot) scoreCardSlot.classList.remove("loaded");
  clearCard();
  shareInFlight = false;
  shareLabel = originalShareLabel;
  hideReviveOffer();
  syncScoreCardActions();
}

// ─── Revive offer ─────────────────────────────────────────
// The revive button sits above the Share/Play-again row. Always
// visible on game-over so the option is discoverable — but the
// button renders in a disabled "poor" state (desaturated, no click)
// when the player can't afford the current cost. A drain bar along
// the bottom signals the 5-second offer window. Click → spend coins
// → dismiss the score card and hand control back to the game loop
// (main.ts then runs a ~1s invulnerability grace period).
//
// All state flows through syncScoreCardActions() into the React
// <ScoreCardActions> component — reviveCost / reviveAffordable /
// reviveBalance / reviveKey drive the rendered button.
const REVIVE_OFFER_MS = 5000;
let reviveExpireTimer: number | null = null;

/** Hide the button AND the balance hint. Only used when the whole
 *  score card closes (restart / revive success) — expiry uses
 *  expireReviveOffer() below, which keeps the button visible. */
function hideReviveOffer() {
  if (reviveExpireTimer !== null) {
    clearTimeout(reviveExpireTimer);
    reviveExpireTimer = null;
  }
  if (coinFillRaf !== null) {
    cancelAnimationFrame(coinFillRaf);
    coinFillRaf = null;
  }
  // Drop the HUD override if the fill was cut short — scoreLoop can
  // go back to chasing getRunCoins() next frame. Next run opens on
  // 0 anyway (showScoreDisplay resets displayedCoins), so no need to
  // snap the HUD here.
  coinDrainOverride = false;
  reviveCost = null;
  reviveBalance = null;
  reviveAffordable = false;
}

// Coin-fill tween handle. Nulled while no fill animation is running.
let coinFillRaf: number | null = null;

// ─── Score-card focus (Revive / Share / Play again) ─────
// Mini-menu on the game-over card: the three action buttons are
// navigable with D-pad ←/→ (gamepad), keyboard ←/→, and activate on
// face-A / Enter. Revive is skipped when not offered (null cost) or
// disabled (can't afford + expiry). Mirrors the main menu's
// getNavigableMenuItems / focusKbd pattern so keyboard and gamepad
// share the exact same code path.
let _scoreCardFocusIdx = 0;
function isScoreCardOpen(): boolean {
  return !!sharePanel && sharePanel.classList.contains("visible");
}
function getNavigableScoreCardButtons(): HTMLElement[] {
  if (!sharePanel) return [];
  const list: HTMLElement[] = [];
  const rev = sharePanel.querySelector<HTMLButtonElement>(".revive-btn");
  if (rev && !rev.hidden && !rev.disabled) list.push(rev);
  const share = sharePanel.querySelector<HTMLButtonElement>(".share-score-btn");
  if (share && !share.hidden) list.push(share);
  const play = sharePanel.querySelector<HTMLButtonElement>(".play-again-btn");
  if (play && !play.hidden) list.push(play);
  return list;
}
function focusScoreCardIndex(idx: number) {
  const btns = getNavigableScoreCardButtons();
  if (!btns.length) return;
  _scoreCardFocusIdx = ((idx % btns.length) + btns.length) % btns.length;
  focusKbd(btns[_scoreCardFocusIdx]);
}
function currentScoreCardFocusIdx(): number {
  const btns = getNavigableScoreCardButtons();
  if (!btns.length) return 0;
  const idx = btns.indexOf(document.activeElement as HTMLElement);
  if (idx !== -1) return idx;
  return Math.min(Math.max(0, _scoreCardFocusIdx), btns.length - 1);
}
(window as any).__rrScoreCardFocusNext = () => {
  if (!isScoreCardOpen()) return;
  focusScoreCardIndex(currentScoreCardFocusIdx() + 1);
};
(window as any).__rrScoreCardFocusPrev = () => {
  if (!isScoreCardOpen()) return;
  focusScoreCardIndex(currentScoreCardFocusIdx() - 1);
};
(window as any).__rrScoreCardSelect = () => {
  if (!isScoreCardOpen()) return;
  const btns = getNavigableScoreCardButtons();
  const btn = btns[currentScoreCardFocusIdx()];
  btn?.click();
};
(window as any).__rrScoreCardHome = () => {
  if (!isScoreCardOpen()) return;
  // Close the score card AND return to the start screen — this is
  // the controller "B / Circle" path off game-over (and the
  // keyboard Escape path). Shares the home-screen re-entry logic
  // with the in-menu "Back to home screen" row.
  hideScoreCard();
  handleHomeClick();
};
(window as any).__rrScoreCardFocusInitial = () => {
  if (!isScoreCardOpen()) return;
  // Default focus sits on Play Again — it's the action most players
  // reach for at game-over, and "Enter-to-restart" muscle memory
  // should "just work" without an extra nav step. Revive and Share
  // are both reachable via ←/→ or ↑/↓ one tap away.
  const btns = getNavigableScoreCardButtons();
  if (!btns.length) return;
  const playIdx = btns.findIndex((b) => b.classList.contains("play-again-btn"));
  const startIdx = playIdx !== -1 ? playIdx : 0;
  focusScoreCardIndex(startIdx);
};
/** Kick off the "coins pour into the wallet" animation on the
 *  game-over card. Visual: the balance number tweens from
 *  (total − runCoins) up to total over ~1.2s with an ease-out.
 *  Audio: Game.playCoinFillAnim() plays up to 10 rising-pitch
 *  coin chimes evenly spaced across the same window, finished
 *  with the chain-end chord. No-op when runCoins is 0. */
function startCoinFillAnim(total: number, runCoins: number) {
  if (coinFillRaf !== null) {
    cancelAnimationFrame(coinFillRaf);
    coinFillRaf = null;
  }
  if (runCoins <= 0) return;
  const startAt = Math.max(0, total - runCoins);
  const DURATION_MS = 1200;
  const startTime = performance.now();
  window.Game?.playCoinFillAnim?.(runCoins, DURATION_MS);
  // Take over the HUD coin counter for the duration of the fill so
  // the top-left number drains from runCoins → 0 while the card
  // balance climbs from startAt → total. Reads as the coins "moving"
  // out of the run pouch and into the persistent wallet.
  coinDrainOverride = true;
  const step = () => {
    const now = performance.now();
    const t = Math.min(1, (now - startTime) / DURATION_MS);
    const eased = 1 - (1 - t) ** 3; // ease-out cubic
    reviveBalance = Math.round(startAt + (total - startAt) * eased);
    if (scoreCoinValueEl) {
      const drained = Math.round(runCoins * (1 - eased));
      scoreCoinValueEl.textContent = String(drained);
      displayedCoins = drained;
    }
    syncScoreCardActions();
    if (t < 1) {
      coinFillRaf = requestAnimationFrame(step);
    } else {
      coinFillRaf = null;
      reviveBalance = total;
      if (scoreCoinValueEl) {
        scoreCoinValueEl.textContent = "0";
        displayedCoins = 0;
      }
      // Leave coinDrainOverride on — state.runCoins is still at the
      // pre-drain value until the next run resets it, so un-pinning
      // now would snap the HUD right back to 10/whatever. The flag
      // clears in hideReviveOffer (card close) or showScoreDisplay
      // (new run).
      syncScoreCardActions();
    }
  };
  coinFillRaf = requestAnimationFrame(step);
}

/** Fires when the 5-second window elapses. Button stays rendered
 *  in the DOM (through the React component) so the player can
 *  still see the revive option + their coin balance, but
 *  reviveAffordable flips to false so clicks are ignored and the
 *  drain bar stops. */
function expireReviveOffer() {
  reviveExpireTimer = null;
  reviveAffordable = false;
  syncScoreCardActions();
}

function startReviveOffer() {
  hideReviveOffer();
  if (!window.Game?.isGameOver || !window.Game?.getReviveCost) return;
  if (!window.Game.isGameOver()) return; // No offer outside a game-over
  const cost = window.Game.getReviveCost();
  const balance = window.Game.getCoinsBalance?.() ?? 0;
  const runCoins = window.Game.getRunCoins?.() ?? 0;
  reviveCost = cost;
  // Seed the balance at the pre-run value so the fill tween has
  // somewhere to climb from. If there are no run coins to animate,
  // we skip the tween entirely and show the final balance.
  reviveBalance = Math.max(0, balance - runCoins);
  // Afford check must use the TRUE total, not the pre-tween seed —
  // the player can always afford whatever they just collected, and
  // we don't want the drain bar's visibility to flicker during the
  // animation.
  reviveAffordable = balance >= cost;
  // Bumping the key remounts the revive button in React so the
  // CSS .draining keyframe restarts from its from-frame on every
  // offer — equivalent to the vanilla reflow trick.
  reviveKey += 1;
  syncScoreCardActions();
  // Pour the run's coins into the balance visually + audibly.
  startCoinFillAnim(balance, runCoins);
  // Drain bar only plays when the offer is actually live — i.e.,
  // the player has enough coins. A draining bar on a can't-afford
  // button reads as "hurry up and buy" when there's nothing to buy
  // with.
  if (reviveAffordable) {
    reviveExpireTimer = window.setTimeout(expireReviveOffer, REVIVE_OFFER_MS);
  }
}

function handleReviveClick() {
  if (!reviveAffordable) return;
  if (!window.Game?.revive) return;
  const ok = window.Game.revive();
  if (ok) {
    hideReviveOffer();
    hideScoreCard();
  }
}

// Touch/mobile heuristic — on desktop we prefer clipboard
// copy, on touch we prefer the OS share sheet.
const isTouchDevice =
  window.matchMedia("(pointer: coarse)").matches || (navigator.maxTouchPoints || 0) > 1;

function setShareLabel(text: string) {
  shareLabel = text;
  syncScoreCardActions();
}
function flashShareLabel(text: string, duration = 1800) {
  setShareLabel(text);
  setTimeout(() => {
    if (!shareInFlight) setShareLabel(originalShareLabel);
  }, duration);
}

function isDesktopApp() {
  return !!window.electronAPI?.isDesktop;
}

function buildShareText(score: number) {
  if (isDesktopApp()) {
    return `🦖 I scored ${score} in Raptor Runner — can you beat me? ${STEAM_STORE_URL}`;
  }
  return `Can you beat my highscore of ${score} at https://raptor.trebeljahr.com?`;
}

async function handleShareClick() {
  if (shareInFlight || !currentCardBlob) return;
  shareInFlight = true;
  try {
    const score = window.Game?.getScore ? window.Game.getScore() : 0;
    const shareText = buildShareText(score);
    const file = new File([currentCardBlob], `raptor-runner-${score}.png`, { type: "image/png" });
    // Mobile: native share sheet with the file — the OS
    // decides whether the image, the text, or both end up
    // in the target app.
    if (isTouchDevice && navigator.canShare?.({ files: [file] }) && navigator.share) {
      try {
        await navigator.share({
          title: "Raptor Runner",
          text: shareText,
          files: [file],
        });
        flashShareLabel("Shared!");
        return;
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return; // cancelled
        // fall through to clipboard
      }
    }
    // Desktop / fallback: write BOTH the PNG and the share
    // text as a single ClipboardItem. Apps that only know
    // how to paste images (WhatsApp desktop) get the
    // picture; apps that paste rich content (Gmail, Slack)
    // get both. A single ClipboardItem is atomic — one
    // paste delivers both types.
    const textBlob = new Blob([shareText], {
      type: "text/plain",
    });
    if (navigator.clipboard && window.ClipboardItem && navigator.clipboard.write) {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            "image/png": currentCardBlob,
            "text/plain": textBlob,
          }),
        ]);
        flashShareLabel(isDesktopApp() ? "Invite copied!" : "Copied!");
        return;
      } catch (_e) {
        // Some browsers reject multi-type ClipboardItems;
        // fall back to image-only.
        try {
          await navigator.clipboard.write([new ClipboardItem({ "image/png": currentCardBlob })]);
          flashShareLabel(isDesktopApp() ? "Invite copied!" : "Copied!");
          return;
        } catch (_e2) {
          // fall through to text-only copy
        }
      }
    }
    // Last-resort text fallback: at least copy the share
    // sentence so the player has something to paste.
    try {
      await navigator.clipboard.writeText(shareText);
      flashShareLabel("Link copied!");
    } catch (_e) {
      flashShareLabel("Copy failed");
    }
  } finally {
    shareInFlight = false;
  }
}

// Play again — explicit restart action. Uses
// Game.restartFromGameOver which honours the short
// death-animation cooldown built into main.ts. Share, Revive, Play
// Again, and the restart hint are all rendered by the React
// <ScoreCardActions> component; their click handlers delegate back
// to the functions defined here (doRestart, handleShareClick,
// handleReviveClick).
function doRestart() {
  if (window.Game?.restartFromGameOver) {
    window.Game.restartFromGameOver();
  }
}
// Clicking anywhere on the game-over overlay backdrop
// (but not the panel itself) restarts the game via mouse
// only — touch devices already use "tap to restart" via
// the canvas pointerdown handler.
if (scoreCardOverlay) {
  scoreCardOverlay.addEventListener("click", (e) => {
    if (e.target === scoreCardOverlay) {
      doRestart();
    }
  });
}
// Seed an initial render so the React trees exist before the
// panels first open. The score-card hint renders immediately;
// revive stays hidden until startReviveOffer flips reviveCost to
// a number. The menu list seeds so the first openMenu() paints
// instantly rather than waiting on the subsequent refresh.
syncScoreCardActions();
syncMenuList();
// Paint the start screen immediately with the loading state so the
// button has real DOM to attach the boot-splash fade-out to. onGameReady
// later flips assetsReady and syncs again to reveal the ready state +
// personal-best badge.
syncStartScreen();
