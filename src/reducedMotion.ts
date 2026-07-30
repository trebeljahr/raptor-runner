/*
 * Raptor Runner — effective reduce-motion resolution.
 *
 * The user-facing setting is a three-way enum (system | on | off);
 * everything that damps motion needs a plain boolean answered per
 * frame. This module folds the OS preference (matchMedia) and the
 * explicit setting into one cached flag so the hot render/effects
 * paths pay a single function call + boolean read, never a
 * matchMedia query.
 *
 * Lives outside main.ts so the effects modules (particles, weather)
 * can read it without importing the orchestration layer, and outside
 * state.ts because it isn't run state — it survives resets and is
 * driven by settings + an OS media query, not the game loop.
 *
 * main.ts owns the setting's persistence and calls
 * setReduceMotionMode from its Game.setReduceMotion setter and at
 * load; consumers only ever call reduceMotion().
 */

import type { ReduceMotionSetting } from "./constants";

let mode: ReduceMotionSetting = "system";
let systemPrefers = false;
let effective = false;

function recompute(): void {
  effective = mode === "on" || (mode === "system" && systemPrefers);
}

// Guarded so the module stays importable under test runners or
// SSR-ish tooling where matchMedia may be absent.
const query =
  typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
if (query) {
  systemPrefers = query.matches;
  recompute();
  query.addEventListener("change", (e) => {
    systemPrefers = e.matches;
    recompute();
  });
}

/**
 * Apply a new reduce-motion mode. Recomputes the cached effective
 * flag and mirrors the EXPLICIT choices onto <body> as
 * data-reduce-motion="on"/"off" so the stylesheet's
 * prefers-reduced-motion blocks can be forced or overridden by the
 * in-game setting. "system" removes the attribute entirely — the
 * media query alone should govern, exactly as before the setting
 * existed.
 */
export function setReduceMotionMode(next: ReduceMotionSetting): void {
  mode = next;
  recompute();
  const body = typeof document !== "undefined" ? document.body : null;
  if (!body) return;
  if (mode === "system") delete body.dataset.reduceMotion;
  else body.dataset.reduceMotion = mode;
}

/** Effective "damp decorative motion" flag. Cheap enough to call
 *  per frame or per spawn. */
export function reduceMotion(): boolean {
  return effective;
}
