// Trailer edit decisions → frame-exact timeline → ffmpeg graph, FCPXML, OTIO.
//
// The edit file (trailer/*.json, see trailer/README.md) names clips by slug and
// cuts them in seconds. normalizeEdit() turns it into a timeline counted in
// whole frames, so the ffmpeg draft and the two NLE exports agree to the frame.
// Everything here is pure: the CLI (scripts/render-trailer.mjs) resolves
// files, renders the card PNGs and runs ffmpeg.

/**
 * @typedef {{ blur: number, dim: number }} Look  blur: gaussian sigma in px; dim: brightness
 *   multiplier (1 = unchanged)
 * @typedef {{ kind: "clip", name: string, file: string, offset: number, frames: number,
 *   inFrame: number, speed: number, sourceFrames: number, fileFrames: number, fadeIn: number,
 *   fadeOut: number, look: Look | null }} ClipItem
 * @typedef {{ kind: "still", name: string, file: string, offset: number, frames: number,
 *   fadeIn: number, fadeOut: number, look: Look | null }} StillItem
 * @typedef {{ name: string, file: string, offset: number, frames: number, fadeIn: number,
 *   fadeOut: number }} Overlay
 * @typedef {{ role: "music" | "sfx", name: string, file: string, offset: number, frames: number,
 *   inSeconds: number, sourceSeconds: number, gainDb: number, fadeIn: number, fadeOut: number,
 *   automation: [number, number][] }} AudioItem
 *   automation: [seconds into the cut, dB on top of gainDb], linear between points
 * @typedef {{ name: string, fps: number, width: number, height: number, frames: number,
 *   video: (ClipItem | StillItem)[], overlays: Overlay[], audio: AudioItem[],
 *   master: { loudness: number, truePeak: number } | null }} Timeline
 */

const round = (x) => Math.round(x);

/**
 * @param {any} edit       parsed edit file
 * @param {{ clipFile: (slug: string) => string, clipFrames: (slug: string) => number,
 *   cardFile: (id: string) => string, titleFile: (index: number) => string,
 *   musicFile?: string, musicSeconds?: number, sfxFile?: (index: number) => string,
 *   sfxSeconds?: (index: number) => number }} media
 * @returns {Timeline}
 */
