import { expect, test } from "vitest";
import { parse } from "../grammar/filter.js";
import { copySourceOf, targetSlotsOf } from "./copy-source.js";
import { selfAsTilde } from "../grammar/self-as-tilde.js";

/** #1648: the source a triggered copier names, from its trigger's subject text. */
const of = (t: string | undefined) => copySourceOf(t, parse);

test("a plain source class is the grammar's abilityOf", () => {
  expect(of("an ability of an artifact")).toEqual({ control: "any", type: "artifact" });
  expect(of("a loyalty ability of a Chandra planeswalker")).toEqual({ control: "any", type: "planeswalker", subtype: "chandra" });
});
test("a host is a status on the host's noun", () => {
  expect(of("an ability of equipped creature")).toMatchObject({ type: "creature", status: ["equipped"] });
  expect(of("a loyalty ability of enchanted planeswalker")).toMatchObject({ type: "planeswalker", status: ["enchanted"] });
});
test("a trailing 'that isn't a mana ability' is the kind's, not the source's", () => {
  expect(of("an ability of an artifact or creature that isn't a mana ability")).toEqual({ control: "any", type: ["creature", "artifact"] });
});
test("no source stated: nothing (Rings of Brighthearth, Verrak, Ertha Jo)", () => {
  expect(of("an ability")).toBeUndefined();
  expect(of("an ability that isn't a mana ability")).toBeUndefined();
  expect(of("an ability that targets a creature or player")).toBeUndefined();
  expect(of(undefined)).toBeUndefined();
});

/** What an ability aims at (Ability.targets), read from the clause text. */
const aims = (t: string) => targetSlotsOf([t], undefined, parse, selfAsTilde);
test("targets: a class per phrase, whose it is, and nothing for a relative clause", () => {
  expect(aims("{T}: This creature deals 1 damage to any target.")).toEqual([{}]);
  expect(aims("Target creature you control gains protection from the color of your choice until end of turn.")).toEqual([{ type: "creature", control: "you" }]);
  expect(aims("Destroy target creature with flying an opponent controls.")).toEqual([{ type: "creature", control: "opp" }]);
  expect(aims("Target player gains 3 life.")).toEqual([{ player: true }]);
  expect(aims("Target opponent loses 2 life.")).toEqual([{ player: true, control: "opp" }]);
  expect(aims("Choose target artifact a player controls and target artifact card in that player's graveyard.")).toHaveLength(2);
  expect(aims("Target spell can't be countered.")).toEqual([{ type: "spell" }]);
  expect(aims("Destroy all creatures target player controls.")).toBeUndefined();
  expect(aims("Whenever this creature attacks, destroy target creature defending player controls.")).toEqual([{ type: "creature", control: "opp" }]);
  expect(aims("Whenever this creature attacks, exile up to one target card from a graveyard.")).toEqual([{ type: "card" }]);
  expect(aims("When this creature enters, exile two target lands.")).toEqual([{ type: "land" }, { type: "land" }]);
  expect(aims("Return target permanent card from your graveyard to your hand.")).toEqual([{ type: "card" }]);
  expect(aims("Whenever this creature becomes the target of a spell, it deals damage equal to its power to each opponent.")).toBeUndefined();
  expect(aims("Draw a card.")).toBeUndefined();
});
test("targets: an opponent's permanent said as 'that player controls' and 'defending player controls'", () => {
  expect(aims("When this creature enters, for each opponent, exile up to one target permanent that player controls with mana value 3 or greater.")).toEqual([{ control: "opp" }]);
  expect(aims("Whenever this creature attacks, destroy target creature defending player controls.")).toEqual([{ type: "creature", control: "opp" }]);
});
