/*
 * Controller-family detection for on-screen button prompts.
 *
 * Prompts render one <kbd> variant per family (Xbox letters,
 * PlayStation shapes, Nintendo letters, a neutral dot) and CSS picks
 * which one is visible via a `pad-family-<family>` class on <body> —
 * the same zero-React-state pattern as body.gamepad-connected. This
 * module owns the id heuristic and the body-class bookkeeping so the
 * gamepadconnected listener (src/main.ts) and any future source of
 * pad identity (e.g. Steam Input's controller type) share one entry
 * point.
 *
 * Display only. Input routing has its own, narrower concern — which
 * button INDEX confirms vs cancels — handled by faceLayout() in
 * src/main.ts. Nintendo pads therefore appear in both places: they
 * differ in routing AND labels, while PlayStation pads follow the
 * standard routing and only label buttons differently.
 */

export type PadFamily = "xbox" | "playstation" | "nintendo" | "generic";

// Same fragments as faceLayout() in main.ts. 057e is Nintendo's USB
// vendor id; the readable fragments cover browser stacks that strip
// the vendor numbers from Gamepad.id.
const NINTENDO = /057e|nintendo|joy.?con|switch pro/i;

// 054c is Sony's vendor id; the rest are unambiguous PlayStation
// markers. Chrome's DualShock 4 id is "Wireless Controller (STANDARD
// GAMEPAD Vendor: 054c Product: 09cc)" — only the vendor id gives it
// away, hence 054c must be here and not just marketing names.
const PLAYSTATION = /054c|sony|playstation|dualshock|dualsense/i;

const XBOX = /045e|xbox|xinput/i;

// Some browser/OS combos report the DualShock 4 as literally
// "Wireless Controller" with no Sony marker at all. Too weak to test
// early — Microsoft's own pad is NAMED "Xbox Wireless Controller" —
// so this fragment only wins once nothing stronger has matched.
const PLAYSTATION_WEAK = /wireless controller/i;

export function familyFromGamepadId(id: string): PadFamily {
  // Nintendo and Sony markers outrank Xbox ones: pads presented
  // through the XInput stack often mention "XInput" while still
  // naming their real vendor, and /xinput/ must not claim those.
  if (NINTENDO.test(id)) return "nintendo";
  if (PLAYSTATION.test(id)) return "playstation";
  if (XBOX.test(id)) return "xbox";
  if (PLAYSTATION_WEAK.test(id)) return "playstation";
  return "generic";
}

const FAMILY_CLASSES = [
  "pad-family-xbox",
  "pad-family-playstation",
  "pad-family-nintendo",
  "pad-family-generic",
] as const;

/**
 * Tag <body> with the family so CSS can reveal the matching prompt
 * glyphs. Exactly one pad-family-* class at a time — stale classes
 * from a previously connected pad would reveal two variants at once.
 * Pass null when the last pad disconnects to clear them all.
 */
export function applyPadFamilyBodyClass(family: PadFamily | null): void {
  const cls = document.body.classList;
  for (const c of FAMILY_CLASSES) cls.remove(c);
  if (family !== null) cls.add(`pad-family-${family}`);
}
