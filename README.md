# Raptor Runner

A pixel-art homage to the Chrome "No Internet" dinosaur game, with a full
day/night cycle, a starry sky, weather, rare events, cosmetics, and a
shop. Plays in the browser, ships as a desktop app via Electron, and as a
mobile app via Capacitor — one TypeScript codebase, three targets.

Live build: [raptor.trebeljahr.com](https://raptor.trebeljahr.com)

## Stack

- **Vite + TypeScript** for the build and dev server
- **Canvas** for the game itself (no game framework)
- **React** for menu / shop / settings overlays mounted on top of the canvas
- **Electron** for desktop builds (macOS / Windows / Linux)
- **Capacitor** for mobile builds (iOS / Android)
- **Vitest** for unit tests
- **pnpm** for package management (pinned via `packageManager` in `package.json`)

## Development

```sh
pnpm install
pnpm dev          # web dev server
pnpm dev:desktop  # web dev server + Electron shell
pnpm test         # run unit tests
pnpm typecheck    # tsc --noEmit
pnpm build        # web production build (typecheck + vite build)
```

Append `?debug=true` to the URL during `pnpm dev` to unlock the debug menu
(hitbox overlay, score editor, rare-event triggers, free shop). Debug mode
is gated on `import.meta.env.DEV`, so the flag is a dead knob in
production builds and the debug branches are tree-shaken out of the
shipped bundle.

## Distribution

- Web: deployed to `raptor.trebeljahr.com`
- Desktop: `pnpm electron:build` — outputs to `release/`
- Mobile: `pnpm cap:run:ios` / `pnpm cap:run:android`
- itch.io: `pnpm itch:push:mac` / `:win` / `:linux` / `:android`
