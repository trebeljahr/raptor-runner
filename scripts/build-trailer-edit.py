"""Generate the Steam trailer's edit file from the recorded clips' logs.

Reads each clip's events.json (coins, jumps, strikes, flower field) and
pose.json (run-cycle frame and height per frame) and writes an edit file for
scripts/render-trailer.mjs: pose-matched cuts, sound effects on the recorded
frames, title cards, the outfit parade and the end card.

    python3 scripts/build-trailer-edit.py trailer/steam-trailer.json M

The second argument picks the transition sound (M = Clean Modern Woosh 8).
The cut carries the game's footsteps (pre-mixed into one stem under
trailer-clips/stems/) and audible jumps; `nosteps` as a third argument
leaves both out, for comparison. `mesohit` swaps the end-card piano hit for
the Mesozoic trailer's boom + Cinematic dun.
"""
import json, os, subprocess, sys

ROOT = subprocess.run(["git", "rev-parse", "--git-common-dir"], capture_output=True, text=True,
                      cwd=os.path.dirname(os.path.abspath(__file__))).stdout.strip()
MAIN = os.path.dirname(os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ROOT)))
RAW = os.path.join(MAIN, "trailer-clips/raw")
OUT = sys.argv[1]
FPS = 60

_cache = {}
def events(clip):
    return json.load(open(f"{RAW}/{clip}.events.json"))
def pose(clip):
    if clip not in _cache:
        _cache[clip] = json.load(open(f"{RAW}/{clip}.pose.json"))["pose"]
    return _cache[clip]

cuts, sfx, report = [], [], []
t = 0.0
prev = None  # (clip, out) of the previous cut when it was a clip

def hold(p, i):
    """How many frames the pose at i has been shown (run cycle on the ground)."""
    n = 1
    while i - n >= 0 and p[i - n][0] == p[i][0] and p[i - n][1] == 0:
        n += 1
    return n

def match_in(clip, a, window=0.8):
    """Shift `a` so the new clip's previous frame equals the last frame shown:
    same run-cycle pose held for as long, or the same height in the same
    direction mid-jump. The cycle then continues across the cut."""
    if prev is None:
        return a
    pc, pout = prev
    pp = pose(pc)
    li = min(len(pp) - 1, round(pout * FPS) - 1)
    last = pp[li]
    rising = last[1] > pp[max(0, li - 1)][1]
    p = pose(clip)
    want = round(a * FPS)
    best, best_d = None, None
    for i in range(max(2, want - round(window * FPS)), min(len(p), want + round(window * FPS))):
        f, air = p[i - 1]
        # Score: exact pose and hold first, then distance from the wanted in-point.
        if last[1] == 0:
            if air != 0 or f != last[0]:
                continue
            miss = abs(hold(p, i - 1) - hold(pp, li))
            if miss > 1:
                continue
        else:
            miss = abs(air - last[1]) / 0.02
            if miss > 3 or (p[i - 1][1] > p[i - 2][1]) != rising:
                continue
        d = miss * 1000 + abs(i - want)
        if best_d is None or d < best_d:
            best, best_d = i, d
    if best is None:
        report.append(f"  no pose match for {clip} @ {a}")
        return a
    return round(best / FPS, 4)

def last_on_ground(clip, out, window=0.3):
    """Pull an out point back to a frame where the raptor is on the ground."""
    p = pose(clip)
    i = round(out * FPS) - 1
    for d in range(0, round(window * FPS)):
        if i - d >= 0 and p[i - d][1] == 0:
            return round((i - d + 1) / FPS, 4)
    return out

def clip(name, a, b, speed=1, note=None, match=True, ground_out=True, **kw):
    global t, prev
    dur = b - a
    if match:
        a = match_in(name, a)
    b = round(a + dur, 4)
    if ground_out:
        b = last_on_ground(name, b)
    c = {"clip": name, "in": a, "out": b}
    if speed != 1:
        c["speed"] = speed
    c.update(kw)
    if note:
        c["note"] = note
    cuts.append(c)
    start = t
    t = round(t + (b - a) / speed, 4)
    prev = (name, b)
    return start, a, b

