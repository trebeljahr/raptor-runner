/* Home controls read current loading, progress, and keyboard settings. */
import type { MouseEvent } from "react";
import { formatKeyCode } from "../../input/keyLabels";

export interface StartScreenCallbacks {
  onStart: () => void;
  getHighScore: () => number;
  getAssetsReady: () => boolean;
  getLoadingState: () => {
    status: "loading" | "error" | "ready";
    message: string | null;
    canRetry: boolean;
  };
  getJumpKeys: () => string[];
}

export interface StartScreenProps {
  callbacks: StartScreenCallbacks;
}

export function StartScreen({ callbacks: cb }: StartScreenProps) {
  const ready = cb.getAssetsReady();
  const loading = cb.getLoadingState();
  const failed = loading.status === "error";
  const hs = cb.getHighScore();
  const nextGoal = window.Game?.getAchievements().find(
    (a) => !a.unlocked && !a.secret && a.progress,
  );
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
        {ready && nextGoal && <p className="start-next-goal">Next goal: {nextGoal.desc}</p>}
        <button
          id="start-btn"
          className={"start-btn" + (!ready && !failed ? " loading" : "")}
          type="button"
          disabled={!ready && !failed}
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
          <span className="label">
            {ready
              ? "Start Game"
              : failed
                ? loading.canRetry
                  ? "Retry loading"
                  : "Reload game"
                : "Loading…"}
          </span>
        </button>
        {failed && (
          <p className="start-error" role="alert">
            {loading.message}
          </p>
        )}
        <p className="start-hint start-hint-desktop">
          <kbd>Enter</kbd> to start ·{" "}
          {cb.getJumpKeys().map((code, index) => (
            <span key={code}>
              {index > 0 ? " / " : ""}
              <kbd>{formatKeyCode(code)}</kbd>
            </span>
          ))}{" "}
          to jump · <kbd>Esc</kbd> for menu
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
      {/* The heart is aria-hidden, so the sr-only "love" right after it
          makes the byline copy and read as "Made with love by…". Keep
          it flush against </svg>: a space before it garbles the copied
          spacing ("with  loveby"). */}
      <p className="start-byline">
        Made with{" "}
        <svg
          className="heart"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 01-.383-.218 25.18 25.18 0 01-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0112 5.052 5.5 5.5 0 0116.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 01-4.244 3.17 15.247 15.247 0 01-.383.219l-.022.012-.007.004-.003.001a.752.752 0 01-.704 0l-.003-.001z" />
        </svg>
        <span className="sr-only">love</span> by{" "}
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
