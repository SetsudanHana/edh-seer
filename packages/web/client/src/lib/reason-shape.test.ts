import { expect, test } from "vitest";
import { distinctiveReason, reasonShapes, reasonTemplate } from "./reason-shape.js";
import type { DeckReport } from "../types.js";

type Card = DeckReport["cards"][number];

const card = (name: string, reasons: { tag?: string; text: string }[]): Card =>
  ({ name, topPartners: [{ name: "Partner", score: 1, reasons }] }) as never;

const wizard = (name: string): Card =>
  card(name, [{ text: `${name} triggers on a wizard entering; Inalla supplies it` }]);

test("a template is the sentence without its card names", () => {
  const names = new Set(["Inalla", "Kindred Discovery"]);
  expect(reasonTemplate("Kindred Discovery triggers on a wizard entering; Inalla supplies it", names))
    .toBe("· triggers on a wizard entering; · supplies it");
});

// LONGEST FIRST, or a name that CONTAINS another leaves half of itself behind — this deck really
// runs "Kefka, Court Mage // Kefka, Ruler of Ruin".
test("a longer name is replaced before the shorter name inside it", () => {
  const names = new Set(["Kefka, Court Mage", "Kefka, Court Mage // Kefka, Ruler of Ruin"]);
  expect(reasonTemplate("Kefka, Court Mage // Kefka, Ruler of Ruin draws", names)).toBe("· draws");
});

// MEASURED on the review deck: 94 rows, 12 distinct templates, the top one covering 25.
test("a template most rows share is reported once, with an example", () => {
  const cards = [...Array(6)].map((_, i) => wizard(`Wiz ${i}`));
  cards.push(card("Odd One Out", [{ text: "Odd One Out can fetch Sol Ring" }]));
  const shapes = reasonShapes(cards);
  expect(shapes.distinct).toBe(2);
  expect(shapes.shared).toHaveLength(1);
  expect(shapes.shared[0]!.count).toBe(6);
  expect(shapes.shared[0]!.sample).toBe("Wiz 0 triggers on a wizard entering; Inalla supplies it");
});

// BELOW THE FLOOR NOTHING FOLDS: a small deck saying the same thing three times is not a stuck
// record, and folding there would hide the only sentences it has.
test("a handful of repeats is left alone", () => {
  expect(reasonShapes([...Array(3)].map((_, i) => wizard(`Wiz ${i}`))).shared).toEqual([]);
});

test("a row whose only story is the shared one says nothing further", () => {
  const cards = [...Array(6)].map((_, i) => wizard(`Wiz ${i}`));
  const names = new Set(cards.map((c) => c.name));
  const { shared } = reasonShapes(cards);
  expect(shared).toHaveLength(1);
  expect(distinctiveReason(cards[0]!, shared, names)).toBeUndefined();
});

test("a row with something else to say keeps that sentence", () => {
  const cards = [...Array(6)].map((_, i) => wizard(`Wiz ${i}`));
  const mixed = card("Both", [
    { text: "Both triggers on a wizard entering; Inalla supplies it" },
    { text: "Both returns a creature from your graveyard" },
  ]);
  cards.push(mixed);
  const names = new Set(cards.map((c) => c.name));
  const { shared } = reasonShapes(cards);
  expect(distinctiveReason(mixed, shared, names)).toBe("Both returns a creature from your graveyard");
});

// A TABLE CAN BE A STUCK RECORD IN MORE THAN ONE VOICE. The review deck's second-commonest sentence
// covered 16 of 94 rows and 7 of the 12 visible ones, so folding only the top template left the
// screen looking barely changed.
test("two shared mechanisms are both folded, biggest first", () => {
  const cards = [
    ...[...Array(6)].map((_, i) => wizard(`Wiz ${i}`)),
    ...[...Array(5)].map((_, i) => card(`Etb ${i}`, [{ text: `Etb ${i} triggers on its own entry; Inalla copies it` }])),
    card("Odd One Out", [{ text: "Odd One Out can fetch Sol Ring" }]),
  ];
  const { shared } = reasonShapes(cards);
  expect(shared.map((s) => s.count)).toEqual([6, 5]);
  const names = new Set(cards.map((c) => c.name));
  expect(distinctiveReason(cards[7]!, shared, names)).toBeUndefined(); // an Etb row folds too
  expect(distinctiveReason(cards[11]!, shared, names)).toBe("Odd One Out can fetch Sol Ring");
});
