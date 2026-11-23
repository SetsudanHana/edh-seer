import { expect, test } from "vitest";
import { grammarClauseRecords } from "../grammar/clause-record.js";
import { deriveCardTags } from "./derive.js";
import { deriveAbilities } from "./derive.js";
import { deriveInputOf } from "../derive-input.js";

// #1354: "create a tapped X token" is a creation; the token ARRIVES tapped (CR 110.5b), nothing taps it, so no `tap` action may land in `unclaimed`.
// Oracle texts are the corpus's (Mongo `cards`, 2026-11-23).
const card = (name: string, typeLine: string, oracleText: string, keywords: string[] = []) => ({ name, typeLine, oracleText, keywords });
const ARBALEST = card("Arbalest Engineers", "Creature — Human Artificer", "When this creature enters, choose one —\n• This creature deals 1 damage to any target.\n• Put a +1/+1 counter on target creature. It gains trample and haste until end of turn.\n• Create a tapped Powerstone token. (It's an artifact with \"{T}: Add {C}. This mana can't be spent to cast a nonartifact spell.\")");
const EVIN = card("Evin, Waterdeep Opportunist", "Legendary Creature — Human Rogue", "Menace\nWard—Sacrifice a creature.\nEvin gets +2/+0 for each Treasure you control.\nWhenever one or more players sacrifice one or more creatures, you create a tapped Treasure token. This ability triggers only once each turn.", ["Treasure", "Menace", "Ward"]);
const DYING = card("Dying to Serve", "Enchantment", "Whenever you discard one or more cards, create a tapped 2/2 black Zombie creature token. This ability triggers only once each turn.");
const OPPOSITION = card("Opposition", "Enchantment", "Tap an untapped creature you control: Tap target artifact, creature, or land.");

const tagsOf = (c: ReturnType<typeof card>) => {
  const g = grammarClauseRecords(c);
  return deriveCardTags(deriveInputOf(c as never, "x", c.name, g.records, undefined, g.readings));
};

test("a tapped token's creation leaves no tap in unclaimed, and the token is still read tapped (grammar path)", () => {
  for (const c of [ARBALEST, EVIN, DYING]) {
    const tags = tagsOf(c);
    expect((tags.unclaimed ?? []).filter((a) => a.verb === "tap"), c.name).toEqual([]);
    expect(tags.abilities.some((a) => (a.emits ?? []).some((e) => e.verb === "create-token")), c.name).toBe(true);
  }
  // the created token's own text still says tapped
  const creates = grammarClauseRecords(DYING).records.flatMap((r) => r.actions ?? []).filter((a) => a.verb === "create");
  expect(creates.map((a) => a.object)).toEqual(["a tapped 2/2 black Zombie creature token"]);
});

test("the stored model's companion tap of a created tapped token is silent too (Covetous Elegy shape)", () => {
  const { unclaimed } = deriveAbilities(
    [{ id: 1, abilityType: "spell", actions: [{ verb: "create", object: "a tapped Treasure token", amount: "1" }, { verb: "tap", object: "a tapped Treasure token" }] }],
    "Covetous Elegy", { 1: "Then you create a tapped Treasure token for each creature your opponents control." },
  );
  expect(unclaimed.filter((a) => a.verb === "tap")).toEqual([]);
});

test("a real tap is untouched (Opposition: tap target artifact, creature, or land)", () => {
  const tags = tagsOf(OPPOSITION);
  const taps = tags.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "taps");
  expect(taps.length).toBeGreaterThan(0);
});
