/*
 * Raptor Runner — rare background events (easter eggs).
 *
 * Five one-shot visual events (UFO, Santa, tumbleweed, comet, meteor)
 * that roll against the per-event average interval every time the
 * raptor jumps. Each event type can only be active once at a time.
 *
 * The catalog (interval, time-of-day condition, lifetime) and the
 * spawn/update logic live here. The drawing functions stay in main.ts
 * for now because drawRareEvent is a ~450-line wall of canvas drawing
 * that will move out cleanly once the sky/world render modules split.
 *
 * Two couplings back to the main loop are passed in via setters so
 * this module has no bare references:
 *   • onAchievementUnlock(id) — fires the per-event achievement on
 *                               first sighting
 *   • duneHeightAt(x: number, off)    — pure function that returns the dune
 *                               height at a given screen x and offset.
 *                               Currently owned by render/world code.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { audio } from "../audio";
import { IMAGES } from "../images";
import { saveRareEventsSeen } from "../persistence";
import { state } from "../state";

// ══════════════════════════════════════════════════════════════════
// Couplings (wired from main.ts's init)
// ══════════════════════════════════════════════════════════════════

type AchievementCallback = (id: string) => void;
type DuneHeightProvider = (screenX: number, offset: number) => number;

let onAchievementUnlock: AchievementCallback | null = null;
let duneHeightAt: DuneHeightProvider = () => 0;

/** Register the achievement-unlock hook. Called once during init. */
export function setRareEventsAchievementHandler(cb: AchievementCallback | null): void {
  onAchievementUnlock = cb;
}

/** Register the dune-height lookup function (currently owned by
 *  render/world code in main.ts). Must be wired before the first
 *  frame — tumbleweed/UFO/meteor positioning reads it. */
export function setDuneHeightProvider(fn: DuneHeightProvider): void {
  duneHeightAt = fn;
}

// ══════════════════════════════════════════════════════════════════
// Catalog
// ══════════════════════════════════════════════════════════════════

interface RareEventDefinition {
  id: string;
  achievement: string;
  avgInterval: number;
  condition: () => boolean;
  duration: number;
}

// avgInterval is the per-jump expected interval for THIS event when
// eligible — i.e. each unseen event rolls 1/avgInterval per jump.
// Sized so that a player who has earned enough coins to clear the
// shop (~1500 jumps across runs) has near-certainly seen all five.
export const RARE_EVENTS: ReadonlyArray<RareEventDefinition> = [
  {
    id: "ufo",
    achievement: "ufo-sighting",
    avgInterval: 250,
    condition: () => !state.isRaining && state.rainIntensity < 0.1,
    duration: 20,
  },
  {
    id: "santa",
    achievement: "santa-spotted",
    avgInterval: 250,
    condition: () => state.isNight && state.rainIntensity < 0.1,
    duration: 6,
  },
  {
    id: "tumbleweed",
    achievement: "tumbleweed",
    avgInterval: 200,
    condition: () => !state.isNight && state.rainIntensity < 0.1,
    duration: 25,
  },
  {
    id: "comet",
    achievement: "comet",
    avgInterval: 300,
    condition: () => state.isNight && state.rainIntensity < 0.1,
    duration: 8,
  },
  {
    id: "meteor",
    achievement: "meteor-impact",
    avgInterval: 250,
    condition: () => state.isNight && state.rainIntensity < 0.1,
    duration: 5,
  },
];

// ══════════════════════════════════════════════════════════════════
// Spawn
// ══════════════════════════════════════════════════════════════════

/**
 * Check whether to trigger a rare event on this jump. Called from
 * the Raptor entity's `onJump` callback wired in main.ts's init.
 *
 * One event at a time. Unseen events are preferred over repeats.
 * Each candidate rolls independently against its own avgInterval —
 * the previous "pick one then roll" path diluted every event's
 * effective odds by the pool size, so a 2-event pool halved each
 * event's per-jump chance.
 */
