import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { expect, test } from "vitest";
import { alignVerbs, parseActions } from "./action.js";

// Every effect below is printed text from the action census (`packages/tagger/actions.jsonl.gz`).
const read = (effect: string, cost?: string) => parseActions(effect, "spell", cost);

test("draw, mill, scry, surveil: the amount as the store spells it, the object a card", () => {
  expect(read("Draw two cards.")).toMatchObject([{ verb: "draw", amount: "2", text: "two cards" }]);
  expect(read("Target player mills thirteen cards.")).toMatchObject([{ verb: "mill", amount: "13", actor: { control: "any", scope: "target" } }]);
  expect(read("Scry 2.")).toMatchObject([{ verb: "scry", amount: "2" }]);
  expect(read("Draw a card for each creature you control.")).toMatchObject([{ verb: "draw", amount: "for each creature you control" }]);
  expect(read("Draw X cards, where X is that creature's power.")).toMatchObject([{ verb: "draw", amount: "X" }]);
});

test("phrases split on the printed joints; an actor carries to the phrases after it", () => {
  expect(read("Draw a card, then discard a card.").map((r) => r.verb)).toEqual(["draw", "discard"]);
  expect(read("Target player draws two cards and loses 2 life.")).toMatchObject([{ verb: "draw", actor: { scope: "target" } }]);
  expect(read("Target opponent draws a card. You draw two cards.")).toMatchObject([
    { verb: "draw", actor: { control: "opp" } }, { verb: "draw", actor: { control: "you" } },
  ]);
  expect(read("You and target opponent each draw three cards.")).toMatchObject([
    { verb: "draw", actor: { control: "you" } }, { verb: "draw", actor: { control: "opp" } },
  ]);
});

test("conditions are KEPT on the action (owner, 2026-10-01); 'you may' is optional, and so is its 'if you do'", () => {
  expect(read("you may pay {2}. If you do, draw a card.")).toMatchObject([{ verb: "draw", condition: "if you do", optional: true }]);
  expect(read("Draw a card at the beginning of the next turn's upkeep.")).toMatchObject([{ verb: "draw", condition: "at the beginning of the next turn's upkeep" }]);
  expect(read("you may discard a card. If you do, draw a card.")).toMatchObject([{ verb: "discard", optional: true }, { verb: "draw", optional: true }]);
});

test("discard and search: a whole hand, a class, one search per zone named", () => {
  expect(read("Each player discards their hand, then draws seven cards.")).toMatchObject([{ verb: "discard", amount: "all", actor: { scope: "each" } }, { verb: "draw", amount: "7" }]);
  expect(read("Target player discards a card at random.")).toMatchObject([{ verb: "discard", amount: "1" }]);
  expect(read("you may search your library for a basic land card, put it onto the battlefield tapped, then shuffle.")[0])
    .toMatchObject({ verb: "search", fromZone: "library", object: { type: "land", basic: true }, text: "a basic land card", optional: true });
  expect(read("Search target player's graveyard, hand, and library for any number of cards with that name and exile them.").map((r) => r.fromZone))
    .toEqual(["graveyard", "hand", "library"]);
});

test("a cost's actions come first, the cost's own words read the same way", () => {
  expect(read("Create a Treasure token.", "{U/R}{U/R}, Discard this card")).toMatchObject([{ verb: "discard", object: { self: true } }]);
  // A cost the segmenter left in the text is still a cost; ability words and table rows are labels.
  expect(read("Crescent Fang — Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.")[0]?.verb).toBe("search");
});

test("readings align to stored actions by verb, in order", () => {
  expect(alignVerbs(["sacrifice", "draw"], ["draw"])).toEqual([[1, 0]]);
  expect(alignVerbs(["search", "search", "search", "exile", "shuffle"], ["search", "search", "search"])).toEqual([[0, 0], [1, 1], [2, 2]]);
});

test("over the census: deterministic, and draw/search coverage not below its floor", () => {
  const FAMILY = new Set(["draw", "discard", "mill", "scry", "surveil", "search", "reveal"]);
  const rows = gunzipSync(readFileSync(new URL("../../actions.jsonl.gz", import.meta.url))).toString("utf8").trim().split("\n")
    .map((l) => JSON.parse(l) as { effect: string; type: string | null; cost?: string; actions: { verb: string }[]; cards: number });
  let total = 0, got = 0;
  for (const r of rows) {
    const a = parseActions(r.effect, r.type, r.cost);
    expect(JSON.stringify(parseActions(r.effect, r.type, r.cost))).toBe(JSON.stringify(a));
    const hit = new Set(alignVerbs(r.actions.map((x) => x.verb), a.map((x) => x.verb)).map(([i]) => i));
    r.actions.forEach((x, i) => { if (FAMILY.has(x.verb)) { total += r.cards; if (hit.has(i)) got += r.cards; } });
  }
  // A RATCHET, raised as coverage grows. 2.0% of stored draw/search actions print no such verb in
  // their clause text at all (an empty text, or an action the store filed under the wrong clause).
  expect(got / total).toBeGreaterThanOrEqual(0.945);
}, 120000);
