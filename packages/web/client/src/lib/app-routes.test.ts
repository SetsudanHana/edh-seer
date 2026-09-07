import { expect, test } from "vitest";
import { isAppRoute } from "./app-routes.js";

/** THE LIST THAT DECIDES WHETHER A PATH GETS THE SHELL OR A 404, and both mistakes are expensive:
 *  a missing route 404s a real page, and a route too wide re-opens the defect of 2026-09-04, where
 *  Pages answered `/assets/main-<hash>.js` with the shell at 200 and a browser cached HTML under a
 *  JavaScript URL behind an `immutable` header. */
test("every client-side route the app actually mounts is served the shell", () => {
  for (const path of ["/", "/analysis", "/analysis/graph", "/analysis/cards", "/analysis/combos",
    "/graph", "/combos", "/cards", "/commanders"]) {
    expect(isAppRoute(path), `${path} is an app route`).toBe(true);
  }
});

/** A FILE THAT IS MISSING MUST 404 LIKE A FILE. These are the paths whose 200-with-HTML answer is
 *  the bug this exists to close -- both are stamped `immutable`, so one bad response is cached for
 *  a year. */
test("asset and artifact paths are never handed the shell", () => {
  for (const path of ["/assets/main-abc123.js", "/assets/src-abc.css", "/static/manifest.json",
    "/static/v-abc/cards/1be5.json", "/sw.js", "/robots.txt"]) {
    expect(isAppRoute(path), `${path} is not an app route`).toBe(false);
  }
});

/** A MISTYPED URL IS A 404, which is also the honest answer for a crawler following a stale link --
 *  and the reason the sitemap can promise what it promises. */
test("a path the app does not mount is not an app route", () => {
  for (const path of ["/cardz", "/analysisx", "/cards/", "/commanders/x/y", "/how-it-works"]) {
    expect(isAppRoute(path), `${path} is not an app route`).toBe(false);
  }
});

/** `/cards/:slug` AND `/commanders/:slug` HAVE THEIR OWN FUNCTIONS, which prerender the card into
 *  the shell. Matching them here would serve an EMPTY shell to a crawler instead, which is the
 *  whole thing Task 11 exists to prevent. */
test("a card page is not served by the generic fallback", () => {
  expect(isAppRoute("/cards/krenko-mob-boss")).toBe(false);
  expect(isAppRoute("/commanders/krenko-mob-boss")).toBe(false);
});
