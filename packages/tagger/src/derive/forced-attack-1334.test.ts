import { describe, expect, test } from "vitest";
import { grammarClauseRecords } from "../index.js";
import { deriveAsCorpus } from "../derive-worker.js";
import fixtures from "./forced-attack-1334.fixtures.json" with { type: "json" };

/** #1334, owner ruling 2026-11-26: "fix the misread and park it". "Target creature attacks this turn if able" (CR 508.1d: a requirement) is NOT a `cant`, and the grammar read it as one with a negated object ("not attack this turn if able"). It is not goad either
 *  (CR 701.15: goad adds "attacks a player other than the goading player"). The clause stays honestly unread: no `cant`, no emit, no forced-attack reading until a consumer exists. A genuine "can't attack" keeps its `cant`. Stored documents and clauses of the production corpus, 2026-11-26. */
type Fx = { source: Record<string, unknown>; canonical: unknown[] | null; segmentHash?: string };
const F = fixtures as unknown as Record<string, Fx>;
const records = (name: string) => grammarClauseRecords(F[name]!.source as never)!.records;
const cants = (name: string) => records(name).flatMap((r) => (r.actions ?? []).filter((a) => a.verb === "cant").map((a) => String(a.object)));
const derived = (name: string) => deriveAsCorpus({ doc: { oracleId: name, name, canonical: F[name]!.canonical ?? [], segmentHash: F[name]!.segmentHash } as never, source: F[name]!.source, isToken: false }).tags;

describe("a forced attack or block is no cant", () => {
  test.each([
    ["Incite War", "Creatures target player controls attack this turn if able."],
    ["Siren's Call", "Creatures the active player controls attack this turn if able."],
    ["Maddening Imp", "attack this turn if able"],
    ["Provoke", "That creature blocks this turn if able."],
    ["Hustle // Bustle", "Target creature attacks or blocks this turn if able."],
    ["Phyrexian Juggernaut", "attacks each combat if able"],
    ["Goblin Rabblemaster", "attack each combat if able"],
  ])("%s", (name, printed) => {
    expect(String(F[name]!.source.oracleText)).toContain(printed);
    expect(cants(name).filter((c) => /\bnot (?:attack|block)/i.test(c)), name).toEqual([]);
  });

  test("Dulcet Sirens, Gideon Jura and Siren's Call carry no forced-attack cant at all, and their other cants are untouched", () => {
    for (const n of ["Dulcet Sirens", "Gideon Jura", "Siren's Call"]) expect(cants(n).filter((c) => /if able|not (?:attack|block)/i.test(c)), n).toEqual([]);
    expect(String(F["Gideon Jura"]!.source.oracleText)).toContain("creatures that player controls attack Gideon Jura if able");
    expect(String(F["Dulcet Sirens"]!.source.oracleText)).toContain("Target creature attacks target opponent this turn if able");
  });

  test("the clause derives no ability and no emit, and sits in `unclaimed` as no cant (Incite War: the first-strike mode is still read)", () => {
    const t = derived("Incite War");
    const forced = (t.unclaimed ?? []).filter((u) => u.clause === 2);
    expect(forced.length).toBe(1);
    expect(forced[0]!.verb).not.toBe("cant");
    expect(forced[0]!.verb).not.toBe("goad");
    expect(t.abilities.filter((a) => a.clause === 2)).toEqual([]);
    expect(t.abilities.some((a) => a.effect.kind === "keyword-grant")).toBe(true);
  });
});

describe("a later 'that creature' still resolves through the requirement to its target (Mark for Death)", () => {
  // "Target creature an opponent controls blocks this turn if able. Untap that creature." The requirement is parked unread, but the creature it names is still the spell's target, so the untap that follows keeps `scope: target` (what a "whenever you cast a spell that targets a creature" payoff reads).
  test("Mark for Death: the untap's subject and its emit are the targeted opponent's creature", () => {
    expect(String(F["Mark for Death"]!.source.oracleText)).toContain("Target creature an opponent controls blocks this turn if able. Untap that creature.");
    const untap = derived("Mark for Death").abilities.find((a) => a.effect.kind === "untap")!;
    // the untap's own "that creature" is the opponent's creature; its emit is the targeted one (`scope: target`, as for every "that creature" after a target)
    expect(untap.effect.subject).toMatchObject({ type: "creature", control: "opp" });
    expect(untap.emits?.find((e) => e.verb === "untaps")?.subject).toMatchObject({ type: "creature", scope: "target", control: "opp" });
    expect(untap.targets).toEqual([{ type: "creature", control: "opp" }]);
  });
  test("and Provoke (the untap names its own target first) is unchanged", () => {
    const untap = derived("Provoke").abilities.find((a) => a.effect.kind === "untap")!;
    expect(untap.effect.subject).toMatchObject({ type: "creature", scope: "target", control: "opp" });
  });
});

describe("a genuine restriction keeps its cant", () => {
  test("Pacifism (can't attack or block) and Moat (can't attack) still read a restriction", () => {
    for (const n of ["Pacifism", "Moat"]) {
      expect(cants(n).length, n).toBeGreaterThan(0);
      expect(derived(n).abilities.some((a) => a.effect.kind === "restriction"), n).toBe(true);
    }
  });
  test("Maarika's 'must be blocked if able' is untouched (not in this ruling)", () => {
    expect(cants("Maarika, Brutal Gladiator")).toContain("be unblocked");
  });
});
