import { expect, test } from "vitest";
import {
  segmentHash, needsNormalize, needsDerive,
  type CardClausesDoc, type DerivedTagsDoc,
} from "./clause-store.js";

const HASH = segmentHash("Flying", "Creature — Faerie", ["Flying"]);

const clauseDoc = (over: Partial<CardClausesDoc> = {}): CardClausesDoc => ({
  oracleId: "abc", name: "Bitterblossom",
  clauses: [], canonical: [],
  segmentHash: HASH, normalizeVersion: 1,
  model: "claude-haiku-4-5", updatedAt: new Date(), warnings: [],
  ...over,
});

const derivedDoc = (over: Partial<DerivedTagsDoc> = {}): DerivedTagsDoc => ({
  oracleId: "abc", schemaVersion: 1, promptVersion: 0, model: "derived",
  characteristics: {
    types: ["creature"], subtypes: ["faerie"], colors: ["B"], identity: ["B"],
    cmc: 2, power: "0", toughness: "1", token: false, keywords: ["Flying"],
  },
  abilities: [],
  deriveVersion: 1, normalizeVersion: 1, segmentHash: HASH,
  ...over,
});

test("the hash covers every input segment() actually reads", () => {
  // segment(oracleText, keywords, typeLine) -- hashing oracle text alone means a typeLine or
  // keywords correction re-segments the card while the staleness check keeps serving the stale doc.
  expect(segmentHash("a", "T", ["k"])).toBe(segmentHash("a", "T", ["k"]));
  expect(segmentHash("a", "T", ["k"])).not.toBe(segmentHash("b", "T", ["k"]));
  expect(segmentHash("a", "T", ["k"])).not.toBe(segmentHash("a", "U", ["k"]));
  expect(segmentHash("a", "T", ["k"])).not.toBe(segmentHash("a", "T", ["j"]));
});

test("keyword ORDER is not a fact, so it must not change the hash", () => {
  // Scryfall does not promise a stable keyword order; re-paying for a re-ordered array would be
  // spending money on nothing.
  expect(segmentHash("a", "T", ["flying", "haste"])).toBe(segmentHash("a", "T", ["haste", "flying"]));
});

test("field boundaries are unambiguous even when a field contains the separator", () => {
  // Naive concatenation makes ("ab", "c") and ("a", "bc") collide, which would silently skip a
  // re-normalize the card needed. A SPACE separator is not enough -- oracle text and type lines are
  // full of spaces, so ("a b", "c") and ("a", "b c") would hash identically.
  expect(segmentHash("ab", "c", [])).not.toBe(segmentHash("a", "bc", []));
  expect(segmentHash("a b", "c", [])).not.toBe(segmentHash("a", "b c", []));
  expect(segmentHash("a", "b", ["c"])).not.toBe(segmentHash("a", "b c", []));
});

test("normalizing is skipped only when the card AND the vocabulary are unchanged", () => {
  expect(needsNormalize(null, HASH, 1)).toBe(true);
  expect(needsNormalize(clauseDoc(), HASH, 1)).toBe(false);
  // Oracle/typeLine/keywords changed under us.
  expect(needsNormalize(clauseDoc(), segmentHash("other", "T", []), 1)).toBe(true);
  // NORMALIZE_VERSION bumped: the closed vocabularies changed, so the answer may differ.
  expect(needsNormalize(clauseDoc(), HASH, 2)).toBe(true);
});

test("deriving is free, so it re-runs on any drift at all", () => {
  const clauses = clauseDoc();
  expect(needsDerive(null, clauses, 1)).toBe(true);
  expect(needsDerive(derivedDoc(), clauses, 1)).toBe(false);
  // Derivation code changed.
  expect(needsDerive(derivedDoc(), clauses, 2)).toBe(true);
  // The clause doc was re-normalized under a newer vocabulary.
  expect(needsDerive(derivedDoc({ normalizeVersion: 0 }), clauses, 1)).toBe(true);
  // The card itself changed, so the clause doc was rebuilt.
  expect(needsDerive(derivedDoc({ segmentHash: "stale" }), clauses, 1)).toBe(true);
});

test("a derived doc never re-queues into the FLAT grind", () => {
  // deriveCardTags sets promptVersion 0, which needsRetag would read as permanently stale. The two
  // never meet because derived docs live in their own collection and dump-untagged reads cardTags.
  expect(derivedDoc().promptVersion).toBe(0);
  expect(derivedDoc().model).toBe("derived");
});
