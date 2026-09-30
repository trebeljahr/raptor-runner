/*
 * Raptor Runner — Electron main process.
 *
 * In dev mode: loads the Vite dev server at localhost:5173.
 * In production: loads the built dist/index.html via file://.
 *
 * The service worker is silently ignored in Electron (file:// doesn't
 * support SW registration). The VitePWA plugin's "auto" inject
 * handles this gracefully — the register call fails silently and the
 * game runs without offline support, which is fine for a desktop app.
 *
 * Steam integration:
 *   steamworks.js is initialized once before window creation ONLY when
 *   a real Steam app ID is resolvable. Checks, in order:
 *     1. process.env.STEAM_APP_ID — explicit override (dev, Steam CI)
 *     2. steam_appid.txt — file next to the binary (Steam build)
 *   If neither yields a positive integer, steamworks is never touched.
 *   That keeps itch.io / DRM-free builds from attaching to Spacewar
 *   (app id 480) on machines where Steam happens to be running.
 *
 *   If Steam isn't running / the user isn't logged in / the SDK fails
 *   to load, steamClient stays null and every bridge call short-
 *   circuits — the game still runs and unlocks land in localStorage.
 */

import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, ipcMain, Menu, shell, type IpcMainInvokeEvent } from "electron";
import steamworks from "steamworks.js";
import { STEAM_ACTION_SETS, STEAM_DIGITAL_ACTIONS } from "./steamInputActions";

const isDev = !app.isPackaged;
const DEV_URL = "http://localhost:5173";
const ENTRY_FILE = path.resolve(__dirname, "../dist/index.html");

const isAchievementName = (value: unknown): value is string =>
  typeof value === "string" && /^ACH_[A-Z0-9_]{1,96}$/.test(value);

const MAX_CLOUD_SAVE_BYTES = 256 * 1024;

function isCloudSave(value: unknown): value is string {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > MAX_CLOUD_SAVE_BYTES)
    return false;
  try {
    const save = JSON.parse(value);
    return (
      save !== null &&
      typeof save === "object" &&
      !Array.isArray(save) &&
      save.version === 1 &&
      Number.isSafeInteger(save.savedAt) &&
      save.savedAt >= 0 &&
      save.data !== null &&
      typeof save.data === "object" &&
      !Array.isArray(save.data) &&
      Object.values(save.data).every((entry) => typeof entry === "string")
    );
  } catch {
    return false;
  }
}

const IPC_ARGUMENTS: Record<string, (args: unknown[]) => boolean> = {
  "cloud-save:read": (args) => args.length === 0,
  "cloud-save:write": (args) => args.length === 1 && isCloudSave(args[0]),
  "app:quit": (args) => args.length === 0,
  "window:isFullscreen": (args) => args.length === 0,
  "window:setFullscreen": (args) => args.length === 1 && typeof args[0] === "boolean",
  "steam:isAvailable": (args) => args.length === 0,
  "steam-input:open-binding-panel": (args) => args.length === 0,
  "steam-input:set-action-set": (args) =>
    args.length === 1 && typeof args[0] === "string" && STEAM_SET_NAMES.includes(args[0]),
  "steam:openOverlay": (args) =>
    args.length === 1 &&
    typeof args[0] === "string" &&
    Object.prototype.hasOwnProperty.call(OVERLAY_DIALOG_MAP, args[0]),
  "steam:openOverlayUrl": (args) => args.length === 1 && isWebUrl(args[0]),
  "steam:activateAchievement": (args) => args.length === 1 && isAchievementName(args[0]),
  "steam:getAchievementStates": (args) =>
    args.length === 1 &&
    Array.isArray(args[0]) &&
    args[0].length <= 256 &&
    args[0].every(isAchievementName),
};

// Trust is pinned to the launch target, never to the page currently displayed.
let mainWindow: BrowserWindow | null = null;

function isWebUrl(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length > 4096 ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password
    );
  } catch {
    return false;
  }
}

function isApplicationUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (isDev) {
      return isWebUrl(value) && isWebUrl(DEV_URL) && url.origin === new URL(DEV_URL).origin;
    }
    if (url.protocol !== "file:" || url.host || url.username || url.password) return false;
    const target = fileURLToPath(url);
    return target === ENTRY_FILE;
  } catch {
    return false;
  }
}

