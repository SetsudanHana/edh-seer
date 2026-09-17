import { useEffect } from "react";
import { useLocation } from "react-router";

/** WHICH KIND OF ROUTE IS ON SCREEN, as an attribute CSS can read.
 *
 *  `index.html`'s `.intro` is the landing page's own argument and real content for a reader without
 *  JavaScript. It is also outside React, so it stayed on screen under every card page -- a pitch for
 *  the deck analyser printed below a card's partner list. It belongs on `/` and nowhere else, and
 *  only the router knows which one is showing. */
export function RouteMarker(): null {
  const { pathname } = useLocation();
  useEffect(() => {
    // THREE KINDS, AND THE THIRD IS WHY THIS IS NOT A BOOLEAN. A browse page's content IS the
    // prerendered block -- React renders nothing into `#root` there -- so the rule that hides that
    // block on boot must not fire, or the page empties itself the moment the bundle runs.
    // A FOURTH KIND (UX review, 2026-09-17): /cards and /commanders ARE a search box, and the
    // header's beside it was two boxes with two labels for one purpose. CSS hides the header's.
    document.documentElement.dataset.route = pathname === "/"
      ? "home"
      : pathname.startsWith("/browse/") ? "browse"
      : pathname === "/cards" || pathname === "/commanders" ? "search" : "page";
  }, [pathname]);
  return null;
}
