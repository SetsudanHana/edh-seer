import { parseGate } from "@edh-seer/tagger/gate";
import { describe, expect, test } from "vitest";
import { pAtLeast, seen } from "@edh-seer/engine";
import type { DeckCard } from "./types.js";
import rocks from "./ramp-colour.fixtures.json" with { type: "json" };
import goldfish from "./fixtures/goldfish-cards.json" with { type: "json" };
import { FREE_TAP, fetchTags, manaTags, mkLine, ritualLine, tapFor, triggerLine, withLines, withTap } from "./mana-test-support.js";
import { cardLines, colourSourceColours, isColourSource, isFetchSource } from "./mana-lines.js";
import { gateVerdict } from "./gate.js";
import { classifyAccelerant, colourMaskOf, tapBonusOf, fetchesLand, ritualAdds, opponentHandSize, keepsHand, colorMask, fetchMaskOf, isEveryLandType, landfallOf, manaAvailability, manaOutput, parseCost, payable, pAtLeastMana, quantiles, rng, simulate, takeRandomLand, pickLand} from "./goldfish.js";

const card = (name: string, typeLine: string, manaValue = 0, oracleText = "", producedMana?: string[]): DeckCard => ({
  card: { name, typeLine, oracleText, keywords: [], colors: [], manaValue, ...(producedMana ? { producedMana } : {}) } as never,
  tags: null,
});

/** A REAL CARD, as production derived it: the Card document and the mana keys of its derived tags, dumped from Mongo by
 *  `research/mana/refresh-fixtures.mts` (the goldfish reads the derived mana lines, #1169 task 2b-1). `as` renames it, for a deck of copies. */
const real = (name: string, as?: string): DeckCard => {
  const hit = (goldfish as unknown as DeckCard[]).find((c) => c.card.name === name || c.card.name.startsWith(`${name} //`));
  expect(hit, `fixture for ${name}`).toBeDefined();
  const dc = structuredClone(hit!);
  if (as) dc.card.name = as;
  return dc;
};
const WUBRG = ["W", "U", "B", "R", "G"];
/** The same deck with its DRAW and TUTOR abilities gone and its mana lines kept: the control arm for what a draw changes. */
const untag = (d: DeckCard[]): DeckCard[] => d.map((x) => ({ ...x, tags: x.tags?.manaLines ? manaTags(x.tags.manaLines) : null }));

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
  const r = simulate(deck, { trials: TRIALS, turns: 6, seed: 11, mulligan: false });
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
  const r = simulate(deck, { trials: TRIALS, turns: 6, seed: 13, mulligan: false });
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
  const withRock = [...basics(37), real("Sol Ring"), ...spells(61, 3)];
  const withDork = [...basics(37), real("Llanowar Elves"), ...spells(61, 3)];
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
    Array.from({ length: n }, (_, i) => withTap(card(`Rock ${i}`, "Artifact", 2, "{T}: Add {C}."), ["C"]));
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

test("classifyAccelerant reads the derived mana lines and refuses a one-shot", () => {
  expect(classifyAccelerant(real("Sol Ring"))?.kind).toBe("rock");
  expect(classifyAccelerant(real("Llanowar Elves"))?.kind).toBe("dork");
  // A land-fetch spell produces no mana of its own, which is exactly why `manaWithRocks` cannot see
  // it — and it is the biggest term on a green deck.
  expect(classifyAccelerant(real("Nature's Lore"))).toEqual({ name: "Nature's Lore", manaValue: 2, kind: "land-fetch", fetchTapped: false });
  expect(classifyAccelerant(real("Kodama's Reach"))?.fetchTapped).toBe(true);
  // A RITUAL IS NOT A SOURCE at any confidence — `isManaSource`'s ruling, restated here because the
  // ceiling it creates is real: Dark Ritual does enable a turn.
  expect(classifyAccelerant(real("Dark Ritual"))).toBeNull();
  // A land is a land drop, never an accelerant cast.
  expect(classifyAccelerant(real("Forest"))).toBeNull();
  // A card with no derived tags is nothing: derive covers every card in a deck, so that is an underived card (`coverage.ts` lists it).
  expect(classifyAccelerant(card("Sol Ring", "Artifact", 1, "{T}: Add {C}{C}.", ["C"]))).toBeNull();
});

/** A hundred-card deck with a dozen Dragons: Mox Jasper's gate is met (gate.ts). */
const deckOfDragons = (extra: DeckCard[] = []): DeckCard[] => [...extra, ...Array.from({ length: 12 }, (_, i) => card(`Dragon ${i}`, "Creature — Dragon", 5)), ...spells(88 - extra.length, 3)];

// A GATED SOURCE IS STILL A SOURCE, CONDITIONED ON THE DECK (owner 2026-10-13, #1169 2b-2): "it matches only specific themes, like in this case dragons".
test("a gated mana line plays in a deck that meets its gate and not in one that does not: Mox Jasper is a rock among Dragons", () => {
  const jasper = real("Mox Jasper");
  const dragons = deckOfDragons([jasper]);
  const none = [jasper, ...spells(99, 3)];
  expect(classifyAccelerant(jasper)).toBeNull();
  expect(classifyAccelerant(jasper, none)).toBeNull();
  expect(classifyAccelerant(jasper, dragons)).toEqual({ name: "Mox Jasper", manaValue: 0, kind: "rock" });
  expect(manaOutput(jasper, dragons)).toMatchObject({ amount: 0, gated: { amount: 1 } });
  // any colour, once the gate is met: the model plays the line's colours
  expect(colourMaskOf(jasper, none)).toBe(0);
  expect(colourMaskOf(jasper, dragons)).toBe(colorMask(WUBRG));
  // and the simulation sees it: the same deck prices one more accelerant with the Dragons than without
  expect(manaAvailability(dragons, { trials: 50 }).accelerants).toBe(1);
  expect(manaAvailability([jasper, ...spells(11, 5), ...basics(36), ...spells(51, 3)], { trials: 50 }).accelerants).toBe(0);
});

test("the board-count gates stay priced turn by turn whatever the deck: Sceptre of Eternal Glory still waits on its three lands (not 'met' from the first land)", () => {
  const sceptre = real("Sceptre of Eternal Glory");
  const forests = [sceptre, ...basics(40, "Forest").map((d) => ({ ...d, card: { ...d.card, name: "Forest" } })), ...spells(59, 3)];
  expect(manaOutput(sceptre, forests)).toEqual({ amount: 3, needsLands: 3 });
  expect(manaOutput(sceptre, forests)).toEqual(manaOutput(sceptre));
});

// WHAT THE DERIVED READING DROPS, AND WHY (#1169 task 2b-1). Each card below was an accelerant when the goldfish read printed text and `producedMana`.
test("derived lines the goldfish cannot play are not accelerants: a gate it cannot check, a cost it cannot pay, a trigger it has no event for", () => {
  // (Howlsquad Heavy's max-speed gate is met from turn 4 in any deck: see the max-speed test below. Mox Jasper's Dragon IS a decklist's: see the next test.)
  // A COST WITH NO BOARD TO PAY FROM: another creature sacrificed (Phyrexian Altar), another permanent tapped (Springleaf Drum), a counter (Wall of Roots),
  // or exiling the card from hand (Simian Spirit Guide) is not a tap this model can pay. (A planeswalker's "+N: Add" IS playable -- see the loyalty test.)
  for (const n of ["Phyrexian Altar", "Springleaf Drum", "Wall of Roots", "Simian Spirit Guide"]) {
    expect(classifyAccelerant(real(n)), n).toBeNull();
  }
  // A GRANT A TRIGGER STARTS is gated by it (derive 303): Princess Yue's "{T}: Add {C}" is the Moon's, after she dies, and is no mana of the creature in play.
  expect(classifyAccelerant(real("Princess Yue"))).toBeNull();
  // A GATED FETCH (Charitable Levy: three noncreature spells first) is not a fetch the model can perform.
  expect(classifyAccelerant(real("Charitable Levy"))).toBeNull();
  // The tap-replacements the simulation prices are accelerants, with their bonus: Forsaken Monument and Leyline of Abundance (owner 2026-10-13), and the
  // same shape for one land type -- Crypt Ghast and Nirkana Revenant (Swamps), Nissa, Who Shakes the World (Forests), a bonus per matching land tapped.
  expect(classifyAccelerant(real("Forsaken Monument"))?.kind).toBe("rock");
  expect(classifyAccelerant(real("Leyline of Abundance"))?.kind).toBe("rock");
  expect(classifyAccelerant(real("Crypt Ghast"))?.kind).toBe("dork");
  expect(classifyAccelerant(real("Nirkana Revenant"))?.kind).toBe("dork");
  expect(classifyAccelerant(real("Nissa, Who Shakes the World"))?.kind).toBe("rock");
  expect([tapBonusOf(real("Forsaken Monument")), tapBonusOf(real("Leyline of Abundance")), tapBonusOf(real("Crypt Ghast")), tapBonusOf(real("Nissa, Who Shakes the World"))])
    .toEqual(["colorless", "creature", "land:swamp", "land:forest"]);
});

// A TAP BONUS THAT IS CONDITIONAL, OR LASTS A TURN, IS NOT PRICED AS A STANDING ONE (2b-1 review round 3): Rikala, Homarid King ("..., if there are three or more tide counters
// on Rikala, add an additional {U}") and Pyre Rhymer // Molten Tide ("Until end of turn, whenever you tap a Mountain for mana, add an additional {R}") name a land type like Nissa and
// Crypt Ghast do, and are neither unconditional nor permanent. Refused, never priced as always on.
test("a land-type tap bonus with an intervening if, or only until end of turn, is no standing bonus", () => {
  const rikala = card("Rikala, Homarid King", "Legendary Creature \u2014 Merfolk Noble", 4, "At the beginning of your upkeep, put a tide counter on Rikala. Then if there are four or more tide counters on Rikala, remove them.\nCreatures you control get +1/+0 for each tide counter on Rikala.\nWhenever you tap an Island for mana, if there are three or more tide counters on Rikala, add an additional {U}.");
  const rhymer = card("Pyre Rhymer // Molten Tide", "Creature // Sorcery", 3, "Prowess\nThis creature enters prepared.\n//\nUntil end of turn, whenever you tap a Mountain for mana, add an additional {R}.");
  const crypt = card("Crypt Ghast", "Creature", 4, "Extort\nWhenever you tap a Swamp for mana, add an additional {B}.");
  expect([tapBonusOf(rikala), tapBonusOf(rhymer), tapBonusOf(crypt)]).toEqual([undefined, undefined, "land:swamp"]);
});

// AN AURA'S MANA COUNTS ONLY IF MANA IS THE CARD'S PURPOSE (owner 2026-10-13): the removal Auras are no accelerant, the ramp Auras are.
test("an Aura that removes what it enchants, or grants a trigger, is no accelerant; an Aura that gives a land a tap ability is", () => {
  for (const n of ["Imprisoned in the Moon", "Honest Work", "Mark of Sakiko"]) expect(classifyAccelerant(real(n)), n).toBeNull();
  expect(classifyAccelerant(real("Abundant Growth"))?.kind).toBe("rock");
  expect(classifyAccelerant(real("Lithoform Blight"))?.kind).toBe("rock");
  expect(manaOutput(real("Abundant Growth")).amount).toBe(1);
});

