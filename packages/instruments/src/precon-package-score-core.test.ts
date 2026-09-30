import { describe, expect, it } from "vitest";
import type { UpgradePackage, UpgradeSwap } from "@edh-seer/matcher/upgrade-package";
import { hardViolations, s1Share, s2Kept, s2Sample, strictlyBetter, type PackageFacts } from "./precon-package-score-core.js";

describe("strictlyBetter", () => {
  it("takes the cheaper card that loses nothing: Night's Whisper over Divination", () => {
    expect(strictlyBetter({ manaValue: 3, timing: 0, frequency: 0 }, { manaValue: 2, timing: 0, frequency: 0 })).toEqual({ ok: true, gained: ["manaValue"] });
  });

  it("names every measure gained", () => {
    expect(strictlyBetter({ manaValue: 3, timing: 2, permanence: 2 }, { manaValue: 1, timing: 2, permanence: 3 }).gained).toEqual(["manaValue", "permanence"]);
  });

  it("refuses a card that is cheaper but slower", () => {
    expect(strictlyBetter({ manaValue: 3, timing: 2 }, { manaValue: 2, timing: 0 }).ok).toBe(false);
  });

  it("refuses an equal card: nothing is gained", () => {
    expect(strictlyBetter({ manaValue: 2, timing: 0 }, { manaValue: 2, timing: 0 }).ok).toBe(false);
  });

  it("reads drawback and restriction as lower-is-better", () => {
    expect(strictlyBetter({ manaValue: 2, timing: 0, drawback: 1 }, { manaValue: 2, timing: 0, drawback: 0 }).ok).toBe(true);
    expect(strictlyBetter({ manaValue: 2, timing: 0, restriction: 0 }, { manaValue: 2, timing: 0, restriction: 1 }).ok).toBe(false);
  });

  it("cannot compare a measure only the cut carries", () => {
    expect(strictlyBetter({ manaValue: 3, timing: 0, rateFloor: 40 }, { manaValue: 1, timing: 2 }).ok).toBe(false);
  });

  it("never ranks a card without mana value or timing", () => {
    expect(strictlyBetter({ manaValue: 3 }, { manaValue: 1, timing: 2 }).ok).toBe(false);
  });
});

const swap = (out: string, into: string, extra: Partial<UpgradeSwap> = {}): UpgradeSwap => ({
  out: { name: out, reason: "costs 3 for one card" }, in: { name: into, reason: "the same job for 1 less mana" }, kind: "synergy", ...extra,
});
const pkg = (swaps: UpgradeSwap[], target: 2 | 3 | 4 = 3, bringDown: UpgradeSwap[] = []): UpgradePackage => ({
  target, from: "1-2", bringDown, sections: [{ id: "consistency", swaps }],
});
const facts = (over: Partial<PackageFacts> = {}): PackageFacts => ({
  commanders: ["Nalia de'Arnise"], deck: new Set(["Divination", "Nalia de'Arnise", "Murder"]), identity: new Set(["W", "B"]),
  identityOf: (n) => (n === "Lightning Bolt" ? ["R"] : n === "Nowhere Card" ? null : ["B"]),
  bandAfter: "1-2", manaBefore: 1, manaAfter: 1, role: () => null, ...over,
});

describe("hardViolations", () => {
  it("passes a clean package", () => {
    expect(hardViolations(pkg([swap("Divination", "Night's Whisper")]), facts())).toEqual([]);
  });

  it("H1: fails a package that leaves the deck above its target", () => {
    expect(hardViolations(pkg([swap("Divination", "Night's Whisper")], 2), facts({ bandAfter: "3" })).map((v) => v.measure)).toEqual(["H1"]);
    expect(hardViolations(pkg([swap("Divination", "Night's Whisper")], 4), facts({ bandAfter: "4-5" }))).toEqual([]);
  });

  it("H2: fails an empty or overlong reason", () => {
    const s = swap("Divination", "Night's Whisper");
    s.out.reason = " ";
    s.in.reason = "x".repeat(161);
    expect(hardViolations(pkg([s]), facts()).map((v) => v.measure)).toEqual(["H2", "H2"]);
  });

  it("H3: fails an add outside the identity, not in the index, or already in the deck", () => {
    expect(hardViolations(pkg([swap("Divination", "Lightning Bolt")]), facts()).map((v) => v.detail)).toEqual(["Lightning Bolt is outside the identity"]);
    expect(hardViolations(pkg([swap("Divination", "Nowhere Card")]), facts()).map((v) => v.measure)).toEqual(["H3"]);
    expect(hardViolations(pkg([swap("Divination", "Murder")]), facts()).map((v) => v.measure)).toEqual(["H3"]);
  });

  it("H3: fails cutting the commander, or a card cut or added twice across sections", () => {
    expect(hardViolations(pkg([swap("Nalia de'Arnise", "Night's Whisper")]), facts()).map((v) => v.measure)).toEqual(["H3"]);
    const twice = pkg([swap("Divination", "Night's Whisper")], 3, [swap("Divination", "Sign in Blood")]);
    expect(hardViolations(twice, facts()).map((v) => v.detail)).toEqual(["Divination is cut twice"]);
  });

  it("H4: fails a role swap that loses a role or is not strictly better", () => {
    const role = swap("Divination", "Night's Whisper", { kind: "role", role: "draw" });
    const lost = facts({ role: () => ({ cutRoles: ["draw", "ramp"], addRoles: ["draw"], cut: { manaValue: 3, timing: 0 }, add: { manaValue: 2, timing: 0 } }) });
    expect(hardViolations(pkg([role]), lost).map((v) => v.detail)).toEqual(["Divination -> Night's Whisper: loses ramp"]);
    const worse = facts({ role: () => ({ cutRoles: ["draw"], addRoles: ["draw"], cut: { manaValue: 2, timing: 2 }, add: { manaValue: 2, timing: 0 } }) });
    expect(hardViolations(pkg([role]), worse).map((v) => v.measure)).toEqual(["H4"]);
    expect(hardViolations(pkg([role]), facts()).map((v) => v.measure)).toEqual(["H4"]);
  });

  it("H5: fails a package that makes the mana base worse", () => {
    expect(hardViolations(pkg([swap("Divination", "Night's Whisper")]), facts({ manaBefore: 0.8, manaAfter: 0.9 })).map((v) => v.measure)).toEqual(["H5"]);
  });
});

describe("soft measures", () => {
  it("S1 counts a precon only when every target has five swaps", () => {
    const five = Array.from({ length: 5 }, (_, i) => swap(`Out ${i}`, `In ${i}`));
    expect(s1Share([{ packages: [pkg(five, 2), pkg(five, 3)] }, { packages: [pkg(five, 2), pkg(five.slice(1), 3)] }, {}])).toBeCloseTo(1 / 3);
    expect(s1Share([])).toBe(0);
  });

  it("S2 samples every ninth precon, twenty in all", () => {
    const sample = s2Sample(Array.from({ length: 200 }, (_, i) => i));
    expect(sample).toHaveLength(20);
    expect(sample.slice(0, 3)).toEqual([0, 9, 18]);
  });

  it("S2 counts a precon kept when its synergy does not drop", () => {
    expect(s2Kept([{ before: 3, after: 3 }, { before: 3, after: 3.2 }, { before: 3, after: 2.9 }])).toBe(2);
  });
});
