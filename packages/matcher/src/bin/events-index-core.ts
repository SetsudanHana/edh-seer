import type { EventMembers } from "../partners-core.js";

/** THE EVENT INDEX (roadmap AJ3): the cards behind every event count, cut into files a reader can
 *  fetch one of.
 *
 *  ONE FILE PER SHARD, NOT PER KEY. There are 1,187 keys and the Pages deploy already carries
 *  18,486 files under a 20,000 cap (measured 2026-09-19): a file each would spend most of the
 *  headroom the corpus still needs to grow into. 256 shards average about five keys and ~30 KB,
 *  and the worst single key -- 24,982 ids, an event essentially every card can cause -- is ~175 KB
 *  raw, paid only by a reader who picks that event.
 *
 *  A SHARD BUNDLES UNRELATED KEYS, exactly as the card and partner shards bundle unrelated cards.
 *  That is the cost of the file cap, and it is bounded: picking one event fetches one file. */
export const EVENT_SHARD_COUNT = 256;

/** WHICH SHARD A KEY LIVES IN. FNV-1a over the key's UTF-16 code units, the same hash `shardOf`
 *  runs over a card name -- the browser and the build must agree on where a key is, so they run
 *  the identical function rather than two implementations that agree today.
 *
 *  THE KEY IS HASHED AS WRITTEN. It carries `|`, `:` and commas, and none of them is normalised
 *  away first: a "tidy the key up" step here would move every shard while both sides still
 *  computed a plausible-looking name. */
export function eventShardOf(key: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    // `Math.imul` for the 32-bit wrap, for the reason `shardOf` gives: `h * 16777619` exceeds 2^53
    // and silently loses precision, so the browser and the build would agree only by luck.
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % EVENT_SHARD_COUNT).toString(16).padStart(2, "0");
}

/** THE FILES TO WRITE, keyed by shard name. Every key appears in exactly one. */
export function eventShards(events: Map<string, EventMembers>): Map<string, Record<string, EventMembers>> {
  const out = new Map<string, Record<string, EventMembers>>();
  for (const [key, members] of events) {
    const name = eventShardOf(key);
    const shard = out.get(name) ?? {};
    shard[key] = members;
    out.set(name, shard);
  }
  return out;
}
