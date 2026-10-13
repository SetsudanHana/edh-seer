/** WHICH CARDS ARE A COLOUR SOURCE, on REAL derived tags (#1169, task 2a). `fixtures/mana-colour-sources.json` holds each named card's
 *  Card document and the mana keys of its production tags, and the whole Gisa deck, dumped from Mongo by
 *  `research/mana/dump-colour-fixtures.mts`: an assertion here is about what the corpus carries and not about a card as remembered. */
import { describe, expect, test } from "vitest";
import fx from "./fixtures/mana-colour-sources.json" with { type: "json" };
import { colourSources } from "./mana-base.js";
import { colourDeficit, manaAuditFull, type Color } from "./mana-audit.js";
import { colourSourceCards } from "./colour-sources.js";
import { deckIdentity, isColourSource, colourSourceColours, makesAnyMana, isFetchSource, cardLines, hasConditionalMana } from "./mana-lines.js";
import { staticFixer } from "./static-fixers.js";
import { landFacts, neededColours } from "./land-score.js";
import { unreadSourceNames } from "./mana-lines.js";
import type { DeckCard } from "./types.js";

const all = fx as unknown as { cards: DeckCard[]; gisa: { deck: DeckCard[] } };
const get = (name: string): DeckCard => {
  const dc = all.cards.find((c) => c.card.name === name || c.card.name.startsWith(`${name} //`));
  expect(dc, `fixture for ${name}`).toBeDefined();
  return dc!;
};
const colours = (name: string, identity: ReadonlySet<string> | null = null) => colourSourceColours(get(name), identity);

describe("a colour source is a repeatable tap or static production you control without consuming anything", () => {
  test("ramp that is not a colour source: Treasure makers, sacrifice, counters, triggers, restrictions, auras", () => {
    for (const n of ["Pitiless Plunderer", "Phyrexian Altar", "Priest of Forgotten Gods", "Birgi, God of Storytelling", "Smokebraider", "Omen Hawker",
      "Cryptic Trilobite", "Utopia Sprawl", "Wild Growth", "Lotus Petal", "Dark Ritual", "Treasure Map"]) {
      expect(colours(n), n).toEqual([]);
      expect(cardLines(get(n)).some(isColourSource), `${n} has a colour-source line`).toBe(false);
    }
    // ...and none of them is a source of any mana either, but for Smokebraider's and Omen Hawker's restricted lines, which are not mana
    // for the deck's spells.
    expect(makesAnyMana(get("Pitiless Plunderer"))).toBe(false);
    expect(makesAnyMana(get("Smokebraider"))).toBe(false);
  });

  test("Honored Hierarch: whatever the corpus says its ungated line makes is all it is credited with", () => {
    const hierarchy = get("Honored Hierarch");
    const ungated = cardLines(hierarchy).filter((l) => l.gate === null && isColourSource(l));
    expect(colours("Honored Hierarch").sort()).toEqual([...new Set(ungated.flatMap((l) => l.colours))].sort());
  });

  test("Sol Ring is colourless: it makes mana and no colour", () => {
    expect(colours("Sol Ring")).toEqual([]);
    expect(makesAnyMana(get("Sol Ring"))).toBe(true);
  });

  test("Arcane Signet makes the commander's colours; with none known, any", () => {
    expect(colours("Arcane Signet", new Set(["B", "R"]))).toEqual(["B", "R"]);
    expect(colours("Arcane Signet")).toEqual(["W", "U", "B", "R", "G"]);
  });

  test("Exotic Orchard: all five for a count, none for a land swap (its colours are the opponents' lands')", () => {
    expect(colours("Exotic Orchard")).toEqual(["W", "U", "B", "R", "G"]);
    expect(colourSourceColours(get("Exotic Orchard"), null, "none")).toEqual([]);
    expect(hasConditionalMana(get("Exotic Orchard"))).toBe(true);
  });

  test("Tainted Peak: the gated line is not credited, only the ungated ones", () => {
    const peak = get("Tainted Peak");
    expect(cardLines(peak).some((l) => l.gate !== null)).toBe(true);
    expect(colours("Tainted Peak")).toEqual([]);
    expect(makesAnyMana(peak)).toBe(true);
  });

  test("Cavern of Souls: the coloured line is restricted, so only the colourless one counts", () => {
    expect(colours("Cavern of Souls")).toEqual([]);
    expect(makesAnyMana(get("Cavern of Souls"))).toBe(true);
  });

  test("a filter land is a full source of both its colours (Cascade Bluffs); Cascading Cataracts is colourless only", () => {
    expect(colours("Cascade Bluffs")).toEqual(["U", "R"]);
    expect(colours("Cascading Cataracts")).toEqual([]);
    expect(makesAnyMana(get("Cascading Cataracts"))).toBe(true);
  });

  test("a basic land type is a mana ability (CR 305.6); a land that makes every land a basic type is one itself (CR 305.7)", () => {
    expect(colours("Plains")).toEqual(["W"]);
    expect(colours("Overgrown Tomb")).toEqual(["B", "G"]);
    expect(colours("Urborg, Tomb of Yawgmoth")).toEqual(["B"]);
    expect(colours("Yavimaya, Cradle of Growth")).toEqual(["G"]);
  });

  test("Chromatic Lantern is a static fixer for lands and also taps for any colour itself", () => {
    expect(staticFixer(get("Chromatic Lantern"))).toEqual({ colours: ["W", "U", "B", "R", "G"], covers: "lands" });
    expect(staticFixer(get("Chromatic Orrery"))).toMatchObject({ covers: "all-mana" });
    expect(colours("Chromatic Lantern")).toEqual(["W", "U", "B", "R", "G"]);
    expect(staticFixer(get("Sol Ring"))).toBeNull();
  });

  test("a transform card's land back never taps for mana from the deck: Treasure Map", () => {
    expect(makesAnyMana(get("Treasure Map"))).toBe(false);
  });
});

