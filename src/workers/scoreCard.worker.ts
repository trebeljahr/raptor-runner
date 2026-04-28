/// <reference lib="webworker" />
/*
 * Score-card renderer running in a Web Worker, so the main
 * thread (and the game's rAF loop) aren't blocked while we
 * compose the shareable PNG.
 *
 * Input message (from game.js):
 *   {
 *     bitmap,        // ImageBitmap of the death snapshot (transferred)
 *     score,         // number
 *     highScore,     // number
 *     newHighScore,  // bool
 *     width,         // logical card width in px  (default 1200)
 *     height,        // logical card height in px (default 630)
 *     scale,         // internal resolution multiplier (default 2)
 *   }
 *
 * Output message:
 *   { blob }         // PNG Blob, or { error } on failure
 */

self.onmessage = async (e: MessageEvent) => {
  try {
    const {
      bitmap,
      score,
      highScore,
      newHighScore,
      width = 1200,
      height = 630,
      scale = 2,
    } = e.data || {};
    const W = width;
    const H = height;

    if (typeof OffscreenCanvas === "undefined") {
      throw new Error("OffscreenCanvas not supported");
    }

    const canvas = new OffscreenCanvas(W * scale, H * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.scale(scale, scale);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // ── Background: death snapshot, object-fit: cover ────────────
    if (bitmap && bitmap.width > 0 && bitmap.height > 0) {
      const srcW = bitmap.width;
      const srcH = bitmap.height;
      const srcAspect = srcW / srcH;
      const dstAspect = W / H;
      // biome-ignore lint/suspicious/noImplicitAnyLet: auto-suppressed during biome 2.x bump
      let sx;
      // biome-ignore lint/suspicious/noImplicitAnyLet: auto-suppressed during biome 2.x bump
      let sy;
      // biome-ignore lint/suspicious/noImplicitAnyLet: auto-suppressed during biome 2.x bump
      let sw;
      // biome-ignore lint/suspicious/noImplicitAnyLet: auto-suppressed during biome 2.x bump
      let sh;
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
      ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, W, H);
      // Release the transferred bitmap immediately.
      if (typeof bitmap.close === "function") bitmap.close();
    } else {
      ctx.fillStyle = "#0c0e15";
      ctx.fillRect(0, 0, W, H);
    }

    // ── Dark scrim at the top (for the title) ────────────────────
    const topShadeH = 220;
    const topShade = ctx.createLinearGradient(0, 0, 0, topShadeH);
    topShade.addColorStop(0, "rgba(0, 0, 0, 0.7)");
    topShade.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = topShade;
    ctx.fillRect(0, 0, W, topShadeH);

    // ── Dark scrim at the bottom (for the score block) ──────────
    const botShadeH = 260;
    const botShade = ctx.createLinearGradient(0, H - botShadeH, 0, H);
    botShade.addColorStop(0, "rgba(0, 0, 0, 0)");
    botShade.addColorStop(1, "rgba(0, 0, 0, 0.75)");
    ctx.fillStyle = botShade;
    ctx.fillRect(0, H - botShadeH, W, botShadeH);

    // ── Title + URL (top-left) ──────────────────────────────────
    ctx.save();
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
    ctx.shadowBlur = 14;
    ctx.font = 'bold 72px "Helvetica Neue", Helvetica, Arial, sans-serif';
    ctx.fillText("Raptor Runner", 60, 100);
    ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
    ctx.font = '26px "Helvetica Neue", Helvetica, Arial, sans-serif';
    ctx.fillText("raptor.trebeljahr.com", 62, 142);
    ctx.restore();

    // ── Score block (bottom-right) ──────────────────────────────
    ctx.save();
    ctx.textAlign = "right";
    ctx.textBaseline = "alphabetic";
    ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
    ctx.shadowBlur = 16;
    ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
    ctx.font = '600 30px "Helvetica Neue", Helvetica, Arial, sans-serif';
    // Label sits at H-220 (was H-180) so the baseline of the label
    // clears the top of the 180px score digits — the prior layout
    // had the cap of the number sitting exactly under the label
    // baseline with ~0px gap, which read as cramped. 40px of clear
    // breathing room now.
    ctx.fillText("FINAL SCORE", W - 60, H - 220);
    ctx.font = 'bold 180px "Helvetica Neue", Helvetica, Arial, sans-serif';
    const scoreGrad = ctx.createLinearGradient(0, H - 170, 0, H - 40);
    scoreGrad.addColorStop(0, "#ffee9a");
    scoreGrad.addColorStop(1, "#e89d33");
    ctx.fillStyle = scoreGrad;
    // " m" suffix (with leading space) so the unit reads as
    // attached to the number — distance in meters, matching the
    // in-game HUD's meters-based score.
    ctx.fillText(`${score | 0} m`, W - 60, H - 50);
    ctx.restore();

    // ── Personal best line (bottom-left) ────────────────────────
    ctx.save();
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
    ctx.shadowBlur = 14;
    ctx.font = 'italic 36px "Helvetica Neue", Helvetica, Arial, sans-serif';
    if (newHighScore) {
      ctx.fillStyle = "#ffd84a";
      ctx.fillText("\u2605 New personal best!", 60, H - 60);
    } else {
      ctx.fillStyle = "rgba(255, 255, 255, 0.82)";
      ctx.fillText(`Personal best: ${highScore | 0} m`, 60, H - 60);
    }
    ctx.restore();

    const blob = await canvas.convertToBlob({ type: "image/png" });
    self.postMessage({ blob });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    self.postMessage({ error: msg });
  }
};
