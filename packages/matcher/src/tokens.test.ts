import { expect, test } from "vitest";
import type { Card } from "@mtg/engine";
import { createdTokenRefs } from "./tokens.js";

const card = (allParts: unknown): Card => ({ name: "X", typeLine: "Artifact", allParts } as unknown as Card);

// 413 of the 424 clause-corpus cards that create a token resolve through allParts (97.4%), and the
// join is (name, typeLine) — which is what separates the three different Wizard tokens.
test("a card's created tokens come from allParts, deduped", () => {
  expect(createdTokenRefs(card([
    { component: "token", name: "Treasure", typeLine: "Token Artifact — Treasure" },
    { component: "token", name: "Treasure", typeLine: "Token Artifact — Treasure" },
  ]))).toEqual([{ name: "Treasure", typeLine: "Token Artifact — Treasure" }]);
});

test("only token parts count, and a card with none yields none", () => {
  // meld_part / combo_piece point at real CARDS, not tokens — including them would put a card on the
  // graph twice, once as itself and once as a phantom token.
  expect(createdTokenRefs(card([
    { component: "meld_part", name: "Hanweir Battlements", typeLine: "Land" },
    { component: "combo_piece", name: "Thing", typeLine: "Creature" },
  ]))).toEqual([]);
  expect(createdTokenRefs(card(undefined))).toEqual([]);
});
