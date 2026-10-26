import { expect, test } from "vitest";
import type { Ability } from "../schema.js";
import { deriveDiff, lostAnimateFields, lostClaims, lostTriggerFlags } from "./derive-diff.js";

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

test("claimsNothing is no difference: it must not move a labelled group key (#1253)", () => {
  const ref = { verb: "sacrifice", subject: { control: "you", token: null, type: "creature", ref: "trigger" } };
  const self = { verb: "sacrifice", subject: { control: "you", token: null, type: "creature", self: true } };
  const withFlag = deriveDiff([ab({ emits: [ref], claimsNothing: "refused-trigger" as const } as never)], [ab({ emits: [self] } as never)]);
  const without = deriveDiff([ab({ emits: [ref] } as never)], [ab({ emits: [self] } as never)]);
  expect(withFlag).toBe(without);
  expect(deriveDiff([ab({ claimsNothing: "refused-trigger" as const } as never)], [ab({})])).toBeNull();
});

// Jade Statue: "{2}: This artifact becomes a 3/6 Golem artifact creature until end of combat. Activate only during combat."
test("a grammar animate that drops the stored animate's type, subtype or stats is refused (#1349)", () => {
  const animate = (subject: Record<string, unknown>) => ab({ effect: { kind: "animate", subject } as never, cost: "{2}" });
  const stored = animate({ control: "any", token: null, type: ["creature", "artifact"], allTypes: ["artifact", "creature"], subtype: "golem", stats: [{ metric: "power", op: "eq", value: 3 }, { metric: "toughness", op: "eq", value: 6 }], self: true });
  const grammar = animate({ control: "any", token: null, type: "artifact", self: true });
  expect(lostAnimateFields([stored], [grammar, ab({ effect: { kind: "pump" }, amount: "3/6" })])).toBe(true);
  // The grammar carrying the same fields, or the stored side being bare, loses nothing.
  expect(lostAnimateFields([stored], [stored])).toBe(false);
  expect(lostAnimateFields([grammar], [stored])).toBe(false);
  expect(lostAnimateFields([ab({})], [grammar])).toBe(false);
  // Another clause's animate does not stand in.
  expect(lostAnimateFields([stored], [{ ...stored, clause: 2 } as Ability])).toBe(true);
});

test("a trigger flag the stored ability carries and the grammar's matching trigger lacks is lost: Kate Stewart's 'one or more' batch (#1349)", () => {
  const trig = (extra: Record<string, unknown>, verbs = ["counter-added"]) => ab({ kind: "triggered", trigger: { verbs, subject: { control: "you", token: null }, ...extra } as never });
  const stored = trig({ batched: true });
  expect(lostTriggerFlags([stored], [trig({})])).toBe(true);
  // The flag kept, or the stored side bare, loses nothing; the grammar having no such trigger at all is a loss too (refused, not guessed).
  expect(lostTriggerFlags([stored], [trig({ batched: true })])).toBe(false);
  expect(lostTriggerFlags([trig({})], [trig({ batched: true })])).toBe(false);
  expect(lostTriggerFlags([stored], [trig({}, ["attacks"])])).toBe(true);
  // An event-size bound is a flag too.
  expect(lostTriggerFlags([trig({ amount: { op: "gte", value: 5 } }, ["combat-damage"])], [trig({}, ["combat-damage"])])).toBe(true);
  // One batched trigger of two is not covered by the one the grammar kept.
  expect(lostTriggerFlags([stored, stored], [trig({ batched: true }), trig({})])).toBe(true);
});
