import { expect, test } from "vitest";
import { mergeTokenDocs, tokenDoc, tokenKey, tokenGapMessage, unresolvedPrintingIds, unresolvedTokenMakers } from "./ingest-tokens-core.js";

test("a token becomes a document keyed on its oracle id", () => {
  const d = tokenDoc({
    id: "print-1", oracle_id: "abc", name: "Treasure", type_line: "Token Artifact — Treasure",
    oracle_text: "{T}, Sacrifice this token: Add one mana of any color.",
    layout: "token", image_uris: { normal: "n.jpg", art_crop: "a.jpg" },
  })!;
  expect(d._id).toBe("abc");
  expect(d.image).toBe("n.jpg");
  expect(d.oracleText).toContain("Add one mana");
  expect(d.printingIds).toEqual(["print-1"]);
});

// Kuja, Genome Sorcerer's Wizard part points at ONE of three printings under the same oracle_id;
// `mergeTokenDocs` is what makes that printing id findable in the collapsed row.
test("two payloads sharing an oracle_id merge into one doc carrying both printing ids", () => {
  const a = tokenDoc({
    id: "print-a", oracle_id: "wiz", name: "Wizard", type_line: "Token Creature — Wizard",
    oracle_text: "Whenever you cast a noncreature spell, this token deals 1 damage to each opponent.",
  })!;
  const b = tokenDoc({ id: "print-b", oracle_id: "wiz", name: "Wizard", type_line: "Token Creature — Wizard" })!;
  const merged = mergeTokenDocs([a, b]);
  expect(merged).toHaveLength(1);
  expect(merged[0]!.printingIds.sort()).toEqual(["print-a", "print-b"]);
  // First-seen payload's fields win — a reprint's rules text does not change the token's identity.
  expect(merged[0]!.oracleText).toContain("noncreature spell");
});

// The four distinct "Wizard" oracle_ids stay four separate docs — merging is keyed on oracle_id,
// never on the ambiguous (name, typeLine) pair.
test("payloads with different oracle_ids stay separate even when name and typeLine collide", () => {
  const a = tokenDoc({ id: "print-a", oracle_id: "wiz-1", name: "Wizard", type_line: "Token Creature — Wizard" })!;
  const b = tokenDoc({ id: "print-b", oracle_id: "wiz-2", name: "Wizard", type_line: "Token Creature — Wizard" })!;
  expect(mergeTokenDocs([a, b])).toHaveLength(2);
});

// 20 of every 175 tokens are double-faced, and their images live on card_faces. Reading only the
// top-level image_uris returns nothing for those - a token list would render blanks.
test("a double-faced token takes its image from the front face", () => {
  const d = tokenDoc({
    oracle_id: "dfc", name: "Dinosaur // Treasure", layout: "double_faced_token",
    card_faces: [{ image_uris: { normal: "front.jpg" } }, { image_uris: { normal: "back.jpg" } }],
  })!;
  expect(d.image).toBe("front.jpg");
});

test("a token with no oracle id has no stable key and is refused", () => {
  expect(tokenDoc({ name: "Nameless" })).toBeNull();
});

// tokenKey is (name, typeLine) only — a reporting aid, not the exact join (that is printingId).
// Several different tokens share a name, so this at least separates those.
test("the lookup key distinguishes tokens that share a name", () => {
  expect(tokenKey("Soldier", "Token Creature — Soldier"))
    .not.toBe(tokenKey("Soldier", "Token Artifact Creature — Soldier"));
  expect(tokenKey("Treasure", "Token Artifact — Treasure"))
    .toBe(tokenKey("treasure", "TOKEN ARTIFACT — TREASURE"));
});

test("empty arrays are not written", () => {
  const d = tokenDoc({ oracle_id: "x", name: "T", colors: [], keywords: [] })!;
  expect(d).not.toHaveProperty("colors");
  expect(d).not.toHaveProperty("keywords");
});

/** AN EMBLEM IS A SCRYFALL OBJECT (spec 2026-09-08): layout `emblem`, its own oracle id, oracle text
 *  equal to the granted ability. It rides the same document shape as a token; the layout is what
 *  the derive side reads to set `emblem: true` instead of `token: true`. */
test("an emblem payload becomes a token document carrying its layout and text", () => {
  const d = tokenDoc({
    id: "4a8123a6", oracle_id: "64c3e607", name: "Chandra, Roaring Flame Emblem",
    type_line: "Emblem — Chandra", layout: "emblem",
    oracle_text: "At the beginning of your upkeep, this emblem deals 3 damage to you.",
  })!;
  expect(d.layout).toBe("emblem");
  expect(d.typeLine).toBe("Emblem — Chandra");
  expect(d.oracleText).toContain("deals 3 damage");
  expect(d.printingIds).toEqual(["4a8123a6"]);
});

/** #1709: Beast Within's Beast part names printing ca8e8a9a-..., released after the token ingest ran.
 *  The token doc for oracle 6bb61f34 existed (name + type line matched), so the name-only coverage
 *  line read 100% while the exact join resolved nothing. */
test("a token part whose printing id no token doc holds is reported, though its name matches", () => {
  const beast = { _id: "6bb61f34", name: "Beast", typeLine: "Token Creature — Beast", printingIds: ["old-print"] };
  const parts = [
    { component: "token", name: "Beast", typeLine: "Token Creature — Beast", printingId: "ca8e8a9a" },
    { component: "token", name: "Beast", typeLine: "Token Creature — Beast", printingId: "old-print" },
    { component: "combo_piece", name: "Some Card", typeLine: "Creature", printingId: "zzz" },
  ];
  expect(unresolvedPrintingIds(parts, [beast])).toEqual(["ca8e8a9a"]);
  expect(unresolvedPrintingIds(parts, [{ ...beast, printingIds: ["old-print", "ca8e8a9a"] }])).toEqual([]);
});

test("makers of an unresolved printing are named, and the gap message carries count, examples and the cure", () => {
  const docs = [{ printingIds: ["old"] }];
  const mk = (n: number) => Array.from({ length: n }, (_, i) => ({
    name: `Maker ${i}`, allParts: [{ component: "token", typeLine: "Token Creature — Beast", printingId: "new" }],
  }));
  const gaps = unresolvedTokenMakers([...mk(2), { name: "Fine", allParts: [{ component: "token", printingId: "old" }] }, { name: "NoParts" }], docs);
  expect(gaps).toEqual([{ printingId: "new", makers: ["Maker 0", "Maker 1"] }]);
  expect(tokenGapMessage([])).toBeNull();
  const many = Array.from({ length: 7 }, (_, i) => ({ printingId: `id${i}`, makers: ["M"] }));
  const msg = tokenGapMessage(many)!;
  expect(msg).toContain("7 token printing id(s)");
  expect(msg).toContain("id4 (M)");
  expect(msg).not.toContain("id5");
  expect(msg).toContain("packages/data/src/bin/ingest-tokens.ts");
});
