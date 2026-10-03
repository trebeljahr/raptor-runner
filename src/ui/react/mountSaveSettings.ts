import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SaveSettings } from "./SaveSettings";

let root: Root | null = null;
let host: HTMLElement | null = null;

/** Call when the parent opens or refreshes the save settings section. */
export function refreshSaveSettings(): void {
  const nextHost = document.getElementById("save-settings-body");
  if (!nextHost) return;
  if (host !== nextHost) {
    root?.unmount();
    host = nextHost;
    root = createRoot(host);
  }
  root?.render(createElement(SaveSettings));
}

/** Call on close to discard file previews and their confirmation tokens. */
export function unmountSaveSettings(): void {
  root?.unmount();
  root = null;
  host = null;
}
