import { expect, test } from "vitest";
import type { LlmProvider } from "./llm/provider.js";
import { normalizeCard } from "./normalize-card.js";

/** Fails the test if it is ever called — the point is that it must not be. */
const neverCalled: LlmProvider = {
  model: "test",
  chat: async () => { throw new Error("the model was called for an all-inert card"); },
};

test("an all-inert card is answered in code, with no model call", async () => {
  // A vanilla creature with only printed keywords has nothing askable. Sending an empty clause list
  // and paying for the reply is both wasteful and pointless: the answer is already known.
  const res = await normalizeCard(neverCalled, {
    name: "Vanilla Bear", oracleText: "Flying, trample", keywords: ["Flying", "Trample"],
    typeLine: "Creature — Bear",
  });
  expect(res.rejected).toEqual([]);
  expect(res.clauses).toHaveLength(1);
  expect(res.clauses[0].actions?.[0]).toMatchObject({ verb: "none", object: "Flying, trample" });
  // Still a complete record: the clause keeps its slot, so nothing downstream sees a gap.
  expect(res.clauses[0].id).toBe(1);
});

test("a card with a real ability does call the model", async () => {
  let called = false;
  const provider: LlmProvider = {
    model: "test",
    chat: async () => { called = true; return JSON.stringify({ clauses: [{ id: 1, abilityType: "spell", actions: [{ verb: "draw", object: "you" }] }] }); },
  };
  const res = await normalizeCard(provider, {
    name: "Ancestral Recall", oracleText: "Target player draws three cards.", keywords: [], typeLine: "Instant",
  });
  expect(called).toBe(true);
  expect(res.rejected).toEqual([]);
});
