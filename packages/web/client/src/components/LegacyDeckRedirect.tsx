import { useEffect } from "react";

/** CATCHES A SHARE LINK COPIED BEFORE THE SURFACES MOVED UNDER `/analysis`.
 *
 *  A share link is `path + #deck=<payload>`: the path says which surface, the hash says which deck.
 *  `/graph` and `/combos` could have been Cloudflare redirects, but `/cards` could not -- it is the
 *  card SEARCH page now, and THE HASH NEVER REACHES THE SERVER, so no edge rule can tell a stale
 *  share link from someone who typed `/cards`. The check is therefore in the client, and it lives
 *  in one component rather than three so all three paths cannot drift apart.
 *
 *  A NON-DECK HASH IS NOT A SHARE LINK. Only `#deck=` redirects; an anchor is left where it is.
 *
 *  `hash` and `replace` are injected so the test needs no real Location. `window.location.replace`
 *  rather than a router navigation on purpose: this is a URL that should not survive in history --
 *  Back from the report belongs at whatever the reader was on before, not at a path that no longer
 *  means what their link meant. */
export function LegacyDeckRedirect({
  to,
  hash = typeof window === "undefined" ? "" : window.location.hash,
  replace = (url: string) => window.location.replace(url),
}: { to: string; hash?: string; replace?: (url: string) => void }): null {
  useEffect(() => {
    if (!hash.startsWith("#deck=")) return;
    replace(`${to}${hash}`);
  }, [to, hash, replace]);
  return null;
}
