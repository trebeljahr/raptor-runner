/*
 * Raptor Runner — localStorage persistence wrappers.
 *
 * Every read/write to localStorage goes through these helpers so that:
 *   • Private mode / denied storage fails gracefully with sane fallbacks
 *     instead of throwing at the game loop
 *   • The namespaced key strings are centralised in src/constants.ts
 *     and never typed inline
 *   • Existing players' progress is preserved forever — no function
 *     here ever renames or reformats a stored value
 *
 * This module depends only on src/constants.ts — it's a leaf of the
 * module graph and safe to import from anywhere.
 */

import {
  ACHIEVEMENTS_KEY,
  CAREER_RUNS_KEY,
  COINS_BALANCE_KEY,
  COINS_COLLECTED_KEY,
  COINS_MUTED_KEY,
  COINS_VOLUME_KEY,
  EQUIPPED_COSMETICS_KEY,
  EVENTS_MUTED_KEY,
  EVENTS_VOLUME_KEY,
  FOOTSTEPS_MUTED_KEY,
  FOOTSTEPS_VOLUME_KEY,
  HIGH_CONTRAST_KEY,
  HIGH_SCORE_KEY,
  JUMP_KEYS_KEY,
  JUMP_MUTED_KEY,
  JUMP_VOLUME_KEY,
  MASTER_VOLUME_KEY,
  MUSIC_MUTED_KEY,
  MUSIC_VOLUME_KEY,
  MUTED_KEY,
  OWNED_COSMETICS_KEY,
  RAIN_MUTED_KEY,
  RAIN_VOLUME_KEY,
  RARE_EVENTS_SEEN_KEY,
  REDUCE_MOTION_KEY,
  TEXT_SCALE_KEY,
  THUNDER_MUTED_KEY,
  THUNDER_VOLUME_KEY,
  TOTAL_DAY_CYCLES_KEY,
  TOTAL_JUMPS_KEY,
  TOTAL_NIGHTS_KEY,
  UI_MUTED_KEY,
  UI_VOLUME_KEY,
  UNLOCKED_BOW_TIE_KEY,
  UNLOCKED_PARTY_HAT_KEY,
  UNLOCKED_THUG_GLASSES_KEY,
  WEAR_BOW_TIE_KEY,
  WEAR_PARTY_HAT_KEY,
  WEAR_THUG_GLASSES_KEY,
} from "./constants";
import type { CosmeticSlot } from "./cosmetics";

export type UnlockedAchievementSet = { [id: string]: true };
export type RareEventsSeen = { [id: string]: number };

// ── Durable mirror (Capacitor Preferences) ─────────────────
//
// On iOS WKWebView, localStorage is subject to eviction. Every write
// here also fires an async mirror into @capacitor/preferences so the
// player's progress survives a storage purge. The mirror module is
// lazy-imported and its loader promise is cached so we only pay the
// dynamic-import cost once per session. On the web build the guard is
// evaluated at build time to `false`, so the entire branch (and the
// mobile/ tree it references) dead-code-eliminates out of the bundle.

type MirrorApi = {
  mirrorSet(key: string, value: string): void;
  mirrorRemove(key: string): void;
};

let _mirrorApi: MirrorApi | null = null;
let _mirrorLoading: Promise<void> | null = null;

function ensureMirror(): void {
  if (!__IS_CAPACITOR__) return;
  if (_mirrorApi || _mirrorLoading) return;
  _mirrorLoading = import("./mobile/durable")
    .then((m) => {
      _mirrorApi = { mirrorSet: m.mirrorSet, mirrorRemove: m.mirrorRemove };
    })
    .catch(() => {
      /* mirror unavailable — continue with localStorage only */
    });
}

function mirrorWrite(key: string, value: string): void {
  if (!__IS_CAPACITOR__) return;
  ensureMirror();
  if (_mirrorApi) _mirrorApi.mirrorSet(key, value);
  else if (_mirrorLoading) _mirrorLoading.then(() => _mirrorApi?.mirrorSet(key, value));
}

