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
- About 30–180 s wall time per shot on an M-series Mac; all 19 take ~30–50 min.
- Re-recording a shot gives the same footage: `Math.random` is seeded from
  the slug, and game time steps one frame at a time.
- Each clip gets two sidecars. `NN-<slug>.events.json` lists the clip
  second of every coin pickup, jump, lightning strike, game over and any
  `clip` (the raptor passing through an obstacle: should be none).
  `NN-<slug>.pose.json` holds the raptor's run-cycle frame and height for
  every frame, for matching cuts on the raptor's pose.
- Vite's file watcher ignores `.claude/` paths, so a dev server started in
  a worktree under `.claude/worktrees/` keeps serving stale modules after an
  edit to `src/`. Restart the dev server after changing the game code.

Shots live in `SHOTS` in `scripts/record-trailer-shots.mjs`. Per shot:
`phase` (time of day, `PHASE.*`), `rate` (sky sweep in day cycles per
second), `moon` (moon phase, 0.5 = full), `pterodactyls: false` (cacti only), `obstacles: false` (an open
desert: no cacti, pterodactyls or coins), `raptorAt` (pin the raptor's x;
below 0 is off screen, for sky-only plates), `stand` (freeze the world and
stand the raptor still), `hud` (keep the game's own overlays; starts the run
with the real Start Game button), `score` (the run's distance at the start),
`outfit` (cosmetic ids from `src/cosmetics.ts`), `rain` (`off`, `build`,
`full`), `lead` (game seconds run before the first frame), `speed`, `seed`,
`setup` (actions at the start of the lead) and `beats` (actions on a given
second: `strike`, `rainRamp(to, seconds)`, `shootingStar`, `pterodactyl`,
`breather`, `crash`).

- **Time-lapse:** the raptor runs as in a normal run, on an open desert,
  while a full day turns in 7 s.

- **Storm:** one continuous take. `rainRamp` eases the rain in over 6.5 s and
  out over 4.5 s, slower and smoother than the game's own fades, and the
  rainbow comes up as it clears.
- **Night:** the phase lock starts on the second day cycle, so the game's
  own shooting stars fall at night (from the second night on, as in a real
  run); `shootingStar` adds one on a chosen second.
- **Night plate:** night sky with shooting stars and the raptor off screen;
  blurred, it is the background of every title card.
- **Game over** (recorded, not in the current cut): `parade-finale` runs the
  parade's last look on until `crash` ends the run on a cactus, and a drawn
  cursor clicks Play again; `game-over` does the same with the HUD on.
- **Outfit parade:** ten takes share one `seed`, sky and lead, so the
  scenery, cacti and jumps are identical (verified: 57 dB PSNR away from the
  raptor, matching event logs). Cutting between them at continuous clip
  times changes only the outfit.

The director (`window.__trailer`) hides every DOM overlay, owns all 14
cosmetics and keeps rare events and random rain out of the frame. Its
autopilot simulates the jump arc against every obstacle's real collision
outline (cacti and both pterodactyl heights, with the airborne pose) and
jumps on the frame with the widest clearance, so the raptor never clips an
obstacle. Collisions stay off as a safety net, except in the game-over shot.

## 2. Edit file

`trailer/steam-trailer.json` is the current cut. Fields:

| Field | Meaning |
|---|---|
| `fps`, `width`, `height` | output format (60, 1920, 1080) |
| `clips` | clip folder, relative to the main checkout (override with `--clips=`) |
| `music` | `file`, `in` (seconds into the track), `gainDb`, `fadeIn`, `fadeOut`, `credit`, `automation` (`[[second in the cut, dB], …]`, linear between points: duck the calm opening, dip before the drop) |
| `cuts[]` | in order, end to end. Clip cut: `clip` (file name without `.mp4`), `in`, `out` (seconds in the clip), optional `speed`, `fadeIn`, `fadeOut` (to/from black), `look` (`{ blur, dim }`, e.g. under the end card). Card cut: `card` (key in `cards`), `duration`, `fadeIn`, `fadeOut` |
| `titles[]` | overlays: `style` (`glass`, `art`, `fill`, `end-logo`, `end-cta`, `lower-third`); optional `reveal: { x, y, seconds }` opens the overlay as a circle growing from that point (then it stays fully open); `start`, `duration` (seconds in the cut), `fadeIn`, `fadeOut`, plus the style's fields (`text`; `logo`, `align`, `top`, `width`; `lines`, `align`, `top`; `text`, `kicker`) |
| `cards` | opaque cards used as cuts: `kind: "intertitle"` (`sky`: `day`, `gold`, `dusk`, `night`, `storm`; `text`, optional `kicker`) or `kind: "art"` (`background`, `fit`: `cover` or `width`, `extend`, `position`) |
| `sfx[]` | `file` (repo path; optional `in`, seconds into the file; `rate`, playback rate like Web Audio's, pitch and speed) or `synth` (`tap` is the game's menu/equip tap) (`impact`, `swipe`, `sand`, `swell`, `whoosh`, `thump`, `riser`, `boom`, made by ffmpeg), `at` (second in the cut), `gainDb`, optional `duration`, `fadeIn`, `fadeOut` |
| `master` | `loudness` (LUFS, default −14), `truePeak` (dBTP, default −1.5) |
| `note`, `notes` | free text, ignored by the renderer |

Pacing in `steam-trailer.json` follows the music's two swells: a calm midday
run (two jumps) with the music low, a title card into the first drop on the
time-lapse (shooting stars at night), one storm in one take from first drops
to the strike, then the rainbow, the bare raptor through a flower field in
the track's quiet passage, a card into the outfit parade on the second swell
(no pterodactyls; 30 outfit combinations, cuts shrinking evenly from 0.55 s
to 5 frames, the equip tap rising in pitch). A few frames of the last outfit,
then a hard cut to the end card (an `art` card carrying the wordmark and
call to action via `logo` and `lines`) on a cinematic piano hit.

Sound follows the game: flower-field coins climb in pitch like the game's
chain (7% per pickup, capped at 1.7×) and each outfit change plays the
game's equip tap.

Title cards follow the Mesozoic Protocol cut: black, short fades to and from
black, a big uppercase line in the wordmark's cream and a coin-gold rule,
and a transition sound on each cut in. `pnpm trailer:render` on an edit made
of short clip-to-card pairs is an easy way to audition sounds; the synths
`impact`, `swipe` and `sand` exist for that.

Every cut between two gameplay clips is matched on the raptor's pose: the
frame before the new in-point shows the same run-cycle pose, held as long,
as the last frame of the previous cut (or the same height and direction
mid-jump), so the run cycle continues across the cut. Out-points are pulled
back to a frame on the ground. The edit was generated from the event and
pose logs; edit the JSON directly to tune it.

Cards use the game's display font (Unbounded, from
`@fontsource-variable/unbounded`). The `glass` title style (a frosted panel
over blurred night-plate footage) remains available. The
end card uses the designed assets in `trailer/assets/`:
`raptor-runner-logo.png` (the transparent wordmark from the key art) and
`library-hero.png` (the Steam library hero), shown whole along the bottom
with its sky extended upward.

