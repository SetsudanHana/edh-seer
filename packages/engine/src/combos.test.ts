import { expect, test } from "vitest";
import { ComboIndex } from "./combos.js";
import { synergyScore } from "./synergy.js";
import { FIXTURES } from "./fixtures.js";

const combos = new ComboIndex([
  { cards: ["Thassa's Oracle", "Demonic Consultation"], result: "Win the game." },
]);

test("combosContainedIn returns combos whose cards are all present", () => {
  const names = new Set(["Thassa's Oracle", "Demonic Consultation", "Island"]);
  expect(combos.combosContainedIn(names)).toHaveLength(1);
});

test("combosContainedIn returns nothing when a piece is missing", () => {
  const names = new Set(["Thassa's Oracle"]);
  expect(combos.combosContainedIn(names)).toHaveLength(0);
});

test("synergyScore flags a known combo pair", () => {
  const r = synergyScore(FIXTURES.thassasOracle, FIXTURES.consultation, combos);
  expect(r.combo).toBe(true);
  expect(r.score).toBe(100);
  expect(r.reasons.some((x) => x.tag === "combo" && x.text.includes("Win the game"))).toBe(true);
});
