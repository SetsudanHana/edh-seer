import { expect, test } from "vitest";
import type { Card } from "@mtg/engine";
import { seen } from "@mtg/engine";
import { computeDeckMath, CORPUS_MEDIAN_CLOCK } from "./deck-math.js";
import { computeBuild } from "./build.js";
import type { LandRecommendation } from "./land-count.js";
import type { DeckCard, Hierarchy } from "./types.js";

const H: Hierarchy = {};

const beater = (name: string, power: string, mv: number): DeckCard => ({
  card: { name, typeLine: "Creature — Human", oracleText: "", keywords: [], colors: [], manaValue: mv, power } as Card,
  tags: null,
});

const spell = (name: string): DeckCard => ({
  card: { name, typeLine: "Instant", oracleText: "", keywords: [], colors: [], manaValue: 3 } as Card,
  tags: null,
});

const fillTo = (n: number, deck: DeckCard[]) =>
  [...deck, ...Array.from({ length: n - deck.length }, (_, i) => spell(`filler-${i}`))];

const answer = (name: string, oracleText: string, typeLine = "Instant"): DeckCard => ({
  card: { name, typeLine, oracleText, keywords: [], colors: [], manaValue: 3 } as Card,
  tags: null,
});

/** The payoff design §12.8 promised for the clock: every target turn in this layer was a Tier C
 *  guess, and a fixed turn 5 applied to every deck alike. */
test("the deck's own clock sets the turn everything is priced against", () => {
  const fast = fillTo(100, Array.from({ length: 40 }, (_, i) => beater(`Bear-${i}`, "5", 1)));
  const slow = fillTo(100, Array.from({ length: 30 }, (_, i) => beater(`Ogre-${i}`, "3", 5)));

  const fastMath = computeDeckMath(fast, H);
  const slowMath = computeDeckMath(slow, H);
  expect(fastMath.turnSource).toBe("clock");
  expect(fastMath.turn).toBe(fastMath.clock.turn);
  expect(fastMath.turn).toBeLessThan(slowMath.turn);
  // `seen` follows the turn, so the whole readout moves together rather than one number drifting.
  expect(fastMath.seen).toBe(seen(fastMath.turn));
});

test("a deck with no combat clock is priced at the measured corpus median, not at nothing", () => {
  const math = computeDeckMath(fillTo(100, []), H);
  expect(math.clock.turn).toBeUndefined();
  expect(math.turn).toBe(CORPUS_MEDIAN_CLOCK);
  expect(math.turnSource).toBe("corpus-median");
});

test("an explicit turn still wins, and says that is what happened", () => {
  const deck = fillTo(100, Array.from({ length: 40 }, (_, i) => beater(`Bear-${i}`, "5", 1)));
  const math = computeDeckMath(deck, H, [], 5);
  expect(math.turn).toBe(5);
  expect(math.turnSource).toBe("override");
});

/** Step C: the doctrine states a CONFIDENCE, and the maths derives the count. The alternative --
 *  "run 3 enchantment removal" -- is the fixed template this layer exists to replace. */
test("required is the count that reaches the threshold, and it moves with the turn", () => {
  const early = computeDeckMath(fillTo(100, []), H, [], 3);
  const late = computeDeckMath(fillTo(100, []), H, [], 11);
  const req = (m: ReturnType<typeof computeDeckMath>) =>
    m.answers.find((a) => a.class === "artifact")!.required;
  // A longer horizon sees more cards, so fewer copies reach the same confidence. This is the
  // property that makes it a derived number rather than a template: it is not one target for all
  // decks, it is the deck's own clock inverted.
  expect(req(early)).toBeGreaterThan(req(late));
  expect(req(late)).toBeGreaterThan(0);
});

test("required is the same for every class -- the doctrine sets confidence, not per-class counts", () => {
  // Deliberately NOT "creature removal needs more than land removal". The classes differ in what a
  // deck HAS, never in what the maths demands; a per-class target would smuggle the template back in.
  const math = computeDeckMath(fillTo(100, []), H, [], 9);
  const required = math.answers.map((a) => a.required);
  expect(new Set(required).size).toBe(1);
});

