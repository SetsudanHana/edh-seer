import { expect, test } from "vitest";
import { grammarClauseRecords, triggerSubjectText } from "./clause-record.js";

// #896 task 7: clause records from printed text alone.
test("a card the grammar reads completely gets one record per clause, in the store's shape", () => {
  const farseek = grammarClauseRecords({ name: "Farseek", typeLine: "Sorcery", oracleText: "Search your library for a Plains, Island, Swamp, or Mountain card, put it onto the battlefield tapped, then shuffle." });
  expect(farseek.complete).toBe(true);
  const [rec] = farseek.records;
  expect(rec).toMatchObject({ id: 1, abilityType: "spell" });
  // The back-reference keeps its printed words, and comes from the library the search named.
  expect(rec!.actions!.find((a) => a.verb === "put")).toMatchObject({ object: "it", fromZone: "library", toZone: "battlefield" });
});

test("a clause the grammar cannot read blocks the card, and says which", () => {
  const g = grammarClauseRecords({ name: "X", typeLine: "Sorcery", oracleText: "Redistribute any number of players' life totals." });
  expect(g.complete).toBe(false);
  expect(g.blocker).toMatchObject({ clause: 1, kind: "action" });
});

test("a trigger's subject is what the event happens to, and an actor trigger's object", () => {
  expect(triggerSubjectText("Whenever this creature or another creature dies")).toBe("this creature or another creature");
  expect(triggerSubjectText("Whenever you discard a card")).toBe("a card");
});

test("a self trigger's first 'it' is the card itself, and a player verb names its player", () => {
  const junk = grammarClauseRecords({ name: "Wall of Junk", typeLine: "Artifact Creature — Wall", oracleText: "When this creature blocks, return it to its owner's hand at end of combat." });
  expect(junk.records[0]!.actions![0]).toMatchObject({ verb: "return", object: "this creature" });
  const barrier = grammarClauseRecords({ name: "Barrier of Bones", typeLine: "Creature — Skeleton Wall", oracleText: "When this creature enters, surveil 1." });
  expect(barrier.records[0]!.actions![0]).toMatchObject({ verb: "surveil", amount: "1" });
});

test("a phase trigger's subject is whose phase", () => {
  expect(triggerSubjectText("At the beginning of your upkeep")).toBe("you");
  expect(triggerSubjectText("At the beginning of each upkeep")).toBe("each player");
});

test("a proliferate chooses any permanent; support names other creatures; a token list is one create per kind", () => {
  const tide = grammarClauseRecords({ name: "Inexorable Tide", typeLine: "Enchantment", oracleText: "Whenever you cast a spell, proliferate." });
  expect(tide.records[0]!.actions![0]).toMatchObject({ verb: "proliferate", object: "any" });
  const patron = grammarClauseRecords({ name: "Generous Patron", typeLine: "Creature — Elf Advisor", oracleText: "When this creature enters, support 2." });
  expect(patron.records[0]!.actions![0]).toMatchObject({ verb: "support", object: "other target creatures", amount: "2" });
  const cotton = grammarClauseRecords({ name: "Farmer Cotton", typeLine: "Legendary Creature — Halfling Peasant", oracleText: "When this creature enters, create X 1/1 white Halfling creature tokens and X Food tokens." });
  expect(cotton.records[0]!.actions!.map((a) => a.object)).toEqual(["X 1/1 white Halfling creature tokens", "X Food tokens"]);
});

test("spells given affinity are a cost reduction, the store's form", () => {
  const pearl = grammarClauseRecords({ name: "Pearl-Ear, Imperial Advisor", typeLine: "Legendary Creature — Fox Advisor", oracleText: "Enchantment spells you cast have affinity for Auras." });
  expect(pearl.records[0]!.actions![0]).toMatchObject({ verb: "cost-modify" });
});
