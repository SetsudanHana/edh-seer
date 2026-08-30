import { expect, test } from "vitest";
import type { DeckCard } from "@edh-seer/matcher";
import { faceDeckCards, projectDeckGraph } from "@edh-seer/matcher";

// THE `graph` DEP CANNOT BE UNIT-TESTED DIRECTLY: it is a closure inside a NestJS provider factory
// in this same file, reachable only through a live Mongo connection. This pins the composition it
// depends on at the closest seam that needs no database -- the exact expression the dep now runs,
// `deckCards.flatMap(copy-expand).flatMap(faceDeckCards)` -- through the same `projectDeckGraph` the
// dep feeds it to.
test("copy-expanding before splitting into faces keeps the copy count; splitting first would silently drop it", () => {
  const twoFace: DeckCard = {
    card: {
      name: "A // B", typeLine: "Artifact // Land", oracleText: "front\nback",
      keywords: [], colors: [], manaValue: 2, layout: "modal_dfc",
      faces: [
        { name: "A", typeLine: "Artifact", oracleText: "front", colors: [] },
        { name: "B", typeLine: "Land", oracleText: "back", colors: [] },
      ],
    } as DeckCard["card"],
    tags: null,
  };
  const lotusCobra: DeckCard = {
    card: {
      name: "Lotus Cobra", typeLine: "Creature — Snake", oracleText: "",
      keywords: [], colors: ["G"], manaValue: 2,
    } as DeckCard["card"],
    tags: null,
  };
  const copiesByName = new Map([["A // B", 2], ["Lotus Cobra", 1]]);

  // THE EXACT COMPOSITION `data.module.ts`'s `graph` dep now runs.
  const projectionDeck = [twoFace, lotusCobra].flatMap((dc) =>
    Array(copiesByName.get(dc.card.name) ?? 1).fill(dc),
  ).flatMap((dc) => faceDeckCards(dc));

  const g = projectDeckGraph(projectionDeck, [
    // A face-stamped reason: if the LAND face's node never joined `seen` under its face id, this
    // would land in `offDeckReasons` instead of forming an edge -- exactly what swallowed every
    // face-stamped reason before the split was wired in.
    { tag: "landfall", text: "B feeds Lotus Cobra", producer: "A // B", consumer: "Lotus Cobra", producerFace: 1 },
  ], { kinds: {}, repeatability: {}, scaling: {}, damping: 1 });

  expect(g.nodes.map((n) => n.id).sort()).toEqual(["A // B", "Lotus Cobra", "face:1:A // B"]);
  // The wrong order (split, then copy-expand-by-name) would look `copiesByName` up by the FACE
  // name ("A" / "B"), miss, and fall back to 1 -- both faces reading 2 is what proves the order.
  expect(g.nodes.find((n) => n.id === "A // B")?.copies).toBe(2);
  expect(g.nodes.find((n) => n.id === "face:1:A // B")?.copies).toBe(2);
  expect(g.offDeckReasons).toBe(0);
});
