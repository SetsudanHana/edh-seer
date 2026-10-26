import { expect, test } from "vitest";
import { deriveCardTags, deriveInputOf, grammarClauseRecords } from "@edh-seer/tagger";
import type { CardTags } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons, analyzeDeckStructured } from "./index.js";
import type { DeckCard } from "./types.js";

/** "Face a dilemma" (Star Trek; owner ruling 2026-10-26, #1349): "You face a dilemma as you choose one or more modes for a spell or ability." Seven of Nine, Elim Garak,
 *  Obsidian Order Operative and Tinkerer watch it; EVERY modal spell or ability supplies it. Real oracle text (Mongo `cards`), derived the way production derives it: the
 *  grammar's own records, no stored answer. */
const H = loadHierarchy();
function fromText(name: string, typeLine: string, oracleText: string, keywords: string[] = []): DeckCard {
  const card = { name, typeLine, oracleText, keywords };
  const g = grammarClauseRecords(card);
  expect(g.complete, name).toBe(true);
  const tags = deriveCardTags(deriveInputOf(card as never, name, name, g.records, undefined, g.readings)) as CardTags;
  return { card: { ...card, colors: [], manaValue: 0 } as unknown as DeckCard["card"], tags };
}
const seven = fromText("Seven of Nine", "Legendary Artifact Creature — Human Scientist", "Whenever you face a dilemma, draw a card. (You face a dilemma as you choose one or more modes for a spell or ability.)", ["Face a dilemma"]);
const kolaghans = fromText("Kolaghan's Command", "Instant", "Choose two —\n• Return target creature card from your graveyard to your hand.\n• Target player discards a card.\n• Destroy target artifact.\n• Kolaghan's Command deals 2 damage to any target.");
const prince = fromText("Charming Prince", "Creature — Human Noble", "When this creature enters, choose one —\n• Scry 2.\n• You gain 3 life.\n• Exile another target creature you own. Return it to the battlefield under your control at the beginning of the next end step.", ["Scry"]);
const bolt = fromText("Lightning Bolt", "Instant", "Lightning Bolt deals 3 damage to any target.");

test("Seven of Nine pairs with a modal spell: Kolaghan's Command supplies the dilemma she draws on", () => {
  const reasons = pairReasons(kolaghans, seven, H);
  const hit = reasons.filter((r) => r.tag.startsWith("face-a-dilemma"));
  expect(hit.length).toBeGreaterThan(0);
  expect(hit[0]!.text).toContain("Kolaghan's Command");
  expect(hit[0]!.text).toContain("Seven of Nine");
});

test("...and with a modal triggered ability: Charming Prince", () => {
  expect(pairReasons(prince, seven, H).some((r) => r.tag.startsWith("face-a-dilemma"))).toBe(true);
});

test("...but not with a spell that has no modes: Lightning Bolt", () => {
  expect(pairReasons(bolt, seven, H).some((r) => r.tag.startsWith("face-a-dilemma"))).toBe(false);
});

// OWNER RULING 2026-10-26: a producer-only event names no theme without a payoff. Every modal card
// emits face-a-dilemma, so a deck of Charms and Commands with no Seven of Nine is not a "face a
// dilemma" deck; with one, it is.
const modals = Array.from({ length: 8 }, (_, i) => fromText(`Command ${i}`, "Instant",
  "Choose two —\n• Return target creature card from your graveyard to your hand.\n• Target player discards a card.\n• Destroy target artifact.\n• Command " + i + " deals 2 damage to any target."));
const head = (cards: DeckCard[]) => analyzeDeckStructured(cards, []).themes[0]?.tag;

test("a deck of modal spells with no dilemma payoff is not headlined face-a-dilemma", () => {
  expect(head(modals)).not.toMatch(/^face-a-dilemma/);
  // ...but the tag is still reported among its themes: a demotion, not a deletion.
  expect(analyzeDeckStructured(modals, []).themes.some((t) => t.tag.startsWith("face-a-dilemma"))).toBe(true);
});

test("with Seven of Nine in the deck, face-a-dilemma can headline", () => {
  expect(head([...modals, seven])).toMatch(/^face-a-dilemma/);
});
