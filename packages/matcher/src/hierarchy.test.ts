import { expect, test } from "vitest";
import { buildHierarchy, impliesType, expandTypes, PSEUDO_TYPE_SETS, ALL_CARD_TYPES } from "./hierarchy.js";
import { CARD_TYPES, UMBRELLA_TYPES } from "@mtg/tagger";

test("buildHierarchy maps each subtype after the dash to its card types", () => {
  const h = buildHierarchy([
    "Legendary Creature — Human Wizard",
    "Artifact — Treasure",
    "Enchantment — Aura",
    "Basic Land — Mountain",
  ]);
  expect(h.wizard).toContain("creature");
  expect(h.human).toContain("creature");
  expect(h.treasure).toContain("artifact");
  expect(h.aura).toContain("enchantment");
  expect(h.mountain).toContain("land");
});

test("impliesType is true only for a real subtype→type pair", () => {
  const h = { wizard: ["creature"], treasure: ["artifact"] };
  expect(impliesType(h, "wizard", "creature")).toBe(true);
  expect(impliesType(h, "Wizard", "Creature")).toBe(true); // case-insensitive
  expect(impliesType(h, "wizard", "artifact")).toBe(false);
  expect(impliesType(h, "unknownsub", "creature")).toBe(false);
});

test("expandTypes: a concrete type expands to itself", () => {
  expect([...expandTypes(["instant"], [], {})]).toEqual(["instant"]);
});

test("expandTypes: permanent and spell umbrellas expand to their member card types", () => {
  expect(expandTypes(["permanent"], [], {}).has("creature")).toBe(true);
  expect(expandTypes(["permanent"], [], {}).has("instant")).toBe(false); // instants are not permanents
  expect(expandTypes(["spell"], [], {}).has("instant")).toBe(true);
  expect(expandTypes(["spell"], [], {}).has("land")).toBe(false); // lands are not cast
});

test("expandTypes: negations expand to every card type except the negated one", () => {
  const nc = expandTypes(["noncreature"], [], {});
  expect(nc.has("creature")).toBe(false);
  expect(nc.has("instant")).toBe(true);
  const nl = expandTypes(["nonland"], [], {});
  expect(nl.has("land")).toBe(false);
  expect(nl.has("creature")).toBe(true);
});

test("expandTypes: a subtype contributes its implied card types via the hierarchy", () => {
  const h = { wizard: ["creature"] };
  expect(expandTypes([], ["wizard"], h).has("creature")).toBe(true);
});

test("expandTypes: a STATED type list is authoritative — subtypes do not widen it", () => {
  // A subtype implication is a fact about the OTHER cards that share the subtype, not about this
  // one. Theros printed "Enchantment Creature — Human Warrior", so the real corpus records
  // human -> [creature, enchantment]; Setessan Champion is a plain "Creature — Human Warrior" and
  // must not satisfy a filter demanding an enchantment. Same shape sent Metalwork Colossus
  // ("Artifact Creature — Construct") into a LAND filter, because some card is a Land — Construct.
  const h = { human: ["creature", "enchantment"], construct: ["artifact", "creature", "land"] };
  const champion = expandTypes(["creature"], ["human"], h);
  expect(champion.has("creature")).toBe(true);
  expect(champion.has("enchantment")).toBe(false);
  expect(expandTypes(["artifact", "creature"], ["construct"], h).has("land")).toBe(false);
});

test("expandTypes: subtypes still carry a subject whose type tokens expand to nothing", () => {
  // "wizard" with no type stated, and an unrecognised token that contributes no card type — both
  // leave the subtype as the only signal there is, and dropping it would delete real edges.
  const h = { wizard: ["creature"] };
  expect(expandTypes([], ["wizard"], h).has("creature")).toBe(true);
  expect(expandTypes(["kindred"], ["wizard"], h).has("creature")).toBe(true);
});

test("expandTypes: an unknown token contributes nothing", () => {
  expect(expandTypes(["banana", "tribal"], [], {}).size).toBe(0);
});

test("PSEUDO_TYPE_SETS covers the four pseudo-types; ALL_CARD_TYPES has eight", () => {
  expect(Object.keys(PSEUDO_TYPE_SETS).sort()).toEqual(["noncreature", "nonland", "permanent", "spell"]);
  expect(ALL_CARD_TYPES.length).toBe(8);
});

test("the card-type sets tagger derives against are the same ones matcher expands", () => {
  // tagger's subject.ts restates these to resolve a negated type ("noncreature spell") into the
  // concrete types it leaves. It cannot import them -- matcher depends on tagger, not the reverse --
  // so this is the guard that stops the copy rotting. If it fails, the two packages disagree about
  // what a card type IS, and every negated subject silently derives against the wrong set.
  expect([...CARD_TYPES]).toEqual([...ALL_CARD_TYPES]);
  expect(UMBRELLA_TYPES.permanent).toEqual(PSEUDO_TYPE_SETS.permanent);
  expect(UMBRELLA_TYPES.spell).toEqual(PSEUDO_TYPE_SETS.spell);
});
