import { expect, test } from "vitest";
import type { Clause } from "./segment.js";
import type { ClauseRecord } from "./canonicalize.js";
import { validateClauses, rejections } from "./validate-clauses.js";

/** A two-clause card: a keyword line answered in code, and a triggered ability. */
const SEGMENTED: Clause[] = [
  { id: 1, kind: "keyword", text: "Flying" },
  {
    id: 2, kind: "ability", abilityType: "triggered",
    text: "Whenever this creature deals combat damage to a player, draw a card.",
    effectActions: ["draw=1"],
  },
];

const GOOD: ClauseRecord[] = [
  { id: 1, abilityType: "none", actions: [{ verb: "none", object: "Flying" }] },
  {
    id: 2, abilityType: "triggered",
    trigger: { event: "damage-dealt", subject: "this creature", control: "you" },
    actions: [{ verb: "draw", object: "you", amount: "1" }],
  },
];

const kinds = (v: { kind: string }[]): string[] => v.map((x) => x.kind).sort();

test("a well-formed response has no violations", () => {
  expect(validateClauses(SEGMENTED, GOOD)).toEqual([]);
});

test("clause ids must be answered exactly once, none invented, none dropped", () => {
  // Mirkwood Bats: the segmenter emits 2 clauses and the model answered 3, inventing an id to
  // split "create or sacrifice" into two triggers. That shipped into the gold fixture unnoticed.
  const invented = [...GOOD, { id: 3, abilityType: "triggered", actions: [{ verb: "lose-life" }] }];
  expect(kinds(validateClauses(SEGMENTED, invented))).toContain("invented-id");

  const dropped = [GOOD[0]];
  expect(kinds(validateClauses(SEGMENTED, dropped))).toContain("missing-id");

  const duplicated = [...GOOD, GOOD[1]];
  expect(kinds(validateClauses(SEGMENTED, duplicated))).toContain("duplicate-id");
});

test("every verb, zone and trigger event must be in the closed vocabulary", () => {
  // A hallucinated verb currently reaches derive.ts as `unclaimed` -- silently, after the spend.
  const badVerb = [GOOD[0], { ...GOOD[1], actions: [{ verb: "proliferat" }] }];
  expect(kinds(validateClauses(SEGMENTED, badVerb))).toContain("unknown-verb");

  const badZone = [GOOD[0], { ...GOOD[1], actions: [{ verb: "put", toZone: "sideboard" }] }];
  expect(kinds(validateClauses(SEGMENTED, badZone))).toContain("unknown-zone");

  const badEvent = [GOOD[0], { ...GOOD[1], trigger: { event: "combat-damage" } }];
  expect(kinds(validateClauses(SEGMENTED, badEvent))).toContain("unknown-trigger-event");
});

test("abilityType must be copied from the segmenter, not re-decided", () => {
  // normalize-prompt.ts tells the model to copy type= verbatim, so this is literal equality
  // against a value the harness already holds.
  const rewritten = [GOOD[0], { ...GOOD[1], abilityType: "static" }];
  expect(kinds(validateClauses(SEGMENTED, rewritten))).toContain("ability-type-mismatch");
});

test("a trigger belongs on a triggered clause and nowhere else", () => {
  const missing = [GOOD[0], { ...GOOD[1], trigger: undefined }];
  expect(kinds(validateClauses(SEGMENTED, missing))).toContain("missing-trigger");

  // A trigger on a clause the segmenter did not call triggered.
  const seg: Clause[] = [{ id: 1, kind: "ability", abilityType: "static", text: "Creatures you control get +1/+1." }];
  const stray: ClauseRecord[] = [
    { id: 1, abilityType: "static", trigger: { event: "enters" }, actions: [{ verb: "modify-pt" }] },
  ];
  expect(kinds(validateClauses(seg, stray))).toContain("unexpected-trigger");

  // `event: "none"` is the vocabulary's way of saying no trigger -- not a violation.
  const noneEvent: ClauseRecord[] = [
    { id: 1, abilityType: "static", trigger: { event: "none" }, actions: [{ verb: "modify-pt" }] },
  ];
  expect(validateClauses(seg, noneEvent)).toEqual([]);
});

test("zones are legal only on the verbs whose zones actually vary", () => {
  // Every other verb already fixes its own zones, and recording them twice is what made two runs
  // disagree over a fact neither of them chose.
  const seg: Clause[] = [{ id: 1, kind: "ability", abilityType: "spell", text: "Draw a card." }];
  const zoned: ClauseRecord[] = [{ id: 1, abilityType: "spell", actions: [{ verb: "draw", fromZone: "library" }] }];
  expect(kinds(validateClauses(seg, zoned))).toContain("zone-on-unzoned-verb");
});

test("`play` carries zones even though the prompt's five do not include it", () => {
  // Measured against the gold fixture: this gate rejected Muldrotha, and the gate was wrong.
  // effect-kind.ts:24 consumes { verb: "play", from: "graveyard" } as graveyard-recursion -- it IS
  // Muldrotha's whole card. Rejecting it would re-queue the card forever, paying every time.
  const seg: Clause[] = [{
    id: 1, kind: "ability", abilityType: "static",
    text: "During each of your turns, you may play a land and cast a permanent spell from your graveyard.",
  }];
  const rec: ClauseRecord[] = [{
    id: 1, abilityType: "static", actions: [{ verb: "play", fromZone: "graveyard", toZone: "battlefield" }],
  }];
  expect(validateClauses(seg, rec)).toEqual([]);
});

test("a dropped pre-filled action WARNS, it does not reject", () => {
  // Measured: the pre-fill table is ~97% precise, so hard-rejecting on it would re-queue ~3% of the
  // corpus forever. Syr Konrad is the case -- its trigger has three comma-separated limbs, so
  // effectBody's single-comma split leaves trigger text in the body and pre-fills `put` from it.
  // The model correctly reports no `put` action; the pre-fill is what is wrong.
  const seg: Clause[] = [{
    id: 1, kind: "ability", abilityType: "activated", text: "{T}, Sacrifice a creature: Draw a card.",
    cost: "{T}, Sacrifice a creature", costActions: ["sacrifice"], effectActions: ["draw=1"],
  }];
  const dropped: ClauseRecord[] = [{ id: 1, abilityType: "activated", actions: [{ verb: "draw" }] }];
  const v = validateClauses(seg, dropped);
  expect(kinds(v)).toContain("dropped-prefilled-action");
  expect(v.every((x) => x.severity === "warn")).toBe(true);
  expect(rejections(v)).toEqual([]);

  const kept: ClauseRecord[] = [{
    id: 1, abilityType: "activated",
    actions: [{ verb: "sacrifice", object: "a creature" }, { verb: "draw", amount: "1" }],
  }];
  expect(validateClauses(seg, kept)).toEqual([]);
});

test("vocabulary and id defects DO reject", () => {
  const badVerb = [GOOD[0], { ...GOOD[1], actions: [{ verb: "nonsense" }] }];
  expect(rejections(validateClauses(SEGMENTED, badVerb))).toHaveLength(1);
});

test("violations name the clause they came from, so a reject is debuggable", () => {
  const bad = [GOOD[0], { ...GOOD[1], actions: [{ verb: "nonsense" }] }];
  const v = validateClauses(SEGMENTED, bad);
  expect(v[0].clauseId).toBe(2);
  expect(v[0].detail).toContain("nonsense");
});
