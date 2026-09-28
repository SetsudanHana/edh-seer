import { expect, test } from "vitest";
import { missingLinks } from "./deck-links-core.js";

const graph = { edges: [
  { from: "Asinine Antics", to: "token:Cursed Role", tags: ["creates:role"] },
  { from: "token:Cursed Role", to: "Doomwake Giant", tags: ["enters:enchantment"] },
] };

test("a link is present when an edge runs from -> to and carries the tag", () => {
  expect(missingLinks(graph, [{ from: "token:Cursed Role", to: "Doomwake Giant", tag: "enters:enchantment" }])).toEqual([]);
});

test("a missing edge, or one without the tag, or the wrong direction, is reported", () => {
  const rows = [
    { from: "Doomwake Giant", to: "token:Cursed Role", tag: "enters:enchantment" },
    { from: "Asinine Antics", to: "token:Cursed Role", tag: "enters:enchantment" },
    { from: "Asinine Antics", to: "Doomwake Giant", tag: "enters:enchantment" },
  ];
  expect(missingLinks(graph, rows)).toEqual(rows);
});
