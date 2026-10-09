import { expect, test } from "vitest";
import type { UpgradePackage } from "@edh-seer/matcher/upgrade-package";
import { afterLine, heroUpgradesLine, REPORT_DIFFERS, sameAsBelow, TARGET_MEANING } from "./precon-upgrades.js";

const pkg = (target: 2 | 3 | 4): UpgradePackage => ({
  target, from: "3", bringDown: [],
  sections: [{ id: "lands", swaps: [{ kind: "land", out: { name: "A", reason: "a" }, in: { name: "B", reason: "b" } }] }],
});

test("afterLine states the band the report reads the swapped deck at, not the target", () => {
  const withAfter = (t: 2 | 3 | 4, band: "1-2" | "3" | "4-5"): UpgradePackage => ({ ...pkg(t), after: { band, synergy: 3, mana: 1 } });
  expect(afterLine(withAfter(4, "3"), null)).toContain("the report reads the deck at bracket 3");
  expect(afterLine(withAfter(3, "1-2"), null)).toContain("the report reads the deck at bracket 1–2");
  expect(afterLine(withAfter(4, "4-5"), null)).toContain("the report reads the deck at bracket 4–5");
});

test("bracket 4 is not said to exclude 5", () => {
  expect(TARGET_MEANING[4]).not.toMatch(/tournament/);
});

test("afterLine and sameAsBelow name the bracket by its label", () => {
  expect(afterLine(pkg(2), null)).toContain("still fits bracket 1–2");
  expect(afterLine(pkg(4), null)).toContain("still fits bracket 4–5");
  expect(sameAsBelow(pkg(4), [pkg(3), pkg(4)])).toContain("same swaps as at bracket 3");
  expect(sameAsBelow(pkg(3), [pkg(2), pkg(3)])).toContain("same swaps as at bracket 1–2");
  expect(sameAsBelow(pkg(3), [pkg(2), pkg(3)])).toContain("bracket 3 allows");
});

test("the hero names what its number counts", () => {
  expect(heroUpgradesLine("eight", 8, 2)).toBe("Eight swaps below upgrade it for bracket 1–2; switch the bracket to see the others.");
  expect(heroUpgradesLine("one", 1, 3)).toBe("One swap below upgrades it for bracket 3; switch the bracket to see the others.");
  expect(REPORT_DIFFERS).toBe("The full report is a different list: it ranks what the deck is short on, so its counts differ.");
});