// ── Batched write queue ─────────────────────────────────────
//
// localStorage.setItem is synchronous and can cost 1–15ms per call
// on mobile WebViews (more under memory pressure). A single
// cosmetic-unlock frame was paying for 4–5 such writes back-to-back
// (owned + legacy-unlock + equipped + legacy-wear + achievement),
// producing a visible stutter right at the celebration moment.
//
// Writes now queue into _pendingWrites (deduplicated by key — the
// last value wins) and flush during the next idle period via
// requestIdleCallback, or setTimeout(0) on WebViews that don't
// support rIC. In-process reads go through _persistGet which
// checks the pending queue first, so save→load in the same tick
// still sees the fresh value.
//
// The queue is flushed synchronously on visibilitychange (hidden)
// and pagehide so we don't lose data when the tab dies. Mirror
// writes are NOT queued — they're already async via Capacitor's
// Preferences API so they don't cost the main thread anything,
// and firing them eagerly means the durable copy is in flight
// even if the tab dies before the idle flush runs (next
// hydration pulls from the mirror).

const _pendingWrites = new Map<string, string>();
let _flushScheduled = false;
let _backupReloadRequired = false;
let _lastWriteFailed = false;

function _scheduleFlush(): void {
  if (_flushScheduled) return;
  _flushScheduled = true;
  const runFlush = () => {
    _flushScheduled = false;
    _flushPending();
  };
  const w = window as unknown as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
  };
  if (typeof w.requestIdleCallback === "function") {
    // timeout: 1000ms caps the deferral so a tab that never becomes
    // idle (e.g. a heavy animation loop) still gets its writes
    // flushed within a second.
    w.requestIdleCallback(runFlush, { timeout: 1000 });
  } else {
    setTimeout(runFlush, 0);
  }
}

function _flushPending(): void {
  if (_pendingWrites.size === 0) return;
  // An interrupted import must recover before queued settings can overwrite it.
  try {
    if (window.localStorage.getItem(SAVE_RESTORE_JOURNAL_KEY) !== null) return;
  } catch {
    _lastWriteFailed = true;
    return;
  }
  _lastWriteFailed = false;
  for (const [key, value] of _pendingWrites) {
    try {
      window.localStorage.setItem(key, value);
      _pendingWrites.delete(key);
    } catch {
      _lastWriteFailed = true;
      /* Retain unsaved preferences for a later flush or local backup. */
    }
  }
}

/** Flush all queued writes to localStorage synchronously. Called on
 *  page-hide so nothing is lost when the tab dies; also safe to
 *  call from tests that want to assert post-save localStorage
 *  state directly. */
export function flushPersistenceWrites(): void {
  _flushPending();
}

// Install flush-on-hide listeners once per module load.
//   • visibilitychange fires on tab switch / app background (covers
//     iOS Capacitor swipe-away where beforeunload doesn't fire).
//   • pagehide is the reliable "tab is going away" event — on iOS
//     Safari it fires where beforeunload is unreliable.
if (typeof window !== "undefined" && typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") _flushPending();
  });
  window.addEventListener("pagehide", () => _flushPending());
}

/** getItem wrapper that consults the pending-write queue first, so
 *  a read in the same tick as a save returns the fresh value even
 *  though the idle flush hasn't fired yet. Falls back to
 *  localStorage on a miss; returns null if storage throws. */
