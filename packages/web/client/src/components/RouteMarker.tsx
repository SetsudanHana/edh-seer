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
    document.documentElement.dataset.route = pathname === "/" ? "home" : "page";
  }, [pathname]);
  return null;
}
