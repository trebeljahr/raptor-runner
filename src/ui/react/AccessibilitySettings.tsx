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
import type { ChangeEvent, MouseEvent } from "react";

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

export type AccessibilityRow =
  | AccessibilityToggleRow
  | AccessibilitySliderRow
  | AccessibilitySelectRow;

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
          default:
            return null;
        }
      })}
    </>
  );
}
