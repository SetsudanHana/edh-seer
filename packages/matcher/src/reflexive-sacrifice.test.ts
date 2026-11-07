import { describe, expect, test } from "vitest";
import { deriveCardTags, deriveInputOf, grammarClauseRecords } from "@edh-seer/tagger";
import type { CardTags } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import type { DeckCard } from "./types.js";
import fixtures from "./reflexive-sacrifice.fixtures.json" with { type: "json" };

/** #1565 -- a REFLEXIVE trigger ("you may sacrifice it. When you do, ...", CR 603.12) follows only its OWN card's sacrifice. Stored `cardClauses.canonical` and `cards` fields,
 *  dumped from Mongo (DERIVE 474 tree, 2026-11-07): `reflexive-sacrifice.fixtures.json`. */
const H = loadHierarchy();
type Fx = { source: Record<string, unknown>; canonical: unknown[] };
const card = (name: string): DeckCard => {
  const fx = (fixtures as Record<string, Fx>)[name]!;
  const src = fx.source as { name: string };
  // The way production reads the card: the grammar's records when it reads the text completely, else the stored canonical clauses.
  const g = grammarClauseRecords(fx.source as never);
  const input = g.complete ? deriveInputOf(fx.source as never, name, name, g.records, undefined, g.readings) : deriveInputOf(fx.source as never, name, name, fx.canonical as never);
  return { card: { ...src, colors: [], manaValue: 0 } as unknown as DeckCard["card"], tags: deriveCardTags(input) as CardTags };
};
const sacTags = (a: DeckCard, b: DeckCard) => pairReasons(a, b, H).filter((r) => r.tag.startsWith("sacrifice:") || r.tag.startsWith("dies:"));

describe("a reflexive sacrifice trigger hears no other card's outlet", () => {
  const seer = card("Viscera Seer");
  test.each([
    ["Flaxen Intruder", "Viscera Seer"],
    ["The Falcon, Airship Restored", "Viscera Seer"],
    ["Heart-Piercer Manticore", "Sword of the Ages"],
    ["The Falcon, Airship Restored", "Mount Doom"],
    ["Grist, the Hunger Tide", "Viscera Seer"],
  ])("%s x %s: no sacrifice reason", (consumer, outlet) => {
    expect(sacTags(card(outlet), card(consumer)).filter((r) => r.tag.startsWith("sacrifice:")), `${outlet} -> ${consumer}`).toEqual([]);
  });
  test("the card keeps its own sacrifice supply: Heart-Piercer Manticore (sacrifice another creature) still feeds a real sacrifice consumer", () => {
    expect(sacTags(card("Heart-Piercer Manticore"), card("Korvold, Fae-Cursed King")).some((r) => r.tag.startsWith("sacrifice:"))).toBe(true);
  });
  test("control: an ordinary 'Whenever you sacrifice' consumer still pairs with Viscera Seer", () => {
    expect(sacTags(seer, card("Korvold, Fae-Cursed King")).some((r) => r.tag.startsWith("sacrifice:"))).toBe(true);
    expect(sacTags(seer, card("Mayhem Devil")).some((r) => r.tag.startsWith("sacrifice:"))).toBe(true);
  });
});
