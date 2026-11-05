import { describe, expect, test } from "vitest";
import { pairReasons } from "./edges.js";
import { deriveCardTags, deriveInputOf, grammarClauseRecords } from "@edh-seer/tagger";
import type { CardTags } from "@edh-seer/tagger";
import type { DeckCard, Hierarchy } from "./types.js";

// #1534: the `prevented` event family. Real oracle text (Mongo `cards`, 2026-11-05) through the grammar's own records, the path every card below derives on.
const H: Hierarchy = { creature: ["creature"] };
const CARDS: Record<string, [string, string]> = {
  "Fog": ["Instant", "Prevent all combat damage that would be dealt this turn."],
  "Wild Slash": ["Instant", "Ferocious — If you control a creature with power 4 or greater, damage can't be prevented this turn.\nWild Slash deals 2 damage to any target."],
  "Questing Beast": ["Legendary Creature — Beast", "Vigilance, deathtouch, haste\nQuesting Beast can't be blocked by creatures with power 2 or less.\nCombat damage that would be dealt by creatures you control can't be prevented.\nWhenever Questing Beast deals combat damage to an opponent, it deals that much damage to target planeswalker that player controls."],
  "Circle of Protection: Red": ["Enchantment", "{1}: The next time a red source of your choice would deal damage to you this turn, prevent that damage."],
  "Worship": ["Enchantment", "If you control a creature, damage that would reduce your life total to less than 1 reduces it to 1 instead."],
  "Selfless Squire": ["Creature — Human Soldier", "Flash\nWhen this creature enters, prevent all damage that would be dealt to you this turn.\nWhenever damage that would be dealt to you is prevented, put that many +1/+1 counters on this creature."],
  "Phyrexian Vindicator": ["Creature — Phyrexian Dragon", "Flying\nIf damage would be dealt to this creature, prevent that damage. When damage is prevented this way, this creature deals that much damage to any other target."],
  "Judgment of Alexander": ["Enchantment", "Prevent all damage that would be dealt to you this turn by sources your opponents control. Whenever damage from a creature is prevented this way, each commander creature you control deals damage equal to its power to that creature."],
  "New Way Forward": ["Instant", "The next time a source of your choice would deal damage to you this turn, prevent that damage. When damage is prevented this way, New Way Forward deals that much damage to that source's controller and you draw that many cards."],
  "Samite Ministration": ["Instant", "Prevent all damage that would be dealt to you this turn by a source of your choice. Whenever damage from a black or red source is prevented this way this turn, you gain that much life."],
};
// The stored (model) records of the three cards whose derived row is `clauseSource: "model"` (Mongo cardClauses, 2026-11-05). Every other card derives on the grammar's own records.
const prevent = (object: string) => ({ verb: "prevent", object, fromZone: null, toZone: null, amount: null, optional: false });
const STORED: Record<string, unknown[]> = {
  "Wild Slash": [{ id: 1, abilityType: "static", actions: [prevent("damage can't be prevented this turn")] }, { id: 2, abilityType: "spell", actions: [{ verb: "deal-damage", object: "any target", amount: "2", optional: false }] }],
  "Worship": [{ id: 1, abilityType: "static", actions: [prevent("damage that would reduce your life total to less than 1")] }],
  "Questing Beast": [
    { id: 1, abilityType: "static", actions: [{ verb: "none", object: "Vigilance, deathtouch, haste" }] },
    { id: 2, abilityType: "static", actions: [{ verb: "cant", object: "be blocked by creatures with power 2 or less", fromZone: null, toZone: null, amount: null, optional: false }] },
    { id: 3, abilityType: "static", actions: [prevent("combat damage that would be dealt by creatures you control")] },
    { id: 4, abilityType: "triggered", trigger: { event: "damage-dealt", subject: "Questing Beast", control: "you" }, actions: [{ verb: "deal-damage", object: "target planeswalker that player controls", amount: "that much", optional: false }] },
  ],
};
const card = (name: string): DeckCard => {
  const [typeLine, oracleText] = CARDS[name]!;
  const c = { name, typeLine, oracleText, keywords: [] as string[] };
  const g = grammarClauseRecords(c as never);
  const stored = STORED[name];
  const tags = deriveCardTags(deriveInputOf(c as never, name, name, (stored ?? g.records) as never, undefined, stored ? undefined : g.readings)) as CardTags;
  return { card: { ...c, colors: [], manaValue: 0 }, tags } as unknown as DeckCard;
};
const preventedReasons = (a: string, b: string) => pairReasons(card(a), card(b), H).filter((r) => /prevented/.test(r.tag));

describe("#1534: prevented family", () => {
  test("a 'prevented this way' payoff hears only its own card's prevention: Fog -> Phyrexian Vindicator, Judgment of Alexander, New Way Forward, Samite Ministration", () => {
    for (const payoff of ["Phyrexian Vindicator", "Judgment of Alexander", "New Way Forward", "Samite Ministration"]) {
      expect(preventedReasons("Fog", payoff), payoff).toEqual([]);
    }
  });
  test("Phyrexian Vindicator's own prevention is no pair with itself", () => {
    expect(preventedReasons("Phyrexian Vindicator", "Phyrexian Vindicator")).toEqual([]);
  });
  test("Fog and Circle of Protection: Red still feed Selfless Squire's 'whenever damage that would be dealt to you is prevented'", () => {
    expect(preventedReasons("Fog", "Selfless Squire").length).toBeGreaterThan(0);
    expect(preventedReasons("Circle of Protection: Red", "Selfless Squire").length).toBeGreaterThan(0);
  });
  test("'damage can't be prevented' prevents nothing: Wild Slash and Questing Beast do not feed Selfless Squire", () => {
    expect(preventedReasons("Wild Slash", "Selfless Squire")).toEqual([]);
    expect(preventedReasons("Questing Beast", "Selfless Squire")).toEqual([]);
  });
  test("a life-total floor replaces damage, it prevents none: Worship does not feed Selfless Squire", () => {
    expect(preventedReasons("Worship", "Selfless Squire")).toEqual([]);
  });
});
