import { expect, test } from "vitest";
import { anchorOf, comboIndex, SHARD_COUNT, shardOf } from "./build-static-core.js";

/** THE ANCHOR IS WHY THE INDEX IS EXACT RATHER THAN APPROXIMATE. A combo is contained in a deck
 *  only if EVERY one of its cards is present, so it can only ever match if its alphabetically-first
 *  card is present — index by that and each combo lands in exactly one bucket with no loss.
 *  Measured 2026-08-30: embedding beats one 1.60 MB gz blob 120x on the median deck
 *  (p50 13.4 KB gz) and breaks even only after ~70 decks. */
test("a combo is anchored on its alphabetically-first card, whatever order it was stored in", () => {
  expect(anchorOf(["Thassa's Oracle", "Demonic Consultation"])).toBe("Demonic Consultation");
  expect(anchorOf(["Demonic Consultation", "Thassa's Oracle"])).toBe("Demonic Consultation");
});

test("every combo lands in exactly one bucket", () => {
  const combos = [
    { cards: ["B", "A"], result: "win" },
    { cards: ["A", "C"], result: "win" },
    { cards: ["C", "D"], result: "draw" },
  ];
  const idx = comboIndex(combos);
  expect(idx.get("A")).toHaveLength(2);
  expect(idx.get("C")).toHaveLength(1);
  expect(idx.get("B")).toBeUndefined();
  expect([...idx.values()].flat()).toHaveLength(combos.length);
});

/** A CARD NAME IS NOT A FILENAME, and the previous layout learned that the expensive way: it named
 *  each file `encodeURIComponent(name)`, so `sol ring` lived in a file literally called
 *  `sol%20ring.json` — and a static host decodes a request path once before matching it, looked for
 *  `sol ring.json`, and served a 404. A shard name is hex and survives any number of decodes. */
test("a shard name is four hex digits, whatever the card name contains", () => {
  for (const name of ["fell the profane // fell mire", "krenko, mob boss", "ach! hans, run!", "æther vial", "question elemental?"]) {
    const shard = shardOf(name);
    expect(shard).toMatch(/^[0-9a-f]{4}$/);
    expect(decodeURIComponent(shard)).toBe(shard);
    expect(shard).not.toContain("/");
  }
});

test("the same name always lands in the same shard, and the shard is inside the count", () => {
  expect(shardOf("krenko, mob boss")).toBe(shardOf("krenko, mob boss"));
  for (let i = 0; i < 2000; i++) {
    expect(parseInt(shardOf(`card ${i}`), 16)).toBeLessThan(SHARD_COUNT);
  }
});

/** THE POINT OF THE COUNT IS THE HOST'S CAP: Cloudflare's free tier rejects a deployment over
 *  20,000 files, and one file per card name was 35,713. A test on the constant is what stops it
 *  being raised past the cap by someone who only sees the byte cost. */
test("the shard count stays under the 20,000-file free-tier cap", () => {
  expect(SHARD_COUNT).toBe(16_384);
  expect(SHARD_COUNT).toBeLessThan(20_000);
});

/** A HASH THAT PILES NAMES INTO ONE SHARD COSTS EVERY DECK THAT TOUCHES IT. This is not a
 *  uniformity proof; it is the cheap check that would have failed loudly if the mask, the wrap or
 *  the seed were wrong -- e.g. dropping `Math.imul` for `*`, which loses precision past 2^53 and
 *  collapses the low bits. */
test("spreads names across shards rather than piling them into a few", () => {
  const names = Array.from({ length: 20_000 }, (_, i) => `card number ${i}`);
  const used = new Set(names.map(shardOf));
  // 20,000 names into 16,384 shards fills roughly 1 - e^-1.22 = 70% of them under a uniform hash.
  expect(used.size).toBeGreaterThan(SHARD_COUNT * 0.6);
});
