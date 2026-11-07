import { describe, expect, test } from "vitest";
import { deriveRow } from "../derive-worker.js";
import { grammarClauseRecords } from "../grammar/clause-record.js";
import fixtures from "./sacrifice-split.fixtures.json" with { type: "json" };

/** #1523 part 2 (owner ruling 2026-11-07) -- "Sacrifice this artifact and thirteen Blood tokens" is TWO sacrifices: the card itself, and the
 *  tail, which is its own sacrifice emit like any other cost sacrifice (Ashnod's Altar, Viscera Seer). Source documents and stored
 *  `cardClauses.canonical` dumped from Mongo (DERIVE 472 tree, 2026-11-07): `sacrifice-split.fixtures.json`. */
type Fx = { source: Record<string, unknown>; canonical: unknown[] };
const fx = (name: string) => (fixtures as Record<string, Fx>)[name]!;
const rowOf = (name: string) => deriveRow({ doc: { oracleId: name, name, canonical: fx(name).canonical } as never, source: fx(name).source, isToken: false });
const grammarRowOf = (name: string) => deriveRow({ doc: { oracleId: name, name, canonical: grammarClauseRecords(fx(name).source as never).records } as never, source: fx(name).source, isToken: false });
const dies = (row: ReturnType<typeof rowOf>) =>
  row.tags.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "dies" || e.verb === "sacrifice").map((e) => ({ verb: e.verb, ...e.subject }));
const selfOf = (row: ReturnType<typeof rowOf>) => dies(row).filter((s) => s.self === true);
const tailOf = (row: ReturnType<typeof rowOf>) => dies(row).filter((s) => s.self !== true);

describe("Glass-Cast Heart: the card, and a separate Blood-token sacrifice", () => {
  test("the self sacrifice is the artifact and carries no `blood`", () => {
    const self = selfOf(rowOf("Glass-Cast Heart"));
    expect(self.length).toBeGreaterThan(0);
    for (const s of self) { expect(s.subtype).toBeUndefined(); expect(s.type).toBe("artifact"); }
  });
  test("the tail is a Blood-token sacrifice, you control, not a creature", () => {
    const tail = tailOf(rowOf("Glass-Cast Heart"));
    expect(tail.map((s) => [s.verb, s.subtype, s.token, s.control])).toEqual([["sacrifice", "blood", true, "you"], ["dies", "blood", true, "you"]]);
    for (const s of tail) expect([s.type ?? []].flat()).not.toContain("creature");
  });
});

describe("a creature tail makes the card a sacrifice outlet", () => {
  test.each(["Sword of the Ages", "Emrakul's Evangel", "Magus of the Order", "Kyscu Drake"])("%s: a tail `dies` creature you control", (name) => {
    const tail = tailOf(rowOf(name)).filter((s) => s.verb === "dies");
    expect(tail.length).toBe(1);
    expect([tail[0]!.type ?? []].flat()).toContain("creature");
    expect(tail[0]!.control).toBe("you");
    expect(selfOf(rowOf(name)).filter((s) => s.verb === "dies").length).toBe(1);
  });
  test("Sword of the Ages: the tail is a class, not the card", () => {
    const tail = tailOf(rowOf("Sword of the Ages"));
    expect(tail.length).toBeGreaterThan(0);
    expect(tail.every((s) => s.self === undefined)).toBe(true);
  });
  test("Kyscu Drake on the grammar path: the card, and one separate creature tail (the grammar already read two objects)", () => {
    const row = grammarRowOf("Kyscu Drake");
    expect(selfOf(row).filter((s) => s.verb === "dies").length).toBe(1);
    expect(tailOf(row).filter((s) => s.verb === "dies").map((s) => s.named)).toEqual(["spitting drake"]);
  });
  test("the convention being copied: Viscera Seer's cost sacrifice is a `dies` creature you control", () => {
    expect(tailOf(rowOf("Viscera Seer")).filter((s) => s.verb === "dies").map((s) => [s.type, s.control])).toEqual([["creature", "you"]]);
  });
});

describe("the payment holds both objects (the cost is not free of the tail)", () => {
  const sac = (name: string) => rowOf(name).tags.abilities.find((a) => a.payment?.sacrifice !== undefined)!.payment!.sacrifice!;
  test("Glass-Cast Heart: the artifact, then thirteen Blood tokens", () => {
    const s = sac("Glass-Cast Heart");
    expect(s.map((o) => o.amount)).toEqual(["1", "13"]);
    expect(s[0]!.subject.self).toBe(true);
    expect(s[1]!.subject).toMatchObject({ subtype: "blood", token: true, control: "you" });
    expect(s[1]!.subject.self).toBeUndefined();
  });
  test("Sword of the Ages: itself, then any number of creatures you control", () => {
    const s = sac("Sword of the Ages");
    expect(s.map((o) => o.amount)).toEqual(["1", "any"]);
    expect(s[1]!.subject).toMatchObject({ type: "creature", control: "you" });
  });
  test("Mount Doom (the card's own name): itself, then a legendary artifact", () => {
    const s = sac("Mount Doom");
    expect(s[0]!.subject.self).toBe(true);
    expect(s[1]!.subject).toMatchObject({ legendary: true, type: "artifact" });
  });
});

describe("a sacrifice whose cards the same ability exiles (#1523 part 2 fix)", () => {
  const exiled = (name: string) => rowOf(name).tags.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "dies" || e.verb === "sacrifice").map((e) => [e.verb, e.subject.self === true, e.exiledAtOnce === true]);
  test("Sword of the Ages: the creature tail is marked, the card itself is not", () => {
    expect(exiled("Sword of the Ages")).toEqual([["sacrifice", true, false], ["dies", true, false], ["sacrifice", false, true], ["dies", false, true]]);
  });
  test.each(["Emrakul's Evangel", "Magus of the Order", "Viscera Seer", "Ashnod's Altar"])("%s: nothing is exiled, nothing is marked", (name) => {
    expect(exiled(name).every(([, , m]) => m === false)).toBe(true);
  });
});
