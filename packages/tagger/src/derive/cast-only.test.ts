import { describe, expect, test } from "vitest";
import { deriveCardTags, deriveInputOf } from "../index.js";
import type { CardTags, ClauseRecord } from "../index.js";
import { neverEntersUncast } from "./cast-only.js";
import fixtures from "./cast-only.fixtures.json" with { type: "json" };

/** #1513 part 2. Source documents and clause records are the corpus's own (cards, cardClauses.canonical, or the grammar's reading for a grammar-sourced row), dumped from Mongo 2026-11-09 (DERIVE 479). */
const F = fixtures as unknown as Record<string, { source: Record<string, unknown>; canonical: ClauseRecord[] }>;
const tagsOf = (name: string) => deriveCardTags(deriveInputOf(F[name]!.source as never, name, name, F[name]!.canonical)) as CardTags;
const ofPutEmits = (name: string) => tagsOf(name).abilities.flatMap((a) => a.emits ?? []).filter((e) => e.ofPut === true);
const triggered = (name: string) => tagsOf(name).abilities.filter((a) => a.trigger !== undefined);

describe("castOnly", () => {
  test("Primeval Spawn: \"If this creature would enter and it wasn't cast or no mana was spent to cast it, exile it instead.\" marks its leave trigger", () => {
    const leaves = triggered("Primeval Spawn").filter((a) => a.trigger!.verbs.includes("leaves"));
    expect(leaves.length).toBeGreaterThan(0);
    expect(leaves.every((a) => a.castOnly === true)).toBe(true);
  });
  test("Thief of Existence: only the leave trigger its own cast trigger grants is marked, not the cast trigger", () => {
    const t = triggered("Thief of Existence");
    expect(t.filter((a) => a.castOnly === true).map((a) => [a.trigger!.verbs[0], a.grantedBy !== undefined])).toEqual([["leaves", true]]);
  });
  test.each(["Hypnox", "Champion of the Clachan", "Rancor", "Dawn of the Dead"])("%s is left unmarked: its triggers do not need a cast", (name) => {
    expect(triggered(name).filter((a) => a.castOnly === true)).toEqual([]);
  });
  test("a class-wide \"would enter and it wasn't cast\" (Containment Priest) is not the card's own", () => {
    expect(neverEntersUncast(F["Containment Priest"]!.source.oracleText as string, "Containment Priest")).toBe(false);
    expect(neverEntersUncast(F["Primeval Spawn"]!.source.oracleText as string, "Primeval Spawn")).toBe(true);
    expect(neverEntersUncast("If Primeval Spawn would enter and it wasn’t cast, exile it instead.", "Primeval Spawn")).toBe(true);
  });
});

describe("ofPut", () => {
  test.each([
    ["Dawn of the Dead", ["exiled", "leaves"]],
    ["Whip of Erebos", ["exiled", "leaves"]],
    ["Footsteps of the Goryo", ["dies", "sacrifice"]],
    ["Zara, Renegade Recruiter", ["leaves"]],
    ["Purphoros, Bronze-Blooded", ["dies", "sacrifice"]],
  ])("%s: the removal of what its clause put is marked", (name, verbs) => {
    expect(ofPutEmits(name).map((e) => e.verb).sort()).toEqual([...verbs].sort());
  });
  test("Vindictive Triumph: the exile of the TARGET is not marked, the end-step exile of what it returned is", () => {
    const ex = tagsOf("Vindictive Triumph").abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "exiled");
    expect(ex.map((e) => [e.subject.scope === "target", e.ofPut === true])).toEqual([[true, false], [false, true]]);
  });
  test("Journey to the Lost City: \"Put all permanent cards exiled with this enchantment onto the battlefield, then sacrifice it\" sacrifices the enchantment, not what was put", () => {
    expect(ofPutEmits("Journey to the Lost City")).toEqual([]);
  });
  test.each(["Come Back Wrong", "Ephemerate"])("%s: a removal that is not the pronoun of a put in its clause is unmarked unless it is the sacrifice of the returned card", (name) => {
    const marked = ofPutEmits(name).map((e) => e.verb).sort();
    expect(marked).toEqual(name === "Come Back Wrong" ? ["dies", "sacrifice"] : []);
  });
});

describe("actsOnHost", () => {
  test.each(["Parallax Dementia", "Reality Acid"])("%s: its leaves trigger acts on the enchanted permanent", (name) => {
    expect(triggered(name).filter((a) => a.actsOnHost === true).map((a) => a.trigger!.verbs)).toEqual([["leaves"]]);
  });
  test.each(["Rancor", "Goblin Shrine", "Chime of Night"])("%s: a leave trigger that does not name the host is unmarked", (name) => {
    expect(triggered(name).filter((a) => a.actsOnHost === true)).toEqual([]);
  });
});

describe("ofPut: a definite noun phrase", () => {
  test("Sneak Attack: \"Sacrifice the creature at the beginning of the next end step\" is the removal of what the clause put", () => {
    expect(ofPutEmits("Sneak Attack").map((e) => e.verb).sort()).toEqual(["dies", "sacrifice"]);
  });
});
