import { parseGate } from "@edh-seer/tagger/gate";
import { describe, expect, test } from "vitest";
import type { Card } from "@edh-seer/engine";
import { answerWeightOf, BUILD_PARENTS, detectAnswerClasses, detectBuildCategories } from "./build.js";
import { NARROW_WEIGHT } from "./narrow-weight.js";
import { detectWincons } from "./wincon.js";
import { answerClassesOf, loadRules, ownText, ruleMatches, RULES_VERSION, tokenQuotes, type Rule } from "./rules.js";
import type { DeckCard } from "./types.js";
import type { ManaLine } from "@edh-seer/tagger";
import { nonAccelerantRamp } from "./ramp-class.js";
import { FREE_TAP, manaTags, mkLine, ritualLine, tapFor, triggerLine } from "./mana-test-support.js";
import { realAura, realCard } from "./removal-test-support.js";
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
  const card = realCard("Wrath of God");
  expect(ruleMatches({ id: "a", match: [{ op: "rule", id: "boardWipe.text" }] }, card, set)).toBe(true);
  expect(ruleMatches({
    id: "b",
    match: [{ op: "rule", id: "boardWipe.text" }],
    not: [{ op: "rule", id: "boardWipe.text" }],
  }, card, set)).toBe(false);
  expect(ruleMatches({
    id: "c",
    match: [{ op: "anyOf", clauses: [
      { op: "typeLine", contains: "land" },
      { op: "rule", id: "boardWipe.text" },
    ] }],
  }, card, set)).toBe(true);
});

test("a `rule` clause naming no rule throws, as an unknown pattern does", () => {
  expect(() => ruleMatches({ id: "x", match: [{ op: "rule", id: "nope.text" }] }, realCard("Wrath of God"), loadRules())).toThrow(/unknown rule/i);
});

/** The `else if` that used to give wipes precedence over targeted removal is a `not` clause now, so
 *  it needs the same test it had as code. */
