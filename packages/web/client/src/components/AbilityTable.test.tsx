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
  // AK4: the trigger column is a clause now, so it reads after "when".
  expect(screen.getAllByText(/this card attacks/).length).toBeGreaterThan(0);
});

test("a single-type count is unchanged", () => {
  render(<AbilityTable rows={[{ kind: "activated", when: [], effect: "token-generation", counts: "goblin", emits: [] }]} stacked />);
  expect(screen.getAllByText(/every Goblin you control/).length).toBeGreaterThan(0);
});

test("a row with a speed requirement says it needs max speed", () => {
  render(<AbilityTable rows={[{ kind: "activated", cost: "{3}", when: [], effect: "draw-card", emits: [], requires: { marker: "speed", min: 4 } }]} stacked />);
  expect(screen.getAllByText(/at max speed/i).length).toBeGreaterThan(0);
});

/** A SELF EMIT READS AS THIS CARD (owner, 2026-09-08). "Untap Chandra" is Chandra untapping, and the
 *  row said "anything untapping" because the key cannot carry the flag. Since AK4 the wording is a
 *  clause for the self case and the ACTION for everything else -- this column says what the
 *  ability does, and "a card being drawn" was never that. */
test("an emit whose subject is the card itself reads as this card", () => {
  render(<AbilityTable rows={[{
    kind: "triggered", when: ["cast|spell|-|-"], effect: "untap",
    emits: ["untaps|-|-|-", "non-combat-damage|creature|-|-"], selfEmits: ["untaps|-|-|-"],
  }]} stacked />);
  expect(screen.getAllByText(/this card untaps/).length).toBeGreaterThan(0);
  // The subject of a damage emit is the creature DEALING it, so there is no action form for
  // it and the clause is what shows -- which is the right sentence either way.
  expect(screen.getAllByText(/a creature deals noncombat damage/).length).toBeGreaterThan(0);
  expect(screen.queryByText(/anything untapping/)).toBeNull();
});

/** THE COLOUR AND THE SELF (owner, 2026-09-08): Chandra untaps herself on a red spell, and the row
 *  said "a spell being cast" and "untaps a permanent". */
test("a coloured trigger names the colour, and a self effect reads reflexively", () => {
  render(<AbilityTable rows={[{
    kind: "triggered", when: ["cast|spell|-|-"], whenColors: ["R"], effect: "untap", effectSelf: true,
    emits: ["untaps|-|-|-"], selfEmits: ["untaps|-|-|-"],
  }]} stacked />);
  expect(screen.getAllByText(/a red spell is cast/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/untaps itself/).length).toBeGreaterThan(0);
  expect(screen.queryByText(/untaps a permanent/)).toBeNull();
});
