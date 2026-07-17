import { expect, test } from "vitest";
import { synergyScore } from "./synergy.js";
import { extractTags } from "./tags.js";
import { FIXTURES } from "./fixtures.js";

test("Goblin tribal: chieftain + recruiter synergize on tribe:goblin", () => {
  const r = synergyScore(FIXTURES.goblinChieftain, FIXTURES.goblinRecruiter);
  expect(r.score).toBeGreaterThan(0);
  expect(r.reasons.some((x) => x.tag === "tribe:goblin")).toBe(true);
});

test("Spellslinger: Lightning Bolt + Archmage Emeritus synergize on cast:instant", () => {
  const r = synergyScore(FIXTURES.lightningBolt, FIXTURES.archmageEmeritus);
  expect(r.reasons.some((x) => x.tag === "cast:instant")).toBe(true);
});

test("Negation: negated 'sacrifice a creature' clause is not a sacrifice outlet (a real outlet still is)", () => {
  // plan case: an unrelated non-sacrifice card is not tagged
  expect(extractTags(FIXTURES.guardianOfFaith).produces.has("sacrifice-event")).toBe(false);
  // the real matcher needle "sacrifice a creature" sits inside a negated ("can't") clause,
  // so hasClause's negation-skip must keep it from being tagged as a sacrifice outlet
  expect(extractTags(FIXTURES.sacImmunity).produces.has("sacrifice-event")).toBe(false);
  // positive control: the same needle un-negated DOES produce the tag,
  // proving the needle is real and the test above is meaningful
  expect(extractTags(FIXTURES.ashnods).produces.has("sacrifice-event")).toBe(true);
});

test("Regression: Treasure maker still pays off an artifact payoff", () => {
  const r = synergyScore(FIXTURES.dockside, FIXTURES.fireweaver);
  expect(r.reasons.some((x) => x.tag === "artifact")).toBe(true);
});

test("Regression: token maker still triggers a creature-ETB payoff", () => {
  const r = synergyScore(FIXTURES.krenko, FIXTURES.impactTremors);
  expect(r.reasons.some((x) => x.tag === "creature-etb")).toBe(true);
});

test("Graveyard: self-mill + reanimator synergize on graveyard", () => {
  const r = synergyScore(FIXTURES.stitchersSupplier, FIXTURES.gravedigger);
  expect(r.score).toBeGreaterThan(0);
  expect(r.reasons.some((x) => x.tag === "graveyard")).toBe(true);
});

test("Lifegain: source + payoff synergize on lifegain", () => {
  const r = synergyScore(FIXTURES.soulWarden, FIXTURES.archangelOfThune);
  expect(r.score).toBeGreaterThan(0);
  expect(r.reasons.some((x) => x.tag === "lifegain")).toBe(true);
});

test("Blink: flicker spell + own-ETB value creature synergize on blink", () => {
  const r = synergyScore(FIXTURES.ephemerate, FIXTURES.mulldrifter);
  expect(r.score).toBeGreaterThan(0);
  expect(r.reasons.some((x) => x.tag === "blink")).toBe(true);
});

test("Blink does not synergize with a token-maker (tokens cease to exist when blinked)", () => {
  const r = synergyScore(FIXTURES.ephemerate, FIXTURES.krenko);
  expect(r.score).toBe(0);
  expect(r.reasons).toHaveLength(0);
});

test("Blink synergizes with a nontoken ETB-value creature", () => {
  const r = synergyScore(FIXTURES.ephemerate, FIXTURES.mulldrifter);
  expect(r.score).toBeGreaterThan(0);
  expect(r.reasons.some((x) => x.tag === "blink" || x.tag === "nontoken-etb")).toBe(true);
});

test("A creature-enters pinger still synergizes with a token-maker (tokens count for pingers)", () => {
  const r = synergyScore(FIXTURES.krenko, FIXTURES.impactTremors);
  expect(r.reasons.some((x) => x.tag === "creature-etb")).toBe(true);
});

test("Enchantress: an enchantment + a cast-enchantment payoff synergize on enchantment", () => {
  const r = synergyScore(FIXTURES.wildGrowth, FIXTURES.enchantressPresence);
  expect(r.score).toBeGreaterThan(0);
  expect(r.reasons.some((x) => x.tag === "enchantment")).toBe(true);
});

