import { expect, test } from "vitest";
import { ComboIndex } from "@edh-seer/engine";
import type { Combo } from "@edh-seer/engine";
import { deriveCardTags, deriveInputOf, grammarClauseRecords } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { analyzeDeckStructured } from "./analyze.js";
import { loadHierarchy } from "./index.js";
import type { DeckCard } from "./types.js";
import fixtures from "./fixtures/combo-first-827.json" with { type: "json" };

/** #827 review. The token-first order (a token's entry before its maker's own single entry) assumes the token's repeated entry outweighs the maker's one. It does not when the maker's own entry IS the engine: Acererak the Archlich's "When Acererak enters, ...
 *  return Acererak to its owner's hand" re-enters over and over, and Commander Spellbook lists Acererak with Carnival of Souls (and with Ayara) as pieces of a combo found in this deck. The pair keeps its direct entry first. Stored documents, clauses and combo rows of the
 *  production corpus, 2026-11-25. */
type Fx = { source: Record<string, unknown> & { _id: string }; canonical: ClauseRecord[] | null };
const F = fixtures as unknown as Record<string, Fx>;
const dc = (name: string): DeckCard => {
  const src = F[name]!.source;
  const g = F[name]!.canonical === null ? grammarClauseRecords(src as never) : undefined;
  return { card: src as unknown as DeckCard["card"], tags: deriveCardTags(deriveInputOf(src as never, name, name, g ? g.records : F[name]!.canonical!, undefined, g?.readings)) as CardTags };
};
const tokens = (F as unknown as Record<string, Record<string, CardTags>>)["__tokens"]!;
const combos = (F as unknown as Record<string, Combo[]>)["__combos"]!;
const MOUNTAIN = { card: { name: "Mountain", typeLine: "Basic Land — Mountain", oracleText: "{T}: Add {R}.", keywords: [], colors: [], manaValue: 0 }, tags: null } as unknown as DeckCard;
const DECK = ["Acererak the Archlich", "Carnival of Souls", "Semblance Anvil", "Bontu's Monument", "Ayara, First of Locthwain", "Defiler of Flesh", "Jet Medallion"];
const report = (withCombos: boolean) => analyzeDeckStructured(
  [...DECK.map(dc), ...Array.from({ length: 20 }, () => MOUNTAIN)], ["Acererak the Archlich"], loadHierarchy(), undefined, new ComboIndex(withCombos ? combos : []), undefined,
  (ref) => tokens[ref.printingId ?? ""] ?? null, undefined, [], [], { skipSimulation: true },
);
const first = (r: ReturnType<typeof report>, card: string, partner: string) => r.cards.find((c) => c.name === card)!.topPartners!.find((p) => p.name === partner)!.reasons[0]!.text;

test("the combo is found in this deck, and Acererak's text is what the issue read", () => {
  expect(F["Acererak the Archlich"]!.source.oracleText).toContain("When Acererak enters, if you haven't completed Tomb of Annihilation, return Acererak to its owner's hand");
  expect(report(true).combos.map((c) => c.cards.length).sort()).toEqual([4, 5]);
});

test.each(["Carnival of Souls", "Ayara, First of Locthwain"])("%s x Acererak: pieces of one combo found in the deck keep the maker's own entry first", (card) => {
  expect(first(report(true), card, "Acererak the Archlich")?.startsWith(`When Acererak the Archlich enters, ${card}`)).toBe(true);
});

// #1811 (owner ruling 2026-11-26): Acererak's own entry is repeatable (its enters trigger returns it to its owner's hand), so it is no oneshot baseline for the token-first order to demote; the entry leads with or without the combo. The combo guard in analyze.ts is redundant for this card now
// and stays for any maker whose own entry derive still labels oneshot.
test("without the combo in the deck, Acererak's own entry still leads: it is repeatable, so no baseline to demote (Acererak x Carnival of Souls, #1811)", () => {
  expect(first(report(false), "Carnival of Souls", "Acererak the Archlich")).toMatch(/^When Acererak the Archlich enters, Carnival of Souls/);
});

// THE COMBO GUARD STILL BITES for a maker whose own entry stays oneshot (#1811 review): with Acererak's printed self-bounce taken out of
// its text (so `bouncesItselfOnEntry` is false and its own entry is the oneshot baseline again), the combo keeps the maker's entry first,
// and without the combo the token's entry leads. Deleting `!inOneCombo(...)` in analyze.ts fails the first assertion.
test("a oneshot maker in a found combo keeps its own entry first; without the combo the token leads (the #827 guard, exercised)", () => {
  const plain = (name: string): DeckCard => {
    const d = dc(name);
    if (name !== "Acererak the Archlich") return d;
    const text = String((d.card as { oracleText?: string }).oracleText).replace(/return Acererak to its owner's hand and /, "");
    return { ...d, card: { ...d.card, oracleText: text } as DeckCard["card"] };
  };
  const run = (withCombos: boolean) => analyzeDeckStructured(
    [...DECK.map(plain), ...Array.from({ length: 20 }, () => MOUNTAIN)], ["Acererak the Archlich"], loadHierarchy(), undefined, new ComboIndex(withCombos ? combos : []), undefined,
    (ref) => tokens[ref.printingId ?? ""] ?? null, undefined, [], [], { skipSimulation: true },
  );
  expect(first(run(true), "Carnival of Souls", "Acererak the Archlich")).toMatch(/^When Acererak the Archlich enters, Carnival of Souls/);
  expect(first(run(false), "Carnival of Souls", "Acererak the Archlich")).toMatch(/^When Zombie enters, /);
});
