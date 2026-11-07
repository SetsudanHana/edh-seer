import { describe, expect, test } from "vitest";
import type { CardTags } from "@edh-seer/tagger";
import { deriveRow } from "../../tagger/src/derive-worker.js";
import { loadHierarchy, pairReasons } from "./index.js";
import type { DeckCard } from "./types.js";
import fixtures from "./reflexive-sacrifice.fixtures.json" with { type: "json" };

/** #1565 -- a REFLEXIVE trigger ("you may sacrifice it. When you do, ...", CR 603.12) follows only its OWN card's sacrifice. Stored `cardClauses.canonical` and `cards`/`tokens` fields,
 *  dumped from Mongo (DERIVE 475 tree, 2026-11-07): `reflexive-sacrifice.fixtures.json`. Cards are derived by production's own `deriveRow` (the card-by-card grammar switch included), so a card
 *  that production reads from the model's answer is read that way here. */
const H = loadHierarchy();
type Fx = { source: Record<string, unknown>; canonical: unknown[]; oracleId?: string };
const TOKEN = "Heart-Piercer Manticore (token)";
const card = (name: string): DeckCard => {
  const fx = (fixtures as Record<string, Fx>)[name]!;
  const src = fx.source as { name: string };
  const row = deriveRow({ doc: { oracleId: fx.oracleId ?? name, name, canonical: fx.canonical } as never, source: fx.source, isToken: name === TOKEN });
  return { card: { ...src, colors: [], manaValue: 0 } as unknown as DeckCard["card"], tags: row.tags as CardTags };
};
/** The same card as if derive had never stamped `trigger.reflexive`: every row below must pair with it, or the row proves nothing. */
const unflagged = (c: DeckCard): DeckCard => ({
  ...c,
  tags: { ...c.tags, abilities: c.tags.abilities.map((a) => (a.trigger?.reflexive ? { ...a, trigger: (({ reflexive: _r, ...t }) => t)(a.trigger) } : a)) } as CardTags,
});
const sacReasons = (producer: DeckCard, consumer: DeckCard) => pairReasons(producer, consumer, H).filter((r) => r.tag.startsWith("sacrifice:"));

const ROWS: [string, string][] = [
  ["Flaxen Intruder", "Viscera Seer"],
  ["The Falcon, Airship Restored", "Mount Doom"],
  [TOKEN, "Sword of the Ages"],
  ["Grist, the Hunger Tide", "Viscera Seer"],
  ["Gorbag of Minas Morgul", "Viscera Seer"],
  ["Caesar, Legion's Emperor", "Viscera Seer"],
  ["Ziatora, the Incinerator", "Viscera Seer"],
  ["Minsc & Boo, Timeless Heroes", "Viscera Seer"],
];

describe("a reflexive sacrifice trigger hears no other card's outlet", () => {
  test.each(ROWS)("%s x %s: no sacrifice reason", (consumer, outlet) => {
    expect(sacReasons(card(outlet), card(consumer)), `${outlet} -> ${consumer}`).toEqual([]);
  });
  test.each(ROWS)("%s x %s: the same pair WITHOUT the flag pairs (the row can fail)", (consumer, outlet) => {
    expect(sacReasons(card(outlet), unflagged(card(consumer))).length, `${outlet} -> ${consumer}`).toBeGreaterThan(0);
  });
  test("Gorbag's and Caesar's mode bullets carry the flag too", () => {
    for (const name of ["Gorbag of Minas Morgul", "Caesar, Legion's Emperor"]) {
      const triggered = card(name).tags.abilities.filter((a) => a.trigger?.verbs.includes("sacrifice"));
      expect(triggered.length, name).toBeGreaterThan(1);
      for (const a of triggered) expect(a.trigger?.reflexive, `${name} clause ${a.clause}`).toBe(true);
    }
  });
  test("the card keeps its own sacrifice supply: Caesar (sacrifice another creature) still feeds a real sacrifice consumer", () => {
    expect(sacReasons(card("Caesar, Legion's Emperor"), card("Korvold, Fae-Cursed King")).length).toBeGreaterThan(0);
  });
  test("control: an ordinary 'Whenever you sacrifice' consumer still pairs with Viscera Seer", () => {
    expect(sacReasons(card("Viscera Seer"), card("Korvold, Fae-Cursed King")).length).toBeGreaterThan(0);
    expect(sacReasons(card("Viscera Seer"), card("Mayhem Devil")).length).toBeGreaterThan(0);
  });
});
