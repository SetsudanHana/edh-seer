import { describe, expect, test } from "vitest";
import { deriveCardTags, deriveInputOf } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import type { DeckCard } from "./types.js";
import fixtures from "./anyof-alternatives.fixtures.json" with { type: "json" };

/** #1575 part 6: A LIST THE GRAMMAR READS AS ALTERNATIVES IS NOT ONE MERGED FILTER, AND LOSES NO PAIR BY IT. Oracle text and clause records are the corpus's own, dumped from Mongo 2026-11-09 (DERIVE 480).
 *  Behemoth's Herald: "Sacrifice a red, green, or white creature". Reign of Terror: "Destroy all green creatures or all white creatures". Spectacular Pileup: "Destroy all creatures and Vehicles". */
type Fx = { source: Record<string, unknown>; canonical: ClauseRecord[] };
const F = fixtures as unknown as Record<string, Fx>;
const H = loadHierarchy();
const D: Record<string, DeckCard> = {};
const card = (name: string): DeckCard => (D[name] ??= { card: F[name]!.source as unknown as DeckCard["card"], tags: deriveCardTags(deriveInputOf(F[name]!.source as never, name, name, F[name]!.canonical)) as CardTags });
const tags = (producer: string, consumer: string) => pairReasons(card(producer), card(consumer), H).filter((r) => r.consumer === consumer).map((r) => r.tag);

describe("a colour disjunction keeps its merged colours: a creature of two of the colours is in both alternatives", () => {
  test.each(["Behemoth's Herald", "Reign of Terror"])("%s -> Rienne, Angel of Rebirth (a multicolored creature that dies) still pairs", (producer) => {
    expect(tags(producer, "Rienne, Angel of Rebirth").some((t) => t.startsWith("dies"))).toBe(true);
  });
  test.each(["Behemoth's Herald", "Reign of Terror"])("%s -> Reborn Hope (return a multicolored creature card) still pairs", (producer) => {
    expect(tags(producer, "Reborn Hope").some((t) => t.startsWith("graveyard-recursion"))).toBe(true);
  });
});

describe("a typed alternative is a typed death", () => {
  test.each(["Blackbloom Rogue // Blackbloom Bog", "Jace's Phantasm"])("Spectacular Pileup (\"Destroy all creatures and Vehicles\") fills an opponent's graveyard for %s", (consumer) => {
    expect(tags("Spectacular Pileup", consumer).some((t) => t.startsWith("threshold"))).toBe(true);
  });
  test("Wrath of God (a plain typed mass death) still does", () => {
    expect(tags("Wrath of God", "Jace's Phantasm").some((t) => t.startsWith("threshold"))).toBe(true);
  });
});

import { cardThemeTags } from "./edges.js";
import { killsOwnCreatures } from "./suggest-static.js";

describe("review round of #1575", () => {
  test("Arcade Gannon (\"an artifact or Human spell\") pairs with no instant or sorcery payoff (Young Pyromancer), and keeps an artifact-cast payoff (Traxos)", () => {
    expect(tags("Arcade Gannon", "Young Pyromancer")).toEqual([]);
    expect(tags("Arcade Gannon", "Traxos, Scourge Eternal").some((t) => t.startsWith("cast"))).toBe(true);
    expect(tags("Arcade Gannon", "Katilda and Lier").some((t) => t.startsWith("cast"))).toBe(true);
  });
  test.each(["Purge", "Nissa's Defeat", "Thraben Exorcism"])("%s: opponent-aimed removal is no theme of the deck (anyOf alternatives count as a permanent)", (name) => {
    const themes = [...cardThemeTags(card(name).tags!)];
    expect(themes.filter((t) => /^(dies|exiled|leaves):/.test(t))).toEqual([]);
  });
  test("Spectacular Pileup (\"creatures and Vehicles\") still kills your own creatures", () => {
    expect(killsOwnCreatures(card("Spectacular Pileup").tags)).toBe(true);
  });
});