export function maybeSpawnRareEvent(): void {
  if (state.activeRareEvent) return; // one at a time
  const eligible = RARE_EVENTS.filter((e) => e.avgInterval > 0 && e.condition());
  if (eligible.length === 0) return;
  const unseen = eligible.filter((e) => !state._rareEventsSeen[e.id]);
  const pool = unseen.length > 0 ? unseen : eligible;
  // Independent per-event rolls — avgInterval is "expected jumps
  // between sightings of THIS event when eligible". If multiple
  // events succeed in the same frame, pick uniformly among them.
  const triggered = pool.filter((e) => Math.random() < 1 / e.avgInterval);
  if (triggered.length === 0) return;
  const evt = triggered[Math.floor(Math.random() * triggered.length)];
  state.activeRareEvent = {
    id: evt.id,
    age: 0,
    life: evt.duration,
    x: state.width + 50,
    y: state.height * (0.1 + Math.random() * 0.3),
  };
  // Fire the per-event SFX. The audio module respects the SFX mute
  // channel, so this is a no-op when the user has SFX off.
  if (evt.id === "ufo") audio.playUfo();
  else if (evt.id === "santa") audio.playSanta();
  else if (evt.id === "comet") audio.playComet();
  // Unlock achievement on first sighting
  if (!state._rareEventsSeen[evt.id]) {
    state._rareEventsSeen[evt.id] = 1;
    saveRareEventsSeen(state._rareEventsSeen);
    if (onAchievementUnlock) onAchievementUnlock(evt.achievement);
  }
}

// ══════════════════════════════════════════════════════════════════
// Update
// ══════════════════════════════════════════════════════════════════

export function updateRareEvent(dtSec: number): void {
  if (!state.activeRareEvent) return;
  const e = state.activeRareEvent;
  e.age += dtSec;
  // Move event across the screen (right to left for most)
  if (e.id === "tumbleweed") {
    // Tumbleweed rolls left along the dune surface, bouncing above it
    e.x -= state.width * 0.06 * dtSec; // gentle roll, crosses screen in ~18s
    const duneY = state.ground - duneHeightAt(e.x, state.duneOffset);
    const bounce = Math.abs(Math.sin(e.age * 3.5)) * 12;
    e.y = duneY - 10 - bounce;
    // End when fully off-screen left
    if (e.x < -30) e.age = e.life;
    e.rot = (e.rot || 0) - dtSec * 4; // counter-clockwise (rolling left)
  } else if (e.id === "ufo") {
    const t = e.age / e.life;
    const hoverX = state.width * 0.6;
    const hoverY = state.height * 0.35;
    if (t < 0.08) {
      // Phase 1: Fast descent
      e.x = hoverX;
      e.y = -30 + (t / 0.08) * (hoverY + 30);
      e.beam = false;
      e.phase = "descend";
    } else if (!e.targetCactus) {
      // Phase 2: Hover + beam on — wait for a cactus to scroll into
      // the beam.
      e.x = hoverX + Math.sin(e.age * 2) * 10;
      e.y = hoverY + Math.sin(e.age * 3) * 5;
      e.beam = true;
      e.phase = "search";
      // Check if any cactus is under the beam footprint (e.x ± 30)
      const duneCacti = (state as any).duneCacti;
      if (duneCacti) {
        const off = state.duneOffset;
        for (const dc of duneCacti) {
          if (dc.dead || dc.struck) continue;
          const sx = dc.wx - off;
          if (sx > e.x - 28 && sx < e.x + 28) {
            e.targetCactus = dc;
            e.abductStartAge = e.age;
            // Store position and hide original immediately
            e.abductSx = sx;
            e.abductDuneY = state.ground - duneHeightAt(sx, state.duneOffset);
            dc.dead = true;
            break;
          }
        }
      }
    } else if (e.cactusLift == null || e.cactusLift < 1) {
      // Phase 3: Beam up the cactus
      e.x = hoverX + Math.sin(e.age * 2) * 5;
      e.y = hoverY + Math.sin(e.age * 3) * 3;
      e.beam = true;
      e.phase = "abduct";
      const liftTime = 3; // seconds to beam up
      const elapsed = e.age - (e.abductStartAge || e.age);
      e.cactusLift = Math.min(1, elapsed / liftTime);
    } else if (!e._absorbed) {
      // Phase 4: Cactus absorbed, brief pause
      e.beam = false;
      e.phase = "absorbed";
      e.x = hoverX;
      e.y = hoverY;
      // Cactus already marked dead when grabbed
      e._absorbed = true;
      e._absorbedAt = e.age;
    } else {
      // Phase 5: Fly away upward-right after a brief pause
      const pauseTime = 0.5;
      const flyElapsed = e.age - (e._absorbedAt || e.age) - pauseTime;
      if (flyElapsed < 0) {
        e.x = hoverX;
        e.y = hoverY;
      } else {
        e.beam = false;
        e.phase = "flyaway";
        e.x = hoverX + flyElapsed * state.width * 0.15;
        e.y = hoverY - flyElapsed * state.height * 0.15;
        if (e.y < -60 || e.x > state.width + 60) e.age = e.life;
      }
    }
  } else if (e.id === "santa") {
    // Santa flies across the night sky left to right
    e.x = -50 + (e.age / e.life) * (state.width + 100);
    e.y = state.height * 0.12 + Math.sin(e.age * 1.5) * 8;
  } else if (e.id === "comet") {
    // Slow arc across night sky — enters right, exits left
    const ct = e.age / e.life;
    e.x = state.width * 1.3 - ct * state.width * 1.6;
    e.y = state.height * 0.05 + ct * state.height * 0.25;
  } else if (e.id === "meteor") {
    // Streak from upper-right to a specific impact point on/behind
    // the dune band.
    if (!e.startX) {
      e.startX = state.width * (0.7 + Math.random() * 0.3);
      e.startY = -10;
      e.targetX = state.width * (0.3 + Math.random() * 0.4);
      e.targetY = state.ground - duneHeightAt(e.targetX, state.duneOffset) + 3;
    }
    const mt = e.age / e.life;
    const flightT = 0.5; // first 50% is the streak, rest is impact
    if (mt < flightT) {
      const ft = mt / flightT;
      e.x = e.startX + (e.targetX - e.startX) * ft;
      e.y = e.startY + (e.targetY - e.startY) * ft;
      e.vx = (e.targetX - e.startX) / (e.life * flightT);
      e.vy = (e.targetY - e.startY) / (e.life * flightT);
    } else {
      // First frame past the flight phase — fire the explosion cue
      // exactly once per meteor, on the transition into impact.
      if (!e.impact) audio.playMeteor();
      e.impact = true;
      e.impactX = e.impactX || e.targetX;
      // Recalculate impact Y from current dune position (dunes
      // scroll).
      e.impactY =
        e.impactY || state.ground - duneHeightAt(e.impactX || e.targetX, state.duneOffset) + 3;
    }
  }
  if (e.age >= e.life) {
    stopActiveRareEventAudio();
    state.activeRareEvent = null;
  }
}

