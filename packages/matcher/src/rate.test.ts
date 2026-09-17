import { expect, test } from "vitest";
import type { CardTags } from "@edh-seer/tagger";
import { bestRates, compareRates, manaOf, ratesOf, type Rate, type RateTriple } from "./rate.js";
import type { DeckCard } from "./types.js";

/** A card with one derived ability and a printed cost. Verified oracle texts from the corpus
 *  (2026-09-17): Divination "Draw two cards." {2}{U}; Rhystic Study "Whenever an opponent casts a
 *  spell, you may draw a card unless that player pays {1}." {2}{U}; Blue Sun's Zenith "Target
 *  player draws X cards." {X}{U}{U}{U}. */
const card = (name: string, manaCost: string, abilities: unknown[], over: { types?: string[]; keywords?: string[]; text?: string } = {}): DeckCard => ({
  card: { name, typeLine: "", oracleText: over.text ?? "", keywords: over.keywords ?? [], colors: [], manaValue: manaOf(manaCost) ?? 0, manaCost } as unknown as DeckCard["card"],
  tags: {
    oracleId: name, schemaVersion: 1, promptVersion: 1, model: "t",
    characteristics: { types: over.types ?? ["sorcery"], subtypes: [], colors: [], identity: [], cmc: 0, power: null, toughness: null, token: false, keywords: [] },
    abilities: abilities as CardTags["abilities"],
  } as CardTags,
});

test("manaOf reads generic, pips and hybrids, skips tap and energy, refuses X", () => {
  expect(manaOf("{2}{U}")).toBe(3);
  expect(manaOf("{4}, {T}")).toBe(4);
  expect(manaOf("{T}")).toBe(0);
  expect(manaOf("{B/R}{2/W}{C/G}")).toBe(3);
  expect(manaOf("{X}{U}{U}{U}")).toBeNull();
  expect(manaOf(undefined)).toBeNull();
});

/** A FIXED ONE-SHOT IS A POINT: floor and ceiling are the amount, for the card's own mana. */
test("Divination: two cards for three mana, floor and ceiling alike", () => {
  const [r, ...rest] = ratesOf(card("Divination", "{2}{U}", [
    { kind: "on-cast", effect: { kind: "draw-card", subject: { control: "you", token: null } }, amount: "2", repeats: "once" },
  ]));
  expect(rest).toEqual([]);
  expect(r).toEqual({ family: "cards", kind: "on-cast", amount: 2, mana: 3, repeats: "once", floor: 2, ceiling: 2 });
});

/** A TRIGGER HAS A FLOOR OF 0 AND AN OPEN CEILING (owner 2026-09-17: "Rhystic Study can draw you 0
 *  cards at worst, but it is still 'opponents' spells cost 1 more'"): the payment that stops it is
 *  the fallback, carried verbatim, never priced. */
test("Rhystic Study: one card per trigger, floor 0, open ceiling, the {1} tax as fallback", () => {
  const [r] = ratesOf(card("Rhystic Study", "{2}{U}", [
    { kind: "triggered", trigger: { verbs: ["cast"], subject: { type: "spell", control: "opp", token: null } },
      effect: { kind: "draw-card", subject: { control: "you", token: null } }, amount: "1", repeats: "repeatable",
      unless: { cost: "{1}", payer: "opponent" } },
  ]));
  expect(r).toEqual({ family: "cards", kind: "triggered", amount: 1, mana: 3, repeats: "repeatable", floor: 0, ceiling: null, fallback: { cost: "{1}", payer: "opponent" } });
});

/** AN X SPELL IS A SLOPE: the fixed part of the cost is the mana, and each further mana is one
 *  card. That is the honest answer where a mana value was not (the `{X}` deadline defect). */
test("Blue Sun's Zenith: a slope of one card per mana after three", () => {
  const [r] = ratesOf(card("Blue Sun's Zenith", "{X}{U}{U}{U}", [
    { kind: "on-cast", effect: { kind: "draw-card", scaling: "x-cost", subject: { control: "you", token: null } }, amount: "X", repeats: "once" },
  ]));
  expect(r).toEqual({ family: "cards", kind: "on-cast", amount: 0, mana: 3, slope: 1, repeats: "once", floor: 0, ceiling: null });
});

/** AN ACTIVATION IS PRICED ON ITS OWN COST, not the card's: paying gives the effect every time. */
test("an activated draw is one card per four mana, each activation", () => {
  const [r] = ratesOf(card("Jayemdae Tome", "{4}", [
    { kind: "activated", cost: "{4}, {T}", effect: { kind: "draw-card", subject: { control: "you", token: null } }, amount: "1", repeats: "repeatable" },
  ]));
  expect(r).toEqual({ family: "cards", kind: "activated", amount: 1, mana: 4, repeats: "repeatable", floor: 1, ceiling: 1 });
});

