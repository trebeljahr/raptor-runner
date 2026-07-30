# Third-party notices

The packaged Raptor Runner desktop application bundles the following
third-party components. Each remains subject to its own license; this
file aggregates the attributions required for redistribution.

## Runtime dependencies (shipped in the binary)

### Electron

- License: MIT
- Homepage: https://www.electronjs.org/
- Source: https://github.com/electron/electron

The bundled Electron runtime includes Chromium (BSD-style) and Node.js
(MIT). Upstream attribution files for those components are shipped
inside the Electron distribution under `LICENSES.chromium.html` and
similar.

### steamworks.js

- License: MIT
- Homepage: https://github.com/ceifa/steamworks.js

Wraps the Steamworks SDK. Only loaded when a valid Steam App ID is
configured; not initialised in itch.io / DRM-free builds.

### Valve Steamworks SDK (loaded at runtime by steamworks.js, Steam builds only)

- License: Steamworks SDK Access Agreement
- https://partner.steamgames.com/doc/sdk/uploading/distributing_opensource

Only applicable to the Steam release channel. Not present in the
itch.io distribution.

## Build-time dependencies (not shipped in the binary)

### Vite, TypeScript, Tailwind CSS, vite-plugin-pwa

All MIT-licensed; used only at build time to produce the `dist/` bundle.
See `package.json` for the full devDependency list.

## Bundled fonts

### Unbounded (`@fontsource-variable/unbounded`)

- License: SIL Open Font License 1.1
- Copyright 2022 The Unbounded Project Authors
- https://github.com/googlefonts/unbounded

Subset `.woff2` files are shipped in `dist/assets/`. The OFL requires the
license text to travel with the font; the full text is in
`node_modules/@fontsource-variable/unbounded/LICENSE`.

## Game assets

Raptor Runner's assets are a mix of third-party licensed work, generated
work, and original work. They are **not** uniformly Rico Trebeljahr's
copyright, and this file should not claim otherwise.

**The authoritative attribution list is `src/credits.ts`**
(`ATTRIBUTION_SECTIONS`), which is the single source rendered into both the
in-game credits overlay and the Credits section of `imprint.html`. Keep it
that way: adding an attribution here instead of there means the game itself
stops showing it, which is what the licenses actually require.

Third-party assets currently credited there include:

- **Raptor sprite and running animation** — by Chris Masna ("Run Forrest
  Run" on DeviantArt), used with explicit permission.
- **Cactus, party hat, bow tie, flower, and coin sprites** — Freepik,
  under the Freepik Free License, which requires attribution.
- **"Thug life" sunglasses** — Wikimedia Commons, by Aboulharakat,
  licensed CC BY-SA 4.0.
- **Music** — "L'Étoile danse Pt. 1" by Meydän, CC BY 4.0.
- **Sound effects** — various, from Pixabay and itch.io, several under
  CC BY 3.0. Pixabay's link-attribution URLs must be preserved verbatim.

Everything not attributed in `src/credits.ts` is either generated or
original work. Original assets are © 2026 Rico Trebeljahr; see
[LICENSE](LICENSE) for redistribution terms.

<!--
  One item to resolve before a paid storefront release:

  thug-glasses.png is CC BY-SA 4.0. Share-alike is the one license in this
  list that can propagate obligations to derivative work, and the sprite
  was modified (background flood-filled). Confirm this is acceptable for a
  paid closed-source release, or swap the sprite.

  The raptor sprite permission is settled — Chris Masna granted full use.
-->


---

To regenerate a complete dependency-tree license list for a build, run:

    npx license-checker --production --summary
