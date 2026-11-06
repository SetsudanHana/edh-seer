import { expect, test } from "vitest";
import { deriveCardTags, deriveInputOf, grammarClauseRecords } from "@edh-seer/tagger";
import type { CardTags } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import { producerEvents } from "./edges.js";
import type { DeckCard } from "./types.js";

/** AN ANIMATE'S RESULT FEEDS THE KINDRED CARDS THAT REACH IT (#1364 part 2). A permanent that becomes an Elemental / Soldier / Dragon is that kindred while it is a creature, so a lord that names the
 *  kindred reaches it ("Other Soldier creatures get +1/+1": Boros Keyrune's Soldier) and a count of the kindred counts it (Omnath's "number of Elementals you control").
 *  Real oracle text (Mongo `cards`, read 2026-11-06), derived from the grammar's own records. */
const H = loadHierarchy();
function fromText(name: string, typeLine: string, oracleText: string): DeckCard {
  const card = { name, typeLine, oracleText, keywords: [] as string[] };
  const g = grammarClauseRecords(card);
  expect(g.complete, name).toBe(true);
  const tags = deriveCardTags(deriveInputOf(card as never, name, name, g.records, undefined, g.readings)) as CardTags;
  return { card: { ...card, colors: [], manaValue: 0 } as unknown as DeckCard["card"], tags };
}
const keyrune = fromText("Boros Keyrune", "Artifact", "{T}: Add {R} or {W}.\n{R}{W}: This artifact becomes a 1/1 red and white Soldier artifact creature with double strike until end of turn. (It deals both first-strike and regular combat damage.)");
const marshal = fromText("Field Marshal", "Creature — Human Soldier", "Other Soldier creatures get +1/+1 and have first strike. (They deal combat damage before creatures without first strike.)");
const brave = fromText("Brave the Wilds", "Sorcery", "Bargain (You may sacrifice an artifact, enchantment, or token as you cast this spell.)\nIf this spell was bargained, target land you control becomes a 3/3 Elemental creature with haste that's still a land.\nSearch your library for a basic land card, reveal it, put it into your hand, then shuffle.");
const crasher = fromText("Thicket Crasher", "Creature — Elemental Rhino", "Trample (This creature can deal excess combat damage to the player or planeswalker it's attacking.)\nOther Elementals you control have trample.");
const omnath = fromText("Omnath, Locus of the Roil", "Legendary Creature — Elemental", "When Omnath enters, it deals damage to any target equal to the number of Elementals you control.\nLandfall — Whenever a land you control enters, put a +1/+1 counter on target Elemental you control. If you control eight or more lands, draw a card.");
/** Mutavault is not grammar-complete ("all creature types"): its STORED-shape reading (a self animate with the result in the object) is derived. */
const mutaCard = { name: "Mutavault", typeLine: "Land", oracleText: "{T}: Add {C}.\n{1}: This land becomes a 2/2 creature with all creature types until end of turn. It's still a land.", keywords: [] as string[] };
const mutavault: DeckCard = {
  card: { ...mutaCard, colors: [], manaValue: 0 } as unknown as DeckCard["card"],
  tags: deriveCardTags(deriveInputOf(mutaCard as never, "Mutavault", "Mutavault", [
    { id: 1, abilityType: "activated", actions: [{ verb: "add-mana", object: "{C}", fromZone: null, toZone: null, amount: null, optional: false }] },
    { id: 2, abilityType: "activated", actions: [{ verb: "animate", object: "this as a 2/2 creature with all creature types", fromZone: null, toZone: null, amount: null, optional: false }] },
  ] as never)) as CardTags,
};
const crusader = fromText("Akroan Crusader", "Creature — Human Soldier", "Heroic — Whenever you cast a spell that targets this creature, create a 1/1 red Soldier creature token with haste. (It can attack and {T} as soon as it comes under your control.)");
/** Leyline of Resonance is not grammar-complete: its STORED reading (Mongo `cardClauses`, `canonical`, verbatim) is derived. */
const resCard = { name: "Leyline of Resonance", typeLine: "Enchantment", oracleText: "If this card is in your opening hand, you may begin the game with it on the battlefield.\nWhenever you cast an instant or sorcery spell that targets only a single creature you control, copy that spell. You may choose new targets for the copy.", keywords: [] as string[] };
const resonance: DeckCard = {
  card: { ...resCard, colors: [], manaValue: 0 } as unknown as DeckCard["card"],
  tags: deriveCardTags(deriveInputOf(resCard as never, "Leyline of Resonance", "Leyline of Resonance", [
    { id: 1, abilityType: "static", actions: [{ verb: "play", object: "this", fromZone: null, toZone: null, amount: null, optional: true }] },
    { id: 2, abilityType: "triggered", trigger: { event: "cast", subject: "an instant or sorcery spell that targets only a single creature you control", control: "you" }, actions: [{ verb: "copy", object: "that spell", fromZone: null, toZone: null, amount: null, optional: false }] },
  ] as never)) as CardTags,
};
/** Cid is not grammar-complete: its STORED reading (Mongo `cardClauses`, `canonical`, verbatim) is derived. */
const cidCard = { name: "Cid, Timeless Artificer", typeLine: "Legendary Creature — Human Artificer", oracleText: "Artifact creatures and Heroes you control get +1/+1 for each Artificer you control and each Artificer card in your graveyard.\nA deck can have any number of cards named Cid, Timeless Artificer.\nCycling {W}{U} ({W}{U}, Discard this card: Draw a card.)", keywords: [] as string[] };
const cid: DeckCard = {
  card: { ...cidCard, colors: [], manaValue: 0 } as unknown as DeckCard["card"],
  tags: deriveCardTags(deriveInputOf(cidCard as never, "Cid, Timeless Artificer", "Cid, Timeless Artificer", [
    { id: 1, abilityType: "static", actions: [{ verb: "modify-pt", object: "Artifact creatures and Heroes you control", fromZone: null, toZone: null, amount: "+1/+1 for each Artificer you control and each Artificer card in your graveyard", optional: false }] },
    { id: 2, abilityType: "static", actions: [{ verb: "other", object: "A deck can have any number of cards named Cid, Timeless Artificer", fromZone: null, toZone: null, amount: null, optional: false }] },
    { id: 3, abilityType: "none", actions: [{ verb: "none", object: "Cycling {W}{U}" }] },
  ] as never)) as CardTags,
};
const anthem = fromText("Glorious Anthem", "Enchantment", "Creatures you control get +1/+1.");
const targetingOf = (c: DeckCard): unknown[] => producerEvents(c.tags!).flatMap((e) => (e as { targeting?: unknown[] }).targeting ?? []);
const tagsBetween = (a: DeckCard, b: DeckCard): string[] => pairReasons(a, b, H).map((r) => `${r.producer}>${r.consumer}:${r.tag}`);

