import { expect, test } from "vitest";
import { deriveCardTags, deriveInputOf } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import type { DeckCard } from "./types.js";
import fixtures from "./fixtures/counter-recipients.json" with { type: "json" };

/** #1522: a counter a card puts on ITSELF lands on a permanent of its own printed types that YOU control, so it never feeds "a creature you don't control" (Generous Patron, Kros) or "an opponent
 *  puts counters" (Bold Plagiarist). Source documents and stored `cardClauses.canonical` dumped from Mongo 2026-11-05. */
const F = fixtures as unknown as Record<string, { source: Record<string, unknown>; canonical: ClauseRecord[] }>;
const dc = (name: string): DeckCard => ({
  card: F[name]!.source as unknown as DeckCard["card"],
  tags: deriveCardTags(deriveInputOf(F[name]!.source as never, name, name, F[name]!.canonical)) as CardTags,
});
const H = loadHierarchy();
const counterReasons = (a: string, b: string) => pairReasons(dc(a), dc(b), H).filter((r) => r.producer === a && r.consumer === b && r.tag.startsWith("counter-added"));

test.each([
  ["Ajani's Pridemate", "Generous Patron"],
  ["Ajani's Pridemate", "Kros, Defense Contractor"],
  ["Ajani's Pridemate", "Bold Plagiarist"],
  ["Drillworks Mole", "Bold Plagiarist"],
  ["Drillworks Mole", "Generous Patron"],
  ["Ich-Tekik, Salvage Splicer", "Generous Patron"],
])("%s's counter on itself feeds no payoff for counters on a creature you don't control (%s)", (producer, consumer) => {
  expect(counterReasons(producer, consumer)).toEqual([]);
});

test.each([
  ["Ajani's Pridemate", "Terrasymbiosis"],
  ["Kros, Defense Contractor", "Generous Patron"],
])("a counter on your own creature, or on target creature an opponent controls, still feeds %s -> %s", (producer, consumer) => {
  expect(counterReasons(producer, consumer)).not.toEqual([]);
});

// An UNTYPED +1/+1 placer that is not marked self ("put a +1/+1 counter on it": Heartfire Hero names itself, Ich-Tekik's creature type is unread) is still a counter you put on your own permanent.
test.each([
  ["Heartfire Hero", "Generous Patron"],
  ["Heartfire Hero", "Kros, Defense Contractor"],
  ["Heartfire Hero", "Bold Plagiarist"],
])("an untyped +1/+1 counter with no stated recipient feeds no payoff for opponents' creatures (%s -> %s)", (producer, consumer) => {
  expect(counterReasons(producer, consumer)).toEqual([]);
});

test("...and still feeds a payoff for your own creatures", () => {
  expect(counterReasons("Heartfire Hero", "Terrasymbiosis")).not.toEqual([]);
});

// #1522 fix round: the counter lands on a permanent an OPPONENT controls, so the payoffs for "a creature you don't control" are fed.
test.each([
  ["Yes Man, Personal Securitron", "Generous Patron"], // "Target opponent gains control of Yes Man. When they do, ... put a quest counter on Yes Man"
  ["Yes Man, Personal Securitron", "Kros, Defense Contractor"],
  ["Jon Irenicus, Shattered One", "Generous Patron"], // "target opponent gains control of up to one target creature you control. Put two +1/+1 counters on it"
  ["Jon Irenicus, Shattered One", "Kros, Defense Contractor"],
])("a counter on a creature handed to an opponent still feeds %s -> %s", (producer, consumer) => {
  expect(counterReasons(producer, consumer)).not.toEqual([]);
});

test("a creature you keep (Rogue Skycaptain) still feeds no payoff for an opponent's creatures", () => {
  expect(counterReasons("Rogue Skycaptain", "Generous Patron")).toEqual([]);
});