export function normalizeEdit(edit, media) {
  const fps = edit.fps ?? 60;
  const f = (seconds) => round(seconds * fps);
  const look = (cut) => (cut.look ? { blur: cut.look.blur ?? 0, dim: cut.look.dim ?? 1 } : null);
  const video = [];
  let offset = 0;
  for (const [i, cut] of edit.cuts.entries()) {
    const where = `cuts[${i}]`;
    if (cut.card) {
      if (!edit.cards?.[cut.card]) throw new Error(`${where}: unknown card "${cut.card}"`);
      const frames = f(cut.duration);
      if (frames <= 0) throw new Error(`${where}: duration must be > 0`);
      video.push({
        kind: "still",
        name: cut.card,
        file: media.cardFile(cut.card),
        offset,
        frames,
        fadeIn: f(cut.fadeIn ?? 0),
        fadeOut: f(cut.fadeOut ?? 0),
        look: look(cut),
      });
      offset += frames;
      continue;
    }
    const speed = cut.speed ?? 1;
    if (!(speed > 0)) throw new Error(`${where}: speed must be > 0`);
    if (!(cut.out > cut.in))
      throw new Error(`${where}: out (${cut.out}) must be after in (${cut.in})`);
    const inFrame = f(cut.in);
    const sourceFrames = f(cut.out) - inFrame;
    const available = media.clipFrames(cut.clip);
    if (f(cut.out) > available) {
      throw new Error(
        `${where}: ${cut.clip} out ${cut.out}s is past the clip's end (${(available / fps).toFixed(2)}s)`,
      );
    }
    const frames = round(sourceFrames / speed);
    video.push({
      kind: "clip",
      name: cut.clip,
      file: media.clipFile(cut.clip),
      offset,
      frames,
      inFrame,
      speed,
      sourceFrames,
      fileFrames: available,
      fadeIn: f(cut.fadeIn ?? 0),
      fadeOut: f(cut.fadeOut ?? 0),
      look: look(cut),
    });
    offset += frames;
  }
  const total = offset;

  const overlays = (edit.titles ?? []).map((t, i) => {
    const start = f(t.start);
    const frames = f(t.duration);
    if (start < 0 || start + frames > total) {
      throw new Error(`titles[${i}] "${t.text}" runs outside the ${(total / fps).toFixed(2)}s cut`);
    }
    return {
      name: `title-${i + 1}`,
      file: media.titleFile(i),
      offset: start,
      frames,
      fadeIn: f(t.fadeIn ?? t.fade ?? 0.25),
      fadeOut: f(t.fadeOut ?? t.fade ?? 0.25),
      // { x, y } in px: the overlay opens as a growing circle from there
      // over its whole duration (draft-only, like fades).
      reveal: t.reveal ? { x: t.reveal.x, y: t.reveal.y } : null,
    };
  });

  const audio = [];
  if (edit.music) {
    const m = edit.music;
    const inSeconds = m.in ?? 0;
    if (media.musicSeconds !== undefined && inSeconds + total / fps > media.musicSeconds) {
      throw new Error(`music: in ${inSeconds}s + cut length runs past the track's end`);
    }
    audio.push({
      role: "music",
      name: m.name ?? "music",
      file: media.musicFile,
      offset: 0,
      frames: total,
      inSeconds,
      sourceSeconds: media.musicSeconds ?? inSeconds + total / fps,
      gainDb: m.gainDb ?? 0,
      fadeIn: m.fadeIn ?? 0,
      fadeOut: m.fadeOut ?? 0,
      automation: [...(m.automation ?? [])].sort((a, b) => a[0] - b[0]),
      rate: 1,
    });
  }
  for (const [i, x] of (edit.sfx ?? []).entries()) {
    const offset = f(x.at);
    if (offset < 0 || offset >= total) throw new Error(`sfx[${i}] at ${x.at}s is outside the cut`);
    const sourceSeconds = media.sfxSeconds(i);
    const inSeconds = x.in ?? 0;
    // `rate` plays faster and higher, like Web Audio's playbackRate.
    const rate = x.rate ?? 1;
    const seconds = Math.min(
      x.duration ?? (sourceSeconds - inSeconds) / rate,
      (sourceSeconds - inSeconds) / rate,
    );
    audio.push({
      role: "sfx",
      name: x.name ?? x.synth ?? x.file.split("/").pop(),
      file: media.sfxFile(i),
      offset,
      frames: Math.min(f(seconds), total - offset),
      inSeconds,
      rate,
      sourceSeconds,
      gainDb: x.gainDb ?? 0,
      fadeIn: x.fadeIn ?? 0,
      fadeOut: x.fadeOut ?? 0,
      automation: [],
    });
  }

  return {
    name: edit.name,
    fps,
    width: edit.width ?? 1920,
    height: edit.height ?? 1080,
    frames: total,
    video,
    overlays,
    audio,
    master: edit.master
      ? { loudness: edit.master.loudness ?? -14, truePeak: edit.master.truePeak ?? -1.5 }
      : null,
  };
}

/**
 * Gain curve as an ffmpeg expression in linear amplitude: dB points joined
 * linearly, held flat before the first and after the last.
 * @param {[number, number][]} points
 */
export function gainExpr(points, baseDb = 0) {
  if (points.length === 0) return `${(10 ** (baseDb / 20)).toFixed(6)}`;
  let db = `${points.at(-1)[1]}`;
  for (let i = points.length - 2; i >= 0; i--) {
    const [t0, g0] = points[i];
    const [t1, g1] = points[i + 1];
    db = `if(lt(t,${t1}),${g0}+(${g1 - g0})*(t-${t0})/${t1 - t0},${db})`;
  }
  db = `if(lt(t,${points[0][0]}),${points[0][1]},${db})`;
  return `pow(10,(${baseDb}+${db})/20)`;
}