function _persistGet(key: string): string | null {
  const pending = _pendingWrites.get(key);
  if (pending !== undefined) return pending;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Every persistence write in the codebase goes through this.
 *  Queues the localStorage write for an idle flush (see the
 *  _pendingWrites comment above) and kicks off the async Capacitor
 *  Preferences mirror eagerly so the durable copy is in flight
 *  immediately. */
function _persistSet(key: string, value: string): void {
  if (_backupReloadRequired) return;
  _pendingWrites.set(key, value);
  _scheduleFlush();
  mirrorWrite(key, value);
  if (_writeListener) {
    try {
      _writeListener(key, value);
    } catch {
      /* a broken listener must never take down a save */
    }
  }
}

// ── Write notifications (Steam Cloud mirror) ────────────────
//
// Same shape as the Capacitor mirror above, but pull- rather than
// push-flavoured: instead of importing a platform backend, we let one
// live at arm's length behind a callback so this module stays a leaf
// of the graph. src/steamCloud.ts registers here to learn "something
// durable changed" and debounces its own uploads.

let _writeListener: ((key: string, value: string) => void) | null = null;

/** Register (or clear, with null) the single persistence-write
 *  listener. Fires once per logical save with the key and the exact
 *  string that will land in localStorage. */
export function setPersistenceWriteListener(
  listener: ((key: string, value: string) => void) | null,
): void {
  _writeListener = listener;
}

/** The complete list of keys we mirror. Kept here so
 *  hydratePersistence() has a single source of truth and the next
 *  dev to add a key can't forget to include it in the mirror. */
export const DURABLE_KEYS: readonly string[] = [
  HIGH_SCORE_KEY,
  TOTAL_JUMPS_KEY,
  TOTAL_NIGHTS_KEY,
  CAREER_RUNS_KEY,
  ACHIEVEMENTS_KEY,
  TOTAL_DAY_CYCLES_KEY,
  RARE_EVENTS_SEEN_KEY,
  MUTED_KEY,
  MUSIC_MUTED_KEY,
  JUMP_MUTED_KEY,
  RAIN_MUTED_KEY,
  FOOTSTEPS_MUTED_KEY,
  COINS_MUTED_KEY,
  UI_MUTED_KEY,
  EVENTS_MUTED_KEY,
  THUNDER_MUTED_KEY,
  UNLOCKED_PARTY_HAT_KEY,
  UNLOCKED_THUG_GLASSES_KEY,
  WEAR_PARTY_HAT_KEY,
  WEAR_THUG_GLASSES_KEY,
  UNLOCKED_BOW_TIE_KEY,
  WEAR_BOW_TIE_KEY,
  COINS_BALANCE_KEY,
  COINS_COLLECTED_KEY,
  OWNED_COSMETICS_KEY,
  EQUIPPED_COSMETICS_KEY,
  TEXT_SCALE_KEY,
  REDUCE_MOTION_KEY,
  HIGH_CONTRAST_KEY,
  MASTER_VOLUME_KEY,
  MUSIC_VOLUME_KEY,
  JUMP_VOLUME_KEY,
  RAIN_VOLUME_KEY,
  THUNDER_VOLUME_KEY,
  FOOTSTEPS_VOLUME_KEY,
  COINS_VOLUME_KEY,
  UI_VOLUME_KEY,
  EVENTS_VOLUME_KEY,
  JUMP_KEYS_KEY,
];

/** Call once at boot, BEFORE any load*() function reads localStorage.
 *  On mobile, this copies any key present in Preferences but missing
 *  from localStorage (the eviction-recovery path) back into
 *  localStorage. On web it's a no-op that resolves immediately. */
export async function hydratePersistence(): Promise<void> {
  if (!__IS_CAPACITOR__) return;
  try {
    const { hydrateKeys } = await import("./mobile/durable");
    await hydrateKeys([...DURABLE_KEYS]);
  } catch {
    /* fall through — continue with whatever localStorage has */
  }
}

// ── Durable snapshot (Steam Cloud mirror) ───────────────────
//
// The cloud mirror ships the raw stored strings, not decoded values:
// every load*() above already tolerates arbitrary input, so a
// snapshot written by any past or future build imports through the
// exact same per-key validation/clamping path a hand-edited
// localStorage would. Bump the version only if that stops being true
// (i.e. a load*() function ever becomes unable to read an old wire
// format) — an import with a higher version than we understand is
// refused wholesale (see src/steamCloud.ts).

export const PERSISTENCE_SCHEMA_VERSION = 1;

export type DurableSnapshotData = { [key: string]: string };

export const SAVE_RESTORE_JOURNAL_KEY = "raptor-runner:saveRestoreJournal";

export function getPersistenceWriteStatus(): {
  pending: boolean;
  failed: boolean;
  reloadRequired: boolean;
} {
  return {
    pending: _pendingWrites.size > 0,
    failed: _lastWriteFailed,
    reloadRequired: _backupReloadRequired,
  };
}

/** Strict read for deliberate backup operations; includes unflushed settings.
 *  Unlike the best-effort cloud snapshot, unavailable storage is an error. */
export function readDurableSnapshotForBackup(): DurableSnapshotData {
  if (window.localStorage.getItem(SAVE_RESTORE_JOURNAL_KEY) !== null) {
    throw new Error("Save recovery is pending. Reload before making a backup.");
  }
  const data: DurableSnapshotData = Object.create(null);
  for (const key of DURABLE_KEYS) {
    const value = _pendingWrites.get(key) ?? window.localStorage.getItem(key);
    if (value !== null) data[key] = value;
  }
  return data;
}

function writeCompleteSnapshot(data: DurableSnapshotData): void {
  for (const key of DURABLE_KEYS) {
    if (Object.hasOwn(data, key)) window.localStorage.setItem(key, data[key]);
    else window.localStorage.removeItem(key);
  }
  for (const key of DURABLE_KEYS) {
    if (window.localStorage.getItem(key) !== (data[key] ?? null)) {
      throw new Error("Browser storage did not retain the complete save.");
    }
  }
}

/** Recover before audio/settings/state load on boot. The journal contains only
 *  the previous game save, never another site's keys or cloud metadata. */
export function recoverPendingSaveRestore(): void {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(SAVE_RESTORE_JOURNAL_KEY);
  } catch {
    return; // Normal gameplay remains available when storage is denied.
  }
  if (raw === null) return;
  const journal = JSON.parse(raw) as { version?: unknown; before?: unknown };
  if (
    journal?.version !== 1 ||
    !journal.before ||
    typeof journal.before !== "object" ||
    Array.isArray(journal.before) ||
    Object.entries(journal.before).some(
      ([key, value]) => !DURABLE_KEYS.includes(key) || typeof value !== "string",
    )
  ) {
    throw new Error("The interrupted save import could not be recovered.");
  }
  writeCompleteSnapshot(journal.before as DurableSnapshotData);
  window.localStorage.removeItem(SAVE_RESTORE_JOURNAL_KEY);
  if (window.localStorage.getItem(SAVE_RESTORE_JOURNAL_KEY) !== null) {
    throw new Error("The interrupted save import could not be recovered.");
  }
}

