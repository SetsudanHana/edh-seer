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

// #1391: the keyword-grant twin fold runs AFTER the switch, on the tags it picks. Sparkspitter (real stored data dumped from Mongo): its grammar reading reads the token's
// "trample, haste" as a keyword-grant pair. Unfolded the diff key is `abilities:2->5` (unlabelled), so the model reading stays; folded first it would be the labelled
// `abilities:2->4` ("grammar right") and the card would switch to a worse reading.
const SPARK = {"name":"Sparkspitter","oracleText":"{R}, {T}, Discard a card: Create a 3/1 red Elemental creature token named Spark Elemental. It has trample, haste, and \"At the beginning of the end step, sacrifice this token.\"","typeLine":"Creature \u2014 Elemental Spellshaper","keywords":[],"manaCost":"{2}{R}","colors":["R"],"colorIdentity":["R"],"manaValue":3,"power":"1","toughness":"3"};
const SPARK_STORED = [{"id":1,"abilityType":"activated","actions":[{"verb":"discard","object":"a card","fromZone":null,"toZone":null,"amount":null,"optional":false},{"verb":"create","object":"a 3/1 red Elemental creature token named Spark Elemental with trample, haste, and this ability","fromZone":null,"toZone":null,"amount":"1","optional":false}]},{"id":2,"abilityType":"triggered","trigger":{"event":"end-step","subject":"you","control":"you"},"actions":[{"verb":"sacrifice","object":"this token","fromZone":null,"toZone":null,"amount":null,"optional":false}]}];
test("Sparkspitter keeps its model reading: the switch keys UNFOLDED readings (#1391)", () => {
  const row = deriveRow({ doc: { oracleId: "0fbec99f-0e49-4211-a06e-edd783cf47da", name: SPARK.name, canonical: SPARK_STORED } as never, source: SPARK, isToken: false });
  expect(row.fromGrammar).toBe(false);
});

test("Colossus of Akros: deriveRow returns folded abilities (the unfolded derive has two keyword-grant twins)", () => {
  const source = { oracleText: "As long as this creature is monstrous, it has trample and can attack as though it didn't have defender.", keywords: [], typeLine: "Artifact Creature \u2014 Golem", name: "Colossus of Akros", manaCost: "{8}", colors: [], colorIdentity: [], manaValue: 8, layout: "normal" };
  const g = grammarClauseRecords(source as never);
  const unfolded = deriveCardTags(deriveInputOf(source as never, "x", source.name, g.records, undefined, g.readings), { foldGrantTwins: false });
  expect(unfolded.abilities.filter((a) => a.effect?.kind === "keyword-grant")).toHaveLength(2);
  const row = deriveRow({ doc: { oracleId: "x", name: source.name, canonical: g.records } as never, source, isToken: false });
  expect(row.tags.abilities.filter((a) => a.effect?.kind === "keyword-grant")).toHaveLength(1);
  expect(row.tags.abilities).toEqual(foldGrantTwins(unfolded.abilities));
});

// #1391 F2 review: "you and <player> each draw", through the pipeline's row (the model's stored answer, or the grammar's when the switch takes it). Oracle text and stored records dumped from Mongo 2026-10-28.
const act = (verb: string, object: string, amount: string | null = null) => ({ verb, object, amount, fromZone: null, toZone: null, optional: false });
const drawers = (source: { name: string; oracleText: string; typeLine: string; keywords: string[] }, canonical: unknown[], verb = "draw") => {
  const row = deriveRow({ doc: { oracleId: "x", name: source.name, canonical } as never, source: source as never, isToken: false });
  return row.tags.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === verb).map((e) => e.subject.control);
};
test("Diviner Spirit and Black Widow: the damaged player's draw is never `you` (F2 review)", () => {
  const diviner = { name: "Diviner Spirit", typeLine: "Creature \u2014 Spirit", keywords: [], oracleText: "Whenever this creature deals combat damage to a player, you and that player each draw that many cards." };
  expect(drawers(diviner, [{ id: 1, abilityType: "triggered", trigger: { event: "damage-dealt", subject: "this creature", control: "you" }, actions: [act("draw", "you", "that many"), act("draw", "that player", "that many")] }])).toEqual(["any", "any"]);
  const widow = { name: "Black Widow, Intel Expert", typeLine: "Legendary Creature \u2014 Human Spy Hero", keywords: ["First strike"], oracleText: "First strike\nWhenever Black Widow deals combat damage to an opponent, you and that player each draw two cards." };
  expect(drawers(widow, [{ id: 2, abilityType: "triggered", trigger: { event: "damage-dealt", subject: "this creature", control: "you" }, actions: [act("draw", "you", "2"), act("draw", "that player", "2")] }])).toEqual(["any", "any"]);
});
test("Cait, Cage Brawler: the defending player's draw and discard are theirs, not yours (F2 review)", () => {
  const cait = { name: "Cait, Cage Brawler", typeLine: "Legendary Creature \u2014 Human Warrior", keywords: [], oracleText: "During your turn, Cait has indestructible.\nWhenever Cait attacks, you and defending player each draw a card, then discard a card. Put two +1/+1 counters on Cait if you discarded the card with the greatest mana value among those cards or tied for greatest." };
  const stored = [{ id: 1, abilityType: "static", actions: [act("grant-ability", "indestructible")] }, { id: 2, abilityType: "triggered", trigger: { event: "attacks", subject: "this creature", control: "you" }, actions: [act("draw", "you"), act("draw", "defending player"), act("discard", "you"), act("discard", "defending player"), act("add-counter", "+1/+1", "2")] }];
  expect(drawers(cait, stored)).toEqual(["you", "opp"]);
  expect(drawers(cait, stored, "discard")).toEqual(["you", "opp"]);
});
