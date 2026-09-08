import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

/** THE PEEK STACK (spec 2026-09-08 part 3). A partner click looks at the partner beside the list
 *  instead of leaving the page; a name inside the peek looks further; back returns one; close
 *  returns to the page with focus where the first click was. The URL never moves: a peek is a
 *  look, not a place.
 *
 *  A CONTEXT, NOT PROPS, because the click lives in `PartnerList`, which is rendered by both pages
 *  and by the peek itself; and NULL outside a provider, so the same list on a surface with no peek
 *  navigates as it always did. */
export interface PeekApi {
  stack: readonly string[];
  push: (slug: string, opener?: Element | null) => void;
  back: () => void;
  close: () => void;
}

export const PeekContext = createContext<PeekApi | null>(null);

export function usePeek(): PeekApi | null {
  return useContext(PeekContext);
}

/** The provider's own state. Focus goes back to the element that opened the FIRST peek, because
 *  that is the row the reader was on; intermediate openers were inside a panel that is gone. */
export function usePeekState(): PeekApi {
  const [stack, setStack] = useState<string[]>([]);
  const opener = useRef<Element | null>(null);
  const push = useCallback((slug: string, from?: Element | null) => {
    setStack((s) => {
      if (s.length === 0) opener.current = from ?? document.activeElement;
      return [...s, slug];
    });
  }, []);
  const back = useCallback(() => { setStack((s) => s.slice(0, -1)); }, []);
  const close = useCallback(() => {
    setStack([]);
    const el = opener.current;
    opener.current = null;
    if (el instanceof HTMLElement && el.isConnected) el.focus();
  }, []);
  return useMemo(() => ({ stack, push, back, close }), [stack, push, back, close]);
}
