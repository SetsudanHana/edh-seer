import { deriveCardTags, deriveInputOf, grammarClauseRecords } from "@edh-seer/tagger";
import { expect, test } from "vitest";
import { computeBuild, detectBuildCategories } from "./build.js";
import { makeGateWeigher, UNREAD_WEIGHT } from "./effect-gate-weight.js";
import { drawOf } from "./goldfish.js";
import { recommendedLands } from "./land-count.js";
import type { DeckCard } from "./types.js";

// Real oracle text (Mongo `cards`, 2026-10-27), derived from the printed text by the grammar, as production does for a card it reads completely.
const REAL: Record<string, { typeLine: string; oracleText: string; manaValue: number; manaCost?: string }> = {
  "Federation Field Medic": { typeLine: "Creature — Human Doctor", manaValue: 4, manaCost: "{3}{W}", oracleText: "Vigilance\nWhen this creature enters, choose one —\n• Put a +1/+1 counter on target creature. It gains vigilance until end of turn.\n• Draw a card if you control a permanent with a counter on it." },
  "Veil of Summer": { typeLine: "Instant", manaValue: 1, manaCost: "{G}", oracleText: "Draw a card if an opponent has cast a blue or black spell this turn. Spells you control can't be countered this turn. You and permanents you control gain hexproof from blue and from black until end of turn. (You and they can't be the targets of blue or black spells or abilities your opponents control.)" },
  "Beza, the Bounding Spring": { typeLine: "Legendary Creature — Elemental Elk", manaValue: 4, oracleText: "When Beza enters, create a Treasure token if an opponent controls more lands than you. You gain 4 life if an opponent has more life than you. Create two 1/1 blue Fish creature tokens if an opponent controls more creatures than you. Draw a card if an opponent has more cards in hand than you." },
  "Thickest in the Thicket": { typeLine: "Enchantment", manaValue: 5, oracleText: "When this enchantment enters, put X +1/+1 counters on target creature, where X is that creature's power.\nAt the beginning of your end step, draw two cards if you control the creature with the greatest power or tied for the greatest power." },
  "Weatherlight Compleated": { typeLine: "Legendary Artifact — Vehicle", manaValue: 2, oracleText: "Flying\nAs long as Weatherlight Compleated has four or more phyresis counters on it, it's a Phyrexian creature in addition to its other types.\nWhenever a creature you control dies, put a phyresis counter on Weatherlight Compleated. Then draw a card if it has seven or more phyresis counters on it. If it doesn't, scry 1." },
  "Roadside Reliquary": { typeLine: "Land", manaValue: 0, oracleText: "{T}: Add {C}.\n{2}, {T}, Sacrifice this land: Draw a card if you control an artifact. Draw a card if you control an enchantment." },
  "Inspiring Call": { typeLine: "Instant", manaValue: 3, oracleText: "Draw a card for each creature you control with a +1/+1 counter on it. Those creatures gain indestructible until end of turn. (Damage and effects that say \"destroy\" don't destroy them.)" },
  "Divination": { typeLine: "Sorcery", manaValue: 3, manaCost: "{2}{U}", oracleText: "Draw two cards." },
  "Managorger Hydra": { typeLine: "Creature — Hydra", manaValue: 3, oracleText: "Trample\nWhenever a player casts a spell, put a +1/+1 counter on this creature.\nThis creature gets +1/+1 for each +1/+1 counter on it." },
  "Mind Stone": { typeLine: "Artifact", manaValue: 2, oracleText: "{T}: Add {C}.\n{1}, {T}, Sacrifice this artifact: Draw a card." },
};
const make = (realName: string, asName = realName): DeckCard => {
  const c = REAL[realName]!;
  const printed = { name: asName, typeLine: c.typeLine, oracleText: c.oracleText, keywords: [] as string[] };
  const g = grammarClauseRecords(printed);
  if (!g.complete) throw new Error(`grammar does not read ${realName} completely`);
  return { card: { ...printed, manaValue: c.manaValue, manaCost: c.manaCost } as never, tags: deriveCardTags(deriveInputOf(printed as never, "x", asName, g.records, undefined, g.readings)) };
};
const copies = (realName: string, n: number): DeckCard[] => Array.from({ length: n }, (_, i) => make(realName, `${realName} ${i}`));
const filler = (n: number): DeckCard[] => Array.from({ length: n }, (_, i) => ({ card: { name: `Filler ${i}`, typeLine: "Sorcery", oracleText: "", manaValue: 2 } as never, tags: null }));
const deckOf = (...own: DeckCard[][]): DeckCard[] => { const cards = own.flat(); return [...cards, ...filler(100 - cards.length)]; };
const gatedDraw = (dc: DeckCard) => dc.tags!.abilities.filter((a) => a.effect.kind === "draw-card" && a.gate !== undefined);

