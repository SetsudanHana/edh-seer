import { useLayoutEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router";

/** A NEW PAGE OPENS AT ITS TOP (#1405). React Router changes the DOM without touching scroll, so a click on a
 *  similar card opened the next card page at the old offset, mid-page. Mounted once, for every route.
 *
 *  PUSH or REPLACE that changes the pathname scrolls to 0. POP (back, forward) is left to the browser. A hash-only
 *  change is not a new page. The report ("/") keeps its own memory (`useScrollMemory` in ReportShell saves the
 *  offset on the way out and writes it back, and already resets a page left for), so this skips any move to or
 *  from "/" rather than fight it. */
export function ScrollToTop(): null {
  const { pathname } = useLocation();
  const type = useNavigationType();
  const previous = useRef(pathname);
  useLayoutEffect(() => {
    const from = previous.current;
    previous.current = pathname;
    if (from === pathname || type === "POP" || from === "/" || pathname === "/") return;
    window.scrollTo(0, 0);
  }, [pathname, type]);
  return null;
}
