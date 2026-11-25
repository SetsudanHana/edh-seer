import { expect, test } from "vitest";
import { ComboIndex } from "@edh-seer/engine";
import { deriveCardTags, deriveInputOf, grammarClauseRecords } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { analyzeDeckStructured } from "./analyze.js";
import { loadHierarchy, pairReasons } from "./index.js";
import type { DeckCard } from "./types.js";
import fixtures from "./fixtures/token-first-827.json" with { type: "json" };

/** #827 (persona round 2026-09-29, first-cuts seat): the deck's Cards page said "When Krenko, Mob Boss enters, Impact Tremors deals 1 damage" for a pair whose synergy is the Goblins Krenko makes every turn. The partner's reasons are the pair's DIRECT reasons first and the
 *  token hop's after, so the row, which prints the first, named Krenko's own single entry. Krenko is a creature that enters once, so that reason is true, and it stays: but it is the baseline (the card's own implied entry, once), and the reason a token adds on the same
 *  tag (a Goblin enters, every turn) is the one that carries the synergy, so it is said first. Stored documents of the production corpus (allParts included), 2026-11-25. */
type Fx = { source: Record<string, unknown> & { _id: string }; canonical: ClauseRecord[] | null };
const F = fixtures as unknown as Record<string, Fx>;
const dc = (name: string): DeckCard => {
  const src = F[name]!.source;
  const g = F[name]!.canonical === null ? grammarClauseRecords(src as never) : undefined;
  return { card: src as unknown as DeckCard["card"], tags: deriveCardTags(deriveInputOf(src as never, name, name, g ? g.records : F[name]!.canonical!, undefined, g?.readings)) as CardTags };
};
const goblin = (F as unknown as Record<string, { printingId: string; tags: CardTags }>)["__goblin"]!;
const MOUNTAIN = { card: { name: "Mountain", typeLine: "Basic Land — Mountain", oracleText: "{T}: Add {R}.", keywords: [], colors: [], manaValue: 0 }, tags: null } as unknown as DeckCard;

const report = () => analyzeDeckStructured(
  [dc("Krenko, Mob Boss"), dc("Impact Tremors"), dc("Mana Echoes"), dc("General Kreat, the Boltbringer"), dc("Goblin Chieftain"), ...Array.from({ length: 20 }, () => MOUNTAIN)],
  ["Krenko, Mob Boss"], loadHierarchy(), undefined, new ComboIndex([]), undefined,
  (ref) => (ref.printingId === goblin.printingId ? goblin.tags : null), undefined, [], [], { skipSimulation: true },
);
const partnerTexts = (card: string, partner: string) => report().cards.find((c) => c.name === card)!.topPartners!.find((p) => p.name === partner)!.reasons.map((r) => r.text);

test("the oracle text the issue reads (Krenko makes Goblins per Goblin; Impact Tremors fires on a creature entering)", () => {
  expect(F["Krenko, Mob Boss"]!.source.oracleText).toBe("{T}: Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control.");
  expect(F["Impact Tremors"]!.source.oracleText).toBe("Whenever a creature you control enters, this enchantment deals 1 damage to each opponent.");
});

test.each([
  ["Impact Tremors", "Krenko, Mob Boss"],
  ["Impact Tremors", "General Kreat, the Boltbringer"],
  ["Mana Echoes", "Krenko, Mob Boss"],
  ["Mana Echoes", "General Kreat, the Boltbringer"],
])("%s x %s: the first sentence names the Goblins that enter, not the maker's own entry", (card, partner) => {
  const texts = partnerTexts(card, partner);
  expect(texts[0], `${card} x ${partner}`).toMatch(/^When Goblin enters, /);
  // the maker's own entry is still said, after it
  expect(texts.some((t) => t.startsWith(`When ${partner} enters, `)), "own entry kept").toBe(true);
});

test("a pair with no token hop keeps its order (Goblin Chieftain x Impact Tremors: a card, no token reason)", () => {
  const texts = partnerTexts("Impact Tremors", "Goblin Chieftain");
  expect(texts[0]).toBe("When Goblin Chieftain enters, Impact Tremors deals 1 damage");
});

test("the card-to-card reasons themselves are unchanged: pairReasons still says the maker's entry (the card page without token nodes keeps its two)", () => {
  const rs = pairReasons(dc("Krenko, Mob Boss"), dc("Impact Tremors"), loadHierarchy(), { tokensMediate: false }).filter((r) => r.tag === "enters:creature").map((r) => r.text);
  expect(rs).toEqual(["When a Goblin enters thanks to Krenko, Mob Boss, Impact Tremors deals 1 damage", "When Krenko, Mob Boss enters, Impact Tremors deals 1 damage"]);
});
