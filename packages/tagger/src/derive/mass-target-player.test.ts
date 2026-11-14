import { describe, expect, test } from "vitest";
import { deriveRow } from "../derive-worker.js";
import fixtures from "./mass-target-player.fixtures.json" with { type: "json" };

/** #1266 -- "DESTROY ALL CREATURES TARGET PLAYER CONTROLS" IS A MASS EFFECT, NOT A TARGETED KILL. The PLAYER is the target, the creatures are the class: scope `all` / `each`, control from the player named.
 *  Read as scope `target` it is the same shape as "destroy target creature", so `removal.targeted` read a wipe as a targeted kill (and `boardWipe` needed a printed pattern to find it).
 *  Card documents and stored `cardClauses.canonical` dumped from Mongo (2026-11-14): `mass-target-player.fixtures.json`. */
const rowOf = (name: string) => {
  const f = (fixtures as Record<string, { source: Record<string, unknown>; canonical: unknown[] }>)[name]!;
  return deriveRow({ doc: { oracleId: name, name, canonical: f.canonical } as never, source: f.source, isToken: false });
};
const emits = (name: string, verb: string) => rowOf(name).tags.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === verb);

describe("a mass effect on one player's board is scope all / each, not target", () => {
  test.each([
    ["Mogg Infestation", "dies", "all"],
    ["Rain of Daggers", "dies", "all"],
    ["Overwhelming Forces", "dies", "all"],
    ["Primeval Light", "dies", "all"],
    ["Settle the Wreckage", "exiled", "all"],
    ["Settle the Wreckage", "leaves", "all"],
    ["Hurkyl's Recall", "leaves", "all"],
    ["River's Rebuke", "leaves", "all"],
    ["Sudden Disappearance", "exiled", "all"],
    ["Contagion Engine", "counter-added", "each"],
  ])("%s: the %s emit is scope %s and the board is the targeted player's (control opp or any, never you)", (name, verb, scope) => {
    const e = emits(name, verb);
    expect(e.length, name).toBeGreaterThan(0);
    expect(e.map((x) => x.subject.scope), name).toEqual(e.map(() => scope));
    expect(e.every((x) => x.subject.control === "opp" || x.subject.control === "any"), name).toBe(true);
  });

  test.each(["Mogg Infestation", "Rain of Daggers", "Contagion Engine", "Settle the Wreckage"])("%s: the mass carries the targetPlayer marker (a Wrath has none)", (name) => {
    const all = rowOf(name).tags.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.subject.scope === "all" || e.subject.scope === "each");
    expect(all.filter((e) => ["dies", "exiled", "leaves", "counter-added"].includes(e.verb)).every((e) => e.subject.targetPlayer === true), name).toBe(true);
  });

  test("Seismic Wave: the damage to each creature target opponent controls is scope each; \"any target\" stays a target", () => {
    const scopes = emits("Seismic Wave", "non-combat-damage").map((e) => e.subject.scope);
    expect(scopes).toEqual(["target", "each"]);
  });

  test("Terminate: one target creature stays target", () => {
    expect(emits("Terminate", "dies").map((x) => x.subject.scope)).toEqual(["target"]);
  });
  test("Flame Wave: the player or planeswalker target stays target, the creatures that player controls are each", () => {
    expect(emits("Flame Wave", "non-combat-damage").map((x) => x.subject.scope)).toEqual(["target", "target", "each"]);
  });
});

describe("the board of a targeted player keeps the control it had under scope target", () => {
  test.each([["Mogg Infestation", "dies"], ["Primeval Light", "dies"], ["River's Rebuke", "leaves"]])("%s: a kill or bounce is an opponent's", (name, verb) => {
    expect(emits(name, verb).map((e) => e.subject.control)).toEqual(emits(name, verb).map(() => "opp"));
  });
  test("Contagion Engine: a counter has no removal default, control stays any", () => {
    expect(emits("Contagion Engine", "counter-added").map((e) => e.subject.control)).toEqual(["any"]);
  });
});