// All native handlers use this gate before touching preferences or native APIs.
function handle<Args extends unknown[], Result>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: Args) => Result,
): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    const win = mainWindow;
    const frame = event.senderFrame;
    if (
      !win ||
      win.isDestroyed() ||
      event.sender !== win.webContents ||
      !frame ||
      frame !== win.webContents.mainFrame ||
      !isApplicationUrl(frame.url)
    ) {
      throw new Error("Untrusted native bridge sender");
    }
    const validate = IPC_ARGUMENTS[channel];
    if (!validate || !validate(args)) throw new TypeError("Invalid native bridge arguments");
    return handler(event, ...(args as Args));
  });
}

function secureWindow(win: BrowserWindow): void {
  mainWindow = win;
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!isApplicationUrl(url) && isWebUrl(url)) {
      void shell.openExternal(url).catch(() => {});
    }
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (isApplicationUrl(url)) return;
    event.preventDefault();
    if (isWebUrl(url)) void shell.openExternal(url).catch(() => {});
  });
  win.webContents.on("will-redirect", (event, url) => {
    if (!isApplicationUrl(url)) event.preventDefault();
  });
  win.webContents.on("will-attach-webview", (event) => event.preventDefault());
}

// Override the product name BEFORE any window is created so dev-mode
// dock tooltips ("Electron"), the About menu, and userData paths all
// read "Raptor Runner". Packaged builds pick this up from the Info.plist
// generated by electron-builder's `productName`, so this line is a
// no-op in production.
app.setName("Raptor Runner");

/**
 * Resolve the Steam app ID from env var first, then a sibling
 * steam_appid.txt file. Returns null if neither yields a valid
 * positive integer — in which case we skip Steam init entirely,
 * so itch.io / DRM-free distributions don't attach to Spacewar
 * (app id 480) on machines where Steam is running.
 */
function resolveSteamAppId(): number | null {
  const fromEnv = process.env.STEAM_APP_ID;
  if (fromEnv) {
    const n = Number(fromEnv);
    if (Number.isSafeInteger(n) && n > 0 && n <= 0xffffffff) return n;
  }
  const candidates = [
    path.join(__dirname, "..", "steam_appid.txt"),
    path.join(process.resourcesPath ?? "", "..", "steam_appid.txt"),
  ];
  for (const p of candidates) {
    try {
      const raw = fs.readFileSync(p, "utf8").trim();
      const n = Number(raw);
      if (Number.isSafeInteger(n) && n > 0 && n <= 0xffffffff) return n;
    } catch {
      /* try next */
    }
  }
  return null;
}

type SteamClient = ReturnType<typeof steamworks.init>;
let steamClient: SteamClient | null = null;

const resolvedAppId = resolveSteamAppId();
if (resolvedAppId !== null) {
  try {
    steamClient = steamworks.init(resolvedAppId);
    steamworks.electronEnableSteamOverlay();
    console.log(`[steam] init ok, appid ${resolvedAppId}`);
  } catch (err) {
    console.warn("[steam] init failed, running without Steam:", err);
    steamClient = null;
  }
} else {
  console.log("[steam] no app id configured, skipping Steam init");
}

// ── Steam Input ────────────────────────────────────────────────────
// Semantic controller actions (see docs/STEAM_INPUT.md). The main
// process owns every native handle — handles are bigints and never
// cross IPC. The renderer receives plain-JSON level-state snapshots
// pushed on "steam-input:frame" every ~16 ms and falls back to the
// W3C Gamepad API whenever the snapshots stop, carry no controllers,
// or carry available:false — so any failure below degrades to the
// exact pre-Steam-Input behaviour. Main-process timers are not
// background-throttled, so frames keep flowing when the window loses
// focus.

type SteamInputSnapshot = {
  available: boolean;
  controllerCount: number;
  inputType: string;
  /** The set applyActionSet last pushed to the controllers. The
   *  renderer holds its edge-state prime after requesting a switch
   *  until this reflects the request — actions absent from a set read
   *  false, so without the stamp a button held across the switch
   *  would resurface as a fresh edge. */
  activeSet: string;
  digital: Record<string, boolean>;
};

