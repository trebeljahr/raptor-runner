import { ACHIEVEMENTS } from "./achievements";
import * as K from "./constants";
import { COSMETIC_SLOTS, COSMETICS } from "./cosmetics";
import {
  DURABLE_KEYS,
  type DurableSnapshotData,
  getPersistenceWriteStatus,
  PERSISTENCE_SCHEMA_VERSION,
  readDurableSnapshotForBackup,
  replaceDurableSnapshotForBackup,
} from "./persistence";

export const SAVE_BACKUP_MAX_BYTES = 64 * 1024;
const PRODUCT = "raptor-runner";
const FORMAT_VERSION = 1;
const achievementIds = new Set(ACHIEVEMENTS.map(({ id }) => id));
const cosmeticIds = new Set(COSMETICS.map(({ id }) => id));
const rareEventIds = new Set(["ufo", "santa", "tumbleweed", "comet", "meteor"]);
const durableKeys = new Set(DURABLE_KEYS);
const integerKeys = new Set<string>([
  K.HIGH_SCORE_KEY,
  K.TOTAL_JUMPS_KEY,
  K.TOTAL_NIGHTS_KEY,
  K.CAREER_RUNS_KEY,
  K.TOTAL_DAY_CYCLES_KEY,
  K.COINS_BALANCE_KEY,
  K.COINS_COLLECTED_KEY,
]);
const booleanKeys = new Set<string>([
  K.MUTED_KEY,
  K.MUSIC_MUTED_KEY,
  K.JUMP_MUTED_KEY,
  K.RAIN_MUTED_KEY,
  K.FOOTSTEPS_MUTED_KEY,
  K.COINS_MUTED_KEY,
  K.UI_MUTED_KEY,
  K.EVENTS_MUTED_KEY,
  K.THUNDER_MUTED_KEY,
  K.HIGH_CONTRAST_KEY,
  K.UNLOCKED_PARTY_HAT_KEY,
  K.UNLOCKED_THUG_GLASSES_KEY,
  K.WEAR_PARTY_HAT_KEY,
  K.WEAR_THUG_GLASSES_KEY,
  K.UNLOCKED_BOW_TIE_KEY,
  K.WEAR_BOW_TIE_KEY,
]);
const volumeKeys = new Set<string>([
  K.MASTER_VOLUME_KEY,
  K.MUSIC_VOLUME_KEY,
  K.JUMP_VOLUME_KEY,
  K.RAIN_VOLUME_KEY,
  K.THUNDER_VOLUME_KEY,
  K.FOOTSTEPS_VOLUME_KEY,
  K.COINS_VOLUME_KEY,
  K.UI_VOLUME_KEY,
  K.EVENTS_VOLUME_KEY,
]);

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function nonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function validNumber(raw: string, min: number, max: number, integer = false): boolean {
  const value = Number(raw);
  return (
    raw.length > 0 &&
    String(value) === raw &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max &&
    (!integer || Number.isSafeInteger(value))
  );
}
function validIds(value: unknown, allowed: Set<string>): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((id) => typeof id === "string" && allowed.has(id)) &&
    new Set(value).size === value.length
  );
}
function validKeyCodes(raw: string): boolean {
  const codes = raw.split(",");
  // Match Game.setJumpKeys' saved output. KeyboardEvent.code includes media,
  // international and vendor-specific keys; an enum would reject real saves.
  return (
    codes.length > 0 &&
    new Set(codes).size === codes.length &&
    codes.every(
      (code) =>
        code.length > 0 &&
        code === code.trim() &&
        !(K.RESERVED_KEY_CODES as readonly string[]).includes(code),
    )
  );
}

