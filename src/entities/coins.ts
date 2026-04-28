/*
 * Raptor Runner — collectible coins. Scattered across each flower-
 * field breather + one above each cactus. Bob, pop-fade on pickup,
 * add to the score and the persistent shop balance. Spawning runs
 * from Cactuses._rollNextGap / Cactus.spawn so coins can never
 * collide with an upcoming cactus.
 */

import { audio } from "../audio";
import {
  COIN_AMBIENT_TWINKLE_COUNT,
  COIN_BANK_REWARD,
  COIN_BASE_Y_ABOVE_GROUND_RATIO,
  COIN_BOB_AMPLITUDE_PX,
  COIN_BOB_FREQUENCY_HZ,
  COIN_COLLECT_FADE_FRAMES,
  COIN_COUNT_PER_FIELD,
  COIN_FIELD_EDGE_MARGIN_RAPTOR_WIDTHS,
  COIN_GLINT_MAX_ALPHA,
  COIN_GLINT_SIZE_RATIO,
  COIN_SIZE_RATIO,
  COIN_SPACING_RATIO,
  COIN_SPARKLE_FREQUENCY_HZ,
  COIN_TWINKLE_FREQUENCY_HZ,
  DIAMOND_BANK_REWARD,
  DIAMOND_SIZE_SCALE,
  DIAMOND_SPARKLE_COUNT,
  DIAMOND_SPARKLE_ORBIT_RATIO,
} from "../constants";
import { compactInPlace, type Polygon, pointInPolygon } from "../helpers";
import { IMAGES } from "../images";
import { saveCoinsBalance } from "../persistence";
import { state } from "../state";

export interface Coin {
  x: number;
  /** Y of the coin's top edge, before the bob offset is applied. */
  baseY: number;
  w: number;
  h: number;
  /** Per-coin phase offset so neighbours don't bob in sync. */
  phase: number;
  collected: boolean;
  /** state.frame when collected — drives the pop/fade animation. */
  collectFrame: number;
  /** True for the right-most coin in the field — i.e. the last one
   *  the raptor passes through on its way out. Triggers the
   *  chain-end chord on top of the regular pickup cue. */
  lastInField: boolean;
  /** True for coins spawned inside a flower-field breather (the
   *  10-coin ribbon). These coins feed the rising-pitch chain cue.
   *  Coins spawned above cacti set this to false and play the flat
   *  base-pitch chime — the chain is specifically a "full field"
   *  reward, not a metric for every pickup in a run. */
  fieldCoin: boolean;
  /** True for the diamond that replaces the last coin in a flower
   *  field. Rendered as a blue gem, worth 10× the normal bank
   *  reward, and still triggers lastInField's chain-end chord. */
  isDiamond: boolean;
}

interface RaptorRef {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Optional body silhouette — when present, coin pickup uses it
   *  as the authoritative hit test. Without it, collectCoins falls
   *  back to the raptor's bounding box. */
  collisionPolygon?: () => Polygon;
}

/** Scatter COIN_COUNT_PER_FIELD coins across [startX, endX] at
 *  chest-height on the running raptor. Resets the audio coin streak
 *  so the rising-pitch chain restarts per-field rather than climbing
 *  across the whole run. */
