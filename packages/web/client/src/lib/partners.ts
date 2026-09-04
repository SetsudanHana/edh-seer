import { StaticLookup } from "@edh-seer/matcher/static-lookup";
import type { CardPageRecord, NameIndexEntry, PartnerRow } from "@edh-seer/matcher/partners-core";

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

export function loadCardPage(
  slug: string, baseUrl: string, fetchImpl: typeof fetch = fetch,
): Promise<CardPageData | null> {
  return new StaticLookup(baseUrl, fetchImpl).cardPage(slug);
}

export function loadNameIndex(
  baseUrl: string, fetchImpl: typeof fetch = fetch,
): Promise<NameIndexEntry[]> {
  return new StaticLookup(baseUrl, fetchImpl).nameIndex();
}
