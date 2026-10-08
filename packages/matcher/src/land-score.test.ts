import { expect, test } from "vitest";
import type { Card } from "@edh-seer/engine";
import { basicsFloor, betterLand, colourReplacements, landFacts, neededColours } from "./land-score.js";
import type { DeckCard } from "./types.js";

const dc = (name: string, typeLine: string, oracleText: string, producedMana: string[] = [], kinds: string[] = [], manaCost?: string): DeckCard => ({
  card: { name, typeLine, oracleText, keywords: [], colors: [], manaValue: 0, producedMana, ...(manaCost ? { manaCost } : {}) } as Card,
  tags: { abilities: kinds.map((k) => ({ kind: "activated", effect: { kind: k } })) } as unknown as DeckCard["tags"],
});

const shrine = dc("Godless Shrine", "Land — Plains Swamp", "({T}: Add {W} or {B}.)\nAs Godless Shrine enters, you may pay 2 life. If you don't, it enters tapped.", ["W", "B"]);
const barrens = dc("Scoured Barrens", "Land", "Scoured Barrens enters tapped.\nWhen Scoured Barrens enters, you gain 1 life.\n{T}: Add {W} or {B}.", ["W", "B"], ["lifegain", "mana-generation"]);
const plains = dc("Plains", "Basic Land — Plains", "({T}: Add {W}.)", ["W"]);
const locthwain = dc("Castle Locthwain", "Legendary Land", "Castle Locthwain enters tapped unless you control a Swamp.\n{T}: Add {B}.\n{1}{B}{B}, {T}: Draw a card, then you lose life equal to the number of cards in your hand.", ["B"], ["mana-generation", "draw-card"]);
const temple = dc("Temple of Silence", "Land", "Temple of Silence enters tapped.\nWhen Temple of Silence enters, scry 1.\n{T}: Add {W} or {B}.", ["W", "B"], ["scry", "mana-generation"]);
const tower = dc("Command Tower", "Land", "{T}: Add one mana of any color in your commander's color identity.", ["W", "U", "B", "R", "G"], ["mana-generation"]);
const spells = [dc("Swords to Plowshares", "Instant", "", [], [], "{W}"), dc("Doom Blade", "Instant", "", [], [], "{1}{B}")];
const needed = neededColours([...spells, shrine]);

test("the needed colours are the deck's spells' pips, never a land's", () => {
  expect([...needed].sort()).toEqual(["B", "W"]);
});

test("a shock land never enters tapped; a gain land always; a check land some turns", () => {
  expect(landFacts(shrine, needed, []).tapped).toBe(0);
  expect(landFacts(barrens, needed, []).tapped).toBe(2);
  expect(landFacts(locthwain, needed, []).tapped).toBe(1);
});

// CR 305.6: A BASIC LAND TYPE IS A MANA ABILITY, printed only as reminder text, which is not read.
test("a basic land type makes its colour: a shock land's reminder text is not needed", () => {
  expect(landFacts(shrine, needed, []).colours).toEqual(["W", "B"]);
  expect(landFacts(plains, needed, []).colours).toEqual(["W"]);
});

test("colours count only when the deck asks for them", () => {
  expect(landFacts(tower, needed, []).colours).toEqual(["W", "B"]);
});

test("the shock land is strictly better than the gain land: the life was for entering tapped", () => {
  expect(landFacts(barrens, needed, []).utility).toEqual([]);
  expect(betterLand(landFacts(barrens, needed, []), landFacts(shrine, needed, []))).toEqual({ ok: true, untapped: true, colours: [] });
  expect(betterLand(landFacts(temple, needed, []), landFacts(shrine, needed, [])).ok).toBe(true);
});

test("a dual is strictly better than a basic on colour, and never the other way round", () => {
  expect(betterLand(landFacts(plains, needed, []), landFacts(shrine, needed, []))).toEqual({ ok: true, untapped: false, colours: ["B"] });
  expect(betterLand(landFacts(shrine, needed, []), landFacts(plains, needed, [])).ok).toBe(false);
});