/** Replace only known game keys, with rollback on errors and recovery after
 *  interruption. Never invoke platform mirrors or overwrite cloud ownership. */
export function replaceDurableSnapshotForBackup(data: DurableSnapshotData): void {
  if (__IS_CAPACITOR__ || window.electronAPI || _writeListener) {
    throw new Error("Save-file import is available only in the browser edition.");
  }
  if (
    Object.entries(data).some(
      ([key, value]) => !DURABLE_KEYS.includes(key) || typeof value !== "string",
    )
  ) {
    throw new Error("The save contains unsupported data.");
  }
  const before = readDurableSnapshotForBackup();
  const journal = JSON.stringify({ version: 1, before });
  // A failed journal write leaves every existing key untouched.
  window.localStorage.setItem(SAVE_RESTORE_JOURNAL_KEY, journal);
  if (window.localStorage.getItem(SAVE_RESTORE_JOURNAL_KEY) !== journal) {
    throw new Error("Browser storage could not protect the existing save.");
  }
  try {
    writeCompleteSnapshot(data);
    window.localStorage.removeItem(SAVE_RESTORE_JOURNAL_KEY);
    if (window.localStorage.getItem(SAVE_RESTORE_JOURNAL_KEY) !== null) {
      throw new Error("Browser storage could not finish the import.");
    }
    // Idle/pagehide callbacks must never replay pre-import preferences.
    for (const key of DURABLE_KEYS) _pendingWrites.delete(key);
    // The current engine still holds its pre-import values until reload.
    _backupReloadRequired = true;
  } catch {
    try {
      writeCompleteSnapshot(before);
      window.localStorage.removeItem(SAVE_RESTORE_JOURNAL_KEY);
      if (window.localStorage.getItem(SAVE_RESTORE_JOURNAL_KEY) !== null) {
        throw new Error("Recovery is still pending.");
      }
    } catch {
      _backupReloadRequired = true;
      throw new Error(
        "Import failed. Recovery is pending; free browser storage and reload before playing.",
      );
    }
    throw new Error("Import failed. Your previous save and settings were restored.");
  }
}

/** Read every durable key's raw stored string. Flushes the pending
 *  queue first so the snapshot always reflects the latest saves. */
export function exportDurableSnapshot(): DurableSnapshotData {
  _flushPending();
  const out: DurableSnapshotData = {};
  for (const key of DURABLE_KEYS) {
    try {
      const value = window.localStorage.getItem(key);
      if (value != null) out[key] = value;
    } catch {
      /* storage unavailable — key stays absent */
    }
  }
  return out;
}

/** True when any durable key holds data on this machine. The cloud
 *  boot reconcile uses this to tell a genuinely fresh machine (safe
 *  to adopt the cloud file wholesale) apart from a machine that has
 *  pre-mirror progress but no sync stamp yet — importing over the
 *  latter would silently destroy real local progress. */