test("Equipment: an Equipment + an equipment payoff synergize on equipment", () => {
  const r = synergyScore(FIXTURES.bonesplitter, FIXTURES.puresteelPaladin);
  expect(r.score).toBeGreaterThan(0);
  expect(r.reasons.some((x) => x.tag === "equipment")).toBe(true);
});

test("Counters: a Modular creature + a proliferate card synergize on +1/+1 counters", () => {
  const r = synergyScore(FIXTURES.arcboundRavager, FIXTURES.evolutionSage);
  expect(r.score).toBeGreaterThan(0);
  expect(r.reasons.some((x) => x.tag === "counter:+1/+1")).toBe(true);
});

test("Attack-matters: an attacker-trigger creature + Isshin synergize on attack-trigger", () => {
  const r = synergyScore(FIXTURES.goblinRabblemaster, FIXTURES.isshin);
  expect(r.score).toBeGreaterThan(0);
  expect(r.reasons.some((x) => x.tag === "attack-trigger")).toBe(true);
});

test("Graveyard-recursion: an Unearth creature + a self-mill card synergize on graveyard", () => {
  const r = synergyScore(FIXTURES.anathemancer, FIXTURES.stitchersSupplier);
  expect(r.score).toBeGreaterThan(0);
  expect(r.reasons.some((x) => x.tag === "graveyard")).toBe(true);
});

test("Tokens: a Fabricate creature + a token doubler synergize on token", () => {
  const r = synergyScore(FIXTURES.angelOfInvention, FIXTURES.parallelLives);
  expect(r.score).toBeGreaterThan(0);
  expect(r.reasons.some((x) => x.tag === "token")).toBe(true);
});

test("Spellslinger: Monastery Swiftspear + Lightning Bolt synergize on cast:instant", () => {
  const r = synergyScore(FIXTURES.monasterySwiftspear, FIXTURES.lightningBolt);
  expect(r.score).toBeGreaterThan(0);
  expect(r.reasons.some((x) => x.tag === "cast:instant")).toBe(true);
});

test("Aristocrats: an afterlife creature + Blood Artist synergize on creature-death", () => {
  const r = synergyScore(FIXTURES.titheTaker, FIXTURES.bloodArtist);
  expect(r.score).toBeGreaterThan(0);
  expect(r.reasons.some((x) => x.tag === "creature-death")).toBe(true);
});

test("Aristocrats: a devour sac outlet + Blood Artist synergize on sacrifice-event", () => {
  const r = synergyScore(FIXTURES.mycoloth, FIXTURES.bloodArtist);
  expect(r.score).toBeGreaterThan(0);
  expect(r.reasons.some((x) => x.tag === "sacrifice-event")).toBe(true);
});

test("Ramp: Cultivate + Craterhoof Behemoth synergize on ramp", () => {
  const r = synergyScore(FIXTURES.cultivate, FIXTURES.craterhoofBehemoth);
  expect(r.score).toBeGreaterThan(0);
  expect(r.reasons.some((x) => x.tag === "ramp")).toBe(true);
});

test("Keyword-actions: Thraben Inspector (investigate) + Reckless Fireweaver synergize on artifact", () => {
  const r = synergyScore(FIXTURES.thrabenInspector, FIXTURES.fireweaver);
  expect(r.score).toBeGreaterThan(0);
  expect(r.reasons.some((x) => x.tag === "artifact")).toBe(true);
});

test("Keyword-actions: Whisperwood Elemental (manifest) + Impact Tremors synergize on creature-etb", () => {
  const r = synergyScore(FIXTURES.whisperwoodElemental, FIXTURES.impactTremors);
  expect(r.score).toBeGreaterThan(0);
  expect(r.reasons.some((x) => x.tag === "creature-etb")).toBe(true);
});

test("Auras: Rancor + Kor Spiritdancer synergize on aura", () => {
  const r = synergyScore(FIXTURES.rancor, FIXTURES.korSpiritdancer);
  expect(r.score).toBeGreaterThan(0);
  expect(r.reasons.some((x) => x.tag === "aura")).toBe(true);
});