test("a land that does something else is never cut for one that does not", () => {
  expect(landFacts(locthwain, needed, []).utility).toContain("draw-card");
  expect(betterLand(landFacts(locthwain, needed, []), landFacts(shrine, needed, [])).ok).toBe(false);
});

test("a tapped land is never better than an untapped one, whatever its colours", () => {
  expect(betterLand(landFacts(plains, needed, []), landFacts(barrens, needed, [])).ok).toBe(false);
});

// docs/plans/2026-10-04-mana-base-quality.md F7: "Battlefield Forge -> Tournament Grounds: never enters
// tapped and makes white, black or red" was offered on 27 precon pages. The restriction is the sentence
// after the mana line, so the colours were read as free.
test("mana spendable only on some spells makes no colour, and marks the land conditional", () => {
  const grounds = dc("Tournament Grounds", "Land", "{T}: Add {C}.\n{T}: Add {R}, {W}, or {B}. Spend this mana only to cast a Knight or Equipment spell.", ["C", "R", "W", "B"]);
  const forge = dc("Battlefield Forge", "Land", "{T}: Add {C}.\n{T}: Add {R} or {W}. Battlefield Forge deals 1 damage to you.", ["C", "R", "W"]);
  const rw = new Set(["R", "W"] as const);
  expect(landFacts(grounds, rw, []).colours).toEqual([]);
  expect(landFacts(grounds, rw, []).utility).toContain("conditional-mana");
  expect(betterLand(landFacts(forge, rw, []), landFacts(grounds, rw, [])).ok).toBe(false);
});

test("the basics floor is what the deck's own cards search for", () => {
  const landscape = dc("Myriad Landscape", "Land", "Myriad Landscape enters tapped.\n{T}: Add {C}.\n{2}, {T}, Sacrifice Myriad Landscape: Search your library for up to two basic land cards that share a land type, put them onto the battlefield tapped, then shuffle.", ["C"]);
  const wilds = dc("Evolving Wilds", "Land", "{T}, Sacrifice Evolving Wilds: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.");
  expect(basicsFloor([landscape, wilds, plains, shrine])).toBe(3);
  expect(basicsFloor([shrine, plains])).toBe(0);
});

// OWNER RULINGS 2026-10-08 (#966 T3): trade what makes none of the colour first, lands before rocks;
// then what makes it but is not online in time; never fast mana, a utility land, or a commander.
const rock = (name: string, mv: number, text: string, made: string[]): DeckCard => ({
  card: { name, typeLine: "Artifact", oracleText: text, keywords: [], colors: [], manaValue: mv, producedMana: made } as Card,
  tags: null,
});
const izzetSpells = [dc("Counterspell", "Instant", "", [], [], "{U}{U}"), dc("Lightning Bolt", "Instant", "", [], [], "{R}")];
const mountain = dc("Mountain", "Basic Land — Mountain", "({T}: Add {R}.)", ["R"]);
const gate = dc("Izzet Guildgate", "Land — Gate", "Izzet Guildgate enters tapped.\n{T}: Add {U} or {R}.", ["U", "R"]);
const vents = dc("Steam Vents", "Land — Island Mountain", "({T}: Add {U} or {R}.)\nAs Steam Vents enters, you may pay 2 life. If you don't, it enters tapped.", ["U", "R"]);
const diamond = rock("Fire Diamond", 2, "Fire Diamond enters tapped.\n{T}: Add {R}.", ["R"]);
const solRing = rock("Sol Ring", 1, "{T}: Add {C}{C}.", ["C"]);
const bog = dc("Bojuka Bog", "Land", "Bojuka Bog enters tapped.\nWhen Bojuka Bog enters, exile target player's graveyard.\n{T}: Add {B}.", ["B"], ["graveyard-hate", "mana-generation"]);
const deckOf = (...more: DeckCard[]) => [...izzetSpells, ...more];

