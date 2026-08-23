import { describe, expect, it, test } from "vitest";
import { detectBuildCategories, computeBuild, rampResilience, rolesByCard, doubleDutyRating, DOUBLE_DUTY_MULT } from "./build.js";
import type { DeckCard } from "./types.js";
import type { CardTags } from "@mtg/tagger";

/** Minimal DeckCard: oracleText + typeLine drive the heuristics; abilities drive ramp/draw. */
const mk = (
  name: string,
  oracleText: string,
  typeLine = "Creature",
  abilities: CardTags["abilities"] = [],
): DeckCard => ({
  card: { name, typeLine, oracleText, keywords: [], colors: [], manaValue: 0 } as never,
  tags: {
    oracleId: name, schemaVersion: 1, promptVersion: 1, model: "t",
    characteristics: { types: [typeLine.toLowerCase()], subtypes: [], colors: [], identity: [], cmc: 0, power: null, toughness: null, token: false, keywords: [] },
    abilities,
  },
});

const rampAbility: CardTags["abilities"] = [{ kind: "static", effect: { kind: "mana-generation" } }];
const drawAbility: CardTags["abilities"] = [{ kind: "triggered", trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } }, effect: { kind: "draw-card" } }];

test("ramp/draw come from structured effect kinds; lands (utility only) from typeline", () => {
  const m = detectBuildCategories([
    mk("Sol Ring", "Add {C}{C}.", "Artifact", rampAbility),
    mk("Divination", "Draw two cards.", "Sorcery", drawAbility),
    mk("Forest", "", "Basic Land — Forest"),
    mk("Bojuka Bog", "", "Land"),
  ]);
  expect(m.get("ramp")).toEqual(new Set(["Sol Ring"]));
  expect(m.get("draw")).toEqual(new Set(["Divination"]));
  // A basic never fills the lands ROLE (it's pure infrastructure, never double-duty); a nonbasic
  // utility land does.
  expect(m.get("lands")).toEqual(new Set(["Bojuka Bog"]));
});

test("basic lands do not fill the lands role (only utility lands do)", () => {
  const m = detectBuildCategories([
    mk("Forest", "", "Basic Land — Forest"),
    mk("Snow-Covered Island", "", "Basic Snow Land — Island"),
    mk("Bojuka Bog", "When Bojuka Bog enters, exile target player's graveyard.", "Land"),
  ]);
  expect(m.get("lands")).toEqual(new Set(["Bojuka Bog"]));
});

test("targeted removal is detected from oracle text (Swords/Counterspell gap)", () => {
  const m = detectBuildCategories([
    mk("Swords to Plowshares", "Exile target creature. Its controller gains life equal to its power.", "Instant"),
    mk("Counterspell", "Counter target spell.", "Instant"),
    mk("Beast Within", "Destroy target permanent. Its controller creates a 3/3 green Beast creature token.", "Instant"),
  ]);
  expect(m.get("targetedRemoval")).toEqual(new Set(["Swords to Plowshares", "Beast Within"]));
  expect(m.get("stackInteraction")).toEqual(new Set(["Counterspell"]));
});

test("stack interaction: counters (typed), redirection, and stack-bounce; not plain removal", () => {
  const m = detectBuildCategories([
    mk("Counterspell", "Counter target spell.", "Instant"),
    mk("Essence Scatter", "Counter target creature spell.", "Instant"),
    mk("Deflecting Swat", "You may change the target of target spell or ability.", "Instant"),
    mk("Narset Reversal", "Return target instant or sorcery spell to its owner's hand. You may copy that spell.", "Instant"),
    mk("Swords to Plowshares", "Exile target creature. Its controller gains life equal to its power.", "Instant"),
  ]);
  expect(m.get("stackInteraction")).toEqual(new Set(["Counterspell", "Essence Scatter", "Deflecting Swat", "Narset Reversal"]));
});

test("counters are no longer counted as targeted removal", () => {
  const m = detectBuildCategories([mk("Counterspell", "Counter target spell.", "Instant")]);
  expect(m.get("targetedRemoval") ?? new Set()).not.toContain("Counterspell");
});

test("board wipe is distinguished from targeted removal (wipe wins, not double-counted)", () => {
  const m = detectBuildCategories([
    mk("Wrath of God", "Destroy all creatures. They can't be regenerated.", "Sorcery"),
  ]);
  expect(m.get("boardWipe")).toEqual(new Set(["Wrath of God"]));
  expect(m.get("targetedRemoval")?.has("Wrath of God")).toBeFalsy();
});

