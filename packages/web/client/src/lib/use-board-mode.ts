import { useEffect, useState } from "react";
import { MIN_DISC_PX, predictDiscDiameter } from "../components/disc-fit.js";

/** WHICH GRAPH SURFACE THIS DEVICE GETS, and why it is not a width.
 *
 *  `use-narrow.ts` put the line at Tailwind's `sm` (639px) because it was convenient. The measured
 *  cliff is at 600-640 and it is driven by the canvas HEIGHT stepping 518 to 378, not by width, so
 *  the guess was close for a reason nobody had written down.
 *
 *  TWO CONDITIONS, AND THE POINTER ONE IS LOAD-BEARING. The desktop board's own discs measure
 *  20.1px, under the 24px floor -- a size-only rule would flip DESKTOP into the ego view. The floor
 *  is a thumb constraint: on a precise pointer the 38.1px separation clears WCAG 2.5.8's spacing
 *  exception and the hover tooltip names whatever is under the cursor. So the ego view is for a
 *  device with a coarse pointer AND NO precise one -- a touchscreen laptop keeps the board.
 *
 *  CEILING: `(any-pointer: fine)` is the best proxy available for "there is also a mouse", and it is
 *  unverified on a 2-in-1 in tablet posture, where it may report fine while nothing is attached. If
 *  that shows up, the upgrade is a width term as a backstop. */
export function useBoardMode(nodeCount: number): "board" | "ego" {
  const read = (): "board" | "ego" => {
    const mm = typeof window === "undefined" ? undefined : window.matchMedia;
    // A missing `matchMedia` means the board, which is the state every existing test was written
    // against -- the same rule `use-narrow.ts` keeps, for the same reason.
    if (!mm) return "board";
    const coarse = mm.call(window, "(pointer: coarse)").matches;
    const alsoFine = mm.call(window, "(any-pointer: fine)").matches;
    if (!coarse || alsoFine) return "board";
    // The canvas is not mounted yet, so the viewport stands in for it. It over-states the canvas
    // slightly, which biases toward KEEPING the board -- the conservative direction, since the ego
    // view is the bigger change to put in front of someone.
    return predictDiscDiameter(nodeCount, window.innerWidth, window.innerHeight) < MIN_DISC_PX
      ? "ego"
      : "board";
  };
  const [mode, setMode] = useState(read);
  useEffect(() => {
    // Subscribed, not read once: a phone rotates and a window resizes, the same reason
    // `use-narrow.ts` gives. BOTH queries are watched, because plugging in a mouse changes
    // `any-pointer` without changing anything about the size.
    const mm = window.matchMedia;
    if (!mm) return;
    const queries = [mm.call(window, "(pointer: coarse)"), mm.call(window, "(any-pointer: fine)")];
    const onChange = (): void => setMode(read());
    for (const q of queries) q.addEventListener?.("change", onChange);
    window.addEventListener("resize", onChange);
    onChange();
    return () => {
      for (const q of queries) q.removeEventListener?.("change", onChange);
      window.removeEventListener("resize", onChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `read` closes over nothing but
    // `nodeCount`, which is in the deps; hoisting it into a useCallback would only move the same
    // dependency one line up.
  }, [nodeCount]);
  return mode;
}
