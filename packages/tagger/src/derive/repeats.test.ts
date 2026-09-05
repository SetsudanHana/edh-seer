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
  // "attacks" is phase-shaped ONLY when self -- see the rule 6/9 attacks tests below.
  expect(repeatsFor(triggered(["attacks"], { control: "you", self: true }), "Whenever this creature attacks, draw a card.")).toBe("per-cycle");
});

test("rule 6/9: 'attacks' is once per cycle when SELF, but once per ATTACKER when the subject is a class (finding 3, 2026-08-11 review)", () => {
  // Weathered Sentinels (real corpus card): "Whenever this creature attacks, it gets +3/+3 and
  // gains indestructible until end of turn." One creature, one attack trigger per round -- self,
  // per-cycle is correct.
  expect(
    repeatsFor(triggered(["attacks"], { control: "you", self: true, type: "creature" }), "Whenever this creature attacks, it gets +3/+3 and gains indestructible until end of turn."),
  ).toBe("per-cycle");
  // Doran, Besieged by Time (real corpus card): "Whenever a creature you control attacks or
  // blocks, it gets +X/+X until end of turn, where X is the difference between its power and
  // toughness." Every attacker triggers it separately -- a wide board fires this many times a
  // round, not once, so `attacks` in PHASE_VERBS was overstating it before the fix (202 abilities
  // on `attacks:you`, the largest rule-6 group per the design spec's §5 measurement).
  expect(
    repeatsFor(triggered(["attacks"], { control: "you", type: "creature" }), "Whenever a creature you control attacks or blocks, it gets +X/+X until end of turn, where X is the difference between its power and toughness."),
  ).toBe("repeatable");
});

test("rule 7: a phase trigger on EVERY turn fires up to pod-size times a round", () => {
  expect(repeatsFor(triggered(["upkeep"], { control: "any" }), "At the beginning of each upkeep, draw a card.")).toBe("per-turn");
  expect(repeatsFor(triggered(["upkeep"], { control: "opp" }), "At the beginning of each opponent's upkeep, draw a card.")).toBe("per-turn");
});

test("rule 6/7 extension: an ordinal 'each turn' bounds a non-phase verb the same way", () => {
  // Faerie Mastermind: "Whenever an opponent draws their second card each turn, you draw a card."
  // `draw` is not a phase verb, so before ORDINAL_EACH_TURN existed this fell through every rule to
  // REFUSED -- the card the whole taxonomy was designed around, sitting unlabelled. The ordinal
  // "second ... each turn" bounds the trigger to that opponent's turn the same way a phase verb does.
  expect(repeatsFor(triggered(["draw"], { control: "opp" }), "Whenever an opponent draws their second card each turn, you draw a card.")).toBe("per-turn");
});

test("rule 6/7 extension folds into the SAME control split as a phase trigger", () => {
  // Rashmi, Eternities Crafter: "Whenever you cast your first spell each turn, reveal the top card
  // of your library..." Same ordinal shape as Faerie Mastermind, but control:you -- bounded to your
  // own turn, so per-cycle. Pins the fold into the existing branch rather than assuming it.
  expect(repeatsFor(triggered(["cast"], { control: "you" }), "Whenever you cast your first spell each turn, reveal the top card of your library.")).toBe("per-cycle");
});

