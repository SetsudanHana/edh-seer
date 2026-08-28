import { expect, test } from "vitest";
import type { Card } from "@edh-seer/engine";
import { BUILD_PARENTS, detectAnswerClasses, detectBuildCategories } from "./build.js";
import { detectWincons } from "./wincon.js";
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
  expect([...(classes.get("creature")?.cards ?? [])].sort()).toEqual(["Bedevil", "Boomerang", "Fire Bolt"]);
  expect(classes.get("planeswalker")?.cards.has("Bedevil")).toBe(true);
  // "any target" is burn aimed at a player, not removal, and it names no class.
  expect(classes.get("creature")?.cards.has("Lightning Bolt")).toBe(false);
  expect([...(classes.get("enchantment")?.cards ?? [])]).toEqual(["Boomerang"]);
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
test("a self-destroy with no return clause keeps its count, even though it says 'you own'", () => {
  const classes = detectAnswerClasses([
    mk("Staff of Compleation", "{T}, Pay 1 life: Destroy target permanent you own.\n{T}, Pay 2 life: Add one mana of any color.\n{T}, Pay 3 life: Proliferate.\n{T}, Pay 4 life: Draw a card.\n{5}: Untap this artifact.", "Artifact"),
  ]);
  for (const cls of ["creature", "artifact", "enchantment", "planeswalker", "land"]) {
    expect(classes.get(cls)?.cards.has("Staff of Compleation"), cls).toBe(true);
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
  const conditional = mk(
    "Riverpyre Verge",
    "This land enters tapped unless you control a Mountain or an Island.\n{T}: Add {U}{R}.",
    "Land",
  );
  const unconditional = mk("Karoo Gate", "This land enters tapped.\n{T}: Add {G}{W}.", "Land");
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
  const consistency = BUILD_PARENTS.find((p) => p.name === "Consistency")!;
  expect(consistency.leaves).toContain("impulseDraw");
  expect(consistency.leaves).toContain("cardSelection");
});

// I4 (2026-08-25): RAMP IS A NET GAIN. `ramp.effect` matched any mana-generating effect kind with
// no net test, so Manamorphose — two mana for two mana plus a cantrip — read as acceleration.
test("a one-shot mana spell is ramp only when it nets, and a permanent mana source always is", () => {
  const cats = (dc: DeckCard) => [...detectBuildCategories([dc]).keys()];
  const spell = (name: string, oracleText: string, manaValue: number, typeLine = "Instant"): DeckCard => ({
    card: { name, oracleText, typeLine, manaValue } as Card,
    tags: { oracleId: name, schemaVersion: 1, promptVersion: 0, model: "t",
      characteristics: { types: [], subtypes: [], colors: [], identity: [], cmc: manaValue, power: null, toughness: null, token: false, keywords: [] },
      abilities: [{ kind: "on-cast", effect: { kind: "mana-generation" } }] } as never,
  });

  // Dark Ritual nets +2; Manamorphose nets 0 and is the item's named witness.
  expect(cats(spell("Dark Ritual", "Add {B}{B}{B}.", 1, "Instant"))).toContain("ramp");
  expect(cats(spell("Manamorphose", "Add two mana in any combination of colors.\nDraw a card.", 2))).not.toContain("ramp");

  // A RATE IS NOT AN AMOUNT. Jeska's Will adds one {R} per card in an opponent's hand — the most
  // explosive rituals in the format state no fixed number, so unreadable must KEEP the card.
  expect(cats(spell("Jeska's Will", "Add {R} for each card in target opponent's hand.", 3, "Sorcery"))).toContain("ramp");

  // THE MAXIMUM, NOT THE SUM: Cabal Ritual's second sentence says "instead".
  expect(cats(spell("Cabal Ritual", "Add {B}{B}{B}.\nThreshold — Add {B}{B}{B}{B}{B} instead if there are seven or more cards in your graveyard.", 2, "Sorcery"))).toContain("ramp");

  // A PERMANENT MANA SOURCE REPEATS, so it is never net-tested — a dork nets 0 the turn it lands.
  expect(cats(spell("Llanowar Elves", "{T}: Add {G}.", 1, "Creature — Elf Druid"))).toContain("ramp");
  // …including one whose OTHER face is a sorcery. Bramble Familiar // Fetch Quest's `{T}: Add {G}`
  // is a mana dork, and the type-line union carries "Sorcery" from the Adventure half.
  expect(cats(spell("Bramble Familiar // Fetch Quest", "{T}: Add {G}.\n//\nMill seven cards.", 2, "Creature — Elemental Raccoon // Sorcery — Adventure"))).toContain("ramp");
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
