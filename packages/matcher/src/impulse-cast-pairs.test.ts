import { describe, expect, test } from "vitest";
import { deriveCardTags, deriveInputOf } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import type { DeckCard } from "./types.js";
import fixtures from "./fixtures/impulse-cast-pairs.json" with { type: "json" };

/** #1665 (#1608 item 7, owner ruling 2026-11-17): an own-library impulse draw ("Exile the top two cards of your library. Until the end of your next turn, you may play those cards.") derives a cast FROM EXILE, and only a payoff
 *  that asks where the spell was cast from hears it. A cast trigger that states no origin ("whenever you cast a spell", prowess, "an instant or sorcery") does NOT: the plain-trigger case is the one the CEILING at 496 refused to emit.
 *  Source documents and stored `cardClauses.canonical` dumped from Mongo 2026-11-17 (DERIVE 537). */
const F = fixtures as unknown as Record<string, { source: Record<string, unknown>; canonical: ClauseRecord[] }>;
const dc = (name: string): DeckCard => ({
  card: F[name]!.source as unknown as DeckCard["card"],
  tags: deriveCardTags(deriveInputOf(F[name]!.source as never, name, name, F[name]!.canonical)) as CardTags,
});
const H = loadHierarchy();
const castTags = (producer: string, consumer: string) => pairReasons(dc(producer), dc(consumer), H).map((r) => r.tag).filter((t) => t.startsWith("cast:") || t.startsWith("prowess:"));

describe.each(["Light Up the Stage", "Act on Impulse"])("%s: an impulse draw off your own library", (impulse) => {
  test.each(["Kami of Celebration", "Faldorn, Dread Wolf Herald", "Quintorius Kand", "Mizzix, Replica Rider"])("is heard by %s, which asks where the spell was cast from", (payoff) => {
    expect(castTags(impulse, payoff)).not.toEqual([]);
  });
  // The card's own cast (an instant or a sorcery) is heard by every plain trigger that fits it, so the plain payoffs here name a class the impulse card is not: a creature spell, an artifact spell. Only the exile-origin emit
  // could meet them, and it carries no word of where it came from for them.
  test.each(["Beast Whisperer", "Sai, Master Thopterist"])("is NOT heard by %s, a cast trigger with no origin", (plain) => {
    expect(castTags(impulse, plain)).toEqual([]);
  });
  test("is no cast of a card an opponent owns: Nita's 'a spell you don't own' stays deaf", () => {
    expect(castTags(impulse, "Nita, Forum Conciliator")).toEqual([]);
  });
});
