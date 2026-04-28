// @ts-nocheck
import { createElement } from "react";
/*
 * Mount helper for <StartScreen>. Hosts inside a dedicated
 * #start-content-root div so the surrounding #start-screen wrapper,
 * its CSS-animated clouds/ground/cacti, and the cosmetic-aware
 * raptor stage (painted by refreshStartRaptorCosmetics) stay in
 * vanilla DOM.
 */
import { createRoot, type Root } from "react-dom/client";
import { StartScreen, type StartScreenCallbacks } from "./StartScreen";

let root: Root | null = null;

export function refreshStartScreen(callbacks: StartScreenCallbacks): void {
  const host = document.getElementById("start-content-root");
  if (!host) return;
  if (!root) root = createRoot(host);
  root.render(createElement(StartScreen, { callbacks }));
}