test("rule 6/7 extension does NOT over-match a bare 'each turn' with no ordinal", () => {
  // Spirit of the Labyrinth: "Each player can't draw more than one card each turn." -- "one" is not
  // an ordinal, and in the real corpus this line is a static (kind "static", caught by rule 4 before
  // ever reaching the trigger branch). Wrapped as a trigger here to isolate the regex: without an
  // ordinal word, the phase-bound branch must not fire, so an otherwise un-narrowed trigger (no
  // type/subtype subject) must not come out per-cycle or per-turn. (Until 2026-09-05 it was
  // refused outright; rule 9 now reads an untyped non-self trigger as a class, so it is
  // `repeatable` -- still not the phase label this test guards against.)
  const label = repeatsFor(triggered(["draw"], { control: "you" }), "Each player can't draw more than one card each turn.");
  expect(label).not.toBe("per-cycle");
  expect(label).not.toBe("per-turn");
  expect(label).toBe("repeatable");
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

// 2026-09-05, owner: "fix the repeats labeller so Black Market Connections counts as engine".
test("rules 6-7 on the RAW event: a step the Verb union does not carry is still a phase", () => {
  const noTrigger: Ability = { kind: "triggered", effect: { kind: "draw-card" } };
  // Black Market Connections: "At the beginning of your first main phase, choose one or more --".
  expect(repeatsFor(noTrigger, "Buy Information -- Draw a card. You lose 2 life.", "", { event: "main-phase", control: "you" })).toBe("per-cycle");
  // Howling Mine / Font of Mythos: every player's draw step.
  expect(repeatsFor(noTrigger, "that player draws an additional card.", "", { event: "draw-step", control: "any" })).toBe("per-turn");
  // A saga chapter fires once in the saga's life (CR 714.2b).
  expect(repeatsFor(noTrigger, "You may discard up to two cards. If you do, draw that many cards.", "", { event: "chapter", control: "you" })).toBe("once");
  // An unknown raw event that is no phase leaves the ability where it was.
  expect(repeatsFor(noTrigger, "", "", { event: "becomes-target", control: "any" })).toBeUndefined();
});

test("rule 9: a class needs no TYPE -- an untyped, non-self trigger still watches a class", () => {
  // Mind's Eye: "Whenever an opponent draws a card".
  expect(repeatsFor(triggered(["draw"], { control: "opp" }), "Whenever an opponent draws a card, you may pay {1}. If you do, draw a card.")).toBe("repeatable");
  expect(repeatsFor(triggered(["gain-life"], { control: "you" }), "Whenever you gain life, ...")).toBe("repeatable");
  // The card's OWN untyped event is not a class, and rule 8 names only arrivals and departures.
  expect(repeatsFor(triggered(["taps"], { self: true, control: "you" }), "Whenever this creature becomes tapped, ...")).toBeUndefined();
});

test("rule 8b: combat happens once a turn -- own or untyped combat triggers split on control; a class of attackers stays repeatable", () => {
  // "Whenever this creature deals combat damage to a player".
  expect(repeatsFor(triggered(["combat-damage"], { self: true, type: "creature", control: "you" }), "...")).toBe("per-cycle");
  // Curse of Verbosity: "Whenever enchanted player is attacked".
  expect(repeatsFor(triggered(["attacks"], { control: "any" }), "Whenever enchanted player is attacked, you draw a card.")).toBe("per-turn");
  // Finding 3 (2026-08-11) holds: a CLASS of attackers is once per attacker.
  expect(repeatsFor(triggered(["attacks"], { type: "creature", control: "you" }), "Whenever a creature you control attacks, ...")).toBe("repeatable");
});

test("rule 8: the card's own sacrifice, graveyard arrival and cast happen once", () => {
  expect(repeatsFor(triggered(["sacrifice"], { self: true, control: "you" }), "When you sacrifice this creature, ...")).toBe("once");
  expect(repeatsFor(triggered(["enters-graveyard"], { self: true, control: "any" }), "When this card is put into a graveyard from anywhere, ...")).toBe("once");
  expect(repeatsFor(triggered(["cast"], { self: true, control: "you" }), "When you cast this spell, ...")).toBe("once");
});

test("rule 1: a cost that discards or exiles the card itself fires once (channel)", () => {
  // Otawara, Soaring City: "{3}{U}, Discard this card: Return target ... to its owner's hand."
  expect(repeatsFor(activated(), "Return target artifact, creature, enchantment, or planeswalker to its owner's hand.", "{3}{U}, Discard this card")).toBe("once");
  expect(repeatsFor(activated(), "Draw a card.", "{2}, Exile this card from your graveyard")).toBe("once");
  // Discarding A card is not discarding this one.
  expect(repeatsFor(activated(), "Draw a card.", "{1}, Discard a card")).toBe("repeatable");
});
