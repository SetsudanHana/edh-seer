/** THE ONE HOST THIS SITE ANSWERS AS, written where the edge can import it.
 *
 *  `index.html`'s canonical tag is the source of truth for the origin, and `seo.test.ts` asserts
 *  this constant agrees with it -- a Pages Function cannot read that tag per request without
 *  fetching the shell first, and a redirect that has to fetch a page to know where to send you is
 *  slower than the page.
 *
 *  ONLY THE BARE OLD HOST IS REDIRECTED. Every preview deployment lives on
 *  `<branch-or-hash>.edhseer.pages.dev` and has to keep answering, or nothing can be checked before
 *  it is promoted. The old production alias is the only host that has ever been shared as a link,
 *  and the only one whose 200s compete with the canonical pages. */
export const CANONICAL_HOST = "edhseer.cards";
const LEGACY_HOSTS = new Set(["edhseer.pages.dev"]);

/** The URL to 301 to, or null when this request is already on a host that may answer. Path,
 *  query and fragment travel with it: the analysis share link lives in the fragment. */
export function canonicalHostRedirect(url: URL): string | null {
  if (!LEGACY_HOSTS.has(url.host)) return null;
  const to = new URL(url);
  to.protocol = "https:";
  to.host = CANONICAL_HOST;
  return to.toString();
}
