import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fcpxml,
  ffmpegArgs,
  gainExpr,
  normalizeEdit,
  otio,
  otioJson,
  packLanes,
  synthArgs,
} from "./trailer-timeline.mjs";

const media = {
  clipFile: (slug) => `/clips/${slug}.mp4`,
  clipFrames: () => 360,
  cardFile: (id) => `/out/cards/${id}.png`,
  titleFile: (i) => `/out/cards/title-${i + 1}.png`,
  musicFile: "/out/media/music.mp3",
  musicSeconds: 120,
};

const edit = {
  name: "test-cut",
  fps: 60,
  music: { file: "music.mp3", in: 10, fadeOut: 1 },
  cuts: [
    { clip: "a", in: 0.5, out: 2.5 },
    { clip: "b", in: 1, out: 3, speed: 0.5 },
    { card: "end", duration: 2, fadeIn: 0.25 },
  ],
  titles: [{ text: "Hello", start: 1, duration: 1.5 }],
  cards: { end: { kind: "end" } },
};

test("cuts are laid end to end in whole frames", () => {
  const tl = normalizeEdit(edit, media);
  assert.deepEqual(
    tl.video.map((v) => [v.name, v.offset, v.frames]),
    [
      ["a", 0, 120],
      ["b", 120, 240],
      ["end", 360, 120],
    ],
  );
  assert.equal(tl.frames, 480);
  assert.equal(tl.video[1].inFrame, 60);
  assert.equal(tl.video[1].sourceFrames, 120);
  assert.equal(tl.overlays[0].offset, 60);
  assert.equal(tl.audio[0].frames, 480);
});

