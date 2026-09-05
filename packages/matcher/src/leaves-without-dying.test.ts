import { expect, test } from "vitest";
import { deriveCardTags } from "@edh-seer/tagger";
import type { Characteristics, ClauseRecord, CardTags } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import type { DeckCard } from "./types.js";

/** ROADMAP Y1 WITNESSES (2026-09-05). Clause records are the corpus's own (`cardClauses.canonical`),
 *  copied verbatim; texts are the printed oracle sentences. This is the bank: a pair here that stops
 *  forming, or a refused pair that starts, is a regression in the dies/leaves model. */
const chars = (types: string[]): Characteristics => ({
  types, subtypes: [], colors: [], identity: [], cmc: 0, power: null, toughness: null, token: false, keywords: [],
});

function card(name: string, types: string[], clauses: ClauseRecord[], clauseTexts: Record<number, string>): DeckCard {
  const tags = deriveCardTags({ oracleId: name, name, clauses, clauseTexts, characteristics: chars(types) }) as CardTags;
  return {
    card: { name, typeLine: types.join(" "), oracleText: Object.values(clauseTexts).join("\n"), keywords: [], colors: [], manaValue: 0 } as unknown as DeckCard["card"],
    tags,
  };
}

const H = loadHierarchy();

const ephemerate = card("Ephemerate", ["instant"], [{
  id: 1, abilityType: "spell",
  actions: [
    { verb: "exile", object: "target creature you control", fromZone: "battlefield", toZone: "exile" },
    { verb: "return", object: "it", fromZone: "exile", toZone: "battlefield" },
  ],
}], { 1: "Exile target creature you control, then return it to the battlefield under its owner's control." });

const ozolith = card("The Ozolith", ["artifact"], [{
  id: 1, abilityType: "triggered",
  trigger: { event: "leaves", subject: "a creature you control", control: "you" },
  actions: [{ verb: "add-counter", object: "those counters" }],
}], { 1: "Whenever a creature you control leaves the battlefield, if it had counters on it, put those counters on The Ozolith." });

const bloodArtist = card("Blood Artist", ["creature"], [{
  id: 1, abilityType: "triggered",
  trigger: { event: "dies", subject: "this creature or another creature", control: "any" },
  actions: [{ verb: "lose-life", object: "target player", amount: "1" }, { verb: "gain-life", object: "you", amount: "1" }],
}], { 1: "Whenever this creature or another creature dies, target player loses 1 life and you gain 1 life." });

const portMage = card("Dour Port-Mage", ["creature"], [{
  id: 1, abilityType: "triggered",
  trigger: { event: "leaves", subject: "one or more other creatures you control", control: "you" },
  actions: [{ verb: "draw", object: "a card", amount: "1" }],
}], { 1: "Whenever one or more other creatures you control leave the battlefield without dying, draw a card." });

const tomb = card("Desecrated Tomb", ["artifact"], [{
  id: 1, abilityType: "triggered",
  trigger: { event: "leaves", subject: "one or more creature cards", control: "you" },
  actions: [{ verb: "create", object: "a 1/1 black Bat creature token with flying" }],
}], { 1: "Whenever one or more creature cards leave your graveyard, create a 1/1 black Bat creature token with flying." });

const edict = card("Fleshbag Marauder", ["creature"], [{
  id: 1, abilityType: "triggered",
  trigger: { event: "enters", subject: "this creature", control: "you" },
  actions: [{ verb: "sacrifice", object: "a creature" }],
}], { 1: "When this creature enters, each player sacrifices a creature of their choice." });

const bloodchief = card("Bloodchief Ascension", ["enchantment"], [{
  id: 1, abilityType: "triggered",
  trigger: { event: "milled", subject: "a card", control: "opponent" },
  actions: [{ verb: "lose-life", object: "that player", amount: "2" }, { verb: "gain-life", object: "you", amount: "2" }],
}], { 1: "Whenever a card is put into an opponent's graveyard from anywhere, if Bloodchief Ascension has three or more quest counters on it, you may have that player lose 2 life. If you do, you gain 2 life." });

const tags = (a: DeckCard, b: DeckCard): string[] => pairReasons(a, b, H).map((r) => r.tag).sort();

test("a flicker feeds a leaves payoff on the leaves tag", () => {
  expect(tags(ephemerate, ozolith)).toContain("leaves:creature");
});

test("a flicker feeds a without-dying payoff", () => {
  expect(tags(ephemerate, portMage)).toContain("leaves:creature");
});

test("a flicker feeds no death payoff and fills no graveyard", () => {
  expect(tags(ephemerate, bloodArtist)).toEqual([]);
  expect(tags(ephemerate, bloodchief)).toEqual([]);
});

test("a death still feeds a leaves payoff, on the tag the panel was judged against", () => {
  expect(tags(edict, ozolith)).toContain("leaves:creature");
});

test("a death feeds neither a without-dying payoff nor a graveyard-leave payoff", () => {
  expect(tags(edict, portMage).filter((t) => t.startsWith("leaves"))).toEqual([]);
  expect(tags(edict, tomb).filter((t) => t.startsWith("leaves"))).toEqual([]);
});

test("a flicker feeds no graveyard-leave payoff either", () => {
  expect(tags(ephemerate, tomb).filter((t) => t.startsWith("leaves"))).toEqual([]);
});
