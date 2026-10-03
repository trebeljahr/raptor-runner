import { beforeEach, describe, expect, it, vi } from "vitest";
import { CACTUS_VARIANTS } from "../cactusVariants";
import { state } from "../state";
import { Cactus, Cactuses } from "./cactus";
import type { Raptor } from "./raptor";

vi.mock("./coins", () => ({
  spawnCoinAboveCactus: vi.fn(),
  spawnCoinsInRange: vi.fn(),
  spawnCoinUnderPterodactyl: vi.fn(),
}));

const raptor = { x: 0, w: 100, h: 90 } as Raptor;
let obstacles: Cactuses;
let cactus: Cactus;

beforeEach(() => {
  state.width = 1000;
  state.ground = 500;
  state.bgVelocity = 5;
  state.score = 0;
  state._nextBreatherAtScore = 500;
  state.gameOver = false;
  state.noCollisions = false;
  state.frame = 100;
  state.invulnerableUntilFrame = 0;
  state.runCactiCleared = 0;
  obstacles = new Cactuses(raptor);
  cactus = new Cactus(CACTUS_VARIANTS[0], raptor);
  obstacles.cacti.push(cactus);
});

function moveTo(rightEdge: number) {
  state._frameScrollDx = cactus.x + cactus.w - rightEdge;
  cactus.update();
  obstacles.resolveClearances();
}

describe("cactus clearance rewards", () => {
  it("counts only after the whole obstacle passes the player, once", () => {
    moveTo(1);
    expect(state.runCactiCleared).toBe(0);
    moveTo(-1);
    expect(state.runCactiCleared).toBe(1);
    obstacles.resolveClearances();
    expect(state.runCactiCleared).toBe(1);
    expect(obstacles.cacti).toHaveLength(0);
  });

  it("does not reward the frame that kills the player", () => {
    state.gameOver = true;
    moveTo(-1);
    expect(state.runCactiCleared).toBe(0);
  });

  it("remembers a death through revive even after grace ends", () => {
    state.gameOver = true;
    moveTo(30);
    state.gameOver = false;
    state.invulnerableUntilFrame = 120;
    moveTo(10);
    state.frame = 121;
    moveTo(-1);
    expect(state.runCactiCleared).toBe(0);
  });

  it("does not credit obstacles crossed during invulnerability", () => {
    state.invulnerableUntilFrame = 120;
    moveTo(30);
    state.frame = 121;
    moveTo(-1);
    expect(state.runCactiCleared).toBe(0);
  });

  it("still rewards a later cactus approached after grace ends", () => {
    state.invulnerableUntilFrame = 120;
    moveTo(500);
    state.frame = 121;
    moveTo(50);
    moveTo(-1);
    expect(state.runCactiCleared).toBe(1);
  });

  it("does not reward passing through obstacles with debug collisions disabled", () => {
    state.noCollisions = true;
    moveTo(-1);
    expect(state.runCactiCleared).toBe(0);
  });
});
