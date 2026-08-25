import { expect, test } from "vitest";
import { pAtLeast, seen } from "@mtg/engine";
import type { DeckCard } from "./types.js";
import { classifyAccelerant, manaAvailability, pAtLeastMana, quantiles, rng, simulate } from "./goldfish.js";

const card = (name: string, typeLine: string, manaValue = 0, oracleText = "", producedMana?: string[]): DeckCard => ({
  card: { name, typeLine, oracleText, keywords: [], colors: [], manaValue, ...(producedMana ? { producedMana } : {}) } as never,
  tags: null,
});

const basics = (n: number, name = "Forest"): DeckCard[] =>
  Array.from({ length: n }, (_, i) => card(`${name} ${i}`, "Basic Land — Forest"));
const spells = (n: number, manaValue: number): DeckCard[] =>
  Array.from({ length: n }, (_, i) => card(`Spell ${manaValue}-${i}`, "Sorcery", manaValue));

/** The trial count every anchor runs at. Big enough that Monte Carlo error is well inside the
 *  tolerances below, small enough to stay in `npm test` — the 20k × 71 sweep is a bin, like every
 *  other instrument here. */
const TRIALS = 20_000;

// C6. DETERMINISM. A Monte Carlo whose output moves between runs cannot be a ratchet baseline, and
// `Math.random` is banned by this test rather than by convention.
test("the generator is seeded and the simulation is reproducible", () => {
  const a = rng(7), b = rng(7), c = rng(8);
  const first = [a(), a(), a()];
  expect([b(), b(), b()]).toEqual(first);
  expect([c(), c(), c()]).not.toEqual(first);

  const deck = [...basics(37), ...spells(62, 3)];
  const one = simulate(deck, { trials: 200, turns: 4, seed: 3 });
  const two = simulate(deck, { trials: 200, turns: 4, seed: 3 });
  expect(one.manaAt).toEqual(two.manaAt);
});

// A1 — THE CAPPED OFF-DIAGONAL, LANDS ONLY, and it is an EXTERNAL check of the land-drop cap rather
// than an assertion inside the simulator. With no ramp, P(≥M mana at T) is the closed form for
// M ≤ T and EXACTLY ZERO for M > T — which is the half `pAtLeast` gets wrong: `pAtLeast(4, 37,
// seen(3), 99)` answers 55.5%, four mana on turn three off three land drops.
test("A1: lands only reproduces the closed form on the diagonal and is exactly zero above it", () => {
  const deck = [...basics(37), ...spells(62, 3)];
  const r = simulate(deck, { trials: TRIALS, turns: 6, seed: 11 });
  for (let t = 1; t <= 6; t++) {
    const closed = pAtLeast(t, 37, seen(t), deck.length);
    expect(Math.abs(pAtLeastMana(r, t, t) - closed), `turn ${t}`).toBeLessThan(0.015);
    // C2: never more than one land drop per turn. Checked from OUTSIDE, which is the difference
    // between a ratchet proven to fire and decoration.
    expect(pAtLeastMana(r, t + 1, t), `turn ${t} cannot make ${t + 1}`).toBe(0);
  }
});

// A3 — THE ALL-TAPPED DECK. Every land unconditionally tapped, so the whole curve shifts a turn: the
// land played on turn T pays from turn T+1, and mana at T is the closed form one turn back.
test("A3: an all-tapped deck is the same curve shifted one turn", () => {
  const tapped = Array.from({ length: 37 }, (_, i) =>
    card(`Tapped ${i}`, "Land", 0, "This land enters tapped.\n{T}: Add {G}."));
  const deck = [...tapped, ...spells(62, 3)];
  const r = simulate(deck, { trials: TRIALS, turns: 6, seed: 13 });
  expect(pAtLeastMana(r, 1, 1)).toBe(0); // the turn-1 land is tapped, so turn 1 makes nothing
  for (let t = 2; t <= 6; t++) {
    const closed = pAtLeast(t - 1, 37, seen(t - 1), deck.length);
    expect(Math.abs(pAtLeastMana(r, t - 1, t) - closed), `turn ${t}`).toBeLessThan(0.02);
  }
});