export function spawnCoinsInRange(startX: number, endX: number, raptor: RaptorRef): void {
  if (!raptor || raptor.h <= 0 || raptor.w <= 0) return;
  if (endX <= startX) return;
  const coinSize = raptor.h * COIN_SIZE_RATIO;
  state.coins = state.coins || [];
  const baseY = state.ground - raptor.h * COIN_BASE_Y_ABOVE_GROUND_RATIO - coinSize / 2;
  // Inset the usable span by EDGE_MARGIN on each side so coins don't
  // hug the cactus bookends. Fall back to the full width on tiny
  // breathers where 2× margin would leave nothing to spawn into.
  const edgeMarginPx = raptor.w * COIN_FIELD_EDGE_MARGIN_RAPTOR_WIDTHS;
  const rawFieldWidth = endX - startX;
  const usableStartX = rawFieldWidth > edgeMarginPx * 2 ? startX + edgeMarginPx : startX;
  const usableEndX = rawFieldWidth > edgeMarginPx * 2 ? endX - edgeMarginPx : endX;
  // Tight ribbon centred in the usable span — quick ding-ding-ding
  // run regardless of field length. Compress to fit if the full
  // ribbon would overflow the margin.
  const fieldWidth = usableEndX - usableStartX;
  const desiredSpacing = raptor.w * COIN_SPACING_RATIO;
  const gaps = COIN_COUNT_PER_FIELD - 1;
  const desiredSpanPx = desiredSpacing * gaps;
  const spacing = desiredSpanPx <= fieldWidth ? desiredSpacing : fieldWidth / gaps;
  const spanPx = spacing * gaps;
  const firstCoinX = usableStartX + (fieldWidth - spanPx) / 2;
  for (let i = 0; i < COIN_COUNT_PER_FIELD; i++) {
    const isLast = i === COIN_COUNT_PER_FIELD - 1;
    // Last slot is a diamond — rewards the full chain grab with a
    // juicier visual + 10× coin payout, matching the chain-end
    // chord that already plays on pickup number 10.
    const isDiamond = isLast;
    const size = isDiamond ? coinSize * DIAMOND_SIZE_SCALE : coinSize;
    // Re-centre the larger gem on the same footprint the coin
    // would have occupied, so spacing and the pickup hit-band stay
    // uniform across the ribbon.
    const x = firstCoinX + spacing * i - (size - coinSize) / 2;
    const y = baseY - (size - coinSize) / 2;
    state.coins.push({
      x,
      baseY: y,
      w: size,
      h: size,
      phase: Math.random() * Math.PI * 2,
      collected: false,
      collectFrame: 0,
      lastInField: isLast,
      fieldCoin: true,
      isDiamond,
    });
  }
  audio.resetCoinStreak();
}

/** Spawn a single coin at chest-height under a tall-flying
 *  pterodactyl: running under the flyer IS the pickup. Positions
 *  the coin at the raptor's normal coin-collect band (same y as
 *  flower-field coins) so no jump is required — the reward for
 *  reading a tall flyer as "don't jump, keep running" is the pickup
 *  itself. Caller passes the ptero's current x + width; we centre
 *  the coin under the body. */
export function spawnCoinUnderPterodactyl(pteroX: number, pteroW: number, raptor: RaptorRef): void {
  if (!raptor || raptor.h <= 0 || raptor.w <= 0) return;
  const coinSize = raptor.h * COIN_SIZE_RATIO;
  state.coins = state.coins || [];
  const baseY = state.ground - raptor.h * COIN_BASE_Y_ABOVE_GROUND_RATIO - coinSize / 2;
  state.coins.push({
    x: pteroX + pteroW / 2 - coinSize / 2,
    baseY,
    w: coinSize,
    h: coinSize,
    phase: Math.random() * Math.PI * 2,
    collected: false,
    collectFrame: 0,
    lastInField: false,
    fieldCoin: false,
    isDiamond: false,
  });
}

/** Spawn a single coin above a cactus: clearing IS the pickup. Coin
 *  sits at the peak of a just-clearing arc. `isLarge` doubles the
 *  gap (0.7 → 1.4 × coinSize) so tall cacti aren't trivially clipped
 *  by a shallow hop. Sole score source in the coins-only model. */
export function spawnCoinAboveCactus(
  cactusX: number,
  cactusY: number,
  cactusW: number,
  raptor: RaptorRef,
  isLarge = false,
): void {
  if (!raptor || raptor.h <= 0 || raptor.w <= 0) return;
  const coinSize = raptor.h * COIN_SIZE_RATIO;
  state.coins = state.coins || [];
  const cx = cactusX + cactusW / 2 - coinSize / 2;
  const gapMultiplier = isLarge ? 1.4 : 0.7;
  const baseY = cactusY - coinSize - coinSize * gapMultiplier;
  state.coins.push({
    x: cx,
    baseY,
    w: coinSize,
    h: coinSize,
    phase: Math.random() * Math.PI * 2,
    collected: false,
    collectFrame: 0,
    // Not part of a field — no chain-end chord.
    lastInField: false,
    // Per-cactus coins are NOT part of the pitched chain cue. The
    // rising "ding-ding-diiing" is specifically the 10-coin field
    // reward; per-cactus pickups play the flat base-pitch chime.
    fieldCoin: false,
    isDiamond: false,
  });
}

/** Shared bob phase — same y used by draw and collision. */
function bobPhase(c: Coin): number {
  return state.frame * ((Math.PI * 2 * COIN_BOB_FREQUENCY_HZ) / 60) + c.phase;
}

