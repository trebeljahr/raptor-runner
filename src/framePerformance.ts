/** Bounded debug measurements. CPU timings exclude asynchronous GPU/audio work;
 * RAF intervals capture the frame cadence the player actually sees. */
export class FramePerformance {
  private intervals = new Float64Array(120);
  private updates = new Float64Array(120);
  private renders = new Float64Array(120);
  private index = 0;
  private count = 0;
  private previous: number | null = null;

  reset(): void {
    this.index = this.count = 0;
    this.previous = null;
  }

  record(now: number, update: number, render: number): void {
    if (this.previous !== null) {
      this.intervals[this.index] = Math.max(0, now - this.previous);
      this.updates[this.index] = update;
      this.renders[this.index] = render;
      this.index = (this.index + 1) % this.intervals.length;
      this.count = Math.min(this.count + 1, this.intervals.length);
    }
    this.previous = now;
  }

  summary() {
    const sorted = Array.from(this.intervals.subarray(0, this.count)).sort((a, b) => a - b);
    let interval = 0,
      update = 0,
      render = 0,
      spikes = 0;
    for (let i = 0; i < this.count; i++) {
      interval += this.intervals[i];
      update += this.updates[i];
      render += this.renders[i];
      if (this.intervals[i] > 25) spikes++;
    }
    const n = this.count || 1;
    return {
      fps: interval > 0 ? (1000 * this.count) / interval : 0,
      update: update / n,
      render: render / n,
      p95: sorted[Math.max(0, Math.ceil(this.count * 0.95) - 1)] ?? 0,
      max: sorted[this.count - 1] ?? 0,
      spikes,
      samples: this.count,
    };
  }
}
