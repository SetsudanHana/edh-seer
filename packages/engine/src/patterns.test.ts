import { expect, test } from "vitest";
import { extractTags } from "./tags.js";
import type { Card } from "./card.js";
import { FIXTURES } from "./fixtures.js";

function make(typeLine: string, oracleText: string, keywords: string[] = []): Card {
  return { name: "X", typeLine, oracleText, keywords, colors: [], manaValue: 0 };
}

test("a creature produces tribe tags for each of its subtypes", () => {
  const p = extractTags(make("Legendary Creature — Goblin Warrior", "Tap: create tokens."));
  expect(p.produces.has("tribe:goblin")).toBe(true);
  expect(p.produces.has("tribe:warrior")).toBe(true);
});

test("a tribal payoff cares about the referenced tribe", () => {
  const p = extractTags(make("Creature — Goblin", "Other Goblins you control get +1/+1."));
  expect(p.cares.has("tribe:goblin")).toBe(true);
});

test("a non-tribal 'X you control' phrase is not tagged as a tribe", () => {
  const p = extractTags(make("Artifact", "Artifacts you control get +1/+0."));
  expect([...p.cares].some((t) => t.startsWith("tribe:"))).toBe(false);
});

test("instants and sorceries produce cast tags; magecraft cares about them", () => {
  const bolt = extractTags(make("Instant", "Deal 3 damage to any target."));
  expect(bolt.produces.has("cast:instant")).toBe(true);
  const mage = extractTags(make("Creature — Human Wizard", "Magecraft — Whenever you cast or copy an instant or sorcery spell, draw a card."));
  expect(mage.cares.has("cast:instant")).toBe(true);
  expect(mage.cares.has("cast:sorcery")).toBe(true);
});

test("Krenko produces tokens (and creature-etb)", () => {
  const t = extractTags(FIXTURES.krenko);
  expect(t.produces.has("token")).toBe(true);
  expect(t.produces.has("creature-etb")).toBe(true);
});

test("Impact Tremors cares about creature-etb", () => {
  const t = extractTags(FIXTURES.impactTremors);
  expect(t.cares.has("creature-etb")).toBe(true);
});

test("Ashnod's Altar is a sacrifice outlet: produces sacrifice-event and mana, cares about fodder", () => {
  const t = extractTags(FIXTURES.ashnods);
  expect(t.produces.has("sacrifice-event")).toBe(true);
  expect(t.produces.has("mana")).toBe(true);
  expect(t.cares.has("sacrifice-fodder")).toBe(true);
});

test("Blood Artist cares about creature-death", () => {
  const t = extractTags(FIXTURES.bloodArtist);
  expect(t.cares.has("creature-death")).toBe(true);
});

test("Cultivate is ramp and produces land-etb + mana", () => {
  const t = extractTags(FIXTURES.cultivate);
  expect(t.produces.has("ramp")).toBe(true);
  expect(t.produces.has("land-etb")).toBe(true);
});

test("Lotus Cobra cares about land-etb (landfall)", () => {
  const t = extractTags(FIXTURES.lotusCobra);
  expect(t.cares.has("land-etb")).toBe(true);
});

test("Swords to Plowshares is removal", () => {
  const t = extractTags(FIXTURES.swordsToPlowshares);
  expect(t.produces.has("removal")).toBe(true);
});

test("Divination is card-draw", () => {
  const t = extractTags(FIXTURES.divination);
  expect(t.produces.has("card-draw")).toBe(true);
});

test("tribal payoff resolves irregular plurals (Elves, Wolves)", () => {
  const elves = extractTags(make("Creature — Elf", "Other Elves you control get +1/+1."));
  expect(elves.cares.has("tribe:elf")).toBe(true);
  const wolves = extractTags(make("Enchantment", "Wolves you control get +1/+1."));
  expect(wolves.cares.has("tribe:wolf")).toBe(true);
});

test("tribal payoff uses word boundaries: 'each golemancer' is not tribe:golem", () => {
  const p = extractTags(make("Enchantment", "Whenever you cast a spell, each golemancer gains haste."));
  expect(p.cares.has("tribe:golem")).toBe(false);
});

test("self-mill produces graveyard; a negated 'put into your graveyard' clause does not", () => {
  expect(extractTags(FIXTURES.stitchersSupplier).produces.has("graveyard")).toBe(true);
  const neg = extractTags(make("Enchantment", "Cards in libraries can't be put into your graveyard."));
  expect(neg.produces.has("graveyard")).toBe(false);
});

test("graveyard payoff cares about the graveyard", () => {
  expect(extractTags(FIXTURES.gravedigger).cares.has("graveyard")).toBe(true);
});