/** Spread items over as few lanes as possible so none overlap within a lane. */
export function packLanes(items) {
  const ends = [];
  return items.map((it) => {
    let lane = ends.findIndex((end) => end <= it.offset);
    if (lane < 0) lane = ends.push(0) - 1;
    ends[lane] = it.offset + it.frames;
    return lane;
  });
}

// Noise bands from dark to airy. Layering them under smooth envelopes
// moves the sound up or down in pitch without filter sweeps, which click
// in ffmpeg when their cutoff is stepped.
const BANDS = [
  ["lowpass=f=450", 0.9],
  ["bandpass=f=1100:width_type=q:w=0.9", 0.75],
  ["bandpass=f=2800:width_type=q:w=0.9", 0.5],
  ["highpass=f=6000", 0.32],
];

/** Pink-noise bands, band i shaped by `env(i)` (an ffmpeg expression in t). */
function bands(d, env) {
  const parts = BANDS.map(
    ([filter, gain], i) =>
      `anoisesrc=color=pink:duration=${d}:amplitude=${gain}:seed=${17 + i},${filter},` +
      `volume='${env(i)}':eval=frame[b${i}]`,
  );
  const labels = BANDS.map((_, i) => `[b${i}]`).join("");
  return `${parts.join(";")};${labels}amix=inputs=${BANDS.length}:normalize=0`;
}

/**
 * ffmpeg argv that synthesizes a trailer sound effect to a 48 kHz WAV.
 * swell: air rising in pitch and level, for the run-up into a drop.
 * whoosh: a soft air pass that pans left to right, for a cut to a card.
 * thump: a short, round low hit under a drop or the end card.
 * riser / boom: the harder sci-fi pair from the Mesozoic Protocol cut.
 */