def plate(text, plate_in, dur, note=None):
    """A title card: blurred night-sky footage with a glass panel over it."""
    global t, prev
    cuts.append({"clip": "08-night-plate", "in": plate_in, "out": round(plate_in + dur, 4),
                 "look": {"blur": 7, "dim": 0.92}, **({"note": note} if note else {})})
    titles.append({"style": "glass", "text": text, "start": round(t, 4), "duration": dur,
                   "fadeIn": 0.18, "fadeOut": 0.12})
    start = t
    t = round(t + dur, 4)
    prev = None
    return start

def at(cut_start, clip_in, clip_t, speed=1):
    return round(cut_start + (clip_t - clip_in) / speed, 3)

def sound(file=None, synth=None, when=0, gain=0, **kw):
    x = {"file": file} if file else {"synth": synth}
    x["at"] = round(when, 3)
    x["gainDb"] = gain
    x.update(kw)
    sfx.append(x)

COIN = "public/assets/coin-collect.mp3"
CHIME = "public/assets/coin-chain-end.mp3"
JUMP = "public/assets/jump.mp3"
STEPS = "nosteps" not in sys.argv[3:]  # in-game footsteps and audible jumps (default)
JUMP_BOOST = 6 if STEPS else 0
titles = []
END_SKY = "linear-gradient(to bottom, rgba(14,150,214,.45), rgba(14,150,214,0) 70%), linear-gradient(to right, rgb(161,235,238), rgb(199,241,228) 25%, rgb(162,236,233) 50%, rgb(69,217,244) 75%, rgb(23,213,247))"

def gameplay(name, start, a, b, speed=1, coin_gain=-13, jump_gain=-17):
    for e in events(name):
        if a <= e["t"] < b:
            when = at(start, a, e["t"], speed)
            if e["kind"] == "coins":
                sound(COIN, when=when, gain=coin_gain)
            elif e["kind"] == "jumps":
                sound(JUMP, when=when, gain=jump_gain + JUMP_BOOST)

# Transition sounds: (file, peak seconds into the file, in, duration, peak offset from the cut, gain dB)
VARIANTS = {
    "G1": ("trailer/assets/whoosh-cinematic.mp3", 0.875, 0.45, 0.75, -0.12, -9),
    "G2": ("trailer/assets/whoosh-cinematic.mp3", 0.875, 0.45, 0.75, 0.0, -9),
    "G3": ("trailer/assets/whoosh-cinematic.mp3", 0.875, 0.45, 0.75, 0.15, -9),
    "G4": ("trailer/assets/whoosh-cinematic.mp3", 0.875, 0.62, 0.5, 0.0, -9),
    "L": ("trailer/assets/clean-woosh-1.mp3", 0.53, 0.2, 0.85, 0.0, -14),
    "M": ("trailer/assets/clean-woosh-8.mp3", 0.17, 0.0, 0.9, 0.0, -14),
}
VARIANT = sys.argv[2] if len(sys.argv) > 2 else "M"

def whoosh(at_cut, gain=None):
    """The chosen transition sound, its peak placed relative to the cut."""
    f, peak, src_in, dur, off, g = VARIANTS[VARIANT]
    sound(f, when=at_cut + off - (peak - src_in), gain=g if gain is None else gain,
          **{"in": src_in}, duration=dur, fadeOut=0.25)

def card(cid, dur, note=None, lead_clip_fade=True):
    """Black title card with short fades, as in the Mesozoic cut, and a
    whoosh on the cut in."""
    global t, prev
    if lead_clip_fade and cuts and "clip" in cuts[-1]:
        cuts[-1]["fadeOut"] = 0.2
    cuts.append({"card": cid, "duration": dur, "fadeIn": 0.2, "fadeOut": 0.2, **({"note": note} if note else {})})
    whoosh(t)
    start = t
    t = round(t + dur, 4)
    prev = None
    return start

