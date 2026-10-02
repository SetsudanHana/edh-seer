import { expect, test } from "vitest";
import type { Ability } from "@edh-seer/tagger";
import { deriveDiff } from "./grammar-only-core.js";

const ab = (over: Partial<Ability>): Ability => ({ kind: "static", effect: { kind: "" }, clause: 1, ...over } as Ability);

test("the same abilities in any order are no difference", () => {
  const x = ab({ amount: "1" }), y = ab({ amount: "2" });
  expect(deriveDiff([x, y], [y, x])).toBeNull();
});

test("a difference is keyed on the fields that differ, one level into effect and trigger", () => {
  expect(deriveDiff([ab({ effect: { kind: "search" }, amount: "1" })], [ab({ effect: { kind: "" }, amount: "1" })])).toBe("effect.kind");
  expect(deriveDiff([ab({ amount: "1" })], [ab({})])).toBe("amount");
  expect(deriveDiff([ab({}), ab({ amount: "1" })], [ab({})])).toBe("abilities:2->1");
});
