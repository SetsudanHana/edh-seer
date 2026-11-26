import { expect, test } from "vitest";
import { ComboIndex } from "@edh-seer/engine";
import { deriveCardTags, deriveInputOf, grammarClauseRecords } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { analyzeDeckStructured } from "./analyze.js";
import { loadHierarchy, pairReasons } from "./index.js";
import type { DeckCard } from "./types.js";
import fixtures from "./fixtures/waterbend-1815.json" with { type: "json" };

/** #1815, owner ruling 2026-11-26: waterbend (CR 701.67a: "Waterbend [cost]" means "Pay [cost]. For each generic mana in that cost, you may tap an untapped artifact or creature you control rather than pay that mana.") is an artifact demand, as improvise is (#1804), AND a creature demand, as a creature
 *  outlet is: tokens and token makers, not every creature. Stored documents and clauses of the production corpus, 2026-11-26. */
type Fx = { source: Record<string, unknown> & { _id: string }; canonical: ClauseRecord[] | null };
const F = fixtures as unknown as Record<string, Fx>;
const dc = (name: string): DeckCard => {
  const src = F[name]!.source;
  const g = F[name]!.canonical === null ? grammarClauseRecords(src as never) : undefined;
  return { card: src as unknown as DeckCard["card"], tags: deriveCardTags(deriveInputOf(src as never, name, name, g ? g.records : F[name]!.canonical!, undefined, g?.readings)) as CardTags };
};
const tokens = (F as unknown as Record<string, Record<string, { ref: unknown; tags: CardTags }>>)["__tokens"]!;
const thopter = (): DeckCard => ({ card: { name: "Thopter", typeLine: "Token Artifact Creature — Thopter", oracleText: "", keywords: [], colors: [], manaValue: 0 }, tags: Object.values(tokens).find((t) => t.tags.characteristics.subtypes.includes("thopter"))!.tags, isToken: true });
const reasons = (p: DeckCard, c: DeckCard, opts = {}) => pairReasons(p, c, loadHierarchy(), opts).filter((r) => r.consumer === c.card.name && r.producer === p.card.name);
const CONSUMERS = ["Geyser Leaper", "Water Whip", "Waterbending Lesson", "Hama, the Bloodbender", "Katara, Water Tribe's Hope", "Giant Koi"];

test("the cards print the waterbend cost", () => {
  expect(String(F["Geyser Leaper"]!.source.oracleText)).toContain("Waterbend {4}: Draw a card, then discard a card.");
  expect(String(F["Water Whip"]!.source.oracleText)).toContain("As an additional cost to cast this spell, waterbend {5}.");
  expect(String(F["Waterbending Lesson"]!.source.oracleText)).toContain("discard a card unless you waterbend {2}");
});

test.each(CONSUMERS)("%s: an artifact (Sol Ring, Ornithopter) can be tapped to pay its waterbend cost; the sentence says so", (c) => {
  for (const p of ["Sol Ring", "Ornithopter"]) {
    const r = reasons(dc(p), dc(c)).find((x) => x.tag === "scales:artifact");
    expect(r, `${p} -> ${c}`).toBeDefined();
    expect(r!.text).toBe(`${c} can tap ${p} to help pay for its waterbend cost`);
    expect(r!.text).not.toMatch(/counts it|grows|bigger/);
  }
});

test.each(CONSUMERS)("%s: a creature TOKEN and a maker of creature tokens are creature demand; a plain creature (Grizzly Bears) is not", (c) => {
  expect(reasons(thopter(), dc(c)).map((x) => x.tag), `Thopter -> ${c}`).toContain("scales:creature");
  const maker = reasons(dc("Harried Dronesmith"), dc(c), { tokensMediate: false }).filter((x) => x.tag === "scales:creature");
  expect(maker.map((x) => x.text), `Dronesmith -> ${c}`).toEqual([`Harried Dronesmith makes tokens ${c} can tap to help pay for its waterbend cost`]);
  expect(reasons(dc("Grizzly Bears"), dc(c)), `Grizzly Bears -> ${c}`).toEqual([]);
});

test("a waterbend trigger (Avatar Aang) and an opponent's ward (The Unagi of Kyoshi Island) are no demand", () => {
  for (const c of ["Avatar Aang // Aang, Master of Elements", "The Unagi of Kyoshi Island"]) {
    for (const p of ["Sol Ring", "Ornithopter"]) expect(reasons(dc(p), dc(c)).filter((x) => /waterbend/.test(x.text)), `${p} -> ${c}`).toEqual([]);
  }
});

test("in a deck, Sol Ring is a partner of Geyser Leaper with the waterbend sentence and Grizzly Bears is not", () => {
  const MOUNTAIN = { card: { name: "Mountain", typeLine: "Basic Land — Mountain", oracleText: "{T}: Add {R}.", keywords: [], colors: [], manaValue: 0 }, tags: null } as unknown as DeckCard;
  const r = analyzeDeckStructured([dc("Geyser Leaper"), dc("Sol Ring"), dc("Grizzly Bears"), ...Array.from({ length: 12 }, () => MOUNTAIN)], [], loadHierarchy(), undefined, new ComboIndex([]), undefined,
    (ref) => tokens[ref.printingId ?? ""]?.tags ?? null, undefined, [], [], { skipSimulation: true });
  const partner = (name: string) => r.cards.find((c) => c.name === "Geyser Leaper")!.topPartners!.find((p) => p.name === name);
  expect(partner("Sol Ring")?.reasons.map((x) => x.text)).toContain("Geyser Leaper can tap Sol Ring to help pay for its waterbend cost");
  expect(partner("Grizzly Bears")?.reasons.some((x) => /waterbend/.test(x.text)) ?? false).toBe(false);
});
