import { expect, test } from "vitest";
import type { DeckSuggestions } from "@edh-seer/matcher/suggest-static";
import { engineDeck } from "./engine-model.fixture.js";
import { PRECON_SWAPS, preconPage } from "./precon-page.js";

const meta = { slug: "test-deck-test-set", name: "Test Deck", setCode: "TST", setName: "Test Set", releaseDate: "2026-01-01", commanders: ["Commander"] };
const add = (name: string, n: number) => ({ name, slug: name.toLowerCase(), identity: [], mv: 2, connections: Array.from({ length: n }, (_, i) => `c${i}`), reasons: [{ text: `${name} works`, others: [] }] });

test("a precon page: the commander's links, swaps with both counts, and the list without the commander", () => {
  const { report, graph } = engineDeck();
  const suggestions = {
    build: {}, answers: {}, synergy: {}, plan: [], routes: [],
    pairs: Array.from({ length: PRECON_SWAPS + 2 }, (_, i) => ({ cut: `Cut ${i}`, cutConnections: 3, add: add(`Add ${i}`, 20 - i), rule: "no-role" as const, counts: [] })),
  } as DeckSuggestions;
  const page = preconPage(meta, { report, graph, missing: [], resolvedCount: 0, totalCount: 0, commanderColorIdentity: ["B"] } as never, suggestions);
  expect(page.commanderLinks).toBeGreaterThan(0);
  expect(page.swaps).toHaveLength(PRECON_SWAPS);
  expect(page.swaps[0]).toEqual({ out: { name: "Cut 0", connections: 3 }, in: { name: "Add 0", slug: "add 0", connections: 20, reason: "Add 0 works" } });
  const listed = page.decklist.flatMap((g) => g.cards.map((c) => c.name));
  expect(listed).not.toContain("Commander");
  expect(listed.length).toBeGreaterThan(0);
  // Names only: nothing on a page carries a card's rules text.
  expect(JSON.stringify(page)).not.toMatch(/oracle/i);
});

test("with no suggestions the page still stands, with no swaps and no route", () => {
  const { report, graph } = engineDeck();
  const page = preconPage(meta, { report, graph, missing: [], resolvedCount: 0, totalCount: 0, commanderColorIdentity: [] } as never, null);
  expect(page.swaps).toEqual([]);
  expect(page.route).toBeNull();
});
