import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACHIEVEMENTS_KEY,
  CAREER_RUNS_KEY,
  HIGH_SCORE_KEY,
  RARE_EVENTS_SEEN_KEY,
  TOTAL_DAY_CYCLES_KEY,
  TOTAL_JUMPS_KEY,
} from "./constants";
import {
  flushPersistenceWrites,
  loadBoolFlag,
  loadCareerRuns,
  loadHighScore,
  loadRareEventsSeen,
  loadTotalDayCycles,
  loadTotalJumps,
  loadUnlockedAchievements,
  saveBoolFlag,
  saveCareerRuns,
  saveHighScore,
  saveRareEventsSeen,
  saveTotalDayCycles,
  saveTotalJumps,
  saveUnlockedAchievements,
} from "./persistence";

/*
 * Persistence tests rely on happy-dom's window.localStorage. We reset
 * it between every test so no leak crosses test boundaries. The
 * synchronous flush before clear drains any queued writes from a
 * prior test out of the pending-writes map so they don't leak into
 * the next test's reads via _persistGet's pending-first fallback.
 */
beforeEach(() => {
  flushPersistenceWrites();
  window.localStorage.clear();
});

describe("loadHighScore / saveHighScore", () => {
  it("returns 0 when key is missing", () => {
    expect(loadHighScore()).toBe(0);
  });
  it("round-trips an integer", () => {
    saveHighScore(1234);
    expect(loadHighScore()).toBe(1234);
  });
  it("returns 0 for a malformed value", () => {
    window.localStorage.setItem(HIGH_SCORE_KEY, "not-a-number");
    expect(loadHighScore()).toBe(0);
  });
  it("returns 0 for a negative stored value (defensive)", () => {
    window.localStorage.setItem(HIGH_SCORE_KEY, "-5");
    expect(loadHighScore()).toBe(0);
  });
  it("writes the raw number as a string", () => {
    saveHighScore(42);
    // Writes are now queued for an idle flush (see
    // _pendingWrites in persistence.ts); force the flush here so
    // the assertion can inspect the underlying localStorage state
    // directly rather than going through load*() which would
    // short-circuit via _persistGet's pending-first fallback.
    flushPersistenceWrites();
    expect(window.localStorage.getItem(HIGH_SCORE_KEY)).toBe("42");
  });
});

describe("loadCareerRuns / saveCareerRuns", () => {
  it("defaults to 0", () => {
    expect(loadCareerRuns()).toBe(0);
  });
  it("round-trips", () => {
    saveCareerRuns(77);
    expect(loadCareerRuns()).toBe(77);
  });
  it("rejects negative values", () => {
    window.localStorage.setItem(CAREER_RUNS_KEY, "-1");
    expect(loadCareerRuns()).toBe(0);
  });
  it("rejects garbage values", () => {
    window.localStorage.setItem(CAREER_RUNS_KEY, "🦖");
    expect(loadCareerRuns()).toBe(0);
  });
});

describe("loadTotalJumps / saveTotalJumps", () => {
  it("defaults to 0", () => {
    expect(loadTotalJumps()).toBe(0);
  });
  it("round-trips", () => {
    saveTotalJumps(9999);
    expect(loadTotalJumps()).toBe(9999);
  });
  it("rejects garbage", () => {
    window.localStorage.setItem(TOTAL_JUMPS_KEY, "abc");
    expect(loadTotalJumps()).toBe(0);
  });
});

describe("loadTotalDayCycles / saveTotalDayCycles", () => {
  it("defaults to 0", () => {
    expect(loadTotalDayCycles()).toBe(0);
  });
  it("round-trips", () => {
    saveTotalDayCycles(12);
    expect(loadTotalDayCycles()).toBe(12);
  });
  it("returns 0 for malformed stored value", () => {
    window.localStorage.setItem(TOTAL_DAY_CYCLES_KEY, "nope");
    expect(loadTotalDayCycles()).toBe(0);
  });
  it("returns 0 for a negative stored value", () => {
    // Standardized to match the other numeric loaders — negative values
    // are treated as garbage, not trusted.
    window.localStorage.setItem(TOTAL_DAY_CYCLES_KEY, "-3");
    expect(loadTotalDayCycles()).toBe(0);
  });
});

