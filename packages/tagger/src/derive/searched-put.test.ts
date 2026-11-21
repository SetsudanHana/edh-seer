import { describe, expect, test } from "vitest";
import { deriveAsCorpus } from "../derive-worker.js";
import fixtures from "./searched-put.fixtures.json" with { type: "json" };

/** #1694: A SEARCHED PUT INTO A GRAVEYARD GOES TO THE SEARCHED LIBRARY'S OWNER (CR 701.23a: to search is to look through a hidden zone for a card; the cards come from the library searched, and a card put into
 *  a graveyard goes to its owner's, CR 404.1). Entomb's `enters-graveyard {control: any, fromZone: library}` fed every "a card is put into an opponent's graveyard" consumer (Bloodchief Ascension, Profane Memento,
 *  Dauthi Voidwalker ...). Read off the clause's own search (`librarySearch`): your library is `you`, "target opponent's library" is `opp`, "target player's library" stays `any`.
 *  Fixtures: card documents (and, for the model rows, stored `cardClauses`) dumped from Mongo 2026-11-21 (DERIVE 559); derived as derive-corpus derives them (`deriveAsCorpus`). */
type Fx = { source: Record<string, unknown>; canonical?: unknown[]; segmentHash?: string };
const rowOf = (name: string) => {
  const f = (fixtures as unknown as Record<string, Fx>)[name]!;
  return deriveAsCorpus({ doc: { oracleId: name, name, canonical: f.canonical ?? [], segmentHash: f.segmentHash } as never, source: f.source, isToken: false });
};
const puts = (name: string) => rowOf(name).tags.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "enters-graveyard" && e.subject.fromZone === "library").map((e) => e.subject.control);

describe("a search of your library that puts into your graveyard is yours", () => {
  test.each([
    "Entomb", "Unmarked Grave", "Vile Entomber", "Scion of the Ur-Dragon", // grammar
    "Buried Alive", // model
    "Dina's Guidance", // the #1677 shape stays you
    "Transmute Artifact", // "put it into its owner's graveyard": the owner of a card from your library is you
  ])("%s", (name) => {
    const c = puts(name);
    expect(c.length).toBeGreaterThan(0);
    for (const x of c) expect(x).toBe("you");
  });
  test.each(["Intuition", "Gifts Ungiven", "Burning-Rune Demon", "Fork in the Road", "Jarad's Orders", "Final Parting"])("split pile %s: the cards are still yours", (name) => {
    const c = puts(name);
    expect(c.length).toBeGreaterThan(0);
    for (const x of c) expect(x).toBe("you");
  });
});

describe("another player's library", () => {
  test("target opponent's library into their graveyard is theirs (Life's Finale)", () => expect(puts("Life's Finale")).toEqual(["opp"]));
  test("target player's library stays any player's (Quiet Speculation)", () => expect(puts("Quiet Speculation")).toEqual(["any"]));
});
