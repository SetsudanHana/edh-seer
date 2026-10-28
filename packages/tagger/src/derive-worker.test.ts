import { expect, test } from "vitest";
import { deriveRow } from "./derive-worker.js";
import { grammarClauseRecords } from "./grammar/clause-record.js";

// #1376: the card-by-card switch also takes the grammar reading when the stored answer IS the grammar's abilities with exact duplicates (the same ability emitted twice from one clause).
// Howling Golem's text (the same sentence derive.test.ts reads); the stored record carries its draw action twice.
test("a stored answer that is the grammar's abilities with exact duplicates switches to the grammar reading", () => {
  const source = { oracleText: "Whenever this creature attacks or blocks, each player draws a card.", keywords: [], typeLine: "Artifact Creature — Golem", name: "Howling Golem", manaCost: "{4}", colors: [], colorIdentity: [], power: "3", toughness: "3", manaValue: 4 };
  const g = grammarClauseRecords(source as never);
  expect(g.complete).toBe(true);
  const [first, ...rest] = g.records;
  const doubled = { ...first!, actions: [...(first!.actions ?? []), ...(first!.actions ?? [])] };
  const row = (canonical: typeof g.records) => deriveRow({ doc: { oracleId: "x", name: source.name, canonical } as never, source, isToken: false });
  const stored = row([doubled, ...rest]);
  const grammar = row(g.records);
  expect(stored.fromGrammar).toBe(true);
  expect(stored.tags.abilities).toEqual(grammar.tags.abilities);
});
