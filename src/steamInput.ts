/*
 * Renderer-side Steam Input bridge.
 *
 * The Electron main process polls the Steam Input API at ~60 Hz and
 * pushes level-state snapshots over IPC (see electron/main.ts). This
 * module caches the latest snapshot with a receipt timestamp; the
 * gamepad poll in main.ts consumes it via getFreshSteamFrame() and
 * falls back to the W3C Gamepad API the moment frames stop arriving.
 * Timestamps are taken on receipt with performance.now() — never
 * trusted across process boundaries, so main-process clock behaviour
 * is irrelevant.
 *
 * In web/mobile builds window.electronAPI is undefined and every
 * export here is a no-op; on Steam-less desktop sessions the main
 * process never sends a frame, so getFreshSteamFrame() stays null and
 * the W3C path runs exactly as before.
 *
 * Imported by main.ts only — ui.ts keeps talking to the game through
 * window.Game, the UI/game boundary is untouched.
 */

import type { SteamActionSetName } from "./input/steamActions";

/**
 * Frames older than this are treated as "Steam is gone". ~15 poll
 * periods: wide enough to absorb a main-process hitch, short enough
 * that when Steam dies mid-session the W3C fallback engages within a
 * quarter second.
 */
const STEAM_FRAME_FRESH_MS = 250;

let _latest: { frame: SteamInputFrame; at: number } | null = null;
let _subscribed = false;
let _lastSentSet: SteamActionSetName | null = null;

/**
 * Subscribe to main-process snapshot frames. Safe to call in every
 * build target; does nothing unless the preload bridge exposes the
 * Steam Input surface.
 *
 * `onControllersLost` fires on the controllerCount > 0 → 0 transition
 * — the Steam-side equivalent of the last pad unplugging. When a
 * Steam-owned controller disconnects, Steam also removes the emulated
 * pad it shows to Chromium, so the browser's `gamepaddisconnected`
 * fires as well; the callback target must be (and is) idempotent, so
 * the double notification is harmless.
 */
export function initSteamInput(opts: { onControllersLost: () => void }): void {
  if (_subscribed) return;
  const api = window.electronAPI;
  if (!api?.onSteamInputFrame) return;
  _subscribed = true;
  api.onSteamInputFrame((frame) => {
    const prev = _latest?.frame ?? null;
    _latest = { frame, at: performance.now() };
    if (prev && prev.controllerCount > 0 && frame.controllerCount === 0) {
      opts.onControllersLost();
    }
  });
}

/**
 * The latest snapshot, or null once frames go stale. Callers must
 * additionally check `available` / `controllerCount` before treating
 * Steam Input as the live input source.
 */
export function getFreshSteamFrame(): SteamInputFrame | null {
  if (!_latest) return null;
  if (performance.now() - _latest.at > STEAM_FRAME_FRESH_MS) return null;
  return _latest.frame;
}

/**
 * Ask the main process to activate an action set. Cached — only one
 * IPC round-trip per actual transition, so it is safe (and intended)
 * to call every frame with the currently-desired set. On failure the
 * cache clears so the next call retries.
 */
export function syncSteamActionSet(name: SteamActionSetName): void {
  if (name === _lastSentSet) return;
  _lastSentSet = name;
  window.electronAPI
    ?.setSteamActionSet(name)
    .then((ok) => {
      if (!ok) _lastSentSet = null;
    })
    .catch(() => {
      _lastSentSet = null;
    });
}
