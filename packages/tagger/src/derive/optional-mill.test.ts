import { describe, expect, test } from "vitest";
import { deriveCardTags } from "./derive.js";
import { deriveInputOf } from "../derive-input.js";
import { grammarClauseRecords } from "../grammar/clause-record.js";

// #1662 (owner ruling 2026-11-17, #721: an optional self-mill counts like surveil): a `mill` ability whose action is "you may" carries `optional: true`.
// Oracle texts read from the corpus `cards` collection 2026-11-20.
const viaGrammar = (name: string, typeLine: string, oracleText: string) => {
  const card = { name, typeLine, oracleText, keywords: [] as string[] };
  const g = grammarClauseRecords(card as never);
  return deriveCardTags(deriveInputOf(card as never, "x", name, g.records, undefined, g.readings));
};
const mills = (tags: ReturnType<typeof viaGrammar>) => tags.abilities.filter((a) => a.effect.kind === "mill");

describe("Ability.optional on a mill (#1662)", () => {
  test("'you may mill two cards' is optional", () => {
    const m = mills(viaGrammar("Probe Optional", "Sorcery", "You may mill two cards."));
    expect(m.length).toBeGreaterThan(0);
    for (const a of m) expect(a.optional).toBe(true);
  });
  test("a forced 'mill two cards' carries no marker", () => {
    const m = mills(viaGrammar("Probe Forced", "Sorcery", "Mill two cards."));
    expect(m.length).toBeGreaterThan(0);
    for (const a of m) expect(a.optional).toBeUndefined();
  });
  test("Territory Culler: the put into the graveyard on the 'If you don't' branch is an optional mill", () => {
    const tags = viaGrammar("Territory Culler", "Creature — Eldrazi Drone",
      "Devoid (This card has no color.)\nReach\nLandfall — Whenever a land you control enters, look at the top card of your library. If it's a creature card, you may reveal it and put it into your hand. If you don't put the card into your hand, you may put it into your graveyard.");
    const m = mills(tags);
    expect(m).toHaveLength(1);
    expect(m[0]!.optional).toBe(true);
  });
  test("only a mill is marked: an optional draw is not", () => {
    const tags = viaGrammar("Probe Draw", "Sorcery", "You may draw a card.");
    for (const a of tags.abilities) expect(a.optional).toBeUndefined();
  });
});

describe("the rest of a pick is not an optional mill (#1662)", () => {
  // The stored answer (cardClauses, 2026-11-20) with the printed text: the grammar rewrite marks the "rest" put optional beside its "up to three" twin.
  test("Kruphix's Insight: 'the rest of the revealed cards into your graveyard' is forced", () => {
    const text = "Reveal the top six cards of your library. Put up to three enchantment cards from among them into your hand and the rest of the revealed cards into your graveyard.";
    const stored = [{ id: 1, abilityType: "spell", actions: [
      { verb: "reveal", object: "the top six cards of your library", fromZone: null, toZone: null, amount: null, optional: false },
      { verb: "put", object: "up to three enchantment cards from among them", fromZone: "library", toZone: "hand", amount: null, optional: true },
      { verb: "put", object: "the rest of the revealed cards", fromZone: "library", toZone: "graveyard", amount: null, optional: false },
    ] }] as never;
    const card = { name: "Kruphix's Insight", typeLine: "Instant", oracleText: text, keywords: [] as string[] };
    const tags = deriveCardTags(deriveInputOf(card as never, "x", card.name, stored));
    const m = mills(tags);
    expect(m.length).toBeGreaterThan(0);
    for (const a of m) expect(a.optional).toBeUndefined();
  });
});
