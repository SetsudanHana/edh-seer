import { describe, expect, it } from "vitest";
import type { Reason } from "@mtg/engine";
import { projectDeckGraph } from "./graph-projection.js";
import type { DeckCard } from "./types.js";

const W = { kinds: {}, repeatability: {}, scaling: {}, damping: 1 };

function card(name: string, typeLine = "Creature — Human", manaValue = 2): DeckCard {
  return {
    card: {
      name, typeLine, oracleText: "", keywords: [], colors: ["B"], manaValue,
    } as DeckCard["card"],
    tags: null,
  };
}

function reason(producer: string, consumer: string, tag: string): Reason {
  return { tag, text: `${producer} feeds ${consumer}`, producer, consumer };
}

describe("projectDeckGraph", () => {
  it("makes one node per deck card, keyed by name", () => {
    const g = projectDeckGraph([card("Bitterblossom"), card("Zulaport Cutthroat")], [], W);
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["Bitterblossom", "Zulaport Cutthroat"]);
  });

  it("keeps a card with no edges as an isolate, because that is the orphan diagnostic", () => {
    const g = projectDeckGraph([card("Sol Ring", "Artifact")], [], W);
    expect(g.nodes).toHaveLength(1);
    expect(g.edges).toEqual([]);
  });

  it("carries the facets that used to be separate nodes as node fields", () => {
    const g = projectDeckGraph([card("Bitterblossom", "Enchantment — Faerie", 2)], [], W);
    expect(g.nodes[0]).toMatchObject({
      types: ["enchantment"], subtypes: ["faerie"], colors: ["B"], cmc: 2,
    });
  });

  it("groups reasons into one edge per ordered producer->consumer pair", () => {
    const reasons = [
      reason("Bitterblossom", "Zulaport Cutthroat", "tokens"),
      reason("Bitterblossom", "Zulaport Cutthroat", "sacrifice"),
    ];
    const g = projectDeckGraph([card("Bitterblossom"), card("Zulaport Cutthroat")], reasons, W);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]).toMatchObject({ from: "Bitterblossom", to: "Zulaport Cutthroat" });
    expect(g.edges[0].tags.sort()).toEqual(["sacrifice", "tokens"]);
  });

  it("emits two edges for a mutually feeding pair, because that is what it is", () => {
    const reasons = [
      reason("Niv-Mizzet, Parun", "Curiosity", "draw"),
      reason("Curiosity", "Niv-Mizzet, Parun", "damage"),
    ];
    const g = projectDeckGraph([card("Niv-Mizzet, Parun"), card("Curiosity")], reasons, W);
    expect(g.edges).toHaveLength(2);
  });

  it("counts reasons it cannot place instead of guessing a direction", () => {
    const g = projectDeckGraph(
      [card("A"), card("B")],
      [{ tag: "t", text: "no direction on this one" }],
      W,
    );
    expect(g.edges).toEqual([]);
    expect(g.undirectedReasons).toBe(1);
  });

  it("drops reasons naming a card outside the deck", () => {
    const g = projectDeckGraph([card("A")], [reason("A", "NotInDeck", "t")], W);
    expect(g.edges).toEqual([]);
    expect(g.offDeckReasons).toBe(1);
  });

  it("keeps only each node's top-k edges, unioned so a mutual pick survives", () => {
    const cards = ["hub", "a", "b", "c"].map((n) => card(n));
    // hub->a is the weakest of hub's three, but it is a's ONLY edge, so the union keeps it.
    const reasons = [
      reason("hub", "a", "t1"),
      reason("hub", "b", "t1"), reason("hub", "b", "t2"),
      reason("hub", "c", "t1"), reason("hub", "c", "t2"), reason("hub", "c", "t3"),
    ];
    const g = projectDeckGraph(cards, reasons, W, { topK: 2 });
    const pairs = g.edges.map((e) => `${e.from}->${e.to}`).sort();
    expect(pairs).toEqual(["hub->a", "hub->b", "hub->c"]);
  });

  it("drops an edge under the absolute floor even when top-k would keep it", () => {
    const g = projectDeckGraph(
      [card("A"), card("B")],
      [reason("A", "B", "t")],
      W,
      { floor: 99 },
    );
    expect(g.edges).toEqual([]);
  });
});
