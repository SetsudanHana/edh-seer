import { expect, test } from "vitest";
import { deriveCardTags, deriveInputOf, grammarClauseRecords } from "@edh-seer/tagger";
import type { CardTags } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import type { DeckCard } from "./types.js";

/** A GRANT TO CARDS IN A GRAVEYARD OR HAND STILL REACHES EVERY PRINTED CARD OF ITS CLASS (#1542 review; owner ruling 2026-09-10, "a type is a class too"), and reaches no token.
 *  Real oracle text (Mongo `cards`, read 2026-11-06); Doomguide's reading is its stored `cardClauses.canonical`. */
const H = loadHierarchy();
const build = (name: string, typeLine: string, oracleText: string, records: unknown[], isToken = false): DeckCard => {
  const card = { name, typeLine, oracleText, keywords: [] as string[] };
  return { card: { ...card, colors: [], manaValue: 0 } as unknown as DeckCard["card"], tags: deriveCardTags(deriveInputOf(card as never, name, name, records as never)) as CardTags, ...(isToken ? { isToken: true } : {}) } as DeckCard;
};
const fromText = (name: string, typeLine: string, oracleText: string): DeckCard => {
  const g = grammarClauseRecords({ name, typeLine, oracleText, keywords: [] });
  expect(g.complete, name).toBe(true);
  const card = { name, typeLine, oracleText, keywords: [] as string[] };
  return { card: { ...card, colors: [], manaValue: 0 } as unknown as DeckCard["card"], tags: deriveCardTags(deriveInputOf(card as never, name, name, g.records, undefined, g.readings)) as CardTags };
};
const doomguide = build("Solemn Doomguide", "Creature — Tiefling Cleric",
  "Flying\nEach creature card in your graveyard that's a Cleric, Rogue, Warrior, and/or Wizard has unearth {1}{B}. ({1}{B}: Return the card to the battlefield. The creature gains haste. Exile it at the beginning of the next end step or if it would leave the battlefield. Unearth only as a sorcery.)",
  [{ id: 1, abilityType: "none", actions: [{ verb: "none", object: "Flying", fromZone: null, toZone: null }] }, { id: 2, abilityType: "static", actions: [{ verb: "grant-ability", object: "unearth {1}{B}", fromZone: null, toZone: null, amount: null, optional: false }] }]);
const aminatouText = "At the beginning of your upkeep, surveil 2.\nEach enchantment card in your hand has miracle. Its miracle cost is equal to its mana cost reduced by {4}.";
const aminatou = build("Aminatou, Veil Piercer", "Legendary Creature — Human Wizard", aminatouText, []);
const dregscape = fromText("Dregscape Sliver", "Creature — Sliver", "Each Sliver creature card in your graveyard has unearth {2}.\nUnearth {2} ({2}: Return this card from your graveyard to the battlefield. It gains haste. Exile it at the beginning of the next end step or if it would leave the battlefield. Unearth only as a sorcery.)");
const hibernation = build("Hibernation Sliver", "Creature — Sliver", "All Slivers have \"Pay 2 life: Return this permanent to its owner's hand.\"", []);
const mishra = fromText("Mishra, Tamer of Mak Fawa", "Legendary Creature — Human Artificer", "Permanents you control have \"Ward—Sacrifice a permanent.\"\nEach artifact card in your graveyard has unearth {1}{B}{R}. ({1}{B}{R}: Return the card from your graveyard to the battlefield. It gains haste. Exile it at the beginning of the next end step or if it would leave the battlefield. Unearth only as a sorcery.)");
const candy = build("Candy Trail", "Artifact — Food Clue", "When this artifact enters, scry 2.\n{2}, {T}, Sacrifice this artifact: You gain 3 life and draw a card.", []);
const homing = fromText("Homing Sliver", "Creature \u2014 Sliver", "Each Sliver card in each player's hand has slivercycling {3}.\nSlivercycling {3} ({3}, Discard this card: Search your library for a Sliver card, reveal it, put it into your hand, then shuffle.)");
const reasons = (p: DeckCard, c: DeckCard): string[] => pairReasons(p, c, H).filter((r) => r.producer === p.card.name && r.consumer === c.card.name && r.tag === "static:keyword-grant").map((r) => r.tag);

test("a graveyard grant reaches the printed cards of its class: Doomguide -> a Wizard creature card, Dregscape Sliver -> Hibernation Sliver, Mishra -> Candy Trail", () => {
  expect(doomguide.tags!.abilities.find((a) => a.effect.kind === "keyword-grant")!.effect.subject).toMatchObject({ zone: "graveyard" });
  expect(reasons(doomguide, aminatou)).toEqual(["static:keyword-grant"]);
  expect(reasons(dregscape, hibernation)).toEqual(["static:keyword-grant"]);
  expect(reasons(mishra, candy)).toEqual(["static:keyword-grant"]);
  // ...a hand grant too, though the stored reading names no keyword (slivercycling): Homing Sliver -> Hibernation Sliver.
  expect(reasons(homing, hibernation)).toEqual(["static:keyword-grant"]);
});

test("...but not a card outside the class (Doomguide -> Candy Trail), and not a token (a token is never a card in a graveyard)", () => {
  expect(reasons(doomguide, candy)).toEqual([]);
  const wizardToken = build("Wizard", "Token Creature — Wizard", "", [], true);
  expect(reasons(doomguide, wizardToken)).toEqual([]);
});

test("an animated permanent is still no graveyard-grant consumer (#1364): Doomguide's Wizards do not reach a land that becomes a Wizard", () => {
  const hall = fromText("Great Hall of the Biblioplex", "Land", "{T}: Add {C}.\n{T}, Pay 1 life: Add one mana of any color. Spend this mana only to cast an instant or sorcery spell.\n{5}: If this land isn't a creature, it becomes a 2/4 Wizard creature with \"Whenever you cast an instant or sorcery spell, this creature gets +1/+0 until end of turn.\" It's still a land.");
  expect(reasons(doomguide, hall)).toEqual([]);
});
