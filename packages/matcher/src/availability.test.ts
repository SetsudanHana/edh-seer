import { expect, test } from "vitest";
import type { CardTags } from "@edh-seer/tagger";
import type { Card } from "@edh-seer/engine";
import { pAtLeast, seen } from "@edh-seer/engine";
import type { DeckCard, Hierarchy } from "./types.js";
import { deckAvailability } from "./availability.js";

const H: Hierarchy = { wizard: ["creature"], zombie: ["creature"] };

const tags = (id: string, abilities: CardTags["abilities"]): CardTags => ({
  oracleId: id, schemaVersion: 1, promptVersion: 1, model: "t",
  characteristics: {
    types: ["creature"], subtypes: [], colors: [], identity: [], cmc: 0,
    power: null, toughness: null, token: false, keywords: [],
  },
  abilities,
});

const deckCard = (name: string, abilities: CardTags["abilities"]): DeckCard => ({
  card: { name } as Card,
  tags: tags(name, abilities),
});

/** Listens for a creature dying -- a sac payoff. */
const payoff = (name: string) => deckCard(name, [{
  kind: "triggered",
  trigger: { verbs: ["dies"], subject: { type: "creature", control: "you", token: null } },
  effect: { kind: "lifegain" },
}]);

/** Emits a creature dying -- a sac outlet. */
const outlet = (name: string) => deckCard(name, [{
  kind: "activated",
  effect: { kind: "sacrifice", subject: { type: "creature", control: "you", token: null } },
  emits: [{ verb: "dies", subject: { type: "creature", control: "you", token: null } }],
}]);

/** A card with no trigger and no emit: it exists only to make the library the right size. */
const filler = (name: string) => deckCard(name, []);

const deckOf = (...parts: DeckCard[][]) => parts.flat();
const fillTo = (n: number, deck: DeckCard[]) =>
  [...deck, ...Array.from({ length: n - deck.length }, (_, i) => filler(`filler-${i}`))];

const find = (rows: ReturnType<typeof deckAvailability>, key: string) => rows.find((r) => r.key === key)!;

/** The user's framing, and the whole reason this exists: "20 cards that care about creatures dying
 *  but only 4 sac outlets, the deck dynamics are scuffed". The spec's answer is that the ratio is
 *  the wrong instrument -- what is wrong is that you rarely DRAW an outlet. */
test("counts demand and supply for one shape, and prices supply by when you draw it", () => {
  const deck = fillTo(100, deckOf(
    Array.from({ length: 20 }, (_, i) => payoff(`payoff-${i}`)),
    Array.from({ length: 4 }, (_, i) => outlet(`outlet-${i}`)),
  ));
  const rows = deckAvailability(deck, H, { turn: 5 });
  const dies = find(rows, "dies:type:creature");

  expect(dies.consumers).toBe(20);
  expect(dies.suppliers).toBe(4);
  // 100-card deck, no commander named, so all 100 are library; 12 cards seen by turn 5.
  //
  // 40.9%, NOT the 28% the stub quoted twice for this exact case -- 28% is seen(1), four outlets
  // by turn ONE. Found by this test, corrected in the stub. It cuts against that section's own
  // argument, which is why it is pinned here.
  expect(Math.round(dies.available! * 1000) / 10).toBe(40.5);
  expect(dies.available).toBeCloseTo(pAtLeast(1, 4, seen(5), 100), 12);
});

test("the library excludes the commander, because it was never in it", () => {
  const deck = fillTo(100, deckOf([payoff("payoff")], [outlet("outlet")]));
  const withCommander = deckAvailability(deck, H, { turn: 5, commanderNames: ["filler-0"] });
  const without = deckAvailability(deck, H, { turn: 5 });
  // One fewer card to hide the outlet among: availability goes UP, and by the exact amount a
  // 99-card library gives against the 100-card one.
  expect(find(withCommander, "dies:type:creature").available)
    .toBeCloseTo(pAtLeast(1, 1, seen(5), 99), 12);
  expect(find(without, "dies:type:creature").available)
    .toBeCloseTo(pAtLeast(1, 1, seen(5), 100), 12);
  expect(find(withCommander, "dies:type:creature").available!)
    .toBeGreaterThan(find(without, "dies:type:creature").available!);
});

/** Stub §10.1: the commander is the only card with P = 1, and if the sac outlet IS the commander
 *  then "4 outlets at 28%" is not a small error, it is the wrong answer. */
test("a supplier in the command zone is always available", () => {
  const deck = fillTo(100, deckOf(
    Array.from({ length: 20 }, (_, i) => payoff(`payoff-${i}`)),
    [outlet("Prossh")],
  ));
  const rows = deckAvailability(deck, H, { turn: 5, commanderNames: ["Prossh"] });
  const dies = find(rows, "dies:type:creature");

  expect(dies.available).toBe(1);
  expect(dies.fromCommandZone).toBe(true);
  // The count still reads 1 -- the commander is a supplier, it just is not a DRAWN one.
  expect(dies.suppliers).toBe(1);
  expect(dies.librarySuppliers).toBe(0);
});

test("a shape nothing supplies reads zero, not undefined", () => {
  const deck = fillTo(100, [payoff("payoff")]);
  const dies = find(deckAvailability(deck, H, { turn: 5 }), "dies:type:creature");
  expect(dies.consumers).toBe(1);
  expect(dies.suppliers).toBe(0);
  expect(dies.available).toBe(0);
});

