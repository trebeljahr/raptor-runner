/*
 * Raptor Runner — cosmetic registry. Single source of truth: shop
 * UI, equip menu, and raptor rendering all read from COSMETICS.
 * Add an entry and it shows up in all three.
 */

export type CosmeticSlot = "head" | "eyes" | "neck";

export const COSMETIC_SLOTS: ReadonlyArray<CosmeticSlot> = ["head", "eyes", "neck"];

/** Human-readable slot name used in the equip menu subheadings. */
export const COSMETIC_SLOT_LABELS: Record<CosmeticSlot, string> = {
  head: "Head",
  eyes: "Eyes",
  neck: "Neck",
};

export interface CosmeticDef {
  /** Stable id — persisted in localStorage. Don't rename. */
  id: string;
  name: string;
  slot: CosmeticSlot;
  /** Coin cost. Score-unlocked items use 0 with scoreUnlock: true. */
  price: number;
  description?: string;
  /** Key into IMAGES{}. Missing / unloaded → placeholder rect. */
  spriteKey?: string;
  /** True for the three score-milestone classics (party hat, thug
   *  glasses, bow tie). Filtered out of the shop grid. */
  scoreUnlock?: boolean;
  /** Per-item overrides applied on top of the slot defaults in
   *  raptor.ts. Anything undefined falls back to the slot default. */
  draw?: {
    /** Head: fraction of raptor height. Eyes/neck: fraction of
     *  raptor width. */
    scale?: number;
    /** Radians. Positive = clockwise. */
    rotation?: number;
    /** Extra anchor offset as a fraction of raptor width/height.
     *  +x nudges toward the snout, +y nudges down. */
    offset?: { x?: number; y?: number };
  };
}