const STEAM_SET_NAMES: string[] = Object.values(STEAM_ACTION_SETS);
const STEAM_ACTION_NAMES: string[] = Object.values(STEAM_DIGITAL_ACTIONS);

// Assigned only when input.init() succeeds. The IPC handler further
// down is registered unconditionally so a renderer invoke resolves to
// false instead of rejecting on DRM-free / Steam-less sessions.
let steamInputApplyActionSet: ((name: string) => boolean) | null = null;
let steamInputTimer: ReturnType<typeof setInterval> | null = null;

if (steamClient) {
  const input = steamClient.input;
  let inputStarted = false;
  try {
    input.init();
    inputStarted = true;
    console.log("[steam-input] init ok");
  } catch (err) {
    console.warn("[steam-input] init failed, browser gamepad API only:", err);
  }

  if (inputStarted) {
    type SteamController = ReturnType<typeof input.getControllers>[number];

    const setHandles = new Map<string, bigint>();
    const actionHandles = new Map<string, bigint>();
    let handlesResolved = false;
    let controllers: SteamController[] = [];
    let lastRequestedSet: string = STEAM_ACTION_SETS.inGame;
    let tick = 0;

    // getActionSet / getDigitalAction return 0n until Steam has
    // loaded the in-game actions manifest — which can happen seconds
    // after launch, or never (VDF not uploaded / not installed
    // locally). Retried ~1/s; while any handle is 0n the snapshots
    // carry available:false so the renderer stays on the W3C path,
    // and if Steam learns the manifest later the Steam path engages
    // seamlessly.
    const resolveHandles = (): void => {
      try {
        for (const name of STEAM_SET_NAMES) {
          if ((setHandles.get(name) ?? 0n) === 0n) {
            setHandles.set(name, input.getActionSet(name));
          }
        }
        for (const name of STEAM_ACTION_NAMES) {
          if ((actionHandles.get(name) ?? 0n) === 0n) {
            actionHandles.set(name, input.getDigitalAction(name));
          }
        }
        handlesResolved =
          STEAM_SET_NAMES.every((n) => (setHandles.get(n) ?? 0n) !== 0n) &&
          STEAM_ACTION_NAMES.every((n) => (actionHandles.get(n) ?? 0n) !== 0n);
        if (handlesResolved) console.log("[steam-input] action handles resolved");
      } catch (err) {
        console.warn("[steam-input] handle resolution failed:", err);
      }
    };

    const applyActionSet = (name: string): boolean => {
      // Whitelist — never pass a raw renderer string to native code.
      if (!STEAM_SET_NAMES.includes(name)) return false;
      lastRequestedSet = name;
      const handle = setHandles.get(name) ?? 0n;
      if (handle === 0n) return false;
      for (const c of controllers) {
        try {
          c.activateActionSet(handle);
        } catch {
          /* controller may have just detached — next enumeration drops it */
        }
      }
      return true;
    };
    steamInputApplyActionSet = applyActionSet;

    const pollTick = (): void => {
      tick++;
      if (!handlesResolved && tick % 60 === 1) resolveHandles();
      // Controller enumeration is heavier than reading action state;
      // every ~500 ms picks up hot-plugs without hammering the API.
      if (tick % 32 === 1) {
        const before = controllers.length;
        try {
          controllers = input.getControllers();
        } catch {
          controllers = [];
        }
        // A late-arriving controller must inherit the set the
        // renderer last asked for, not the manifest default.
        if (controllers.length > before) applyActionSet(lastRequestedSet);
      }

      // First controller wins, mirroring the renderer's first-pad-
      // wins scan over navigator.getGamepads().
      const digital: Record<string, boolean> = {};
      let inputType = "Unknown";
      const first = controllers.length > 0 ? controllers[0] : undefined;
      if (handlesResolved && first) {
        try {
          inputType = String(first.getType());
        } catch {
          /* keep Unknown */
        }
        for (const name of STEAM_ACTION_NAMES) {
          const handle = actionHandles.get(name) ?? 0n;
          let pressed = false;
          if (handle !== 0n) {
            try {
              pressed = first.isDigitalActionPressed(handle);
            } catch {
              pressed = false;
            }
          }
          digital[name] = pressed;
        }
      } else {
        for (const name of STEAM_ACTION_NAMES) digital[name] = false;
      }

      const snapshot: SteamInputSnapshot = {
        available: handlesResolved && controllers.length > 0,
        controllerCount: controllers.length,
        inputType,
        activeSet: lastRequestedSet,
        digital,
      };
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.webContents.send("steam-input:frame", snapshot);
      }
    };

    steamInputTimer = setInterval(pollTick, 16);
  }
}

