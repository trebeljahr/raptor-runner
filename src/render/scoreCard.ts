/*
 * Raptor Runner — shareable score card.
 *
 * Composes a 1200×630 PNG with the current sky color, the final
 * score, and the personal best. Uses a Web Worker when available
 * to keep the main thread free during the game-over animation.
 */

import { contexts } from "../canvas";
import { state } from "../state";
import ScoreCardWorker from "../workers/scoreCard.worker.ts?worker";

// Persistent worker reused across calls so we don't pay startup
// cost every game-over.
let scoreCardWorker: Worker | null = null;
function getScoreCardWorker() {
  if (scoreCardWorker) return scoreCardWorker;
  try {
    scoreCardWorker = new ScoreCardWorker();
  } catch (_e) {
    scoreCardWorker = null;
  }
  return scoreCardWorker;
}

export async function generateScoreCardBlob(deathSnapshotReady: boolean) {
  const deathCanvas = contexts.deathCanvas!;
  // Try the web-worker path first — keeps the main thread free so
  // the raptor keeps animating smoothly under the game-over scrim.
  try {
    if (
      deathSnapshotReady &&
      typeof createImageBitmap === "function" &&
      typeof OffscreenCanvas !== "undefined"
    ) {
      const worker = getScoreCardWorker();
      if (worker) {
        const bitmap = await createImageBitmap(deathCanvas);
        const blob = await new Promise<Blob>((resolve, reject) => {
          const onMessage = (e: MessageEvent) => {
            worker.removeEventListener("message", onMessage);
            worker.removeEventListener("error", onError);
            if (e.data?.blob) resolve(e.data.blob);
            else reject(new Error(e.data?.error || "worker failed"));
          };
          const onError = (ev: ErrorEvent) => {
            worker.removeEventListener("message", onMessage);
            worker.removeEventListener("error", onError);
            reject(new Error("worker error: " + ev.message));
          };
          worker.addEventListener("message", onMessage);
          worker.addEventListener("error", onError);
          worker.postMessage(
            {
              bitmap,
              score: state.score,
              highScore: state.highScore,
              newHighScore: state.newHighScore,
            },
            [bitmap],
          );
        });
        return blob;
      }
    }
  } catch (_e) {
    // Fall through to main-thread path.
  }
  return generateScoreCardBlobMainThread(deathSnapshotReady);
}

// Main-thread fallback for browsers without OffscreenCanvas / Web
// Worker support, or when the worker errors out.
function generateScoreCardBlobMainThread(deathSnapshotReady: boolean) {
  const deathCanvas = contexts.deathCanvas!;
  const W = 1200;
  const H = 630;
  const scale = 2;
  const card = document.createElement("canvas");
  card.width = W * scale;
  card.height = H * scale;
  const cctx = card.getContext("2d")!;
  cctx.scale(scale, scale);
  cctx.imageSmoothingEnabled = true;
  cctx.imageSmoothingQuality = "high";

  // ── Background: the actual game screenshot from death ─────
  if (deathSnapshotReady && deathCanvas && deathCanvas.width > 0 && deathCanvas.height > 0) {
    const srcW = deathCanvas.width;
    const srcH = deathCanvas.height;
    const srcAspect = srcW / srcH;
    const dstAspect = W / H;
    // biome-ignore lint/suspicious/noImplicitAnyLet: auto-suppressed during biome 2.x bump
    let sx, sy, sw, sh;
    if (srcAspect > dstAspect) {
      sh = srcH;
      sw = sh * dstAspect;
      sy = 0;
      sx = (srcW - sw) / 2;
    } else {
      sw = srcW;
      sh = sw / dstAspect;
      sx = 0;
      sy = Math.max(0, (srcH - sh) * 0.75);
    }
    cctx.drawImage(deathCanvas, sx, sy, sw, sh, 0, 0, W, H);
  } else {
    cctx.fillStyle = "#0c0e15";
    cctx.fillRect(0, 0, W, H);
  }

  // ── Dark gradient strips ──────────────────────────────────
  const topShadeH = 220;
  const topShade = cctx.createLinearGradient(0, 0, 0, topShadeH);
  topShade.addColorStop(0, "rgba(0, 0, 0, 0.7)");
  topShade.addColorStop(1, "rgba(0, 0, 0, 0)");
  cctx.fillStyle = topShade;
  cctx.fillRect(0, 0, W, topShadeH);

  const botShadeH = 260;
  const botShade = cctx.createLinearGradient(0, H - botShadeH, 0, H);
  botShade.addColorStop(0, "rgba(0, 0, 0, 0)");
  botShade.addColorStop(1, "rgba(0, 0, 0, 0.75)");
  cctx.fillStyle = botShade;
  cctx.fillRect(0, H - botShadeH, W, botShadeH);

  // ── Title + URL (top left) ────────────────────────────────
  cctx.save();
  cctx.textAlign = "left";
  cctx.textBaseline = "alphabetic";
  cctx.fillStyle = "#ffffff";
  cctx.shadowColor = "rgba(0, 0, 0, 0.55)";
  cctx.shadowBlur = 14;
  cctx.font = 'bold 72px "Helvetica Neue", Helvetica, Arial, sans-serif';
  cctx.fillText("Raptor Runner", 60, 100);
  cctx.fillStyle = "rgba(255, 255, 255, 0.8)";
  cctx.font = '26px "Helvetica Neue", Helvetica, Arial, sans-serif';
  cctx.fillText("raptor.trebeljahr.com", 62, 142);
  cctx.restore();

  // ── Score block (bottom right) ────────────────────────────
  cctx.save();
  cctx.textAlign = "right";
  cctx.textBaseline = "alphabetic";
  cctx.shadowColor = "rgba(0, 0, 0, 0.6)";
  cctx.shadowBlur = 16;
  cctx.fillStyle = "rgba(255, 255, 255, 0.7)";
  cctx.font = '600 30px "Helvetica Neue", Helvetica, Arial, sans-serif';
  cctx.fillText("FINAL SCORE", W - 60, H - 180);
  cctx.font = 'bold 180px "Helvetica Neue", Helvetica, Arial, sans-serif';
  const scoreGrad = cctx.createLinearGradient(0, H - 170, 0, H - 40);
  scoreGrad.addColorStop(0, "#ffee9a");
  scoreGrad.addColorStop(1, "#e89d33");
  cctx.fillStyle = scoreGrad;
  cctx.fillText(`${state.score}`, W - 60, H - 50);
  cctx.restore();

  // Personal best / new record
  cctx.save();
  cctx.textAlign = "left";
  cctx.textBaseline = "alphabetic";
  cctx.shadowColor = "rgba(0, 0, 0, 0.6)";
  cctx.shadowBlur = 14;
  cctx.font = 'italic 36px "Helvetica Neue", Helvetica, Arial, sans-serif';
  if (state.newHighScore) {
    cctx.fillStyle = "#ffd84a";
    cctx.fillText("★ New personal best!", 60, H - 60);
  } else {
    cctx.fillStyle = "rgba(255, 255, 255, 0.82)";
    cctx.fillText(`Personal best: ${state.highScore}`, 60, H - 60);
  }
  cctx.restore();

  return new Promise<Blob | null>((resolve) => {
    card.toBlob((blob) => resolve(blob), "image/png");
  });
}