# --- Act 1: calm, music low ------------------------------------------------
s, a, b = clip("01-calm-midday", 0.4, 4.0, note="0:00 calm: bare raptor, midday, two jumps")
gameplay("01-calm-midday", s, a, b)
card("t-day", 1.5)
DROP1 = t
DROP2 = round(DROP1 + 28.5, 4)  # the track's second swell
# --- Act 2: first drop ------------------------------------------------------
s, a, b = clip("02-timelapse", 0.0, 8.0, match=False,
               note="DROP: time-lapse, a full day while the raptor runs an open desert; shooting stars at night")
sound(synth="thump", when=s, gain=-9, duration=0.9)
card("t-storm", 1.4)
s1, a1, b1 = clip("04-storm", 2.6, 8.9, note="one continuous take: the rain builds, lightning strikes at 7.4s")
for e in events("04-storm"):
    if e["kind"] == "strikes" and a1 <= e["t"] < b1:
        sound("public/assets/thunder.mp3", when=at(s1, a1, e["t"]) + 0.25, gain=-3)
gameplay("04-storm", s1, a1, b1)
s3, a3, b3 = clip("04-storm", 13.2, 18.2, note="the rain clears, the rainbow fades in")
gameplay("04-storm", s3, a3, b3)
sound("public/assets/rain.mp3", when=s1, gain=-9, duration=round(t - s1, 2), fadeIn=1.5, fadeOut=3.0)
card("t-flowers", 1.4)
# --- Act 3: the music's quiet passage ---------------------------------------
fe = events("03-flower-field")
off = [e["t"] for e in fe if e["kind"] == "field-off"][0]
s, a, b = clip("03-flower-field", round(DROP2 - 1.4 - t, 4) * 0 + round(off + 0.25 - (DROP2 - 1.4 - t), 4), round(off + 0.25, 4),
               ground_out=False, note="bare raptor: the flower field to its last flower, then straight to the next card")
coin_times = [e["t"] for e in fe if e["kind"] == "coins"]
field_coins = [ct for ct in coin_times if ct < off]
# The game's rising chain on a flower field (audio.ts playCoinCollect):
# each pickup within 1.5 s of the last plays 7% higher, capped at 1.7x;
# the diamond adds the chain-end chord on top of its own pickup.
streak, last_ct = 0, -9.0
for ct in field_coins:
    streak = streak if ct - last_ct <= 1.5 else 0
    rate = min(1.7, 1 + streak * 0.07)
    streak, last_ct = streak + 1, ct
    if a <= ct < b:
        sound(COIN, when=at(s, a, ct), gain=-9, rate=round(rate, 3))
        if ct == max(field_coins):
            sound(CHIME, when=at(s, a, ct), gain=-7)
card("t-cosmetics", round(DROP2 - t, 4), lead_clip_fade=False)
# --- Act 4: outfit parade: one take, only the outfit changes ----------------
# 8 named looks, then 22 more combinations; cut lengths shrink geometrically
# from 0.8 s to 6 frames so the parade speeds up into a blur of outfits.
names = ["classic", "cowboy", "top-hat", "wizard", "diadem", "sombrero", "pirate", "crown"]
clips_ = [f"{12 + i:02d}-parade-{n}" for i, n in enumerate(names)]
clips_ += [f"{21 + i:02d}-parade-combo-{i + 1:02d}" for i in range(22)]
# Even acceleration on a log scale: 0.55 s down to 5 frames over all looks.
FIRST, LAST = 0.55 * FPS, 5
n_ = len(clips_)
frames_ = [max(LAST, round(FIRST * (LAST / FIRST) ** (i / (n_ - 1)))) for i in range(n_)]
cf = 19  # clip frame: timed so the end card opens while the raptor is on the ground
cf0 = cf
parade_start = t
for i, (name, nf) in enumerate(zip(clips_, frames_)):
    cs, _, _ = clip(name, round(cf / FPS, 4), round((cf + nf) / FPS, 4), match=False, ground_out=False,
                    note="DROP 2: outfit parade, dressed from the first frame, cuts shrinking to 6 frames" if i == 0 else None)
    if i > 0:
        # The game's equip tap, climbing in pitch as the cuts speed up.
        sound(synth="tap", when=cs, gain=-4, duration=0.08, rate=round(1 + 0.6 * i / (len(clips_) - 1), 3))
    cf += nf
