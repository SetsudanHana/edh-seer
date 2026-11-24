import { expect, test } from "vitest";
import { normalizeName } from "@edh-seer/data";
import { anchorOf, comboIndex, resolveKeyOwners, SHARD_COUNT, shardOf, shippedTags, shippedTokenTags, staleRows } from "./build-static-core.js";

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

/** #568: the unnamed pieces ride into the shard with the combo, so a static report can tell a
 *  two-card combo from one that needs a third creature. */
test("a combo's template pieces are kept in its bucket", () => {
  const idx = comboIndex([{ cards: ["Metallic Mimic", "Goblin Bombardment"], result: "Infinite death triggers", requires: ["Creature with undying"] }]);
  expect(idx.get("Goblin Bombardment")).toEqual([
    { cards: ["Metallic Mimic", "Goblin Bombardment"], result: "Infinite death triggers", requires: ["Creature with undying"] },
  ]);
});

test("staleRows lists rows derived below the current version, and rows with no version", () => {
  const rows = [{ id: "a", deriveVersion: 335 }, { id: "b", deriveVersion: 334 }, { id: "c" }, { id: "d", deriveVersion: 336 }];
  expect(staleRows(rows, 335).map((r) => r.id)).toEqual(["b", "c"]);
  expect(staleRows([], 335)).toEqual([]);
});

test("shippedTags drops the diagnostic `unclaimed` and touches nothing else (#1299)", () => {
  const row = { oracleId: "x", deriveVersion: 358, abilities: [{ clause: 1 }], unknownTriggers: ["t"], unclaimed: [{ clause: 1, verb: "cant" }] };
  const out = shippedTags(row);
  expect("unclaimed" in out).toBe(false);
  expect(out).toEqual({ oracleId: "x", deriveVersion: 358, abilities: [{ clause: 1 }], unknownTriggers: ["t"] });
  expect(shippedTags({ oracleId: "y" })).toEqual({ oracleId: "y" });
  expect("unclaimed" in row).toBe(true);
});

test("shippedTokenTags strips unclaimed from every resolved token row and skips an unresolved printing (#1299)", () => {
  const rows: Record<string, { oracleId: string; unclaimed?: unknown[] }> = { p1: { oracleId: "a", unclaimed: [{ clause: 1 }] }, p2: { oracleId: "b" } };
  const out = shippedTokenTags(["p1", "p2", "p3"], (p) => rows[p] ?? null);
  expect(out).toEqual({ p1: { oracleId: "a" }, p2: { oracleId: "b" } });
});

/** #1790: the three real cards the build used to lose, with their real claimants (names read from the corpus). */
const card = (_id: string, name: string, searchNames: string[]) => ({ _id, name, searchNames });
const smelt = card("real-smelt", "Smelt", ["smelt"]);
const smeltSplit = card("split-smelt", "Smelt // Herd // Saw", ["smelt herd saw", "smelt"]);
const gather = card("real-gather", "Gather the Townsfolk", ["gather the townsfolk"]);
const gatherJoke = card("joke-gather", "Gather, the Townsfolk", ["gather the townsfolk"]);
const ransack = card("real-ransack", "Ransack the Lab", ["ransack the lab"]);
const ransackJoke = card("joke-ransack", "Ransack, the Lab", ["ransack the lab"]);

test("a card's own name owns its key, whatever order the claimants arrive in (#1790)", () => {
  for (const order of [[smeltSplit, smelt, gatherJoke, gather, ransackJoke, ransack], [smelt, smeltSplit, gather, gatherJoke, ransack, ransackJoke]]) {
    const r = resolveKeyOwners(order, normalizeName);
    expect(r.owners.get("smelt")).toBe(smelt);
    expect(r.owners.get("gather the townsfolk")).toBe(gather);
    expect(r.owners.get("ransack the lab")).toBe(ransack);
    expect(r.unresolved.size).toBe(0);
  }
});

test("the shadowing alias keeps a key of its own, so the multi-name card stays reachable (#1790)", () => {
  const r = resolveKeyOwners([smelt, smeltSplit], normalizeName);
  expect(r.owners.get("smelt herd saw")).toBe(smeltSplit);
});

test("a punctuation-variant card that loses its own key is reported as shadowed, not dropped silently (#1790)", () => {
  const r = resolveKeyOwners([gatherJoke, gather], normalizeName);
  expect(r.shadowed.map((s) => [s.card.name, s.owner.name])).toEqual([["Gather, the Townsfolk", "Gather the Townsfolk"]]);
});

test("same-name duplicates are tied, not an error; alias-only keys are tied too (#1790)", () => {
  const a = card("a", "Blink", ["blink"]);
  const b = card("b", "Blink", ["blink"]);
  const r = resolveKeyOwners([a, b], normalizeName);
  expect(r.tied.get("blink")).toEqual([a, b]);
  expect(r.unresolved.size).toBe(0);
  const m1 = card("m1", "Monster // Virtuous", ["monster virtuous", "monster"]);
  const m2 = card("m2", "Monster // Sorcerer", ["monster sorcerer", "monster"]);
  expect(resolveKeyOwners([m1, m2], normalizeName).tied.get("monster")).toEqual([m1, m2]);
});

test("two different names that both strip to the same key at the same tier are an unresolved collision (#1790)", () => {
  const x = card("x", "Foo, Bar", ["foo bar"]);
  const y = card("y", "Foo; Bar", ["foo bar"]);
  const r = resolveKeyOwners([x, y], normalizeName);
  expect([...r.unresolved.keys()]).toEqual(["foo bar"]);
  expect(r.owners.has("foo bar")).toBe(false);
});
