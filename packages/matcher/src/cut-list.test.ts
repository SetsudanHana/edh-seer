import { expect, test } from "vitest";
import { cutCandidates, deckSlack, trimOrder, CUT_RATING_MAX, CUT_AXIS_MAX, type CutInput } from "./cut-list.js";

const card = (over: Partial<CutInput> & { name: string }): CutInput => ({
  rating: 0, axisWeight: 0, partnerCount: 0, manaValue: 0, roles: [], isLand: false,
  isCommander: false, isComboPiece: false, fillsDeckRole: false, ...over,
});
const CATS = [
  { category: "ramp", count: 14, target: 10 },   // four to spare
  { category: "draw", count: 10, target: 10 },   // exactly at target
  { category: "boardWipe", count: 1, target: 3 },
];

test("a dead card is a candidate and its reasons name every condition", () => {
  const [row] = cutCandidates([card({ name: "Dead Weight" })]);
  expect(row.name).toBe("Dead Weight");
  expect(row.reasons).toEqual([
    "nothing in the deck connects to it",
    "no edge on your main theme",
    "fills none of the functional roles the deck is measured on",
  ]);
});

test("lands, commanders and combo pieces are never candidates", () => {
  const rows = cutCandidates([
    card({ name: "Wastes", isLand: true }),
    card({ name: "The Boss", isCommander: true }),
    card({ name: "Half A Combo", isComboPiece: true }),
  ]);
  expect(rows).toEqual([]);
});

// THE GATE THAT KEEPS SOL RING OFF THE LIST. Before it, a card whose every role sat in an
// over-target category was a candidate, and the 71-deck run flagged Sol Ring, Arcane Signet and
// Dark Ritual in a deck running ramp 14/10. Nothing here ranks two ramp cards, so a surplus
// category cannot name which member is the worst one.
test("any functional role protects the card, even in a category way over target", () => {
  const rows = cutCandidates([
    card({ name: "Nth Rock", roles: ["ramp"] }),
    card({ name: "Nth Cantrip", roles: ["draw"] }),
    card({ name: "Roleless", roles: [] }),
  ]);
  expect(rows.map((r) => r.name)).toEqual(["Roleless"]);
  expect(rows[0].reasons[2]).toBe("fills none of the functional roles the deck is measured on");
});

// A deliberate silence is not evidence: cost reduction and tax form no edge by design, so their
// zero partner count means nothing. The first 71-deck run flagged Jet Medallion for exactly this.
test("a ROLE_NOT_SYNERGY card is protected, however dead it looks", () => {
  const rows = cutCandidates([card({ name: "Jet Medallion", fillsDeckRole: true })]);
  expect(rows).toEqual([]);
});

test("deckSlack names the over-target categories, biggest surplus first, and never a card", () => {
  expect(deckSlack(CATS)).toEqual([{ category: "ramp", count: 14, target: 10, over: 4 }]);
  // target 0 means "reported, never scored" (graveyardHate) — it can never be over.
  expect(deckSlack([{ category: "graveyardHate", count: 2, target: 0 }])).toEqual([]);
});

test("the rating and axis gates are boundaries, not ranges", () => {
  const rows = cutCandidates([
    card({ name: "At The Rating Line", rating: CUT_RATING_MAX }),
    card({ name: "Over The Rating Line", rating: CUT_RATING_MAX + 0.1 }),
    card({ name: "At The Axis Line", axisWeight: CUT_AXIS_MAX }),
    card({ name: "Under The Axis Line", axisWeight: CUT_AXIS_MAX - 0.01 }),
  ]);
  // weakest first, so the rating-0 card leads the rating-1.0 one
  expect(rows.map((r) => r.name)).toEqual(["Under The Axis Line", "At The Rating Line"]);
});

test("an on-theme edge is stated as pointing away, not as absent", () => {
  const [row] = cutCandidates([card({ name: "Off Axis", axisWeight: 0.1, partnerCount: 1 })]);
  expect(row.reasons[0]).toBe("only 1 card connects to it");
  expect(row.reasons[1]).toBe("its edges point away from your main theme");
});

