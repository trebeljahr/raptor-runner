// @ts-nocheck
import { createElement } from "react";
/*
 * Mount helper for the React <MenuList> — the main pause-menu nav
 * buttons + close-hint + menu-hint + gamepad-hint + made-by footer.
 * Hosts inside the #menu-list-root div in index.html which sits
 * where the old <ul> used to live.
 */
import { createRoot, type Root } from "react-dom/client";
import { MenuList, type MenuListCallbacks } from "./MenuList";

let root: Root | null = null;

export function refreshMenuList(callbacks: MenuListCallbacks): void {
  const host = document.getElementById("menu-list-root");
  if (!host) return;
  if (!root) root = createRoot(host);
  root.render(createElement(MenuList, { callbacks }));
}