export function synthArgs(kind, seconds, outFile) {
  const d = seconds;
  const graphs = {
    swell: `${bands(d, (i) => {
      // Each brighter band enters later; all fade out in the last frames.
      const o = [0, 0.3, 0.55, 0.72][i];
      return `pow(clip((t/${d}-${o})/${1 - o},0,1),1.7)*(1-pow(t/${d},30))`;
    })},aformat=channel_layouts=stereo,extrastereo=m=1.5`,
    whoosh:
      `${bands(d, (i) => {
        // A bell per band, centres staggered so the pass rises then falls.
        const c = [0.42, 0.48, 0.54, 0.58][i];
        return `exp(-pow((t/${d}-${c})/0.2,2))*pow(sin(PI*t/${d}),2)`;
      })},aformat=channel_layouts=stereo,` +
      `aeval='val(0)*(1.15-0.9*t/${d})|val(1)*(0.25+0.9*t/${d})':c=stereo`,
    // Audition candidates for card transitions.
    impact:
      `aevalsrc='0.9*sin(2*PI*(64*t-10*t*t))*exp(-4.5*t)':d=${d}:s=48000[s];` +
      `anoisesrc=color=pink:duration=${d}:amplitude=0.9:seed=9,highpass=f=1800,` +
      "volume='exp(-28*t)':eval=frame[n];" +
      "[s][n]amix=inputs=2:normalize=0,aformat=channel_layouts=stereo",
    swipe:
      `anoisesrc=color=white:duration=${d}:amplitude=0.6:seed=4,bandpass=f=4200:width_type=q:w=0.8,` +
      `volume='min(1,t*40)*exp(-9*t)':eval=frame,aformat=channel_layouts=stereo,` +
      `aeval='val(0)*(1.2-1.2*t/${d})|val(1)*(0.2+1.0*t/${d})':c=stereo`,
    sand:
      `anoisesrc=color=brown:duration=${d}:amplitude=0.9:seed=13,bandpass=f=900:width_type=q:w=0.7,` +
      `tremolo=f=38:d=0.55,volume='pow(sin(PI*min(1,t/${d})),1.4)*exp(-1.5*t)':eval=frame,` +
      "aformat=channel_layouts=stereo,extrastereo=m=1.8",
    // The game's menu/equip tap (audio.ts playMenuTap): a 900→620 Hz sine
    // body plus a 2.1 kHz triangle tick, under 60 ms.
    tap:
      `aevalsrc='0.8*sin(2*PI*900*(0.05/log(620/900))*(pow(620/900,t/0.05)-1))*exp(-90*t)*min(1,t*250)` +
      `+0.5*(2/PI)*asin(sin(2*PI*2100*t))*exp(-250*t)*min(1,t*500)':d=${d}:s=48000,` +
      "aformat=channel_layouts=stereo",
    thump:
      `aevalsrc='0.9*sin(2*PI*(72*t-14*t*t))*exp(-7*t)*min(1,t*400)':d=${d}:s=48000,` +
      "lowpass=f=240,aformat=channel_layouts=stereo",
    riser:
      `anoisesrc=color=pink:duration=${d}:amplitude=0.6:seed=7,highpass=f=500,` +
      `volume='pow(t/${d},2.2)':eval=frame[n];` +
      `aevalsrc='0.22*sin(2*PI*(180*t+${(700 / (2 * d)).toFixed(4)}*t*t))*pow(t/${d},1.6)':d=${d}:s=48000[s];` +
      "[n][s]amix=inputs=2:normalize=0,aformat=channel_layouts=stereo",
    // Same as the Mesozoic Protocol trailer: 48 Hz sub hit with a short crack.
    boom:
      `aevalsrc='0.9*sin(2*PI*48*t)*exp(-3*t)+0.45*(random(0)*2-1)*exp(-140*t)':d=${d}:s=48000,lowpass=f=5000[a];` +
      `aevalsrc='0.5*(random(1)*2-1)*exp(-5*t)':d=${d}:s=48000,lowpass=f=180[b];` +
      "[a][b]amix=inputs=2:normalize=0,aformat=channel_layouts=stereo",
  };
  if (!graphs[kind]) throw new Error(`unknown synth "${kind}" (${Object.keys(graphs).join(", ")})`);
  return [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-filter_complex",
    `${graphs[kind]},aresample=48000[out]`,
    "-map",
    "[out]",
    "-c:a",
    "pcm_s16le",
    outFile,
  ];
}

// ---------------------------------------------------------------------------
// ffmpeg
// ---------------------------------------------------------------------------

/**
 * geq alpha mask: a circle from (x, y) that grows (ease-out) to cover the
 * frame over the overlay's duration, with a soft 36 px edge.
 */
export function revealMask(o, W, H, fps) {
  const { x, y } = o.reveal;
  const far = Math.ceil(
    Math.max(
      Math.hypot(x, y),
      Math.hypot(W - x, y),
      Math.hypot(x, H - y),
      Math.hypot(W - x, H - y),
    ),
  );
  // Fully open a few frames before the overlay ends, so the handoff is clean.
  const d = ((o.frames / fps) * 0.85).toFixed(6);
  const r = `(${far + 40})*(1-pow(1-min(1,T/${d}),3))`;
  const a = `255*clip((${r}-hypot(X-${x},Y-${y}))/36,0,1)*alpha(X,Y)/255`;
  return `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${a}'`;
}

/**
 * ffmpeg argv that renders the timeline to an H.264 + AAC MP4.
 *
 * With `audioOnly`, renders just the mix to a WAV. The CLI measures that
 * WAV's loudness and passes the difference to the target as `masterGainDb`:
 * one static gain plus a peak limiter keeps the cut's quiet-to-loud ramp,
 * where a one-pass loudnorm would level it out.
 */
