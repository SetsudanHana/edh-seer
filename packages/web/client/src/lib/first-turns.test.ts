import { expect, test } from "vitest";
import type { DeckReport } from "../types.js";
import { firstTurns } from "./first-turns.js";

const row = (turn: number, p25: number, median: number, p75: number) =>
  ({ turn, mana: { p25, median, p75 }, payableShare: { p25: 0, median: 0, p75: 0 } });
const rows = [row(1, 1, 1, 1), row(2, 2, 2, 3), row(3, 2, 3.5, 4), row(4, 3, 4, 5), row(5, 4, 5, 6), row(6, 5, 6, 7)];

type C = { name: string; manaValue?: number; roles?: string[]; isCommander?: boolean; face?: number; cardName?: string };
function deck(cards: C[], plan: string[] = []): DeckReport {
  return {
    cards: cards.map((c) => ({ isCommander: false, ...c })),
    manaAvailability: { trials: 2000, accelerants: 5, rows, headline: { mana: 5, turn: 5, low: 0.4, high: 0.6 } },
    deckMath: { wincons: { classes: [{ class: "go-wide", count: plan.length, share: 1, cards: plan }], focus: 1 } },
  } as unknown as DeckReport;
}

test("each turn lists the cards that first fit its typical mana, by job, and counts what is castable", () => {
  const t = firstTurns(deck([
    { name: "Sol Ring", manaValue: 1, roles: ["ramp"] },
    { name: "Arcane Signet", manaValue: 2, roles: ["ramp"] },
    { name: "Goblin Instigator", manaValue: 2 },
    { name: "Night's Whisper", manaValue: 2, roles: ["draw"] },
    { name: "Swords to Plowshares", manaValue: 1, roles: ["targetedRemoval"] },
    { name: "Goblin Rabblemaster", manaValue: 3 },
    { name: "Hellrider", manaValue: 4 },
    { name: "Mountain", manaValue: 0 },
    { name: "Krenko, Mob Boss", manaValue: 4, isCommander: true },
  ], ["Goblin Instigator", "Goblin Rabblemaster"]), (n) => n === "Mountain")!;
  expect(t.nonland).toBe(7);
  const [t1, t2, t3, t4] = t.steps;
  expect(t1!.jobs.map((j) => [j.job, j.cards.map((c) => c.name)])).toEqual([["ramp", ["Sol Ring"]], ["answer", ["Swords to Plowshares"]]]);
  expect(t2!.jobs.map((j) => j.job)).toEqual(["ramp", "draw", "plan"]);
  expect(t2!.castable).toBe(5);
  // A median of 3.5 casts a three-drop, not a four.
  expect(t3!.mana).toBe(3);
  expect(t3!.jobs[0]!.cards.map((c) => c.name)).toEqual(["Goblin Rabblemaster"]);
  expect(t4!.jobs).toEqual([{ job: "other", cards: [{ name: "Hellrider", manaValue: 4 }] }]);
  // The commander is not a library card; it gets its own turn.
  expect(t.commander).toMatchObject({ name: "Krenko, Mob Boss", manaValue: 4, turn: 4 });
});

test("a two-faced card is listed once, by its front, and a land back does not make it a free spell", () => {
  const t = firstTurns(deck([
    { name: "Fell the Profane", cardName: "Fell the Profane // Fell Mire", manaValue: 4, roles: ["targetedRemoval"], face: 0 },
    { name: "Fell Mire", cardName: "Fell the Profane // Fell Mire", manaValue: 4, roles: ["targetedRemoval"], face: 1 },
  ]))!;
  expect(t.nonland).toBe(1);
  expect(t.steps[3]!.jobs[0]!.cards.map((c) => c.name)).toEqual(["Fell the Profane // Fell Mire"]);
});

test("no mana simulation, no picture", () => {
  expect(firstTurns({ cards: [] } as unknown as DeckReport)).toBeNull();
});