test("protection is detected; a land-fetch is ramp not a tutor", () => {
  const m = detectBuildCategories([
    mk("Heroic Intervention", "Permanents you control gain hexproof and indestructible until end of turn.", "Instant"),
    mk("Rampant Growth", "Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.", "Sorcery"),
    mk("Demonic Tutor", "Search your library for a card, put that card into your hand, then shuffle.", "Sorcery"),
  ]);
  expect(m.get("protection")).toEqual(new Set(["Heroic Intervention"]));
  expect(m.get("tutor")).toEqual(new Set(["Demonic Tutor"]));
  expect(m.get("tutor")?.has("Rampant Growth")).toBeFalsy();
});

// 10 ramp + 10 draw + 10 removal + 3 wipes + 36 lands = a "complete" goodstuff shell.
const completeShell = (): DeckCard[] => {
  const cards: DeckCard[] = [];
  for (let i = 0; i < 10; i++) cards.push(mk(`Rock ${i}`, "Add {C}.", "Artifact", rampAbility));
  for (let i = 0; i < 10; i++) cards.push(mk(`Draw ${i}`, "Draw a card.", "Sorcery", drawAbility));
  for (let i = 0; i < 4; i++) cards.push(mk(`Scry ${i}`, "Scry 2.", "Sorcery"));
  // TASK 3: spread across all five answer classes so this shell also hits full COVERAGE, not just
  // full count -- ten creature-only kill spells would now cap Interaction below its target.
  for (let i = 0; i < 6; i++) cards.push(mk(`Kill ${i}`, "Destroy target creature.", "Instant"));
  cards.push(mk("Wipe Art", "Destroy target artifact.", "Instant"));
  cards.push(mk("Wipe Ench", "Destroy target enchantment.", "Instant"));
  cards.push(mk("Wipe Walker", "Destroy target planeswalker.", "Instant"));
  cards.push(mk("Wipe Land", "Destroy target land.", "Instant"));
  for (let i = 0; i < 3; i++) cards.push(mk(`Wipe ${i}`, "Destroy all creatures.", "Sorcery"));
  for (let i = 0; i < 36; i++) cards.push(mk(`Land ${i}`, "", "Basic Land — Forest"));
  return cards;
};

test("a complete goodstuff shell scores exactly 5 (every parent, and lands, exactly at target)", () => {
  // 10 ramp = Ramp 10/10, 10 draw + 4 scry = Consistency 14/14, 10 kill spread across all five
  // answer classes = Interaction 10/10 count AND coverage 1.0 (task 3), 3 wipes = Board wipes
  // 3/3, 36 lands on the nose -- every scored parent attains 1.0, so the weighted mean is 5
  // exactly rather than merely "near" it.
  const { buildScore } = computeBuild(completeShell(), "goodstuff");
  expect(buildScore).toBeCloseTo(5, 5);
});

test("an empty pile scores near 0 and suggests the big gaps", () => {
  const { buildScore, suggestions } = computeBuild([mk("Lonely", "Vanilla.", "Creature")], "goodstuff");
  expect(buildScore).toBeLessThan(1);
  expect(suggestions.length).toBeGreaterThan(0);
  expect(suggestions.some((s) => /Ramp 0\/10/.test(s))).toBe(true);
});

// RETARGETED for Task 7: `boardWipe` and `protection` no longer carry a target of their own --
// the archetype delta named on each now reaches the PARENT that owns it (`Board wipes` is
// boardWipe's own single-leaf parent and moves unchanged in meaning; `protection` lives inside the
// multi-leaf `Interaction` parent, so its delta widens the whole group). See build.ts's
// ARCHETYPE_TARGET_DELTAS doc comment for the full reasoning and which archetypes this affects.
test("archetype deltas shift PARENT targets: Voltron wants fewer wipes, more interaction", () => {
  const cards = [mk("Shield", "Permanents you control gain indestructible.", "Instant")];
  const voltron = computeBuild(cards, "voltron").buildParents;
  const goodstuff = computeBuild(cards, "goodstuff").buildParents;
  const t = (ps: typeof voltron, name: string) => ps.find((p) => p.name === name)!.target;
  expect(t(voltron, "Board wipes")).toBeLessThan(t(goodstuff, "Board wipes"));
  expect(t(voltron, "Interaction")).toBeGreaterThan(t(goodstuff, "Interaction"));
});

test("a grouped leaf never carries a target of its own, whatever the archetype", () => {
  // Voltron deltas BOTH boardWipe and protection -- the two leaves most likely to leak a stray
  // target back onto the leaf row if the redirection to the parent were wrong.
  const cards = [mk("Shield", "Permanents you control gain indestructible.", "Instant")];
  const { buildCategories } = computeBuild(cards, "voltron");
  for (const c of buildCategories) {
    if (c.category === "lands") continue; // the one leaf that still scores on its own band
    expect(c.target).toBe(0);
  }
});

