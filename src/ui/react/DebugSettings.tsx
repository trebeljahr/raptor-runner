/*
 * Debug settings body — React port of the rows inside the pause
 * menu's <details id="debug-settings"> block. Rendered only when
 * body[data-debug="true"] (set from the ?debug=true query param);
 * the component returns the entries unconditionally, CSS (combined
 * with the .debug-only class on the outer <details>) handles the
 * production hide.
 *
 * Muted-style "on / off" labels read live state from window.Game on
 * every render (isShowingHitboxes, isRaining, isNoCollisions,
 * isPerfOverlay). The score input is uncontrolled — defaultValue
 * reads the current score at mount time, then onChange fires the
 * Game.setScore setter. ui.ts remounts the component (via
 * debugSettingsKey bump in the mount helper) on every menu-open so
 * a re-opened menu shows the current score after a run has ticked
 * up points.
 *
 * Triggers (UFO, Santa, tumbleweed, …) delegate back to ui.ts via
 * callback props so the Game API calls and closeMenu() side effects
 * live in one place.
 */
import type { ChangeEvent, MouseEvent } from "react";

export interface DebugSettingsCallbacks {
  onToggleHitboxes: () => void;
  onToggleRain: () => void;
  onToggleNoCollisions: () => void;
  onTogglePerf: () => void;
  onScoreInputChange: (raw: string) => void;
  onTriggerUfo: () => void;
  onTriggerSanta: () => void;
  onTriggerTumbleweed: () => void;
  onTriggerComet: () => void;
  onTriggerMeteor: () => void;
  onAdvanceMoon: () => void;
  onForceBreather: () => void;
  onSpawnPterodactyl: () => void;
}

function stop(e: MouseEvent) {
  e.stopPropagation();
}

export interface DebugSettingsProps {
  callbacks: DebugSettingsCallbacks;
}

export function DebugSettings({ callbacks: cb }: DebugSettingsProps) {
  const Game = window.Game;
  const hitboxesOn = Game?.isShowingHitboxes?.() === true;
  const rainOn = Game?.isRaining?.() === true;
  const noCollisions = Game?.isNoCollisions?.() === true;
  const perfOn = Game?.isPerfOverlay?.() === true;
  const currentScore = Game?.getScore?.() ?? 0;

  const handleScoreInput = (e: ChangeEvent<HTMLInputElement>) => {
    cb.onScoreInputChange(e.currentTarget.value);
  };

  return (
    <>
      <li className="in-game-only">
        <button
          className="menu-item"
          type="button"
          onClick={(e) => {
            stop(e);
            cb.onToggleHitboxes();
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
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" strokeDasharray="3 3"></rect>
            </svg>
            <span>{hitboxesOn ? "Hitboxes: on" : "Hitboxes: off"}</span>
          </span>
        </button>
      </li>
      <li className="in-game-only">
        <button
          className="menu-item"
          type="button"
          onClick={(e) => {
            stop(e);
            cb.onToggleRain();
          }}
        >
          <span className="inner">
            🌧️ <span>{rainOn ? "Rain: on" : "Rain: off"}</span>
          </span>
        </button>
      </li>
      <li className="in-game-only">
        <button
          className="menu-item"
          type="button"
          onClick={(e) => {
            stop(e);
            cb.onToggleNoCollisions();
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
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
            </svg>
            <span>{noCollisions ? "Collisions: off" : "Collisions: on"}</span>
          </span>
        </button>
      </li>
      <li className="in-game-only">
        <button
          className="menu-item"
          type="button"
          onClick={(e) => {
            stop(e);
            cb.onTogglePerf();
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
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
            </svg>
            <span>{perfOn ? "Perf overlay: on" : "Perf overlay: off"}</span>
          </span>
        </button>
      </li>
      <li className="in-game-only menu-score-editor">
        <label className="menu-item menu-score-editor-label">
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
              <path d="M12 20h9"></path>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
            </svg>
            <span>Score</span>
            <input
              type="number"
              min={0}
              step={1}
              defaultValue={currentScore | 0}
              className="menu-score-input"
              onChange={handleScoreInput}
              onClick={(e) => e.stopPropagation()}
            />
          </span>
        </label>
      </li>
      <li className="in-game-only">
        <button
          className="menu-item"
          type="button"
          onClick={(e) => {
            stop(e);
            cb.onTriggerUfo();
          }}
        >
          <span className="inner">
            🛸 <span>Trigger UFO</span>
          </span>
        </button>
      </li>
      <li className="in-game-only">
        <button
          className="menu-item"
          type="button"
          onClick={(e) => {
            stop(e);
            cb.onTriggerSanta();
          }}
        >
          <span className="inner">
            🎅 <span>Trigger Santa</span>
          </span>
        </button>
      </li>
      <li className="in-game-only">
        <button
          className="menu-item"
          type="button"
          onClick={(e) => {
            stop(e);
            cb.onTriggerTumbleweed();
          }}
        >
          <span className="inner">
            🌾 <span>Trigger Tumbleweed</span>
          </span>
        </button>
      </li>
      <li className="in-game-only">
        <button
          className="menu-item"
          type="button"
          onClick={(e) => {
            stop(e);
            cb.onTriggerComet();
          }}
        >
          <span className="inner">
            ☄️ <span>Trigger Comet</span>
          </span>
        </button>
      </li>
      <li className="in-game-only">
        <button
          className="menu-item"
          type="button"
          onClick={(e) => {
            stop(e);
            cb.onTriggerMeteor();
          }}
        >
          <span className="inner">
            💥 <span>Trigger Meteor</span>
          </span>
        </button>
      </li>
      <li className="in-game-only">
        <button
          className="menu-item"
          type="button"
          onClick={(e) => {
            stop(e);
            cb.onAdvanceMoon();
          }}
        >
          <span className="inner">
            🌙 <span>Advance Moon Phase</span>
          </span>
        </button>
      </li>
      <li className="in-game-only">
        <button
          className="menu-item"
          type="button"
          onClick={(e) => {
            stop(e);
            cb.onForceBreather();
          }}
        >
          <span className="inner">
            🌼 <span>Trigger Flower Field</span>
          </span>
        </button>
      </li>
      <li className="in-game-only">
        <button
          className="menu-item"
          type="button"
          onClick={(e) => {
            stop(e);
            cb.onSpawnPterodactyl();
          }}
        >
          <span className="inner">
            🦅 <span>Trigger Pterodactyl</span>
          </span>
        </button>
      </li>
    </>
  );
}