ct = cf / FPS
sound(synth="thump", when=parade_start, gain=-9, duration=0.9)
gameplay("11-parade-bare", parade_start, cf0 / FPS, ct, coin_gain=-12, jump_gain=-16)
# The last look for a few frames, then a hard cut to the end card on the
# Mesozoic end-card hit.
LAST_FRAMES = 8
s, a, b = clip("20-parade-monocle", round(ct, 4), round(ct + LAST_FRAMES / FPS, 4), match=False, ground_out=False,
               note="last look (monocle, bow tie), a few frames")
sound(synth="tap", when=s, gain=-4, duration=0.08, rate=1.6)
END = t
if "mesohit" in sys.argv[3:]:
    # The end-card hit from the Mesozoic Protocol trailer: its boom synth
    # layered with "Cinematic dun" (Pixabay), on the cut.
    sound(synth="boom", when=END, gain=0, duration=2.5)
    sound("trailer/assets/cinematic-dun.mp3", when=END, gain=-3)
else:
    # "Cinematic Piano Hit" (Universfield, Pixabay): a short swell, the hit
    # lands 0.37 s in, on the cut.
    sound("trailer/assets/cinematic-piano-hit.mp3", when=END - 0.37, gain=-2)
cuts.append({"card": "end-art", "duration": 4.8, "note": "end card: library hero, wordmark and Wishlist plate"})
t = round(t + 4.8, 4)
total = t
END_TEXT = {"logo": "trailer/assets/raptor-runner-logo.png", "lines": ["Wishlist on Steam", "store.steampowered.com/app/5035590"]}
if STEPS:
    # The game's footsteps (audio.ts playStep): on run-cycle frames 0 and 6
    # while on the ground, one of four samples (never the same twice in a
    # row), ±4 % playback rate, gain 0.75 ±12 %. Pre-mixed into one stem so
    # hundreds of steps cost one track.
    import random, subprocess
    rng = random.Random(7)
    STEP_FILES = ["public/assets/step-left.mp3", "public/assets/step-right.mp3",
                  "public/assets/step-a.mp3", "public/assets/step-b.mp3"]
    steps, at_t = [], 0.0
    for c in cuts:
        if "card" in c:
            at_t += c["duration"]
            continue
        p = pose(c["clip"])
        i0, i1 = round(c["in"] * FPS), round(c["out"] * FPS)
        for i in range(max(1, i0), min(i1, len(p))):
            f, air = p[i]
            if air == 0 and f in (0, 6) and p[i - 1][0] != f:
                steps.append(round(at_t + (i - i0) / FPS / c.get("speed", 1), 4))
        at_t += (c["out"] - c["in"]) / c.get("speed", 1)
    picks, last = [], -1
    for _ in steps:
        k = rng.choice([x for x in range(4) if x != last]); last = k; picks.append(k)
    graph, labels = [], []
    counts = [picks.count(k) for k in range(4)]
    for k in range(4):
        if counts[k]:
            graph.append(f"[{k}:a]aresample=48000,aformat=channel_layouts=stereo,asplit={counts[k]}" +
                         "".join(f"[s{k}_{j}]" for j in range(counts[k])))
    used = [0, 0, 0, 0]
    for n, (when, k) in enumerate(zip(steps, picks)):
        j = used[k]; used[k] += 1
        rate = 1 + (rng.random() - 0.5) * 0.08
        gain = 0.75 * (0.88 + rng.random() * 0.24)
        graph.append(f"[s{k}_{j}]asetrate={round(48000 * rate)},aresample=48000,volume={gain:.3f},"
                     f"adelay={round(when * 1000)}:all=1[t{n}]")
        labels.append(f"[t{n}]")
    graph.append("".join(labels) + f"amix=inputs={len(labels)}:normalize=0:duration=longest[out]")
    STEM = os.path.join(MAIN, "trailer-clips/stems/footsteps-steam-trailer.wav")
    import os
    os.makedirs(os.path.dirname(STEM), exist_ok=True)
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"]
    for f in STEP_FILES:
        cmd += ["-i", f]
    cmd += ["-filter_complex", ";".join(graph), "-map", "[out]", "-c:a", "pcm_s16le", STEM]
    subprocess.run(cmd, check=True)
    sound(STEM, when=0, gain=-15, name="footsteps (pre-mixed, game's playStep)")
    print(f"  footsteps: {len(steps)} steps pre-mixed into {STEM}")

