/** THE PATHS THIS APP ANSWERS WITH ITS OWN SHELL, and nothing else.
 *
 *  Cloudflare Pages answers an unmatched path with `index.html` at status 200. That is what an SPA
 *  wants for `/analysis/graph` and catastrophic for `/assets/main-<hash>.js`: on 2026-09-04 a
 *  browser cached an HTML response under a JavaScript URL, and `_headers` had stamped that path
 *  `immutable, max-age=31536000`, so the app could not start for a year.
 *
 *  With a `404.html` in the output Pages 404s correctly on its own -- but it then 404s the client
 *  routes too, because no file exists at any of them. This list is what a Function hands the shell
 *  back to. Everything absent from it gets the 404 it deserves, which is also the honest answer for
 *  a crawler following a stale link.
 *
 *  `/cards/:slug` AND `/commanders/:slug` ARE NOT HERE: they have their own Functions, which
 *  prerender the card into the shell rather than serving it empty. */
const APP_ROUTES: RegExp[] = [
  /^\/$/,
  // The report's three surfaces, and the two legacy paths that still catch a shared deck link.
  /^\/analysis(?:\/|$)/,
  /^\/graph$/,
  /^\/combos$/,
  // The two collection pages. Their `:slug` children are prerendered by their own Functions.
  /^\/cards$/,
  /^\/commanders$/,
];

export const isAppRoute = (pathname: string): boolean => APP_ROUTES.some((r) => r.test(pathname));
