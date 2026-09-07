import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { AbilityTable } from "./AbilityTable.js";

/** A COUNT OVER SEVERAL TYPES READS AS A CHOICE OF PROPER NOUNS. Burakos counts his party --
 *  "cleric, rogue, warrior, wizard" -- and the first cut printed "every Cleric, rogue, warrior,
 *  wizard", three lowercase nouns in a list that read as AND (branch review, 2026-09-05). */
test("a multi-type count capitalises every type and reads as a choice", () => {
  render(<AbilityTable rows={[{
    kind: "triggered", when: ["attacks|-|-|-"], self: true, effect: "token-generation",
    scaling: "per-creature", counts: "cleric, rogue, warrior, wizard", emits: [],
  }]} stacked />);
  expect(screen.getAllByText(/every Cleric, Rogue, Warrior or Wizard you control/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/this card attacking/).length).toBeGreaterThan(0);
});

test("a single-type count is unchanged", () => {
  render(<AbilityTable rows={[{ kind: "activated", when: [], effect: "token-generation", counts: "goblin", emits: [] }]} stacked />);
  expect(screen.getAllByText(/every Goblin you control/).length).toBeGreaterThan(0);
});

test("a row with a speed requirement says it needs max speed", () => {
  render(<AbilityTable rows={[{ kind: "activated", cost: "{3}", when: [], effect: "draw-card", emits: [], requires: { marker: "speed", min: 4 } }]} stacked />);
  expect(screen.getAllByText(/at max speed/i).length).toBeGreaterThan(0);
});
