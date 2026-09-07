import { isAppRoute } from "../client/src/lib/app-routes.js";

/** THE SPA FALLBACK, MADE EXPLICIT, so that a missing FILE can 404 like a missing file.
 *
 *  Pages' own fallback answers every unmatched path with `index.html` at 200 -- including
 *  `/assets/main-<hash>.js` during the seconds of a deploy, which is how a browser came to hold an
 *  HTML response under a JavaScript URL behind an `immutable` header. A `404.html` in the output
 *  makes Pages 404 correctly, and this Function hands the shell back to the paths that legitimately
 *  have no file: the client-side routes.
 *
 *  IT ASKS THE ASSET STORE FIRST and only acts on a 404, so a real file is served exactly as before
 *  and this cannot come between a reader and the bytes they asked for.
 *
 *  A PATH THAT IS NEITHER A FILE NOR AN APP ROUTE GETS THE 404 THROUGH UNCHANGED. That is the whole
 *  point: `/assets/*`, `/static/*` and a mistyped URL are all genuine misses, and answering them
 *  with a 200 shell is what taught the browser a lie in the first place. */
export const onRequestGet: PagesFunction = async (context) => {
  const response = await context.env.ASSETS.fetch(context.request);
  if (response.status !== 404) return response;
  if (!isAppRoute(new URL(context.request.url).pathname)) return response;

  const shell = await context.env.ASSETS.fetch(new URL("/index.html", context.request.url).toString());
  return new Response(await shell.text(), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
};
