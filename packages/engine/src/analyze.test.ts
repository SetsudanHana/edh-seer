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

import type { Card } from "./card.js";

// Minimal cards whose synergy comes purely from oracle text the engine already tags.
function card(name: string, oracleText: string): Card {
  return { name, typeLine: "Creature", oracleText, keywords: [], colors: [], manaValue: 1 };
}

// A produces tokens/creature-etb; B and C care about creatures entering.
const A = card("Token Maker", "create a 1/1 creature token.");
const B = card("ETB Payoff B", "whenever a creature enters the battlefield under your control, each opponent loses 1 life.");
const C = card("ETB Payoff C", "whenever a creature enters the battlefield under your control, draw a card.");

test("analyzeDeck ranks cards by weighted synergy and reports partner counts", () => {
  const report = analyzeDeck([A, B, C]);
  // A synergizes with both B and C; B and C each only with A.
  const a = report.cards.find((c) => c.name === "Token Maker")!;
  expect(a.partnerCount).toBe(2);
  expect(report.cards[0].name).toBe("Token Maker"); // highest score, ranked first
  expect(a.isCommander).toBe(false);
  expect(a.topPartners.length).toBeGreaterThan(0);
  expect(a.topPartners.length).toBeLessThanOrEqual(5);
});

test("commander boost multiplies edges to a commander and marks it", () => {
  const withoutCmd = analyzeDeck([A, B, C]);
  const withCmd = analyzeDeck([A, B, C], undefined, ["Token Maker"]);

  expect(withCmd.commanders).toEqual(["Token Maker"]);
  const aWith = withCmd.cards.find((c) => c.name === "Token Maker")!;
  expect(aWith.isCommander).toBe(true);

  // B's only partner is the commander A, so B's score is boosted ×COMMANDER_BOOST vs the no-commander run.
  const bBefore = withoutCmd.cards.find((c) => c.name === "ETB Payoff B")!.score;
  const bAfter = withCmd.cards.find((c) => c.name === "ETB Payoff B")!.score;
  expect(bAfter).toBe(bBefore * 3);
});

test("commanderNames not present in cards are ignored", () => {
  const report = analyzeDeck([A, B], undefined, ["Not In Deck"]);
  expect(report.commanders).toEqual([]);
});

test("Coverage: Kindred Discovery gains edges to both Wizards in a mini wizard deck", () => {
  const report = analyzeDeck([
    FIXTURES.kindredDiscovery,
    FIXTURES.archmageOfEchoes,
    FIXTURES.academyWizard,
  ]);
  const kindred = report.cards.find((c) => c.name === "Kindred Discovery");
  expect(kindred).toBeDefined();
  expect(kindred!.partnerCount).toBe(2);
});

// Vanilla Human Wizard producer — only emits tribe tags, no payoff text.
const wiz = (n: string): Card => ({
  name: n, typeLine: "Creature — Human Wizard", oracleText: "", keywords: [], colors: ["U"], manaValue: 2,
});

test("cohesion identifies the Wizard theme as dominant in a wizard-heavy deck", () => {
  const report = analyzeDeck([wiz("W1"), wiz("W2"), wiz("W3"), wiz("W4"), FIXTURES.archmageOfEchoes]);
  expect(report.cohesion).not.toBeNull();
  // computeCohesion skips the tribe-nontoken:X shadow, so the named theme is tribe:wizard.
  expect(report.cohesion!.tag).toBe("tribe:wizard");
  expect(report.cohesion!.score).toBeGreaterThan(0);
});

test("a wizard payoff outranks the vanilla wizards it enables", () => {
  // Archmage cares tribe:wizard, so it edges to all four vanilla wizards (partnerCount 4);
  // each vanilla wizard edges only to Archmage. Damped weighted sum puts Archmage on top.
  const report = analyzeDeck([wiz("W1"), wiz("W2"), wiz("W3"), wiz("W4"), FIXTURES.archmageOfEchoes]);
  expect(report.cards[0].name).toBe("Archmage of Echoes");
});

test("cohesion is null for a deck with no tagged cards", () => {
  const blank = (n: string): Card => ({ name: n, typeLine: "Land", oracleText: "", keywords: [], colors: [], manaValue: 0 });
  const report = analyzeDeck([blank("L1"), blank("L2")]);
  expect(report.cohesion).toBeNull();
});

// Deck-level regression (SDD 2026-08-04 engine-truth, findings 1/2/6): a full analyzeDeck run,
// not a direct rankThemes/weights.ts call, so it also exercises the analyze.ts wiring that
// unit tests on weights.ts alone can't catch.
//
// Two tags in one family (tribe:wizard + tribe:goblin) plus a third, distinct-family theme
// (cast:instant). Before this fix, rankThemes grouped by the WHOLE "tribe" family: the two
// tribes pooled their weight (2 wizards @ idf(wizard)=~3.34 + 1 goblin @ idf(goblin)=~4.11 =
// ~10.79) and that pooled total beat cast:instant's own weight alone (4 @ idf(instant)=~2.12 =
// ~8.48) -- so cohesion named "tribe:wizard" primary even though wizard's OWN weight (~6.68)
// never individually beat cast:instant. It also disagreed with report.themes, whose raw-count
// sort put cast:instant (4 cards) on top regardless. Verified against the pre-fix code: primary
// was "tribe:wizard", themes[0].tag was "cast:instant" -- the exact split findings 1 and 2
// describe. After the fix (subsumption-only grouping, themes built from the same rankThemes
// call as cohesion), both agree and cast:instant -- the tag with the real (non-pooled) lead --
// wins.
test("cohesion and themes agree, and a real theme is not out-ranked by two pooled tribes", () => {
  const wizard = (n: string): Card => ({
    name: n, typeLine: "Creature — Wizard", oracleText: "", keywords: [], colors: ["U"], manaValue: 2,
  });
  const goblin = (n: string): Card => ({
    name: n, typeLine: "Creature — Goblin", oracleText: "", keywords: [], colors: ["R"], manaValue: 2,
  });
  const instant = (n: string): Card => ({
    name: n, typeLine: "Instant", oracleText: "", keywords: [], colors: ["R"], manaValue: 1,
  });
  const report = analyzeDeck([
    wizard("W1"), wizard("W2"), goblin("G1"),
    instant("I1"), instant("I2"), instant("I3"), instant("I4"),
  ]);
  expect(report.cohesion!.tag).toBe("cast:instant");
  expect(report.themes[0].tag).toBe(report.cohesion!.tag);
});

test("deck stats: curve, land count, avg/median manaValue", () => {
  const report = analyzeDeck(deck, combos);
  expect(report.landCount).toBe(0);
  expect(report.avgManaValue).toBeCloseTo(20 / 9, 10);
  expect(report.medianManaValue).toBe(2);
  expect(report.manaCurve).toHaveLength(8);
  expect(report.manaCurve[4].count).toBe(1); // Krenko
});
