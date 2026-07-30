/*
 * Raptor Runner — high-contrast mode flag.
 *
 * Mirrors reducedMotion.ts: main.ts owns the setting's persistence
 * and calls setHighContrastMode from its Game.setHighContrast setter
 * and at load; render code polls highContrast() per frame, so the
 * hot paths pay one function call + boolean read.
 *
 * The mode has two halves, both keyed off this flag:
 *  - UI chrome: the <body data-high-contrast="true"> attribute
 *    switches the palette-token overrides in styles/base.css.
 *  - Canvas world: the fg→main composite in main.ts applies a
 *    legibility filter, and render/sky.ts damps the sky-light tint
 *    so silhouettes keep their own colour instead of blending
 *    toward the sky.
 *
 * Lives outside main.ts so render/sky.ts can read it without
 * importing the orchestration layer, and outside state.ts because
 * it isn't run state — it survives resets.
 */

let enabled = false;

/** Apply high-contrast mode: caches the flag for the render paths
 *  and stamps/removes the body attribute the stylesheet keys on.
 *  Safe to call before init() completes and cheap to call again. */
export function setHighContrastMode(on: boolean): void {
  enabled = on === true;
  const body = typeof document !== "undefined" ? document.body : null;
  if (!body) return;
  if (enabled) body.dataset.highContrast = "true";
  else delete body.dataset.highContrast;
}

/** Cached high-contrast flag. Cheap enough to call per frame. */
export function highContrast(): boolean {
  return enabled;
}
