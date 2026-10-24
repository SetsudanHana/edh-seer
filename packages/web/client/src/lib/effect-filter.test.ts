import { describe, expect, test } from "vitest";
import { UNJUDGED_FACT, packFact } from "@edh-seer/matcher/member-facts";
import { membersPassing, unjudgedLeftOut, unjudgedMembers } from "./effect-filter.js";
import type { EventTerm } from "./event-terms.js";
import type { EventQuery } from "./facets.js";

const ping = packFact({ kind: "triggered", repeats: "repeatable", amount: { kind: "fixed", value: 1 } });
const bolt = packFact({ kind: "spell", repeats: "once", amount: { kind: "fixed", value: 3 } });
const doubler = packFact({ kind: "replacement", repeats: "continuous", amount: { kind: "unstated" } });

test("a side keeps the members whose abilities pass, in the list's own order", () => {
  const m = { p: [5, 2, 9], c: [7, 3], pf: [[bolt], [ping], []], cf: [[doubler], [ping]] };
  expect(membersPassing(m, "makes", { amountMin: 1, amountMax: 1 })).toEqual([2]);
  expect(membersPassing(m, "pays", { kinds: ["replacement"] })).toEqual([7]);
});

test("no filter keeps the list as it is, facts or not", () => {
  expect(membersPassing({ p: [5, 2], c: [] }, "makes", {})).toEqual([5, 2]);
});

/** AN OLD SHARD CANNOT ANSWER, AND SAYS SO rather than keeping or dropping everything. */
test("a shard without facts answers null to a real filter", () => {
  expect(membersPassing({ p: [5, 2], c: [] }, "makes", { kinds: ["triggered"] })).toBeNull();
});

test("the members no ability describes are named apart, not judged", () => {
  const m = { p: [5, 2, 9], c: [], pf: [[bolt], [], []], cf: [] };
  expect(unjudgedMembers(m, "makes")).toEqual([2, 9]);
  expect(unjudgedMembers({ p: [5], c: [] }, "makes")).toEqual([]);
});

const q0: EventQuery = { produce: [], consume: [], colours: [], types: [], subtypes: [], keywords: [], cardColours: [] };
const once = packFact({ kind: "triggered", repeats: "once", amount: { kind: "fixed", value: 1 } });

/** THE PAGE COUNT IS "LEFT OUT UNJUDGED", NOT "UNJUDGED ANYWHERE" (review of #1339). */
describe("unjudgedLeftOut", () => {
  const lists = new Map([
    ["a", { p: [1, 2, 3, 4], c: [], pf: [[ping], [], [once, UNJUDGED_FACT], [bolt]], cf: [] }],
    ["b", { p: [1, 2, 3], c: [], pf: [[ping], [ping], [ping]], cf: [] }],
  ]);
  const and = (key: string): EventTerm => ({ key, side: "makes", op: "and" });

  test("an empty filter (amtvar alone) leaves nothing out", () => {
    expect(unjudgedLeftOut([and("a")], lists, { ...q0, produce: ["a"], amountVariable: true })).toEqual([]);
  });

  test("counts the members the filter dropped unjudged, not the ones it judged short or kept", () => {
    const q = { ...q0, produce: ["a"], repeatsMin: "repeatable" as const };
    expect(unjudgedLeftOut([and("a")], lists, q).sort()).toEqual([2, 3]);
  });

  test("an AND with another term leaves out only cards the other term still wants", () => {
    const q = { ...q0, produce: ["a", "b"], repeatsMin: "repeatable" as const };
    // 4 is not on b, so it was never in the answer; 2 and 3 are on both.
    expect(unjudgedLeftOut([and("a"), and("b")], lists, q).sort()).toEqual([2, 3]);
    const only = new Map(lists).set("b", { p: [1], c: [], pf: [[ping]], cf: [] });
    expect(unjudgedLeftOut([and("a"), and("b")], only, q)).toEqual([]);
  });

  test("a not term never narrows, and a card it removes is not counted", () => {
    const notC: EventTerm = { key: "c", side: "makes", op: "not" };
    const withC = new Map(lists).set("c", { p: [2], c: [], pf: [[ping]], cf: [] });
    const q = { ...q0, produce: ["a"], notProduce: ["c"], repeatsMin: "repeatable" as const };
    expect(unjudgedLeftOut([and("a"), notC], withC, q)).toEqual([3]);
  });

  test("a card an ability decisively failed on is not unjudged", () => {
    const q = { ...q0, produce: ["a"], abilityKinds: ["spell" as const] };
    // 1 (triggered ping) and 4 (bolt is a spell, passes) -- 1 failed on its kind; 2 and 3 are unjudged.
    expect(unjudgedLeftOut([and("a")], lists, q).sort()).toEqual([2, 3]);
  });

  test("a shard that cannot answer counts nothing", () => {
    expect(unjudgedLeftOut([and("a")], new Map([["a", { p: [1], c: [] }]]), { ...q0, produce: ["a"], repeatsMin: "once" })).toEqual([]);
  });
});
