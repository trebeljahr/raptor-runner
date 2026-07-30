// @ts-nocheck
/*
 * Main pause-menu navigation list + footer — React port of the <ul>
 * of buttons between the cosmetics / debug sections and the
 * close-hint in the vanilla .menu-panel. Plus the four trailing
 * elements (Resume-game hint, "Press Esc to close", gamepad hint
 * row, "Made with ♥ by…" paragraph) which logically belong to the
 * same menu-list footer group.
 *
 * The outer .menu-panel wrapper, the <h2 id="menu-title">, the
 * sound-settings / cosmetics / debug <details> blocks, and the Shop
 * button all stay vanilla. This component mounts into a dedicated
 * #menu-list-root div placed where the old <ul> used to be.
 *
 * Button click handlers delegate entirely to the callbacks prop so
 * ui.ts keeps owning the Game-API writes and overlay choreography
 * (openCredits, openAchievements, resetConfirm, install prompt,
 * fullscreen IPC, etc.). Dynamic labels — fullscreen's "on/off",
 * the install-button visibility — come in through getter callbacks
 * so ui.ts can compute them once and pass the result on each render.
 */
import type { MouseEvent } from "react";
import { DONATE_URL, ITCH_STORE_URL, STEAM_WISHLIST_URL } from "../../config/externalLinks";

export interface MenuListCallbacks {
  onClose: () => void;
  onHome: () => void;
  onAchievements: () => void;
  onResetProgress: () => void;
  onInstall: () => void;
  onAbout: () => void;
  onCredits: () => void;
  onImprint: () => void;
  onSteamStore: () => void;
  onSteamFriends: () => void;
  onFullscreen: () => void;
  onQuit: () => void;

  getInstallAvailable: () => boolean;
  getFullscreenLabel: () => string;
}

function stop(e: MouseEvent) {
  e.stopPropagation();
}

export interface MenuListProps {
  callbacks: MenuListCallbacks;
}