export function ffmpegArgs(tl, outFile, { audioOnly = false, masterGainDb = 0 } = {}) {
  const { fps, width: W, height: H } = tl;
  const sec = (frames) => (frames / fps).toFixed(6);
  const inputs = [];
  const graph = [];
  const addInput = (args) => {
    inputs.push(...args);
    return inputs.filter((a) => a === "-i").length - 1;
  };

  const fades = (item, alpha = "") => {
    const out = [];
    if (item.fadeIn > 0) out.push(`fade=t=in:st=0:d=${sec(item.fadeIn)}${alpha}`);
    if (item.fadeOut > 0) {
      out.push(`fade=t=out:st=${sec(item.frames - item.fadeOut)}:d=${sec(item.fadeOut)}${alpha}`);
    }
    return out;
  };

  const labels = (audioOnly ? [] : tl.video).map((item, i) => {
    const label = `v${i}`;
    let chain;
    if (item.kind === "clip") {
      const n = addInput(["-i", item.file]);
      chain = [
        `[${n}:v]trim=start_frame=${item.inFrame}:end_frame=${item.inFrame + item.sourceFrames}`,
        `setpts=(PTS-STARTPTS)/${item.speed}`,
        `fps=${fps}`,
      ];
    } else {
      const n = addInput(["-loop", "1", "-framerate", String(fps), "-i", item.file]);
      chain = [`[${n}:v]fps=${fps}`];
    }
    chain.push(
      `trim=end_frame=${item.frames}`,
      "setpts=PTS-STARTPTS",
      `scale=${W}:${H}:flags=lanczos`,
      "setsar=1",
      ...(item.look?.blur ? [`gblur=sigma=${item.look.blur}`] : []),
      ...(item.look && item.look.dim !== 1
        ? [`colorchannelmixer=rr=${item.look.dim}:gg=${item.look.dim}:bb=${item.look.dim}`]
        : []),
      "format=yuv420p",
      ...fades(item),
    );
    graph.push(`${chain.join(",")}[${label}]`);
    return `[${label}]`;
  });
  if (!audioOnly) graph.push(`${labels.join("")}concat=n=${labels.length}:v=1:a=0[base0]`);

  let base = "base0";
  for (const [i, o] of (audioOnly ? [] : tl.overlays).entries()) {
    const n = addInput(["-loop", "1", "-framerate", String(fps), "-i", o.file]);
    graph.push(
      [
        // One spare frame: overlay drops an input's final frame at EOF, which
        // showed as a one-frame gap before the next cut and on the last frame.
        `[${n}:v]trim=end_frame=${o.frames + 1}`,
        "setpts=PTS-STARTPTS",
        "format=rgba",
        ...(o.reveal ? [revealMask(o, W, H, fps)] : []),
        ...fades(o, ":alpha=1"),
        `setpts=PTS+${sec(o.offset)}/TB`,
      ].join(",") + `[o${i}]`,
    );
    const next = `base${i + 1}`;
    graph.push(
      `[${base}][o${i}]overlay=0:0:eof_action=pass:enable='between(t,${sec(o.offset)},${sec(o.offset + o.frames - 0.5)})'[${next}]`,
    );
    base = next;
  }
  if (!audioOnly) graph.push(`[${base}]format=yuv420p[vout]`);

  const maps = audioOnly ? [] : ["-map", "[vout]"];
  if (tl.audio.length) {
    const dur = (tl.frames / fps).toFixed(6);
    const tracks = tl.audio.map((a, i) => {
      // Seek the input rather than atrim's start: a start-trimmed stream
      // followed by adelay plays at the wrong time (or not at all) once a
      // file is used more than once in the mix.
      const seek = a.inSeconds > 0 ? ["-ss", a.inSeconds.toFixed(6)] : [];
      const n = addInput([...seek, "-i", a.file]);
      const len = a.frames / fps;
      const rate = a.rate ?? 1;
      const chain = [
        `[${n}:a]atrim=start=0:duration=${(len * rate).toFixed(6)}`,
        "asetpts=PTS-STARTPTS",
        "aresample=48000",
        ...(rate !== 1 ? [`asetrate=${Math.round(48000 * rate)}`, "aresample=48000"] : []),
        "aformat=channel_layouts=stereo",
        `volume='${gainExpr(a.automation, a.gainDb)}':eval=frame`,
      ];
      if (a.fadeIn > 0) chain.push(`afade=t=in:st=0:d=${a.fadeIn}`);
      if (a.fadeOut > 0) {
        chain.push(`afade=t=out:st=${Math.max(0, len - a.fadeOut).toFixed(6)}:d=${a.fadeOut}`);
      }
      if (a.offset > 0) {
        const ms = Math.round((a.offset / fps) * 1000);
        chain.push(`adelay=${ms}:all=1`);
      }
      graph.push(`${chain.join(",")}[a${i}]`);
      return `[a${i}]`;
    });
    // Pad every track to the cut so amix's length is the cut's length.
    const padded = tracks.map((label, i) => {
      graph.push(`${label}apad=whole_dur=${dur},atrim=duration=${dur}[p${i}]`);
      return `[p${i}]`;
    });
    const master = tl.master
      ? `,volume=${masterGainDb.toFixed(2)}dB,` +
        `alimiter=limit=${(10 ** (tl.master.truePeak / 20)).toFixed(4)}:attack=2:release=60:level=false`
      : "";
    graph.push(
      `${padded.join("")}amix=inputs=${padded.length}:normalize=0:duration=longest${master},atrim=duration=${dur}[aout]`,
    );
    maps.push("-map", "[aout]");
  }

  if (audioOnly) {
    return [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      ...inputs,
      "-filter_complex",
      graph.join(";\n"),
      ...maps,
      "-c:a",
      "pcm_s16le",
      outFile,
    ];
  }

  return [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-stats",
    ...inputs,
    "-filter_complex",
    graph.join(";\n"),
    ...maps,
    "-frames:v",
    String(tl.frames),
    "-r",
    String(fps),
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "16",
    "-profile:v",
    "high",
    "-pix_fmt",
    "yuv420p",
    ...(tl.audio.length ? ["-c:a", "aac", "-b:a", "320k", "-ar", "48000"] : []),
    "-movflags",
    "+faststart",
    outFile,
  ];
}

