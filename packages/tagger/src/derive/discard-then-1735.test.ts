import { describe, expect, test } from "vitest";
import { deriveAsCorpus } from "../derive-worker.js";
import fixtures from "./discard-then-1735.fixtures.json" with { type: "json" };
import { actionRecipients } from "./recipient.js";

/** #1735: A ", THEN" JOINS THE SAME PLAYER'S NEXT VERB. Minamo's Meddling ("That spell's controller reveals their hand, then discards each card with the same name ...") stored `discard {control: you}`: the #1722 joined-discard cue joined only through and/or. Robber Fly ("defending player
 *  discards all the cards in their hand, then draws that many cards") read its draw `any`, though the defender is the opponent. Fixtures: card documents and stored `cardClauses` dumped from Mongo 2026-11-21 (DERIVE 572); derived as derive-corpus derives them (`deriveAsCorpus`). */
type Fx = { source: Record<string, unknown>; canonical?: unknown[]; segmentHash?: string };
const rowOf = (name: string) => {
  const f = (fixtures as unknown as Record<string, Fx>)[name]!;
  return deriveAsCorpus({ doc: { oracleId: name, name, canonical: f.canonical ?? [], segmentHash: f.segmentHash } as never, source: f.source, isToken: false });
};
const controls = (name: string, verb: string) => rowOf(name).tags.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === verb).map((e) => e.subject.control);

describe("', then' joins the player's own verbs (production cards)", () => {
  test("Minamo's Meddling: 'that spell's controller reveals their hand, then discards' is the opponent's discard", () => expect(controls("Minamo's Meddling", "discard")).toEqual(["opp"]));
  test("Robber Fly: 'defending player discards ..., then draws' is the opponent's draw", () => expect(controls("Robber Fly", "draw")).toEqual(["opp"]));
});

describe("controls: what the join must not move", () => {
  test("Robber Fly: the discard stays the opponent's", () => expect(controls("Robber Fly", "discard")).toEqual(["opp"]));
  test("Cephalid Looter: 'target player draws a card, then discards' stays anyone's", () => expect(controls("Cephalid Looter", "discard")).toEqual(["any"]));
  test("Dark Intimations: 'each opponent sacrifices ..., then discards' stays the opponent's", () => expect(controls("Dark Intimations", "discard")).toEqual(["opp"]));
  test("Windfall: 'each player discards their hand, then draws' stays anyone's", () => expect(controls("Windfall", "draw")).toEqual(["any"]));
  test("Cut a Deal: 'each opponent draws a card, then you draw a card for each' keeps your own draw yours", () => expect(controls("Cut a Deal", "draw")).toContain("you"));
  test("River's Grasp: 'target player reveals their hand, you choose a card, then that player discards' is not yours", () => expect(controls("River's Grasp", "discard")).not.toContain("you"));
  test("Inspired Ultimatum: 'target player gains 5 life, ... then you draw five cards' is yours", () => expect(controls("Inspired Ultimatum", "draw")).not.toContain("opp"));
});

describe("another actor between the player and the joined verb refuses the join", () => {
  test("'target opponent loses 2 life, then you draw a card': the draw is not the opponent's", () =>
    expect(actionRecipients("Target opponent loses 2 life, then you draw a card.").draw).not.toBe("opp"));
  test("'each opponent loses 2 life, then you discard a card': the discard is not the opponent's", () =>
    expect(actionRecipients("Each opponent loses 2 life, then you discard a card.").discard).not.toBe("opp"));
  test("'target opponent loses 2 life, then each player draws a card' is not the opponent's alone", () =>
    expect(actionRecipients("Target opponent loses 2 life, then each player draws a card.").draw).not.toBe("opp"));
  test("'that spell's controller reveals their hand, then discards' joins", () =>
    expect(actionRecipients("That spell's controller reveals their hand, then discards each card.").discard).toBe("opp"));
  test("a period ends the join: 'its controller reveals their hand. Then discard a card'", () =>
    expect(actionRecipients("Its controller reveals their hand. Then you discard a card.").discard).toBe("you"));
});