// LOYALTY MANA ABILITIES ARE ACCELERANTS (owner 2026-10-13, #1169 2b-1 review). CR 606.3: a loyalty ability is activated at sorcery timing, once per
// planeswalker per turn, so "+2: Add {R}{R}{R}" is a repeatable source that pays the turn the walker is cast (it is no creature: no summoning sickness).
test("a planeswalker's non-negative loyalty mana ability is an accelerant priced at its amount; a negative one is not", () => {
  for (const n of ["Chandra, Torch of Defiance", "Chandra, Flameshaper", "Chandra, Legacy of Fire", "Domri, Anarch of Bolas", "Ugin, Eye of the Storms"]) {
    expect(classifyAccelerant(real(n))?.kind, n).toBe("rock");
  }
  expect(manaOutput(real("Chandra, Torch of Defiance")).amount).toBe(2);
  expect(manaOutput(real("Chandra, Flameshaper")).amount).toBe(3);
  expect(manaOutput(real("Ugin, Eye of the Storms")).amount).toBe(3);
  expect(manaOutput(real("Domri, Anarch of Bolas")).amount).toBe(1);
  // CEILING in the model: a scaling amount ("+1: Add {R} for each planeswalker you control") is a rate, priced at the incumbent one.
  expect(manaOutput(real("Chandra, Legacy of Fire")).amount).toBe(1);
  // The colour it makes is the line's: Chandra's {R}, Ugin's {C}.
  expect(colourMaskOf(real("Chandra, Torch of Defiance"))).toBe(colorMask(["R"]));
  expect(colourMaskOf(real("Ugin, Eye of the Storms"))).toBe(colorMask(["C"]));
  // A NEGATIVE cost counts when the walker's STARTING loyalty covers it (owner 2026-10-13: usable the turn it is cast, CR 606.6): Chandra, Novice Pyromancer
  // (loyalty 5, -1: Add {R}{R}) and Koth (loyalty 3, -2: Add {R} for each Mountain) are accelerants. One that does not -- Chandra, Heart of Fire's -9 at
  // loyalty 5, Quintorius' -6 at 4 -- is not, and Jaya's +1 restricts what the mana is for.
  for (const n of ["Chandra, Novice Pyromancer", "Koth of the Hammer"]) expect(classifyAccelerant(real(n))?.kind, n).toBe("rock");
  for (const n of ["Chandra, Heart of Fire", "Quintorius Kand", "Jaya Ballard"]) expect(classifyAccelerant(real(n)), n).toBeNull();
  expect(manaOutput(real("Chandra, Novice Pyromancer"))).toMatchObject({ amount: 2, turns: 5 });
  // Koth's amount scales (a rate: priced at the incumbent one) and he can pay his -2 once from loyalty 3.
  expect(manaOutput(real("Koth of the Hammer"))).toMatchObject({ amount: 1, turns: 1 });
  // A "+N" or "0" never runs out.
  expect(manaOutput(real("Chandra, Torch of Defiance"))).not.toHaveProperty("turns");
  // A transform card's BACK face is not ramp (owner 2026-10-10, #1174): Arlinn, the Moon's Fury's "+2: Add {R}{G}" is reached only by transforming.
  expect(classifyAccelerant(real("Arlinn, the Pack's Hope"))).toBeNull();
  // Nissa's land fetches cost -7 (Worldwaker, loyalty 3) and -8 (Who Shakes the World, loyalty 5): neither can be activated the turn she is cast.
  expect(isFetchSource(real("Nissa, Worldwaker"))).toBe(false);
  expect(isFetchSource(real("Nissa, Who Shakes the World"))).toBe(false);
  expect(fetchesLand(real("Nissa, Worldwaker"))).toBe(false);
  expect(classifyAccelerant(real("Nissa, Worldwaker"))).toBeNull();
});

// PINS THAT LOYALTY NEVER LEAKS INTO COLOUR COUNTING: the colour audit asks for a repeatable TAP or a static grant (`isColourSource`), and a loyalty ability is neither.
test("a planeswalker's loyalty mana ability is not a colour source", () => {
  const chandra = real("Chandra, Torch of Defiance");
  expect(colourSourceColours(chandra)).toEqual([]);
  expect(cardLines(chandra).some(isColourSource)).toBe(false);
  expect(colourSourceColours(real("Chandra, Novice Pyromancer"))).toEqual([]);
});

// A NEGATIVE LOYALTY ABILITY RUNS OUT (CR 606.6): loyalty L and cost c give floor(L/c) activations, one a turn (CR 606.3), and the simulation counts them.
// The walker is priced at its best-amount ability, and the rest of the turns it adds nothing. Both arms are the SAME shuffle with one slot swapped (the walker
// against an inert four-drop), so a trial's gap is the walker's own mana on that turn.
test("a negative loyalty mana ability pays for floor(loyalty / cost) turns, from the turn the walker is cast", () => {
  const turnsOn = (walker: DeckCard): number => {
    const arm = (w: DeckCard): number[][] => simulate([w, ...basics(98)], { trials: 3_000, turns: 8, seed: 41, mulligan: false }).manaAt;
    const a = arm(walker), b = arm(card("Inert four-drop", "Sorcery", 4));
    let most = 0;
    for (let i = 0; i < a[0]!.length; i++) {
      let n = 0;
      for (let t = 0; t < 8; t++) if (a[t]![i]! - b[t]![i]! === 2) n++;
      most = Math.max(most, n);
    }
    return most;
  };
  const withLoyalty = (loyalty: number): DeckCard => {
    const dc = structuredClone(real("Chandra, Novice Pyromancer"));
    for (const l of dc.tags!.manaLines!) if (l.cost.loyalty !== null) l.startLoyalty = loyalty;
    return dc;
  };
  // Loyalty 1 and a -1 ability: one turn (the turn she is cast). Loyalty 5: five turns, turns four to eight.
  expect(turnsOn(withLoyalty(1))).toBe(1);
  expect(turnsOn(real("Chandra, Novice Pyromancer"))).toBe(5);
  expect(turnsOn(real("Chandra, Torch of Defiance"))).toBe(5);
});

// NISSA, WHO SHAKES THE WORLD: "Whenever you tap a Forest for mana, add an additional {G}" -- +1 per Forest tapped, so it is worth the Forests on the board.
test("a land-type tap bonus pays one per matching land tapped, and nothing for another land type", () => {
  const gaps = (land: string, subtype: string): number[][] => {
    const arm = (nissa: boolean): number[][] => simulate([nissa ? real("Nissa, Who Shakes the World") : card("Inert five-drop", "Sorcery", 5), ...basics(98, land).map((c) => ({ ...c, card: { ...c.card, typeLine: `Basic Land \u2014 ${subtype}` } }))],
      { trials: 3_000, turns: 8, seed: 43, mulligan: false }).manaAt;
    const a = arm(true), b = arm(false);
    return a.map((turn, t) => turn.map((x, i) => x - b[t]![i]!));
  };
  const forests = gaps("Forest", "Forest");
  // All lands bar one card, so by turn t there are t lands, and once she is out every Forest taps for one more.
  for (let t = 4; t < 8; t++) for (const g of forests[t]!) expect([0, t + 1], `turn ${t + 1}`).toContain(g);
  expect(forests[7]!.some((g) => g === 8)).toBe(true);
  for (const turn of gaps("Plains", "Plains")) for (const g of turn) expect(g).toBe(0);
});

test("a planeswalker's loyalty mana lands in the simulation the turn it is cast and adds its amount", () => {
  const maxAt = (name: string, turn: number): number => {
    const deck = [...basics(60), ...Array.from({ length: 39 }, (_, i) => real(name, `${name} ${i}`))];
    const r = simulate(deck, { trials: 2_000, turns: turn, seed: 31, mulligan: false });
    expect(deck.length).toBe(99);
    return Math.max(...r.manaAt[turn - 1]!);
  };
  // Chandra, Torch of Defiance (mana value 4, +1: Add {R}{R}): three lands on turn three, and on turn four four lands plus her two.
  expect(maxAt("Chandra, Torch of Defiance", 3)).toBe(3);
  expect(maxAt("Chandra, Torch of Defiance", 4)).toBe(6);
  // Domri, Anarch of Bolas (mana value 3, +1: Add {R} or {G}): three lands and her one on turn three.
  expect(maxAt("Domri, Anarch of Bolas", 2)).toBe(2);
  expect(maxAt("Domri, Anarch of Bolas", 3)).toBe(4);
  // Her −1 ability (Chandra, Novice Pyromancer, mana value 4, loyalty 5) is playable the turn she is cast: four lands and her two on turn four.
  expect(maxAt("Chandra, Novice Pyromancer", 4)).toBe(6);
  // Chandra, Heart of Fire's −9 cannot be paid from loyalty 5: four lands and nothing more.
  expect(maxAt("Chandra, Heart of Fire", 4)).toBe(4);
});

// MAX SPEED IS TURN 4 (owner 2026-10-13; CR 702.179a, 702.179d via gate.ts `MAX_SPEED_TURN`): a "speed 4" line is priced from turn 4, not from the turn it lands.
describe("a max-speed gate is priced from turn 4", () => {
  const meanAt = (d: DeckCard[], turn: number): number => {
    const r = simulate(d, { trials: 400, turns: 6, seed: 7 });
    const xs = r.manaAt[turn - 1]!;
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  };
  /** Sixty Muraganda Raceways whose max-speed line is edited: kept ("speed 4"), ungated (`null`, two from the start) or removed (the plain {C} alone). */
  const raceways = (edit: "kept" | "ungated" | "removed"): DeckCard[] => [...Array.from({ length: 60 }, (_, i) => {
    const c = real("Muraganda Raceway", `Raceway ${i}`);
    const lines = c.tags!.manaLines!;
    c.tags!.manaLines = edit === "kept" ? lines : edit === "removed" ? lines.filter((l) => l.gate?.kind !== "speed") : lines.map((l) => (l.gate?.kind === "speed" ? { ...l, gate: null } : l));
    return c;
  }), ...spells(39, 3)];
  test("Howlsquad Heavy is an accelerant in any deck; Muraganda Raceway taps for two from turn 4 and for one before", () => {
    expect(classifyAccelerant(real("Howlsquad Heavy"))?.kind).toBe("dork");
    expect(classifyAccelerant(real("Howlsquad Heavy"), deckOfDragons())?.kind).toBe("dork");
    const kept = raceways("kept"), removed = raceways("removed"), ungated = raceways("ungated");
    for (const t of [1, 2, 3]) {
      expect(meanAt(kept, t), `turn ${t} = the plain line`).toBe(meanAt(removed, t));
      expect(meanAt(kept, t), `turn ${t} < the ungated two`).toBeLessThan(meanAt(ungated, t));
    }
    expect(meanAt(kept, 5)).toBeGreaterThan(meanAt(removed, 5));
  });
});

test("an Adventure or prepare card's spell half is a face you play: Rampant Growth on Studious First-Year is a land-fetch", () => {
  expect(classifyAccelerant(real("Studious First-Year"))?.kind).toBe("land-fetch");
});

