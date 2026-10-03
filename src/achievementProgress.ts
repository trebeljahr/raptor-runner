export interface AchievementProgress {
  current: number;
  target: number;
  unit: string;
  scope: string;
}
interface Counters {
  highScore: number;
  careerRuns: number;
  runCactiCleared: number;
  totalNightsSurvived: number;
  runNightsSurvived: number;
  coinsCollected: number;
  ownedShopItems: number;
  shopItems: number;
  equippedSlots: number;
}
export function achievementProgress(id: string, c: Counters): AchievementProgress | null {
  const goals: Record<string, [number, number, string, string]> = {
    "first-run": [c.careerRuns, 1, "runs", "Career"],
    "first-jump": [c.runCactiCleared, 1, "cacti", "This run"],
    "score-25": [c.runCactiCleared, 25, "cacti", "This run"],
    "party-time": [c.highScore, 1000, "m", "Best run"],
    "dinosaurs-forever": [c.highScore, 1500, "m", "Best run"],
    "score-250": [c.highScore, 2000, "m", "Best run"],
    "first-night": [c.totalNightsSurvived, 1, "nights", "Career"],
    "ten-nights": [c.totalNightsSurvived, 10, "nights", "Career"],
    "twenty-nights": [c.runNightsSurvived, 5, "nights", "This run"],
    "century-runner": [c.careerRuns, 100, "runs", "Career"],
    "coin-hoarder": [c.coinsCollected, 1000, "coins", "Career"],
    "first-purchase": [c.ownedShopItems, 1, "items", "Owned"],
    "shop-cleaned-out": [c.ownedShopItems, c.shopItems, "items", "Owned"],
    "fully-equipped": [c.equippedSlots, 3, "slots", "Outfit"],
  };
  const goal = goals[id];
  if (!goal) return null;
  const [current, target, unit, scope] = goal;
  return { current: Math.min(target, Math.max(0, Math.floor(current))), target, unit, scope };
}
