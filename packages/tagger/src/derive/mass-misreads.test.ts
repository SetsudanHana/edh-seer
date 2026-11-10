import { describe, expect, test } from "vitest";
import { deriveRow } from "../derive-worker.js";
import fixtures from "./mass-misreads.fixtures.json" with { type: "json" };

/** #1549 -- DERIVE MISREADS THAT MAKE THE `boardWipe.text` RULE MISS A REAL WIPE OR CLAIM A NON-WIPE.
 *  Card documents and stored `cardClauses.canonical` dumped from Mongo (DERIVE 465 tree, 2026-11-06): `mass-misreads.fixtures.json`. */
const rowOf = (name: string) => {
  const f = (fixtures as Record<string, { source: Record<string, unknown>; canonical: unknown[] }>)[name]!;
  return deriveRow({ doc: { oracleId: name, name, canonical: f.canonical } as never, source: f.source, isToken: false });
};
const emits = (name: string, verb: string) => rowOf(name).tags.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === verb);
const shape = (name: string, verb: string) => emits(name, verb).map((e) => [e.subject.control, e.subject.scope, e.subject.type]);

describe('"of your choice" is the CHOICE that is yours, not the creatures', () => {
  test.each([
    ["Extinction", "dies", "creature"],
    ["Root Greevil", "dies", "enchantment"],
    ["Witch's Vengeance", "dies", "creature"],
    ["Space Beleren", "dies", "creature"],
  ])("%s: the %s emit is control any", (name, verb, type) => {
    const wipe = emits(name, verb).filter((e) => e.subject.type === type && e.subject.scope === "all" && e.subject.self !== true);
    expect(wipe.length).toBeGreaterThan(0);
    expect(wipe.map((e) => e.subject.control)).toEqual(wipe.map(() => "any"));
  });
  test("Wash Out: the bounce of every permanent of the colour is control any", () => {
    expect(emits("Wash Out", "leaves").map((e) => [e.subject.control, e.subject.scope])).toEqual([["any", "all"]]);
  });
});

describe("a count of YOUR cards is not who controls the creatures", () => {
  test("Nightmare Unmaking: `each creature with power greater than the number of cards in your hand` is control any", () => {
    const ex = emits("Nightmare Unmaking", "exiled");
    expect(ex.map((e) => [e.subject.control, e.subject.scope])).toEqual([["any", "each"], ["any", "each"]]);
  });
});

describe("a sacrifice of one creature other than the card is not a class", () => {
  test("Xathrid Demon: the sacrificed creature has no scope", () => {
    for (const verb of ["sacrifice", "dies"]) expect(emits("Xathrid Demon", verb).map((e) => e.subject.scope)).toEqual([undefined]);
  });
  test("Demonic Taskmaster: the same", () => {
    expect(emits("Demonic Taskmaster", "dies").map((e) => e.subject.scope)).toEqual([undefined]);
  });
  test("CONTROL: `destroy all creatures other than this creature` (Magister of Worth) stays a mass", () => {
    expect(emits("Magister of Worth", "dies").map((e) => [e.subject.control, e.subject.scope])).toContainEqual(["any", "all"]);
  });
});

describe("`one of those Dragons` is one of an antecedent's set", () => {
  test("Zurgo and Ojutai: the return to hand has no scope", () => {
    expect(emits("Zurgo and Ojutai", "leaves").map((e) => e.subject.scope)).toEqual([undefined]);
  });
});

describe("`each of the chosen creatures` is a set the card picked, not the class", () => {
  test("Mega Flare: the damage is not scope each", () => {
    expect(emits("Mega Flare", "non-combat-damage").map((e) => e.subject.scope)).not.toContain("each");
  });
});

describe("the dealer's sentence is not the recipient", () => {
  test("Missy: the pinged recipient is the opponent, not each of the opponent's artifact creatures", () => {
    const dmg = emits("Missy", "non-combat-damage");
    expect(dmg).toHaveLength(1);
    expect([dmg[0]!.subject.type, dmg[0]!.subject.scope]).toEqual([undefined, undefined]);
    expect(dmg[0]!.subject.control).toBe("opp");
  });
});

describe("a comparison with a target's stat does not make the mass one target", () => {
  test("Fell the Mighty: the destroy is a mass of creatures, not scope target", () => {
    expect(shape("Fell the Mighty", "dies")).toEqual([["any", "all", "creature"]]);
  });
});

describe('"except for" lists the spared, not the class', () => {
  test("Elspeth Tirel: the -5 destroys nonland permanents, and it spares tokens (nontoken, #1579 part 3; lands spared, #1582)", () => {
    const d = emits("Elspeth Tirel", "dies");
    expect(d.map((e) => [e.subject.notType, e.subject.token, e.subject.scope])).toEqual([[["land"], false, "all"]]);
    expect([d[0]!.subject.type].flat()).not.toContain("land");
  });
  test("Scourglass: destroys the permanents that are neither artifacts nor lands (#1582)", () => {
    const d = emits("Scourglass", "dies").filter((e) => e.subject.self !== true);
    expect(d.map((e) => [e.subject.notType, e.subject.scope])).toEqual([[["artifact", "land"], "all"]]);
    expect([d[0]!.subject.type].flat().sort()).toEqual(["battle", "creature", "enchantment", "planeswalker"]);
  });
  test("CONTROL: Wrath of God stays a mass of creatures", () => {
    expect(shape("Wrath of God", "dies")).toEqual([["any", "all", "creature"]]);
  });
});

describe("a `cast` stored with a mass object is the condition, not a cast", () => {
  test.each(["Cyclone Summoner", "Sunderflock"])("%s: the bounce stays, no cast emit", (name) => {
    expect(emits(name, "cast")).toEqual([]);
    expect(emits(name, "leaves").length).toBeGreaterThan(0);
  });
  test("Cyclone Summoner: the bounce spares lands (notType) and Giants and Wizards (notSubtype), #1582", () => {
    const b = emits("Cyclone Summoner", "leaves");
    expect(b.map((e) => [e.subject.notType, e.subject.notSubtype])).toEqual([[["land"], ["giant", "wizard"]]]);
    expect([b[0]!.subject.type].flat()).not.toContain("land");
  });
});

describe('"of your choice" on a non-permanent choice keeps its `you` (review of #1549)', () => {
  test("Boneyard Parley: the cards put onto the battlefield under your control are `you`", () => {
    expect(emits("Boneyard Parley", "enters").map((e) => e.subject.control)).toEqual(["you"]);
  });
  test("Nyx Lotus: the mana is yours", () => {
    const a = rowOf("Nyx Lotus").tags.abilities.find((x) => x.effect.kind === "mana-generation")!;
    expect(a.effect.subject?.control).toBe("you");
  });
});
