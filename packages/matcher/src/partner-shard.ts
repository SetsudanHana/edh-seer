/** WHICH SHARD A SLUG LIVES IN, AND NOTHING ELSE.
 *
 *  ITS OWN FILE BECAUSE OF WHO IMPORTS IT. The build and the browser take it from
 *  `partners-core.ts`, which also pulls in `directedReasons` and therefore `edges.ts` -- 126 KB of
 *  matcher. The Cloudflare Pages Function that pre-renders a card page needs the shard rule and
 *  nothing else, and a Function bundle has a 1 MB limit, so it imports this module directly. One
 *  definition either way: a second copy of the hash in the Function is a URL that works until the
 *  day the two disagree, and then works for exactly half the corpus. */

/** SMALLER THAN THE CARD SHARDS ON PURPOSE. The deploy is 18,457 files against a 20,000 cap, so the
 *  partner artifact has room for a few thousand; 2,048 leaves headroom at ~7 records per shard. */
export const PARTNER_SHARD_COUNT = 2_048;

/** Same FNV-1a as `shardOf`, different modulus -- one rule, imported by the build, the browser and
 *  the edge, so none of the three can drift about where a page lives. */
export function partnerShardOf(slug: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % PARTNER_SHARD_COUNT).toString(16).padStart(3, "0");
}