Times are rounded to whole frames; the MP4 and both timelines agree to the
frame. The renderer refuses an `out` past a clip's end or a title outside the
cut.

### Generating the edit

`trailer/steam-trailer.json` is generated, not hand-written:

```bash
python3 scripts/build-trailer-edit.py trailer/steam-trailer.json M
```

It reads the clips' event and pose logs and writes the cut. Hand edits to
the JSON work too, but are overwritten the next time the generator runs.

The cut carries the game's footsteps (run-cycle frames 0 and 6, four
samples with the game's pitch and level jitter, pre-mixed into
`trailer-clips/stems/footsteps-steam-trailer.wav`) and audible jumps. To
hear it without them, build a comparison cut:

```bash
python3 scripts/build-trailer-edit.py trailer/steam-trailer-nosteps.json M nosteps
```

## 3. Render

```bash
pnpm trailer:render trailer/steam-trailer.json
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
/tmp/otio/bin/python -c "import opentimelineio as o, sys; [print(f, o.adapters.read_from_file(f).duration()) for f in sys.argv[1:]]" trailer-clips/cuts/steam-trailer/steam-trailer.otio
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

- The low `thump` on the drops is synthesized by ffmpeg. The `swell` and
  `whoosh` synths stay available but are not in the current cut.
- Game over: the cactus impact sound (Pixabay, freesound_community).
- **Transitions** (every title card and the end flash): "Clean modern woosh
  transition 8" by Sdanezis
  (pixabay.com/sound-effects/film-special-effects-clean-modern-woosh-transition-8-607301/),
  Pixabay Content License. Auditioned alternatives kept in `trailer/assets/`:
  "Whoosh Cinematic" by DRAGON-STUDIO (376875) and "Clean modern woosh
  transition 1" by Sdanezis (607299).
- **End card hit:** "Cinematic Piano Hit" by Universfield
  (pixabay.com/sound-effects/musical-cinematic-piano-hit-567216/), Pixabay
  Content License, `trailer/assets/cinematic-piano-hit.mp3`.
- **Previous end card hit** (`mesohit` in the generator): the same as the Mesozoic Protocol trailer: the `boom`
  synth layered with "Cinematic dun"
  (pixabay.com/sound-effects/dun-283044/, Pixabay Content License), copied
  from Mesozoic Protocol's `public/audio/new-enemy.mp3` to
  `trailer/assets/cinematic-dun.mp3`.
- Not used: the shop sound (CC BY 3.0) and every rare-event sound.

The authoritative list for the game is `src/credits.ts`.

## Steam upload notes

- Steam: H.264 MP4, 1920x1080, high bitrate. The draft is CRF 16, 60 fps.
- The Steam page copy keeps rare sights unnamed and unshown; the trailer
  follows that and shows none of them.
