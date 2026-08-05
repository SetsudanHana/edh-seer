import { expect, test } from "vitest";
import {
  buildTagIndex, candidateFromTagIndex, mergeFixtures, pairKey, pickStratum, randomPair, upsertPair,
  type ClauseFixture, type PairRecord,
} from "./pair-calibrate-core.js";

const rec = (a: string, b: string, over: Partial<PairRecord> = {}): PairRecord => ({
  a, b, verdict: "neutral", stratum: "random", judgedAt: "2026-08-06T00:00:00.000Z", ...over,
});

const CHARS = {
  types: [], subtypes: [], colors: [], identity: [], cmc: 0,
  power: null, toughness: null, token: false, keywords: [],
};

test("the strata split 40/40/20 and every draw lands in one", () => {
  // The proportions ARE the sampling design: linked catches false edges, shared-tag catches MISSED
  // ones, random locks in neutrals. A boundary that drifted would quietly stop testing one of them.
  expect(pickStratum(0)).toBe("linked");
  expect(pickStratum(0.39)).toBe("linked");
  expect(pickStratum(0.4)).toBe("shared-tag");
  expect(pickStratum(0.79)).toBe("shared-tag");
  expect(pickStratum(0.8)).toBe("random");
  expect(pickStratum(0.999)).toBe("random");
});

test("a pair is the same pair in either order", () => {
  // Judging A/B then B/A must not leave two records that can disagree with each other.
  expect(pairKey("Sol Ring", "Urza")).toBe(pairKey("Urza", "Sol Ring"));
});

test("re-judging a pair replaces the verdict instead of appending a second one", () => {
  const existing = [rec("Sol Ring", "Urza", { verdict: "synergy" })];
  const out = upsertPair(existing, rec("Urza", "Sol Ring", { verdict: "neutral" }));
  expect(out).toHaveLength(1);
  expect(out[0].verdict).toBe("neutral");
  expect(upsertPair(out, rec("A", "B"))).toHaveLength(2);
});

test("fixtures dedupe by oracleId and never lose a card already captured", () => {
  // The fixture is what lets the gate run with no database, so a card captured once stays captured.
  const a: ClauseFixture = { name: "Sol Ring", oracleId: "1", clauses: [], characteristics: CHARS as never };
  const b: ClauseFixture = { name: "Urza", oracleId: "2", clauses: [], characteristics: CHARS as never };
  const again: ClauseFixture = { name: "Sol Ring", oracleId: "1", clauses: [], characteristics: CHARS as never };
  const out = mergeFixtures([a], [b, again]);
  expect(out.map((f) => f.oracleId).sort()).toEqual(["1", "2"]);
});

test("the tag index drops tags only one card carries", () => {
  // A tag with a single card can never produce a pair; keeping it would make the sampler retry on
  // cards that have no possible partner.
  const index = buildTagIndex([
    { name: "Blood Artist", tags: new Set(["dies:creature", "drain"]) },
    { name: "Viscera Seer", tags: new Set(["dies:creature"]) },
    { name: "Sol Ring", tags: new Set(["mana"]) },
  ]);
  expect([...index.keys()]).toEqual(["dies:creature"]);
  expect(index.get("dies:creature")).toEqual(["Blood Artist", "Viscera Seer"]);
});

test("a shared-tag candidate is two DIFFERENT cards that really share a tag", () => {
  const index = buildTagIndex([
    { name: "Blood Artist", tags: new Set(["dies:creature"]) },
    { name: "Viscera Seer", tags: new Set(["dies:creature"]) },
  ]);
  const pair = candidateFromTagIndex(index, () => 0.5);
  expect(pair).not.toBeNull();
  expect(pair![0]).not.toBe(pair![1]);
  expect(new Set(pair!)).toEqual(new Set(["Blood Artist", "Viscera Seer"]));
});

test("an empty tag index yields no candidate rather than hanging", () => {
  expect(candidateFromTagIndex(new Map(), () => 0.5)).toBeNull();
});

test("a random pair is two different cards, and one card yields none", () => {
  for (const r of [0, 0.25, 0.5, 0.75, 0.99]) {
    const pair = randomPair(["a", "b", "c", "d"], () => r);
    expect(pair![0]).not.toBe(pair![1]);
  }
  expect(randomPair(["only"], () => 0.5)).toBeNull();
});