test("damage is its own family, and a bolt is three for one", () => {
  const [r] = ratesOf(card("Lightning Bolt", "{R}", [
    { kind: "on-cast", effect: { kind: "damage", subject: { control: "any", token: null } }, amount: "3", repeats: "once" },
  ]));
  expect(r).toEqual({ family: "damage", kind: "on-cast", amount: 3, mana: 1, repeats: "once", floor: 3, ceiling: 3 });
});

/** REFUSALS, each a distinct reason: cards drawn by someone else are not your rate; an amount the
 *  card states as a count of something is not a number; a payment YOU make to keep the effect is a
 *  cost, not a rate; damage to your own side is a cost too; a family the axis does not cover has
 *  no row. */
test("what refuses a rate: another player's draw, a counted amount, your own upkeep payment, an uncovered family", () => {
  expect(ratesOf(card("Howling Mine", "{2}", [
    { kind: "triggered", effect: { kind: "draw-card", subject: { control: "any", token: null } }, amount: "1", repeats: "per-cycle" },
  ]))).toEqual([]);
  expect(ratesOf(card("Blue Sun's Cousin", "{2}{U}", [
    { kind: "on-cast", effect: { kind: "draw-card", scaling: "per-creature", subject: { control: "you", token: null } }, amount: "X", repeats: "once" },
  ]))).toEqual([]);
  expect(ratesOf(card("Phantasmal Forces", "{3}{U}", [
    { kind: "triggered", effect: { kind: "draw-card", subject: { control: "you", token: null } }, amount: "1", repeats: "per-cycle", unless: { cost: "{U}", payer: "you" } },
  ]))).toEqual([]);
  expect(ratesOf(card("Self-Immolation", "{R}", [
    { kind: "on-cast", effect: { kind: "damage", subject: { control: "you", token: null } }, amount: "4", repeats: "once" },
  ]))).toEqual([]);
  expect(ratesOf(card("Llanowar Elves", "{G}", [
    { kind: "activated", cost: "{T}", effect: { kind: "mana-generation" }, repeats: "repeatable" },
  ]))).toEqual([]);
});

/** SUMMONING SICKNESS (CR 302.6; owner 2026-09-17: "account for summoning sickness on the
 *  creatures"). A creature's tap ability and its own attack trigger wait a turn; haste, a
 *  noncreature, and a cast-trigger do not. The rate is unchanged -- the first yield is later. */
test("a creature's tap ability and attack trigger are delayed; haste, an artifact and a cast trigger are not", () => {
  const tapDraw = [{ kind: "activated", cost: "{T}", effect: { kind: "draw-card", subject: { control: "you", token: null } }, amount: "1", repeats: "repeatable" }];
  expect(ratesOf(card("Merfolk Looter-ish", "{1}{U}", tapDraw, { types: ["creature"] }))[0]?.delayed).toBe(true);
  expect(ratesOf(card("Hasty Looter", "{1}{U}", tapDraw, { types: ["creature"], keywords: ["Haste"] }))[0]?.delayed).toBeUndefined();
  expect(ratesOf(card("Jayemdae Tome", "{4}", tapDraw, { types: ["artifact"] }))[0]?.delayed).toBeUndefined();
  const attackDraw = [{ kind: "triggered", trigger: { verbs: ["attacks"], subject: { self: true, control: "you", token: null } }, effect: { kind: "draw-card", subject: { control: "you", token: null } }, amount: "1", repeats: "per-turn" }];
  expect(ratesOf(card("Attacking Drawer", "{2}{U}", attackDraw, { types: ["creature"] }))[0]?.delayed).toBe(true);
  const castDraw = [{ kind: "triggered", trigger: { verbs: ["cast"], subject: { type: "spell", control: "you", token: null } }, effect: { kind: "draw-card", subject: { control: "you", token: null } }, amount: "1", repeats: "repeatable" }];
  expect(ratesOf(card("Cast Drawer", "{2}{U}", castDraw, { types: ["creature"] }))[0]?.delayed).toBeUndefined();
});

/** A CONDITION THE ABILITY CANNOT SHOW PUTS THE FLOOR AT 0 (Fiery Gambit's nine cards are behind
 *  coin flips; the derived ability says "draw 9" and nothing else). The amount stays the ceiling. */
