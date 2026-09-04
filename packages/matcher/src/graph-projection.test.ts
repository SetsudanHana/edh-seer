import { describe, expect, it, test } from "vitest";
import type { Reason } from "@edh-seer/engine";
import { nodeId, projectDeckGraph } from "./graph-projection.js";
import { faceDeckCards } from "./faces.js";
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

// The two-faced fixture edges.test.ts/faces.test.ts already use -- an Instant front, a Land back.
function mdfcDeckCard(): DeckCard {
  return {
    card: {
      name: "Fell the Profane // Fell Mire", typeLine: "Instant // Land", oracleText: "a\nb",
      keywords: [], colors: ["B"], manaValue: 4, layout: "modal_dfc",
      faces: [
        { name: "Fell the Profane", typeLine: "Instant", oracleText: "a", manaCost: "{3}{B}", colors: ["B"] },
        { name: "Fell Mire", typeLine: "Land", oracleText: "b", colors: [] },
      ],
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
    const pairs = g.edges.filter((e) => e.drawn).map((e) => `${e.from}->${e.to}`).sort();
    expect(pairs).toEqual(["hub->a", "hub->b", "hub->c"]);
  });

  // THE BUDGET IS FOR THE PICTURE, NOT FOR THE TRUTH. Top-k thins what the board DRAWS; it must not
  // thin what the inspector, the pair list or the score can see. Seen live on the Rani deck
  // (2026-09-05): Grim Guardian had 34 enchantments feeding it, every one at the same implied
  // weight, and the drawer said "Fed by 0 -- None" because its own top-4 went to its outgoing
  // edges and every producer's top-4 went elsewhere. The union kept nothing. 237 of 462 edges
  // survived the projection on that deck, 48.7% of real claims gone from every reader.
  it("returns every edge, and marks only the top-k union as drawn", () => {
    const cards = ["hub", "a", "b", "c"].map((n) => card(n));
    const reasons = [
      reason("hub", "a", "t1"),
      reason("hub", "b", "t1"), reason("hub", "b", "t2"),
      reason("hub", "c", "t1"), reason("hub", "c", "t2"), reason("hub", "c", "t3"),
    ];
    const g = projectDeckGraph(cards, reasons, W, { topK: 1 });
    const byPair = new Map(g.edges.map((e) => [`${e.from}->${e.to}`, e.drawn]));
    // hub's own top-1 is c; a and b each keep their only edge, so the union draws all three here...
    expect(byPair.get("hub->c")).toBe(true);
    expect(byPair.get("hub->a")).toBe(true);
    expect(byPair.get("hub->b")).toBe(true);
    // ...so add a consumer whose ONLY edges are the weakest thing in the deck, seen from both ends.
    const sink = [...cards, card("sink")];
    const sinkReasons = [...reasons, reason("hub", "sink", "t1"), reason("a", "sink", "t1")];
    const g2 = projectDeckGraph(sink, sinkReasons, W, { topK: 1 });
    const drawn = g2.edges.filter((e) => e.drawn).map((e) => `${e.from}->${e.to}`).sort();
    const all = g2.edges.map((e) => `${e.from}->${e.to}`).sort();
    expect(all).toContain("a->sink");
    expect(all).toContain("hub->sink");
    // sink's own top-1 keeps one of its two; the other is still RETURNED, just not drawn.
    expect(drawn.filter((p) => p.endsWith("->sink"))).toHaveLength(1);
    expect(all).toHaveLength(5);
  });

  it("keeps an edge under the absolute floor but does not draw it", () => {
    const g = projectDeckGraph(
      [card("A"), card("B")],
      [reason("A", "B", "t")],
      W,
      { floor: 99 },
    );
    expect(g.edges.map((e) => [e.from, e.to, e.drawn])).toEqual([["A", "B", false]]);
  });
});

