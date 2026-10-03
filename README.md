# Raptor Runner

A handcrafted homage to the Chrome "No Internet" dinosaur game, with a full
day/night cycle, a starry sky, weather, rare events, cosmetics, and a
shop. Plays in the browser, ships as a desktop app via Electron, and as a
mobile app via Capacitor — one TypeScript codebase, three targets.

Live build: [raptorrunner.com](https://raptorrunner.com)

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

- Web: deployed to `raptorrunner.com` via GitHub Pages (`.github/workflows/deploy.yml`).
  The custom domain comes from `public/CNAME`; `www.raptorrunner.com` is a
  CNAME to the Pages host and GitHub 301s it to the apex. The retired host
  `raptor.trebeljahr.com` is a Cloudflare redirect rule (301, path preserved)
  to the apex — keep that rule, players still have the old URL bookmarked.
- Desktop: `pnpm electron:build` — outputs to `release/`
- Signed releases and store uploads: [release operations](docs/RELEASING.md)
- Mobile: `pnpm cap:run:ios` / `pnpm cap:run:android`
- itch.io: `pnpm itch:push:mac` / `:win` / `:linux` / `:android`
