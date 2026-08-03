import { expect, test } from "vitest";
import type { CardDoc } from "@mtg/data";
import type { CardTags } from "@mtg/tagger";
import type { DeckCard, Hierarchy } from "./types.js";
import { buildGraph } from "./graph.js";
import { addEventEdges, orphanCards } from "./graph-events.js";

const H: Hierarchy = { wizard: ["creature"] };

const doc = (id: string, name: string, typeLine: string): CardDoc => ({
  _id: id, name, typeLine, oracleText: "", keywords: [], colors: [], manaValue: 0,
  colorIdentity: [], power: null, toughness: null, tags: { produces: [], cares: [] }, searchNames: [],
});

const tags = (id: string, abilities: CardTags["abilities"], subtypes: string[] = [], types = ["creature"]): CardTags => ({
  oracleId: id, schemaVersion: 1, promptVersion: 1, model: "t",
  characteristics: { types, subtypes, colors: [], identity: [], cmc: 0, power: "1", toughness: "1", token: false, keywords: [] },
  abilities,
});

const makerTags = (id: string) => tags(id, [{
  kind: "triggered",
  trigger: { verbs: ["enters"], subject: { subtype: "wizard", control: "you", token: false } },
  effect: { kind: "token-generation", subject: { subtype: "wizard", control: "you", token: true } },
  emits: [{ verb: "enters", subject: { subtype: "wizard", control: "you", token: true } }],
}], ["wizard"]);

const payoffTags = (id: string) => tags(id, [{
  kind: "triggered",
  trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } },
  effect: { kind: "draw-card" },
}]);

/** The brief's §4.6 rule: events are nodes, cards attach by role, and card-to-card synergy is a
 *  derived two-hop view. Storing pairs instead would cost n*m edges all saying the same thing. */
test("synergy is reified as an event node with EMITS in and TRIGGERS out", () => {
  const docs = [doc("m1", "Maker One", "Creature — Wizard"), doc("p1", "Payoff", "Creature — Human")];
  const deck: DeckCard[] = [
    { card: { name: "Maker One", typeLine: "Creature — Wizard", oracleText: "", keywords: [], colors: [], manaValue: 0 }, tags: makerTags("m1") },
    { card: { name: "Payoff", typeLine: "Creature — Human", oracleText: "", keywords: [], colors: [], manaValue: 0 }, tags: payoffTags("p1") },
  ];
  const g = addEventEdges(buildGraph(docs), deck, H);

  const ev = g.nodes.find((n) => n.kind === "event" && n.label === "enters:creature");
  expect(ev).toBeDefined();
  expect(g.edges).toContainEqual({ from: "card:m1", to: ev!.id, kind: "EMITS" });
  expect(g.edges).toContainEqual({ from: ev!.id, to: "card:p1", kind: "TRIGGERS" });
  // No card-to-card edge is stored — the pair is a two-hop walk.
  expect(g.edges.some((e) => e.from === "card:m1" && e.to === "card:p1")).toBe(false);
});

/** Two makers feeding one payoff cost 3 role edges, not 2 pairs — and the saving grows as n*m. */
test("several producers share one event node rather than each storing a pair", () => {
  const docs = [doc("m1", "M1", "Creature — Wizard"), doc("m2", "M2", "Creature — Wizard"), doc("p1", "P", "Creature — Human")];
  const mk = (n: string) => ({ name: n, typeLine: "Creature — Wizard", oracleText: "", keywords: [], colors: [], manaValue: 0 });
  const deck: DeckCard[] = [
    { card: mk("M1"), tags: makerTags("m1") },
    { card: mk("M2"), tags: makerTags("m2") },
    { card: { ...mk("P"), typeLine: "Creature — Human" }, tags: payoffTags("p1") },
  ];
  const g = addEventEdges(buildGraph(docs), deck, H);
  const ev = g.nodes.find((n) => n.kind === "event" && n.label === "enters:creature")!;
  expect(g.edges.filter((e) => e.to === ev.id && e.kind === "EMITS")).toHaveLength(2);
  expect(g.edges.filter((e) => e.from === ev.id && e.kind === "TRIGGERS")).toHaveLength(1);
});

/** "Forms no edge" and "we never parsed this card" look identical in a graph and mean opposite
 *  things, so an untagged card must not be counted as an orphan. */
test("orphanCards reports unconnected cards but not untagged ones", () => {
  const docs = [doc("m1", "M", "Creature — Wizard"), doc("p1", "P", "Creature — Human"), doc("lone", "Lone", "Artifact"), doc("nt", "Untagged", "Artifact")];
  const deck: DeckCard[] = [
    { card: { name: "M", typeLine: "Creature — Wizard", oracleText: "", keywords: [], colors: [], manaValue: 0 }, tags: makerTags("m1") },
    { card: { name: "P", typeLine: "Creature — Human", oracleText: "", keywords: [], colors: [], manaValue: 0 }, tags: payoffTags("p1") },
    { card: { name: "Lone", typeLine: "Artifact", oracleText: "", keywords: [], colors: [], manaValue: 0 }, tags: tags("lone", [], [], ["artifact"]) },
    { card: { name: "Untagged", typeLine: "Artifact", oracleText: "", keywords: [], colors: [], manaValue: 0 }, tags: null },
  ];
  const g = addEventEdges(buildGraph(docs), deck, H);
  const orphans = orphanCards(g, deck).map((n) => n.id).sort();
  expect(orphans).toContain("card:lone");
  expect(orphans).not.toContain("card:m1");
  expect(orphans).not.toContain("card:p1");
  // Untagged is unknown, not unconnected — it must never be reported as an orphan.
  expect(orphans).not.toContain("card:nt");
});

/** A tagged card missing from the graph means the graph and the deck describe different card sets.
 *  That does not fail on its own — it quietly yields a graph where the non-overlapping cards look
 *  connected because nothing ever asked about them. It shipped once, from a `buildGraph` call one
 *  statement too early, and the CLI cheerfully reported "0 orphans" over 80 disconnected cards. */
test("a tagged deck card missing from the graph is a loud error, not a silent skip", () => {
  const g = buildGraph([doc("m1", "M", "Creature — Wizard")]);
  const deck: DeckCard[] = [
    { card: { name: "M", typeLine: "Creature — Wizard", oracleText: "", keywords: [], colors: [], manaValue: 0 }, tags: makerTags("m1") },
    { card: { name: "Ghost", typeLine: "Creature — Human", oracleText: "", keywords: [], colors: [], manaValue: 0 }, tags: payoffTags("absent") },
  ];
  expect(() => addEventEdges(g, deck, H)).toThrow(/not nodes in the graph/);
});

test("an untagged deck card is skipped quietly, not treated as a mismatch", () => {
  const g = buildGraph([doc("m1", "M", "Creature — Wizard")]);
  const deck: DeckCard[] = [
    { card: { name: "M", typeLine: "Creature — Wizard", oracleText: "", keywords: [], colors: [], manaValue: 0 }, tags: makerTags("m1") },
    { card: { name: "Unknown", typeLine: "Artifact", oracleText: "", keywords: [], colors: [], manaValue: 0 }, tags: null },
  ];
  expect(() => addEventEdges(g, deck, H)).not.toThrow();
});