test("rejects an out point past the clip's end", () => {
  const bad = { ...edit, cuts: [{ clip: "a", in: 0, out: 7 }] };
  assert.throws(() => normalizeEdit(bad, media), /past the clip's end/);
});

test("rejects a title that runs past the cut", () => {
  const bad = { ...edit, titles: [{ text: "Late", start: 7.5, duration: 1 }] };
  assert.throws(() => normalizeEdit(bad, media), /outside/);
});

test("ffmpeg graph concatenates every cut and caps the frame count", () => {
  const args = ffmpegArgs(normalizeEdit(edit, media), "/out/x.mp4");
  const graph = args[args.indexOf("-filter_complex") + 1];
  assert.match(graph, /concat=n=3:v=1:a=0/);
  assert.match(graph, /setpts=\(PTS-STARTPTS\)\/0\.5/);
  // Music starts 10 s into the track: the input is seeked, not atrimmed.
  assert.equal(args[args.indexOf("-ss") + 1], "10.000000");
  assert.match(graph, /atrim=start=0:duration=8\.000000/);
  assert.equal(args[args.indexOf("-frames:v") + 1], "480");
});

test("FCPXML puts clips on the spine and titles and music on connected lanes", () => {
  const x = fcpxml(normalizeEdit(edit, media));
  assert.match(x, /<fcpxml version="1\.8">/);
  assert.match(
    x,
    /<asset-clip ref="r\d+" name="a" offset="0s" start="30\/60s" duration="120\/60s"/,
  );
  // Half speed: start sits in the retimed clip's own time.
  assert.match(x, /name="b" offset="120\/60s" start="120\/60s" duration="240\/60s"/);
  assert.match(x, /<timept time="720\/60s" value="360\/60s"/);
  assert.match(x, /<clip lane="1" name="title-1" offset="90\/60s" duration="90\/60s"/);
  assert.match(x, /<clip name="end" offset="360\/60s" duration="120\/60s"/);
  assert.match(x, /lane="-1" name="music" offset="30\/60s" start="600\/60s" duration="480\/60s"/);
});

test("OTIO has one video track per layer and an audio track", () => {
  const o = otio(normalizeEdit(edit, media));
  const [v1, v2, a1] = o.tracks.children;
  assert.equal(v1.children.length, 3);
  assert.equal(v1.children[1].effects[0].time_scalar, 0.5);
  assert.deepEqual(
    v2.children.map((c) => [c.OTIO_SCHEMA, c.source_range.duration.value]),
    [
      ["Gap.1", 60],
      ["Clip.2", 90],
    ],
  );
  assert.equal(a1.kind, "Audio");
  assert.equal(a1.children[0].source_range.start_time.value, 600);
});

test("OTIO JSON writes rates and times as doubles", () => {
  const json = otioJson(normalizeEdit(edit, media));
  assert.match(json, /"rate": 60\.0,/);
  assert.match(json, /"value": 600\.0\n/);
  assert.match(json, /"time_scalar": 0\.5,/);
  assert.doesNotMatch(json, /"(rate|value)": \d+[,\n]/);
});

const withSfx = {
  ...edit,
  master: { loudness: -14 },
  cuts: [{ ...edit.cuts[0], look: { blur: 10, dim: 0.5 } }, ...edit.cuts.slice(1)],
  sfx: [
    { file: "a.mp3", at: 1 },
    { synth: "boom", at: 1.5, duration: 2, gainDb: -3 },
    { file: "a.mp3", at: 7.9 },
  ],
};
const sfxMedia = { ...media, sfxFile: (i) => `/out/media/sfx-${i}.wav`, sfxSeconds: () => 1 };

test("effects land at their time, clipped to the cut's end", () => {
  const tl = normalizeEdit(withSfx, sfxMedia);
  const sfx = tl.audio.filter((a) => a.role === "sfx");
  assert.deepEqual(
    sfx.map((a) => [a.offset, a.frames]),
    [
      [60, 60],
      [90, 60],
      [474, 6],
    ],
  );
});

test("overlapping effects get their own lanes", () => {
  assert.deepEqual(
    packLanes([
      { offset: 0, frames: 60 },
      { offset: 30, frames: 60 },
      { offset: 60, frames: 10 },
    ]),
    [0, 1, 0],
  );
});

test("gain curve holds before the first point and after the last", () => {
  const expr = gainExpr(
    [
      [0, -12],
      [2, 0],
    ],
    -2,
  );
  // Evaluate the ffmpeg expression in JS: if(c,a,b) → iff(c,a,b).
  const fn = Function("t", "lt", "pow", "iff", `return ${expr.replace(/if\(/g, "iff(")}`);
  const evalAt = (t) =>
    fn(
      t,
      (a, b) => a < b,
      Math.pow,
      (c, a, b) => (c ? a : b),
    );
  const db = (t) => 20 * Math.log10(evalAt(t));
  assert.ok(Math.abs(db(-1) - -14) < 1e-9);
  assert.ok(Math.abs(db(1) - -8) < 1e-9);
  assert.ok(Math.abs(db(5) - -2) < 1e-9);
});

test("audio-only render mixes every track with a static master gain", () => {
  const tl = normalizeEdit(withSfx, sfxMedia);
  const args = ffmpegArgs(tl, "/out/mix.wav", { audioOnly: true });
  const graph = args[args.indexOf("-filter_complex") + 1];
  assert.doesNotMatch(graph, /concat|overlay/);
  assert.match(graph, /amix=inputs=4:normalize=0/);
  assert.match(graph, /adelay=1500:all=1/);
  const full = ffmpegArgs(tl, "/out/x.mp4", { masterGainDb: 2.5 });
  const fullGraph = full[full.indexOf("-filter_complex") + 1];
  assert.match(fullGraph, /volume=2\.50dB,alimiter/);
  assert.match(fullGraph, /gblur=sigma=10,colorchannelmixer=rr=0\.5/);
});

test("effects export to their own lanes in both timelines", () => {
  const tl = normalizeEdit(withSfx, sfxMedia);
  assert.match(fcpxml(tl), /lane="-3" name="boom"/);
  const names = otio(tl).tracks.children.map((t) => t.name);
  assert.deepEqual(names.slice(-3), ["A1 music", "A2 sfx", "A3 sfx"]);
});

test("synths name a known recipe", () => {
  assert.match(synthArgs("riser", 2, "/x.wav").join(" "), /anoisesrc/);
  assert.throws(() => synthArgs("laser", 1, "/x.wav"), /unknown synth/);
});