test("an ungated draw weighs 1 and is not conditional (Divination)", () => {
  const d = make("Divination");
  const w = makeGateWeigher(deckOf([d])).of(d.tags!.abilities.find((a) => a.effect.kind === "draw-card")!, d);
  expect(w).toMatchObject({ weight: 1, conditional: false, basis: "ungated" });
});

test("a scaling draw that prints no 'if' has no gate, so it weighs 1 (Inspiring Call)", () => {
  const d = make("Inspiring Call");
  expect(d.tags!.abilities.some((a) => a.gate !== undefined)).toBe(false);
  expect(makeGateWeigher(deckOf([d])).of(d.tags!.abilities.find((a) => a.effect.kind === "draw-card")!, d).weight).toBe(1);
});

test("Federation Field Medic's draw (needs a counter on a permanent) is weighted by the deck's supply of counters: high in a counters deck, low without", () => {
  const medic = make("Federation Field Medic");
  const [draw] = gatedDraw(medic);
  expect(draw!.gate!.kind).toBe("unknown");
  expect(draw!.conditionCares).toEqual(["counter-added:any"]);
  const withCounters = makeGateWeigher(deckOf([medic], copies("Managorger Hydra", 12))).of(draw!, medic);
  const without = makeGateWeigher(deckOf([medic])).of(draw!, medic);
  expect(withCounters).toMatchObject({ basis: "supply", conditional: true, needs: "you control a permanent with a counter on it" });
  expect(withCounters.weight).toBeGreaterThan(0.75);
  expect(without.weight).toBeLessThan(0.05);
  expect(without.basis).toBe("supply");
});

test("the card's own counters do not count as the deck's supply (Federation puts a counter itself)", () => {
  const medic = make("Federation Field Medic");
  expect(makeGateWeigher(deckOf([medic])).of(gatedDraw(medic)[0]!, medic).weight).toBe(0);
});

test("a board-count gate is the deck's chance of meeting it, from gate.ts (Roadside Reliquary)", () => {
  const land = make("Roadside Reliquary");
  const [artifactDraw] = gatedDraw(land);
  expect(artifactDraw!.gate!.kind).toBe("control");
  const artifacts = Array.from({ length: 25 }, (_, i) => make("Mind Stone", `Mind Stone ${i}`));
  expect(makeGateWeigher(deckOf([land], artifacts)).of(artifactDraw!, land).weight).toBeGreaterThan(0.9);
  const none = makeGateWeigher(deckOf([land])).of(artifactDraw!, land);
  expect(none.weight).toBe(0);
  expect(none.basis).toBe("evaluated");
});

test("Veil of Summer: an opponent's spell is no property of a decklist, so the draw takes the fixed partial weight, flagged, never 0 and never 1", () => {
  const veil = make("Veil of Summer");
  const [draw] = gatedDraw(veil);
  expect(draw!.gate).toMatchObject({ kind: "turn-event", event: "opponent-cast" });
  const w = makeGateWeigher(deckOf([veil])).of(draw!, veil);
  expect(w).toMatchObject({ weight: UNREAD_WEIGHT, conditional: true, basis: "unread" });
  expect(UNREAD_WEIGHT).toBeGreaterThan(0);
  expect(UNREAD_WEIGHT).toBeLessThan(1);
});

test("Beza (a comparison with an opponent, nothing a deck supplies) takes the fixed weight; Weatherlight's counters on the card, which gate.ts only reads for a mana line, too", () => {
  const beza = make("Beza, the Bounding Spring");
  const [bezaDraw] = gatedDraw(beza);
  expect(bezaDraw!.conditionCares).toBeUndefined();
  expect(makeGateWeigher(deckOf([beza])).of(bezaDraw!, beza)).toMatchObject({ weight: UNREAD_WEIGHT, basis: "unread" });
  const wl = make("Weatherlight Compleated");
  const [wlDraw] = gatedDraw(wl);
  expect(wlDraw!.gate!.kind).toBe("counter");
  expect(makeGateWeigher(deckOf([wl])).of(wlDraw!, wl)).toMatchObject({ weight: UNREAD_WEIGHT, basis: "unread" });
});

test("the Draw role count is weighted: membership stays, the count is the expected number of cards that really draw", () => {
  const sure = copies("Divination", 5);
  const veils = copies("Veil of Summer", 4);
  const deck = deckOf(sure, veils);
  // MEMBERSHIP IS UNCHANGED: a gated draw card is still a draw card.
  expect(detectBuildCategories(deck).get("draw")!.size).toBe(9);
  const count = (gates?: ReturnType<typeof makeGateWeigher>) => computeBuild(deck, undefined, undefined, undefined, 0, undefined, gates).buildCategories.find((c) => c.category === "draw")!.count;
  expect(count()).toBe(9);
  // 5 + 4 x UNREAD_WEIGHT, rounded to a whole card
  expect(count(makeGateWeigher(deck))).toBe(Math.round(5 + 4 * UNREAD_WEIGHT));
  const result = computeBuild(deck, undefined, undefined, undefined, 0, undefined, makeGateWeigher(deck));
  expect(result.conditionalRoles).toHaveLength(4);
  expect(result.conditionalRoles![0]).toMatchObject({ category: "draw", weight: UNREAD_WEIGHT, basis: "unread", needs: "an opponent has cast a blue or black spell this turn" });
});

