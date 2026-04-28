// @ts-nocheck
import { createElement } from "react";
/*
 * Mount helper for the React <CosmeticsMenu>. Hosts inside the
 * existing #cosmetics-list div so the outer <details id="cosmetics">
 * (and its hidden-attribute gating in ui.ts) keeps driving
 * show/hide at the section level.
 */
import { createRoot, type Root } from "react-dom/client";
import { CosmeticsMenu, type CosmeticsMenuCallbacks } from "./CosmeticsMenu";

let root: Root | null = null;

export function refreshCosmeticsMenu(callbacks: CosmeticsMenuCallbacks): void {
  const host = document.getElementById("cosmetics-list");
  if (!host) return;
  if (!root) root = createRoot(host);
  root.render(createElement(CosmeticsMenu, { callbacks }));
}
