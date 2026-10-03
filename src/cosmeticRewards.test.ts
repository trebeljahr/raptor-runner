import { beforeEach, expect, it } from "vitest";
import { grantCosmetic, migrateLegacyCosmetics } from "./cosmetics";
import { WEAR_PARTY_HAT_KEY } from "./constants";
import { loadBoolFlag, loadEquippedCosmetics, loadOwnedCosmetics } from "./persistence";
import { state } from "./state";

beforeEach(() => {
  localStorage.clear();
  state.ownedCosmetics = {};
  state.equippedCosmetics = { head: null, eyes: null, neck: null };
});

it.each([
  ["party-hat", "head", "cowboy-hat"],
  ["bow-tie", "neck", "gold-chain"],
  ["thug-glasses", "eyes", "monocle"],
] as const)("grants %s without replacing a chosen outfit", (reward, slot, chosen) => {
  state.equippedCosmetics[slot] = chosen;
  grantCosmetic(reward, { autoEquip: false });
  expect(state.ownedCosmetics[reward]).toBe(true);
  expect(state.equippedCosmetics[slot]).toBe(chosen);
});

it("preserves a deliberately empty slot", () => {
  state.equippedCosmetics.head = null;
  grantCosmetic("party-hat", { autoEquip: false });
  expect(state.ownedCosmetics["party-hat"]).toBe(true);
  expect(state.equippedCosmetics.head).toBeNull();
});

it("keeps an unworn reward unequipped after save hydration and legacy migration", () => {
  state.wearPartyHat = true;
  grantCosmetic("party-hat", { autoEquip: false });
  state.ownedCosmetics = loadOwnedCosmetics();
  state.equippedCosmetics = loadEquippedCosmetics();
  state.wearPartyHat = loadBoolFlag(WEAR_PARTY_HAT_KEY, true);
  migrateLegacyCosmetics();
  expect(state.equippedCosmetics.head).toBeNull();
  expect(state.wearPartyHat).toBe(false);
});

it("still auto-equips purchases into an empty slot", () => {
  grantCosmetic("cowboy-hat");
  expect(state.equippedCosmetics.head).toBe("cowboy-hat");
});
