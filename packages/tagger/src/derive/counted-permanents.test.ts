import { describe, expect, test } from "vitest";
import { deriveAsCorpus } from "../derive-worker.js";
import fixtures from "./counted-permanents.fixtures.json" with { type: "json" };

/** #1577 -- A COUNTED OR SET-DEFINED "PERMANENTS" IS NOT "ALL PERMANENTS". "Sacrifice any number of permanents" (Renounce), "sacrifice that many permanents" (Lich, Phyrexian Negator), "put all permanent cards exiled with this
 *  enchantment" (Journey to the Lost City) and "all tokens ... with the same name" (Legions to Ashes) were stored as a bare `permanent` mass, which the matcher now reads as proof of EVERY permanent subtype (subject.ts
 *  `sweepsEveryPermanent`). Card documents and stored `cardClauses` dumped from Mongo (DERIVE 481 tree, 2026-11-09): `counted-permanents.fixtures.json`. */
type Fx = { source: Record<string, unknown>; canonical?: unknown[]; segmentHash?: string };
const rowOf = (name: string) => {
  const f = (fixtures as unknown as Record<string, Fx>)[name]!;
  return deriveAsCorpus({ doc: { oracleId: name, name, canonical: f.canonical ?? [], segmentHash: f.segmentHash } as never, source: f.source, isToken: false });
};
const removals = (name: string) => rowOf(name).tags.abilities.flatMap((a) => a.emits ?? [])
  .filter((e) => ["dies", "leaves", "exiled", "sacrifice", "enters"].includes(e.verb) && [e.subject.type].flat().includes("permanent") && e.subject.scope === "all" && (e.subject.fromZone ?? "battlefield") === "battlefield");

describe("a counted permanent mass is marked counted, a set the card defined earlier chosen", () => {
  test.each(["Renounce", "Pitiless Carnage", "Phyrexian Negator", "Lich", "God-Eternal Bontu", "Shimatsu the Bloodcloaked", "Dralnu, Lich Lord", "Phyrexian Totem"])("%s: counted", (name) => {
    const e = removals(name);
    expect(e.length).toBeGreaterThan(0);
    for (const x of e) expect(x.subject.selection).toBe("counted");
  });
  test.each(["Journey to the Lost City", "Legions to Ashes", "Deep Space 9"])("%s: chosen", (name) => {
    const e = removals(name);
    expect(e.length).toBeGreaterThan(0);
    for (const x of e) expect(x.subject.selection).toBe("chosen");
  });
});

describe("CONTROL: a real sweep stays unmarked", () => {
  test.each(["Apocalypse", "Worldfire", "Hellcarver Demon", "Kaervek's Spite", "Worldslayer", "Thieves' Auction", "Worldpurge", "Gideon, Champion of Justice"])("%s", (name) => {
    const e = removals(name);
    expect(e.length).toBeGreaterThan(0);
    for (const x of e) expect(x.subject.selection).toBeUndefined();
  });
});

/** #1579 part 2 -- A NUMBER THAT LEADS THE PLURAL IS COUNTED, NOT CHOSEN. "defending player exiles two permanents they control" (Bane of Bala Ged), "that player sacrifices two permanents of their choice" (Greater Harvester), "Each opponent sacrifices two permanents of their choice"
 *  (Earth-Cult Elemental, d20 result 20), "Sacrifice up to three permanents" (Baba Lysaga), "sacrifices seven permanents of their choice" (Nicol Bolas, Planeswalker) are a number picked from the whole class, which is what `counted` says. "half the permanents they control of their choice"
 *  (Pox Plague) is a number picked by a player too, and `counted` as well: `chosen` is a set the CARD defined. */
describe("a numbered permanent mass is counted", () => {
  test.each([["Bane of Bala Ged", "exiled"], ["Greater Harvester", "sacrifice"], ["Baba Lysaga, Night Witch", "sacrifice"], ["Nicol Bolas, Planeswalker", "sacrifice"], ["Earth-Cult Elemental", "sacrifice"]])("%s (%s): counted", (name, verb) => {
    const e = rowOf(name).tags.abilities.flatMap((a) => a.emits ?? []).filter((x) => x.verb === verb && x.subject.scope === "all" && [x.subject.type].flat().includes("permanent"));
    expect(e.length).toBeGreaterThan(0);
    for (const x of e) expect(x.subject.selection).toBe("counted");
  });
  test("Pox Plague ('half the permanents they control of their choice') is counted", () => {
    const e = removals("Pox Plague");
    expect(e.length).toBeGreaterThan(0);
    for (const x of e) expect(x.subject.selection).toBe("counted");
  });
});
