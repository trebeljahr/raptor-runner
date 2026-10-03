const _IDLE_CROWN = { x: 0.86851, y: 0.15566 };
const _IDLE_SNOUT = { x: 0.98616, y: 0.25472 };
const _IDLE_NECK_CORRECTION = { x: 0.00187, y: -0.00078 };

// The three score-unlock classics bypass the generic placeholder
// draw path in raptor.ts and use slightly smaller scales. Mirror
// those here so party-hat/thug-glasses/bow-tie render identically
// on the start screen.
type CosmeticDraw = {
  scale?: number;
  rotation?: number;
  offset?: { x?: number; y?: number };
};
const _CLASSIC_DRAW: Record<string, CosmeticDraw> = {
  "party-hat": { scale: 0.25, rotation: -0.35 },
  "thug-glasses": { scale: 0.07 },
  "bow-tie": { scale: 0.06, rotation: -0.15 },
};

export function applyCosmeticPreviewTransform(
  img: HTMLImageElement,
  slot: "head" | "eyes" | "neck",
  def: { id: string; slot: "head" | "eyes" | "neck"; draw?: CosmeticDraw },
) {
  const draw = def?.draw ?? _CLASSIC_DRAW[def.id] ?? {};
  let cx = 0;
  let cy = 0;
  let rot = 0;
  let widthFrac: number | null = null;
  let heightFrac: number | null = null;
  let apX = 0.5;
  let apY = 0.5;
  if (slot === "head") {
    cx = _IDLE_CROWN.x - 0.01;
    cy = _IDLE_CROWN.y + 0.04;
    heightFrac = draw.scale ?? 0.3;
    rot = draw.rotation ?? -0.35;
    // Bottom-centre of the sprite anchors to the crown.
    apX = 0.5;
    apY = 1.0;
  } else if (slot === "eyes") {
    cx = _IDLE_CROWN.x + (_IDLE_SNOUT.x - _IDLE_CROWN.x) * 0.5 - 0.012;
    cy = _IDLE_CROWN.y + (_IDLE_SNOUT.y - _IDLE_CROWN.y) * 0.5 + 0.013;
    widthFrac = draw.scale ?? 0.1;
    // atan2 must use pixel deltas, so scale dy by the raptor aspect.
    const RAPTOR_ASPECT = 212 / 578;
    const rideAngle = Math.atan2(
      (_IDLE_SNOUT.y - _IDLE_CROWN.y) * RAPTOR_ASPECT,
      _IDLE_SNOUT.x - _IDLE_CROWN.x,
    );
    rot = draw.rotation ?? rideAngle - 0.25;
  } else {
    // neck
    cx = _IDLE_CROWN.x - 0.02 + _IDLE_NECK_CORRECTION.x;
    cy = _IDLE_CROWN.y + 0.2 + _IDLE_NECK_CORRECTION.y;
    widthFrac = draw.scale ?? 0.08;
    rot = draw.rotation ?? -0.15;
  }
  if (draw.offset?.x != null) cx += draw.offset.x;
  if (draw.offset?.y != null) cy += draw.offset.y;
  img.style.left = (cx * 100).toFixed(3) + "%";
  img.style.top = (cy * 100).toFixed(3) + "%";
  if (widthFrac != null) {
    img.style.width = (widthFrac * 100).toFixed(3) + "%";
    img.style.height = "auto";
  } else {
    img.style.height = (heightFrac! * 100).toFixed(3) + "%";
    img.style.width = "auto";
  }
  img.style.transform =
    `translate(${(-apX * 100).toFixed(2)}%, ${(-apY * 100).toFixed(2)}%) ` +
    `rotate(${rot.toFixed(4)}rad)`;
  img.style.transformOrigin = `${(apX * 100).toFixed(2)}% ${(apY * 100).toFixed(2)}%`;
}
