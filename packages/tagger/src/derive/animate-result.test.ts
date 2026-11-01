import { expect, test } from "vitest";
import { animateResult } from "./animate-result.js";

/** `Effect.becomes` is read off the printed clause (#1364). Real oracle text (Mongo `cards`). */
const pt = (p: number, t: number) => [{ metric: "power", op: "eq", value: p }, { metric: "toughness", op: "eq", value: t }];

test("a target animate's result: type, subtype, P/T (Brave the Wilds, Mutavault)", () => {
  expect(animateResult("If this spell was bargained, target land you control becomes a 3/3 Elemental creature with haste that's still a land.")).toMatchObject({ type: "creature", subtype: "elemental", stats: pt(3, 3) });
  expect(animateResult("{1}: This land becomes a 2/2 creature with all creature types until end of turn. It's still a land.")).toMatchObject({ type: "creature", stats: pt(2, 2) });
});

test("a static's \"is\" / \"are\" states a result, a plural is not a class of the deck (Living Plane, Ichthyomorphosis)", () => {
  const r = animateResult("All lands are 1/1 creatures that are still lands.");
  expect(r).toMatchObject({ type: "creature", stats: pt(1, 1) });
  expect(r?.scope).toBeUndefined();
  expect(animateResult("Enchanted creature loses all abilities and is a blue Fish with base power and toughness 0/1.")).toMatchObject({ subtype: "fish", colors: ["U"], stats: pt(0, 1) });
});

test("a CONDITION ahead of the result is not it (Siege Modification, Gideon Blackblade)", () => {
  expect(animateResult("As long as enchanted permanent is a Vehicle, it's a creature in addition to its other types.")).toEqual({ control: "any", token: null, type: "creature" });
  expect(animateResult("During your turn, Gideon Blackblade is a 4/4 Human Soldier creature with indestructible that's still a planeswalker.")).toMatchObject({ subtype: ["human", "soldier"], stats: pt(4, 4) });
});

test("a list of types is all of them (Lush Growth)", () => {
  expect(animateResult("Enchanted land is a Mountain, Forest, and Plains.")).toMatchObject({ subtype: ["mountain", "forest", "plains"] });
});

test("no result that reads: a choice, a colour alone, a copy", () => {
  expect(animateResult("As this creature enters, it becomes your choice of a 3/3 artifact creature, a 2/2 artifact creature with flying, or a 1/6 Wall artifact creature with defender in addition to its other types.")).toBeUndefined();
  expect(animateResult("Target creature becomes blue until end of turn.")).toBeUndefined();
  expect(animateResult("Target creature becomes a copy of target artifact.")).toBeUndefined();
});

test("a condition inside another sentence of the clause is not the result (Summoner's Egg, Hauntwoods Shrieker)", () => {
  expect(animateResult("When this creature dies, turn the exiled card face up. If it's a creature card, put it onto the battlefield under your control.")).toBeUndefined();
  expect(animateResult("Turn target creature face down. It's a 2/2 Cyberman artifact creature.")).toMatchObject({ subtype: "cyberman", stats: pt(2, 2) });
});
