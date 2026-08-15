import { expect, test } from "vitest";
import { mergeTokenDocs, tokenDoc, tokenKey } from "./ingest-tokens-core.js";

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
