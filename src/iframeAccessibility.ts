/*
 * Raptor Runner — accessibility propagation into same-origin iframes.
 *
 * The About and Imprint overlays render standalone HTML pages
 * (about.html / imprint.html) in an <iframe>. Those child documents
 * size their text in rem against their OWN root and never load the
 * game's settings, so a player's text scale would silently stop at
 * the iframe boundary. This module copies the parent root's inline
 * font-size / --text-scale and the body's high-contrast marker into
 * every reachable child document.
 *
 * Two call sites keep the copies fresh:
 *  - the setting appliers (applyTextScale, setHighContrastMode) call
 *    syncEmbeddedDocs() so already-loaded iframes update live, and
 *  - IframeOverlay's load handler calls syncEmbeddedDoc(frame) so a
 *    lazily-loaded page picks the values up on arrival.
 */

/** Copy accessibility presentation state into one iframe's document.
 *  Cross-origin frames throw on contentDocument access — swallowed,
 *  since there is nothing we could do for them anyway. */
export function syncEmbeddedDoc(frame: HTMLIFrameElement): void {
  let doc: Document | null;
  try {
    doc = frame.contentDocument;
  } catch {
    return;
  }
  const childRoot = doc?.documentElement;
  if (!childRoot) return;
  const parentRoot = document.documentElement;
  const fontSize = parentRoot.style.fontSize;
  const textScale = parentRoot.style.getPropertyValue("--text-scale");
  if (fontSize) childRoot.style.fontSize = fontSize;
  else childRoot.style.removeProperty("font-size");
  if (textScale) childRoot.style.setProperty("--text-scale", textScale);
  else childRoot.style.removeProperty("--text-scale");
  const childBody = doc?.body;
  if (childBody) {
    if (document.body?.dataset.highContrast) childBody.dataset.highContrast = "true";
    else delete childBody.dataset.highContrast;
  }
}

/** Push the current values into every iframe on the page. */
export function syncEmbeddedDocs(): void {
  if (typeof document === "undefined") return;
  for (const frame of document.querySelectorAll("iframe")) {
    syncEmbeddedDoc(frame);
  }
}
