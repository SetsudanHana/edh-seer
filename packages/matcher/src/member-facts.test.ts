import { expect, test } from "vitest";
import type { CardTags } from "@edh-seer/tagger";
import { ABILITY_KINDS, REPEATS_LADDER, UNJUDGED_FACT, factAmountOf, factKindOf, isUnjudgedFact, memberPasses, memberUndecided, packFact, unjudged, unpackFact, type MemberFact } from "./member-facts.js";

type Ability = CardTags["abilities"][number];
const ab = (x: Partial<Ability>): Ability => ({ kind: "triggered", effect: { kind: "damage" }, ...x }) as Ability;

test("a fact survives packing, every field", () => {
  const facts: MemberFact[] = [
    { kind: "triggered", repeats: "repeatable", amount: { kind: "fixed", value: 1 } },
    { kind: "replacement", repeats: "continuous", amount: { kind: "unstated" } },
    { kind: "spell", repeats: "once", amount: { kind: "variable" } },
    { kind: "activated", repeats: undefined, amount: { kind: "fixed", value: 1000 } },
    { kind: "static", repeats: "per-turn", amount: { kind: "fixed", value: 0 } },
    { kind: "replacement", repeats: "continuous", amount: { kind: "plus", value: 2 } },
    { kind: "replacement", repeats: "continuous", amount: { kind: "times", value: 3 } },
  ];
  for (const f of facts) expect(unpackFact(packFact(f))).toEqual(f);
});

test("a replacement is its own kind, and on-cast is the spell's effect", () => {
  expect(factKindOf(ab({ kind: "static", replacement: true }))).toBe("replacement");
  expect(factKindOf(ab({ kind: "static" }))).toBe("static");
  expect(factKindOf(ab({ kind: "on-cast" }))).toBe("spell");
  expect(factKindOf(ab({ kind: "activated" }))).toBe("activated");
});

test("an amount is fixed only when the card prints a number", () => {
  expect(factAmountOf("1")).toEqual({ kind: "fixed", value: 1 });
  expect(factAmountOf("1,000")).toEqual({ kind: "fixed", value: 1000 });
  expect(factAmountOf("X")).toEqual({ kind: "variable" });
  expect(factAmountOf("that much")).toEqual({ kind: "variable" });
  // UNSTATED IS NOT ONE (`Ability.amount`).
  expect(factAmountOf(undefined)).toEqual({ kind: "unstated" });
});

/** THE OWNER'S QUERY: noncombat pingers for exactly 1 that fire more than once. */
test("exactly 1, at least once a round, keeps the pinger and drops the burn spell and the X", () => {
  const ping = packFact({ kind: "triggered", repeats: "repeatable", amount: { kind: "fixed", value: 1 } });
  const bolt = packFact({ kind: "spell", repeats: "once", amount: { kind: "fixed", value: 1 } });
  const xPing = packFact({ kind: "triggered", repeats: "repeatable", amount: { kind: "variable" } });
  const two = packFact({ kind: "triggered", repeats: "repeatable", amount: { kind: "fixed", value: 2 } });
  const q = { amountMin: 1, amountMax: 1, minRepeats: "per-cycle" as const };
  expect(memberPasses([ping], q)).toBe(true);
  expect(memberPasses([bolt], q)).toBe(false);
  expect(memberPasses([xPing], q)).toBe(false);
  expect(memberPasses([xPing], { ...q, includeVariable: true })).toBe(true);
  expect(memberPasses([two], q)).toBe(false);
  expect(memberPasses([two], { amountMin: 2 })).toBe(true);
});

/** ONE ABILITY MUST PASS THE WHOLE FILTER: a 3-damage tap ability beside a once-only 1-damage ETB
 *  is not a repeatable 1-damage pinger. */
test("the filter is met by one ability, not pieced together from two", () => {
  const etbOne = packFact({ kind: "triggered", repeats: "once", amount: { kind: "fixed", value: 1 } });
  const tapThree = packFact({ kind: "activated", repeats: "per-cycle", amount: { kind: "fixed", value: 3 } });
  expect(memberPasses([etbOne, tapThree], { amountMin: 1, amountMax: 1, minRepeats: "per-cycle" })).toBe(false);
});

test("a member with no facts passes only an empty filter", () => {
  expect(memberPasses([], {})).toBe(true);
  expect(memberPasses(undefined, {})).toBe(true);
  expect(memberPasses([], { kinds: ["triggered"] })).toBe(false);
});