test("weakest first, ties broken by fewest partners then name, and the list is capped", () => {
  const rows = cutCandidates([
    card({ name: "B", rating: 0.5, partnerCount: 3 }),
    card({ name: "A", rating: 0.5, partnerCount: 3 }),
    card({ name: "Lonely", rating: 0.5, partnerCount: 1 }),
    card({ name: "Zero", rating: 0 }),
  ], 3);
  expect(rows.map((r) => r.name)).toEqual(["Zero", "Lonely", "A"]);
});

/** Cost orders the list and never admits a row to it. Two cards the deck cannot connect are
 *  different cut candidates when one costs 9 and the other 1 -- which is the only sense in which
 *  cost belongs here, since nothing in this repo models card quality. */
test("mana value breaks a tie, expensive first, and gates nothing", () => {
  const base = { rating: 0.3, axisWeight: 0, partnerCount: 0, roles: [], fillsDeckRole: false, isLand: false, isCommander: false, isComboPiece: false };
  const rows = cutCandidates([
    { ...base, name: "Cheap", manaValue: 1 },
    { ...base, name: "Expensive", manaValue: 9 },
  ]);
  expect(rows.map((r) => r.name)).toEqual(["Expensive", "Cheap"]);
  expect(rows.map((r) => r.manaValue)).toEqual([9, 1]);
});

test("a costly card the deck DOES use is still not a candidate", () => {
  const rows = cutCandidates([{
    name: "Expensive engine", rating: 3.0, axisWeight: 0.8, partnerCount: 12, manaValue: 9,
    roles: [], fillsDeckRole: false, isLand: false, isCommander: false, isComboPiece: false,
  }]);
  expect(rows).toEqual([]);
});

// TRIM MODE. `cutCandidates` filters and is EMPTY on 18 of the 71 calibration decks; "I'm five over"
// still needs five rows there, which is the whole reason this exists.
test("trim always has an Nth row, where the passive cut list has none at all", () => {
  const tight = [
    card({ name: "Engine", rating: 4, axisWeight: 0.9, partnerCount: 20 }),
    card({ name: "Rock", rating: 0, roles: ["ramp"] }),
    card({ name: "Wheel", rating: 2, axisWeight: 0.6, partnerCount: 9, roles: ["draw"] }),
  ];
  expect(cutCandidates(tight)).toEqual([]);
  expect(trimOrder(tight, CATS)).toHaveLength(3);
});

// THE SOL RING REGRESSION, one layer up. The first cut of `trimOrder` dropped the protection from a
// role in an over-target category, which put `burakos-crashing-the-party`'s ENTIRE RAMP PACKAGE —
// Sol Ring included — in its top five, all tied at 0.0 and ordered by mana value. A role protects
// whatever the category count says; the surplus rides on the protection TEXT.
test("an over-target role still protects, and sorts behind a card with no role at all", () => {
  const rows = trimOrder([
    card({ name: "Sol Ring", roles: ["ramp"] }),
    card({ name: "Random Card" }),
  ], CATS);
  expect(rows.map((r) => r.name)).toEqual(["Random Card", "Sol Ring"]);
  expect(rows[0].protections).toEqual([]);
  expect(rows[1].protections[0]).toContain("ramp is at 14 against a target of 10");
});

test("a role in a category still under target says nothing about room", () => {
  const [row] = trimOrder([card({ name: "Wrath", roles: ["boardWipe"] })], CATS);
  expect(row.protections).toEqual(["fills boardWipe"]);
  expect(row.reasons.join(" ")).not.toContain("room");
});

test("trim protects a combo piece and a deck-role card, which the cut list drops entirely", () => {
  const rows = trimOrder([
    card({ name: "Half A Combo", isComboPiece: true }),
    card({ name: "Jet Medallion", fillsDeckRole: true }),
  ], CATS);
  expect(cutCandidates(rows.map((r) => card({ name: r.name })))).toHaveLength(2); // both cuttable when stripped
  expect(rows.find((r) => r.name === "Half A Combo")!.protections)
    .toEqual(["half of a combo the deck assembles"]);
  expect(rows.find((r) => r.name === "Jet Medallion")!.protections[0])
    .toContain("without forming edges");
});

test("lands and commanders are outside the trim universe entirely", () => {
  const rows = trimOrder([
    card({ name: "Wastes", isLand: true }),
    card({ name: "The Boss", isCommander: true }),
    card({ name: "Cuttable" }),
  ], CATS);
  expect(rows.map((r) => r.name)).toEqual(["Cuttable"]);
});