test("a derived amount is what the line says: Relic of Sauron taps for two, Muraganda Raceway for one until max speed, Ancient Ziggurat's mana pays generic only", () => {
  expect(manaOutput(real("Relic of Sauron")).amount).toBe(2);
  expect(manaOutput(real("Muraganda Raceway")).amount).toBe(1);
  // ...and for two from turn 4 (turn 4 by owner ruling 2026-10-13; CR 702.179a/d give entry turn + 2 at the earliest, not priced).
  expect(manaOutput(real("Muraganda Raceway")).speed).toEqual({ turn: 4, amount: 2 });
  // A card whose only mana is the speed line taps for nothing before it (Endrider Catalyzer: two at max speed; Howlsquad Heavy: one, the incumbent of its scaling line).
  expect(manaOutput(real("Endrider Catalyzer")).amount).toBe(0);
  expect(manaOutput(real("Endrider Catalyzer")).speed?.amount).toBe(2);
  expect(manaOutput(real("Howlsquad Heavy")).speed?.amount).toBe(1);
  // RESTRICTED MANA IS NEVER A COLOUR SOURCE (owner, 2026-10-10): the creature-only mana of Ancient Ziggurat pays no coloured pip.
  expect(colourMaskOf(real("Ancient Ziggurat"))).toBe(0);
  // A gated line is not credited a colour (Tainted Peak's B/R needs a Swamp) but its plain {C} stays; Temple's gated {C}{C} keeps the colourless bit.
  expect(colourMaskOf(real("Tainted Peak"))).toBe(colorMask(["C"]));
  expect(colourMaskOf(real("Temple of the False God"))).toBe(colorMask(["C"]));
  // Sol Ring is colourless and nothing else; Llanowar Elves is green.
  expect(colourMaskOf(real("Sol Ring"))).toBe(colorMask(["C"]));
  expect(colourMaskOf(real("Llanowar Elves"))).toBe(colorMask(["G"]));
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
  const deck = [...basics(37), real("Sol Ring"), ...spells(61, 3)];
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

/** A synthetic card carrying these derived lines, for the shapes no corpus card prints. */
const withManaLines = (name: string, typeLine: string, lines: ReturnType<typeof mkLine>[]): DeckCard => withLines(card(name, typeLine, 1), lines);
const amountOf = (n: number, over: Partial<ReturnType<typeof mkLine>> = {}) => ({ amount: { fixed: n, scales: null }, net: n, ...over });

test("manaOutput reads what one tap nets, and refuses what it cannot price", () => {
  // The whole point: a rock that taps for two.
  expect(manaOutput(real("Sol Ring"))).toEqual({ amount: 2 });
  expect(manaOutput(real("Thran Dynamo"))).toEqual({ amount: 3 });
  // An ordinary source, and a card with no mana ability at all.
  expect(manaOutput(real("Llanowar Elves"))).toEqual({ amount: 1 });
  expect(manaOutput(card("Bear", "Creature", 2))).toEqual({ amount: 1 });

  // A COST IS NOT FREE. A filter land pays one to make two, and a payment land pays {1} — both are
  // ONE mana. Reading the Add run alone is what took the first count over this corpus from 9 lands
  // to 27.
  expect(manaOutput(real("Cascade Bluffs"))).toEqual({ amount: 1 });
  expect(manaOutput(withManaLines("Payment", "Land", [tapFor(["U", "B"], { cost: { ...FREE_TAP, mana: 1 }, ...amountOf(2, { net: 1 }) })]))).toEqual({ amount: 1 });
  // Nor is a sacrifice, a counter or a loyalty cost a tap this model can pay.
  expect(manaOutput(withManaLines("Altar", "Artifact", [tapFor(["B"], { cost: { ...FREE_TAP, tap: true, sacrificeOther: true }, ...amountOf(2) })]))).toEqual({ amount: 1 });
  expect(manaOutput(withManaLines("Counters", "Creature", [tapFor(["C"], { cost: { ...FREE_TAP, tap: true, counters: "remove" }, ...amountOf(2) })]))).toEqual({ amount: 1 });

  // RESTRICTED MANA IS REFUSED, because this model is colour-blind (C10) and cannot check the
  // restriction. Jegantha taps for five that pay no generic cost.
  expect(manaOutput(real("Jegantha, the Wellspring"))).toEqual({ amount: 1 });
  expect(manaOutput(real("Cryptic Trilobite"))).toEqual({ amount: 1 });

  // A KAROO IS NET NEUTRAL — it taps for two off one fewer land, and the bounce is not modelled, so
  // counting it two over-claims. Rakdos Carnarium, verbatim. The bounce is an ENTERS fact (printed), not a mana detector.
  expect(manaOutput(real("Rakdos Carnarium"))).toEqual({ amount: 1 });

  // Temple of the False God: two mana, and NOTHING below five lands.
  expect(manaOutput(real("Temple of the False God"))).toEqual({ amount: 2, needsLands: 5 });

  // The tron shape. The SUBTYPE is `Urza's Power-Plant`, hyphenated, while the CARD is `Urza's
  // Power Plant` without one — so the board is matched on the type line and never on the name.
  expect(manaOutput(real("Urza's Mine"))).toEqual({ amount: 1, tron: { subtypes: ["urza's power-plant", "urza's tower"], amount: 2 } });
  expect(manaOutput(real("Urza's Tower"))).toEqual({ amount: 1, tron: { subtypes: ["urza's mine", "urza's power-plant"], amount: 3 } });
});

test("a source's output reaches the board: tron assembles, Temple stays dark under five lands", () => {
  const tron = (n: string, name: string): DeckCard[] => Array.from({ length: 33 }, (_, i) => real(name, `${n} ${i}`));
  const deck = [...tron("Mine", "Urza's Mine"), ...tron("Plant", "Urza's Power Plant"), ...tron("Tower", "Urza's Tower")];
  const assembled = simulate(deck, { trials: 5_000, turns: 3, seed: 11 });
  // Three land drops cap a plain deck at three mana. Assembled tron taps for seven off the same
  // three drops, which is exactly the fact `manaWithRocks` and this model both used to miss.
  expect(pAtLeastMana(assembled, 7, 3)).toBeGreaterThan(0.1);
  expect(pAtLeastMana(simulate(basics(99), { trials: 5_000, turns: 3, seed: 11 }), 4, 3)).toBe(0);

  // A GATE IS ZERO BELOW ITS THRESHOLD, not one. A deck of nothing but Temples makes no mana at all
  // for four turns; the incumbent read one per Temple.
  const temples = Array.from({ length: 99 }, (_, i) => real("Temple of the False God", `Temple ${i}`));
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
  const tower = (i: number): DeckCard => real("Urza's Tower", `Urza's Tower ${i}`);
  const nexus = (i: number): DeckCard => real("Planar Nexus", `Planar Nexus ${i}`);
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
  Array.from({ length: n }, (_, i) => withTap({
    card: { name: `${name} ${i}`, typeLine: `Land — ${name}`, oracleText: "{T}: Add one mana of any color.", keywords: [], colors: [], manaValue: 0, producedMana: colors } as never,
    tags: null,
  }, colors));
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
  // THE REAL FETCHLAND: Scalding Tarn prints "an Island or Mountain card" -- a word no invented fixture should replace (roadmap N2).
  const tarn = real("Scalding Tarn");
  const land = (typeLine: string, colours: string[]): DeckCard => withTap(card(typeLine, typeLine), colours);
  const deck = [land("Land — Island", ["U"]), land("Land — Mountain", ["R"]), land("Land — Forest", ["G"])];
  // It finds what it NAMES, against what this deck actually holds -- so it is a blue and red source
  // and not a green one, and in a deck with no Mountain it would not be a red one either.
  expect(fetchMaskOf(tarn, deck)).toBe(colorMask(["U", "R"]));
  expect(fetchMaskOf(tarn, [land("Land — Island", ["U"])])).toBe(colorMask(["U"]));

  // "an Island OR Mountain card" IS AN OR, NOT AN AND (owner, 2026-08-25): a plain Island is a legal
  // target, a plain Mountain is, and a land carrying both is. One word (`some` vs `every`) separates
  // this from a fetch that can find almost nothing.
  expect(fetchMaskOf(tarn, [land("Basic Land — Island", ["U"])])).toBe(colorMask(["U"]));
  expect(fetchMaskOf(tarn, [land("Basic Land — Mountain", ["R"])])).toBe(colorMask(["R"]));
  // And a land carrying NEITHER is not a target, however much mana it makes.
  expect(fetchMaskOf(tarn, [land("Basic Land — Forest", ["G"])])).toBe(0);

  // NAMING A TYPE IS NOT DEMANDING A BASIC (owner, 2026-08-25). Scalding Tarn searches for a
  // "card", not a "basic land card", so a SHOCKLAND carrying both types is a legal target -- and in
  // `iz-it-izzet` that is what takes it from 19 lands to 20.
  const shock = [land("Land — Island Mountain", ["U", "R"])];
  expect(fetchMaskOf(tarn, shock)).toBe(colorMask(["U", "R"]));
  // The mirror, and the one card in the 71 decks that needs it: Seething Landscape says BASIC, so
  // the same shockland is NOT a legal target.
  const landscape = real("Seething Landscape");
  expect(fetchMaskOf(landscape, shock)).toBe(0);
  expect(fetchMaskOf(landscape, [...shock, land("Basic Land — Swamp", ["B"])])).toBe(colorMask(["B"]));
  // `nonbasic` contains `basic`, and reading it as a demand would empty every mask.
  expect(fetchMaskOf(card("Nonbasic Fetch", "Sorcery", 1, "Search your library for a nonbasic land card."), shock)).toBe(colorMask(["U", "R"]));
  // A basic fetch that finds Wastes finds {C}: the colourless bit, not only the five colours (Solemn Simulacrum in a colourless deck).
  expect(fetchMaskOf(card("Basic Fetch", "Sorcery", 2, "Search your library for a basic land card, put it onto the battlefield tapped."),
    [land("Basic Land — Wastes", ["C"])])).toBe(colorMask(["C"]));
  // The colours a fetch finds are the colours the land is a COLOUR SOURCE of: a gated line is not credited, as in the audit.
  expect(fetchMaskOf(real("Scalding Tarn"), [real("Tainted Peak")])).toBe(0);

  // THINNING: the land it finds LEAVES the library, so a deck of fetches draws better than the same
  // deck of blanks. Measured through the simulator rather than asserted.
  const withFetch = simulate([...Array.from({ length: 20 }, (_, i) => real("Scalding Tarn", `Tarn ${i}`)), ...dual(20, "Island", ["U"]), ...spell(59, "Spell", "{U}", 1)], { trials: 4_000, turns: 3, seed: 6 });
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
  const fetchland = (i: number): DeckCard => ({ ...card(`Fetch ${i}`, "Land", 0, FETCH, []), tags: fetchTags({ kind: "permanent", tapped: false, reach: WUBRG }) });
  const deck: DeckCard[] = [
    ...Array.from({ length: 20 }, (_, i) => fetchland(i)),
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
  const ramp: DeckCard[] = [
    ...Array.from({ length: 20 }, (_, i) => real("Nature's Lore", `Lore ${i}`)),
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
  const tarns = Array.from({ length: 20 }, (_, i) => real("Scalding Tarn", `Tarn ${i}`));
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

// N3. CR 712.8a -- A CARD IN HAND IS ITS FRONT FACE, so a transform card's land back can never be
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
  // The Treasure maker has a token-maker line, which is no mana of its own.
  expect(classifyAccelerant(real("Pitiless Plunderer"))).toBeNull();

  // A GRANT TO PERMANENTS YOU CONTROL IS RECURRING MANA and stays: Enduring Vitality is one of the
  // three accelerants on `samut` the old hypergeometric model could see at all.
  expect(classifyAccelerant(real("Enduring Vitality"))?.kind).toBe("dork");

  // THE GRANT IS NOT ENOUGH ON ITS OWN -- Goldspan Dragon grants to TREASURES, and a permanent that
  // sacrifices itself for mana is the one-shot again, in a sentence shaped like a grant.
  expect(classifyAccelerant(real("Goldspan Dragon"))).toBeNull();

  // A SUSPEND-ONLY MANA ROCK IS NOT A TURN-ONE ROCK. Mana value 0 and rule 3 casts by mana value, so
  // Mox Tantalite landed free on turn one; the real sequence is a cost and a three-turn wait.
  expect(classifyAccelerant(real("Mox Tantalite"))).toBeNull();

  // The ordinary rock is untouched.
  expect(classifyAccelerant(real("Sol Ring"))?.kind).toBe("rock");
});

// N10. "ADD THREE MANA OF ANY ONE COLOR" IS INVISIBLE TO A READER THAT COUNTS `{...}` SYMBOLS.
// Sceptre of Eternal Glory is in 11 decks and was priced at one mana.
test("N10: a word-form amount is read, and its gate with it", () => {
  const sceptre = manaOutput(real("Sceptre of Eternal Glory"));
  // The gated line wins because it makes more -- and it is ZERO below the gate, not one.
  expect(sceptre.amount).toBe(3);
  // SAME NAME IS UNCHECKABLE HERE and "three or more lands" is its floor, so the gate under-claims
  // rather than counting three from turn one.
  expect(sceptre.needsLands).toBe(3);

  expect(manaOutput(withManaLines("Three", "Artifact", [tapFor(WUBRG, amountOf(3))])).amount).toBe(3);
  expect(manaOutput(withManaLines("Two", "Artifact", [tapFor(["U", "B", "R"], amountOf(2))])).amount).toBe(2);
  // Restricted mana stays one: the model is colour-blind, so it cannot check the restriction.
  expect(manaOutput(withManaLines("Smoke", "Creature", [tapFor(WUBRG, { ...amountOf(2), restriction: { spend: "to cast elemental spells", typeName: "elemental", minManaValue: null } })])).amount).toBe(1);
  // A cost that is not exactly {T} is not a tap this model can pay.
  expect(manaOutput(withManaLines("Costed", "Artifact", [tapFor(WUBRG, { cost: { ...FREE_TAP, mana: 1 }, ...amountOf(2, { net: 1 }) })])).amount).toBe(1);
  // An X amount is a RATE, not an amount -- it stays at one rather than being guessed.
  expect(manaOutput(withManaLines("Elves", "Creature", [tapFor(WUBRG, { amount: { fixed: null, scales: "x" }, net: 1 })])).amount).toBe(1);
  // A gate this model cannot check leaves its line uncounted.
  expect(manaOutput(withManaLines("Gated", "Artifact", [tapFor(["C"], { ...amountOf(3), gate: parseGate("you control a swamp") })])).amount).toBe(1);
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

// N12. A FETCH IS NOT FREE, INSTANT AND UNTAPPED just because the model performs it the moment the
// land is played. Two printed facts were being ignored: what cracking it COSTS, and whether the land
// it finds arrives TAPPED.
test("N12: a crack that costs mana is not a fetch this model can perform", () => {
  // Wayfarer's Bauble, verbatim: cast for {1}, then {2} and a tap and a sacrifice, a turn later.
  // Priced as a cast-time fetch it was a one-mana ramp spell that put a land onto the battlefield.
  expect(classifyAccelerant(real("Wayfarer's Bauble"))).toBeNull();

  // Nature's Lore resolves its fetch, so it stays a land-fetch accelerant.
  expect(classifyAccelerant(real("Nature's Lore"))?.kind).toBe("land-fetch");

  // A LAND whose crack costs mana is an ordinary land: Myriad Landscape taps for {C} and its two
  // basics cost {2} the model never pays, so it neither fixes colours nor thins.
  const landscape = (i: number) => real("Myriad Landscape", `Myriad ${i}`);
  const green = card("Green", "Sorcery", 1, "");
  (green.card as { manaCost?: string }).manaCost = "{G}";
  const deck = [...Array.from({ length: 20 }, (_, i) => landscape(i)), ...basics(17), ...spells(61, 3), green];
  const r = simulate(deck, { trials: 4_000, turns: 4, seed: 9 });
  // Its colours are its own {C}, not the green of the basics it could fetch for {2}.
  expect(r.byCardCastable.get("Green")![3]).toBeLessThan(r.byCard.get("Green")![3]);
});

test("N12: a fetch that finds a TAPPED land gives a tapped land", () => {
  const wilds = (i: number) => real("Evolving Wilds", `Wilds ${i}`);
  const deck = [...Array.from({ length: 37 }, (_, i) => wilds(i)), ...spells(62, 3)];
  const r = simulate(deck, { trials: 4_000, turns: 3, seed: 9 });
  // Every land in this deck arrives tapped, so turn one makes nothing at all.
  expect(pAtLeastMana(r, 1, 1)).toBe(0);

  // FABLED PASSAGE UNTAPS ITS LAND once you control four, so it is tapped early and not late -- the
  // `slow` shape, and the one card of the family that prints the clause (21 slots).
  const passage = (i: number) => real("Fabled Passage", `Passage ${i}`);
  const late = simulate([...Array.from({ length: 37 }, (_, i) => passage(i)), ...spells(62, 3)], { trials: 4_000, turns: 6, seed: 9 });
  expect(pAtLeastMana(late, 1, 1)).toBe(0);
  // THE CELL THAT SEPARATES THE TWO: on turn four the land played THIS turn is the difference. Every
  // land tapped reads 0% for four mana on turn four; untapping at four lands reads 64%.
  expect(pAtLeastMana(r, 4, 4)).toBe(0);
  expect(pAtLeastMana(late, 4, 4)).toBeGreaterThan(0.5);
});

// N14. A PHYREXIAN PIP KEEPS ITS COLOUR, and the reason is a missing model rather than a reading of
// the card: its alternative is TWO LIFE, and nothing here has a life total. Same direction as the
// `{2/W}` ruling beside it, a much larger number, and stated rather than left implicit.
test("N14: a Phyrexian pip demands its colour, because this model cannot pay life", () => {
  const dismember = parseCost("{1}{B/P}{B/P}")!;
  expect(dismember).toEqual({ total: 3, pips: [colorMask(["B"]), colorMask(["B"])] });

  const swamp = { mana: 1, colors: colorMask(["B"]) };
  const forest = { mana: 1, colors: colorMask(["G"]) };
  // Three green sources make the mana and not the colour, so the model says no -- where a player
  // pays four life and casts it off one land. UNDER-claiming, which is the direction this repo takes.
  expect(payable([forest, forest, forest], dismember)).toBe(false);
  expect(payable([forest, swamp, swamp], dismember)).toBe(true);

  // The pip is still ONE mana of the total, exactly as the rules count it.
  expect(parseCost("{G/P}")).toEqual({ total: 1, pips: [colorMask(["G"])] });
});

// O2. A TAP-REPLACEMENT MAKES AN EXISTING SOURCE PRODUCE MORE, and it was being priced as a flat
// one-mana rock -- so Forsaken Monument, which adds {C} for EVERY permanent tapped for {C}, was worth
// exactly one mana in a deck with twenty-seven colourless lands. Three defects, one family.
test("O2: a land aura waits a turn, because the land pays for it", () => {
  // Wild Growth, verbatim. You enchant a land you already control, tapping it to pay -- so it nets
  // nothing the turn it lands and pays from the next, which is a DORK's timing and not a rock's.
  const growth = real("Wild Growth");
  expect(classifyAccelerant(growth)?.kind).toBe("dork");

  // Overgrowth adds TWO, and the amount is on the aura's trigger line, not on a tap.
  expect(manaOutput(real("Overgrowth")).amount).toBe(2);
  expect(manaOutput(growth).amount).toBe(1);
  // "an additional one mana of any color" is one, in words.
  expect(manaOutput(real("Fertile Ground")).amount).toBe(1);

  // AN ORDINARY ROCK IS UNTOUCHED: it brings its own mana and pays the turn it lands (CR 302.6).
  expect(classifyAccelerant(real("Sol Ring"))?.kind).toBe("rock");
});

test("O2: a per-source bonus scales with the board it reads", () => {
  const monument = (i: number) => real("Forsaken Monument", `Monument ${i}`);
  const wastes = (i: number) => withTap(card(`Wastes ${i}`, "Basic Land — Wastes", 0, ""), ["C"]);
  const deck = [...Array.from({ length: 12 }, (_, i) => monument(i)), ...Array.from({ length: 37 }, (_, i) => wastes(i)), ...spells(50, 3)];
  const r = simulate(deck, { trials: 4_000, turns: 8, seed: 12 });

  // With the Monument out, every colourless land taps for two. Priced as a flat one-mana rock the
  // deck could not reach ten mana by turn eight; reading the bonus it routinely does.
  expect(pAtLeastMana(r, 10, 8)).toBeGreaterThan(0.3);

  // AND IT IS NOT FREE MONEY: the bonus counts SOURCES, not mana, so a source making two mana off one
  // tap is still one trigger. A deck with no colourless source gets nothing from it.
  const green = [...Array.from({ length: 12 }, (_, i) => monument(i)), ...basics(37), ...spells(50, 3)];
  const none = simulate(green, { trials: 4_000, turns: 8, seed: 12 });
  expect(pAtLeastMana(none, 10, 8)).toBe(0);
});

// LEYLINE OF ABUNDANCE (owner, 2026-10-13: Forsaken Monument and Leyline are accelerants; the bonus is +1 per qualifying tap, CR 106.12a). "Whenever you
// tap a creature for mana, add an additional {G}": the board's CREATURE sources count, a rock or a land does not. Both arms are the SAME shuffle with one
// slot swapped (Leyline against an inert four-drop), so the difference per trial is the Leyline's own bonus and nothing else.
test("O2: Leyline of Abundance's bonus counts creature sources only: a rock adds nothing, a dork adds one", () => {
  const filler = (leyline: boolean): DeckCard[] => [leyline ? real("Leyline of Abundance") : card("Inert four-drop", "Sorcery", 4)];
  const arm = (leyline: boolean, source: DeckCard): number[] => {
    const deck = [...filler(leyline), source, ...basics(38), ...spells(59, 3)];
    expect(deck.length).toBe(99);
    return simulate(deck, { trials: 3_000, turns: 8, seed: 14 }).manaAt.flatMap((turn) => turn);
  };
  const gap = (source: DeckCard): { min: number; max: number } => {
    const a = arm(true, source), b = arm(false, source);
    const d = a.map((x, i) => x - b[i]!);
    return { min: d.reduce((m, x) => Math.min(m, x), 0), max: d.reduce((m, x) => Math.max(m, x), 0) };
  };
  // Sol Ring is a rock: the bonus never reads it.
  expect(gap(real("Sol Ring"))).toEqual({ min: 0, max: 0 });
  // Llanowar Elves is a creature: in the trials that hold both, every tap of it adds one {G}.
  expect(gap(real("Llanowar Elves"))).toEqual({ min: 0, max: 1 });
});

// O2, THE PHASE-TRIGGER HALF. "At the beginning of your first main phase, add {G}{G}" is a recurring
// source that never taps, so `manaOutput`'s `{T}:` reader sees nothing. The rule is small because the
// GUARDS take almost the whole family: of 32 corpus cards printing the shape, most add a RATE, six
// restrict the mana, and two are one-shots wearing a trigger.
test("O2: a phase trigger that adds a FIXED amount is a source; the rest are refused", () => {
  // Hulking Raptor, verbatim. It is a creature and pays from the turn after it lands, like any dork:
  // you cast it DURING your main phase, so that turn's trigger has already happened.
  const raptor = real("Hulking Raptor");
  expect(classifyAccelerant(raptor)?.kind).toBe("dork");
  expect(manaOutput(raptor).amount).toBe(2);

  // A NON-CREATURE PHASE TRIGGER IS THE SHAPE THE TIMING RULE EXISTS FOR -- Eladamri's Vineyard is an
  // Enchantment, so the generic creature branch would call it a rock and pay it a turn early.
  // 9 of the corpus family are non-creatures.
  const vineyard = real("Eladamri's Vineyard");
  expect(classifyAccelerant(vineyard)?.kind).toBe("dork");
  expect(manaOutput(vineyard).amount).toBe(2);

  // A RATE IS NOT AN AMOUNT -- the I4 ruling one subsystem over. Muerra adds one per Raccoon and
  // Black Market one per charge counter; neither is a number this model knows.
  expect(manaOutput(real("Muerra, Trash Tactician")).amount).toBe(1);
  expect(manaOutput(real("Black Market")).amount).toBe(1);
  // NOT A REAL CARD, and the comment says so: no corpus card prints a MULTI-SYMBOL rate, so this is
  // the one assertion here with no printed witness.
  expect(manaOutput(withManaLines("Elf Engine", "Enchantment", [triggerLine("main-phase", "your first main phase", ["G"], 2, { amount: { fixed: null, scales: "for each elf you control" } })])).amount).toBe(1);

  // RESTRICTED mana stays refused by the standing rule: Thran Turbine's two colourless cannot cast
  // spells at all, and this model cannot check what mana is spent on.
  expect(manaOutput(real("Thran Turbine")).amount).toBe(1);
  expect(classifyAccelerant(real("Thran Turbine"))).toBeNull();

  // A ONE-SHOT IS NOT A SOURCE, at any confidence. "Your NEXT main phase" fires once (Mana Drain; the
  // amount scales, so it is refused as a rate too).
  expect(manaOutput(real("Mana Drain")).amount).toBe(1);
  expect(classifyAccelerant(real("Mana Drain"))).toBeNull();
});

// O2, THE EVENT-TRIGGER HALF. Classified corpus-wide by whether this simulator PRODUCES the event,
// and only one bucket survives: a LAND ENTERING, which is rule 2 and happens every turn a land drop
// does. Combat, an opponent, a creature dying and a spell cast are all events the goldfish does not
// have -- so those cards are refused rather than priced off a stream that is not there.
test("O2: landfall mana pays per land entering, and only that bucket is modellable", () => {
  // Lotus Cobra, verbatim. A creature cast in your main phase misses that turn's land drop, which
  // already happened under rule 2 -- so it pays from the next turn, like every other engine here.
  const cobra = (i: number) => real("Lotus Cobra", `Lotus Cobra ${i}`);
  expect(classifyAccelerant(cobra(0))?.kind).toBe("dork");
  expect(landfallOf(cobra(0))).toBe(1);
  const deck = [...Array.from({ length: 12 }, (_, i) => cobra(i)), ...basics(37), ...spells(50, 3)];
  const r = simulate(deck, { trials: 4_000, turns: 8, seed: 21 });

  // IT IS A REAL SOURCE: the same deck with the Cobras replaced by blanks reads materially lower.
  const blank = [...Array.from({ length: 12 }, (_, i) => card(`Blank ${i}`, "Creature — Snake", 2, "")),
    ...basics(37), ...spells(50, 3)];
  expect(pAtLeastMana(r, 6, 6)).toBeGreaterThan(pAtLeastMana(simulate(blank, { trials: 4_000, turns: 8, seed: 21 }), 6, 6) + 0.05);

  // AND IT IS WORTH LESS THAN A FLAT DORK, which is the correction rather than an upgrade: the mana
  // arrives only when a land ENTERS, and a deck misses land drops. Priced as an ordinary one-mana
  // dork -- what it was before -- the same board reads HIGHER than the truth.
  const asDork = [...Array.from({ length: 12 }, (_, i) => withTap(card(`Dork ${i}`, "Creature — Snake", 2, "{T}: Add {G}."), ["G"])),
    ...basics(37), ...spells(50, 3)];
  const dorkArm = pAtLeastMana(simulate(asDork, { trials: 4_000, turns: 8, seed: 21 }), 9, 8);
  expect(pAtLeastMana(r, 9, 8)).toBeLessThan(dorkArm);

  // PER EVENT, NOT PER TURN: a land-fetch SPELL puts a second land onto the battlefield in the same
  // turn, and the Cobra is paid for both.
  const withFetch = [...Array.from({ length: 12 }, (_, i) => cobra(i)),
    ...Array.from({ length: 10 }, (_, i) => real("Nature's Lore", `Lore ${i}`)),
    ...basics(30), ...spells(47, 3)];
  const fetched = simulate(withFetch, { trials: 4_000, turns: 8, seed: 21 });
  expect(pAtLeastMana(fetched, 6, 5)).toBeGreaterThan(pAtLeastMana(r, 6, 5));

  // A SPELL CAST, COMBAT, AN OPPONENT AND A CREATURE DYING ARE NOT EVENTS THIS MODEL HAS. Birgi is
  // the owner's own card and is deliberately NOT priced off the accelerants rule 3 happens to cast:
  // that stream is a fraction of a real deck's spells and would feed back into the casting loop.
  const birgi = real("Birgi, God of Storytelling");
  expect(manaOutput(birgi).amount).toBe(1);
  // TRIGGER MANA FROM A SPELL CAST IS RAMP, NOT A DORK (owner, 2026-10-10): the cast trigger is a line the goldfish refuses.
  expect(classifyAccelerant(birgi)).toBeNull();
  expect(landfallOf(birgi)).toBe(0);
  // ...and neither is a creature's own enters trigger (Burning-Tree Emissary: mana once, no source).
  expect(classifyAccelerant(real("Burning-Tree Emissary"))).toBeNull();

  // NO PRINTED WITNESS, and the comment says so: all three landfall-mana cards in the corpus are
  // unrestricted, so this pins the guard against the SHAPE. It is kept because every other mana
  // reader in this module checks the restriction, and landfall being the one that does not is how a
  // rule quietly diverges from its neighbours.
  const restricted = withManaLines("Not A Real Card", "Creature — Snake", [
    triggerLine("enters", "a land you control", ["G"], 2, { restriction: { spend: "to cast creature spells", typeName: "creature", minManaValue: null } })]);
  // Refused outright, since the restriction cannot be checked: not an accelerant at all.
  expect(classifyAccelerant(restricted)).toBeNull();
  expect(landfallOf(restricted)).toBe(0);
  const board = [...Array.from({ length: 12 }, () => restricted), ...basics(37), ...spells(50, 3)];
  const asRestricted = simulate(board, { trials: 4_000, turns: 8, seed: 21 });
  // REFUSED, so it reads EXACTLY like the same dorks with no mana line -- same composition, same seed, same answer.
  const bare = [...Array.from({ length: 12 }, () => card("Not A Real Card", "Creature — Snake", 2)), ...basics(37), ...spells(50, 3)];
  expect(pAtLeastMana(asRestricted, 9, 8)).toBe(pAtLeastMana(simulate(bare, { trials: 4_000, turns: 8, seed: 21 }), 9, 8));
  // A GATED landfall is not credited either (Koth: "that land is a Mountain").
  expect(classifyAccelerant(withManaLines("Gated Landfall", "Creature", [triggerLine("enters", "a land you control", ["R"], 1, { gate: parseGate("that land is a mountain") })]))).toBeNull();
});

// O1. THE FLIP, AND THE ITEM'S OWN PREMISE SHRANK TWICE UNDER MEASUREMENT. Ashling was ALREADY
// counted -- as a one-mana dork, through `producedMana` -- so the gap was never the whole engine,
// only the difference between one and two. And the flip needs no play model after all: the card is
// cast in a main phase and flips at the NEXT one, which is exactly the dork timing the model already
// has. What was actually missing is the AMOUNT in words and the restriction being checkable.
test("O1: a restricted phase trigger counts when the deck makes the restriction vacuous", () => {
  // Ashling's back face, as the line derive reads it: two mana of any colour at the beginning of your first main phase, spent only on spells at
  // mana value 4 or greater. (The REAL card transforms, and a transform card's back is never a source from the deck, #1174; this is the shape.)
  const floor = { restriction: { spend: "to cast spells with mana value 4 or greater", minManaValue: 4 } };
  const ashling = (i: number) => withLines(card(`Ashling ${i}`, "Legendary Creature — Elemental Sorcerer", 4),
    [triggerLine("main-phase", "your first main phase", WUBRG, 2, { anyColour: "any", ...floor })]);
  // THE AMOUNT IS TWO, with its floor recorded for the deck to settle.
  expect(manaOutput(ashling(0))).toEqual({ amount: 2, needsMinMV: 4 });
  expect(classifyAccelerant(ashling(0))?.kind).toBe("dork");
  // THE REAL CARD, as it was priced before the goldfish read derived lines: a transform card's back that is NOT a land (#1174 is about land backs) still
  // counts here, so the two Ashling decks keep their mana commander.
  const real_ = real("Ashling, Rekindled");
  expect(classifyAccelerant(real_)?.kind).toBe("dork");
  expect(manaOutput(real_)).toEqual({ amount: 2, needsMinMV: 4 });
  // ...and a transform card whose back IS a land does not (Treasure Map // Treasure Cove).
  expect(classifyAccelerant(real("Treasure Map"))).toBeNull();

  // IN A DECK WITH NOTHING CHEAP, THE RESTRICTION BINDS NOTHING. `iz-it-izzet` is built that way:
  // all 62 of its nonlands are mana value 4 or greater, so "spend only on mana value 4 or greater"
  // costs it exactly nothing -- and mana value is the ONE restriction this model can check, because
  // it knows every card's.
  // THE ENGINE'S OWN MANA VALUE COUNTS, and that is correct rather than awkward: a deck holding a
  // two-drop has a two-drop to cast, so the restriction binds.
  const expensive = [...Array.from({ length: 12 }, (_, i) => ashling(i)), ...basics(37), ...spells(50, 6)];
  const cheap = [...Array.from({ length: 12 }, (_, i) => ashling(i)), ...basics(37), ...spells(50, 2)];
  const rich = simulate(expensive, { trials: 4_000, turns: 8, seed: 31 });
  const poor = simulate(cheap, { trials: 4_000, turns: 8, seed: 31 });

  // Same lands, same count of the same card: the ONLY difference is whether the deck can spend the
  // mana. The deck of six-drops gets it; the deck of two-drops does not.
  expect(pAtLeastMana(rich, 8, 7)).toBeGreaterThan(pAtLeastMana(poor, 8, 7));

  // AND THE REFUSAL IS THE DEFAULT: a restriction this model cannot check still refuses outright (Thran Turbine's "can't be spent to cast spells",
  // Abstract Paintmage's instants and sorceries).
  expect(manaOutput(real("Thran Turbine")).amount).toBe(1);
  expect(classifyAccelerant(real("Abstract Paintmage"))).toBeNull();
  expect(manaOutput(real("Abstract Paintmage")).amount).toBe(1);
});

// O1, THE PIECE THAT UNLOCKS IT. A COMMANDER IS NOT IN THE LIBRARY, so rule 3 never cast it and a
// commander that MAKES MANA contributed nothing -- 6 of the 71 decks have one, including both Ashling
// decks. It is the most reliable accelerant a deck can have: available from the command zone every
// game, no draw required. So it starts in hand rather than in the library, and rule 3 casts it when
// the mana is there, like anything else.
test("O1: a commander that makes mana is deployed, because the command zone always has it", () => {
  const bear = card("Bear", "Creature — Bear", 2, "");
  const dork = withTap(card("Mana Commander", "Legendary Creature — Elf Druid", 2, "{T}: Add {G}."), ["G"]);
  const deck = [...basics(37), ...spells(62, 4)];

  // No mulligan: a cheap commander is itself "a play by turn 3", so the keep would differ by commander.
  const withMana = simulate(deck, { trials: 8_000, turns: 8, seed: 41, alsoPrice: [dork], mulligan: false });
  const without = simulate(deck, { trials: 8_000, turns: 8, seed: 41, alsoPrice: [bear], mulligan: false });
  // The same 99 cards; the only difference is whether the commander taps for mana.
  expect(pAtLeastMana(withMana, 6, 6)).toBeGreaterThan(pAtLeastMana(without, 6, 6) + 0.05);

  // IT IS STILL PRICED, not silently turned into a library card: the commander keeps its own row and
  // never dilutes the deck it is not in.
  expect(withMana.byCard.has("Mana Commander")).toBe(true);
  expect(pAtLeastMana(without, 6, 6)).toBe(pAtLeastMana(simulate(deck, { trials: 8_000, turns: 8, seed: 41, mulligan: false }), 6, 6));
});

// --- coloured-source sequencing (roadmap L4) ---

const W = 1, U = 2, B = 4, R = 8, G = 16;

test("the land played is the one the hand's colours ask for, not the one the shuffle put first", () => {
  // A Mountain first in hand and an Island second, with {U}{U} to cast: the incumbent rule read
  // tapped-ness and then HAND ORDER, so it played the Mountain half the time.
  expect(pickLand([{ colors: R }, { colors: U }], 0, [U, U])).toBe(1);
});

test("a colour the board already makes is not a reason to play a second source of it", () => {
  expect(pickLand([{ colors: U }, { colors: R }], U, [U, R])).toBe(1);
});

test("a land covering two unmet demands beats one covering a single demand", () => {
  expect(pickLand([{ colors: B }, { colors: U | R }], 0, [B, U, R])).toBe(1);
});

test("no colour tension keeps hand order, which is the rule this replaced", () => {
  // The acceptance test for every deck that is mono-coloured or already fixed: byte-identical.
  expect(pickLand([{ colors: G }, { colors: G }], G, [G, G])).toBe(0);
  expect(pickLand([{ colors: W }, { colors: U }], 0, [])).toBe(0);
});

test("a hybrid pip is satisfied by either half", () => {
  // `parseCost` gives `{U/R}` one pip whose mask names both, so a Mountain answers it.
  expect(pickLand([{ colors: G }, { colors: R }], 0, [U | R])).toBe(1);
});

test("the sequencing rule is reached THROUGH simulate, not only as a pure function", () => {
  // A PROBE THAT CALLS THE INNER FUNCTION DOES NOT TEST THE GATE THAT SELECTS IT — the fifth time
  // this repo records that shape, so the rule is separated here through the whole simulation.
  //
  // Thirty Islands, thirty Mountains and forty `{U}{R}` two-drops: on turn two the card is castable
  // only off ONE of each. Playing by hand order takes two Islands about half the time.
  const dual = (i: number): DeckCard => ({
    card: {
      name: `Bolt ${i}`, typeLine: "Instant", oracleText: "", keywords: [], colors: ["U", "R"],
      manaValue: 2, manaCost: "{U}{R}",
    } as never,
    tags: null,
  });
  const landOf = (name: string, color: string, i: number): DeckCard => ({
    card: {
      name: `${name} ${i}`, typeLine: `Basic Land — ${name}`, oracleText: `{T}: Add {${color}}.`,
      keywords: [], colors: [], manaValue: 0, producedMana: [color],
    } as never,
    tags: null,
  });
  const deck = [
    ...Array.from({ length: 30 }, (_, i) => landOf("Island", "U", i)),
    ...Array.from({ length: 30 }, (_, i) => landOf("Mountain", "R", i)),
    ...Array.from({ length: 40 }, (_, i) => dual(i)),
  ];
  const t2 = simulate(deck, { trials: 4_000, turns: 3, seed: 11 }).byCardCastable.get("Bolt 0")![1];
  // MEASURED IN BOTH ARMS, because a threshold picked by eye is how a test comes to pass in both:
  // the first version of this one asserted 0.4 and the colour-BLIND rule already read 0.508.
  // Hand order 50.8%, colour-aware 92.5% — the gap is every hand holding both colours.
  expect(t2).toBeGreaterThan(0.85);
});

test("a split card is gated on the cost it pays, not on its combined mana value", async () => {
  const { manaModel } = await import("./goldfish.js");
  const land = (n: number) => Array.from({ length: n }, (_, i) => ({
    card: { name: `Plains ${i}`, typeLine: "Basic Land — Plains", oracleText: "", manaValue: 0,
      producedMana: ["W"], keywords: [] },
    tags: null,
  })) as never[];
  const splitCard = {
    card: {
      name: "Dusk // Dawn", typeLine: "Sorcery // Sorcery", oracleText: "", manaValue: 9,
      manaCost: "{2}{W}{W} // {3}{W}{W}", layout: "split", keywords: ["Aftermath"],
    },
    tags: null,
  } as never;
  const res = manaModel([...land(36), splitCard]);
  const curve = res.curves.get("Dusk // Dawn")!;
  // Turn 4 is when {2}{W}{W} becomes payable off four Plains. Under the old gate the card was not
  // even considered until the board made NINE mana.
  expect(curve.castable[3].high).toBeGreaterThan(0.5);
});

/** T18b. THE PER-CARD FIGURE IS CONDITIONAL ON HAVING DRAWN THE CARD, and the denominator that
 *  makes it so is the thing worth pinning: it used to be every trial, including the ones where the
 *  card was never seen, so a one-drop's "40% to cast it on turn 1" was mostly counting games in
 *  which it was still in the library.
 *
 *  "DRAWN", NEVER "STILL IN HAND". The first attempt asked whether the card was in hand at the
 *  moment the cell was scored, and rule 3 casts accelerants greedily -- so `Sol Ring` had already
 *  left the hand and read as drawn in 5 trials of 2,000 instead of ~8% of them, and a zero-mana rock
 *  read 0 and would have printed 0%. A card that the deck reliably CASTS is the last one that should
 *  read as never drawn. */
test("a card's castability denominator counts the trials that drew it, cast or not", () => {
  // `manaCost` matters here and nowhere else in this file: `parseCost` returns null without it and
  // the card would be skipped by the colour-aware half entirely.
  const solRing = real("Sol Ring");
  const deck = [...basics(37), solRing, ...spells(61, 3)];
  const r = simulate(deck, { trials: TRIALS, turns: 4, seed: 23 });

  // A singleton is drawn by turn 1 in (7 opening + 1 draw) of 99 cards. It is CAST on turn 1 in most
  // of those, which is exactly why "still in hand" got this wrong.
  const held = r.byCardHeld.get("Sol Ring")!;
  expect(held[0] / TRIALS).toBeCloseTo(8 / 99, 2);
  // And it keeps growing with the extra draws, rather than collapsing as the card gets played.
  expect(held[3]).toBeGreaterThan(held[0]);

  // The rate is over THAT denominator: one mana off 37 lands is close to certain once you hold it,
  // and would read near 8% if the divisor were still every trial.
  expect(r.byCardCastable.get("Sol Ring")![0]).toBeGreaterThan(0.9);
});

/** A commander is priced from the command zone and was never shuffled in, so "did you draw it" does
 *  not apply -- it is available in every game. Its denominator has to be every trial, or the one row
 *  a reader looks for by name is computed off a few hundred. */
test("a commander is held in every trial, because the command zone is not the library", () => {
  const deck = [...basics(37), ...spells(62, 3)];
  const commander = card("Commander", "Legendary Creature — Human", 4);
  const r = simulate(deck, { trials: 500, turns: 5, seed: 29, alsoPrice: [commander] });
  expect(r.byCardHeld.get("Commander")).toEqual(Array(5).fill(500));
});

/** RITUALS ARE ONE TURN'S MANA, NOT A SOURCE (owner 2026-10-06: "there were games where I won on turn
 *  3 casting Alania t2"). A ritual never joins the board, so `manaAt` and every castability figure
 *  stay as they were; what it changes is how fast the COMMANDER can come down in one burst. */
test("a ritual is an instant or sorcery that adds a fixed amount; a rate or a creature is not one", () => {
  expect(ritualAdds(real("Desperate Ritual"))).toBe(3);
  expect(ritualAdds(real("Seething Song"))).toBe(5);
  expect(ritualAdds(real("Dark Ritual"))).toBe(3);
  // Cabal Ritual's threshold line is gated; the plain line is the ritual.
  expect(ritualAdds(real("Cabal Ritual"))).toBe(3);
  expect(ritualAdds(real("Jeska's Will"))).toBe(0);
  // "Add {R}{R}, then add {R} for each card named ..." is a fixed run AND a count: derive reads two lines, and a card that counts has never been a ritual here.
  expect(ritualAdds(real("Rite of Flame"))).toBe(0);
  // A ritual NETS mana (owner's rule I4): High Tide's "an additional {U}" costs {U}, Eldrazi Confluence's Scion mode costs {2}{R}{R}{R}... -- neither gains.
  expect(ritualAdds(real("High Tide"))).toBe(0);
  expect(ritualAdds(real("Eldrazi Confluence"))).toBe(0);
  expect(ritualAdds(withTap(card("Elf", "Creature — Elf", 1, "Add {G}."), ["G"]))).toBe(0);
  // An extra cost (printed: a spell's additional cost is not on the line), a spending restriction, or a creature wearing an instant face is not a
  // free ritual.
  expect(ritualAdds(real("Culling the Weak"))).toBe(0);
  expect(ritualAdds(withLines(card("Bound", "Instant", 1, "Add {R}{R}{R}. Spend this mana only to cast instant or sorcery spells."),
    [ritualLine(["R"], 3, { restriction: { spend: "to cast instant or sorcery spells", minManaValue: null } })]))).toBe(0);
  expect(ritualAdds(withLines(card("Giant", "Creature — Giant // Instant — Adventure", 4, "Add {R}{R}{R}."), [ritualLine(["R"], 3)]))).toBe(0);
  // Two colours, one mana each: one unit of each. Two colours at three mana cannot be told apart per unit and are refused.
  expect(ritualAdds(withLines(card("Pair", "Instant", 1), [ritualLine(["R", "G"], 2)]))).toBe(2);
  expect(ritualAdds(withLines(card("Triple Pair", "Instant", 1), [ritualLine(["R", "G"], 3)]))).toBe(0);
  // A choice of colour is no fixed colour.
  expect(ritualAdds(withLines(card("Any", "Instant", 1), [ritualLine(WUBRG, 2, { anyColour: "any" })]))).toBe(0);
});

test("rituals in hand bring the commander down earlier, and leave the board's mana alone", () => {
  const withCost = (dc: DeckCard, manaCost: string): DeckCard => ({ ...dc, card: { ...dc.card, manaCost } as never });
  const ritual = (i: number) => withCost(withLines(card(`Ritual ${i}`, "Instant", 2, "Add {R}{R}{R}."), [ritualLine(["R"], 3)]), "{1}{R}");
  const inert = (i: number) => withCost(card(`Ritual ${i}`, "Instant", 2, "Draw a card."), "{1}{R}");
  const commander = withCost(card("Commander", "Legendary Creature — Otter", 5), "{3}{R}{R}");
  const mountains = Array.from({ length: 40 }, (_, i) => card(`Mountain ${i}`, "Basic Land — Mountain", 0, "", ["R"]));
  const withRituals = simulate([...mountains, ...Array.from({ length: 59 }, (_, i) => ritual(i))], { trials: 2_000, turns: 5, seed: 5, alsoPrice: [commander] });
  const without = simulate([...mountains, ...Array.from({ length: 59 }, (_, i) => inert(i))], { trials: 2_000, turns: 5, seed: 5, alsoPrice: [commander] });
  // Two lands and three rituals chain 2 -> 3 -> 4 -> 5 on turn 2.
  expect(withRituals.fastStart.get("Commander")![1]).toBeGreaterThan(0.5);
  expect(without.fastStart.get("Commander")![1]).toBe(0);
  expect(withRituals.manaAt).toEqual(without.manaAt);
});

test("the burst starts from the mana left after this turn's accelerants, not from what the board made", () => {
  // Turn 3: three lands pay for a 3-mana rock that taps for three -- six made, three left to spend.
  const rock = (i: number) => withTap(card(`Rock ${i}`, "Artifact", 3, "{T}: Add {C}{C}{C}."), ["C"], 3);
  const commander = card("Commander", "Legendary Creature — Human", 6);
  const r = simulate([...basics(40, "Mountain"), ...Array.from({ length: 59 }, (_, i) => rock(i))], { trials: 500, turns: 4, seed: 9, alsoPrice: [commander] });
  expect(r.fastStart.get("Commander")![2]).toBe(0);
  expect(r.fastStart.get("Commander")![3]).toBeGreaterThan(0.5);
});

/** NOT COLOUR-BLIND (owner 2026-10-06: "we can not be colorblind regarding rituals"). A ritual pays
 *  its own cost in colour and adds its own colour; the commander has to be payable in colour. */
test("red rituals on Mountains bring down a red commander, never a blue one", () => {
  const ritual = (i: number) => withLines({ card: { name: `Ritual ${i}`, typeLine: "Instant", oracleText: "Add {R}{R}{R}.", manaCost: "{1}{R}", keywords: [], colors: ["R"], manaValue: 2 } as never, tags: null }, [ritualLine(["R"], 3)]);
  const mountains = Array.from({ length: 40 }, (_, i) => card(`Mountain ${i}`, "Basic Land — Mountain", 0, "", ["R"]));
  const deck = [...mountains, ...Array.from({ length: 59 }, (_, i) => ritual(i))];
  const red = { card: { name: "Red", typeLine: "Legendary Creature — Human", oracleText: "", manaCost: "{3}{R}{R}", keywords: [], colors: ["R"], manaValue: 5 } as never, tags: null };
  const blue = { card: { name: "Blue", typeLine: "Legendary Creature — Otter", oracleText: "", manaCost: "{3}{U}{R}", keywords: [], colors: ["U", "R"], manaValue: 5 } as never, tags: null };
  const r = simulate(deck, { trials: 1_000, turns: 3, seed: 13, alsoPrice: [red, blue] });
  expect(r.fastStart.get("Red")![1]).toBeGreaterThan(0.5);
  expect(r.fastStart.get("Blue")![2]).toBe(0);
});

/** JESKA'S WILL (owner 2026-10-06): "Add {R} for each card in target opponent's hand" counts the
 *  opponent's hand, which the goldfish has none of. Assumed: 7 on our turns 1-2, 6 on turn 3, one
 *  fewer a turn after, never below 3 -- they draw one and play a land and a spell or so. */
test("an opponent's hand is assumed 7, 7, 6, 5, 4, then 3", () => {
  expect([1, 2, 3, 4, 5, 6, 9].map(opponentHandSize)).toEqual([7, 7, 6, 5, 4, 3, 3]);
});

test("Jeska's Will adds a red for each card in the opponent's assumed hand", () => {
  const jeska = (i: number) => real("Jeska's Will", `Will ${i}`);
  const mountains = Array.from({ length: 40 }, (_, i) => card(`Mountain ${i}`, "Basic Land — Mountain", 0, "", ["R"]));
  const commander = { card: { name: "Six", typeLine: "Legendary Creature — Human", oracleText: "", manaCost: "{4}{R}{R}", keywords: [], colors: ["R"], manaValue: 6 } as never, tags: null };
  const r = simulate([...mountains, ...Array.from({ length: 59 }, (_, i) => jeska(i))], { trials: 1_000, turns: 3, seed: 17, alsoPrice: [commander] });
  // Turn 3: three Mountains cast it for six red; three lands alone never make six.
  expect(r.fastStart.get("Six")![2]).toBeGreaterThan(0.5);
  expect(ritualAdds(jeska(0))).toBe(0);
});

/** EVERY SIMULATED GAME MULLIGANS (owner 2026-10-06: "if we do not account for mulligans we are making
 *  our goldfishing worse"). Keep 2-4 lands AND a play by turn 3 (a nonland costing 3 or less, or a
 *  commander that does); the first mulligan is free, the second goes to six, and six is kept. */
test("the keep rule: two to four lands and something to cast by turn three", () => {
  expect(keepsHand(3, 2)).toBe(true);
  expect(keepsHand(1, 2)).toBe(false);
  expect(keepsHand(5, 2)).toBe(false);
  expect(keepsHand(3, 5)).toBe(false);
  // No cheap spell, but a three-mana commander is the play.
  expect(keepsHand(3, 5, 3)).toBe(true);
  expect(keepsHand(3, Infinity, 4)).toBe(false);
});

test("a game keeps a hand a player keeps: turn one almost never goes without a land", () => {
  // 30 lands in 99: an unmulliganed seven plus a draw has no land about one game in twenty.
  const deck = [...basics(30), ...spells(69, 2)];
  const r = simulate(deck, { trials: 4_000, turns: 1, seed: 21 });
  const noLand = r.manaAt[0]!.filter((m) => m === 0).length / 4_000;
  // 4.6% without mulligans; what is left is the forced six that still drew no land.
  expect(noLand).toBeLessThan(0.01);
});

/** WHAT A KEPT HAND HAS SEEN, BY KIND (#1 after the mulligan, owner 2026-10-06). A mulligan does not
 *  change how MANY cards you have seen, it changes WHICH: a kept hand holds 2-4 lands and a cheap
 *  play, so lands and cheap spells are seen more and dear spells less. `seenShare` is the mean
 *  count of each kind seen by turn t over the kind's copies in the deck. */
test("seen shares: equal for every kind without mulligans, tilted toward lands and cheap spells with them", () => {
  const deck = [...basics(37), ...spells(31, 2), ...spells(31, 6)];
  const raw = simulate(deck, { trials: 6_000, turns: 2, seed: 23, mulligan: false });
  const kept = simulate(deck, { trials: 6_000, turns: 2, seed: 23 });
  const exact = seen(1) / 99;
  for (const k of ["land", "cheap", "dear"] as const) expect(raw.seenShare[k][0]).toBeCloseTo(exact, 2);
  expect(kept.seenShare.land[0]).toBeGreaterThan(exact);
  expect(kept.seenShare.cheap[0]).toBeGreaterThan(exact);
  expect(kept.seenShare.dear[0]).toBeLessThan(exact);
});

/** EACH GAME ATTACKS (owner 2026-10-07, item 2: the per-game spread). A trial casts the creatures it
 *  holds, cheapest first, with the mana left after its accelerants, attacks with everything (no
 *  blocks, no summoning sickness -- the expected curve's rule), and records the first turn its
 *  damage reaches 40 (one opponent) and 120 (the table, infect left out). */
describe("per-game combat kill turns", () => {
  const creature = (i: number, keywords: string[] = []): DeckCard => ({ card: { name: `Ox ${i}`, typeLine: "Creature — Ox", oracleText: "", manaCost: "{1}{R}", keywords, colors: ["R"], manaValue: 2, power: "3" } as never, tags: null });
  const mountains = Array.from({ length: 40 }, (_, i) => card(`Mountain ${i}`, "Basic Land — Mountain", 0, "", ["R"]));

  test("every game records a kill turn; one opponent never later than the table", () => {
    const r = simulate([...mountains, ...Array.from({ length: 59 }, (_, i) => creature(i))], { trials: 400, turns: 8, seed: 31, combatTo: 20 });
    expect(r.killTurns.one).toHaveLength(400);
    expect(r.killTurns.table).toHaveLength(400);
    r.killTurns.one.forEach((one, i) => expect(one).toBeLessThanOrEqual(r.killTurns.table[i]!));
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    expect(median(r.killTurns.table)).toBeLessThanOrEqual(20);
    expect(median(r.killTurns.one)).toBeLessThan(median(r.killTurns.table));
  });

  test("playing on for combat leaves every priced number exactly as it was, fetchlands and all", () => {
    const wilds = Array.from({ length: 10 }, (_, i) => real("Evolving Wilds", `Wilds ${i}`));
    const deck = [...mountains.slice(0, 30), ...wilds, ...Array.from({ length: 59 }, (_, i) => creature(i))];
    const priced = simulate(deck, { trials: 300, turns: 8, seed: 37 });
    const fought = simulate(deck, { trials: 300, turns: 8, seed: 37, combatTo: 20 });
    expect(fought.manaAt).toEqual(priced.manaAt);
    expect(fought.seenShare).toEqual(priced.seenShare);
  });

  test("a mana creature attacks too, and a commander that is both is cast and counted once", () => {
    // A 10-power commander that taps for mana: cast turn 1 as a dork, it swings 10 a turn -- 40 by turn 4.
    const dork = withTap({ card: { name: "Titan", typeLine: "Legendary Creature — Elf", oracleText: "{T}: Add {G}.", producedMana: ["G"], manaCost: "{G}", keywords: [], colors: ["G"], manaValue: 1, power: "10" } as never, tags: null }, ["G"]);
    const forests = Array.from({ length: 40 }, (_, i) => card(`Forest ${i}`, "Basic Land — Forest", 0, "", ["G"]));
    const deck = [...forests, ...Array.from({ length: 59 }, (_, i) => card(`Spell ${i}`, "Sorcery", 7, "Draw a card."))];
    const r = simulate(deck, { trials: 200, turns: 8, seed: 41, alsoPrice: [dork], combatTo: 20 });
    // Counted twice it would swing 20 and kill on turn 2; a forced landless six casts it late.
    expect(Math.min(...r.killTurns.one)).toBe(4);
    expect(r.killTurns.one.filter((t) => t === 4).length).toBeGreaterThan(180);
  });

  test("infect damage is poison, never life: an infect deck never kills the table with damage", () => {
    const r = simulate([...mountains, ...Array.from({ length: 59 }, (_, i) => creature(i, ["Infect"]))], { trials: 200, turns: 8, seed: 31, combatTo: 20 });
    expect(r.killTurns.table.every((t) => t === Infinity)).toBe(true);
  });
});

/** DRAW AND TUTORS (item 3, owner 2026-10-07). After its accelerants a game spends on draw -- a draw
 *  spell, an enters-draw creature, an upkeep engine, an activated draw, a tutor -- cheapest first,
 *  and only then on creatures. A tutor finds what the HAND needs: a land when it holds none, an
 *  accelerant while the board makes less than the commander costs, else the biggest creature the
 *  next turn can cast, and never a card its own filter refuses. */
describe("draw and tutors", () => {
  const tagged = (name: string, typeLine: string, manaCost: string, manaValue: number, abilities: unknown[], extra: { power?: string; types?: string[] } = {}): DeckCard => ({
    card: { name, typeLine, oracleText: "", manaCost, keywords: [], colors: [], manaValue, ...(extra.power ? { power: extra.power } : {}) } as never,
    tags: { abilities, characteristics: { types: extra.types ?? [typeLine.split(" ")[0]!.toLowerCase()], subtypes: [], colors: [], identity: [], cmc: manaValue, power: extra.power ?? null, toughness: null, token: false, keywords: [] } } as never,
  });
  const you = { control: "you", token: null };
  const drawTwo = (i: number) => tagged(`Divination ${i}`, "Sorcery", "{1}", 1, [{ kind: "on-cast", effect: { kind: "draw-card", subject: you }, amount: "2", repeats: "once" }]);
  const arena = (i: number) => tagged(`Arena ${i}`, "Enchantment", "{1}", 1, [{ kind: "triggered", trigger: { verbs: ["upkeep"], subject: you }, effect: { kind: "draw-card", subject: you }, amount: "1", repeats: "per-cycle" }]);
  const tutor = (i: number, type?: string) => tagged(`Tutor ${i}`, "Sorcery", "{0}", 0, [{ kind: "on-cast", effect: { kind: "search", subject: { ...you, ...(type ? { type } : {}) } }, amount: "1", repeats: "once" }]);
  const forest = (i: number) => ({ ...tagged(`Forest ${i}`, "Basic Land — Forest", "", 0, [], { types: ["basic", "land"] }), card: { name: `Forest ${i}`, typeLine: "Basic Land — Forest", oracleText: "", keywords: [], colors: [], manaValue: 0, producedMana: ["G"] } as never });
  const forests = (n: number) => Array.from({ length: n }, (_, i) => forest(i));
  const opts = { trials: 2_000, turns: 6, seed: 5, mulligan: false } as const;

  test("a draw spell shows the game more cards than one a turn", () => {
    const deck = [...forests(37), ...Array.from({ length: 62 }, (_, i) => drawTwo(i))];
    const drew = simulate(deck, opts).seenShare.land[5]!;
    const plain = simulate(untag(deck), opts).seenShare.land[5]!;
    expect(drew).toBeGreaterThan(plain + 0.05);
  });

  test("an upkeep engine draws every turn after it lands", () => {
    const deck = [...forests(37), ...Array.from({ length: 62 }, (_, i) => arena(i))];
    expect(simulate(deck, opts).seenShare.land[5]!).toBeGreaterThan(simulate(untag(deck), opts).seenShare.land[5]! + 0.05);
  });

  test("a hand with no land tutors one", () => {
    const deck = [...forests(3), ...Array.from({ length: 96 }, (_, i) => tutor(i))];
    // Landless sevens are nearly every game; the turn-1 tutor finds a land and turn 2 plays it.
    expect(pAtLeastMana(simulate(deck, opts), 1, 2)).toBeGreaterThan(0.95);
    expect(pAtLeastMana(simulate(untag(deck), opts), 1, 2)).toBeLessThan(0.3);
  });

  test("with land in hand and the commander out of reach, a tutor finds an accelerant", () => {
    const ring = withTap(tagged("Sol Ring", "Artifact", "{1}", 1, [], {}), ["C"], 2);
    const commander = tagged("Big", "Legendary Creature", "{6}", 6, [], { types: ["legendary", "creature"] });
    const deck = [...forests(40), ring, ...Array.from({ length: 58 }, (_, i) => tutor(i))];
    // Turn 1: Forest, tutor for Sol Ring, cast it off the Forest: three mana on turn 2.
    const r = simulate(deck, { ...opts, alsoPrice: [commander] });
    expect(pAtLeastMana(r, 3, 2)).toBeGreaterThan(0.9);
  });

  test("a tutor never finds what its filter refuses", () => {
    const ring = withTap(tagged("Sol Ring", "Artifact", "{1}", 1, []), ["C"], 2);
    const commander = tagged("Big", "Legendary Creature", "{6}", 6, [], { types: ["legendary", "creature"] });
    const deck = [...forests(40), ring, ...Array.from({ length: 58 }, (_, i) => tutor(i, "creature"))];
    const withTutors = simulate(deck, { ...opts, alsoPrice: [commander] });
    // A creature tutor in a deck with no creature finds nothing, so the board is the untutored one.
    expect(withTutors.manaAt).toEqual(simulate(untag(deck), { ...opts, alsoPrice: untag([commander]) }).manaAt);
  });

  test("with the mana there, a tutor finds the biggest creature the next turn can cast", () => {
    const titan = tagged("Titan", "Creature", "{1}", 1, [], { power: "40" });
    const deck = [...forests(40), titan, ...Array.from({ length: 58 }, (_, i) => tutor(i, "creature"))];
    // No commander, so nothing waits on mana: turn 1 tutors the Titan and casts it -- 40 on turn 1.
    const r = simulate(deck, { ...opts, combatTo: 20 });
    expect(r.killTurns.one.filter((t) => t <= 2).length / r.killTurns.one.length).toBeGreaterThan(0.9);
  });

  test("a deck that draws nothing and tutors nothing plays exactly as it did", () => {
    const deck = [...forests(37), ...Array.from({ length: 62 }, (_, i) => tagged(`Bear ${i}`, "Creature", "{1}{G}", 2, [], { power: "2" }))];
    const tagged_ = simulate(deck, { trials: 500, turns: 6, seed: 9 });
    const plain = simulate(untag(deck), { trials: 500, turns: 6, seed: 9 });
    expect(tagged_.manaAt).toEqual(plain.manaAt);
    expect(tagged_.byCardCastable).toEqual(plain.byCardCastable);
  });

  test("a search that puts the card into the graveyard is not a tutor", () => {
    const entomb = (i: number) => ({ ...tutor(i), card: { ...tutor(i).card, oracleText: "Search your library for a card, put that card into your graveyard, then shuffle." } as never });
    const deck = [...forests(3), ...Array.from({ length: 96 }, (_, i) => entomb(i))];
    expect(simulate(deck, opts).manaAt).toEqual(simulate(untag(deck), opts).manaAt);
  });

  test("an accelerant that draws still draws", () => {
    const prism = (i: number) => {
      const d = tagged(`Prism ${i}`, "Artifact", "{2}", 2, [{ kind: "triggered", trigger: { verbs: ["enters"], subject: { ...you, self: true } }, effect: { kind: "draw-card", subject: you }, amount: "1", repeats: "once" }]);
      return withLines({ ...d, card: { ...d.card, oracleText: "When this artifact enters, draw a card.\n{1}, {T}: Add one mana of any color." } as never },
        [tapFor(WUBRG, { cost: { ...FREE_TAP, mana: 1 }, net: 0 })]);
    };
    const deck = [...forests(37), ...Array.from({ length: 62 }, (_, i) => prism(i))];
    expect(simulate(deck, opts).seenShare.land[5]!).toBeGreaterThan(simulate(untag(deck), opts).seenShare.land[5]! + 0.02);
  });
});

// COST AGAINST PRODUCTION (owner, 2026-10-08, #1114): the simulation's slot colours are what a source FIXES, not
// everything its card can add, so it agrees with the audit and the mana base score.
test("Prismatic Lens is not a blue source in the simulation: it pays {U}{U} no better than a colourless rock", () => {
  const lens = rocks["Prismatic Lens"] as unknown as DeckCard;
  const grey = withTap(card("Grey Rock", "Artifact", 2, "{T}: Add {C}."), ["C"]);
  const island = (i: number) => card(`Island ${i}`, "Basic Land — Island", 0, "({T}: Add {U}.)", ["U"]);
  const mountain = (i: number) => card(`Mountain ${i}`, "Basic Land — Mountain", 0, "({T}: Add {R}.)", ["R"]);
  const counterspell: DeckCard = { ...card("Counterspell", "Instant", 2), card: { ...card("Counterspell", "Instant", 2).card, manaCost: "{U}{U}" } };
  const deckWith = (extra: DeckCard) => [...Array.from({ length: 4 }, (_, i) => island(i)), ...Array.from({ length: 30 }, (_, i) => mountain(i)), extra, counterspell, ...spells(30, 1)];
  const run = (d: DeckCard[]) => simulate(d, { trials: 4_000, turns: 6, seed: 5 }).byCardCastable.get("Counterspell");
  expect(run(deckWith(lens))).toEqual(run(deckWith(grey)));
});

// STATIC COLOUR FIXERS (owner, 2026-10-08, #1115): the simulation agrees with the audit -- once Chromatic Lantern is out,
// every land taps for every colour. Isolated from Lantern's own "{T}: Add one mana of any color" by a twin that has
// only that line.
test("Chromatic Lantern makes the lands blue in the simulation, beyond its own tap", () => {
  const lantern = rocks["Chromatic Lantern"] as unknown as DeckCard;
  const twin: DeckCard = { ...lantern, card: { ...lantern.card, name: "Lantern Twin", oracleText: "{T}: Add one mana of any color." } as never, tags: { ...lantern.tags, staticFixer: undefined } as never };
  const island = (i: number) => card(`Island ${i}`, "Basic Land — Island", 0, "({T}: Add {U}.)", ["U"]);
  const mountain = (i: number) => card(`Mountain ${i}`, "Basic Land — Mountain", 0, "({T}: Add {R}.)", ["R"]);
  const counterspell: DeckCard = { ...card("Counterspell", "Instant", 4), card: { ...card("Counterspell", "Instant", 4).card, manaCost: "{2}{U}{U}" } };
  const deckWith = (extra: DeckCard) => [...Array.from({ length: 4 }, (_, i) => island(i)), ...Array.from({ length: 30 }, (_, i) => mountain(i)), extra, counterspell, ...spells(30, 1)];
  const run = (d: DeckCard[]) => simulate(d, { trials: 6_000, turns: 8, seed: 5 }).byCardCastable.get("Counterspell")!;
  const withStatic = run(deckWith(lantern));
  const without = run(deckWith(twin));
  expect(withStatic[7]!).toBeGreaterThan(without[7]! + 0.01);
  // Not out before it can be cast: nothing moves on turns 1-3 (it costs three).
  for (let t = 0; t < 3; t++) expect(withStatic[t]).toBe(without[t]);
});

// A creature that is also a static fixer (Stormtide Leviathan, Dryad of the Ilysian Grove) is still a creature: it
// attacks (#1115 review). A vanilla twin with the same body is the yardstick.
test("a creature fixer is fielded and attacks like its vanilla twin", () => {
  const body = (name: string, oracleText: string): DeckCard => ({ card: { name, typeLine: "Creature — Leviathan", oracleText, manaCost: "{1}{U}", keywords: [], colors: ["U"], manaValue: 2, power: "20", toughness: "20" } as never, tags: null });
  const islands = Array.from({ length: 40 }, (_, i) => card(`Island ${i}`, "Basic Land — Island", 0, "", ["U"]));
  const deckOf = (text: string) => [...islands, ...Array.from({ length: 59 }, (_, i) => body(`Body ${i}`, text))];
  const run = (text: string) => simulate(deckOf(text), { trials: 300, turns: 8, seed: 43, combatTo: 20 }).killTurns.one;
  const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
  const twin = run("");
  const fixer = run("All lands are Islands in addition to their other types.");
  expect(med(twin)).toBeLessThan(Infinity);
  expect(med(fixer)).toBeLessThanOrEqual(med(twin));
});

/** #1151, owner ruling 2026-10-10 ("the deck's own need"): the Glance tile asks whether the player
 *  can pay for THEIR spells on time, so `need` is the on-curve mana of the cost 90% of the deck's
 *  nonlands sit at or under, and the fixed 6-by-6 `headline` is untouched. */
describe("manaModel need (#1151)", () => {
  const plains = (n: number): DeckCard[] => Array.from({ length: n }, (_, i) => card(`Plains ${i}`, "Basic Land — Plains", 0, "", ["W"]));
  const mixed = (): DeckCard[] => [
    ...plains(36),
    ...Array.from({ length: 20 }, (_, i) => card(`Two ${i}`, "Creature — Bear", 2)),
    ...Array.from({ length: 20 }, (_, i) => card(`Three ${i}`, "Creature — Bear", 3)),
    ...Array.from({ length: 3 }, (_, i) => card(`Six ${i}`, "Creature — Giant", 6)),
  ];
  test("sits at the cost 90% of the nonlands fit under, and leaves the headline alone", async () => {
    const { manaModel } = await import("./goldfish.js");
    const a = manaModel(mixed(), { trials: 300, seed: 3 }).availability; const n = a.need!;
    expect(n.mana).toBe(3);
    expect(n.turn).toBe(3);
    expect(n.share).toBeGreaterThanOrEqual(0.9);
    expect(n.low).toBeLessThanOrEqual(n.high);
    for (const v of [n.low, n.high]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    expect(a.headline).toMatchObject({ mana: 6, turn: 6 });
  });
  test("clamps to two for a deck of nothing but cheap drops", async () => {
    const { manaModel } = await import("./goldfish.js");
    const cheap = [...plains(36), ...Array.from({ length: 30 }, (_, i) => card(`Zero ${i}`, "Artifact", i % 2))];
    const a = manaModel(cheap, { trials: 200, seed: 3 }).availability; const n = a.need!;
    expect(n.mana).toBe(2);
    expect(n.turn).toBe(2);
  });
  test("clamps to the last row turn when the 90% point is beyond it", async () => {
    const { manaModel } = await import("./goldfish.js");
    const big = [...plains(36), ...Array.from({ length: 30 }, (_, i) => card(`Nine ${i}`, "Creature — Giant", 9))];
    const a = manaModel(big, { trials: 200, seed: 3 }).availability;
    expect(a.need!.mana).toBe(8);
    expect(a.rows.map((r) => r.turn)).toContain(a.need!.turn);
  });
});

// BOARD-COUNT GATES ARE TIMED TURN BY TURN (owner 2026-10-13, #1169 2b-2): "a gate like 'you control a Dragon' / metalcraft / 'four or more creatures' is met from the turn the
// deck can plausibly have it on board, not from turn one -- the goldfish times it like the lands/tron gates". The decks below are SMALL ON PURPOSE: with 8 cards or fewer every card
// is in the opening seven plus the turn-1 draw, so the game is deterministic (one land a turn, ties only between identical cards) and each turn's mana is one number.
describe("board-count gates are met turn by turn on the goldfish's own board", () => {
  const elf = (i: number): DeckCard => card(`Elf ${i}`, "Creature — Elf", 1);
  const manaPerTurn = (deck: DeckCard[], turns: number, over: Parameters<typeof simulate>[1] = {}): number[] => {
    const r = simulate(deck, { trials: 20, turns, seed: 5, mulligan: false, ...over });
    return r.manaAt.map((col) => { expect(new Set(col).size, "deterministic").toBe(1); return col[0]!; });
  };

  test("Leafkin Druid taps for one before four creatures are out and for two after (the creatures are the Elves the model 'casts' with the mana it has left, and itself)", () => {
    const druid = real("Leafkin Druid");
    const deck = [druid, elf(1), elf(2), elf(3), ...basics(4)];
    const out = manaOutput(druid, deck);
    expect(out.amount).toBe(1);
    expect(out.gated?.amount).toBe(2);
    // T1 1 land; T2 2 lands, the Druid is cast; T3 3 lands and a Druid that is not yet two (one Elf and itself); T4 four creatures: 4 lands + 2
    expect(manaPerTurn(deck, 5)).toEqual([1, 2, 4, 6, 6]);
  });

  test("a board gate is priced per game, not by the deck's median-clock verdict: one Dragon in 100 cards leaves Mox Jasper a blank in the games with no Dragon out and a rock in the games where it is (#1191, Fable finding 8)", () => {
    const jasper = real("Mox Jasper");
    const lone = (typeLine: string): DeckCard[] => [jasper, card("Lone Dragon", typeLine, 1), ...basics(98)];
    expect(gateVerdict(jasper.tags!.manaLines![0]!.gate!, lone("Creature \u2014 Dragon")), "the deck-level verdict is unmet").toBe("unmet");
    // the report-side classification (the audit's bar) still says no; the simulation asks per game and keeps the card
    expect(classifyAccelerant(jasper, lone("Creature \u2014 Dragon"))).toBeNull();
    expect(classifyAccelerant(jasper, lone("Creature \u2014 Dragon"), true)).not.toBeNull();
    expect(classifyAccelerant(jasper, [jasper, ...basics(99)], true), "no Dragon in the deck: no game can meet the gate").toBeNull();
    const run = (typeLine: string): number[][] => simulate(lone(typeLine), { trials: 300, turns: 10, seed: 11, mulligan: false }).manaAt;
    const withDragon = run("Creature \u2014 Dragon"), control = run("Creature \u2014 Elf");
    let more = 0, same = 0;
    for (let t = 0; t < withDragon.length; t++) for (let i = 0; i < withDragon[t]!.length; i++) {
      const d = withDragon[t]![i]! - control[t]![i]!;
      expect(d, `turn ${t + 1} trial ${i}`).toBeGreaterThanOrEqual(0);
      if (d > 0) more++; else same++;
    }
    expect(more, "the games where the Dragon is out play the Jasper").toBeGreaterThan(0);
    expect(same, "the games with no Dragon out do not").toBeGreaterThan(0);
  });

  test("a power gate (Fanatic of Rhonas) turns on once a creature of power 4 is out, and stays off beside creatures of power 2 or a '*' (#1191)", () => {
    const withPower = (name: string, power: string): DeckCard => ({ ...card(name, "Creature \u2014 Giant", 2), card: { ...card(name, "Creature \u2014 Giant", 2).card, power } });
    const dork = withManaLines("Power Dork", "Creature \u2014 Elf", [tapFor(["G"], { gate: parseGate("you control a creature with power 4 or greater") })]);
    const mana = (power: string): number[] => manaPerTurn([dork, withPower("Giant", power), ...basics(6)], 6);
    const off = mana("2");
    expect(off).toEqual([1, 2, 3, 4, 5, 6]);
    expect(mana("*")).toEqual(off);
    const on = mana("4");
    expect(on.slice(0, 2)).toEqual(off.slice(0, 2));
    expect(on[5]).toBeGreaterThan(off[5]!);
  });

  test("a basic-land gate (Gleaming Bastion) makes its colour once a BASIC is out, and never beside non-basic lands (#1191)", () => {
    const bastion = withLines(card("Basic Gated Land", "Land", 0), [tapFor(["C"]), tapFor(["W"], { gate: parseGate("this land entered this turn or if you control a basic land") })]);
    const white: DeckCard = { ...card("White Spell", "Sorcery", 1), card: { ...card("White Spell", "Sorcery", 1).card, manaCost: "{W}" } };
    const castable = (lands: DeckCard[]): number[] => simulate([bastion, ...lands, white], { trials: 20, turns: 4, seed: 5, mulligan: false }).byCardCastable.get("White Spell")!;
    expect(castable(basics(3))[3]).toBe(1);
    expect(castable(Array.from({ length: 3 }, (_, i) => card(`Utility ${i}`, "Land")))).toEqual([0, 0, 0, 0]);
  });

  test("Mox Jasper makes nothing until a Dragon is on the board, then one mana of any colour: a Dragon the mana could pay for on turn 2 helps from turn 3", () => {
    const jasper = real("Mox Jasper");
    const dragon = card("Dragon", "Creature — Dragon", 2);
    expect(manaPerTurn([jasper, dragon, ...basics(6)], 4)).toEqual([1, 2, 4, 5]);
    // a Dragon the mana cannot pay for until turn 6 helps from turn 7, and not before
    expect(manaPerTurn([jasper, card("Big Dragon", "Creature — Dragon", 6), ...basics(6)], 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  test("the commander counts toward a gate: a Dragon commander makes Mox Jasper a rock once it could be cast, and the deck without it has no rock at all", () => {
    const jasper = real("Mox Jasper");
    const deck = [jasper, ...basics(6)];
    const commander = card("Dragon Commander", "Legendary Creature — Dragon", 2);
    expect(classifyAccelerant(jasper, deck)).toBeNull();
    expect(manaPerTurn(deck, 3)).toEqual([1, 2, 3]);
    expect(manaPerTurn(deck, 3, { alsoPrice: [commander] })).toEqual([1, 2, 4]);
  });

  test("a land's gated colours wait on the board too: Spire of Industry makes a colour only with an artifact out, the turn after the model could cast one", () => {
    const spire = real("Spire of Industry");
    const trinket = card("Trinket", "Artifact", 0);
    const bolt: DeckCard = { ...card("Red Spell", "Sorcery", 1), card: { ...card("Red Spell", "Sorcery", 1).card, manaCost: "{R}" } };
    const r = simulate([spire, trinket, bolt], { trials: 20, turns: 3, seed: 5, mulligan: false });
    const castable = r.byCardCastable.get("Red Spell")!;
    // turn 1: the only land taps for {C}; the Trinket is 'cast' at its end and is out from turn 2
    expect(castable.slice(0, 3)).toEqual([0, 1, 1]);
  });

  test("the land policy plays the land that makes the colour NOW: a Verge whose green waits on a Forest is not the green land beside a Forest", () => {
    const verge = real("Thornspire Verge");
    const green: DeckCard = { ...card("Green Spell", "Sorcery", 1), card: { ...card("Green Spell", "Sorcery", 1).card, manaCost: "{G}" } };
    const r = simulate([verge, card("Forest", "Basic Land \u2014 Forest"), green], { trials: 60, turns: 2, seed: 9, mulligan: false });
    // turn 1: the Forest, in every game, whatever order the hand is dealt in
    expect(r.byCardCastable.get("Green Spell")![0]).toBe(1);
  });

  test("the availability the report prints counts the commander's Dragon toward Mox Jasper's gate (manaModel hands the gate the whole decklist)", async () => {
    const { manaModel } = await import("./goldfish.js");
    const jasper = real("Mox Jasper");
    const commander = card("Dragon Commander", "Legendary Creature \u2014 Dragon", 2);
    expect(manaModel([jasper, ...basics(6)], { trials: 10, turns: 3, alsoPrice: [commander] }).availability.accelerants).toBe(1);
    expect(manaModel([jasper, ...basics(6)], { trials: 10, turns: 3 }).availability.accelerants).toBe(0);
  });

  test("a commander whose own mana waits on a Dragon plays once the library's Dragon is out, in its colour (the priced extras are judged against the whole decklist too)", () => {
    const commander = withManaLines("Dragon Elf", "Legendary Creature \u2014 Elf", [tapFor(["G"], { gate: parseGate("you control a dragon") })]);
    const withCmd = { ...commander, card: { ...commander.card, manaValue: 2 } };
    const islands = Array.from({ length: 5 }, (_, i) => card(`Island ${i}`, "Basic Land \u2014 Island"));
    const green: DeckCard = { ...card("Green Spell", "Sorcery", 1), card: { ...card("Green Spell", "Sorcery", 1).card, manaCost: "{G}" } };
    const deck = [card("Small Dragon", "Creature \u2014 Dragon", 3), ...islands, green];
    // cast on turn 2, a dork taps from turn 3; the Dragon the leftover mana pays for on turn 3 is out from turn 4, and only then does the commander make its {G}
    expect(manaPerTurn(deck, 4, { alsoPrice: [withCmd] })).toEqual([1, 2, 3, 5]);
    const r = simulate(deck, { trials: 20, turns: 4, seed: 5, mulligan: false, alsoPrice: [withCmd] });
    expect(r.byCardCastable.get("Green Spell")).toEqual([0, 0, 0, 1]);
  });

  test("an unmet board gate stays a blank, and a deck whose cards cannot meet it does not get the line (Mox Jasper beside no Dragon)", () => {
    const jasper = real("Mox Jasper");
    expect(manaPerTurn([jasper, ...basics(7)], 4)).toEqual([1, 2, 3, 4]);
  });

  test("a walker's gated loyalty line is priced against the deck, its turns included (manaOutput's loyalty branch is handed the deck)", () => {
    const line = mkLine({ gate: parseGate("you control a dragon"), cost: { ...FREE_TAP, tap: false, loyalty: -1 }, startLoyalty: 3, colours: ["R"], amount: { fixed: 2, scales: null }, net: 2 });
    const walker = withManaLines("Gated Walker", "Legendary Planeswalker — Test", [line]);
    const deck = deckOfDragons([walker]);
    expect(manaOutput(walker, deck).turns).toBe(3);
    expect(manaOutput(walker, deck).gated?.amount).toBe(2);
  });
});