describe("loadUnlockedAchievements / saveUnlockedAchievements", () => {
  it("returns an empty set when nothing saved", () => {
    expect(loadUnlockedAchievements()).toEqual(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Object.create(null) as any,
    );
    // Alternative: just check keys length
    expect(Object.keys(loadUnlockedAchievements())).toHaveLength(0);
  });
  it("round-trips a set", () => {
    saveUnlockedAchievements({ "first-run": true, "score-25": true });
    const got = loadUnlockedAchievements();
    expect(got["first-run"]).toBe(true);
    expect(got["score-25"]).toBe(true);
    expect(Object.keys(got).length).toBe(2);
  });
  it("serializes as a JSON array of ids", () => {
    saveUnlockedAchievements({ alpha: true, beta: true });
    // Writes are queued for idle flush — drain before probing
    // localStorage directly. load*() would read from the pending
    // queue first and hide the underlying serialization format.
    flushPersistenceWrites();
    const raw = window.localStorage.getItem(ACHIEVEMENTS_KEY);
    expect(raw).toBe(JSON.stringify(["alpha", "beta"]));
  });
  it("treats malformed JSON as an empty set", () => {
    window.localStorage.setItem(ACHIEVEMENTS_KEY, "{{ not json");
    expect(Object.keys(loadUnlockedAchievements())).toHaveLength(0);
  });
  it("ignores non-string entries in the stored array", () => {
    window.localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(["alpha", 42, null, "beta"]));
    const got = loadUnlockedAchievements();
    expect(got.alpha).toBe(true);
    expect(got.beta).toBe(true);
    expect(Object.keys(got).length).toBe(2);
  });
  it("treats a non-array stored value as empty", () => {
    window.localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify({ not: "an array" }));
    expect(Object.keys(loadUnlockedAchievements())).toHaveLength(0);
  });
});

describe("loadRareEventsSeen / saveRareEventsSeen", () => {
  it("defaults to empty object", () => {
    expect(loadRareEventsSeen()).toEqual({});
  });
  it("round-trips a counter map", () => {
    saveRareEventsSeen({ ufo: 1, comet: 3 });
    expect(loadRareEventsSeen()).toEqual({ ufo: 1, comet: 3 });
  });
  it("returns {} on malformed JSON", () => {
    window.localStorage.setItem(RARE_EVENTS_SEEN_KEY, "nope");
    expect(loadRareEventsSeen()).toEqual({});
  });
});

describe("loadBoolFlag / saveBoolFlag", () => {
  const KEY = "raptor-runner:test-flag";

  it("returns fallback when missing", () => {
    expect(loadBoolFlag(KEY, true)).toBe(true);
    expect(loadBoolFlag(KEY, false)).toBe(false);
  });
  it("reads '1' as true and '0' as false", () => {
    saveBoolFlag(KEY, true);
    expect(loadBoolFlag(KEY, false)).toBe(true);
    saveBoolFlag(KEY, false);
    expect(loadBoolFlag(KEY, true)).toBe(false);
  });
  it("treats anything other than '1' as false", () => {
    window.localStorage.setItem(KEY, "true");
    expect(loadBoolFlag(KEY, true)).toBe(false);
    window.localStorage.setItem(KEY, "");
    expect(loadBoolFlag(KEY, true)).toBe(false);
  });
});

describe("failure tolerance — silent no-op when localStorage throws", () => {
  /*
   * Reproduces private-browsing / storage-denied scenarios. The wrappers
   * must never throw into the game loop.
   */
  let origSetItem: typeof window.localStorage.setItem;
  let origGetItem: typeof window.localStorage.getItem;

  beforeEach(() => {
    origSetItem = window.localStorage.setItem.bind(window.localStorage);
    origGetItem = window.localStorage.getItem.bind(window.localStorage);
  });
  afterEach(() => {
    // Restore by assigning back to the storage instance. happy-dom
    // exposes these as writable methods.
    window.localStorage.setItem = origSetItem;
    window.localStorage.getItem = origGetItem;
    vi.restoreAllMocks();
  });

  it("save* calls swallow throws", () => {
    window.localStorage.setItem = () => {
      throw new Error("QuotaExceeded");
    };
    expect(() => saveHighScore(1)).not.toThrow();
    expect(() => saveCareerRuns(1)).not.toThrow();
    expect(() => saveTotalJumps(1)).not.toThrow();
    expect(() => saveTotalDayCycles(1)).not.toThrow();
    expect(() => saveUnlockedAchievements({ foo: true })).not.toThrow();
    expect(() => saveRareEventsSeen({ foo: 1 })).not.toThrow();
    expect(() => saveBoolFlag("x", true)).not.toThrow();
  });

  it("load* calls return fallbacks when getItem throws", () => {
    window.localStorage.getItem = () => {
      throw new Error("SecurityError");
    };
    expect(loadHighScore()).toBe(0);
    expect(loadCareerRuns()).toBe(0);
    expect(loadTotalJumps()).toBe(0);
    expect(loadTotalDayCycles()).toBe(0);
    expect(loadUnlockedAchievements()).toEqual(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Object.create(null) as any,
    );
    expect(loadRareEventsSeen()).toEqual({});
    expect(loadBoolFlag("x", true)).toBe(true);
  });
});
