import { describe, expect, test } from "vitest";
import { deriveCardTags, deriveInputOf } from "../index.js";
import type { CardTags, ClauseRecord } from "../index.js";
import fixtures from "./leave-followups.fixtures.json" with { type: "json" };

/** #1575. Source documents and clause records are the corpus's own (cards, cardClauses.canonical, or the grammar's reading for a grammar-sourced row), dumped from Mongo 2026-11-09 (DERIVE 480). */
const F = fixtures as unknown as Record<string, { source: Record<string, unknown>; canonical: ClauseRecord[] }>;
const tagsOf = (name: string) => deriveCardTags(deriveInputOf(F[name]!.source as never, name, name, F[name]!.canonical)) as CardTags;
const emitVerbs = (name: string) => tagsOf(name).abilities.filter((a) => a.trigger === undefined).flatMap((a) => (a.emits ?? []).map((e) => e.verb));

describe("a would-enter replacement derives no leave (part 1)", () => {
  test.each(["Primeval Spawn", "Containment Priest", "Hallowed Moonlight", "Mistcaller"])("%s: the exile instead of entering never leaves the battlefield", (name) => {
    expect(emitVerbs(name)).not.toContain("leaves");
  });
  test("the exile itself is still an exile (CR 406.2)", () => {
    expect(emitVerbs("Primeval Spawn")).toContain("exiled");
    expect(emitVerbs("Containment Priest")).toContain("exiled");
  });
});

describe("a granted ability the stored answer numbers otherwise still names its granter (part 2)", () => {
  test("Elemental Expressionist: the quoted exile trigger is granted by clause 1, the cast and copy triggers are its own", () => {
    const by = tagsOf("Elemental Expressionist").abilities.map((a) => [a.trigger?.verbs[0], a.grantedBy ?? null]);
    expect(by).toEqual([["cast", null], ["copy", null], ["exiled", 1]]);
  });
});

const emitsOf = (name: string, verb: string) => tagsOf(name).abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === verb).map((e) => e.subject);

describe("an exception of the card itself is not a class (part 4)", () => {
  test("Worldslayer: 'all permanents other than this Equipment' destroys every other permanent", () => {
    expect(emitsOf("Worldslayer", "dies")).toEqual([{ control: "any", token: null, type: "permanent", scope: "all", other: true }]);
  });
  test.each([
    ["Oath of Lim-Dûl", "sacrifice", "permanent"],
    ["Blizzard Strix", "exiled", "permanent"],
    ["Magister of Worth", "dies", "creature"],
    ["Sidisi, Regent of the Mire", "sacrifice", "creature"],
  ])("%s: the exception after 'other than' names the card, not a type of the class", (name, verb, type) => {
    const subjects = emitsOf(name, verb).filter((s) => s.scope !== "all" || s.other === true);
    expect(subjects.map((s) => s.type)).toContain(type);
    expect(subjects.some((s) => s.other === true)).toBe(true);
  });
  test("'other than up to two chosen creatures' (Mount Doom) is a chosen set, not the card: it keeps its all-but selection", () => {
    expect(emitsOf("Mount Doom", "dies").map((s) => s.selection)).toContain("all-but");
  });
});

describe("a condition on the target is not its class (part 5)", () => {
  test("Saw: 'a permanent other than that creature or this Equipment' sacrifices a permanent", () => {
    expect(emitsOf("Saw", "sacrifice").map((s) => s.type)).toEqual(["permanent"]);
  });
  test("Mythos of Nethroi: 'target nonland permanent if it's a creature or if {G}{W} was spent' destroys a nonland permanent", () => {
    expect(emitsOf("Mythos of Nethroi", "dies").map((s) => [s.type, s.notType])).toEqual([[["creature", "artifact", "enchantment", "planeswalker", "battle"], ["land"]]]);
  });
  test("Deathbringer Liege: 'target creature if it's tapped' stays a creature", () => {
    expect(emitsOf("Deathbringer Liege", "dies").map((s) => s.type)).toContain("creature");
  });
});

describe("alternatives stay alternatives (part 6)", () => {
  test("Thraben Exorcism: 'target Spirit, creature with disturb, or enchantment' is three alternatives, each with its own filter", () => {
    const [s] = emitsOf("Thraben Exorcism", "exiled");
    expect(s!.anyOf).toEqual([{ subtype: "spirit" }, { type: "creature", keyword: ["disturb"] }, { type: "enchantment" }]);
    expect(s!.type).toBeUndefined();
    expect(s!.subtype).toBeUndefined();
    expect(s!.keyword).toBeUndefined();
    expect(s!.scope).toBe("target");
  });
  test("Ray of Ruin and Spectacular Pileup: a Vehicle alternative is not a subtype of the creature alternative", () => {
    expect(emitsOf("Ray of Ruin", "exiled")[0]!.anyOf).toEqual([{ type: "creature" }, { subtype: "vehicle" }, { type: "land", basic: false }]);
    expect(emitsOf("Spectacular Pileup", "dies")[0]!.anyOf).toEqual([{ type: "creature" }, { subtype: "vehicle" }]);
  });
  test("a counter's kind is no alternative: Aurification's 'gold counter' leaves the creatures a creature class", () => {
    const s = emitsOf("Aurification", "counter-removed")[0]!;
    expect(s.anyOf).toBeUndefined();
    expect(s.type).toBe("creature");
  });
  test("a class word outside the alternatives stays at the top: Minsc & Boo's creature with trample or haste", () => {
    const s = emitsOf("Minsc & Boo, Timeless Heroes", "counter-added")[0]!;
    expect([s.type, s.anyOf]).toEqual(["creature", [{ keyword: ["trample"] }, { keyword: ["haste"] }]]);
  });
});
