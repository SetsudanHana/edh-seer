import { expect, test } from "vitest";
import { deriveCardTags, deriveInputOf } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import type { DeckCard } from "./types.js";
import fixtures from "./fixtures/player-counters.json" with { type: "json" };

/** #1526: energy, experience, poison, rad and ticket counters go on a PLAYER (CR 107.14, 107.17, 122.1f, 122.1i), so they never feed a payoff for counters on a creature or permanent. A proliferate
 *  chooses players too and still takes them. Source documents and stored `cardClauses.canonical` dumped from Mongo 2026-11-05. */
const F = fixtures as unknown as Record<string, { source: Record<string, unknown>; canonical: ClauseRecord[] }>;
const dc = (name: string): DeckCard => ({
  card: F[name]!.source as unknown as DeckCard["card"],
  tags: deriveCardTags(deriveInputOf(F[name]!.source as never, name, name, F[name]!.canonical)) as CardTags,
});
const H = loadHierarchy();
const counterReasons = (a: string, b: string) => pairReasons(dc(a), dc(b), H).filter((r) => r.producer === a && r.consumer === b && r.tag.startsWith("counter-added"));

test.each([
  ["Aether Herder", "Generous Patron"],
  ["Aether Herder", "Kros, Defense Contractor"],
  ["Aether Herder", "Bold Plagiarist"],
  ["Crypt Cobra", "Bold Plagiarist"],
  ["Meren of Clan Nel Toth", "Generous Patron"],
])("a player counter feeds no payoff for counters on a creature (%s -> %s)", (producer, consumer) => {
  expect(counterReasons(producer, consumer)).toEqual([]);
});

test.each([
  ["Aether Herder", "Atraxa, Praetors' Voice"],
  ["Harnessed Lightning", "Contentious Plan"],
  ["Crypt Cobra", "Contentious Plan"],
  ["Meren of Clan Nel Toth", "Atraxa, Praetors' Voice"],
  ["Aether Herder", "Territorial Gorger"],
  ["Harnessed Lightning", "Territorial Gorger"],
])("a player counter still feeds a proliferate or a player-counter payoff (%s -> %s)", (producer, consumer) => {
  expect(counterReasons(producer, consumer)).not.toEqual([]);
});
