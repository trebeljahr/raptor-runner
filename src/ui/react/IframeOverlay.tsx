// @ts-nocheck
/*
 * Generic iframe-sheet overlay — shared shell for the About and
 * Imprint overlays. Both are just a close × and an iframe pointing
 * at a standalone HTML page in the build root (about.html /
 * imprint.html), so they have no meaningful content divergence —
 * one component renders either one.
 *
 * The iframe's src flips lazily from "about:blank" to the real path
 * on first open, driven by the iframeSrc prop. ui.ts keeps the
 * "have we ever opened this" flag and flips the prop on first open.
 */
import { type MouseEvent, useEffect, useRef } from "react";

export interface IframeOverlayCallbacks {
  onClose: () => void;
}
export interface IframeOverlayProps {
  callbacks: IframeOverlayCallbacks;
  iframeTitle: string;
  iframeSrc: string; // "about:blank" until the overlay has been opened
}

export function IframeOverlay({ callbacks: cb, iframeTitle, iframeSrc }: IframeOverlayProps) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const handleClose = (e: MouseEvent) => {
    e.stopPropagation();
    cb.onClose();
  };

  return (
    <div className="imprint-sheet">
      <button
        type="button"
        ref={closeRef}
        className="imprint-close"
        aria-label="Close"
        onClick={handleClose}
      >
        ×
      </button>
      <iframe title={iframeTitle} src={iframeSrc} loading="lazy" />
    </div>
  );
}