export function MenuList({ callbacks: cb }: MenuListProps) {
  const handleAbout = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    cb.onAbout();
  };
  const handleImprint = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    cb.onImprint();
  };

  return (
    <>
      <ul>
        <li className="in-game-only">
          <button
            className="menu-item"
            type="button"
            onClick={(e) => {
              stop(e);
              cb.onHome();
            }}
          >
            <span className="inner">
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
                <path d="M3 12L12 3l9 9"></path>
                <path d="M5 10v10h14V10"></path>
              </svg>
              <span>Back to home screen</span>
            </span>
          </button>
        </li>
        <li>
          <button
            className="menu-item"
            type="button"
            onClick={(e) => {
              stop(e);
              cb.onAchievements();
            }}
          >
            <span className="inner">
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
                <path d="M8 21h8" />
                <path d="M12 17v4" />
                <path d="M7 4h10v5a5 5 0 0 1-10 0V4z" />
                <path d="M7 6H4a2 2 0 0 0-2 2v1a3 3 0 0 0 3 3h2" />
                <path d="M17 6h3a2 2 0 0 1 2 2v1a3 3 0 0 1-3 3h-2" />
              </svg>
              <span>Achievements</span>
            </span>
          </button>
        </li>
        <li className="pre-game-only">
          <button
            className="menu-item"
            type="button"
            onClick={(e) => {
              stop(e);
              cb.onResetProgress();
            }}
          >
            <span className="inner">
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
                <path d="M3 12a9 9 0 1 0 3-6.7"></path>
                <polyline points="3 4 3 10 9 10"></polyline>
              </svg>
              <span>Reset all progress</span>
            </span>
          </button>
        </li>
        {cb.getInstallAvailable() && (
          <li className="web-only">
            <button
              className="menu-item"
              type="button"
              onClick={(e) => {
                stop(e);
                cb.onInstall();
              }}
            >
              <span className="inner">
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
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span>Install App</span>
              </span>
            </button>
          </li>
        )}
        <li>
          <a className="menu-item" href="about.html" onClick={handleAbout}>
            <span className="inner">
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
                <line x1="12" y1="16" x2="12" y2="12"></line>
                <line x1="12" y1="8" x2="12.01" y2="8"></line>
              </svg>
              <span>About</span>
            </span>
          </a>
        </li>
        <li>
          <button
            className="menu-item"
            type="button"
            onClick={(e) => {
              stop(e);
              cb.onCredits();
            }}
          >
            <span className="inner">
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
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                <circle cx="12" cy="7" r="4"></circle>
              </svg>
              <span>Credits</span>
            </span>
          </button>
        </li>
        <li className="web-only">
          <a className="menu-item" href="imprint.html" onClick={handleImprint}>
            <span className="inner">
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
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
                <polyline points="10 9 9 9 8 9"></polyline>
              </svg>
              <span>Imprint</span>
            </span>
          </a>
        </li>
        <li className="web-only">
          <a className="menu-item" href={ITCH_STORE_URL} target="_blank" rel="noreferrer noopener">
            <span className="inner">
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
                <path d="M3 9h18"></path>
                <path d="M3 9v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9"></path>
                <path d="M5 9l1-5h12l1 5"></path>
              </svg>
              <span>View on itch.io</span>
            </span>
          </a>
        </li>
        <li className="web-only">
          <a
            className="menu-item"
            href={STEAM_WISHLIST_URL}
            target="_blank"
            rel="noreferrer noopener"
          >
            <span className="inner">
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
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
              </svg>
              <span>Wishlist on Steam</span>
            </span>
          </a>
        </li>
        <li>
          <a className="menu-item" href={DONATE_URL} target="_blank" rel="noreferrer noopener">
            <span className="inner">
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
                <path d="M12 2v20"></path>
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
              </svg>
              <span>Support / Donate</span>
            </span>
          </a>
        </li>
        <li className="web-only">
          <a
            className="menu-item"
            href="https://github.com/trebeljahr/velociraptor"
            target="_blank"
            rel="noreferrer noopener"
          >
            <span className="inner">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M12 .5C5.648.5.5 5.648.5 12c0 5.082 3.292 9.393 7.862 10.917.575.106.787-.25.787-.556 0-.275-.01-1.002-.015-1.966-3.198.695-3.874-1.542-3.874-1.542-.522-1.326-1.275-1.679-1.275-1.679-1.044-.714.079-.699.079-.699 1.154.081 1.762 1.185 1.762 1.185 1.025 1.757 2.689 1.249 3.344.955.104-.742.401-1.249.729-1.537-2.553-.29-5.238-1.277-5.238-5.683 0-1.256.45-2.282 1.185-3.087-.119-.29-.513-1.46.112-3.045 0 0 .966-.309 3.164 1.179a11.02 11.02 0 0 1 2.88-.388c.978.004 1.962.132 2.881.388 2.197-1.488 3.16-1.179 3.16-1.179.627 1.585.233 2.755.114 3.045.738.805 1.184 1.831 1.184 3.087 0 4.418-2.69 5.39-5.252 5.674.413.356.78 1.058.78 2.133 0 1.541-.014 2.783-.014 3.162 0 .308.208.668.792.555C20.21 21.39 23.5 17.08 23.5 12c0-6.352-5.148-11.5-11.5-11.5z" />
              </svg>
              <span>GitHub</span>
            </span>
          </a>
        </li>
        <li className="steam-only">
          <button
            className="menu-item"
            type="button"
            onClick={(e) => {
              stop(e);
              cb.onSteamStore();
            }}
          >
            <span className="inner">
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
                <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"></path>
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <path d="M16 10a4 4 0 0 1-8 0"></path>
              </svg>
              <span>View on Steam Store</span>
            </span>
          </button>
        </li>
        <li className="steam-only">
          <button
            className="menu-item"
            type="button"
            onClick={(e) => {
              stop(e);
              cb.onSteamFriends();
            }}
          >
            <span className="inner">
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
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
              </svg>
              <span>Friends on Steam</span>
            </span>
          </button>
        </li>
        <li className="desktop-only">
          <button
            className="menu-item"
            type="button"
            onClick={(e) => {
              stop(e);
              cb.onFullscreen();
            }}
          >
            <span className="inner">
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
                <path d="M8 3H5a2 2 0 0 0-2 2v3"></path>
                <path d="M21 8V5a2 2 0 0 0-2-2h-3"></path>
                <path d="M3 16v3a2 2 0 0 0 2 2h3"></path>
                <path d="M16 21h3a2 2 0 0 0 2-2v-3"></path>
              </svg>
              <span>{cb.getFullscreenLabel()}</span>
            </span>
          </button>
        </li>
        <li className="desktop-only">
          <button
            className="menu-item"
            type="button"
            onClick={(e) => {
              stop(e);
              cb.onQuit();
            }}
          >
            <span className="inner">
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
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                <polyline points="16 17 21 12 16 7"></polyline>
                <line x1="21" y1="12" x2="9" y2="12"></line>
              </svg>
              <span>Quit</span>
            </span>
          </button>
        </li>
      </ul>
      <div className="close-hint in-game-only">
        <button
          type="button"
          onClick={(e) => {
            stop(e);
            cb.onClose();
          }}
        >
          Resume game
        </button>
      </div>
      <p className="menu-hint">
        Press <kbd>Esc</kbd> to close
      </p>
      <p className="menu-gamepad-hint">
        <span>
          <kbd>↕</kbd> Navigate
        </span>
        {/* One <kbd> per controller family; the pad-family-* body
            class (see src/input/padFamily.ts) reveals the matching
            one via CSS. Nintendo shows the same letters as Xbox but
            keeps its own class — the physical positions differ and
            faceLayout() already routes them separately. */}
        <span>
          <kbd className="gp-select glyph-xbox">A</kbd>
          <kbd className="gp-select glyph-ps">✕</kbd>
          <kbd className="gp-select glyph-nintendo">A</kbd>
          <kbd className="gp-select glyph-generic">●</kbd> Select
        </span>
        <span>
          <kbd className="gp-back glyph-xbox">B</kbd>
          <kbd className="gp-back glyph-ps">○</kbd>
          <kbd className="gp-back glyph-nintendo">B</kbd>
          <kbd className="gp-back glyph-generic">◦</kbd> Back
        </span>
        <span>
          <kbd className="gp-back">☰</kbd> Close
        </span>
      </p>
      <p className="made-by in-game-only web-only">
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
        <a href="https://portfolio.trebeljahr.com" target="_blank" rel="noreferrer noopener">
          Rico Trebeljahr
        </a>
        {" · "}
        <a href="https://ricos.site/newsletters" target="_blank" rel="noreferrer noopener">
          Writing at ricos.site
        </a>
      </p>
    </>
  );
}
