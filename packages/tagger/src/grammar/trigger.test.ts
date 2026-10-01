import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parseTrigger, type TriggerReading } from "./trigger.js";

// Every preamble below is printed text from the trigger census (`packages/tagger/triggers.jsonl`).
const one = (p: string, condition: string | null = null) => {
  const r = parseTrigger(p, condition);
  if (r === null || Array.isArray(r)) throw new Error(`expected one reading for "${p}": ${JSON.stringify(r)}`);
  return r;
};
const events = (p: string) => [parseTrigger(p, null) ?? []].flat().map((r: TriggerReading) => r.event);

test("object verbs: the subject's controller, and anyone's when the phrase names none", () => {
  expect(one("Whenever a creature you control dies")).toMatchObject({ event: "dies", control: "you", subject: { type: "creature", control: "you" } });
  expect(one("Whenever a creature dies")).toMatchObject({ event: "dies", control: "any" });
  expect(one("Whenever a land an opponent controls enters")).toMatchObject({ event: "enters", control: "opp", subject: { type: "land" } });
});

test("the card itself is self and yours, with the printed class kept", () => {
  expect(one("When ~ enters")).toMatchObject({ event: "enters", control: "you", subject: { self: true } });
  expect(one("When this creature dies")).toMatchObject({ event: "dies", subject: { self: true, type: "creature" } });
  expect(one("When this Aura enters").subject).toMatchObject({ self: true, subtype: "aura" });
});

test("actor verbs: whose is the actor's", () => {
  expect(one("Whenever you cast a noncreature spell")).toMatchObject({ event: "cast", control: "you" });
  expect(one("Whenever an opponent casts a spell")).toMatchObject({ event: "cast", control: "opp" });
  expect(one("Whenever a player casts an artifact, instant, or sorcery spell")).toMatchObject({ event: "cast", control: "any" });
  expect(one("Whenever you gain life")).toMatchObject({ event: "life-gained", control: "you" });
});

test("phases: whose step it is; 'each' and 'the' are every player's", () => {
  expect(one("At the beginning of your upkeep")).toMatchObject({ event: "upkeep", control: "you" });
  expect(one("At the beginning of each opponent's upkeep")).toMatchObject({ event: "upkeep", control: "opp" });
  expect(one("At the beginning of each end step")).toMatchObject({ event: "end-step", control: "any" });
  expect(one("At the beginning of the end step")).toMatchObject({ event: "end-step", control: "any" });
  expect(one("At the beginning of combat on your turn")).toMatchObject({ event: "begin-combat", control: "you" });
  expect(one("At the beginning of your next upkeep")).toMatchObject({ event: "upkeep", narrowing: "next" });
});

test("a compound is one reading per event", () => {
  expect(events("Whenever this creature enters or attacks")).toEqual(["enters", "attacks"]);
  expect(events("Whenever ~ attacks or blocks")).toEqual(["attacks", "blocks"]);
  expect(events("Whenever you cycle or discard a card")).toEqual(["cycled", "discarded"]);
  expect(events("Whenever you cast or copy an instant or sorcery spell")).toEqual(["cast", "copy"]);
  expect(events("When you cycle this card and when this creature dies")).toEqual(["cycled", "dies"]);
});

test("CR 700.4: put into a graveyard from the battlefield is dies; CR 603.6c: from anywhere is not", () => {
  expect(one("When this artifact is put into a graveyard from the battlefield")).toMatchObject({ event: "dies", subject: { self: true } });
  expect(one("When ~ is put into a graveyard from anywhere").event).toBe("put-into-graveyard");
});

test("damage: the direction is the event, the kind rides beside it", () => {
  expect(one("Whenever this creature deals combat damage to a player")).toMatchObject({ event: "damage-dealt", damage: "combat" });
  expect(one("Whenever this creature is dealt damage")).toMatchObject({ event: "damaged", subject: { self: true } });
  expect(one("Whenever a source deals damage to this creature")).toMatchObject({ event: "damaged", subject: { self: true } });
  expect(one("Whenever a source you control deals noncombat damage to an opponent")).toMatchObject({ event: "damage-dealt", damage: "noncombat" });
});

