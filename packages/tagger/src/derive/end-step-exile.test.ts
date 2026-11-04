import { describe, expect, test } from "vitest";
import { deriveRow } from "../derive-worker.js";
import fixtures from "./end-step-exile.fixtures.json" with { type: "json" };

/** #1502 -- AN END-STEP EXILE OF WHAT THE CARD JUST PUT ONTO THE BATTLEFIELD. Source documents and stored `cardClauses.canonical`
 *  dumped from Mongo (DERIVE 450 tree, 2026-11-04): `end-step-exile.fixtures.json`. */
const rowOf = (name: string) => {
  const f = (fixtures as Record<string, { source: Record<string, unknown>; canonical: unknown[] }>)[name]!;
  return deriveRow({ doc: { oracleId: name, name, canonical: f.canonical } as never, source: f.source, isToken: false });
};
const exiledFromBattlefield = (name: string) => rowOf(name).tags.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "exiled" && e.subject.fromZone === "battlefield");
const unclaimedExiles = (name: string) => (rowOf(name).tags.unclaimed ?? []).filter((u) => u.verb === "exile");

describe("A: the token maker's own end-step exile is claimed, not unclaimed", () => {
  test.each(["Zektar Shrine Expedition", "Living Laser", "Nahiri, the Unforgiving", "Flamerush Rider", "Altaïr Ibn-La'Ahad"])("%s: one token exile from the battlefield, nothing unclaimed", (name) => {
    expect(unclaimedExiles(name).filter((u) => u.fromZone === "battlefield")).toEqual([]);
    const ex = exiledFromBattlefield(name);
    expect(ex).toHaveLength(1);
    expect(ex[0]!.subject.token).toBe(true);
  });
  test("Zektar Shrine: the exiled token is the 7/1 Elemental creature", () => {
    const s = exiledFromBattlefield("Zektar Shrine Expedition")[0]!.subject;
    expect([s.type, s.subtype]).toEqual(["creature", "elemental"]);
  });
  test("Nahiri: the token stays untyped (its copied card is a creature or Equipment card)", () => {
    expect(exiledFromBattlefield("Nahiri, the Unforgiving")[0]!.subject.type).toBeUndefined();
  });
});

describe("B: Gruesome Encore's reanimation is a put onto the battlefield, its exile is of the creature", () => {
  test("no exile of a graveyard card, one exile from the battlefield of a creature that is no token", () => {
    const emits = rowOf("Gruesome Encore").tags.abilities.flatMap((a) => a.emits ?? []);
    expect(emits.filter((e) => e.verb === "exiled" && e.subject.fromZone !== "battlefield")).toEqual([]);
    expect(emits.filter((e) => e.verb === "enters").map((e) => [e.subject.type, e.subject.fromZone])).toEqual([["creature", "graveyard"]]);
    const ex = exiledFromBattlefield("Gruesome Encore");
    expect(ex).toHaveLength(1);
    expect([ex[0]!.subject.type, ex[0]!.subject.token]).toEqual(["creature", null]);
    expect(unclaimedExiles("Gruesome Encore")).toEqual([]);
  });
  test("the effect stays graveyard-recursion", () => {
    expect(rowOf("Gruesome Encore").tags.abilities.some((a) => a.effect.kind === "graveyard-recursion")).toBe(true);
  });
});

describe("C: Sauron's conditional end-step exile reaches the exiled-from-battlefield consumers", () => {
  test("the exiled emit is the Wraith creature token, from the battlefield", () => {
    const ex = exiledFromBattlefield("Sauron, the Necromancer").filter((e) => e.subject.token === true);
    expect(ex).toHaveLength(1);
    expect([ex[0]!.subject.type, ex[0]!.subject.subtype]).toEqual(["creature", "wraith"]);
  });
});

describe("controls", () => {
  test("a flicker that returns the card at the next end step exiles it from the battlefield once and is unchanged otherwise", () => {
    expect(exiledFromBattlefield("Eerie Interlude")).toHaveLength(1);
  });
  test("an ordinary token maker emits no exile", () => {
    expect(rowOf("Raise the Alarm").tags.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "exiled")).toEqual([]);
  });
});
