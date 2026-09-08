/** WHEN THE SITE HEADER HIDES ON A PHONE (owner 2026-09-08).
 *
 *  The header went static on phones the same day (a pinned 92px on top of the chapter rail was
 *  17% of a report's screen), and the cost was the nav and the search field scrolling away. This
 *  is the middle: pinned, but hidden while the reader scrolls DOWN, back the moment they scroll UP,
 *  the rule and the numbers the chapter rail already uses, so the two bars move as one block.
 *
 *  Pure, so it is testable without a window; `main.tsx` feeds it the scroll deltas. */
export const SCROLL_TWITCH = 8;
export const HIDE_BELOW = 120;

export function headerHidden(
  { y, dy, wide, was = false }: { y: number; dy: number; wide: boolean; was?: boolean },
): boolean {
  if (wide) return false;
  // A thumb wobbles. Under the threshold nothing is a gesture and nothing moves.
  if (Math.abs(dy) < SCROLL_TWITCH) return was;
  // Near the top the header and the page are one block, and half of it arriving late reads as a
  // glitch rather than as a bar that got out of the way.
  return y > HIDE_BELOW && dy > 0;
}
