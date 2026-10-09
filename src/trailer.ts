// Trailer director (dev only, `?trailer=1`). Exposes `window.__trailer` so
// scripts/record-trailer-shots.mjs can stage a shot deterministically: lock
// or sweep the time of day, dress the raptor, start or stop a storm, land a
// lightning strike on a chosen frame, open a flower field, and let an
// autopilot jump the cacti so the run looks played rather than ghosted
// through obstacles.
//
// Each frame the recorder calls `__trailer.step(dt)`, which applies the
// director's per-frame rules and then renders one frame on the virtual
// clock from src/headlessRaf.ts. Nothing here runs in production: main.ts
// only imports this module behind `import.meta.env.DEV`.

import {
  INITIAL_BG_VELOCITY,
  JUMP_CLEARANCE_MULTIPLIER,
  RAIN_FADE_IN_RATE,
  RAIN_FADE_OUT_RATE,
  RAINBOW_LIFETIME_SEC,
  RAPTOR_IDLE_FRAME,
  SKY_COLORS,
  VELOCITY_SCALE_DIVISOR,
} from "./constants";
import { COSMETIC_SLOTS, COSMETICS, equipCosmetic, grantCosmetic, unequipSlot } from "./cosmetics";
import { maybeSpawnShootingStar } from "./effects/particles";
import { resetRain, strikeLightning } from "./effects/weather";
import type { Cactuses } from "./entities/cactus";
import type { Raptor } from "./entities/raptor";
import { lerpColor, type Polygon, polygonsOverlap } from "./helpers";
import { computeSkyGradient } from "./render/sky";
import { state } from "./state";

export interface TrailerHost {
  raptor: () => Raptor;
  cactuses: () => Cactuses;
  start: () => void;
}

type RainMode = "off" | "build" | "full" | "stopping" | "ramp";

const smoothstep = (t: number) => t * t * (3 - 2 * t);

