import { expect, test } from "vitest";
import type { UpgradePackage } from "@edh-seer/matcher/upgrade-package";
import { afterLine, heroUpgradesLine, REPORT_DIFFERS, sameAsBelow, TARGET_MEANING, whatTheSwapsDo } from "./precon-upgrades.js";

const pkg = (target: 2 | 3 | 4): UpgradePackage => ({
  target, from: "3", bringDown: [],
  sections: [{ id: "lands", swaps: [{ kind: "land", out: { name: "A", reason: "a" }, in: { name: "B", reason: "b" } }] }],
});

test("afterLine states the band the report reads the swapped deck at, not the target", () => {
  const withAfter = (t: 2 | 3 | 4, band: "1-2" | "3" | "4-5"): UpgradePackage => ({ ...pkg(t), after: { band, synergy: 3, mana: 1 } });
  expect(afterLine(withAfter(4, "3"))).toContain("the report reads the deck at bracket 3");
  expect(afterLine(withAfter(3, "1-2"))).toContain("the report reads the deck at bracket 1–2");
  expect(afterLine(withAfter(4, "4-5"))).toContain("the report reads the deck at bracket 4–5");
});

test("bracket 4 is not said to exclude 5", () => {
  expect(TARGET_MEANING[4]).not.toMatch(/tournament/);
});

test("afterLine and sameAsBelow name the bracket by its label", () => {
  expect(afterLine(pkg(2))).toContain("still fits bracket 1–2");
  expect(afterLine(pkg(4))).toContain("still fits bracket 4–5");
  expect(sameAsBelow(pkg(4), [pkg(3), pkg(4)])).toContain("same swaps as at bracket 3");
  expect(sameAsBelow(pkg(3), [pkg(2), pkg(3)])).toContain("same swaps as at bracket 1–2");
  expect(sameAsBelow(pkg(3), [pkg(2), pkg(3)])).toContain("bracket 3 allows");
});

test("the hero names what its number counts", () => {
  expect(heroUpgradesLine("eight", 8, 2)).toBe("Eight swaps below upgrade it for bracket 1–2; switch the bracket to see the others.");
  expect(heroUpgradesLine("one", 1, 3)).toBe("One swap below upgrades it for bracket 3; switch the bracket to see the others.");
  expect(REPORT_DIFFERS).toBe("The full report is a different list: it ranks what the deck is short on, so its counts differ.");
});

// THE EFFECT OF THE SWAPS IN WORDS (#893): consistency and synergy, never power.
type After = NonNullable<UpgradePackage["after"]>;
const withAfter = (a: Partial<After>): UpgradePackage => ({ ...pkg(3), after: { band: "3", synergy: 3, mana: 0.1, ...a } });
const before = (over: Partial<{ synergy: number; build: number; gaps: { group: string; have: number; target: number }[] }> = {}) => ({
  synergy: { score: over.synergy ?? 3, band: "x" }, build: { score: over.build ?? 4.1, band: "x" }, gaps: over.gaps ?? [],
});
const POWER = /stronger|keep up|power|win more/i;

test("afterLine no longer says the synergy change; whatTheSwapsDo does", () => {
  expect(afterLine(withAfter({ synergy: 3.4 }))).not.toMatch(/synergy/);
  expect(afterLine(withAfter({ synergy: 3.4 }))).toBe("1 swap, and after them the report reads the deck at bracket 3.");
});

test("synergy: a rise inside a band says the band it stays in", () => {
  const s = whatTheSwapsDo(withAfter({ synergy: 3.3 }), before());
  expect(s).toContain("Its cards work together a little more: synergy 3.0 → 3.3 of 5, still connected.");
});

test("synergy: a rise across a band names both bands", () => {
  const s = whatTheSwapsDo(withAfter({ synergy: 3.2 }), before({ synergy: 2.8 }));
  expect(s).toContain("synergy 2.8 → 3.2 of 5, from developing to connected.");
});

test("synergy: the same figure is said unchanged", () => {
  expect(whatTheSwapsDo(withAfter({ synergy: 3.02 }), before())).toContain("synergy stays at 3.0 of 5, connected");
});

test("build: a rise across a band, with a shortfall closed and one left", () => {
  const s = whatTheSwapsDo(
    withAfter({ build: 4.2, short: [{ group: "Card draw", have: 7, target: 8 }] }),
    before({ build: 3.6, gaps: [{ group: "Ramp", have: 9, target: 11 }, { group: "Card draw", have: 5, target: 8 }] }),
  );
  expect(s).toContain("It is more consistent: Build 3.6 → 4.2 of 5, from close to on target");
  expect(s).toContain("no longer short on ramp");
  expect(s).toContain("still 1 short on card draw");
});

test("build: a fall is said honestly, and a new shortfall is named", () => {
  const s = whatTheSwapsDo(withAfter({ build: 3.8, short: [{ group: "Ramp", have: 8, target: 11 }] }), before({ build: 4.2, gaps: [] }));
  expect(s).toContain("a little less consistent: Build 4.2 → 3.8 of 5, from on target to close");
  expect(s).toContain("now 3 short on ramp");
});

test("build: absent on an old page's package, and nothing is made up", () => {
  const s = whatTheSwapsDo(withAfter({ synergy: 3.3 }), before());
  expect(s).not.toMatch(/Build|consistent/);
  expect(s).toContain("synergy 3.0 → 3.3");
});

test("the closing clause is said once, and no sentence uses a power word", () => {
  const s = whatTheSwapsDo(withAfter({ synergy: 3.3, build: 4.2, short: [] }), before({ gaps: [{ group: "Ramp", have: 9, target: 11 }] }));
  expect(s.match(/what this page measures/g)).toHaveLength(1);
  expect(s).not.toMatch(POWER);
  for (const a of [{ synergy: 1, build: 1 }, { synergy: 4.5, build: 5 }]) expect(whatTheSwapsDo(withAfter(a), before())).not.toMatch(POWER);
});

test("with nothing to compare there is nothing to say", () => {
  expect(whatTheSwapsDo(pkg(3), before())).toBe("");
});
