import { expect, test } from "vitest";
import { packFact } from "@edh-seer/matcher/member-facts";
import { membersPassing } from "./effect-filter.js";

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
