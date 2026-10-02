import { expect, test } from "vitest";
import type { Ability } from "../schema.js";
import { deriveDiff, lostClaims } from "./derive-diff.js";

const ab = (over: Partial<Ability>): Ability => ({ kind: "static", effect: { kind: "" }, clause: 1, ...over } as Ability);

test("the same abilities in any order are no difference", () => {
  const x = ab({ amount: "1" }), y = ab({ amount: "2" });
  expect(deriveDiff([x, y], [y, x])).toBeNull();
  // ...nor the same subject built with its keys in another order.
  expect(deriveDiff([ab({ effect: { kind: "", subject: { control: "you", token: null, zone: "graveyard" } } })],
    [ab({ effect: { kind: "", subject: { zone: "graveyard", token: null, control: "you" } } })])).toBeNull();
});

test("a difference is keyed on the fields that differ, one level into effect and trigger", () => {
  expect(deriveDiff([ab({ effect: { kind: "search" }, amount: "1" })], [ab({ effect: { kind: "" }, amount: "1" })])).toBe("effect.kind");
  // A subject says how it moved: the grammar added a type and changed the controller.
  expect(deriveDiff([ab({ effect: { kind: "", subject: { control: "any", token: null } } })], [ab({ effect: { kind: "", subject: { control: "you", token: null, type: "creature" } } })]))
    .toBe("effect.subject(~control +type)");
  expect(deriveDiff([ab({ amount: "1" })], [ab({})])).toBe("amount");
  expect(deriveDiff([ab({}), ab({ amount: "1" })], [ab({})])).toBe("abilities:2->1");
});

test("a grammar-only derive that drops a claim the stored one makes says which", () => {
  const recursion = ab({ effect: { kind: "graveyard-recursion" }, emits: [{ verb: "leaves", subject: { control: "you", token: null } }] } as never);
  expect(lostClaims([recursion], [ab({ effect: { kind: "" } })])).toEqual(["emit:leaves", "kind:graveyard-recursion"]);
  expect(lostClaims([ab({})], [recursion])).toEqual([]);
});