export function hasDurableData(): boolean {
  _flushPending();
  for (const key of DURABLE_KEYS) {
    try {
      if (window.localStorage.getItem(key) != null) return true;
    } catch {
      /* storage unavailable — treat the key as absent */
    }
  }
  return false;
}

/** Write a snapshot's raw strings back into localStorage. Only keys
 *  in DURABLE_KEYS are honoured — a cloud file can never plant
 *  arbitrary keys — and non-string values are skipped. Call BEFORE
 *  the boot-time load*() pass so the imported values flow through
 *  the normal per-key validation (and migrateLegacyCosmetics). */
export function importDurableSnapshot(data: DurableSnapshotData): void {
  for (const key of DURABLE_KEYS) {
    const value = data[key];
    if (typeof value !== "string") continue;
    try {
      window.localStorage.setItem(key, value);
      // Drop any queued write for the key so _persistGet doesn't
      // serve a stale pre-import value over the fresh one.
      _pendingWrites.delete(key);
    } catch {
      /* storage unavailable — skip, same policy as _flushPending */
    }
  }
}

// ── High score ──────────────────────────────────────────────

export function loadHighScore(): number {
  try {
    const raw = _persistGet(HIGH_SCORE_KEY);
    if (raw == null) return 0;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch (_e) {
    return 0;
  }
}

/** Persist the high score. Silently no-ops if storage is unavailable. */
export function saveHighScore(value: number): void {
  _persistSet(HIGH_SCORE_KEY, String(value));
}

// ── Career runs ─────────────────────────────────────────────

export function loadCareerRuns(): number {
  try {
    const raw = _persistGet(CAREER_RUNS_KEY);
    if (raw == null) return 0;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch (_e) {
    return 0;
  }
}

export function saveCareerRuns(value: number): void {
  _persistSet(CAREER_RUNS_KEY, String(value));
}

// ── Unlocked achievements ───────────────────────────────────

export function loadUnlockedAchievements(): UnlockedAchievementSet {
  const set: UnlockedAchievementSet = Object.create(null);
  try {
    const raw = _persistGet(ACHIEVEMENTS_KEY);
    if (!raw) return set;
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      for (const id of arr) if (typeof id === "string") set[id] = true;
    }
  } catch (_e) {
    /* ignore corrupt values */
  }
  return set;
}

export function saveUnlockedAchievements(set: UnlockedAchievementSet): void {
  _persistSet(ACHIEVEMENTS_KEY, JSON.stringify(Object.keys(set)));
}

// ── Total jumps (career) ────────────────────────────────────

export function loadTotalJumps(): number {
  try {
    const raw = _persistGet(TOTAL_JUMPS_KEY);
    if (raw == null) return 0;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch (_e) {
    return 0;
  }
}

export function saveTotalJumps(value: number): void {
  _persistSet(TOTAL_JUMPS_KEY, String(value));
}

// ── Total nights survived (career) ──────────────────────────

export function loadTotalNightsSurvived(): number {
  try {
    const raw = _persistGet(TOTAL_NIGHTS_KEY);
    if (raw == null) return 0;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch (_e) {
    return 0;
  }
}

export function saveTotalNightsSurvived(value: number): void {
  _persistSet(TOTAL_NIGHTS_KEY, String(value));
}

// ── Total day/night cycles witnessed ────────────────────────

export function loadTotalDayCycles(): number {
  try {
    const raw = _persistGet(TOTAL_DAY_CYCLES_KEY);
    if (raw == null) return 0;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch (_e) {
    return 0;
  }
}

export function saveTotalDayCycles(n: number): void {
  _persistSet(TOTAL_DAY_CYCLES_KEY, String(n));
}

// ── Rare events seen ────────────────────────────────────────

export function loadRareEventsSeen(): RareEventsSeen {
  try {
    const raw = _persistGet(RARE_EVENTS_SEEN_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_e) {
    return {};
  }
}

export function saveRareEventsSeen(seen: RareEventsSeen): void {
  _persistSet(RARE_EVENTS_SEEN_KEY, JSON.stringify(seen));
}

// ── Generic boolean flag (per-channel mute, cosmetic unlocks) ─

/** Returns `fallback` if the key is missing or unparseable
 *  (e.g. private mode, denied storage). */
export function loadBoolFlag(key: string, fallback: boolean): boolean {
  try {
    const raw = _persistGet(key);
    if (raw == null) return fallback;
    return raw === "1";
  } catch (_e) {
    return fallback;
  }
}

export function saveBoolFlag(key: string, value: boolean): void {
  _persistSet(key, value ? "1" : "0");
}

// ── Generic number setting (volumes, text scale) ────────────

/** Returns `fallback` if the key is missing or unparseable; an
 *  out-of-range stored value is clamped rather than discarded so a
 *  schema tweak (e.g. narrowing a slider's range) degrades to the
 *  nearest legal value instead of silently resetting the player's
 *  choice. */
export function loadNumberSetting(key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = _persistGet(key);
    if (raw == null) return fallback;
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  } catch (_e) {
    return fallback;
  }
}

export function saveNumberSetting(key: string, value: number): void {
  _persistSet(key, String(value));
}

// ── Generic string-enum setting ─────────────────────────────

/** Returns `fallback` unless the stored value is one of `allowed` —
 *  a value written by a newer build (or corrupted) never leaks an
 *  unknown variant into the callers' switch statements. */
export function loadStringSetting<T extends string>(
  key: string,
  fallback: T,
  allowed: readonly T[],
): T {
  try {
    const raw = _persistGet(key);
    if (raw == null) return fallback;
    return (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
  } catch (_e) {
    return fallback;
  }
}

export function saveStringSetting(key: string, value: string): void {
  _persistSet(key, value);
}

// ── Generic string-list setting (key bindings) ──────────────

/** Stored comma-joined rather than as JSON: the values are
 *  KeyboardEvent.code identifiers (never contain commas), and a
 *  flat format survives hand-editing in devtools better than
 *  JSON.parse's all-or-nothing failure mode. Falls back when the
 *  key is missing or decodes to an empty list — an empty binding
 *  set is never a valid stored state. */
export function loadStringListSetting(key: string, fallback: readonly string[]): string[] {
  try {
    const raw = _persistGet(key);
    if (raw == null) return [...fallback];
    const items = raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return items.length > 0 ? items : [...fallback];
  } catch (_e) {
    return [...fallback];
  }
}

export function saveStringListSetting(key: string, values: readonly string[]): void {
  _persistSet(key, values.join(","));
}

// ── Coin balance ────────────────────────────────────────────

export function loadCoinsBalance(): number {
  try {
    const raw = _persistGet(COINS_BALANCE_KEY);
    if (raw == null) return 0;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function saveCoinsBalance(value: number): void {
  _persistSet(COINS_BALANCE_KEY, String(value));
}

// ── Coins collected (lifetime, monotonic) ─────────────────
// Parallel to coinsBalance but never decremented. Drives the
// "coin hoarder" achievement and anywhere else a monotonic
// lifetime counter matters later.

export function loadCoinsCollected(): number {
  try {
    const raw = _persistGet(COINS_COLLECTED_KEY);
    if (raw == null) return 0;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function saveCoinsCollected(value: number): void {
  _persistSet(COINS_COLLECTED_KEY, String(value));
}

// ── Owned cosmetics (set of ids) ────────────────────────────

export function loadOwnedCosmetics(): { [id: string]: true } {
  const set: { [id: string]: true } = Object.create(null);
  try {
    const raw = _persistGet(OWNED_COSMETICS_KEY);
    if (!raw) return set;
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      for (const id of arr) if (typeof id === "string") set[id] = true;
    }
  } catch {
    /* ignore corrupt value */
  }
  return set;
}

export function saveOwnedCosmetics(set: { [id: string]: true }): void {
  _persistSet(OWNED_COSMETICS_KEY, JSON.stringify(Object.keys(set)));
}

// ── Equipped cosmetics (per-slot id or null) ────────────────

export type EquippedMap = Record<CosmeticSlot, string | null>;

export function loadEquippedCosmetics(): EquippedMap {
  const fallback: EquippedMap = {
    head: null,
    eyes: null,
    neck: null,
  };
  try {
    const raw = _persistGet(EQUIPPED_COSMETICS_KEY);
    if (!raw) return fallback;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return fallback;
    return {
      head: typeof obj.head === "string" ? obj.head : null,
      eyes: typeof obj.eyes === "string" ? obj.eyes : null,
      neck: typeof obj.neck === "string" ? obj.neck : null,
    };
  } catch {
    return fallback;
  }
}

export function saveEquippedCosmetics(map: EquippedMap): void {
  _persistSet(EQUIPPED_COSMETICS_KEY, JSON.stringify(map));
}