// IPC: switch the active Steam Input action set. Registered even when
// Steam Input never started so the renderer's invoke resolves (to
// false) instead of rejecting.
handle("steam-input:set-action-set", (_evt, name: string) => {
  if (typeof name !== "string") return false;
  return steamInputApplyActionSet ? steamInputApplyActionSet(name) : false;
});

// IPC: open Steam's controller configurator for this app so the
// player can rebind actions. steamworks.js wraps no ShowBindingPanel,
// so the steam:// URL scheme stands in: the OS hands it to the Steam
// client, which opens the configurator (Big Picture window on
// desktop, the native overlay on Steam Deck). Gated on steamClient —
// on DRM-free / Steam-less sessions the renderer gets false and the
// UI never offers the button anyway.
handle("steam-input:open-binding-panel", () => {
  if (!steamClient || resolvedAppId === null) return false;
  shell.openExternal(`steam://controllerconfig/${resolvedAppId}`).catch(() => {
    /* Steam client gone mid-session — nothing sensible to do */
  });
  return true;
});

app.on("will-quit", () => {
  // Timer non-null implies input.init() succeeded, so shutdown() has
  // something to tear down.
  if (steamInputTimer !== null) {
    clearInterval(steamInputTimer);
    steamInputTimer = null;
    try {
      steamClient?.input.shutdown();
    } catch {
      /* Steam already gone — nothing to release */
    }
  }
});

// IPC: renderer asks whether Steam is usable this session.
handle("steam:isAvailable", () => steamClient !== null);

// IPC: quit the app. Called from the desktop-only Quit button in
// the settings menu.
//
// Force-close every window before calling app.quit(). On macOS
// app.quit() alone sometimes gets deferred by the platform (any
// open transition / animation / "should close?" check can hold it),
// and the player sees a button that does nothing. win.destroy()
// skips the usual close-event path so there's no prevention hook
// the renderer could have silently installed. After the windows
// are gone, window-all-closed handles Linux/Windows and app.quit()
// finishes macOS.
handle("app:quit", () => {
  for (const w of BrowserWindow.getAllWindows()) {
    try {
      w.destroy();
    } catch {
      /* already destroyed — ignore */
    }
  }
  app.quit();
});

// Steam overlay dialogs (Friends, Achievements, etc.). Activates the
// in-game Steam overlay to a specific panel. Returns false if Steam
// isn't available or the client refuses — lets the renderer gracefully
// fall back.
//
// Note: the Steam overlay has known rendering limitations on macOS.
// Valve's macOS overlay support for non-native apps (including
// Electron) is unreliable — the overlay may not appear, or may appear
// without proper interaction. Windows and Linux are unaffected. The
// IPC still fires; if the overlay doesn't pop, it's a Valve/OS issue,
// not ours.
type OverlayDialog =
  | "Friends"
  | "Community"
  | "Players"
  | "Settings"
  | "OfficialGameGroup"
  | "Stats"
  | "Achievements";
const OVERLAY_DIALOG_MAP: Record<OverlayDialog, number> = {
  Friends: 0,
  Community: 1,
  Players: 2,
  Settings: 3,
  OfficialGameGroup: 4,
  Stats: 5,
  Achievements: 6,
};
handle("steam:openOverlay", (_evt, dialog: OverlayDialog) => {
  if (!steamClient) return false;
  const code = OVERLAY_DIALOG_MAP[dialog];
  if (code == null) return false;
  try {
    steamClient.overlay.activateDialog(code);
    return true;
  } catch (err) {
    console.warn("[steam] openOverlay failed:", dialog, err);
    return false;
  }
});