test("a parent's count is the UNION of its leaves, not the sum -- a card carrying two leaves counts once", () => {
  // "Scry 2, then draw a card" with a structured draw-card ability hits BOTH cardSelection.text
  // (the oracle "scry" pattern) and draw.effect (the effectKind) -- the Grave Researcher shape the
  // brief names. Summing the two leaf sets would read Consistency as 3 (2 + 1); the deck only runs
  // 2 distinct cards.
  const cards = [
    mk("Grave Researcher", "Scry 2, then draw a card.", "Sorcery", drawAbility),
    mk("Divination", "Draw two cards.", "Sorcery", drawAbility),
  ];
  const members = detectBuildCategories(cards);
  expect(members.get("draw")).toEqual(new Set(["Grave Researcher", "Divination"]));
  expect(members.get("cardSelection")).toEqual(new Set(["Grave Researcher"]));

  const { buildParents } = computeBuild(cards, undefined);
  const consistency = buildParents.find((p) => p.name === "Consistency")!;
  expect(consistency.count).toBe(2);
});

test("buildScore is computed from PARENT attainment: any leaf inside a parent can carry its whole floor", () => {
  // 14 tutors and nothing else meets Consistency's target of 14 outright -- under the retired
  // leaf-scored shape this would have scored ZERO (draw's own target was 10, unmet; tutor's own
  // target was always 0 and excluded), because no single leaf floor could ever be satisfied by a
  // different leaf. That is exactly the shape the owner's ruling retires.
  //
  // EXPECTED buildScore, by hand from computeBuild's formula (no archetype -> no deltas, so every
  // BUILD_PARENTS target and BASE_TARGETS.lands=36 apply unmodified). Only Consistency has any
  // count; the other three parents and lands sit at 0:
  //   Consistency  count 14, target 14, weight 1   -> attainment min(14/14,1) = 1
  //   Ramp         count 0,  target 10, weight 1   -> attainment min(0/10,1)  = 0
  //   Interaction  count 0,  target 10, weight 1   -> attainment min(0/10,1)  = 0
  //   Board wipes  count 0,  target 3,  weight 0.5 -> attainment min(0/3,1)   = 0
  //   Lands        count 0,  target 36 -> |0-36|=36, over the +/-3 band by 33, /9 falloff = 3.667,
  //                clamped to 0 attainment, weight 1 (LANDS_WEIGHT)
  //   weightSum  = 1 + 1 + 1 + 0.5 + 1 = 4.5
  //   attainSum  = 1*1 + 1*0 + 1*0 + 0.5*0 + 1*0 = 1
  //   buildScore = (attainSum / weightSum) * 5 = (1 / 4.5) * 5 = 10/9 ~= 1.1111
  const tutors = Array.from({ length: 14 }, (_, i) =>
    mk(`Tutor ${i}`, "Search your library for a card, put that card into your hand, then shuffle.", "Sorcery"));
  const { buildParents, buildScore } = computeBuild(tutors, undefined);
  const consistency = buildParents.find((p) => p.name === "Consistency")!;
  expect(consistency.count).toBe(14);
  expect(consistency.target).toBe(14);
  expect(buildScore).toBeCloseTo(10 / 9, 5);
});

// F3 (controller review, 2026-08-21): the old "a zero-target category is neutral" test asserted
// /Protection|Tutor/i never appears in `suggestions` -- but `buildSuggestions` (build.ts) iterates
// `parents` exclusively and builds its text from `p.name`, so a LEAF name (Protection, Tutor, or
// any other) can never appear in a suggestion for ANY reason, target zero or not. The assertion
// passed for a fact unrelated to zero-target handling and could not have failed short of a parent
// itself being renamed "Protection" or "Tutor". Deleted rather than retargeted: the property it
// meant to guard -- a leaf with no floor of its own doesn't drag its parent down or get flagged on
// its own -- is already pinned by "a grouped leaf never carries a target of its own" above (leaf
// `target` is always 0) and by this file's PARENT-attainment test above (a zero-floor leaf can
// still carry its whole parent's floor). The complementary case a retarget would actually need --
// a PARENT whose own target reaches 0 -- is unreachable through `ARCHETYPE_TARGET_DELTAS` today
// (no delta zeroes Board wipes' floor of 3) and re-cutting those deltas is the owner's call, not
// this fix round's; see `packages/web/client/src/components/components.test.tsx` (F2, the
// zero-target-parent BuildBenchmarks fixture) for that case covered directly at the rendering layer.

test("land count is two-sided: heavy flood is flagged, not rewarded", () => {
  const flood = completeShell().concat(Array.from({ length: 12 }, (_, i) => mk(`Extra Land ${i}`, "", "Land")));
  const { suggestions } = computeBuild(flood, "goodstuff"); // 48 lands
  expect(suggestions.some((s) => /Lands 48/.test(s))).toBe(true);
});

