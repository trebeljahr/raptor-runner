# Trailer pipeline

Agent-driven trailer cuts: record deterministic gameplay clips headlessly,
describe the cut in an edit file, render a draft MP4, and fine-tune the same
cut in DaVinci Resolve (the free edition is enough).

```
record-trailer-shots.mjs ──► trailer-clips/raw/NN-<slug>.mp4      (1920x1080, 60 fps, no HUD)
trailer/<cut>.json ──► render-trailer.mjs ──► trailer-clips/cuts/<cut>/
                                                ├─ <cut>.mp4       draft, H.264 + AAC
                                                ├─ <cut>.fcpxml    Resolve timeline
                                                ├─ <cut>.otio      same cut, OpenTimelineIO
                                                ├─ cards/*.png     title and end cards
                                                └─ media/          music and effects copies
```

`trailer-clips/` sits in the **main checkout** (also when the scripts run in a
worktree, so clips survive worktree cleanup) and is gitignored. Nothing is
uploaded anywhere.

## 1. Record clips

`?headless=1` (virtual clock, `src/headlessRaf.ts`) and `?trailer=1`
(the director, `src/trailer.ts`) are DEV-only, so recording needs a dev
server, not `vite preview`. Chrome runs headless on a virtual clock: no
window opens and nothing takes focus. Pick a free high port.

```bash
pnpm dev --port 51843 --strictPort
```

```bash
BASE_URL=http://localhost:51843 pnpm trailer:shots
```

```bash
BASE_URL=http://localhost:51843 pnpm trailer:shots --shots=storm-lightning,rainbow
```

- `pnpm trailer:shots:list` prints the shot list.
- `--fps=30` halves capture time; `--seconds=N` overrides every length.
- About 30–120 s wall time per shot on an M-series Mac; all 17 take ~20–40 min.
- Re-recording a shot gives the same footage: `Math.random` is seeded from
  the slug, and game time steps one frame at a time.
- Each clip gets a sidecar `NN-<slug>.events.json`: the clip second of
  every coin pickup, jump and lightning strike, for placing sound effects
  in the edit file.
- Vite's file watcher ignores `.claude/` paths, so a dev server started in
  a worktree under `.claude/worktrees/` keeps serving stale modules after an
  edit to `src/`. Restart the dev server after changing the game code.

Shots live in `SHOTS` in `scripts/record-trailer-shots.mjs`. Per shot:
`phase` (time of day, `PHASE.*`), `rate` (sky sweep in day cycles per
second), `moon` (moon phase, 0.5 = full), `stand` (`{ x, clouds }`: freeze
the world and stand the raptor still while the sky turns and clouds race,
for the time-lapse), `outfit` (cosmetic ids from `src/cosmetics.ts`),
`rain` (`off`, `build`, `full`), `lead` (game seconds run before the first
frame), `speed`, `seed`, `setup` (actions at the start of the lead) and
`beats` (actions on a given second: `strike`, `rainRamp(to, seconds)`,
`shootingStar`, `pterodactyl`, `breather`).

- **Storm:** one continuous take. `rainRamp` eases the rain in over 6.5 s and
  out over 4.5 s, slower and smoother than the game's own fades, and the
  rainbow comes up as it clears.
- **Night:** the phase lock starts on the second day cycle, so the game's
  own shooting stars fall at night (from the second night on, as in a real
  run); `shootingStar` adds one on a chosen second.
- **Outfit parade:** ten takes share one `seed`, sky and lead, so the
  scenery, cacti and jumps are identical (verified: 57 dB PSNR away from the
  raptor, matching event logs). Cutting between them at continuous clip
  times changes only the outfit.

The director (`window.__trailer`) hides every DOM overlay, owns all 14
cosmetics, keeps rare events and random rain out of the frame, and runs an
autopilot that jumps each cactus and low pterodactyl with the apex over the
obstacle. Collisions are off, so a take never ends in a game over.

## 2. Edit file

`trailer/steam-52s.json` is the current cut. Fields:

| Field | Meaning |
|---|---|
| `fps`, `width`, `height` | output format (60, 1920, 1080) |
| `clips` | clip folder, relative to the main checkout (override with `--clips=`) |
| `music` | `file`, `in` (seconds into the track), `gainDb`, `fadeIn`, `fadeOut`, `credit`, `automation` (`[[second in the cut, dB], …]`, linear between points: duck the calm opening, dip before the drop) |
| `cuts[]` | in order, end to end. Clip cut: `clip` (file name without `.mp4`), `in`, `out` (seconds in the clip), optional `speed`, `fadeIn`, `fadeOut` (to/from black), `look` (`{ blur, dim }`, e.g. under the end card). Card cut: `card` (key in `cards`), `duration`, `fadeIn`, `fadeOut` |
| `titles[]` | transparent overlays: `style` (`end-logo`, `end-cta`, `lower-third`), `start`, `duration` (seconds in the cut), `fadeIn`, `fadeOut`, plus the style's fields (`logo`, `align`, `top`, `width`; `lines`, `align`, `top`; `text`, `kicker`) |
| `cards` | opaque cards used as cuts: `kind: "intertitle"` (`sky`: `day`, `gold`, `dusk`, `night`, `storm`; `text`, optional `kicker`) or `kind: "art"` (`background`, `fit`: `cover` or `width`, `extend`, `position`) |
| `sfx[]` | `file` (repo path) or `synth` (`swell`, `whoosh`, `thump`, `riser`, `boom`, made by ffmpeg), `at` (second in the cut), `gainDb`, optional `duration`, `fadeIn`, `fadeOut` |
| `master` | `loudness` (LUFS, default −14), `truePeak` (dBTP, default −1.5) |
| `note`, `notes` | free text, ignored by the renderer |

