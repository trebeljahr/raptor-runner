/*
 * Cosmetics body — React port of renderCosmeticsMenu() +
 * _buildCosmeticSlotRow() + _setThumbForId() from src/ui.ts. The
 * outer <details id="cosmetics"> and its <summary> stay vanilla in
 * index.html; this component renders the .cosmetics-body contents.
 *
 * Visuals are unchanged: class names, data-slot attribute, the
 * "None" SVG icon, the slot-tinted placeholder thumb, the
 * aria-pressed=true + .cosmetic-equip-badge on the currently-equipped
 * row — all copied verbatim from the vanilla builder.
 *
 * Ownership drives visibility at three levels:
 *   - The whole <details> gating (toggled from ui.ts via the
 *     `hidden` attribute on #cosmetics) if no cosmetic is owned.
 *   - Per-slot sections that only render when the slot has at least
 *     one owned item.
 *   - Per-item rows for every owned item in that slot, plus a
 *     leading "None" row to unequip.
 *
 * ui.ts owns the Game API writes (equipCosmetic / unequipSlot) and
 * the side-effect fanout (start-screen raptor preview refresh) via
 * the callbacks prop.
 */
import type { MouseEvent } from "react";

export interface CosmeticsMenuCallbacks {
  onEquipCosmetic: (id: string) => void;
  onUnequipSlot: (slot: "head" | "eyes" | "neck") => void;
}

const SPRITE_MAP: Record<string, string> = {
  partyHat: "assets/party-hat.png",
  thugGlasses: "assets/thug-glasses.png",
  bowTie: "assets/bow-tie.png",
  cowboyHat: "assets/cosmetics/cowboy-hat.png",
  topHat: "assets/cosmetics/top-hat.png",
  wizardHat: "assets/cosmetics/wizard-hat.png",
  pirateTricorn: "assets/cosmetics/pirate-tricorn.png",
  tiara: "assets/cosmetics/tiara.png",
  monocle: "assets/cosmetics/monocle.png",
  eyePatch: "assets/cosmetics/eye-patch.png",
  goldChain: "assets/cosmetics/gold-chain.png",
  sombrero: "assets/cosmetics/sombrero.png",
  bandana: "assets/cosmetics/bandana.png",
  crown: "assets/cosmetics/crown.png",
};
function spriteUrlForId(id: string): string | null {
  const all = window.Game?.getAllCosmetics?.() ?? [];
  const def = all.find((c: { id: string }) => c.id === id);
  if (!def?.spriteKey) return null;
  return SPRITE_MAP[def.spriteKey] ?? null;
}

const SLOT_COLOR: Record<string, string> = {
  head: "#d97706",
  eyes: "#1f2937",
  neck: "#b91c1c",
};

const COSMETIC_SLOT_UI = [
  { slot: "head" as const, label: "Head" },
  { slot: "eyes" as const, label: "Eyes" },
  { slot: "neck" as const, label: "Neck" },
];

function NoneIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
      className="cosmetic-none-icon"
    >
      <circle cx="12" cy="12" r="9"></circle>
      <line x1="5.6" y1="5.6" x2="18.4" y2="18.4"></line>
    </svg>
  );
}

interface OptionThumbProps {
  id: string | null;
  slot: "head" | "eyes" | "neck";
}
function OptionThumb({ id, slot }: OptionThumbProps) {
  const spriteUrl = id ? spriteUrlForId(id) : null;
  const cls =
    "cosmetic-option-thumb" +
    (spriteUrl ? " cosmetic-slot-thumb-sprite" : "") +
    (id == null ? " cosmetic-slot-thumb-none" : "");
  if (spriteUrl) {
    return (
      <div className={cls}>
        <img src={spriteUrl} alt="" />
      </div>
    );
  }
  if (id == null) {
    return (
      <div className={cls}>
        <NoneIcon />
      </div>
    );
  }
  return <div className={cls} style={{ background: SLOT_COLOR[slot] ?? "#555" }} />;
}

export interface CosmeticsMenuProps {
  callbacks: CosmeticsMenuCallbacks;
}

export function CosmeticsMenu({ callbacks: cb }: CosmeticsMenuProps) {
  const Game = window.Game;
  const all = Game?.getAllCosmetics?.() ?? [];
  const owned = all.filter((c) => Game?.ownsCosmetic?.(c.id) === true);

  return (
    <>
      {COSMETIC_SLOT_UI.map(({ slot, label }) => {
        const ownedInSlot = owned.filter((c) => c.slot === slot);
        if (ownedInSlot.length === 0) return null;
        const equippedId = Game?.getEquippedCosmetic?.(slot) ?? null;

        const options: Array<{ id: string | ""; name: string }> = [
          { id: "", name: "None" },
          ...ownedInSlot.map((c) => ({ id: c.id, name: c.name })),
        ];

        return (
          <div key={slot} className="cosmetic-slot" data-slot={slot}>
            <h3 className="cosmetic-slot-label">{label}</h3>
            <ul className="menu-group-body cosmetic-slot-body">
              {options.map((opt) => {
                const isEquipped = (opt.id === "" && equippedId == null) || opt.id === equippedId;
                const handleClick = (e: MouseEvent) => {
                  e.stopPropagation();
                  Game?.playMenuTap?.();
                  // "None" row and a click on the already-equipped row
                  // both unequip the slot. The toggle lets a controller
                  // player turn a cosmetic off without first navigating
                  // down to the "None" row.
                  if (opt.id === "" || isEquipped) cb.onUnequipSlot(slot);
                  else cb.onEquipCosmetic(opt.id);
                };
                return (
                  <li key={opt.id || "__none__"}>
                    <button
                      type="button"
                      className="menu-item cosmetic-equip-btn"
                      aria-pressed={isEquipped ? "true" : "false"}
                      onClick={handleClick}
                    >
                      <span className="inner">
                        <OptionThumb id={opt.id || null} slot={slot} />
                        <span className="cosmetic-option-name">{opt.name}</span>
                        {isEquipped && <span className="cosmetic-equip-badge">Equipped</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </>
  );
}
