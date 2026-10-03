import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
async function ready(page: Page, coins = 0) {
  await page.addInitScript((balance) => {
    localStorage.setItem("raptor-runner:muted", "1");
    localStorage.setItem("raptor-runner:coinsBalance", String(balance));
  }, coins);
  await page.goto(`http://127.0.0.1:${process.env.RR_TEST_PORT}/`);
  await expect(page.getByRole("button", { name: "Start Game", exact: true })).toBeEnabled();
  await expect(page.locator("#boot-splash")).toHaveCount(0);
}
async function die(page: Page) {
  await page.getByRole("button", { name: "Start Game", exact: true }).click();
  await expect(page.locator("#score-card-panel")).toBeVisible({ timeout: 25_000 });
}
test("missing required art blocks startup and can be retried", async ({ page }) => {
  await page.route("**/assets/raptor-sheet.png", (route) => route.abort());
  await page.goto(`http://127.0.0.1:${process.env.RR_TEST_PORT}/`);
  await expect(page.getByRole("button", { name: "Retry loading" })).toBeEnabled();
  expect(await page.evaluate(() => window.Game!.isStarted())).toBe(false);
  await page.unroute("**/assets/raptor-sheet.png");
  await page.getByRole("button", { name: "Retry loading" }).click();
  await expect(page.getByRole("button", { name: "Start Game", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.Game!.getLoadingState().status)).toBe("ready");
});
test("rebinding updates hints and remains saved after reload", async ({ page }) => {
  await ready(page);
  await page.getByRole("button", { name: "Open menu", exact: true }).click();
  await page.locator("#accessibility-settings > summary").click();
  await page.getByRole("button", { name: /^Jump key:.*Change$/ }).click();
  await page.keyboard.press("j");
  await expect(page.locator("#game-canvas")).toHaveAttribute("aria-label", /Press J or tap/);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.locator(".start-hint-desktop")).toContainText("J to jump");
  await page.reload();
  await expect(page.locator(".start-hint-desktop")).toContainText("J to jump");
  await page.getByRole("button", { name: "Start Game", exact: true }).click();
  const before = await page.evaluate(() => window.Game!.getTotalJumps());
  await page.keyboard.press("Space");
  expect(await page.evaluate(() => window.Game!.getTotalJumps())).toBe(before);
  await page.keyboard.press("j");
  await expect.poll(() => page.evaluate(() => window.Game!.getTotalJumps())).toBe(before + 1);
  await page.keyboard.press("Escape");
  const pausedAt = await page.evaluate(() => window.Game!.getScore());
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.Game!.getScore())).toBe(pausedAt);
  await page.getByRole("button", { name: "Resume game", exact: true }).click();
});
test("results announce exact score and revive stays available", async ({ page }) => {
  await ready(page, 100);
  await die(page);
  const score = await page.evaluate(() => window.Game!.getScore());
  await expect(page.locator("#run-result-announcement")).toContainText(`${score} meters`);
  await expect(page.locator("#score-card-actions-root")).toContainText(/coins? earned this run/);
  expect(
    await page.evaluate(
      () => window.Game!.getAchievements().find((a) => a.id === "first-run")?.unlocked,
    ),
  ).toBe(true);
  await expect(page.locator(".achievement-toast")).toHaveCount(0);
  await page.screenshot({
    animations: "disabled",
    path: test.info().outputPath("results-desktop.png"),
  });
  await page.waitForTimeout(5500);
  await expect(page.locator(".revive-btn")).toBeEnabled();
  const cost = await page.evaluate(() => window.Game!.getReviveCost());
  const wallet = await page.evaluate(() => window.Game!.getCoinsBalance());
  await page.locator(".revive-btn").click();
  await expect(page.locator("#score-card-panel")).not.toBeVisible();
  expect(await page.evaluate(() => window.Game!.getCoinsBalance())).toBe(wallet - cost);
});
test("poor revive shows the balance and restart clears the result", async ({ page }) => {
  await ready(page);
  await die(page);
  await expect(page.locator(".revive-btn")).toBeDisabled();
  const wallet = await page.evaluate(() => window.Game!.getCoinsBalance());
  await expect(page.locator("#score-card-actions-root .revive-balance").first()).toContainText(
    `You have ${wallet} coins`,
  );
  await page.getByRole("button", { name: "Play again", exact: true }).click();
  await expect(page.locator("#score-card-panel")).not.toBeVisible();
  await expect(page.locator("#run-result-announcement")).toHaveText("");
});
test("wardrobe try-on never buys or changes the equipped outfit", async ({ page }) => {
  await ready(page, 100);
  await page.getByRole("button", { name: "Open menu", exact: true }).click();
  await page.locator("#menu-shop").click();
  await expect(page.getByRole("dialog", { name: "Shop", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Try on Cowboy Hat", exact: true }).click();
  await expect(page.locator(".shop-preview")).toContainText("Trying on Cowboy Hat");
  await page.screenshot({
    animations: "disabled",
    path: test.info().outputPath("wardrobe-preview.png"),
  });
  expect(await page.evaluate(() => window.Game!.getCoinsBalance())).toBe(100);
  expect(await page.evaluate(() => window.Game!.ownsCosmetic("cowboy-hat"))).toBe(false);
  expect(await page.evaluate(() => window.Game!.getEquippedCosmetic("head"))).toBeNull();
  await page.getByRole("button", { name: "Buy Cowboy Hat for 50 coins", exact: true }).click();
  expect(await page.evaluate(() => window.Game!.getCoinsBalance())).toBe(50);
  await page.getByRole("button", { name: "Owned items", exact: true }).click();
  await expect(page.locator(".shop-item")).toHaveCount(1);
  await page.getByRole("button", { name: "Run rewards", exact: true }).click();
  await expect(page.locator(".shop-item")).toHaveCount(3);
  await expect(page.locator(".shop-item").first()).toContainText("1,000 meters");
});
test("touch landscape has usable results and no keyboard hint", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  try {
    await ready(page);
    await die(page);
    await page.screenshot({
      animations: "disabled",
      path: test.info().outputPath("results-touch-landscape.png"),
    });
    await expect(page.locator(".score-card-hint")).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Play again", exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    await context.close();
  }
});

test("save export and confirmed restore survive reload without uploads", async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("save-fixture")) return;
    sessionStorage.setItem("save-fixture", "1");
    localStorage.setItem("raptor-runner:muted", "1");
    localStorage.setItem("raptor-runner:coinsBalance", "73");
    localStorage.setItem("raptor-runner:highScore", "123");
  });
  await page.goto(`http://127.0.0.1:${process.env.RR_TEST_PORT}/`);
  await expect(page.getByRole("button", { name: "Start Game", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Open menu", exact: true }).click();
  await page.locator("#save-settings > summary").click();
  await expect(
    page.getByText("Progress and settings are saved in this browser.", { exact: false }),
  ).toBeVisible();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export save", exact: true }).click();
  const download = await downloading;
  const backup = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(backup.product).toBe("raptor-runner");
  expect(backup.data["raptor-runner:coinsBalance"]).toBe("73");
  const input = page.getByLabel("Preview a backup file");
  await input.setInputFiles({
    name: "broken.json",
    mimeType: "application/json",
    buffer: Buffer.from("{broken"),
  });
  await expect(page.getByRole("alert")).toContainText("not valid JSON");
  expect(await page.evaluate(() => window.Game!.getCoinsBalance())).toBe(73);
  backup.data["raptor-runner:coinsBalance"] = "20";
  backup.data["raptor-runner:highScore"] = "456";
  const file = {
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  };
  await input.setInputFiles(file);
  await expect(
    page.getByRole("button", { name: "Replace save and reload", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("table")).toContainText("456");
  await page.getByRole("button", { name: "Cancel import", exact: true }).click();
  expect(await page.evaluate(() => window.Game!.getHighScore())).toBe(123);
  await input.setInputFiles(file);
  await page
    .getByRole("checkbox", { name: "I understand this replaces my progress and settings." })
    .check();
  await page.screenshot({
    animations: "disabled",
    path: test.info().outputPath("save-import-preview.png"),
  });
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(request.url());
  });
  await Promise.all([
    page.waitForEvent("load"),
    page.getByRole("button", { name: "Replace save and reload", exact: true }).click(),
  ]);
  await expect(page.getByRole("button", { name: "Start Game", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.Game!.getHighScore())).toBe(456);
  expect(await page.evaluate(() => window.Game!.getCoinsBalance())).toBe(20);
  expect(posts).toEqual([]);
});

test("late jump inputs cannot respawn until the death grace period ends", async ({ page }) => {
  await ready(page, 100);
  await page.getByRole("button", { name: "Start Game", exact: true }).click();
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.evaluate(() => window.Game!._forceGameOver());
  await expect(page.locator(".play-again-btn")).toBeDisabled();
  await expect(page.locator(".score-card-hint")).toBeDisabled();
  await expect(page.locator(".revive-btn")).toBeDisabled();
  const blockedInputs = () => page.evaluate(() => {
    for (const code of ["Space", "KeyW", "Enter", "ArrowUp"]) {
      window.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));
    }
    (window as any).__rrScoreCardSelect(); // Controller confirm uses this same path.
    document.querySelector<HTMLButtonElement>(".play-again-btn")!.click();
    document.getElementById("score-card-overlay")!.click();
    document.getElementById("game-canvas")!.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    );
    window.Game!.restartFromGameOver(); // API must also enforce the grace period.
    const revived = window.Game!.revive();
    return { dead: window.Game!.isGameOver(), revived, coins: window.Game!.getCoinsBalance() };
  });
  expect(await blockedInputs()).toEqual({ dead: true, revived: false, coins: 100 });
  await page.clock.runFor(499);
  expect(await blockedInputs()).toEqual({ dead: true, revived: false, coins: 100 });
  await page.clock.runFor(17);
  await expect(page.locator(".play-again-btn")).toBeEnabled();
  await expect(page.locator(".revive-btn")).toBeEnabled();
  await page.evaluate(() => window.dispatchEvent(
    new KeyboardEvent("keydown", { code: "Space", repeat: true, bubbles: true }),
  ));
  expect(await page.evaluate(() => window.Game!.isGameOver())).toBe(true);
  await page.keyboard.press("Space");
  expect(await page.evaluate(() => window.Game!.isGameOver())).toBe(false);
  // A new death starts a fresh grace period.
  await page.evaluate(() => {
    window.Game!._forceGameOver();
    window.Game!.restartFromGameOver();
  });
  expect(await page.evaluate(() => window.Game!.isGameOver())).toBe(true);
  await page.clock.runFor(516);
  await page.locator(".revive-btn").click();
  expect(await page.evaluate(() => window.Game!.isGameOver())).toBe(false);
  expect(await page.evaluate(() => window.Game!.getCoinsBalance())).toBe(50);
});