// A2 — THE ONE-ACCELERANT DECK, which anchors the accelerant path INCLUDING rule 4's timing. A rock
// has no summoning sickness (CR 302.6 restricts creatures) and pays the turn it lands; a dork waits.
// The two decks are identical but for that one word on the type line.
test("A2: a rock pays the turn it lands and a dork waits one", () => {
  const withRock = [...basics(37), card("Sol Ring", "Artifact", 1, "{T}: Add {C}{C}.", ["C"]), ...spells(61, 3)];
  const withDork = [...basics(37), card("Llanowar Elves", "Creature — Elf Druid", 1, "{T}: Add {G}.", ["G"]), ...spells(61, 3)];
  const rock = simulate(withRock, { trials: TRIALS, turns: 4, seed: 17 });
  const dork = simulate(withDork, { trials: TRIALS, turns: 4, seed: 17 });

  // Turn 2 is where the two differ and the closed form cannot go: with two lands and the accelerant
  // cast on turn 1 off one land, the rock is already making mana and the elf is not.
  expect(pAtLeastMana(rock, 3, 2)).toBeGreaterThan(pAtLeastMana(dork, 3, 2));
  // Both beat the lands-only deck by turn 4 — the accelerant is real in each case, only later.
  const bare = simulate([...basics(37), ...spells(62, 3)], { trials: TRIALS, turns: 4, seed: 17 });
  expect(pAtLeastMana(rock, 5, 4)).toBeGreaterThan(pAtLeastMana(bare, 5, 4));
  expect(pAtLeastMana(dork, 5, 4)).toBeGreaterThan(pAtLeastMana(bare, 5, 4));
});

// C3 — THE TAPPED PREDICATE FIRES IN BOTH DIRECTIONS, through the simulator rather than through the
// classifier's own unit tests: a slow land is tapped as the first drop and untapped later, so a deck
// of nothing but slow lands makes strictly less mana early and catches up.
test("C3: a conditional land is tapped early and untapped later", () => {
  const slow = Array.from({ length: 37 }, (_, i) =>
    card(`Sundown Pass ${i}`, "Land", 0, "This land enters tapped unless you control two or more other lands.\n{T}: Add {R} or {W}."));
  const r = simulate([...slow, ...spells(62, 3)], { trials: TRIALS, turns: 6, seed: 19 });
  const bare = simulate([...basics(37), ...spells(62, 3)], { trials: TRIALS, turns: 6, seed: 19 });
  // Turn 1 and 2 are strictly worse — every drop enters tapped.
  expect(pAtLeastMana(r, 1, 1)).toBe(0);
  expect(pAtLeastMana(r, 2, 2)).toBeLessThan(pAtLeastMana(bare, 2, 2));
  // By turn 5 the third drop onward is untapped, so the gap narrows rather than persisting.
  const early = pAtLeastMana(bare, 2, 2) - pAtLeastMana(r, 2, 2);
  const late = pAtLeastMana(bare, 5, 5) - pAtLeastMana(r, 5, 5);
  expect(late).toBeLessThan(early);
});

// C4's NEGATIVE ARM IS **NOT** THIS TEST, and saying so is the point. The registered criterion is
// about "a deck at or below the corpus MINIMUM of 3 accelerants", which is a claim about the 71
// real decks and therefore lives in the bin, where the corpus is. A synthetic 37-land pile with
// three two-mana rocks bolted on is a different object, and it MISSES the registered <5pp bound
// outright — MEASURED: +9.4pp at turn 6, because by turn 6 you have seen 13 cards and P(at least one
// of three rocks) is ~35%, landing squarely on the 6-mana threshold. That figure is recorded rather
// than tuned away; what it says is that three cheap rocks are worth more than the criterion assumed,
// on a deck built to have nothing else going on.
//
// What a unit test CAN anchor without the corpus is the DOSE: more accelerants must be worth more,
// and none must be worth nothing.
test("accelerants are monotone in count, and three are worth less than thirteen", () => {
  const bare = [...basics(37), ...spells(62, 3)];
  const rocks = (n: number): DeckCard[] =>
    Array.from({ length: n }, (_, i) => card(`Rock ${i}`, "Artifact", 2, "{T}: Add {C}.", ["C"]));
  const thin = [...basics(37), ...rocks(3), ...spells(59, 3)];
  // Thirteen is the corpus MEDIAN accelerant count, so this is the shape of a real deck's dose.
  const thick = [...basics(37), ...rocks(13), ...spells(49, 3)];
  const at6 = (deck: DeckCard[]): number =>
    pAtLeastMana(simulate(deck, { trials: TRIALS, turns: 6, seed: 23 }), 6, 6);
  const [a, b, c] = [at6(bare), at6(thin), at6(thick)];
  expect(b).toBeGreaterThan(a);
  expect(c).toBeGreaterThan(b);
  // …and the dose is not flat: the step from 3 to 13 is bigger than the step from 0 to 3.
  expect(c - b).toBeGreaterThan(b - a);
});

