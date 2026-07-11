import { expect, test } from "vitest";
import { analyzeDeck } from "./analyze.js";
import { ComboIndex } from "./combos.js";
import { FIXTURES } from "./fixtures.js";

const deck = [
  FIXTURES.krenko,
  FIXTURES.impactTremors,
  FIXTURES.dockside,
  FIXTURES.fireweaver,
  FIXTURES.cultivate,
  FIXTURES.swordsToPlowshares,
  FIXTURES.divination,
  FIXTURES.thassasOracle,
  FIXTURES.consultation,
];

const combos = new ComboIndex([
  { cards: ["Thassa's Oracle", "Demonic Consultation"], result: "Win the game." },
]);

test("edges are sorted by score descending and combo edge is on top", () => {
  const report = analyzeDeck(deck, combos);
  expect(report.edges.length).toBeGreaterThan(0);
  for (let i = 1; i < report.edges.length; i++) {
    expect(report.edges[i - 1].score).toBeGreaterThanOrEqual(report.edges[i].score);
  }
  expect(report.edges[0].score).toBe(100);
});

test("known combo is reported", () => {
  const report = analyzeDeck(deck, combos);
  expect(report.combos).toHaveLength(1);
  expect(report.combos[0].result).toBe("Win the game.");
});

test("roles count ramp, draw, and removal", () => {
  const report = analyzeDeck(deck, combos);
  expect(report.roles.ramp).toBe(1); // Cultivate
  expect(report.roles.draw).toBe(1); // Divination
  expect(report.roles.removal).toBe(1); // Swords to Plowshares
});

test("themes tally produced tags across the deck", () => {
  const report = analyzeDeck(deck, combos);
  const artifact = report.themes.find((t) => t.tag === "artifact");
  expect(artifact?.count).toBe(1); // Dockside produces artifact (Treasure)
});
