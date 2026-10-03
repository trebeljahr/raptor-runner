/** Human-readable name for a KeyboardEvent.code. Covers the code
 *  families a player is likely to bind; anything unrecognized shows
 *  its raw code, which is still unambiguous. */
export function formatKeyCode(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Arrow")) return `${code.slice(5)} arrow`;
  if (code.startsWith("Numpad")) return `Numpad ${code.slice(6)}`;
  if (code === "ShiftLeft" || code === "ShiftRight") return "Shift";
  if (code === "ControlLeft" || code === "ControlRight") return "Ctrl";
  if (code === "AltLeft" || code === "AltRight") return "Alt";
  return code;
}

