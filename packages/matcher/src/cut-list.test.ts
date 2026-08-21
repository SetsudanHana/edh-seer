import { expect, test } from "vitest";
import { cutCandidates, deckSlack, trimOrder, CUT_RATING_MAX, CUT_AXIS_MAX, type CutInput, type SlackParent } from "./cut-list.js";

const card = (over: Partial<CutInput> & { name: string }): CutInput => ({
  rating: 0, axisWeight: 0, partnerCount: 0, manaValue: 0, roles: [], isLand: false,
  isCommander: false, isComboPiece: false, fillsDeckRole: false, ...over,
});
// FIX F2 (controller review, 2026-08-21): `deckSlack`/`trimOrder` read `buildParents` now, not
// leaf `buildCategories` -- a leaf's own target is permanently 0 since Task 7, so it could never
// be "over" again. A card's `roles` stay LEAF names (`rolesByCard` is unchanged), which is why
// each parent here still lists the same leaf the old fixture named.
const PARENTS: SlackParent[] = [
  { name: "Ramp", count: 14, target: 10, leaves: ["ramp"] },        // four to spare
  { name: "Consistency", count: 10, target: 10, leaves: ["draw"] }, // exactly at target
  { name: "Board wipes", count: 1, target: 3, leaves: ["boardWipe"] },
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

test("deckSlack names the over-target PARENTS, biggest surplus first, and never a card", () => {
  expect(deckSlack(PARENTS)).toEqual([{ category: "Ramp", count: 14, target: 10, over: 4 }]);
  // target 0 means "reported, never scored" (no archetype delta has lifted this group) — it can
  // never be over.
  expect(deckSlack([{ name: "Interaction", count: 2, target: 0, leaves: ["graveyardHate"] }])).toEqual([]);
  // NO LANDS EXCLUSION NEEDED ANY MORE: `lands` was never a `BUILD_PARENTS` member to begin with
  // (build.ts keeps it scored on its own two-sided band, outside every parent), so it can never
  // reach `deckSlack` as a row at all -- the guarantee moved from a filter here to the shape of
  // `buildParents` itself. `land-count.ts` still owns the land verdict from the deck's own curve.
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
  expect(trimOrder(tight, PARENTS)).toHaveLength(3);
});

// THE SOL RING REGRESSION, one layer up. The first cut of `trimOrder` dropped the protection from a
// role in an over-target category, which put `burakos-crashing-the-party`'s ENTIRE RAMP PACKAGE —
// Sol Ring included — in its top five, all tied at 0.0 and ordered by mana value. A role protects
// whatever the category count says; the surplus rides on the protection TEXT.
test("an over-target role still protects, and sorts behind a card with no role at all", () => {
  const rows = trimOrder([
    card({ name: "Sol Ring", roles: ["ramp"] }),
    card({ name: "Random Card" }),
  ], PARENTS);
  expect(rows.map((r) => r.name)).toEqual(["Random Card", "Sol Ring"]);
  expect(rows[0].protections).toEqual([]);
  // Names the PARENT ("Ramp"), never the leaf role -- fix F2: the leaf's own count is no longer
  // the number that is over target, so restating the leaf name here would be a false sentence.
  expect(rows[1].protections[0]).toContain("Ramp is at 14 against a target of 10");
});

test("a role in a category still under target says nothing about room", () => {
  const [row] = trimOrder([card({ name: "Wrath", roles: ["boardWipe"] })], PARENTS);
  expect(row.protections).toEqual(["fills boardWipe"]);
  expect(row.reasons.join(" ")).not.toContain("room");
});

test("trim protects a combo piece and a deck-role card, which the cut list drops entirely", () => {
  const rows = trimOrder([
    card({ name: "Half A Combo", isComboPiece: true }),
    card({ name: "Jet Medallion", fillsDeckRole: true }),
  ], PARENTS);
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
  ], PARENTS);
  expect(rows.map((r) => r.name)).toEqual(["Cuttable"]);
});

