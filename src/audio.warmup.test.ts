import { afterEach, describe, expect, it, vi } from "vitest";
import { audio } from "./audio";

afterEach(() => {
  audio._audioCtx = null;
  audio._audioUnlocked = false;
  audio._ufoBuffer = null;
  audio._rainPrimed = false;
  audio.rain = null;
  audio._isRainPlaying = false;
  audio._warmedBuffers = new WeakSet();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fakeGraph() {
  const sources: any[] = [];
  const gains: any[] = [];
  audio._audioCtx = {
    currentTime: 5,
    createBufferSource: () => {
      const src = {
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
      };
      sources.push(src);
      return src;
    },
    createGain: () => {
      const gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
      gains.push(gain);
      return gain;
    },
    decodeAudioData: vi.fn(),
  } as unknown as AudioContext;
  const out = {} as AudioNode;
  vi.spyOn(audio, "_sfxOut").mockReturnValue(out);
  return { sources, gains, out };
}

describe("audio warm-up", () => {
  it("warms each buffer once on its real output channel and disconnects after silence", () => {
    const { sources, gains, out } = fakeGraph();
    const buffer = {} as AudioBuffer;
    audio._warmAudioBuffer(buffer, "events");
    expect(sources).toHaveLength(0);
    audio._audioUnlocked = true;
    audio._warmAudioBuffer(buffer, "events");
    audio._warmAudioBuffer(buffer, "events");
    expect(sources).toHaveLength(1);
    expect(audio._sfxOut).toHaveBeenCalledWith("events");
    expect(gains[0].connect).toHaveBeenCalledWith(out);
    expect(gains[0].gain.value).toBe(0);
    expect(sources[0].stop).toHaveBeenCalledWith(5.01);
    sources[0].onended();
    expect(sources[0].disconnect).toHaveBeenCalled();
    expect(gains[0].disconnect).toHaveBeenCalled();
  });
  it("warms a UFO buffer that finishes decoding after audio was unlocked", async () => {
    const { sources } = fakeGraph();
    audio._audioUnlocked = true;
    const decoded = {} as AudioBuffer;
    vi.stubGlobal("AudioContext", class {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(1) })),
    );
    vi.spyOn(audio._audioCtx!, "decodeAudioData").mockResolvedValue(decoded);
    audio._preloadUfoBuffer();
    await vi.waitFor(() => expect(audio._ufoBuffer).toBe(decoded));
    expect(sources).toHaveLength(1);
    expect(audio._sfxOut).toHaveBeenCalledWith("events");
  });
  it("primes rain again after a pause without replaying a running decoder", () => {
    const rain = document.createElement("audio");
    audio.rain = rain;
    Object.defineProperty(rain, "paused", { value: true, configurable: true });
    const play = vi.spyOn(rain, "play").mockImplementation(async () => {
      Object.defineProperty(rain, "paused", { value: false, configurable: true });
    });
    audio._primeRainAudio();
    audio._primeRainAudio();
    expect(play).toHaveBeenCalledTimes(1);
    expect(rain.volume).toBe(0);
    Object.defineProperty(rain, "paused", { value: true, configurable: true });
    audio._primeRainAudio();
    expect(play).toHaveBeenCalledTimes(2);
  });
});