test("lands counts copies, not distinct names (basics don't collapse to 1)", () => {
  const deck = Array.from({ length: 24 }, () => mk("Swamp", "", "Basic Land — Swamp"))
    .concat([mk("Sol Ring", "Add {C}{C}.", "Artifact", rampAbility)]);
  const { buildCategories, suggestions } = computeBuild(deck, "goodstuff");
  const lands = buildCategories.find((c) => c.category === "lands")!;
  expect(lands.count).toBe(24);
  expect(suggestions.some((s) => /Lands 1 —/.test(s))).toBe(false);
});

// TASK 9 (owner, 2026-08-21): `computeBuild`'s third argument is `land-count.ts`'s own rounded
// Karsten target, threaded in from `analyze.ts` rather than recomputed here -- these tests exercise
// `gatedLandsTarget`'s decision directly through `computeBuild`, which is where the score is made.
test("computeBuild scores the derived land target when it falls inside the regression's tested range", () => {
  const { buildCategories, landsTargetSource } = computeBuild([], undefined, 34); // inside [28, 39]
  expect(landsTargetSource).toBe("derived");
  expect(buildCategories.find((c) => c.category === "lands")!.target).toBe(34);
});

test("computeBuild falls back to the flat convention when the derived target extrapolates past the tested range", () => {
  // 50: izzet-big-mana's own witness in the task brief (avgManaValue 5.98 -> 50 lands in a 99-card
  // deck), well past the top published arm (39).
  const { buildCategories, landsTargetSource } = computeBuild([], undefined, 50);
  expect(landsTargetSource).toBe("flat");
  expect(buildCategories.find((c) => c.category === "lands")!.target).toBe(36); // BASE_TARGETS.lands
});

test("computeBuild falls back when no derived target is supplied at all", () => {
  const { landsTargetSource } = computeBuild([], undefined);
  expect(landsTargetSource).toBe("flat");
});

test("the tested range's boundary values, 28 and 39, are INSIDE it -- not fencepost exclusions", () => {
  expect(computeBuild([], undefined, 28).landsTargetSource).toBe("derived"); // lower published arm
  expect(computeBuild([], undefined, 39).landsTargetSource).toBe("derived"); // upper published arm
  expect(computeBuild([], undefined, 27).landsTargetSource).toBe("flat"); // one below the floor
  expect(computeBuild([], undefined, 40).landsTargetSource).toBe("flat"); // one above the ceiling
});

test("landfall's +4 delta still applies on top of a DERIVED land target, not only the flat one", () => {
  // The regression reads castability (curve, ramp, fast mana); it has no term for how often a
  // landfall payoff wants to see a land drop, so the delta is not double-counting a fact the
  // regression can already see -- see adjustedTargets's doc comment for the full argument.
  const derived = computeBuild([], undefined, 34).buildCategories.find((c) => c.category === "lands")!.target;
  const landfall = computeBuild([], "landfall", 34).buildCategories.find((c) => c.category === "lands")!.target;
  expect(derived).toBe(34);
  expect(landfall).toBe(38);
});

test("rolesByCard inverts category membership into per-card role lists", () => {
  const members = new Map<import("./build.js").BuildCategory, Set<string>>([
    ["ramp", new Set(["Sol Ring", "Llanowar Elves"])],
    ["draw", new Set(["Sol Ring"])], // a card in two categories
  ]);
  const roles = rolesByCard(members);
  expect(new Set(roles.get("Sol Ring"))).toEqual(new Set(["ramp", "draw"]));
  expect(roles.get("Llanowar Elves")).toEqual(["ramp"]);
  expect(roles.get("Nonexistent")).toBeUndefined();
});

test("doubleDutyRating applies a bounded premium capped at 5", () => {
  expect(doubleDutyRating(3)).toBeCloseTo(3 * DOUBLE_DUTY_MULT);
  expect(doubleDutyRating(4.5)).toBe(5); // capped, never dwarfs the scale
  expect(doubleDutyRating(0)).toBe(0);
});

test("land-ramp spells (search a land onto the battlefield) count as ramp", () => {
  const m = detectBuildCategories([
    mk("Cultivate", "Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.", "Sorcery"),
    mk("Farseek", "Search your library for a Plains, Island, Swamp, or Mountain card, put it onto the battlefield tapped, then shuffle.", "Sorcery"),
    mk("Rampant Growth", "Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.", "Sorcery"),
  ]);
  expect(m.get("ramp")).toEqual(new Set(["Cultivate", "Farseek", "Rampant Growth"]));
});