Pacing in `steam-52s.json` follows the music's two swells: a calm midday
run with the music low, a swell into the first drop (8.4 s) on a time-lapse
of a full day around the standing raptor, the night sky with shooting stars,
one storm from first drops to rainbow, then the flower stretch in the
track's quiet passage, a second swell into the outfit parade (36.9 s, cuts
shrinking from 1.0 s to 0.5 s), a four-shot recap and the end card. Cards
are hard cuts carried by a soft whoosh; no dips to black.

The edit was generated from the event logs (sound effects land on the
recorded coin, jump and strike frames); edit the JSON directly to tune it.

Cards use the game's display font (Unbounded, from
`@fontsource-variable/unbounded`) over the game's own sky gradients
(`SKY_COLORS`) and a dune silhouette. The end card uses the designed assets
in `trailer/assets/`: `raptor-runner-logo.png` (the transparent wordmark from
the key art) and `library-hero.png` (the Steam library hero), shown whole
along the bottom with its sky extended upward.

Times are rounded to whole frames; the MP4 and both timelines agree to the
frame. The renderer refuses an `out` past a clip's end or a title outside the
cut.

## 3. Render

```bash
pnpm trailer:render trailer/steam-52s.json
```

- `--clips=<dir>` / `--out=<dir>` override the folders.
- `--no-video` writes cards and timelines only (seconds instead of a minute).
- `pnpm trailer:test` runs the timeline unit tests.

Mastering renders the mix alone, measures its loudness, then applies one
static gain plus a limiter (−14 LUFS, −1.5 dBTP). A one-pass `loudnorm`
would flatten the quiet-to-loud ramp.

To check that both timelines parse (OpenTimelineIO has no Python 3.14
wheels yet, so use 3.12):

```bash
python3.12 -m venv /tmp/otio && /tmp/otio/bin/pip install opentimelineio otio-fcpx-xml-adapter
```

```bash
/tmp/otio/bin/python -c "import opentimelineio as o, sys; [print(f, o.adapters.read_from_file(f).duration()) for f in sys.argv[1:]]" trailer-clips/cuts/steam-52s/steam-52s.otio
```

## 4. Fine-tune in Resolve

File → Import → Timeline… → pick `<cut>.fcpxml` (or `<cut>.otio`). Leave
"Automatically import source clips into media pool" on.

- V1: clips and title cards. Each clip points at the full recorded file, so
  trimming in Resolve can extend any cut.
- V2+: overlay PNGs (transparent). To change text, edit the edit file and
  re-render with `--no-video`; the PNGs are overwritten in place and Resolve
  picks them up.
- A1: music, trimmed and placed. A2+: sound effects.
- Draft-only, redo in Resolve: fades, the end-card blur, music automation
  and the loudness master.

Resolve here is the free edition: no external scripting, so no MCP server.
Everything above runs on ffmpeg and plain files.

## Licences and credits

Only assets whose licence allows use in a trailer are in the cut:

- **Music:** "L'Etoile danse (Pt. 1)" by Meydän, from the album *Havor*
  (2018), licensed CC BY 4.0 via Free Music Archive
  (https://freemusicarchive.org/music/Meydan/Havor/6-_LEtoile_danse_Pt_1_1738/).
  Attribution is required: put this credit line in the Steam trailer
  description and any video description:

  > Music: "L'Etoile danse (Pt. 1)" by Meydän (freemusicarchive.org), licensed under CC BY 4.0, https://creativecommons.org/licenses/by/4.0/

- **Sound effects:** Pixabay Content License (use in videos allowed, no
  attribution required): rain ambience by Pig Bank - Mood, thunder clap by
  soundmarker33, coin pickup by freesound_community, coin chain-end chord
  ("Diamond found") by Liecio, achievement stinger by freesound_community.
- **Jump:** "SFX_Jump_22" from the 8-bit Jump Sound Effects pack by Jesús
  Lastra (jalastram), CC BY 3.0, https://jalastram.itch.io/8-bit-jump-sound-effects.
  Credit it next to the music:

  > Jump sound: "SFX_Jump_22" by jalastram, licensed under CC BY 3.0, https://creativecommons.org/licenses/by/3.0/

- Transition sounds (`swell`, `whoosh`, `thump`) are synthesized by ffmpeg.
- Not used: the shop sound (CC BY 3.0) and every rare-event sound.

The authoritative list for the game is `src/credits.ts`.

## Steam upload notes

- Steam: H.264 MP4, 1920x1080, high bitrate. The draft is CRF 16, 60 fps.
- The Steam page copy keeps rare sights unnamed and unshown; the trailer
  follows that and shows none of them.
