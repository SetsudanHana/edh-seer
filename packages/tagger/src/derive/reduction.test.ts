import { expect, test } from "vitest";
import { deriveAbilities } from "./derive.js";
import { reductionOf } from "./reduction.js";

test("the printed mana a reducer takes off, read from the clause", () => {
  expect(reductionOf("Creature spells you cast cost {2} less to cast.", "-2")).toEqual({ mana: "{2}" });
  expect(reductionOf("Creature spells of the chosen type cost {2} less to cast.", undefined)).toEqual({ mana: "{2}" });
  expect(reductionOf("Blue spells you cast cost {U} less to cast.", undefined)).toEqual({ mana: "{U}" });
  expect(reductionOf("This spell costs {U}{U}{U} less to cast if an opponent has drawn four or more cards this turn.", undefined))
    .toEqual({ mana: "{U}{U}{U}", self: true });
});

test("the clause's amount when the text prints no mana symbols", () => {
  expect(reductionOf("", "-1")).toEqual({ mana: "{1}" });
  expect(reductionOf("", "{2} less")).toEqual({ mana: "{2}" });
  expect(reductionOf("", "-X, where X is your speed")).toEqual({ mana: "{X}" });
  expect(reductionOf("", undefined)).toBeUndefined();
});

test("a reduction of this spell or this ability discounts only the card itself", () => {
  expect(reductionOf("This spell costs {X} less to cast, where X is the total power of creatures you control.", undefined))
    .toEqual({ mana: "{X}", self: true });
  expect(reductionOf("This ability costs {1} less to activate for each Equipment you control.", undefined))
    .toEqual({ mana: "{1}", self: true });
  // A class is not self, even when the card is one of the class.
  expect(reductionOf("Artifact spells you cast cost {1} less to cast.", "-1")).toEqual({ mana: "{1}" });
});

test("derive stamps it on cost-reduction abilities only (#804)", () => {
  const incubator = deriveAbilities([{ id: 2, abilityType: "static", actions: [{ verb: "cost-modify", object: "creature spells of the chosen type cost {2} less to cast" }] }],
    "Urza's Incubator", { 2: "Creature spells of the chosen type cost {2} less to cast." }).abilities[0]!;
  expect(incubator.effect.kind).toBe("cost-reduction");
  expect(incubator.reduces).toEqual({ mana: "{2}" });
  const bonePicker = deriveAbilities([{ id: 1, abilityType: "static", actions: [{ verb: "cost-modify", object: "this spell costs {3} less to cast" }] }],
    "Bone Picker", { 1: "This spell costs {3} less to cast if a creature died this turn." }).abilities[0]!;
  expect(bonePicker.reduces).toEqual({ mana: "{3}", self: true });
  const draw = deriveAbilities([{ id: 1, abilityType: "spell", actions: [{ verb: "draw", object: "card", amount: "2" }] }],
    "Divination", { 1: "Draw two cards." }).abilities[0]!;
  expect(draw.reduces).toBeUndefined();
});
