import { expect, test } from "vitest";
import { deriveCardTags, deriveInputOf } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import type { DeckCard } from "./types.js";
import fixtures from "./fixtures/exiled-counters.json" with { type: "json" };

/** #1523 part 1: a counter put on a card in EXILE ("exile that card with a blood counter on it") is on no battlefield permanent, so it reaches no battlefield counter payoff
 *  (Generous Patron's "a creature you don't control", Aragorn's "put counters on Aragorn"). Source documents and stored `cardClauses.canonical` dumped from Mongo 2026-11-05. */
const F = fixtures as unknown as Record<string, { source: Record<string, unknown>; canonical: ClauseRecord[] }>;
const dc = (name: string): DeckCard => ({
  card: F[name]!.source as unknown as DeckCard["card"],
  tags: deriveCardTags(deriveInputOf(F[name]!.source as never, name, name, F[name]!.canonical)) as CardTags,
});
const H = loadHierarchy();
const counterReasons = (a: string, b: string) => pairReasons(dc(a), dc(b), H).filter((r) => r.tag.startsWith("counter-added"));

test.each([
  ["Rayami, First of the Fallen", "Generous Patron"],
  ["Rayami, First of the Fallen", "Kros, Defense Contractor"],
  ["Rayami, First of the Fallen", "Bold Plagiarist"],
  ["Darigaaz Reincarnated", "Aragorn, Company Leader"],
  ["Delay", "Generous Patron"],
])("%s's counter on an exiled card feeds no battlefield counter payoff (%s)", (producer, consumer) => {
  expect(counterReasons(producer, consumer)).toEqual([]);
});

test.each([
  ["Spaceshift", "Hardened Scales"],
  ["Daydream", "Hardened Scales"],
  ["Cathars' Crusade", "Hardened Scales"],
])("a +1/+1 counter put on a returned or battlefield creature still feeds %s -> %s", (producer, consumer) => {
  expect(counterReasons(producer, consumer)).not.toEqual([]);
});

// Rift Elemental's cost removes a time counter "from a permanent you control OR SUSPENDED CARD you own": a suspend-style time counter on an exiled card is a true supply (CR 702.62a: suspend exiles the card with time counters).
// Kate Stewart's "time counters on a permanent you control" is not.
test.each(["Delay", "Taigam, Master Opportunist"])("%s's time counter on an exiled card feeds Rift Elemental's suspended-card cost, not Kate Stewart", (producer) => {
  expect(pairReasons(dc(producer), dc("Rift Elemental"), H).some((r) => r.tag.startsWith("counter-removed"))).toBe(true);
  expect(counterReasons(producer, "Kate Stewart")).toEqual([]);
});

// #1523 part 2: "exile it and put a hit counter on it" (and "Put three time counters on it" in the next sentence) is the same exiled-card counter as the "with a counter on it" shape.
// Stored `cardClauses.canonical` dumped from Mongo 2026-11-05.
const PUT_SHAPE = [
  "Etrata, the Silencer", "Ravenloft Adventurer", "Jhoira of the Ghitu", "Mairsil, the Pretender", "Tasha, the Witch Queen", "Suspend", "Sinister Concierge",
  "The Tenth Doctor", "Kang Prime", "Zethi, Arcane Blademaster", "Lara Croft, Tomb Raider", "The Master, Formed Anew", "Alaundo the Seer", "The Parting of the Ways",
];
// These also put a +1/+1 counter on a battlefield permanent (Pako on itself, Flamewar and Nassari on themselves, Kianne's Fractal, Cosima's return), which proliferate and Hardened Scales rightly still read.
const ALSO_BATTLEFIELD = [
  "Pako, Arcane Retriever", "Flamewar, Brash Veteran // Flamewar, Streetwise Operative", "Uvilda, Dean of Perfection // Nassari, Dean of Expression",
  "Kianne, Dean of Substance // Imbraham, Dean of Theory", "Cosima, God of the Voyage // The Omenkeel",
];
const PAYOFFS = ["Generous Patron", "Kros, Defense Contractor", "Atraxa, Praetors' Voice", "Hardened Scales"];
test.each([...PUT_SHAPE.flatMap((p) => PAYOFFS.map((c) => [p, c] as const)), ...ALSO_BATTLEFIELD.flatMap((p) => PAYOFFS.slice(0, 2).map((c) => [p, c] as const))])("%s's counter put on the card it exiled feeds no battlefield counter payoff (%s)", (producer, consumer) => {
  expect(counterReasons(producer, consumer)).toEqual([]);
});

// Controls: the exile is not the counter's recipient, or the card is back on the battlefield.
test.each([
  ["Constrictor Sage", "Generous Patron"],   // "Exile this card from your graveyard: Tap target creature ... and put a stun counter on it" (exile is the cost)
  ["Hallowed Respite", "Hardened Scales"],   // "exile ..., then return it ... put a +1/+1 counter on it"
  ["Sequence Engine", "Hardened Scales"],    // "exile ... from a graveyard. Create a token. Put X +1/+1 counters on it"
  ["Myra the Magnificent", "Generous Patron"], // the midway counter is on an Attraction
])("%s's counter is on a battlefield object and still feeds %s", (producer, consumer) => {
  expect(counterReasons(producer, consumer)).not.toEqual([]);
});

test("the stamped producers keep their emits: Jhoira's time counters still feed Rift Elemental's suspended-card cost", () => {
  expect(pairReasons(dc("Jhoira of the Ghitu"), dc("Rift Elemental"), H).some((r) => r.tag.startsWith("counter-removed"))).toBe(true);
});
