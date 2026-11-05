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
