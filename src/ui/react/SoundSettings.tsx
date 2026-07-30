// @ts-nocheck
/*
 * Sound Settings body — React port of the 9-channel toggle list that
 * lives inside the pause menu's <details id="sound-settings"> block
 * in index.html, plus the label-update half of refreshSoundUI() in
 * src/ui.ts. The outer <details>, its <summary>, and the .menu-panel
 * wrapper stay vanilla; this component only owns the <div
 * class="sound-settings-body"> contents.
 *
 * Muted flags are read from window.Game on every render. ui.ts calls
 * refreshSoundSettings() after any channel toggle (via syncSoundUI)
 * so the "on"/"off" labels stay honest. The component delegates the
 * actual Game.setXxxMuted writes back to ui.ts through callback props
 * — it's a dumb renderer.
 */
import type { MouseEvent } from "react";

export interface SoundSettingsCallbacks {
  onToggleSound: () => void;
  onToggleMusic: () => void;
  onToggleJumpSound: () => void;
  onToggleRainSound: () => void;
  onToggleThunder: () => void;
  onToggleFootsteps: () => void;
  onToggleCoinsSound: () => void;
  onToggleUiSound: () => void;
  onToggleEventsSound: () => void;
}

function channelLabel(name: string, muted: boolean) {
  return name + ": " + (muted ? "off" : "on");
}
function stop(e: MouseEvent) {
  e.stopPropagation();
}

export interface SoundSettingsProps {
  callbacks: SoundSettingsCallbacks;
}

export function SoundSettings({ callbacks: cb }: SoundSettingsProps) {
  const Game = window.Game;
  const muted = Game?.isMuted?.() === true;
  const musicMuted = Game?.isMusicMuted?.() === true;
  const jumpMuted = Game?.isJumpMuted?.() === true;
  const rainSoundMuted = Game?.isRainMuted?.() === true;
  const thunderMuted = Game?.isThunderMuted?.() === true;
  const footstepsMuted = Game?.isFootstepsMuted?.() === true;
  const coinsMuted = Game?.isCoinsMuted?.() === true;
  const uiMuted = Game?.isUiMuted?.() === true;
  const eventsMuted = Game?.isEventsMuted?.() === true;

  return (
    <>
      <button
        className="menu-item"
        type="button"
        aria-pressed={!muted}
        onClick={(e) => {
          stop(e);
          cb.onToggleSound();
        }}
      >
        <span className="inner">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="-5 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
          </svg>
          <span>{channelLabel("Sound", muted)}</span>
        </span>
      </button>
      <button
        className="menu-item"
        type="button"
        aria-pressed={!musicMuted}
        onClick={(e) => {
          stop(e);
          cb.onToggleMusic();
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
            <path d="M9 18V5l12-2v13"></path>
            <circle cx="6" cy="18" r="3"></circle>
            <circle cx="18" cy="16" r="3"></circle>
          </svg>
          <span>{channelLabel("Music", musicMuted)}</span>
        </span>
      </button>
      <button
        className="menu-item"
        type="button"
        aria-pressed={!jumpMuted}
        onClick={(e) => {
          stop(e);
          cb.onToggleJumpSound();
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
            <polyline points="17 1 21 5 17 9"></polyline>
            <path d="M3 11V9a4 4 0 0 1 4-4h14"></path>
            <polyline points="7 23 3 19 7 15"></polyline>
            <path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
          </svg>
          <span>{channelLabel("Jump sound", jumpMuted)}</span>
        </span>
      </button>
      <button
        className="menu-item"
        type="button"
        aria-pressed={!rainSoundMuted}
        onClick={(e) => {
          stop(e);
          cb.onToggleRainSound();
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
            <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"></path>
            <path d="M16 14v6"></path>
            <path d="M8 14v6"></path>
            <path d="M12 16v6"></path>
          </svg>
          <span>{channelLabel("Rain sound", rainSoundMuted)}</span>
        </span>
      </button>
      <button
        className="menu-item"
        type="button"
        aria-pressed={!thunderMuted}
        onClick={(e) => {
          stop(e);
          cb.onToggleThunder();
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
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
          </svg>
          <span>{channelLabel("Thunder", thunderMuted)}</span>
        </span>
      </button>
      <button
        className="menu-item"
        type="button"
        aria-pressed={!footstepsMuted}
        onClick={(e) => {
          stop(e);
          cb.onToggleFootsteps();
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
            <path d="M8.5 3a2.5 2.5 0 0 1 2.5 2.5v3A2.5 2.5 0 0 1 8.5 11 2.5 2.5 0 0 1 6 8.5v-3A2.5 2.5 0 0 1 8.5 3z"></path>
            <path d="M6.5 13h4a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2h-1l-1 3H6l.5-3H6a2 2 0 0 1-2-2v-1a2 2 0 0 1 2-2z"></path>
            <path d="M15.5 9a2.5 2.5 0 0 1 2.5 2.5v3a2.5 2.5 0 1 1-5 0v-3A2.5 2.5 0 0 1 15.5 9z"></path>
          </svg>
          <span>{channelLabel("Footsteps", footstepsMuted)}</span>
        </span>
      </button>
      <button
        className="menu-item"
        type="button"
        aria-pressed={!coinsMuted}
        onClick={(e) => {
          stop(e);
          cb.onToggleCoinsSound();
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
            <circle cx="12" cy="12" r="9"></circle>
            <path d="M12 7v10M9 10h5a2 2 0 0 1 0 4H9"></path>
          </svg>
          <span>{channelLabel("Coins", coinsMuted)}</span>
        </span>
      </button>
      <button
        className="menu-item"
        type="button"
        aria-pressed={!uiMuted}
        onClick={(e) => {
          stop(e);
          cb.onToggleUiSound();
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
            <path d="M9 11V7a3 3 0 0 1 6 0v4"></path>
            <rect x="5" y="11" width="14" height="10" rx="2"></rect>
          </svg>
          <span>{channelLabel("UI clicks", uiMuted)}</span>
        </span>
      </button>
      <button
        className="menu-item"
        type="button"
        aria-pressed={!eventsMuted}
        onClick={(e) => {
          stop(e);
          cb.onToggleEventsSound();
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
            <polygon points="12 2 15 9 22 9 17 14 19 21 12 17 5 21 7 14 2 9 9 9 12 2"></polygon>
          </svg>
          <span>{channelLabel("Rare events", eventsMuted)}</span>
        </span>
      </button>
    </>
  );
}
