import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { audio } from "./audio";

describe("volume preview lifetime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    audio.muted = false;
    audio.musicMuted = false;
    audio.rainMuted = false;
    audio.masterVolume = 0.6;
    audio.channelVolumes.music = 0.5;
    audio.music = document.createElement("audio");
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
      Object.defineProperty(this, "paused", { value: false, configurable: true });
      return Promise.resolve();
    });
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  });
  afterEach(() => {
    audio.stopVolumePreview();
    vi.runAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  it("reuses one sample during changes and stops after inactivity", async () => {
    audio.previewVolume("music");
    const sample = audio._volumePreview!;
    await vi.advanceTimersByTimeAsync(100);
    audio.channelVolumes.music = 0.8;
    audio.previewVolume("music");
    expect(audio._volumePreview).toBe(sample);
    await vi.advanceTimersByTimeAsync(100);
    expect(sample.volume).toBeCloseTo(0.5 * 0.8 * 0.6);
    await vi.advanceTimersByTimeAsync(600);
    expect(audio._volumePreview).toBeNull();
    expect(sample.pause).toHaveBeenCalled();
  });
  it("does not revive a preview released before play resolves", async () => {
    audio.previewVolume("music");
    const sample = audio._volumePreview!;
    audio.stopVolumePreview();
    await vi.advanceTimersByTimeAsync(200);
    expect(sample.volume).toBe(0);
    expect(audio._volumePreview).toBeNull();
  });
  it("respects master and channel mute", () => {
    audio.muted = true;
    audio.previewVolume("music");
    expect(audio._volumePreview).toBeNull();
    audio.muted = false;
    audio.musicMuted = true;
    audio.previewVolume("music");
    expect(audio._volumePreview).toBeNull();
  });
});
