import { expect, test } from "vitest";
import type { Ability } from "../schema.js";
import { deriveDiff, lostAmountOrCount, lostClaims, lostScaledAmount, lostSubjectFields, lostTriggerFlags, manaDiffers } from "./derive-diff.js";

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
  expect(lostSubjectFields([stored], [grammar, ab({ effect: { kind: "pump" }, amount: "3/6" })])).toEqual(["animate:stats", "animate:subtype", "animate:type"]);
  // The grammar carrying the same fields, or the stored side being bare, loses nothing.
  expect(lostSubjectFields([stored], [stored])).toEqual([]);
  expect(lostSubjectFields([grammar], [stored])).toEqual([]);
  expect(lostSubjectFields([ab({})], [grammar])).toEqual([]);
  // Another clause's animate does not stand in: the clause has an animate of its own to compare, or none.
  expect(lostSubjectFields([stored], [{ ...stored, clause: 2 } as Ability])).toEqual([]);
  expect(lostSubjectFields([stored], [grammar, { ...stored, clause: 2 } as Ability])).toEqual(["animate:stats", "animate:subtype", "animate:type"]);
});

// Simic Keyrune / Ebony Fly: the grammar split the animate into a pump and a keyword-grant, so its clause holds NO animate. That is `lostClaims`' kind loss; comparing the stored animate's fields
// against an empty set flagged a field loss as well (#1352).
test("a clause where the grammar has no effect of the stored kind is not a lost field", () => {
  const stored = ab({ effect: { kind: "animate", subject: { control: "any", token: null, type: ["creature", "artifact"], subtype: "crab", keyword: ["hexproof"] } } as never });
  const split = [ab({ effect: { kind: "pump" } as never, amount: "2/3" }), ab({ effect: { kind: "keyword-grant", subject: { control: "any", token: null } } as never })];
  expect(lostSubjectFields([stored], split)).toEqual([]);
  expect(lostClaims([stored], split)).toEqual(["kind:animate"]);
});

// Goddric, Cloaked Reveler: "is a Dragon with base power and toughness 4/4, flying, and ...". The stored keyword-grant carries subtype dragon; the grammar's keyword-grant in that clause does not.
test("a lost field on ANY effect kind is refused, paired by clause and kind, not by position (#1352)", () => {
  const grant = (subject: Record<string, unknown> | undefined, clause = 2) => ab({ clause, effect: { kind: "keyword-grant", ...(subject ? { subject } : {}) } as never });
  const stored = grant({ control: "any", token: null, subtype: "dragon", scope: "all" });
  expect(lostSubjectFields([stored], [grant({ control: "any", token: null })])).toEqual(["keyword-grant:subtype"]);
  // The same subtype on ANOTHER ability of the same kind in that clause stands in, whatever the order.
  expect(lostSubjectFields([stored], [grant(undefined), grant({ control: "any", token: null, subtype: "dragon" })])).toEqual([]);
  expect(lostSubjectFields([grant(undefined), stored], [grant({ control: "any", token: null, subtype: "dragon" }), grant(undefined)])).toEqual([]);
  // A different clause does not stand in.
  expect(lostSubjectFields([stored], [grant({ control: "any", token: null }), grant({ control: "any", token: null, subtype: "dragon" }, 3)])).toEqual(["keyword-grant:subtype"]);
  // A non-animate loss: Hubris' "all Auras attached to it" bounce, whose subtype the grammar drops, and a token's keyword.
  const bounce = (subject: Record<string, unknown>) => ab({ effect: { kind: "bounce", subject } as never });
  expect(lostSubjectFields([bounce({ control: "any", token: null, type: "creature" }), bounce({ control: "any", token: null, subtype: "aura", scope: "all" })], [bounce({ control: "any", token: null, type: "creature" })]))
    .toEqual(["bounce:subtype"]);
  const token = (subject: Record<string, unknown>) => ab({ effect: { kind: "token-generation", subject } as never });
  expect(lostSubjectFields([token({ control: "you", token: true, keyword: ["toxic"] })], [token({ control: "you", token: true })])).toEqual(["token-generation:keyword"]);
  // A field only the grammar carries is a gain.
  expect(lostSubjectFields([bounce({ control: "any", token: null })], [bounce({ control: "any", token: null, type: "creature" })])).toEqual([]);
});

