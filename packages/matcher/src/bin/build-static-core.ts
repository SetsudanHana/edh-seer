export interface StaticCombo { cards: string[]; result: string }

/** The alphabetically-first card of a combo. A combo is contained in a deck only if EVERY one of
 *  its cards is present, so it can only match when its anchor is present — which makes indexing by
 *  the anchor EXACT rather than a heuristic, and puts each combo in exactly one bucket. */
export function anchorOf(comboCards: string[]): string {
  return [...comboCards].sort()[0];
}

export function comboIndex(combos: StaticCombo[]): Map<string, StaticCombo[]> {
  const out = new Map<string, StaticCombo[]>();
  for (const c of combos) {
    const a = anchorOf(c.cards);
    const bucket = out.get(a);
    if (bucket) bucket.push({ cards: c.cards, result: c.result });
    else out.set(a, [{ cards: c.cards, result: c.result }]);
  }
  return out;
}

/** How many files `cards/` holds, FIXED BY CONSTRUCTION and not by how many cards exist.
 *
 *  Cloudflare's free tier caps a deployment at 20,000 files (Pages and Workers static assets
 *  alike, checked 2026-08-30), and one file per card name is 35,713 — the whole corpus was
 *  unhostable there, and would have crossed the cap again on the next set even if the cap were
 *  higher. A shard count fixed here cannot drift: the corpus grows into the same 16,384 files.
 *
 *  16,384 AND NOT FEWER. Sharding trades bytes for file count — a deck fetches one shard per card
 *  name, and every other card sharing that shard rides along. At 16,384 the corpus averages 2.2
 *  names per shard (100.3 MB / 16,384 = 6.1 KB raw, ~2 KB gzipped), so a 100-card deck pulls
 *  roughly 200 KB against the 90 KB the one-file-per-name layout cost. Halving the count doubles
 *  that bill; doubling it leaves no headroom under the cap once the shell's own files are counted. */
export const SHARD_COUNT = 16_384;

/** WHICH SHARD A NAME LIVES IN. FNV-1a over the name's UTF-16 code units, masked to `SHARD_COUNT`
 *  and printed as fixed-width hex.
 *
 *  HEX, AND THAT IS THE POINT, not a detail. The previous layout named each file
 *  `encodeURIComponent(name)`, so `sol ring` was written to a file literally called
 *  `sol%20ring.json` — and every conformant static host decodes a request path ONCE before
 *  matching it, so it looked for `sol ring.json` and served a 404. That defect was invisible in
 *  dev, where a middleware was written not to decode, and in the parity bin, where a filesystem
 *  shim does not decode either: the two sides agreed with each other and neither matched a real
 *  host. A shard name is `[0-9a-f]{4}`, which survives any number of decodes unchanged, so the
 *  whole class of defect is gone rather than fixed.
 *
 *  FNV-1a is chosen for being tiny, dependency-free and identical in Node and a browser — the
 *  build and the client import THIS function, so they cannot disagree about where a card lives.
 *  It is not a security boundary and nothing here needs it to be. */
export function shardOf(normalizedName: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < normalizedName.length; i++) {
    h ^= normalizedName.charCodeAt(i);
    // `Math.imul` for the 32-bit wrap: `h * 16777619` exceeds 2^53 and silently loses precision,
    // which would make the browser and the build agree only by luck.
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % SHARD_COUNT).toString(16).padStart(4, "0");
}
