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
  RAINBOW_LIFETIME_SEC,
  SKY_COLORS,
  VELOCITY_SCALE_DIVISOR,
} from "./constants";
import { COSMETIC_SLOTS, COSMETICS, equipCosmetic, grantCosmetic, unequipSlot } from "./cosmetics";
import { resetRain, strikeLightning } from "./effects/weather";
import type { Cactuses } from "./entities/cactus";
import type { Raptor } from "./entities/raptor";
import { lerpColor } from "./helpers";
import { computeSkyGradient } from "./render/sky";
import { state } from "./state";

export interface TrailerHost {
  raptor: () => Raptor;
  cactuses: () => Cactuses;
  start: () => void;
}

type RainMode = "off" | "build" | "full" | "stopping";

export function installTrailerHooks(host: TrailerHost): void {
  let phaseRate = 0; // day cycles per second while the phase is locked
  let autopilot = true;
  let allowEvents = false;
  let allowBreathers = false;
  let rain: RainMode = "off";
  let speed: number | null = null;
  let strikes = 0;
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
    const base = Math.floor(state.smoothPhase);
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

  /** Jump so the apex lands over the next cactus or low pterodactyl. */
  const drive = () => {
    const r = host.raptor();
    if (!autopilot || r.y !== r.ground || state.gameOver) return;
    const a = r.downwardAcceleration;
    if (!(a > 0)) return;
    const airFrames = 2 * Math.sqrt((2 * r.h * JUMP_CLEARANCE_MULTIPLIER) / a);
    const pxPerFrame = state.bgVelocity * (state.width / VELOCITY_SCALE_DIVISOR);
    const mid = r.x + r.w * 0.55;
    const c = host.cactuses();
    const ahead = [...c.cacti, ...c.pterodactyls.pteros.filter((p) => p.isLowFlight)].filter(
      (o) => o.x + o.w > r.x,
    );
    for (const o of ahead) {
      const prev = lastX.get(o);
      lastX.set(o, o.x);
      const closing = prev === undefined ? pxPerFrame : Math.max(pxPerFrame, prev - o.x);
      const d = o.x + o.w / 2 - mid;
      if (d > 0 && d <= (airFrames * closing) / 2) {
        r.jump();
        return;
      }
    }
  };

  const beforeFrame = (dtMs: number) => {
    if (phaseRate && state.cinematicPhaseLock !== null) {
      state.cinematicPhaseLock += (phaseRate * dtMs) / 1000;
    }
    if (rain === "off" && state.isRaining) setRain("off");
    if (
      (rain === "build" || rain === "full") &&
      state.lightning.nextAt !== Number.POSITIVE_INFINITY
    ) {
      state.lightning.nextAt = Number.POSITIVE_INFINITY;
    }
    if (!allowEvents) state.activeRareEvent = null;
    if (!allowBreathers) state._nextBreatherAtScore = state.score + 1e9;
    if (speed !== null) state.bgVelocity = speed;
    drive();
  };

  /** Render one frame; returns run counters so the recorder can log events. */
  const step = (dtMs = 1000 / 60) => {
    beforeFrame(dtMs);
    (window as unknown as { __rafStep: (dt: number) => number }).__rafStep(dtMs);
    return { coins: state.runCoins, jumps: state.runJumps, strikes };
  };

  const api = {
    /** Start a run with every cosmetic owned and nothing equipped. */
    begin() {
      document.body.classList.add("cinematic-mode");
      for (const c of COSMETICS) grantCosmetic(c.id, { autoEquip: false });
      outfit([]);
      host.start();
      state.noCollisions = true;
      setRain("off");
    },
    step,
    advance(ms: number, dtMs = 1000 / 60) {
      for (let left = ms; left > 0; left -= dtMs) step(Math.min(dtMs, left));
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
