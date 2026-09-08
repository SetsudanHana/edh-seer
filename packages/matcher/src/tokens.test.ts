import { expect, test } from "vitest";
import type { Card } from "@edh-seer/engine";
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

// Kuja's Wizard part carries a printingId that distinguishes it from three other Wizard oracle_ids
// sharing the same name and typeLine — this is the field that makes that resolution exact.
test("a token's printing id rides along on the ref", () => {
  expect(createdTokenRefs(card([
    { component: "token", name: "Wizard", typeLine: "Token Creature — Wizard", printingId: "04ae24bf" },
  ]))).toEqual([{ name: "Wizard", typeLine: "Token Creature — Wizard", printingId: "04ae24bf" }]);
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

/** AN EMBLEM PART IS A REF (spec 2026-09-08). Scryfall lists it as a combo_piece with an
 *  "Emblem — …" type line; every other combo_piece still points at a real card and is excluded. */
test("an Emblem combo_piece is a ref flagged emblem; a card combo_piece is not", () => {
  expect(createdTokenRefs(card([
    { component: "combo_piece", name: "Chandra, Roaring Flame Emblem", typeLine: "Emblem — Chandra", printingId: "4a8123a6" },
    { component: "combo_piece", name: "Magic Origins Checklist", typeLine: "Card", printingId: "f3dcc7b5" },
  ]))).toEqual([{ name: "Chandra, Roaring Flame Emblem", typeLine: "Emblem — Chandra", printingId: "4a8123a6", emblem: true }]);
});
