import { pAtLeast, pAnyWeighted, seen } from "@edh-seer/engine";
import type { Card } from "@edh-seer/engine";
import { describe, expect, test } from "vitest";
import { answerCoverage, COVERAGE_CLASSES } from "./answer-coverage.js";
import { answerClassWeight, answerWeightOf, detectAnswerClasses } from "./build.js";
import { computeDeckMath } from "./deck-math.js";
import { NARROW_WEIGHT } from "./narrow-weight.js";
import { realCard } from "./removal-test-support.js";
import { answerClassesOf } from "./rules.js";
import type { DeckCard, Hierarchy } from "./types.js";

const mk = (name: string, oracleText: string, typeLine = "Instant"): DeckCard => ({ card: { name, oracleText, typeLine } as Card, tags: null });

/** Owner 2026-11-13: a colour-locked answer counts, at a weaker weight (#1266 follow-up). */
describe("colour-locked answers are marked (owner 2026-11-13)", () => {
  test("NARROW_WEIGHT is the repo's fixed partial weight, 0.5", () => {
    expect(NARROW_WEIGHT).toBe(0.5);
  });

  test("derived path: the subject's colours lock damage, tuck and bounce (Combust, King Crab, Aether Gust)", () => {
    for (const n of ["Combust", "King Crab", "Aether Gust"]) {
      const marks = answerClassesOf(realCard(n, { oracleText: "" }));
      expect(marks.size, n).toBeGreaterThan(0);
      for (const [cls, m] of marks) expect(m.colourLocked, `${n} ${cls}`).toBe(true);
    }
  });

  test("derived path: an uncoloured subject is not locked (Lightning Bolt, Flame Slash, Boomerang, Condemn)", () => {
    for (const n of ["Lightning Bolt", "Flame Slash", "Boomerang", "Condemn"]) {
      for (const [cls, m] of answerClassesOf(realCard(n, { oracleText: "" }))) expect(m.colourLocked, `${n} ${cls}`).toBe(false);
    }
  });

  test("printed path: a colour hoser is no longer dropped, it is marked (Pyroblast, Soul Rend)", () => {
    const pyro = answerClassesOf(mk("Pyroblast", "Choose one —\n• Counter target spell if it's blue.\n• Destroy target permanent if it's blue."));
    expect([...pyro.keys()].sort()).toEqual(["artifact", "creature", "enchantment", "land", "planeswalker"]);
    for (const m of pyro.values()) expect(m.colourLocked).toBe(true);
    const rend = answerClassesOf(mk("Soul Rend", "Destroy target creature if it's white. A creature destroyed this way can't be regenerated."));
    expect(rend.get("creature")?.colourLocked).toBe(true);
  });

  test("printed path: a plain destroy and a stat condition are not locked (Murder, Fatal Push)", () => {
    expect(answerClassesOf(mk("Murder", "Destroy target creature.")).get("creature")!.colourLocked).toBe(false);
  });

  test("a card with a locked clause AND a plain clause for the class is not locked", () => {
    const m = answerClassesOf(mk("Charm", "Choose one —\n• Destroy target creature.\n• Destroy target permanent if it's blue."));
    expect(m.get("creature")!.colourLocked).toBe(false);
    expect(m.get("artifact")!.colourLocked).toBe(true);
  });
});

describe("colour-locked answers weigh NARROW_WEIGHT in the class counts", () => {
  const cards = [mk("Murder", "Destroy target creature."), realCard("Combust", { oracleText: "" })];
  test("detectAnswerClasses names the locked card and the weights add up", () => {
    const creature = detectAnswerClasses(cards).get("creature")!;
    expect([...creature.colourLocked]).toEqual(["Combust"]);
    expect(answerWeightOf(creature, "Murder")).toBe(1);
    expect(answerWeightOf(creature, "Combust")).toBe(NARROW_WEIGHT);
    expect(answerClassWeight(creature)).toBe(1 + NARROW_WEIGHT);
  });
});

