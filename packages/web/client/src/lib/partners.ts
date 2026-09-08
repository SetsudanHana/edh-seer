import { StaticLookup } from "@edh-seer/matcher/static-lookup";
import type { CardPageRecord, NameIndexEntry, PartnerRow } from "@edh-seer/matcher/partners-core";
import { CARD_PAGE_DATA_ID } from "./inject.js";

/** THE CARD PAGES' DATA PLANE, and it is deliberately three lines over `StaticLookup`.
 *
 *  The artifacts live under a content-addressed version directory named by `manifest.json`, are
 *  read through the Cache API when there is one, fall back to the flat layout when a deploy is
 *  caught mid-upload, and need `fetch` bound to `globalThis` or a real browser throws
 *  `Illegal invocation`. `StaticLookup` already does all four and carries the measured reason for
 *  each; this file is the page-shaped API over it, not a second implementation of it.
 *
 *  NO INSTANCE IS MEMOIZED HERE. A navigation pays one extra `manifest.json` read; the shard bytes
 *  -- the part that is actually large -- are cached by URL in the browser's own cache, which is
 *  where the version directory exists to put them. */
export type CardPageData = CardPageRecord;
export type { NameIndexEntry, PartnerRow };

/** THE RECORD THE EDGE ALREADY PUT IN THIS DOCUMENT, or null.
 *
 *  THE NETWORK IS NOT ALWAYS AVAILABLE TO THE THING RENDERING THIS PAGE. Googlebot's renderer obeys
 *  `robots.txt` for subresources, `/static/` is disallowed, and so the fetch below returned nothing
 *  and every card page rendered as `<NotFound />` in the DOM Google indexed. The edge has the record
 *  at serve time; reading it here is what makes the rendered page true. It is also two round trips
 *  a human no longer waits for.
 *
 *  IT MUST MATCH THE SLUG BEING ASKED FOR. React Router navigates without reloading the document, so
 *  after one click on a partner link this tag still holds the card the reader ARRIVED on. Returning
 *  it then would show the wrong card under the right URL -- a worse failure than the one being
 *  fixed, because nothing about it looks broken.
 *
 *  EVERY FAILURE IS `null`, WHICH MEANS "ASK THE NETWORK". No tag (a dev server, the SPA fallback,
 *  a degraded edge response), a body that will not parse, no `document` at all under SSR or a test:
 *  all of them fall through to the fetch that has always been here. */
export function inlineCardPage(slug: string, doc?: Document): CardPageData | null {
  const d = doc ?? (typeof document === "undefined" ? undefined : document);
  const el = d?.getElementById(CARD_PAGE_DATA_ID);
  if (!el || el.getAttribute("data-slug") !== slug) return null;
  try {
    return JSON.parse(el.textContent ?? "") as CardPageData;
  } catch {
    return null;
  }
}

export function loadCardPage(
  slug: string, baseUrl: string, fetchImpl: typeof fetch = fetch,
): Promise<CardPageData | null> {
  const inline = inlineCardPage(slug);
  if (inline) return Promise.resolve(inline);
  return new StaticLookup(baseUrl, fetchImpl).cardPage(slug);
}

export function loadNameIndex(
  baseUrl: string, fetchImpl: typeof fetch = fetch,
): Promise<NameIndexEntry[]> {
  return new StaticLookup(baseUrl, fetchImpl).nameIndex();
}

/** ONE LOAD PER SESSION (spec 2026-09-08 part 1). `loadNameIndex` builds a fresh `StaticLookup` per
 *  call; the Cache API keeps the second fetch cheap but the 1.5 MB parse is paid again, and the
 *  header field on every page would pay it beside the Cards page's own. Keyed by base URL because
 *  tests and the dev server use different ones. An empty answer is forgotten so the next focus
 *  retries: `nameIndex()` resolves to [] on a miss rather than throwing. */
const shared = new Map<string, Promise<NameIndexEntry[]>>();

export function sharedNameIndex(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<NameIndexEntry[]> {
  const hit = shared.get(baseUrl);
  if (hit) return hit;
  const p = loadNameIndex(baseUrl, fetchImpl);
  shared.set(baseUrl, p);
  p.then((index) => { if (index.length === 0 && shared.get(baseUrl) === p) shared.delete(baseUrl); })
    .catch(() => { if (shared.get(baseUrl) === p) shared.delete(baseUrl); });
  return p;
}

/** Tests only: forget every cached load. */
export function resetSharedNameIndex(): void { shared.clear(); }