test("Attack-matters: a Mobilize creature + Isshin synergize on attack-trigger", () => {
  const mobilizer = {
    name: "Salt Road Skirmisher",
    typeLine: "Creature — Rabbit Warrior",
    oracleText: "Mobilize 2.",
    keywords: ["Mobilize"],
    colors: ["R"],
    manaValue: 3,
  };
  const r = synergyScore(mobilizer, FIXTURES.isshin);
  expect(r.score).toBeGreaterThan(0);
  expect(r.reasons.some((x) => x.tag === "attack-trigger")).toBe(true);
});

test("Graveyard-count: a threshold payoff + Stitcher's Supplier synergize on graveyard", () => {
  const nimbleMongoose = {
    name: "Nimble Mongoose",
    typeLine: "Creature — Snake",
    oracleText: "Threshold — Nimble Mongoose gets +2/+2 as long as seven or more cards are in your graveyard.",
    keywords: [],
    colors: ["G"],
    manaValue: 1,
  };
  const r = synergyScore(nimbleMongoose, FIXTURES.stitchersSupplier);
  expect(r.score).toBeGreaterThan(0);
  expect(r.reasons.some((x) => x.tag === "graveyard")).toBe(true);
});

test("Morbid: a morbid payoff + Tithe Taker synergize on creature-death", () => {
  const tragicSlip = {
    name: "Tragic Slip",
    typeLine: "Instant",
    oracleText: "Target creature gets -1/-1 until end of turn. Morbid — That creature gets -13/-13 instead if a creature died this turn.",
    keywords: [],
    colors: ["B"],
    manaValue: 1,
  };
  const r = synergyScore(tragicSlip, FIXTURES.titheTaker);
  expect(r.score).toBeGreaterThan(0);
  expect(r.reasons.some((x) => x.tag === "creature-death")).toBe(true);
});

test("Lifegain: an extort creature + Archangel of Thune synergize on lifegain", () => {
  const kingpinsPet = {
    name: "Kingpin's Pet",
    typeLine: "Creature — Vampire",
    oracleText: "Flying. Extort.",
    keywords: ["Flying", "Extort"],
    colors: ["W", "B"],
    manaValue: 3,
  };
  const r = synergyScore(kingpinsPet, FIXTURES.archangelOfThune);
  expect(r.score).toBeGreaterThan(0);
  expect(r.reasons.some((x) => x.tag === "lifegain")).toBe(true);
});

test("Metalcraft: a metalcraft payoff + Dockside Extortionist synergize on artifact", () => {
  const ardentRecruit = {
    name: "Ardent Recruit",
    typeLine: "Creature — Human Soldier",
    oracleText: "Metalcraft — Ardent Recruit gets +1/+1 as long as you control three or more artifacts.",
    keywords: [],
    colors: ["W"],
    manaValue: 1,
  };
  const r = synergyScore(ardentRecruit, FIXTURES.dockside);
  expect(r.score).toBeGreaterThan(0);
  expect(r.reasons.some((x) => x.tag === "artifact")).toBe(true);
});

test("Eerie: an eerie payoff + Wild Growth synergize on enchantment", () => {
  const overgrownPest = {
    name: "Overgrown Pest",
    typeLine: "Creature — Insect",
    oracleText: "Eerie — Whenever an enchantment enters the battlefield under your control, put a +1/+1 counter on this creature.",
    keywords: [],
    colors: ["G"],
    manaValue: 2,
  };
  const r = synergyScore(overgrownPest, FIXTURES.wildGrowth);
  expect(r.score).toBeGreaterThan(0);
  expect(r.reasons.some((x) => x.tag === "enchantment")).toBe(true);
});

test("Celebration: a celebration payoff + Krenko synergize on token", () => {
  const festivalCrasher = {
    name: "Festival Crasher",
    typeLine: "Creature — Human",
    oracleText: "Celebration — Festival Crasher gets +2/+2 as long as two or more nonland permanents entered this turn.",
    keywords: [],
    colors: ["R"],
    manaValue: 2,
  };
  const r = synergyScore(festivalCrasher, FIXTURES.krenko);
  expect(r.score).toBeGreaterThan(0);
  expect(r.reasons.some((x) => x.tag === "token")).toBe(true);
});

