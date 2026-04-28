// @ts-nocheck
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Credits, type CreditsCallbacks } from "./Credits";

let root: Root | null = null;

export function refreshCredits(callbacks: CreditsCallbacks): void {
  const host = document.getElementById("credits-overlay");
  if (!host) return;
  if (!root) root = createRoot(host);
  root.render(createElement(Credits, { callbacks }));
}