/** Scroll all live coins by this frame's ground speed and drop any
 *  that scrolled off the left edge or finished their collect fade. */
export function updateCoins(_frameScale: number): void {
  if (!state.coins || state.coins.length === 0) return;
  // Shared integer dx so coins stay pixel-locked to the cacti
  // scrolling past them — see state._frameScrollDx.
  const dx = state._frameScrollDx;
  for (const c of state.coins) c.x -= dx;
  compactInPlace(state.coins, (c) => {
    if (c.x + c.w < -20) return false;
    if (c.collected && state.frame - c.collectFrame > COIN_COLLECT_FADE_FRAMES) return false;
    return true;
  });
}

/** Polygon-precise pickup. AABB-rejects first (cheap), then samples
 *  the coin disc (centre + 4 cardinal edges) against the raptor body
 *  silhouette so phantom grabs through tail/neck-air don't register.
 *
 *  `onCollect` gets the coin centre after bob offset so callers can
 *  spawn bursts exactly where the coin was rendered. */
export function collectCoins(
  raptor: RaptorRef,
  onCollect: (coin: Coin, centerX: number, centerY: number) => void,
): void {
  if (!state.coins || state.coins.length === 0) return;
  const rL = raptor.x;
  const rR = raptor.x + raptor.w;
  const rT = raptor.y;
  const rB = raptor.y + raptor.h;
  const poly = raptor.collisionPolygon ? raptor.collisionPolygon() : null;
  for (const c of state.coins) {
    if (c.collected) continue;
    const cL = c.x;
    const cR = c.x + c.w;
    if (cR < rL || cL > rR) continue;
    const cy = c.baseY + Math.sin(bobPhase(c)) * COIN_BOB_AMPLITUDE_PX;
    if (cy + c.h < rT || cy > rB) continue;
    if (poly) {
      const cxC = c.x + c.w / 2;
      const cyC = cy + c.h / 2;
      const r = Math.min(c.w, c.h) / 2;
      // Disc sampled at center + 8 surrounding points (cardinals and
      // diagonals) — the prior 5-point set left narrow concavities
      // of the raptor silhouette (neck/tail gaps) where a coin could
      // phase through without any sample landing inside the body.
      // Cheap inner-radius fallback also checks polygon vertices
      // against the coin disc: if any vertex is within the coin's
      // radius we count the hit even when the coin's own sampled
      // points all missed. Catches head-grazes where the coin sits
      // just off the raptor's outline.
      const rDiag = r * 0.707; // 1/√2 for diagonals on the same disc
      const samples = [
        { x: cxC, y: cyC },
        { x: cxC - r, y: cyC },
        { x: cxC + r, y: cyC },
        { x: cxC, y: cyC - r },
        { x: cxC, y: cyC + r },
        { x: cxC - rDiag, y: cyC - rDiag },
        { x: cxC + rDiag, y: cyC - rDiag },
        { x: cxC - rDiag, y: cyC + rDiag },
        { x: cxC + rDiag, y: cyC + rDiag },
      ];
      let hit = false;
      for (const s of samples) {
        if (pointInPolygon(s, poly)) {
          hit = true;
          break;
        }
      }
      if (!hit) {
        const r2 = r * r;
        for (const p of poly) {
          const dx = p.x - cxC;
          const dy = p.y - cyC;
          if (dx * dx + dy * dy <= r2) {
            hit = true;
            break;
          }
        }
      }
      if (!hit) continue;
    }
    c.collected = true;
    c.collectFrame = state.frame;
    // Score is distance-based now — coin pickups fill the wallet
    // instead of bumping the meter count. Bank immediately:
    // "picked up = yours" even if the player dies later in the field.
    const reward = c.isDiamond ? DIAMOND_BANK_REWARD : COIN_BANK_REWARD;
    state.coinsBalance += reward;
    state.runCoins += reward;
    saveCoinsBalance(state.coinsBalance);
    onCollect(c, c.x + c.w / 2, cy + c.h / 2);
  }
}

/** Blit each coin, honouring the bob offset and the short
 *  pop-fade for coins currently in their collect animation.
 *
 *  Perf: a full 10-coin ribbon on screen was previously paying for
 *  ~50 save/restore pairs per frame (one outer per coin + one per
 *  glint + one per ambient twinkle), and each save() snapshots every
 *  context field. Loop now snapshots the base transform once via
 *  getTransform(), reuses it across both drawImage (coin sprite) and
 *  setTransform (per-star matrix composition), and tracks globalAlpha
 *  + fillStyle inline so setters only fire when the value actually
 *  changes. Same visuals, zero save/restore in the hot loop. */