test("a board wipe is not also counted as targeted removal", () => {
  const m = detectBuildCategories([realCard("Wrath of God")]);
  expect(m.get("boardWipe")?.has("Wrath of God")).toBe(true);
  expect(m.get("targetedRemoval")?.has("Wrath of God")).toBeUndefined();
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

test("graveyard hate is a category, and it is cards exiled from a graveyard that is not yours (read from derive, #1266)", () => {
  const hate = (names: string[]) => [...(detectBuildCategories(names.map((n) => realCard(n))).get("graveyardHate") ?? new Set())].sort();
  // an opponent's or any graveyard: a targeted exile, a single-graveyard exile, a mass exile
  expect(hate(["Bojuka Bog", "Decompose", "Honor the Fallen"])).toEqual(["Bojuka Bog", "Decompose", "Honor the Fallen"]);
  // the replacement: the card never reaches the graveyard (CR 614.6), opp or any
  expect(hate(["Rest in Peace", "Leyline of the Void", "Dryad Militant", "Valgavoth, Terror Eater", "Dauthi Voidwalker", "Sanctifier en-Vec"]))
    .toEqual(["Dauthi Voidwalker", "Dryad Militant", "Leyline of the Void", "Rest in Peace", "Sanctifier en-Vec", "Valgavoth, Terror Eater"]);
  // YOUR graveyard (delve, a discard exiled, each player's own yard that comes back), the card itself, a spell rider, and a processor are not hate
  expect(hate(["Necropotence", "Dig Through Time", "Mizzix's Mastery", "Living Death", "Adorned Crocodile", "Kess, Dissident Mage", "Mind Raker"])).toEqual([]);
});

test("an exile the VICTIM CHOOSES is no graveyard hate (Carrion Rats, Axebane Ferox: derive marks it victimMay)", () => {
  const set = loadRules();
  const rule = set.rules.find((r) => r.id === "graveyardHate")!;
  const card = realCard("Decompose");
  const abilities = (card.tags!.abilities as unknown as { effect: Record<string, unknown>; emits?: { victimMay?: boolean }[] }[]).map((a) => ({ ...a, emits: a.emits?.map((e) => ({ ...e, victimMay: true })) }));
  expect(ruleMatches(rule, card, set)).toBe(true);
  expect(ruleMatches(rule, { card: card.card, tags: { ...card.tags!, abilities } as never }, set)).toBe(false);
});

/** Static hate says "graveyard" before "exile", which the old exile-first pattern could not see; derive reads the replacement now. */
test("static hate counts, even though it never says exile first", () => {
  const m = detectBuildCategories([realCard("Leyline of the Void")]);
  expect(m.get("graveyardHate")?.has("Leyline of the Void")).toBe(true);
});

test("a spell rider ('if that spell would be put into a graveyard, exile it instead') is not graveyard hate", () => {
  const m = detectBuildCategories([realCard("Kess, Dissident Mage")]);
  expect(m.get("graveyardHate")?.has("Kess, Dissident Mage")).toBeUndefined();
});

test("an own-graveyard graveyard-hate effect cannot match, and a self exile cannot match", () => {
  const set = loadRules();
  const rule = set.rules.find((r) => r.id === "graveyardHate")!;
  const own = realCard("Decompose");
  const ownTags = (own.tags!.abilities as { effect: { kind: string; subject?: Record<string, unknown> }; emits?: { subject: Record<string, unknown> }[] }[]).map((a) => ({
    ...a, effect: a.effect.kind === "graveyard-hate" ? { ...a.effect, subject: { ...a.effect.subject, owner: "you" } } : a.effect,
    emits: a.emits?.map((e) => ({ ...e, subject: { ...e.subject, owner: "you" } })),
  }));
  expect(ruleMatches(rule, { card: own.card, tags: { ...own.tags!, abilities: ownTags } as never }, set)).toBe(false);
  const self = realCard("Decompose");
  const selfTags = (self.tags!.abilities as { effect: { kind: string; subject?: Record<string, unknown> }; emits?: { subject: Record<string, unknown> }[] }[]).map((a) => ({
    ...a, effect: a.effect.kind === "graveyard-hate" ? { ...a.effect, subject: { ...a.effect.subject, self: true } } : a.effect,
    emits: a.emits?.map((e) => ({ ...e, subject: { ...e.subject, self: true } })) }));
  expect(ruleMatches(rule, { card: self.card, tags: { ...self.tags!, abilities: selfTags } as never }, set)).toBe(false);
});

test("answer classes come from the type the removal actually names", () => {
  const classes = detectAnswerClasses([
    realCard("Murder"),
    realCard("Disenchant"),
    realCard("Vindicate"),
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
  expect([...answerClassesOf(realCard("Return to Nature")).keys()].sort()).toEqual(["artifact", "enchantment", "graveyard"]);
  expect([...answerClassesOf(realCard("Hearth Charm")).keys()].sort()).toEqual(["artifact", "creature"]);
});

/** Counting only destroy/exile made a real deck read as 14 removal spells with 3 creature answers.
 *  A burn spell and a bounce spell both answer a creature, and `targetedRemoval` has always counted
 *  them -- the two axes disagreeing about the same card is worse than either reading alone.
 *  Real derived rows (#1266): the answers.damage / bounce rules read what derive wrote, not the printed text. */
test("damage and bounce answer what they aim at", () => {
  const classes = detectAnswerClasses([
    realCard("Lightning Bolt"),
    realCard("Flame Slash"),
    realCard("Broadside Barrage"),
    realCard("Boomerang"),
  ]);
  expect([...(classes.get("creature")?.cards ?? [])].sort()).toEqual(["Boomerang", "Broadside Barrage", "Flame Slash", "Lightning Bolt"]);
  expect([...(classes.get("planeswalker")?.cards ?? [])].sort()).toEqual(["Boomerang", "Broadside Barrage", "Lightning Bolt"]);
  // "Any target" is a creature or a planeswalker as much as a player (owner, 2026-09-26, issue #581:
  // the Krenko deck's creature answers left out its Lightning Bolt). It was ruled burn-only before,
  // which made every red deck's cheapest answer answer nothing. Not an artifact or a land.
  expect(classes.get("artifact")?.cards.has("Lightning Bolt") ?? false).toBe(false);
  expect([...(classes.get("enchantment")?.cards ?? [])]).toEqual(["Boomerang"]);
});

/** Issue #581: naming each answer row's cards showed what the classes missed and what they
 *  over-counted. Each case is one a real deck carried. */
test("tucks, shrinks and plural objects answer; colour hosers answer marked colour-locked; exile costs do not", () => {
  const classes = detectAnswerClasses([
    realCard("Chaos Warp"),
    realCard("Condemn"),
    realCard("Nowhere to Run"),
    realCard("Yawgmoth, Thran Physician"),
    realCard("Curtains' Call"),
    realCard("Pyroblast"),
    mk("Plaza of Heroes", "{3}, {T}, Exile Plaza of Heroes: Target legendary creature gains hexproof and indestructible until end of turn."),
    realCard("Befuddle"),
    realCard("Prodigal Pyromancer"),
  ]);
  const creature = classes.get("creature")?.cards ?? new Set();
  for (const n of ["Chaos Warp", "Condemn", "Nowhere to Run", "Yawgmoth, Thran Physician", "Curtains' Call"]) expect(creature.has(n), n).toBe(true);
  expect(classes.get("land")?.cards.has("Chaos Warp")).toBe(true);
  // Befuddle is "-4/-0": a power-only shrink kills nothing. Prodigal Pyromancer is a 1-damage ping.
  for (const n of ["Plaza of Heroes", "Befuddle", "Prodigal Pyromancer"]) expect(creature.has(n), n).toBe(false);
  // Owner 2026-11-13: a colour hoser counts, marked colour-locked (weighed at NARROW_WEIGHT); it used to be dropped.
  expect(creature.has("Pyroblast")).toBe(true);
  expect(classes.get("enchantment")?.colourLocked.has("Pyroblast")).toBe(true);
});

/** #1266: damage, tuck, shrink, -1/-1 counter and bounce answers are DERIVED. `oracleText: ""` blanks the printed text, so a pass here is the derived rows alone. */
describe("the damage, tuck, shrink, counter and bounce answers read derived data (#1266)", () => {
  const classes = (name: string): string[] => [...answerClassesOf(realCard(name, { oracleText: "" })).keys()].sort();
  const ALL = ["artifact", "creature", "enchantment", "land", "planeswalker"];

  test("the printed patterns are gone, and no answer rule reads the printed text of these six kinds", () => {
    const set = loadRules();
    for (const p of ["damageRemoval", "damageRemovalAny", "tuckRemoval", "shrinkRemoval", "counterShrinkRemoval", "bounceRemoval"]) expect(set.patterns[p], p).toBeUndefined();
    for (const r of set.rules.filter((x) => /^answers\.(damage|tuck|shrink|counterShrink|bounce)/.test(x.id))) {
      expect(JSON.stringify(r.match), r.id).not.toContain('"oracle"');
      expect(r.answerClassFrom, r.id).toBeUndefined();
    }
  });

  test("damage: a named creature or planeswalker at any amount, \"any target\" at 2 or more or X", () => {
    expect(classes("Lightning Bolt")).toEqual(["creature", "planeswalker"]);
    expect(classes("Searing Spear")).toEqual(["creature", "planeswalker"]);
    expect(classes("Shock")).toEqual(["creature", "planeswalker"]);
    expect(classes("Flame Slash")).toEqual(["creature"]);
    expect(classes("Broadside Barrage")).toEqual(["creature", "planeswalker"]);
    // The printed pattern wanted a digit: "X damage to target creature" answered nothing.
    expect(classes("Heat Ray")).toEqual(["creature"]);
    // "any other target" was no key of the class table.
    expect(classes("Bond of Passion")).toEqual(["creature", "planeswalker"]);
    // A 1-damage ping at any target is no answer.
    expect(classes("Prodigal Pyromancer")).toEqual([]);
    // Damage to YOUR creature, and to a target player with a creature sweep beside it, answer nothing.
    for (const n of ["Rile", "Chandra's Flame Wave"]) expect(classes(n), n).toEqual([]);
    // Energy-cost damage derives no effect subject; the targeted damage emit decides.
    expect(classes("Aethertorch Renegade")).toEqual(["creature"]);
    expect(classes("Dynavolt Tower")).toEqual(["creature", "planeswalker"]);
    // A block trigger's ping at the attacker is still a creature answer.
    expect(classes("Elite Javelineer")).toEqual(["creature"]);
  });

  // Owner 2026-11-13: a colour hoser IS a creature answer (Combust), at a weaker weight the follow-up PR gives it.
  test("damage: a colour hoser answers creature on purpose (owner 2026-11-13)", () => {
    expect(classes("Combust")).toEqual(["creature"]);
  });

  // Owner 2026-11-13: damage to "target player or planeswalker" answers planeswalkers (about 170 cards).
  test("damage: \"target player or planeswalker\" answers a planeswalker (Lava Spike, owner 2026-11-13)", () => {
    expect(classes("Lava Spike")).toEqual(["planeswalker"]);
  });

  // Owner 2026-11-13, reversing the colour-hoser part of the 2026-10-27 ruling (#1357): every answer kind counts a colour-locked subject. Real derived rows.
  test("tuck: a colour-locked tuck counts (King Crab, Hunting Drake, Aether Gust)", () => {
    expect(classes("King Crab")).toEqual(["creature"]);
    expect(classes("Hunting Drake")).toEqual(["creature"]);
    expect(classes("Aether Gust")).toEqual(["artifact", "creature", "enchantment", "planeswalker"]);
  });

  test("no answer rule refuses a colour (notColourLocked is not used by any rule; the colour is read as a lock, not refused)", () => {
    for (const r of loadRules().rules.filter((x) => x.answerClass !== undefined)) expect(JSON.stringify(r.match), r.id).not.toContain("notColourLocked");
  });

  test("tuck: shuffle and put-into-library of a permanent of the class, never a graveyard card", () => {
    expect(classes("Chaos Warp")).toEqual(ALL);
    expect(classes("Condemn")).toEqual(["creature"]);
    // The printed pattern wanted "its owner's library" after "put": "owner puts it on their choice of the top or bottom" answered nothing.
    expect(classes("Dire Downdraft")).toEqual(["creature"]);
    expect(classes("Plow Under")).toEqual(["land"]);
    // "target artifact ... card from a graveyard" is recursion, not an answer.
    expect(classes("Keeper of the Cadence")).toEqual([]);
    // "nonenchantment permanent" and "noncreature permanent" name their classes by what they are not.
    expect(classes("Audacious Swap")).toEqual(["artifact", "creature", "land", "planeswalker"]);
    expect(classes("Brutalizer Exarch")).toEqual(["artifact", "enchantment", "land", "planeswalker"]);
    // CEILING: derive reads Lashweed Lurker's "its owner's library" as control `you`.
    expect(classes("Lashweed Lurker")).toEqual([]);
  });

  test("shrink and -1/-1 counters: a creature the card does not control, and a shrink that can kill", () => {
    expect(classes("Nowhere to Run")).toEqual(["creature"]);
    // "Target nonblack creature gets -1/-1": the printed pattern wanted `target creature`.
    expect(classes("Toxic Stench")).toEqual(["creature"]);
    expect(classes("Befuddle")).toEqual([]);
    expect(classes("Yawgmoth, Thran Physician")).toEqual(["creature"]);
    expect(classes("Baleful Ammit")).toEqual([]);
    // The -1/-1 is the TOKEN's ability, not the Exhumer's (#533).
    expect(classes("Skirk Ridge Exhumer")).toEqual([]);
  });

  test("bounce: a permanent on the battlefield, never a card in a graveyard", () => {
    expect(classes("Unsummon")).toEqual(["creature"]);
    expect(classes("Boomerang")).toEqual(ALL);
    // "Return X target creatures": the printed pattern wanted `return target`.
    expect(classes("Aether Tide")).toEqual(["creature"]);
    expect(classes("Revive the Fallen")).toEqual([]);
    // CEILING: derive files an unless-tax bounce with no subject (Crystal Shard). (Seedling Charm's bare Aura is read as an enchantment since Rules 53: see its own test.)
    expect(classes("Crystal Shard")).toEqual([]);
  });

  // "Spell or permanent" derives a type list with no land and `umbrella: "permanent"`: the umbrella is every permanent, a land included (#1266).
  test("bounce: \"target spell or permanent\" answers a land, \"nonland permanent\" does not, and a narrowed permanent does not", () => {
    expect(classes("Venser, Shaper Savant")).toEqual(ALL);
    expect(classes("Jeskai Revelation")).toEqual(expect.arrayContaining(ALL));
    // "nonland permanent" is `notType: [land]`, no umbrella.
    expect(classes("Into the Roil")).toEqual(["artifact", "creature", "enchantment", "planeswalker"]);
    expect(classes("Cyclonic Rift")).toEqual(["artifact", "creature", "enchantment", "planeswalker"]);
    // A land has no colour and no mana value: "red or green" and "mana value 1 or greater" cannot name one.
    expect(classes("Aether Gust")).toEqual(["artifact", "creature", "enchantment", "planeswalker"]);
    expect(classes("Divide by Zero")).toEqual(["artifact", "creature", "enchantment", "planeswalker"]);
  });
});

/** #1266, Rules 51: the destroy and exile answers (`answers.typed.<class>`, `answers.typed.exile.<class>`) are DERIVED. `oracleText: ""` blanks the printed text, so a pass is the derived rows alone. */
describe("the destroy and exile answers read derived data (#1266)", () => {
  const classes = (name: string): string[] => [...answerClassesOf(realCard(name, { oracleText: "" })).keys()].sort();
  const marks = (name: string, cls: string) => answerClassesOf(realCard(name, { oracleText: "" })).get(cls);
  const ALL = ["artifact", "creature", "enchantment", "land", "planeswalker"];

  test("the printed patterns are gone, and no typed answer rule reads the printed text", () => {
    const set = loadRules();
    for (const p of ["typedRemoval", "exileRemoval", "graveyardHate", "exileReturnsToBattlefield", "exileThenReturns"]) expect(set.patterns[p], p).toBeUndefined();
    const typed = set.rules.filter((x) => x.id.startsWith("answers.typed"));
    expect(typed.map((r) => r.id).sort()).toEqual(["creature", "artifact", "enchantment", "planeswalker", "land"].flatMap((c) => [`answers.typed.${c}`, `answers.typed.exile.${c}`]).sort());
    for (const r of typed) {
      expect(JSON.stringify(r.match), r.id).not.toContain('"oracle"');
      expect(r.answerClassFrom, r.id).toBeUndefined();
    }
  });

  test("the class is the type the target names", () => {
    expect(classes("Murder")).toEqual(["creature"]);
    expect(classes("Vindicate")).toEqual(ALL);
    expect(classes("Disenchant")).toEqual(["artifact", "enchantment"]);
    // "noncreature permanent" is not a creature (the printed pattern read the word inside it): Bramblecrush, Woodfall Primus.
    expect(classes("Bramblecrush")).toEqual(["artifact", "enchantment", "land", "planeswalker"]);
    // A basic land type names the land class (owner 2026-11-13): "Destroy target Scarecrow or Plains", "Forest, green enchantment, or green planeswalker".
    expect(classes("Boggart Arsonists")).toEqual(["land"]);
    expect(classes("Nissa's Defeat")).toEqual(["enchantment", "land", "planeswalker"]);
  });

  // Owner 2026-11-13 rulings 1 to 3.
  test("an edict aimed at a player is an answer, and so is a one-sided mass kill at a player (Imperial Edict, Mogg Infestation)", () => {
    expect(classes("Imperial Edict")).toEqual(["creature"]);
    expect(classes("Mogg Infestation")).toEqual(["creature"]);
  });

  test("a land answer is a TARGETED land kill: Boom // Bust is one, the mass kill at a player is stax (Ajani Vengeant, Burning of Xinye)", () => {
    expect(classes("Boom // Bust")).toEqual(["land"]);
    expect(classes("Ajani Vengeant")).not.toContain("land");
    expect(classes("Burning of Xinye")).not.toContain("land");
  });

  test("a pay-or-die destroy is the victim's option, so it is no removal and no answer (#1628: Arcum's Whistle, Winter's Chill); Nettling Imp and Norritt stay counted (NEEDS RULING)", () => {
    const set = loadRules();
    const targeted = set.rules.find((r) => r.id === "removal.targeted")!;
    for (const n of ["Arcum's Whistle", "Winter's Chill"]) {
      const dc = realCard(n);
      expect(ruleMatches(targeted, dc, set), n).toBe(false);
      expect(classes(n), n).toEqual([]);
    }
    for (const n of ["Nettling Imp", "Norritt"]) expect(ruleMatches(targeted, realCard(n), set), n).toBe(true);
  });

  test("Soul Snare answers creatures, not planeswalkers: the planeswalker is the defender (#1629)", () => {
    expect(classes("Soul Snare")).toEqual(["creature"]);
  });

  test("an Aura-only kill answers enchantments at NARROW_WEIGHT, and names no creature (owner 2026-11-13: Devout Harpist, Piety Charm)", () => {
    for (const n of ["Devout Harpist", "Piety Charm"]) {
      // "attached to a creature" names the host, not the target: no creature class.
      expect(classes(n), n).toEqual(["enchantment"]);
      expect(marks(n, "enchantment")?.colourLocked, n).toBe(true);
    }
    expect(marks("Devout Harpist", "enchantment")?.exile).toBe(false);
    const pool = detectAnswerClasses([realCard("Devout Harpist"), realCard("Disenchant")]).get("enchantment")!;
    expect(answerWeightOf(pool, "Devout Harpist")).toBe(NARROW_WEIGHT);
    expect(answerWeightOf(pool, "Disenchant")).toBe(1);
  });

  test("an Aura-only bounce counts the same, and names no creature (owner 2026-11-13: Seedling Charm)", () => {
    // "Return target Aura attached to a creature to its owner's hand": the Aura is the target, the creature is the host.
    expect(classes("Seedling Charm")).toEqual(["enchantment"]);
    expect(marks("Seedling Charm", "enchantment")?.colourLocked).toBe(true);
    const pool = detectAnswerClasses([realCard("Seedling Charm"), realCard("Disenchant")]).get("enchantment")!;
    expect(answerWeightOf(pool, "Seedling Charm")).toBe(NARROW_WEIGHT);
  });

  test("Miracle Worker stays an Aura answer at half weight (owner 2026-11-13)", () => {
    expect(classes("Miracle Worker")).toEqual(["enchantment"]);
    expect(marks("Miracle Worker", "enchantment")?.colourLocked).toBe(true);
    const pool = detectAnswerClasses([realCard("Miracle Worker"), realCard("Disenchant")]).get("enchantment")!;
    expect(answerWeightOf(pool, "Miracle Worker")).toBe(NARROW_WEIGHT);
  });

  test("a card that prints an exile from a graveyard elsewhere still answers what its other mode destroys", () => {
    // The printed `graveyardHate` guard vetoed the WHOLE card: a delve line (Murderous Cut) and a graveyard mode (Cleanup Crew) answered nothing.
    expect(classes("Murderous Cut")).toEqual(["creature"]);
    expect(classes("Cleanup Crew")).toEqual(["artifact", "enchantment", "graveyard"]);
    // ...and the graveyard exile itself is no battlefield answer (Shamble Back, Deathrite Shaman keep their tests above).
  });

  test("the card itself and its own card type are no class: haunt, \"until this enchantment leaves the battlefield\"", () => {
    expect(classes("Absolver Thrull")).toEqual(["enchantment"]);
    expect(classes("Orzhov Euthanist")).toEqual(["creature"]);
    expect(marks("Orzhov Euthanist", "creature")?.exile).toBe(false);
    expect(classes("Stasis Snare")).toEqual(["creature"]);
    expect(classes("Oblivion Ring")).toEqual(["artifact", "creature", "enchantment", "planeswalker"]);
  });

  test("the exile mark: an exile that stays, not a blink, and an \"until\" exile counts", () => {
    for (const n of ["Swords to Plowshares", "Stasis Snare", "Oblivion Ring", "Banisher Priest", "Constable of the Realm", "Parallax Wave", "Lava Coil"]) {
      expect(marks(n, "creature")?.exile ?? marks(n, "artifact")?.exile, n).toBe(true);
    }
    // Blinks: back at the next end step (Flickerwisp, Astral Slide, Long Road Home), a card-wide reading; the class stays (a delayed return keeps its place in the count).
    for (const n of ["Flickerwisp", "Astral Slide", "Long Road Home", "Morningtide's Light"]) {
      const m = answerClassesOf(realCard(n, { oracleText: "" }));
      expect(m.size, n).toBeGreaterThan(0);
      for (const [cls, v] of m) expect(v.exile, `${n} ${cls}`).toBe(false);
    }
    // A destroy never marks.
    expect(marks("Murder", "creature")?.exile).toBe(false);
  });

  // Owner 2026-11-13: a compound noun is narrower than either class. It counts at NARROW_WEIGHT in BOTH classes, the creature and the type it names beside it.
  test("a compound noun answers BOTH classes at NARROW_WEIGHT (Hearth Charm, Chandler, Molten Frame: artifact creature)", () => {
    for (const n of ["Hearth Charm", "Chandler", "Molten Frame"]) {
      expect(classes(n), n).toEqual(["artifact", "creature"]);
      for (const cls of ["artifact", "creature"]) expect(marks(n, cls)?.colourLocked, `${n} ${cls}`).toBe(true);
    }
    const pool = detectAnswerClasses([realCard("Hearth Charm"), realCard("Murder"), realCard("Disenchant")]);
    expect(answerWeightOf(pool.get("creature")!, "Hearth Charm")).toBe(NARROW_WEIGHT);
    expect(answerWeightOf(pool.get("artifact")!, "Hearth Charm")).toBe(NARROW_WEIGHT);
    expect(answerWeightOf(pool.get("creature")!, "Murder")).toBe(1);
  });

  test("an enchantment creature and a land creature are narrow in both classes (Leonin Iconoclast, Feast of Dreams, Consuming Sinkhole)", () => {
    for (const n of ["Leonin Iconoclast", "Feast of Dreams"]) {
      expect(classes(n), n).toEqual(["creature", "enchantment"]);
      for (const cls of ["creature", "enchantment"]) expect(marks(n, cls)?.colourLocked, `${n} ${cls}`).toBe(true);
    }
    expect(classes("Consuming Sinkhole")).toEqual(["creature", "land", "planeswalker"]);
    expect(marks("Consuming Sinkhole", "creature")).toMatchObject({ colourLocked: true, exile: true });
    expect(marks("Consuming Sinkhole", "land")).toMatchObject({ colourLocked: true, exile: true });
    // The damage mode at a player or planeswalker is a plain clause.
    expect(marks("Consuming Sinkhole", "planeswalker")?.colourLocked).toBe(false);
  });

  test("a compound beside an unrestricted clause for the class is not narrow there (Electrostatic Bolt, Bumi Bash), and a disjunction is not a compound (Vronos)", () => {
    // "2 damage to target creature. If it's an artifact creature, 4 damage instead": the plain target is a full creature answer.
    expect(marks("Electrostatic Bolt", "creature")?.colourLocked).toBe(false);
    // Bumi Bash's bite is unrestricted; "land creature or nonbasic land" derives as one compound subject (CEILING below), so its land row is narrow.
    expect(marks("Bumi Bash", "creature")?.colourLocked).toBe(false);
    expect(marks("Bumi Bash", "land")?.colourLocked).toBe(true);
    // "target nonland permanent" reaches every class whole; the "artifact creature" Vronos makes is a becomes, no target of a kill.
    for (const cls of ["artifact", "creature", "enchantment", "planeswalker"]) expect(marks("Vronos, Masked Inquisitor", cls)?.colourLocked, cls).toBe(false);
    // Gremlin Mine's damage rule has no artifact class: creature only, narrow.
    expect(classes("Gremlin Mine")).toEqual(["creature"]);
    expect(marks("Gremlin Mine", "creature")?.colourLocked).toBe(true);
  });

  test("CEILING: real misses the derived rows cannot see", () => {
    // Polymorph / Transmogrify: derive reads the creature as yours (owner ruling #962); Venser's and Teferi's exile is on an emblem node; The Eternal Wanderer's \"that player's next end step\" return is unread, so its blink looks immediate; Bumi Bash's
    // \"land creature or nonbasic land\" derives as ONE compound subject.
    for (const n of ["Polymorph", "Transmogrify", "Venser, the Sojourner", "The Eternal Wanderer"]) expect(classes(n), n).toEqual([]);
    expect(classes("Bumi Bash")).toEqual(["creature", "land"]);
  });
});

test("a blink is not an answer, however much it reads like removal", () => {
  const classes = detectAnswerClasses([
    realCard("Essence Flux"),
    realCard("Beast Within"),
  ]);
  expect(classes.get("creature")?.cards.has("Essence Flux")).toBe(false);
  // ...and the negation still reads as an answer, since "you don't control" is not "you control".
  expect(classes.get("creature")?.cards.has("Beast Within")).toBe(true);
});

test("graveyard is an answer class too, and it comes from the hate rule", () => {
  const classes = detectAnswerClasses([realCard("Bojuka Bog")]);
  expect([...(classes.get("graveyard")?.cards ?? [])]).toEqual(["Bojuka Bog"]);
});

/** Exile is the only recursion-proof answer (design §2.1, owner's ruling): a tucked card can be
 *  drawn or tutored again, and a destroyed one can be reanimated. The pair is the test -- either
 *  card alone passes with a pattern that ignores the verb entirely. */
test("an exile marks its class, a destroy does not", () => {
  const classes = detectAnswerClasses([
    realCard("Swords to Plowshares"),
    realCard("Vindicate"),
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
  const marks = answerClassesOf(realCard("Treva's Charm"));
  expect(marks.get("creature")?.exile).toBe(true);
  expect(marks.get("enchantment")?.exile).toBe(false);
});

/** `answers.typed` already vetoes graveyard exile, and the exile rule must carry the same veto:
 *  "Exile target creature card from a graveyard" names a creature and answers no creature on the
 *  battlefield. Without the `not` this is a recursion-proof creature answer that does not exist. */
test("exiling a creature card OUT of a graveyard is not a creature answer", () => {
  const classes = detectAnswerClasses([realCard("Shamble Back")]);
  expect(classes.get("creature")?.cards.has("Shamble Back") ?? false).toBe(false);
  expect(classes.get("creature")?.exiling.has("Shamble Back") ?? false).toBe(false);
});

/** A multi-type exile marks every class it names, the same global sweep the class rule uses. */
test("one exile clause naming two types marks both", () => {
  const marks = answerClassesOf(realCard("Return to Dust"));
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
  const classes = detectAnswerClasses([realCard("Bojuka Bog")]);
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
 *  `answers.typed.creature` (a delayed return keeps its place in the count, owner 2026-09-25); only `answers.typed.exile.*` (`notBlinkedBack`) refuses it, and only the mode.
 *  Paired with a real exile removal in the same test: either half alone passes with a broken guard. */
test("a blink exiles a creature but is not a recursion-proof answer, and a real exile still is", () => {
  const classes = detectAnswerClasses([
    realCard("Long Road Home"),
    realCard("Swords to Plowshares"),
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
  const classes = detectAnswerClasses([realCard("Staff of Compleation")]);
  for (const cls of ["creature", "artifact", "enchantment", "planeswalker", "land"]) {
    expect(classes.get(cls)?.cards.has("Staff of Compleation") ?? false, cls).toBe(false);
  }
});

/** The five type classes have no recurring rule at all, so they are empty by construction rather
 *  than by a special case -- if this ever fails, a mode leaked out of the graveyard rule. */
test("only graveyard carries a recurring mark", () => {
  const classes = detectAnswerClasses([
    realCard("Swords to Plowshares"),
    realCard("Vindicate"),
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
  // Real derived abilities (derive 368): a prohibition derives nothing, a win is the win-game kind, a loss is a loses-game emit.
  const alt = (name: string): boolean => (detectWincons([realCard(name)]).get("alt-win") ?? new Set()).has(name);
  expect(alt("Platinum Angel")).toBe(false);
  expect(alt("Everybody Lives!")).toBe(false);
  // The control arm: winning, or making somebody ELSE lose, is a real alternate win.
  expect(alt("Thassa's Oracle")).toBe(true);
  expect(alt("Laboratory Maniac")).toBe(true);
  expect(alt("Vorpal Sword")).toBe(true);
});

// I5 (2026-08-25): IMPULSE DRAW IS NOT CARD SELECTION, and the `selection` pattern said so outright
// — its third alternative was literally the impulse template. Selection REORDERS what you will
// draw; impulse draw ADDS cards you may cast, usually only this turn.
test("impulse draw is its own category and no longer reads as card selection", () => {
  const cats = (dc: DeckCard) => [...detectBuildCategories([dc]).keys()];

  // Light Up the Stage's shape. Measured: 14 distinct cards across the 71 decks, none of which was
  // already counted as draw, so the leaf is not a rename of one that existed.
  const impulse = realCard("Light Up the Stage");
  expect(cats(impulse)).toContain("impulseDraw");
  expect(cats(impulse)).not.toContain("cardSelection");

  // …and the two halves that stay selection.
  expect(cats(realCard("Preordain"))).toContain("cardSelection");
  expect(cats(realCard("Consider"))).toContain("cardSelection");

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

// --- THE PROTECTION ROLE READS DERIVED DATA (#1266; it was the printed `protection` pattern and the `protectionIsOwnKeyword` text reader) ---
// Every card below is REAL: oracle text and derived abilities from `fixtures/removal-derived.json` (Mongo, derive 515). A must-hold case BLANKS the oracle text, so only derived data can say yes.

const protectionText = () => loadRules().rules.find((r) => r.id === "protection.text")!;
const protectsDerived = (name: string): boolean => ruleMatches(protectionText(), realCard(name, { oracleText: "" }));
const protects = (name: string): boolean => ruleMatches(protectionText(), realCard(name));

test("a keyword handed to something else is protection, read off the derived grant", () => {
  const grants = [
    "Heroic Intervention", "Lightning Greaves", "Swiftfoot Boots", "Mother of Runes", "Boros Charm", "Avacyn, Angel of Hope", "Archetype of Endurance", "Dora Milaje Elite",
    // "It gains ..." after a sentence with a target, or after one that puts another card onto the battlefield, is that permanent.
    "Feat of Resistance", "Gaea's Gift", "Fated Return", "Airtight Alibi", "Strefan, Maurer Progenitor",
    // "You have hexproof" is a grant to the player.
    "Leyline of Sanctity",
    // Inside a quoted ability handed to others, "this creature" and "It" are the GRANTEE, not the card.
    "Agent of the Shadow Thieves",
  ];
  for (const name of grants) expect(protectsDerived(name), name).toBe(true);
});

test("a keyword the card gives ITSELF protects nothing else (the Sylvan Caryatid rule, `Ability.grantsSelf`)", () => {
  // Printed keyword only: derive writes no grant at all.
  expect(protects("Sylvan Caryatid")).toBe(false);
  // The sentence forms main's text reader already refused (#1289).
  for (const name of ["Adanto Vanguard", "Falkenrath Aristocrat", "Dragonlord Ojutai", "Kogla, the Titan Ape", "Hungering Puppetbeast", "Crew Captain"]) expect(protects(name), name).toBe(false);
  // The same fact behind a condition or a trigger, which the anchored text reader let through: "As long as you control four or more artifacts, this creature has hexproof", "As long as your opponents
  // control no creatures, this creature has indestructible", "Landfall — ... this creature gains indestructible", "If you do, this creature gains indestructible".
  for (const name of ["Shimmer Dragon", "Erebos's Titan", "Dreadwurm", "Temur Sabertooth"]) expect(protects(name), name).toBe(false);
  // A grant inside the card's own animate carries `subject.self` and no `grantsSelf` ("Chromium becomes a Human ..., loses all abilities, and gains hexproof"): `notSelf` refuses it.
  for (const name of ["Chromium, the Mutable", "Gideon, Champion of Justice"]) expect(protects(name), name).toBe(false);
  // Shadowspear hands lifelink and trample to its host: a grant, of no protection keyword (`grantsAny`).
  expect(realCard("Shadowspear").tags!.abilities.some((a) => (a.grants ?? []).includes("lifelink"))).toBe(true);
});

test("a keyword counter put on another permanent is protection; one the card puts on itself is not", () => {
  for (const name of ["Claim the Kingdom", "Slippery Bogbonder", "Summon: Knights of Round"]) expect(protectsDerived(name), name).toBe(true);
  // "enters with an indestructible counter on it" and "Put an indestructible counter on Drivnod" are the same fact about the card itself.
  for (const name of ["Myojin of Grim Betrayal", "Drivnod, Carnage Dominus"]) expect(protects(name), name).toBe(false);
});

test("a printed protection word that hands nothing to your permanents is not protection", () => {
  const not = [
    // A token "with hexproof", and a token's reminder text, are the TOKEN'S (owner ruling 2026-09-27, #533; #1289).
    "Deeproot Waters", "Shuri's Fabricator", "Vibranium Mining Mech", "T'Challa, the Black Panther",
    // Taking protection AWAY is a removal enabler.
    "Shadowspear", "Nowhere to Run", "Hour of Devastation",
    // A list of keywords the card counts or looks for, and a card NAME that holds the word.
    "Akroma, Vision of Ixidor", "Skyshroud Sentinel",
    // "This spell can't be countered" protects the card itself.
    "Nezahal, Primal Tide", "Niv-Mizzet, Parun",
  ];
  for (const name of not) expect(protects(name), name).toBe(false);
});

test("phasing out is protection, read off the derived `phases-out` emit", () => {
  for (const name of ["Teferi's Protection", "Slip Out the Back"]) expect(protectsDerived(name), name).toBe(true);
  // A card that phases out ANY permanent, yours or theirs, can be both protection and interaction: it stays.
  expect(protectsDerived("Galadriel's Dismissal")).toBe(true);
});

// owner 2026-11-12: a card that protects only itself is not Protection, phasing included. The derived `phases-out` emit carries `subject.self`.
test("a card that phases only ITSELF out is not protection", () => {
  const selfOnly = ["Blink Dog", "Crystal Golem", "Mist Dragon", "Rainbow Efreet", "Frenetic Efreet", "Teferi's Honor Guard", "Vaporous Djinn", "Warping Wurm", "Vision, Synthezoid Avenger", "Kaito Shizuki", "Renegade Silent"];
  for (const name of selfOnly) expect(protectsDerived(name), name).toBe(false);
});

// owner 2026-11-12: phasing aimed only at an opponent's permanent is interaction, not Protection. The emit's subject carries `control: "opp"`.
test("phasing aimed only at an opponent's permanent is not protection", () => {
  for (const name of ["Teferi's Reproach", "Divine Smite", "Sapphire Charm", "Teferi, Master of Time", "Teferi, Timeless Voyager"]) expect(protectsDerived(name), name).toBe(false);
});

// owner 2026-11-12: a targeting ban against opponents handed to something that is not the card is Protection. The derived `targeting-ban` kind carries who is protected (`effect.subject`) and from whom (`targetingBan.source.control`).
test("a targeting ban against opponents, on something other than the card, is protection", () => {
  // "Target creature can't be the target of spells or abilities your opponents control this turn", the Aura form, the board form, and the lands-and-graveyard form.
  for (const name of ["Vines of Vastwood", "Canopy Cover", "Shielding Plax", "Veilstone Amulet", "Tomik, Distinguished Advokist", "Display of Dominance"]) expect(protectsDerived(name), name).toBe(true);
  // The card's own ban is hexproof on itself (a stat), and a ban from ANY source or from lands/graveyards is not against opponents.
  for (const name of ["Thrun, Breaker of Silence", "Shanna, Sisay's Legacy", "Karplusan Strider"]) expect(protectsDerived(name), name).toBe(false);
  // Owner 2026-11-12 (Display of Dominance and Tomik confirmed): the rest of the opponent-aimed set stays.
  // A ban from ANY source that protects YOUR things counts too (owner 2026-11-12, second ruling): Autumn's Veil and Spellbane Centaur ("creatures you control can't be the targets of blue ... spells"), an Aura's
  // enchanted creature (Anti-Magic Aura, Spectral Shield, Artifact Ward: an Aura you can put on your own creature), and a global ban on every graveyard (Ground Seal, Silent Gravestone, Dennick, Underworld Cerberus)
  // or every creature (Dense Foliage).
  for (const name of ["Autumn's Veil", "Spellbane Centaur", "Anti-Magic Aura", "Spectral Shield", "Artifact Ward", "Ground Seal", "Silent Gravestone", "Dennick, Pious Apprentice // Dennick, Pious Apparition", "Underworld Cerberus", "Dense Foliage"]) expect(protectsDerived(name), name).toBe(true);
  // Owner 2026-11-13: Peace Talks ("players and permanents can't be the targets of spells or activated abilities", this turn and next) protects everyone, opponents included: a global ban on all permanents.
  expect(protectsDerived("Peace Talks")).toBe(true);
  // Still refused: a ban on the card itself, from any source (hexproof on itself, a stat).
  for (const name of ["Gaea's Revenge", "Raiding Party", "Bartel Runeaxe"]) expect(protectsDerived(name), name).toBe(false);
});

// owner 2026-11-12: a ban whose subject is only OPPONENTS' things protects nobody of yours, whatever the source. Written row: no real card has the shape.
test("a targeting ban on only the opponents' things is not protection", () => {
  const ban = (subject: object, source: object): DeckCard => derivedCard("Written", [{ kind: "static", effect: { kind: "targeting-ban", subject }, targetingBan: { by: ["spell", "ability"], source } }], "Enchantment");
  expect(ruleMatches(protectionText(), ban({ control: "opp", token: null, type: "creature", scope: "all" }, { control: "any", token: null }))).toBe(false);
  expect(ruleMatches(protectionText(), ban({ control: "opp", token: null, type: "creature", scope: "all" }, { control: "opp", token: null }))).toBe(false);
  expect(ruleMatches(protectionText(), ban({ control: "you", token: null, type: "creature", scope: "all" }, { control: "any", token: null }))).toBe(true);
});

// owner 2026-11-12: Livio, Oathsworn Sentinel is Protection (confirmed), as are Display of Dominance and Tomik, Distinguished Advokist.
test("Livio, Oathsworn Sentinel, Display of Dominance and Tomik are protection (owner confirmed)", () => {
  // Livio joins protection.flicker (its aegis-counter exile and return of the card to its owner); the other two are protection.text's opponent-aimed ban.
  const anyProtection = (name: string): boolean => loadRules().rules.filter((r) => r.category === "protection").some((r) => ruleMatches(r, realCard(name, { oracleText: "" })));
  for (const name of ["Livio, Oathsworn Sentinel", "Display of Dominance", "Tomik, Distinguished Advokist"]) expect(anyProtection(name), name).toBe(true);
});

// owner 2026-11-12: a land can carry Protection. The `countsAsLand` exclusion is gone from protection.text; these are the 11 cards it had hidden, each read against its Mongo text.
test("a land, and a spell with a land face, can be protection", () => {
  // Derived readings: a grant of protection / hexproof / indestructible to another permanent, and a keyword counter on another permanent.
  for (const name of ["Sejiri Steppe", "Tower of the Magistrate", "Plaza of Heroes", "Tyrite Sanctum"]) expect(protectsDerived(name), name).toBe(true);
  // Modal spells whose other face is a land: the spell face is the protection (indestructible to your other creatures, a counter and indestructible, protection from a colour).
  for (const name of ["Emeria's Call // Emeria, Shattered Skyclave", "Revitalizing Repast // Old-Growth Grove", "Sejiri Shelter // Sejiri Glacier"]) expect(protectsDerived(name), name).toBe(true);
  // The printed residue: mana spent on a spell "can't be countered".
  for (const name of ["Boseiju, Who Shelters All", "Cavern of Souls", "Mistrise Village"]) expect(protects(name), name).toBe(true);
  // Detection Tower lets YOU target hexproof creatures: anti-protection. "As though they didn't have hexproof" names the keyword and grants none (derive 519; Kaya, Bane of the Dead and Nowhere to Run store `cant`, which is not a grant).
  for (const name of ["Detection Tower", "Kaya, Bane of the Dead", "Nowhere to Run"]) expect(protectsDerived(name), name).toBe(false);
});

// owner 2026-11-12: Talon Gates of Madara ("When this land enters, up to one target creature phases out.") carries Protection. Its stored clause files the phase-out as `put`; derive reads the printed text (phase-out-put.test.ts).
test("Talon Gates of Madara is protection, read off the derived phases-out emit", () => {
  expect(protectsDerived("Talon Gates of Madara")).toBe(true);
});

// owner 2026-11-12: phasing out an opponent's permanent is interaction, but not removal. It carries an ANSWER class by what it can hit and no `targetedRemoval` for the phasing alone.
describe("phasing out another player's permanent is an answer, not removal (#1266)", () => {
  const classes = (name: string): string[] => [...answerClassesOf(realCard(name)).keys()].sort();
  const removal = (names: string[]): string[] => [...(detectBuildCategories(names.map((n) => realCard(n))).get("targetedRemoval") ?? [])].sort();

  test("the class is the type the phase-out can hit", () => {
    expect(classes("Sapphire Charm")).toEqual(["creature"]);
    expect(classes("Teferi, Master of Time")).toEqual(["creature"]);
    expect(classes("Teferi, Timeless Voyager")).toEqual(["creature"]);
    expect(classes("Divine Smite")).toEqual(["creature", "planeswalker"]);
    // "All nonland permanents they control": creatures, artifacts, enchantments and planeswalkers, not lands.
    expect(classes("Teferi's Reproach")).toEqual(["artifact", "creature", "enchantment", "planeswalker"]);
    // A phase-out of a target of ANY controller can be an answer too (it is protection as well).
    expect(classes("Galadriel's Dismissal")).toEqual(["creature"]);
  });

  test("phasing alone is not targeted removal; Divine Smite's exile branch and Timeless Voyager's tuck are", () => {
    expect(removal(["Teferi's Reproach", "Sapphire Charm", "Teferi, Master of Time", "Galadriel's Dismissal"])).toEqual([]);
    expect(removal(["Divine Smite", "Teferi, Timeless Voyager"])).toEqual(["Divine Smite", "Teferi, Timeless Voyager"]);
  });

  // owner 2026-11-12: a TARGETLESS mass phase-out of creatures is an answer (answer:creature), not a board wipe. Out of Time, Time and Tide and Disciple of Caelus Nin phase out every creature (of any controller).
  test("a mass phase-out that reaches opponents' creatures answers creature, and is no board wipe", () => {
    for (const name of ["Out of Time", "Time and Tide", "Disciple of Caelus Nin"]) expect(classes(name), name).toEqual(["creature"]);
    // "All artifacts and creatures phase out" covers two classes.
    expect(classes("The City on the Edge of Forever")).toEqual(["artifact", "creature"]);
    const wipes = detectBuildCategories(["Out of Time", "Time and Tide", "Disciple of Caelus Nin"].map((n) => realCard(n))).get("boardWipe") ?? [];
    expect([...wipes]).toEqual([]);
  });

  // owner 2026-11-12 (confirmed, no change): Slip Out the Back and Galadriel's Dismissal are Protection AND keep their answer tag.
  test("Slip Out the Back and Galadriel's Dismissal keep their answer class", () => {
    expect(classes("Galadriel's Dismissal")).toEqual(["creature"]);
    expect(classes("Slip Out the Back")).toEqual(["creature"]);
  });

  // A mass phase-out of only YOUR permanents (control you) answers nothing; neither does a chosen-type one that no class is read from. Teferi's Realm stays with no answer tag (owner 2026-11-13: each player chooses on their own upkeep).
  test("a mass phase-out of only your own permanents answers nothing", () => {
    for (const name of ["Teferi's Protection", "Perch Protection", "Ripples of Potential", "Taniwha", "Temporal Firestorm", "Teferi's Realm"]) expect(classes(name), name).toEqual([]);
  });

  test("a phase-out of your own permanent, of the card itself, or only a block triggers answers nothing", () => {
    for (const name of ["Teferi's Protection", "Clever Concealment", "Blink Dog", "Mist Dragon", "Dream Fighter"]) expect(classes(name), name).toEqual([]);
  });
});

// owner 2026-11-12: Dream Fighter is opponent-aimed and leaves Protection. "This creature and that creature phase out" fires when it blocks or becomes blocked by a creature, and "that creature" is the creature
// blocking it or blocked by it, which an opponent controls (CR 509.1a: the defending player chooses which creatures THEY control block an attacker; derive reads it `control: any`). The rule refuses a phase-out only a BLOCK makes (`notBlockCombat`).
test("a phase-out that only a block triggers is opponent-aimed, not protection", () => {
  expect(protectsDerived("Dream Fighter")).toBe(false);
  // Written row: a block trigger that phases out another creature of ANY controller is refused; the same emit on a spell or a non-block trigger still counts.
  const phase = (trigger: object | undefined): DeckCard => derivedCard("Written", [{ kind: trigger ? "triggered" : "on-cast", ...(trigger ? { trigger } : {}), effect: { kind: "" }, emits: [{ verb: "phases-out", subject: { control: "any", token: null, type: "creature" } }] }], "Creature");
  expect(ruleMatches(protectionText(), phase({ verbs: ["blocks", "becomes-blocked"] }))).toBe(false);
  expect(ruleMatches(protectionText(), phase({ verbs: ["attacks"] }))).toBe(true);
  expect(ruleMatches(protectionText(), phase(undefined))).toBe(true);
});

test("the one printed residue: spells that can't be countered and protection for the player", () => {
  // CEILING (see the rule's why): derive reads neither, so these stand on printed text; with the text blanked nothing derived says so.
  for (const name of ["Delighted Halfling", "Vexing Shusher", "The One Ring", "Seht's Tiger", "Solitary Confinement"]) {
    expect(protects(name), name).toBe(true);
    expect(protectsDerived(name), name).toBe(false);
  }
});

test("named CEILINGs of the derived protection read (#1266)", () => {
  // MISSES. "Choose hexproof or indestructible. Creatures you control gain that ability" names no keyword in `grants`; a per-colour keyword list derives no grant; an emblem's grant lives on the emblem's node.
  for (const name of ["Linvala, Shield of Sea Gate", "Scion of Draco", "Elspeth, Knight-Errant"]) expect(protects(name), name).toBe(false);
  // OVER-READ. Celebr-8000's "it gains the indicated ability" sits a sentence away from the bullet that names indestructible, so `grantsSelf` is not set.
  expect(protects("Celebr-8000")).toBe(true);
});

const VIBRANIUM_REMINDER = "(It's an artifact with indestructible and \"{T}: Add {C}. This mana can't be spent to cast a nonartifact spell.\")";

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

// THE WIPE RULE READS DERIVED DATA (#1266; it was the printed `boardWipe` pattern). The cards below are REAL: their oracle text and derived abilities are in `fixtures/removal-derived.json`, and the list
// started as the 2026-09-05 measurement against Commander Salt's boardWipes on six cached decks (the old regex found 7 of 16; Fiery Confluence's each-creature mode and Chandra, Bold Pyromancer's
// ultimate were the two defensible extras). The old pattern also called every "each player sacrifices a creature" EDICT a wipe (Fleshbag Marauder, Plaguecrafter, Szat's Will) and every "return all
// ... cards from your graveyard" recursion one. Overload is a printed KEYWORD (Scryfall `keywords`), which derive does not read: the fixture carries none, so the test sets it.
const overloaded = (name: string): DeckCard => { const dc = realCard(name); return { ...dc, card: { ...dc.card, keywords: ["Overload"] } }; };
test("a board wipe is a mass effect on the battlefield, in any of its shapes", () => {
  const wipes: DeckCard[] = [
    realCard("Wrath of God"), realCard("Damnation"), realCard("Plague Wind"), realCard("Farewell"), realCard("Austere Command"),
    realCard("Blasphemous Act"), realCard("Toxic Deluge"), realCard("The Meathook Massacre"), realCard("Massacre Girl"), realCard("Black Sun's Zenith"),
    realCard("Living Death"), realCard("Blasphemous Edict"), realCard("Cataclysm"), realCard("Delayed Blast Fireball"), realCard("Chandra Nalaar"),
    realCard("Desynchronization"), realCard("Calamity of the Titans"), realCard("Cower in Fear"),
    // A creature wipe that ALSO hits lands names another type and stays a wipe (owner 2026-11-06: only a land-only mass is land denial, below).
    realCard("Jokulhaups"),
    // A global Aura / Equipment sweep was a wipe on main and stays; only the attachments of a TARGET are refused (below).
    realCard("Serene Heart"), realCard("Pure // Simple"),
    // One-sided: an opponent-only mass effect is still a wipe.
    // Overload turns "target" into "each", and derive reads only the targeted half.
    overloaded("Cyclonic Rift"), overloaded("Vandalblast"),
    // "Destroy all creatures target player controls": derive scopes it `all` (#1266), so the derived mass clauses carry it.
    realCard("Mogg Infestation"), realCard("Primeval Light"),
    // #1581 control: an EVERY-player counted sacrifice ("sacrifices a third of the creatures they control") keeps its role; only the opponent-side counted pick is refused.
    realCard("Pox"),
    // #1581 owner ruling 2026-11-09: a 'sacrifice HALF' effect is a wipe in practice, like Pox. Derive stores 'half' as a counted pick with no amount, the same as 'that many', so the printed 'sacrifices half' keeps it.
    realCard("Vona's Hunger"), realCard("Rakdos the Defiler"),
  ];
  const notWipes: DeckCard[] = [
    realCard("Fleshbag Marauder"), realCard("Rest in Peace"), realCard("Gallifrey Stands"), realCard("Emrakul, the World Anew"), realCard("Eldritch Immunity"), realCard("Mizzix's Mastery"),
    realCard("Coat of Arms"), realCard("Wisdom of Ages"), realCard("Arcane Artisan"), realCard("Mass Polymorph"), realCard("Synthetic Destiny"),
    // A single target is removal, not a wipe.
    realCard("Doom Blade"),
    // A power-only shrink, a continuous one, and an opponent's counted sacrifice kill nothing in bulk.
    realCard("Cumber Stone"), realCard("Kaervek, the Spiteful"), realCard("Crackling Doom"), realCard("Portal to Phyrexia"),
    // #1581: "that source's controller sacrifices that many permanents of their choice" is an opponent's COUNTED sacrifice, a deterrent and no wipe (`selection: counted`).
    realCard("Phyrexian Obliterator"), realCard("Ravenous Rotbelly"), realCard("Bane of Bala Ged"),
    // Burn at a player and the planeswalkers they control touches no creature.
    realCard("Cavalier of Flame"),
    // A target widened by "and all other ... with the same name", and a block's "destroy both creatures".
    realCard("Banishment"), realCard("Alaborn Zealot"),
    // `notEdict`: "Target player sacrifices two creatures" forces a choice on one named player.
    realCard("Dead Drop"),
    // `notAttachedTo`: "Destroy all Equipment attached to that creature" rides on a targeted spell.
    realCard("Blastfire Bolt"),
    // `notTokenOnly`: both a kill emit (Faerie Artisans, "exile all other tokens created with this creature") and a debuff (Bloodline Culling, "Creature tokens get -2/-2").
    realCard("Faerie Artisans"), realCard("Bloodline Culling"),
    // `notBlockCombat` on a debuff: "each creature blocking it gets -1/-1".
    realCard("Plague Wight"),
    // Burn at a player, by the number of lands they control, touches no creature (no mass subject, so no sweep emit).
    realCard("Typhoon"), realCard("Treacherous Terrain"),
  ];
  const m = detectBuildCategories([...wipes, ...notWipes]);
  const found = m.get("boardWipe") ?? new Set<string>();
  expect(wipes.map((d) => d.card.name).filter((n) => !found.has(n))).toEqual([]);
  expect(notWipes.map((d) => d.card.name).filter((n) => found.has(n))).toEqual([]);
});

// MASS LAND DESTRUCTION IS STAX, NOT A WIPE (owner 2026-11-06: "It should be mass land denial rather than boardwipe, so it is stax piece"); A WIPE THAT ALSO DESTROYS LANDS IS BOTH (owner 2026-11-06, #1554).
test("mass land destruction is stax and not a wipe; a wipe that also hits lands is both", () => {
  const roles = (names: string[]): Map<string, Set<string>> => detectBuildCategories(names.map((n) => realCard(n)));
  const denial = ["Armageddon", "Ravages of War", "Ruination", "Global Ruin", "Sunder", "Natural Balance", "Planar Overlay", "Omen of Fire", "Acid Rain"];
  const both = ["Wildfire", "Death Cloud", "Jokulhaups", "Obliterate", "Decree of Annihilation"];
  const m = roles([...denial, ...both, "Wrath of God", "Stone Rain"]);
  const has = (cat: string, n: string): boolean => m.get(cat)?.has(n) === true;
  expect(denial.filter((n) => has("boardWipe", n))).toEqual([]);
  expect(denial.filter((n) => !has("stax", n))).toEqual([]);
  expect(both.filter((n) => !has("boardWipe", n))).toEqual([]);
  expect(both.filter((n) => !has("stax", n))).toEqual([]);
  // Wrath of God is a wipe and nothing else.
  expect(has("boardWipe", "Wrath of God")).toBe(true);
  expect(has("stax", "Wrath of God")).toBe(false);
  // A single land destruction (scope target) is neither.
  expect(has("boardWipe", "Stone Rain")).toBe(false);
  expect(has("stax", "Stone Rain")).toBe(false);
});

// OWNER 2026-11-12: MASS LAND DESTRUCTION IS STAX, NOT A BOARD WIPE, on EVERY path the wipe rule has (#1266, Rules 45). The derived kill path refused a land-only subject since 2026-11-06; two other paths still let it in: OVERLOAD
// (Break the Ice: "Destroy target land that is snow or could produce {C}", overloaded to "each") and the derived "all lands target player controls" (Ajani Vengeant: "Destroy all lands target player controls").
test("a land-only mass by overload or at a target player is stax and no wipe; a wipe beside it stays one", () => {
  const m = detectBuildCategories([overloaded("Break the Ice"), realCard("Ajani Vengeant"), realCard("Catastrophe"), realCard("Mogg Infestation")]);
  const has = (cat: "stax" | "boardWipe", n: string): boolean => m.get(cat)?.has(n) === true;
  for (const n of ["Break the Ice", "Ajani Vengeant"]) { expect(has("boardWipe", n), `${n} boardWipe`).toBe(false); expect(has("stax", n), `${n} stax`).toBe(true); }
  // "Destroy all lands or all creatures" names creatures too: both. A creature mass at a target player stays a wipe.
  expect(has("boardWipe", "Catastrophe")).toBe(true);
  expect(has("boardWipe", "Mogg Infestation")).toBe(true);
});

// OWNER 2026-11-13: EACH HALF OF A CARD IS ITS OWN EFFECT (#1266, Rules 48). Burning of Xinye ("You destroy four lands you control, then target opponent destroys four lands they control. Then Burning of Xinye
// deals 4 damage to each creature.") is a board wipe for the damage AND stax for the land destruction. Catastrophe ("Destroy all lands or all creatures.") stays both; Stone Rain (one land) stays neither.
test("each half of a card is its own effect: Xinye is a wipe and stax, Catastrophe both, Stone Rain neither", () => {
  const m = detectBuildCategories([realCard("Burning of Xinye"), realCard("Catastrophe"), realCard("Stone Rain")]);
  const has = (cat: "stax" | "boardWipe", n: string): boolean => m.get(cat)?.has(n) === true;
  for (const n of ["Burning of Xinye", "Catastrophe"]) { expect(has("boardWipe", n), `${n} boardWipe`).toBe(true); expect(has("stax", n), `${n} stax`).toBe(true); }
  expect(has("boardWipe", "Stone Rain")).toBe(false);
  expect(has("stax", "Stone Rain")).toBe(false);
});

// OWNER 2026-11-13: URZA'S SYLEX IS WEAK STAX (#1266, Rules 48). "Each player chooses six lands they control. Destroy all other permanents." It stays a board wipe and gains role:stax. The engine has no weak-stax level.
test("Urza's Sylex is a board wipe and stax; the other choose-and-destroy-the-rest wipes are not stax", () => {
  const m = detectBuildCategories(["Urza's Sylex", "Razia's Purification", "End Hostilities", "Wash Out"].map((n) => realCard(n)));
  const has = (cat: "stax" | "boardWipe", n: string): boolean => m.get(cat)?.has(n) === true;
  expect(has("boardWipe", "Urza's Sylex")).toBe(true);
  expect(has("stax", "Urza's Sylex")).toBe(true);
  for (const n of ["Razia's Purification", "End Hostilities", "Wash Out"]) expect(has("stax", n), `${n} stax`).toBe(false);
});

// OWNER 2026-11-13: DESTROYING ALL LANDS OF ONE TARGET PLAYER IS STAX (#1266, Rules 48). Ajani Vengeant's -7 ("Destroy all lands target player controls") derives scope `target`, the same as Stone Rain, so the printed words carry it.
// The text is blanked to the -7 alone: Ajani's +1 ("doesn't untap") would make the card stax whatever the -7 reads as.
test("destroying all lands target player controls is stax on its own; Stone Rain is not", () => {
  const staxRules = loadRules().rules.filter((r) => r.category === "stax");
  const isStax = (dc: DeckCard): boolean => staxRules.some((r) => ruleMatches(r, dc));
  expect(isStax(realCard("Ajani Vengeant", { oracleText: "\u22127: Destroy all lands target player controls." }))).toBe(true);
  expect(isStax(realCard("Stone Rain"))).toBe(false);
});

// ALL PERMANENTS NAMES LANDS; A RESTRICTED PERMANENT SUBJECT DOES NOT (#1557, Rules 41). Derive 468 keeps the restriction on the subject (chosenColor, colorCount, selection), so only a genuinely unrestricted `permanent` is land-including.
test("an unrestricted permanent wipe is stax too; a restricted one, and a per-opponent choice, are not", () => {
  const m = detectBuildCategories([
    "Apocalypse", "Worldfire", "Dimensional Breach", "Wash Out", "Razia's Purification", "Council's Judgment", "End Hostilities", "All Is Dust", "Liliana of the Veil", "Ultimate Magic: Meteor", "Gideon, Champion of Justice", "Urza's Sylex", "Wrath of God",
  ].map((n) => realCard(n)));
  const has = (cat: "stax" | "boardWipe", n: string): boolean => m.get(cat)?.has(n) === true;
  for (const n of ["Apocalypse", "Worldfire", "Dimensional Breach", "Gideon, Champion of Justice"]) { expect(has("stax", n), `${n} stax`).toBe(true); expect(has("boardWipe", n), `${n} boardWipe`).toBe(true); }
  for (const n of ["Wash Out", "Razia's Purification", "Council's Judgment", "End Hostilities", "All Is Dust", "Liliana of the Veil", "Ultimate Magic: Meteor", "Wrath of God"]) expect(has("stax", n), `${n} stax`).toBe(false);
  // Meteor's destroy is one chosen permanent per opponent, but its 7 damage to each creature is still a wipe.
  expect(has("boardWipe", "Ultimate Magic: Meteor")).toBe(true);
  // The restricted ones stay the wipes they were.
  for (const n of ["Wash Out", "Razia's Purification", "End Hostilities", "All Is Dust"]) expect(has("boardWipe", n), `${n} boardWipe`).toBe(true);
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
/** Flash is a printed KEYWORD (Scryfall `keywords`), which the fixture does not carry: the test sets it, as `overloaded` does. */
const FLASH: ReadonlySet<string> = new Set(["Restoration Angel", "Silver Surfer, Cosmic Voyager", "Phelia, Exuberant Shepherd"]);
const flick = (name: string): DeckCard => { const dc = realCard(name); return FLASH.has(name) ? { ...dc, card: { ...dc.card, keywords: ["Flash"] } } : dc; };

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

test("the flicker shield reads the derived `flicker` ability, not the printed sentence (#1266)", () => {
  const rule = loadRules().rules.find((r) => r.id === "protection.flicker")!;
  const shields = (name: string): boolean => ruleMatches(rule, { ...flick(name), card: { ...flick(name).card, oracleText: "" } });
  // The printed pattern needed "exile target" and "return it / that card": "each creature you control", "any number of target creatures ... Return those cards", "up to two target creatures ... those
  // cards", a replacement ("would be put into a graveyard ..., exile it instead. Return it ...") and a flash creature's "any number of other target permanents" were all missed.
  for (const name of ["Ghostway", "Eerie Interlude", "Displace", "Cosmic Intervention", "Silver Surfer, Cosmic Voyager", "Ephemerate", "Restoration Angel", "Otherworldly Journey", "Parting Gust"]) expect(shields(name), name).toBe(true);
  // Not at instant speed: a sorcery, and a TRIGGERED flicker on a permanent without flash. (An ACTIVATED flicker is at instant speed: owner 2026-11-12, tested below.)
  for (const name of ["Flicker", "Flickerwisp", "Brago, King Eternal"]) expect(shields(name), name).toBe(false);
  // Restoration Angel without its Flash keyword is a sorcery-speed blink.
  expect(ruleMatches(rule, realCard("Restoration Angel"))).toBe(false);
  // A card that exiles and returns only ITSELF shields nothing else, and removal that never returns is no flicker.
  expect(shields("Swords to Plowshares")).toBe(false);
  // Written rows (no instant or flash card in the corpus derives these shapes): a flicker of an OPPONENT's permanent is a blink, and one of the card itself shields nothing else.
  const flashCard = (subject: object): DeckCard => ({ ...derivedCard("Written", [{ kind: "triggered", effect: { kind: "flicker", subject } }], "Creature"), card: { ...derivedCard("Written", [], "Creature").card, keywords: ["Flash"] } });
  expect(ruleMatches(rule, flashCard({ control: "you", token: null, type: "creature", scope: "target" }))).toBe(true);
  expect(ruleMatches(rule, flashCard({ control: "opp", token: null, type: "creature", scope: "target" }))).toBe(false);
  expect(ruleMatches(rule, flashCard({ control: "any", token: null, self: true }))).toBe(false);
  // CEILING over-reads, named in the rule's why: Phelia has flash but flickers on ATTACK; derive reads Audacious Swap's "If it's a land card, they put it onto the battlefield" as a one-branch return.
  for (const name of ["Phelia, Exuberant Shepherd", "Audacious Swap"]) expect(shields(name), name).toBe(true);
});

// owner 2026-11-12: an ACTIVATED flicker on a permanent without flash is Protection (it is at instant speed too), on any card type. It still refuses a flicker of only the card itself and of only opponents' permanents.
test("an activated flicker is protection on any card type", () => {
  const rule = loadRules().rules.find((r) => r.id === "protection.flicker")!;
  const shields = (name: string): boolean => ruleMatches(rule, { ...flick(name), card: { ...flick(name).card, oracleText: "" } });
  // Creatures, and artifacts that exile your permanent and later return it ("Return each creature card exiled with this artifact").
  for (const name of ["Eldrazi Displacer", "Mistmeadow Witch", "Roon of the Hidden Realm", "Emiel the Blessed", "Abuelo, Ancestral Echo", "Nephalia Smuggler", "Cold Storage", "Synod Sanctum"]) expect(shields(name), name).toBe(true);
  // Written rows: an activated flicker of only the card itself, or of only an opponent's permanent, shields nothing.
  // The flicker needs the instant-speed exile it pairs with (`pairedInstantExile`), as derive writes it for Eldrazi Displacer.
  const exile = { kind: "activated", effect: { kind: "" }, emits: [{ verb: "exiled", subject: { control: "opp", token: null, type: "creature", scope: "target", fromZone: "battlefield" }, instantSpeed: true }] };
  const activated = (subject: object, emits: object[] = [{ verb: "enters", subject: { control: "any", token: null, fromZone: "exile" } }]): DeckCard => derivedCard("Written", [exile, { kind: "activated", effect: { kind: "flicker", subject }, emits }], "Artifact");
  expect(ruleMatches(rule, activated({ control: "any", token: null, type: "creature", scope: "target", other: true }))).toBe(true);
  expect(ruleMatches(rule, activated({ control: "opp", token: null, type: "creature", scope: "target" }))).toBe(false);
  expect(ruleMatches(rule, activated({ control: "any", token: null, self: true }))).toBe(false);
  // "Put a card exiled with this onto the battlefield under YOUR control" is a steal, and a loyalty or sorcery-speed exile (no instant-speed `exiled` emit) is no shield: Sisters of Stone Death, Karn Liberated, Aminatou, Ghost Vacuum.
  for (const name of ["Sisters of Stone Death", "Karn Liberated", "Aminatou, the Fateshifter", "Ghost Vacuum", "Profane Procession // Tomb of the Dusk Rose", "Lilysplash Mentor", "Aetherling", "Kaya, Ghost Assassin"]) expect(shields(name), name).toBe(false);
  // A triggered flicker on a card without flash is still no shield.
  expect(ruleMatches(rule, derivedCard("Written", [{ kind: "triggered", effect: { kind: "flicker", subject: { control: "you", token: null, type: "creature", scope: "target" } } }], "Creature"))).toBe(false);
});

/** A card that carries only derived abilities, as derive writes them (#1266: stackInteraction reads emits and effect kinds, no longer the printed text). */
const derivedCard = (name: string, abilities: object[], typeLine = "Instant"): DeckCard => ({
  card: { name, oracleText: "", typeLine, manaValue: 2 } as Card,
  tags: { oracleId: name, abilities, characteristics: { types: [typeLine.toLowerCase()], subtypes: [], colors: [], identity: [], cmc: 2, power: null, toughness: null, token: false, keywords: [] } } as never,
});
const emit = (verb: string, subject: object) => ({ kind: "on-cast", effect: { kind: "" }, emits: [{ verb, subject }] });
const SPELL = { control: "any", token: null, type: "spell", scope: "target" };
const stackOf = (cards: DeckCard[]): string[] => [...(detectBuildCategories(cards).get("stackInteraction") ?? [])].sort();

/** TWO ROLE PATTERNS THAT READ A PHRASE, NOT A MOVE (overview persona rounds 2026-09-25, item 9).
 *  "Return target ... to your hand" from a GRAVEYARD is recursion, not removal (Archaeomancer, and 383
 *  corpus cards with it); "choose new targets for the COPY" retargets your own copy, not an opponent's
 *  spell (Weaver of Harmony, Twincast, and 257 with it). Derive never reads the copy rider as a `retarget` (#491, #1266). */
test("a graveyard return is not removal, and retargeting your own copy is not stack interaction", () => {
  const m = detectBuildCategories([
    realCard("Archaeomancer"),
    derivedCard("Weaver of Harmony", [{ kind: "activated", effect: { kind: "copy-ability", subject: { control: "you", token: null, abilityKind: ["activated", "triggered"], scope: "target" } } }], "Enchantment Creature"),
    derivedCard("Twincast", [{ kind: "on-cast", effect: { kind: "copy-spell", subject: { control: "any", token: null, type: ["instant", "sorcery"], scope: "target" } } }]),
    realCard("Unsummon"),
    derivedCard("Redirect", [{ kind: "on-cast", effect: { kind: "retarget", subject: SPELL } }]),
  ]);
  expect([...(m.get("targetedRemoval") ?? [])].sort()).toEqual(["Unsummon"]);
  expect([...(m.get("stackInteraction") ?? [])].sort()).toEqual(["Redirect"]);
});

/** Owner rulings 2026-10-14 (issue #1199) and #1266: the role reads derived emits. A counter, a steal, an exile or a return of a TARGET spell counts; a counter of "that spell"
 *  with no target earlier (Kira, Counterbalance), a cast trigger's own exile (Possibility Storm), and a battlefield leave of a creature do not. */
describe("stackInteraction reads derived target emits (#1266)", () => {
  test("a targeted counter, and a counter of a spell targeted earlier (derive gives it scope target), are stack interaction", () => {
    expect(stackOf([
      derivedCard("Counterspell", [emit("counter-spell", SPELL)]),
      derivedCard("Swallowed by Leviathan", [emit("counter-spell", SPELL)]),
      derivedCard("Stifle", [emit("counter-spell", { control: "any", token: null, abilityKind: ["activated", "triggered"], scope: "target" })]),
    ])).toEqual(["Counterspell", "Stifle", "Swallowed by Leviathan"]);
  });

  test("an untargeted counter of 'that spell' (Kira, Counterbalance shape) is not", () => {
    expect(stackOf([
      derivedCard("Counterbalance", [{ kind: "triggered", effect: { kind: "" }, emits: [{ verb: "counter-spell", subject: { control: "any", token: null, type: "spell" } }] }], "Enchantment"),
      derivedCard("Kira", [{ kind: "triggered", effect: { kind: "" }, emits: [{ verb: "counter-spell", subject: { control: "any", token: null, type: "spell" } }] }], "Creature"),
    ])).toEqual([]);
  });

  test("a stack exile, leave or steal with scope target is; the same without scope (Possibility Storm shape) is not", () => {
    const stack = { control: "opp", token: null, type: "spell", fromZone: "stack" };
    expect(stackOf([
      derivedCard("Commandeer", [emit("gains-control", { ...stack, scope: "target", control: "you" })]),
      derivedCard("Spell Queller", [emit("exiled", { ...stack, scope: "target" })], "Creature"),
      derivedCard("Reprieve", [emit("leaves", { ...stack, scope: "target" })]),
      derivedCard("Possibility Storm", [emit("exiled", stack)], "Enchantment"),
      derivedCard("Krark", [emit("leaves", stack)], "Creature"),
    ])).toEqual(["Commandeer", "Reprieve", "Spell Queller"]);
  });

  test("a retarget of a target spell is; a battlefield leave of a creature is removal, not stack interaction", () => {
    expect(stackOf([
      derivedCard("Misdirection", [{ kind: "on-cast", effect: { kind: "retarget", subject: SPELL } }]),
      derivedCard("Own copy rider", [{ kind: "on-cast", effect: { kind: "retarget", subject: { control: "any", token: null, type: "spell" } } }]),
      derivedCard("Unsummon", [emit("leaves", { control: "opp", token: null, type: "creature", scope: "target", fromZone: "battlefield" })]),
    ])).toEqual(["Misdirection"]);
  });
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

// #1266: CARD SELECTION AND IMPULSE DRAW READ DERIVED DATA. Real derived rows (fixtures/removal-derived.json).
test("card selection is a scry, a surveil or a look the card DOES; a card that only hears one is a payoff (#1266)", () => {
  const sel = (n: string) => detectBuildCategories([realCard(n)]).get("cardSelection")?.has(n) === true;
  expect(sel("Preordain")).toBe(true);
  expect(sel("Impulse")).toBe(true);
  expect(sel("Chance-Met Elves")).toBe(false); // "Whenever you scry": a payoff
  expect(sel("Eligeth, Crossroads Augur")).toBe(false); // "If you would scry ..., draw that many cards instead": a replacement
});

// Gift of the Gargantuan has no scry/surveil emit, no Hideaway and no to-hand/search effect arm: the `abilityMark looksAtTop` arm is the ONLY reason it is selection.
test("a look at the top cards that nothing else reads is card selection through the looksAtTop mark (Gift of the Gargantuan, #1266)", () => {
  const n = "Gift of the Gargantuan";
  expect(realCard(n).tags?.abilities?.some((a) => a.looksAtTop === true)).toBe(true);
  expect(detectBuildCategories([realCard(n)]).get("cardSelection")?.has(n)).toBe(true);
});

test("an exile of the top cards and a play of them in ANOTHER clause is impulse draw (Theater of Horrors, #1266)", () => {
  const imp = (n: string) => detectBuildCategories([realCard(n)]).get("impulseDraw")?.has(n) === true;
  expect(imp("Theater of Horrors")).toBe(true);
  expect(imp("Light Up the Stage")).toBe(true);
  expect(imp("Preordain")).toBe(false);
});

// ISSUE #566: "exile the top card of your library ... you may play" is impulse draw (Count on Luck);
// the pattern demanded a count word ("top two cards").
test("an upkeep exile-the-top-card-and-play is impulse draw", () => {
  const luck = realCard("Count on Luck");
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
  test("a craft cost that exiles a land from the battlefield is no swap (Kaslem's Stonetree: Craft with Cave), while Wormfang Newt's still is (#1500)", () => {
    const craft = { control: "you", type: "land", subtype: "cave", fromZone: "battlefield", viaCraft: true };
    expect(ruleMatches(rule, plus(land("land", "library"), "exiled", craft), set)).toBe(true);
    expect(ruleMatches(rule, plus(land("land", "library"), "exiled", { ...craft, viaCraft: undefined }), set)).toBe(false);
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
    // Pure // Simple's Simple half destroys all Auras and Equipment, a wipe, and Pure is its own effect (owner 2026-11-13, Rules 52): the whole card holds as well as its first half.
    const pure = blank("Pure // Simple");
    const firstHalf: DeckCard = { ...pure, tags: { ...pure.tags!, abilities: pure.tags!.abilities.filter((a) => a.clause === 1) } };
    expect(ruleMatches(rule, pure, set), "whole card").toBe(true);
    expect(ruleMatches(rule, firstHalf, set), "Pure // Simple, first half").toBe(true);
    for (const n of ["Daring Demolition", "Rend Spirit"]) expect(ruleMatches(rule, blank(n), set), n).toBe(true);
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
  test("TARGETED DAMAGE IS REMOVAL when its target can be a permanent, at any amount (owner ruling 2026-10-22, #1294): any target, creature, planeswalker, battle, 1-damage pings, repeatable pingers", () => {
    for (const n of ["Lightning Bolt", "Lightning Helix", "Galvanic Blast", "Bee Sting", "Jolene, Plundering Pugilist", "Prodigal Pyromancer", "Flame Slash", "Fling", "Electrolyze", "Volcanic Spite", "Rampaging Raptor", "Aethertorch Renegade"]) expect(ruleMatches(rule, realCard(n), set), n).toBe(true);
  });
  test("a pinger whose effect lost its subject to a cost still reads its targeted damage emits (Aethertorch Renegade: '{T}, Pay {E}{E}: 1 damage to target creature')", () => {
    expect(realCard("Aethertorch Renegade").tags!.abilities.some((a) => a.effect.kind === "damage" && a.effect.subject === undefined)).toBe(true);
  });
  test("'target player or planeswalker' is removal through the planeswalker (Lava Spike), and on a land it fills removal.land (Sunscorched Desert)", () => {
    expect(ruleMatches(rule, realCard("Lava Spike"), set)).toBe(true);
    expect(ruleMatches(land, realCard("Sunscorched Desert"), set)).toBe(true);
    expect(ruleMatches(rule, realCard("Sunscorched Desert"), set)).toBe(false);
  });
  test("a damage REDIRECT is not removal (owner ruling 2026-10-22): Harm's Way, Shining Shoal, Captain's Maneuver, Glarecaster, Mirrorwood Treefolk, Ward of Piety, Zhalfirin Crusader; nor damage the victim may have dealt (Requiem Monolith)", () => {
    for (const n of ["Harm's Way", "Shining Shoal", "Captain's Maneuver", "Glarecaster", "Mirrorwood Treefolk", "Ward of Piety", "Zhalfirin Crusader", "Requiem Monolith"]) expect(ruleMatches(rule, realCard(n), set), n).toBe(false);
  });
  test("prevent-then-deal DEALS the damage and stays removal (Refraction Trap, Divine Deflection, Vengeful Archon), and so does a trample overflow card (Ram Through)", () => {
    for (const n of ["Refraction Trap", "Divine Deflection", "Vengeful Archon", "Ram Through"]) expect(ruleMatches(rule, realCard(n), set), n).toBe(true);
  });
  test("damage that cannot reach a permanent is burn, not removal: 'target player' / 'target opponent' (Pyroclastic Elemental, Sudden Impact, Hired Claw, Fire and Brimstone), 'each opponent' (Purphoros), your own creature (Rile)", () => {
    for (const n of ["Pyroclastic Elemental", "Sudden Impact", "Hired Claw", "Fire and Brimstone", "Purphoros, God of the Forge", "Rile", "Anathemancer"]) expect(ruleMatches(rule, realCard(n), set), n).toBe(false);
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
  test("a coin-flip loss on your own creature is not removal (#1295 item 5): Orcish Captain's -0/-2 is the losing side of a flip that otherwise pumps an Orc", () => {
    expect(ruleMatches(rule, realCard("Orcish Captain"), set)).toBe(false);
  });
  test("permanents you OWN are refused, as the printed pattern refused 'you own': a bounce (Get Out, Leave // Chance) and a DELAYED flicker of your own creature (Charming Prince)", () => {
    for (const n of ["Get Out", "Leave // Chance", "Charming Prince"]) expect(ruleMatches(rule, blank(n), set), n).toBe(false);
  });
  test("ownership is checked per ability, not per clause (#1366): Word of Undoing's target bounce is removal though a second bounce in its clause is 'Auras you own'; Hubris (same shape) is too; Venser's +2 stays refused by its own emit", () => {
    for (const n of ["Word of Undoing", "Hubris"]) expect(ruleMatches(rule, blank(n), set), n).toBe(true);
    expect(ruleMatches(rule, blank("Venser, the Sojourner"), set)).toBe(false);
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

/** tutor.text reads a DERIVED printed search of your own library, and the keyword list for the keyword tutors (#1266). The oracle text is empty on every card here. */
describe("tutor.text is derived", () => {
  const set = loadRules();
  const rule = set.rules.find((r) => r.id === "tutor.text")!;
  const search = (librarySearch: "yours" | "other" | undefined, subject: object = { control: "you" }): DeckCard => ({
    card: { name: "x", oracleText: "", typeLine: "Sorcery", keywords: [] } as unknown as Card,
    tags: { abilities: [{ effect: { kind: "search", subject }, ...(librarySearch ? { librarySearch } : {}) }] } as never,
  });
  const keyworded = (keywords: string[]): DeckCard => ({ card: { name: "x", oracleText: "", typeLine: "Instant", keywords } as unknown as Card, tags: null });
  test("a printed search of your own library is a tutor with no oracle text", () => {
    expect(ruleMatches(rule, search("yours"), set)).toBe(true);
  });
  test("another player's search (Sphinx Ambassador), and a dig with no librarySearch, are not", () => {
    expect(ruleMatches(rule, search("other"), set)).toBe(false);
    expect(ruleMatches(rule, search(undefined), set)).toBe(false);
  });
  test("a search that only fetches lands is fixing, and a subject with no type is not land-only", () => {
    expect(ruleMatches(rule, search("yours", { control: "you", type: "land" }), set)).toBe(false);
    expect(ruleMatches(rule, search("yours", { control: "you", type: ["land"] }), set)).toBe(false);
    expect(ruleMatches(rule, search("yours", { control: "you", type: ["land", "creature"] }), set)).toBe(true);
    expect(ruleMatches(rule, search("yours", { control: "you", type: "creature" }), set)).toBe(true);
  });
  test("Transmute and Transfigure are tutors; Typecycling is, unless it is Landcycling (Brainspoil, Fleshwrither, Homing Sliver, Sojourner's Companion)", () => {
    expect(ruleMatches(rule, keyworded(["Transmute"]), set)).toBe(true);
    expect(ruleMatches(rule, keyworded(["Transfigure"]), set)).toBe(true);
    expect(ruleMatches(rule, keyworded(["Typecycling", "Cycling", "Slivercycling"]), set)).toBe(true);
    expect(ruleMatches(rule, keyworded(["Affinity", "Landcycling", "Typecycling", "Cycling"]), set)).toBe(false);
    expect(ruleMatches(rule, keyworded(["Cycling"]), set)).toBe(false);
  });
});

describe("tutor.text land-only refusal reads basic land types (#1266)", () => {
  const set = loadRules();
  const rule = set.rules.find((r) => r.id === "tutor.text")!;
  const search = (subject: object): DeckCard => ({ card: { name: "x", oracleText: "", typeLine: "Sorcery", keywords: [] } as unknown as Card, tags: { abilities: [{ effect: { kind: "search", subject }, librarySearch: "yours" }] } as never });
  test("a Mountain card, a basic Plains, Swamp or Forest card are land fetches (Alpine Guide, Abzan Monument); a basic-land-or-Shrine search is not land-only", () => {
    expect(ruleMatches(rule, search({ control: "you", subtype: "mountain" }), set)).toBe(false);
    expect(ruleMatches(rule, search({ control: "you", subtype: ["plains", "swamp", "forest"], basic: true }), set)).toBe(false);
    expect(ruleMatches(rule, search({ control: "any", anyOf: [{ type: "land" }, { subtype: "gate" }] }), set)).toBe(false);
    expect(ruleMatches(rule, search({ control: "you", type: ["mountain", "cave"] }), set)).toBe(false);
    expect(ruleMatches(rule, search({ control: "any", anyOf: [{ type: "land" }, { subtype: "shrine" }] }), set)).toBe(true);
    expect(ruleMatches(rule, search({ control: "any", named: "ajani, valiant protector" }), set)).toBe(true);
  });
});

describe("burn.effect and wincon.burn are derived (#1266)", () => {
  const set = loadRules();
  const rule = set.rules.find((r) => r.id === "burn.effect")!;
  const wincon = set.rules.find((r) => r.id === "wincon.burn")!;
  // Effects as derive 367 writes them for these cards (cardTagsDerived).
  const card = (abilities: object[], keywords: string[] = []): DeckCard => ({
    card: { name: "x", oracleText: "", typeLine: "Instant", keywords } as unknown as Card,
    tags: { abilities } as never,
  });
  const dmg = (subject?: object) => ({ effect: { kind: "damage", ...(subject ? { subject } : {}) } });
  const loss = (kind: string, subject?: object) => ({ effect: { kind, ...(subject ? { subject } : {}) } });
  const burn = (c: DeckCard) => ruleMatches(rule, c, set);
  test("Lightning Bolt (any target), Lava Spike (player anyOf) and Pestilence (creature and player) are burn", () => {
    expect(burn(card([dmg({ control: "any", token: null, scope: "target" })]))).toBe(true);
    expect(burn(card([dmg({ control: "any", token: null, scope: "target", anyOf: [{ player: true }, { type: "planeswalker" }] })]))).toBe(true);
    expect(burn(card([dmg({ control: "any", token: null, scope: "each", anyOf: [{ type: "creature" }, { player: true }] })]))).toBe(true);
  });
  test("damage to a creature only (Flame Slash) is removal, not burn", () => {
    expect(burn(card([dmg({ control: "any", token: null, type: "creature", scope: "target" })]))).toBe(false);
    expect(burn(card([dmg({ control: "any", token: null, scope: "target", anyOf: [{ type: "creature" }, { type: "planeswalker" }] })]))).toBe(false);
  });
  test("a branch inherits the parent's type: Sonar Strike's creature-only anyOf is not burn", () => {
    expect(burn(card([dmg({ control: "any", token: null, scope: "target", type: "creature", anyOf: [{ combat: "attacking" }, { combat: "blocking" }, { tapped: true }] })]))).toBe(false);
    expect(burn(card([dmg({ control: "any", token: null, type: "creature", anyOf: [{ scope: "target" }, { scope: "each", other: true }] })]))).toBe(false);
  });
  test("damage to you (Sell-Sword Brute) is not burn; to a target opponent (Caesar) is", () => {
    expect(burn(card([dmg({ control: "you", token: null })]))).toBe(false);
    expect(burn(card([dmg({ control: "opp", token: null, scope: "target" })]))).toBe(true);
  });
  test("life loss aimed at any player (Blood Artist) is burn; 'you lose 1 life' (Caesar) and a life total set (Arbiter of Knollridge) are not", () => {
    expect(burn(card([loss("player-life-loss", { control: "any", token: null, scope: "target" })]))).toBe(true);
    expect(burn(card([loss("drain", { control: "opp", token: null, scope: "each" })]))).toBe(true);
    expect(burn(card([loss("", undefined)]))).toBe(false);
    // A model-`static` clause keeps no effect subject; its emits decide (Granite Shard reads, Pariah's redirect to a creature does not).
    const withEmit = (kind: string, verb: string, subject: object) => ({ effect: { kind }, emits: [{ verb, subject }] });
    expect(burn(card([withEmit("damage", "non-combat-damage", { control: "any", token: null, scope: "target" })]))).toBe(true);
    expect(burn(card([withEmit("player-life-loss", "lose-life", { control: "opp", token: null, scope: "each" })]))).toBe(true);
    expect(burn(card([withEmit("damage", "non-combat-damage", { control: "any", token: null, type: "creature" })]))).toBe(false);
    expect(burn(card([withEmit("damage", "non-combat-damage", { control: "any", token: null, self: true })]))).toBe(false);
    expect(burn(card([dmg()]))).toBe(false);
    expect(burn(card([loss("player-life-loss", { control: "you", token: null })]))).toBe(false);
    expect(burn(card([]))).toBe(false);
  });
  test("an Extort card (Syndic of Tithes) is burn by its keyword, since the drain is only reminder text", () => {
    expect(burn(card([], ["Extort"]))).toBe(true);
  });
  test("wincon.burn reads the same signal", () => {
    expect(ruleMatches(wincon, card([dmg({ control: "any", token: null, scope: "target" })]), set)).toBe(true);
    expect(ruleMatches(wincon, card([], ["Extort"]), set)).toBe(true);
    expect(ruleMatches(wincon, card([dmg({ control: "you", token: null })]), set)).toBe(false);
    expect(ruleMatches(wincon, card([dmg({ control: "any", token: null, type: "creature", scope: "target" })]), set)).toBe(false);
  });
  test("the printed `burn` pattern is gone: oracle text alone is no burn", () => {
    expect(burn({ card: { name: "x", oracleText: "X deals 3 damage to any target.", typeLine: "Instant", keywords: [] } as unknown as Card, tags: null })).toBe(false);
  });
});

describe("wincon.mill and wincon.altWin are derived (#1266)", () => {
  const set = loadRules();
  const mill = set.rules.find((r) => r.id === "wincon.mill")!;
  const altWin = set.rules.find((r) => r.id === "wincon.altWin")!;
  const is = (rule: Rule, name: string): boolean => ruleMatches(rule, realCard(name), set);
  test("an opponent's or any player's mill is a mill plan (Traumatize, Anowon, Minister of Inquiries, Countermand)", () => {
    for (const n of ["Traumatize", "Anowon, the Ruin Thief", "Minister of Inquiries", "Countermand"]) expect(is(mill, n), n).toBe(true);
    // Chancellor of the Spires: the effect names no subject, the emit does.
    expect(is(mill, "Chancellor of the Spires")).toBe(true);
  });
  test("your own mill is fuel, not a plan (Dogmeat)", () => {
    expect(is(mill, "Dogmeat, Ever Loyal")).toBe(false);
  });
  test("a dig's remainder into the graveyard is not a mill (Fact or Fiction, Hermit Druid)", () => {
    expect(is(mill, "Fact or Fiction")).toBe(false);
    expect(is(mill, "Hermit Druid")).toBe(false);
  });
  test("manifest dread's graveyard half is no mill: its emit sits under a kind-less ability (Manifest Dread)", () => {
    expect(is(mill, "Manifest Dread")).toBe(false);
  });
  test("exiling the top of a library is no mill (derive 368: Sire of Stagnation, Ulamog)", () => {
    expect(is(mill, "Sire of Stagnation")).toBe(false);
    expect(is(mill, "Ulamog, the Ceaseless Hunger")).toBe(false);
  });
  test("a win is an alternate win condition: the win-game kind, or an opponent's loss (Epic Struggle, Phage)", () => {
    expect(is(altWin, "Epic Struggle")).toBe(true);
    expect(is(altWin, "Phage the Untouchable")).toBe(true);
  });
  test("YOUR OWN LOSS is never a payoff (owner 2026-10-16, #1252): Demonic Pact, Lich's Mastery", () => {
    expect(is(altWin, "Demonic Pact")).toBe(false);
    expect(is(altWin, "Lich's Mastery")).toBe(false);
  });
  test("reminder text and a reaction to a loss are no win condition (Marsh Viper's poison reminder, Blood Tyrant)", () => {
    expect(is(altWin, "Marsh Viper")).toBe(false);
    expect(is(altWin, "Blood Tyrant")).toBe(false);
  });
});

/** #1315: `wincon.voltron` reads the Enchant line and the host-effect abilities, not the printed text. Real derived rows (derive 374). */
test("an Aura is voltron when it helps the creature it enchants, and not when it hurts or takes it", () => {
  const voltron = (name: string): boolean => (detectWincons([realAura(name)]).get("voltron") ?? new Set()).has(name);
  // Helps: pump, keyword, speed-increase, evasion, regenerate, umbra armor, an Aura only your creature can wear, and ruled either-or / conditional buffs (owner 2026-10-22).
  for (const n of ["Rancor", "Ethereal Armor", "Aqueous Form", "Battle Mastery", "Regeneration", "Crab Umbra", "Dying Wish", "Spirit Loop", "Clutch of Undeath", "Fists of the Demigod", "Inner Demon", "Mishra's Domination"]) {
    expect(voltron(n), n).toBe(true);
  }
  // Hurts or takes it, or helps nothing: removal, goad, control, shrink, defender and phasing grants, a pump with no amount, a can't-attack restriction.
  for (const n of ["Pacifism", "Shiny Impetus", "Deep Freeze", "Cursed Flesh", "Sky Tether", "Control Magic", "Frenzied Fugue", "Dream Coat", "Mistform Mask", "Teferi's Curse", "Nurgle's Rot", "Eaten by Piranhas", "Arrest", "Utopia Vow", "Compulsory Rest", "Darksteel Mutation", "Minimus Containment"]) {
    expect(voltron(n), n).toBe(false);
  }
  // Equipment is still voltron by its subtype, and a non-Aura with a host-less pump is not.
  expect(voltron("Bonesplitter")).toBe(true);
  expect(voltron("Hall of Triumph")).toBe(false);
});

/** Owner 2026-10-22 ("judge the quote"): an Aura that hands the creature a QUOTED ability is a buff unless the quote is a curse (a sacrifice, a death, life lost or damage dealt to the grantee). */
test("a quoted grant is voltron when the granted ability is no curse", () => {
  const voltron = (name: string): boolean => (detectWincons([realAura(name)]).get("voltron") ?? new Set()).has(name);
  for (const n of ["Sunbond", "Splinter Twin", "Idolized", "Dragon Mantle", "Shade's Form", "Malicious Intent", "Mark of Sakiko", "Power of Fire", "Shifting Shadow", "Crystalline Nautilus"]) expect(voltron(n), n).toBe(true);
  // Curses: sacrifice the creature or a creature, lose life; and Pillory also forbids attacking.
  for (const n of ["Pendrell Flux", "Necrotic Plague", "Inevitable End", "Instill Furor", "Withercrown", "Pillory of the Sleepless"]) expect(voltron(n), n).toBe(false);
  // The quoted-curse check only stops a quote from being the POSITIVE: Shifting Shadow and Crystalline Nautilus carry another one (a pump, an evasion) and stay voltron.
  // CEILING: a quote derive wrote no child ability for (Oblivion Crown's discard cost) is not judged, so it is not counted.
  expect(voltron("Oblivion Crown")).toBe(false);
});

/** The owner's correction of the brief: bestow creatures, Licids and the Cloudform family are not Auras by subtype but act as one. */
test("a non-Aura card that buffs what it is attached to is voltron", () => {
  const voltron = (name: string): boolean => (detectWincons([realAura(name)]).get("voltron") ?? new Set()).has(name);
  for (const n of ["Nyxborn Wolf", "Boon Satyr", "Cloudform", "Lightform", "Rageform", "Corrupting Licid", "Kestia, the Cultivator"]) expect(voltron(n), n).toBe(true);
  // Takes the creature (Hypnotic Siren), or has no host buff at all.
  for (const n of ["Hypnotic Siren", "Estrid, the Masked", "Not Dead After All", "Living Lectern", "Curse of the Werefox", "Umbra Mystic"]) expect(voltron(n), n).toBe(false);
});

/** #1326: the printed `graveyardHate` guard on removal.targeted / removal.land refused any card whose text exiled from a graveyard ANYWHERE: a cost (Grim Lavamancer), an escape line (Phlage),
 *  a delve reminder (Magmatic Sinkhole). Real derived rows. Paired with graveyard hate that deals no damage, kills nothing and stays out: either half alone passes with a broken rule. */
test("an exile from your own graveyard in a cost, escape or delve line does not stop targeted damage being removal", () => {
  const removal = detectBuildCategories(["Grim Lavamancer", "Phlage, Titan of Fire's Fury", "Magmatic Sinkhole", "Harvest Pyre", "Molten-Tail Masticore"].map((n) => realCard(n))).get("targetedRemoval") ?? new Set<string>();
  for (const n of ["Grim Lavamancer", "Phlage, Titan of Fire's Fury", "Magmatic Sinkhole", "Harvest Pyre", "Molten-Tail Masticore"]) expect(removal.has(n), n).toBe(true);
});

test("graveyard hate that removes nothing from the battlefield is still not targeted removal", () => {
  const hate = ["Bojuka Bog", "Relic of Progenitus", "Tormod's Crypt", "Soul-Guide Lantern", "Nihil Spellbomb", "Scavenging Ooze", "Rest in Peace"];
  const removal = detectBuildCategories(hate.map((n) => realCard(n))).get("targetedRemoval") ?? new Set<string>();
  for (const n of hate) expect(removal.has(n), n).toBe(false);
});

describe("handFill: cards put from your library into your hand are card advantage, not draw (#1302)", () => {
  const roles = (name: string): string[] => {
    const m = detectBuildCategories([realCard(name)]);
    return [...m.entries()].filter(([, s]) => s.has(name)).map(([k]) => k).sort();
  };
  test("a reveal, a pile, two of a look, or all of a type fill handFill (owner 2026-10-22)", () => {
    // Dark Confidant, Ad Nauseam, Darkstar-style reveals: one card, no pick (Demonic Consultation is a tutor now: see below).
    for (const n of ["Dark Confidant", "Ad Nauseam", "Fact or Fiction", "Dig Through Time", "Winding Way", "Tamiyo, Collector of Tales"]) {
      expect(roles(n), n).toContain("handFill");
    }
    expect(roles("Coiling Oracle")).toContain("handFill");
  });
  test("every card of a type (Winding Way) is a typed dig: handFill through `handFill.dig`, not `handFill.effect`", () => {
    const set = loadRules(), card = realCard("Winding Way");
    expect(card.tags!.abilities.some((a) => a.effect.kind === "search" && a.toHand === "all")).toBe(true);
    expect(ruleMatches(set.rules.find((r) => r.id === "handFill.dig")!, card, set)).toBe(true);
    expect(ruleMatches(set.rules.find((r) => r.id === "handFill.effect")!, card, set)).toBe(false);
  });
  test("handFill.dig refuses a dig that reveals until a named card, a pick of one, and a net-zero swap", () => {
    const set = loadRules(), rule = set.rules.find((r) => r.id === "handFill.dig")!;
    const dig = (extra: Record<string, unknown>) => ({ ...mk("Dig", ""), tags: { abilities: [{ kind: "spell", effect: { kind: "search" }, toHand: "1", ...extra }] } }) as never;
    expect(ruleMatches(rule, dig({}), set)).toBe(true);
    expect(ruleMatches(rule, dig({ named: true }), set)).toBe(false);
    expect(ruleMatches(rule, dig({ netZero: true }), set)).toBe(false);
    expect(ruleMatches(rule, dig({ chooses: true }), set)).toBe(false);
    expect(ruleMatches(rule, dig({ chooses: true, toHand: "2" }), set)).toBe(true);
  });
  test("YOUR one pick from a typed look is card selection, whatever the object says (Augur of Bolas, Boughside Wanderers, Break Out, Follow the Lumarets' base case)", () => {
    for (const n of ["Augur of Bolas", "Boughside Wanderers", "Break Out", "Follow the Lumarets"]) {
      expect(roles(n), n).toContain("cardSelection");
      expect(roles(n), n).not.toContain("handFill");
    }
  });
  test("two named classes, a list of four, and three picks in a row are cards to hand (Kiora, Gift of the Gargantuan, Harper Recruiter, Memories Returning)", () => {
    for (const n of ["Kiora, Master of the Depths", "Gift of the Gargantuan", "Harper Recruiter", "Memories Returning"]) expect(roles(n), n).toContain("handFill");
  });
  test("they are no longer draw (the 2026-10-02 `draw.dig` line is reversed)", () => {
    for (const n of ["Fact or Fiction", "Dig Through Time", "Dark Confidant", "Ad Nauseam"]) expect(roles(n), n).not.toContain("draw");
  });
  test("one card chosen from a larger look is still card selection (owner 2026-10-02: Impulse, Browse)", () => {
    for (const n of ["Impulse", "Browse"]) {
      expect(roles(n), n).toContain("cardSelection");
      expect(roles(n), n).not.toContain("handFill");
    }
    // An Impulse that upgrades to two or all on a condition keeps its base case.
    for (const n of ["Accumulate Wisdom", "Flow State"]) expect(roles(n), n).not.toContain("handFill");
  });
  test("a dig for a CLASS is cards to hand too, and keeps its search kind for the tutor edges (owner 2026-10-22)", () => {
    // Archghoul ("If it's a Zombie card"), Eclipsed Flamekin (up to one card of three types), Narset Transcendent, Yuna's Whistle (reveal until a creature), Atraxa (one per card type).
    for (const n of ["Archghoul of Thraben", "Narset Transcendent", "Yuna's Whistle", "Atraxa, Grand Unifier", "Dryad Greenseeker"]) {
      const r = roles(n);
      expect(r, n).toContain("handFill");
      expect(r, n).not.toContain("tutor");
    }
    expect(realCard("Archghoul of Thraben").tags!.abilities.some((a) => a.effect.kind === "search" && a.toHand === "1")).toBe(true);
    // One card YOU pick from a typed look is the Impulse line: card selection, not hand-fill.
    for (const n of ["Eclipsed Flamekin", "Gather the Pack", "Thundertrap Trainer"]) {
      expect(roles(n), n).toContain("cardSelection");
      expect(roles(n), n).not.toContain("handFill");
    }
    // A PRINTED search of your library stays a tutor and is no hand-fill.
    expect(roles("Demonic Tutor")).toContain("tutor");
    expect(roles("Demonic Tutor")).not.toContain("handFill");
  });
  test("a net-zero swap or draw replacement is card selection, not hand-fill (Scroll Rack, Abundance, Underrealm Lich)", () => {
    for (const n of ["Scroll Rack", "Abundance", "Underrealm Lich"]) {
      expect(roles(n), n).toContain("cardSelection");
      expect(roles(n), n).not.toContain("handFill");
    }
  });
  test("a reveal-until-a-NAMED-card is a tutor with no printed search; taking every hit of a name is not (owner 2026-10-22)", () => {
    for (const n of ["Demonic Consultation", "Divining Witch", "Spoils of the Vault"]) {
      expect(roles(n), n).toContain("tutor");
      expect(roles(n), n).not.toContain("handFill");
    }
    for (const n of ["Desperate Research", "Tamiyo, Collector of Tales"]) {
      expect(roles(n), n).toContain("handFill");
      expect(roles(n), n).not.toContain("tutor");
    }
  });
  test("an opponent's pick of the CARD is not your choice (Karn: hand-fill), a pick of your own (Eye of Yawgmoth, Truth or Tale) is selection", () => {
    expect(roles("Karn, Scion of Urza")).toContain("handFill");
    // Truth or Tale: the opponent picks the PILE, YOU pick the card from it: your own one-of-N pick.
    expect(roles("Truth or Tale")).toContain("cardSelection");
    expect(roles("Truth or Tale")).not.toContain("handFill");
    expect(roles("Eye of Yawgmoth")).toContain("cardSelection");
    expect(roles("Eye of Yawgmoth")).not.toContain("handFill");
    expect(roles("Genesis Ultimatum")).toContain("handFill");
  });
  test("a printed draw is unchanged (Divination)", () => {
    expect(roles("Divination")).toContain("draw");
    expect(roles("Divination")).not.toContain("handFill");
  });
  test("the old printed pattern is gone", () => {
    expect(loadRules().patterns["digToHand"]).toBeUndefined();
    expect(loadRules().rules.find((r) => r.id === "draw.dig")).toBeUndefined();
  });
});
