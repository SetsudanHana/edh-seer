import { expect, test } from "vitest";
import type { Ability } from "../schema.js";
import { deriveDiff, lostClaims, lostSubjectFields, lostTriggerFlags, manaDiffers } from "./derive-diff.js";

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
  expect(lostSubjectFields([stored], [grant(undefined)])).toEqual(["keyword-grant:subtype"]);
  // The same subtype on ANOTHER ability of the same kind in that clause stands in, whatever the order.
  expect(lostSubjectFields([stored], [grant(undefined), grant({ control: "any", token: null, subtype: "dragon" })])).toEqual([]);
  expect(lostSubjectFields([grant(undefined), stored], [grant({ control: "any", token: null, subtype: "dragon" }), grant(undefined)])).toEqual([]);
  // A different clause does not stand in.
  expect(lostSubjectFields([stored], [grant(undefined), grant({ control: "any", token: null, subtype: "dragon" }, 3)])).toEqual(["keyword-grant:subtype"]);
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