export function drawCoins(ctx: CanvasRenderingContext2D): void {
  if (!state.coins || state.coins.length === 0) return;
  const img = IMAGES.coin;
  if (!img) return;

  const base = ctx.getTransform();
  const ba = base.a,
    bb = base.b,
    bc = base.c,
    bd = base.d,
    be = base.e,
    bf = base.f;

  let lastAlpha = -1;
  let fillStyleSet = false;

  for (const c of state.coins) {
    const cy = c.baseY + Math.sin(bobPhase(c)) * COIN_BOB_AMPLITUDE_PX;
    let scale = 1;
    let coinAlpha = 1;
    if (c.collected) {
      // Pop up + fade out so the grab reads, then the coin is gone.
      const t = Math.min(1, (state.frame - c.collectFrame) / COIN_COLLECT_FADE_FRAMES);
      scale = 1 + t * 0.6;
      coinAlpha = 1 - t;
    }

    // Coin / diamond blit — runs in the base transform (no per-coin
    // translate/scale; the x/y/w/h args already position + size it).
    ctx.setTransform(ba, bb, bc, bd, be, bf);
    if (coinAlpha !== lastAlpha) {
      ctx.globalAlpha = coinAlpha;
      lastAlpha = coinAlpha;
    }
    const w = c.w * scale;
    const h = c.h * scale;
    const x = c.x - (w - c.w) / 2;
    const y = cy - (h - c.h) / 2;
    if (c.isDiamond) {
      const dImg = IMAGES.diamond;
      if (dImg) {
        ctx.drawImage(dImg, Math.round(x), Math.round(y), Math.round(w), Math.round(h));
      }
      if (c.collected) continue;
      // Edge sparkles — DIAMOND_SPARKLE_COUNT star-flicks orbiting
      // at DIAMOND_SPARKLE_ORBIT_RATIO so they graze the gem's
      // silhouette. Each one carries its own phase offset for
      // irregular twinkling. Re-use the coin twinkle cadence but
      // with a denser orbit for the "end-of-chain flex" read.
      if (!fillStyleSet) {
        ctx.fillStyle = "#fff";
        fillStyleSet = true;
      }
      const dTwinkleBaseT = state.frame * ((Math.PI * 2 * COIN_TWINKLE_FREQUENCY_HZ) / 60);
      const dcx = c.x + c.w / 2;
      const dcy = cy + c.h / 2;
      for (let i = 0; i < DIAMOND_SPARKLE_COUNT; i++) {
        const ang = (i / DIAMOND_SPARKLE_COUNT) * Math.PI * 2 + c.phase * 0.5;
        const orbit = c.w * DIAMOND_SPARKLE_ORBIT_RATIO;
        const dx = dcx + Math.cos(ang) * orbit;
        const dy = dcy + Math.sin(ang) * orbit * 0.75;
        const tPhase = dTwinkleBaseT + c.phase * 1.7 + i * 2.1;
        const tAmp = Math.sin(tPhase);
        if (tAmp <= 0) continue;
        const tAlpha = tAmp * tAmp * coinAlpha;
        if (tAlpha <= 0) continue;
        const tr = c.w * 0.09;
        if (tAlpha !== lastAlpha) {
          ctx.globalAlpha = tAlpha;
          lastAlpha = tAlpha;
        }
        drawFourPointStar(ctx, ba, bb, bc, bd, be, bf, dx, dy, tr);
      }
      continue;
    }
    ctx.drawImage(img, Math.round(x), Math.round(y), Math.round(w), Math.round(h));

    if (c.collected) continue;

    if (!fillStyleSet) {
      ctx.fillStyle = "#fff";
      fillStyleSet = true;
    }

    // Main glint — a 4-point star sweeping across the coin face,
    // opacity pulsed on its own sin so the orbit has a dim-bright
    // cadence on top of the motion.
    const sparkleT = state.frame * ((Math.PI * 2 * COIN_SPARKLE_FREQUENCY_HZ) / 60) + c.phase;
    const s = Math.sin(sparkleT);
    if (s > 0) {
      const orbitT = sparkleT * 0.5;
      const orbitRx = c.w * 0.18;
      const orbitRy = c.h * 0.12;
      const sx = c.x + c.w * 0.62 + Math.cos(orbitT) * orbitRx;
      const sy = cy + c.h * 0.32 + Math.sin(orbitT) * orbitRy;
      const sr = c.w * COIN_GLINT_SIZE_RATIO;
      const glintAlpha = Math.min(1, s * COIN_GLINT_MAX_ALPHA) * coinAlpha;
      if (glintAlpha > 0 && sr > 0) {
        if (glintAlpha !== lastAlpha) {
          ctx.globalAlpha = glintAlpha;
          lastAlpha = glintAlpha;
        }
        drawFourPointStar(ctx, ba, bb, bc, bd, be, bf, sx, sy, sr);
      }
    }

    // Ambient twinkles — star-flicks on an orbit around the coin,
    // each with its own phase so they blink irregularly and
    // neighbours don't stamp identically.
    const twinkleBaseT = state.frame * ((Math.PI * 2 * COIN_TWINKLE_FREQUENCY_HZ) / 60);
    const cx = c.x + c.w / 2;
    const centerY = cy + c.h / 2;
    for (let i = 0; i < COIN_AMBIENT_TWINKLE_COUNT; i++) {
      const ang = (i / COIN_AMBIENT_TWINKLE_COUNT) * Math.PI * 2 + c.phase * 0.5;
      const orbit = c.w * 0.6;
      const tx = cx + Math.cos(ang) * orbit;
      const ty = centerY + Math.sin(ang) * orbit * 0.7;
      const tPhase = twinkleBaseT + c.phase * 1.7 + i * 2.1;
      const tAmp = Math.sin(tPhase);
      if (tAmp <= 0) continue;
      // Squared envelope = narrow "blink" with a bright peak.
      const tAlpha = tAmp * tAmp * 0.95 * coinAlpha;
      if (tAlpha <= 0) continue;
      const tr = c.w * 0.11;
      if (tAlpha !== lastAlpha) {
        ctx.globalAlpha = tAlpha;
        lastAlpha = tAlpha;
      }
      drawFourPointStar(ctx, ba, bb, bc, bd, be, bf, tx, ty, tr);
    }
  }

  // Restore base transform + default alpha so downstream draws
  // aren't affected by the last coin/star's state.
  ctx.setTransform(ba, bb, bc, bd, be, bf);
  ctx.globalAlpha = 1;
}