/** Strict import validation, deliberately narrower than corruption-tolerant loaders. */
export function validateBackupData(input: unknown): DurableSnapshotData {
  if (!record(input)) throw new Error("The backup has no valid save data.");
  const data: DurableSnapshotData = Object.create(null);
  for (const [key, raw] of Object.entries(input)) {
    if (!durableKeys.has(key) || typeof raw !== "string" || raw.length > 8192) {
      throw new Error("The backup contains unknown or invalid save fields.");
    }
    let valid = false;
    try {
      if (integerKeys.has(key)) valid = validNumber(raw, 0, Number.MAX_SAFE_INTEGER, true);
      else if (booleanKeys.has(key)) valid = raw === "0" || raw === "1";
      else if (volumeKeys.has(key)) valid = validNumber(raw, 0, 1);
      else if (key === K.TEXT_SCALE_KEY)
        valid = validNumber(raw, K.TEXT_SCALE_MIN, K.TEXT_SCALE_MAX);
      else if (key === K.REDUCE_MOTION_KEY)
        valid = (K.REDUCE_MOTION_VALUES as readonly string[]).includes(raw);
      else if (key === K.JUMP_KEYS_KEY) valid = validKeyCodes(raw);
      else if (key === K.ACHIEVEMENTS_KEY) valid = validIds(JSON.parse(raw), achievementIds);
      else if (key === K.OWNED_COSMETICS_KEY) valid = validIds(JSON.parse(raw), cosmeticIds);
      else if (key === K.RARE_EVENTS_SEEN_KEY) {
        const seen: unknown = JSON.parse(raw);
        valid =
          record(seen) &&
          Object.entries(seen).every(
            ([id, count]) => rareEventIds.has(id) && nonnegativeInteger(count),
          );
      } else if (key === K.EQUIPPED_COSMETICS_KEY) {
        const equipped: unknown = JSON.parse(raw);
        valid =
          record(equipped) &&
          Object.keys(equipped).length === COSMETIC_SLOTS.length &&
          COSMETIC_SLOTS.every(
            (slot) =>
              Object.hasOwn(equipped, slot) &&
              (equipped[slot] === null ||
                COSMETICS.some((item) => item.id === equipped[slot] && item.slot === slot)),
          );
      }
    } catch {
      valid = false;
    }
    if (!valid) throw new Error("The backup contains an invalid setting or progress value.");
    data[key] = raw;
  }
  const owned = new Set<string>(JSON.parse(data[K.OWNED_COSMETICS_KEY] ?? "[]"));
  for (const [id, flag] of [
    ["party-hat", K.UNLOCKED_PARTY_HAT_KEY],
    ["bow-tie", K.UNLOCKED_BOW_TIE_KEY],
    ["thug-glasses", K.UNLOCKED_THUG_GLASSES_KEY],
  ])
    if (data[flag] === "1") owned.add(id);
  const equipped = JSON.parse(data[K.EQUIPPED_COSMETICS_KEY] ?? "{}");
  if (Object.values(equipped).some((id) => typeof id === "string" && !owned.has(id))) {
    throw new Error("The backup equips an item it does not own.");
  }
  return data;
}

export interface SaveBackup {
  product: typeof PRODUCT;
  formatVersion: number;
  saveSchemaVersion: number;
  exportedAt: string;
  data: DurableSnapshotData;
}

export function parseSaveBackup(text: string): SaveBackup {
  if (
    typeof text !== "string" ||
    text.length > SAVE_BACKUP_MAX_BYTES ||
    new TextEncoder().encode(text).byteLength > SAVE_BACKUP_MAX_BYTES
  ) {
    throw new Error("Choose a Raptor Runner backup smaller than 64 KB.");
  }
  let backup: unknown;
  try {
    backup = JSON.parse(text);
  } catch {
    throw new Error("This file is not valid JSON.");
  }
  if (!record(backup) || backup.product !== PRODUCT) {
    throw new Error("This is not a Raptor Runner save backup.");
  }
  if (
    backup.formatVersion !== FORMAT_VERSION ||
    backup.saveSchemaVersion !== PERSISTENCE_SCHEMA_VERSION
  ) {
    throw new Error("This backup uses an unsupported save version.");
  }
  if (
    Object.keys(backup).sort().join(",") !==
      "data,exportedAt,formatVersion,product,saveSchemaVersion" ||
    typeof backup.exportedAt !== "string" ||
    !Number.isFinite(Date.parse(backup.exportedAt)) ||
    new Date(backup.exportedAt).toISOString() !== backup.exportedAt
  ) {
    throw new Error("The backup details are invalid.");
  }
  return {
    product: PRODUCT,
    formatVersion: FORMAT_VERSION,
    saveSchemaVersion: PERSISTENCE_SCHEMA_VERSION,
    exportedAt: backup.exportedAt,
    data: validateBackupData(backup.data),
  };
}

export interface SaveSummary {
  bestMeters: number;
  coins: number;
  runs: number;
  achievements: number;
  cosmetics: number;
}
function summarize(data: DurableSnapshotData): SaveSummary {
  const owned = new Set<string>(JSON.parse(data[K.OWNED_COSMETICS_KEY] ?? "[]"));
  for (const [id, key] of [
    ["party-hat", K.UNLOCKED_PARTY_HAT_KEY],
    ["bow-tie", K.UNLOCKED_BOW_TIE_KEY],
    ["thug-glasses", K.UNLOCKED_THUG_GLASSES_KEY],
  ])
    if (data[key] === "1") owned.add(id);
  return {
    bestMeters: Number(data[K.HIGH_SCORE_KEY] ?? 0),
    coins: Number(data[K.COINS_BALANCE_KEY] ?? 0),
    runs: Number(data[K.CAREER_RUNS_KEY] ?? 0),
    achievements: JSON.parse(data[K.ACHIEVEMENTS_KEY] ?? "[]").length,
    cosmetics: owned.size,
  };
}
function fingerprint(data: DurableSnapshotData): string {
  return JSON.stringify(DURABLE_KEYS.map((key) => data[key] ?? null));
}

