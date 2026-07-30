// @ts-nocheck
/*
 * Accessibility settings body — rendered inside the pause menu's
 * <details id="accessibility-settings"> block in index.html. The
 * outer <details>, its <summary>, and the .menu-group wrapper stay
 * vanilla; this component only owns the <div
 * class="accessibility-settings-body"> contents.
 *
 * Unlike <SoundSettings> (a fixed list of nine toggle buttons), the
 * rows here are DATA: ui.ts passes an array of row descriptors and
 * this component renders one control per descriptor. Adding a new
 * accessibility setting later means appending a descriptor to
 * ACCESSIBILITY_SETTINGS_CALLBACKS in ui.ts — no component changes.
 *
 * Current values are read through each row's get() on every render;
 * ui.ts re-renders the tree (via syncAccessibilityUI) after any
 * set() so labels and control positions stay honest. The component
 * is a dumb renderer, same contract as the other menu overlays.
 */
import { type ChangeEvent, type MouseEvent, useEffect, useState } from "react";

/** Boolean on/off row. Rendered as a .menu-item button with the
 *  same "Label: on/off" text convention as the sound toggles. */
export interface AccessibilityToggleRow {
  kind: "toggle";
  id: string;
  label: string;
  get: () => boolean;
  set: (value: boolean) => void;
}

/** Numeric row rendered as an <input type="range">. `format` turns
 *  the raw value into the human-readable readout shown next to the
 *  slider (and into aria-valuetext, so screen readers announce
 *  "110%" instead of "1.1"). */
export interface AccessibilitySliderRow {
  kind: "slider";
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  format?: (value: number) => string;
  get: () => number;
  set: (value: number) => void;
}

/** String-enum row rendered as a native <select> — keyboard and
 *  screen-reader behavior comes for free. */
export interface AccessibilitySelectRow {
  kind: "select";
  id: string;
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  get: () => string;
  set: (value: string) => void;
}

/** Key-binding row: a button that, once armed, captures the next
 *  keydown and hands its KeyboardEvent.code to set(). rejectionHint
 *  vets a code before it's accepted — a non-null return is shown
 *  inline and the capture stays armed for another try. */
export interface AccessibilityKeyCaptureRow {
  kind: "keycapture";
  id: string;
  label: string;
  /** Current binding codes, for display. */
  get: () => string[];
  /** Replace the binding with the single captured code. */
  set: (code: string) => void;
  /** Restore the default bindings. */
  reset: () => void;
  /** Reason a code can't be bound, or null when it's acceptable. */
  rejectionHint: (code: string) => string | null;
}

export type AccessibilityRow =
  | AccessibilityToggleRow
  | AccessibilitySliderRow
  | AccessibilitySelectRow
  | AccessibilityKeyCaptureRow;

export interface AccessibilitySettingsCallbacks {
  rows: AccessibilityRow[];
}

function stop(e: MouseEvent) {
  e.stopPropagation();
}

function ToggleRow({ row }: { row: AccessibilityToggleRow }) {
  const on = row.get();
  return (
    <button
      className="menu-item"
      type="button"
      aria-pressed={on}
      onClick={(e) => {
        stop(e);
        row.set(!on);
      }}
    >
      <span className="inner">
        <span>
          {row.label}: {on ? "on" : "off"}
        </span>
      </span>
    </button>
  );
}

function SliderRow({ row }: { row: AccessibilitySliderRow }) {
  const value = row.get();
  const readout = row.format ? row.format(value) : String(value);
  const inputId = `accessibility-${row.id}`;
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const n = Number.parseFloat(e.currentTarget.value);
    if (Number.isFinite(n)) row.set(n);
  };
  return (
    <div className="menu-item accessibility-row">
      <span className="inner">
        <label htmlFor={inputId}>{row.label}</label>
        <input
          id={inputId}
          className="accessibility-range"
          type="range"
          min={row.min}
          max={row.max}
          step={row.step}
          value={value}
          aria-valuetext={readout}
          onChange={handleChange}
          onClick={stop}
        />
        <span className="accessibility-value" aria-hidden="true">
          {readout}
        </span>
      </span>
    </div>
  );
}

