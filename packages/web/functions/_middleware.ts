import { canonicalHostRedirect } from "../client/src/lib/origin.js";

/** THE OLD HOST 301s TO THE NEW ONE, for every path, before any other Function or asset answers.
 *
 *  `edhseer.pages.dev` served every URL with a 200 for a week after the custom domain went live
 *  (measured 2026-09-08: `/` and `/cards/skullclamp` both rendered in full there). The canonical
 *  tag kept a search engine from indexing the duplicate, but old share links still landed on it and
 *  stayed on it. This is Pages' root middleware, so it runs ahead of `[[path]].ts`, the card and
 *  browse Functions, and the asset store alike -- one place, every route.
 *
 *  A `_redirects` file cannot do this: its rules match paths, never hosts. */
export const onRequest: PagesFunction = (context) => {
  const to = canonicalHostRedirect(new URL(context.request.url));
  if (to !== null) return Response.redirect(to, 301);
  return context.next();
};