describe("a land-fetch counts as a source of what it finds", () => {
  const forest = (n: number): DeckCard[] => Array.from({ length: n }, () => get("Plains"))
    .map((dc, i) => ({ ...dc, card: { ...dc.card, name: `Forest ${i}`, typeLine: "Basic Land — Forest" } }));
  const island = (n: number): DeckCard[] => Array.from({ length: n }, () => get("Plains"))
    .map((dc, i) => ({ ...dc, card: { ...dc.card, name: `Island ${i}`, typeLine: "Basic Land — Island" } }));

  test("Cultivate is a source of every colour the deck's basics can reach, and of none the deck has no basic for", () => {
    const cultivate = get("Cultivate");
    expect(cultivate.tags!.landFetch!.kind).toBe("spell");
    expect(isFetchSource(cultivate)).toBe(true);
    const by = colourSourceCards([cultivate, ...forest(2), ...island(2)], null);
    expect(by.get("G")!.map((d) => d.card.name)).toContain("Cultivate");
    expect(by.get("U")!.map((d) => d.card.name)).toContain("Cultivate");
    expect(by.get("W")!.map((d) => d.card.name)).not.toContain("Cultivate");
  });

  test("a fetch spell is capped at what the deck gives it to find", () => {
    const by = colourSourceCards([get("Cultivate"), get("Cultivate"), get("Cultivate"), ...forest(1)], null);
    // one Forest to find: the three Cultivates are one green source between them, plus the Forest.
    expect(by.get("G")!).toHaveLength(2);
  });

  test("a costed permanent fetch that makes no more than it costs does not count (Myriad Landscape); Wood Elves does", () => {
    expect(isFetchSource(get("Myriad Landscape"))).toBe(false);
    expect(isFetchSource(get("Wood Elves"))).toBe(true);
    expect(isFetchSource(get("Polluted Delta"))).toBe(true);
    expect(isFetchSource(get("Sol Ring"))).toBe(false);
  });
});

