import { expect, test } from "vitest";
import { ComboIndex, loadImpactWeights } from "@edh-seer/engine";
import { deriveCardTags, deriveInputOf, grammarClauseRecords } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { analyzeDeckStructured } from "./analyze.js";
import { loadHierarchy, pairReasons } from "./index.js";
import { computeCardBuckets } from "./buckets.js";
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

// REVIEW OF #1815. A Role is an Aura, not a creature (CR 303.7: "Some Aura enchantments also have the subtype Role."): its create-token emit has no `type`, and the loose token-count maker test let it stand in for a creature token.
test.each(["Unassuming Sage", "Cut In"])("%s makes a Role token, which no creature-token count counts (waterbend, Magnus the Red)", (maker) => {
  for (const c of [...CONSUMERS, "Magnus the Red"]) {
    for (const opts of [{}, { tokensMediate: false }]) {
      expect(reasons(dc(maker), dc(c), opts).filter((x) => x.tag === "scales:creature"), `${maker} -> ${c} ${JSON.stringify(opts)}`).toEqual([]);
    }
  }
});

test("a real creature-token maker still feeds Magnus the Red's count (Harried Dronesmith)", () => {
  expect(reasons(dc("Harried Dronesmith"), dc("Magnus the Red"), { tokensMediate: false }).map((x) => x.tag)).toContain("scales:creature");
});

// A waterbend count pays for ITS OWN card's cost, never for other spells: the deck-level readers (theme tags, the Ramp Payoff archetype, the "fueled by" line, the efficiency bucket) read `cost-reduction` as a discount on spells and must skip it.
test("a deck of waterbend cards has no Cost reducers theme, no Ramp Payoff archetype, no cost-reduction engine line and no efficiency", () => {
  const MOUNTAIN = { card: { name: "Mountain", typeLine: "Basic Land — Mountain", oracleText: "{T}: Add {R}.", keywords: [], colors: [], manaValue: 0 }, tags: null } as unknown as DeckCard;
  const names = ["Geyser Leaper", "Water Whip", "Waterbending Lesson", "Hama, the Bloodbender", "Katara, Water Tribe's Hope", "Giant Koi", "Grizzly Bears"];
  const r = analyzeDeckStructured([...names.map(dc), ...Array.from({ length: 12 }, () => MOUNTAIN)], [], loadHierarchy(), undefined, new ComboIndex([]), undefined,
    (ref) => tokens[ref.printingId ?? ""]?.tags ?? null, undefined, [], [], { skipSimulation: true });
  expect(r.themes.map((t) => t.tag)).not.toContain("static:cost-reduction");
  expect((r.archetypes ?? []).map((a) => a.category)).not.toContain("mana-ramp-payoff");
  expect(r.identity?.engine ?? "").not.toMatch(/cost reduction/);
  expect(computeCardBuckets(dc("Geyser Leaper").tags!, loadImpactWeights()).efficiency).toBe(0);
});

test("only the Role subtype is refused: Loki, the Deceiver's typeless token COPY of a Villain is still a creature token for the count; Living Lectern (a Role maker) is not", () => {
  expect(reasons(dc("Loki, the Deceiver"), dc("Geyser Leaper"), { tokensMediate: false }).map((x) => x.tag)).toContain("scales:creature");
  expect(reasons(dc("Living Lectern"), dc("Geyser Leaper"), { tokensMediate: false }).filter((x) => x.tag === "scales:creature")).toEqual([]);
});

// #1815 re-review: the similar-cards comparison read the waterbend count as a "cost reduction" effect (an emit-less ability's effect kind
// rides along as a pseudo-output). It is the card's own cost, not an effect it has: Geyser Leaper compares with its waterbend count removed
// exactly as with it in.
test("similar cards: the waterbend count is no effect of the card (Geyser Leaper compares the same with or without it)", async () => {
  const { compareCards } = await import("./similar.js");
  const leaper = dc("Geyser Leaper");
  const stripped: DeckCard = { ...leaper, tags: { ...leaper.tags!, abilities: leaper.tags!.abilities.filter((a) => a.effect?.costOf !== "waterbend") } };
  const other = dc("Merfolk Looter");
  expect(compareCards(leaper as never, other as never)).not.toBeNull();
  expect(compareCards(leaper as never, other as never)).toEqual(compareCards(stripped as never, other as never));
});