test("short on blue by turn 2: the always-tapped blue gate (nothing lost) before the red-only land; Sol Ring and Steam Vents are never named", () => {
  expect(colourReplacements(deckOf(mountain, diamond, gate, solRing, vents), "U", 2, { U: 4 })).toEqual(["Izzet Guildgate", "Mountain"]);
});

test("with no other source, the always-tapped blue dual is named: it makes blue but never in time", () => {
  expect(colourReplacements(deckOf(gate, solRing, vents), "U", 2, { U: 4 })).toEqual(["Izzet Guildgate"]);
});

test("a rock that makes the colour is never named, however late it is: Arcane Signet and Sceptre-shaped rocks stay", () => {
  const sapphire = rock("Sapphire Medallion", 3, "{T}: Add {U}.", ["U"]);
  const signet = rock("Arcane Signet", 2, "{T}: Add one mana of any color in your commander's color identity.", ["W", "U", "B", "R", "G"]);
  const sceptre = rock("Sceptre of Eternal Glory", 3, "{T}: Add one mana of any color.", ["W", "U", "B", "R", "G"]);
  expect(colourReplacements(deckOf(sapphire, signet, sceptre), "U", 2, { U: 2 })).toEqual([]);
});

const withTags = (d: DeckCard, kinds: [string, string][]): DeckCard => ({
  ...d, tags: { abilities: kinds.map(([kind, k]) => ({ kind, effect: { kind: k } })) } as unknown as DeckCard["tags"],
});

test("only plain rocks are named: a sacrifice outlet, a win condition and a play-from-top artifact are refused; a Mind Stone is not", () => {
  const altar = withTags(rock("Ashnod's Altar", 3, "Sacrifice a creature: Add {C}{C}.", ["C"]), [["activated", ""], ["activated", "mana-generation"]]);
  const stadium = withTags(rock("Strixhaven Stadium", 3, "{T}: Add {C}. Put a point counter on this artifact.\nWhenever a creature deals combat damage to you, remove a point counter from this artifact.", ["C"]),
    [["activated", "mana-generation"], ["activated", "counter-placement"], ["triggered", ""]]);
  const skull = withTags(rock("Crystal Skull, Isu Spyglass", 2, "You may look at the top card of your library any time.\n{T}: Add {C}.", ["C"]),
    [["static", "play-from-top"], ["activated", "mana-generation"]]);
  const stone = withTags(rock("Mind Stone", 2, "{T}: Add {C}.\n{1}, {T}, Sacrifice this artifact: Draw a card.", ["C"]),
    [["activated", "mana-generation"], ["activated", ""], ["activated", "draw-card"]]);
  expect(colourReplacements(deckOf(altar, stadium, skull), "U", 2, { U: 4 })).toEqual([]);
  expect(colourReplacements(deckOf(altar, stadium, skull, stone), "U", 2, { U: 4 })).toEqual(["Mind Stone"]);
});

test("a name appears once however many copies of the basic the deck runs", () => {
  expect(colourReplacements(deckOf(mountain, mountain, mountain, diamond), "U", 2, { U: 4 })).toEqual(["Mountain", "Fire Diamond"]);
});

test("a land that does something besides make mana, a commander, and a basic of another short colour are never named", () => {
  const swamp = dc("Swamp", "Basic Land — Swamp", "({T}: Add {B}.)", ["B"]);
  const spellsB = [...izzetSpells, dc("Doom Blade", "Instant", "", [], [], "{1}{B}")];
  const out = colourReplacements([...spellsB, bog, swamp, mountain, diamond], "U", 2, { U: 4, B: 2 }, ["Mountain"]);
  expect(out).toEqual(["Fire Diamond"]);
});

