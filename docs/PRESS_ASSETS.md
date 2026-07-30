# press/ assets

Web-only assets. Pruned from Electron and Capacitor builds and excluded
from the PWA precache (see the `prune-native-press-assets` plugin and the
`press/**` globs in `vite.config.ts`), so nothing here ships inside a
native binary.

Three groups, and the distinction matters for store submissions.

## `NN-*.png` — gameplay screenshots

Steam requires at least five screenshots and wants them to be **gameplay
only**: no concept art, no marketing copy, no menus unless the menu is a
genuinely unique component. These qualify.

`01`–`07` are referenced by `press.html` and `landing.html`. Don't
renumber them.

| File | Shows |
| --- | --- |
| `01-midday.png` | Bright baseline — cactus varieties, parallax dunes |
| `02-sunset.png` | Warm evening sky |
| `03-night.png` | Moon, stars, Milky Way band |
| `04-storm-lightning.png` | Peak weather, lightning strike |
| `05-cosmetics.png` | Raptor wearing cosmetics |
| `06-sunrise.png` | Pre-dawn gradient range |
| `07-rainy-night.png` | Rain at night |
| `08-coin-clear-day.png` | Coin pickup, clear midday, HUD visible |
| `09-pterodactyl-dusk.png` | Pterodactyl in flight against a dusk sky |
| `10-flower-field.png` | A flower stretch: coin run, sparkles, no cacti |

`08`–`10` are 2920x1535-ish (~1.90:1). `01`–`07` are 1920x1081, one pixel
too tall to be the 16:9 Steam asks for. **Everything here needs a re-crop
to exactly 1920x1080 before upload.**

## `ui-*.png` — menu and overlay captures

Not eligible as general Steam screenshots — Valve's rules say to avoid
menu screens. Useful for the press kit, devlogs and store-page GIFs.

`ui-shop.png` is the exception worth considering: the shop is arguably a
unique component, which is the carve-out Valve allows. Keep it out of the
first few slots if you submit it, since a reviewer may disagree.

## `asset-*`, `preview-*`, `icon-*` — source art

Reusable pieces for building store capsules, not screenshots.

| File | Size | Notes |
| --- | --- | --- |
| `icon-raptor-runner.svg` | vector | Best scaling source — use this over the PNGs wherever possible |
| `asset-raptor.png` | 1200x630 | Composed key art: wordmark, tagline, raptor, cacti, sky. Closest thing to a header capsule already |
| `asset-raptor-sprite.png` | 578x212 | Raptor cutout, ~2.73:1 — close to the small capsule's 2.66:1 |
| `asset-raptor-icon.png` | 512x512 | Square raptor on a sky gradient |
| `preview-raptor-1024.png` | 1024x1024 | App-icon treatment with a rounded dark border |
| `preview-raptor-512.png` | 512x512 | Same, smaller |

Steam capsule dimensions and content rules are in the vault:
`raptor-runner-capsule-art-brief.md`. Note that the four store capsules
are double the size most older guides state.
