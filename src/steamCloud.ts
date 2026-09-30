/*
 * Raptor Runner — Steam Cloud save mirror (renderer side).
 *
 * Steam Auto-Cloud syncs a single save.json in Electron's userData
 * directory. This module keeps that file in step with localStorage
 * (the operational source of truth, see src/persistence.ts):
 *
 *   - Boot: read the cloud file over IPC and, if it is strictly
 *     newer than what this machine last saw, import it BEFORE the
 *     game's load*() pass — so another machine's progress lands
 *     through the normal per-key validation and legacy migrations.
 *   - After boot: every persistence write schedules a debounced
 *     (~2 s trailing) snapshot push to the main process, which
 *     writes save.json atomically. pagehide flushes synchronously
 *     so the last run's progress isn't lost on quit.
 *
 * Mirrors the src/steamBridge.ts design: every window.electronAPI
 * access is guarded, so the web build no-ops, and the main process
 * refuses the IPC when steamworks.js never initialized — the same
 * binary on itch.io does nothing here.
 *
 * Deliberately NO Steamworks cloud API calls — Auto-Cloud watches
 * the file; we only maintain the file.
 */

import { CLOUD_SAVED_AT_KEY } from "./constants";
import {
  type DurableSnapshotData,
  exportDurableSnapshot,
  hasDurableData,
  importDurableSnapshot,
  PERSISTENCE_SCHEMA_VERSION,
  setPersistenceWriteListener,
} from "./persistence";

export type CloudSnapshot = {
  version: number;
  savedAt: number;
  data: DurableSnapshotData;
};

// ── Pure decision logic (unit-tested, no Electron) ──────────

/** Parse + validate raw file content into a snapshot, or null for
 *  anything unusable: bad JSON, wrong shape, a version from a build
 *  newer than this one, or a non-finite timestamp. A corrupt cloud
 *  file must degrade to "local wins", never to a crash. */
export function parseCloudSnapshot(raw: string | null | undefined): CloudSnapshot | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as { version?: unknown; savedAt?: unknown; data?: unknown };
  if (typeof obj.version !== "number" || !Number.isFinite(obj.version)) return null;
  // A higher version means a future build changed the wire format in
  // a way our loaders may not understand — refuse rather than guess.
  if (obj.version > PERSISTENCE_SCHEMA_VERSION) return null;
  if (typeof obj.savedAt !== "number" || !Number.isFinite(obj.savedAt)) return null;
  if (obj.data === null || typeof obj.data !== "object" || Array.isArray(obj.data)) return null;
  const data: DurableSnapshotData = {};
  for (const [key, value] of Object.entries(obj.data as Record<string, unknown>)) {
    if (typeof value === "string") data[key] = value;
  }
  return { version: obj.version, savedAt: obj.savedAt, data };
}

/** Newer-wins: import only when the cloud file is STRICTLY newer
 *  than the last snapshot stamp this machine pushed or imported.
 *  Ties (same machine re-reading its own upload) keep local.
 *
 *  A missing local stamp is ambiguous: it means either a genuinely
 *  fresh machine (safe to adopt the cloud file) or a machine with
 *  pre-mirror progress that simply predates this feature. Importing
 *  over the latter would wholesale destroy real local progress, so
 *  when local durable data exists without a stamp we keep local and
 *  let this machine's own next push establish it as newest —
 *  ordinary newer-wins reconciliation takes over from there. */
export function shouldImportCloudSnapshot(
  cloud: CloudSnapshot | null,
  localSavedAt: number | null,
  hasLocalData: boolean,
): boolean {
  if (cloud === null) return false;
  if (localSavedAt === null) {
    if (hasLocalData) return false;
    return cloud.savedAt > 0;
  }
  return cloud.savedAt > localSavedAt;
}

/** Assemble the envelope pushed to the main process. */
export function buildCloudSnapshot(data: DurableSnapshotData, savedAt: number): CloudSnapshot {
  return { version: PERSISTENCE_SCHEMA_VERSION, savedAt, data };
}

// ── Renderer glue ───────────────────────────────────────────

// Trailing debounce: gameplay saves coins/score in bursts, and each
// push costs an IPC round-trip plus a synchronous file write in the
// main process. 2 s trailing collapses a burst into one write while
// staying far inside Auto-Cloud's on-quit sync window.
const PUSH_DEBOUNCE_MS = 2000;

let _pushTimer: ReturnType<typeof setTimeout> | null = null;
let _active = false;

function readLocalSavedAt(): number | null {
  try {
    const raw = window.localStorage.getItem(CLOUD_SAVED_AT_KEY);
    if (raw == null) return null;
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeLocalSavedAt(savedAt: number): void {
  try {
    window.localStorage.setItem(CLOUD_SAVED_AT_KEY, String(savedAt));
  } catch {
    /* storage unavailable — next boot falls back to cloud-wins */
  }
}

/** Snapshot localStorage and hand it to the main process. The main
 *  side also keeps the last received snapshot to re-flush on quit,
 *  so a lost invoke during shutdown still lands on disk. */
function pushSnapshot(): void {
  const api = typeof window !== "undefined" ? window.electronAPI : undefined;
  if (!api) return;
  const savedAt = Date.now();
  const snapshot = buildCloudSnapshot(exportDurableSnapshot(), savedAt);
  writeLocalSavedAt(savedAt);
  api.writeCloudSave(JSON.stringify(snapshot)).catch(() => {
    /* swallow — the main-side quit flush or the next push recovers */
  });
}

function schedulePush(): void {
  if (_pushTimer !== null) clearTimeout(_pushTimer);
  _pushTimer = setTimeout(() => {
    _pushTimer = null;
    pushSnapshot();
  }, PUSH_DEBOUNCE_MS);
}

function flushPendingPush(): void {
  if (_pushTimer === null) return;
  clearTimeout(_pushTimer);
  _pushTimer = null;
  pushSnapshot();
}

/**
 * Boot-time reconcile + subscription. MUST be awaited before the
 * load*() block in init() reads localStorage into the state
 * singleton — an import after that point would be invisible until
 * the next launch.
 *
 * Resolves immediately (without touching persistence) when:
 *   - not under Electron (web/Capacitor build), or
 *   - the main process reports Steam never initialized (itch.io /
 *     DRM-free copy of the same binary).
 */
export async function initSteamCloud(): Promise<void> {
  const api = typeof window !== "undefined" ? window.electronAPI : undefined;
  if (!api || typeof api.readCloudSave !== "function") return;

  let steam = false;
  try {
    steam = await api.isSteam();
  } catch {
    return;
  }
  if (!steam) return;

  try {
    const raw = await api.readCloudSave();
    const cloud = parseCloudSnapshot(raw);
    if (cloud !== null && shouldImportCloudSnapshot(cloud, readLocalSavedAt(), hasDurableData())) {
      importDurableSnapshot(cloud.data);
      // Stamp the imported time so the next boot's comparison treats
      // this file as already seen (tie → local wins).
      writeLocalSavedAt(cloud.savedAt);
      console.log("[steam-cloud] imported newer cloud save");
    }
  } catch (err) {
    console.warn("[steam-cloud] boot reconcile failed, keeping local state:", err);
  }

  _active = true;
  setPersistenceWriteListener(() => {
    if (_active) schedulePush();
  });
  // pagehide is the reliable teardown event (matches persistence.ts's
  // own flush-on-hide choice); beforeunload additionally covers the
  // desktop window-close path. Both funnel through the same
  // idempotent flush.
  window.addEventListener("pagehide", flushPendingPush);
  window.addEventListener("beforeunload", flushPendingPush);
}
