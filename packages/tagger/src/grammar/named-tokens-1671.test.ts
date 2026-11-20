import { expect, test } from "vitest";
import { grammarClauseRecords } from "./clause-record.js";
import { parseActions } from "./action.js";
import { segment } from "../segment.js";
import { deriveCardTags } from "../derive/derive.js";
import { deriveInputOf } from "../derive-input.js";

// #1671: a token named after a real card has its characteristics ONLY in the reminder the segmenter strips (CR 111.3: the
// spell or ability may define them; CR 202.2: colour is the colour of the mana symbols of the cost the reminder prints).
// Every oracle text below is the corpus's own (Mongo `cards`, 2026-11-20).
const card = (name: string, typeLine: string, oracleText: string) => ({ name, typeLine, oracleText, keywords: [] as string[] });

const ARZAKON = '−3: Create a Black Lotus token. (It\'s a {0} artifact with "{T}, Sacrifice this token: Add three mana of any one color.")';
const WORZEL = "−8: Create ten Scryb Sprites tokens. (They're {G} 1/1 Faerie creatures with flying.)";
const NIVEA = "{5}{W}{W}{W}, Sacrifice Nivea: Create an Akroma, Angel of Wrath token. (She's a {5}{W}{W}{W} legendary 6/6 Angel creature with flying, first strike, vigilance, trample, haste, and protection from black and from red.)";
const BALEFANG = "When Balefang enters, target opponent creates a tapped Baneslayer Angel token. The token is goaded for the rest of the game. (It's a {3}{W}{W} 5/5 Angel creature with flying, first strike, lifelink, and protection from Demons and from Dragons.)";
const THOMIL = '−5: Create a Lord of the Pit token. (It\'s a {4}{B}{B}{B} 7/7 Demon creature with flying, trample, and "At the beginning of your upkeep, sacrifice another creature. If you can\'t, this token deals 7 damage to you.")';

test("the reminder's type line is the named token's characteristics, in the clause the grammar reads", () => {
  expect(segment(WORZEL, [], "Legendary Planeswalker — Worzel")[0]!.text).toBe("Create ten 1/1 green Faerie creature tokens with flying.");
  expect(segment(NIVEA, [], "Legendary Creature — Human Wizard")[0]!.text).toBe("Create a 6/6 white legendary Angel creature token with flying, first strike, vigilance, trample, haste, and protection from black and from red.");
});

test.each([
  ["Worzel, the Protector", "Legendary Planeswalker — Worzel", WORZEL],
  ["Nivea, Beloved Battlemage", "Legendary Creature — Human Wizard Warrior", NIVEA],
  ["Arzakon", "Legendary Planeswalker — Arzakon", ARZAKON],
  ["Thomil, the Destroyer", "Legendary Planeswalker — Thomil", THOMIL],
  ["Balefang the Unslayable", "Legendary Creature — Angel Warrior", BALEFANG],
])("%s derives from its named token's reminder", (name, typeLine, text) => {
  const g = grammarClauseRecords(card(name, typeLine, text));
  expect(g.blocker, JSON.stringify(g.blocker)).toBeUndefined();
  expect(g.complete).toBe(true);
});

test("a token named after a card with NO type line in its reminder stays a blocker", () => {
  const g = grammarClauseRecords(card("Fake Maker", "Legendary Creature — Human", "{T}: Create a Black Lotus token."));
  expect(g.complete).toBe(false);
  const h = grammarClauseRecords(card("Fake Maker", "Legendary Creature — Human", "{T}: Create a Black Lotus token. (It's a mystery.)"));
  expect(h.complete).toBe(false);
});

test("a predefined token's reminder is left alone (Food, Treasure)", () => {
  expect(segment('When this enters, create a Food token. (It\'s an artifact with "{2}, {T}, Sacrifice this token: You gain 3 life.")', [], "Creature — Elf")[0]!.text).toBe("When this enters, create a Food token.");
});

