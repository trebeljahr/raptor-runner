import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CACTUS_VARIANTS } from "./cactusVariants";
import {
  ESSENTIAL_IMAGE_KEYS,
  GameStartup,
  IMAGE_LOAD_TIMEOUT_MS,
  loadGameImages,
} from "./assetLoading";

class FakeImage {
  static requests: FakeImage[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 100;
  naturalHeight = 100;
  src = "";
  constructor() {
    FakeImage.requests.push(this);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeImage.requests = [];
  vi.stubGlobal("Image", FakeImage);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("essential image loading", () => {
  it("requires the player and every obstacle sprite", () => {
    expect(ESSENTIAL_IMAGE_KEYS.has("raptorSheet")).toBe(true);
    expect(ESSENTIAL_IMAGE_KEYS.has("pterodactylSprite")).toBe(true);
    for (const cactus of CACTUS_VARIANTS) expect(ESSENTIAL_IMAGE_KEYS.has(cactus.key)).toBe(true);
  });

  it("reports failed essential art but tolerates missing decoration", async () => {
    const images = {};
    const attempt = loadGameImages({ raptorSheet: "raptor", flower01: "flower" }, images);
    for (const image of FakeImage.requests) image.onerror?.();
    expect(await attempt).toEqual(["raptorSheet"]);
  });

  it("waits for image decode before publishing a sprite", async () => {
    const images: Record<string, HTMLImageElement | undefined> = {};
    const attempt = loadGameImages({ raptorSheet: "raptor" }, images);
    let finishDecode!: () => void;
    const image = FakeImage.requests[0] as FakeImage & { decode: () => Promise<void> };
    image.decode = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishDecode = resolve;
        }),
    );
    image.onload?.();
    await Promise.resolve();
    expect(images.raptorSheet).toBeUndefined();
    finishDecode();
    expect(await attempt).toEqual([]);
    expect(images.raptorSheet).toBe(image);
  });

  it("bounds a stalled decode and treats a rejected decode as a load failure", async () => {
    const images = {};
    const attempt = loadGameImages(
      { raptorSheet: "raptor", cactus: "cactus" },
      images,
      new Set(["raptorSheet", "cactus"]),
    );
    Object.assign(FakeImage.requests[0], { decode: () => new Promise(() => {}) });
    Object.assign(FakeImage.requests[1], { decode: () => Promise.reject(new Error("decode")) });
    FakeImage.requests.forEach((image) => image.onload?.());
    await vi.advanceTimersByTimeAsync(IMAGE_LOAD_TIMEOUT_MS);
    expect(await attempt).toEqual(["raptorSheet", "cactus"]);
  });

  it("bounds hangs, ignores late completion, and recovers with a fresh request", async () => {
    const images: Record<string, HTMLImageElement | undefined> = {};
    const sources = { raptorSheet: "raptor", flower01: "flower" };
    const first = loadGameImages(sources, images);
    const staleImage = FakeImage.requests[0];
    const lateLoad = staleImage.onload!;
    FakeImage.requests[1].onload?.();
    await vi.advanceTimersByTimeAsync(IMAGE_LOAD_TIMEOUT_MS);
    expect(await first).toEqual(["raptorSheet"]);
    expect(staleImage.onload).toBeNull();
    const retry = loadGameImages(sources, images);
    expect(FakeImage.requests).toHaveLength(3);
    lateLoad();
    expect(images.raptorSheet).toBeUndefined();
    FakeImage.requests[2].onload?.();
    expect(await retry).toEqual([]);
    expect(images.raptorSheet).toBe(FakeImage.requests[2]);
  });

  it("rejects an image with no decoded dimensions", async () => {
    const attempt = loadGameImages({ raptorSheet: "raptor" }, {});
    FakeImage.requests[0].naturalWidth = 0;
    FakeImage.requests[0].onload?.();
    expect(await attempt).toEqual(["raptorSheet"]);
  });
});

describe("startup retries", () => {
  it("blocks initialization on failure and shares concurrent retries", async () => {
    const prepare = vi.fn(async () => {});
    const initialize = vi.fn();
    const load = vi.fn().mockResolvedValueOnce(["raptorSheet"]).mockResolvedValue([]);
    const startup = new GameStartup(prepare, load, initialize);
    const statuses: string[] = [];
    startup.subscribe((snapshot) => statuses.push(snapshot.status));
    const first = startup.run();
    expect(startup.run()).toBe(first);
    expect((await first).status).toBe("error");
    expect(startup.getState().canRetry).toBe(true);
    expect(initialize).not.toHaveBeenCalled();
    const retry = startup.run();
    expect(startup.run()).toBe(retry);
    expect((await retry).status).toBe("ready");
    await startup.run();
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(2);
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(statuses).toContain("error");
    expect(statuses.at(-1)).toBe("ready");
  });

  it("does not publish ready until initialization finishes", async () => {
    let finish!: () => void;
    const startup = new GameStartup(
      async () => {},
      async () => [],
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const attempt = startup.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(startup.getState().status).toBe("loading");
    finish();
    expect((await attempt).status).toBe("ready");
  });

  it("isolates observer errors and snapshot mutations; supports unsubscribing", async () => {
    const startup = new GameStartup(
      async () => {},
      async () => ["raptorSheet"],
      () => {},
    );
    startup.subscribe(() => {
      throw new Error("consumer");
    });
    startup.subscribe((snapshot) => {
      snapshot.failedAssets.length = 0;
    });
    const observer = vi.fn();
    const unsubscribe = startup.subscribe(observer);
    unsubscribe();
    expect((await startup.run()).failedAssets).toEqual(["raptorSheet"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(observer).not.toHaveBeenCalled();
  });

  it("never repeats a partially failed initialization", async () => {
    const initialize = vi.fn(() => {
      throw new Error("canvas");
    });
    const startup = new GameStartup(
      async () => {},
      async () => [],
      initialize,
    );
    expect(await startup.run()).toMatchObject({ status: "error", canRetry: false });
    await startup.run();
    expect(initialize).toHaveBeenCalledTimes(1);
  });
});
