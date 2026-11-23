import { expect, test } from "vitest";
import { grammarClauseRecords } from "./clause-record.js";
import { deriveCardTags } from "../derive/derive.js";
import { deriveInputOf } from "../derive-input.js";

// #1330: "reveal the top card of your library ... put it into your hand": "it" is the revealed card, not the card itself. Every oracle text is the corpus's own (Mongo `cards`, 2026-11-23).
const card = (name: string, typeLine: string, oracleText: string, keywords: string[] = []) => ({ name, typeLine, oracleText, keywords });
const NEUROK = card("Neurok Familiar", "Creature — Bird", "Flying\nWhen this creature enters, reveal the top card of your library. If it's an artifact card, put it into your hand. Otherwise, put it into your graveyard.", ["Flying"]);
const BRONCO = card("Caustic Bronco", "Creature — Snake Horse Mount", "Whenever this creature attacks, reveal the top card of your library and put it into your hand. You lose life equal to that card's mana value if this creature isn't saddled. Otherwise, each opponent loses that much life.\nSaddle 3 (Tap any number of other creatures you control with total power 3 or more: This Mount becomes saddled until end of turn. Saddle only as a sorcery.)", ["Saddle"]);
const COILING = card("Coiling Oracle", "Creature — Snake Elf Druid", "When this creature enters, reveal the top card of your library. If it's a land card, put it onto the battlefield. Otherwise, put that card into your hand.");
const STONE = card("Gathering Stone", "Artifact", "As this artifact enters, choose a creature type.\nSpells you cast of the chosen type cost {1} less to cast.\nWhen this artifact enters and at the beginning of your upkeep, look at the top card of your library. If it's a card of the chosen type, you may reveal it and put it into your hand. If you don't put the card into your hand, you may put it into your graveyard.");
const ZOOLOGIST = card("Zoologist", "Creature — Human Druid", "{3}{G}, {T}: Reveal the top card of your library. If it's a creature card, put it onto the battlefield. Otherwise, put it into your graveyard.");
const APPRENTICE = card("Steelshaper Apprentice", "Creature — Human Soldier", "{W}, {T}, Return this creature to its owner's hand: Search your library for an Equipment card, reveal that card, put it into your hand, then shuffle.");
const SELF_BOUNCE = card("Tidal Visionary-like", "Creature — Merfolk", "When this creature enters, return this creature to its owner's hand.");

const puts = (c: ReturnType<typeof card>) => grammarClauseRecords(c).records.flatMap((r) => r.actions ?? []).filter((a) => a.verb === "put" || a.verb === "return");

test("the put of a revealed top card is the library's card, not the card itself", () => {
  for (const c of [NEUROK, BRONCO, COILING, STONE]) {
    const ps = puts(c);
    expect(ps.length, c.name).toBeGreaterThan(0);
    for (const p of ps) expect(p.object, c.name).not.toMatch(/^this /);
    expect(ps.find((p) => p.toZone === "hand"), c.name).toMatchObject({ fromZone: "library" });
  }
});

test("no self leaves is derived from them", () => {
  for (const c of [NEUROK, BRONCO, COILING]) {
    const g = grammarClauseRecords(c);
    const ab = deriveCardTags(deriveInputOf(c as never, c.name, c.name, g.records, undefined, g.readings), { foldGrantTwins: false, collapseZoneSearches: false }).abilities;
    expect(ab.filter((a) => a.effect?.kind === "bounce" || a.emits?.some((e) => e.verb === "leaves")), c.name).toEqual([]);
  }
});

test("a reveal of the library kept as it was: a put onto the battlefield of an activated card, a real self-bounce", () => {
  expect(puts(ZOOLOGIST)[0]).toMatchObject({ object: "it", fromZone: "library", toZone: "battlefield" });
  expect(puts(APPRENTICE).concat(puts(SELF_BOUNCE))).toEqual(expect.arrayContaining([expect.objectContaining({ object: "this creature", toZone: "hand", fromZone: "battlefield" })]));
  expect(puts(SELF_BOUNCE)[0]).toMatchObject({ object: "this creature", toZone: "hand", fromZone: "battlefield" });
});
