import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as K from "./constants";
import type * as Persistence from "./persistence";
import type * as Backup from "./saveBackup";

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

let persistence: typeof Persistence;
let backup: typeof Backup;
let home: boolean;
let reload = vi.fn<() => void>();
let controller: InstanceType<typeof Backup.SaveBackupController>;

function file(data: Record<string, unknown> = { [K.HIGH_SCORE_KEY]: "123" }) {
  return JSON.stringify({
    product: "raptor-runner",
    formatVersion: 1,
    saveSchemaVersion: 1,
    exportedAt: "2026-10-03T12:00:00.000Z",
    data,
  });
}
function previewToken(text = file()): string {
  const result = controller.preview(text);
  if (!result.ok) throw new Error(result.error);
  return result.value.token;
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  vi.stubGlobal("localStorage", new MemoryStorage());
  persistence = await import("./persistence");
  backup = await import("./saveBackup");
  home = true;
  reload = vi.fn();
  controller = new backup.SaveBackupController(() => home, reload);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("backup format validation", () => {
  it("round-trips the latest queued progress and preferences without flushing them", () => {
    persistence.saveHighScore(200);
    persistence.saveBoolFlag(K.MUTED_KEY, true);
    const exported = controller.export();
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(backup.parseSaveBackup(exported.value.text).data).toMatchObject({
      [K.HIGH_SCORE_KEY]: "200",
      [K.MUTED_KEY]: "1",
    });
    expect(localStorage.getItem(K.HIGH_SCORE_KEY)).toBeNull();
    expect(exported.value.filename).toMatch(/^raptor-runner-save-.*\.json$/);
  });

  it.each([
    [K.HIGH_SCORE_KEY, "-1"],
    [K.HIGH_SCORE_KEY, "1.5"],
    [K.TOTAL_JUMPS_KEY, "9007199254740992"],
    [K.COINS_BALANCE_KEY, "NaN"],
    [K.MUTED_KEY, "true"],
    [K.MASTER_VOLUME_KEY, "1.1"],
    [K.TEXT_SCALE_KEY, "2"],
    [K.REDUCE_MOTION_KEY, "sometimes"],
    [K.JUMP_KEYS_KEY, ""],
    [K.JUMP_KEYS_KEY, "Enter"],
    [K.JUMP_KEYS_KEY, "KeyJ,KeyJ"],
    [K.JUMP_KEYS_KEY, " KeyJ"],
    [K.ACHIEVEMENTS_KEY, '["unknown-achievement"]'],
    [K.ACHIEVEMENTS_KEY, '["first-run","first-run"]'],
    [K.OWNED_COSMETICS_KEY, '["unknown-hat"]'],
    [K.RARE_EVENTS_SEEN_KEY, '{"ufo":-1}'],
    [K.RARE_EVENTS_SEEN_KEY, '{"unknown":1}'],
    [K.RARE_EVENTS_SEEN_KEY, '{"ufo":true}'],
    [K.EQUIPPED_COSMETICS_KEY, '{"head":"monocle","eyes":null,"neck":null}'],
    [K.EQUIPPED_COSMETICS_KEY, '{"head":"cowboy-hat","eyes":null,"neck":null}'],
    [K.CLOUD_SAVED_AT_KEY, "999"],
    ["unrelated-site-data", "value"],
    [K.HIGH_SCORE_KEY, 123],
  ])("rejects malformed or unsupported durable field %s: %s", (key, value) => {
    expect(() => backup.parseSaveBackup(file({ [key]: value }))).toThrow();
  });

  it.each([
    ["AudioVolumeDown", "MediaPlayPause", "BrowserBack"],
    ["Convert", "NonConvert", "KanaMode", "Lang1", "IntlRo", "IntlYen"],
    ["VendorKeyboardAction"],
    ["KeyA", "KeyB", "KeyC", "KeyD", "KeyE", "KeyF", "KeyG", "KeyH", "KeyI", "KeyJ"],
  ])("round-trips any canonical binding list accepted by the game setter: %s", (...codes) => {
    persistence.saveStringListSetting(K.JUMP_KEYS_KEY, codes);
    const exported = controller.export();
    expect(exported.ok).toBe(true);
    if (exported.ok) {
      expect(backup.parseSaveBackup(exported.value.text).data[K.JUMP_KEYS_KEY]).toBe(
        codes.join(","),
      );
    }
  });

  it("validates every durable field written by this version", () => {
    const data: Record<string, string> = {};
    for (const key of persistence.DURABLE_KEYS) {
      if (key === K.ACHIEVEMENTS_KEY) data[key] = '["first-run"]';
      else if (key === K.OWNED_COSMETICS_KEY) data[key] = '["cowboy-hat"]';
      else if (key === K.EQUIPPED_COSMETICS_KEY)
        data[key] = '{"head":"cowboy-hat","eyes":null,"neck":null}';
      else if (key === K.RARE_EVENTS_SEEN_KEY) data[key] = '{"ufo":1}';
      else if (key === K.REDUCE_MOTION_KEY) data[key] = "system";
      else if (key === K.JUMP_KEYS_KEY) data[key] = "Space,KeyW,ArrowUp";
      else if (key === K.TEXT_SCALE_KEY) data[key] = "1.25";
      else data[key] = "1";
    }
    expect(backup.parseSaveBackup(file(data)).data).toEqual(data);
  });

  it.each([
    "not JSON",
    "[]",
    '{"product":"other-game"}',
    file().replace('"formatVersion":1', '"formatVersion":2'),
    file().replace('"saveSchemaVersion":1', '"saveSchemaVersion":2'),
    file().replace('"exportedAt":"2026-10-03T12:00:00.000Z"', '"exportedAt":"invalid"'),
    file().replace('"data":', '"extra":true,"data":'),
    file().replace('"raptor-runner:highScore":"123"', '"__proto__":"pollute"'),
  ])("rejects invalid envelopes", (text) => {
    expect(() => backup.parseSaveBackup(text)).toThrow();
  });

  it("rejects oversized input by UTF-8 bytes, including multibyte text", () => {
    expect(() => backup.parseSaveBackup("x".repeat(backup.SAVE_BACKUP_MAX_BYTES + 1))).toThrow(
      /64 KB/,
    );
    expect(() => backup.parseSaveBackup("日".repeat(30_000))).toThrow(/64 KB/);
  });
});

describe("preview and deliberate confirmation", () => {
  it("previews incoming and current totals without changing any saved values", () => {
    localStorage.setItem(K.HIGH_SCORE_KEY, "50");
    const result = controller.preview(
      file({ [K.HIGH_SCORE_KEY]: "200", [K.COINS_BALANCE_KEY]: "12" }),
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        current: { bestMeters: 50 },
        incoming: { bestMeters: 200, coins: 12 },
      },
    });
    expect(localStorage.getItem(K.HIGH_SCORE_KEY)).toBe("50");
    expect(localStorage.length).toBe(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it("requires the exact preview token and an explicit final confirmation", () => {
    const token = previewToken();
    expect(controller.confirm(token, false).ok).toBe(false);
    expect(controller.confirm("other-token", true).ok).toBe(false);
    expect(localStorage.getItem(K.HIGH_SCORE_KEY)).toBeNull();
    expect(controller.confirm(token, true).ok).toBe(true);
    expect(localStorage.getItem(K.HIGH_SCORE_KEY)).toBe("123");
    expect(reload).toHaveBeenCalledTimes(1);
    expect(controller.confirm(token, true).ok).toBe(false);
  });

  it("cancellation or a new invalid preview invalidates the old token", () => {
    const first = previewToken();
    controller.cancel();
    expect(controller.confirm(first, true).ok).toBe(false);
    const second = previewToken();
    expect(controller.preview("invalid").ok).toBe(false);
    expect(controller.confirm(second, true).ok).toBe(false);
  });

  it("refuses import if settings change after the preview", () => {
    const token = previewToken();
    persistence.saveBoolFlag(K.MUTED_KEY, true);
    expect(controller.confirm(token, true)).toMatchObject({
      ok: false,
      error: expect.stringContaining("changed"),
    });
    expect(persistence.loadBoolFlag(K.MUTED_KEY, false)).toBe(true);
    expect(reload).not.toHaveBeenCalled();
  });

  it("refuses both preview and final confirmation away from home", () => {
    const token = previewToken();
    home = false;
    expect(controller.confirm(token, true).ok).toBe(false);
    expect(controller.preview(file()).ok).toBe(false);
    expect(controller.export().ok).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("preserves unrelated data and prevents queued or old-engine writes after import", () => {
    localStorage.setItem("another-app:record", "keep");
    localStorage.setItem(K.CLOUD_SAVED_AT_KEY, "456");
    persistence.saveHighScore(50);
    persistence.saveBoolFlag(K.MUTED_KEY, true);
    const token = previewToken(file({ [K.HIGH_SCORE_KEY]: "200", [K.MUTED_KEY]: "0" }));
    expect(controller.confirm(token, true).ok).toBe(true);
    persistence.saveHighScore(1);
    persistence.saveBoolFlag(K.MUTED_KEY, true);
    persistence.flushPersistenceWrites();
    expect(localStorage.getItem(K.HIGH_SCORE_KEY)).toBe("200");
    expect(localStorage.getItem(K.MUTED_KEY)).toBe("0");
    expect(localStorage.getItem("another-app:record")).toBe("keep");
    expect(localStorage.getItem(K.CLOUD_SAVED_AT_KEY)).toBe("456");
    expect(localStorage.getItem(persistence.SAVE_RESTORE_JOURNAL_KEY)).toBeNull();
    expect(persistence.getPersistenceWriteStatus().reloadRequired).toBe(true);
  });

  it("resets omitted game keys to defaults rather than mixing two saves", () => {
    localStorage.setItem(K.COINS_BALANCE_KEY, "999");
    localStorage.setItem(K.MUTED_KEY, "1");
    expect(controller.confirm(previewToken(), true).ok).toBe(true);
    expect(localStorage.getItem(K.COINS_BALANCE_KEY)).toBeNull();
    expect(localStorage.getItem(K.MUTED_KEY)).toBeNull();
  });

  it("rejects desktop, mobile and active mirror writes without touching them", () => {
    const listener = vi.fn();
    persistence.setPersistenceWriteListener(listener);
    expect(controller.confirm(previewToken(), true).ok).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    persistence.setPersistenceWriteListener(null);
    vi.stubGlobal("electronAPI", {});
    expect(controller.getStatus().supported).toBe(false);
    expect(controller.export().ok).toBe(false);
    vi.stubGlobal("electronAPI", undefined);
    vi.stubGlobal("__IS_CAPACITOR__", true);
    expect(controller.getStatus().supported).toBe(false);
    expect(controller.preview(file()).ok).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("failed or interrupted storage writes", () => {
  it("reports denied reads as unavailable instead of exporting an empty save", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(controller.getStatus().available).toBe(false);
    expect(controller.export().ok).toBe(false);
    expect(controller.preview(file()).ok).toBe(false);
  });

  it("retains failed queued writes for a backup rather than losing preferences", () => {
    const set = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    persistence.saveBoolFlag(K.MUTED_KEY, true);
    persistence.flushPersistenceWrites();
    expect(persistence.readDurableSnapshotForBackup()[K.MUTED_KEY]).toBe("1");
    expect(controller.getStatus().message).toContain("could not save");
    expect(controller.export().ok).toBe(true);
    set.mockRestore();
    persistence.flushPersistenceWrites();
    expect(localStorage.getItem(K.MUTED_KEY)).toBe("1");
  });

  it("leaves all keys unchanged if the protective journal cannot be written", () => {
    localStorage.setItem(K.HIGH_SCORE_KEY, "50");
    const token = previewToken();
    const original = window.localStorage.setItem.bind(window.localStorage);
    vi.spyOn(window.localStorage, "setItem").mockImplementation(function (
      this: Storage,
      key,
      value,
    ) {
      if (key === persistence.SAVE_RESTORE_JOURNAL_KEY) throw new Error("quota");
      original.call(this, key, value);
    });
    expect(controller.confirm(token, true).ok).toBe(false);
    expect(localStorage.getItem(K.HIGH_SCORE_KEY)).toBe("50");
    expect(reload).not.toHaveBeenCalled();
  });

  it("rolls back partial writes and preserves settings that were still queued", () => {
    localStorage.setItem(K.HIGH_SCORE_KEY, "50");
    persistence.saveBoolFlag(K.MUTED_KEY, true);
    const token = previewToken(file({ [K.HIGH_SCORE_KEY]: "200", [K.MUTED_KEY]: "0" }));
    const original = window.localStorage.setItem.bind(window.localStorage);
    let failed = false;
    vi.spyOn(window.localStorage, "setItem").mockImplementation(function (
      this: Storage,
      key,
      value,
    ) {
      if (!failed && key === K.MUTED_KEY && value === "0") {
        failed = true;
        throw new Error("quota");
      }
      original.call(this, key, value);
    });
    expect(controller.confirm(token, true)).toMatchObject({
      ok: false,
      error: expect.stringContaining("restored"),
    });
    expect(localStorage.getItem(K.HIGH_SCORE_KEY)).toBe("50");
    expect(localStorage.getItem(K.MUTED_KEY)).toBe("1");
    persistence.flushPersistenceWrites();
    expect(localStorage.getItem(K.MUTED_KEY)).toBe("1");
    expect(reload).not.toHaveBeenCalled();
  });

  it("keeps the journal and blocks idle writes when rollback needs a later recovery", () => {
    localStorage.setItem(K.HIGH_SCORE_KEY, "50");
    persistence.saveBoolFlag(K.MUTED_KEY, true);
    const token = previewToken(file({ [K.HIGH_SCORE_KEY]: "200", [K.MUTED_KEY]: "0" }));
    const original = window.localStorage.setItem.bind(window.localStorage);
    const set = vi.spyOn(window.localStorage, "setItem").mockImplementation(function (
      this: Storage,
      key,
      value,
    ) {
      if (key === K.MUTED_KEY) throw new Error("quota");
      original.call(this, key, value);
    });
    expect(controller.confirm(token, true)).toMatchObject({
      ok: false,
      error: expect.stringContaining("Recovery is pending"),
    });
    expect(localStorage.getItem(persistence.SAVE_RESTORE_JOURNAL_KEY)).not.toBeNull();
    const calls = set.mock.calls.length;
    persistence.flushPersistenceWrites();
    expect(set.mock.calls).toHaveLength(calls);
    set.mockRestore();
    persistence.recoverPendingSaveRestore();
    expect(localStorage.getItem(K.HIGH_SCORE_KEY)).toBe("50");
    expect(localStorage.getItem(K.MUTED_KEY)).toBe("1");
    expect(localStorage.getItem(persistence.SAVE_RESTORE_JOURNAL_KEY)).toBeNull();
  });

  it("recovers an interrupted overwrite before boot-time settings reads", async () => {
    localStorage.setItem(
      persistence.SAVE_RESTORE_JOURNAL_KEY,
      JSON.stringify({ version: 1, before: { [K.HIGH_SCORE_KEY]: "50", [K.MUTED_KEY]: "1" } }),
    );
    localStorage.setItem(K.HIGH_SCORE_KEY, "200");
    localStorage.setItem(K.MUTED_KEY, "0");
    vi.resetModules();
    const boot = await import("./persistence");
    boot.recoverPendingSaveRestore();
    expect(boot.loadHighScore()).toBe(50);
    expect(boot.loadBoolFlag(K.MUTED_KEY, false)).toBe(true);
  });
});
