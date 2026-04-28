// @ts-nocheck
import { createElement } from "react";
/*
 * Mount helper for <DebugSettings>. Hosts inside the existing
 * .debug-settings-body <ul>. The outer <details id="debug-settings">
 * and its data-debug="true" / .debug-only gating remain in index.html
 * so production builds (where body[data-debug] is unset) never
 * reveal the section.
 */
import { createRoot, type Root } from "react-dom/client";
import { DebugSettings, type DebugSettingsCallbacks } from "./DebugSettings";

let root: Root | null = null;

export function refreshDebugSettings(callbacks: DebugSettingsCallbacks): void {
  const host = document.querySelector(".debug-settings-body");
  if (!host) return;
  if (!root) root = createRoot(host);
  root.render(createElement(DebugSettings, { callbacks }));
}
