// @ts-nocheck
import { createElement } from "react";
/*
 * Mount helper for the React <AccessibilitySettings> body. The outer
 * <details id="accessibility-settings"> with its <summary> stays
 * vanilla in index.html — we only replace the body div's inner
 * content. Mirrors mountSoundSettings.ts.
 */
import { createRoot, type Root } from "react-dom/client";
import {
  AccessibilitySettings,
  type AccessibilitySettingsCallbacks,
} from "./AccessibilitySettings";

// Re-exported so ui.ts (which IS type-checked) can annotate its
// callbacks table without importing the .tsx module directly —
// tsc runs without the --jsx flag, so .tsx imports only resolve
// from inside @ts-nocheck files like this one.
export type { AccessibilitySettingsCallbacks } from "./AccessibilitySettings";

let root: Root | null = null;

export function refreshAccessibilitySettings(callbacks: AccessibilitySettingsCallbacks): void {
  const host = document.querySelector(".accessibility-settings-body");
  if (!host) return;
  if (!root) root = createRoot(host);
  root.render(createElement(AccessibilitySettings, { callbacks }));
}
