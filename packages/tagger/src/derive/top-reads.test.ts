/** `Ability.impulse` and `Ability.looksAtTop` (#1266): the two words the card-selection and impulse-draw roles used to read off the whole oracle text, read one clause at a time. The printed text of every card is the corpus Scryfall oracle text
 *  (Mongo `cards`, 2026-11-13). */
import { describe, expect, test } from "vitest";
import { deriveInputOf } from "../derive-input.js";
import { grammarClauseRecords } from "../grammar/clause-record.js";
import type { Ability } from "../schema.js";
import { deriveCardTags } from "./derive.js";
import { topReadsFromText } from "./top-reads.js";

const derive = (name: string, typeLine: string, oracleText: string) => {
  const card = { name, typeLine, oracleText, keywords: [] as string[] };
  const g = grammarClauseRecords(card);
  return deriveCardTags(deriveInputOf(card as never, "x", name, g.records, undefined, g.readings)).abilities;
};

describe("impulse: the clause exiles from the top of YOUR library and lets you play the cards", () => {
  test("Light Up the Stage", () => {
    const a = derive("Light Up the Stage", "Sorcery", "Spectacle {R} (You may cast this spell for its spectacle cost rather than its mana cost if an opponent lost life this turn.)\nExile the top two cards of your library. Until the end of your next turn, you may play those cards.");
    expect(a.filter((x) => x.impulse).map((x) => x.emits?.map((e) => e.verb))).toEqual([["exiled"]]);
  });
  test("Count on Luck: an upkeep trigger, one card", () => {
    const a = derive("Count on Luck", "Enchantment", "At the beginning of your upkeep, exile the top card of your library. You may play that card this turn.");
    expect(a.some((x) => x.impulse === true)).toBe(true);
  });
  test("Arc-Slogger exiles the top ten as a cost and plays nothing: no mark", () => {
    const a = derive("Arc-Slogger", "Creature — Ogre Shaman", "{R}, Exile the top ten cards of your library: This creature deals 2 damage to any target.");
    expect(a.some((x) => x.impulse)).toBe(false);
  });
});

describe("looksAtTop: the clause looks at the top cards of a library", () => {
  test("Impulse", () => {
    const a = derive("Impulse", "Instant", "Look at the top four cards of your library. Put one of them into your hand and the rest on the bottom of your library in any order.");
    expect(a.some((x) => x.looksAtTop === true)).toBe(true);
  });
  test("Preordain says scry, not look: no mark (a scry is read from its own emit)", () => {
    const a = derive("Preordain", "Sorcery", "Scry 2, then draw a card.");
    expect(a.some((x) => x.looksAtTop)).toBe(false);
  });
});

describe("topReadsFromText", () => {
  const exile = { kind: "on-cast", effect: { kind: "" }, emits: [{ verb: "exiled", subject: { control: "you", token: null, fromZone: "library" } }], clause: 2 } as unknown as Ability;
  test("an exile of an opponent's library is not an impulse draw of yours", () => {
    const opp = { ...exile, emits: [{ verb: "exiled", subject: { control: "opp", token: null, fromZone: "library" } }] } as unknown as Ability;
    const text = { 2: "Exile the top card of your library. You may play that card." };
    expect(topReadsFromText([opp], text, text[2])[0]!.impulse).toBeUndefined();
    expect(topReadsFromText([exile], text, text[2])[0]!.impulse).toBe(true);
  });
  test("the words of ANOTHER clause are not a look", () => {
    expect(topReadsFromText([exile], { 1: "Look at the top four cards of your library.", 2: "Draw a card." }, "x")[0]!.looksAtTop).toBeUndefined();
  });
  test("a clause with no text, and an ability with no clause, are left alone", () => {
    const bare = { kind: "static", effect: { kind: "" } } as unknown as Ability;
    expect(topReadsFromText([bare, exile], undefined, "x")).toEqual([bare, exile]);
  });
  test("manifest dread looks at the top two only where the card prints the reminder", () => {
    const dread = { ...exile, clause: 3 } as unknown as Ability;
    expect(topReadsFromText([dread], { 3: "At the beginning of each opponent's upkeep, manifest dread." }, "Flying\nAt the beginning of each opponent's upkeep, manifest dread. (Look at the top two cards of your library. Put one onto the battlefield face down as a 2/2 creature and the other into your graveyard.)")[0]!.looksAtTop).toBe(true);
    expect(topReadsFromText([dread], { 3: "When this Equipment enters, manifest dread." }, "When this Equipment enters, manifest dread.")[0]!.looksAtTop).toBeUndefined();
  });
  test("the exile and the permission to play may be two clauses (Theater of Horrors)", () => {
    const upkeep = { ...exile, clause: 1 } as unknown as Ability;
    const card = "At the beginning of your upkeep, exile the top card of your library.\nDuring your turn, if an opponent lost life this turn, you may play lands and cast spells from among cards exiled with this enchantment.";
    expect(topReadsFromText([upkeep], { 1: "At the beginning of your upkeep, exile the top card of your library." }, card)[0]!.impulse).toBe(true);
  });
});
