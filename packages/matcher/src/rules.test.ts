import { parseGate } from "@edh-seer/tagger/gate";
import { describe, expect, test } from "vitest";
import type { Card } from "@edh-seer/engine";
import { BUILD_PARENTS, detectAnswerClasses, detectBuildCategories } from "./build.js";
import { detectWincons } from "./wincon.js";
import { answerClassesOf, loadRules, ownText, ruleMatches, RULES_VERSION, tokenQuotes, type Rule } from "./rules.js";
import type { DeckCard } from "./types.js";
import type { ManaLine } from "@edh-seer/tagger";
import { nonAccelerantRamp } from "./ramp-class.js";
import { FREE_TAP, manaTags, mkLine, ritualLine, tapFor, triggerLine } from "./mana-test-support.js";
import { realCard } from "./removal-test-support.js";
import goldfish from "./fixtures/goldfish-cards.json" with { type: "json" };

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
      rule.category ?? rule.facet ?? rule.answerClass ?? rule.answerClassFrom ?? rule.winconClass,
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
  const card = mk("Test", "Destroy all creatures.");
  expect(ruleMatches({ id: "a", match: [{ op: "oracle", pattern: "boardWipe" }] }, card, set)).toBe(true);
  expect(ruleMatches({
    id: "b",
    match: [{ op: "oracle", pattern: "boardWipe" }],
    not: [{ op: "oracle", pattern: "boardWipe" }],
  }, card, set)).toBe(false);
  expect(ruleMatches({
    id: "c",
    match: [{ op: "anyOf", clauses: [
      { op: "oracle", pattern: "graveyardHate" },
      { op: "oracle", pattern: "boardWipe" },
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
  expect([...(classes.get("creature")?.cards ?? [])].sort()).toEqual(["Murder", "Vindicate"]);
  expect([...(classes.get("enchantment")?.cards ?? [])].sort()).toEqual(["Disenchant", "Vindicate"]);
  // `permanent` is not its own class: a card that answers any permanent answers all of them, and
  // treating it as a sixth class would report a Vindicate deck as having no enchantment removal.
  expect(classes.has("permanent")).toBe(false);
  expect([...(classes.get("land")?.cards ?? [])]).toEqual(["Vindicate"]);
});

test("a card covering two classes in two sentences gets both", () => {
  // One `test()` keeps only the first match; the sweep is global for exactly this shape.
  expect([...answerClassesOf(mk("Charm", "Choose one — Destroy target artifact. Or destroy target creature.")).keys()].sort())
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
  expect([...(classes.get("creature")?.cards ?? [])].sort()).toEqual(["Bedevil", "Boomerang", "Fire Bolt", "Lightning Bolt"]);
  expect(classes.get("planeswalker")?.cards.has("Bedevil")).toBe(true);
  // "Any target" is a creature or a planeswalker as much as a player (owner, 2026-09-26, issue #581:
  // the Krenko deck's creature answers left out its Lightning Bolt). It was ruled burn-only before,
  // which made every red deck's cheapest answer answer nothing. Not an artifact or a land.
  expect(classes.get("planeswalker")?.cards.has("Lightning Bolt")).toBe(true);
  expect(classes.get("artifact")?.cards.has("Lightning Bolt") ?? false).toBe(false);
  expect([...(classes.get("enchantment")?.cards ?? [])]).toEqual(["Boomerang"]);
});

/** Issue #581: naming each answer row's cards showed what the classes missed and what they
 *  over-counted. Each case is one a real deck carried. */
test("tucks, shrinks and plural objects answer; colour hosers and exile costs do not", () => {
  const classes = detectAnswerClasses([
    mk("Chaos Warp", "The owner of target permanent shuffles it into their library, then reveals the top card of their library."),
    mk("Condemn", "Put target attacking creature on the bottom of its owner's library. Its controller gains life equal to its toughness."),
    mk("Nowhere to Run", "When Nowhere to Run enters, target creature an opponent controls gets -3/-3 until end of turn."),
    mk("Yawgmoth", "Pay 1 life, Sacrifice another creature: Put a -1/-1 counter on up to one target creature and draw a card."),
    mk("Curtains' Call", "Destroy two target creatures."),
    mk("Pyroblast", "Choose one —\n• Counter target spell if it's blue.\n• Destroy target permanent if it's blue."),
    mk("Plaza of Heroes", "{3}, {T}, Exile Plaza of Heroes: Target legendary creature gains hexproof and indestructible until end of turn."),
    mk("Shrinker", "Target creature gets -2/-0 until end of turn."),
    mk("Pinger", "{T}: Pinger deals 1 damage to any target."),
  ]);
  const creature = classes.get("creature")?.cards ?? new Set();
  for (const n of ["Chaos Warp", "Condemn", "Nowhere to Run", "Yawgmoth", "Curtains' Call"]) expect(creature.has(n), n).toBe(true);
  expect(classes.get("land")?.cards.has("Chaos Warp")).toBe(true);
  for (const n of ["Pyroblast", "Plaza of Heroes", "Shrinker", "Pinger"]) expect(creature.has(n), n).toBe(false);
  expect(classes.get("enchantment")?.cards.has("Pyroblast") ?? false).toBe(false);
});

test("a blink is not an answer, however much it reads like removal", () => {
  const classes = detectAnswerClasses([
    mk("Essence Flux", "Exile target creature you control, then return it to the battlefield under its owner's control."),
    mk("Beast Within", "Destroy target permanent you don't control. Its controller creates a 3/3 token.", "Instant"),
  ]);
  expect(classes.get("creature")?.cards.has("Essence Flux")).toBe(false);
  // ...and the negation still reads as an answer, since "you don't control" is not "you control".
  expect(classes.get("creature")?.cards.has("Beast Within")).toBe(true);
});

test("graveyard is an answer class too, and it comes from the hate rule", () => {
  const classes = detectAnswerClasses([
    mk("Bojuka Bog", "When this land enters, exile target player's graveyard.", "Land"),
  ]);
  expect([...(classes.get("graveyard")?.cards ?? [])]).toEqual(["Bojuka Bog"]);
});

/** Exile is the only recursion-proof answer (design §2.1, owner's ruling): a tucked card can be
 *  drawn or tutored again, and a destroyed one can be reanimated. The pair is the test -- either
 *  card alone passes with a pattern that ignores the verb entirely. */
test("an exile marks its class, a destroy does not", () => {
  const classes = detectAnswerClasses([
    mk("Swords to Plowshares", "Exile target creature. Its controller gains life equal to its power."),
    mk("Vindicate", "Destroy target permanent.", "Sorcery"),
  ]);
  expect([...(classes.get("creature")?.cards ?? [])].sort()).toEqual(["Swords to Plowshares", "Vindicate"]);
  expect([...(classes.get("creature")?.exiling ?? [])]).toEqual(["Swords to Plowshares"]);
  // Vindicate reaches five classes and exiles none of them.
  expect([...(classes.get("enchantment")?.exiling ?? [])]).toEqual([]);
});

/** The mode rides on the RULE that matched, not on the card (design §2.4). Treva's Charm destroys
 *  an enchantment and exiles a creature; a card-level flag would report a recursion-proof
 *  enchantment answer it does not have. */
test("a card that exiles one type and destroys another marks only the type it exiled", () => {
  const marks = answerClassesOf(mk(
    "Treva's Charm",
    "Choose one —\n• Destroy target enchantment.\n• Exile target attacking creature.\n• Draw a card, then discard a card.",
  ));
  expect(marks.get("creature")?.exile).toBe(true);
  expect(marks.get("enchantment")?.exile).toBe(false);
});

/** `answers.typed` already vetoes graveyard exile, and the exile rule must carry the same veto:
 *  "Exile target creature card from a graveyard" names a creature and answers no creature on the
 *  battlefield. Without the `not` this is a recursion-proof creature answer that does not exist. */
test("exiling a creature card OUT of a graveyard is not a creature answer", () => {
  const classes = detectAnswerClasses([
    mk("Shamble Back", "Exile target creature card from a graveyard. Create a 2/2 black Zombie creature token. You gain 2 life."),
  ]);
  expect(classes.get("creature")?.cards.has("Shamble Back") ?? false).toBe(false);
  expect(classes.get("creature")?.exiling.has("Shamble Back") ?? false).toBe(false);
});

/** A multi-type exile marks every class it names, the same global sweep the class rule uses. */
test("one exile clause naming two types marks both", () => {
  const marks = answerClassesOf(mk(
    "Return to Dust",
    "Exile target artifact or enchantment. If you cast this spell during your main phase, you may exile up to one other target artifact or enchantment.",
  ));
  expect(marks.get("artifact")?.exile).toBe(true);
  expect(marks.get("enchantment")?.exile).toBe(true);
});

/** §12.3's whole reason for this axis: one Bojuka Bog answers a recursion engine not at all, and
 *  Rest in Peace answers it forever. A count cannot tell them apart. */
test("recurring graveyard hate is the replacement effect, the prohibition and the activated ability", () => {
  const classes = detectAnswerClasses([
    mk("Rest in Peace", "When this enchantment enters, exile all graveyards.\nIf a card or token would be put into a graveyard from anywhere, exile it instead.", "Enchantment"),
    mk("Leyline of the Void", "If this card is in your opening hand, you may begin the game with it on the battlefield.\nIf a card would be put into an opponent's graveyard from anywhere, exile it instead.", "Enchantment"),
    mk("Grafdigger's Cage", "Creature cards in graveyards and libraries can't enter the battlefield.\nPlayers can't cast spells from graveyards or libraries.", "Artifact"),
    mk("Scavenging Ooze", "{G}: Exile target card from a graveyard. If it was a creature card, put a +1/+1 counter on this creature and you gain 1 life.", "Creature — Ooze"),
    mk("Relic of Progenitus", "{T}: Target player exiles a card from their graveyard.\n{1}, Exile this artifact: Exile all graveyards. Draw a card.", "Artifact"),
  ]);
  expect([...(classes.get("graveyard")?.recurring ?? [])].sort()).toEqual([
    "Grafdigger's Cage", "Leyline of the Void", "Relic of Progenitus", "Rest in Peace", "Scavenging Ooze",
  ]);
});

/** The card the axis was written for. It IS graveyard hate and it is NOT recurring -- its trigger
 *  fires once, so it answers a card and not an engine. */
test("Bojuka Bog is graveyard hate and is not recurring", () => {
  const classes = detectAnswerClasses([
    mk("Bojuka Bog", "This land enters tapped.\nWhen this land enters, exile target player's graveyard.\n{T}: Add {B}.", "Land"),
  ]);
  expect(classes.get("graveyard")?.cards.has("Bojuka Bog")).toBe(true);
  expect(classes.get("graveyard")?.recurring.has("Bojuka Bog") ?? false).toBe(false);
});

/** Deathrite Shaman is the double case: a repeatable activated hate ability that ALSO names card
 *  types inside a graveyard. It must be recurring hate and must contribute no battlefield answer. */
test("a repeatable graveyard exile is recurring hate, not a land or creature answer", () => {
  const classes = detectAnswerClasses([
    mk("Deathrite Shaman", "{T}: Exile target land card from a graveyard. Add one mana of any color.\n{B}, {T}: Exile target instant or sorcery card from a graveyard. Each opponent loses 2 life.\n{G}, {T}: Exile target creature card from a graveyard. You gain 2 life.", "Creature — Elf Shaman"),
  ]);
  expect(classes.get("graveyard")?.recurring.has("Deathrite Shaman")).toBe(true);
  expect(classes.get("land")?.cards.has("Deathrite Shaman") ?? false).toBe(false);
  expect(classes.get("creature")?.cards.has("Deathrite Shaman") ?? false).toBe(false);
});

/** Lazotep Quarry's activated ability exiles from ITS OWN graveyard to reanimate a copy -- that is
 *  self-recursion, not hate, and it is the reason alternation 4's determiner is narrowed to the same
 *  allow-list `graveyardHatePositive` already uses. Caught by the population gate on the 71
 *  calibration decks before this narrowing shipped; pinned here so it cannot silently return. */
test("Lazotep Quarry recurs from its own graveyard, which is not hate", () => {
  const classes = detectAnswerClasses([
    mk(
      "Lazotep Quarry",
      "{T}: Add {C}.\n{T}, Sacrifice a creature: Add one mana of any color.\n{X}{2}, {T}, Sacrifice a Desert: Exile target creature card with mana value X from your graveyard. Create a token that's a copy of it, except it's a 4/4 black Zombie. Activate only as a sorcery.",
      "Land — Desert",
    ),
  ]);
  expect(classes.get("graveyard")?.cards.has("Lazotep Quarry") ?? false).toBe(false);
  expect(classes.get("graveyard")?.recurring.has("Lazotep Quarry") ?? false).toBe(false);
});

/** Ground Seal, fetched from the corpus: "Cards in graveyards can't be the targets of spells or
 *  abilities." A prohibition must name WHAT it prohibits -- "can't be the targets of" is graveyard
 *  PROTECTION, the thing a graveyard deck runs AGAINST hate, not hate itself. The unnarrowed
 *  `cards? in [^.]{0,40}graveyards?[^.]{0,30}can'?t` (no verb) read this as hate with its sign
 *  inverted; corpus-wide it also caught Underworld Cerberus and Dennick the same way, plus three
 *  cards with no graveyard interaction at all (Demoralize, Exquisite Firecraft, Gilded Cerodon --
 *  a threshold/spell-mastery/desert template). None of the 8 cards the narrowed pattern drops
 *  appears in the 71 calibration decks. */
test("graveyard protection is not graveyard hate, however it phrases the prohibition", () => {
  const classes = detectAnswerClasses([
    mk("Ground Seal", "When this enchantment enters, draw a card.\nCards in graveyards can't be the targets of spells or abilities.", "Enchantment"),
  ]);
  expect(classes.get("graveyard")?.cards.has("Ground Seal") ?? false).toBe(false);
  expect(classes.get("graveyard")?.recurring.has("Ground Seal") ?? false).toBe(false);
});

/** Long Road Home, fetched from the corpus: "Exile target creature. At the beginning of the next
 *  end step, return that card to the battlefield under its owner's control with a +1/+1 counter on
 *  it." A blink is the LEAST recursion-proof answer there is -- the threat comes straight back, on a
 *  timer the opponent doesn't even have to work for -- so an exile mark on one is worse than the
 *  count claim it rides on. It targets any creature (no "you control"), so it stays in `count` via
 *  `typedRemoval` exactly as before; only the NEW rule's `not` clause touches it, and only the mode.
 *  Paired with a real exile removal in the same test: either half alone passes with a broken guard. */
test("a blink exiles a creature but is not a recursion-proof answer, and a real exile still is", () => {
  const classes = detectAnswerClasses([
    mk("Long Road Home", "Exile target creature. At the beginning of the next end step, return that card to the battlefield under its owner's control with a +1/+1 counter on it.", "Instant"),
    mk("Swords to Plowshares", "Exile target creature. Its controller gains life equal to its power."),
  ]);
  expect(classes.get("creature")?.cards.has("Long Road Home")).toBe(true);
  expect(classes.get("creature")?.exiling.has("Long Road Home") ?? false).toBe(false);
  expect(classes.get("creature")?.cards.has("Swords to Plowshares")).toBe(true);
  expect(classes.get("creature")?.exiling.has("Swords to Plowshares")).toBe(true);
});

/** Staff of Compleation, fetched from the corpus: "{T}, Pay 1 life: Destroy target permanent you
 *  own." It is a genuine (self-targeted) destroy with no return clause -- not a blink -- and it was
 *  a count member before this branch touched anything. The "you own" exile guard added for Venser
 *  and Slip On the Ring is scoped to the exile-mode rule only, exactly to avoid excluding this card
 *  from `count`: population-gated, this card left all five answer classes the first time the guard
 *  was written generically, which is the regression this test pins against. */
/** S19, 2026-09-02. A SELF-BLINK IS NOT REMOVAL, and it was reaching the report's front page:
 *  `Displacer Kitten` printed "pulls double duty (Removal)" in High synergy cards for
 *  *"exile up to one target nonland permanent you control, then return that card to the
 *  battlefield"*. `targetedRemoval`'s clause is `(destroy|exile) … target … <noun>` and never
 *  looked at what followed the noun.
 *
 *  THE GUARD IS ON THE EXILE BRANCH ONLY, and that boundary is the recorded decision one test
 *  below: written generically it also drops `Staff of Compleation` ("destroy target permanent you
 *  own"), which left all five answer classes the first time this was tried. `destroy` keeps its
 *  old pattern character for character.
 *
 *  MEASURED with `build-population.ts` over the 71 calibration decks: `targetedRemoval` 210 -> 196,
 *  **14 memberships removed and none added**, no other category moved, and every one of the 14 is a
 *  blink — Blur, Conjurer's Closet, Displace, Displacer Kitten, Essence Flux, Illusionist's
 *  Stratagem, Siren's Ruse, Skycoach Conductor, Sword of Hearth and Home, Teferi's Time Twist,
 *  Thassa Deep-Dwelling, The Mind Stone, Waterbender's Restoration, Y'shtola Rhul. Corpus-wide
 *  2,985 -> 2,894. On the example deck the interaction count reads 19 -> 13 against a target of 10. */
test("a self-blink is not removal, however many permanents it exiles", () => {
  const cats = detectBuildCategories([
    realCard("Displacer Kitten"),
    realCard("Conjurer's Closet"),
    // The control case: same verb, an opponent's permanent, still removal.
    realCard("Swords to Plowshares"),
  ]);
  const removal = cats.get("targetedRemoval") ?? new Set<string>();
  expect(removal.has("Displacer Kitten")).toBe(false);
  expect(removal.has("Conjurer's Closet")).toBe(false);
  // Sword of Hearth and Home ("exile up to one target creature YOU OWN") derives `opp`: a CEILING of the derived rule (#1295 item 5), pinned in the over-claim test below.
  expect(removal.has("Swords to Plowshares")).toBe(true);
});

/** A CARD THAT DOES BOTH KEEPS ITS REMOVAL, which is why the guard is on the CLAUSE and not on the
 *  card: a `not` rule would have dropped this one wholesale. */
test("a card that blinks its own and kills theirs is still removal", () => {
  const cats = detectBuildCategories([
    // The real Closet (an immediate flicker of your own creature, clause 1) beside the real Shatter's destroy, moved to clause 2.
    realCard("Conjurer's Closet", { extraAbilities: realCard("Shatter").tags!.abilities.map((a) => ({ ...a, clause: 2 })) }),
  ]);
  expect(cats.get("targetedRemoval")?.has("Conjurer's Closet")).toBe(true);
});

/** Owner ruling 2026-09-27 (issue #531): a destroy limited to permanents YOU OWN answers nothing.
 *  Staff of Compleation sat on the "Answers lands" shelf; this test used to hold it in every class. */
test("a destroy limited to permanents you own is in no answer class", () => {
  const classes = detectAnswerClasses([
    mk("Staff of Compleation", "{T}, Pay 1 life: Destroy target permanent you own.\n{T}, Pay 2 life: Add one mana of any color.\n{T}, Pay 3 life: Proliferate.\n{T}, Pay 4 life: Draw a card.\n{5}: Untap this artifact.", "Artifact"),
  ]);
  for (const cls of ["creature", "artifact", "enchantment", "planeswalker", "land"]) {
    expect(classes.get(cls)?.cards.has("Staff of Compleation") ?? false, cls).toBe(false);
  }
});

/** The five type classes have no recurring rule at all, so they are empty by construction rather
 *  than by a special case -- if this ever fails, a mode leaked out of the graveyard rule. */
test("only graveyard carries a recurring mark", () => {
  const classes = detectAnswerClasses([
    mk("Swords to Plowshares", "Exile target creature. Its controller gains life equal to its power."),
    mk("Vindicate", "Destroy target permanent.", "Sorcery"),
  ]);
  for (const cls of ["creature", "artifact", "enchantment", "planeswalker", "land"]) {
    expect([...(classes.get(cls)?.recurring ?? [])], cls).toEqual([]);
  }
});

/** `entersTapped` gates `ramp.land.bigMana`'s `not` clause, and it used to match the word "tapped"
 *  inside a CONDITIONAL clause -- so a land that enters untapped most of the time read as one that
 *  never does (roadmap I9's second defect). Measured over the 71 calibration decks the fix moves 0
 *  category memberships, so this test is the only thing standing between the negative lookahead and
 *  a silent revert. */
test("a conditionally-tapped land is not read as unconditionally tapped", () => {
  // The two-mana {T} line is DERIVED now (#1266): `ramp.land.bigMana` reads `manaLines`, so the fixtures carry one.
  const withLine = (c: DeckCard): DeckCard => ({ ...c, tags: manaTags([mkLine({ amount: { fixed: 2, scales: null } })]) });
  const conditional = withLine(mk(
    "Riverpyre Verge",
    "This land enters tapped unless you control a Mountain or an Island.\n{T}: Add {U}{R}.",
    "Land",
  ));
  const unconditional = withLine(mk("Karoo Gate", "This land enters tapped.\n{T}: Add {G}{W}.", "Land"));
  const bigMana = (c: DeckCard): boolean =>
    (detectBuildCategories([c]).get("ramp") ?? new Set()).has(c.card.name);
  expect(bigMana(conditional)).toBe(true);
  expect(bigMana(unconditional)).toBe(false);
});

/** K4b: `altWin` matched the NEGATION of a win condition. Both witnesses were found by K4 making
 *  the sentence NAME its card — "wins by an alternate win condition (The Golden Throne)" is visibly
 *  wrong where "an alternate win condition" would have hidden it. */
test("a card that prevents LOSING is not an alternate win condition", () => {
  const alt = (c: DeckCard): boolean => (detectWincons([c]).get("alt-win") ?? new Set()).has(c.card.name);
  expect(alt(mk("Platinum Angel", "Flying\nYou can't lose the game and your opponents can't win the game.", "Artifact Creature — Angel"))).toBe(false);
  expect(alt(mk("The Golden Throne", "If you would lose the game, instead exile The Golden Throne and your life total becomes 1.", "Artifact"))).toBe(false);
  // The control arm: making somebody ELSE lose is a real alternate win, and 18 of the 20 cards the
  // detector finds are genuine. The fix must not cost them.
  expect(alt(mk("Thassa's Oracle", "If X is greater than or equal to the number of cards in your library, you win the game.", "Creature — Merfolk Wizard"))).toBe(true);
  expect(alt(mk("Vorpal Sword", "Whenever equipped creature deals combat damage to a player, that player loses the game.", "Artifact — Equipment"))).toBe(true);
});

// I5 (2026-08-25): IMPULSE DRAW IS NOT CARD SELECTION, and the `selection` pattern said so outright
// — its third alternative was literally the impulse template. Selection REORDERS what you will
// draw; impulse draw ADDS cards you may cast, usually only this turn.
test("impulse draw is its own category and no longer reads as card selection", () => {
  const cats = (dc: DeckCard) => [...detectBuildCategories([dc]).keys()];

  // Light Up the Stage's shape. Measured: 14 distinct cards across the 71 decks, none of which was
  // already counted as draw, so the leaf is not a rename of one that existed.
  const impulse = mk("Light Up the Stage", "Exile the top two cards of your library. Until the end of your next turn, you may play those cards.", "Sorcery");
  expect(cats(impulse)).toContain("impulseDraw");
  expect(cats(impulse)).not.toContain("cardSelection");

  // …and the two halves that stay selection.
  expect(cats(mk("Preordain", "Scry 2, then draw a card.", "Sorcery"))).toContain("cardSelection");
  expect(cats(mk("Consider", "Look at the top card of your library. Surveil 1.", "Instant"))).toContain("cardSelection");

  // BOTH LEAVES SIT INSIDE CONSISTENCY, which is what makes this a labelling change and not a
  // scoring one: measured over the 71 decks, the Consistency union moved in 0 of them.
  const consistency = BUILD_PARENTS.find((p) => p.name === "Card advantage")!;
  expect(consistency.leaves).toContain("impulseDraw");
  expect(consistency.leaves).toContain("cardSelection");
});

// I4 (2026-08-25): RAMP IS A NET GAIN. `ramp.effect` matched any mana-generating effect kind with
// no net test, so Manamorphose — two mana for two mana plus a cantrip — read as acceleration.
// #1169 task 2b-2: the net is the DERIVED mana line's (`ManaLine.net`: produced less the face's mana value for a spell), not the oracle text's "add" run.
// The cards below carry NO oracle text at all, so the verdict can only come from the lines.
test("a one-shot mana spell is ramp only when it nets, and a permanent mana source always is", () => {
  const cats = (dc: DeckCard) => [...detectBuildCategories([dc]).keys()];
  const spell = (name: string, lines: ManaLine[], manaValue: number, typeLine = "Instant"): DeckCard => ({
    card: { name, oracleText: "", typeLine, manaValue } as Card,
    tags: manaTags(lines, { abilities: [{ kind: "on-cast", effect: { kind: "mana-generation" } }] as never, characteristics: { types: [], subtypes: [], colors: [], identity: [], cmc: manaValue, power: null, toughness: null, token: false, keywords: [] } as never }),
  });
  const anyColour = { colours: ["W", "U", "B", "R", "G"], anyColour: "any" as const };

  // Dark Ritual nets +2; Manamorphose nets 0 and is the item's named witness.
  expect(cats(spell("Dark Ritual", [ritualLine(["B"], 3, { cost: { ...FREE_TAP, tap: false, mana: 1 }, net: 2 })], 1))).toContain("ramp");
  expect(cats(spell("Manamorphose", [ritualLine([], 2, { ...anyColour, cost: { ...FREE_TAP, tap: false, mana: 2 }, net: 0 })], 2))).not.toContain("ramp");

  // A RATE IS NOT AN AMOUNT. Jeska's Will adds one {R} per card in an opponent's hand — the most
  // explosive rituals in the format state no fixed number, so unreadable must KEEP the card.
  expect(cats(spell("Jeska's Will", [ritualLine(["R"], 1, { amount: { fixed: null, scales: "for each card in target opponent's hand" }, cost: { ...FREE_TAP, tap: false, mana: 3 }, net: -2 })], 3, "Sorcery"))).toContain("ramp");

  // THE MAXIMUM, NOT THE SUM: Cabal Ritual's second sentence says "instead" (a gated line of its own).
  expect(cats(spell("Cabal Ritual", [ritualLine(["B"], 3, { cost: { ...FREE_TAP, tap: false, mana: 2 }, net: 1 }), ritualLine(["B"], 5, { gate: parseGate("threshold"), cost: { ...FREE_TAP, tap: false, mana: 2 }, net: 3 })], 2, "Sorcery"))).toContain("ramp");
  // ...and a spell with a line that nets nothing in either reading is not ramp.
  expect(cats(spell("Net Zero", [ritualLine(["B"], 2, { cost: { ...FREE_TAP, tap: false, mana: 2 }, net: 0 }), ritualLine(["B"], 2, { gate: parseGate("threshold"), cost: { ...FREE_TAP, tap: false, mana: 2 }, net: 0 })], 2, "Sorcery"))).not.toContain("ramp");
  // A card with no mana line at all is not ramp any more (#1190): the mana-generation LABEL on its ability decides nothing, the derived record does.
  expect(cats(spell("No Line", [], 2, "Sorcery"))).not.toContain("ramp");

  // A PERMANENT MANA SOURCE REPEATS, so it is never net-tested — a dork nets 0 the turn it lands.
  expect(cats(spell("Llanowar Elves", [tapFor(["G"])], 1, "Creature — Elf Druid"))).toContain("ramp");
  // …including one whose OTHER face is a sorcery. Bramble Familiar // Fetch Quest's `{T}: Add {G}`
  // is a mana dork, and the type-line union carries "Sorcery" from the Adventure half.
  expect(cats(spell("Bramble Familiar // Fetch Quest", [tapFor(["G"])], 2, "Creature — Elemental Raccoon // Sorcery — Adventure"))).toContain("ramp");
});

// OWNER 2026-10-13 (#1169 2b-2 follow-up): High Tide IS ramp -- a tap bonus for the turn whose yield is the Islands tapped, not a net-0 one-shot -- while a spell whose mana arrives on a
// trigger or a grant is judged against its mana value (Reckless Blaze, mana value 5, "add {R}" when a creature dies; Divergent Growth, mana value 1, a tap ability until end of turn).
test("High Tide's real derived line (a one-turn tap bonus) keeps the Ramp role; a trigger or grant that cannot pay for its spell does not", () => {
  const cats = (dc: DeckCard) => [...detectBuildCategories([dc]).keys()];
  // The REAL card and the REAL derived mana lines (goldfish-cards.json is dumped from the production derive); the ability list is the one the on-cast mana spells carry.
  const real = (name: string): DeckCard => {
    const dc = structuredClone((goldfish as unknown as DeckCard[]).find((c) => c.card.name === name)!);
    return { ...dc, tags: { ...manaTags(dc.tags!.manaLines!, { abilities: [{ kind: "on-cast", effect: { kind: "mana-generation" } }] as never }) } };
  };
  for (const name of ["High Tide", "Bubbling Muck"]) {
    const dc = real(name);
    expect(dc.tags?.manaLines?.[0], name).toMatchObject({ untilEndOfTurn: true, trigger: { event: "tapped-for-mana" } });
    expect(cats(dc), name).toContain("ramp");
  }
  const spell = (name: string, lines: ManaLine[], manaValue: number, typeLine: string): DeckCard => ({
    card: { name, oracleText: "", typeLine, manaValue } as Card,
    tags: manaTags(lines, { abilities: [{ kind: "on-cast", effect: { kind: "mana-generation" } }] as never }),
  });
  expect(cats(spell("Reckless Blaze", [triggerLine("dies", "a creature you control dealt damage this way", ["R"], 1)], 5, "Sorcery"))).not.toContain("ramp");
  expect(cats(spell("Divergent Growth", [mkLine({ source: "static-grant", colours: ["W", "U", "B", "R", "G"], anyColour: "any" })], 1, "Instant"))).not.toContain("ramp");
  // ...and a trigger that DOES out-produce the spell's mana value stays ramp.
  expect(cats(spell("Big Trigger", [triggerLine("dies", "a creature", ["R"], 3)], 2, "Instant"))).toContain("ramp");
});

// #1190 (Fable round 2, finding 1): THE RAMP ROLE READS THE DERIVED MANA RECORD, like every other mana reader since #1169. It read `abilities[].effect.kind` and printed-text patterns, so
// four Auras that make no mana anywhere else were Ramp (the cards below carry NO abilities: the verdict can only come from `manaLines` / `landFetch`).
describe("the Ramp role is read from the derived mana record (#1190)", () => {
  const rampLeaves = (dc: DeckCard) => ruleIds(dc).filter((id) => loadRules().rules.find((r) => r.id === id)?.category === "ramp");
  const ruleIds = (dc: DeckCard) => loadRules().rules.filter((r) => ruleMatches(r, dc)).map((r) => r.id);
  const real = (name: string): DeckCard => structuredClone((goldfish as unknown as DeckCard[]).find((c) => c.card.name === name)!);
  const ramp = (name: string) => rampLeaves(real(name)).length > 0;

  test("an Aura whose mana is a side effect has no mana line and no Ramp role (owner 2026-10-13)", () => {
    for (const n of ["Honest Work", "Imprisoned in the Moon", "Mark of Sakiko"]) expect(ramp(n), n).toBe(false);
    // ...and a mana-generation LABEL alone, with no line behind it, decides nothing (the 18 cards that carried one).
    const label: DeckCard = { card: { name: "Labelled", oracleText: "", typeLine: "Enchantment — Aura", manaValue: 2 } as Card, tags: manaTags([], { abilities: [{ kind: "static", effect: { kind: "mana-generation" }, repeats: "per-cycle" }] as never }) };
    expect(rampLeaves(label)).toEqual([]);
    expect(ruleIds(label)).not.toContain("ramp.engine.source");
  });

  test("the classes the owner ruled ramp stay ramp, each from its own line", () => {
    for (const n of ["Abundant Growth", "Phyrexian Altar", "Birgi, God of Storytelling // Harnfel, Horn of Bounty", "Pitiless Plunderer", "Dark Ritual", "High Tide", "Lotus Petal",
      "Sol Ring", "Llanowar Elves", "Black Market"]) expect(ramp(n), n).toBe(true);
    // land fetch: a spell, a creature that fetches, and a rock that sacrifices to fetch
    for (const n of ["Nature's Lore", "Wood Elves", "Wayfarer's Bauble"]) expect(rampLeaves(real(n)), n).toContain("ramp.landFetchSpell");
    expect(rampLeaves(real("Pitiless Plunderer"))).toContain("ramp.manaToken");
    expect(rampLeaves(real("Sol Ring"))).not.toContain("ramp.manaToken");
    expect(rampLeaves(real("Dark Ritual"))).toEqual(["ramp.effect"]);
  });

  test("a line with NO ability behind it is ramp (Molten Tide's shape, #1182)", () => {
    const tide: DeckCard = { card: { name: "Molten Tide", oracleText: "", typeLine: "Sorcery", manaValue: 3 } as Card, tags: manaTags([mkLine({ source: "one-shot-spell", repeats: "once", trigger: { event: "tapped-for-mana", text: "a mountain", subject: { control: "any", token: null, subtype: "mountain" } }, untilEndOfTurn: true, cost: { ...FREE_TAP, tap: false, mana: 3 }, net: -2 })], { isOneShot: true }) };
    expect(rampLeaves(tide)).toEqual(["ramp.effect"]);
  });

  test("the engines facet reads the line's repeats and the token it makes, not any token-generation ability", () => {
    const facets = (n: string) => ruleIds(real(n)).filter((id) => id.startsWith("ramp.engine") || id === "ramp.unlabelled");
    expect(facets("Sol Ring")).toContain("ramp.engine.source");
    expect(facets("Phyrexian Altar")).toContain("ramp.engine.source");
    expect(facets("Pitiless Plunderer")).toContain("ramp.engine.source");
    expect(facets("Birgi, God of Storytelling // Harnfel, Horn of Bounty")).toContain("ramp.engine.source");
    expect(facets("Dark Ritual")).toEqual([]);
    expect(facets("Wood Elves")).toContain("ramp.engine.land");
    // a creature-token engine is no mana engine: it has no mana line at all
    const soldiers: DeckCard = { card: { name: "Token Engine", oracleText: "", typeLine: "Enchantment", manaValue: 3 } as Card, tags: manaTags([], { abilities: [{ kind: "triggered", effect: { kind: "token-generation" }, repeats: "repeatable" }] as never }) };
    expect(ruleIds(soldiers)).not.toContain("ramp.engine.source");
  });
});

// #1190 follow-ups (owner rulings 2026-10-13).
describe("the Ramp role, second round (#1190)", () => {
  const ruleIds = (dc: DeckCard) => loadRules().rules.filter((r) => (r.category === "ramp" || r.facet?.of === "ramp") && ruleMatches(r, dc)).map((r) => r.id);
  const real = (name: string): DeckCard => structuredClone((goldfish as unknown as DeckCard[]).find((c) => c.card.name === name)!);

  test("a loyalty ability the walker cannot use the turn it is cast is not the Role either (Nissa, Worldwaker's -7 at loyalty 3)", () => {
    expect(ruleIds(real("Nissa, Worldwaker"))).toEqual([]);
    // Nissa, Who Shakes the World keeps the Role through her Forest trigger; her -8 fetch at loyalty 5 adds no engine.
    expect(ruleIds(real("Nissa, Who Shakes the World"))).toContain("ramp.effect");
    expect(ruleIds(real("Nissa, Who Shakes the World"))).not.toContain("ramp.landFetchSpell");
    // "-1: Add {R}{R}" at loyalty 5 is usable on the cast turn.
    expect(ruleIds(real("Chandra, Novice Pyromancer"))).toContain("ramp.effect");
  });

  test("cost reduction IS ramp (owner 2026-08-06 and 2026-10-13): a discount for OTHER spells, not a cheaper self", () => {
    const withAbility = (name: string, subject: object, kind = "static"): DeckCard => ({
      card: { name, oracleText: "", typeLine: "Artifact", manaValue: 3 } as Card,
      tags: manaTags([], { abilities: [{ kind, effect: { kind: "cost-reduction", subject } }] as never }),
    });
    // Sapphire Medallion: "Blue spells you cast cost {1} less" -- control you, spells, all of them
    expect(ruleIds(withAbility("Sapphire Medallion", { control: "you", type: "spell", scope: "all" }))).toEqual(["ramp.costReduction"]);
    expect(ruleIds(withAbility("Zimone", { control: "any", type: "spell", scope: "each" }))).toEqual(["ramp.costReduction"]);
    // "This spell costs {1} less to cast ..." and a self-discount with no subject are a cheaper card, not ramp
    expect(ruleIds(withAbility("Blasphemous Act", { control: "any", type: "spell", self: true }, "on-cast"))).toEqual([]);
    expect(ruleIds(withAbility("Sunderflock", {}))).toEqual([]);
    // Trinisphere ("each spell that would cost less than three mana costs three") is a tax the derive typed as a reduction; Accursed Witch cheapens OPPONENTS' spells
    const texted = (name: string, oracleText: string): DeckCard => ({ ...withAbility(name, { control: "any", type: "spell", scope: "all" }), card: { name, oracleText, typeLine: "Artifact", manaValue: 3 } as Card });
    expect(ruleIds(texted("Trinisphere", "As long as this artifact is untapped, each spell that would cost less than three mana to cast costs three mana to cast."))).toEqual([]);
    expect(ruleIds(texted("Accursed Witch", "Spells your opponents cast that target this creature cost {1} less to cast."))).toEqual([]);
  });

  // Real oracle text (Mongo, 2026-10-14). The derive typed every one of these cost-reduction with a scope-all subject; the rule decides.
  test("a self discount, an alternative cost and a free cast are not ramp; Activated-ability reducers and a named-spell discount are (owner 2026-10-14)", () => {
    const text = (name: string, oracleText: string, subject: object): DeckCard => ({
      card: { name, oracleText, typeLine: "Artifact", manaValue: 3 } as Card,
      tags: manaTags([], { abilities: [{ kind: "static", effect: { kind: "cost-reduction", subject } }] as never }),
    });
    const all = { control: "any", type: "spell", scope: "all" };
    expect(ruleIds(text("Volcanic Salvo", "This spell costs {X} less to cast, where X is the total power of creatures you control.\nVolcanic Salvo deals 6 damage to each of up to two target creatures and/or planeswalkers.", { control: "you", type: "creature", scope: "all" }))).toEqual([]);
    expect(ruleIds(text("As Foretold", "At the beginning of your upkeep, put a time counter on this enchantment.\nOnce each turn, you may pay {0} rather than pay the mana cost for a spell you cast with mana value X or less, where X is the number of time counters on this enchantment.", all))).toEqual([]);
    expect(ruleIds(text("Aluren", "Any player may cast creature spells with mana value 3 or less without paying their mana costs and as though they had flash.", all))).toEqual([]);
    expect(ruleIds(text("Fires of Invention", "You can cast spells only during your turn and you can cast no more than two spells each turn.\nYou may cast spells with mana value less than or equal to the number of lands you control without paying their mana costs.", all))).toEqual([]);
    // Heartstone, Training Grounds: a reducer of activated abilities IS ramp (owner ruling); the derived subject names the ability kind.
    const act = { abilityKind: ["activated"], type: "creature", scope: "all" };
    expect(ruleIds(text("Heartstone", "Activated abilities of creatures cost {1} less to activate. This effect can't reduce the mana in that cost to less than one mana.", act))).toEqual(["ramp.costReduction"]);
    expect(ruleIds(text("Training Grounds", "Activated abilities of creatures you control cost {2} less to activate. This effect can't reduce the mana in that cost to less than one mana.", act))).toEqual(["ramp.costReduction"]);
    expect(ruleIds(text("Cheering Fanatic", "Whenever this creature attacks, choose a card name. Spells with the chosen name cost {1} less to cast this turn.", all))).toEqual(["ramp.costReduction"]);
    expect(ruleIds(text("Sapphire Medallion", "Blue spells you cast cost {1} less to cast.", all))).toEqual(["ramp.costReduction"]);
    // A self discount AND a discount for others stays ramp (Hamza), and so does a card that merely also casts something free (The Ur-Sphinx).
    expect(ruleIds(text("Hamza, Guardian of Arashin", "This spell costs {1} less to cast for each creature you control with a +1/+1 counter on it.\nCreature spells you cast cost {1} less to cast for each creature you control with a +1/+1 counter on it.", all))).toEqual(["ramp.costReduction"]);
    expect(ruleIds(text("The Ur-Sphinx", "Eminence \u2014 As long as The Ur-Sphinx is in the command zone or on the battlefield, other Sphinx spells you cast cost {1} less to cast.\nFlying\nWhenever one or more Sphinxes you control attack, each player mills that many cards. For each player, you may cast a card that player milled this way without paying its mana cost.", all))).toEqual(["ramp.costReduction"]);
    // SYNTHETIC text (no such card): a self discount plus a discount for others written with several mana symbols, with and without "(or {1})".
    for (const other of ["Minotaur spells you cast cost {B}{R} less to cast.", "Spells you cast cost {W}{U}{B}{R}{G} less to cast.", "Spells you cast cost {U} (or {1}) less to cast."])
      expect(ruleIds(text("Synthetic", `This spell costs {1} less to cast.\n${other}`, all)), other).toEqual(["ramp.costReduction"]);

    // SPELLS THAT TARGET THIS CARD are no discount for other spells (Spellwild Ouphe). The subjects below are the REAL derived ones (cardTagsDerived, 2026-10-14).
    const ouphe = { control: "any", token: null, type: "spell", scope: "all", targets: { self: true, type: "creature" } };
    expect(ruleIds(text("Spellwild Ouphe", "Spells that target this creature cost {2} less to cast.", ouphe))).toEqual([]);
    const bladegraft: DeckCard = {
      card: { name: "Bladegraft Aspirant", oracleText: "Menace\nEquipment spells you cast cost {1} less to cast.\nActivated abilities of Equipment you control that target this creature cost {1} less to activate.", typeLine: "Creature", manaValue: 2 } as Card,
      tags: manaTags([], { abilities: [
        { kind: "static", effect: { kind: "cost-reduction", subject: { control: "you", token: null, type: "spell", subtype: "equipment", scope: "all" } } },
        { kind: "static", effect: { kind: "cost-reduction" } },
      ] as never }),
    };
    expect(ruleIds(bladegraft)).toEqual(["ramp.costReduction"]);
    expect(nonAccelerantRamp(bladegraft)).toBe("cost-reducer");
    expect(nonAccelerantRamp(text("Spellwild Ouphe", "Spells that target this creature cost {2} less to cast.", ouphe))).not.toBe("cost-reducer");
  });
});

// --- self-protection in words that are not a printed keyword (roadmap I1) ---

const protectionRule = () => loadRules().rules.find((r) => r.id.startsWith("protection"))!;
const asCard = (name: string, oracleText: string, keywords: string[] = []): DeckCard => ({
  card: { name, typeLine: "Creature", oracleText, keywords, colors: [], manaValue: 3 } as never,
  tags: { oracleId: name, schemaVersion: 1, promptVersion: 1, model: "t",
    characteristics: { types: ["creature"], subtypes: [], colors: [], identity: [], cmc: 3, power: "3", toughness: "3", token: false, keywords } as never,
    abilities: [] } as never,
});

test("a spell that cannot be countered protects nothing but itself", () => {
  // 10 of the 113 cards the protection rule fires on say only this — Nezahal, Niv-Mizzet Parun,
  // Toski. A creature that cannot be countered is not one of a deck's ten Interaction cards.
  const c = asCard("Nezahal", "This spell can't be countered.\nYou have no maximum hand size.");
  expect(ruleMatches(protectionRule(), c)).toBe(false);
});

test("entering with an indestructible counter ON ITSELF is the same fact", () => {
  const c = asCard("Myojin of Grim Betrayal", "Myojin of Grim Betrayal enters with an indestructible counter on it if you cast it from your hand.");
  expect(ruleMatches(protectionRule(), c)).toBe(false);
});

test("a card that says both keeps its other half", () => {
  // Stripped, not matched: the remaining word still has to clear the printed-keyword test, and here
  // it does not — the hexproof is handed to something else.
  const c = asCard("Both", "This spell can't be countered.\nCreatures you control gain hexproof until end of turn.");
  expect(ruleMatches(protectionRule(), c)).toBe(true);
});

const SHURI_REMINDER = "(They're artifacts with indestructible and \"{T}: Add {C}. This mana can't be spent to cast a nonartifact spell.\")";
const VIBRANIUM_REMINDER = "(It's an artifact with indestructible and \"{T}: Add {C}. This mana can't be spent to cast a nonartifact spell.\")";

test("a token's reminder text is the TOKEN'S, not the card's (#1289)", () => {
  const cases: [string, string][] = [
    ["Shuri's Fabricator", `When this artifact enters, create two tapped Vibranium tokens. ${SHURI_REMINDER}\n{6}, {T}: Return target artifact card from your graveyard to the battlefield with a finality counter on it. Activate only as a sorcery. (If a permanent with a finality counter on it would be put into a graveyard, exile it instead.)`],
    ["Vibranium Mining Mech", `Trample\nWhenever this Vehicle enters or attacks, create a tapped Vibranium token. ${VIBRANIUM_REMINDER}\n{2}: This Vehicle gets +1/+0 until end of turn.\nCrew 2`],
    ["T'Challa, the Black Panther", `Whenever T'Challa enters or attacks, create a tapped Vibranium token. ${VIBRANIUM_REMINDER}\nWhenever you cast an artifact spell with mana value 4 or greater, put two +1/+1 counters on T'Challa.`],
    ["Dora Milaje Elite", `First strike\nWhen this creature enters, if an opponent controls more lands than you, create a tapped Vibranium token. ${VIBRANIUM_REMINDER}\nSacrifice this creature: Legendary permanents you control gain indestructible until end of turn.`],
  ];
  for (const [name, text] of cases) {
    const c = asCard(name, text);
    expect(ruleMatches(protectionRule(), c), name).toBe(name === "Dora Milaje Elite");
  }
});

test("ownText blanks a reminder after a create-token sentence and no other parenthesis (#1289)", () => {
  const out = ownText({ oracleText: `When this enters, create a tapped Vibranium token. ${VIBRANIUM_REMINDER}\nActivate only as a sorcery. (If a permanent with a finality counter on it would be put into a graveyard, exile it instead.)` });
  expect(out).not.toContain("indestructible");
  expect(out).not.toContain("Add {C}");
  expect(out).toContain("(If a permanent with a finality counter");
});

test("ownText keeps a reminder that explains the CARD's own action after a create-token sentence (#1289)", () => {
  const lode = "Discover 10. If the discovered card's mana value is less than 10, create a number of tapped Treasure tokens equal to the difference. (To discover 10, exile cards from the top of your library until you exile a nonland card with mana value 10 or less. Cast it without paying its mana cost or put it into your hand. Put the rest on the bottom in a random order.)";
  expect(ownText({ oracleText: lode })).toBe(lode);
  const adventure = "Flying\nThis creature can't block.\n//\nCreate a Treasure token. (Then exile this card. You may cast the creature later from exile.)";
  expect(ownText({ oracleText: adventure })).toBe(adventure);
  const carrot = "When this artifact enters and when you sacrifice it, create a 1/1 white Rabbit creature token and scry 1. (Look at the top card of your library. You may put that card on the bottom.)";
  expect(ownText({ oracleText: carrot })).toBe(carrot);
});

test("ownText blanks a token description by every opener family, verbatim corpus text (#1289)", () => {
  const cases: [string, string, string][] = [
    ["Nivea", "{5}{W}{W}{W}, Sacrifice Nivea: Create an Akroma, Angel of Wrath token. (She's a {5}{W}{W}{W} legendary 6/6 Angel creature with flying, first strike, vigilance, trample, haste, and protection from black and from red.)", "protection from"],
    ["Lord Skitter's Blessing", "When this enchantment enters, create a Wicked Role token attached to target creature you control. (Enchanted creature gets +1/+1. When this token is put into a graveyard, each opponent loses 1 life.)\nAt the beginning of your draw step, if you control an enchanted creature, you lose 1 life and you draw an additional card.", "each opponent loses"],
    ["Twisted Sewer-Witch", "When this creature enters, create a 1/1 black Rat creature token with \"This creature can't block.\" Then for each Rat you control, create a Wicked Role token attached to that Rat. (If you control another Role on it, put that one into the graveyard. Enchanted creature gets +1/+1. When this token is put into a graveyard, each opponent loses 1 life.)", "another Role"],
    ["Ant-Man's Army", "When this creature enters, create a Food token or a Treasure token. (A Food token is an artifact with \"{2}, {T}, Sacrifice this token: You gain 3 life.\" A Treasure token is an artifact with \"{T}, Sacrifice this token: Add one mana of any color.\")", "Sacrifice this token"],
    ["Tireless Provisioner", "Landfall — Whenever a land you control enters, create a Food token or a Treasure token. (Food is an artifact with \"{2}, {T}, Sacrifice this token: You gain 3 life.\" Treasure is an artifact with \"{T}, Sacrifice this token: Add one mana of any color.\")", "Sacrifice this token"],
    ["Dragon Broodmother", "Flying\nAt the beginning of each upkeep, create a 1/1 red and green Dragon creature token with flying and devour 2. (As the token enters, you may sacrifice any number of creatures. It enters with twice that many +1/+1 counters on it.)", "twice that many"],
  ];
  for (const [name, text, gone] of cases) expect(ownText({ oracleText: text }), name).not.toContain(gone);
});

test("a kept reminder loses only its token-description sentences (#1289)", () => {
  const freebooter = "When this creature dies, scry 1 and create a Treasure token. (To scry 1, look at the top card of your library. You may put that card on the bottom. A Treasure token is an artifact with \"{T}, Sacrifice this token: Add one mana of any color.\")";
  const out = ownText({ oracleText: freebooter });
  expect(out).toContain("To scry 1, look at the top card");
  expect(out).not.toContain("Sacrifice this token");
  const grab = "Mill four cards. You may put a permanent card from among the cards milled this way into your hand. If you control a Squirrel or returned a Squirrel card to your hand this way, create a Food token. (To mill four cards, put the top four cards of your library into your graveyard. A Food token is an artifact with \"{2}, {T}, Sacrifice this token: You gain 3 life.\")";
  const out2 = ownText({ oracleText: grab });
  expect(out2).toContain("To mill four cards");
  expect(out2).not.toContain("You gain 3 life");
});

test("a pronoun sentence late in a kept reminder is the card's unless it follows a create sentence (#1289)", () => {
  const genevieve = "Flying\nAt the beginning of combat on your turn, roll the party die and create a number of Treasure tokens equal to the result. (Your party consists of up to one of each of Cleric, Rogue, Warrior, and Wizard. If your party size is 1, the party die is a d4. It's a d8 for 2, a d12 for 3, and a d20 for 4.)";
  expect(ownText({ oracleText: genevieve })).toBe(genevieve);
  const chalk = "Whenever one or more creature cards leave your graveyard, create a 2/2 white and blue Detective creature token, then investigate. (Create a Clue token. It's an artifact with \"{2}, Sacrifice this token: Draw a card.\")";
  const out = ownText({ oracleText: chalk });
  expect(out).toContain("(Create a Clue token.)");
  expect(out).not.toContain("Draw a card");
  const stage = "Whenever a player performs a magic trick, they create a Hat token. (You perform a magic trick when you cast an instant or spell with flash, or turn a face-down creature face-up. Hat tokens are artifact tokens with \"{1}, {T}, Sacrifice this artifact: Create a 1/1 white Rabbit creature token.\")\nWhenever Chaos ensues, until your next turn, creature cards in your hand have flash.";
  const out2 = ownText({ oracleText: stage });
  expect(out2).toContain("You perform a magic trick");
  expect(out2).not.toContain("Rabbit");
});

test("a sentence whose subject is the card itself protects only the card (#1289)", () => {
  const selfOnly: [string, string][] = [
    ["Falkenrath Aristocrat", "Flying, haste\nSacrifice a creature: This creature gains indestructible until end of turn. If the sacrificed creature was a Human, put a +1/+1 counter on this creature."],
    ["Dragonlord Ojutai", "Flying\nDragonlord Ojutai has hexproof as long as it's untapped.\nWhenever Dragonlord Ojutai deals combat damage to a player, look at the top three cards of your library. Put one of them into your hand and the rest on the bottom of your library in any order."],
    ["Crew Captain", "Haste\nThis creature has indestructible as long as it entered this turn."],
    ["Kogla, the Titan Ape", "When Kogla enters, it fights up to one target creature you don't control.\nWhenever Kogla attacks, destroy target artifact or enchantment defending player controls.\n{1}{G}: Return target Human you control to its owner's hand. Kogla gains indestructible until end of turn."],
    ["Hungering Puppetbeast", `When this creature enters, create a Heartwood token. (It's a red and green artifact with "{T}: Add {R} or {G}.")\n{1}, Sacrifice another artifact: Put a +1/+1 counter on this creature. It gains your choice of trample, hexproof, or haste until end of turn.`],
    ["Ellie", "Ellie deals 2 damage to target player and gains indestructible until end of turn."],
    ["Until Card", "{1}: Until end of turn, this creature gains hexproof."],
  ];
  for (const [name, text] of selfOnly) expect(ruleMatches(protectionRule(), asCard(name, text)), name).toBe(false);
});

test("a grant to something else keeps the role even beside a self sentence (#1289)", () => {
  const keeps: [string, string][] = [
    ["Feat of Resistance", "Put a +1/+1 counter on target creature you control. It gains protection from the color of your choice until end of turn. (It can't be blocked, targeted, dealt damage, enchanted, or equipped by anything of that color.)"],
    ["Gaea's Gift", "Put a +1/+1 counter on target creature you control. It gains reach, trample, hexproof, and indestructible until end of turn. (It can't be the target of spells or abilities your opponents control. Damage and effects that say \"destroy\" don't destroy it.)"],
    ["Fated Return", "Put target creature card from a graveyard onto the battlefield under your control. It gains indestructible. If it's your turn, scry 2."],
    ["Airtight Alibi", "Flash\nEnchant creature\nWhen this Aura enters, untap enchanted creature. It gains hexproof until end of turn. If it's suspected, it's no longer suspected.\nEnchanted creature gets +2/+2 and can't become suspected."],
    ["Lightning Greaves", "Equipped creature has haste and shroud. (It can't be the target of spells or abilities.)\nEquip {0}"],
    ["Heroic Intervention", "Permanents you control gain hexproof and indestructible until end of turn."],
    // Inside a quoted ability granted to others, "this creature" and "It" are the GRANTEE, not the card.
    ["Agent of the Shadow Thieves", "Commander creatures you own have \"Whenever this creature attacks a player, if no opponent has more life than that player, put a +1/+1 counter on this creature. It gains deathtouch and indestructible until end of turn.\""],
    ["Both Sentences", "This creature gains indestructible until end of turn.\nSacrifice this creature: Other creatures you control gain hexproof until end of turn."],
    ["Plural Subject", "This creature and other creatures you control gain indestructible until end of turn."],
  ];
  for (const [name, text] of keeps) expect(ruleMatches(protectionRule(), asCard(name, text)), name).toBe(true);
});

test("a card with no protection at all does not match the rule at all", () => {
  // NOT A TEST OF THE EMPTY GUARD, and saying so is the point: `protectionIsOwnKeyword` only runs
  // once the protection pattern has matched, so its `found(txt).size === 0` branch is UNREACHABLE
  // through the shipped rule and mutating it away changes no test. It is kept because a caller that
  // did reach it would otherwise be told a silent card protects itself, and the rule reads the op
  // under `not:` — so the wrong answer there would SUPPRESS the rule, which is the under-claiming
  // direction. Recorded rather than shipped as a guard that fires.
  expect(ruleMatches(protectionRule(), asCard("Bear", "Vanilla."))).toBe(false);
});

test("stripping hexproof from an opponent is removal, not protection", () => {
  // Shadowspear and Nowhere to Run exist so your REMOVAL connects. Counted as Interaction of the
  // protection kind, they reached a true category through a false sentence.
  const shadowspear = asCard("Shadowspear",
    "Equipped creature gets +1/+1 and has trample and lifelink.\n{1}: Permanents your opponents control lose hexproof and indestructible until end of turn.\nEquip {2}");
  expect(ruleMatches(protectionRule(), shadowspear)).toBe(false);
  const nowhere = asCard("Nowhere to Run",
    "Creatures your opponents control can be the targets of spells and abilities as though they didn't have hexproof.");
  expect(ruleMatches(protectionRule(), nowhere)).toBe(false);
});

test("a card that grants AND strips keeps its own half", () => {
  // Archetype of Endurance, verbatim in shape: one sentence gives your creatures hexproof, the next
  // takes it from theirs. Only the second goes — which is why this is a strip and not a refusal.
  const c = asCard("Archetype of Endurance",
    "Creatures you control have hexproof.\nCreatures your opponents control lose hexproof and can't have hexproof.");
  expect(ruleMatches(protectionRule(), c)).toBe(true);
});

test("the strip takes the SENTENCE, because one clause can name two words", () => {
  // A phrase-level cut on Shadowspear leaves "indestructible" standing, and the card reads as
  // protection again through the half that was never about protecting anything of yours.
  const c = asCard("Two Words",
    "{1}: Permanents your opponents control lose hexproof and indestructible until end of turn.");
  expect(ruleMatches(protectionRule(), c)).toBe(false);
});

// THE WIPE PATTERN, MEASURED AGAINST COMMANDER SALT'S boardWipes ON THE SIX CACHED DECKS (2026-09-05):
// the old five-shape regex found 7 of 16 with 0 false; this one finds 16 of 16 with 2 (Fiery
// Confluence's each-creature mode and Chandra, Bold Pyromancer's ultimate, both defensible). The
// old one also called every "each player sacrifices a creature" EDICT a wipe (Fleshbag Marauder,
// Plaguecrafter, Szat's Will -- 15 cards in the 71 decks) and every "return all ... cards from your
// graveyard" recursion one. Every quoted line is oracle text fetched from the corpus, not memory.
test("a board wipe is a mass effect on the battlefield, in any of its printed shapes", () => {
  const wipes: [string, string][] = [
    ["Wrath of God", "Destroy all creatures. They can't be regenerated."],
    ["Farewell", "Choose one or more —\n• Exile all artifacts.\n• Exile all creatures.\n• Exile all enchantments.\n• Exile all graveyards."],
    ["Blasphemous Act", "This spell costs {1} less to cast for each creature on the battlefield.\nBlasphemous Act deals 13 damage to each creature."],
    ["Toxic Deluge", "As an additional cost to cast this spell, pay X life.\nAll creatures get -X/-X until end of turn."],
    ["The Meathook Massacre", "When The Meathook Massacre enters, each creature gets -X/-X until end of turn."],
    ["Massacre Girl", "Menace\nWhen Massacre Girl enters, each other creature gets -1/-1 until end of turn."],
    ["Living Death", "Each player exiles all creature cards from their graveyard, then sacrifices all creatures they control, then puts all cards they exiled this way onto the battlefield."],
    ["Blasphemous Edict", "Each player sacrifices thirteen creatures of their choice."],
    ["Cyclonic Rift", "Return target nonland permanent you don't control to its owner's hand.\nOverload {6}{U} (You may cast this spell for its overload cost. If you do, change \"target\" in its text to \"each.\")"],
    ["Vandalblast", "Destroy target artifact you don't control.\nOverload {4}{R} (You may cast this spell for its overload cost. If you do, change \"target\" in its text to \"each.\")"],
    ["Black Sun's Zenith", "Put X -1/-1 counters on each creature. Shuffle Black Sun's Zenith into its owner's library."],
    ["Delayed Blast Fireball", "Delayed Blast Fireball deals 2 damage to each opponent and each creature they control."],
    ["Chandra Nalaar", "−8: Chandra Nalaar deals 10 damage to target player or planeswalker and each creature that player or that planeswalker's controller controls."],
    ["Desynchronization", "Return each nonland permanent that's not historic to its owner's hand."],
    ["Calamity of the Titans", "Exile each creature and planeswalker with mana value less than the revealed card's mana value."],
    ["Plague Wind", "Destroy all creatures you don't control. They can't be regenerated."],
  ];
  const notWipes: [string, string][] = [
    ["Fleshbag Marauder", "When this creature enters, each player sacrifices a creature of their choice."],
    ["Rest in Peace", "When this enchantment enters, exile all graveyards.\nIf a card or token would be put into a graveyard from anywhere, exile it instead."],
    ["Gallifrey Stands", "When Gallifrey Stands enters, return all Doctor cards from your graveyard to your hand."],
    ["Emrakul, the World Anew", "When Emrakul leaves the battlefield, sacrifice all creatures you control."],
    ["Eldritch Immunity", "Target creature you control gains protection from each color until end of turn.\nOverload {4}{C} (You may cast this spell for its overload cost. If you do, change \"target\" in its text to \"each.\")"],
    ["Mizzix's Mastery", "Exile target card that's an instant or sorcery from your graveyard. For each card exiled this way, copy it, and you may cast the copy without paying its mana cost. Exile Mizzix's Mastery.\nOverload {5}{R}{R}{R} (You may cast this spell for its overload cost. If you do, change \"target\" in its text to \"each.\")"],
    ["Coat of Arms", "Each creature gets +1/+1 for each other creature on the battlefield that shares at least one creature type with it."],
    ["Wisdom of Ages", "Return all instant and sorcery cards from your graveyard to your hand. You have no maximum hand size for the rest of the game."],
    // PERSONA ROUND 2026-09-25, oracle text from Scryfall. A token-copier cleaning up ITS OWN tokens
    // wipes nothing, and burn to each opponent and their planeswalkers touches no creature.
    ["Arcane Artisan", "{2}{U}, {T}: Target player draws a card, then exiles a card from their hand. If a creature card is exiled this way, that player creates a token that's a copy of that card.\nWhen this creature leaves the battlefield, exile all tokens created with it at the beginning of the next end step."],
    // #961: a polymorph exiles ONLY its caster's creatures, to replace them from the library.
    ["Mass Polymorph", "Exile all creatures you control, then reveal cards from the top of your library until you reveal that many creature cards. Put all creature cards revealed this way onto the battlefield, then shuffle the rest of the revealed cards into your library."],
    ["Synthetic Destiny", "Exile all creatures you control. At the beginning of the next end step, reveal cards from the top of your library until you reveal that many creature cards, put all creature cards revealed this way onto the battlefield, then shuffle the rest of the revealed cards into your library."],
    ["Cavalier of Flame", "{1}{R}: Creatures you control get +1/+0 and gain haste until end of turn.\nWhen this creature enters, discard any number of cards, then draw that many cards.\nWhen this creature dies, it deals X damage to each opponent and each planeswalker they control, where X is the number of land cards in your graveyard."],
  ];
  const m = detectBuildCategories([...wipes, ...notWipes].map(([n, t]) => mk(n, t, "Sorcery")));
  const found = m.get("boardWipe") ?? new Set<string>();
  expect(wipes.map(([n]) => n).filter((n) => !found.has(n))).toEqual([]);
  expect(notWipes.map(([n]) => n).filter((n) => found.has(n))).toEqual([]);
});

// A DRAW THAT COMES BACK (owner, 2026-09-05). `repeats` narrows `effectKind` on the SAME ability.
test("effectKind with `repeats` is tested per ability, not per card", () => {
  const card = (abilities: unknown[]): DeckCard => ({
    card: { name: "x", oracleText: "", typeLine: "Creature" } as Card,
    tags: { abilities } as never,
  });
  const rule: Rule = { id: "t", match: [{ op: "effectKind", in: ["draw-card"], repeats: ["repeatable"] }] };
  const set = loadRules();
  // A repeatable draw is an engine.
  expect(ruleMatches(rule, card([{ effect: { kind: "draw-card" }, repeats: "repeatable" }]), set)).toBe(true);
  // A one-shot draw beside a repeatable SAC OUTLET is not: the labels are on different abilities.
  expect(ruleMatches(rule, card([
    { effect: { kind: "draw-card" }, repeats: "once" },
    { effect: { kind: "sacrifice-outlet" }, repeats: "repeatable" },
  ]), set)).toBe(false);
  // `null` names an unlabelled ability.
  const unlabelled: Rule = { id: "u", match: [{ op: "effectKind", in: ["draw-card"], repeats: [null] }] };
  expect(ruleMatches(unlabelled, card([{ effect: { kind: "draw-card" } }]), set)).toBe(true);
  expect(ruleMatches(unlabelled, card([{ effect: { kind: "draw-card" }, repeats: "once" }]), set)).toBe(false);
});

test("emits is tested per ability like effectKind: a removal ability is what emits dies/leaves", () => {
  const card = (abilities: unknown[]): DeckCard => ({
    card: { name: "x", oracleText: "", typeLine: "Creature" } as Card,
    tags: { abilities } as never,
  });
  const set = loadRules();
  const engine: Rule = { id: "t", match: [{ op: "emits", verbs: ["dies", "leaves"], repeats: ["per-cycle"] }] };
  const kill = { effect: { kind: "" }, emits: [{ verb: "dies", subject: { control: "opp", token: null, scope: "target" } }] };
  expect(ruleMatches(engine, card([{ ...kill, repeats: "per-cycle" }]), set)).toBe(true);
  expect(ruleMatches(engine, card([{ ...kill, repeats: "once" }]), set)).toBe(false);
  // The label must sit on the SAME ability as the emit.
  expect(ruleMatches(engine, card([{ ...kill, repeats: "once" }, { effect: { kind: "draw-card" }, repeats: "per-cycle" }]), set)).toBe(false);
  // A card's OWN sacrifice is not removal, and a graveyard leave is not a battlefield one.
  const removal: Rule = { id: "r", match: [{ op: "emits", verbs: ["dies", "leaves"], control: ["opp", "any"], zone: [null] }] };
  expect(ruleMatches(removal, card([{ effect: { kind: "" }, emits: [{ verb: "dies", subject: { control: "you", token: null } }] }]), set)).toBe(false);
  expect(ruleMatches(removal, card([{ effect: { kind: "" }, emits: [{ verb: "leaves", subject: { control: "any", token: null, zone: "graveyard" } }] }]), set)).toBe(false);
  expect(ruleMatches(removal, card([{ effect: { kind: "" }, emits: [{ verb: "leaves", subject: { control: "any", token: null } }] }]), set)).toBe(true);
  const any: Rule = { id: "u", match: [{ op: "emits", verbs: ["dies"] }] };
  expect(ruleMatches(any, card([{ ...kill }]), set)).toBe(true);
  expect(ruleMatches(any, card([{ effect: { kind: "draw-card" } }]), set)).toBe(false);
});

/** AN IMMEDIATE FLICKER ANSWERS NOTHING, AND IT PROTECTS (owner ruling 2026-09-25). "Exile target X,
 *  then return it to the battlefield" puts the permanent straight back, so it is not removal and not
 *  an answer; the answer-modes spec's "answers the board for a turn" holds for a DELAYED return only,
 *  which keeps its place. Cast at instant speed on your own permanent, a flicker makes a new object
 *  (CR 400.7) and the removal aimed at it loses its target (CR 608.2b): protection. Oracle text from
 *  Scryfall, 2026-09-25. */
const FLICKERS = ["Eldrazi Confluence", "Flicker", "Ephemerate", "Cloudshift", "Restoration Angel", "Otherworldly Journey", "Flickerwisp", "Brago, King Eternal", "Swords to Plowshares"];
const flick = (name: string) => realCard(name);

test("an immediate-return flicker is not an answer; a delayed one still is", () => {
  expect([...answerClassesOf(flick("Eldrazi Confluence")).keys()]).toEqual([]);
  expect([...answerClassesOf(flick("Flicker")).keys()]).toEqual([]);
  expect([...answerClassesOf(flick("Otherworldly Journey")).keys()]).toContain("creature");
  expect([...answerClassesOf(flick("Flickerwisp")).keys()]).toContain("creature");
  expect([...answerClassesOf(flick("Swords to Plowshares")).keys()]).toContain("creature");
});

test("an immediate-return flicker is not targeted removal", () => {
  const m = detectBuildCategories(FLICKERS.map(flick));
  const removal = m.get("targetedRemoval") ?? new Set<string>();
  expect(removal.has("Eldrazi Confluence")).toBe(false);
  expect(removal.has("Flicker")).toBe(false);
  expect(removal.has("Swords to Plowshares")).toBe(true);
  expect(removal.has("Otherworldly Journey")).toBe(true);
});

test("a flicker you can cast at instant speed on your own permanent is protection", () => {
  const m = detectBuildCategories(FLICKERS.map(flick));
  const protection = [...(m.get("protection") ?? new Set<string>())].sort();
  expect(protection).toEqual(["Cloudshift", "Eldrazi Confluence", "Ephemerate", "Otherworldly Journey", "Restoration Angel"]);
});

/** TWO ROLE PATTERNS THAT READ A PHRASE, NOT A MOVE (overview persona rounds 2026-09-25, item 9).
 *  "Return target ... to your hand" from a GRAVEYARD is recursion, not removal (Archaeomancer, and 383
 *  corpus cards with it); "choose new targets for the COPY" retargets your own copy, not an opponent's
 *  spell (Weaver of Harmony, Twincast, and 257 with it). Oracle text from Scryfall, 2026-09-26. */
test("a graveyard return is not removal, and retargeting your own copy is not stack interaction", () => {
  const m = detectBuildCategories([
    realCard("Archaeomancer"),
    mk("Weaver of Harmony", "Other enchantment creatures you control get +1/+1.\n{G}, {T}: Copy target activated or triggered ability you control from an enchantment source. You may choose new targets for the copy. (Mana abilities can't be targeted.)", "Enchantment Creature — Snake Druid"),
    mk("Twincast", "Copy target instant or sorcery spell. You may choose new targets for the copy."),
    realCard("Unsummon"),
    mk("Redirect", "You may choose new targets for target spell."),
  ]);
  expect([...(m.get("targetedRemoval") ?? [])].sort()).toEqual(["Unsummon"]);
  expect([...(m.get("stackInteraction") ?? [])].sort()).toEqual(["Redirect"]);
});

/** Owner rulings 2026-10-14 (issue #1199): Commandeer, Invert Polarity and Split Decision ARE stack
 *  interaction -- gaining control of a targeted spell, or countering a spell targeted in an earlier
 *  sentence. A protection trigger ("becomes the target of a spell ... counter that spell"), a
 *  gain-control of a creature "with that spell's mana value", and a copy retarget stay out.
 *  Oracle text from the corpus, 2026-10-14. */
test("gaining control of a targeted spell and countering a spell targeted earlier are stack interaction", () => {
  const m = detectBuildCategories([
    mk("Commandeer", "You may exile two blue cards from your hand rather than pay this spell's mana cost.\nGain control of target noncreature spell. You may choose new targets for it. (If that spell is an artifact, enchantment, or planeswalker, the permanent enters under your control.)"),
    mk("Invert Polarity", "Choose target spell, then flip a coin. If you win the flip, gain control of that spell and you may choose new targets for it. If you lose the flip, counter that spell."),
    mk("Split Decision", "Will of the council \u2014 Choose target instant or sorcery spell. Starting with you, each player votes for denial or duplication. If denial gets more votes, counter the spell. If duplication gets more votes or the vote is tied, copy the spell. You may choose new targets for the copy."),
    mk("Mages' Contest", "You and target spell's controller bid life. You start the bidding with a bid of 1. In turn order, each player may top the high bid. The bidding ends if the high bid stands. The high bidder loses life equal to the high bid. If you win the bidding, counter that spell."),
    mk("Swallowed by Leviathan", "Choose target spell. Surveil 2, then counter the chosen spell unless its controller pays {1} for each card in your graveyard. (To surveil 2, look at the top two cards of your library, then put any number of them into your graveyard and the rest on top of your library in any order.)", "Instant"),
    mk("Twincast", "Copy target instant or sorcery spell. You may choose new targets for the copy."),
    mk("Frost Titan", "Whenever this creature becomes the target of a spell or ability an opponent controls, counter that spell or ability unless its controller pays {2}.\nWhenever this creature enters or attacks, tap target permanent. It doesn't untap during its controller's next untap step.", "Creature \u2014 Giant"),
    mk("Skyfire Kirin", "Flying\nWhenever you cast a Spirit or Arcane spell, you may gain control of target creature with that spell's mana value until end of turn.", "Creature \u2014 Dragon Spirit"),
    mk("Counterbalance", "Whenever an opponent casts a spell, you may reveal the top card of your library. If you do, counter that spell if it has the same mana value as the revealed card.", "Enchantment"),
  ]);
  expect([...(m.get("stackInteraction") ?? [])].sort()).toEqual(["Commandeer", "Invert Polarity", "Mages' Contest", "Split Decision", "Swallowed by Leviathan"]);
});

/** Owner ruling 2026-09-27 (issue #513): Saw in Half is NOT removal -- its controller gets two copies
 *  back, and it is played on your own creatures to win or combo. Fractured Identity gives the copies
 *  to everyone else and stays removal; Grim Hireling keeps both its roles. */
test("a destroy whose controller gets copies back is neither removal nor an answer", () => {
  const saw = realCard("Saw in Half");
  const fractured = realCard("Fractured Identity");
  const hireling = realCard("Grim Hireling");
  // The Treasure is the derived mana line's, not the oracle text's (#1190).
  const treasure = { ...hireling, tags: { ...hireling.tags!, ...manaTags([mkLine({ source: "token-maker", repeats: "repeatable", producesToken: "treasure", cost: { ...FREE_TAP, tap: false } })]), abilities: hireling.tags!.abilities } };
  const cats = detectBuildCategories([saw, fractured, treasure]);
  expect(cats.get("targetedRemoval")?.has("Saw in Half") ?? false).toBe(false);
  expect(cats.get("targetedRemoval")?.has("Fractured Identity")).toBe(true);
  expect(cats.get("targetedRemoval")?.has("Grim Hireling")).toBe(true);
  expect(cats.get("ramp")?.has("Grim Hireling")).toBe(true);
  expect(detectAnswerClasses([saw]).get("creature")?.cards.has("Saw in Half") ?? false).toBe(false);
});

/** Owner ruling 2026-09-27 (issue #533): an ability quoted in a token-creating sentence is the TOKEN'S.
 *  Mage's Attendant loses Counterspells; its Wizard token carries it. A quoted grant to your own
 *  permanents is not a token and stays the card's. */
test("an ability quoted for a token is the token's, not the maker's", () => {
  const attendant = "When this creature enters, create a 1/1 blue Wizard creature token with \"{1}, Sacrifice this token: Counter target noncreature spell unless its controller pays {1}.\"";
  const cats = detectBuildCategories([mk("Mage's Attendant", attendant, "Creature — Cat Rogue")]);
  expect(cats.get("stackInteraction")?.has("Mage's Attendant") ?? false).toBe(false);
  expect(tokenQuotes({ oracleText: attendant }, "Wizard")).toContain("Counter target noncreature spell");
  expect(tokenQuotes({ oracleText: attendant }, "Goblin")).toBe("");
  const rite = "Creatures you control have \"{T}: Add one mana of any color.\"";
  expect(ownText({ oracleText: rite })).toBe(rite);
});

/** Owner ruling 2026-09-27 (issue #512): putting a land card onto the battlefield is ramp, from hand
 *  (Growth Spiral) or from among the cards looked at (Planar Genesis). */
test("putting a land card onto the battlefield is ramp", () => {
  // The rule reads the derived emit since #1266: the text is kept for the reader, the tags carry the claim.
  const withEnters = (dc: DeckCard, fromZone: string): DeckCard => ({
    ...dc, tags: { abilities: [{ effect: { kind: "" }, emits: [{ verb: "enters", subject: { control: "you", token: null, type: "land", fromZone } }] }] } as never,
  });
  const cats = detectBuildCategories([
    withEnters(mk("Growth Spiral", "Draw a card. You may put a land card from your hand onto the battlefield.", "Instant"), "hand"),
    withEnters(mk("Planar Genesis", "Look at the top four cards of your library. You may put a land card from among them onto the battlefield tapped. If you don't, put a card from among them into your hand. Put the rest on the bottom of your library in a random order.", "Instant"), "library"),
  ]);
  expect(cats.get("ramp")?.has("Growth Spiral")).toBe(true);
  expect(cats.get("ramp")?.has("Planar Genesis")).toBe(true);
});

// ISSUE #566: "exile the top card of your library ... you may play" is impulse draw (Count on Luck);
// the pattern demanded a count word ("top two cards").
test("an upkeep exile-the-top-card-and-play is impulse draw", () => {
  const luck = mk("Count on Luck", "At the beginning of your upkeep, exile the top card of your library. You may play that card this turn.", "Enchantment");
  expect(detectBuildCategories([luck]).get("impulseDraw")?.has("Count on Luck")).toBe(true);
});

// ISSUE #566: an Aura that strips a permanent is removal, answering what its Enchant line names.
test("a neutralising Aura is targeted removal for the classes it can enchant", () => {
  const moon = mk("Imprisoned in the Moon", "Enchant creature, land, or planeswalker\nEnchanted creature, land, or planeswalker is a colorless land with \"{T}: Add {C}\" and loses all other card types and abilities.", "Enchantment — Aura");
  const frog = mk("Frogify", "Enchant creature\nEnchanted creature loses all abilities and is a blue Frog creature with base power and toughness 1/1.", "Enchantment — Aura");
  const cats = detectBuildCategories([moon, frog]);
  expect(cats.get("targetedRemoval")).toEqual(new Set(["Imprisoned in the Moon", "Frogify"]));
  expect([...answerClassesOf(moon).keys()].sort()).toEqual(["creature", "land", "planeswalker"]);
  expect([...answerClassesOf(frog).keys()]).toEqual(["creature"]);
  // A plain Aura on its own creature is not removal.
  expect(detectBuildCategories([mk("Pump Aura", "Enchant creature\nEnchanted creature gets +2/+2.", "Enchantment — Aura")]).get("targetedRemoval")).toBeUndefined();
});

// #1167: the rule table reads a card as the DECK holds it. Same printed text, two layouts.
const tapAdd = (face: 0 | 1) => [tapFor(["C"], { face })];
const layoutCard = (layout: string, face: 0 | 1, typeLine = "Artifact // Land"): DeckCard => ({
  card: { name: "Probe // Cave", oracleText: "Scry 1.\n//\n{T}: Add {C}.", typeLine, layout } as Card,
  tags: { abilities: [], manaLines: tapAdd(face), characteristics: { types: ["artifact"] } } as never,
});

test("countsAsLand op: a modal DFC with a land face is a land to the guards, a transform card is a spell", () => {
  const modal = detectBuildCategories([layoutCard("modal_dfc", 1)]);
  expect(modal.get("lands")).toEqual(new Set(["Probe // Cave"]));
  expect(modal.get("ramp") ?? new Set()).toEqual(new Set());
  const transform = detectBuildCategories([layoutCard("transform", 1)]);
  expect(transform.get("lands") ?? new Set()).toEqual(new Set());
});

test("a card that transforms into a land is never ramp, wherever its mana ability sits (owner 2026-10-10, #1174)", () => {
  expect(detectBuildCategories([layoutCard("transform", 1)]).get("ramp") ?? new Set()).toEqual(new Set());
  // Not even on the front: Treasure Map's three Treasures on transforming do not make it ramp.
  expect(detectBuildCategories([layoutCard("transform", 0)]).get("ramp") ?? new Set()).toEqual(new Set());
  // A modal DFC is not a transform: a spell front that makes mana is still ramp.
  expect(detectBuildCategories([layoutCard("modal_dfc", 0, "Artifact // Artifact")]).get("ramp")).toEqual(new Set(["Probe // Cave"]));
});

// The narrowing, pinned: only transform/flip cards with a LAND back lose ramp.
test("an adventure half's mana ability is still ramp (it is cast from hand)", () => {
  expect(detectBuildCategories([layoutCard("adventure", 1, "Creature // Sorcery — Adventure")]).get("ramp")).toEqual(new Set(["Probe // Cave"]));
});

test("a transform card whose back is not a land keeps its back-face ramp", () => {
  expect(detectBuildCategories([layoutCard("transform", 1, "Creature // Creature")]).get("ramp")).toEqual(new Set(["Probe // Cave"]));
});

/** ramp.landPut reads a DERIVED enters emit, not printed text (#1266). The oracle text is empty on every card here. */
describe("ramp.landPut is derived", () => {
  const set = loadRules();
  const rule = set.rules.find((r) => r.id === "ramp.landPut")!;
  const land = (type: string | string[], fromZone: string | undefined, control = "you"): DeckCard => ({
    card: { name: "x", oracleText: "", typeLine: "Sorcery" } as Card,
    tags: { abilities: [{ effect: { kind: "" }, emits: [{ verb: "enters", subject: { control, token: null, type, fromZone } }] }] } as never,
  });
  test("a land entering from hand, library, graveyard or exile is ramp with no oracle text", () => {
    for (const z of ["hand", "library", "graveyard", "exile"]) expect(ruleMatches(rule, land("land", z), set), z).toBe(true);
  });
  test("a land entering under an opponent's emit control still counts (Realmbreaker: under YOUR control)", () => {
    expect(ruleMatches(rule, land("land", "graveyard", "opp"), set)).toBe(true);
  });
  test("a blink of land-or-other, a creature, and a land with no origin are not land drops", () => {
    expect(ruleMatches(rule, land(["creature", "artifact", "land"], "exile"), set)).toBe(false);
    expect(ruleMatches(rule, land("creature", "graveyard"), set)).toBe(false);
    expect(ruleMatches(rule, land("land", undefined), set)).toBe(false);
  });
  const plus = (c: DeckCard, verb: string, subject: Record<string, unknown>): DeckCard => {
    (c.tags as { abilities: unknown[] }).abilities.push({ effect: { kind: "" }, emits: [{ verb, subject: { token: null, ...subject } }] });
    return c;
  };
  test("a land exiled from the battlefield and returned is a swap, whoever controls it (Wormfang Newt, Petradon, Realm Razer)", () => {
    for (const control of ["you", "any", "opp"])
      expect(ruleMatches(rule, plus(land("land", "exile"), "exiled", { control, type: "land", fromZone: "battlefield" }), set), control).toBe(false);
  });
  test("an exile from the LIBRARY is the land drop itself (Venture Forth)", () => {
    expect(ruleMatches(rule, plus(land("land", "exile"), "exiled", { control: "you", type: "land", fromZone: "library" }), set)).toBe(true);
  });
  test("a land drop only an opponent gets is not yours (Old-Growth Dryads, Hired Giant)", () => {
    const dryads = plus(land("land", "library", "any"), "search", { control: "opp", type: "land", fromZone: "library" });
    expect(ruleMatches(rule, dryads, set)).toBe(false);
    // ...but one you ALSO search for is (Tempt with Discovery's shape).
    expect(ruleMatches(rule, plus(dryads, "search", { control: "you", type: "land", fromZone: "library" }), set)).toBe(true);
  });
  test("destroying every land and returning some is not ramp (Fall of the Thran)", () => {
    expect(ruleMatches(rule, plus(land("land", "graveyard", "any"), "dies", { control: "any", type: "land", scope: "all" }), set)).toBe(false);
    // "Sacrifice two lands" / "any number of lands" derives the SAME scope-all `dies`, under `you`, and is refused too (owner 2026-10-17, Hew the Entwood:
    // it sacrifices X lands and puts back at most X, so you never end with more). Planar Engineering, Scapeshift and Natural Balance are refused BY THIS RULE
    // and stay Ramp through `landFetch`, pinned just below.
    expect(ruleMatches(rule, plus(land("land", "library"), "dies", { control: "you", type: "land", scope: "all" }), set)).toBe(false);
    // Destroying ONE land (Waking the Trolls) is not "all".
    expect(ruleMatches(rule, plus(land("land", "graveyard"), "dies", { control: "any", type: "land", scope: "target" }), set)).toBe(true);
  });
  test("a sacrifice-N card with a land search keeps Ramp through landFetch, not through ramp.landPut (Planar Engineering, Scapeshift)", () => {
    const c = plus(land("land", "library"), "dies", { control: "you", type: "land", scope: "all" });
    (c.tags as { landFetch?: unknown }).landFetch = { zone: "battlefield" };
    expect(ruleMatches(rule, c, set)).toBe(false);
    expect(detectBuildCategories([c]).get("ramp")?.has("x")).toBe(true);
  });
  test("Sacred Ground is NOT refused: its derive has no trigger to tell a retention from a drop (CEILING, #1277, owner ruling 2026-10-17)", () => {
    // The real shape: an `enters` with `ref: "trigger"` on an ability that has NO trigger. Pinned so the day the derive gains the trigger and the rule refuses it, this test flips.
    const sacred: DeckCard = {
      card: { name: "Sacred Ground", oracleText: "", typeLine: "Enchantment" } as Card,
      tags: { abilities: [{ effect: { kind: "graveyard-recursion" }, emits: [{ verb: "enters", subject: { control: "you", token: null, type: "land", fromZone: "graveyard", ref: "trigger" } }] }] } as never,
    };
    expect(ruleMatches(rule, sacred, set)).toBe(true);
  });
  test("allOf and not compose inside a rule", () => {
    const yes: Rule = { id: "a", match: [{ op: "allOf", clauses: [{ op: "emits", verbs: ["enters"] }, { op: "not", clause: { op: "emits", verbs: ["dies"] } }] }] };
    expect(ruleMatches(yes, land("land", "hand"), set)).toBe(true);
    expect(ruleMatches(yes, plus(land("land", "hand"), "dies", { control: "you" }), set)).toBe(false);
  });
});

/** ramp.land.fetchesTwo and ramp.land.bigMana read DERIVED mana lines and the shared land classifier, not printed text (#1266). Oracle texts are verbatim from the corpus; where the
 *  must-hold cases carry NO oracle text the old printed pattern could not have matched them, and the not-hold ones carry text the old pattern WOULD have matched. */
describe("ramp.land.fetchesTwo and ramp.land.bigMana are derived", () => {
  const set = loadRules();
  const two = set.rules.find((r) => r.id === "ramp.land.fetchesTwo")!;
  const big = set.rules.find((r) => r.id === "ramp.land.bigMana")!;
  const land = (name: string, oracleText: string, lines: ManaLine[]): DeckCard => ({ card: { name, oracleText, typeLine: "Land" } as Card, tags: manaTags(lines) });
  const amount = (n: number | null): Partial<ManaLine> => ({ amount: { fixed: n, scales: n === null ? "x" : null } });
  const cost = (over: Partial<ManaLine["cost"]>): Partial<ManaLine> => ({ cost: { ...FREE_TAP, ...over } });
  const fetch = (n: number, over: Partial<ManaLine["cost"]> = {}): ManaLine =>
    mkLine({ source: "fetch", repeats: "once", ...amount(n), ...cost({ mana: 2, sacrificeSelf: true, ...over }) });
  const TAPPED = "This land enters tapped.";

  test("a bare {T} that adds two, on a land that enters untapped, is bigMana with no oracle text (Ancient Tomb)", () => {
    const tomb = land("Ancient Tomb", "", [mkLine({ ...amount(2) })]);
    expect(ruleMatches(big, tomb, set)).toBe(true);
    expect(ruleMatches(big, land("City of Traitors", "", [mkLine({ ...amount(2) })]), set)).toBe(true);
  });
  test("a GATED bare-{T} line of 2+ still holds (owner 2026-10-13, #1169; Urza's Tower: 3 mana under the Tron gate)", () => {
    const tower = land("Urza's Tower", "{T}: Add {C}. If you control an Urza's Mine and an Urza's Power-Plant, add {C}{C}{C} instead.", [
      mkLine({ ...amount(1) }),
      mkLine({ ...amount(3), gate: { kind: "tron", names: ["urza's mine", "urza's power-plant"], text: "you control an urza's mine and an urza's power-plant" } as never }),
    ]);
    expect(ruleMatches(big, tower, set)).toBe(true);
  });
  test("a land that sacrifices itself to fetch two is fetchesTwo with no oracle text (Myriad Landscape)", () => {
    expect(ruleMatches(two, land("Myriad Landscape", "", [mkLine({ ...amount(1) }), fetch(2)]), set)).toBe(true);
  });
  test("a fetchland that finds ONE land is not fetchesTwo (Evolving Wilds)", () => {
    expect(ruleMatches(two, land("Evolving Wilds", "{T}, Sacrifice this land: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.", [fetch(1, { mana: 0 })]), set)).toBe(false);
  });
  test("a scaling add is no stated 2+ (the printed pattern needed a number)", () => {
    expect(ruleMatches(big, land("x", "", [mkLine({ ...amount(null) })]), set)).toBe(false);
  });
  test("a bare-{T} add of ONE is not bigMana", () => {
    expect(ruleMatches(big, land("Forest", "", [mkLine({ ...amount(1) })]), set)).toBe(false);
  });
  test("a cost beyond the bare {T} is not bigMana: a sacrifice (Crystal Vein), mana, life, a counter, another tap", () => {
    // The oracle text here is the one the old pattern read as a bare "{T}: Add {C}{C}".
    for (const over of [{ sacrificeSelf: true }, { sacrificeOther: true }, { mana: 1 }, { life: 2 }, { counters: "remove" as const }, { tapOther: true }, { tap: false }, { other: ["Exert this land"] }, { consumes: ["discard" as const] }])
      expect(ruleMatches(big, land("Crystal Vein", "{T}: Add {C}{C}.", [mkLine({ ...amount(2), ...cost(over) })]), set), JSON.stringify(over)).toBe(false);
  });
  test("a two-mana land that enters tapped is not bigMana (Rakdos Carnarium), and neither is one whose tapped condition the classifier cannot read (Dormant Volcano)", () => {
    const line = mkLine({ ...amount(2) });
    expect(ruleMatches(big, land("Rakdos Carnarium", `${TAPPED}\nWhen this land enters, return a land you control to its owner's hand.\n{T}: Add {B}{R}.`, [line]), set)).toBe(false);
    expect(ruleMatches(big, land("Dormant Volcano", "This land enters tapped.\nWhen this land enters, sacrifice it unless you return an untapped Mountain you control to its owner's hand.\n{T}: Add {C}{R}.", [line]), set)).toBe(false);
  });
  test("a two-mana land with a conditional or absent tapped clause stays bigMana", () => {
    const line = mkLine({ ...amount(2) });
    expect(ruleMatches(big, land("Lotus Vale", "", [line]), set)).toBe(true);
    expect(ruleMatches(big, land("x", "This land enters tapped unless you control a Mountain.\n{T}: Add {R}{R}.", [line]), set)).toBe(true);
  });
  test("a non-land is never either rule", () => {
    expect(ruleMatches(big, { card: { name: "Sol Ring", oracleText: "", typeLine: "Artifact" } as Card, tags: manaTags([mkLine({ ...amount(2) })]) }, set)).toBe(false);
  });
});

/** removal.targeted reads DERIVED emits, not printed text (#1266, removal step 1). Every card here carries its real Mongo oracle text and its real `cardTagsDerived` abilities
 *  (`fixtures/removal-derived.json`); the must-hold cases blank the oracle text, so only the derived data can say yes. The damage half is still a printed pattern (#1294). */
describe("removal.targeted is derived", () => {
  const set = loadRules();
  const rule = set.rules.find((r) => r.id === "removal.targeted")!;
  const land = set.rules.find((r) => r.id === "removal.land")!;
  const blank = (name: string): DeckCard => realCard(name, { oracleText: "" });
  test("a destroy, an exile, a shuffle, a bounce and a lethal debuff of a target hold with no oracle text (Murder, Swords, Chaos Warp, Cyclonic Rift, Tragic Slip, Dismember)", () => {
    for (const n of ["Murder", "Swords to Plowshares", "Chaos Warp", "Cyclonic Rift", "Tragic Slip", "Dismember"]) expect(ruleMatches(rule, blank(n), set), n).toBe(true);
  });
  test("wording the printed pattern missed holds: a multicoloured permanent (Pure // Simple), 'creature or Vehicle' (Daring Demolition), 'target Spirit' (Rend Spirit)", () => {
    for (const n of ["Pure // Simple", "Daring Demolition", "Rend Spirit"]) expect(ruleMatches(rule, blank(n), set), n).toBe(true);
  });
  test("an exile whose emit names no origin zone still holds (Karlov), and so does an 'until this leaves' exile, whose return derive reads as an opponent's flicker (Fairgrounds Warden)", () => {
    for (const n of ["Karlov of the Ghost Council", "Fairgrounds Warden"]) expect(ruleMatches(rule, blank(n), set), n).toBe(true);
  });
  test("a delayed return still holds (Flickerwisp, Otherworldly Journey): owner ruling 2026-09-25", () => {
    for (const n of ["Flickerwisp", "Otherworldly Journey"]) expect(ruleMatches(rule, blank(n), set), n).toBe(true);
  });
  test("a wipe is not targeted (Wrath of God: scope all)", () => {
    expect(ruleMatches(rule, realCard("Wrath of God"), set)).toBe(false);
    expect(ruleMatches(rule, blank("Wrath of God"), set)).toBe(false);
  });
  test("a flicker of your own permanent is not removal (Abuelo: control you; Flicker: the return comes at once), with its printed text", () => {
    for (const n of ["Abuelo, Ancestral Echo", "Flicker"]) expect(ruleMatches(rule, realCard(n), set), n).toBe(false);
  });
  test("a -N/-0 shrink kills nothing (Disorient), and a bounce of your own permanent is not removal (Alley Evasion), with their printed text", () => {
    for (const n of ["Disorient", "Alley Evasion"]) expect(ruleMatches(rule, realCard(n), set), n).toBe(false);
  });
  test("an edict is read from the derived victim marker, with no oracle text (#1295 item 1): Diabolic Edict, Cruel Edict, Structural Collapse (two sacrifices), Rakdos Riteknife (a sacrifice cost beside it)", () => {
    for (const n of ["Diabolic Edict", "Cruel Edict", "Structural Collapse", "Rakdos Riteknife"]) expect(ruleMatches(rule, blank(n), set), n).toBe(true);
  });
  test("a sweep that makes EACH player sacrifice is not an edict (Innocent Blood)", () => {
    expect(ruleMatches(rule, blank("Innocent Blood"), set)).toBe(false);
  });
  test("a target another word on the card used to turn `you` comes back (#1295 item 2): Premature Burial, Blazing Hope, Soul Snare, and Alchemist's Retrieval (cleave: any nonland permanent)", () => {
    for (const n of ["Premature Burial", "Blazing Hope", "Soul Snare", "Alchemist's Retrieval"]) expect(ruleMatches(rule, blank(n), set), n).toBe(true);
  });
  test("an O-ring return and a one-branch return are still removal (#1295 item 3): Constable of the Realm, Mysterious Limousine (until this leaves), Unyielding Gatekeeper, Vindictive Triumph (an 'If ...' return); the blinks stay out (Flicker, Eldrazi Displacer, Ephemerate)", () => {
    for (const n of ["Constable of the Realm", "Mysterious Limousine", "Unyielding Gatekeeper", "Vindictive Triumph"]) expect(ruleMatches(rule, blank(n), set), n).toBe(true);
    for (const n of ["Flicker", "Eldrazi Displacer", "Ephemerate"]) expect(ruleMatches(rule, realCard(n), set), n).toBe(false);
  });
  test("an anaphor resolved to the right object (#1295 item 4): Depressurize ('destroy that creature' after a targeted shrink) is removal; Venser, Fervent Forger's sacrificed copy tokens are not", () => {
    expect(ruleMatches(rule, blank("Depressurize"), set)).toBe(true);
    expect(ruleMatches(rule, realCard("Venser, Fervent Forger"), set)).toBe(false);
  });
  test("a tuck and a bounce 'or suspended card' that derived nothing are removal again (#1295 item 4): Venser's Diffusion, Teferi, Hero of Dominaria (-3, third from the top)", () => {
    for (const n of ["Venser's Diffusion", "Teferi, Hero of Dominaria"]) expect(ruleMatches(rule, blank(n), set), n).toBe(true);
  });
  test("the CEILING in rules.ts is pinned: the polymorph family stays `you` by owner ruling #962 (primary use is your own creature), so the role loses it (Polymorph, Transmogrify, Chaos Mutation, Divergent Transformations)", () => {
    for (const n of ["Polymorph", "Transmogrify", "Chaos Mutation", "Divergent Transformations"]) expect(ruleMatches(rule, realCard(n), set), n).toBe(false);
  });
  test("what derive over-claimed leaves the role (#1295 item 5): 'you own' (Become Anonymous, Northampton Farm, Sword of Hearth and Home, Despotic Scepter, Telim'Tor's Edict), its controller sacrificing YOUR pumped creature (Celestial Sword), a creature that crewed it (Getaway Car), and the victim's option to decline (Star Athlete, Enchanter's Bane, Thornplate Intimidator, Disorienting Choice, Livio)", () => {
    for (const n of ["Become Anonymous", "Northampton Farm", "Sword of Hearth and Home", "Despotic Scepter", "Telim'Tor's Edict", "Celestial Sword", "Getaway Car",
      "Star Athlete", "Enchanter's Bane", "Thornplate Intimidator", "Disorienting Choice", "Livio, Oathsworn Sentinel"]) expect(ruleMatches(rule, realCard(n), set), n).toBe(false);
  });
  test("permanents you OWN are refused, as the printed pattern refused 'you own': a bounce (Get Out, Leave // Chance) and a DELAYED flicker of your own creature (Charming Prince)", () => {
    for (const n of ["Get Out", "Leave // Chance", "Charming Prince"]) expect(ruleMatches(rule, blank(n), set), n).toBe(false);
  });
  test("a land with derived removal fills removal.land, not removal.targeted", () => {
    const eiganjo = { ...realCard("Murder"), card: { name: "x", typeLine: "Land", oracleText: "", manaValue: 0 } as never };
    expect(ruleMatches(land, eiganjo, set)).toBe(true);
    expect(ruleMatches(rule, eiganjo, set)).toBe(false);
  });
  test("toughnessDown: only a negative toughness half kills", () => {
    const debuff = (amount: string): DeckCard => ({ card: { name: "x", typeLine: "Instant", oracleText: "" } as never, tags: { abilities: [{ effect: { kind: "debuff", subject: { control: "any", token: null, type: "creature", scope: "target" } }, amount }] } as never });
    for (const a of ["-5/-5", "-0/-3", "-1/-1", "-X/-X, where X is the mana value of the exiled card"]) expect(ruleMatches(rule, debuff(a), set), a).toBe(true);
    for (const a of ["-2/-0", "-7/-0", "-X/-0", "-X/+X"]) expect(ruleMatches(rule, debuff(a), set), a).toBe(false);
  });
  test("an ability paid by exiling THIS card from hand is no removal of the target (Emrakul, the Exigent Doom's cost); one that pairs the target with a graveyard card of the same control and type is not either (Macabre Mockery)", () => {
    const exile = (cost: string | undefined, emits: unknown[], extra: unknown[] = []): DeckCard => ({ card: { name: "x", typeLine: "Sorcery", oracleText: "" } as never,
      tags: { abilities: [{ kind: "activated", clause: 1, effect: { kind: "" }, ...(cost ? { cost } : {}), emits }, ...extra] } as never });
    const land = { control: "opp", token: null, type: "land", scope: "target" };
    expect(ruleMatches(rule, exile(undefined, [{ verb: "exiled", subject: land }]), set)).toBe(true);
    expect(ruleMatches(rule, exile("{3}, Exile this card from your hand", [{ verb: "exiled", subject: land }]), set)).toBe(false);
    const dies = { control: "opp", token: null, type: "creature", scope: "target" };
    const back = (control: string): unknown => ({ kind: "", clause: 1, effect: { kind: "graveyard-recursion" }, emits: [{ verb: "enters", subject: { ...dies, control, fromZone: "graveyard" } }] });
    expect(ruleMatches(rule, exile(undefined, [{ verb: "dies", subject: dies }], [back("opp")]), set)).toBe(false);
    // Lethal Protection: the kill is an opponent's creature, the graveyard card is YOURS.
    expect(ruleMatches(rule, exile(undefined, [{ verb: "dies", subject: dies }], [back("you")]), set)).toBe(true);
  });
});
