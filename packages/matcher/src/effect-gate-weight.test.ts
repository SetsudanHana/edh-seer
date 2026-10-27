import { deriveCardTags, deriveInputOf, grammarClauseRecords } from "@edh-seer/tagger";
import { expect, test } from "vitest";
import { computeBuild, detectAnswerClasses, detectBuildCategories } from "./build.js";
import { makeGateWeigher, UNREAD_WEIGHT } from "./effect-gate-weight.js";
import { drawOf, simulate } from "./goldfish.js";
import { isTargetCondition } from "./target-condition.js";
import type { GateWeigher } from "./effect-gate-weight.js";
import { landInputs, recommendedLands } from "./land-count.js";
import type { DeckCard } from "./types.js";

// Real oracle text (Mongo `cards`, 2026-10-27), derived from the printed text by the grammar, as production does for a card it reads completely.
const REAL: Record<string, { records?: unknown[]; keywords?: string[]; typeLine: string; oracleText: string; manaValue: number; manaCost?: string; partial?: true }> = {
  "Federation Field Medic": { typeLine: "Creature — Human Doctor", manaValue: 4, manaCost: "{3}{W}", oracleText: "Vigilance\nWhen this creature enters, choose one —\n• Put a +1/+1 counter on target creature. It gains vigilance until end of turn.\n• Draw a card if you control a permanent with a counter on it." },
  "Veil of Summer": { typeLine: "Instant", manaValue: 1, manaCost: "{G}", oracleText: "Draw a card if an opponent has cast a blue or black spell this turn. Spells you control can't be countered this turn. You and permanents you control gain hexproof from blue and from black until end of turn. (You and they can't be the targets of blue or black spells or abilities your opponents control.)" },
  "Beza, the Bounding Spring": { typeLine: "Legendary Creature — Elemental Elk", manaValue: 4, oracleText: "When Beza enters, create a Treasure token if an opponent controls more lands than you. You gain 4 life if an opponent has more life than you. Create two 1/1 blue Fish creature tokens if an opponent controls more creatures than you. Draw a card if an opponent has more cards in hand than you." },
  "Thickest in the Thicket": { typeLine: "Enchantment", manaValue: 5, oracleText: "When this enchantment enters, put X +1/+1 counters on target creature, where X is that creature's power.\nAt the beginning of your end step, draw two cards if you control the creature with the greatest power or tied for the greatest power." },
  "Weatherlight Compleated": { typeLine: "Legendary Artifact — Vehicle", manaValue: 2, oracleText: "Flying\nAs long as Weatherlight Compleated has four or more phyresis counters on it, it's a Phyrexian creature in addition to its other types.\nWhenever a creature you control dies, put a phyresis counter on Weatherlight Compleated. Then draw a card if it has seven or more phyresis counters on it. If it doesn't, scry 1." },
  "Roadside Reliquary": { typeLine: "Land", manaValue: 0, oracleText: "{T}: Add {C}.\n{2}, {T}, Sacrifice this land: Draw a card if you control an artifact. Draw a card if you control an enchantment." },
  "Inspiring Call": { typeLine: "Instant", manaValue: 3, oracleText: "Draw a card for each creature you control with a +1/+1 counter on it. Those creatures gain indestructible until end of turn. (Damage and effects that say \"destroy\" don't destroy them.)" },
  "Divination": { typeLine: "Sorcery", manaValue: 3, manaCost: "{2}{U}", oracleText: "Draw two cards." },
  "Managorger Hydra": { typeLine: "Creature — Hydra", manaValue: 3, oracleText: "Trample\nWhenever a player casts a spell, put a +1/+1 counter on this creature." },
  "Pyroblast": { typeLine: "Instant", manaValue: 1, manaCost: "{R}", oracleText: "Choose one —\n• Counter target spell if it's blue.\n• Destroy target permanent if it's blue." },
  "Titan's Presence": { typeLine: "Instant", manaValue: 3, manaCost: "{3}", oracleText: "As an additional cost to cast this spell, reveal a colorless creature card from your hand.\nExile target creature if its power is less than or equal to the revealed card's power." },
  "Fatal Push": { partial: true, typeLine: "Instant", manaValue: 1, manaCost: "{B}", oracleText: "Destroy target creature if it has mana value 2 or less.\nRevolt — Destroy that creature if it has mana value 4 or less instead if a permanent left the battlefield under your control this turn." },
  "Soul Rend": { typeLine: "Instant", manaValue: 2, manaCost: "{1}{B}", oracleText: "Destroy target creature if it's white. A creature destroyed this way can't be regenerated.\nDraw a card at the beginning of the next turn's upkeep." },
  "Wolf Strike": { typeLine: "Instant", manaValue: 3, manaCost: "{2}{G}", oracleText: "Target creature you control gets +2/+0 until end of turn if it's night. Then it deals damage equal to its power to target creature you don't control." },
  "Garna, Bloodfist of Keld": { typeLine: "Legendary Creature — Human Berserker", manaValue: 4, manaCost: "{1}{B}{R}{R}", oracleText: "Whenever another creature you control dies, draw a card if it was attacking. Otherwise, Garna deals 1 damage to each opponent." },
  "Miles \"Tails\" Prower": { typeLine: "Legendary Creature — Fox Artificer", manaValue: 4, manaCost: "{1}{W}{U}", oracleText: "Flash\nFlying\nWhenever a Vehicle you control enters, draw a card if it has flying. Otherwise, put a flying counter on it." },
  "Into the Roil": { keywords: ["Kicker"], typeLine: "Instant", manaValue: 2, manaCost: "{1}{U}", oracleText: "Kicker {1}{U} (You may pay an additional {1}{U} as you cast this spell.)\nReturn target nonland permanent to its owner's hand. If this spell was kicked, draw a card." },
  "Pixie Illusionist": { keywords: ["Kicker", "Flying"], typeLine: "Creature — Faerie Wizard", manaValue: 1, manaCost: "{U}", oracleText: "Kicker {3}{G} (You may pay an additional {3}{G} as you cast this spell.)\nFlying\nIf this creature was kicked, it enters with two +1/+1 counters on it.\n{T}: Target land you control becomes the basic land type of your choice until end of turn." },
  "Archon's Glory": { keywords: ["Bargain"], typeLine: "Instant", manaValue: 1, manaCost: "{W}", oracleText: "Bargain (You may sacrifice an artifact, enchantment, or token as you cast this spell.)\nTarget creature gets +2/+2 until end of turn. If this spell was bargained, that creature also gains flying and lifelink until end of turn." },
  "Mind Spiral": { keywords: ["Gift"], typeLine: "Sorcery", manaValue: 5, manaCost: "{4}{U}", oracleText: "Gift a tapped Fish (You may promise an opponent a gift as you cast this spell. If you do, they create a tapped 1/1 blue Fish creature token before its other effects.)\nTarget player draws three cards. If the gift was promised, tap target creature an opponent controls and put a stun counter on it. (If a permanent with a stun counter would become untapped, remove one from it instead.)" },
  "Boros Fury-Shield": { typeLine: "Instant", manaValue: 2, manaCost: "{1}{R}", oracleText: "Prevent all combat damage that would be dealt this turn by target attacking or blocking creature. If {R} was spent to cast this spell, Boros Fury-Shield deals damage to that creature's controller equal to the creature's power." },
  "Cling to Dust": { keywords: ["Escape"], typeLine: "Instant", manaValue: 1, manaCost: "{B}", oracleText: "Exile target card from a graveyard. If it was a creature card, you gain 3 life. Otherwise, you draw a card.\nEscape\u2014{3}{B}, Exile five other cards from your graveyard. (You may cast this card from your graveyard for its escape cost.)" },
  "Prisoner's Dilemma": { records: [{ id: 1, abilityType: "spell", actions: [{ verb: "deal-damage", object: "each opponent", amount: "4" }, { verb: "deal-damage", object: "each opponent", amount: "8" }, { verb: "deal-damage", object: "each opponent who chose silence", amount: "12" }] }, { id: 2, abilityType: "none", actions: [{ verb: "none", object: "Flashback {5}{R}{R}" }] }], keywords: ["Flashback"], typeLine: "Sorcery", manaValue: 5, manaCost: "{3}{R}{R}", oracleText: "Each opponent secretly chooses silence or snitch, then the choices are revealed. If each opponent chose silence, Prisoner's Dilemma deals 4 damage to each of them. If each opponent chose snitch, Prisoner's Dilemma deals 8 damage to each of them. Otherwise, Prisoner's Dilemma deals 12 damage to each opponent who chose silence.\nFlashback {5}{R}{R}" },
  "Ertai's Trickery": { typeLine: "Instant", manaValue: 1, manaCost: "{U}", oracleText: "Counter target spell if it was kicked." },
  "Morsel Theft": { keywords: ["Prowl"], typeLine: "Kindred Sorcery \u2014 Rogue", manaValue: 4, manaCost: "{2}{B}{B}", oracleText: "Prowl {1}{B} (You may cast this for its prowl cost if you dealt combat damage to a player this turn with a Rogue.)\nTarget player loses 3 life and you gain 3 life. If this spell's prowl cost was paid, draw a card." },
  "Crush of Tentacles": { keywords: ["Surge"], typeLine: "Sorcery", manaValue: 6, manaCost: "{4}{U}{U}", oracleText: "Surge {3}{U}{U} (You may cast this spell for its surge cost if you or a teammate has cast another spell this turn.)\nReturn all nonland permanents to their owners' hands. If this spell's surge cost was paid, create an 8/8 blue Octopus creature token." },
  "Poison the Cup": { keywords: ["Foretell", "Scry"], typeLine: "Instant", manaValue: 3, manaCost: "{1}{B}{B}", oracleText: "Destroy target creature. If this spell was foretold, scry 2.\nForetell {1}{B} (During your turn, you may pay {2} and exile this card from your hand face down. Cast it on a later turn for its foretell cost.)" },
  "Full Bore": { typeLine: "Instant", manaValue: 1, manaCost: "{R}", oracleText: "Target creature you control gets +3/+2 until end of turn. If that creature was cast for its warp cost, it also gains trample and haste until end of turn." },
  "Approach of the Second Sun": { records: [{ id: 1, abilityType: "spell", actions: [{ verb: "win-game", object: "you", fromZone: null, toZone: null, amount: null, optional: false }, { verb: "put", object: "Approach of the Second Sun", fromZone: "stack", toZone: "library", amount: null, optional: false }, { verb: "gain-life", object: "you", fromZone: null, toZone: null, amount: "7", optional: false }] }], typeLine: "Sorcery", manaValue: 7, manaCost: "{6}{W}", oracleText: "If this spell was cast from your hand and you've cast another spell named Approach of the Second Sun this game, you win the game. Otherwise, put Approach of the Second Sun into its owner's library seventh from the top and you gain 7 life." },
  "Protection Racket": { records: [{ id: 1, abilityType: "triggered", trigger: { event: "upkeep", subject: "your upkeep", control: "you" }, actions: [{ verb: "reveal", object: "the top card of your library", fromZone: null, toZone: null, amount: null, optional: false }, { verb: "exile", object: "that card", fromZone: "library", toZone: "exile", amount: null, optional: true }, { verb: "put", object: "that card", fromZone: "library", toZone: "hand", amount: null, optional: false }] }], typeLine: "Enchantment", manaValue: 3, manaCost: "{2}{B}", oracleText: "At the beginning of your upkeep, repeat the following process for each opponent in turn order. Reveal the top card of your library. That player may pay life equal to that card's mana value. If they do, exile that card. Otherwise, put it into your hand." },
  "Sin Prodder": { records: [{ id: 1, abilityType: "none", actions: [{ verb: "none", object: "Menace" }] }, { id: 2, abilityType: "triggered", trigger: { event: "upkeep", subject: "you", control: "you" }, actions: [{ verb: "reveal", object: "the top card of your library", fromZone: null, toZone: null, amount: null, optional: false }, { verb: "put", object: "that card", fromZone: "library", toZone: "graveyard", amount: null, optional: true }, { verb: "deal-damage", object: "that player", fromZone: null, toZone: null, amount: "that card's mana value", optional: false }, { verb: "put", object: "that card", fromZone: "library", toZone: "hand", amount: null, optional: false }] }], keywords: ["Menace"], typeLine: "Creature \u2014 Devil", manaValue: 3, manaCost: "{2}{R}", oracleText: "Menace\nAt the beginning of your upkeep, reveal the top card of your library. Any opponent may have you put that card into your graveyard. If a player does, this creature deals damage to that player equal to that card's mana value. Otherwise, put that card into your hand." },
  "Mind Stone": { typeLine: "Artifact", manaValue: 2, oracleText: "{T}: Add {C}.\n{1}, {T}, Sacrifice this artifact: Draw a card." },
};
const make = (realName: string, asName = realName): DeckCard => {
  const c = REAL[realName]!;
  const printed = { name: asName, typeLine: c.typeLine, oracleText: c.oracleText, keywords: c.keywords ?? [] };
  if (c.records) return { card: { ...printed, manaValue: c.manaValue, manaCost: c.manaCost } as never, tags: deriveCardTags(deriveInputOf(printed as never, "x", asName, c.records as never)) };
  const g = grammarClauseRecords(printed);
  if (!g.complete && !c.partial) throw new Error(`grammar does not read ${realName} completely`);
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

test("Federation Field Medic's draw (needs a counter on a permanent) is weighted by the deck's supply of counters: high in a counters deck, exactly 0 without (a readable condition with no support, owner ruling A)", () => {
  const medic = make("Federation Field Medic");
  const [draw] = gatedDraw(medic);
  expect(draw!.gate!.kind).toBe("unknown");
  expect(draw!.conditionCares).toEqual(["counter-added:any"]);
  const withCounters = makeGateWeigher(deckOf([medic], copies("Managorger Hydra", 12))).of(draw!, medic);
  const without = makeGateWeigher(deckOf([medic])).of(draw!, medic);
  expect(withCounters).toMatchObject({ basis: "supply", conditional: true, needs: "you control a permanent with a counter on it" });
  expect(withCounters.weight).toBeGreaterThan(0.75);
  expect(without.weight).toBe(0);
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

test("target classifier negatives: an effect condition that mentions no target is not a target condition (Garna, Miles Prower), nor is the day or night (Wolf Strike)", () => {
  for (const name of ["Garna, Bloodfist of Keld", "Miles \"Tails\" Prower", "Wolf Strike"]) {
    const dc = make(name);
    const gated = dc.tags!.abilities.filter((a) => a.gate !== undefined);
    expect(gated.length, name).toBeGreaterThan(0);
    for (const a of gated) {
      expect(isTargetCondition(dc.card.oracleText, a.gate!.text), `${name}: ${a.gate!.text}`).toBe(false);
      expect(makeGateWeigher(deckOf([dc])).of(a, dc).basis, name).toBe("unread");
    }
  }
  // the same condition words WITH a target in the clause are a target condition, and the day or night never is
  expect(isTargetCondition("Destroy target creature if it was attacking.", "it was attacking")).toBe(true);
  expect(isTargetCondition("Draw a card if it was attacking.", "it was attacking")).toBe(false);
  expect(isTargetCondition("Target creature gets +2/+0 if it's night.", "it's night")).toBe(false);
  expect(isTargetCondition("Destroy target nonland permanent if it's a creature or if {G}{W} was spent to cast this spell.", "it's a creature or if {g}{w} was spent to cast this spell")).toBe(false);
  // curly apostrophes read the same as straight ones
  expect(isTargetCondition("Counter target spell if it\u2019s blue.", "it's blue")).toBe(true);
});

test("a stat or state condition on the target is a narrow answer, a colour one covers nothing (Fatal Push, Titan's Presence vs Pyroblast, Soul Rend)", () => {
  const push = make("Fatal Push");
  expect(makeGateWeigher(deckOf([push])).of(gatedDraw(push)[0] ?? push.tags!.abilities.find((a) => a.gate !== undefined)!, push)).toMatchObject({ weight: 1, basis: "target" });
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

test("the count is the EXACT weighted sum, never rounded up into a sure card: one half-weight draw makes 5.5, not 6", () => {
  const deck = deckOf(copies("Divination", 5), copies("Veil of Summer", 1));
  const r = computeBuild(deck, undefined, undefined, undefined, 0, undefined, makeGateWeigher(deck));
  expect(r.buildCategories.find((c) => c.category === "draw")!.count).toBe(5 + UNREAD_WEIGHT);
  expect(r.buildParents.find((p) => p.key === "consistency")!.count).toBe(5 + UNREAD_WEIGHT);
  // the suggestion sentence prints the decimal, one place, no ".0"
  expect(r.suggestionByKey.consistency).toContain("Card advantage 5.5/");
  expect(computeBuild(deck, undefined, undefined, undefined, 0, undefined).suggestionByKey.consistency).toContain("Card advantage 6/");
  // and the score moves
  expect(r.buildScore).toBeLessThan(computeBuild(deck, undefined, undefined, undefined, 0, undefined).buildScore);
});

test("ruleWeight's multi-level path: two gated draws at different weights give the better one, and a deck that meets neither makes the card count 0", () => {
  const land = make("Roadside Reliquary");
  const div = make("Divination", "Multi Draw");
  const both: DeckCard = { ...div, tags: { ...div.tags!, abilities: land.tags!.abilities.filter((a) => a.effect.kind === "draw-card") } };
  const artifacts = Array.from({ length: 25 }, (_, i) => make("Mind Stone", `Mind Stone ${i}`));
  const rich = deckOf([both], artifacts);
  const r = computeBuild(rich, undefined, undefined, undefined, 0, undefined, makeGateWeigher(rich));
  const row = r.conditionalRoles!.find((c) => c.card === "Multi Draw" && c.category === "draw")!;
  // the artifact draw (met) carries the card; the enchantment draw (never met) does not drag it down
  expect(row.weight).toBeGreaterThan(0.9);
  expect(row.weight).toBeLessThan(1);
  const poor = deckOf([both]);
  const r0 = computeBuild(poor, undefined, undefined, undefined, 0, undefined, makeGateWeigher(poor));
  expect(r0.conditionalRoles!.find((c) => c.card === "Multi Draw" && c.category === "draw")!.weight).toBe(0);
  expect(r0.buildCategories.find((c) => c.category === "draw")!.count).toBe(0);
  expect(detectBuildCategories(poor).get("draw")!.has("Multi Draw")).toBe(true);
});

test("an oracle-only role rule weighs a card whose every ability is gated, and leaves a card with a sure ability whole", () => {
  const veil = make("Veil of Summer");
  // the protection role is read from the printed text ("hexproof"): Veil's keyword-grant is ungated, so it stays whole there
  const deck = deckOf([veil]);
  const r = computeBuild(deck, undefined, undefined, undefined, 0, undefined, makeGateWeigher(deck));
  expect(r.buildCategories.find((c) => c.category === "protection")!.count).toBe(1);
  expect(r.buildCategories.find((c) => c.category === "draw")!.count).toBe(UNREAD_WEIGHT);
});

test("a condition on the TARGET is a narrow answer, not a chance: Pyroblast and Titan's Presence count whole and are named target", () => {
  for (const name of ["Pyroblast", "Titan's Presence"]) {
    const dc = make(name);
    const gated = dc.tags!.abilities.filter((a) => a.gate !== undefined);
    expect(gated.length, name).toBeGreaterThan(0);
    for (const a of gated) expect(makeGateWeigher(deckOf([dc])).of(a, dc), name).toMatchObject({ weight: 1, basis: "target", conditional: true });
  }
  const pyro = make("Pyroblast");
  const deck = deckOf([pyro]);
  const r = computeBuild(deck, undefined, undefined, undefined, 0, undefined, makeGateWeigher(deck));
  expect(r.buildCategories.find((c) => c.category === "stackInteraction")!.count).toBe(1);
  expect(r.buildCategories.find((c) => c.category === "targetedRemoval")!.count).toBe(1);
  expect(r.conditionalRoles!.filter((c) => c.card === "Pyroblast").map((c) => `${c.category}:${c.basis}:${c.weight}`).sort()).toEqual(["stackInteraction:target:1", "targetedRemoval:target:1"]);
  // answer coverage agrees: neither card covers a class (a colour hoser never did; Titan's Presence now covers no creature class)
  expect(detectAnswerClasses([pyro]).size).toBe(0);
  // a STAT condition on the target still covers its class, marked narrow (owner refinement 2026-10-27): Titan's Presence and Fatal Push answer creatures, narrowly; a COLOUR one (Pyroblast, Soul Rend) covers none
  const titans = make("Titan's Presence"), push = make("Fatal Push");
  expect(detectAnswerClasses([titans]).get("creature")!.narrow.has(titans.card.name)).toBe(true);
  expect(detectAnswerClasses([push]).get("creature")!.narrow.has(push.card.name)).toBe(true);
  expect(detectAnswerClasses([make("Soul Rend")]).get("creature")).toBeUndefined();
  // an effect condition that mentions no target is still a chance (Miles Prower's "if it has flying" is not in this fixture; Veil's is)
  const veil = make("Veil of Summer");
  expect(makeGateWeigher(deckOf([veil])).of(gatedDraw(veil)[0]!, veil).basis).toBe("unread");
});

test("a speed or initiative gate on an effect is unread, not sure", () => {
  const veil = make("Veil of Summer");
  const draw = gatedDraw(veil)[0]!;
  for (const gate of [{ kind: "speed", n: 4, text: "you have max speed" }, { kind: "initiative", text: "you have the initiative" }] as const) {
    const w = makeGateWeigher(deckOf([veil])).of({ ...draw, gate } as never, { ...veil, card: { ...veil.card, oracleText: "" } });
    expect(w).toMatchObject({ weight: UNREAD_WEIGHT, basis: "unread" });
  }
});

test("the goldfish draws a gated draw in expectation: left out without a weigher (as before), the amount times the weight with one", () => {
  const veil = make("Veil of Summer");
  const deck = deckOf([veil]);
  expect(drawOf(veil)).toBeNull();
  expect(drawOf(veil, makeGateWeigher(deck))).toEqual({ once: UNREAD_WEIGHT, upkeep: 0 });
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

test("simulate: a lone fractional draw pays in about its weight's share of the games (stratified carry), and a whole-draw deck is unchanged", () => {
  const lands = Array.from({ length: 36 }, (_, i) => ({ card: { name: `Forest ${i}`, typeLine: "Basic Land — Forest", oracleText: "{T}: Add {G}.", manaValue: 0 } as never, tags: null }) as DeckCard);
  const veils = copies("Veil of Summer", 20);
  const deck = [...lands, ...veils, ...filler(44)];
  const total = (r: ReturnType<typeof simulate>, t: number): number => 36 * r.seenShare.land[t] + 64 * r.seenShare.cheap[t];
  const opts = { trials: 3000, turns: 8, seed: 7 };
  const plain = simulate(deck, opts);
  const gated = simulate(deck, { ...opts, gates: makeGateWeigher(deck) });
  const extra = total(gated, 7) - total(plain, 7);
  // 20 Veils at 0.5 each: several cards more by turn 8 on average, and fewer than the 20 x 1 an unweighted draw would add
  expect(extra).toBeGreaterThan(0.5);
  expect(extra).toBeLessThan(10);
  // a single Veil: its half draw still pays in some games (the old carry started at 0 and a lone 0.5 never paid)
  const lone = [...lands, ...copies("Veil of Summer", 1), ...filler(63)];
  const loneOpts = { trials: 4000, turns: 8, seed: 11 };
  expect(total(simulate(lone, { ...loneOpts, gates: makeGateWeigher(lone) }), 7)).toBeGreaterThan(total(simulate(lone, loneOpts), 7));
  // no gated draw, no change: the same seed reads the same table with and without a weigher
  const calm = [...lands, ...copies("Divination", 10), ...filler(54)];
  expect(simulate(calm, { ...opts, gates: makeGateWeigher(calm) }).seenShare).toEqual(simulate(calm, opts).seenShare);
});

test("land-count reads the same weights: the Karsten cheap-piece count, the draw credits, the role-over counts and the pieces", () => {
  const sure = copies("Divination", 5);
  const veils = copies("Veil of Summer", 4);
  const deck = deckOf(sure, veils);
  const gates = makeGateWeigher(deck);
  // the cheap ramp-plus-draw count: Veil is mana value 1 and a draw card; Divination costs 3 and is not cheap
  expect(landInputs(deck).rampPlusDraw).toBe(4);
  expect(landInputs(deck, { gates }).rampPlusDraw).toBe(4 * UNREAD_WEIGHT);
  // the pieces count and the over count: 9 draw cards against a target of 5 is 4 over; weighted, 7 against 5 is 2 over
  const plain = recommendedLands(deck, { roleTargets: { consistency: 5 } });
  const weighted = recommendedLands(deck, { gates, roleTargets: { consistency: 5 } });
  expect(plain.drawPieces).toBe(9);
  expect(weighted.drawPieces).toBe(5 + 4 * UNREAD_WEIGHT);
  // a gated draw saves fewer lands than a sure one: the weighted deck wants at least as many
  expect(weighted.target).toBeGreaterThanOrEqual(plain.target);
  if (plain.ifTrimmed?.draw && weighted.ifTrimmed?.draw) expect(weighted.ifTrimmed.draw.over).toBeLessThan(plain.ifTrimmed.draw.over);
});

test("the carry pays in proportion to the weight: three times the expected extra cards at 0.75 as at 0.25 (an always-pay carry would read 1)", () => {
  const lands = Array.from({ length: 36 }, (_, i) => ({ card: { name: `Forest ${i}`, typeLine: "Basic Land — Forest", oracleText: "{T}: Add {G}.", manaValue: 0 } as never, tags: null }) as DeckCard);
  const deck = [...lands, ...copies("Veil of Summer", 20), ...filler(44)];
  const total = (r: ReturnType<typeof simulate>): number => 36 * r.seenShare.land[7] + 64 * r.seenShare.cheap[7];
  const opts = { trials: 4000, turns: 8, seed: 5 };
  const base = total(simulate(deck, opts));
  const flat = (weight: number): GateWeigher => ({ of: () => ({ weight, conditional: true, basis: "unread" }) });
  const lo = total(simulate(deck, { ...opts, gates: flat(0.25) })) - base;
  const hi = total(simulate(deck, { ...opts, gates: flat(0.75) })) - base;
  expect(lo).toBeGreaterThan(0.5);
  expect(hi / lo).toBeGreaterThan(2.3);
  expect(hi / lo).toBeLessThan(3.7);
});

test("the trimmed over-count is whole cards: a surplus of 3.5 cuts 3, never 4", () => {
  const deck = deckOf(copies("Divination", 5), copies("Veil of Summer", 7));
  const r = recommendedLands(deck, { gates: makeGateWeigher(deck), roleTargets: { consistency: 5 } });
  for (const t of [r.ifTrimmed?.draw, r.ifTrimmed?.ramp]) if (t) expect(Number.isInteger(t.over)).toBe(true);
  expect(r.drawPieces).toBe(5 + 7 * UNREAD_WEIGHT);
});

// OPTIONAL-COST CHOICES COUNT WHOLE, FLAGGED (owner ruling 2026-10-27): kicked, bargained and a promised gift are the player's choice, not chance.
test("a kicked draw weighs 1 and is flagged as a choice, not a chance (Into the Roil, Blink of an Eye's text)", () => {
  for (const name of ["Into the Roil", "Blink of an Eye"]) {
    const d = make("Into the Roil", name);
    const [draw] = gatedDraw(d);
    expect(draw!.gate).toMatchObject({ kind: "unknown", text: "this spell was kicked" });
    expect(makeGateWeigher(deckOf([d])).of(draw!, d)).toEqual({ weight: 1, conditional: true, basis: "choice", needs: "this spell was kicked" });
  }
});

test("'enters with counters if kicked' (Pixie Illusionist), a bargained grant (Archon's Glory) and a promised gift (Mind Spiral) weigh 1, flagged", () => {
  const pixie = make("Pixie Illusionist");
  const counters = pixie.tags!.abilities.find((a) => a.effect.kind === "enters-with-counters")!;
  expect(makeGateWeigher(deckOf([pixie])).of(counters, pixie)).toMatchObject({ weight: 1, basis: "choice", conditional: true });
  const glory = make("Archon's Glory");
  const grant = glory.tags!.abilities.find((a) => a.gate !== undefined)!;
  expect(makeGateWeigher(deckOf([glory])).of(grant, glory)).toMatchObject({ weight: 1, basis: "choice", needs: "this spell was bargained" });
  const spiral = make("Mind Spiral");
  const gated = spiral.tags!.abilities.filter((a) => a.gate !== undefined);
  expect(gated.length).toBeGreaterThan(0);
  for (const a of gated) expect(makeGateWeigher(deckOf([spiral])).of(a, spiral)).toMatchObject({ weight: 1, basis: "choice", needs: "the gift was promised" });
});

test("'{R} was spent' is the deck's mana, not an optional cost: it stays unread at the fixed weight (Boros Fury-Shield)", () => {
  const d = make("Boros Fury-Shield");
  const gated = d.tags!.abilities.find((a) => a.gate !== undefined)!;
  expect(makeGateWeigher(deckOf([d])).of(gated, d)).toMatchObject({ weight: UNREAD_WEIGHT, basis: "unread" });
});

test("a kicked draw keeps its role whole, flagged: the card counts 1 in draw and the report lists the choice (Into the Roil)", () => {
  const d = make("Into the Roil");
  const deck = deckOf([d]);
  const rows = computeBuild(deck, undefined, undefined, undefined, 0, undefined, makeGateWeigher(deck)).conditionalRoles ?? [];
  expect(rows.some((r) => r.card === d.card.name && r.category === "draw" && r.basis === "choice" && r.weight === 1)).toBe(true);
});

// REVIEW OF 16eee43e..b7c231f7 (#1357 part 2)
const roleRow = (cards: DeckCard[], card: string, category: string) =>
  computeBuild(deckOf(cards), undefined, undefined, undefined, 0, undefined, makeGateWeigher(deckOf(cards))).conditionalRoles?.find((r) => r.card === card && r.category === category);

test("the report names the condition the role leans on: Cling to Dust's draw is its Otherwise branch, not the lifegain's 'it was a creature card'", () => {
  const d = make("Cling to Dust");
  const row = roleRow([d], d.card.name, "draw");
  expect(row).toMatchObject({ weight: 0.5, basis: "unread" });
  expect(row!.needs).toBe('the answer to "it was a creature card" is no');
});

test("an exhaustive set of branches counts whole: every branch of Prisoner's Dilemma is burn, so burn is 1 and no row is listed", () => {
  const d = make("Prisoner's Dilemma");
  const deck = deckOf([d]);
  const burn = computeBuild(deck, undefined, undefined, undefined, 0, undefined, makeGateWeigher(deck)).buildCategories.find((c) => c.category === "burn")!;
  expect(burn.count).toBe(1);
  expect(roleRow([d], d.card.name, "burn")).toBeUndefined();
});

test("a branch the stored reading lost still counts whole when the printed Otherwise does the same (Jace, the Perfected Mind: draws 3, otherwise draws 1)", () => {
  const printed = { name: "Jace, the Perfected Mind", typeLine: "Legendary Planeswalker \u2014 Jace", keywords: [] as string[], oracleText: "Compleated ({U/P} can be paid with {U} or 2 life. If life was paid, this planeswalker enters with two fewer loyalty counters.)\n+1: Until your next turn, up to one target creature gets -3/-0.\n\u22122: Target player mills three cards. Then if a graveyard has twenty or more cards in it, you draw three cards. Otherwise, you draw a card.\n\u2212X: Target player mills three times X cards." };
  const a = (verb: string, object: string, amount: string) => ({ verb, object, fromZone: null, toZone: null, amount, optional: false }) as never;
  const records = [
    { id: 1, abilityType: "none", actions: [{ verb: "none", object: "Compleated" }] },
    { id: 2, abilityType: "activated", actions: [a("modify-pt", "up to one target creature", "-3/-0")] },
    { id: 3, abilityType: "activated", actions: [a("mill", "target player", "3"), a("draw", "you", "3")] },
    { id: 4, abilityType: "activated", actions: [a("mill", "target player", "3X")] },
  ] as never;
  const d: DeckCard = { card: { ...printed, manaValue: 4 } as never, tags: deriveCardTags(deriveInputOf(printed as never, "x", printed.name, records)) };
  const draw = d.tags!.abilities.find((x) => x.effect.kind === "draw-card")!;
  expect(draw.gate).toMatchObject({ kind: "unknown", text: "a graveyard has twenty or more cards in it" });
  expect(draw.otherwiseAlike).toBe(true);
  const deck = deckOf([d]);
  expect(computeBuild(deck, undefined, undefined, undefined, 0, undefined, makeGateWeigher(deck)).buildCategories.find((c) => c.category === "draw")!.count).toBe(1);
});

test("the Otherwise gate names the card, never '~' (Approach of the Second Sun)", () => {
  const d = make("Approach of the Second Sun");
  const other = d.tags!.abilities.find((a) => a.gate?.text.startsWith("it is not the case that"))!;
  expect(other.gate!.text).toBe("it is not the case that this spell was cast from your hand and you've cast another spell named approach of the second sun this game");
  expect(other.gate!.text).not.toContain("~");
});

test("Ertai's Trickery ('Counter target spell if it was kicked') is a condition on the TARGET, not the player's choice", () => {
  const d = make("Ertai's Trickery");
  const [a] = d.tags!.abilities.filter((x) => x.gate !== undefined);
  expect(makeGateWeigher(deckOf([d])).of(a!, d)).toMatchObject({ weight: 1, basis: "target" });
});

test("prowl, surge, warp and foretold are optional-cost choices too, each said in its own word", () => {
  for (const [name, needs] of [["Morsel Theft", "this spell's prowl cost was paid"], ["Crush of Tentacles", "this spell's surge cost was paid"], ["Poison the Cup", "this spell was foretold"], ["Full Bore", "that creature was cast for its warp cost"]] as const) {
    const d = make(name);
    const [a] = d.tags!.abilities.filter((x) => x.gate !== undefined);
    expect(makeGateWeigher(deckOf([d])).of(a!, d), name).toEqual({ weight: 1, conditional: true, basis: "choice", needs });
  }
});

test("a LONE Otherwise is no exhaustive set: the opponent chooses, and only the Otherwise puts a card into your hand (Protection Racket, Sin Prodder)", () => {
  for (const name of ["Protection Racket", "Sin Prodder"]) {
    const d = make(name);
    expect(d.tags!.abilities.filter((a) => a.gate !== undefined).map((a) => a.gate!.kind === "unknown" && a.gate!.otherwise), name).toEqual([true]);
    expect(roleRow([d], d.card.name, "handFill"), name).toMatchObject({ weight: 0.5, basis: "unread" });
  }
});
