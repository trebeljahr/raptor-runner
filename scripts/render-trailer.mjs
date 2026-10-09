// Trailer renderer: edit file → draft MP4 + Resolve-ready timelines.
//
// Reads an edit decision file (trailer/*.json, documented in
// trailer/README.md), renders its title and end cards to PNG, then writes:
//
//   <out>/<name>.mp4      H.264 + AAC draft, ready to watch or upload
//   <out>/<name>.fcpxml   FCPXML 1.8 timeline (Resolve: File → Import → Timeline)
//   <out>/<name>.otio     OpenTimelineIO timeline, same cut
//   <out>/cards/*.png     title and end cards the timelines point at
//   <out>/media/          a copy of the music, so the timelines stay valid
//
// The timelines reference the recorded clips in place (absolute paths), at
// full length, so every cut can be re-trimmed in Resolve. Free Resolve
// imports both formats; no scripting API or Studio licence is involved.
//
// Clips and cuts live in the main checkout's trailer-clips/ (gitignored), so
// they survive worktree cleanup; music, effects and fonts come from this repo.
//
//   node scripts/render-trailer.mjs trailer/steam-30s.json
//
// Flags:
//   --clips=<dir>   recorded clips (default: the edit's "clips", else trailer-clips/raw)
//   --out=<dir>     output folder (default trailer-clips/cuts/<name>)
//   --no-video      write cards and timelines only, skip the ffmpeg render

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { renderCards } from "./lib/trailer-cards.mjs";
import { mainCheckout, REPO } from "./lib/trailer-paths.mjs";
import { fcpxml, ffmpegArgs, normalizeEdit, otioJson, synthArgs } from "./lib/trailer-timeline.mjs";

const CLIP_ROOT = mainCheckout();
const FONT = join(
  REPO,
  "node_modules/@fontsource-variable/unbounded/files/unbounded-latin-wght-normal.woff2",
);

const argv = process.argv.slice(2);
const flag = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const editPath = argv.find((a) => !a.startsWith("--"));
if (!editPath) {
  console.error(
    "Usage: node scripts/render-trailer.mjs <edit.json> [--clips=dir] [--out=dir] [--no-video]",
  );
  process.exit(1);
}

const fromRepo = (p) => (isAbsolute(p) ? p : join(REPO, p));
const fromClipRoot = (p) => (isAbsolute(p) ? p : join(CLIP_ROOT, p));

