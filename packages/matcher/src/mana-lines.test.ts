/** The mana-line predicates over a structured line (#1193 review). Synthetic lines are labelled; the real ones come from the derived fixtures in mana-colour-sources.test.ts. */
import { describe, expect, test } from "vitest";
import { isLandfall, isLoyaltyAbility, paidWithResource } from "./mana-lines.js";
import { FREE_TAP, mkLine, triggerLine } from "./mana-test-support.js";
import type { ManaLine } from "@edh-seer/tagger";

describe("isLandfall reads the subject structurally and refuses a qualified land", () => {
  const landfall = (subject: string) => isLandfall(triggerLine("enters", subject, ["G"], 1));
  test("a land you control, and another land you control, are landfall", () => {
    expect(landfall("a land you control")).toBe(true);
    expect(landfall("another land you control")).toBe(true);
  });
  // SYNTHETIC subjects ("Whenever a nonbasic land you control enters, add {C}"): the old regex refused each; parseSubject keeps the qualifier as its own field.
  test.each(["a nonbasic land you control", "a basic land you control", "a tapped land you control", "a land you control with a +1/+1 counter on it", "a land an opponent controls", "this land", "a creature you control"])(
    "%s is not landfall", (subject) => expect(landfall(subject)).toBe(false));
});

describe("a line derived before 312 reads safely (static-out rows built earlier)", () => {
  // A pre-312 cost has no `loyalty` and no `consumes`, and carries a loyalty cost as a string in `other`.
  const pre = (other: string[]): ManaLine => { const { loyalty: _l, consumes: _c, ...old } = FREE_TAP; return mkLine({ cost: { ...old, tap: false, other } as unknown as ManaLine["cost"] }); };
  test("an empty-cost line is no loyalty ability", () => {
    expect(isLoyaltyAbility(pre([]))).toBe(false);
    expect(paidWithResource(pre([]))).toBe(false);
  });
  test("a piece in `other` with no `consumes` reads as consumed, the safe direction", () => {
    expect(paidWithResource(pre(["+1"]))).toBe(true);
    expect(paidWithResource(pre(["Discard a card"]))).toBe(true);
  });
});