test("a card whose only draw is gated is listed as conditional in the Draw role (Thickest in the Thicket)", () => {
  const thicket = make("Thickest in the Thicket");
  const deck = deckOf([thicket]);
  const r = computeBuild(deck, undefined, undefined, undefined, 0, undefined, makeGateWeigher(deck));
  expect(r.conditionalRoles!.filter((c) => c.card === thicket.card.name && c.category === "draw")).toHaveLength(1);
});

test("a gated draw beside an ungated one does not dilute the card: it is a sure draw card (Divination with Veil of Summer's gated draw added)", () => {
  const div = make("Divination", "Divination Plus");
  const veilDraw = make("Veil of Summer").tags!.abilities.find((a) => a.effect.kind === "draw-card")!;
  const both: DeckCard = { ...div, tags: { ...div.tags!, abilities: [...div.tags!.abilities, veilDraw] } };
  const deck = deckOf([both]);
  const r = computeBuild(deck, undefined, undefined, undefined, 0, undefined, makeGateWeigher(deck));
  expect(r.conditionalRoles).toBeUndefined();
  expect(r.buildCategories.find((c) => c.category === "draw")!.count).toBe(1);
});

test("the parent count (Consistency) carries the same weights, so the leaf rows and the parent agree", () => {
  const deck = deckOf(copies("Divination", 5), copies("Veil of Summer", 4));
  const consistency = (gates?: ReturnType<typeof makeGateWeigher>) => computeBuild(deck, undefined, undefined, undefined, 0, undefined, gates).buildParents.find((p) => p.key === "consistency")!.count;
  expect(consistency()).toBe(9);
  expect(consistency(makeGateWeigher(deck))).toBe(Math.round(5 + 4 * UNREAD_WEIGHT));
});

test("the goldfish draws a gated draw in expectation: left out without a weigher (as before), the amount times the weight with one", () => {
  const veil = make("Veil of Summer");
  const deck = deckOf([veil]);
  expect(drawOf(veil)).toBeNull();
  expect(drawOf(veil, makeGateWeigher(deck))).toEqual({ once: UNREAD_WEIGHT, upkeep: 0 });
  // an ungated draw is unchanged by a weigher
  const div = make("Divination");
  expect(drawOf(div, makeGateWeigher(deckOf([div])))).toEqual(drawOf(div));
  // a TRIGGERED gated draw was counted in full before (no weigher: Federation Field Medic's enters trigger); with one it counts at its weight, and at nothing in a deck with no counters
  const medic = make("Federation Field Medic");
  expect(drawOf(medic)).toEqual({ once: 1, upkeep: 0 });
  const counters = drawOf(medic, makeGateWeigher(deckOf([medic], copies("Managorger Hydra", 12))))!;
  expect(counters.once).toBeGreaterThan(0.75);
  expect(counters.once).toBeLessThan(1);
  expect(drawOf(medic, makeGateWeigher(deckOf([medic])))).toBeNull();
});

test("the land recommendation counts the draw pieces at the same weights as the build panel", () => {
  const deck = deckOf(copies("Divination", 5), copies("Veil of Summer", 4));
  expect(recommendedLands(deck).drawPieces).toBe(9);
  expect(recommendedLands(deck, { gates: makeGateWeigher(deck) }).drawPieces).toBe(Math.round(5 + 4 * UNREAD_WEIGHT));
});

test("the row's count is a whole card and its exact sum rides beside it: a lone half-weight card shows as 6 and weighs 5.5 (the score reads the exact one)", () => {
  const deck = deckOf(copies("Divination", 5), copies("Veil of Summer", 1));
  const r = computeBuild(deck, undefined, undefined, undefined, 0, undefined, makeGateWeigher(deck));
  expect(r.buildCategories.find((c) => c.category === "draw")).toMatchObject({ count: 6, weighted: 5 + UNREAD_WEIGHT });
  expect(r.buildParents.find((p) => p.key === "consistency")).toMatchObject({ count: 6, weighted: 5 + UNREAD_WEIGHT });
  // no conditional member, no `weighted`
  const plain = computeBuild(deck, undefined, undefined, undefined, 0, undefined).buildCategories.find((c) => c.category === "draw")!;
  expect(plain.weighted).toBeUndefined();
  // the score moves although the shown count does not
  const base = computeBuild(deck, undefined, undefined, undefined, 0, undefined).buildScore;
  expect(r.buildScore).toBeLessThan(base);
});