function probe(file, entries) {
  const r = spawnSync("ffprobe", ["-v", "error", ...entries, "-of", "json", file], {
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`ffprobe failed on ${file}: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

const videoFrames = (file) =>
  Number(
    probe(file, ["-select_streams", "v:0", "-show_entries", "stream=nb_frames"]).streams[0]
      .nb_frames,
  );
const mediaSeconds = (file) =>
  Number(probe(file, ["-show_entries", "format=duration"]).format.duration);

/** EBU R128 integrated loudness of a file's audio, in LUFS. */
function integratedLoudness(file) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-af", "ebur128", "-f", "null", "-"], {
    encoding: "utf8",
  });
  const m = [...r.stderr.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].at(-1);
  if (!m) throw new Error(`could not measure loudness of ${file}`);
  return Number(m[1]);
}

async function main() {
  const edit = JSON.parse(await readFile(resolve(editPath), "utf8"));
  const clipsDir = fromClipRoot(flag("clips") ?? edit.clips ?? "trailer-clips/raw");
  const out = fromClipRoot(flag("out") ?? `trailer-clips/cuts/${edit.name}`);
  await mkdir(join(out, "cards"), { recursive: true });
  await mkdir(join(out, "media"), { recursive: true });

  const clipFile = (slug) => {
    const exact = join(clipsDir, `${slug}.mp4`);
    if (existsSync(exact)) return exact;
    throw new Error(`clip "${slug}" not found in ${clipsDir} (record it with pnpm trailer:shots)`);
  };
  const frames = new Map();
  const clipFrames = (slug) => {
    if (!frames.has(slug)) frames.set(slug, videoFrames(clipFile(slug)));
    return frames.get(slug);
  };

  let musicFile;
  let musicSeconds;
  if (edit.music) {
    const src = fromRepo(edit.music.file);
    musicFile = join(out, "media", basename(src));
    await copyFile(src, musicFile);
    musicSeconds = mediaSeconds(musicFile);
  }

  // Effects: files are copied next to the timelines, synths are generated.
  const sfxFiles = [];
  for (const [i, x] of (edit.sfx ?? []).entries()) {
    const nn = String(i + 1).padStart(2, "0");
    if (x.synth) {
      const file = join(out, "media", `sfx-${nn}-${x.synth}.wav`);
      const r = spawnSync("ffmpeg", synthArgs(x.synth, x.duration ?? 2, file), {
        encoding: "utf8",
      });
      if (r.status !== 0) throw new Error(`sfx[${i}] synth ${x.synth} failed: ${r.stderr}`);
      sfxFiles.push(file);
    } else {
      const src = fromRepo(x.file);
      const file = join(out, "media", basename(src));
      await copyFile(src, file);
      sfxFiles.push(file);
    }
  }
  const sfxSeconds = sfxFiles.map(mediaSeconds);

  const cardFile = (id) => join(out, "cards", `${id}.png`);
  const titleFile = (i) => join(out, "cards", `title-${String(i + 1).padStart(2, "0")}.png`);
  const tl = normalizeEdit(edit, {
    clipFile,
    clipFrames,
    cardFile,
    titleFile,
    musicFile,
    musicSeconds,
    sfxFile: (i) => sfxFiles[i],
    sfxSeconds: (i) => sfxSeconds[i],
  });

  const usedCards = new Set(edit.cuts.filter((c) => c.card).map((c) => c.card));
  await renderCards(
    [
      ...[...usedCards].map((id) => {
        const card = edit.cards[id];
        return {
          ...card,
          outFile: cardFile(id),
          logo: card.logo && fromRepo(card.logo),
          background: card.background && fromRepo(card.background),
        };
      }),
      ...(edit.titles ?? []).map((t, i) => ({
        kind: t.style ?? "lower-third",
        ...t,
        outFile: titleFile(i),
        logo: t.logo && fromRepo(t.logo),
        background: t.background && fromRepo(t.background),
      })),
    ],
    { width: tl.width, height: tl.height, font: FONT },
  );

  const fcpxmlFile = join(out, `${edit.name}.fcpxml`);
  const otioFile = join(out, `${edit.name}.otio`);
  await writeFile(fcpxmlFile, fcpxml(tl));
  await writeFile(otioFile, otioJson(tl));

  const seconds = (tl.frames / tl.fps).toFixed(2);
  console.log(
    `${edit.name}: ${tl.video.length} cuts, ${tl.overlays.length} titles, ${sfxFiles.length} sfx, ${seconds}s @ ${tl.fps} fps`,
  );
  for (const v of tl.video) {
    const at = (v.offset / tl.fps).toFixed(2).padStart(6);
    const len = (v.frames / tl.fps).toFixed(2);
    const src =
      v.kind === "clip" ? `${v.name} @ ${(v.inFrame / tl.fps).toFixed(2)}s` : `[${v.name} card]`;
    console.log(
      `  ${at}s  +${len}s  ${src}${v.kind === "clip" && v.speed !== 1 ? ` ×${v.speed}` : ""}`,
    );
  }
  console.log(
    `  timeline: ${relative(process.cwd(), fcpxmlFile)}\n  timeline: ${relative(process.cwd(), otioFile)}`,
  );

  if (argv.includes("--no-video")) return;
  // Loudness: render the mix alone, measure it, then master with one static
  // gain so the quiet opening stays quieter than the drop.
  let masterGainDb = 0;
  if (tl.master && tl.audio.length) {
    const wav = join(out, "media", "mix-unmastered.wav");
    const r = spawnSync("ffmpeg", ffmpegArgs(tl, wav, { audioOnly: true }), { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`audio mix failed: ${r.stderr}`);
    const measured = integratedLoudness(wav);
    masterGainDb = tl.master.loudness - measured;
    console.log(
      `  mix:      ${measured.toFixed(1)} LUFS → ${masterGainDb >= 0 ? "+" : ""}${masterGainDb.toFixed(1)} dB`,
    );
  }

  const mp4 = join(out, `${edit.name}.mp4`);
  await new Promise((res, rej) => {
    const ff = spawn("ffmpeg", ffmpegArgs(tl, mp4, { masterGainDb }), {
      stdio: ["ignore", "inherit", "inherit"],
    });
    ff.on("error", rej);
    ff.on("close", (code) => (code === 0 ? res() : rej(new Error(`ffmpeg exited ${code}`))));
  });
  const got = videoFrames(mp4);
  if (got !== tl.frames) throw new Error(`rendered ${got} frames, timeline has ${tl.frames}`);
  const lufs = tl.audio.length ? `, ${integratedLoudness(mp4).toFixed(1)} LUFS` : "";
  console.log(`  video:    ${relative(process.cwd(), mp4)} (${got} frames${lufs})`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
