import { expect, test } from "vitest";
import type { Ability } from "../schema.js";
import { repeatsFor } from "./repeats.js";

const activated = (): Ability => ({ kind: "activated", effect: { kind: "" as const } });
const triggered = (verbs: string[], subject: Record<string, unknown> = {}): Ability => ({
  kind: "triggered",
  effect: { kind: "" as const },
  trigger: { verbs: verbs as never, subject: { control: "any", token: null, ...subject } as never },
});

test("rule 1: sacrificing the card ITSELF fires once", () => {
  // Escape Tunnel: clause.cost="{T}, Sacrifice this land", clause.text="Search your library for a
  // basic land card...". The self-sacrifice check reads the COST argument, not the body.
  expect(repeatsFor(activated(), "Exile target card from a graveyard.", "Sacrifice this creature")).toBe("once");
});

test("rule 1 does NOT fire for a repeatable sacrifice outlet -- indefinite article, not self", () => {
  // Viscera Seer: clause.cost="Sacrifice a creature", clause.text="Scry 1." Same verb as rule 1,
  // opposite answer -- conflating "this" with "a" inverts the commonest sacrifice shape there is.
  expect(repeatsFor(activated(), "Scry 1.", "Sacrifice a creature")).toBe("repeatable");
});

test("rule 2: a tap cost fires once per ROUND", () => {
  // Gogo, Master of Mimicry: clause.cost="{X}{X}, {T}", clause.text="Copy target activated or
  // triggered ability you control X times." The cost is stripped out of the body by segment.ts's
  // classify() before it ever reaches this function, so the tap has to be read from `cost`.
  expect(repeatsFor(activated(), "Copy target activated or triggered ability you control X times.", "{X}{X}, {T}")).toBe("per-cycle");
  expect(repeatsFor(activated(), "Untap target artifact.", "{Q}")).toBe("per-cycle");
});

test("rule 2 BEATS rule 3 -- the tap is the harder cap", () => {
  // "once each turn" is once per TURN (up to pod-size a round); {T} is once per ROUND. Taking the
  // text rule first would overstate this by the pod size.
  expect(repeatsFor(activated(), "Draw a card. Activate only once each turn.", "{T}")).toBe("per-cycle");
});

test("rule 3: an explicit once-each-turn limit fires once per TURN", () => {
  expect(repeatsFor(activated(), "Scry 1. Activate only once each turn.", "{1}")).toBe("per-turn");
});

test("rule 4: a static ability never fires at all", () => {
  // Rest in Peace is not repeatable graveyard hate, it is always on. Folding this into
  // `repeatable` would lose the distinction step D needs.
  expect(repeatsFor({ kind: "static", effect: { kind: "" as const } }, "Creatures you control get +1/+1.")).toBe("continuous");
});

test("rule 5: a spell's own cast happens once", () => {
  expect(repeatsFor({ kind: "on-cast", effect: { kind: "" as const } }, "Destroy target creature.")).toBe("once");
});

test("rule 6: a phase trigger on YOUR turn is once per round", () => {
  expect(repeatsFor(triggered(["upkeep"], { control: "you" }), "At the beginning of your upkeep, draw a card.")).toBe("per-cycle");
  expect(repeatsFor(triggered(["attacks"], { control: "you" }), "Whenever this creature attacks, draw a card.")).toBe("per-cycle");
});

test("rule 7: a phase trigger on EVERY turn fires up to pod-size times a round", () => {
  expect(repeatsFor(triggered(["upkeep"], { control: "any" }), "At the beginning of each upkeep, draw a card.")).toBe("per-turn");
  expect(repeatsFor(triggered(["upkeep"], { control: "opp" }), "At the beginning of each opponent's upkeep, draw a card.")).toBe("per-turn");
});

test("rule 8: the card's OWN enters/dies fires once; a class-watching trigger does not", () => {
  // Same verb, opposite buckets. `subject.self` is the discriminator, and self-reference is the
  // largest defect family this engine has had.
  expect(repeatsFor(triggered(["enters"], { self: true }), "When this creature enters, draw a card.")).toBe("once");
  expect(repeatsFor(triggered(["dies"], { self: true }), "When this creature dies, draw a card.")).toBe("once");
  expect(repeatsFor(triggered(["dies"], { type: "creature", control: "you" }), "Whenever a creature you control dies, draw a card.")).toBe("repeatable");
});

test("rule 9: an unlimited activated ability is repeatable", () => {
  // Faerie Mastermind's second ability: clause.cost="{3}{U}", clause.text="Each player draws a
  // card." No tap, no limit.
  expect(repeatsFor(activated(), "Each player draws a card.", "{3}{U}")).toBe("repeatable");
});

test("rule 10: what the rules cannot name stays UNSET, never guessed", () => {
  expect(repeatsFor({ kind: "triggered", effect: { kind: "" as const } }, "")).toBeUndefined();
});