test("an amount behind a condition on the card's text has a floor of 0 and keeps its ceiling", () => {
  const draw9 = [{ kind: "on-cast", effect: { kind: "draw-card", subject: { control: "you", token: null } }, amount: "9", repeats: "once" }];
  const gambit = ratesOf(card("Fiery Gambit", "{2}{R}", draw9, { text: "Flip a coin until you lose a flip or choose to stop flipping. If you win three or more flips, draw nine cards." }))[0];
  expect(gambit).toMatchObject({ floor: 0, ceiling: 9, conditional: true });
  const plain = ratesOf(card("Divination", "{2}{U}", [{ kind: "on-cast", effect: { kind: "draw-card", subject: { control: "you", token: null } }, amount: "2", repeats: "once" }], { text: "Draw two cards." }))[0];
  expect(plain).toMatchObject({ floor: 2, ceiling: 2 });
  expect(plain).not.toHaveProperty("conditional");
});

/** AN ACTIVATION THAT CHARGES MORE THAN MANA says so: "{R}, Sacrifice this creature: 6 damage" is
 *  not six for one. The rate stands, the flag lets a per-mana sort leave it out. */
test("an activation cost with words in it is flagged as more than mana", () => {
  const sac = [{ kind: "activated", cost: "{R}, Sacrifice this creature", effect: { kind: "damage", subject: { control: "any", token: null } }, amount: "6", repeats: "once" }];
  expect(ratesOf(card("Bloodfire Colossus", "{6}{R}{R}", sac, { types: ["creature"] }))[0]).toMatchObject({ mana: 1, floor: 6, extraCost: true });
  const tap = [{ kind: "activated", cost: "{4}, {T}", effect: { kind: "draw-card", subject: { control: "you", token: null } }, amount: "1", repeats: "repeatable" }];
  expect(ratesOf(card("Jayemdae Tome", "{4}", tap))[0]).not.toHaveProperty("extraCost");
});

/** THE ORDER A SEARCH ROW SORTS BY: floor per mana, then ceiling per mana with open above bounded,
 *  then the cheaper ability. */
test("compareRates: priced before free, floor per mana first, open ceiling breaks above a bounded one, cheaper last", () => {
  const rows: RateTriple[] = [
    [0, 9, 3],      // Fiery Gambit: conditional, ceiling 9
    [2, 2, 3],      // Divination
    [3, 3, 1],      // Brainstorm
    [0, null, 3],   // Rhystic Study: a trigger
    [1, 1, 0],      // Merfolk Looter: free activation
    [1, 1, 1],      // one for one
  ];
  expect([...rows].sort(compareRates)).toEqual([[3, 3, 1], [1, 1, 1], [2, 2, 3], [0, null, 3], [0, 9, 3], [1, 1, 0]]);
  expect(compareRates([3, 3, 0], [1, 1, 0])).toBeLessThan(0);
  expect(compareRates([0, null, 0], [0, null, 0])).toBe(0);
});

test("bestRates keeps the best per family and leaves an extraCost activation out", () => {
  const rate = (over: Partial<Rate>): Rate => ({ family: "cards", kind: "activated", amount: 1, mana: 1, repeats: "repeatable", floor: 1, ceiling: 1, ...over });
  expect(bestRates([
    rate({ floor: 1, ceiling: 1, mana: 2 }),
    rate({ floor: 1, ceiling: 1, mana: 1 }),
    rate({ family: "damage", floor: 6, ceiling: 6, mana: 1, extraCost: true }),
    rate({ family: "damage", floor: 0, ceiling: null, mana: 4 }),
  ])).toEqual({ cards: [1, 1, 1], damage: [0, null, 4] });
  expect(bestRates([])).toEqual({});
});

/** A LOYALTY COST IS NOT MANA (CR 606.5). Teferi, Temporal Pilgrim "0: Draw a card." (corpus,
 *  2026-09-17) read as one card for nothing on the first chip sort. */
test("a loyalty or empty cost has no mana to read and is refused", () => {
  const draw = (cost: string) => ({ kind: "activated", cost, effect: { kind: "draw-card", subject: { control: "you", token: null } }, amount: "1", repeats: "per-turn" });
  expect(ratesOf(card("Teferi, Temporal Pilgrim", "{3}{U}{U}", [draw("0"), draw("+1"), draw("−3"), draw("")], { types: ["planeswalker"] }))).toEqual([]);
  expect(ratesOf(card("Obsessive Stitcher", "{1}{U}{B}", [draw("{T}")], { types: ["creature"] }))).toMatchObject([{ mana: 0, floor: 1, delayed: true }]);
});
