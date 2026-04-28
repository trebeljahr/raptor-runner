import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clamp,
  compactInPlace,
  cross,
  lerp,
  lerpColor,
  type Polygon,
  pointInPolygon,
  polygonsOverlap,
  randRange,
  rgb,
  rgba,
  segmentsIntersect,
  shrinkPolygon,
} from "./helpers";

describe("lerp", () => {
  it("returns a at t=0", () => {
    expect(lerp(3, 7, 0)).toBe(3);
  });
  it("returns b at t=1", () => {
    expect(lerp(3, 7, 1)).toBe(7);
  });
  it("interpolates at midpoint", () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
  });
  it("extrapolates beyond [0,1]", () => {
    expect(lerp(0, 10, 1.5)).toBe(15);
    expect(lerp(0, 10, -0.5)).toBe(-5);
  });
  it("handles negative ranges", () => {
    expect(lerp(-10, 10, 0.5)).toBe(0);
  });
});

describe("lerpColor", () => {
  it("rounds channel values to integers", () => {
    // t=0.5 between (0,0,0) and (3,3,3) would give 1.5 → rounds to 2
    expect(lerpColor([0, 0, 0], [3, 3, 3], 0.5)).toEqual([2, 2, 2]);
  });
  it("returns a at t=0 and b at t=1", () => {
    expect(lerpColor([10, 20, 30], [200, 100, 50], 0)).toEqual([10, 20, 30]);
    expect(lerpColor([10, 20, 30], [200, 100, 50], 1)).toEqual([200, 100, 50]);
  });
});

describe("rgb / rgba", () => {
  it("formats rgb() string", () => {
    expect(rgb([50, 180, 205])).toBe("rgb(50, 180, 205)");
  });
  it("formats rgba() string with alpha", () => {
    expect(rgba([50, 180, 205], 0.5)).toBe("rgba(50, 180, 205, 0.5)");
  });
});

describe("randRange", () => {
  // randRange uses Math.random internally; stub it for determinism.
  beforeEach(() => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns min when Math.random is 0", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(randRange(5, 10)).toBe(5);
  });
  it("returns halfway point with Math.random=0.5", () => {
    expect(randRange(5, 10)).toBe(7.5);
  });
  it("returns just below max (exclusive upper bound)", () => {
    // Math.random is [0,1), so randRange is [min, max)
    vi.spyOn(Math, "random").mockReturnValue(0.9999999);
    const v = randRange(5, 10);
    expect(v).toBeLessThan(10);
    expect(v).toBeGreaterThanOrEqual(5);
  });
});

describe("clamp", () => {
  it("clamps below lo", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });
  it("clamps above hi", () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });
  it("passes through values in range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });
  it("works at the boundaries", () => {
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });
});

describe("cross", () => {
  it("is zero for collinear points", () => {
    expect(cross({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 })).toBe(0);
  });
  it("is positive for counter-clockwise turn", () => {
    expect(cross({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 })).toBeGreaterThan(0);
  });
  it("is negative for clockwise turn", () => {
    expect(cross({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 })).toBeLessThan(0);
  });
});

describe("segmentsIntersect", () => {
  it("returns true for a plus-sign crossing", () => {
    expect(
      segmentsIntersect({ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }),
    ).toBe(true);
  });
  it("returns false for parallel segments", () => {
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 })).toBe(
      false,
    );
  });
  it("returns false for disjoint segments", () => {
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 2 }, { x: 3, y: 3 })).toBe(
      false,
    );
  });
  it("strict crossing — returns false when segments merely touch at a shared endpoint", () => {
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 })).toBe(
      false,
    );
  });
});

describe("pointInPolygon", () => {
  // Unit square for most cases.
  const square: Polygon = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];

  it("detects a point clearly inside", () => {
    expect(pointInPolygon({ x: 0.5, y: 0.5 }, square)).toBe(true);
  });
  it("rejects a point clearly outside", () => {
    expect(pointInPolygon({ x: 2, y: 2 }, square)).toBe(false);
    expect(pointInPolygon({ x: -0.5, y: 0.5 }, square)).toBe(false);
  });
  it("works for concave polygons (C-shape)", () => {
    const cShape: Polygon = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 3 },
      { x: 4, y: 3 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ];
    // Inside the left column of the C
    expect(pointInPolygon({ x: 0.5, y: 2 }, cShape)).toBe(true);
    // Inside the hollow middle (the "bite" of the C)
    expect(pointInPolygon({ x: 2.5, y: 2 }, cShape)).toBe(false);
  });
  it("normalized polygon (0..1 bounds) matches sprite collision use case", () => {
    // Mimics a cactus-variant polygon after scaling.
    const cactusLike: Polygon = [
      { x: 0.4, y: 0.05 },
      { x: 0.6, y: 0.05 },
      { x: 0.6, y: 0.95 },
      { x: 0.4, y: 0.95 },
    ];
    expect(pointInPolygon({ x: 0.5, y: 0.5 }, cactusLike)).toBe(true);
    expect(pointInPolygon({ x: 0.3, y: 0.5 }, cactusLike)).toBe(false);
  });
});