test("Offspring: an offspring creature + Parallel Lives synergize on token", () => {
  const deepCavernBat = {
    name: "Deep-Cavern Bat",
    typeLine: "Creature — Bat",
    oracleText: "Flying. Offspring {2}. When this creature enters, exile target nonland card from an opponent's hand.",
    keywords: ["Flying", "Offspring"],
    colors: ["B"],
    manaValue: 2,
  };
  const r = synergyScore(deepCavernBat, FIXTURES.parallelLives);
  expect(r.score).toBeGreaterThan(0);
  expect(r.reasons.some((x) => x.tag === "token")).toBe(true);
});

test("Renown: a renown creature + Evolution Sage synergize on +1/+1 counters", () => {
  const kytheonsIrregulars = {
    name: "Kytheon's Irregulars",
    typeLine: "Creature — Human Soldier",
    oracleText: "Renown 2. Whenever this creature attacks, tap target creature defending player controls.",
    keywords: ["Renown"],
    colors: ["W"],
    manaValue: 3,
  };
  const r = synergyScore(kytheonsIrregulars, FIXTURES.evolutionSage);
  expect(r.score).toBeGreaterThan(0);
  expect(r.reasons.some((x) => x.tag === "counter:+1/+1")).toBe(true);
});

test("Chosen-type: Kindred Discovery pays off a Wizard producer (wildcard care)", () => {
  const r = synergyScore(FIXTURES.kindredDiscovery, FIXTURES.archmageOfEchoes);
  expect(r.score).toBeGreaterThan(0);
  const wild = r.reasons.find((x) => x.text.includes("any creature type"));
  expect(wild).toBeDefined();
  expect(wild!.tag.startsWith("tribe:")).toBe(true);
});

test("Tribal cast: Archmage of Echoes pays off a Wizard producer", () => {
  const r = synergyScore(FIXTURES.archmageOfEchoes, FIXTURES.academyWizard);
  expect(r.reasons.some((x) => x.tag === "tribe:wizard")).toBe(true);
});

test("Changeling: producer wildcard pays off a concrete tribal payoff", () => {
  const r = synergyScore(FIXTURES.changelingHost, FIXTURES.goblinChieftain);
  expect(r.score).toBeGreaterThan(0);
  expect(r.reasons.some((x) => x.tag === "tribe:goblin" && x.text.includes("any creature type"))).toBe(true);
});

test("Party: payoff pays off a Wizard producer", () => {
  const r = synergyScore(FIXTURES.partyPayoff, FIXTURES.academyWizard);
  expect(r.reasons.some((x) => x.tag === "tribe:wizard")).toBe(true);
});

test("Dedup: a payoff caring a concrete tribe AND the wildcard yields one reason, not two", () => {
  const r = synergyScore(FIXTURES.academyWizard, FIXTURES.dualTribalPayoff);
  expect(r.reasons.length).toBe(1);
});

test("A wizard lord synergizes with a card that makes Wizard tokens", () => {
  const r = synergyScore(FIXTURES.wizardLord, FIXTURES.wizardTokenMaker);
  expect(r.reasons.some((x) => x.tag === "tribe:wizard")).toBe(true);
});

test("token-tribe detection does not cross a sentence boundary (a payoff type is not the token's type)", () => {
  // "Create three ... creature tokens. When an Elf enters ..." must NOT read Elf as the token type.
  expect(extractTags(FIXTURES.decoyTokenMaker).produces.has("tribe:elf")).toBe(false);
});

test("A nontoken-Wizard payoff does NOT synergize with a Wizard-token maker", () => {
  const r = synergyScore(FIXTURES.nontokenWizardPayoff, FIXTURES.wizardTokenMaker);
  expect(r.reasons.some((x) => x.tag === "tribe-nontoken:wizard")).toBe(false);
});

test("A nontoken-Wizard payoff synergizes with a printed (nontoken) Wizard", () => {
  const r = synergyScore(FIXTURES.nontokenWizardPayoff, FIXTURES.academyWizard);
  expect(r.reasons.some((x) => x.tag === "tribe-nontoken:wizard")).toBe(true);
});