test("a class answered from the command zone needs nothing drawn", () => {
  // It is available in every game, so a shortfall against a draw-probability target is meaningless.
  const commander: DeckCard = {
    card: {
      name: "Vindicator", typeLine: "Legendary Creature — Human", manaValue: 4, keywords: [], colors: [],
      oracleText: "Destroy target artifact.",
    } as Card,
    tags: null,
  };
  const math = computeDeckMath(fillTo(100, [commander]), H, ["Vindicator"], 9);
  const artifact = math.answers.find((a) => a.class === "artifact")!;
  expect(artifact.fromCommandZone).toBe(true);
  expect(artifact.available).toBe(1);
  expect(artifact.required).toBe(0);
});

/** A longer horizon sees more cards, so the same deck reads as more available. That is the whole
 *  point -- and the reason the turn has to be visible next to the numbers it moves. */
test("pricing later raises availability for the same cards", () => {
  const deck = fillTo(100, [
    ...Array.from({ length: 4 }, (_, i) => ({
      card: {
        name: `Naturalize-${i}`, typeLine: "Instant", manaValue: 2, keywords: [], colors: [],
        oracleText: "Destroy target artifact or enchantment.",
      } as Card,
      tags: null,
    })),
  ]);
  const early = computeDeckMath(deck, H, [], 3);
  const late = computeDeckMath(deck, H, [], 9);
  const artifact = (m: ReturnType<typeof computeDeckMath>) =>
    m.answers.find((a) => a.class === "artifact")!.available;
  expect(artifact(late)).toBeGreaterThan(artifact(early));
});

test("an answer row says how many of its answers exile, and how many recur", () => {
  const deck = fillTo(100, [
    answer("Swords to Plowshares", "Exile target creature. Its controller gains life equal to its power."),
    answer("Murder", "Destroy target creature."),
    answer("Bojuka Bog", "This land enters tapped.\nWhen this land enters, exile target player's graveyard.\n{T}: Add {B}.", "Land"),
    answer("Rest in Peace", "When this enchantment enters, exile all graveyards.\nIf a card or token would be put into a graveyard from anywhere, exile it instead.", "Enchantment"),
  ]);
  const dm = computeDeckMath(deck, H);
  const creature = dm.answers.find((a) => a.class === "creature")!;
  expect(creature.count).toBe(2);
  expect(creature.exiling).toBe(1);
  expect(creature.recurring).toBe(0);

  const graveyard = dm.answers.find((a) => a.class === "graveyard")!;
  expect(graveyard.count).toBe(2);
  expect(graveyard.recurring).toBe(1);

  // The modes are MEASURED, not scored (design §2.3): the two numbers that drive the panel's
  // shortfall and its bar must be untouched by this step.
  expect(creature.required).toBeGreaterThan(0);
  expect(creature.available).toBeGreaterThan(0);
});

/** Fix F1 (task 9, controller review 2026-08-21): a landfall deck's `computeDeckMath` panel row and
 *  `computeBuild`'s score both apply `ARCHETYPE_TARGET_DELTAS.landfall`'s `lands: +4` on top of the
 *  identical gated Karsten target, so they can never again print two different numbers for "what
 *  this deck wants". This is the exact `rakdos-landfall` shape the review measured live: gated
 *  target 39, score's scored target 43 -- before the fix the panel stayed at 39. */
test("a landfall deck's panel target and scored target agree, including the archetype delta", () => {
  const deck = fillTo(100, []);
  const rec: LandRecommendation = {
    avgManaValue: 3.2, rampPlusDraw: 0, fastMana: 0, commanders: 1,
    mdfcUntapped: 0, mdfcTapped: 0, actual: 39, target: 39, // inside [28, 39]: the gate reads 'derived'
  };

  const scoredTarget = computeBuild(deck, "landfall", rec.target)
    .buildCategories.find((c) => c.category === "lands")!.target;
  const dm = computeDeckMath(deck, H, [], undefined, { landRecommendation: rec, primary: "landfall" });

  expect(dm.lands.targetSource).toBe("derived");
  expect(dm.lands.archetypeDelta).toBe(4);
  expect(dm.lands.archetypeLabel).toBe("Landfall");
  expect(dm.lands.target).toBe(scoredTarget); // 43 === 43 -- THE divergence this task closes
  expect(dm.lands.target).toBe(43);

  // Omitting `primary` (every pre-task-9 caller, and every other archetype) must not invent a
  // delta out of nowhere.
  const noPrimary = computeDeckMath(deck, H, [], undefined, { landRecommendation: rec });
  expect(noPrimary.lands.archetypeDelta).toBe(0);
  expect(noPrimary.lands.archetypeLabel).toBeUndefined();
  expect(noPrimary.lands.target).toBe(39);
});