/** Stop any looping audio attached to the currently-active rare
 *  event. UFO's ~12s sample is shorter than its ~20s event window
 *  so the stop is mostly a safety net there; santa + comet both
 *  loop and would otherwise bleed into the next run forever when
 *  the player dies mid-event and updateRareEvent stops ticking.
 *
 *  Called from updateRareEvent when the event's lifetime naturally
 *  expires, AND from the game-over + resetGame paths in main.ts so
 *  a mid-event death doesn't leave the sample looping. Safe to call
 *  with no active event (no-ops when state.activeRareEvent is null
 *  or missing its `id`). */
export function stopActiveRareEventAudio(): void {
  const e = state.activeRareEvent;
  if (!e) return;
  if (e.id === "ufo") audio.stopUfo();
  else if (e.id === "santa") audio.stopSanta();
  else if (e.id === "comet") audio.stopComet();
}

// ══════════════════════════════════════════════════════════════════
// Drawing
// ══════════════════════════════════════════════════════════════════

/** Draw sky-layer rare events (comet, meteor) — on main canvas, no tint. */
/*
 * Meteor streak sprites. Both the head-glow radial gradient and the
 * trail linear gradient have fixed geometry — radius 12 for the glow,
 * length 50 for the trail. Baking them to offscreen canvases once at
 * module load (called lazily on first meteor) eliminates two
 * createRadialGradient / createLinearGradient calls per frame during
 * the streak phase. Per-frame alpha modulation happens via
 * globalAlpha at drawImage time.
 */
const METEOR_HEAD_R = 12;
const METEOR_TRAIL_LEN = 50;
let _meteorHeadSprite: HTMLCanvasElement | null = null;
let _meteorTrailSprite: HTMLCanvasElement | null = null;

function getMeteorHeadSprite(): HTMLCanvasElement {
  if (_meteorHeadSprite) return _meteorHeadSprite;
  const size = METEOR_HEAD_R * 2;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const cx = c.getContext("2d");
  if (!cx) return c;
  const mid = size / 2;
  const g = cx.createRadialGradient(mid, mid, 0, mid, mid, METEOR_HEAD_R);
  g.addColorStop(0, "rgba(255, 255, 220, 1)");
  g.addColorStop(0.4, "rgba(255, 180, 50, 0.6)");
  g.addColorStop(1, "rgba(255, 80, 0, 0)");
  cx.fillStyle = g;
  cx.beginPath();
  cx.arc(mid, mid, METEOR_HEAD_R, 0, Math.PI * 2);
  cx.fill();
  _meteorHeadSprite = c;
  return c;
}

/** Force-bake both meteor sprites. Called from init() so the first
 *  meteor event doesn't pay a sprite-bake cost during gameplay. */
