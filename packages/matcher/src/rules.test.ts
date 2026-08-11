import { expect, test } from "vitest";
import type { Card } from "@mtg/engine";
import { detectAnswerClasses, detectBuildCategories } from "./build.js";
import { answerClassesOf, loadRules, ruleMatches, RULES_VERSION } from "./rules.js";
import type { DeckCard } from "./types.js";

const mk = (name: string, oracleText: string, typeLine = "Instant"): DeckCard => ({
  card: { name, oracleText, typeLine } as Card,
  tags: null,
});

test("the rule set loads, is versioned, and every pattern a rule names exists", () => {
  const set = loadRules();
  expect(RULES_VERSION).toBeGreaterThan(0);
  // A typo in a pattern name is the failure this whole layer exists to avoid -- it would silently
  // never match, exactly as hierarchy.json silently held 16 of 527 subtypes.
  const named = (clauses: { op: string; pattern?: string; clauses?: unknown[] }[]): string[] =>
    clauses.flatMap((c) =>
      c.op === "anyOf"
        ? named(c.clauses as { op: string; pattern?: string }[])
        : c.pattern ? [c.pattern] : [],
    );
  for (const rule of set.rules) {
    for (const p of [...named(rule.match), ...named(rule.not ?? [])]) {
      expect(set.patterns[p], `rule ${rule.id} names pattern ${p}`).toBeDefined();
    }
    expect(
      rule.category ?? rule.answerClass ?? rule.answerClassFrom ?? rule.winconClass,
      `rule ${rule.id} does something`,
    ).toBeDefined();
  }
});

test("every pattern compiles", () => {
  for (const [name, src] of Object.entries(loadRules().patterns)) {
    expect(() => new RegExp(src, "i"), name).not.toThrow();
  }
});

test("an unknown pattern name throws rather than never matching", () => {
  const set = loadRules();
  expect(() =>
    ruleMatches({ id: "bogus", match: [{ op: "oracle", pattern: "nope" }] }, mk("x", "y"), set),
  ).toThrow(/unknown pattern/i);
});

test("`not` vetoes, `match` conjoins, `anyOf` disjoins", () => {
  const set = loadRules();
  const card = mk("Test", "Destroy target creature.");
  expect(ruleMatches({ id: "a", match: [{ op: "oracle", pattern: "targetedRemoval" }] }, card, set)).toBe(true);
  expect(ruleMatches({
    id: "b",
    match: [{ op: "oracle", pattern: "targetedRemoval" }],
    not: [{ op: "oracle", pattern: "targetedRemoval" }],
  }, card, set)).toBe(false);
  expect(ruleMatches({
    id: "c",
    match: [{ op: "anyOf", clauses: [
      { op: "oracle", pattern: "boardWipe" },
      { op: "oracle", pattern: "targetedRemoval" },
    ] }],
  }, card, set)).toBe(true);
});

/** The `else if` that used to give wipes precedence over targeted removal is a `not` clause now, so
 *  it needs the same test it had as code. */
test("a board wipe is not also counted as targeted removal", () => {
  const m = detectBuildCategories([mk("Wrath", "Destroy all creatures.", "Sorcery")]);
  expect(m.get("boardWipe")?.has("Wrath")).toBe(true);
  expect(m.get("targetedRemoval")?.has("Wrath")).toBeUndefined();
});

/** The land branch used to `continue`, so no land could reach the nonland detectors. That is a
 *  `not typeLine: land` on every nonland rule now, and getting it wrong would silently reclassify
 *  every utility land in every deck. */
test("a land does not reach the nonland detectors", () => {
  const m = detectBuildCategories([
    mk("Riptide Laboratory", "{1}, {T}: Return target Wizard you control to its owner's hand.", "Land"),
  ]);
  expect(m.get("stackInteraction")?.has("Riptide Laboratory")).toBeUndefined();
});

test("graveyard hate is a category, and it is the opponent's graveyard that makes it one", () => {
  const m = detectBuildCategories([
    mk("Bojuka Bog", "When this land enters, exile target player's graveyard.", "Land"),
    mk("Rest in Peace", "If a card would be put into a graveyard from anywhere, exile it instead.", "Enchantment"),
    // Delve, encore and escape all say "exile ... from your graveyard" and are not hate. The old
    // negative-filter pattern caught all three; measured on the calibration decks it was wrong on
    // two thirds of what it matched.
    mk("Dig Through Time", "Delve (Each card you exile from your graveyard while casting this spell pays for {1}.) Look at the top seven cards of your library."),
    mk("Mizzix's Mastery", "Exile target card that's an instant or sorcery from your graveyard. Copy it."),
    mk("Necropotence", "Whenever you discard a card, exile that card from your graveyard.", "Enchantment"),
  ]);
  const hate = m.get("graveyardHate") ?? new Set();
  expect([...hate].sort()).toEqual(["Bojuka Bog", "Rest in Peace"]);
});

