import { expect, test } from "vitest";
import { topdeckPayoffs } from "./topdeck.js";
import type { CardTags } from "@mtg/tagger";
import type { DeckCard } from "./types.js";

const card = (name: string, typeLine: string, manaValue: number, oracleText = "", abilities: CardTags["abilities"] = []): DeckCard => ({
  card: { name, typeLine, oracleText, keywords: [], colors: [], manaValue } as never,
  tags: {
    oracleId: name, schemaVersion: 1, promptVersion: 1, model: "t",
    characteristics: { types: typeLine.toLowerCase().split(/[^a-z]+/).filter(Boolean), subtypes: [], colors: [], identity: [], cmc: manaValue, power: null, toughness: null, token: false, keywords: [] },
    abilities,
  } as unknown as CardTags,
});

const HIDETSUGU = card("Hidetsugu and Kairi", "Legendary Creature", 5,
  "When Hidetsugu and Kairi dies, exile the top card of your library. Target opponent loses life equal to its mana value. If it's an instant or sorcery card, you may cast it without paying its mana cost.",
  [{
    kind: "triggered",
    trigger: { verbs: ["dies"], subject: { control: "you", token: null, self: true } },
    effect: { kind: "player-life-loss", subject: { control: "opp", token: null } },
    amount: "mana value of exiled card",
    emits: [{ verb: "cast", subject: { control: "any", token: null, type: ["instant", "sorcery"], fromZone: "exile" } }],
  }] as unknown as CardTags["abilities"]);

const LIBRARY: DeckCard[] = [
  card("Island", "Basic Land", 0),
  card("Swamp", "Basic Land", 0),
  card("Skull Storm", "Sorcery", 9),
  card("Pongify", "Instant", 1),
];

test("a topdeck payoff reports what your library actually gives it", () => {
  const [row] = topdeckPayoffs([HIDETSUGU, ...LIBRARY], ["Hidetsugu and Kairi"]);
  expect(row.card).toBe("Hidetsugu and Kairi");
  // Lands drain nothing and they ARE exiled, so the honest expectation includes them.
  expect(row.meanManaValue).toBe(2.5);
  expect(row.nonlandMeanManaValue).toBe(5);
  expect(row.landShare).toBe(0.5);
  expect(row.castable).toEqual({ types: ["instant", "sorcery"], share: 0.5 });
});

test("a payoff reading EVERY player's library is not a fact about your curve alone", () => {
  // Nashi exiles "the top card of EACH PLAYER's library" — the pronoun is the whole difference, and
  // what it reads is their curve as much as yours.
  const nashi = card("Nashi, Moon Sage's Scion", "Legendary Creature", 4,
    "Whenever Nashi deals combat damage to a player, exile the top card of each player's library. Until end of turn, you may play one of those cards. If you cast a spell this way, pay life equal to its mana value rather than paying its mana cost.",
    [{ kind: "triggered", effect: { kind: "" }, amount: "equal to its mana value" }] as unknown as CardTags["abilities"]);
  expect(topdeckPayoffs([nashi, ...LIBRARY])).toEqual([]);
});

test("a topdeck effect that reads no mana value claims nothing", () => {
  const top = card("Sensei's Divining Top", "Artifact", 1,
    "{1}, {T}: Look at the top three cards of your library and rearrange them.");
  expect(topdeckPayoffs([top, ...LIBRARY])).toEqual([]);
});

test("the free-cast half is absent when the card only drains", () => {
  const drainOnly = { ...HIDETSUGU, tags: { ...HIDETSUGU.tags!, abilities: [{ ...HIDETSUGU.tags!.abilities[0], emits: [] }] } as CardTags };
  expect(topdeckPayoffs([drainOnly, ...LIBRARY], ["Hidetsugu and Kairi"])[0].castable).toBeUndefined();
});