export function warmMeteorSprites(): void {
  getMeteorHeadSprite();
  getMeteorTrailSprite();
  getCometHeadSprite();
}

/*
 * Comet head sprite. Bakes three concentric radial gradients
 * (outer halo, inner glow, bright core) into one RGBA sprite so the
 * per-frame draw is a single drawImage with alpha modulation, instead
 * of three createRadialGradient + arc + fill cycles. Gradients are
 * baked at alpha=1; caller scales via globalAlpha.
 */
const COMET_HEAD_R = 10;
const COMET_OUTER_R = COMET_HEAD_R * 14; // 140 — matches the renderer
let _cometHeadSprite: HTMLCanvasElement | null = null;

function getCometHeadSprite(): HTMLCanvasElement {
  if (_cometHeadSprite) return _cometHeadSprite;
  const size = COMET_OUTER_R * 2;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const cx = c.getContext("2d");
  if (!cx) return c;
  const mid = size / 2;

  // 1. Outer halo — largest radial gradient
  const g1 = cx.createRadialGradient(mid, mid, 0, mid, mid, COMET_OUTER_R);
  g1.addColorStop(0, "rgba(240, 248, 255, 0.7)");
  g1.addColorStop(0.1, "rgba(200, 225, 255, 0.35)");
  g1.addColorStop(0.3, "rgba(130, 180, 250, 0.12)");
  g1.addColorStop(1, "rgba(60, 100, 200, 0)");
  cx.fillStyle = g1;
  cx.beginPath();
  cx.arc(mid, mid, COMET_OUTER_R, 0, Math.PI * 2);
  cx.fill();

  // 2. Inner glow — tighter, brighter
  const g2 = cx.createRadialGradient(mid, mid, 0, mid, mid, COMET_HEAD_R * 4);
  g2.addColorStop(0, "rgba(255, 255, 255, 0.6)");
  g2.addColorStop(0.4, "rgba(200, 230, 255, 0.25)");
  g2.addColorStop(1, "rgba(150, 200, 255, 0)");
  cx.fillStyle = g2;
  cx.beginPath();
  cx.arc(mid, mid, COMET_HEAD_R * 4, 0, Math.PI * 2);
  cx.fill();

  // 3. Bright core
  const gc = cx.createRadialGradient(mid, mid, 0, mid, mid, COMET_HEAD_R);
  gc.addColorStop(0, "rgba(255, 255, 255, 1)");
  gc.addColorStop(0.3, "rgba(230, 245, 255, 0.95)");
  gc.addColorStop(1, "rgba(160, 210, 255, 0.65)");
  cx.fillStyle = gc;
  cx.beginPath();
  cx.arc(mid, mid, COMET_HEAD_R, 0, Math.PI * 2);
  cx.fill();

  _cometHeadSprite = c;
  return c;
}

function getMeteorTrailSprite(): HTMLCanvasElement {
  if (_meteorTrailSprite) return _meteorTrailSprite;
  // Trail is a 4px-thick horizontal line with a linear gradient along
  // its length. Bake to a thin strip; rotate + drawImage at use time.
  const lineW = 4;
  const padding = 2;
  const w = METEOR_TRAIL_LEN;
  const h = lineW + padding * 2;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const cx = c.getContext("2d");
  if (!cx) return c;
  const g = cx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, "rgba(255, 220, 80, 0.8)");
  g.addColorStop(0.3, "rgba(255, 120, 20, 0.4)");
  g.addColorStop(0.7, "rgba(220, 50, 0, 0.15)");
  g.addColorStop(1, "rgba(150, 30, 0, 0)");
  cx.strokeStyle = g;
  cx.lineWidth = lineW;
  cx.lineCap = "round";
  cx.beginPath();
  cx.moveTo(0, h / 2);
  cx.lineTo(w, h / 2);
  cx.stroke();
  _meteorTrailSprite = c;
  return c;
}

export function drawRareEventSky(ctx: CanvasRenderingContext2D) {
  if (!state.activeRareEvent) return;
  const e = state.activeRareEvent;
  if (e.id !== "comet" && e.id !== "meteor") return;
  drawRareEvent(ctx);
}

/** Draw foreground rare events (UFO, Santa, tumbleweed) — on fgCtx, gets tint. */
/** Draw the UFO beam on the background canvas so dunes paint over
 *  it. The beam's top edge is pulled up into the UFO's base — so
 *  it visually emerges from the window/aperture rather than below
 *  the hull — and a vertical gradient fades the first few pixels
 *  so the top reads as glowing emission instead of a hard-edged
 *  rectangle sitting against the sprite. */