// DECK FIT (owner, 2026-08-20): "if you have a card that cares about red permanents and have none,
// it is not a very good card in the deck." An intervening-if condition names something the deck must
// provide, and a deck providing none makes that text dead.
test("an unmet condition is a REASON on both lists, and never a gate", () => {
  const dead = card({ name: "Oath of Liliana", unmetConditions: ["planeswalkers entering"] });
  const [cut] = cutCandidates([dead]);
  expect(cut.reasons).toContain("its condition needs planeswalkers entering, and nothing in the deck provides that");

  // NEVER A GATE, and Oath of Liliana is exactly why. Its "at the beginning of each end step, if a
  // planeswalker entered under your control this turn" half is dead in a deck with none — but its
  // ETB ("each opponent sacrifices a creature") is unconditional and real, so the card still works.
  // Verified live: it renders in trim at rating 1.5 carrying BOTH the unmet condition and
  // "its best edge is on your main theme". A rule that demoted it would throw away a working card.
  const protectedCard = card({
    name: "Oath of Liliana", unmetConditions: ["planeswalkers entering"], rating: 1.5, roles: ["draw"],
  });
  expect(cutCandidates([protectedCard])).toEqual([]);
  const [row] = trimOrder([protectedCard], PARENTS);
  expect(row.protections.length).toBeGreaterThan(0);
  expect(row.reasons.some((r) => r.includes("nothing in the deck provides that"))).toBe(true);

  // A card whose condition the deck DOES meet says nothing at all.
  expect(cutCandidates([card({ name: "Warlock Class" })])[0].reasons
    .some((r) => r.includes("nothing in the deck provides"))).toBe(false);
});

// --- F6: what a partner count means depends on the deck it is in. ---

/** A deck with a REAL SPREAD of partner counts, median 3: a flat fixture where every card carries
 *  the same count has no middle to be above, and "at the median" would then be true of everyone. */
const deckOf = (partners: number): CutInput[] => [
  card({ name: "Wired In", partnerCount: partners, rating: 0.8 }),
  card({ name: "Loner", partnerCount: 1, rating: 0.8 }),
  ...[0, 2, 3, 4, 6, 9].map((p, i) => card({ name: `Filler ${i}`, partnerCount: p, rating: 0.8 })),
];

// MEASURED ACROSS THE 71 DECKS BEFORE THIS EXISTED: 2,521 trim rows said "only N cards connect to
// it" about a card better connected than half its own deck — Herald's Horn at 38 partners in a deck
// whose median is 7, i.e. the deck's tribal cost-reducer described as isolated.
test("a card better connected than half its deck is not described as isolated", () => {
  const rows = trimOrder(deckOf(38));
  const wired = rows.find((r) => r.name === "Wired In")!;
  expect(wired.reasons[0]).toBe("38 cards connect to it, but none of those links is strong");
  const loner = rows.find((r) => r.name === "Loner")!;
  expect(loner.reasons[0]).toBe("only 1 card connects to it");
});

// AND IT IS A PROTECTION, not merely a wording fix: `trimOrder` leads on protection COUNT, so
// without it a card wired into half the deck was offered for the cut ahead of a card nothing
// touches. 28 of the 355 top-five slots across the 71 decks were held by such a card; now 2.
test("being well connected pushes a card down the trim order", () => {
  const rows = trimOrder(deckOf(38));
  expect(rows[0]!.name).not.toBe("Wired In");
  expect(rows.find((r) => r.name === "Wired In")!.protections)
    .toContain("connects to 38 cards, more than half this deck");
});

// A THREE-CARD LIST HAS NO MIDDLE. With one cuttable card the median IS that card, so a naive
// comparison would call it well connected on the strength of its own single edge.
test("a universe too small to have a middle keeps the plain wording", () => {
  const [row] = trimOrder([card({ name: "Alone", partnerCount: 2, rating: 0.5 })]);
  expect(row!.reasons[0]).toBe("only 2 cards connect to it");
  expect(row!.protections.join(" ")).not.toContain("more than half");
});
