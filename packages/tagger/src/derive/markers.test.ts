import { expect, test } from "vitest";
import { segment } from "../segment.js";
import { clauseRequiresOf } from "./markers.js";

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