// Open the Steam overlay to a specific URL (store page, news, etc.).
handle("steam:openOverlayUrl", (_evt, url: string) => {
  if (!steamClient) return false;
  try {
    steamClient.overlay.activateToWebPage(url);
    return true;
  } catch (err) {
    console.warn("[steam] openOverlayUrl failed:", url, err);
    return false;
  }
});

/**
 * Persisted user prefs (currently just fullscreen mode). Stored as a
 * tiny JSON blob in app.getPath("userData") so the choice survives
 * app restarts without reaching into localStorage.
 *
 * Kept intentionally minimal: reads are synchronous at app start so
 * we can apply prefs to the BrowserWindow constructor, writes are
 * best-effort from the IPC handler and never block the caller.
 */
type Prefs = { fullscreen?: boolean };
let _prefsPath = "";
function prefsPath(): string {
  if (!_prefsPath) {
    _prefsPath = path.join(app.getPath("userData"), "prefs.json");
  }
  return _prefsPath;
}
function loadPrefs(): Prefs {
  try {
    return JSON.parse(fs.readFileSync(prefsPath(), "utf8")) as Prefs;
  } catch {
    return {};
  }
}
function savePrefs(patch: Prefs): void {
  try {
    const current = loadPrefs();
    const next = { ...current, ...patch };
    fs.writeFileSync(prefsPath(), JSON.stringify(next), "utf8");
  } catch (err) {
    console.warn("[prefs] save failed:", err);
  }
}

// IPC: toggle fullscreen from the desktop menu. Persists so the
// preference survives app restart.
handle("window:setFullscreen", (evt, wantFullscreen: boolean) => {
  const win = BrowserWindow.fromWebContents(evt.sender);
  if (!win || win.isDestroyed()) return false;
  const isMac = process.platform === "darwin";
  if (isMac) {
    win.setSimpleFullScreen(!!wantFullscreen);
  } else {
    win.setFullScreen(!!wantFullscreen);
  }
  savePrefs({ fullscreen: !!wantFullscreen });
  return !!wantFullscreen;
});

// IPC: read current fullscreen state (used by the menu to sync the
// toggle label when the overlay opens).
handle("window:isFullscreen", (evt) => {
  const win = BrowserWindow.fromWebContents(evt.sender);
  if (!win || win.isDestroyed()) return false;
  return process.platform === "darwin" ? win.isSimpleFullScreen() : win.isFullScreen();
});

// ── Steam Cloud save mirror ────────────────────────────────────────
// The renderer pushes {version, savedAt, data} snapshots of its
// localStorage persistence (src/steamCloud.ts) and we keep them in
// save.json under userData, where Steam Auto-Cloud picks the file up.
// Gated on steamClient: the identical binary shipped DRM-free must
// never grow a save.json (players could mistake it for a working
// cloud save). Writes go through a tmp file + rename so a crash
// mid-write can't leave Auto-Cloud a half-written JSON — and the tmp
// name never matches Auto-Cloud's exact-filename pattern.

function cloudSavePath(): string {
  return path.join(app.getPath("userData"), "save.json");
}

// Last snapshot the renderer sent vs last content that landed on
// disk. will-quit re-flushes only when they differ (a failed write),
// so the common quit path costs nothing extra.
let lastCloudSnapshot: string | null = null;
let lastCloudWritten: string | null = null;

function writeCloudSaveAtomic(content: string): boolean {
  const finalPath = cloudSavePath();
  const tmpPath = finalPath + ".tmp";
  try {
    fs.writeFileSync(tmpPath, content, "utf8");
    fs.renameSync(tmpPath, finalPath);
    lastCloudWritten = content;
    return true;
  } catch (err) {
    console.warn("[steam-cloud] save.json write failed:", err);
    return false;
  }
}

