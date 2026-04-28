// @ts-nocheck
import { createElement } from "react";
/*
 * Two mount helpers — one each for the About and Imprint overlays —
 * share the <IframeOverlay> component. Each overlay gets its own
 * React root, its own lazy iframe src state, and its own host
 * element, so they don't interfere when both are mounted at once.
 */
import { createRoot, type Root } from "react-dom/client";
import { IframeOverlay, type IframeOverlayProps } from "./IframeOverlay";

let aboutRoot: Root | null = null;
let imprintRoot: Root | null = null;

export function refreshAboutOverlay(props: Omit<IframeOverlayProps, "iframeTitle">): void {
  const host = document.getElementById("about-overlay");
  if (!host) return;
  if (!aboutRoot) aboutRoot = createRoot(host);
  aboutRoot.render(
    createElement(IframeOverlay, {
      ...props,
      iframeTitle: "About Raptor Runner",
    }),
  );
}

export function refreshImprintOverlay(props: Omit<IframeOverlayProps, "iframeTitle">): void {
  const host = document.getElementById("imprint-overlay");
  if (!host) return;
  if (!imprintRoot) imprintRoot = createRoot(host);
  imprintRoot.render(
    createElement(IframeOverlay, {
      ...props,
      iframeTitle: "Imprint",
    }),
  );
}