/** Static hate is the half the old pattern could not see AT ALL: "graveyard" comes before "exile",
 *  so an exile-first regex misses the two most important cards in the class. */
test("static hate counts, even though it never says exile first", () => {
  const m = detectBuildCategories([
    mk("Leyline of the Void", "If a card would be put into an opponent's graveyard from anywhere, exile it instead.", "Enchantment"),
  ]);
  expect(m.get("graveyardHate")?.has("Leyline of the Void")).toBe(true);
});

test("a self-replacement clause on one spell is not graveyard hate", () => {
  // "If that spell would be put into a graveyard, exile it instead" is how a card keeps its own
  // spell around. Diluvian Primordial and Urabrask both read this way.
  const m = detectBuildCategories([
    mk("Diluvian Primordial", "You may cast target instant or sorcery card from that player's graveyard. If a spell cast this way would be put into a graveyard, exile it instead."),
  ]);
  expect(m.get("graveyardHate")?.has("Diluvian Primordial")).toBeUndefined();
});

test("answer classes come from the type the removal actually names", () => {
  const classes = detectAnswerClasses([
    mk("Murder", "Destroy target creature."),
    mk("Disenchant", "Destroy target artifact or enchantment."),
    mk("Vindicate", "Destroy target permanent.", "Sorcery"),
  ]);
  expect([...(classes.get("creature") ?? [])].sort()).toEqual(["Murder", "Vindicate"]);
  expect([...(classes.get("enchantment") ?? [])].sort()).toEqual(["Disenchant", "Vindicate"]);
  // `permanent` is not its own class: a card that answers any permanent answers all of them, and
  // treating it as a sixth class would report a Vindicate deck as having no enchantment removal.
  expect(classes.has("permanent")).toBe(false);
  expect([...(classes.get("land") ?? [])]).toEqual(["Vindicate"]);
});

test("a card covering two classes in two sentences gets both", () => {
  // One `test()` keeps only the first match; the sweep is global for exactly this shape.
  expect([...answerClassesOf(mk("Charm", "Choose one — Destroy target artifact. Or destroy target creature."))].sort())
    .toEqual(["artifact", "creature"]);
});

/** Counting only destroy/exile made a real deck read as 14 removal spells with 3 creature answers.
 *  A burn spell and a bounce spell both answer a creature, and `targetedRemoval` has always counted
 *  them -- the two axes disagreeing about the same card is worse than either reading alone. */
test("damage and bounce answer what they aim at", () => {
  const classes = detectAnswerClasses([
    mk("Lightning Bolt", "Lightning Bolt deals 3 damage to any target."),
    mk("Fire Bolt", "Fire Bolt deals 2 damage to target creature."),
    mk("Bedevil", "Bedevil deals 3 damage to target creature or planeswalker."),
    mk("Boomerang", "Return target permanent to its owner's hand."),
  ]);
  expect([...(classes.get("creature") ?? [])].sort()).toEqual(["Bedevil", "Boomerang", "Fire Bolt"]);
  expect(classes.get("planeswalker")?.has("Bedevil")).toBe(true);
  // "any target" is burn aimed at a player, not removal, and it names no class.
  expect(classes.get("creature")?.has("Lightning Bolt")).toBe(false);
  expect([...(classes.get("enchantment") ?? [])]).toEqual(["Boomerang"]);
});

test("a blink is not an answer, however much it reads like removal", () => {
  const classes = detectAnswerClasses([
    mk("Essence Flux", "Exile target creature you control, then return it to the battlefield under its owner's control."),
    mk("Beast Within", "Destroy target permanent you don't control. Its controller creates a 3/3 token.", "Instant"),
  ]);
  expect(classes.get("creature")?.has("Essence Flux")).toBe(false);
  // ...and the negation still reads as an answer, since "you don't control" is not "you control".
  expect(classes.get("creature")?.has("Beast Within")).toBe(true);
});

test("graveyard is an answer class too, and it comes from the hate rule", () => {
  const classes = detectAnswerClasses([
    mk("Bojuka Bog", "When this land enters, exile target player's graveyard.", "Land"),
  ]);
  expect([...(classes.get("graveyard") ?? [])]).toEqual(["Bojuka Bog"]);
});
