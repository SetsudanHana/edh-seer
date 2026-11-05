import { expect, test } from "vitest";
import { deriveCardTags } from "../derive/derive.js";
import { deriveInputOf } from "../derive-input.js";
import { grammarClauseRecords } from "./clause-record.js";
import { damageSourceOf } from "../derive/replacement.js";

/** #1537: a damage multiplier keeps the controller, type and colour of the source it names, on the grammar path. Oracle text is the corpus's (Scryfall). */
const multipliers = (name: string, typeLine: string, oracleText: string) => {
  const card = { name, typeLine, oracleText, keywords: [] as string[] };
  const g = grammarClauseRecords(card);
  expect(g.complete, name).toBe(true);
  const tags = deriveCardTags(deriveInputOf(card, name, name, g.records, undefined, g.readings));
  return tags.abilities.filter((a) => a.effect?.kind === "damage-multiplier");
};

test("Insult // Injury: 'a source you control' is control you on the effect subject and the double emit", () => {
  const [a] = multipliers("Insult // Injury", "Instant // Sorcery — Adventure",
    "Damage can't be prevented this turn. If a source you control would deal damage this turn, it deals double that damage instead.\n//\nAftermath (Cast this spell only from your graveyard. Then exile it.)\nInjury deals 2 damage to target creature and 2 damage to target player or planeswalker.");
  expect(a!.effect.subject?.control).toBe("you");
  expect((a!.emits ?? []).map((e) => [e.verb, e.subject.control])).toEqual([["double", "you"]]);
});

test("Goblin Goliath: the effect subject agrees with its trigger (you)", () => {
  const [a] = multipliers("Goblin Goliath", "Creature — Goblin",
    "When this creature enters, create a number of 1/1 red Goblin creature tokens equal to the number of opponents you have.\n{3}{R}, {T}: If a source you control would deal damage to an opponent this turn, it deals double that damage to that player instead.");
  expect(a!.trigger?.subject.control).toBe("you");
  expect(a!.effect.subject?.control).toBe("you");
});

test("Fiery Emancipation and Torbran keep 'you control' (and Torbran's red) on the trigger", () => {
  const [f] = multipliers("Fiery Emancipation", "Enchantment", "If a source you control would deal damage to a permanent or player, it deals triple that damage to that permanent or player instead.");
  expect(f!.trigger?.subject.control).toBe("you");
  const [t] = multipliers("Torbran, Thane of Red Fell", "Legendary Creature — Dwarf Noble", "If a red source you control would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus 2 instead.");
  expect(t!.trigger?.subject).toMatchObject({ control: "you", colors: ["R"] });
});

test("Furnace of Rath reads any", () => {
  const [a] = multipliers("Furnace of Rath", "Enchantment", "If a source would deal damage to a permanent or player, it deals double that damage to that permanent or player instead.");
  expect(a!.trigger?.subject.control).toBe("any");
  expect(a!.effect.subject?.control ?? "any").toBe("any");
});

test("damageSourceOf names the source before 'would deal', an opponent's too", () => {
  expect(damageSourceOf("If a red source you control would deal damage, it deals double that damage instead.")).toBe("a red source you control");
  expect(damageSourceOf("If a source an opponent controls would deal damage to you, it deals half that damage instead.")).toBe("a source an opponent controls");
  expect(damageSourceOf("If you win the flip, the next time that source would deal damage, it deals double.")).toBeUndefined();
  expect(damageSourceOf("Draw a card.")).toBeUndefined();
});