/** `combatSelfSupplied`: the GAME supplies "whenever a creature attacks", so asking which card you
 *  need to draw is the wrong question. Reporting 0% there would invent a hole the deck does not
 *  have -- the same mistake the corpus census has a whole marked key to avoid. */
test("a self-supplied trigger reports no probability at all, rather than a misleading one", () => {
  const attacker = deckCard("attacker", [{
    kind: "triggered",
    trigger: { verbs: ["attacks"], subject: { control: "any", token: null } },
    effect: { kind: "draw-card" },
  }]);
  const rows = deckAvailability(fillTo(100, [attacker]), H, { turn: 5 });
  const row = rows.find((r) => r.key.startsWith("attacks"))!;
  expect(row.selfSupplied).toBe(true);
  expect(row.available).toBeNull();
});

/** Found on the running app: three Inalla cards want `end-step:any` against zero suppliers, which
 *  read as 0% -- "your deck cannot reach its own end step". No card ever emits a phase, as the
 *  tagger's vocabulary note says, so the turn structure supplies it exactly as the game supplies
 *  combat. */
test("a phase trigger reports no probability -- the turn supplies it, not a card", () => {
  const endStep = deckCard("end-step-payoff", [{
    kind: "triggered",
    trigger: { verbs: ["end-step"], subject: { control: "you", token: null } },
    effect: { kind: "draw-card" },
  }]);
  const rows = deckAvailability(fillTo(100, [endStep]), H, { turn: 5 });
  const row = rows.find((r) => r.key.startsWith("end-step"))!;
  expect(row.consumers).toBe(1);
  expect(row.suppliers).toBe(0);
  expect(row.selfSupplied).toBe(true);
  expect(row.available).toBeNull();
});

test("availability rises with the turn, because you have seen more cards", () => {
  const deck = fillTo(100, deckOf(
    [payoff("payoff")],
    Array.from({ length: 4 }, (_, i) => outlet(`outlet-${i}`)),
  ));
  const byTurn = [2, 5, 9].map(
    (turn) => find(deckAvailability(deck, H, { turn }), "dies:type:creature").available!,
  );
  expect([...byTurn].sort((a, b) => a - b)).toEqual(byTurn);
});

/** The census's own chief trap, inherited: `dies:creature` and `dies:vampire` are different
 *  demands. Rolling up on the first type merged 16 consumer shapes into one row upstream, and a
 *  deck-scoped version that did the same would report a vampire deck as having supply it lacks. */
test("different demands stay different rows", () => {
  const vampirePayoff = deckCard("vampire-payoff", [{
    kind: "triggered",
    trigger: { verbs: ["dies"], subject: { subtype: "vampire", control: "you", token: null } },
    effect: { kind: "lifegain" },
  }]);
  const deck = fillTo(100, deckOf([payoff("payoff"), vampirePayoff], [outlet("outlet")]));
  const rows = deckAvailability(deck, H, { turn: 5 });

  expect(find(rows, "dies:type:creature").consumers).toBe(1);
  expect(find(rows, "dies:subtype:vampire").consumers).toBe(1);
  // The generic outlet cannot promise a VAMPIRE dies, so that demand is unsupplied.
  expect(find(rows, "dies:subtype:vampire").suppliers).toBe(0);
});

test("rows come back with the biggest demand first", () => {
  const deck = fillTo(100, deckOf(
    Array.from({ length: 3 }, (_, i) => payoff(`payoff-${i}`)),
    [deckCard("etb-payoff", [{
      kind: "triggered",
      trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } },
      effect: { kind: "draw-card" },
    }])],
    [outlet("outlet")],
  ));
  const rows = deckAvailability(deck, H, { turn: 5 });
  expect(rows[0].key).toBe("dies:type:creature");
  expect(rows.map((r) => r.consumers)).toEqual([...rows.map((r) => r.consumers)].sort((a, b) => b - a));
});

test("an empty deck produces no rows rather than dividing by zero", () => {
  expect(deckAvailability([], H, { turn: 5 })).toEqual([]);
});

/** THE FALSE ALARM THE 2026-08-27 PERSONA RUN CAUGHT, pinned.
 *
 *  "a creature entering the battlefield — 4 want · 0 supply" printed over a deck the tool's own
 *  graph counts as 51 creatures. Every one of those four consumers was a SELF trigger, so 0 was the
 *  number of external suppliers such a trigger needs — a correct count under a sentence that made
 *  it read as a hole. A self trigger fires when you play the card; there is no card to draw. */
test("a self trigger is self-supplied, not an unmet demand", () => {
  const selfEtb = deckCard("Dire Fleet Ravager", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null, self: true } },
    effect: { kind: "damage" },
  }]);
  const row = deckAvailability([selfEtb], H).find((r) => r.key.startsWith("enters"));
  expect(row).toBeDefined();
  expect(row!.selfSupplied).toBe(true);
  // A refusal, never a probability: there is nothing to draw, so there is no chance to quote.
  expect(row!.available).toBeNull();
});

test("a trigger watching OTHER cards is still a real demand", () => {
  const classEtb = deckCard("Impact Tremors", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "damage" },
  }]);
  const row = deckAvailability([classEtb], H).find((r) => r.key.startsWith("enters"));
  expect(row!.selfSupplied).toBe(false);
});