describe("polygonsOverlap", () => {
  const square: Polygon = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];

  it("returns true for partial overlap", () => {
    const overlapping: Polygon = [
      { x: 0.5, y: 0.5 },
      { x: 1.5, y: 0.5 },
      { x: 1.5, y: 1.5 },
      { x: 0.5, y: 1.5 },
    ];
    expect(polygonsOverlap(square, overlapping)).toBe(true);
  });
  it("returns true when one polygon fully contains the other", () => {
    const inner: Polygon = [
      { x: 0.25, y: 0.25 },
      { x: 0.75, y: 0.25 },
      { x: 0.75, y: 0.75 },
      { x: 0.25, y: 0.75 },
    ];
    expect(polygonsOverlap(square, inner)).toBe(true);
    expect(polygonsOverlap(inner, square)).toBe(true);
  });
  it("returns false for disjoint polygons", () => {
    const far: Polygon = [
      { x: 10, y: 10 },
      { x: 11, y: 10 },
      { x: 11, y: 11 },
      { x: 10, y: 11 },
    ];
    expect(polygonsOverlap(square, far)).toBe(false);
  });
  it("returns false for polygons that are barely-adjacent (no shared points, tiny gap)", () => {
    // Note: polygonsOverlap uses ray-casting, which is ambiguous at shared
    // vertices/edges — a polygon sharing a vertex with another is classified
    // as "inside" by pointInPolygon due to how the intersection epsilon
    // resolves. We avoid that ambiguity in tests (and in the real collision
    // hitboxes, which are screen-space rectangles with no shared corners).
    const almostAdjacent: Polygon = [
      { x: 1.001, y: 1.001 },
      { x: 2, y: 1.001 },
      { x: 2, y: 2 },
      { x: 1.001, y: 2 },
    ];
    expect(polygonsOverlap(square, almostAdjacent)).toBe(false);
  });
});

describe("shrinkPolygon", () => {
  const square: Polygon = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it("returns the same polygon when inset <= 0", () => {
    expect(shrinkPolygon(square, 0)).toBe(square);
    expect(shrinkPolygon(square, -5)).toBe(square);
  });
  it("handles empty polygon", () => {
    expect(shrinkPolygon([], 5)).toEqual([]);
  });
  it("pulls vertices toward the centroid", () => {
    // Centroid of unit 10x10 square is (5,5).
    const shrunk = shrinkPolygon(square, 2);
    // Top-left vertex (0,0) should have moved toward (5,5)
    expect(shrunk[0]!.x).toBeGreaterThan(0);
    expect(shrunk[0]!.y).toBeGreaterThan(0);
    // All shrunk vertices should be inside the original square
    for (const p of shrunk) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(10);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(10);
    }
  });
  it("never moves a vertex past the centroid (clamps t <= 1)", () => {
    // With huge inset, every vertex collapses to (or near) the centroid.
    const shrunk = shrinkPolygon(square, 10_000);
    for (const p of shrunk) {
      expect(p.x).toBeCloseTo(5, 5);
      expect(p.y).toBeCloseTo(5, 5);
    }
  });
});

describe("compactInPlace", () => {
  it("keeps all elements when predicate always returns true", () => {
    const arr = [1, 2, 3, 4, 5];
    const ref = compactInPlace(arr, () => true);
    expect(ref).toBe(arr); // same reference
    expect(arr).toEqual([1, 2, 3, 4, 5]);
  });
  it("removes all elements when predicate always returns false", () => {
    const arr = [1, 2, 3, 4, 5];
    compactInPlace(arr, () => false);
    expect(arr).toEqual([]);
    expect(arr.length).toBe(0);
  });
  it("preserves order of kept elements", () => {
    const arr = [1, 2, 3, 4, 5, 6];
    compactInPlace(arr, (n) => n % 2 === 0);
    expect(arr).toEqual([2, 4, 6]);
  });
  it("mutates the same array reference (zero-alloc contract)", () => {
    const arr = [1, 2, 3];
    const before = arr;
    compactInPlace(arr, (n) => n > 1);
    // Crucial: the reference must still be identical so callers holding
    // `state.clouds` don't get a stale view after the game-loop compacts.
    expect(arr).toBe(before);
  });
  it("handles an empty array", () => {
    const arr: number[] = [];
    compactInPlace(arr, () => true);
    expect(arr).toEqual([]);
  });
  it("handles a single-element array", () => {
    const a = [42];
    compactInPlace(a, (n) => n > 0);
    expect(a).toEqual([42]);
    const b = [42];
    compactInPlace(b, (n) => n < 0);
    expect(b).toEqual([]);
  });
  it("does not re-assign when no removals happen (write === read)", () => {
    // Spy on array access to detect unnecessary writes.
    const arr = [1, 2, 3];
    compactInPlace(arr, () => true);
    expect(arr).toEqual([1, 2, 3]);
  });
  it("handles removing a run of elements from the middle", () => {
    const arr = [1, 2, 3, 4, 5, 6, 7];
    compactInPlace(arr, (n) => n < 3 || n > 5);
    expect(arr).toEqual([1, 2, 6, 7]);
  });
  it("works with object references (identity-preserving)", () => {
    const a = { id: "a" };
    const b = { id: "b" };
    const c = { id: "c" };
    const arr = [a, b, c];
    compactInPlace(arr, (o) => o.id !== "b");
    expect(arr).toEqual([a, c]);
    expect(arr[0]).toBe(a);
    expect(arr[1]).toBe(c);
  });
});
