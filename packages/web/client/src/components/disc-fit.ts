/** WCAG 2.5.8's minimum target, and this repo's hard floor for a disc a thumb has to hit.
 *
 *  NOT a conformance failure today, and the distinction is worth keeping straight: the collide force
 *  enforces uniform separation (27.8px at 390, 38.1px at 1440, measured, minimum equal to median),
 *  so 2.5.8's SPACING exception is satisfied at every width. What fails at 14.7px is usability --
 *  the phone judge's "my thumb pad covers four or five of them" -- not conformance. */
export const MIN_DISC_PX = 24;

/** The house recommendation for a PRIMARY action, which is what tapping a card is on this surface.
 *  The opening state aims here; expansion is allowed to erode it down to MIN_DISC_PX. */
export const OPEN_DISC_PX = 44;

/** World-space radius of a card disc, matching `ART_RADIUS` in `card-node.ts` and what
 *  `__graphProbe` reports (`r: 14`). Duplicated as a local constant rather than imported so this
 *  module stays free of the canvas layer -- if the two ever disagree, the anchor test fails. */
const WORLD_RADIUS = 14;

/** HOW WIDE THE SETTLED CLOUD GETS, in world units, per sqrt(node). Calibrated on ONE measured
 *  point: 73 nodes fitting a 324x378 canvas at z=0.524 implies a box side of 324/0.524 = 618 world
 *  units, and 618 / sqrt(73) = 72.4.
 *
 *  CEILING: one anchor point and a sqrt(N) area model. A depth-1 ego view is a STAR, not a blob, so
 *  its real box is likely tighter than this predicts -- which makes every prediction here
 *  conservative (it under-states disc size) rather than optimistic. Recalibrate against a measured
 *  ego layout at 390/360/320 and pin the anchor test to the new number. */
const CLOUD_SPREAD = 72.4;

/** Predicted painted diameter, in CSS px, of one card disc when `nodeCount` nodes are framed to fit
 *  a `canvasW` x `canvasH` canvas. `fitToView` scales by `min(w/boxW, h/boxH)`, so the SMALLER
 *  canvas dimension is what binds. */
export function predictDiscDiameter(nodeCount: number, canvasW: number, canvasH: number): number {
  const box = CLOUD_SPREAD * Math.sqrt(Math.max(1, nodeCount));
  const z = Math.min(canvasW, canvasH) / box;
  return 2 * WORLD_RADIUS * z;
}