describe("answerCoverage: a class covered only by locked answers covers at half", () => {
  const FIVE = ["W", "U", "B", "R", "G"];
  const ALL = new Set<string>(COVERAGE_CLASSES);
  test("a Set still means full cover", () => {
    expect(answerCoverage(FIVE, ALL, 0).coverage).toBe(1);
  });
  test("a map of fractions scales that class's row", () => {
    const full = answerCoverage(FIVE, new Map(COVERAGE_CLASSES.map((c) => [c, 1])), 0);
    const half = answerCoverage(FIVE, new Map(COVERAGE_CLASSES.map((c) => [c, c === "creature" ? NARROW_WEIGHT : 1])), 0);
    const creature = full.rows.find((r) => r.class === "creature")!;
    expect(full.coverage).toBe(1);
    expect(half.coverage).toBeCloseTo(1 - NARROW_WEIGHT * creature.weight / full.rows.reduce((s, r) => s + r.weight, 0), 9);
    expect(half.rows.find((r) => r.class === "creature")).toMatchObject({ covered: true, fraction: NARROW_WEIGHT });
  });
});

describe("pAnyWeighted: P(at least one LIVE answer), each drawn locked card live with probability w", () => {
  test("no locked cards is pAtLeast(1)", () => {
    expect(pAnyWeighted(4, 0, 0.5, seen(9), 99)).toBeCloseTo(pAtLeast(1, 4, seen(9), 99), 12);
  });
  test("all locked at weight 1 is pAtLeast(1)", () => {
    expect(pAnyWeighted(0, 4, 1, seen(9), 99)).toBeCloseTo(pAtLeast(1, 4, seen(9), 99), 12);
  });
  test("one locked card is half of one full card's chance", () => {
    expect(pAnyWeighted(0, 1, 0.5, seen(9), 99)).toBeCloseTo(0.5 * pAtLeast(1, 1, seen(9), 99), 12);
  });
  test("sits between all-locked-dead and all-full", () => {
    const p = pAnyWeighted(2, 2, 0.5, seen(9), 99);
    expect(p).toBeGreaterThan(pAtLeast(1, 2, seen(9), 99));
    expect(p).toBeLessThan(pAtLeast(1, 4, seen(9), 99));
  });
});

describe("deck-math: the answer row carries the weight", () => {
  const H: Hierarchy = {};
  const filler = (i: number): DeckCard => ({ card: { name: `f${i}`, typeLine: "Instant", oracleText: "", keywords: [], colors: [], manaValue: 3 } as Card, tags: null });
  const deckWith = (a: DeckCard[]): DeckCard[] => [...a, ...Array.from({ length: 100 - a.length }, (_, i) => filler(i))];
  test("a locked answer counts as a card, weighs half, and is less available than a plain one", () => {
    const plain = computeDeckMath(deckWith([mk("Murder", "Destroy target creature.")]), H, [], 9).answers.find((a) => a.class === "creature")!;
    const locked = computeDeckMath(deckWith([realCard("Combust", { oracleText: "" })]), H, [], 9).answers.find((a) => a.class === "creature")!;
    expect(plain).toMatchObject({ count: 1, weighted: 1 });
    expect(locked).toMatchObject({ count: 1, weighted: NARROW_WEIGHT, colourLocked: ["Combust"] });
    expect(locked.available).toBeCloseTo(NARROW_WEIGHT * plain.available, 9);
  });
});

describe("printed path: a colour named inside the target phrase locks the class, read from the derived target (owner 2026-11-13)", () => {
  const classes = (n: string) => answerClassesOf(realCard(n));
  test("\"target creature or planeswalker that's green or white\" locks both rows, as Fry's derived path does (Noxious Grasp, Flourishing Grapple)", () => {
    for (const n of ["Noxious Grasp", "Flourishing Grapple"]) {
      const m = classes(n);
      expect([...m.keys()].sort(), n).toEqual(["creature", "planeswalker"]);
      for (const [cls, v] of m) expect(v.colourLocked, `${n} ${cls}`).toBe(true);
    }
  });
  test("a branch with no colour (Forest) does not stop the coloured branches of the class locking (Nissa's Defeat)", () => {
    const m = classes("Nissa's Defeat");
    // "Forest" names a land (Rules 50): the land row exists, and is the one row the colour does not lock.
    expect([...m.keys()].sort()).toEqual(["enchantment", "land", "planeswalker"]);
    for (const [cls, v] of m) expect(v.colourLocked, cls).toBe(cls !== "land");
  });
  test("\"target Plains and target white creature\" locks the creature row (Reign of Chaos)", () => {
    expect(classes("Reign of Chaos").get("creature")?.colourLocked).toBe(true);
  });
  test("\"nonblack\" is still not a lock (Doom Blade)", () => {
    expect(classes("Doom Blade").get("creature")?.colourLocked).toBe(false);
  });
});