test("ramp-lands that sacrifice for two lands are ramp; fetchlands are not", () => {
  const m = detectBuildCategories([
    mk("Myriad Landscape", "Myriad Landscape enters tapped. {T}: Add {C}. {2}, {T}, Sacrifice Myriad Landscape: Search your library for up to two basic land cards with the same name, put them onto the battlefield tapped, then shuffle.", "Land"),
    mk("Krosan Verge", "Krosan Verge enters tapped. {T}, Sacrifice Krosan Verge: Search your library for a Forest and a Plains card, put them onto the battlefield tapped, then shuffle.", "Land"),
    mk("Arid Mesa", "{T}, Pay 1 life, Sacrifice Arid Mesa: Search your library for a Mountain or Plains card, put it onto the battlefield, then shuffle.", "Land"),
  ]);
  expect(m.get("ramp")).toEqual(new Set(["Myriad Landscape", "Krosan Verge"]));
});

test("treasure makers count as ramp", () => {
  const m = detectBuildCategories([
    mk("Big Score", "Create three Treasure tokens. Draw two cards.", "Instant"),
    mk("Unexpected Windfall", "Draw two cards, then discard a card. Create two Treasure tokens.", "Instant"),
  ]);
  expect(m.get("ramp")).toEqual(new Set(["Big Score", "Unexpected Windfall"]));
});

test("mana-sac token makers (Eldrazi Spawn/Scion, Gold) count as ramp, like Treasure", () => {
  const m = detectBuildCategories([
    mk("Glimpse the Impossible", "Exile the top three cards of your library. You may play those cards this turn. At the beginning of the next end step, if any of those cards remain exiled, put them into your graveyard, then create a 0/1 colorless Eldrazi Spawn creature token for each of them.", "Sorcery"),
    mk("Sacrifice the Wastes", "As an additional cost to cast this spell, sacrifice a creature. Create three Gold tokens.", "Sorcery"),
  ]);
  expect(m.get("ramp")).toEqual(new Set(["Glimpse the Impossible", "Sacrifice the Wastes"]));
});

test("card selection (scry/surveil/impulse) is detected; plain draw is not selection", () => {
  const m = detectBuildCategories([
    mk("Preordain", "Scry 2, then draw a card.", "Sorcery"),
    mk("Sink Below", "Surveil 2. Draw a card.", "Instant"),
    mk("Light Up the Stage", "Exile the top two cards of your library. Until the end of your next turn, you may play those cards.", "Sorcery"),
    mk("Divination", "Draw two cards.", "Sorcery"),
  ]);
  expect(m.get("cardSelection")).toEqual(new Set(["Preordain", "Sink Below", "Light Up the Stage"]));
});

test("burn & drain: damage/life-loss to players (not creatures, not self)", () => {
  const m = detectBuildCategories([
    mk("Lightning Helix", "Lightning Helix deals 3 damage to any target and you gain 3 life.", "Instant"),
    mk("Exsanguinate", "Each opponent loses X life. You gain life equal to the life lost this way.", "Sorcery"),
    mk("Lightning Bolt", "Lightning Bolt deals 3 damage to any target.", "Instant"),
    mk("Flame Slash", "Flame Slash deals 4 damage to target creature.", "Sorcery"),
    mk("Sign in Blood", "Target player draws two cards and loses 2 life.", "Sorcery"),
  ]);
  // Lightning Bolt/Helix hit "any target"; Exsanguinate is opponent life-loss.
  expect(m.get("burn")).toEqual(new Set(["Lightning Helix", "Exsanguinate", "Lightning Bolt"]));
  // Flame Slash is creature-only damage → removal, not burn.
  expect(m.get("burn") ?? new Set()).not.toContain("Flame Slash");
});

test("damage-to-creature is targeted removal; graveyard-hate exile is not removal", () => {
  const m = detectBuildCategories([
    mk("Flame Slash", "Flame Slash deals 4 damage to target creature.", "Sorcery"),
    mk("Release to Memory", "Exile target opponent's graveyard. For each creature card exiled this way, create a 1/1 colorless Spirit creature token.", "Instant"),
  ]);
  expect(m.get("targetedRemoval")).toContain("Flame Slash");
  expect(m.get("targetedRemoval") ?? new Set()).not.toContain("Release to Memory");
});

test("removal with unrelated later graveyard text is still removal (no over-suppression)", () => {
  const m = detectBuildCategories([
    mk("Gaze of Justice", "Exile target creature. Flashback {W}{W} (You may cast this card from your graveyard for its flashback cost. Then exile it.)", "Sorcery"),
    mk("Elspeth Conquers Death", "Exile target permanent an opponent controls with mana value 3 or greater. Return target creature or planeswalker card from your graveyard to the battlefield.", "Enchantment"),
  ]);
  expect(m.get("targetedRemoval")).toContain("Gaze of Justice");
  expect(m.get("targetedRemoval")).toContain("Elspeth Conquers Death");
});

