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
  await expect(page.locator(".run-result")).toContainText(/coins? earned/);
  await expect(page.locator(".run-rewards")).toContainText("First Steps");
  await expect(page.locator(".achievement-toast")).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("results-desktop.png") });
  await page.waitForTimeout(5500);
  await expect(page.locator(".revive-btn")).toBeEnabled();
  const cost = await page.evaluate(() => window.Game!.getReviveCost());
  const wallet = await page.evaluate(() => window.Game!.getCoinsBalance());
  await page.locator(".revive-btn").click();
  await expect(page.locator("#score-card-panel")).not.toBeVisible();
  expect(await page.evaluate(() => window.Game!.getCoinsBalance())).toBe(wallet - cost);
});
test("poor revive explains shortfall and restart clears the result", async ({ page }) => {
  await ready(page);
  await die(page);
  await expect(page.locator(".revive-btn")).toBeDisabled();
  const shortfall = await page.evaluate(
    () => window.Game!.getReviveCost() - window.Game!.getCoinsBalance(),
  );
  await expect(page.locator("#revive-status")).toContainText(`Need ${shortfall} more coins`);
  await page.getByRole("button", { name: "Play again", exact: true }).click();
  await expect(page.locator("#score-card-panel")).not.toBeVisible();
  await expect(page.locator("#run-result-announcement")).toHaveText("");
});
test("wardrobe try-on never buys or changes the equipped outfit", async ({ page }) => {
  await ready(page, 100);
  await page.getByRole("button", { name: "Open menu", exact: true }).click();
  await page.locator("#menu-shop").click();
  await expect(page.getByText("Collect coins in flower patches.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Try on Cowboy Hat", exact: true }).click();
  await expect(page.locator(".shop-preview")).toContainText("Trying on Cowboy Hat");
  await page.screenshot({ path: test.info().outputPath("wardrobe-preview.png") });
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
    await page.screenshot({ path: test.info().outputPath("results-touch-landscape.png") });
    await expect(page.locator(".score-card-hint")).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Play again", exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    await context.close();
  }
});
