import { expect, test } from "vitest";
import { deriveRow } from "./derive-worker.js";
import { grammarClauseRecords } from "./grammar/clause-record.js";
import { deriveCardTags, foldGrantTwins } from "./derive/derive.js";
import { deriveInputOf } from "./derive-input.js";

// #1376: the card-by-card switch also takes the grammar reading when the stored answer IS the grammar's abilities with exact duplicates.
// Nettling Curse: the card document's fields and the stored `cardClauses.canonical` are dumped from Mongo (the model stored "attacks or blocks" as two records numbered 2).
const SOURCE = {"oracleText": "Enchant creature\nWhenever enchanted creature attacks or blocks, its controller loses 3 life.\n{1}{R}: Enchanted creature attacks this turn if able.", "keywords": ["Enchant"], "typeLine": "Enchantment \u2014 Aura", "name": "Nettling Curse", "manaCost": "{2}{B}", "colors": ["B"], "colorIdentity": ["B", "R"], "manaValue": 3, "layout": "normal"};
const STORED = [{"id":1,"abilityType":"none","actions":[{"verb":"none","object":"Enchant creature","fromZone":null,"toZone":null}]},{"id":2,"abilityType":"triggered","trigger":{"event":"attacks","subject":"enchanted creature","control":"any"},"actions":[{"verb":"lose-life","object":"its controller","fromZone":null,"toZone":null,"amount":"3","optional":false}]},{"id":2,"abilityType":"triggered","trigger":{"event":"blocks","subject":"enchanted creature","control":"any"},"actions":[{"verb":"lose-life","object":"its controller","fromZone":null,"toZone":null,"amount":"3","optional":false}]},{"id":3,"abilityType":"activated","actions":[{"verb":"cant","object":"Enchanted creature can't not attack this turn if able","fromZone":null,"toZone":null,"amount":null,"optional":false}]}];

test("Nettling Curse: the stored answer is the grammar's abilities with duplicates, so the switch takes the grammar reading", () => {
  expect(grammarClauseRecords(SOURCE as never).complete).toBe(true);
  const stored = deriveRow({ doc: { oracleId: "93d575b3-0fff-4fc6-85c6-3a8a9d672d6f", name: SOURCE.name, canonical: STORED } as never, source: SOURCE, isToken: false });
  expect(stored.fromGrammar).toBe(true);
});

// #1391: the keyword-grant twin fold runs AFTER the switch, on the tags it picks. The switch decides on the unfolded readings (folding first moved 39 cards model->grammar).
test("Colossus of Akros: deriveRow returns folded abilities, and the switch decided on the unfolded reading", () => {
  const source = { oracleText: "As long as this creature is monstrous, it has trample and can attack as though it didn't have defender.", keywords: [], typeLine: "Artifact Creature — Golem", name: "Colossus of Akros", manaCost: "{8}", colors: [], colorIdentity: [], manaValue: 8, layout: "normal" };
  const g = grammarClauseRecords(source as never);
  const unfolded = deriveCardTags(deriveInputOf(source as never, "x", source.name, g.records, undefined, g.readings), { foldGrantTwins: false });
  const twins = unfolded.abilities.filter((a) => a.effect?.kind === "keyword-grant");
  expect(twins).toHaveLength(2);
  const row = deriveRow({ doc: { oracleId: "x", name: source.name, canonical: g.records } as never, source, isToken: false });
  expect(row.fromGrammar).toBe(true);
  expect(row.tags.abilities.filter((a) => a.effect?.kind === "keyword-grant")).toHaveLength(1);
  expect(row.tags.abilities).toEqual(foldGrantTwins(unfolded.abilities));
});
