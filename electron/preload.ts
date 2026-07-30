/*
 * Raptor Runner — Electron preload script.
 *
 * Runs in the renderer's isolated context before the page loads and
 * exposes a narrow window.electronAPI surface for the Steam bridge.
 *
 * The renderer-side wrapper lives in src/steamBridge.ts, which guards
 * every call against window.electronAPI being undefined — that's what
 * makes the game continue to run unchanged in the browser (PWA) build
 * where this preload never executes.
 */

import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  // Synchronous flag: the mere presence of window.electronAPI means
  // we're running under Electron. Keeping an explicit property
  // lets renderer code read `window.electronAPI?.isDesktop` without
  // an async round-trip — used to toggle desktop-only UI chrome.
  isDesktop: true,

  // Has Steam init succeeded? Cheap boolean the renderer can cache
  // on startup to skip the reconcile pass when offline.
  isSteam: (): Promise<boolean> => ipcRenderer.invoke("steam:isAvailable"),

  // Fire an achievement unlock to Steam. Idempotent — re-unlocking is
  // a no-op on Steam's side. Returns true on success, false otherwise.
  unlockSteamAchievement: (apiName: string): Promise<boolean> =>
    ipcRenderer.invoke("steam:activateAchievement", apiName),

  // Batched read of Steam's unlock state for every id the renderer
  // passes in. Used once at startup to reconcile local <-> Steam.
  getSteamAchievementStates: (apiNames: string[]): Promise<Record<string, boolean>> =>
    ipcRenderer.invoke("steam:getAchievementStates", apiNames),

  // Quit the app. Called from the desktop-only Quit button.
  quit: (): Promise<void> => ipcRenderer.invoke("app:quit"),

  // Toggle fullscreen / windowed from the desktop settings menu.
  // Persists across app restarts (prefs.json in userData).
  setFullscreen: (on: boolean): Promise<boolean> => ipcRenderer.invoke("window:setFullscreen", on),
  isFullscreen: (): Promise<boolean> => ipcRenderer.invoke("window:isFullscreen"),

  // Steam overlay dialogs (Friends / Achievements / etc.). Returns
  // false if Steam isn't running or the client refuses.
  openSteamOverlay: (
    dialog:
      | "Friends"
      | "Community"
      | "Players"
      | "Settings"
      | "OfficialGameGroup"
      | "Stats"
      | "Achievements",
  ): Promise<boolean> => ipcRenderer.invoke("steam:openOverlay", dialog),
  openSteamOverlayUrl: (url: string): Promise<boolean> =>
    ipcRenderer.invoke("steam:openOverlayUrl", url),

  // Steam Input snapshot stream (~60 Hz, pushed by the main process
  // only when Steam Input initialized). Returns an unsubscribe
  // function. The wrapper keeps the IpcRendererEvent out of the page
  // — nothing Electron-flavoured crosses the context bridge. The
  // frame is plain JSON; the renderer types it as SteamInputFrame
  // (src/electron.d.ts).
  onSteamInputFrame: (cb: (frame: unknown) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, frame: unknown) => cb(frame);
    ipcRenderer.on("steam-input:frame", listener);
    return () => {
      ipcRenderer.removeListener("steam-input:frame", listener);
    };
  },

  // Activate a Steam Input action set ("InGame" | "Menus"). Resolves
  // false when Steam Input is not live — never rejects.
  setSteamActionSet: (name: string): Promise<boolean> =>
    ipcRenderer.invoke("steam-input:set-action-set", name),
});
