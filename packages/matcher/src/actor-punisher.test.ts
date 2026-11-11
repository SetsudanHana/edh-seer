import { describe, expect, test } from "vitest";
import { pairReasonsAcrossFaces, punishesItsActor } from "./edges.js";
import type { DeckCard, Hierarchy } from "./types.js";
import fixtures from "./actor-punisher.fixtures.json" with { type: "json" };

/** A SYMMETRIC PUNISHER IS NOT A PAYOFF FOR YOUR OWN ACTION (#1591). "Whenever a player gains life, that player loses 2 life for
 *  each 1 life they gained" (False Cure) fires on your lifegain too, and then it is you who loses the life: the pair is formed only
 *  with a producer that makes an opponent, or any player, do the thing. Fixtures are STORED rows (`cardTagsDerived` by `oracleId`
 *  = `cards._id`, DERIVE 493). */
const F = fixtures as unknown as Record<string, DeckCard>;
const H: Hierarchy = {};
/** The reasons the producer forms INTO the punisher's trigger. */
const into = (producer: string, punisher: string) =>
  pairReasonsAcrossFaces(F[producer]!, F[punisher]!, H).filter((r) => r.consumer === F[punisher]!.card.name && r.producer === F[producer]!.card.name);

describe("your own action does not feed a punisher of 'that player'", () => {
  test.each(["Vampire Nighthawk", "Ray of Dissolution", "Alms of the Vein"])("%s (you gain life) -> False Cure: none", (p) => {
    expect(into(p, "False Cure")).toEqual([]);
  });
  test.each(["Lightning Bolt", "Vampire Nighthawk", "Swords to Plowshares"])("%s (your own cheap spell) -> Eidolon of the Great Revel: none", (p) => {
    expect(into(p, "Eidolon of the Great Revel")).toEqual([]);
  });
  test("'they lose 2 life' is the same player (Mai, Scornful Striker)", () => {
    expect(into("Lightning Bolt", "Mai, Scornful Striker")).toEqual([]);
  });
  test("a nonblack spell of yours -> Soot Imp: none", () => {
    expect(into("Lightning Bolt", "Soot Imp")).toEqual([]);
  });
  test("a discard and a sacrifice punish too (Putrefaction, Aether Barrier)", () => {
    expect(into("Llanowar Elves", "Putrefaction")).toEqual([]);
    expect(into("Llanowar Elves", "Aether Barrier")).toEqual([]);
  });
  test.each(["Phyrexian Tyranny", "Spiteful Visions"])("your own draw (Divination) -> %s: none", (c) => {
    expect(into("Divination", c)).toEqual([]);
  });
});

describe("kept: a producer that makes an opponent, or any player, do it", () => {
  test.each(["Swords to Plowshares", "Grove of the Burnwillows", "Healing Salve"])("%s (an opponent or a target player gains life) -> False Cure", (p) => {
    expect(into(p, "False Cure").map((r) => r.tag)).toContain("gain-life:any");
  });
  test("Knowledge Pool (every player casts from it) -> Eidolon of the Great Revel", () => {
    expect(into("Knowledge Pool", "Eidolon of the Great Revel").length).toBeGreaterThan(0);
  });
  test.each(["Prosperity", "Howling Mine"])("%s (each player draws) -> Phyrexian Tyranny", (p) => {
    expect(into(p, "Phyrexian Tyranny").length).toBeGreaterThan(0);
  });
});

describe("not a punisher", () => {
  test("a benefit to that player keeps your own casts (Tangleroot: 'that player adds {G}')", () => {
    expect(into("Llanowar Elves", "Tangleroot").length).toBeGreaterThan(0);
  });
  const punishes = (card: string, verb: string, i = 0) => punishesItsActor(F[card]!.tags!.abilities[i]!, verb, F[card]!.card.oracleText);
  test("the predicate, on stored rows", () => {
    expect(punishes("False Cure", "gain-life")).toBe(true);
    expect(punishes("Eidolon of the Great Revel", "cast")).toBe(true);
    expect(punishes("Oppression", "cast")).toBe(true);
    expect(punishes("Aether Barrier", "cast")).toBe(true);
    expect(punishes("Tangleroot", "cast")).toBe(false);
    // "sacrifice THIS enchantment" is the card's own cost, not the caster's loss.
    expect(punishes("Standstill", "cast")).toBe(false);
    // "each of that player's opponents draws three cards" is an opponent's gain.
    expect(punishes("Standstill", "cast", 1)).toBe(false);
    // "Whenever a player casts a spell, sacrifice a creature": YOUR sacrifice whoever cast it, stored `any` because derive could not tell.
    expect(punishes("Desecration Elemental", "cast")).toBe(false);
    // the draw-step half of Spiteful Visions gives a card; the second ability is the punisher.
    expect(punishes("Spiteful Visions", "draw")).toBe(false);
    expect(punishes("Spiteful Visions", "draw", 1)).toBe(true);
  });
});