// IPC: latest cloud file content, or null when there is none (first
// launch on this machine), or Steam is absent. Other read errors propagate
// so the renderer cannot overwrite a file it has not reconciled.
handle("cloud-save:read", () => {
  if (!steamClient) return null;
  try {
    if (fs.statSync(cloudSavePath()).size > MAX_CLOUD_SAVE_BYTES) {
      throw new Error("Cloud save exceeds supported size");
    }
    return fs.readFileSync(cloudSavePath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
});

// IPC: persist a renderer snapshot. The renderer debounces, so each
// invoke is meant to hit disk immediately.
handle("cloud-save:write", (_evt, content: string) => {
  if (!steamClient) return false;
  if (typeof content !== "string") return false;
  lastCloudSnapshot = content;
  return writeCloudSaveAtomic(content);
});

app.on("will-quit", () => {
  // Belt-and-suspenders for shutdown races: if the last renderer
  // received snapshot never made it to disk because a write failed, retry it.
  if (lastCloudSnapshot !== null && lastCloudSnapshot !== lastCloudWritten) {
    writeCloudSaveAtomic(lastCloudSnapshot);
  }
});

// IPC: activate a Steam achievement by its API Name. Idempotent on
// Steam's side — re-activating an already-unlocked achievement is a
// no-op, so we don't need to gate on isActivated first. Returns true
// on success, false on any failure (SDK absent, name unknown, etc).
handle("steam:activateAchievement", (_evt, apiName: string) => {
  if (!steamClient) return false;
  try {
    return steamClient.achievement.activate(apiName);
  } catch (err) {
    console.warn("[steam] activateAchievement failed:", apiName, err);
    return false;
  }
});

// IPC: batched state fetch used by the init reconcile pass. Returns
// a record of { apiName: unlocked } for every name the renderer asks
// about. Returns an empty object when Steam isn't available so the
// renderer doesn't need a special null code path.
handle("steam:getAchievementStates", (_evt, apiNames: string[]): Record<string, boolean> => {
  const out: Record<string, boolean> = {};
  if (!steamClient) return out;
  for (const name of apiNames) {
    try {
      out[name] = steamClient.achievement.isActivated(name);
    } catch {
      out[name] = false;
    }
  }
  return out;
});

function createWindow(): void {
  const isMac = process.platform === "darwin";
  // Default fullscreen for desktop games. Player can opt-out via the
  // Fullscreen toggle in the settings menu; that writes prefs.json,
  // which we read here to restore the preference on next launch.
  const prefs = loadPrefs();
  const wantFullscreen = prefs.fullscreen !== false; // default true

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    title: "Raptor Runner",
    icon: path.join(__dirname, "../public/assets/icon-rounded-1024.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
    // Fullscreen + simpleFullScreen together are required on macOS:
    //   - `fullscreen: true` alone uses Lion-style Spaces transition
    //     which animates the window visibly even with show: false
    //     (caused the earlier FOUC-behind-splash bug).
    //   - `simpleFullscreen: true` alone just ENABLES the capability;
    //     the window still opens windowed unless fullscreen is set.
    //   - Both together: window opens instantly at screen size in
    //     pre-Lion style fullscreen, no Spaces animation.
    // On Windows/Linux plain fullscreen is already animation-free.
    fullscreen: wantFullscreen,
    simpleFullscreen: isMac,
    titleBarStyle: isMac ? "hiddenInset" : "default",
    // Windows/Linux: keep the menu bar out of the frame even if the
    // player hits Alt. installApplicationMenu() also nulls the menu
    // entirely on non-mac below, so this is belt-and-suspenders.
    autoHideMenuBar: !isMac,
    backgroundColor: "#50b4cd", // sky-blue matches splash + game sky
    show: false, // wait for first paint so the splash is what appears
  });

  // Show the window only after the renderer has painted at least
  // once. With the inline splash in index.html, that first paint is
  // already the splash — so the window becomes visible already
  // showing the splash, no black/white flash.
  win.once("ready-to-show", () => {
    if (!win.isDestroyed()) win.show();
  });

  secureWindow(win);

  if (isDev) {
    // Dev: connect to the Vite dev server for HMR.
    win.loadURL(DEV_URL);
    // Open DevTools in dev mode (detached so it doesn't resize the game)
    win.webContents.openDevTools({ mode: "detach" });

    // Recover from transient dev-server outages. When Vite decides to
    // restart its own server (e.g. because a file reachable from
    // vite.config.ts's dep graph changed), there's a ~200–500ms
    // window where the port is closed. If the Electron window tries
    // to reload during that window, Chromium drops the page onto the
    // ERR_CONNECTION_RESET / ERR_CONNECTION_REFUSED error screen and
    // never retries on its own — the window is stuck on the sad-face
    // page until you kill Electron and rerun `npm run dev:desktop`.
    //
    // Fix: listen for did-fail-load, and if the failure is (a) on
    // the main frame, (b) against the Vite dev URL, and (c) a
    // recoverable network error code, schedule a retry loop. Each
    // retry is a fresh loadURL; once the server is back up the page
    // loads and HMR is live again.
    //
    // Chromium network error codes:
    //   -3   ABORTED            (we started a new nav; ignore)
    //   -7   TIMED_OUT
    //  -21   NETWORK_CHANGED
    // -101   CONNECTION_RESET   ← the one we see
    // -102   CONNECTION_REFUSED ← common when Vite is still spinning up
    // -104   CONNECTION_FAILED
    // -105   NAME_NOT_RESOLVED
    // -106   INTERNET_DISCONNECTED
    const RECOVERABLE_ERRORS = new Set([-7, -21, -101, -102, -104, -105, -106]);
    let retrying = false;
    win.webContents.on(
      "did-fail-load",
      (_evt, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame) return;
        if (!isApplicationUrl(validatedURL)) return;
        if (!RECOVERABLE_ERRORS.has(errorCode)) return;
        if (retrying) return;
        retrying = true;
        console.log(`[dev-reload] ${errorDescription} (${errorCode}); retrying`);
        const tryReload = () => {
          if (win.isDestroyed()) {
            retrying = false;
            return;
          }
          win.loadURL(DEV_URL).catch(() => {
            // still failing — keep polling until the server is back.
            // 500 ms is small enough that the blue screen is barely
            // visible, big enough that we're not hammering the port.
            setTimeout(tryReload, 500);
          });
        };
        // Small initial delay so Vite has a moment to rebind.
        setTimeout(tryReload, 300);
      },
    );
    // Once a reload succeeds we can accept another recovery attempt.
    win.webContents.on("did-finish-load", () => {
      retrying = false;
    });
  } else {
    // Production: load the built dist/index.html
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  // Force landscape by preventing the window from being narrower than tall
  win.on("resize", () => {
    const [w, h] = win.getSize();
    if (h > w) {
      win.setSize(h, w); // swap dimensions to force landscape
    }
  });
}

/**
 * Install the application menu.
 *
 * - Windows/Linux: no menu. The in-game settings overlay already
 *   exposes everything the player needs (mute, fullscreen, quit), so
 *   the default File/Edit/View/Help bar is just visual noise.
 * - macOS: can't be fully hidden (the system draws the app menu even
 *   if setApplicationMenu(null) is called), so we install a minimal
 *   menu that preserves the standard keyboard shortcuts — Cmd+Q,
 *   Cmd+W, Cmd+C/V/X, Cmd+H — and nothing else.
 */
function installApplicationMenu(): void {
  if (process.platform !== "darwin") {
    Menu.setApplicationMenu(null);
    return;
  }
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "close" }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  installApplicationMenu();

  // macOS dock icon. In packaged builds this comes from the .icns
  // baked into the app bundle (build.mac.icon), but in dev mode
  // Electron shows its own icon unless we override it here. Windows
  // / Linux dock/taskbar icons come from the BrowserWindow `icon:`
  // option below.
  if (process.platform === "darwin" && app.dock) {
    try {
      app.dock.setIcon(path.join(__dirname, "..", "public", "assets", "icon-512.png"));
    } catch (err) {
      console.warn("[app] failed to set dock icon:", err);
    }
  }

  createWindow();

  // macOS: re-create window when dock icon is clicked and no windows open
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed (except on macOS where apps stay
// running until explicitly quit via Cmd+Q).
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
