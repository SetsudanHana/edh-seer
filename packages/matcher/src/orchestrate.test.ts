import { expect, test } from "vitest";
import { resolveDeck } from "./orchestrate.js";
import type { CardLookup } from "@edh-seer/data/resolve";

const doc = (name: string, colorIdentity: string[] = [], typeLine = "Creature — Human") => ({
  _id: name, name, typeLine, oracleText: "", keywords: [], colors: colorIdentity,
  manaValue: 1, colorIdentity, power: "1", toughness: "1",
  tags: { produces: [], cares: [] }, searchNames: [name.toLowerCase()],
});

function lookupOf(docs: ReturnType<typeof doc>[]): CardLookup {
  const byName = new Map(docs.map((d) => [d.searchNames[0], d]));
  return {
    async findByName(n: string) { return (byName.get(n) ?? null) as never; },
    async allCombos() { return []; },
  };
}

/** THE COMMANDER FALLBACK. An export with no Commander section lists the commander FIRST, and
 *  `resolveNames` preserves paste order — so with no explicit commander names the head of the deck
 *  is the commander. This is the only copy of that rule; before this extraction it lived inside a
 *  Nest provider factory and no test could reach it. */
test("with no explicit commander, the head of the decklist becomes one", async () => {
  // `detectCommanders` only ever picks a commander-legal head (`canBeCommander`: legendary
  // creature, or an explicit "can be your commander"/Background grant) — an alphabetised list
  // that happens to start on a spell must NOT be guessed at. Krenko needs the legendary type
  // line for the fallback to have anything to pick.
  const lookup = lookupOf([
    doc("Krenko", ["R"], "Legendary Creature — Human"),
    doc("Mountain", [], "Basic Land — Mountain"),
  ]);
  const r = await resolveDeck([], ["Krenko", "Mountain"], lookup);
  expect(r.commanderResolved).toEqual(["Krenko"]);
});

/** COLOUR IDENTITY IS THE COMMANDER'S, NEVER A UNION OVER THE 99 (CR 903.4) — a union would drift
 *  from what a player calls "on-colour" and is what `legality.ts` checks the 99 against. */
test("colour identity comes from the commander alone", async () => {
  const lookup = lookupOf([doc("Krenko", ["R"]), doc("Brainstorm", ["U"], "Instant")]);
  const r = await resolveDeck(["Krenko"], ["Brainstorm"], lookup);
  expect(r.commanderColorIdentity).toEqual(["R"]);
});
