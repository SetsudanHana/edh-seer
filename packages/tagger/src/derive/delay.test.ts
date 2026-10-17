import { describe, expect, it } from "vitest";
import { delayOf, delaysIn, returnDelay } from "./delay.js";

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

describe("returnDelay: a return/put whose own sentence carries a next-end-step / next-upkeep cue", () => {
  const gap = (n: number) => " ".repeat(n);
  it("reads the verb-first form, with a 120-character window", () => {
    const cue = "at the beginning of the next end step";
    // "return" + gap + cue: the gap between the verb and the cue is what is measured.
    expect(returnDelay(`Return it${gap(120 - " it".length)}${cue}.`)).toBe("next-end-step");
    expect(returnDelay(`Return it${gap(121 - " it".length)}${cue}.`)).toBeUndefined();
    expect(returnDelay("Exile it, then return it to the battlefield at the beginning of your next upkeep.")).toBe("next-upkeep");
  });
  it("reads a put", () => {
    expect(returnDelay("Put it onto the battlefield at the beginning of the next end step.")).toBe("next-end-step");
  });
  it("reads the cue-first form", () => {
    expect(returnDelay("At the beginning of the next end step, return it to the battlefield.")).toBe("next-end-step");
    expect(returnDelay("At the beginning of your next upkeep, put it into your hand.")).toBe("next-upkeep");
    expect(returnDelay("At the beginning of the next end step, draw a card.")).toBeUndefined();
  });
  it("is not set by end of turn or a period between verb and cue", () => {
    expect(returnDelay("Return it at end of turn.")).toBeUndefined();
    expect(returnDelay("Return it. Sacrifice it at the beginning of the next end step.")).toBeUndefined();
  });
  it("reads the cue nearest the return", () => {
    expect(returnDelay("Return it during your upkeep, then at the beginning of the next end step.")).toBe("next-end-step");
  });
});
