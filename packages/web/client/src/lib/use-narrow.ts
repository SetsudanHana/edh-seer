import { useEffect, useState } from "react";

/** True below Tailwind's `sm` breakpoint. Subscribed, not read once: a phone rotates, and a desktop
 *  reader resizes a window, and a board that only checks on mount would be wrong for the rest of
 *  the session.
 *
 *  `matchMedia` is optional on purpose — jsdom provides it only when a test stubs it, and a missing
 *  API means "not narrow", which is the state every existing test was written against. */
export function useIsNarrow(maxWidth = 639): boolean {
  const query = `(max-width: ${maxWidth}px)`;
  const [narrow, setNarrow] = useState(() => window.matchMedia?.(query)?.matches === true);
  useEffect(() => {
    const mql = window.matchMedia?.(query);
    if (!mql) return;
    const onChange = (e: MediaQueryListEvent): void => setNarrow(e.matches);
    setNarrow(mql.matches);
    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  }, [query]);
  return narrow;
}
