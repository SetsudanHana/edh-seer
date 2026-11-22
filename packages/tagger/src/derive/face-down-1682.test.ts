import { expect, test } from "vitest";
import { actionEmits } from "./emits.js";

/** #1682: a card put onto the battlefield face down is turned face down BEFORE it enters (CR 708.3), so its `enters` emit carries `status: ["face-down"]`. Manifest is CR 701.40a, manifest dread 701.62a, cloak 701.58a. */
const entersOf = (action: Parameters<typeof actionEmits>[0], clauseText: string) => actionEmits(action, clauseText).filter((e) => e.verb === "enters");

test.each([
  ["manifest", { verb: "manifest", object: "the top card of your library" }, "Manifest the top card of your library."],
  ["manifest-dread", { verb: "manifest-dread", object: "" }, "Manifest dread."],
  ["cloak", { verb: "cloak", object: "the top card of your library" }, "Cloak the top card of your library."],
  ["put face down", { verb: "put", object: "all creature cards milled this way", toZone: "battlefield" }, "Put all creature cards milled this way onto the battlefield face down under your control."],
] as const)("%s: the enters emit is face-down", (_n, action, text) => {
  const enters = entersOf(action as never, text);
  expect(enters.length).toBeGreaterThan(0);
  for (const e of enters) expect(e.subject.status).toEqual(["face-down"]);
});
test("an ordinary put onto the battlefield is not face-down", () => {
  const enters = entersOf({ verb: "put", object: "target creature card from a graveyard", toZone: "battlefield", fromZone: "graveyard" } as never, "Put target creature card from a graveyard onto the battlefield under your control.");
  expect(enters.length).toBeGreaterThan(0);
  for (const e of enters) expect(e.subject.status).toBeUndefined();
});
test("a cloak the printed clause never words is not a face-down put (The Foretold Soldier's stored answer)", () => {
  const enters = entersOf({ verb: "cloak", object: "this creature" } as never, "Whenever this creature deals damage, exile it face down. It becomes foretold.");
  for (const e of enters) expect(e.subject.status).toBeUndefined();
});