// Opal Guardian: the stored animate's subject stopped at the noun, "permanent"; the grammar's reads the Gargoyle creature.
test("a stored animate's umbrella 'permanent' is met by any type the grammar carries, and only for an animate", () => {
  const animate = (type: unknown) => ab({ effect: { kind: "animate", subject: { control: "any", token: null, ...(type ? { type } : {}) } } as never });
  expect(lostSubjectFields([animate("permanent")], [animate("creature")])).toEqual([]);
  expect(lostSubjectFields([animate("permanent")], [animate(undefined)])).toEqual(["animate:type"]);
  const bounce = (type: string) => ab({ effect: { kind: "bounce", subject: { control: "any", token: null, type } } as never });
  expect(lostSubjectFields([bounce("permanent")], [bounce("creature")])).toEqual(["bounce:type"]);
  // Halcyon Glaze: the stored SELF animate carries the card's own printed noun ("this enchantment"); the grammar's carries what it becomes.
  const self = (type: unknown, isSelf = true) => ab({ effect: { kind: "animate", subject: { control: "any", token: null, ...(type ? { type } : {}), ...(isSelf ? { self: true } : {}) } } as never });
  expect(lostSubjectFields([self("enchantment")], [self("creature")])).toEqual([]);
  // ...but not an animate the grammar leaves without self, or without any type.
  expect(lostSubjectFields([self("enchantment")], [self("creature", false)])).toEqual(["animate:type"]);
  expect(lostSubjectFields([self("enchantment")], [self(undefined)])).toEqual(["animate:type"]);
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

test("any difference in the five mana fields is a difference (#1349 review)", () => {
  const line = { amount: { fixed: 1 } } as never;
  expect(manaDiffers({}, {})).toBe(false);
  expect(manaDiffers({ manaLines: [line] }, { manaLines: [line] })).toBe(false);
  expect(manaDiffers({ manaLines: [line] }, { manaLines: [{ amount: { fixed: 2 } } as never] })).toBe(true);
  expect(manaDiffers({}, { isOneShot: true })).toBe(true);
  expect(manaDiffers({ suspendOnly: true }, {})).toBe(true);
});

// Elvish Branchbender ("becomes an X/X Treefolk, where X is the number of Elves you control") and Chimeric Coils ("{X}{1}: ... an X/X Construct"): the grammar's effect of the same kind is there,
// with the same subject, and no amount; the old labelled groups "amount,count" and "abilities:3->2" let them switch.
test("a grammar effect that drops a stored amount defined by a count is refused, per clause and kind (#1352)", () => {
  const animate = (over: Record<string, unknown>, clause = 1) => ab({ clause, effect: { kind: "animate", subject: { control: "any", token: null } } as never, ...over } as never);
  const branchbender = animate({ amount: "the number of Elves you control", count: { floor: 0, ceiling: null, scalesWith: { control: "you", token: null, subtype: "elf", scope: "all" } } });
  const coils = animate({ amount: "X/X", count: { floor: 0, ceiling: null, scalesWith: "mana" } });
  expect(lostScaledAmount([branchbender], [animate({})])).toEqual(["animate"]);
  expect(lostScaledAmount([coils], [animate({})])).toEqual(["animate"]);
  // The same scaling kept, in any grammar effect of that kind in that clause; or a clause where the grammar has no effect of the kind (lostClaims's), or no stored scaling: nothing lost.
  expect(lostScaledAmount([coils], [animate({}), animate({ count: { floor: 0, ceiling: null, scalesWith: "mana" } })])).toEqual([]);
  // Two scalings that are both objects are not compared; "mana" in the grammar against a stored object is a loss.
  const objectScaling = (extra: Record<string, unknown>) => animate({ amount: "X", count: { floor: 0, ceiling: null, scalesWith: { control: "you", token: null, type: "creature", ...extra } } });
  expect(lostScaledAmount([objectScaling({})], [objectScaling({ keyword: ["flying"] })])).toEqual([]);
  expect(lostScaledAmount([objectScaling({})], [coils])).toEqual(["animate"]);
  expect(lostScaledAmount([coils], [ab({ effect: { kind: "pump" } as never })])).toEqual([]);
  expect(lostScaledAmount([coils], [animate({}, 2)])).toEqual([]);
  expect(lostScaledAmount([animate({ amount: "2" })], [animate({})])).toEqual([]);
  expect(lostScaledAmount([animate({})], [coils])).toEqual([]);
});

// Goddric, Cloaked Reveler: the stored keyword-grant's subject {subtype dragon, scope all} is the quoted "{R}: Dragons you control get +1/+0" read as the recipient; the grant is the card's own,
// and derive keeps no subject for it. A grammar effect with no subject holds nothing to compare; one that carries a subject is still compared (Hubris' bounce).
test("a grammar effect with no subject at all is not a lost field (Goddric); one with a subject is (Hubris)", () => {
  const grant = (subject?: Record<string, unknown>) => ab({ clause: 2, effect: { kind: "keyword-grant", ...(subject ? { subject } : {}) } as never });
  const storedGoddric = grant({ control: "you", token: null, subtype: "dragon", scope: "all", abilityKind: ["activated"] });
  expect(lostSubjectFields([storedGoddric], [grant()])).toEqual([]);
  expect(lostSubjectFields([storedGoddric], [grant({ control: "you", token: null })])).toEqual(["keyword-grant:subtype"]);
  const bounce = (subject: Record<string, unknown>) => ab({ effect: { kind: "bounce", subject } as never });
  expect(lostSubjectFields([bounce({ control: "any", token: null, subtype: "aura", scope: "all" })], [bounce({ control: "any", token: null, type: "creature" })])).toEqual(["bounce:subtype"]);
});

test("a gate moves the group key only when the gates DIFFER, never because the pairing crossed two gated abilities (#1357 part 2: Traveling Botanist and five more un-switched)", () => {
  const g1 = { kind: "unknown", text: "it's a land card" } as never, g2 = { kind: "unknown", text: "you don't put the card into your hand" } as never, g3 = { kind: "unknown", text: "other" } as never;
  // the sort pairs a(g1) with b(g2) and c(g2) with d(g1): the gates are the same SET on both sides
  expect(deriveDiff([ab({ effect: { kind: "a" }, gate: g1 }), ab({ effect: { kind: "c" }, gate: g2 })], [ab({ effect: { kind: "d" }, gate: g1 }), ab({ effect: { kind: "b" }, gate: g2 })])).toBe("effect.kind");
  // a real difference in the gates is still a difference (a switch must not change what a card is gated on)
  expect(deriveDiff([ab({ gate: g1 })], [ab({ gate: g3 })])).toBe("gate");
  expect(deriveDiff([ab({ gate: g1 })], [ab({})])).toBe("gate");
  expect(deriveDiff([ab({ conditionCares: ["counter-added:any"] })], [ab({})])).toBe("conditionCares");
});

test("a gate that moved to ANOTHER ability of the same clause is a difference (draw(g1) mill(g2) against draw(g2) mill(g1))", () => {
  const g1 = { kind: "unknown", text: "it's a land card" } as never, g2 = { kind: "unknown", text: "other" } as never;
  const draw = { effect: { kind: "draw-card" } }, mill = { effect: { kind: "mill" } };
  expect(deriveDiff([ab({ ...draw, gate: g1 }), ab({ ...mill, gate: g2 })], [ab({ ...draw, gate: g2 }), ab({ ...mill, gate: g1 })])).toBe("gate");
  // ...while the same gates on the same kinds, in another order, are none
  expect(deriveDiff([ab({ ...draw, gate: g1 }), ab({ ...mill, gate: g2 })], [ab({ ...mill, gate: g2 }), ab({ ...draw, gate: g1 })])).toBeNull();
});

// #1373 review: the switch took the grammar reading of Dusk Urchins (its counter placement loses `amount: "1"`) and of Freelance Muscle (loses `count`).
test("an amount or count the stored ability carries and the grammar's same ability lacks is a loss; a spelling difference is not", () => {
  const trig = { verbs: ["blocks"], subject: { control: "you", token: null, self: true } } as never;
  const stored = ab({ kind: "triggered", trigger: trig, effect: { kind: "counter-placement" }, amount: "1" });
  expect(lostAmountOrCount([stored], [ab({ kind: "triggered", trigger: trig, effect: { kind: "counter-placement" } })])).toBe(true);
  // Freelance Muscle: both carry an amount, the grammar's has no `count`.
  const scaled = ab({ kind: "triggered", trigger: trig, effect: { kind: "pump" }, amount: "+X/+X, where X is Y", count: { floor: 0, ceiling: null, scalesWith: "mana" } as never });
  expect(lostAmountOrCount([scaled], [ab({ kind: "triggered", trigger: trig, effect: { kind: "pump" }, amount: "Y" })])).toBe(true);
  // Doran: the same ability, the amount spelled without the comma.
  const doran = ab({ kind: "triggered", trigger: trig, effect: { kind: "pump" }, amount: "+X/+X, where X is Y" });
  expect(lostAmountOrCount([doran], [{ ...doran, amount: "+X/+X where X is Y" }])).toBe(false);
  // A gain, another clause's ability, or no counterpart at all (lostClaims' business) are not this loss.
  expect(lostAmountOrCount([ab({ kind: "triggered", trigger: trig, effect: { kind: "counter-placement" } })], [stored])).toBe(false);
  expect(lostAmountOrCount([stored], [{ ...stored, amount: undefined, clause: 2 } as Ability])).toBe(false);
});
