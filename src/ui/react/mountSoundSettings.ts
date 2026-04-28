// @ts-nocheck
import { createElement } from "react";
/*
 * Mount helper for the React <SoundSettings> body. The outer <details
 * id="sound-settings"> with its <summary> stays vanilla in index.html
 * — we only replace the body div's inner content.
 */
import { createRoot, type Root } from "react-dom/client";
import { SoundSettings, type SoundSettingsCallbacks } from "./SoundSettings";

let root: Root | null = null;

export function refreshSoundSettings(callbacks: SoundSettingsCallbacks): void {
  const host = document.querySelector(".sound-settings-body");
  if (!host) return;
  if (!root) root = createRoot(host);
  root.render(createElement(SoundSettings, { callbacks }));
}