export interface SaveBackupStatus {
  supported: boolean;
  available: boolean;
  canImport: boolean;
  message: string;
  maxFileBytes: number;
  reloadRequired: boolean;
}
export interface SaveImportPreview {
  token: string;
  exportedAt: string;
  current: SaveSummary;
  incoming: SaveSummary;
}
export type SaveBackupResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Holds the validated preview internally so the UI cannot alter confirmed data. */
export class SaveBackupController {
  private pending: {
    preview: SaveImportPreview;
    data: DurableSnapshotData;
    original: string;
  } | null = null;
  private applied = false;
  constructor(
    private isHome: () => boolean,
    private reload: () => void,
  ) {}

  getStatus(): SaveBackupStatus {
    const supported = !__IS_CAPACITOR__ && !window.electronAPI;
    const writeStatus = getPersistenceWriteStatus();
    const base = {
      supported,
      available: false,
      canImport: false,
      maxFileBytes: SAVE_BACKUP_MAX_BYTES,
      reloadRequired: writeStatus.reloadRequired,
    };
    if (!supported)
      return {
        ...base,
        message:
          "Save-file transfer is available in the browser edition. Native save transfer has not been verified.",
      };
    try {
      readDurableSnapshotForBackup();
      return {
        ...base,
        available: true,
        canImport: this.isHome() && !this.applied && !writeStatus.reloadRequired,
        message: this.applied
          ? "Backup imported. Reload to use the restored save."
          : getPersistenceWriteStatus().failed
            ? "Browser storage could not save recent changes. Export a backup now; importing may fail until storage is available."
            : "Progress and settings are saved in this browser. Clearing site data can erase them. No cloud backup is provided here.",
      };
    } catch {
      return {
        ...base,
        message:
          "Browser storage is unavailable or save recovery is pending. Reload before trying again.",
      };
    }
  }

  private requireHome(): void {
    const status = this.getStatus();
    if (!status.supported || !status.available) throw new Error(status.message);
    if (!status.canImport)
      throw new Error(
        this.applied
          ? "Reload to finish the import."
          : "Return to the home screen before transferring a save.",
      );
  }

  export(): SaveBackupResult<{ filename: string; text: string }> {
    try {
      this.requireHome();
      const data = validateBackupData(readDurableSnapshotForBackup());
      const exportedAt = new Date().toISOString();
      const backup: SaveBackup = {
        product: PRODUCT,
        formatVersion: FORMAT_VERSION,
        saveSchemaVersion: PERSISTENCE_SCHEMA_VERSION,
        exportedAt,
        data,
      };
      const text = JSON.stringify(backup, null, 2);
      parseSaveBackup(text);
      return {
        ok: true,
        value: { filename: `raptor-runner-save-${exportedAt.slice(0, 10)}.json`, text },
      };
    } catch (error) {
      return this.failure(error);
    }
  }

  preview(text: string): SaveBackupResult<SaveImportPreview> {
    this.pending = null;
    try {
      this.requireHome();
      const backup = parseSaveBackup(text);
      const current = validateBackupData(readDurableSnapshotForBackup());
      const preview = {
        token: crypto.randomUUID(),
        exportedAt: backup.exportedAt,
        current: summarize(current),
        incoming: summarize(backup.data),
      };
      this.pending = { preview, data: backup.data, original: fingerprint(current) };
      return { ok: true, value: structuredClone(preview) };
    } catch (error) {
      return this.failure(error);
    }
  }

  cancel(): void {
    this.pending = null;
  }

  confirm(token: string, overwriteConfirmed: boolean): SaveBackupResult<{ reloadRequired: true }> {
    try {
      this.requireHome();
      if (!overwriteConfirmed || !this.pending || this.pending.preview.token !== token) {
        throw new Error("Preview the backup and confirm the overwrite before importing.");
      }
      const pending = this.pending;
      this.pending = null;
      if (fingerprint(readDurableSnapshotForBackup()) !== pending.original) {
        throw new Error(
          "Your save or settings changed. Preview the backup again before overwriting.",
        );
      }
      replaceDurableSnapshotForBackup(pending.data);
      this.applied = true;
      // Success refers to verified storage, never to merely selecting a file.
      try {
        this.reload();
      } catch {
        /* The UI also offers an explicit reload. */
      }
      return { ok: true, value: { reloadRequired: true } };
    } catch (error) {
      return this.failure(error);
    }
  }

  private failure(error: unknown): { ok: false; error: string } {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "The save operation failed. No upload was attempted.",
    };
  }
}
