import { expect, test } from "vitest";
import { pAtLeast, seen } from "@mtg/engine";
import type { DeckCard } from "./types.js";
import { classifyAccelerant, colorMask, fetchMask, isEveryLandType, manaAvailability, manaOutput, parseCost, payable, pAtLeastMana, quantiles, rng, simulate, takeRandomLand } from "./goldfish.js";

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

// C10, NOW A PERMISSION RATHER THAN A PROHIBITION (L4a, 2026-08-25). The word "castable" was banned
// outright while the model was colour-blind. Colour is modelled now, so the rule is that the word may
// appear on the ONE field that actually checks it and nowhere else -- which is the same guard, and
// still the label that drifts back in through a field name or a renderer.
test("only the colour-aware field may say castable", () => {
  const r = simulate([...basics(37), ...spells(62, 3)], { trials: 50, turns: 2, seed: 1 });
  const named = Object.keys(r).filter((k) => /castab/i.test(k));
  expect(named).toEqual(["byCardCastable"]);
  // The mana-only readouts keep their old names, because they still answer the old, narrower
  // question: how much mana, not whether the colours line up.
  expect(Object.keys(r)).toContain("byCard");
  expect(Object.keys(r)).toContain("payableShareAt");
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

// ---------------------------------------------------------------------------------------------
// WHAT A SOURCE TAPS FOR. Every source in this model produced exactly one mana until `manaOutput`
// existed — a Forest, Sol Ring and an assembled Urza's Tower alike. Sol Ring alone is in 52 of the
// 71 decks. Oracle text below is quoted from the corpus, never recalled.
// ---------------------------------------------------------------------------------------------

test("manaOutput reads what one tap nets, and refuses what it cannot price", () => {
  // The whole point: a rock that taps for two.
  expect(manaOutput("{T}: Add {C}{C}.")).toEqual({ amount: 2 });
  expect(manaOutput("{T}: Add {C}{C}{C}.")).toEqual({ amount: 3 });
  // An ordinary source, and a card with no mana ability at all.
  expect(manaOutput("({T}: Add {G}.)")).toEqual({ amount: 1 });
  expect(manaOutput(undefined)).toEqual({ amount: 1 });

  // A COST IS NOT FREE. A filter land pays one to make two, and a payment land pays {1} — both are
  // ONE mana. Reading the Add run alone is what took the first count over this corpus from 9 lands
  // to 27.
  expect(manaOutput("{T}: Add {C}.\n{U/R}, {T}: Add {U}{U}, {U}{R}, or {R}{R}.")).toEqual({ amount: 1 });
  expect(manaOutput("{1}, {T}: Add {U}{B}.")).toEqual({ amount: 1 });
  // Nor is a sacrifice, a counter or a loyalty cost a tap this model can pay.
  expect(manaOutput("{T}, Sacrifice a creature: Add {B}{B}.")).toEqual({ amount: 1 });
  expect(manaOutput("Sacrifice a creature: Add {C}{C}.")).toEqual({ amount: 1 });
  expect(manaOutput("+1: Add {R}{R}.")).toEqual({ amount: 1 });

  // RESTRICTED MANA IS REFUSED, because this model is colour-blind (C10) and cannot check the
  // restriction. Jegantha taps for five that pay no generic cost.
  expect(manaOutput("{T}: Add {W}{U}{B}{R}{G}. This mana can't be spent to pay generic mana costs.")).toEqual({ amount: 1 });
  expect(manaOutput("{T}: Add {C}{U}. Spend this mana only to activate abilities.")).toEqual({ amount: 1 });

  // A KAROO IS NET NEUTRAL — it taps for two off one fewer land, and the bounce is not modelled, so
  // counting it two over-claims. Rakdos Carnarium, verbatim.
  expect(manaOutput("This land enters tapped.\nWhen this land enters, return a land you control to its owner's hand.\n{T}: Add {B}{R}.")).toEqual({ amount: 1 });

  // Temple of the False God, verbatim: two mana, and NOTHING below five lands.
  expect(manaOutput("{T}: Add {C}{C}. Activate only if you control five or more lands.")).toEqual({ amount: 2, needsLands: 5 });

  // The tron shape. The SUBTYPE is `Urza's Power-Plant`, hyphenated, while the CARD is `Urza's
  // Power Plant` without one — so the board is matched on the type line and never on the name.
  expect(manaOutput("{T}: Add {C}. If you control an Urza's Mine and an Urza's Power-Plant, add {C}{C}{C} instead."))
    .toEqual({ amount: 1, tron: { subtypes: ["Urza's Mine", "Urza's Power-Plant"], amount: 3 } });
});

test("a source's output reaches the board: tron assembles, Temple stays dark under five lands", () => {
  const tron = (n: string, sub: string, others: [string, string], add: string): DeckCard[] =>
    Array.from({ length: 33 }, (_, i) =>
      card(`${n} ${i}`, `Land — ${sub}`, 0, `{T}: Add {C}. If you control an ${others[0]} and an ${others[1]}, add ${add} instead.`));
  const deck = [
    ...tron("Mine", "Urza's Mine", ["Urza's Power-Plant", "Urza's Tower"], "{C}{C}"),
    ...tron("Plant", "Urza's Power-Plant", ["Urza's Mine", "Urza's Tower"], "{C}{C}"),
    ...tron("Tower", "Urza's Tower", ["Urza's Mine", "Urza's Power-Plant"], "{C}{C}{C}"),
  ];
  const assembled = simulate(deck, { trials: 5_000, turns: 3, seed: 11 });
  // Three land drops cap a plain deck at three mana. Assembled tron taps for seven off the same
  // three drops, which is exactly the fact `manaWithRocks` and this model both used to miss.
  expect(pAtLeastMana(assembled, 7, 3)).toBeGreaterThan(0.1);
  expect(pAtLeastMana(simulate(basics(99), { trials: 5_000, turns: 3, seed: 11 }), 4, 3)).toBe(0);

  // A GATE IS ZERO BELOW ITS THRESHOLD, not one. A deck of nothing but Temples makes no mana at all
  // for four turns; the incumbent read one per Temple.
  const temples = Array.from({ length: 99 }, (_, i) =>
    card(`Temple ${i}`, "Land", 0, "{T}: Add {C}{C}. Activate only if you control five or more lands."));
  const t = simulate(temples, { trials: 2_000, turns: 6, seed: 11 });
  expect(pAtLeastMana(t, 1, 4)).toBe(0);
  expect(pAtLeastMana(t, 10, 5)).toBe(1);
});

test("a land that is every land type answers a subtype check by itself", () => {
  // Planar Nexus, verbatim — one card is an Urza's Mine AND an Urza's Power-Plant, which is how tron
  // actually assembles in Commander. It sits in 6 of the 7 tron decks in the calibration corpus.
  const nexusText = "This land is every nonbasic land type. (Nonbasic land types include Cave, Desert, Gate, Lair, Locus, Mine, Power-Plant, Sphere, Tower, and Urza's.)\n{T}: Add {C}.";
  expect(isEveryLandType("Land", nexusText)).toBe(true);
  // Prismatic Omen is REFUSED twice over: it is an enchantment, and every BASIC land type does not
  // include Urza's.
  expect(isEveryLandType("Enchantment", "Lands you control are every basic land type in addition to their other types.")).toBe(false);
  expect(isEveryLandType("Land", "Lands you control are every basic land type in addition to their other types.")).toBe(false);
  expect(isEveryLandType("Land", "{T}: Add {C}.")).toBe(false);

  // Through the simulator: one Urza's Tower plus one Planar Nexus taps for three, and the same
  // Tower with ordinary lands beside it taps for one.
  const tower = (i: number): DeckCard =>
    card(`Urza's Tower ${i}`, "Land — Urza's Tower", 0, "{T}: Add {C}. If you control an Urza's Mine and an Urza's Power-Plant, add {C}{C}{C} instead.");
  const nexus = (i: number): DeckCard => card(`Planar Nexus ${i}`, "Land", 0, nexusText);
  const half = (f: (i: number) => DeckCard): DeckCard[] => Array.from({ length: 50 }, (_, i) => f(i));
  const withNexus = simulate([...half(tower), ...half(nexus)], { trials: 5_000, turns: 2, seed: 5 });
  const withBasics = simulate([...half(tower), ...basics(50)], { trials: 5_000, turns: 2, seed: 5 });
  // Two land drops: 1 + 3 with the Nexus beside the Tower, never more than 2 without it.
  expect(pAtLeastMana(withNexus, 4, 2)).toBeGreaterThan(0.2);
  expect(pAtLeastMana(withBasics, 3, 2)).toBe(0);
});

test("a gated land is held until its gate is met, not played as a blank", () => {
  // OWNER'S POLICY, 2026-08-25: Temple of the False God is your FIFTH land and no earlier. A deck of
  // four Forests and 95 Temples must play the Forests first -- playing a Temple on turn 1 is a land
  // drop that produces nothing at all.
  const temple = (i: number): DeckCard =>
    card(`Temple ${i}`, "Land", 0, "{T}: Add {C}{C}. Activate only if you control five or more lands.");
  const deck = [...basics(4), ...Array.from({ length: 95 }, (_, i) => temple(i))];
  const r = simulate(deck, { trials: 5_000, turns: 5, seed: 9 });
  // Every Forest in the opening seven or the first draws goes down first, so early turns still make
  // mana. Held wrongly, a trial that opens on Temples reads 0 here.
  expect(pAtLeastMana(r, 1, 1)).toBeGreaterThan(0.2);
  // A land that is a blank forever is still played once nothing else is left, so the fifth drop
  // arrives on schedule and turns the whole pile on.
  expect(pAtLeastMana(r, 5, 5)).toBeGreaterThan(0.9);
});

// ---------------------------------------------------------------------------------------------
// L4a — COLOUR-AWARE CASTABILITY. Criteria registered in the design spec (§T.4) BEFORE any number
// existed. `castability.ts` refuses to multiply its mana and colour axes because both are driven by
// the same lands; asking the BOARD removes the question entirely.
// ---------------------------------------------------------------------------------------------

const dual = (n: number, name: string, colors: string[]): DeckCard[] =>
  Array.from({ length: n }, (_, i) => ({
    card: { name: `${name} ${i}`, typeLine: `Land — ${name}`, oracleText: "{T}: Add one mana of any color.", keywords: [], colors: [], manaValue: 0, producedMana: colors } as never,
    tags: null,
  }));
const spell = (n: number, name: string, manaCost: string, manaValue: number): DeckCard[] =>
  Array.from({ length: n }, (_, i) => ({
    card: { name: `${name} ${i}`, typeLine: "Sorcery", oracleText: "", keywords: [], colors: [], manaValue, manaCost } as never,
    tags: null,
  }));

test("parseCost reads a hybrid pip as EITHER colour, which is why pipsByColor is not reused", () => {
  expect(parseCost("{2}{B}{B}")).toEqual({ total: 4, pips: [colorMask(["B"]), colorMask(["B"])] });
  // `pipsByColor` counts {B/R} against BOTH black and red -- right for "does the deck have sources",
  // wrong for "can this board pay". Here it is ONE pip that either colour satisfies.
  expect(parseCost("{B/R}")).toEqual({ total: 1, pips: [colorMask(["B", "R"])] });
  // {C} IS A DEMAND, NOT AN ABSENCE OF ONE (CR 107.4c): colourless mana pays it and nothing else.
  // It used to read as "any source pays this", so a board of Forests could cast Kozilek (N11).
  expect(parseCost("{C}")).toEqual({ total: 1, pips: [colorMask(["C"])] });
  // A COLORLESS HYBRID IS COLOURLESS *OR* ITS COLOUR. Ulalek, Fused Atrocity costs
  // `{C/W}{C/U}{C/B}{C/R}{C/G}`: reading it as a WUBRG demand priced a colourless Eldrazi deck's own
  // commander at 6%, and reading it as unconstrained let five Forests cast it. Both halves are true
  // with the sixth bit.
  expect(parseCost("{C/W}{C/U}{C/B}{C/R}{C/G}")).toEqual({ total: 5, pips: [
    colorMask(["C", "W"]), colorMask(["C", "U"]), colorMask(["C", "B"]), colorMask(["C", "R"]), colorMask(["C", "G"]),
  ] });
  // A NUMERIC hybrid keeps its colour: the generic alternative costs MORE, so demanding the colour
  // under-claims, which is the direction this repo takes.
  expect(parseCost("{2/W}")).toEqual({ total: 1, pips: [colorMask(["W"])] });
  // An X cost is not a number, and `castability.ts` refuses it too.
  expect(parseCost("{X}{R}")).toBeNull();
  expect(parseCost(undefined)).toBeNull();
});

test("payable is a feasibility question, not a product of per-pip probabilities", () => {
  const W = colorMask(["W"]), U = colorMask(["U"]), WU = colorMask(["W", "U"]);
  const cost = parseCost("{U}{U}")!;
  // Two Islands pay {U}{U}; one Island and one Plains do not, though both boards have two mana.
  expect(payable([{ mana: 1, colors: U }, { mana: 1, colors: U }], cost)).toBe(true);
  expect(payable([{ mana: 1, colors: U }, { mana: 1, colors: W }], cost)).toBe(false);
  // A DUAL IS ONE MANA, NOT TWO. Two duals pay {U}{U}; one dual cannot, which is the exact error a
  // per-pip probability makes when it counts the same land against both pips.
  expect(payable([{ mana: 1, colors: WU }, { mana: 1, colors: WU }], cost)).toBe(true);
  expect(payable([{ mana: 2, colors: 0 }, { mana: 1, colors: WU }], cost)).toBe(false);
  // Sol Ring pays GENERIC and no coloured pip: colourless is the empty mask, not a sixth colour.
  expect(payable([{ mana: 2, colors: 0 }, { mana: 1, colors: U }], parseCost("{2}{U}")!)).toBe(true);
  expect(payable([{ mana: 2, colors: 0 }], parseCost("{1}{U}")!)).toBe(false);
});

test("C1/C2/C3: the colour model is an anchor, a bound and a discriminator", () => {
  const anyColor = ["W", "U", "B", "R", "G"];
  const bolt = spell(50, "Bolt", "{R}{R}{R}", 3);

  // C1, THE NO-OP ANCHOR. With every source able to make every colour, the colour-aware answer is
  // the mana-only one. A wiring error shows here first.
  const rainbow = simulate([...dual(49, "City", anyColor), ...bolt], { trials: 4_000, turns: 4, seed: 4 });
  expect(rainbow.byCardCastable.get("Bolt 0")).toEqual(rainbow.byCard.get("Bolt 0"));

  // C3, THE DEFECT IT EXISTS FOR, WITH ITS OWN CONTROL. A deck whose lands make the wrong colour
  // reads ZERO however much mana it has; the same deck in the right colour is unaffected.
  const wrong = simulate([...dual(49, "Island", ["U"]), ...bolt], { trials: 4_000, turns: 4, seed: 4 });
  const right = simulate([...dual(49, "Mountain", ["R"]), ...bolt], { trials: 4_000, turns: 4, seed: 4 });
  expect(wrong.byCard.get("Bolt 0")![3]).toBeGreaterThan(0.5);      // the mana is there
  expect(wrong.byCardCastable.get("Bolt 0")![3]).toBe(0);           // and it cannot cast it
  expect(right.byCardCastable.get("Bolt 0")).toEqual(right.byCard.get("Bolt 0"));

  // C2, THE BOUND, over every card and every turn with NO exceptions: colour can only take away.
  for (const r of [rainbow, wrong, right]) {
    for (const [name, curve] of r.byCardCastable) {
      const mana = r.byCard.get(name)!;
      curve.forEach((p, i) => expect(p).toBeLessThanOrEqual(mana[i]));
    }
  }
});

test("C4: a fetchland is a colour fixer AND a thinner", () => {
  // VERBATIM FROM THE CORPUS. The fixture used to read "an Island or Mountain LAND card" -- a word
  // no fetchland prints -- so C4 passed against a card this repo had invented (roadmap N2).
  const tarn = "{T}, Pay 1 life, Sacrifice this land: Search your library for an Island or Mountain card, put it onto the battlefield, then shuffle.";
  const deckPrinted = [{ typeLine: "Land — Island", producedMana: ["U"] }, { typeLine: "Land — Mountain", producedMana: ["R"] }, { typeLine: "Land — Forest", producedMana: ["G"] }];
  // It finds what it NAMES, against what this deck actually holds -- so it is a blue and red source
  // and not a green one, and in a deck with no Mountain it would not be a red one either.
  expect(fetchMask(tarn, deckPrinted)).toBe(colorMask(["U", "R"]));
  expect(fetchMask(tarn, [{ typeLine: "Land — Island", producedMana: ["U"] }])).toBe(colorMask(["U"]));

  // "an Island OR Mountain card" IS AN OR, NOT AN AND (owner, 2026-08-25): a plain Island is a legal
  // target, a plain Mountain is, and a land carrying both is. One word (`some` vs `every`) separates
  // this from a fetch that can find almost nothing.
  expect(fetchMask(tarn, [{ typeLine: "Basic Land — Island", producedMana: ["U"] }])).toBe(colorMask(["U"]));
  expect(fetchMask(tarn, [{ typeLine: "Basic Land — Mountain", producedMana: ["R"] }])).toBe(colorMask(["R"]));
  // And a land carrying NEITHER is not a target, however much mana it makes.
  expect(fetchMask(tarn, [{ typeLine: "Basic Land — Forest", producedMana: ["G"] }])).toBe(0);

  // NAMING A TYPE IS NOT DEMANDING A BASIC (owner, 2026-08-25). Scalding Tarn searches for a
  // "card", not a "basic land card", so a SHOCKLAND carrying both types is a legal target -- and in
  // `iz-it-izzet` that is what takes it from 19 lands to 20.
  const shock = [{ typeLine: "Land — Island Mountain", producedMana: ["U", "R"] }];
  expect(fetchMask(tarn, shock)).toBe(colorMask(["U", "R"]));
  // The mirror, and the one card in the 71 decks that needs it: Seething Landscape says BASIC, so
  // the same shockland is NOT a legal target. Verbatim.
  const landscape = "{T}, Sacrifice this land: Search your library for a basic Island, Swamp, or Mountain card, put it onto the battlefield tapped, then shuffle.";
  expect(fetchMask(landscape, shock)).toBe(0);
  expect(fetchMask(landscape, [...shock, { typeLine: "Basic Land — Swamp", producedMana: ["B"] }])).toBe(colorMask(["B"]));
  // `nonbasic` contains `basic`, and reading it as a demand would empty every mask.
  expect(fetchMask("Search your library for a nonbasic land card.", shock)).toBe(colorMask(["U", "R"]));

  // THINNING: the land it finds LEAVES the library, so a deck of fetches draws better than the same
  // deck of blanks. Measured through the simulator rather than asserted.
  const fetch = (i: number): DeckCard => ({
    card: { name: `Tarn ${i}`, typeLine: "Land", oracleText: tarn, keywords: [], colors: [], manaValue: 0, producedMana: [] } as never,
    tags: null,
  });
  const withFetch = simulate([...Array.from({ length: 20 }, (_, i) => fetch(i)), ...dual(20, "Island", ["U"]), ...spell(59, "Spell", "{U}", 1)], { trials: 4_000, turns: 3, seed: 6 });
  // A fetch counts as a blue source through what it finds; without the colour read it would be 0.
  expect(withFetch.byCardCastable.get("Spell 0")![2]).toBeGreaterThan(0.9);
});

// N15. A FETCH SAYS "THEN SHUFFLE", SO THE LAND THAT LEAVES IS UNIFORMLY RANDOM. Taking the EARLIEST
// land in draw order pushes the survivors later and understates mana on exactly the fetch decks the
// land-fetch feature was built for -- measured +1.90pp mean on P(>=6 mana at T6) over the 71 decks,
// worst `naya-spellslinger` +6.92pp.
test("N15: a fetch removes a UNIFORMLY RANDOM land, not the first one in draw order", () => {
  // The pick is the rng's, so a stubbed generator names the land that leaves. Three lands at indices
  // 0, 2 and 3; asking for the last of the three must take index 3 and never index 0.
  const lib = () => [{ isLand: true, id: "L0" }, { isLand: false, id: "X" }, { isLand: true, id: "L1" }, { isLand: true, id: "L2" }];
  const last = lib();
  takeRandomLand(last, () => 0.99);
  expect(last.map((c) => c.id)).toEqual(["L0", "X", "L1"]);

  const middle = lib();
  takeRandomLand(middle, () => 0.5);
  expect(middle.map((c) => c.id)).toEqual(["L0", "X", "L2"]);

  // A library with no land left is a no-op rather than a splice of index -1, which would eat the
  // last card in the deck.
  const none = [{ isLand: false, id: "X" }];
  takeRandomLand(none, () => 0);
  expect(none.map((c) => c.id)).toEqual(["X"]);
});

test("N15: the simulator's fetches read the corrected policy, and it pays on a fetch-heavy deck", () => {
  const FETCH = "{T}, Pay 1 life, Sacrifice this land: Search your library for a basic land card, put it onto the battlefield, then shuffle.";
  const deck: DeckCard[] = [
    ...Array.from({ length: 20 }, (_, i) => card(`Fetch ${i}`, "Land", 0, FETCH, [])),
    ...Array.from({ length: 17 }, (_, i) => card(`Forest ${i}`, "Basic Land — Forest", 0, "", ["G"])),
    ...spells(62, 3),
  ];
  // MEASURED under the old earliest-land policy at this seed: 14.76%. The correction can only move
  // it UP, since taking the earliest land is what delayed the survivors.
  const r = simulate(deck, { trials: TRIALS, turns: 8, seed: 11 });
  expect(pAtLeastMana(r, 6, 6)).toBeGreaterThan(0.16);

  // THE OTHER SITE. A land-fetch SPELL resolves through its own branch, so the fetchland arm above
  // leaves it untested -- verified by mutating one site at a time. Nature's Lore, verbatim, in a
  // deck that can cast it. MEASURED under the old policy at this seed: 60.27%.
  const LORE = "Search your library for a Forest card, put it onto the battlefield, then shuffle.";
  const ramp: DeckCard[] = [
    ...Array.from({ length: 20 }, (_, i) => card(`Lore ${i}`, "Sorcery", 2, LORE)),
    ...basics(30),
    ...spells(49, 3),
  ];
  const withRamp = simulate(ramp, { trials: TRIALS, turns: 8, seed: 11 });
  expect(pAtLeastMana(withRamp, 6, 6)).toBeGreaterThan(0.65);
});

// N2. THE TEN REAL FETCHLANDS ARE FETCHLANDS. The gate demanded the literal words "land card" and
// the cycle prints "an Island or Mountain CARD", so ~110 slots -- concentrated in exactly the
// multicolour decks the colour model was built for -- were an untapped land making one colourless
// mana and thinning nothing.
test("N2: the fetch cycle matches the gate, on its own printed text", () => {
  const TARN = "{T}, Pay 1 life, Sacrifice this land: Search your library for an Island or Mountain card, put it onto the battlefield, then shuffle.";
  const tarns = Array.from({ length: 20 }, (_, i) => card(`Tarn ${i}`, "Land", 0, TARN, []));
  const islands = Array.from({ length: 17 }, (_, i) => card(`Island ${i}`, "Basic Land — Island", 0, "", ["U"]));
  const blue = Array.from({ length: 62 }, (_, i) => card(`Blue ${i}`, "Sorcery", 3, "", undefined));
  // The fetch produces nothing of its own, so without the colour read the deck has 17 blue sources
  // for a {U}{U}{U} cost and reads far under its real mana. WITH it, every Tarn is a blue source.
  const r = simulate([...tarns, ...islands, ...blue.slice(0, 61), card("Cryptic", "Instant", 4, "", undefined)], { trials: TRIALS, turns: 6, seed: 4 });
  expect(r.byCardCastable.get("Cryptic")).toBeDefined();

  // MEASURED with the fetch inert (the old gate): 22.29% at turn 4 for a triple-blue four-drop.
  const triple = card("Triple", "Sorcery", 4, "", undefined);
  (triple.card as { manaCost?: string }).manaCost = "{1}{U}{U}{U}";
  const withFetch = simulate([...tarns, ...islands, ...blue.slice(0, 61), triple], { trials: TRIALS, turns: 6, seed: 4 });
  expect(withFetch.byCardCastable.get("Triple")![3]).toBeGreaterThan(0.3);
});

// N3. CR 712.4a -- A CARD IN HAND IS ITS FRONT FACE, so a transform card's land back can never be
// played as a land. `land-count.ts` already makes this check (E4); `goldfish.ts` never learned it,
// and took a phantom land drop on 23 deck-slots while dropping the card from the priced denominator.
test("N3: a transform card's land back is not a land drop, and the front face is priced", () => {
  const compass = (i: number): DeckCard => {
    const c = card(`Compass ${i}`, "Artifact // Land", 3, "{3}, {T}: Search your library for a basic land card, reveal it, put it into your hand, then shuffle.");
    (c.card as { layout?: string }).layout = "transform";
    return c;
  };
  const deck = [...Array.from({ length: 20 }, (_, i) => compass(i)), ...basics(17), ...spells(62, 3)];
  const r = simulate(deck, { trials: TRIALS, turns: 6, seed: 4 });
  // It is a SPELL, so it is priced -- a land is not, which is how the phantom land drop also removed
  // it from `payableShareAt`'s denominator.
  expect(r.byCard.has("Compass 0")).toBe(true);
  // And the deck has 17 lands, not 37. Read as lands these would be a normal mana base.
  expect(pAtLeastMana(r, 6, 6)).toBeLessThan(0.1);

  // A MODAL DFC KEEPS ITS LAND FACE -- you really do play that side (28 distinct cards, 186 slots in
  // the 71 decks), which is the half a blanket type-line-plus-`//` rule would have broken.
  const mdfc = (i: number): DeckCard => {
    const c = card(`Shatterskull ${i}`, "Sorcery // Land", 3, "");
    (c.card as { layout?: string }).layout = "modal_dfc";
    return c;
  };
  const withMdfc = simulate([...Array.from({ length: 20 }, (_, i) => mdfc(i)), ...basics(17), ...spells(62, 3)], { trials: TRIALS, turns: 6, seed: 4 });
  // 34.0% here; refusing the land face reads 0.96%, measured by mutating the allow-list.
  expect(pAtLeastMana(withMdfc, 6, 6)).toBeGreaterThan(0.3);
});

// N1. A PROBABILITY CANNOT EXCEED 1, AND THIS ONE READ 3.0. `byCardHits` keys on card NAME and was
// incremented once per COPY per trial-turn, so N copies of a card accumulated N hits -- and the 13
// documented "any number of copies" cards make that a legal, ordinary paste. The 71 calibration
// decks are singleton, so every measurement ever taken here was blind to it.
test("N1: a card is counted once per trial-turn however many copies the deck runs", () => {
  const copies = (n: number, name: string, manaValue: number): DeckCard[] =>
    Array.from({ length: n }, () => card(name, "Sorcery", manaValue));
  const cheap = card("Solo", "Sorcery", 1);
  (cheap.card as { manaCost?: string }).manaCost = "{G}";
  const many = copies(30, "Approach", 1);
  for (const c of many) (c.card as { manaCost?: string }).manaCost = "{G}";
  const r = simulate([...basics(37), ...many, ...spells(31, 3), cheap], { trials: 2_000, turns: 4, seed: 5 });

  const approach = r.byCard.get("Approach")!;
  const castable = r.byCardCastable.get("Approach")!;
  for (let t = 0; t < 4; t++) {
    expect(approach[t]).toBeLessThanOrEqual(1);
    expect(castable[t]).toBeLessThanOrEqual(1);
  }
  // And it is the same question as the singleton's, so the two read alike rather than 30x apart.
  expect(approach[3]).toBeCloseTo(r.byCard.get("Solo")![3], 2);
  expect(castable[3]).toBeCloseTo(r.byCardCastable.get("Solo")![3], 2);
});

// N9. SCRYFALL STAMPS `produced_mana` FROM QUOTED TOKEN TEXT, so a card that makes Treasures reads
// as a permanent that taps for mana every turn. Treasure mana is a ONE-SHOT resource, and this model
// already refuses one-shots on `isManaSource`'s own ruling -- the same rule, one layer over.
test("N9: token mana is not a mana source, and a granted mana ability still is", () => {
  const plunderer = card("Pitiless Plunderer", "Creature — Human Pirate", 4,
    'Whenever another creature you control dies, create a Treasure token. (It\'s an artifact with "{T}, Sacrifice this token: Add one mana of any color.")',
    ["B", "G", "R", "U", "W"]);
  expect(classifyAccelerant(plunderer)).toBeNull();

  // A GRANT TO PERMANENTS YOU CONTROL IS RECURRING MANA and stays: Enduring Vitality is one of the
  // three accelerants on `samut` the old hypergeometric model could see at all.
  const vitality = card("Enduring Vitality", "Enchantment Creature — Elk Glimmer", 3,
    'Vigilance\nCreatures you control have "{T}: Add one mana of any color."', ["B", "G", "R", "U", "W"]);
  expect(classifyAccelerant(vitality)?.kind).toBe("dork");

  // THE GRANT IS NOT ENOUGH ON ITS OWN -- Goldspan Dragon grants to TREASURES, and a permanent that
  // sacrifices itself for mana is the one-shot again, in a sentence shaped like a grant.
  const goldspan = card("Goldspan Dragon", "Creature — Dragon", 5,
    'Flying, haste\nWhenever this creature attacks, create a Treasure token.\nTreasures you control have "{T}, Sacrifice this artifact: Add two mana of any one color."',
    ["B", "G", "R", "U", "W"]);
  expect(classifyAccelerant(goldspan)).toBeNull();

  // A SUSPENDED MANA ROCK IS NOT A TURN-ONE ROCK. Mana value 0 and rule 3 casts by mana value, so
  // Sol Talisman landed free on turn one; the real sequence is {1} and a three-turn wait.
  const talisman = card("Sol Talisman", "Artifact", 0,
    "Suspend 3—{1} (Rather than cast this card from your hand, pay {1} and exile it with three time counters on it.)\n{T}: Add {C}{C}.", ["C"]);
  expect(classifyAccelerant(talisman)).toBeNull();

  // The ordinary rock is untouched: it says "Add" in its own text.
  expect(classifyAccelerant(card("Sol Ring", "Artifact", 1, "{T}: Add {C}{C}.", ["C"]))?.kind).toBe("rock");
});

// N10. "ADD THREE MANA OF ANY ONE COLOR" IS INVISIBLE TO A READER THAT COUNTS `{...}` SYMBOLS.
// Sceptre of Eternal Glory is in 11 decks and was priced at one mana.
test("N10: a word-form amount is read, and its gate with it", () => {
  const sceptre = manaOutput("{T}: Add one mana of any color.\n{T}: Add three mana of any one color. Activate only if you control three or more lands with the same name.");
  // The gated line wins because it makes more -- and it is ZERO below the gate, not one.
  expect(sceptre.amount).toBe(3);
  // SAME NAME IS UNCHECKABLE HERE and "three or more lands" is its floor, so the gate under-claims
  // rather than counting three from turn one.
  expect(sceptre.needsLands).toBe(3);

  expect(manaOutput("{T}: Add three mana of any one color.").amount).toBe(3);
  expect(manaOutput("{T}: Add two mana in any combination of {U}, {B}, and/or {R}.").amount).toBe(2);
  // Restricted mana stays one: the model is colour-blind, so it cannot check the restriction.
  expect(manaOutput("{T}: Add two mana in any combination of colors. Spend this mana only to cast Elemental spells.").amount).toBe(1);
  // A cost that is not exactly {T} is not a tap this model can pay.
  expect(manaOutput("{1}, {T}: Add two mana in any combination of colors.").amount).toBe(1);
  // An X amount is a RATE, not an amount -- it stays at one rather than being guessed.
  expect(manaOutput("{T}: Add X mana of any one color, where X is the number of Elves you control.").amount).toBe(1);
});

// N11. `{C}` IS A RULES-REAL DEMAND (CR 107.4c): colourless mana, and no other kind pays it. The
// model carried colourless as the EMPTY mask -- right for a SOURCE, since colourless constrains
// nothing about what it can pay, and exactly backwards for a COST, where it constrains everything.
// A board of Forests read as able to cast Kozilek.
test("N11: a colourless pip demands colourless mana, and a coloured source cannot pay it", () => {
  const forest = { mana: 1, colors: colorMask(["G"]) };
  const wastes = { mana: 1, colors: colorMask(["C"]) };
  const eldrazi = parseCost("{4}{C}{C}")!;

  // Six green sources make the mana and cannot make the demand.
  expect(payable(Array(6).fill(forest), eldrazi)).toBe(false);
  // Four Forests and two Wastes can.
  expect(payable([...Array(4).fill(forest), wastes, wastes], eldrazi)).toBe(true);
  // One Wastes is one colourless mana, and the cost wants two.
  expect(payable([...Array(5).fill(forest), wastes], eldrazi)).toBe(false);

  // A COLOURLESS SOURCE STILL PAYS GENERIC, which is the half that was always right.
  expect(payable(Array(6).fill(wastes), parseCost("{5}{G}")!)).toBe(false);
  expect(payable([...Array(5).fill(wastes), forest], parseCost("{5}{G}")!)).toBe(true);
});

test("N11: a colourless hybrid is colourless OR its colour, not 'anything'", () => {
  const ulalek = parseCost("{C/W}{C/U}{C/B}{C/R}{C/G}")!;
  const wastes = { mana: 1, colors: colorMask(["C"]) };
  const forest = { mana: 1, colors: colorMask(["G"]) };
  const plains = { mana: 1, colors: colorMask(["W"]) };

  // Five colourless sources pay every half of it -- the Eldrazi deck's own commander.
  expect(payable(Array(5).fill(wastes), ulalek)).toBe(true);
  // Five FORESTS do not: green pays the {C/G} half and nothing else.
  expect(payable(Array(5).fill(forest), ulalek)).toBe(false);
  // One of each colour does, which is the WUBRG reading being right for the right reason.
  expect(payable([plains, { mana: 1, colors: colorMask(["U"]) }, { mana: 1, colors: colorMask(["B"]) },
    { mana: 1, colors: colorMask(["R"]) }, forest], ulalek)).toBe(true);

  // A NUMERIC hybrid keeps its colour, unchanged: the generic alternative costs MORE, so demanding
  // the colour is the under-claiming direction.
  expect(payable([forest, forest, forest], parseCost("{2/W}")!)).toBe(false);
});
