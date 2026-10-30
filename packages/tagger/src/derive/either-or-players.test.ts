import { describe, expect, test } from "vitest";
import { deriveCardTags } from "./derive.js";
import { deriveInputOf } from "../derive-input.js";
import { segment } from "../segment.js";

// #1401 families F (either/or) and G (player subject). Oracle text and stored model clauses read from the corpus 2026-10-30.
const via = (name: string, typeLine: string, oracleText: string, clauses: unknown[]) => {
  const texts: Record<number, string> = {};
  for (const c of segment(oracleText, [], typeLine)) texts[c.id] = c.text;
  return deriveCardTags({ ...deriveInputOf({ name, typeLine, oracleText, keywords: [] } as never, "x", name, clauses as never), clauseTexts: texts });
};
const act = (verb: string, object: string, extra: object = {}) => ({ verb, object, fromZone: null, toZone: null, amount: null, optional: false, ...extra });
const ENCHANT = { id: 1, abilityType: "none", actions: [{ verb: "none", object: "Enchant player" }] };
const ATTACKED = { event: "attacks", subject: "enchanted player", control: "any" };

describe("F: one printed either/or is ONE ability", () => {
  test("Molten Sentry: the heads and tails animates are one animate", () => {
    const tags = via("Molten Sentry", "Creature — Elemental",
      "As this creature enters, flip a coin. If the coin comes up heads, this creature enters as a 5/2 creature with haste. If it comes up tails, this creature enters as a 2/5 creature with defender.",
      [{ id: 1, abilityType: "static", actions: [act("flip-coin", "a coin"), act("animate", "this creature as a 5/2 creature with haste"), act("animate", "this creature as a 2/5 creature with defender")] }]);
    expect(tags.abilities.filter((a) => a.effect.kind === "animate")).toHaveLength(1);
    expect(tags.abilities.some((a) => (a.emits ?? []).some((e) => e.verb === "flip-coin"))).toBe(true);
  });

  test("Giant Shark: 'blocks or becomes blocked' is one pump, not two trigger-less twins", () => {
    const tags = via("Giant Shark", "Creature — Shark",
      "This creature can't attack unless defending player controls an Island.\nWhenever this creature blocks or becomes blocked by a creature that has been dealt damage this turn, this creature gets +2/+0 and gains trample until end of turn.\nWhen you control no Islands, sacrifice this creature.",
      [{ id: 1, abilityType: "static", actions: [act("cant", "attack unless defending player controls an Island")] },
        { id: 2, abilityType: "triggered", trigger: { event: "blocks", subject: "this creature", control: "you" }, actions: [act("modify-pt", "this creature +2/+0 and gains trample until end of turn")] },
        { id: 2, abilityType: "triggered", trigger: { event: "becomes-blocked", subject: "this creature", control: "you" }, actions: [act("modify-pt", "this creature +2/+0 and gains trample until end of turn")] },
        { id: 3, abilityType: "triggered", trigger: { event: "state", subject: "you control no Islands", control: "you" }, actions: [act("sacrifice", "this creature")] }]);
    expect(tags.abilities.filter((a) => a.effect.kind === "pump")).toHaveLength(1);
  });
});

describe("G: distinct actors get distinct subjects", () => {
  test("Curse of Opulence: you create a Gold token, each attacking opponent creates one", () => {
    const tags = via("Curse of Opulence", "Enchantment — Aura Curse",
      "Enchant player\nWhenever enchanted player is attacked, create a Gold token. Each opponent attacking that player does the same. (A Gold token is an artifact with \"Sacrifice this token: Add one mana of any color.\")",
      [ENCHANT, { id: 2, abilityType: "triggered", trigger: ATTACKED, actions: [act("create", "a Gold token", { amount: "1" }), act("create", "a Gold token", { amount: "1" })] }]);
    const makers = tags.abilities.filter((a) => a.effect.kind === "token-generation");
    expect(makers.map((a) => a.effect.subject?.control)).toEqual(["you", "opp"]);
    expect(makers.map((a) => (a.emits ?? []).find((e) => e.verb === "create-token")?.subject.control)).toEqual(["you", "opp"]);
  });

  test("Curse of Disturbance: the second maker keeps the first's count", () => {
    const tags = via("Curse of Disturbance", "Enchantment — Aura Curse",
      "Enchant player\nWhenever enchanted player is attacked, create a 2/2 black Zombie creature token. Each opponent attacking that player does the same.",
      [ENCHANT, { id: 2, abilityType: "triggered", trigger: ATTACKED, actions: [act("create", "a 2/2 black Zombie creature token", { amount: "1" }), act("create", "a 2/2 black Zombie creature token")] }]);
    const makers = tags.abilities.filter((a) => a.effect.kind === "token-generation");
    expect(makers.map((a) => a.effect.subject?.control)).toEqual(["you", "opp"]);
    expect(makers[1]!.amount).toBe(makers[0]!.amount);
  });

  test("Cruel Entertainment: players controlling players is no gains-control of a permanent (CR 723.3)", () => {
    const tags = via("Cruel Entertainment", "Sorcery",
      "Choose target player and another target player. The first player controls the second player during the second player's next turn, and the second player controls the first player during the first player's next turn.",
      [{ id: 1, abilityType: "spell", actions: [act("gain-control", "the second player during the second player's next turn"), act("gain-control", "the first player during the first player's next turn")] }]);
    expect(tags.abilities.filter((a) => (a.emits ?? []).some((e) => e.verb === "gains-control"))).toHaveLength(0);
    expect(tags.unclaimed?.filter((u) => u.verb === "gain-control")).toHaveLength(2);
  });
});

describe("F: the trigger-less fold keeps two actors", () => {
  test("Zurzoth: 'one or more Devils' is no either/or; you and those players each draw stay two draws", () => {
    const tags = via("Zurzoth, Chaos Rider", "Legendary Creature — Devil",
      "Whenever one or more Devils you control attack one or more players, you and those players each draw a card, then discard a card at random.",
      [{ id: 1, abilityType: "triggered", trigger: { event: "attacks", subject: "one or more Devils you control", control: "you" }, actions: [act("draw", "you"), act("discard", "a card at random"), act("draw", "those players"), act("discard", "a card at random")] }]);
    expect(tags.abilities.filter((a) => a.effect.kind === "draw-card").length).toBeGreaterThanOrEqual(2);
  });
});
