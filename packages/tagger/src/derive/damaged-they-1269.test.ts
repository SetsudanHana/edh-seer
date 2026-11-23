import { describe, expect, test } from "vitest";
import { deriveAsCorpus } from "../derive-worker.js";
import { actionRecipients, damagedPlayerRead } from "./recipient.js";
import fixtures from "./damaged-they-1269.fixtures.json" with { type: "json" };

/** #1269: the card's own damage hit a player, and the clause names that player without "that player" -- "they lose half their life" (Unstoppable Slasher), "they mill two cards" (Rex), "The player gets another poison counter" (Sabertooth Cobra) --
 *  or twice in one verb (Sabertooth's two poison counters, which `actorFor` refused). `any` matches `you`, so each fed "whenever you lose life" / "you mill" payoffs. Fixtures: card documents and stored `cardClauses` dumped from Mongo 2026-11-23 (DERIVE 588). */
type Fx = { source: Record<string, unknown>; canonical?: unknown[]; segmentHash?: string };
const rowOf = (name: string) => {
  const f = (fixtures as unknown as Record<string, Fx>)[name]!;
  return deriveAsCorpus({ doc: { oracleId: name, name, canonical: f.canonical ?? [], segmentHash: f.segmentHash } as never, source: f.source, isToken: false });
};
const controls = (name: string, verb: string): string[] =>
  rowOf(name).tags.abilities.flatMap((a) => (a.emits ?? []).filter((e) => e.verb === verb).map((e) => e.subject.control));

describe("'they' after the card's own damage is the damaged player", () => {
  test.each([
    ["Unstoppable Slasher", "lose-life"],
    ["Rex, Cyber-Hound", "mill"],
    ["Infesting Radroach", "counter-added"],
    ["Glowing One", "counter-added"],
  ])("%s: %s is an opponent's", (name, verb) => {
    const c = controls(name, verb);
    expect(c.length).toBeGreaterThan(0);
    expect(c).toEqual(c.map(() => "opp"));
  });
  test("Rex keeps the energy it gives you", () => expect(controls("Rex, Cyber-Hound", "counter-added")).toContain("you"));
  test("Etali, Primal Conqueror: 'they get that many poison counters'", () => expect(controls("Etali, Primal Conqueror // Etali, Primal Sickness", "counter-added")).toContain("opp"));
  test("Skullknocker Ogre: 'If the player does, they draw a card' is the opponent's", () => expect(controls("Skullknocker Ogre", "draw")).toEqual(["opp"]));
  test("Doomsday Specter: 'The player discards that card'", () => expect(controls("Doomsday Specter", "discard")).toEqual(["opp"]));
});

describe("two actions of one verb, each the damaged player's", () => {
  test("Sabertooth Cobra: both poison counters are an opponent's", () => expect(controls("Sabertooth Cobra", "counter-added")).toEqual(["opp", "opp"]));
});

describe("the reveal-and-put mill was an opponent's already (#1663)", () => {
  test.each(["Mirko Vosk, Mind Drinker", "Balshan Beguiler"])("%s", (name) => expect(controls(name, "mill")).toEqual(["opp"]));
});

describe("guards: a 'they' that is not the damaged player keeps its reading", () => {
  test("Yidris: 'as YOU cast spells ..., they gain cascade' names you before they, so nothing is read", () => {
    const text = (fixtures as unknown as Record<string, Fx>)["Yidris, Maelstrom Wielder"]!.source.oracleText as string;
    const line = text.split("\n").find((l) => /deals combat damage/.test(l))!;
    expect(damagedPlayerRead(line, { triggerIsSelf: true, cardName: "Yidris, Maelstrom Wielder" })).toBe(line);
  });
  test("a creature that is not the card's own: 'they' may be you (synthetic, no such card prints it)", () => {
    const t = "Whenever a creature deals combat damage to a player, they lose 1 life.";
    expect(damagedPlayerRead(t, {})).toBe(t);
    expect(actionRecipients(t, {})).toEqual({});
  });
  test("an 'each player' sentence after the damage keeps every 'they' (synthetic)", () => {
    const t = "Whenever this creature deals combat damage to a player, each player may discard a card. If they do, they draw a card.";
    expect(damagedPlayerRead(t, { triggerIsSelf: true })).toBe(t);
  });
  test("'you' between the damage and the pronoun (synthetic)", () => {
    const t = "Whenever this creature deals combat damage to a player, you may pay {2}. If you do, they lose 2 life.";
    expect(damagedPlayerRead(t, { triggerIsSelf: true })).toBe(t);
  });
  test("a 'they' after a second sentence end, and one in reminder text, are not read (synthetic)", () => {
    expect(damagedPlayerRead("Whenever this creature deals combat damage to a player, draw a card. Scry 1. They lose 1 life.", { triggerIsSelf: true })).toContain("They lose");
    expect(damagedPlayerRead("Whenever this creature deals combat damage to a player, draw a card. (They lose 1 life.)", { triggerIsSelf: true })).toContain("(They lose");
  });
  test("Mind Bomb: 'each player ... they' with no damage trigger", () => {
    expect(controls("Mind Bomb", "discard").every((x) => x !== "opp")).toBe(true);
  });
  test("Tibalt's Trickery: a 'they' that names a player who may be you stays any", () => {
    for (const c of controls("Tibalt's Trickery", "cast")) expect(c).not.toBe("opp");
  });
  test("Elder Mastery: 'enchanted creature deals damage' can be an opponent's creature, so its discard stays any", () => expect(controls("Elder Mastery", "discard")).toEqual(["any"]));
});