export const COSMETICS: ReadonlyArray<CosmeticDef> = [
  // ── Score-unlock classics (free, not for sale) ─────────
  {
    id: "party-hat",
    name: "Party Hat",
    slot: "head",
    price: 0,
    scoreUnlock: true,
    spriteKey: "partyHat",
    description: "Earn by running 1,000 meters in one run.",
  },
  {
    id: "thug-glasses",
    name: "Thug Glasses",
    slot: "eyes",
    price: 0,
    scoreUnlock: true,
    spriteKey: "thugGlasses",
    description: "Earn by running 2,000 meters in one run.",
  },
  {
    id: "bow-tie",
    name: "Bow Tie",
    slot: "neck",
    price: 0,
    scoreUnlock: true,
    spriteKey: "bowTie",
    description: "Earn by running 1,500 meters in one run.",
  },

  // ── Shop: head ────────────────────────────────────────
  {
    id: "cowboy-hat",
    name: "Cowboy Hat",
    slot: "head",
    price: 50,
    spriteKey: "cowboyHat",
    description: "Yeehaw. Fits the desert.",
    draw: { scale: 0.22, rotation: -0.38, offset: { x: 0, y: 0.02 } },
  },
  {
    id: "top-hat",
    name: "Top Hat",
    slot: "head",
    price: 150,
    spriteKey: "topHat",
    description: "Fancy. Pairs with the bow tie.",
    draw: { scale: 0.2, rotation: -0.4, offset: { x: 0, y: 0 } },
  },
  {
    id: "wizard-hat",
    name: "Wizard Hat",
    slot: "head",
    price: 200,
    spriteKey: "wizardHat",
    description: "Pointy and arcane.",
    draw: { scale: 0.32, rotation: -0.12, offset: { x: 0.0, y: 0.04 } },
  },
  {
    id: "pirate-tricorn",
    name: "Pirate Tricorn",
    slot: "head",
    price: 175,
    spriteKey: "pirateTricorn",
    description: "Skull and crossbones, plumed. Pairs with the eye patch.",
    draw: { scale: 0.26, rotation: -0.1, offset: { x: -0.012, y: 0.02 } },
  },
  {
    id: "tiara",
    name: "Diadem",
    slot: "head",
    price: 350,
    spriteKey: "tiara",
    description: "Silver with a sapphire centrepiece.",
    // Tiara sprite has had its right leg cropped so the far band
    // doesn't appear in front of the raptor's face.
    draw: { scale: 0.22, rotation: -0.05, offset: { y: 0.08 } },
  },
  {
    id: "crown",
    name: "Crown",
    slot: "head",
    price: 600,
    spriteKey: "crown",
    description: "Gold, jewelled, and unmistakably regal.",
    // Sprite was cropped down to just the jewelled arches (no
    // decorative band) so it sits higher on the skull.
    draw: { scale: 0.2, rotation: -0.2, offset: { x: -0.0, y: -0.01 } },
  },
  {
    id: "sombrero",
    name: "Sombrero",
    slot: "head",
    price: 75,
    spriteKey: "sombrero",
    description: "Wide-brimmed desert shade.",
    // Massively wide brim — keep small so it doesn't eclipse
    // the head, tilted hard so the brim angles off rather than
    // sitting flat as a disc.
    draw: { scale: 0.26, rotation: -0.5, offset: { x: 0.02, y: 0.03 } },
  },

  // ── Shop: eyes ────────────────────────────────────────
  {
    id: "monocle",
    name: "Monocle",
    slot: "eyes",
    price: 100,
    spriteKey: "monocle",
    description: "Distinguished and a little silly.",
    // Round lens sits at eye level — nudged forward toward the
    // snout so the lens actually covers the eye.
    draw: { scale: 0.05, rotation: 0, offset: { x: 0.01, y: -0.01 } },
  },
  {
    id: "eye-patch",
    name: "Eye Patch",
    slot: "eyes",
    price: 50,
    spriteKey: "eyePatch",
    description: "Arrr.",
    // Centre the patch on the eye — slot-default snout-ridge
    // rotation drapes the small leading strap over the snout.
    draw: { scale: 0.08, offset: { x: -0.005, y: 0 } },
  },

  // ── Shop: neck ────────────────────────────────────────
  {
    id: "bandana",
    name: "Bandana",
    slot: "neck",
    price: 50,
    spriteKey: "bandana",
    description: "Outlaw chic — knot tied at the front.",
    // Tied with the knot at the neck; drapes down over the
    // upper chest.
    draw: { scale: 0.06, rotation: -0.05, offset: { x: -0.02, y: 0.053 } },
  },
  {
    id: "gold-chain",
    name: "Gold Chain",
    slot: "neck",
    price: 200,
    spriteKey: "goldChain",
    description: "Bejewelled bling to match the coin hoard.",
    // Pendant group sits on the neck/chest — scaled down again
    // after the last pass felt too chunky, nudged a touch down
    // and forward so the pendants rest on the throat.
    draw: { scale: 0.063, rotation: -0.3, offset: { x: -0.025, y: 0.05 } },
  },
];

/** O(1) id → def lookup, populated once at module load. */
export const COSMETICS_BY_ID: Record<string, CosmeticDef> = (() => {
  const out: Record<string, CosmeticDef> = Object.create(null);
  for (const c of COSMETICS) out[c.id] = c;
  return out;
})();

/** All cosmetics in a given slot, in the order they're declared
 *  in COSMETICS. Used by the equip menu to render slot subsections. */
export function cosmeticsForSlot(slot: CosmeticSlot): CosmeticDef[] {
  return COSMETICS.filter((c) => c.slot === slot);
}

/** Shop inventory — everything NOT score-unlocked. Grouped by slot
 *  in declaration order. */
export function shopInventory(): CosmeticDef[] {
  return COSMETICS.filter((c) => !c.scoreUnlock);
}

/** Placeholder fill per slot — drawn when a cosmetic has no sprite. */
export const PLACEHOLDER_COLORS: Record<CosmeticSlot, string> = {
  head: "#d97706", // amber
  eyes: "#1f2937", // slate
  neck: "#b91c1c", // red
};

// ── Mutation helpers (grant / buy / equip / unequip) ─────────
// Only path through which owned/equipped state changes. Each helper
// also updates the legacy per-item flags (UNLOCKED_PARTY_HAT_KEY etc.)
// so the Game API shims built on those stay in lockstep.

