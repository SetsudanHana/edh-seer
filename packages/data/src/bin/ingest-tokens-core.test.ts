import { expect, test } from "vitest";
import { tokenDoc, tokenKey } from "./ingest-tokens-core.js";

test("a token becomes a document keyed on its oracle id", () => {
  const d = tokenDoc({
    oracle_id: "abc", name: "Treasure", type_line: "Token Artifact — Treasure",
    oracle_text: "{T}, Sacrifice this token: Add one mana of any color.",
    layout: "token", image_uris: { normal: "n.jpg", art_crop: "a.jpg" },
  })!;
  expect(d._id).toBe("abc");
  expect(d.image).toBe("n.jpg");
  expect(d.oracleText).toContain("Add one mana");
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

// `allParts` keeps only name + typeLine - the Scryfall id it arrived with is a PRINTING id and is
// deliberately dropped - so the join is on both. Several different tokens share a name.
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