test("stax: untap denial and tax effects are detected", () => {
  const m = detectBuildCategories([
    mk("Winter Orb", "Lands don't untap during their controllers' untap steps.", "Artifact"),
    mk("Thalia, Guardian of Thraben", "First strike. Noncreature spells cost {1} more to cast.", "Creature"),
    mk("Divination", "Draw two cards.", "Sorcery"),
  ]);
  expect(m.get("stax")).toEqual(new Set(["Winter Orb", "Thalia, Guardian of Thraben"]));
});

test("edict/destroy (forced-sacrifice effect kind) is NOT stax", () => {
  const m = detectBuildCategories([
    mk("Generous Gift", "Destroy target permanent. Its controller creates a 3/3 green Elephant creature token.", "Instant",
       [{ kind: "triggered", effect: { kind: "forced-sacrifice" } } as any]),
    mk("Winter Orb", "Lands don't untap during their controllers' untap steps.", "Artifact"),
  ]);
  expect(m.get("stax") ?? new Set()).not.toContain("Generous Gift"); // forced-sacrifice no longer a stax signal
  expect(m.get("stax")).toContain("Winter Orb"); // real stax still detected
});

test("redirection via 'choose new targets for' is stack interaction (Deflecting Swat)", () => {
  const m = detectBuildCategories([
    mk("Deflecting Swat", "If you control a commander, you may cast this spell without paying its mana cost. You may choose new targets for target spell or ability.", "Instant"),
  ]);
  expect(m.get("stackInteraction")).toContain("Deflecting Swat");
});

test("removal regex tolerates words between verb and target", () => {
  const m = detectBuildCategories([
    mk("Solitude", "When this creature enters, exile up to one other target creature. That creature's controller gains life equal to its power.", "Creature"),
    mk("Shambling Ghast", "When this creature dies, choose one — Target creature an opponent controls gets -1/-1 until end of turn.", "Creature"),
    mk("Yawgmoth", "Pay 1 life, Sacrifice another creature: Put a -1/-1 counter on up to one target creature and draw a card.", "Creature"),
  ]);
  expect(m.get("targetedRemoval")).toEqual(new Set(["Solitude", "Shambling Ghast", "Yawgmoth"]));
});

test("loosened damage removal catches qualified creature targets; any-target stays out", () => {
  const m = detectBuildCategories([
    mk("Eiganjo Bolt", "It deals 4 damage to target attacking or blocking creature.", "Instant"),
    mk("Pinger", "This creature deals 1 damage to any target.", "Creature"),
  ]);
  expect(m.get("targetedRemoval")).toContain("Eiganjo Bolt");
  expect(m.get("targetedRemoval") ?? new Set()).not.toContain("Pinger");
});

test("land-based removal is detected (channel/activated); graveyard-exile land is not", () => {
  const m = detectBuildCategories([
    mk("Eiganjo, Seat of the Empire", "{T}: Add {W}. Channel — {2}{W}, Discard this card: It deals 4 damage to target attacking or blocking creature.", "Legendary Land"),
    mk("Bojuka Land", "{T}: Add {B}. {1}, {T}, Sacrifice this land: Exile target player's graveyard.", "Land"),
  ]);
  expect(m.get("targetedRemoval")).toContain("Eiganjo, Seat of the Empire");
  expect(m.get("targetedRemoval") ?? new Set()).not.toContain("Bojuka Land");
});

test("verb->target does not bridge a period or an unrelated same-sentence clause", () => {
  const m = detectBuildCategories([
    mk("Cross-period", "Exile this creature. Draw a card, then target player loses 1 life.", "Instant"),
    mk("Same-sentence food", "Destroy a Food you control, then target opponent loses 2 life.", "Sorcery"),
  ]);
  expect(m.get("targetedRemoval") ?? new Set()).not.toContain("Cross-period");
  expect(m.get("targetedRemoval") ?? new Set()).not.toContain("Same-sentence food");
});

test("target-creature-then--1/-1-counter order is removal", () => {
  const m = detectBuildCategories([
    mk("Reverse Counter", "Put target creature you don't control gets a -1/-1 counter.", "Instant"),
  ]);
  expect(m.get("targetedRemoval")).toContain("Reverse Counter");
});

test("counters with a comma-separated type list are stack interaction", () => {
  const m = detectBuildCategories([
    mk("Swan Song", "Counter target enchantment, instant, or sorcery spell. Its controller creates a 2/2 blue Bird creature token with flying.", "Instant"),
    mk("Strix Serenade", "Counter target artifact, creature, or planeswalker spell. Its controller creates a 2/2 blue Bird creature token with flying.", "Instant"),
  ]);
  expect(m.get("stackInteraction")).toEqual(new Set(["Swan Song", "Strix Serenade"]));
});