function SelectRow({ row }: { row: AccessibilitySelectRow }) {
  const inputId = `accessibility-${row.id}`;
  const handleChange = (e: ChangeEvent<HTMLSelectElement>) => {
    row.set(e.currentTarget.value);
  };
  return (
    <div className="menu-item accessibility-row">
      <span className="inner">
        <label htmlFor={inputId}>{row.label}</label>
        <select
          id={inputId}
          className="accessibility-select"
          value={row.get()}
          onChange={handleChange}
          onClick={stop}
        >
          {row.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </span>
    </div>
  );
}

/** Human-readable name for a KeyboardEvent.code. Covers the code
 *  families a player is likely to bind; anything unrecognized shows
 *  its raw code, which is still unambiguous. */
function formatKeyCode(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Arrow")) return `${code.slice(5)} arrow`;
  if (code.startsWith("Numpad")) return `Numpad ${code.slice(6)}`;
  if (code === "ShiftLeft" || code === "ShiftRight") return "Shift";
  if (code === "ControlLeft" || code === "ControlRight") return "Ctrl";
  if (code === "AltLeft" || code === "AltRight") return "Alt";
  return code;
}

function KeyCaptureRow({ row }: { row: AccessibilityKeyCaptureRow }) {
  const [capturing, setCapturing] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const hintId = `accessibility-${row.id}-hint`;
  const current = row.get().map(formatKeyCode).join(", ");
  // Live-region text for the capture flow. Kept in one always-mounted
  // role="status" span (below) because a status region that mounts
  // WITH its content is unreliably announced — the node has to exist
  // first, then change. Rejection hints are visible; the armed-state
  // prompt is redundant with the button text for sighted users, so
  // the span goes screen-reader-only unless there's a hint to show.
  const statusText = capturing
    ? (hint ?? "Press a key to set the new binding. Press Escape to cancel.")
    : (hint ?? "");

  // The capture listener lives on window in the CAPTURE phase so an
  // armed capture wins against every other keydown consumer — the
  // game's window-level jump handler and ui.ts's capture-phase
  // Escape handler (window capture fires before document capture)
  // would otherwise act on the very key being bound. Tab is passed
  // through untouched (capture disarms instead), so keyboard focus
  // can always leave the control — the capture never traps.
  useEffect(() => {
    if (!capturing) return;
    const onCaptureKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Tab") {
        setCapturing(false);
        setHint(null);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape") {
        setCapturing(false);
        setHint(null);
        return;
      }
      const rejection = row.rejectionHint(e.code);
      if (rejection) {
        setHint(rejection);
        return;
      }
      setCapturing(false);
      setHint(null);
      row.set(e.code);
    };
    window.addEventListener("keydown", onCaptureKeyDown, true);
    return () => window.removeEventListener("keydown", onCaptureKeyDown, true);
  }, [capturing, row]);

  return (
    <div className="menu-item accessibility-row accessibility-keybind">
      <span className="inner">
        <span>{row.label}</span>
        <button
          type="button"
          className={capturing ? "accessibility-keycap capturing" : "accessibility-keycap"}
          aria-label={
            capturing ? `${row.label}: press a key to bind` : `${row.label}: ${current}. Change`
          }
          aria-describedby={hint ? hintId : undefined}
          onClick={(e) => {
            stop(e);
            setHint(null);
            setCapturing((c) => !c);
          }}
          onBlur={() => {
            setCapturing(false);
            setHint(null);
          }}
        >
          {capturing ? "Press a key…" : current}
        </button>
        <button
          type="button"
          className="accessibility-keyreset"
          aria-label={`Reset ${row.label} to default`}
          onClick={(e) => {
            stop(e);
            setCapturing(false);
            setHint(null);
            row.reset();
          }}
        >
          Reset
        </button>
        <span
          className={hint ? "accessibility-hint" : "accessibility-hint sr-only"}
          id={hintId}
          role="status"
        >
          {statusText}
        </span>
      </span>
    </div>
  );
}

export interface AccessibilitySettingsProps {
  callbacks: AccessibilitySettingsCallbacks;
}

export function AccessibilitySettings({ callbacks }: AccessibilitySettingsProps) {
  return (
    <>
      {callbacks.rows.map((row) => {
        switch (row.kind) {
          case "toggle":
            return <ToggleRow key={row.id} row={row} />;
          case "slider":
            return <SliderRow key={row.id} row={row} />;
          case "select":
            return <SelectRow key={row.id} row={row} />;
          case "keycapture":
            return <KeyCaptureRow key={row.id} row={row} />;
          default:
            return null;
        }
      })}
    </>
  );
}
