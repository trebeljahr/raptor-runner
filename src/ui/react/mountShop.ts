// @ts-nocheck
import { createElement } from "react";
/*
 * Mount helper for the React Shop overlay.
 *
 * The outer #shop-overlay div (with class="imprint-overlay") stays in
 * index.html so existing CSS (backdrop, open-state positioning) and
 * the open/close class toggle in ui.ts continue to work unchanged.
 * React only owns the sheet contents inside.
 *
 * refreshShop() is called from ui.ts's openShop() and is a no-op if
 * the host element isn't in the DOM yet. First call lazily creates
 * the root; subsequent calls re-render so the component re-reads
 * window.Game state (coin balance, inventory, owned/equipped).
 */
import { createRoot, type Root } from "react-dom/client";
import { Shop } from "./Shop";

let root: Root | null = null;

export interface ShopCallbacks {
  onClose: () => void;
  onShopChange: () => void;
}

export function refreshShop(callbacks: ShopCallbacks): void {
  const host = document.getElementById("shop-overlay");
  if (!host) return;
  if (!root) root = createRoot(host);
  root.render(createElement(Shop, callbacks));
}