export function installTrailerHooks(host: TrailerHost): void {
  let phaseRate = 0; // day cycles per second while the phase is locked
  let autopilot = true;
  let allowEvents = false;
  let allowBreathers = false;
  let rain: RainMode = "off";
  let speed: number | null = null;
  let strikes = 0;
  let ramp: { from: number; to: number; t: number; seconds: number } | null = null;
  let standX: number | null = null;
  let cloudRate = 0; // screen widths per second while standing
  let clearObstacles = false;
  let noPterodactyls = false;
  let revealOnGameOver = false;
  let raptorX: number | null = null;
  // Last seen x per obstacle: pterodactyls fly toward the raptor faster
  // than the ground scrolls, so the jump lead uses each one's own speed.
  const lastX = new WeakMap<object, number>();

  const snapSky = () => {
    const frac = ((state.smoothPhase % 1) + 1) % 1;
    const bandF = frac * SKY_COLORS.length;
    const bandIndex = Math.floor(bandF);
    const next = (bandIndex + 1) % SKY_COLORS.length;
    let sky = lerpColor(SKY_COLORS[bandIndex], SKY_COLORS[next], bandF - bandIndex);
    if (state.rainIntensity > 0) sky = lerpColor(sky, [55, 60, 68], 0.7 * state.rainIntensity);
    state.currentSky = sky;
    computeSkyGradient();
  };

  /** Lock the day cycle at `phase` (0..1, see CINEMATIC_PHASES). */
  const setPhase = (phase: number, { snap = true, rate = 0 } = {}) => {
    // Cycle 1 or later: shooting stars only start on the second night.
    const base = Math.max(1, Math.floor(state.smoothPhase));
    state.cinematicPhaseLock = base + phase;
    state.smoothPhase = state.cinematicPhaseLock;
    state.lastCycleIndex = Math.floor(state.smoothPhase);
    state.lastMoonZenithCycle = Math.floor(state.smoothPhase - 10 / 16);
    phaseRate = rate;
    if (snap) snapSky();
  };

  /** Equip exactly these cosmetics; every other slot is left bare. */
  const outfit = (ids: string[]) => {
    for (const slot of COSMETIC_SLOTS) unequipSlot(slot);
    for (const id of ids) equipCosmetic(id);
  };

  const setRain = (mode: RainMode) => {
    rain = mode;
    if (mode === "off") {
      state.isRaining = false;
      resetRain();
      state.rainIntensity = 0;
      state.rainbow = null;
      state.lightning = { alpha: 0, nextAt: 0 };
      return;
    }
    if (mode === "stopping") {
      // The natural rainbow roll fires once the downpour thins out;
      // _debugRainStop makes that roll a certainty.
      state.isRaining = false;
      state.rainEndPhase = 0;
      state._debugRainStop = true;
      return;
    }
    state.isRaining = true;
    state.rainEndPhase = state.smoothPhase + 100;
    if (mode === "full") state.rainIntensity = 1;
    // Keep random strikes out of the shot; the recorder places them.
    state.lightning.nextAt = Number.POSITIVE_INFINITY;
  };

  // ── Autopilot ────────────────────────────────────────────────────
  // Simulates the raptor's jump arc against every obstacle's collision
  // outline and jumps on the frame that gives the widest clearance, so a
  // take never clips a cactus or flies into a high pterodactyl. Outlines
  // are reduced to per-column top/bottom profiles (BIN px wide), which is
  // cheap enough to test dozens of jump timings every frame.
  const BIN = 6;
  const SAFE = 6; // px of clearance treated as a clean pass
  type Profile = { x0: number; top: number[]; bot: number[] };
  const profile = (poly: Polygon): Profile => {
    let x0 = Number.POSITIVE_INFINITY;
    let x1 = Number.NEGATIVE_INFINITY;
    for (const p of poly) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
    }
    const n = Math.max(1, Math.ceil((x1 - x0) / BIN) + 1);
    const top = new Array<number>(n).fill(Number.POSITIVE_INFINITY);
    const bot = new Array<number>(n).fill(Number.NEGATIVE_INFINITY);
    const mark = (x: number, y: number) => {
      const i = Math.min(n - 1, Math.max(0, Math.floor((x - x0) / BIN)));
      if (y < top[i]) top[i] = y;
      if (y > bot[i]) bot[i] = y;
    };
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const steps = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / (BIN / 2)));
      for (let k = 0; k <= steps; k++) {
        mark(p.x + ((q.x - p.x) * k) / steps, p.y + ((q.y - p.y) * k) / steps);
      }
    }
    return { x0, top, bot };
  };

  /** Smallest vertical gap between raptor and obstacle where they overlap. */
  const gap = (r: Profile, dy: number, o: Profile, dx: number): number => {
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < r.top.length; i++) {
      if (r.top[i] === Number.POSITIVE_INFINITY) continue;
      const j = Math.floor((r.x0 + i * BIN - (o.x0 + dx)) / BIN);
      if (j < 0 || j >= o.top.length || o.top[j] === Number.POSITIVE_INFINITY) continue;
      const sep = Math.max(o.top[j] - (r.bot[i] + dy), r.top[i] + dy - o.bot[j]);
      if (sep < best) best = sep;
    }
    return best;
  };

  /** `fs`: this step's length in 60 fps frames (the game's frameScale). */
  const drive = (fs: number) => {
    const r = host.raptor();
    const c = host.cactuses();
    const pxPerStep = state.bgVelocity * (state.width / VELOCITY_SCALE_DIVISOR) * fs;
    const obstacles = [...c.cacti, ...c.pterodactyls.pteros]
      .filter((o) => o.x + o.w > r.x)
      .map((o) => {
        const prev = lastX.get(o);
        lastX.set(o, o.x);
        const closing = prev === undefined ? pxPerStep : Math.max(pxPerStep, prev - o.x);
        return { o, closing };
      });
    // A sliver of a step (a fast-forward's remainder) can't time a jump.
    if (!autopilot || fs < 0.25 || r.y !== r.ground || state.gameOver || obstacles.length === 0) {
      return;
    }
    const a = r.downwardAcceleration;
    if (!(a > 0)) return;
    const v0 = Math.sqrt(2 * a * r.h * JUMP_CLEARANCE_MULTIPLIER);
    const air = Math.ceil((2 * v0) / (a * fs)) + 1;
    // Airborne the game switches to the idle pose's outline. The polygon
    // is cached per frame, so clear the cache around the probe.
    const cache = r as unknown as { _polyCache: unknown };
    const raptor = profile(r.collisionPolygon());
    const groundY = r.y;
    r.y = groundY - 1;
    cache._polyCache = null;
    const raptorAir = profile(r.collisionPolygon());
    r.y = groundY;
    cache._polyCache = null;
    const near = obstacles
      .filter(({ o, closing }) => o.x - (r.x + r.w) < closing * (air + 40))
      .map(({ o, closing }) => ({ p: profile(o.collisionPolygon()), closing }));
    if (near.length === 0) return;
    const LATEST = Math.ceil(30 / fs);
    const horizon = air + LATEST + 10;
    // A jump is judged until just after it lands: the next obstacle gets
    // its own jump once the raptor is back on the ground.
    const clearance = (jumpAt: number | null) => {
      let worst = Number.POSITIVE_INFINITY;
      const until = jumpAt === null ? horizon : jumpAt + air + Math.ceil(3 / fs);
      for (let t = 1; t <= until; t++) {
        let dy = 0;
        if (jumpAt !== null && t > jumpAt) {
          const n = t - jumpAt;
          dy = Math.min(0, -v0 * fs * n + (a * fs * fs * n * (n + 1)) / 2);
        }
        for (const { p, closing } of near) {
          const g = gap(dy < 0 ? raptorAir : raptor, dy, p, -closing * t);
          if (g < worst) worst = g;
        }
      }
      return worst;
    };
    if (clearance(null) >= SAFE) return;
    let bestAt = 0;
    let best = Number.NEGATIVE_INFINITY;
    for (let k = 0; k <= LATEST; k++) {
      const g = clearance(k);
      if (g > best + 0.5) {
        best = g;
        bestAt = k;
      }
    }
    if (bestAt === 0) r.jump();
  };

  // The game eases rainIntensity toward 0 or 1 inside update(). Pre-
  // compensate for that step so the value it renders is the ramp's.
  const applyRamp = (dtMs: number) => {
    if (!ramp) return;
    ramp.t = Math.min(ramp.seconds, ramp.t + dtMs / 1000);
    const k = ramp.seconds > 0 ? smoothstep(ramp.t / ramp.seconds) : 1;
    const want = ramp.from + (ramp.to - ramp.from) * k;
    const fs = (dtMs / 1000) * 60;
    const raining = ramp.to >= ramp.from;
    state.isRaining = raining;
    if (raining) {
      state.rainEndPhase = state.smoothPhase + 100;
      const a = RAIN_FADE_IN_RATE * fs;
      state.rainIntensity = Math.max(0, (want - a) / (1 - a));
    } else {
      state.rainEndPhase = 0;
      state.rainIntensity = want / (1 - RAIN_FADE_OUT_RATE * fs);
    }
    if (ramp.t >= ramp.seconds && ramp.to === 0) {
      ramp = null;
      rain = "stopping";
    }
  };

  const beforeFrame = (dtMs: number) => {
    if (phaseRate && state.cinematicPhaseLock !== null) {
      state.cinematicPhaseLock += (phaseRate * dtMs) / 1000;
    }
    if (rain === "off" && state.isRaining) setRain("off");
    if (ramp) applyRamp(dtMs);
    if (
      (rain === "build" || rain === "full") &&
      state.lightning.nextAt !== Number.POSITIVE_INFINITY
    ) {
      state.lightning.nextAt = Number.POSITIVE_INFINITY;
    }
    if (!allowEvents) state.activeRareEvent = null;
    if (!allowBreathers) state._nextBreatherAtScore = state.score + 1e9;
    if (speed !== null) state.bgVelocity = speed;
    if (noPterodactyls) {
      // Claim the last spawn was a pterodactyl: the spawner then never rolls
      // one (and so never leaves the coin it hangs under a flyer). Clearing
      // flyers after the fact left that coin floating over empty sand.
      const c = host.cactuses() as unknown as { _prevSpawnWasPtero: boolean };
      c._prevSpawnWasPtero = true;
      host.cactuses().pterodactyls.pteros.length = 0;
    }
    if (revealOnGameOver && state.gameOver) {
      // Show the game's own game-over screen the moment the run ends, in a
      // take that ran without overlays. The start screen was never
      // dismissed through the UI, so hide it the way ui.ts does.
      revealOnGameOver = false;
      document.getElementById("start-screen")?.classList.add("hidden");
      document.body.classList.remove("cinematic-mode");
    }
    if (clearObstacles) {
      // An open desert: drop each cactus, pterodactyl and coin as it
      // spawns (in place: the game holds these arrays across frames).
      const c = host.cactuses();
      c.cacti.length = 0;
      c.pterodactyls.pteros.length = 0;
      if (state.coins) state.coins.length = 0;
    }
    if (raptorX !== null) host.raptor().x = state.width * raptorX;
    if (standX !== null) {
      // Hold the standing pose: an infinite last-advance time stops the
      // run cycle from stepping on the next update.
      const r = host.raptor();
      r.x = state.width * standX;
      r.frame = RAPTOR_IDLE_FRAME;
      r.lastFrameAdvanceAt = Number.POSITIVE_INFINITY;
      // Time-lapse clouds: the world is frozen, so they race on their own.
      for (const c of state.clouds) c.x -= state.width * cloudRate * (dtMs / 1000);
    } else {
      drive((dtMs / 1000) * 60);
    }
  };

  /** Render one frame; returns run counters so the recorder can log events. */
  const step = (dtMs = 1000 / 60) => {
    beforeFrame(dtMs);
    (window as unknown as { __rafStep: (dt: number) => number }).__rafStep(dtMs);

    const r = host.raptor();
    // Did the raptor pass through an obstacle this frame? (Collisions are
    // off in most takes, so the recorder logs it as a "clip" event.)
    const c = host.cactuses();
    const rp = r.collisionPolygon();
    const hit = [...c.cacti, ...c.pterodactyls.pteros].find(
      (o) => o.x < r.x + r.w && o.x + o.w > r.x && polygonsOverlap(rp, o.collisionPolygon()),
    );
    const clip = !hit
      ? false
      : "isLowFlight" in hit
        ? hit.isLowFlight
          ? "low pterodactyl"
          : "high pterodactyl"
        : "cactus";
    return {
      clip,
      coins: state.runCoins,
      jumps: state.runJumps,
      strikes,
      // Pose for match cuts: run-cycle frame and height above ground in
      // raptor heights.
      frame: r.frame,
      air: Number(((r.ground - r.y) / r.h).toFixed(3)),
      over: state.gameOver,
      // On a flower field (grass span under the raptor's feet)?
      grass: (state.grassFields ?? []).some(
        (g: { startX: number; endX: number }) =>
          g.startX < r.x + r.w * 0.6 && g.endX > r.x + r.w * 0.4,
      ),
      speed: Number(state.bgVelocity.toFixed(2)),
    };
  };

  const api = {
    /** Start a run with every cosmetic owned and nothing equipped. */
    /** Start a run with every cosmetic owned and nothing equipped. With
     *  `hud`, the game's own overlays stay visible (score, game over). */
    begin({ hud = false } = {}) {
      if (!hud) document.body.classList.add("cinematic-mode");
      for (const c of COSMETICS) grantCosmetic(c.id, { autoEquip: false });
      outfit([]);
      host.start();
      state.noCollisions = true;
      setRain("off");
    },
    step,
    advance(ms: number, dtMs = 1000 / 60) {
      // Whole frames only: a floating-point remainder would be a near-zero step.
      const frames = Math.round(ms / dtMs);
      for (let i = 0; i < frames; i++) step(dtMs);
    },
    setPhase,
    outfit,
    rain: setRain,
    strike() {
      strikeLightning(performance.now());
      strikes++;
      state.lightning.nextAt = Number.POSITIVE_INFINITY;
    },
    /** Moon phase, 0 = new, 0.5 = full. */
    moon(phase: number) {
      state.moonPhase = phase;
    },
    /** Ease the rain intensity to `to` (0..1) over `seconds`, slower and
     *  smoother than the game's own fades. Easing to 0 lets the
     *  rainbow roll fire as the rain thins out. */
    rainRamp(to: number, seconds: number) {
      rain = "ramp";
      ramp = { from: state.rainIntensity, to, t: 0, seconds };
      state.lightning.nextAt = Number.POSITIVE_INFINITY;
      if (to < state.rainIntensity) state._debugRainStop = true;
    },
    /** Freeze the world and stand the raptor at `x` (fraction of the
     *  width) for a time-lapse; null runs again. */
    stand(x: number | null, clouds = 0.2) {
      standX = x;
      cloudRate = clouds;
      speed = x === null ? null : 0;
      if (x !== null) state.bgVelocity = 0;
    },
    /** One shooting star now (night sky only). */
    shootingStar() {
      maybeSpawnShootingStar(1e6);
    },
    rainbow() {
      state.rainbow = { age: 0, life: RAINBOW_LIFETIME_SEC };
    },
    breather() {
      allowBreathers = true;
      host.cactuses().forceBreather();
    },
    pterodactyl() {
      host.cactuses().forcePterodactyl();
    },
    /** Pin the scroll speed (INITIAL_BG_VELOCITY is a fresh run). */
    speed(v: number | null) {
      speed = v;
      if (v !== null) state.bgVelocity = v;
    },
    /** Pin the raptor's x (fraction of the width; < 0 is off screen, for
     *  sky-only background plates); null puts it back under the game. */
    raptorAt(x: number | null) {
      raptorX = x;
      if (x === null) host.raptor().resize();
    },
    /** Open desert: no cacti, pterodactyls or coins. */
    obstacles(on: boolean) {
      clearObstacles = !on;
    },
    /** Set the run's distance without firing its milestone unlocks. */
    score(meters: number) {
      state.score = meters;
    },
    /** Let the next obstacle end the run (autopilot off, collisions on);
     *  the game-over screen appears when it does. */
    crash() {
      autopilot = false;
      state.noCollisions = false;
      revealOnGameOver = true;
    },
    /** No pterodactyls (cacti stay). */
    pterodactyls(on: boolean) {
      noPterodactyls = !on;
    },
    autopilot(on: boolean) {
      autopilot = on;
    },
    events(on: boolean) {
      allowEvents = on;
    },
    info() {
      const c = host.cactuses();
      return {
        phase: state.smoothPhase,
        rain: state.rainIntensity,
        rainbow: !!state.rainbow,
        score: state.score,
        speed: state.bgVelocity,
        cacti: c.cacti.length,
        pteros: c.pterodactyls.pteros.length,
        coins: state.runCoins,
        flowers: state.flowerPatches?.length ?? 0,
        equipped: { ...state.equippedCosmetics },
        initialSpeed: INITIAL_BG_VELOCITY,
      };
    },
  };
  (window as unknown as { __trailer: typeof api }).__trailer = api;
}
