/** THE SITE'S CONTENT SECURITY POLICY, AND THE OTHER HEADERS EVERY PAGE CARRIES (security review
 *  2026-09-25). The site had none: no CSP, no frame policy, no permissions policy.
 *
 *  ONE DEFINITION, TWO DELIVERIES. Static files get their headers from `public/_headers`; a Pages
 *  Function's response (every card, commander and browse page) gets them from `htmlHeaders`, which
 *  `_headers` never reaches. `csp.test.ts` holds the `/*` rule in `_headers` to exactly this object,
 *  so the two cannot drift.
 *
 *  WHAT EACH LINE ALLOWS, AND WHY:
 *   - scripts: our own bundle, the two inline scripts in `index.html` (boot recovery and the header
 *     menu, the second shared with `how-it-works`) by hash, and Cloudflare's analytics beacon, which
 *     the zone injects into every HTML response. `csp.test.ts` recomputes the hashes from the HTML,
 *     so editing an inline script without updating this list fails the build instead of the site.
 *     JSON-LD and the `application/json` card block are data blocks the browser never runs, and a
 *     CSP does not apply to them.
 *   - images: card art comes from Scryfall's CDN, and the graph paints decoded art from `blob:` URLs.
 *   - connect: `/static` shards and `/api/import` are same-origin; `art-cache.ts` fetches art from
 *     Scryfall; the beacon reports to Cloudflare.
 *   - styles: the one stylesheet Vite builds. No `<style>` element or `style=""` attribute ships in
 *     the HTML; React's `style` prop writes through the CSSOM, which a CSP does not govern.
 *   - nothing may frame the site, no plugin may load, and `<base>` may not move the document. */
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'sha256-MMSegDRg2Xk7IZm9a0Jb9yM9fj1Dhfd/vUGnbdAp0cI=' 'sha256-ie8i0uGFgJjmI0/MAHs2apORlp5Cdou/KMObaQWmXRs=' https://static.cloudflareinsights.com",
  "style-src 'self'",
  "img-src 'self' https://cards.scryfall.io blob: data:",
  "font-src 'self'",
  "connect-src 'self' https://cards.scryfall.io https://cloudflareinsights.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "form-action 'self'",
].join("; ");

/** Every header the site's HTML carries beyond its content type and cache policy. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "content-security-policy": CSP,
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  // The old header for the browsers that predate `frame-ancestors`.
  "x-frame-options": "DENY",
  // Nothing on this site needs a sensor, a camera or a location.
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
};