test("a SELF animate's Soldier is reached by a Soldier lord's pump (Boros Keyrune, Field Marshal) and says so", () => {
  const r = pairReasons(marshal, keyrune, H).filter((x) => x.tag === "static:pump" && x.producer === "Field Marshal" && x.consumer === "Boros Keyrune");
  expect(r).toHaveLength(1);
  expect(r[0]!.text).toMatch(/Boros Keyrune.*Soldier/);
});

test("a TARGET animate's Elemental is reached by an Elemental lord's grant (Brave the Wilds, Thicket Crasher)", () => {
  const r = pairReasons(crasher, brave, H).filter((x) => x.producer === "Thicket Crasher" && x.consumer === "Brave the Wilds");
  expect(r.map((x) => x.tag)).toContain("static:keyword-grant");
});

test("a count of the kindred counts the animator (Omnath's Elementals, Brave the Wilds)", () => {
  expect(pairReasons(brave, omnath, H).some((x) => x.tag === "scales:elemental" && x.producer === "Brave the Wilds" && x.consumer === "Omnath, Locus of the Roil")).toBe(true);
});

test("only a kindred reaches the result: a bare creature lord (Glorious Anthem) and an animate with no creature type (Mutavault, 'all creature types') form no new pair", () => {
  expect(tagsBetween(anthem, keyrune).filter((t) => t.startsWith("Glorious Anthem>Boros Keyrune"))).toEqual([]);
  expect(tagsBetween(marshal, mutavault).filter((t) => t.startsWith("Field Marshal>Mutavault"))).toEqual([]);
  expect(tagsBetween(brave, marshal).filter((t) => t.includes("Brave the Wilds>Field Marshal"))).toEqual([]);
});

test("a lord met by the animated permanent's TYPE alone is no kindred supply (Cid's 'artifact creatures and Heroes' does not reach Boros Keyrune)", () => {
  expect(tagsBetween(cid, keyrune).filter((t) => t.startsWith("Cid, Timeless Artificer>Boros Keyrune"))).toEqual([]);
});

test("the result is no creature target: Brave the Wilds and Kamahl's Will still meet no heroic consumer and no Leyline of Resonance", () => {
  expect(targetingOf(brave)).toEqual([]);
  for (const c of [brave, keyrune]) {
    expect(pairReasons(c, crusader, H).some((r) => r.tag.startsWith("cast:")), c.card.name).toBe(false);
    expect(pairReasons(c, resonance, H).length, c.card.name).toBe(0);
  }
});

test("a lord reaches a card's PRINTED kindred the way it did: Field Marshal and Thicket Crasher's Elemental lord do not cross", () => {
  expect(tagsBetween(marshal, crasher).filter((t) => t.startsWith("Field Marshal>Thicket Crasher"))).toEqual([]);
});

test("the sentences state the animation", () => {
  const text = (a: DeckCard, b: DeckCard, tag: string) => pairReasons(a, b, H).find((x) => x.tag === tag)?.text;
  expect(text(marshal, keyrune, "static:pump")).toBe("Boros Keyrune can become a Soldier, and Field Marshal gives Soldiers bigger stats");
  expect(text(brave, omnath, "scales:elemental")).toMatch(/Brave the Wilds can make one/);
});
