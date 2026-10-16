import { expect, test } from "vitest";
import { deriveCardTags, grammarClauseRecords } from "@edh-seer/tagger";
import type { Characteristics, ClauseRecord, CardTags } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import type { DeckCard } from "./types.js";

/** #1250 task 3 (owner-judged FALSE): Lively Dirge fills YOUR graveyard, Tinybones casts from the graveyard of the
 *  player it damaged -- an opponent's. "That player's graveyard" read `any`, so the pair formed. */
const chars = (types: string[], extra: Partial<Characteristics> = {}): Characteristics => ({
  types, subtypes: [], colors: [], identity: [], cmc: 0, power: null, toughness: null, token: false, keywords: [], ...extra,
});

function card(name: string, types: string[], clauses: ClauseRecord[], clauseTexts: Record<number, string>, oracleText: string): DeckCard {
  const tags = deriveCardTags({ oracleId: name, name, clauses, clauseTexts, characteristics: chars(types) }) as CardTags;
  return {
    card: { name, typeLine: types.join(" "), oracleText, keywords: [], colors: [], manaValue: 0 } as unknown as DeckCard["card"],
    tags,
  };
}

const H = loadHierarchy();

const TINY_TEXT = "Deathtouch\nWhenever Tinybones deals combat damage to a player, you may cast target nonland permanent card from that player's graveyard, and mana of any type can be spent to cast that spell.";
const tinyRecords = grammarClauseRecords({ name: "Tinybones, the Pickpocket", oracleText: TINY_TEXT, keywords: ["Deathtouch"], typeLine: "Legendary Creature — Skeleton Rogue" });
const tinybones = card("Tinybones, the Pickpocket", ["creature"], tinyRecords.records, { 2: TINY_TEXT.split("\n")[1]! }, TINY_TEXT);

// Lively Dirge's clause records are the corpus's own (cardClauses.canonical), the spree mode texts verbatim.
const dirge = card("Lively Dirge", ["sorcery"], [
  { id: 2, abilityType: "spell", actions: [
    { verb: "search", object: "a card", fromZone: "library" },
    { verb: "put", object: "it", fromZone: "library", toZone: "graveyard" },
    { verb: "shuffle", object: "your library" },
  ] },
  { id: 3, abilityType: "spell", actions: [
    { verb: "return", object: "up to two creature cards with total mana value 4 or less", fromZone: "graveyard", toZone: "battlefield" },
  ] },
] as ClauseRecord[], {
  2: "Search your library for a card, put it into your graveyard, then shuffle.",
  3: "Return up to two creature cards with total mana value 4 or less from your graveyard to the battlefield.",
}, "+ {1} — Search your library for a card, put it into your graveyard, then shuffle.\n+ {2} — Return up to two creature cards with total mana value 4 or less from your graveyard to the battlefield.");

// SYNTHETIC filler (no corpus card is this bare): an opponent's graveyard is what Tinybones reaches.
const oppMill = card("Opponent Mill (synthetic)", ["sorcery"], [
  { id: 1, abilityType: "spell", actions: [{ verb: "mill", object: "target opponent", amount: "8" }] },
] as ClauseRecord[], { 1: "Target opponent mills eight cards." }, "Target opponent mills eight cards.");

test("Tinybones's recursion subject and cast/leaves emits are an opponent's graveyard", () => {
  const rec = tinybones.tags!.abilities.find((a) => a.effect.kind === "graveyard-recursion")!;
  expect(rec.effect.subject?.control).toBe("opp");
  expect((rec.emits ?? []).length).toBeGreaterThan(0);
  for (const e of rec.emits ?? []) expect(e.subject.control).toBe("opp");
});

test("Lively Dirge (fills YOUR graveyard) forms no graveyard-recursion with Tinybones", () => {
  const tags = [...pairReasons(dirge, tinybones, H), ...pairReasons(tinybones, dirge, H)].map((r) => r.tag);
  expect(tags.filter((t) => t.startsWith("graveyard-recursion"))).toEqual([]);
});

test("a mill of an opponent still feeds Tinybones's recursion", () => {
  const tags = pairReasons(oppMill, tinybones, H).map((r) => r.tag);
  expect(tags.some((t) => t.startsWith("graveyard-recursion"))).toBe(true);
});
