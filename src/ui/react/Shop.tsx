// @ts-nocheck
/*
 * Shop overlay — React port of renderShop() / refreshShopBalance() from
 * src/ui.ts. Visuals are unchanged: every CSS class name is copied
 * verbatim from the vanilla implementation, and the DOM structure is
 * identical (imprint-sheet > imprint-close + shop-scroll > heading +
 * balance + items + empty-hint).
 *
 * State flow:
 *   - Reads from window.Game on every render (coin balance, shop
 *     inventory, owned/equipped status). The component is re-rendered
 *     on every shop open (see mountShop.ts) and on every buy/equip via
 *     an internal version counter.
 *   - Notifies ui.ts through onShopChange after any mutation so the
 *     menu-button coin chip and the start-screen raptor preview can
 *     refresh outside React's tree.
 *
 * Pixel-identical to the vanilla Shop: confetti colours, sprite map,
 * and slot colours all come straight from the original code paths.
 */
import { type MouseEvent, useCallback, useState } from "react";

const SLOT_COLOR: Record<string, string> = {
  head: "#d97706",
  eyes: "#1f2937",
  neck: "#b91c1c",
  back: "#7c3aed",
};

const SLOT_LABEL: Record<string, string> = {
  head: "Head",
  eyes: "Eyes",
  neck: "Neck",
  back: "Back",
};

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

const CONFETTI_COLORS = [
  "#ff4d6d",
  "#ffb703",
  "#06d6a0",
  "#118ab2",
  "#8338ec",
  "#ffd60a",
  "#ff7b00",
  "#ef476f",
];

function spawnShopConfetti(originX: number, originY: number) {
  const layer = document.createElement("div");
  layer.style.cssText =
    "position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:3000;";
  document.body.appendChild(layer);
  interface P {
    el: HTMLElement;
    x: number;
    y: number;
    vx: number;
    vy: number;
    rot: number;
    vrot: number;
    age: number;
    life: number;
  }
  const particles: P[] = [];
  for (let i = 0; i < 24; i++) {
    const el = document.createElement("div");
    const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    const size = 6 + Math.random() * 5;
    el.style.cssText =
      `position:absolute;left:${originX}px;top:${originY}px;` +
      `width:${size}px;height:${size * 0.6}px;` +
      `background:${color};border-radius:1px;will-change:transform,opacity;`;
    layer.appendChild(el);
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.4;
    const speed = 220 + Math.random() * 280;
    particles.push({
      el,
      x: originX,
      y: originY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 10,
      age: 0,
      life: 0.9 + Math.random() * 0.6,
    });
  }
  let lastT = performance.now();
  function step(now: number) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    let alive = 0;
    for (const p of particles) {
      if (p.age >= p.life) continue;
      p.age += dt;
      p.vy += 780 * dt;
      p.vx *= 0.99;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vrot * dt;
      const t = p.age / p.life;
      const alpha = t < 0.8 ? 1 : Math.max(0, 1 - (t - 0.8) / 0.2);
      p.el.style.transform = `translate(${p.x - originX}px, ${p.y - originY}px) rotate(${p.rot}rad)`;
      p.el.style.opacity = String(alpha);
      if (p.age < p.life) alive++;
    }
    if (alive > 0) requestAnimationFrame(step);
    else layer.remove();
  }
  requestAnimationFrame(step);
}

interface ShopDef {
  id: string;
  name: string;
  slot: string;
  price: number;
  description?: string;
}

interface ShopItemProps {
  def: ShopDef;
  balance: number;
  debug: boolean;
  onChange: () => void;
}

