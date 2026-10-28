import { expect, test } from "vitest";
import { deriveRow } from "./derive-worker.js";
import { grammarClauseRecords } from "./grammar/clause-record.js";

// #1376: the card-by-card switch also takes the grammar reading when the stored answer IS the grammar's abilities with exact duplicates.
// Nettling Curse: the card document's fields and the stored `cardClauses.canonical` are dumped from Mongo (the model stored "attacks or blocks" as two records numbered 2).
const SOURCE = {"oracleText": "Enchant creature\nWhenever enchanted creature attacks or blocks, its controller loses 3 life.\n{1}{R}: Enchanted creature attacks this turn if able.", "keywords": ["Enchant"], "typeLine": "Enchantment \u2014 Aura", "name": "Nettling Curse", "manaCost": "{2}{B}", "colors": ["B"], "colorIdentity": ["B", "R"], "manaValue": 3, "layout": "normal"};
const STORED = [{"id":1,"abilityType":"none","actions":[{"verb":"none","object":"Enchant creature","fromZone":null,"toZone":null}]},{"id":2,"abilityType":"triggered","trigger":{"event":"attacks","subject":"enchanted creature","control":"any"},"actions":[{"verb":"lose-life","object":"its controller","fromZone":null,"toZone":null,"amount":"3","optional":false}]},{"id":2,"abilityType":"triggered","trigger":{"event":"blocks","subject":"enchanted creature","control":"any"},"actions":[{"verb":"lose-life","object":"its controller","fromZone":null,"toZone":null,"amount":"3","optional":false}]},{"id":3,"abilityType":"activated","actions":[{"verb":"cant","object":"Enchanted creature can't not attack this turn if able","fromZone":null,"toZone":null,"amount":null,"optional":false}]}];

test("Nettling Curse: the stored answer is the grammar's abilities with duplicates, so the switch takes the grammar reading", () => {
  expect(grammarClauseRecords(SOURCE as never).complete).toBe(true);
  const stored = deriveRow({ doc: { oracleId: "93d575b3-0fff-4fc6-85c6-3a8a9d672d6f", name: SOURCE.name, canonical: STORED } as never, source: SOURCE, isToken: false });
  expect(stored.fromGrammar).toBe(true);
});

// #1376 review: the grammar reading of Silverquill Pledgemage ("cast or copy") itself carries a duplicate pair; switching to it is not a cleanup. At derive 400 the card kept its stored answer.
test("Silverquill Pledgemage keeps its stored answer: the grammar reading has duplicates of its own", () => {
  const source = {"oracleText":"Magecraft — Whenever you cast or copy an instant or sorcery spell, this creature gains your choice of flying or lifelink until end of turn.","keywords":["Magecraft"],"typeLine":"Creature — Vampire Cleric","name":"Silverquill Pledgemage","manaCost":"{1}{W/B}{W/B}","colors":["B","W"],"colorIdentity":["B","W"],"manaValue":3,"power":"3","toughness":"1","layout":"normal"};
  const stored = [{"id":1,"abilityType":"triggered","trigger":{"event":"cast","subject":"an instant or sorcery spell","control":"you"},"actions":[{"verb":"grant-ability","object":"this creature gains your choice of flying or lifelink until end of turn","fromZone":null,"toZone":null,"amount":null,"optional":false}]},{"id":2,"abilityType":"triggered","trigger":{"event":"copy","subject":"an instant or sorcery spell","control":"you"},"actions":[{"verb":"grant-ability","object":"this creature gains your choice of flying or lifelink until end of turn","fromZone":null,"toZone":null,"amount":null,"optional":false}]}];
  expect(grammarClauseRecords(source as never).complete).toBe(true);
  expect(deriveRow({ doc: { oracleId: "ff72b900-ce3c-4cc4-a50e-e501e17631ca", name: source.name, canonical: stored } as never, source, isToken: false }).fromGrammar).toBe(false);
});
