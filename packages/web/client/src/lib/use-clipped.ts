import { useEffect, useState, type RefObject } from "react";

/** WHETHER A SCROLLER IS ACTUALLY CUT OFF, measured rather than assumed.
 *
 *  A fade painted over content that fits is a cue for scrolling that is not there -- the same lie
 *  as no cue at all, pointing the other way -- so it is driven by the real overflow and re-checked
 *  on resize. Extracted from `ThemeMatrix` when the chapter rail became the second horizontal
 *  scroller on the page (S7): at 390px the rail's nine labels run past the row exactly as the
 *  matrix's columns do, and a rail whose last chapters are invisible is a table of contents that
 *  hides entries. */
export function useClipped(ref: RefObject<HTMLElement | null>, deps: unknown[] = []): boolean {
  const [clipped, setClipped] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = (): void => setClipped(el.scrollWidth > el.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return clipped;
}
