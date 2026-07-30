# Accessibility

What Raptor Runner actually implements, where it lives, and how it maps
to the Steam store page's accessibility checkboxes. Settings live in the
pause menu under **Accessibility** (cog → Accessibility) and persist via
the versioned localStorage schema in `src/persistence.ts`.

## Implemented features

### Adjustable text size
- Presets 100% / 115% / 130% / 150% (`TEXT_SCALE_PRESETS` in
  `src/constants.ts`), applied as a percentage root font-size so it
  composes with OS/browser font scaling (`applyTextScale` in
  `src/main.ts`).
- Covers all DOM chrome (menus, HUD, overlays). Canvas-drawn text (the
  in-world score during a run) does not scale; the DOM HUD mirrors it.

### Reduced motion
- Three-way setting: System (follows `prefers-reduced-motion`), On, Off
  (`src/reducedMotion.ts`).
- Honored by both the CSS chrome (paired `@media` / class blocks in
  `src/styles/legacy.css`) and canvas effects.
- Baseline design restraint: the game has no screen shake or camera bob
  to begin with.

### Volume controls
- Sliders: master, music, effects (fans out to jump / footsteps / coins
  / UI / events / thunder), rain. 0–100% in 5% steps, routed through a
  shared Web Audio gain graph (`src/audio.ts`).
- Separate per-channel mute toggles (9 channels) under Sound Settings.

### Input remapping
- The gameplay jump key is remappable (keyboard capture UI in the
  Accessibility panel; replaces the Space / W / Up-Arrow default trio
  with the captured key). Reserved keys (Escape, Enter, Tab, F9) are
  refused and a reset restores the defaults; the binding can never end
  up empty.
- Menu navigation keys and gamepad bindings are **not** remappable.

### Playable with a single input
- Core gameplay is one action (jump): one key, one tap, or one gamepad
  button. Menus are fully operable by keyboard alone, pointer alone, or
  gamepad alone.

### High contrast
- Toggle swaps the UI palette via tokens on `<body>`
  (`src/highContrast.ts`, token sets in `src/styles/base.css`) and
  adjusts the canvas composite path. It targets UI/chrome legibility;
  it is not a colorblind-specific palette for gameplay objects.

### Screen-reader support (narrated menus)
- All menus and overlays are real DOM with ARIA: labelled controls,
  `aria-pressed` on toggles, `aria-valuetext` on sliders, labelled
  native `<select>`s, `role="dialog"` + `aria-modal` + Tab focus
  trapping on overlays, polite live regions for score milestones,
  achievement toasts, share feedback, and key-capture status.
- Game-over actions (Revive / Share / Play again) are real buttons;
  arrow-key and d-pad navigation moves actual DOM focus, so the focused
  action is announced by the OS screen reader.
- Narration comes from the platform screen reader (VoiceOver / NVDA /
  Narrator) reading the DOM — there is no built-in self-voicing engine.

## Honest caveats

- The gameplay field itself is a canvas: obstacles are not announced.
  A blind player can operate every menu but not play runs by sound
  alone. There is no audio cue for approaching obstacles.
- Canvas-rendered score/game-over text ignores the text-size setting
  (DOM HUD and score card cover the same information).
- High contrast affects UI and canvas compositing, not per-obstacle
  colorblind palettes.
- Screen-reader behavior is verified at the code/DOM level only.
  **TODO (Rico): manual VoiceOver (macOS) and NVDA (Windows) pass over
  the menu, shop, accessibility panel, and game-over card before
  checking the Steam box.**

## Steam store-page checkbox mapping

| Steam checkbox            | Status  | Notes |
| ------------------------- | ------- | ----- |
| Adjustable text size      | Yes     | 100–150% presets, DOM chrome |
| Adjustable colors         | Partial | High-contrast UI toggle; no gameplay colorblind palettes |
| Volume controls           | Yes     | Master + music/effects/rain sliders, per-channel mutes |
| Custom volume controls    | Yes     | Same as above |
| Input remapping           | Partial | Keyboard jump key only; claim only if partial counts |
| Playable with single input| Yes     | One-button gameplay |
| Narrated menus / screen reader | Partial | DOM + ARIA via OS screen reader; manual SR test pending (see TODO) |
| Camera comfort / motion   | Yes     | Reduced-motion setting; no screen shake by design |

When in doubt on a checkbox, under-claim: a partial feature marked
"yes" on the store page is a refund/review liability; the same feature
described accurately in the description text is a plus.
