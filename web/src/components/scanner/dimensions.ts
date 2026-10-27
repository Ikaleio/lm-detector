// Shared mechanical constraints; y is up, +z is the front/output direction.
export const DIM = Object.freeze({
  bodyWidth: 4.6, bodyHeight: .84, bodyDepth: 3.25,
  trayTopY: 1.28, trayWidth: 3.34, trayDepth: 2.4,
  boxWidth: 2.34, boxHeight: 1.18, boxDepth: 1.6, boxZ: -.14,
  railX: 1.94, railY: 1.27, railLength: 2.91,
  gantryBack: -.98, gantryFront: .94, gantryInnerHalfWidth: 1.70, gantryClearY: 2.586 - .014 / 2,
  slotY: .725, slotZ: 1.575, slotWidth: 2.34,
  paperWidth: 1.94, paperLength: 1.64,
})
export const BOX_CENTER_Y = DIM.trayTopY + DIM.boxHeight / 2
export const BOX_TOP_Y = DIM.trayTopY + DIM.boxHeight
export const ease = (v: number) => { const x = Math.max(0, Math.min(v, 1)); return x * x * (3 - 2 * x) }
