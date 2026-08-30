import { expect, test } from "vitest";
import { EXAMPLE_DECK } from "./example-deck.js";

/** THE EXAMPLE HAS TO BE A COMMANDER DECK, and it was not: the hand-written Krenko list shipped 50
 *  cards, so the first thing a first-time reader saw was the report's own top finding — "50 cards,
 *  and a Commander deck is exactly 100". The tool was right and the demo was wrong, which is the
 *  worst way round.
 *
 *  These count what the FORMAT requires rather than what the current list happens to contain, so
 *  swapping the example for another deck is free and shrinking it is not. */
const quantities = (block: string): { name: string; n: number }[] =>
  block.split("\n").filter((l) => l.trim() !== "").map((line) => {
    const m = /^(\d+)\s+(.*)$/.exec(line.trim());
    expect(m, `every line carries a quantity: ${JSON.stringify(line)}`).not.toBeNull();
    return { name: m![2], n: Number(m![1]) };
  });

test("the example is exactly 100 cards, commander included", () => {
  const commanders = quantities(EXAMPLE_DECK.commanders);
  const deck = quantities(EXAMPLE_DECK.decklist);
  const total = [...commanders, ...deck].reduce((n, c) => n + c.n, 0);
  expect(total).toBe(100);
});

test("the example names exactly one commander", () => {
  const commanders = quantities(EXAMPLE_DECK.commanders);
  expect(commanders).toHaveLength(1);
  expect(commanders[0].n).toBe(1);
});

/** THE DEFECT THIS ONE ALREADY CAUGHT ONCE, recorded in the old example's own comment: repeating
 *  the commander in the decklist made the deck 51 slots with Krenko twice, which the legality panel
 *  correctly reported as a duplicate nonbasic. */
test("the commander is not repeated in the decklist", () => {
  const commander = quantities(EXAMPLE_DECK.commanders)[0].name;
  const names = quantities(EXAMPLE_DECK.decklist).map((c) => c.name);
  expect(names).not.toContain(commander);
});

/** Singleton, minus the basics — the one legality rule a hand-edited list is most likely to break,
 *  and one the engine would otherwise report on its own demo. */
test("no nonbasic card appears more than once", () => {
  const BASICS = new Set(["Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes"]);
  const offenders = quantities(EXAMPLE_DECK.decklist)
    .filter((c) => c.n > 1 && !BASICS.has(c.name))
    .map((c) => `${c.n}x ${c.name}`);
  expect(offenders).toEqual([]);
});
