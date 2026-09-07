/** A MEASURED BAR HEIGHT, ROUNDED DOWN. Never `Math.round`, and the difference is a visible defect.
 *
 *  Every one of these is consumed as the `top` of the bar pinned BELOW it. Round a 57.5px header up
 *  to 58 and that bar pins half a pixel too low, leaving a transparent slit between two opaque bars
 *  with the whole page scrolling behind it -- reported from a screenshot on 2026-09-04, where what
 *  came through the slit was the tops of a heading's capitals. Round DOWN and the lower bar overlaps
 *  by up to a pixel instead, which cannot be seen: both paint `--background`.
 *
 *  Fractional heights are the normal case, not the edge one. These bars are sized by line boxes and
 *  padding in `rem`, so a half pixel is what you get on most widths and every zoom level. */
export const stickyPx = (el: Element): string =>
  `${Math.floor(el.getBoundingClientRect().height)}px`;