// Unit-radius 4-point star baked once as a Path2D — translate+scale
// per draw instead of rebuilding the 8-segment path (~60 star draws
// per frame across live coins' glints + twinkles).
const UNIT_STAR_PATH: Path2D = (() => {
  const p = new Path2D();
  p.moveTo(0, -1);
  p.lineTo(0.3, -0.3);
  p.lineTo(1, 0);
  p.lineTo(0.3, 0.3);
  p.lineTo(0, 1);
  p.lineTo(-0.3, 0.3);
  p.lineTo(-1, 0);
  p.lineTo(-0.3, -0.3);
  p.closePath();
  return p;
})();

/** Shared 4-point white sparkle — main glint, ambient twinkles, and
 *  collect-burst particles all use this one primitive.
 *
 *  Caller is responsible for context state: set globalAlpha and
 *  fillStyle BEFORE the call, and reset the transform AFTER the
 *  loop (see drawCoins / drawCoinSparks for the pattern). The
 *  base-matrix params (ba..bf) are the snapshot the caller took
 *  via getTransform() once at the top of its loop — we compose
 *  `base × translate(x,y) × scale(r,r)` inline and setTransform
 *  instead of paying for a save/restore + translate + scale stack
 *  per star. */
function drawFourPointStar(
  ctx: CanvasRenderingContext2D,
  ba: number,
  bb: number,
  bc: number,
  bd: number,
  be: number,
  bf: number,
  x: number,
  y: number,
  r: number,
): void {
  if (r <= 0) return;
  // base * translate(x, y) * scale(r, r) =
  //   [ba*r  bc*r  ba*x + bc*y + be]
  //   [bb*r  bd*r  bb*x + bd*y + bf]
  ctx.setTransform(ba * r, bb * r, bc * r, bd * r, ba * x + bc * y + be, bb * x + bd * y + bf);
  ctx.fill(UNIT_STAR_PATH);
}

export { drawFourPointStar };

export function clearCoins(): void {
  state.coins = [];
}