test("CR 509.1a: only a creature blocks, so 'by a creature' narrows nothing; another blocker class is a narrowing", () => {
  expect(one("Whenever this creature becomes blocked by a creature")).not.toHaveProperty("narrowing");
  expect(one("Whenever this creature becomes blocked by a white creature").narrowing).toBe("by a white creature");
});

test("CR 702.6a: an Equipment's host is yours; an Aura's is anyone's", () => {
  expect(one("Whenever equipped creature attacks")).toMatchObject({ event: "attacks", control: "you", subject: { type: "creature" } });
  expect(one("When enchanted creature dies")).toMatchObject({ event: "dies", control: "any" });
});

test("a narrowing the subject cannot hold rides as `narrowing`, never dropped", () => {
  expect(one("Whenever a creature you control attacks alone")).toMatchObject({ event: "attacks", narrowing: "alone" });
  expect(one("Whenever you cast your second spell each turn")).toMatchObject({ event: "cast", narrowing: "your second spell each turn" });
  expect(one("Whenever this creature attacks while saddled").narrowing).toBe("while saddled");
  // The filter grammar reads the class of "three or more creatures" and drops the number.
  expect(one("Whenever you attack with three or more creatures").narrowing).toBe("three or more creatures");
  // A frequency cap is not a narrowing of which events.
  expect(one("Whenever this creature becomes the target of a spell or ability for the first time each turn")).toMatchObject({ event: "becomes-target", oncePerTurn: true });
  expect(one("Whenever this creature becomes the target of a spell or ability an opponent controls").narrowing).toBe("a spell or ability an opponent controls");
});

test("CR 603.4: the intervening if rides on every reading with its family", () => {
  expect(one("When this creature enters", "it was kicked").condition).toEqual({ family: "other", text: "it was kicked" });
  for (const r of [parseTrigger("Whenever this creature enters or attacks", "you control a Dragon")].flat()) {
    expect(r?.condition).toEqual({ family: "control", text: "you control a Dragon" });
  }
});

test("self-or-class reads the class half; the card itself is derive's twin (#295)", () => {
  const r = one("Whenever this creature or another Ally you control enters");
  expect(r.subject).toMatchObject({ subtype: "ally", control: "you" });
  expect(r.subject).not.toHaveProperty("other");
});

test("counters: the recipient is the subject, the printed kind its counter", () => {
  expect(one("Whenever one or more +1/+1 counters are put on this creature")).toMatchObject({ event: "counter-added", subject: { self: true, counter: "+1/+1" } });
  expect(one("Whenever a time counter is removed from this card while it's exiled")).toMatchObject({ event: "counter-removed", narrowing: "while it's exiled" });
});

test("a back-reference is the object before it, not its class", () => {
  expect(one("When that creature dies this turn")).toMatchObject({ event: "dies", subject: { ref: "sentence", type: "creature" } });
});

test("named-only events, state triggers and the reflexive", () => {
  expect(one("When you do")).toEqual({ event: "reflexive" });
  expect(one("When you control no Islands")).toMatchObject({ event: "state", narrowing: "you control no Islands" });
  expect(one("Whenever day becomes night or night becomes day").event).toBe("day-night");
  expect(one("When you unlock this door")).toMatchObject({ event: "unlocked", subject: { self: true } });
});

test("refuses what it cannot read completely", () => {
  expect(parseTrigger("Whenever a creature frobnicates", null)).toBeNull();
  expect(parseTrigger("At the beginning of your upkeep, choose flying, first strike, trample", null)).toBeNull();
});

test("strict first: a compound is never read as one verb with the rest as a qualifier", () => {
  expect(events("Whenever a creature you control of the chosen type enters or attacks")).toEqual(["enters", "attacks"]);
  expect(parseTrigger("Whenever you play a land from exile or cast a spell from exile", null)).toMatchObject([{ event: "play" }, { event: "cast" }]);
  expect(events("Whenever an equipped creature you control other than ~ attacks or dies")).toEqual(["attacks", "dies"]);
});

