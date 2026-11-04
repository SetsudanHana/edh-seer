import { describe, expect, test } from "vitest";
import { deriveRow } from "../derive-worker.js";
import { grammarClauseRecords } from "../grammar/clause-record.js";
import fixtures from "./end-step-exile.fixtures.json" with { type: "json" };

/** #1502 -- AN END-STEP EXILE OF WHAT THE CARD JUST PUT ONTO THE BATTLEFIELD. Source documents and stored `cardClauses.canonical`
 *  dumped from Mongo (DERIVE 450 tree, 2026-11-04): `end-step-exile.fixtures.json`. */
const rowOf = (name: string) => {
  const f = (fixtures as Record<string, { source: Record<string, unknown>; canonical: unknown[] }>)[name]!;
  return deriveRow({ doc: { oracleId: name, name, canonical: f.canonical } as never, source: f.source, isToken: false });
};
const exiledFromBattlefield = (name: string) => rowOf(name).tags.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "exiled" && e.subject.fromZone === "battlefield");
/** The same card through the GRAMMAR path: the records the grammar reads off the printed text (the main reanimator family derives from these). */
const grammarRowOf = (name: string) => {
  const f = (fixtures as Record<string, { source: Record<string, unknown>; canonical: unknown[] }>)[name]!;
  const g = grammarClauseRecords(f.source as never);
  return deriveRow({ doc: { oracleId: name, name, canonical: g.records } as never, source: f.source, isToken: false });
};
const emitsOf = (row: ReturnType<typeof rowOf>, verb: string) => row.tags.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === verb);
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
    expect([ex[0]!.subject.type, ex[0]!.subject.token]).toEqual(["creature", false]);
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

describe("#1502 fix round: the exile of a put NONTOKEN permanent", () => {
  const stamped = (emits: ReturnType<typeof emitsOf>) => emits.filter((e) => e.subject.fromZone === "battlefield");
  test("Zirilan of the Claw (a Dragon CARD searched and put): its end-step exile is from the battlefield, yours, no token, not the library", () => {
    const ex = emitsOf(rowOf("Zirilan of the Claw"), "exiled");
    expect(ex.map((e) => e.subject.fromZone)).toEqual(["battlefield"]);
    expect([ex[0]!.subject.control, ex[0]!.subject.token, ex[0]!.subject.subtype]).toEqual(["you", false, "dragon"]);
  });
  test.each(["Whip of Erebos", "Dawn of the Dead"])("%s (grammar path): one battlefield exile of a creature, yours, no token, untargeted", (name) => {
    for (const row of [grammarRowOf(name)]) {
      const ex = emitsOf(row, "exiled");
      expect(ex.every((e) => e.subject.fromZone === "battlefield")).toBe(true);
      expect(ex.length).toBeGreaterThanOrEqual(1);
      for (const e of [...ex, ...stamped(emitsOf(row, "leaves"))]) expect([e.subject.control, e.subject.token, e.subject.scope]).toEqual(["you", false, undefined]);
    }
  });
  test("Whip of Erebos (stored model clauses): the same", () => {
    for (const e of emitsOf(rowOf("Whip of Erebos"), "exiled")) expect([e.subject.fromZone, e.subject.control, e.subject.token, e.subject.scope]).toEqual(["battlefield", "you", false, undefined]);
  });
  test("Gruesome Encore: the exile is yours and untargeted, and the put's `enters` is yours, not the opponent's graveyard owner", () => {
    const ex = exiledFromBattlefield("Gruesome Encore")[0]!;
    expect([ex.subject.control, ex.subject.scope, ex.subject.token]).toEqual(["you", undefined, false]);
    expect(emitsOf(rowOf("Gruesome Encore"), "enters").map((e) => e.subject.control)).toEqual(["you"]);
  });
  test("Ashen Powder (no end-step exile): its `enters` is left as stored, the opponent's graveyard owner (CEILING, derive.ts)", () => {
    expect(emitsOf(rowOf("Ashen Powder"), "enters").map((e) => e.subject.control)).toEqual(["opp"]);
  });
  test("Vindictive Triumph: the real exile of the target stays the opponent's; the end-step exile of the returned permanent is yours", () => {
    const ex = emitsOf(rowOf("Vindictive Triumph"), "exiled");
    expect(ex.map((e) => [e.subject.control, e.subject.scope])).toEqual([["opp", "target"], ["you", undefined]]);
  });
});