describe("the colour audit and the mana base count the same sources (Gisa)", () => {
  const deck = all.gisa.deck;
  const commanders = ["Gisa, the Hellraiser"];

  test("every colour: audit `supplied` equals the mana base's source count", () => {
    expect(deck.some((d) => d.card.name === commanders[0])).toBe(true);
    const base = colourSources(deck, commanders);
    const rows = manaAuditFull(deck, { commanderNames: commanders }).rows;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.supplied, `${row.color}`).toBe(base.get(row.color as Color));
    // Black is the commander's colour and the deck's: a real figure, not a pair of zeroes.
    expect(base.get("B")!).toBeGreaterThan(20);
  });

  test("Gisa's commander identity is black, and Pitiless Plunderer, Phyrexian Altar, Priest and Crypt Ghast's Treasure are no black source", () => {
    expect([...deckIdentity(deck, commanders)!]).toEqual(["B"]);
    const black = colourSourceCards(deck.filter((d) => d.card.name !== commanders[0]), deckIdentity(deck, commanders)).get("B")!.map((d) => d.card.name);
    for (const n of ["Pitiless Plunderer", "Phyrexian Altar", "Priest of Forgotten Gods"]) expect(black, n).not.toContain(n);
  });

  test("a deficit is still a per-colour number", () => {
    expect(Object.keys(colourDeficit(deck, commanders)).every((k) => "WUBRG".includes(k))).toBe(true);
  });
});

describe("land swaps read the same lines", () => {
  test("a filter land is a source of both colours, Cavern of Souls and Exotic Orchard of none", () => {
    const need = neededColours([{ card: { name: "x", typeLine: "Instant", manaCost: "{U}{R}{W}{B}{G}", manaValue: 5, keywords: [], colors: [], oracleText: "" } as never, tags: null }]);
    expect(landFacts(get("Cascade Bluffs"), need, []).colours).toEqual(["U", "R"]);
    expect(landFacts(get("Cavern of Souls"), need, []).colours).toEqual([]);
    expect(landFacts(get("Exotic Orchard"), need, []).colours).toEqual([]);
    expect(landFacts(get("Exotic Orchard"), need, []).utility).toContain("conditional-mana");
    expect(landFacts(get("Overgrown Tomb"), need, []).colours).toEqual(["B", "G"]);
  });
});

describe("a consumed resource in the cost is not a colour source (review of 2a)", () => {
  test("energy, discard, collect evidence, exile from a graveyard, forage: only the free lines count", () => {
    for (const n of ["Aether Hub", "Servant of the Conduit", "Bog Witch", "Cryptex", "Molt Tender"]) {
      expect(colours(n), n).toEqual([]);
    }
    // Aether Hub and Thornvault Forager keep their free lines: {C} and {G}.
    expect(makesAnyMana(get("Aether Hub"))).toBe(true);
    expect(colours("Thornvault Forager")).toEqual(["G"]);
  });
  test("self-mill, exert and untap are not consumed resources: Millikin, Oasis Ritualist's exert line and Benthic Explorers stay sources", () => {
    expect(cardLines(get("Millikin")).some(isColourSource)).toBe(true);
    expect(makesAnyMana(get("Millikin"))).toBe(true);
    // the LINE with the piece in its cost, not the card's other free line
    const exert = cardLines(get("Oasis Ritualist")).find((l) => l.cost.other.some((o) => /^exert\b/i.test(o)));
    expect(exert, "Oasis Ritualist exert line").toBeDefined();
    expect(isColourSource(exert!)).toBe(true);
    const untap = cardLines(get("Benthic Explorers")).find((l) => l.cost.other.some((o) => /^untap\b/i.test(o)));
    expect(untap, "Benthic Explorers untap line").toBeDefined();
    expect(isColourSource(untap!)).toBe(true);
    expect(makesAnyMana(get("Benthic Explorers"))).toBe(true);
    // ...and a piece off the list is a consumed resource on the same shape of line
    expect(isColourSource({ ...exert!, cost: { ...exert!.cost, other: ["Discard a card"] } })).toBe(false);
  });
  test("a self-exile is a one-shot: Ether is no source", () => {
    expect(colours("Ether")).toEqual([]);
  });
});