test("an unlabelled repeats fails a minimum above the bottom rung, and a static always clears one", () => {
  const unknown = packFact({ kind: "triggered", repeats: undefined, amount: { kind: "unstated" } });
  const anthem = packFact({ kind: "static", repeats: "continuous", amount: { kind: "unstated" } });
  expect(memberPasses([unknown], { minRepeats: "per-turn" })).toBe(false);
  expect(memberPasses([anthem], { minRepeats: "repeatable" })).toBe(true);
});

/** A REPLACEMENT'S CHANGE IS READ BY THE SAME SIZE FILTER (owner, 2026-10-24: "fix the derive so it
 *  can catch the amount on replacement effects"): Torbran +2, Furnace of Rath x2, Fiery x3. */
test("a change filter tells adding from multiplying, and the range reads its number", () => {
  const torbran = packFact({ kind: "replacement", repeats: "continuous", amount: { kind: "plus", value: 2 } });
  const furnace = packFact({ kind: "replacement", repeats: "continuous", amount: { kind: "times", value: 2 } });
  const fiery = packFact({ kind: "replacement", repeats: "continuous", amount: { kind: "times", value: 3 } });
  const doublers = { changeOp: "times" as const, amountMin: 2, amountMax: 2 };
  expect([torbran, furnace, fiery].map((f) => memberPasses([f], doublers))).toEqual([false, true, false]);
  expect([torbran, furnace, fiery].map((f) => memberPasses([f], { changeOp: "plus" }))).toEqual([true, false, false]);
  expect([torbran, furnace, fiery].map((f) => memberPasses([f], { amountMin: 3 }))).toEqual([false, false, true]);
});

/** AN UNLABELLED ABILITY: "at least once" is any, so the bottom rung keeps it; a higher minimum
 *  cannot be judged, and the page counts it rather than the filter silently dropping it. */
test("an ability with no repeats label passes the bottom rung and cannot be judged above it", () => {
  const unlabelled = packFact({ kind: "triggered", repeats: undefined, amount: { kind: "fixed", value: 1 } });
  expect(memberPasses([unlabelled], { minRepeats: "once" })).toBe(true);
  expect(memberPasses([unlabelled], { minRepeats: "repeatable" })).toBe(false);
  expect(memberUndecided([unlabelled], { minRepeats: "once" })).toBe(false);
  expect(memberUndecided([unlabelled], { minRepeats: "repeatable" })).toBe(true);
  expect(memberUndecided([unlabelled], { kinds: ["triggered"] })).toBe(false);
});

/** A CARD ON A KEY BY WHAT IT IS AND BY AN ABILITY is partly unjudged: the sentinel never passes
 *  and can never be a real packing. */
test("the unjudged marker never passes a filter and collides with no real packing", () => {
  for (const kind of ABILITY_KINDS) for (const repeats of [undefined, ...REPEATS_LADDER]) for (const amount of [
    { kind: "unstated" }, { kind: "variable" }, { kind: "fixed", value: 7 }, { kind: "plus", value: 2 }, { kind: "times", value: 3 },
  ] as const) expect(isUnjudgedFact(packFact({ kind, repeats, amount }))).toBe(false);
  expect(isUnjudgedFact(UNJUDGED_FACT)).toBe(true);
  expect(memberPasses([UNJUDGED_FACT], { kinds: ["static"] })).toBe(false);
  expect(memberPasses([UNJUDGED_FACT], { minRepeats: "once" })).toBe(false);
  const once = packFact({ kind: "triggered", repeats: "once", amount: { kind: "fixed", value: 1 } });
  expect(memberPasses([once, UNJUDGED_FACT], { minRepeats: "repeatable" })).toBe(false);
  expect(memberUndecided([once, UNJUDGED_FACT], { minRepeats: "repeatable" })).toBe(true);
  expect(unjudged([[once, UNJUDGED_FACT], [once], []])).toBe(2);
});

/** UNDECIDED ONLY WHERE THE REPEATS LABEL IS WHAT DECIDES: an unlabelled static against kinds=[triggered]
 *  fails on its kind whatever its repeats are. */
test("an unlabelled ability that fails another criterion is not undecided", () => {
  const staticUnlabelled = packFact({ kind: "static", repeats: undefined, amount: { kind: "unstated" } });
  expect(memberUndecided([staticUnlabelled], { kinds: ["triggered"], minRepeats: "repeatable" })).toBe(false);
  expect(memberUndecided([staticUnlabelled], { kinds: ["static"], minRepeats: "repeatable" })).toBe(true);
});
