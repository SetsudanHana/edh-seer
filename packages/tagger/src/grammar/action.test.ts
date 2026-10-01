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
  // "where X is ..." is the counted thing as the amount, the store's form and what scaling reads.
  expect(read("Draw X cards, where X is that creature's power.")).toMatchObject([{ verb: "draw", amount: "that creature's power" }]);
  expect(read("Target opponent sacrifices a creature or planeswalker, discards a card, and loses 3 life.")).toMatchObject([
    { verb: "discard", actor: { control: "opp" } }, { verb: "lose-life", text: "target opponent" },
  ]);
});

test("phrases split on the printed joints; an actor carries to the phrases after it", () => {
  expect(read("Draw a card, then discard a card.").map((r) => r.verb)).toEqual(["draw", "discard"]);
  expect(read("Target player draws two cards and loses 2 life.")).toMatchObject([
    { verb: "draw", actor: { scope: "target" } }, { verb: "lose-life", text: "target player", actor: { scope: "target" } },
  ]);
  expect(read("Target opponent draws a card. You draw two cards.")).toMatchObject([
    { verb: "draw", actor: { control: "opp" } }, { verb: "draw", actor: { control: "you" } },
  ]);
  // "you and X each": one action per player, no actor text (the store writes the pair as one or two).
  expect(read("You and target opponent each draw three cards.")).toMatchObject([
    { verb: "draw", amount: "3", actor: { control: "any", scope: "each" } }, { verb: "draw", amount: "3", actor: { control: "any", scope: "each" } },
  ]);
  expect(read("you and those players each draw a card, then discard a card at random.").map((r) => [r.verb, r.actor?.text]))
    .toEqual([["draw", undefined], ["discard", undefined], ["draw", undefined], ["discard", undefined]]);
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

test("damage and life: the recipient is the object, the dealer is not the actor, one action per recipient", () => {
  expect(read("~ deals 3 damage to any target.")).toMatchObject([{ verb: "deal-damage", amount: "3", text: "any target", object: { scope: "target" } }]);
  expect(read("This creature deals 2 damage to any target and 3 damage to you.")).toMatchObject([
    { verb: "deal-damage", amount: "2", text: "any target" }, { verb: "deal-damage", amount: "3", text: "you" },
  ]);
  expect(read("Target creature you control deals damage equal to its power to target creature an opponent controls."))
    .toMatchObject([{ verb: "deal-damage", amount: "its power", object: { type: "creature", control: "opp" } }]);
  expect(read("~ deals 2 damage divided as you choose among one or two targets.")).toMatchObject([{ verb: "deal-damage", amount: "2", object: { scope: "target" } }]);
  expect(read("you may have it deal 1 damage to any target.")).toMatchObject([{ verb: "deal-damage", optional: true }]);
  // A life change's object is the player, as the store writes it.
  expect(read("each opponent loses 1 life and you gain 1 life.")).toMatchObject([
    { verb: "lose-life", amount: "1", text: "each opponent" }, { verb: "gain-life", amount: "1", text: "you" },
  ]);
  expect(read("You gain 2 life for each creature you control.")).toMatchObject([{ verb: "gain-life", amount: "2 for each creature you control" }]);
  expect(read("As an additional cost to cast this spell, pay X life.")).toMatchObject([{ verb: "lose-life", amount: "X" }]);
  expect(read("Your life total becomes 10.")).toMatchObject([{ verb: "set-life", amount: "10" }]);
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

test.each([
  ["draw/search", ["draw", "discard", "mill", "scry", "surveil", "search", "reveal"], 0.945],
  ["damage/life", ["deal-damage", "gain-life", "lose-life", "set-life"], 0.895],
])("over the census: deterministic, and %s coverage not below its floor", (_name, verbs, floor) => {
  const FAMILY = new Set(verbs as string[]);
  const rows = gunzipSync(readFileSync(new URL("../../actions.jsonl.gz", import.meta.url))).toString("utf8").trim().split("\n")
    .map((l) => JSON.parse(l) as { effect: string; type: string | null; cost?: string; actions: { verb: string }[]; cards: number });
  let total = 0, got = 0;
  for (const r of rows) {
    const a = parseActions(r.effect, r.type, r.cost);
    expect(JSON.stringify(parseActions(r.effect, r.type, r.cost))).toBe(JSON.stringify(a));
    const fam = (v: string) => FAMILY.has(v);
    const si = r.actions.flatMap((x, i) => (fam(x.verb) ? [i] : [])), ri = a.flatMap((x, j) => (fam(x.verb) ? [j] : []));
    const hit = new Set(alignVerbs(si.map((i) => r.actions[i]!.verb), ri.map((j) => a[j]!.verb)).map(([i]) => si[i]));
    r.actions.forEach((x, i) => { if (FAMILY.has(x.verb)) { total += r.cards; if (hit.has(i)) got += r.cards; } });
  }
  // A RATCHET per family, raised as coverage grows. 2.0% of stored draw/search actions print no such
  // verb in their clause text at all (an empty text, or an action filed under the wrong clause).
  expect(got / total).toBeGreaterThanOrEqual(floor as number);
}, 120000);