test("a rock's extra activated ability is an upside (primary use, owner 2026-10-08): Ring of the Lucii and Hedron Archive are both named", () => {
  const ring = rock("Ring of the Lucii", 3, "{T}: Add {C}{C}.\n{2}, {T}, Pay 1 life: Tap target nonland permanent.", ["C"]);
  const archive = rock("Hedron Archive", 4, "{T}: Add {C}{C}.\n{2}, {T}, Sacrifice this artifact: Draw two cards.", ["C"]);
  expect(colourReplacements(deckOf(ring), "U", 2, { U: 4 })).toEqual(["Ring of the Lucii"]);
  expect(colourReplacements(deckOf(ring, archive), "U", 2, { U: 4 })).toEqual(["Hedron Archive", "Ring of the Lucii"]);
});

test("among lands of other deck colours, fewer colours made go first: a Mountain before Blood Crypt when green is short", () => {
  const crypt = dc("Blood Crypt", "Land — Swamp Mountain", "({T}: Add {B} or {R}.)\nAs Blood Crypt enters, you may pay 2 life. If you don't, it enters tapped.", ["B", "R"]);
  const spellsG = [dc("Cultivate-ish", "Sorcery", "", [], [], "{G}{G}"), dc("Lightning Bolt", "Instant", "", [], [], "{R}"), dc("Doom Blade", "Instant", "", [], [], "{1}{B}")];
  expect(colourReplacements([...spellsG, crypt, mountain], "G", 2, { G: 4 })).toEqual(["Mountain", "Blood Crypt"]);
});

test("a rock that lets mana be spent as any colour is every colour and is never named (Chromatic Orrery)", () => {
  const orrery = rock("Chromatic Orrery", 7, "You may spend mana as though it were mana of any color.\n{T}: Add {C}{C}{C}{C}{C}.\n{5}, {T}: Draw a card for each color among permanents you control.", ["C"]);
  expect(colourReplacements(deckOf(orrery), "U", 2, { U: 4 })).toEqual([]);
});

test("among other-colour lands of equal colour count, one that deepens no hidden shortfall goes first: Swamp before Island", () => {
  const island = dc("Island", "Basic Land — Island", "({T}: Add {U}.)", ["U"]);
  const swamp = dc("Swamp", "Basic Land — Swamp", "({T}: Add {B}.)", ["B"]);
  const spellsG = [dc("Cultivate-ish", "Sorcery", "", [], [], "{G}{G}"), dc("Counterspell", "Instant", "", [], [], "{U}"), dc("Doom Blade", "Instant", "", [], [], "{1}{B}")];
  // U is short but hidden (one pip), so it is in `anyShort` and not in the shown deficit.
  expect(colourReplacements([...spellsG, island, swamp], "G", 2, { G: 4 }, [], { G: 4, U: 1 })).toEqual(["Swamp", "Island"]);
});

// THE AUDIT'S OWN TEST (mana follow-ups, item 2): a slow land is tapped on turn 2 (one land down) and
// untapped on turn 5, exactly as `manaAudit` counts it, so naming and shortfall cannot disagree.
test("a conditionally tapped land of the colour is named when the audit counts it unavailable by the deadline, and not when it does", () => {
  const coast = dc("Stormcarved Coast", "Land", "Stormcarved Coast enters tapped unless you control two or more other lands.\n{T}: Add {U} or {R}.", ["U", "R"]);
  const deck = deckOf(coast, mountain);
  expect(colourReplacements(deck, "U", 2, { U: 4 })).toEqual(["Stormcarved Coast", "Mountain"]);
  expect(colourReplacements(deck, "U", 5, { U: 4 })).toEqual(["Mountain"]);
});

test("among lands of the colour the audit counts unavailable, always tapped comes before conditionally tapped", () => {
  const coast = dc("Stormcarved Coast", "Land", "Stormcarved Coast enters tapped unless you control two or more other lands.\n{T}: Add {U} or {R}.", ["U", "R"]);
  const zeta = dc("Zeta Gate", "Land — Gate", "Zeta Gate enters tapped.\n{T}: Add {U} or {R}.", ["U", "R"]);
  expect(colourReplacements(deckOf(coast, zeta), "U", 2, { U: 4 })).toEqual(["Zeta Gate", "Stormcarved Coast"]);
});
