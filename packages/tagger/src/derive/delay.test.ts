import { describe, expect, it } from "vitest";
import { delayOf, delaysIn } from "./delay.js";

describe("delayOf: the one reader of a delayed-action cue", () => {
  it("reads a delayed trigger's step", () => {
    expect(delayOf("Return it to the battlefield at the beginning of the next end step.")).toMatchObject({ until: "next-end-step", kind: "step" });
    expect(delayOf("Return it at the beginning of your next upkeep.")).toMatchObject({ until: "next-upkeep", kind: "step" });
    expect(delayOf("Sacrifice it at the beginning of the next turn.")).toMatchObject({ until: "next-turn", kind: "step" });
  });
  it("reads end of turn but not end of combat (CR 511.2 -- not a delay past combat)", () => {
    expect(delayOf("Exile it at end of turn.")).toMatchObject({ until: "end-of-turn", kind: "step" });
    expect(delayOf("Exile it at the end of the turn.")).toMatchObject({ until: "end-of-turn", kind: "step" });
    expect(delayOf("Destroy it at end of combat.")).toBeNull();
  });
  it("reads 'when you next' only at the start, as an event delay", () => {
    expect(delayOf("When you next cast a creature spell this turn, copy it.")).toMatchObject({ until: "next-cast", kind: "event" });
    expect(delayOf("Whenever you cast a spell, when you next draw a card.")).toBeNull();
  });
  it("returns null with no cue, and delaysIn lists every cue in order", () => {
    expect(delayOf("Draw a card.")).toBeNull();
    expect(delaysIn("Exile it at end of turn, then return it at the beginning of the next end step.").map((d) => d.until)).toEqual(["end-of-turn", "next-end-step"]);
  });
});
