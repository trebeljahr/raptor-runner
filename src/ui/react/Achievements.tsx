// @ts-nocheck
/*
 * Achievements overlay — React port of renderAchievementsList() +
 * buildAchievementIconNode() from src/ui.ts. Visuals unchanged: every
 * CSS class name, DOM structure, and icon shape is copied verbatim
 * from the vanilla implementation.
 *
 * The achievement list is re-read from window.Game.getAchievements()
 * on every render. The mount helper re-renders on every overlay open,
 * and ui.ts also calls it from doReset() so a progress wipe repaints
 * the list without the overlay having to close and reopen.
 *
 * The secret-achievement handling ("???" title + "?" icon until
 * unlocked) matches the original rule: isHidden = a.secret && !a.unlocked.
 * iconHTML is inline SVG markup from main.ts's ACHIEVEMENTS table;
 * iconImage is a path to a sprite. dangerouslySetInnerHTML is safe
 * here because both inputs are static strings defined in main.ts, not
 * user data.
 *
 * The "View on Steam" button delegates to window.electronAPI — a
 * desktop-only bridge exposed by electron/preload.ts. The CSS class
 * `desktop-only` keeps it hidden on web/mobile builds.
 */
import { type MouseEvent, useEffect, useRef } from "react";

interface Achievement {
  id: string;
  title: string;
  desc: string;
  unlocked?: boolean;
  secret?: boolean;
  iconHTML?: string;
  iconImage?: string;
}

function AchievementIcon({ ach, hidden }: { ach: Achievement; hidden: boolean }) {
  if (hidden) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <text x="12" y="17" textAnchor="middle" fontSize="16" fill="#aaa">
          ?
        </text>
      </svg>
    );
  }
  if (ach.iconImage) {
    return <img src={ach.iconImage} alt="" aria-hidden="true" className="achievement-icon-image" />;
  }
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ach.iconHTML ?? "" }}
    />
  );
}

export interface AchievementsProps {
  onClose: () => void;
}

export function Achievements({ onClose }: AchievementsProps) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    // Mirror the vanilla openAchievements() focus move: the × button
    // is the first stop so keyboard / gamepad users can immediately
    // close with Enter/Space, and the previous heading-focus caused
    // gamepad navigation to stall on a non-interactive element.
    closeRef.current?.focus();
  }, []);

  const list: Achievement[] = window.Game?.getAchievements?.() ?? [];
  const unlockedCount = list.reduce((n, a) => n + (a.unlocked ? 1 : 0), 0);

  const handleClose = (e: MouseEvent) => {
    e.stopPropagation();
    onClose();
  };

  const handleSteamClick = () => {
    if (window.electronAPI && typeof window.electronAPI.openSteamOverlay === "function") {
      window.electronAPI.openSteamOverlay("Achievements");
    }
  };

  return (
    <div className="imprint-sheet achievements-sheet">
      <button
        type="button"
        ref={closeRef}
        className="imprint-close"
        aria-label="Close"
        onClick={handleClose}
      >
        ×
      </button>
      <div className="achievements-scroll">
        <h1 className="achievements-heading" tabIndex={-1}>
          Achievements
        </h1>
        <p className="achievements-progress">
          {unlockedCount} / {list.length} unlocked
        </p>
        <button
          className="achievements-steam-link steam-only"
          type="button"
          onClick={handleSteamClick}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10"></circle>
            <polygon points="10 8 16 12 10 16 10 8"></polygon>
          </svg>
          View on Steam
        </button>
        <ul className="achievements-list">
          {list.map((a) => {
            const isHidden = !!a.secret && !a.unlocked;
            return (
              <li key={a.id} className={"achievement-item " + (a.unlocked ? "unlocked" : "locked")}>
                <div className="icon">
                  <AchievementIcon ach={a} hidden={isHidden} />
                </div>
                <div className="body">
                  <div className="title">{isHidden ? "???" : a.title}</div>
                  <div className="desc">
                    {isHidden ? "Keep playing to discover this secret..." : a.desc}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
