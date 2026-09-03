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
 *  SCOPED TO THE WHOLE-DECK CLOUD, AND THE MEASUREMENT THAT SAYS SO IS WORTH KEEPING. This shipped
 *  with a CEILING promising recalibration against a real ego layout. That ran on 2026-09-03, fifteen
 *  points across three widths and five focus cards, and it did not produce a better constant -- it
 *  showed the sqrt(N) model does not describe small graphs at all:
 *
 *    nodes  box(world)  implied spread  disc @390
 *      3       130          74.9          145.2px
 *      5       252         112.7           38.8px
 *      6       149          60.7           65.8px
 *      8       150          52.9           65.3px
 *      9       321         107.0           33.2px
 *
 *  The "constant" varies 2.1x and NOT with node count: 5 nodes span 252 world units where 8 span
 *  150. `linkDistanceFor` is weight-dependent (LINK_DIST_MIN 60 to LINK_DIST_MAX 260), so a small
 *  graph's box is set by its EDGE WEIGHTS, not by how many nodes it has. No single spread constant
 *  can predict that, and fitting one would be a number that looks measured and is not.
 *
 *  So this predicts the whole-deck cloud only, where N is large enough for the area model to hold
 *  and the anchor is real. That is also its only caller: `useBoardMode` asks how big the WHOLE
 *  board's discs would be, to decide whether to show it at all. **Do not use it to size an ego
 *  view** -- measure that view, or read its `__graphProbe`. */
const CLOUD_SPREAD = 72.4;

/** Predicted painted diameter, in CSS px, of one card disc when `nodeCount` nodes are framed to fit
 *  a `canvasW` x `canvasH` canvas. `fitToView` scales by `min(w/boxW, h/boxH)`, so the SMALLER
 *  canvas dimension is what binds. */
export function predictDiscDiameter(nodeCount: number, canvasW: number, canvasH: number): number {
  const box = CLOUD_SPREAD * Math.sqrt(Math.max(1, nodeCount));
  const z = Math.min(canvasW, canvasH) / box;
  return 2 * WORLD_RADIUS * z;
}
