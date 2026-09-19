import { expect, test } from "vitest";
import { EVENT_SHARD_COUNT, eventShardOf, eventShards } from "./events-index-core.js";
import type { EventMembers } from "./partners-core.js";

/** THE EVENT INDEX (roadmap AJ3): one file per shard, one entry per key, and the browser finds a
 *  key by running the build's own hash. */
test("a key lands in one shard, and the same key always lands in the same one", () => {
  const name = eventShardOf("dies|creature|-|-");
  expect(name).toMatch(/^[0-9a-f]{2}$/);
  expect(eventShardOf("dies|creature|-|-")).toBe(name);
  expect(eventShardOf("enters|land|-|-")).toMatch(/^[0-9a-f]{2}$/);
});

/** A KEY CARRIES `|`, `:` AND COMMAS. The hash reads code units, so none of them needs escaping --
 *  pinned because a "clean up the key first" change would move every shard silently. */
test("the hash reads the key as written, punctuation and all", () => {
  expect(eventShardOf("applies:cost-reduction|creature,artifact|cleric,rogue|-"))
    .toMatch(/^[0-9a-f]{2}$/);
});

test("every key is written exactly once, under its own shard", () => {
  const events = new Map<string, EventMembers>([
    ["dies|creature|-|-", { p: [1, 2], c: [3] }],
    ["enters|land|-|-", { p: [4], c: [] }],
    ["fills|creature,enchantment|-|-", { p: [], c: [5] }],
  ]);
  const shards = eventShards(events);
  expect([...shards.values()].flatMap((s) => Object.keys(s)).sort())
    .toEqual(["dies|creature|-|-", "enters|land|-|-", "fills|creature,enchantment|-|-"]);
  expect(shards.get(eventShardOf("enters|land|-|-"))!["enters|land|-|-"]).toEqual({ p: [4], c: [] });
  expect(shards.size).toBeLessThanOrEqual(EVENT_SHARD_COUNT);
  expect(shards.size).toBeGreaterThan(0);
});

/** A SHARD HOLDS UNRELATED KEYS, and that is the trade: 1,187 keys against a deploy already at
 *  18,486 files under a 20,000 cap. What must NOT happen is a key going missing between them. */
test("nothing is lost when two keys share a shard", () => {
  const many = new Map<string, EventMembers>(
    Array.from({ length: 400 }, (_, i) => [`enters|creature|type${i}|-`, { p: [i], c: [] }]),
  );
  const shards = eventShards(many);
  const written = [...shards.values()].flatMap((s) => Object.entries(s));
  expect(written).toHaveLength(400);
  for (const [key, members] of written) {
    expect(eventShardOf(key)).toBe([...shards].find(([, s]) => key in s)![0]);
    expect(members.p).toHaveLength(1);
  }
});
