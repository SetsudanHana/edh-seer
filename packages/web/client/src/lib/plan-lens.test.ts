import { expect, test } from "vitest";
import { buildEngineModel } from "./engine-model.js";
import { acrossPlans, counts, cutPreview, partnersOf, planLens } from "./plan-lens.js";
import type { CardGraph, DeckReport } from "../types.js";

type Reason = { producer: string; consumer: string; tag: string; text: string; repeatability?: string };

function tiny(names: string[], reasons: Reason[]) {
  const report = {
    commanders: [], cards: names.map((name) => ({ name, score: 1 })),
    edges: reasons.map((r) => ({ a: r.producer, b: r.consumer, score: 1, reasons: [r] })),
  } as unknown as DeckReport;
  const graph = {
    nodes: names.map((n) => ({ id: n, label: n, copies: 1, types: ["creature"], subtypes: [], supertypes: [], colors: [], cmc: 2, roles: [] })),
    edges: [], undirectedReasons: 0, offDeckReasons: 0,
  } as unknown as CardGraph;
  return buildEngineModel(report, graph);
}

const lasting = (producer: string, consumer: string, text: string): Reason => ({ producer, consumer, tag: "etb:creature", text, repeatability: "triggered" });
const once = (producer: string, consumer: string, text: string): Reason => ({ producer, consumer, tag: "etb:creature", text, repeatability: "oneshot" });

test("only a link INTO a plan card feeds the plan: a card the drain card feeds does not set it up", () => {
  // Round 5: Curse of Opulence "fed 5, 5 lasting" on links that read "When Grim Guardian attacks,
  // Curse of Opulence makes a token" -- the drain card feeding the Curse.
  const m = tiny(["Grim Guardian", "Kitten", "Curse"], [
    lasting("Kitten", "Grim Guardian", "When Grim Guardian enters thanks to Kitten, it drains"),
    lasting("Grim Guardian", "Curse", "When Grim Guardian attacks, Curse makes a token"),
    once("Curse", "Grim Guardian", "When Curse enters, Grim Guardian drains"),
  ]);
  const lens = planLens(m, ["Grim Guardian"], []);
  expect(lens.setup).toEqual(["Kitten", "Curse"]);
  expect(partnersOf(lens, "Curse")).toEqual([expect.objectContaining({ name: "Grim Guardian", lasting: false, why: "When Curse enters, Grim Guardian drains" })]);
  expect(counts(partnersOf(lens, "Grim Guardian"))).toEqual({ all: 2, lasting: 1 });
});

test("the sentence offered is a lasting one when the pair has one", () => {
  const m = tiny(["Leech", "Kitten"], [
    once("Kitten", "Leech", "When Kitten is cast, Leech drains"),
    lasting("Kitten", "Leech", "When Leech enters thanks to Kitten, it drains"),
  ]);
  const [p] = partnersOf(planLens(m, ["Leech"], []), "Leech");
  expect(p).toMatchObject({ name: "Kitten", lasting: true, why: "When Leech enters thanks to Kitten, it drains" });
});

test("the set-up ring is capped, a lasting feeder ahead of a one-shot one", () => {
  const m = tiny(["Win", "A", "B", "C"], [
    once("A", "Win", "When A enters, Win drains"),
    lasting("B", "Win", "When Win enters thanks to B, it drains"),
    once("C", "Win", "When C enters, Win drains"),
  ]);
  expect(planLens(m, ["Win"], [], 2).setup).toEqual(["B", "A"]);
});

test("a cut tells a card it leaves with no lasting link from one that never had one", () => {
  const m = tiny(["Leech", "Ascension", "Flux", "Kitten", "Giant"], [
    lasting("Kitten", "Leech", "When Leech enters thanks to Kitten, it drains"),
    lasting("Giant", "Ascension", "When a creature dies thanks to Giant, Ascension drains"),
    once("Kitten", "Flux", "When Kitten is cast, Flux flickers"),
  ]);
  const lens = planLens(m, ["Leech", "Ascension", "Flux"], []);
  const cut = cutPreview(lens, new Set(["Kitten"]));
  expect(cut.lose).toEqual(["Leech"]);
  expect(cut.left).toEqual(["Leech"]);
  expect(cut.never).toEqual(["Flux"]);
  expect(cut.rows.find((r) => r.name === "Ascension")).toMatchObject({ before: 1, after: 1 });
});