test("a +1/+1 counter placer is not a counterspell (counter clause needs 'counter target ... spell/ability')", () => {
  const m = detectBuildCategories([
    mk("Counter Placer", "Put a +1/+1 counter on target creature. Whenever you cast a noncreature spell, draw a card.", "Enchantment"),
  ]);
  expect(m.get("stackInteraction") ?? new Set()).not.toContain("Counter Placer");
});

test("exile-a-spell pseudo-counters are stack interaction; exile-a-creature (removal) is not", () => {
  const m = detectBuildCategories([
    mk("Aven Interrupter", "Flash Flying When this creature enters, exile target spell. It becomes plotted.", "Creature"),
    mk("Swords to Plowshares", "Exile target creature. Its controller gains life equal to its power.", "Instant"),
  ]);
  expect(m.get("stackInteraction")).toContain("Aven Interrupter");
  expect(m.get("stackInteraction") ?? new Set()).not.toContain("Swords to Plowshares");
});

test("a land producing two mana from one tap fills the ramp role", () => {
  const members = detectBuildCategories([
    mk("Ancient Tomb", "{T}: Add {C}{C}. Ancient Tomb deals 2 damage to you.", "Land"),
  ]);
  expect(members.get("ramp")).toEqual(new Set(["Ancient Tomb"]));
});

test("a land that enters tapped is not ramp, even producing three mana of one color (Lotus Field)", () => {
  const members = detectBuildCategories([
    mk("Lotus Field", "Lotus Field enters tapped. {T}: Add three mana of any one color.", "Land"),
  ]);
  expect(members.get("ramp")).toBeUndefined();
});

test("a basic land does not fill the ramp role", () => {
  const members = detectBuildCategories([mk("Island", "({T}: Add {U}.)", "Basic Land — Island")]);
  expect(members.get("ramp")).toBeUndefined();
});

test("a filter land does not fill the ramp role -- it costs mana to use", () => {
  const members = detectBuildCategories([
    mk("Cascade Bluffs", "{T}: Add {C}. {U/R}, {T}: Add {U}{U}, {U}{R}, or {R}{R}.", "Land"),
  ]);
  expect(members.get("ramp")).toBeUndefined();
});

test("the Karoo/bounce-land cycle is not ramp -- it enters tapped, unusable the turn it lands", () => {
  const members = detectBuildCategories([
    mk(
      "Boros Garrison",
      "Boros Garrison enters tapped. When Boros Garrison enters, return a land you control to its owner's hand. {T}: Add {R}{W}.",
      "Land",
    ),
  ]);
  expect(members.get("ramp")).toBeUndefined();
});

test("Temple of the False God (untapped, taps for two) is still ramp", () => {
  const members = detectBuildCategories([
    mk("Temple of the False God", "{T}: Add {C}{C}. Activate only if you control five or more lands.", "Land"),
  ]);
  expect(members.get("ramp")).toEqual(new Set(["Temple of the False God"]));
});

test("the sacrifice-to-fetch-two ramp land still fills the ramp role", () => {
  const members = detectBuildCategories([
    mk(
      "Myriad Landscape",
      "Myriad Landscape enters tapped. {T}: Add {C}. {2}, {T}, Sacrifice Myriad Landscape: Search your library for up to two basic land cards with the same name, put them onto the battlefield tapped, then shuffle.",
      "Land",
    ),
  ]);
  expect(members.get("ramp")).toEqual(new Set(["Myriad Landscape"]));
});

describe("Interaction scores coverage x count", () => {
  // Two decks with the SAME number of interaction cards, one of which answers only creatures.
  const removal = (name: string, text: string) => ({
    card: { name, typeLine: "Instant", oracleText: text, keywords: [], colors: ["B"], colorIdentity: ["B"], manaValue: 2, power: null, toughness: null },
    tags: null,
  }) as never;

  const narrow = Array.from({ length: 10 }, (_, i) => removal(`Kill ${i}`, "Destroy target creature."));
  const broad = [
    ...Array.from({ length: 6 }, (_, i) => removal(`Kill ${i}`, "Destroy target creature.")),
    removal("Wipe Art", "Destroy target artifact."),
    removal("Wipe Ench", "Destroy target enchantment."),
    removal("Wipe Walker", "Destroy target planeswalker."),
    removal("Wipe Land", "Destroy target land."),
  ];

  it("rates the broad deck above the narrow one at the same card count", () => {
    const a = computeBuild(narrow, undefined, undefined, ["B"], 0);
    const b = computeBuild(broad, undefined, undefined, ["B"], 0);
    expect(b.answerCoverage.coverage).toBeGreaterThan(a.answerCoverage.coverage);
    expect(b.buildScore).toBeGreaterThan(a.buildScore);
  });

  it("reports the coverage it scored with, so a reader can check the number", () => {
    const r = computeBuild(broad, undefined, undefined, ["B"], 0);
    expect(r.answerCoverage.source).toBe("weighted");
    expect(r.answerCoverage.rows).toHaveLength(5);
  });

  it("falls back to unweighted when no identity is supplied, and never crashes an existing caller", () => {
    const r = computeBuild(broad, undefined);
    expect(r.answerCoverage.source).toBe("unweighted");
    expect(Number.isFinite(r.buildScore)).toBe(true);
  });

  it("multiplies rather than replaces -- full coverage on two cards is still a thin deck", () => {
    const thin = [
      removal("A", "Destroy target creature."), removal("B2", "Destroy target artifact."),
      removal("C", "Destroy target enchantment."), removal("D", "Destroy target planeswalker."),
      removal("E", "Destroy target land."),
    ];
    const r = computeBuild(thin, undefined, undefined, ["B"], 0);
    expect(r.answerCoverage.coverage).toBeCloseTo(1, 6);
    const interaction = r.buildParents.find((p) => p.name === "Interaction")!;
    expect(interaction.count).toBeLessThan(interaction.target);
  });
});