// Zagorka, Mother of Sanctum (Mongo `cards`): the boundary the quote-strip lost, then "Each opponent who does can't attack you during their next turn".
test("Zagorka: the sentence after the quoted land ability stands alone, 'who does' read as the opponents' condition", () => {
  const g = grammarClauseRecords(card("Zagorka, Mother of Sanctum", "Legendary Creature — Human Warlock",
    'At the beginning of your end step, each player may create a tapped land token named Sanctum with "{T}: Add one mana of any color." Each opponent who does can\'t attack you during their next turn.'));
  expect(g.blocker, JSON.stringify(g.blocker)).toBeUndefined();
  expect(g.complete).toBe(true);
  expect(parseActions("each opponent who does can't attack you during their next turn", "triggered")).toMatchObject([{ verb: "cant", object: { control: "opp", scope: "each" }, condition: "who does", text: "attack you during their next turn" }]);
});

const derived = (name: string, typeLine: string, text: string) => {
  const c = card(name, typeLine, text);
  const g = grammarClauseRecords(c);
  expect(g.complete, name).toBe(true);
  return deriveCardTags(deriveInputOf(c as never, "x", name, g.records, undefined, g.readings));
};

test("derive: Balefang's token is an OPPONENT's tapped Angel, protection from Demons and Dragons names no subtype, and the goad is its own action", () => {
  const t = derived("Balefang the Unslayable", "Legendary Creature — Angel Warrior", BALEFANG);
  const made = t.abilities.find((a) => a.effect.kind === "token-generation")!;
  expect(made.emits?.filter((e) => e.verb === "create-token" || e.verb === "enters").map((e) => [e.subject.control, e.subject.subtype])).toEqual([["opp", "angel"], ["opp", "angel"]]);
  expect(made.emits?.find((e) => e.verb === "enters")?.subject.entersTapped).toBe(true);
  expect(t.abilities.some((a) => a.emits?.some((e) => e.verb === "goad"))).toBe(true);
});

test("derive: Black Lotus is a colourless artifact (its NAME is no colour), Akroma is white alone", () => {
  const lotus = derived("Arzakon", "Legendary Planeswalker — Arzakon", ARZAKON).abilities.find((a) => a.effect.kind === "token-generation")!;
  expect(lotus.emits?.[0]?.subject).toMatchObject({ control: "you", token: true, type: "artifact" });
  expect(lotus.emits?.[0]?.subject.colors).toBeUndefined();
  const akroma = derived("Nivea, Beloved Battlemage", "Legendary Creature — Human Wizard Warrior", NIVEA).abilities.find((a) => a.effect.kind === "token-generation")!;
  expect(akroma.emits?.[0]?.subject).toMatchObject({ colors: ["W"], subtype: "angel", legendary: true });
});

// Ral and the Implicit Maze (Mongo `cards`): its grammar row before #1671 read "Spellgorger Weird" as a Weird; the reminder's own ability names the token, which reads as "this token".
test("a named token's ability that names the token reads as this token (Ral and the Implicit Maze keeps its grammar row)", () => {
  const ral = "I — This Saga deals 2 damage to each creature and planeswalker your opponents control.\nII — You may discard a card. If you do, exile the top two cards of your library. You may play them until the end of your next turn.\nIII — Create a Spellgorger Weird token. (It's a {2}{R} 2/2 Weird creature with \"Whenever you cast a noncreature spell, put a +1/+1 counter on Spellgorger Weird.\")";
  expect(segment(ral, [], "Enchantment — Saga").map((c) => c.text)).toContain("Create a 2/2 red Weird creature token with that ability.");
  const g = grammarClauseRecords(card("Ral and the Implicit Maze", "Enchantment — Saga", ral));
  expect(g.blocker, JSON.stringify(g.blocker)).toBeUndefined();
});

// Ginger, Queen of Sweets (Mongo `cards`): a named token with TWO quoted abilities, which blocked once the reminder was read.
test("a named token with two quoted abilities reads (Ginger, Queen of Sweets keeps its grammar row)", () => {
  const ginger = 'At the beginning of each upkeep, if you\'re the monarch, create a Gingerbrute token. (It\'s a {1} 1/1 Food Golem artifact creature with haste, "{1}: This token can\'t be blocked this turn except by creatures with haste," and "{2}, {T}, Sacrifice this token: You gain 3 life.")';
  const g = grammarClauseRecords(card("Ginger, Queen of Sweets", "Legendary Artifact Creature — Food Noble", ginger));
  expect(g.blocker, JSON.stringify(g.blocker)).toBeUndefined();
});
