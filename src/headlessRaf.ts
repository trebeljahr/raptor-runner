// Headless capture clock (dev only). Hidden and headless browser tabs
// throttle or suspend requestAnimationFrame, so `?headless=1` replaces it
// with a fully virtual clock: the trailer recorder renders an exact frame,
// captures it, and only then advances time. Software canvas rendering can be
// far slower than real time and the clip still plays back smoothly.
//
// One virtual clock backs both performance.now() and the rAF timestamps, so
// the game's delta-time integration and its frame-time checks stay in step.
// Capture code drives it through `window.__rafStep(dtMs)` (advance and render
// one frame) or `window.__advance(ms)` (several frames, no capture).
//
// Imported first in main.ts so the shims exist before any module reads the
// clock. The DEV gate dead-codes the whole file out of production builds.

if (
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("headless") === "1"
) {
  let vnow = performance.now();
  performance.now = () => vnow;

  const queue = new Map<number, FrameRequestCallback>();
  let nextId = 1;
  window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    const id = nextId++;
    queue.set(id, cb);
    return id;
  };
  window.cancelAnimationFrame = (id: number): void => {
    queue.delete(id);
  };

  // The game pauses itself on visibilitychange and blur. Report "visible"
  // so a hidden capture tab never trips that path.
  try {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  } catch {
    /* getters already locked */
  }

  const flush = (): number => {
    const batch = [...queue.values()];
    queue.clear();
    for (const cb of batch) cb(vnow);
    return batch.length;
  };

  const step = (dtMs = 1000 / 60): number => {
    vnow += dtMs;
    return flush();
  };

  const advance = (ms: number, dtMs = 1000 / 60): number => {
    let frames = 0;
    for (let remaining = ms; remaining > 0; remaining -= dtMs) {
      step(Math.min(dtMs, remaining));
      frames++;
    }
    return frames;
  };

  const api = window as unknown as {
    __rafFlush: () => number;
    __rafStep: (dtMs?: number) => number;
    __advance: (ms: number, dtMs?: number) => number;
    __vnow: () => number;
  };
  api.__rafFlush = flush;
  api.__rafStep = step;
  api.__advance = advance;
  api.__vnow = () => vnow;
}

export {};
