import { expect, test } from "vitest";
import { detectBuildCategories, computeBuild, rolesByCard, doubleDutyRating, DOUBLE_DUTY_MULT } from "./build.js";
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
  for (let i = 0; i < 10; i++) cards.push(mk(`Kill ${i}`, "Destroy target creature.", "Instant"));
  for (let i = 0; i < 3; i++) cards.push(mk(`Wipe ${i}`, "Destroy all creatures.", "Sorcery"));
  for (let i = 0; i < 36; i++) cards.push(mk(`Land ${i}`, "", "Basic Land — Forest"));
  return cards;
};

test("a complete goodstuff shell scores near 5", () => {
  const { buildScore } = computeBuild(completeShell(), "goodstuff");
  expect(buildScore).toBeGreaterThan(4.5);
});

test("an empty pile scores near 0 and suggests the big gaps", () => {
  const { buildScore, suggestions } = computeBuild([mk("Lonely", "Vanilla.", "Creature")], "goodstuff");
  expect(buildScore).toBeLessThan(1);
  expect(suggestions.length).toBeGreaterThan(0);
  expect(suggestions.some((s) => /Ramp 0\/10/.test(s))).toBe(true);
});

test("archetype deltas shift targets: Voltron wants fewer wipes, more protection", () => {
  const cards = [mk("Shield", "Permanents you control gain indestructible.", "Instant")];
  const voltron = computeBuild(cards, "voltron").buildCategories;
  const goodstuff = computeBuild(cards, "goodstuff").buildCategories;
  const t = (c: { category: string; target: number }[], k: string) => c.find((x) => x.category === k)!.target;
  expect(t(voltron, "boardWipe")).toBeLessThan(t(goodstuff, "boardWipe"));
  expect(t(voltron, "protection")).toBeGreaterThan(t(goodstuff, "protection"));
});

test("a zero-target category is neutral: it neither scores nor appears as a gap", () => {
  // goodstuff protection/tutor targets are 0 → a deck with none of them isn't penalized for it.
  const { suggestions } = computeBuild(completeShell(), "goodstuff");
  expect(suggestions.some((s) => /Protection|Tutor/i.test(s))).toBe(false);
});

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