test("a qualifier the filter grammar cannot read cuts the subject and narrows the event", () => {
  expect(one("Whenever you cast a spell with {X} in its mana cost")).toMatchObject({ event: "cast", subject: { type: "spell" }, narrowing: "with {X} in its mana cost" });
  expect(one("Whenever a creature you control with a mana ability attacks")).toMatchObject({ event: "attacks", narrowing: "with a mana ability" });
  // Every narrowing is kept, never overwritten.
  expect(one("When you next cast a spell with {X} in its mana cost this turn").narrowing).toBe("next with {X} in its mana cost this turn");
});

test("a caused event is that event, narrowed by its cause", () => {
  expect(one("Whenever a spell or ability an opponent controls causes you to discard a card")).toMatchObject({ event: "discarded", control: "you", narrowing: "caused by a spell or ability an opponent controls" });
  expect(one("Whenever a spell or ability an opponent controls causes a land to be put into your graveyard from the battlefield")).toMatchObject({ event: "dies", subject: { type: "land" } });
});

test("one player the matcher cannot pick out is anyone's, narrowed", () => {
  expect(one("Whenever enchanted player casts a spell")).toMatchObject({ event: "cast", control: "any", narrowing: "enchanted player" });
  expect(one("At the beginning of the chosen player's upkeep")).toMatchObject({ event: "upkeep", narrowing: "chosen player" });
  expect(one("At the beginning of that turn's end step")).toMatchObject({ event: "end-step", narrowing: "that turn" });
});

test("delayed triggers name the object before them; a name the census kept is `named`", () => {
  expect(one("When the creature put onto the battlefield with this enchantment dies").subject).toMatchObject({ ref: "sentence", type: "creature" });
  expect(one("When Jumblebones leaves the battlefield")).toMatchObject({ event: "leaves", subject: { named: "jumblebones" } });
});

test("self or a class it need not belong to is two readings", () => {
  expect(parseTrigger("Whenever this creature or a Dragon you control dies", null)).toMatchObject([{ subject: { self: true } }, { subject: { subtype: "dragon" } }]);
});

test("activations: an ability that isn't a mana ability is an activated ability (CR 605.1a)", () => {
  expect(one("Whenever you activate an ability that isn't a mana ability").subject).toMatchObject({ abilityKind: ["activated"] });
  expect(one("Whenever an opponent activates an ability of a permanent that isn't a mana ability")).toMatchObject({ control: "opp", narrowing: "of a permanent" });
});

test("named-only events the vocabulary has no word for are `other`", () => {
  expect(one("Whenever you open an Attraction").event).toBe("other");
  expect(one("Whenever chaos ensues").event).toBe("other");
  expect(one("Whenever you get one or more {E}")).toMatchObject({ event: "counter-added", subject: { counter: "energy" } });
  expect(one("Whenever you pay life")).toMatchObject({ event: "life-lost", narrowing: "pay" });
});

test("over the census: deterministic, every event a clause-vocabulary word, coverage not below its floor", async () => {
  const { TRIGGERS } = await import("../normalize-prompt.js");
  const rows = readFileSync(new URL("../../triggers.jsonl", import.meta.url), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { preamble: string; cards: number });
  const preambles = new Map<string, number>();
  for (const r of rows) preambles.set(r.preamble, (preambles.get(r.preamble) ?? 0) + r.cards);
  let read = 0, uses = 0, total = 0;
  for (const [p, cards] of preambles) {
    total += cards;
    const r = parseTrigger(p, null);
    expect(JSON.stringify(parseTrigger(p, null))).toBe(JSON.stringify(r));
    if (!r) continue;
    read++; uses += cards;
    for (const x of [r].flat()) if (x.event !== "reflexive") expect(TRIGGERS as readonly string[], p).toContain(x.event);
  }
  // Every printed preamble in the census reads (#896: 100%, as the filter grammar's phrases).
  expect(read).toBe(preambles.size);
  expect(uses).toBe(total);
});