test("classifyAccelerant reads the printed data and refuses a one-shot", () => {
  expect(classifyAccelerant(card("Sol Ring", "Artifact", 1, "{T}: Add {C}{C}.", ["C"]))?.kind).toBe("rock");
  expect(classifyAccelerant(card("Llanowar Elves", "Creature — Elf Druid", 1, "{T}: Add {G}.", ["G"]))?.kind).toBe("dork");
  // A land-fetch spell produces no mana of its own, which is exactly why `manaWithRocks` cannot see
  // it — and it is the biggest term on a green deck.
  const lore = classifyAccelerant(card("Nature's Lore", "Sorcery", 2,
    "Search your library for a Forest card, put that card onto the battlefield, then shuffle."));
  expect(lore).toEqual({ name: "Nature's Lore", manaValue: 2, kind: "land-fetch", fetchTapped: false });
  const reach = classifyAccelerant(card("Kodama's Reach", "Sorcery", 3,
    "Search your library for up to two basic land cards, reveal them, put one onto the battlefield tapped and the other into your hand, then shuffle."));
  expect(reach?.fetchTapped).toBe(true);
  // A RITUAL IS NOT A SOURCE at any confidence — `isManaSource`'s ruling, restated here because the
  // ceiling it creates is real: Dark Ritual does enable a turn.
  expect(classifyAccelerant(card("Dark Ritual", "Instant", 1, "Add {B}{B}{B}.", ["B"]))).toBeNull();
  // A land is a land drop, never an accelerant cast.
  expect(classifyAccelerant(card("Forest", "Basic Land — Forest", 0, "", ["G"]))).toBeNull();
});

// C7. THE SPREAD IS REPORTED, NEVER JUST THE MEDIAN — a median with no p25/p75 beside it invites a
// reader to treat a distribution as a number.
test("quantiles report the spread and survive an empty sample", () => {
  expect(quantiles([1, 2, 3, 4, 5, 6, 7, 8])).toEqual({ p25: 3, median: 5, p75: 7 });
  expect(quantiles([])).toEqual({ p25: 0, median: 0, p75: 0 });
});

// C10. NO OUTPUT CARRIES THE WORD "castable" WHILE THE MODEL IS COLOUR-BLIND. A criterion because it
// is exactly the label that drifts back in through a field name or a renderer.
test("no result field says castable", () => {
  const r = simulate([...basics(37), ...spells(62, 3)], { trials: 50, turns: 2, seed: 1 });
  expect(Object.keys(r).join(" ")).not.toMatch(/castab/i);
});

// THE REPORT WIRING (I11 step 5). This is where the refused quantities could leak into a headline,
// so the shape itself is asserted rather than left to a renderer's good intentions.
test("the report shape is an INTERVAL on the cell the policy moves, and a median-plus-spread elsewhere", () => {
  const deck = [...basics(37), card("Sol Ring", "Artifact", 1, "{T}: Add {C}{C}.", ["C"]), ...spells(61, 3)];
  const m = manaAvailability(deck, { trials: 2_000, turns: 8 });

  // THE HEADLINE IS THE FALSIFIER'S OWN CELL, and it is a range with both ends present.
  expect(m.headline).toMatchObject({ mana: 6, turn: 6 });
  expect(m.headline.low).toBeLessThanOrEqual(m.headline.high);

  // THE PER-TURN ROWS ARE NOT A SECOND INTERVAL, and that is the finding: the two policies agree on
  // every median and disagree only in the tail. Each row carries its spread instead, so C7 holds
  // without printing "15% - 15%" eight times.
  expect(m.rows).toHaveLength(8);
  for (const r of m.rows) {
    expect(r.mana.p25).toBeLessThanOrEqual(r.mana.median);
    expect(r.mana.median).toBeLessThanOrEqual(r.mana.p75);
    expect(r.payableShare.p25).toBeLessThanOrEqual(r.payableShare.median);
    expect(r.payableShare.median).toBeLessThanOrEqual(r.payableShare.p75);
  }
  // The land-drop cap survives the wiring: turn 1 can never be more than one mana off one land, and
  // the accelerant cannot arrive before it is drawn.
  expect(m.rows[0].mana.p75).toBeLessThanOrEqual(2);

  // C10 REACHES THE REPORT SHAPE TOO — the field name is exactly where a banned word creeps back in.
  expect(JSON.stringify(m)).not.toMatch(/castab/i);
  expect(m.accelerants).toBe(1);
});
