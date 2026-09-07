import { expect, test } from "vitest";
import {
  blindRecall, pooledRecall, scoreRecall, stratumOf, type RecallJudgment, type SilentPair,
} from "./recall-core.js";
import { seededRng } from "./precision-core.js";

const pair = (over: Partial<SilentPair> = {}): SilentPair => ({
  deck: "d", a: "A", b: "B",
  emits: { A: [], B: [] }, triggers: { A: [], B: [] },
  hasAbilities: { A: true, B: true }, hasText: { A: true, B: true },
  ...over,
});

// The LOST and PLAUSIBLE tests that stood here are DELETED, not repaired. They asserted a frame
// that measured itself wrong (§26.1): flat's extra claims are mostly mesh, and shared theme tags
// key on a card's own verbs, so neither separated. Keeping them green against a retired stratifier
// would be keeping a passing test for behaviour nobody wants.

test("the worksheet carries no stratum, and the key does", () => {
  // Same ordering as the precision instrument: the judge cannot see which stratum a row came from,
  // so the stratum cannot colour the verdict. Without this, knowing a row is VERB-MATCH is a
  // standing invitation to find a synergy in it.
  const rows = blindRecall(
    [pair({ a: "X", emits: { X: ["enters"] }, triggers: { B: ["enters"] } }), pair({ a: "Y" })],
    seededRng(1),
  );
  for (const r of rows) {
    expect(r).not.toHaveProperty("stratum");
    expect(r).not.toHaveProperty("emits");
    expect(r).not.toHaveProperty("triggers");
    expect(r).not.toHaveProperty("hasAbilities");
  }
  expect(rows.map((r) => r.id).sort()).toEqual([0, 1]);
});

test("recall counts only the misses the engine COULD have expressed", () => {
  // An inexpressible miss is a ceiling, not a defect: no SubjectFilter or verb in the vocabulary can
  // carry "your second spell each turn". Counting it as a defect would make the number unreachable
  // and stop it guiding anything.
  const judgments: RecallJudgment[] = [
    { id: 0, verdict: "miss-expressible", note: "" },
    { id: 1, verdict: "miss-inexpressible", note: "" },
    { id: 2, verdict: "correct-silence", note: "" },
    { id: 3, verdict: "correct-silence", note: "" },
    { id: 4, verdict: "uncertain", note: "" },
  ];
  const s = scoreRecall(judgments);
  expect(s.missExpressible).toBe(1);
  expect(s.missInexpressible).toBe(1);
  expect(s.decided).toBe(4); // uncertain counts against neither
  expect(s.recall).toBeCloseTo(0.75, 5);
});

test("a stratum with nothing decided has no recall rather than a fake 100%", () => {
  const s = scoreRecall([{ id: 0, verdict: "uncertain", note: "" }]);
  expect(s.decided).toBe(0);
  expect(s.recall).toBeNull();
});

// ---- Rebuilt frame (2026-08-06-recall-frame-rebuild-design.md) ----

test("a pair whose emit verb matches the other's trigger verb is VERB-MATCH", () => {
  expect(stratumOf({
    deck: "d", a: "A", b: "B",
    emits: { A: ["enters"], B: [] },
    triggers: { A: [], B: ["enters"] },
    hasAbilities: { A: true, B: true },
    hasText: { A: true, B: true },
  })).toBe("verb-match");
});

test("verb-match is checked in BOTH directions", () => {
  expect(stratumOf({
    deck: "d", a: "A", b: "B",
    emits: { A: [], B: ["dies"] },
    triggers: { A: ["dies"], B: [] },
    hasAbilities: { A: true, B: true },
    hasText: { A: true, B: true },
  })).toBe("verb-match");
});

// Silence with a KNOWN mechanical cause: a card deriving nothing cannot form an edge, whatever its
// text says. 173 such cards across the calibration decks.
test("a card with real text but no derived abilities is DERIVE-EMPTY", () => {
  expect(stratumOf({
    deck: "d", a: "Foundry Inspector", b: "B",
    emits: { "Foundry Inspector": [], B: ["enters"] },
    triggers: { "Foundry Inspector": [], B: [] },
    hasAbilities: { "Foundry Inspector": false, B: true },
    hasText: { "Foundry Inspector": true, B: true },
  })).toBe("derive-empty");
});

// A basic land derives nothing and SAYS nothing. Counting it as derive-empty would flood the stratum
// with pairs whose silence is correct by construction, which is the mistake that put 143k trivially
// silent pairs into the old BASE.
test("a card with no abilities AND no real text is BASE, not DERIVE-EMPTY", () => {
  expect(stratumOf({
    deck: "d", a: "Island", b: "B",
    emits: { Island: [], B: ["enters"] },
    triggers: { Island: [], B: [] },
    hasAbilities: { Island: false, B: true },
    hasText: { Island: false, B: true },
  })).toBe("base");
});

test("VERB-MATCH outranks DERIVE-EMPTY so the strata stay disjoint", () => {
  expect(stratumOf({
    deck: "d", a: "A", b: "B",
    emits: { A: ["enters"], B: [] },
    triggers: { A: [], B: ["enters"] },
    hasAbilities: { A: true, B: false },
    hasText: { A: true, B: true },
  })).toBe("verb-match");
});

// The previous run pooled 120 judgments drawn at equal n from populations of 62,795 / 15,591 /
// 172,570 and reported 92.5%. That number describes the sampling weights, not a deck. Pooling MUST
// reweight to the population the stratum was drawn from.
test("pooled recall reweights each stratum to its population share", () => {
  const pooled = pooledRecall([
    { population: 10, judgments: [{ id: 0, verdict: "miss-expressible", note: "" }] },
    { population: 90, judgments: [{ id: 1, verdict: "correct-silence", note: "" }] },
  ]);
  // Raw pooling would say 50%. Weighted: the miss stratum is a tenth of the population.
  expect(pooled).toBeCloseTo(0.9, 10);
});

test("pooled recall ignores a stratum that decided nothing rather than counting it as perfect", () => {
  const pooled = pooledRecall([
    { population: 50, judgments: [{ id: 0, verdict: "miss-expressible", note: "" }] },
    { population: 50, judgments: [{ id: 1, verdict: "uncertain", note: "" }] },
  ]);
  expect(pooled).toBeCloseTo(0, 10);
});
