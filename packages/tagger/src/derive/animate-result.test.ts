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

test("a condition inside another sentence of the clause is not the result (Hauntwoods Shrieker); a sentence after one still is (Cyber Conversion)", () => {
  expect(animateResult("{1}{G}: Reveal target face-down permanent. If it's a creature card, you may turn it face up.")).toBeUndefined();
  expect(animateResult("Turn target creature face down. It's a 2/2 Cyberman artifact creature.")).toMatchObject({ subtype: "cyberman", stats: pt(2, 2) });
});

test("two colours joined by \"and\" are one result: Atarka Monument, Simic Keyrune, Celestial Colonnade", () => {
  expect(animateResult("{4}{R}{G}: This artifact becomes a 4/4 red and green Dragon artifact creature with flying until end of turn.")).toMatchObject({ type: ["creature", "artifact"], subtype: "dragon", colors: ["R", "G"], stats: pt(4, 4) });
  expect(animateResult("{G}{U}: This artifact becomes a 2/3 green and blue Crab artifact creature with hexproof until end of turn. (It can't be the target of spells or abilities your opponents control.)")).toMatchObject({ type: ["creature", "artifact"], subtype: "crab", colors: ["U", "G"], stats: pt(2, 3) });
  expect(animateResult("{3}{W}{U}: Until end of turn, this land becomes a 4/4 white and blue Elemental creature with flying and vigilance. It's still a land.")).toMatchObject({ type: "creature", subtype: "elemental", colors: ["W", "U"], stats: pt(4, 4) });
});

test("an \"or\" is a choice, not a result: Tundra Kavu", () => {
  expect(animateResult("{T}: Target land becomes a Plains or an Island until end of turn.")).toBeUndefined();
});

test("a result of P/T or colours with no type is none; coordinated noun phrases and a name cut by a comma are none (Life and Limb, Tenth District Hero)", () => {
  expect(animateResult("This creature becomes 4/4 until end of turn.")).toBeUndefined();
  expect(animateResult("All Forests and all Saprolings are 1/1 green Saproling creatures and Forest lands in addition to their other types. (They're affected by summoning sickness.)")).toBeUndefined();
  expect(animateResult("{2}{W}, Collect evidence 4: If this creature is a Detective, it becomes a legendary creature named Mileva, the Stalwart, it has base power and toughness 5/5, and it gains \"Other creatures you control have indestructible.\"")).toBeUndefined();
  expect(animateResult("{1}{W}, Collect evidence 2: This creature becomes a Human Detective with base power and toughness 4/4 and gains vigilance.")).toMatchObject({ subtype: ["human", "detective"], stats: pt(4, 4) });
});

test("whitespace runs and unmatched openers are linear (CodeQL js/polynomial-redos)", () => {
  for (const text of [`Target land becomes a${" ".repeat(100_000)}x`, `Target land becomes a ${"(".repeat(50_000)}`, `Target land becomes a ${"if ".repeat(1_000)}`, `Target land becomes a${" ".repeat(3_000)}creature${" ".repeat(900)}with`]) {
    const t0 = performance.now();
    animateResult(text);
    expect(performance.now() - t0, text.slice(0, 30)).toBeLessThan(50);
  }
});