edit = {
    "name": "steam-trailer" if STEPS else "steam-trailer-nosteps",
    "notes": (
        "Trailer 1, draft 12. Calm midday run (two jumps) with the music low; black title cards as in "
        "the Mesozoic cut, each with Clean Modern Woosh 8; the drop on the track's own swell: a "
        "time-lapse of a full day with shooting stars while the raptor runs an open desert; one storm, "
        "one take from first drops to the strike, then the rainbow; the bare raptor through a flower "
        "field in the music's quiet passage; the outfit parade on the second swell (30 combinations "
        "of one take, cuts shrinking to 5 frames, the equip tap rising in pitch); a few frames of the "
        "last outfit, then a hard cut to the end card on a cinematic piano hit. In-game "
        "footsteps and jumps throughout. "
        "Gameplay cuts are matched on the raptor's pose. No rare events: the Steam copy leaves those "
        "to be found."
    ),
    "fps": 60, "width": 1920, "height": 1080,
    "clips": "trailer-clips/raw",
    "master": {"loudness": -14, "truePeak": -1.5},
    "music": {
        "name": "L'Etoile danse (Pt. 1) (Meydän, CC BY 4.0)",
        "file": "public/assets/music2.mp3",
        "credit": "Music: \"L'Etoile danse (Pt. 1)\" by Meydän (freemusicarchive.org), licensed under CC BY 4.0, https://creativecommons.org/licenses/by/4.0/",
        "in": round(36.9 - DROP1, 3),
        "gainDb": -1, "fadeIn": 0.5, "fadeOut": 3.0,
        "automation": [[0, -10], [round(DROP1 - 0.6, 2), -8], [round(DROP1 - 0.25, 2), -13], [round(DROP1, 2), 0],
                       [round(DROP1 + 19.5, 2), 0], [round(DROP1 + 20.2, 2), 2], [round(DROP2 - 0.6, 2), 2], [round(DROP2 - 0.25, 2), -8],
                       [round(DROP2, 2), 0], [round(END, 2), 0], [round(END + 0.5, 2), -2], [round(total, 2), -4]],
    },
    "cuts": cuts,
    "titles": titles,
    "cards": {
        "t-day": {"kind": "intertitle", "text": "Watch the day turn\nas you run"},
        "t-storm": {"kind": "intertitle", "text": "Storms come and go"},
        "t-flowers": {"kind": "intertitle", "text": "Stop and smell\nthe roses"},
        "t-cosmetics": {"kind": "intertitle", "text": "Dress up\nyour raptor"},
        "end-art": {"kind": "art", "background": "trailer/assets/library-hero.png", "fit": "width",
                    "extend": END_SKY, **END_TEXT},
    },
    "sfx": sorted(sfx, key=lambda x: x["at"]),
}
json.dump(edit, open(OUT, "w"), indent=2, ensure_ascii=False)
print(f"total {total:.2f}s  drop1 {DROP1}  drop2 {DROP2}  end {END}  music in {edit['music']['in']}")
print("\n".join(report) or "  all gameplay cuts pose-matched")