// ---------------------------------------------------------------------------
// FCPXML 1.8 (File → Import → Timeline in DaVinci Resolve, free or Studio)
// ---------------------------------------------------------------------------

const xml = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const fileUrl = (path) => `file://${encodeURI(path)}`;

/**
 * One spine of clips and cards on V1, titles connected on lane 1 (V2), music
 * on lane -1 (A1) and effects below it. Clip sources stay at their full length
 * so every cut can be re-trimmed in Resolve. Fades, blur, gain automation and
 * the loudness master are draft-only: redo them in Resolve.
 * @param {Timeline} tl
 */
export function fcpxml(tl) {
  const { fps } = tl;
  const t = (frames) => (frames === 0 ? "0s" : `${frames}/${fps}s`);
  const assets = new Map();
  const assetFor = (file, attrs) => {
    if (!assets.has(file)) assets.set(file, { id: `r${assets.size + 2}`, file, attrs });
    return assets.get(file).id;
  };
  const baseName = (p) => p.split("/").pop();

  // Spine element covering frame `at`, and the local time of `at` inside it.
  const parentAt = (at) => {
    const i = tl.video.findIndex((v) => at >= v.offset && at < v.offset + v.frames);
    return { index: i, local: (v) => localStart(v) + (at - v.offset) };
  };
  const localStart = (v) => (v.kind === "clip" ? round(v.inFrame / v.speed) : 0);

  const connected = tl.video.map(() => []);
  const titleLanes = packLanes(tl.overlays);
  for (const [i, o] of tl.overlays.entries()) {
    const id = assetFor(o.file, `hasVideo="1" format="r1" duration="0s"`);
    const { index, local } = parentAt(o.offset);
    connected[index].push(
      `<clip lane="${1 + titleLanes[i]}" name="${xml(o.name)}" offset="${t(local(tl.video[index]))}" duration="${t(o.frames)}" format="r1" tcFormat="NDF"><video ref="${id}" offset="0s" duration="${t(o.frames)}"/></clip>`,
    );
  }
  // Music on lane -1 (A1), effects packed onto lanes -2, -3, … (A2, A3, …).
  const sfx = tl.audio.filter((a) => a.role === "sfx");
  const sfxLanes = packLanes(sfx);
  for (const a of tl.audio) {
    const total = round(a.sourceSeconds * fps);
    const id = assetFor(
      a.file,
      `hasAudio="1" audioSources="1" audioChannels="2" audioRate="48000" duration="${t(total)}"`,
    );
    const lane = a.role === "music" ? -1 : -2 - sfxLanes[sfx.indexOf(a)];
    const { index, local } = parentAt(a.offset);
    connected[index].push(
      `<asset-clip ref="${id}" lane="${lane}" name="${xml(a.name)}" offset="${t(local(tl.video[index]))}" start="${t(round(a.inSeconds * fps))}" duration="${t(a.frames)}" audioRole="${a.role === "music" ? "music" : "effects"}"/>`,
    );
  }

  const spine = tl.video.map((v, i) => {
    const kids = connected[i].map((k) => `            ${k}`).join("\n");
    if (v.kind === "still") {
      const id = assetFor(v.file, `hasVideo="1" format="r1" duration="0s"`);
      // Stills sit inside a <clip>: Resolve and OTIO both expect a clip
      // around a <video> on the spine.
      const still = `<video ref="${id}" offset="0s" duration="${t(v.frames)}"/>`;
      return `          <clip name="${xml(v.name)}" offset="${t(v.offset)}" duration="${t(v.frames)}" format="r1" tcFormat="NDF">\n            ${still}${kids ? `\n${kids}` : ""}\n          </clip>`;
    }
    const full = v.fileFrames;
    const id = assetFor(v.file, `hasVideo="1" format="r1" videoSources="1" duration="${t(full)}"`);
    const timeMap =
      v.speed === 1
        ? ""
        : `\n            <timeMap>\n              <timept time="0s" value="0s" interp="linear"/>\n              <timept time="${t(round(full / v.speed))}" value="${t(full)}" interp="linear"/>\n            </timeMap>`;
    const open = `          <asset-clip ref="${id}" name="${xml(v.name)}" offset="${t(v.offset)}" start="${t(localStart(v))}" duration="${t(v.frames)}" format="r1" tcFormat="NDF">`;
    if (!kids && !timeMap) return open.replace(/>$/, "/>");
    return `${open}${timeMap}${kids ? `\n${kids}` : ""}\n          </asset-clip>`;
  });

  const resources = [...assets.values()]
    .map(
      (a) =>
        `    <asset id="${a.id}" name="${xml(baseName(a.file))}" src="${xml(fileUrl(a.file))}" start="0s" ${a.attrs}/>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.8">
  <resources>
    <format id="r1" name="FFVideoFormat${tl.height}p${fps}" frameDuration="1/${fps}s" width="${tl.width}" height="${tl.height}"/>
${resources}
  </resources>
  <library>
    <event name="${xml(tl.name)}">
      <project name="${xml(tl.name)}">
        <sequence format="r1" duration="${t(tl.frames)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
          <spine>
${spine.join("\n")}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;
}

// ---------------------------------------------------------------------------
// OpenTimelineIO (File → Import → Timeline in DaVinci Resolve 18.5+)
// ---------------------------------------------------------------------------

/**
 * @param {Timeline} tl
 */
export function otio(tl) {
  const { fps } = tl;
  const rt = (value) => ({ OTIO_SCHEMA: "RationalTime.1", rate: fps, value });
  const range = (start, duration) => ({
    OTIO_SCHEMA: "TimeRange.1",
    start_time: rt(start),
    duration: rt(duration),
  });
  const item = (schema, fields) => ({
    OTIO_SCHEMA: schema,
    metadata: {},
    name: "",
    source_range: null,
    effects: [],
    markers: [],
    enabled: true,
    ...fields,
  });
  const ref = (file, available) => ({
    OTIO_SCHEMA: "ExternalReference.1",
    metadata: {},
    name: file.split("/").pop(),
    available_range: available,
    available_image_bounds: null,
    target_url: fileUrl(file),
  });
  const clip = (name, file, available, source, effects = []) =>
    item("Clip.2", {
      name,
      source_range: source,
      effects,
      media_references: { DEFAULT_MEDIA: ref(file, available) },
      active_media_reference_key: "DEFAULT_MEDIA",
    });
  const gap = (frames) => item("Gap.1", { source_range: range(0, frames) });
  const track = (name, kind, children) =>
    item("Track.1", { name, kind, children, source_range: null });

  const v1 = tl.video.map((v) => {
    if (v.kind === "still") return clip(v.name, v.file, null, range(0, v.frames));
    const full = v.fileFrames;
    const effects =
      v.speed === 1
        ? []
        : [
            {
              OTIO_SCHEMA: "LinearTimeWarp.1",
              name: "",
              effect_name: "LinearTimeWarp",
              time_scalar: v.speed,
              metadata: {},
              enabled: true,
            },
          ];
    // OTIO ranges are timeline-length; the time warp says how fast to read.
    return clip(v.name, v.file, range(0, full), range(v.inFrame, v.frames), effects);
  });

  const titleLanes = packLanes(tl.overlays);

  const audioClip = (a) =>
    clip(
      a.name,
      a.file,
      range(0, round(a.sourceSeconds * fps)),
      range(round(a.inSeconds * fps), a.frames),
    );
  const laid = (items, make) => {
    const out = [];
    let at = 0;
    for (const it of [...items].sort((a, b) => a.offset - b.offset)) {
      if (it.offset > at) out.push(gap(it.offset - at));
      out.push(make(it));
      at = it.offset + it.frames;
    }
    return out;
  };
  const a1 = tl.audio.filter((a) => a.role === "music").map(audioClip);
  const sfx = tl.audio.filter((a) => a.role === "sfx");
  const lanes = packLanes(sfx);
  const sfxTracks = [...new Set(lanes)].map((lane) =>
    track(
      `A${lane + 2} sfx`,
      "Audio",
      laid(
        sfx.filter((_, i) => lanes[i] === lane),
        audioClip,
      ),
    ),
  );

  return {
    OTIO_SCHEMA: "Timeline.1",
    metadata: {},
    name: tl.name,
    global_start_time: rt(0),
    tracks: item("Stack.1", {
      name: "tracks",
      children: [
        track("V1", "Video", v1),
        ...[...new Set(titleLanes)].map((lane) =>
          track(
            `V${lane + 2} titles`,
            "Video",
            laid(
              tl.overlays.filter((_, i) => titleLanes[i] === lane),
              (o) => clip(o.name, o.file, null, range(0, o.frames)),
            ),
          ),
        ),
        ...(a1.length ? [track("A1 music", "Audio", a1)] : []),
        ...sfxTracks,
      ],
    }),
  };
}

/**
 * OTIO's C++ reader rejects an integer where it expects a double, and
 * JSON.stringify writes 60.0 as 60. Re-add the ".0" on the double fields.
 */
export function otioJson(tl) {
  return `${JSON.stringify(otio(tl), null, 2).replace(
    /("(?:rate|value|time_scalar)": )(-?\d+)(?=[,\n])/g,
    "$1$2.0",
  )}\n`;
}
