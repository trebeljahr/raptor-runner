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
  COINS_VOLUME_KEY,
  EQUIPPED_COSMETICS_KEY,
  EVENTS_VOLUME_KEY,
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
  THUNDER_VOLUME_KEY,
  TOTAL_DAY_CYCLES_KEY,
  TOTAL_JUMPS_KEY,
  TOTAL_NIGHTS_KEY,
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
  for (const [key, value] of _pendingWrites) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* storage unavailable — drop silently, same as before */
    }
  }
  _pendingWrites.clear();
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
  _pendingWrites.set(key, value);
  _scheduleFlush();
  mirrorWrite(key, value);
}

/** The complete list of keys we mirror. Kept here so
 *  hydratePersistence() has a single source of truth and the next
 *  dev to add a key can't forget to include it in the mirror. */
const DURABLE_KEYS: string[] = [
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
    await hydrateKeys(DURABLE_KEYS);
  } catch {
    /* fall through — continue with whatever localStorage has */
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
