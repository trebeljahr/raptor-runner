# Raptor Runner — Notes for Claude Code

A canvas-based dino-runner game. One TypeScript codebase, three targets:
web (Vite → static deploy), desktop (Electron), mobile (Capacitor).

## Stack

- **Vite + TypeScript**, strict mode. `tsconfig.json` includes `*.ts` and
  `*.d.ts` only — `.tsx` files (React overlays) are picked up via Vite's
  own pipeline.
- **Canvas** for the game. No game framework.
- **React** for menus, shop, settings, credits — mounted on top of the
  canvas as overlays. Each lives in `src/ui/react/<Name>.tsx` paired
  with `src/ui/react/mount<Name>.ts` that owns the React root.
- **Vitest** for unit tests (`pnpm test`).
- **pnpm** is the only supported package manager. Pinned via
  `packageManager` field. Don't use `npm install`.

## Code map

- `src/main.ts` — game loop, physics, rendering pipeline, public
  `window.Game` API. The single biggest file; everything else either
  feeds it or is called by it.
- `src/state.ts` — mutable `state` singleton. Every subsystem reads/writes
  this object directly.
- `src/ui.ts` — DOM chrome (start screen, menu overlay, sound toggle,
  cog, landscape guard, keyboard shortcuts). Talks to the game **only**
  through `window.Game`. Hosts the `*_CALLBACKS` tables that wire
  React overlays to game actions.
- `src/ui/react/` — React overlay components and their mount helpers.
- `src/entities/` — raptor, cactus, pterodactyl. Each owns its sprite
  state, physics, and collision polygon.
- `src/persistence.ts` — versioned localStorage schema. Has migrations.
  Touch carefully.
- `src/audio.ts` — WebAudio. Respects a global mute flag and the
  "no audio in previews" preference (see Rico's memory).
- `src/cosmetics.ts`, `src/achievements.ts`, `src/credits.ts` — content
  registries. Mostly data.
- `src/mobile/`, `src/steamBridge.ts`, `electron/` — platform adapters.
- `src/render/`, `src/effects/`, `src/workers/` — rendering helpers.

## Conventions

- **UI → game communication goes through `window.Game`.** `ui.ts` does
  not import from `main.ts`, `state.ts`, or `audio.ts`. Preserve this.
- **Debug mode is gated on `import.meta.env.DEV`** ([main.ts:3002](src/main.ts:3002)).
  `?debug=true` is a dead knob in production builds; debug branches are
  tree-shaken out of the prod bundle.
- **CSP is tight.** No `'unsafe-inline'` for scripts. The one inline
  bootstrap in `index.html` is sha256-pinned. If you add inline JS,
  regenerate the hash via `pnpm csp:verify`.
- **Don't introduce merge commits.** Rebase + fast-forward only (see
  Rico's global git workflow rule).
- **No emoji** in code or commits unless explicitly asked.
- **Comments**: explain *why*, not *what*. Don't reference the current
  task or PR in comments.

## Build matrix

| Target    | Command                  | Notes                                |
| --------- | ------------------------ | ------------------------------------ |
| Web dev   | `pnpm dev`               | `import.meta.env.DEV === true`       |
| Web prod  | `pnpm build`             | typechecks first, then `vite build`  |
| Desktop   | `pnpm electron:build`    | `VITE_TARGET=electron`               |
| Mobile    | `pnpm cap:run:ios/android` | `VITE_TARGET=capacitor`            |

`pnpm typecheck` runs `tsc --noEmit` against the whole tree.
`pnpm test` runs Vitest once (no watch).

## Things that bite

- **The repo lives in a worktree-friendly layout.** Worktrees under
  `.claude/worktrees/` use the parent's `node_modules` if you don't run
  `pnpm install` inside the worktree. Always `pnpm install` once after
  creating a worktree, otherwise `tsc` may resolve a stale TypeScript.
- **`state.debug` is set once at init**, not reactively. Toggling it at
  runtime won't propagate; the `data-debug="true"` body attribute
  controls visibility of debug menu rows via CSS.
- **Particle and entity arrays in `state` are shared mutable**. Don't
  replace them with new references — code holds references across
  frames.

## Don't do

- Don't add audio that auto-plays or pings during preview verification —
  the preview window has no audio control (Rico's memory).
- Don't over-juice. This is a Chrome dino homage; restraint is the
  point. No screen shake, no camera bob (Rico's memory).
- Don't force-push release tags. Bump the patch and cut a new tag if a
  v-tag is wrong (Rico's memory).
