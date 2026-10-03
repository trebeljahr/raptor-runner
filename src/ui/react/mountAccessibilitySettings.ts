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

// Keep the callback type alongside the mount entry point.
export type { AccessibilitySettingsCallbacks } from "./AccessibilitySettings";

let root: Root | null = null;

export function refreshAccessibilitySettings(callbacks: AccessibilitySettingsCallbacks): void {
  const host = document.querySelector(".accessibility-settings-body");
  if (!host) return;
  if (!root) root = createRoot(host);
  root.render(createElement(AccessibilitySettings, { callbacks }));
}
