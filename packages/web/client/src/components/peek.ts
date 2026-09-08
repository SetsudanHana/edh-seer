import { createContext, useCallback, useContext, useMemo, useRef, useState, type MouseEvent } from "react";

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

/** THE CLICK RULE, ONCE. A plain left click on a card name peeks; a click with a modifier, or any
 *  button but the first, or any click outside a provider, navigates as the link always did. The
 *  partner list and the search results both follow it, and one definition is how they cannot
 *  drift. Returns false when the click was left to the link. */
export function peekOnPlainClick(peek: PeekApi | null, slug: string, ev: MouseEvent<HTMLElement>): boolean {
  if (!peek || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return false;
  ev.preventDefault();
  peek.push(slug, ev.currentTarget);
  return true;
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
