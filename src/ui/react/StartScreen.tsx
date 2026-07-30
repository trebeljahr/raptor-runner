// @ts-nocheck
/*
 * Start screen content + byline — React port of the .start-content
 * and .start-byline blocks in index.html. The outer #start-screen
 * wrapper, its backdrop (ground strip, cloud SVGs, parallax cacti),
 * and the cosmetic-aware raptor stage all stay vanilla because they
 * are CSS-animated or painted imperatively by refreshStartRaptorCosmetics
 * and don't benefit from React's tree.
 *
 * Dynamic bits that live here:
 *   - Start button state (loading while assets fetch, ready after
 *     Game.onReady fires). Label and disabled flag follow assetsReady.
 *   - Personal-best badge — visible only when the saved high-score
 *     is > 0. Reads live from Game.getHighScore().
 *   - Subtitle / hints / homage / byline — mostly static text, but
 *     included here so the start-screen chrome is one coherent
 *     component rather than being split.
 *
 * The "Start Game" click delegates back to ui.ts's triggerStart
 * through the onStart prop. The tap-animation class toggle stays in
 * ui.ts (it queries #start-btn by id after render) so the same
 * keyboard path (window.__onStartKey) and the click path share one
 * animation pipeline.
 */
import type { MouseEvent } from "react";

export interface StartScreenCallbacks {
  onStart: () => void;
  getHighScore: () => number;
  getAssetsReady: () => boolean;
}

export interface StartScreenProps {
  callbacks: StartScreenCallbacks;
}

export function StartScreen({ callbacks: cb }: StartScreenProps) {
  const ready = cb.getAssetsReady();
  const hs = cb.getHighScore();
  const showHighScore = hs > 0;

  const handleStart = (e: MouseEvent) => {
    e.stopPropagation();
    cb.onStart();
  };

  return (
    <>
      <div className="start-content">
        <h1>Raptor Runner</h1>
        <p className="subtitle">Jump the cacti. Don't let the raptor die.</p>
        <p className="homage">A homage to the Google "No Internet" idle game.</p>
        {showHighScore && (
          <p className="start-highscore">
            ★ Personal best: <span>{Math.floor(hs)}</span>
          </p>
        )}
        <button
          id="start-btn"
          className={"start-btn" + (ready ? "" : " loading")}
          type="button"
          disabled={!ready}
          onClick={handleStart}
        >
          <span className="spinner" aria-hidden="true"></span>
          <svg
            className="play-icon"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M8 5v14l11-7z"></path>
          </svg>
          <span className="label">{ready ? "Start Game" : "Loading…"}</span>
        </button>
        <p className="start-hint start-hint-desktop">
          Tip: press <kbd>Space</kbd> or tap to jump · <kbd>Esc</kbd> for menu
        </p>
        <p className="start-hint start-hint-touch">Tip: Tap to jump</p>
        {/* Jump = the family's confirm button; one <kbd> per family,
            CSS reveals the one matching the pad-family-* body class
            (see src/input/padFamily.ts). The ☰ menu glyph is
            universal across pads. */}
        <p className="start-hint start-hint-gamepad">
          Tip: <kbd className="glyph-xbox">A</kbd>
          <kbd className="glyph-ps">✕</kbd>
          <kbd className="glyph-nintendo">A</kbd>
          <kbd className="glyph-generic">●</kbd> to jump · <kbd>☰</kbd> for menu
        </p>
      </div>
      <p className="start-byline">
        Made with{" "}
        <svg
          className="heart"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 01-.383-.218 25.18 25.18 0 01-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0112 5.052 5.5 5.5 0 0116.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 01-4.244 3.17 15.247 15.247 0 01-.383.219l-.022.012-.007.004-.003.001a.752.752 0 01-.704 0l-.003-.001z" />
        </svg>{" "}
        by{" "}
        <span className="web-only">
          <a href="https://portfolio.trebeljahr.com" target="_blank" rel="noreferrer noopener">
            Rico Trebeljahr
          </a>{" "}
          <span className="dot">·</span>{" "}
          <a href="https://ricos.site/newsletters" target="_blank" rel="noreferrer noopener">
            Writing at ricos.site
          </a>{" "}
          <span className="dot">·</span> Dino Art by{" "}
          <a href="https://www.instagram.com/chrismasna" target="_blank" rel="noreferrer noopener">
            Chris Masna
          </a>
        </span>
        <span className="desktop-only">
          Rico Trebeljahr <span className="dot">·</span> Dino Art by Chris Masna
        </span>
      </p>
    </>
  );
}
