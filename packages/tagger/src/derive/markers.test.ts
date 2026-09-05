import { expect, test } from "vitest";
import { segment } from "../segment.js";
import { clauseRequiresOf, requiresOf } from "./markers.js";

/** "MAX SPEED —" IS AN ABILITY WORD THE SEGMENTER STRIPS, so the clause the model sees reads "Draw a
 *  card." and the condition is gone: Goblin Surveyor's draw derived unconditional, as did all 34
 *  commander-legal "Max speed" lines (roadmap W18, 2026-09-05). The marker is read off the printed
 *  line and attached to the clause whose text that line ends with. Speed is the PLAYER's marker
 *  (CR 702.179), so the requirement is on the state, never on a card. */
const SURVEYOR = "Trample\nStart your engines! (If you have no speed, it starts at 1. It increases once on each of your turns when an opponent loses life. Max speed is 4.)\nMax speed — {3}, Exile this card from your graveyard: Draw a card.";

test("a Max speed line puts a speed requirement on its own clause and no other", () => {
  const clauses = segment(SURVEYOR, ["Trample", "Start your engines!"], "Creature — Goblin Scout");
  expect(clauseRequiresOf(SURVEYOR, clauses)).toEqual({ 3: { marker: "speed", min: 4 } });
});

test("a card without an ability word requires nothing", () => {
  const text = "Flying\nWhen this creature enters, draw a card.";
  expect(clauseRequiresOf(text, segment(text, ["Flying"], "Creature — Bird"))).toEqual({});
});

/** THE BOOLEAN MARKERS live inside the clause text, not in an ability word: "if you're the monarch"
 *  (25 commander-legal cards), "as long as you have the city's blessing" (25), "if you have the
 *  initiative" (6), "as long as you've completed a dungeon" (15). Read only where the condition
 *  governs the WHOLE clause -- at its head, or trailing on a one-sentence static -- so "create X.
 *  If you're the monarch, create Y instead" keeps both branches unconditional, as today. */
test("a condition that governs the whole clause is a requirement", () => {
  expect(requiresOf("At the beginning of your end step, if you're the monarch, return up to one target creature card from your graveyard to your hand.")).toEqual({ marker: "monarch", min: 1 });
  expect(requiresOf("This creature has flying as long as you have the city's blessing.")).toEqual({ marker: "blessing", min: 1 });
  expect(requiresOf("At the beginning of your end step, if you have the initiative, draw a card.")).toEqual({ marker: "initiative", min: 1 });
  expect(requiresOf("Other creatures you control get +1/+1 as long as you've completed a dungeon.")).toEqual({ marker: "dungeon", min: 1 });
  expect(requiresOf("As long as it's night, this creature gets +2/+0.")).toEqual({ marker: "night", min: 1 });
});

test("a mid-clause alternative is not a requirement on the clause", () => {
  expect(requiresOf("At the beginning of your upkeep, create a 1/1 white Spirit creature token with flying. If you're the monarch, create a 4/4 white Angel creature token with flying instead.")).toBeUndefined();
  expect(requiresOf("When this creature enters, draw a card.")).toBeUndefined();
});
