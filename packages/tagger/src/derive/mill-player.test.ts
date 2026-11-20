import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { deriveCardTags } from "./derive.js";
import { deriveInputOf } from "../derive-input.js";
import { grammarClauseRecords } from "../grammar/clause-record.js";

// #1663: WHOSE LIBRARY a mill empties. Oracle texts and stored clauses (the `cardClauses` answer each model row derives from) read from the corpus 2026-11-20;
// the grammar-path cards derive from their printed text alone, as `derive-corpus` does for them.
// `canonical` is what derive reads for a model row in production (derive-worker.ts deriveRow): `reveal` is dropped from it (canonicalize.ts DROPPED_VERBS).
const FX = JSON.parse(readFileSync(new URL("./mill-player.fixtures.json", import.meta.url), "utf8")) as Record<string, { typeLine: string; oracleText: string; keywords: string[]; clauses: never }>;
const cardOf = (name: string) => ({ name, typeLine: FX[name]!.typeLine, oracleText: FX[name]!.oracleText, keywords: FX[name]!.keywords });
const viaStored = (name: string) => deriveCardTags(deriveInputOf(cardOf(name) as never, "x", name, FX[name]!.clauses));
const viaGrammar = (name: string) => {
  const card = cardOf(name);
  const g = grammarClauseRecords(card as never);
  expect(g.complete, `${name} reads completely`).toBe(true);
  return deriveCardTags(deriveInputOf(card as never, "x", name, g.records, undefined, g.readings));
};
/** [effect subject control, emit controls] of every mill ability. */
const mills = (tags: ReturnType<typeof viaStored>) =>
  tags.abilities.filter((a) => a.effect.kind === "mill").map((a) => [a.effect.subject?.control, (a.emits ?? []).filter((e) => e.verb === "mill").map((e) => e.subject.control)] as const);
const every = (rows: ReturnType<typeof mills>, control: string) => {
  expect(rows.length).toBeGreaterThan(0);
  for (const [eff, emits] of rows) { expect(eff).toBe(control); for (const e of emits) expect(e).toBe(control); }
};

describe("a put of your own library is yours, text-less twin included (#1663)", () => {
  test("Celestus Sanctifier: both day/night records mill your library", () => every(mills(viaStored("Celestus Sanctifier")), "you"));
  test("Gathering Stone: both upkeep/enters records mill your library", () => every(mills(viaStored("Gathering Stone")), "you"));
});

describe("the rest of a reveal takes the library the reveal named (#1663)", () => {
  test("Guild Feud: the opponent's half is opp, your half is you", () => {
    const rows = mills(viaStored("Guild Feud"));
    expect(rows.map((r) => r[0])).toEqual(["opp", "you"]);
    expect(rows.map((r) => r[1])).toEqual([["opp"], ["you"]]);
  });
  test("Sméagol, Helpful Guide: target opponent's library", () => every(mills(viaGrammar("Sméagol, Helpful Guide")), "opp"));
  test("Thief of Sanity: 'that player' after combat damage is an opponent", () => every(mills(viaStored("Thief of Sanity")), "opp"));
  test("Krydle of Baldur's Gate: 'that player mills' after combat damage is an opponent", () => every(mills(viaGrammar("Krydle of Baldur's Gate")), "opp"));
  test("Mirko Vosk: 'that player reveals ... puts into their graveyard' after combat damage is an opponent", () => every(mills(viaGrammar("Mirko Vosk, Mind Drinker")), "opp"));
  test("Eye Spy, Draugr Thought-Thief, Lurking Informant: target player's library is either side's", () => {
    for (const n of ["Eye Spy", "Draugr Thought-Thief", "Lurking Informant"]) every(mills(viaStored(n)), "any");
  });
  test("Dakra Mystic: each player's library is either side's", () => every(mills(viaStored("Dakra Mystic")), "any"));
});

describe("a mill whose object is a player or a controller is not defaulted to you (#1663)", () => {
  test("Mesmeric Orb: that permanent's controller is any player", () => every(mills(viaStored("Mesmeric Orb")), "any"));
  test("Fraying Sanity: enchanted player is any player", () => every(mills(viaStored("Fraying Sanity")), "any"));
  test("Riddlekeeper: the controller of a creature attacking you is an opponent", () => {
    every(mills(viaGrammar("Riddlekeeper")), "opp");
    every(mills(viaStored("Riddlekeeper")), "opp");
  });
});

describe("a mill by another player than 'that player' stays yours (#1663)", () => {
  // Palantir of Orthanc: "Then target opponent may have you draw a card. If that player doesn't, you mill X cards ... and that player loses life": the miller is YOU.
  test("Palantir of Orthanc: 'If that player doesn't, you mill X cards' is a self-mill", () => {
    const text = "At the beginning of your end step, put an influence counter on Palantír of Orthanc and scry 2. Then target opponent may have you draw a card. If that player doesn't, you mill X cards, where X is the number of influence counters on Palantír of Orthanc, and that player loses life equal to the total mana value of those cards.";
    const card = { name: "Palantír of Orthanc", typeLine: "Legendary Artifact", oracleText: text, keywords: [] as string[] };
    const g = grammarClauseRecords(card as never);
    const tags = deriveCardTags(deriveInputOf(card as never, "x", card.name, g.records, undefined, g.readings));
    const rows = mills(tags);
    expect(rows.length).toBeGreaterThan(0);
    for (const [eff, emits] of rows) { expect(eff).toBe("you"); for (const e of emits) expect(e).toBe("you"); }
  });
});

describe("a mill replacement names the player it replaces (#1663)", () => {
  test("Bruvac the Grandiloquent: an opponent would mill", () => {
    const rows = mills(viaStored("Bruvac the Grandiloquent"));
    expect(rows.map((r) => r[0])).toEqual(["opp"]);
  });
  test("The Water Crystal: the replacement is opp, the activated mill stays opp", () => {
    const rows = mills(viaStored("The Water Crystal"));
    expect(rows.map((r) => r[0])).toEqual(["opp", "opp"]);
  });
});
