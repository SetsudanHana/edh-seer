import { describe, expect, test } from "vitest";
import { deriveCardTags, deriveInputOf } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import type { DeckCard } from "./types.js";
import fixtures from "./fixtures/stolen-cast-pairs.json" with { type: "json" };

/** #1592 fix round: "You may cast that card" of a card taken from an OPPONENT's hand, graveyard or library (Covetous Urge, Psychic Intrusion, Stolen Goods) is your cast of a card that opponent owns
 *  (CR 108.3: a card's owner is the player who started the game with it in their deck). It is never a card of YOUR deck, so it fires no deck-mate's own "when you cast this spell" (Artisan of Kozilek, Echo Storm);
 *  you still cast it, so every class trigger hears it ("whenever you cast an instant or sorcery spell", prowess, "a spell you don't own"). A cast off your OWN library (Hidetsugu and Kairi) can be a deck-mate.
 *  Source documents and stored `cardClauses.canonical` dumped from Mongo 2026-11-10. */
const F = fixtures as unknown as Record<string, { source: Record<string, unknown>; canonical: ClauseRecord[] }>;
const dc = (name: string): DeckCard => ({
  card: F[name]!.source as unknown as DeckCard["card"],
  tags: deriveCardTags(deriveInputOf(F[name]!.source as never, name, name, F[name]!.canonical)) as CardTags,
});
const H = loadHierarchy();
const castTags = (producer: string, consumer: string) => pairReasons(dc(producer), dc(consumer), H).map((r) => r.tag).filter((t) => t.startsWith("cast:") || t.startsWith("prowess:"));

describe.each(["Covetous Urge", "Psychic Intrusion", "Stolen Goods"])("%s casts a card an opponent owns", (thief) => {
  test.each(["Artisan of Kozilek", "Echo Storm"])("no self reason with %s's own 'when you cast this spell'", (self) => {
    expect(castTags(thief, self)).toEqual([]);
  });
  test.each(["Talrand, Sky Summoner", "Monastery Swiftspear", "Nita, Forum Conciliator"])("still feeds %s, which hears any spell you cast", (payoff) => {
    expect(castTags(thief, payoff)).not.toEqual([]);
  });
});
// Hidetsugu and Kairi casts off YOUR library, so a deck-mate is possible, but only "if it's an instant or sorcery card": the cast emit carries that type. A creature's own "when you cast or cycle this"
// (Drownyard Lurker, Warped Tusker) is never what it casts; an instant's own cast trigger is (Contractual Safeguard's addendum).
test.each(["Drownyard Lurker", "Warped Tusker"])("Hidetsugu and Kairi casts only an instant or sorcery: no self reason with the creature %s", (creature) => {
  expect(castTags("Hidetsugu and Kairi", creature)).toEqual([]);
});
test("Hidetsugu and Kairi can cast a deck-mate instant: Contractual Safeguard's own cast trigger hears it", () => {
  expect(castTags("Hidetsugu and Kairi", "Contractual Safeguard")).not.toEqual([]);
});
