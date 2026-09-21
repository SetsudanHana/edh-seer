import { StaticLookup } from "@edh-seer/matcher/static-lookup";
import type { CardPageRecord, EventFrequencyFile, EventMembers, NameIndexEntry, PartnerRow } from "@edh-seer/matcher/partners-core";
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
export type { EventFrequencyFile, EventMembers, NameIndexEntry, PartnerRow };

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

/** THE TYPE AND SUBTYPE TABLES the index's `t`/`s` codes point into (2026-09-21). Its own loader
 *  rather than a second field on `sharedNameIndex`, because the two are wanted at different times:
 *  the header field needs the ROWS on first keystroke and never needs the tables, while the facet
 *  row needs the tables to draw itself before any card has been filtered. The underlying fetch is
 *  the same file and `StaticLookup` caches it, so asking twice costs one request. */
const sharedVocabulary = new Map<string, Promise<{ types: string[]; subtypes: string[]; keywords: string[] }>>();
/** ONE `StaticLookup` BEHIND BOTH SHARED READERS, so they share its single fetch and single parse
 *  of a 4.3 MB file. Two instances meant two downloads on any path without a Cache API -- every
 *  test, and a browser's first visit -- while the comment above promised one request per session.
 *
 *  THE SHARED PATH ONLY. `loadNameIndex` below stays unmemoised on purpose: it is the "ask again"
 *  variant, and a test calls it twice with different stubs and expects two different answers.
 *  Caching it broke that, which is what the suite said the moment this map was introduced. */
const sharedLookups = new Map<string, StaticLookup>();
const sharedLookup = (baseUrl: string, fetchImpl: typeof fetch): StaticLookup => {
  const hit = sharedLookups.get(baseUrl);
  if (hit) return hit;
  const made = new StaticLookup(baseUrl, fetchImpl);
  sharedLookups.set(baseUrl, made);
  return made;
};
/** Forgetting a base URL forgets its lookup too, or the retry the empty-answer rule buys would be
 *  answered from the same instance that already resolved empty. */
const forget = (baseUrl: string): void => { sharedLookups.delete(baseUrl); };

export function sharedNameIndexVocabulary(
  baseUrl: string, fetchImpl: typeof fetch = fetch,
): Promise<{ types: string[]; subtypes: string[]; keywords: string[] }> {
  const hit = sharedVocabulary.get(baseUrl);
  if (hit) return hit;
  const p = sharedLookup(baseUrl, fetchImpl).nameIndexVocabulary();
  sharedVocabulary.set(baseUrl, p);
  // An empty answer is forgotten, the same rule the index itself keeps: an artifact built before
  // the tables existed, or a fetch that missed, must not pin an empty vocabulary for the session.
  p.then((v) => {
    if (v.types.length === 0 && sharedVocabulary.get(baseUrl) === p) { sharedVocabulary.delete(baseUrl); forget(baseUrl); }
  }).catch(() => { sharedVocabulary.delete(baseUrl); forget(baseUrl); });
  return p;
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
  // THE SHARED LOOKUP, NOT `loadNameIndex`: the rows and the vocabulary have to come out of one
  // fetch, and `loadNameIndex` makes a fresh instance every call by design.
  const p = sharedLookup(baseUrl, fetchImpl).nameIndex();
  shared.set(baseUrl, p);
  p.then((index) => {
    if (index.length === 0 && shared.get(baseUrl) === p) { shared.delete(baseUrl); forget(baseUrl); }
  }).catch(() => { if (shared.get(baseUrl) === p) { shared.delete(baseUrl); forget(baseUrl); } });
  return p;
}

/** Tests only: forget every cached load. */
/** EVERY MAP THAT REMEMBERS A BASE URL, and the two added on 2026-09-21 belong here. Clearing the
 *  promise maps while leaving `sharedLookups` holding an instance that has already memoised a body
 *  makes the reset look like it worked and answer from the old fetch -- which is what the suite
 *  said when they were first left out. */
export function resetSharedNameIndex(): void {
  shared.clear();
  sharedVocabulary.clear();
  sharedLookups.clear();
  sharedFreq.clear();
  sharedMembers.clear();
}

/** THE EVENT COUNTS, ONCE PER SESSION (roadmap AJ3): what every picker row prints, fetched on the
 *  first search interaction and never on page load. Same memo rule as the name index -- an empty
 *  answer is forgotten so the next interaction retries. */
const sharedFreq = new Map<string, Promise<EventFrequencyFile>>();

export function sharedEventFrequency(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<EventFrequencyFile> {
  const hit = sharedFreq.get(baseUrl);
  if (hit) return hit;
  const p = new StaticLookup(baseUrl, fetchImpl).eventFrequency();
  sharedFreq.set(baseUrl, p);
  p.then((f) => { if (Object.keys(f.supply).length === 0 && sharedFreq.get(baseUrl) === p) sharedFreq.delete(baseUrl); })
    .catch(() => { if (sharedFreq.get(baseUrl) === p) sharedFreq.delete(baseUrl); });
  return p;
}

/** ONE FETCH PER EVENT, SHARED BY BOTH PICKERS AND THE RESULT LIST. Keyed by base URL and key
 *  together: two controls asking for the same event must not fetch its shard twice, and a `null`
 *  (the shard did not carry it) is forgotten so a later build can answer differently. */
const sharedMembers = new Map<string, Promise<EventMembers | null>>();

export function sharedEventMembers(
  baseUrl: string, key: string, fetchImpl: typeof fetch = fetch,
): Promise<EventMembers | null> {
  const id = `${baseUrl}\u0000${key}`;
  const hit = sharedMembers.get(id);
  if (hit) return hit;
  const p = new StaticLookup(baseUrl, fetchImpl).eventMembers(key);
  sharedMembers.set(id, p);
  p.then((m) => { if (m === null && sharedMembers.get(id) === p) sharedMembers.delete(id); })
    .catch(() => { if (sharedMembers.get(id) === p) sharedMembers.delete(id); });
  return p;
}
