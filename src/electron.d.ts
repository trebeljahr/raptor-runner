/*
 * Ambient types for the Electron preload bridge.
 *
 * window.electronAPI is undefined in the browser (PWA) build. The
 * renderer-side wrapper in src/steamBridge.ts checks for presence
 * before every call, so the optional type here matches runtime.
 */

export {};

declare global {
  /**
   * One Steam Input snapshot, pushed by the Electron main process at
   * ~60 Hz (see electron/main.ts). Level state, not edges — edge
   * detection happens renderer-side against the previous frame.
   */
  interface SteamInputFrame {
    /** True only when every action handle resolved AND >= 1 controller. */
    readonly available: boolean;
    readonly controllerCount: number;
    /** Raw steamworks.js InputType string, e.g. "PS5Controller". */
    readonly inputType: string;
    /** The action set the main process had activated when this frame
     *  was polled. Lets the renderer hold its edge-state prime until
     *  snapshots reflect a requested set switch. Optional so a stale
     *  compiled main process degrades to one-frame priming instead of
     *  wedging the Steam path. */
    readonly activeSet?: string;
    /** Pressed-right-now per digital action name (src/input/steamActions.ts). */
    readonly digital: Record<string, boolean>;
  }

  interface ElectronAPI {
    readonly isDesktop: true;
    isSteam(): Promise<boolean>;
    unlockSteamAchievement(apiName: string): Promise<boolean>;
    getSteamAchievementStates(apiNames: string[]): Promise<Record<string, boolean>>;
    quit(): Promise<void>;
    setFullscreen(on: boolean): Promise<boolean>;
    isFullscreen(): Promise<boolean>;
    openSteamOverlay(
      dialog:
        | "Friends"
        | "Community"
        | "Players"
        | "Settings"
        | "OfficialGameGroup"
        | "Stats"
        | "Achievements",
    ): Promise<boolean>;
    openSteamOverlayUrl(url: string): Promise<boolean>;
    /** Subscribe to Steam Input snapshots; returns an unsubscribe fn. */
    onSteamInputFrame(cb: (frame: SteamInputFrame) => void): () => void;
    /** Activate a Steam Input action set. False when Steam Input is not live. */
    setSteamActionSet(name: string): Promise<boolean>;
  }

  interface Window {
    electronAPI?: ElectronAPI;
  }
}
