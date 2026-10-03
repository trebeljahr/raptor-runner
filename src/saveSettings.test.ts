import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SaveSettings } from "./ui/react/SaveSettings";

let container: HTMLDivElement;
let root: Root;
const summary = { bestMeters: 10, coins: 2, runs: 1, achievements: 1, cosmetics: 0 };
const status = {
  supported: true,
  available: true,
  canImport: true,
  message: "Saved in this browser.",
  maxFileBytes: 65536,
};
let api: {
  getSaveBackupStatus: ReturnType<typeof vi.fn>;
  previewSaveImport: ReturnType<typeof vi.fn>;
  cancelSaveImport: ReturnType<typeof vi.fn>;
  confirmSaveImport: ReturnType<typeof vi.fn>;
  exportSaveBackup: ReturnType<typeof vi.fn>;
};

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api = {
    getSaveBackupStatus: vi.fn(() => status),
    previewSaveImport: vi.fn(() => ({
      ok: true,
      value: {
        token: "preview-token",
        exportedAt: "2026-10-03T12:00:00.000Z",
        current: summary,
        incoming: { ...summary, bestMeters: 100 },
      },
    })),
    cancelSaveImport: vi.fn(),
    confirmSaveImport: vi.fn(() => ({ ok: true, value: { reloadRequired: true } })),
    exportSaveBackup: vi.fn(),
  };
  window.Game = api as unknown as NonNullable<Window["Game"]>;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(React.createElement(SaveSettings)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete window.Game;
  vi.unstubAllGlobals();
});

async function choose(file: { size: number; text: () => Promise<string> }) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
}
function button(label: string): HTMLButtonElement {
  return [...container.querySelectorAll("button")].find((item) => item.textContent === label)!;
}

it("requires a preview and checkbox confirmation before the overwrite button can run", async () => {
  expect(button("Replace save and reload")).toBeUndefined();
  await choose({ size: 100, text: async () => "backup-json" });
  expect(api.previewSaveImport).toHaveBeenCalledWith("backup-json");
  expect(button("Replace save and reload").disabled).toBe(true);
  expect(container.querySelector("table")?.textContent).toContain("100");
  expect(api.confirmSaveImport).not.toHaveBeenCalled();
  const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  await act(async () => checkbox.click());
  expect(button("Replace save and reload").disabled).toBe(false);
  await act(async () => button("Replace save and reload").click());
  expect(api.confirmSaveImport).toHaveBeenCalledWith("preview-token", true);
  expect(container.textContent).toContain("Backup imported");
});

it("checks file size before reading any contents", async () => {
  const text = vi.fn(async () => "large");
  await choose({ size: 65537, text });
  expect(text).not.toHaveBeenCalled();
  expect(api.previewSaveImport).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("64 KB");
});

it("cancels previews without writing anything", async () => {
  await choose({ size: 100, text: async () => "backup-json" });
  await act(async () => button("Cancel import").click());
  expect(button("Replace save and reload")).toBeUndefined();
  expect(api.cancelSaveImport).toHaveBeenCalled();
  expect(api.confirmSaveImport).not.toHaveBeenCalled();
});

it("ignores a stale file read that completes after a new file selection", async () => {
  let complete!: (text: string) => void;
  const staleRead = new Promise<string>((resolve) => {
    complete = resolve;
  });
  // File controls are disabled while reading; a synthetic second change still
  // must not let the older async completion replace the current preview.
  await choose({ size: 100, text: () => staleRead });
  await choose({ size: 100, text: async () => "new-backup" });
  await act(async () => complete("old-backup"));
  expect(api.previewSaveImport).toHaveBeenCalledTimes(1);
  expect(api.previewSaveImport).toHaveBeenCalledWith("new-backup");
});

it("hides browser transfer controls in native sessions", async () => {
  api.getSaveBackupStatus.mockReturnValue({ ...status, supported: false });
  await act(async () => root.render(React.createElement(SaveSettings)));
  expect(container.textContent).toBe("");
});

it("disables transfers during a run and explains returning home", async () => {
  api.getSaveBackupStatus.mockReturnValue({ ...status, canImport: false });
  await act(async () => root.render(React.createElement(SaveSettings)));
  expect(button("Export save").disabled).toBe(true);
  expect(container.querySelector<HTMLInputElement>('input[type="file"]')?.disabled).toBe(true);
  expect(container.textContent).toContain("Return to the home screen");
});
