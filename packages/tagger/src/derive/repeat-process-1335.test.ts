import { describe, expect, test } from "vitest";
import { deriveAsCorpus } from "../derive-worker.js";
import fixtures from "./repeat-process-1335.fixtures.json" with { type: "json" };

/** #1335, owner ruling 2026-11-26: "repeat this process" is a LOOP, and the ability whose clause says so carries `loop` ("conditional": "if ... repeat this process", "until ...", "unbounded": "any number of times", "fixed": "once", "two more times", "for <each>"). New vocabulary for future goldfish and score readers;
 *  no matcher reads it. The store files the sentence as a `trigger-again` action (Panharmonicon-style doubling, which it is not); the printed-verb guard (#1321, DERIVE 379) drops that action to `unclaimed`, so each of the 13 cards kept its effect and lost the fact that it repeats. The marker claims it.
 *  Stored documents and clauses of the production corpus, 2026-11-26. */
type Fx = { source: Record<string, unknown>; canonical: unknown[]; segmentHash?: string };
const F = fixtures as unknown as Record<string, Fx>;
const rowOf = (name: string) => deriveAsCorpus({ doc: { oracleId: name, name, canonical: F[name]!.canonical, segmentHash: F[name]!.segmentHash } as never, source: F[name]!.source, isToken: false });
const looped = (name: string) => rowOf(name).tags.abilities.filter((a) => a.loop !== undefined);
const THIRTEEN = ["Sphinx's Tutelage", "Grist, the Hunger Tide", "Demonlord Belzenlok", "Cultivator Colossus", "Insatiable Frugivore", "Primal Surge", "Crooked Scales", "Tyrant of Discord", "Zimone and Dina", "Hoarder's Greed", "Grindstone", "Countryside Crusher", "Scalpelexis"];

describe("the abilities whose clause says 'repeat this process' carry loop", () => {
  test.each(THIRTEEN)("%s", (name) => {
    expect(String(F[name]!.source.oracleText)).toMatch(/repeat this process/i);
    expect(looped(name).length, name).toBeGreaterThan(0);
    // The misfiled trigger-again is claimed by the marker, not left unclaimed.
    expect((rowOf(name).tags.unclaimed ?? []).filter((u) => u.verb === "trigger-again"), name).toEqual([]);
  });
  test("Sphinx's Tutelage: the mill is the looped ability, conditional ('If two nonland cards that share a color were milled this way, repeat this process')", () => {
    expect(String(F["Sphinx's Tutelage"]!.source.oracleText)).toContain("If two nonland cards that share a color were milled this way, repeat this process.");
    const l = looped("Sphinx's Tutelage");
    expect(l.map((a) => [a.effect.kind, a.loop])).toEqual([["mill", "conditional"]]);
  });
  test("Primal Surge: conditional ('If you do, repeat this process')", () => {
    expect(new Set(looped("Primal Surge").map((a) => a.loop))).toEqual(new Set(["conditional"]));
  });
  test("the three shapes: unbounded (Ad Nauseam), fixed (Claim Jumper: 'repeat this process once'), conditional (Thieves' Auction: 'until')", () => {
    expect(new Set(looped("Ad Nauseam").map((a) => a.loop))).toEqual(new Set(["unbounded"]));
    expect(new Set(looped("Claim Jumper").map((a) => a.loop))).toEqual(new Set(["fixed"]));
    expect(new Set(looped("Thieves' Auction").map((a) => a.loop))).toEqual(new Set(["conditional"]));
  });
  test("a card without the phrase, and one whose only 'repeat this process' is reminder text (Jadelight Ranger's explore), carry none", () => {
    for (const n of ["Grizzly Bears", "Mulldrifter", "Jadelight Ranger"]) expect(looped(n), n).toEqual([]);
    expect(String(F["Jadelight Ranger"]!.source.oracleText)).toMatch(/\(.*repeat this process/is);
  });
});

// REVIEW OF #1335: the marker is for the abilities of the LOOPED sentences, not the whole clause. What comes after the loop (Plague of Vermin's Rats, Rally the Horde's tokens, Claim Jumper's shuffle) and the setup before it (Thieves' Auction's "Exile all nontoken permanents") are not repeated.
const marks = (name: string) => rowOf(name).tags.abilities.filter((a) => a.clause !== undefined).map((a) => `${a.effect.kind || "-"}${a.loop ? "*" : ""}`);
describe("only the abilities of the looped sentences carry loop", () => {
  test("post-loop actions carry none: Plague of Vermin's Rats, Rally the Horde's tokens, Demonlord Belzenlok's damage", () => {
    expect(marks("Plague of Vermin")).toEqual(["token-generation"]);
    expect(marks("Rally the Horde").at(-1)).toBe("token-generation");
    expect(marks("Demonlord Belzenlok").at(-1)).toBe("damage");
  });
  test("Claim Jumper: the loop is the search (twice: the first and the repeat), its trailing shuffle is not", () => {
    const m = marks("Claim Jumper");
    expect(m.at(-1)).not.toContain("*");
    expect(m.some((x) => x.endsWith("*"))).toBe(true);
  });
  test("Firemind's Foresight: the searches loop, the trailing shuffle does not", () => {
    const m = marks("Firemind's Foresight");
    expect(m.at(-1)).toBe("-");
    expect(m.filter((x) => x === "search*").length).toBeGreaterThan(0);
  });
  test("Thieves' Auction: the exile-all before the loop is not looped, the put onto the battlefield is", () => {
    expect(marks("Thieves' Auction")).toEqual(["-", "flicker*"]);
  });
  test("Struggle for Sanity: the exiles are looped, the return after the loop is not", () => {
    const m = marks("Struggle for Sanity");
    expect(m.at(-1)).not.toContain("*");
    expect(m.some((x) => x.endsWith("*"))).toBe(true);
  });
  test("what stays: Sphinx's Tutelage's mill, both of Primal Surge's abilities, Cultivator Colossus's put and draw, Ad Nauseam's loss of life", () => {
    expect(marks("Sphinx's Tutelage")[0]).toBe("mill*");
    expect(marks("Primal Surge")).toEqual(["-*", "flicker*"]);
    expect(marks("Cultivator Colossus").filter((x) => x.endsWith("*")).length).toBe(2);
    expect(marks("Ad Nauseam").some((x) => x.endsWith("*"))).toBe(true);
  });
});

// A stored `trigger-again` that says "repeat this process" is the loop whether or not the guard drops it: Sin, Spira's Punishment and The Tale of Tamiyo print "copy" elsewhere, so the guard kept it and they derived `trigger-doubling` (Panharmonicon-style doubling, which they are not).
test("Sin, Spira's Punishment and The Tale of Tamiyo derive no trigger-doubling from 'repeat this process'", () => {
  for (const n of ["Sin, Spira's Punishment", "The Tale of Tamiyo"]) expect(rowOf(n).tags.abilities.filter((a) => a.effect.kind === "trigger-doubling"), n).toEqual([]);
});