export function drawUfoBeam(ctx: CanvasRenderingContext2D) {
  if (!state.activeRareEvent || state.activeRareEvent.id !== "ufo") return;
  const e = state.activeRareEvent;
  if (!e.beam) return;
  const ufoH = IMAGES.ufo ? 60 * (IMAGES.ufo.height / IMAGES.ufo.width) : 35;
  const scan = 0.4 + 0.2 * Math.sin(e.age * 4.5) + 0.1 * Math.sin(e.age * 7.3);
  const beamBottomL = e.x - 30;
  const beamBottomR = e.x + 30;
  // Tuck the top of the beam 8px up into the UFO body — the bottom
  // window on the sprite sits ~30% up from the hull's lower edge.
  const beamTopY = e.y + ufoH / 2 - 8;
  const beamBottomY = state.ground;
  // Gradient fade for the top ~14px so the beam feathers into the
  // hull instead of abutting it as a flat rectangle.
  const fadeLen = 14;
  const fadeStop = Math.min(1, fadeLen / Math.max(1, beamBottomY - beamTopY));
  const grad = ctx.createLinearGradient(0, beamTopY, 0, beamBottomY);
  grad.addColorStop(0, "rgba(245, 250, 255, 0)");
  grad.addColorStop(fadeStop, `rgba(245, 250, 255, ${scan})`);
  grad.addColorStop(1, `rgba(245, 250, 255, ${scan})`);
  ctx.save();
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(e.x - 10, beamTopY);
  ctx.lineTo(e.x + 10, beamTopY);
  ctx.lineTo(beamBottomR, beamBottomY);
  ctx.lineTo(beamBottomL, beamBottomY);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function drawRareEventFg(ctx: CanvasRenderingContext2D) {
  if (!state.activeRareEvent) return;
  const e = state.activeRareEvent;
  // Comet/meteor on sky canvas, tumbleweed in dune layer
  if (e.id === "comet" || e.id === "meteor" || e.id === "tumbleweed") return;
  drawRareEvent(ctx);
}

export function drawRareEvent(ctx: CanvasRenderingContext2D) {
  if (!state.activeRareEvent) return;
  const e = state.activeRareEvent;
  const t = e.age / e.life;
  let alpha = 1;
  // These events enter/exit the screen naturally — no fade
  if (e.id !== "comet" && e.id !== "meteor" && e.id !== "tumbleweed") {
    if (t < 0.1) alpha = t / 0.1;
    else if (t > 0.9) alpha = (1 - t) / 0.1;
  }

  ctx.save();
  ctx.globalAlpha = alpha;

  if (e.id === "ufo") {
    const img = IMAGES.ufo;
    const ufoW = 60,
      ufoH = img ? 60 * (img.height / img.width) : 35;
    if (img) {
      ctx.drawImage(img, e.x - ufoW / 2, e.y - ufoH / 2, ufoW, ufoH);
    }
    // Draw abducted cactus spiraling up in the beam
    if (e.phase === "abduct" && e.targetCactus && e.cactusLift != null) {
      const dc = e.targetCactus;
      const cImg = IMAGES[dc.key];
      if (cImg) {
        // Use stored grab position (cactus is already dead/hidden)
        const grabX = e.abductSx || e.x;
        const grabY = e.abductDuneY || state.ground;
        const liftT = e.cactusLift;
        const cx = grabX + (e.x - grabX) * liftT + Math.sin(e.age * 6) * 8 * (1 - liftT);
        const cy = grabY + (e.y + ufoH / 2 - grabY) * liftT;
        const cScale = 1 - liftT * 0.5; // shrinks as it gets "further"
        const cw = dc.w * cScale;
        const ch = dc.h * cScale;
        const rot = e.age * 3; // spinning
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rot);
        ctx.drawImage(cImg, -cw / 2, -ch, cw, ch);
        ctx.restore();
      }
    }
  } else if (e.id === "santa") {
    const sleighImg = IMAGES.santaSleigh;
    const deerImg = IMAGES.reindeer;
    const sleighW = 55,
      sleighH = sleighImg ? 55 * (sleighImg.height / sleighImg.width) : 30;
    const deerW = 22,
      deerH = deerImg ? 22 * (deerImg.height / deerImg.width) : 25;
    // Sleigh harness attachment — measured from sprite (165/200, 55/128)
    const harnessX = e.x + sleighW * 0.325;
    const harnessY = e.y - sleighH * 0.07;
    // Draw 2 reindeer in front, connected by curved harness lines
    const deerPositions = [];
    for (let i = 0; i < 2; i++) {
      const dx = 40 + i * 30;
      const bobY = Math.sin(e.age * 3 + i * 1.5) * 4;
      const deerX = e.x + dx;
      const deerY = e.y - 5 + bobY;
      // Collar attachment — measured from sprite (185/200, 88/274)
      const collarX = deerX + deerW * 0.425;
      const collarY = deerY - deerH * 0.179;
      deerPositions.push({ deerX, deerY, collarX, collarY, bobY });
      // Curved harness line — droops slightly between sleigh and collar
      ctx.strokeStyle = `rgba(90, 60, 35, ${0.6 * alpha})`;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(harnessX, harnessY);
      const midX = (harnessX + collarX) / 2;
      const midY = Math.max(harnessY, collarY) + 6; // droop below both points
      ctx.quadraticCurveTo(midX, midY, collarX, collarY);
      ctx.stroke();
      if (deerImg) {
        ctx.drawImage(deerImg, deerX - deerW / 2, deerY - deerH / 2, deerW, deerH);
      }
    }
    // Draw sleigh (on top of harness lines)
    if (sleighImg) {
      ctx.drawImage(sleighImg, e.x - sleighW / 2, e.y - sleighH / 2, sleighW, sleighH);
    }
    // Rudolph's red nose on the lead reindeer
    if (Math.sin(e.age * 8) > 0 && deerPositions[1]) {
      const lead = deerPositions[1];
      const noseX = lead.deerX + deerW * 0.4;
      const noseY = lead.deerY - deerH * 0.15;
      ctx.fillStyle = `rgba(255, 40, 20, ${alpha})`;
      ctx.beginPath();
      ctx.arc(noseX, noseY, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (e.id === "tumbleweed") {
    const twImg = IMAGES.tumbleweed;
    const twSize = 20;
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.rot || 0);
    if (twImg) {
      ctx.drawImage(twImg, -twSize / 2, -twSize / 2, twSize, twSize);
    }
    ctx.restore();
  } else if (e.id === "comet") {
    // "Your Name" style comet — very bright, multi-tailed, sparkly.
    const tailAngle = Math.atan2(state.height * 0.25, state.width * 1.6);
    const tailLen = state.width * 0.3;
    const _headR = COMET_HEAD_R;
    const a = alpha;

    // Head — single drawImage of the pre-baked triple-gradient sprite
    // (outer halo + inner glow + bright core baked on top of each other).
    // Replaces 3 createRadialGradient calls per frame.
    const headSprite = getCometHeadSprite();
    ctx.save();
    ctx.globalAlpha = a;
    ctx.drawImage(
      headSprite,
      e.x - COMET_OUTER_R,
      e.y - COMET_OUTER_R,
      COMET_OUTER_R * 2,
      COMET_OUTER_R * 2,
    );
    ctx.restore();

    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(tailAngle);

    // Tail helper
    const _ct = (
      c0: string,
      c1: string,
      c2: string,
      w: number,
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      ex: number,
      ey: number,
    ) => {
      const g = ctx.createLinearGradient(0, 0, ex, 0);
      g.addColorStop(0, c0);
      g.addColorStop(0.35, c1);
      g.addColorStop(1, c2);
      ctx.strokeStyle = g;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(x1, y1, x2, y2, ex, ey);
      ctx.stroke();
    };
    const L = tailLen;
    // Main blue-white dust tail
    _ct(
      `rgba(200,225,255,${0.75 * a})`,
      `rgba(130,180,250,${0.3 * a})`,
      "rgba(70,120,210,0)",
      9,
      L * 0.3,
      -10,
      L * 0.6,
      -18,
      L,
      -30,
    );
    // Cyan ion tail
    _ct(
      `rgba(0,250,255,${0.6 * a})`,
      `rgba(50,210,250,${0.25 * a})`,
      "rgba(30,140,230,0)",
      3,
      L * 0.4,
      5,
      L * 0.9,
      8,
      L * 1.4,
      6,
    );
    // Bright crimson
    _ct(
      `rgba(255,60,35,${0.5 * a})`,
      `rgba(230,35,20,${0.18 * a})`,
      "rgba(150,10,5,0)",
      5,
      L * 0.2,
      -20,
      L * 0.55,
      -38,
      L * 1.15,
      -55,
    );
    // Deep red
    _ct(
      `rgba(190,25,12,${0.3 * a})`,
      `rgba(140,12,8,${0.1 * a})`,
      "rgba(80,5,5,0)",
      3,
      L * 0.15,
      -28,
      L * 0.4,
      -50,
      L * 0.85,
      -70,
    );
    // Warm orange wisp
    _ct(
      `rgba(255,170,60,${0.3 * a})`,
      `rgba(230,110,30,${0.1 * a})`,
      "rgba(180,60,10,0)",
      2.5,
      L * 0.35,
      -6,
      L * 0.65,
      -14,
      L,
      -22,
    );

    // Sparkles — cover the full x/y extent of all tails,
    // similar blink frequency but very different phase offsets,
    // some detaching and lingering in the sky.
    for (let i = 0; i < 30; i++) {
      const h1 = Math.sin(i * 73.1 + 3.7) * 0.5 + 0.5;
      const h2 = Math.sin(i * 127.3 + 17.1) * 0.5 + 0.5;
      const h3 = Math.sin(i * 31.7 + 91.3) * 0.5 + 0.5;
      const h4 = Math.sin(i * 211.9 + 47.3) * 0.5 + 0.5;

      // Position along the tail (0-1)
      const along = h1 * 0.95 + 0.03;
      const baseX = along * L;
      // Y range covers the full tail fan: from +8 (ion tail)
      // down to -70 (deep red tail), scattered by h2
      const yTop = 8 * along; // ion tail top
      const yBot = -15 * along - 55 * along * along; // deep red bottom
      const sy0 = yTop + (yBot - yTop) * h2; // spread across full fan
      let sx = baseX + (h3 - 0.5) * 15;
      let sy = sy0;

      // 30% detach and drift away
      const detaches = h3 > 0.7;
      if (detaches) {
        const driftAge = Math.max(0, e.age - h4 * e.life * 0.5);
        sx += driftAge * 6 * (h2 - 0.4);
        sy += driftAge * 4 * (h4 - 0.5);
        const driftFade = Math.max(0, 1 - driftAge * 0.7);
        if (driftFade < 0.05) continue;
      }

      // Similar blink speed (4.5-6 Hz) but wildly different offsets
      const blinkSpeed = 4.5 + h4 * 1.5;
      const blinkPhase = h1 * 17.3 + h2 * 11.7; // large spread
      const blink = Math.max(0, Math.sin(e.age * blinkSpeed + blinkPhase)) ** 5;
      const baseBright = detaches ? 0.6 : 1;
      const sa = (1 - along * 0.5) * blink * a * baseBright;
      if (sa < 0.05) continue;

      const sr = 1.5 + (1 - along) * 2.5 + h4 * 1.5;
      const ci = i % 5;
      const sC = ["255,255,255", "200,240,255", "255,180,170", "255,230,200", "160,250,255"][ci];
      ctx.strokeStyle = `rgba(${sC},${sa})`;
      ctx.fillStyle = `rgba(${sC},${sa})`;
      const shape = Math.floor(h4 * 3);
      if (shape === 0) {
        // 4-pointed cross
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx, sy - sr * 1.3);
        ctx.lineTo(sx, sy + sr * 1.3);
        ctx.moveTo(sx - sr * 1.3, sy);
        ctx.lineTo(sx + sr * 1.3, sy);
        ctx.stroke();
      } else if (shape === 1) {
        // 6-pointed star
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(sx, sy - sr);
        ctx.lineTo(sx, sy + sr);
        ctx.moveTo(sx - sr * 0.87, sy - sr * 0.5);
        ctx.lineTo(sx + sr * 0.87, sy + sr * 0.5);
        ctx.moveTo(sx - sr * 0.87, sy + sr * 0.5);
        ctx.lineTo(sx + sr * 0.87, sy - sr * 0.5);
        ctx.stroke();
      } else {
        // Bright dot
        ctx.beginPath();
        ctx.arc(sx, sy, sr * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      // Soft glow around each sparkle
      ctx.fillStyle = `rgba(${sC},${sa * 0.25})`;
      ctx.beginPath();
      ctx.arc(sx, sy, sr * 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  } else if (e.id === "meteor") {
    if (!e.impact) {
      const streakLen = METEOR_TRAIL_LEN;
      const angle = Math.atan2(e.vy || 1, e.vx || -0.5);
      // Head glow — baked sprite, drawn with globalAlpha for per-frame
      // alpha modulation (same trick as the moon halo).
      const headSprite = getMeteorHeadSprite();
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.drawImage(
        headSprite,
        e.x - METEOR_HEAD_R,
        e.y - METEOR_HEAD_R,
        METEOR_HEAD_R * 2,
        METEOR_HEAD_R * 2,
      );
      ctx.restore();
      // Trail — baked sprite, rotated into place.
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(angle + Math.PI);
      const trailSprite = getMeteorTrailSprite();
      ctx.globalAlpha = alpha;
      // trailSprite is (streakLen × 8) with the line centered vertically;
      // we want the stroke centered on y=0, so draw at y=-h/2.
      ctx.drawImage(trailSprite, 0, -trailSprite.height / 2, streakLen, trailSprite.height);
      ctx.globalAlpha = 1;
      // Sparks flying off
      for (let i = 0; i < 6; i++) {
        const sx = Math.random() * streakLen * 0.7;
        const sy = (Math.random() - 0.5) * 10;
        ctx.fillStyle = `rgba(255, ${120 + Math.random() * 135}, ${Math.random() * 40}, ${0.7 * alpha})`;
        ctx.beginPath();
        ctx.arc(sx, sy, 0.8 + Math.random() * 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    } else {
      // Impact — particle-based fireball + mushroom cloud
      const it = (e.age / e.life - 0.5) / 0.5;
      const ix = e.impactX,
        iy = e.impactY;
      const S = 1.3; // scale factor

      // Initial flash (first 15% of impact)
      if (it < 0.2) {
        const fa = (1 - it / 0.2) * alpha;
        ctx.fillStyle = `rgba(255, 255, 200, ${fa * 0.4})`;
        ctx.beginPath();
        ctx.arc(ix, iy, (40 + it * 100) * S, 0, Math.PI * 2);
        ctx.fill();
      }

      // Fireball particles — many small circles rising and expanding
      const particleCount = 20;
      for (let i = 0; i < particleCount; i++) {
        const pt = Math.min(1, it * 1.5 + i * 0.02);
        if (pt < 0 || pt > 1) continue;
        // Each particle rises and expands
        const seed = Math.sin(i * 73.7 + 31.1) * 0.5 + 0.5;
        const seed2 = Math.sin(i * 127.3 + 89.9) * 0.5 + 0.5;
        const px = ix + (seed - 0.5) * 40 * S * pt;
        const py = iy - pt * (30 + seed2 * 50) * S;
        const pr = (3 + pt * (4 + seed * 6)) * S;
        const pa = Math.max(0, 1 - pt * 1.2) * alpha;
        if (pa < 0.02) continue;
        // Color: white→yellow→orange→dark as particle ages
        // biome-ignore lint/suspicious/noImplicitAnyLet: auto-suppressed during biome 2.x bump
        let r, g, b;
        if (pt < 0.2) {
          r = 255;
          g = 240;
          b = 200;
        } else if (pt < 0.5) {
          const k = (pt - 0.2) / 0.3;
          r = 255;
          g = Math.round(240 - k * 120);
          b = Math.round(200 - k * 170);
        } else {
          const k = (pt - 0.5) / 0.5;
          r = Math.round(255 - k * 155);
          g = Math.round(120 - k * 80);
          b = Math.round(30 - k * 20);
        }
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${pa})`;
        ctx.beginPath();
        ctx.arc(px, py, pr, 0, Math.PI * 2);
        ctx.fill();
      }

      // Smoke column — darker particles rising higher, slower
      const smokeCount = 12;
      for (let i = 0; i < smokeCount; i++) {
        const st = Math.min(1, it * 1.2 - 0.1 + i * 0.03);
        if (st < 0 || st > 1) continue;
        const seed = Math.sin(i * 47.3 + 17.7) * 0.5 + 0.5;
        const spx = ix + (seed - 0.5) * 20 * S * st;
        const spy = iy - st * (60 + seed * 40) * S;
        const spr = (4 + st * 8) * S;
        const spa = Math.max(0, 0.8 - st) * alpha * 0.35;
        if (spa < 0.02) continue;
        ctx.fillStyle = `rgba(60, 50, 40, ${spa})`;
        ctx.beginPath();
        ctx.arc(spx, spy, spr, 0, Math.PI * 2);
        ctx.fill();
      }

      // Mushroom cap — cluster of overlapping smoke puffs at the top
      const capY = iy - (60 * Math.min(1, it * 1.3) + 30) * S;
      const capA = Math.max(0, 1 - it * 1.8) * alpha * 0.3;
      if (capA > 0.02) {
        for (let i = 0; i < 7; i++) {
          const seed = Math.sin(i * 31.7 + 5.3) * 0.5 + 0.5;
          const cpx = ix + (seed - 0.5) * 40 * S;
          const cpy = capY + Math.sin(i * 2.1) * 6;
          ctx.fillStyle = `rgba(70, 55, 40, ${capA})`;
          ctx.beginPath();
          ctx.arc(cpx, cpy, (10 + seed * 8) * S, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  ctx.restore();
}