import {
  UNLOCKED_BOW_TIE_KEY,
  UNLOCKED_PARTY_HAT_KEY,
  UNLOCKED_THUG_GLASSES_KEY,
  WEAR_BOW_TIE_KEY,
  WEAR_PARTY_HAT_KEY,
  WEAR_THUG_GLASSES_KEY,
} from "./constants";
import {
  saveBoolFlag,
  saveCoinsBalance,
  saveEquippedCosmetics,
  saveOwnedCosmetics,
} from "./persistence";
import { state } from "./state";

// Legacy flag bridges for the three score-unlock classics —
// localStorage keys, mirrored state field names. New shop items
// live entirely in the map-based source of truth.
const LEGACY_UNLOCK_KEY: Record<string, string> = {
  "party-hat": UNLOCKED_PARTY_HAT_KEY,
  "thug-glasses": UNLOCKED_THUG_GLASSES_KEY,
  "bow-tie": UNLOCKED_BOW_TIE_KEY,
};
const LEGACY_WEAR_KEY: Record<string, string> = {
  "party-hat": WEAR_PARTY_HAT_KEY,
  "thug-glasses": WEAR_THUG_GLASSES_KEY,
  "bow-tie": WEAR_BOW_TIE_KEY,
};
const LEGACY_UNLOCK_STATE: Record<string, keyof typeof state> = {
  "party-hat": "unlockedPartyHat",
  "thug-glasses": "unlockedThugGlasses",
  "bow-tie": "unlockedBowTie",
};
const LEGACY_WEAR_STATE: Record<string, keyof typeof state> = {
  "party-hat": "wearPartyHat",
  "thug-glasses": "wearThugGlasses",
  "bow-tie": "wearBowTie",
};

// ── Achievement bridge ─────────────────────────────────────────
// cosmetics.ts can't import from main.ts (unlockAchievement lives in
// an init closure, not exported). main.ts registers the callback at
// boot — same pattern particles.ts uses.

type AchievementCallback = (id: string) => void;
let onAchievementUnlock: AchievementCallback | null = null;

export function setCosmeticsAchievementHandler(cb: AchievementCallback | null): void {
  onAchievementUnlock = cb;
}

/** Purchasable-inventory size (excludes scoreUnlock classics). */
const SHOP_INVENTORY_SIZE = COSMETICS.filter((c) => !c.scoreUnlock).length;

/** True once every purchasable cosmetic is owned. Classics excluded
 *  so earning them doesn't partially satisfy a shop-completion goal. */
function _ownsEntireShop(): boolean {
  let owned = 0;
  for (const def of COSMETICS) {
    if (def.scoreUnlock) continue;
    if (state.ownedCosmetics[def.id]) owned += 1;
  }
  return owned >= SHOP_INVENTORY_SIZE;
}

function _allSlotsEquipped(): boolean {
  const e = state.equippedCosmetics;
  return e.head != null && e.eyes != null && e.neck != null;
}

/** Add to inventory. Purchases auto-equip an empty slot; passive rewards
 *  can disable auto-equip to preserve the player's outfit, including bare slots. */
export function grantCosmetic(
  id: string,
  { forceEquip = false, autoEquip = true }: { forceEquip?: boolean; autoEquip?: boolean } = {},
): void {
  const def = COSMETICS_BY_ID[id];
  if (!def) return;
  if (!state.ownedCosmetics[id]) {
    state.ownedCosmetics[id] = true;
    saveOwnedCosmetics(state.ownedCosmetics);
    const stateKey = LEGACY_UNLOCK_STATE[id];
    const storageKey = LEGACY_UNLOCK_KEY[id];
    if (stateKey && storageKey) {
      (state as unknown as Record<string, unknown>)[stateKey] = true;
      saveBoolFlag(storageKey, true);
    }
  }
  if (forceEquip || (autoEquip && state.equippedCosmetics[def.slot] == null)) {
    equipCosmetic(id);
  } else {
    // Boot migration also reads legacy wear flags. A passive grant must
    // not silently equip the reward the next time the player opens the game.
    _setLegacyWear(id, state.equippedCosmetics[def.slot] === id);
  }
}

/** First-time run rewards appear on the raptor immediately. Repeated
 *  milestones leave the player's later wardrobe choices untouched.
 *  Returns whether this unlock should trigger its celebration. */
export function grantRunReward(id: string): boolean {
  const def = COSMETICS_BY_ID[id];
  if (!def?.scoreUnlock || state.ownedCosmetics[id]) return false;
  grantCosmetic(id, { forceEquip: true });
  return true;
}

