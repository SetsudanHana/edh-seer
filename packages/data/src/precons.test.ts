import { expect, test } from "vitest";
import { commanderDecks, preconDecklist, preconOf, type MtgjsonDeckListEntry } from "./precons.js";

const list: MtgjsonDeckListEntry[] = [
  { code: "CLB", fileName: "PartyTime_CLB", name: "Party Time", releaseDate: "2022-06-10", type: "Commander Deck" },
  { code: "M21", fileName: "Welcome_M21", name: "Welcome Deck", releaseDate: "2020-07-03", type: "Welcome Deck" },
  { code: "C13", fileName: "Evasive_C13", name: "Evasive Maneuvers", releaseDate: "2013-11-01", type: "Commander Deck" },
];

test("only Commander decks, oldest first", () => {
  expect(commanderDecks(list).map((d) => d.name)).toEqual(["Evasive Maneuvers", "Party Time"]);
});

test("a deck file becomes a precon: commanders apart, printings of one card added up, the set named", () => {
  const p = preconOf(list[0]!, {
    code: "CLB", name: "Party Time", releaseDate: "2022-06-10", type: "Commander Deck",
    commander: [{ name: "Nalia de'Arnise", count: 1 }],
    mainBoard: [{ name: "Plains", count: 8 }, { name: "Sol Ring", count: 1 }, { name: "Plains", count: 2 }, { name: "Nalia de'Arnise", count: 1 }],
  }, new Map([["CLB", "Commander Legends: Battle for Baldur's Gate"]]));
  expect(p).toEqual({
    name: "Party Time", fileName: "PartyTime_CLB", setCode: "CLB", setName: "Commander Legends: Battle for Baldur's Gate",
    releaseDate: "2022-06-10", commanders: ["Nalia de'Arnise"],
    cards: [{ name: "Plains", count: 10 }, { name: "Sol Ring", count: 1 }],
  });
  expect(preconDecklist(p!)).toBe("Commander\n1 Nalia de'Arnise\n\nDeck\n10 Plains\n1 Sol Ring");
});

test("a deck with no commander is not a precon page", () => {
  expect(preconOf(list[0]!, { code: "CLB", name: "x", releaseDate: null, type: "Commander Deck", mainBoard: [] }, new Map())).toBeNull();
});