test("a gap names a cost BAND, and a land gap does not", () => {
  // F14: the shape half of "what should I add?". A BAND, never a point -- the modal mana value is
  // only 25-42% of the cards in every leaf, so "add a two-mana rock" would be wrong about two
  // thirds of the time, which is the `thinnest: tutors` defect one rung along.
  const { suggestions } = computeBuild([mk("Lonely", "Vanilla.", "Creature")], "goodstuff");
  const ramp = suggestions.find((s) => /^Ramp /.test(s));
  expect(ramp).toMatch(/typically 2–3 mana/);
  // Every parent gap carries one, whichever four the gap ranking happens to surface.
  for (const gap of suggestions.filter((s) => !/^Lands /.test(s))) expect(gap).toMatch(/typically \d–\d mana/);
  // A LAND IS MANA VALUE 0, so its gap gets no band -- the number would be nonsense.
  const flood = Array.from({ length: 48 }, (_, i) => mk(`Land ${i}`, "", "Land"));
  const landGap = computeBuild(flood, "goodstuff").suggestions.find((s) => /^Lands /.test(s));
  expect(landGap).toBeDefined();
  expect(landGap).not.toMatch(/typically/);
});

describe("rampResilience", () => {
  // Answer-pool ordering: creature 1,839 answers · artifact 755 · land 306. A tier is only worth
  // separating because those three numbers differ.
  const dork = mk("Llanowar Elves", "{T}: Add {G}.", "Creature — Elf Druid", rampAbility);
  const rock = mk("Sol Ring", "Add {C}{C}.", "Artifact", rampAbility);
  const fetchSpell = mk("Cultivate", "Search your library for up to two basic land cards, reveal them, put one onto the battlefield tapped and the other into your hand.", "Sorcery");

  it("splits the package three ways", () => {
    const r = rampResilience([dork, rock, fetchSpell]);
    expect(r).toMatchObject({ land: 1, rock: 1, dork: 1 });
    expect(r.landShare).toBeCloseTo(1 / 3);
  });

  it("a creature that FETCHES a land is land-shaped, not a dork", () => {
    // Solemn Simulacrum is the whole reason land wins the tie: it dies to every board wipe and the
    // land it fetched is still on the battlefield afterwards. What survives is the mana, not the
    // body that bought it. This case matches only `ramp.landFetchSpell`, so it pins the TYPE-LINE
    // rule (a creature in the land tier is not demoted to dork) and NOT the tier precedence --
    // reordering RAMP_TIERS leaves it green. The Wood Elves case below is the one that fires on
    // precedence, verified by actually reordering the table.
    const solemn = mk(
      "Solemn Simulacrum",
      "When this creature enters, you may search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.",
      "Artifact Creature — Golem",
    );
    expect(rampResilience([solemn])).toMatchObject({ land: 1, rock: 0, dork: 0 });
  });

  it("counts a card once even when two ramp rules match it", () => {
    // Both `ramp.landFetchSpell` and `ramp.effect` catch this one, so it pins BOTH halves: the total
    // must stay 1, and the resilient tier must be the one that claims it. PROVEN TO FIRE -- putting
    // "rock" first in RAMP_TIERS fails this test and nothing else in the suite.
    const both = mk(
      "Wood Elves",
      "When this creature enters, search your library for a Forest card and put it onto the battlefield.",
      "Creature — Elf Scout",
      rampAbility,
    );
    const r = rampResilience([both]);
    expect(r.land + r.rock + r.dork).toBe(1);
    expect(r.land).toBe(1);
  });

  it("a deck with no ramp has no share rather than a share of zero", () => {
    // 0 would read as "all fragile" for a deck that has nothing to be fragile.
    expect(rampResilience([mk("Grizzly Bears", "", "Creature — Bear")]).landShare).toBeUndefined();
  });
});