/**
 * Buy a cosmetic with the current coin balance. Return value is
 * used by the shop UI: "ok" purchased, "owned" already have it,
 * "poor" can't afford it, "unknown" no such cosmetic (defensive).
 */
export type PurchaseResult = "ok" | "owned" | "poor" | "unknown";
export function purchaseCosmetic(id: string): PurchaseResult {
  const def = COSMETICS_BY_ID[id];
  if (!def) return "unknown";
  if (state.ownedCosmetics[id]) return "owned";
  if (state.coinsBalance < def.price) return "poor";
  state.coinsBalance -= def.price;
  saveCoinsBalance(state.coinsBalance);
  grantCosmetic(id);
  // Achievement bridge. Fire after grantCosmetic so the
  // ownedCosmetics entry is set before the completionist check
  // looks at the inventory. unlockAchievement is idempotent on
  // the main.ts side, so re-firing "first-purchase" on every
  // subsequent buy is a no-op after the first.
  if (onAchievementUnlock) {
    onAchievementUnlock("first-purchase");
    if (_ownsEntireShop()) onAchievementUnlock("shop-cleaned-out");
  }
  return "ok";
}

/** Equip in its slot, displacing whatever was there. The displaced
 *  item stays owned. No-op if not in inventory. */
export function equipCosmetic(id: string): void {
  const def = COSMETICS_BY_ID[id];
  if (!def) return;
  if (!state.ownedCosmetics[id]) return;
  const prev = state.equippedCosmetics[def.slot];
  if (prev === id) return;
  if (prev) _clearLegacyWear(prev);
  state.equippedCosmetics[def.slot] = id;
  saveEquippedCosmetics(state.equippedCosmetics);
  _setLegacyWear(id, true);
  // "Jurassic Runway": all four slots occupied at the same time.
  // equipCosmetic is the only function that ADDS to equippedCosmetics,
  // so this is the right place to check — unequip/empty-slot never
  // satisfies the condition.
  if (onAchievementUnlock && _allSlotsEquipped()) {
    onAchievementUnlock("fully-equipped");
  }
}

/** Remove whatever is equipped in the given slot; slot becomes empty. */
export function unequipSlot(slot: CosmeticSlot): void {
  const prev = state.equippedCosmetics[slot];
  if (prev == null) return;
  _clearLegacyWear(prev);
  state.equippedCosmetics[slot] = null;
  saveEquippedCosmetics(state.equippedCosmetics);
}

function _setLegacyWear(id: string, on: boolean): void {
  const stateKey = LEGACY_WEAR_STATE[id];
  const storageKey = LEGACY_WEAR_KEY[id];
  if (!stateKey || !storageKey) return;
  (state as unknown as Record<string, unknown>)[stateKey] = on;
  saveBoolFlag(storageKey, on);
}
function _clearLegacyWear(id: string): void {
  _setLegacyWear(id, false);
}

/** Bridge legacy unlock/wear flags into the map on boot so pre-shop
 *  saves don't render an empty Cosmetics section. Idempotent. */
export function migrateLegacyCosmetics(): void {
  const pairs: Array<[string, boolean, boolean]> = [
    ["party-hat", state.unlockedPartyHat, state.wearPartyHat],
    ["thug-glasses", state.unlockedThugGlasses, state.wearThugGlasses],
    ["bow-tie", state.unlockedBowTie, state.wearBowTie],
  ];
  let changed = false;
  for (const [id, unlocked, worn] of pairs) {
    if (!unlocked) continue;
    if (!state.ownedCosmetics[id]) {
      state.ownedCosmetics[id] = true;
      changed = true;
    }
    const def = COSMETICS_BY_ID[id];
    if (!def) continue;
    // Only fill an empty slot — don't overwrite a new shop item the
    // player has explicitly equipped since the migration.
    if (worn && state.equippedCosmetics[def.slot] == null) {
      state.equippedCosmetics[def.slot] = id;
      changed = true;
    }
  }
  if (changed) {
    saveOwnedCosmetics(state.ownedCosmetics);
    saveEquippedCosmetics(state.equippedCosmetics);
  }
}
