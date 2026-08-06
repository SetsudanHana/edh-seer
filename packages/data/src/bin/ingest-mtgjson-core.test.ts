import { expect, test } from "vitest";
import { buildMerge, fieldsFrom } from "./ingest-mtgjson-core.js";

test("keys on the scryfall oracle id, which is our own card _id", () => {
  const m = buildMerge({
    "Sol Ring": [{ identifiers: { scryfallOracleId: "abc" }, producedMana: ["C"], types: ["Artifact"] }],
  });
  expect([...m.keys()]).toEqual(["abc"]);
  expect(m.get("abc")?.producedMana).toEqual(["C"]);
});

// A meld or transform card is ONE atomic entry with one oracle id PER FACE, so taking the first
// face would silently drop the other half of every double-faced card in the corpus.
test("every face of a multi-face entry is merged, not just the first", () => {
  const m = buildMerge({
    "A // B": [
      { identifiers: { scryfallOracleId: "face-a" }, types: ["Creature"] },
      { identifiers: { scryfallOracleId: "face-b" }, types: ["Land"] },
    ],
  });
  expect([...m.keys()].sort()).toEqual(["face-a", "face-b"]);
  expect(m.get("face-b")?.types).toEqual(["Land"]);
});

test("a face with no oracle id is skipped rather than keyed on undefined", () => {
  expect(buildMerge({ X: [{ types: ["Creature"] }] }).size).toBe(0);
});

// "no subtypes" and "not yet ingested" must stay distinguishable, or a later coverage check cannot
// tell whether the merge ran.
test("empty arrays are dropped rather than written", () => {
  const f = fieldsFrom({ subtypes: [], types: ["Artifact"], relatedCards: { spellbook: [] } });
  expect(f.subtypes).toBeUndefined();
  expect(f.spellbook).toBeUndefined();
  expect(f.types).toEqual(["Artifact"]);
});

test("false booleans are not written across 34,000 documents", () => {
  expect(fieldsFrom({ isFunny: false, isOnlineOnly: false }).isFunny).toBeUndefined();
  expect(fieldsFrom({ isFunny: true }).isFunny).toBe(true);
});

// This ADDS to Scryfall data, it does not overwrite it. Two sources silently disagreeing about
// keywords or legalities is worse than one source and a missing field.
test("fields Scryfall already provides are never selected", () => {
  const f = fieldsFrom({
    types: ["Creature"],
    // @ts-expect-error - deliberately passing fields the selector must ignore
    keywords: ["Flying"], colors: ["U"], legalities: { commander: "Legal" }, layout: "normal",
  });
  expect(f).not.toHaveProperty("keywords");
  expect(f).not.toHaveProperty("colors");
  expect(f).not.toHaveProperty("legalities");
  expect(f).not.toHaveProperty("layout");
});

test("a face with nothing worth merging produces no entry at all", () => {
  expect(buildMerge({ X: [{ identifiers: { scryfallOracleId: "x" } }] }).size).toBe(0);
});

// An ADVENTURE or split card is two faces sharing ONE Scryfall oracle id, and our card document
// holds the combined type line. Letting the last face win silently dropped the front face: Beluna
// Grandsquall arrived as "Instant — Adventure" with no supertypes, losing Legendary entirely. 41
// cards disagreed with our own type-line regex, which is how this was caught.
test("faces sharing one oracle id are merged, not overwritten", () => {
  const m = buildMerge({
    "Beluna Grandsquall // Seek Thrills": [
      { identifiers: { scryfallOracleId: "same" }, types: ["Creature"], supertypes: ["Legendary"], subtypes: ["Giant", "Noble"] },
      { identifiers: { scryfallOracleId: "same" }, types: ["Instant"], subtypes: ["Adventure"] },
    ],
  });
  const f = m.get("same")!;
  expect(f.supertypes).toEqual(["Legendary"]);
  expect(f.types).toEqual(["Creature", "Instant"]);
  expect(f.subtypes).toEqual(["Giant", "Noble", "Adventure"]);
});

test("merging faces does not duplicate a shared value", () => {
  const m = buildMerge({
    "X // Y": [
      { identifiers: { scryfallOracleId: "s" }, types: ["Creature"], supertypes: ["Legendary"] },
      { identifiers: { scryfallOracleId: "s" }, types: ["Creature"], supertypes: ["Legendary"] },
    ],
  });
  expect(m.get("s")?.types).toEqual(["Creature"]);
  expect(m.get("s")?.supertypes).toEqual(["Legendary"]);
});

// `relatedCards.tokens` holds MTGJSON UUIDs, not names, and resolves against nothing we store. It
// was written once and then removed - a field that looks like data and resolves to nothing is worse
// than an absent one. Tokens arrive with the printings ingest.
test("token uuids are not stored", () => {
  const f = fieldsFrom({ types: ["Creature"], relatedCards: { tokens: ["fb8bf330-86de-566c-ae38-09bbc290c33a"] } });
  expect(f).not.toHaveProperty("relatedTokens");
});
