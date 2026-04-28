// @ts-nocheck
import { createElement } from "react";
/*
 * Mount helper for the React Achievements overlay. Same pattern as
 * mountShop.ts: the outer #achievements-overlay (class imprint-overlay)
 * stays in index.html for backdrop and open-state CSS, React renders
 * the sheet inside.
 */
import { createRoot, type Root } from "react-dom/client";
import { Achievements } from "./Achievements";

let root: Root | null = null;

export interface AchievementsCallbacks {
  onClose: () => void;
}

export function refreshAchievements(callbacks: AchievementsCallbacks): void {
  const host = document.getElementById("achievements-overlay");
  if (!host) return;
  if (!root) root = createRoot(host);
  root.render(createElement(Achievements, callbacks));
}