// A NAME IS NOT AN IDENTITY. 92 of the corpus's 661 distinct token names are also a real card
// (Llanowar Elves, Mutavault, Sacred Cat), and a card that makes a token copy of itself puts both
// in one deck. Keyed on the name, the two collapsed into one node and the token's relations were
// read as the card's.
describe("a token that shares its name with a real card", () => {
  const tokenCard = (name: string): DeckCard => ({ ...card(name), isToken: true });

  it("is its own node, and the card keeps its bare id", () => {
    const g = projectDeckGraph([card("Llanowar Elves"), tokenCard("Llanowar Elves")], [], W);
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["Llanowar Elves", "token:Llanowar Elves"]);
    expect(g.nodes.map((n) => n.label)).toEqual(["Llanowar Elves", "Llanowar Elves"]);
    expect(g.nodes.find((n) => n.isToken)?.id).toBe("token:Llanowar Elves");
  });

  it("takes only the reasons stamped for its own side", () => {
    const toToken: Reason = { ...reason("Chord of Calling", "Llanowar Elves", "creates:elf"), consumerIsToken: true };
    const toCard = reason("Chord of Calling", "Llanowar Elves", "tutor:elf");
    const g = projectDeckGraph(
      [card("Chord of Calling"), card("Llanowar Elves"), tokenCard("Llanowar Elves")],
      [toToken, toCard],
      W,
    );
    expect(g.edges.map((e) => `${e.from}->${e.to}:${e.tags.join()}`).sort()).toEqual([
      "Chord of Calling->Llanowar Elves:tutor:elf",
      "Chord of Calling->token:Llanowar Elves:creates:elf",
    ]);
    expect(g.offDeckReasons).toBe(0);
  });

  it("counts a reason for a token the deck does not make as off-deck, not as the card's", () => {
    const g = projectDeckGraph(
      [card("Chord of Calling"), card("Llanowar Elves")],
      [{ ...reason("Chord of Calling", "Llanowar Elves", "creates:elf"), consumerIsToken: true }],
      W,
    );
    expect(g.edges).toEqual([]);
    expect(g.offDeckReasons).toBe(1);
  });
});

// THE RATCHET THAT PROTECTS THE FROZEN PANEL. `pairs.json` keys 895 judged pairs on the producer and
// consumer NAMES, and every fixture in this repo reads a node id that is a bare card name. A front
// face keeps that id exactly; only a BACK face gets a new one.
test("the front face's node id is the bare card name", () => {
  expect(nodeId("Fell the Profane // Fell Mire", false, 0)).toBe("Fell the Profane // Fell Mire");
  expect(nodeId("Sol Ring")).toBe("Sol Ring");
});

test("a back face gets its own node id", () => {
  expect(nodeId("Fell the Profane // Fell Mire", false, 1)).toBe("face:1:Fell the Profane // Fell Mire");
});

test("a two-faced card draws two nodes, each with its own printed fields", () => {
  const g = projectDeckGraph(faceDeckCards(mdfcDeckCard()), [], W);
  expect(g.nodes.map((n) => n.id)).toEqual([
    "Fell the Profane // Fell Mire",
    "face:1:Fell the Profane // Fell Mire",
  ]);
  expect(g.nodes.map((n) => n.label)).toEqual(["Fell the Profane", "Fell Mire"]);
  expect(g.nodes[0].typeLine).toBe("Instant");
  expect(g.nodes[1].typeLine).toBe("Land");
  expect(g.nodes.map((n) => n.cardName)).toEqual([
    "Fell the Profane // Fell Mire",
    "Fell the Profane // Fell Mire",
  ]);
});

test("a reason carrying a face lands on that face's node", () => {
  const deck = [...faceDeckCards(mdfcDeckCard()), card("Lotus Cobra")];
  const reasons = [{
    tag: "enters:land", text: "…",
    producer: "Fell the Profane // Fell Mire", producerFace: 1,
    consumer: "Lotus Cobra",
  }];
  const g = projectDeckGraph(deck, reasons, W);
  expect(g.offDeckReasons).toBe(0);
  expect(g.edges[0].from).toBe("face:1:Fell the Profane // Fell Mire");
});
