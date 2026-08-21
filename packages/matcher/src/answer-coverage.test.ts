import { describe, expect, it } from "vitest";
import { ANSWER_BASELINE, COVERAGE_CLASSES, GRAVEYARD_HATE_SHARE, answerCoverage } from "./answer-coverage.js";

const ALL = new Set(COVERAGE_CLASSES);
const FIVE = ["W", "U", "B", "R", "G"];

describe("the tables", () => {
  it("scores five permanent classes and never the graveyard", () => {
    expect([...COVERAGE_CLASSES].sort()).toEqual(
      ["artifact", "creature", "enchantment", "land", "planeswalker"].sort(),
    );
    expect(COVERAGE_CLASSES).not.toContain("graveyard");
  });
  it("keeps each table a distribution, so the blend preserves mass", () => {
    const sum = (t: Record<string, number>) => Object.values(t).reduce((a, b) => a + b, 0);
    expect(sum(ANSWER_BASELINE)).toBeCloseTo(1, 6);
    expect(sum(GRAVEYARD_HATE_SHARE)).toBeCloseTo(1, 6);
  });
  it("gives planeswalker and land no share of graveyard hate, because none is printed on them", () => {
    expect(GRAVEYARD_HATE_SHARE.planeswalker).toBe(0);
    expect(GRAVEYARD_HATE_SHARE.land).toBe(0);
  });
});

describe("answerCoverage", () => {
  it("is 1 when every class is covered", () => {
    expect(answerCoverage(FIVE, ALL, 0).coverage).toBe(1);
  });

  it("is 0 when nothing is covered", () => {
    expect(answerCoverage(FIVE, new Set(), 0).coverage).toBe(0);
  });

  // THE HEADLINE BEHAVIOUR. The same hole costs a mono-black deck far less than a white one,
  // because black's artifact pool is 56 against white's 215 -- the colour pie, not a defect.
  it("charges a mono-black deck less for missing artifact removal than a mono-white one", () => {
    const missing = new Set(COVERAGE_CLASSES.filter((c) => c !== "artifact"));
    const black = answerCoverage(["B"], missing, 0).coverage;
    const white = answerCoverage(["W"], missing, 0).coverage;
    expect(black).toBeGreaterThan(white);
  });

  it("refuses the pool weight when the identity is unknown, and says so", () => {
    const r = answerCoverage(undefined, ALL, 0);
    expect(r.source).toBe("unweighted");
    expect(r.rows.every((x) => x.poolShare === 1)).toBe(true);
  });

  // The blend, not a sum: total demand mass is 1 at every vulnerability, so raising the hate
  // profile SHIFTS weight between classes instead of inflating every class at once (design §4).
  it("preserves demand mass as vulnerability rises", () => {
    for (const v of [0, 0.3, 0.635, 1]) {
      const total = answerCoverage(FIVE, ALL, v).rows.reduce((s, r) => s + r.demand, 0);
      expect(total).toBeCloseTo(1, 6);
    }
  });

  it("shifts demand toward creatures and artifacts as graveyard vulnerability rises", () => {
    const at = (v: number, cls: string) => answerCoverage(FIVE, ALL, v).rows.find((r) => r.class === cls)!.demand;
    expect(at(1, "creature")).toBeGreaterThan(at(0, "creature"));
    expect(at(1, "artifact")).toBeGreaterThan(at(0, "artifact"));
    expect(at(1, "planeswalker")).toBeLessThan(at(0, "planeswalker"));
  });

  it("carries the clamped vulnerability, which is the panel's only source for it", () => {
    expect(answerCoverage(FIVE, ALL, 0.635).graveyardVulnerability).toBe(0.635);
    expect(answerCoverage(FIVE, ALL, 5).graveyardVulnerability).toBe(1);
  });

  it("clamps a vulnerability outside [0,1] rather than extrapolating a share", () => {
    expect(answerCoverage(FIVE, ALL, 5).rows).toEqual(answerCoverage(FIVE, ALL, 1).rows);
    expect(answerCoverage(FIVE, ALL, -1).rows).toEqual(answerCoverage(FIVE, ALL, 0).rows);
  });
});