test("two combo pieces are marked, in both directions", () => {
  const m = tiny(["Mage", "Flux"], [once("Flux", "Mage", "When Mage enters thanks to Flux, it copies a spell")]);
  const lens = planLens(m, ["Mage", "Flux"], [["Mage", "Flux"]]);
  expect(lens.links).toEqual([expect.objectContaining({ from: "Flux", to: "Mage", combo: true })]);
});

test("across every plan: the plan cards a card works with either way, and how many keep working", () => {
  const m = tiny(["Kitten", "Leech", "Mage", "Flux"], [
    lasting("Kitten", "Leech", "When Leech enters thanks to Kitten, it drains"),
    once("Flux", "Kitten", "When Flux is cast, Kitten flickers"),
  ]);
  expect(acrossPlans(m, "Kitten", ["Leech", "Mage", "Flux"])).toEqual({ all: 2, lasting: 1, of: 3 });
  // A plan card is not counted against itself: Leech has two OTHER plan cards, and works with neither.
  expect(acrossPlans(m, "Leech", ["Leech", "Mage", "Flux"])).toEqual({ all: 0, lasting: 0, of: 2 });
});

test("a plan card that feeds another is counted on the card it feeds, never as fed by it", () => {
  // Review of the first draft: Leech feeding Ascension read as Ascension feeding Leech, and cutting
  // Ascension then said Leech "would have no lasting link left".
  const m = tiny(["Leech", "Ascension"], [lasting("Leech", "Ascension", "When Leech dies, Ascension drains")]);
  const lens = planLens(m, ["Leech", "Ascension"], []);
  expect(partnersOf(lens, "Leech")).toEqual([]);
  expect(partnersOf(lens, "Ascension").map((p) => p.name)).toEqual(["Leech"]);
  expect(cutPreview(lens, new Set(["Ascension"])).left).toEqual([]);
});

test("a feeder past the drawn ring still counts for the plan card it feeds", () => {
  const m = tiny(["Win", "Big", "Small"], [
    lasting("Big", "Win", "When Win enters thanks to Big, it drains"),
    lasting("Small", "Win", "When Win enters thanks to Small, it drains"),
  ]);
  const lens = planLens(m, ["Win"], [], 1);
  expect(lens.setup).toHaveLength(1);
  expect(counts(partnersOf(lens, "Win"))).toEqual({ all: 2, lasting: 2 });
  expect(cutPreview(lens, new Set([lens.setup[0]!])).left).toEqual([]);
});

/** A deck whose Maker makes Rogue tokens (`makes` repeatability) and a Rogue dying drains. */
function tokenDeck(makes: string) {
  const report = {
    commanders: [], cards: [{ name: "Maker", score: 1 }, { name: "Drainer", score: 1 }],
    tokenNodes: [{ name: "Rogue", hasPartner: true, madeBy: ["Maker"] }],
    edges: [
      { a: "Rogue", b: "Drainer", score: 1, reasons: [{ producer: "Rogue", producerIsToken: true, consumer: "Drainer", tag: "dies:creature", text: "When a Rogue dies, Drainer drains", repeatability: "triggered" }] },
      { a: "Maker", b: "Rogue", score: 1, reasons: [{ producer: "Maker", consumer: "Rogue", consumerIsToken: true, tag: "token:creature", text: "Maker creates Rogue", repeatability: makes }] },
    ],
  } as unknown as DeckReport;
  const node = (id: string, label: string, isToken = false) => ({ id, label, isToken, copies: 1, types: ["creature"], subtypes: [], supertypes: [], colors: [], cmc: 2, roles: [] });
  const graph = { nodes: [node("Maker", "Maker"), node("Drainer", "Drainer"), node("token:Rogue", "Rogue", true)], edges: [], undirectedReasons: 0, offDeckReasons: 0 } as unknown as CardGraph;
  return planLens(buildEngineModel(report, graph), ["Drainer"], []);
}

test("a token feeds the plan through the card that makes it", () => {
  const lens = tokenDeck("triggered");
  expect(lens.setup).toEqual(["Maker"]);
  expect(partnersOf(lens, "Drainer")).toEqual([expect.objectContaining({ name: "Maker", lasting: true, why: "When a Rogue dies, Drainer drains" })]);
});

test("a token made once feeds the plan once, however often its own trigger repeats", () => {
  expect(partnersOf(tokenDeck("oneshot"), "Drainer")).toEqual([expect.objectContaining({ name: "Maker", lasting: false })]);
});