function ShopItem({ def, balance, debug, onChange }: ShopItemProps) {
  const Game = window.Game;
  const owned = Game?.ownsCosmetic?.(def.id) === true;
  const equipped = Game?.isCosmeticEquipped?.(def.id) === true;
  const thumbUrl = spriteUrlForId(def.id);
  const canAfford = balance >= def.price;
  const isDebugFree = debug && !canAfford;

  const handleEquip = (e: MouseEvent) => {
    e.stopPropagation();
    Game?.playMenuTap?.();
    Game?.equipCosmetic?.(def.id);
    onChange();
  };

  const handleUnequip = (e: MouseEvent) => {
    e.stopPropagation();
    Game?.playMenuTap?.();
    Game?.unequipSlot?.(def.slot);
    onChange();
  };

  const handleBuy = (e: MouseEvent) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const res = Game?.buyCosmetic?.(def.id);
    if (res === "ok") {
      Game?.playShopPurchase?.();
      spawnShopConfetti(cx, cy);
      onChange();
    }
  };

  const thumbStyle = thumbUrl ? undefined : { background: SLOT_COLOR[def.slot] ?? "#555" };
  const thumbClass = thumbUrl ? "shop-item-thumb shop-item-thumb-sprite" : "shop-item-thumb";

  // biome-ignore lint/suspicious/noImplicitAnyLet: auto-suppressed during biome 2.x bump
  let action;
  if (equipped) {
    // Click toggles off — matches the cosmetics drawer so controller
    // players can unequip without backing out of the shop.
    action = (
      <button
        type="button"
        className="shop-item-action shop-item-action-equipped"
        onClick={handleUnequip}
      >
        Equipped
      </button>
    );
  } else if (owned) {
    action = (
      <button type="button" className="shop-item-action" onClick={handleEquip}>
        Equip
      </button>
    );
  } else if (canAfford || debug) {
    action = (
      <button type="button" className="shop-item-action" onClick={handleBuy}>
        <span className="shop-item-price">
          {isDebugFree ? `Buy · ${def.price} (debug)` : `Buy · ${def.price}`}
        </span>
        <img src="assets/coin.png" alt="" className="coin-icon" aria-hidden="true" />
      </button>
    );
  } else {
    // aria-disabled (not disabled) so the d-pad focus ring can still
    // land on the row and show the player what's locked behind what
    // price. The CSS gives it a dashed, low-opacity look so it's
    // visibly non-actionable.
    action = (
      <button type="button" className="shop-item-action shop-item-action-poor" aria-disabled="true">
        <span className="shop-item-price">{def.price}</span>
        <img src="assets/coin.png" alt="" className="coin-icon" aria-hidden="true" />
      </button>
    );
  }

  return (
    <div className="shop-item" data-id={def.id}>
      <div className={thumbClass} style={thumbStyle}>
        {thumbUrl ? (
          <img src={thumbUrl} alt="" loading="lazy" />
        ) : (
          def.name.slice(0, 2).toUpperCase()
        )}
      </div>
      <div className="shop-item-info">
        <div className="shop-item-name">{def.name}</div>
        <div className="shop-item-meta-row">
          <div className="shop-item-slot">{SLOT_LABEL[def.slot] ?? def.slot}</div>
          {owned && <span className="shop-item-owned-pill">Owned</span>}
        </div>
        {def.description && <div className="shop-item-description">{def.description}</div>}
      </div>
      {action}
    </div>
  );
}

export interface ShopProps {
  onClose: () => void;
  onShopChange: () => void;
}

export function Shop({ onClose, onShopChange }: ShopProps) {
  const [, setVersion] = useState(0);
  const bump = useCallback(() => {
    setVersion((v) => v + 1);
    onShopChange();
  }, [onShopChange]);

  const Game = window.Game;
  const inventory: ShopDef[] = Game?.getShopInventory?.() ?? [];
  const balance: number = Game?.getCoinsBalance?.() ?? 0;
  const debug = Game?.isDebug?.() === true;

  const handleClose = (e: MouseEvent) => {
    e.stopPropagation();
    onClose();
  };

  return (
    <div className="imprint-sheet shop-sheet">
      <button className="imprint-close" aria-label="Close" onClick={handleClose}>
        ×
      </button>
      <div className="shop-scroll">
        <h1 className="shop-heading" tabIndex={-1}>
          Shop
        </h1>
        <p className="shop-balance">
          <span className="shop-balance-label">Coins</span>
          <span className="shop-balance-value">
            <span>{balance}</span>
            <img src="assets/coin.png" alt="" className="coin-icon" aria-hidden="true" />
          </span>
        </p>
        {inventory.length === 0 ? (
          <p className="shop-empty-hint">Collect coins on the flower fields to spend them here.</p>
        ) : (
          <div className="shop-items">
            {inventory.map((def) => (
              <ShopItem key={def.id} def={def} balance={balance} debug={debug} onChange={bump} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
