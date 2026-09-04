/** A MISSING HASHED ASSET MUST 404, NOT RETURN THE APP SHELL.
 *
 *  Cloudflare Pages answers any unmatched path with `index.html` at status 200, and `_headers`
 *  stamps `/assets/*` with `immutable, max-age=31536000` -- the header applies to the PATH, not to
 *  whatever is actually served there. On 2026-09-04 that combination cached an HTML response under
 *  a JavaScript URL for a year in every browser that loaded the site during the seconds before a
 *  deploy's files propagated: the module was refused on its MIME type, React never mounted, and the
 *  site rendered as a static shell with no app in it.
 *
 *  A 404 CANNOT BE MISTAKEN FOR A MODULE, and `no-store` means a browser that hits the race once
 *  does not carry it. The shell's own recovery script handles the visitors already poisoned; this
 *  is what stops the next ones.
 *
 *  A REAL ASSET PASSES THROUGH UNTOUCHED, keeping the `immutable` header the asset store already
 *  applied to it.
 *
 *  CEILING: this runs a Function on every `/assets/*` request, which is the hottest path on the
 *  site. That is affordable at today's traffic -- and browsers hold these files for a year, so it
 *  is nearly all first visits -- but it is the line to revisit if Function invocations become the
 *  binding cost. The upgrade path is a `404.html`, which makes Pages 404 correctly on its own, plus
 *  a Function serving the shell for the app's client-side routes (`/analysis/*` and `/`), because
 *  `404.html` would otherwise take those over too. */
export const onRequestGet: PagesFunction = async (context) => {
  const response = await context.env.ASSETS.fetch(context.request);
  const type = response.headers.get("content-type") ?? "";
  // NOTHING UNDER `/assets/` IS EVER AN HTML DOCUMENT. Vite writes JavaScript, CSS, and the fonts
  // and images they reference; an HTML body here is the shell fallback and nothing else.
  if (!type.startsWith("text/html")) return response;
  return new Response("Not found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
};