test("lifegain source produces lifegain (gain N life or lifelink)", () => {
  expect(extractTags(FIXTURES.soulWarden).produces.has("lifegain")).toBe(true);
  expect(extractTags(make("Creature — Angel", "Flying.", ["Lifelink"])).produces.has("lifegain")).toBe(true);
});

test("lifegain payoff cares about lifegain", () => {
  expect(extractTags(FIXTURES.archangelOfThune).cares.has("lifegain")).toBe(true);
});

test("etb-value-creature: own-ETB creature produces creature-etb + cares blink; 'another creature enters' does not", () => {
  const m = extractTags(FIXTURES.mulldrifter);
  expect(m.produces.has("creature-etb")).toBe(true);
  expect(m.cares.has("blink")).toBe(true);
  // Soul Warden triggers on "another creature enters", not its own ETB — must not want blink.
  expect(extractTags(FIXTURES.soulWarden).cares.has("blink")).toBe(false);
});

test("blink enabler produces blink and cares about creature-etb", () => {
  const e = extractTags(FIXTURES.ephemerate);
  expect(e.produces.has("blink")).toBe(true);
  expect(e.cares.has("creature-etb")).toBe(true);
});

test("an enchantment permanent produces the enchantment tag", () => {
  expect(extractTags(FIXTURES.wildGrowth).produces.has("enchantment")).toBe(true);
});

test("an enchantress payoff cares about enchantments", () => {
  expect(extractTags(FIXTURES.enchantressPresence).cares.has("enchantment")).toBe(true);
});

test("an Equipment produces the equipment tag", () => {
  expect(extractTags(FIXTURES.bonesplitter).produces.has("equipment")).toBe(true);
});

test("an equipment payoff cares about equipment", () => {
  expect(extractTags(FIXTURES.puresteelPaladin).cares.has("equipment")).toBe(true);
});

test("self-mill precision: library-peek and opponent discard are NOT graveyard", () => {
  expect(extractTags(make("Enchantment", "Look at the top card of your library.")).produces.has("graveyard")).toBe(false);
  expect(extractTags(make("Sorcery", "Each opponent discards a card.")).produces.has("graveyard")).toBe(false);
  // real self-mill / discard-your-hand still fires
  expect(extractTags(FIXTURES.stitchersSupplier).produces.has("graveyard")).toBe(true);
  expect(extractTags(make("Sorcery", "Discard your hand, then draw seven cards.")).produces.has("graveyard")).toBe(true);
});

test("lifegain source catches 'gains life equal to X' (Swords)", () => {
  expect(extractTags(FIXTURES.swordsToPlowshares).produces.has("lifegain")).toBe(true);
  // still a removal spell
  expect(extractTags(FIXTURES.swordsToPlowshares).produces.has("removal")).toBe(true);
});

test("blink-enabler precision: exile + unrelated return in separate sentences is NOT blink", () => {
  expect(extractTags(make("Sorcery", "Exile target creature. Return all artifacts to the battlefield.")).produces.has("blink")).toBe(false);
  // a real single-clause flicker still fires
  expect(extractTags(FIXTURES.ephemerate).produces.has("blink")).toBe(true);
});

test("etb-value-creature also matches a generic 'this creature enters the battlefield'", () => {
  const generic = extractTags(make("Creature — Elemental", "When this creature enters the battlefield, draw a card."));
  expect(generic.produces.has("creature-etb")).toBe(true);
  expect(generic.cares.has("blink")).toBe(true);
  // own-name still works; 'another creature enters' still does not want blink
  expect(extractTags(FIXTURES.mulldrifter).cares.has("blink")).toBe(true);
  expect(extractTags(FIXTURES.soulWarden).cares.has("blink")).toBe(false);
});

test("a counter keyword (Modular) produces the +1/+1 counter tag", () => {
  expect(extractTags(FIXTURES.arcboundRavager).produces.has("counter:+1/+1")).toBe(true);
});

test("proliferate cares about +1/+1 counters", () => {
  expect(extractTags(FIXTURES.evolutionSage).cares.has("counter:+1/+1")).toBe(true);
});

test("counter-keyword-source isolates the keyword branch (Graft, no counter text)", () => {
  // "Flying." does not match counter-maker's /put .*\+1\/\+1 counter/ or "with a +1/+1 counter",
  // so this only tags counter:+1/+1 via the Graft keyword -> genuinely exercises counter-keyword-source.
  const p = extractTags(make("Creature — Insect", "Flying.", ["Graft"]));
  expect(p.produces.has("counter:+1/+1")).toBe(true);
});
