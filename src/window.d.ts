/*
 * Ambient types for the cross-module bridges hung off `window`.
 *
 * `window.Game` is the public API surface of the game layer (defined
 * as the GameAPI const in src/main.ts). The renderer-side UI code
 * (src/ui.ts and the React overlays) talks to the game layer through
 * this object only — see the comment block at the top of src/ui.ts.
 *
 * The `__rr*` and `__onStartKey` properties are imperative bridges
 * the React overlays / ui.ts use to round-trip with main.ts (gamepad
 * focus walk, "menu is open?" check, deferred Start handler). All of
 * these are typed optional because they're assigned at module init
 * time; consumers must guard with `?.()` before calling.
 */

export {};

declare global {
  interface Window {
    Game?: import("./main").GameAPI;
    __onStartKey?: () => void;
    __rrIsMenuOpen?: () => boolean;
    __rrMenuFocusNext?: () => void;
    __rrMenuFocusPrev?: () => void;
    __rrMenuSelect?: () => void;
    __rrMenuAdjust?: (dir: number) => boolean;
    __rrScoreCardFocusInitial?: () => void;
    __rrToggleMenu?: () => void;
    __rrCloseMenu?: () => void;
    __rrMenuBack?: () => void;
    __rrActiveScrollable?: () => { scrollBy(dx: number, dy: number): void } | null;
    __rrSubOverlayOpen?: () => boolean;
    __rrCloseActiveSubOverlay?: () => boolean;
    __rrSubOverlayFocusNext?: () => void;
    __rrSubOverlayFocusPrev?: () => void;
    __rrSubOverlaySelect?: () => void;
    /** Non-wrapping focus walk for scrollable sub-overlays; false = ring
     *  edge (or empty ring), which tells the poller to scroll instead. */
    __rrSubOverlayFocusStep?: (dir: 1 | -1) => boolean;
    __rrSubOverlayFocusAtEdge?: (dir: 1 | -1) => boolean;
    /** True while a ring item actually holds focus — gates confirm in
     *  scrollable sub-overlays so an unentered ring cannot click an
     *  invisible target. */
    __rrSubOverlayFocusEntered?: () => boolean;
  }
}
