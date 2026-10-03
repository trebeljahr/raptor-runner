import type { MouseEvent } from "react";
import { createPortal } from "react-dom";

export interface ScoreCardActionsProps {
  respawnReady: boolean;
  reviveCost: number | null;
  reviveBalance: number | null;
  reviveAffordable: boolean;
  reviveShortfall: number;
  result: { score: number; best: number; coins: number; record: boolean } | null;
  shareReady: boolean;
  rewards: string[];
  shareLabel: string;
  onRevive: () => void;
  onShare: () => void;
  onRestart: () => void;
}

export function ScoreCardActions({
  respawnReady,
  reviveCost,
  reviveBalance,
  reviveAffordable,
  result,
  shareReady,
  shareLabel,
  onRevive,
  onShare,
  onRestart,
}: ScoreCardActionsProps) {
  const handleRevive = (e: MouseEvent) => {
    e.stopPropagation();
    onRevive();
  };

  const handleShare = (e: MouseEvent) => {
    e.stopPropagation();
    onShare();
  };

  const handleRestart = (e: MouseEvent) => {
    e.stopPropagation();
    onRestart();
  };

  return (
    <>
      <button
        className={"revive-btn" + (!reviveAffordable ? " poor" : "")}
        type="button"
        hidden={reviveCost == null}
        disabled={!respawnReady || !reviveAffordable}
        aria-label={`Revive for ${reviveCost ?? 0} coins`}
        onClick={handleRevive}
      >
        <span className="revive-btn-inner">
          <img src="assets/coin.png" alt="" className="coin-icon" aria-hidden="true" />
          <span className="revive-btn-label">
            Revive · <span>{reviveCost ?? 0}</span>
          </span>
        </span>
      </button>
      {/* No aria-live here on purpose: the coin-fill tween rewrites
          this number every animation frame for ~1.2s, and a live
          region would queue dozens of announcements. Screen readers
          still get the settled value when reading the card. */}
      <div className="revive-balance" hidden={reviveCost == null || reviveBalance == null}>
        You have <span>{reviveBalance ?? 0}</span> coins
        <img src="assets/coin.png" alt="" className="coin-icon" aria-hidden="true" />
      </div>
      {result && (
        <div className="revive-balance">
          {result.coins} {result.coins === 1 ? "coin" : "coins"} earned this run
          <img src="assets/coin.png" alt="" className="coin-icon" aria-hidden="true" />
        </div>
      )}
      <div className="score-card-actions">
        {/* No aria-label: the visible label IS the accessible name, so
            the "Copied!" / "Shared!" feedback flashes are announced
            (the label span is a polite live region) instead of being
            masked by a static override. */}
        <button
          className="share-score-btn"
          type="button"
          disabled={!shareReady}
          onClick={handleShare}
        >
          <span className="inner">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="18" cy="5" r="3"></circle>
              <circle cx="6" cy="12" r="3"></circle>
              <circle cx="18" cy="19" r="3"></circle>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
            </svg>
            <span className="label" aria-live="polite">
              {shareLabel}
            </span>
          </span>
        </button>
        <button
          className="play-again-btn"
          type="button"
          aria-label="Play again"
          disabled={!respawnReady}
          onClick={handleRestart}
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
            <polygon points="6 4 20 12 6 20 6 4"></polygon>
          </svg>
          <span>Play again</span>
        </button>
      </div>
      {(() => {
        // The hint lives outside .score-card-body in the original
        // layout (direct child of #score-card-panel, below the flex
        // container that holds the slot + actions). Portal it to a
        // dedicated root so its position in the flex cascade stays
        // identical to the vanilla DOM.
        const hintHost = document.getElementById("score-card-hint-root");
        if (!hintHost) return null;
        return createPortal(
          <button
            type="button"
            className="score-card-hint"
            aria-label="Restart"
            disabled={!respawnReady}
            onClick={handleRestart}
          >
            <span className="kbd-hint">
              Press <kbd>Enter</kbd> to restart
            </span>
            {/* Restart = the family's confirm button; one <kbd> per
                family, CSS reveals the one matching the pad-family-*
                body class (see src/input/padFamily.ts). */}
            <span className="pad-hint">
              <kbd className="gp-select glyph-xbox">A</kbd>
              <kbd className="gp-select glyph-ps">✕</kbd>
              <kbd className="gp-select glyph-nintendo">A</kbd>
              <kbd className="gp-select glyph-generic">●</kbd> to restart
            </span>
          </button>,
          hintHost,
        );
      })()}
    </>
  );
}