describe("'among' is bounded by the commander's colours (a CEILING), unread is never a silent zero", () => {
  test("Plaza of Heroes, Mox Amber, Chrome Mox and Faeburrow Elder make the identity's colours", () => {
    const id = new Set(["B", "R"]);
    for (const n of ["Mox Amber", "Chrome Mox", "Faeburrow Elder", "Meteor Crater", "Corrupted Grafstone"]) expect(colours(n, id), n).toEqual(["B", "R"]);
    expect(colours("Tazri, Stalwart Survivor", id), "restricted").toEqual([]);
    expect(colours("Plaza of Heroes", id)).toEqual(["B", "R"]);
  });
  test("Katilda grants 'any of this creature's colors' to each Human: the colours are the grantee's, so she credits none, in any identity", () => {
    const five = new Set(["W", "U", "B", "R", "G"]);
    for (const id of [null, five, new Set(["B", "R"])]) expect(colours("Katilda, Dawnhart Prime", id)).toEqual([]);
    expect(colourSourceColours(get("Katilda, Dawnhart Prime"), five, "none")).toEqual([]);
    expect(cardLines(get("Katilda, Dawnhart Prime")).some((l) => l.anyColour === "grantee")).toBe(true);
    expect(cardLines(get("Katilda, Dawnhart Prime")).some(isColourSource)).toBe(false);
  });
  test("a colour chosen as part of the ability is any colour, like Birds of Paradise's (Loot, the Nexus, Nyx Lotus)", () => {
    for (const n of ["Loot, the Nexus", "Nyx Lotus"]) {
      expect(colours(n), n).toEqual(["W", "U", "B", "R", "G"]);
      expect(cardLines(get(n)).some((l) => l.anyColour === "any"), n).toBe(true);
    }
  });
  test("for land swaps an 'among' land is conditional and makes no colour: Plaza of Heroes, The Grey Havens", () => {
    const need = new Set(["W", "U", "B", "R", "G"] as const);
    for (const n of ["Plaza of Heroes", "The Grey Havens"]) {
      expect(landFacts(get(n), need, []).colours, n).toEqual([]);
      expect(landFacts(get(n), need, []).utility, n).toContain("conditional-mana");
    }
  });
  test("a line derive could not read is no colour, and the audit names the card", () => {
    expect(colours("Charmed Pendant")).toEqual([]);
    expect(unreadSourceNames([get("Charmed Pendant"), get("Sol Ring")])).toEqual(["Charmed Pendant"]);
    const spell = { card: { name: "x", typeLine: "Instant", manaCost: "{B}", manaValue: 1, keywords: [], colors: [], oracleText: "" }, tags: null } as unknown as DeckCard;
    const out = manaAuditFull([get("Charmed Pendant"), get("Sol Ring"), spell]);
    expect(out.unreadSources).toEqual(["Charmed Pendant"]);
    expect(manaAuditFull([get("Sol Ring"), spell]).unreadSources).toBeUndefined();
  });
});

describe("an Aura's trigger is not a colour source, so it is no colour swap either", () => {
  test("Fertile Ground makes no colour for a swap", () => {
    expect(colours("Fertile Ground")).toEqual([]);
    expect(cardLines(get("Fertile Ground")).some((l) => l.source === "aura-trigger")).toBe(true);
  });
});

// THE LOYALTY TEST APPLIES TO COLOUR SOURCES TOO (owner 2026-10-13): a walker's loyalty ability is a colour source only if the walker can activate it the turn it is
// cast. Nissa, Worldwaker (-7 from loyalty 3) is NOT a Forest colour source any more -- correct, not a regression: it was counted before 2b-1 only because the
// loyalty cost was never compared with the loyalty. `paidWithResource` lets a loyalty cost through, so the colour path asks `usableLoyalty` itself.
describe("a loyalty ability is a colour source only if the walker can activate it the turn it is cast (owner 2026-10-13)", () => {
  const lantern = cardLines(get("Chromatic Lantern")).find((l) => l.source === "static-grant")!;
  const withLoyalty = (cost: string, startLoyalty?: number) => ({ ...lantern, cost: { ...lantern.cost, other: [cost] }, ...(startLoyalty !== undefined ? { startLoyalty } : {}) });
  test("the control: the same static-grant line with no loyalty cost is a colour source", () => {
    expect(isColourSource(lantern)).toBe(true);
  });
  test("a -7 from loyalty 3 (Nissa, Worldwaker's shape) and a -N with no known loyalty are no source; a -2 from 3, a +1 and a 0 are", () => {
    expect(isColourSource(withLoyalty("−7", 3))).toBe(false);
    expect(isColourSource(withLoyalty("−2"))).toBe(false);
    expect(isColourSource(withLoyalty("−2", 3))).toBe(true);
    expect(isColourSource(withLoyalty("+1", 4))).toBe(true);
    expect(isColourSource(withLoyalty("0", 3))).toBe(true);
  });
});
