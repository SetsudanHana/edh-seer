import { expect, test } from "vitest";
import type { DeckReport } from "../types.js";
import { unreadCardNames } from "./unread.js";

const card = (c: Partial<DeckReport["cards"][number]>): DeckReport["cards"][number] =>
  ({ name: "x", isCommander: false, score: 0, partnerCount: 0, topPartners: [], ...c }) as DeckReport["cards"][number];

test("names only the cards the engine could not read", () => {
  const set = unreadCardNames([
    card({ name: "Sol Ring", derived: true }),
    card({ name: "Nalia de'Arnise", derived: false }),
  ]);
  expect([...set]).toEqual(["Nalia de'Arnise"]);
});

// Both faces of a multi-face card carry the SAME `derived` flag -- it is read off the physical
// card -- so an unread modal DFC rates two rows and must contribute ONE name. Same dedupe
// `ReportView`'s commander list and `CardList`'s unread grid each grew separately.
test("a two-faced card lands once, under its physical name", () => {
  const set = unreadCardNames([
    card({ name: "Fell the Profane", cardName: "Fell the Profane // Fell Mire", derived: false }),
    card({ name: "Fell Mire", cardName: "Fell the Profane // Fell Mire", face: 1, derived: false }),
  ]);
  expect([...set]).toEqual(["Fell the Profane // Fell Mire"]);
});

// `derived` is ABSENT on the flat engine, where the distinction does not exist. Absent must not
// read as unread -- that would hatch every mark on every report the flat engine produced.
test("an absent flag is not an unread card", () => {
  expect(unreadCardNames([card({ name: "Sol Ring" })]).size).toBe(0);
});

test("a fully read deck yields an empty set, so nothing is marked", () => {
  expect(unreadCardNames([card({ name: "Sol Ring", derived: true })]).size).toBe(0);
});
