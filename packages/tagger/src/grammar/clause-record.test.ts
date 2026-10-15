import { expect, test } from "vitest";
import { grammarClauseRecords, phaseControl, triggerSubjectText } from "./clause-record.js";

// #896 task 7: clause records from printed text alone.
test("a card the grammar reads completely gets one record per clause, in the store's shape", () => {
  const farseek = grammarClauseRecords({ name: "Farseek", typeLine: "Sorcery", oracleText: "Search your library for a Plains, Island, Swamp, or Mountain card, put it onto the battlefield tapped, then shuffle." });
  expect(farseek.complete).toBe(true);
  const [rec] = farseek.records;
  expect(rec).toMatchObject({ id: 1, abilityType: "spell" });
  // The back-reference keeps its printed words, and comes from the library the search named.
  expect(rec!.actions!.find((a) => a.verb === "put")).toMatchObject({ object: "it", fromZone: "library", toZone: "battlefield" });
});

test("a clause the grammar cannot read blocks the card, and says which", () => {
  const g = grammarClauseRecords({ name: "X", typeLine: "Sorcery", oracleText: "Redistribute any number of players' life totals." });
  expect(g.complete).toBe(false);
  expect(g.blocker).toMatchObject({ clause: 1, kind: "action" });
});

test("a trigger's subject is what the event happens to, and an actor trigger's object", () => {
  expect(triggerSubjectText("Whenever this creature or another creature dies")).toBe("this creature or another creature");
  expect(triggerSubjectText("Whenever you discard a card")).toBe("a card");
});

test("a self trigger's first 'it' is the card itself, and a player verb names its player", () => {
  const junk = grammarClauseRecords({ name: "Wall of Junk", typeLine: "Artifact Creature — Wall", oracleText: "When this creature blocks, return it to its owner's hand at end of combat." });
  expect(junk.records[0]!.actions![0]).toMatchObject({ verb: "return", object: "this creature" });
  const barrier = grammarClauseRecords({ name: "Barrier of Bones", typeLine: "Creature — Skeleton Wall", oracleText: "When this creature enters, surveil 1." });
  expect(barrier.records[0]!.actions![0]).toMatchObject({ verb: "surveil", amount: "1" });
});

test("a phase trigger's subject is whose phase", () => {
  expect(triggerSubjectText("At the beginning of your upkeep")).toBe("you");
  expect(triggerSubjectText("At the beginning of each upkeep")).toBe("each player");
});

test("a proliferate chooses any permanent; support names other creatures; a token list is one create per kind", () => {
  const tide = grammarClauseRecords({ name: "Inexorable Tide", typeLine: "Enchantment", oracleText: "Whenever you cast a spell, proliferate." });
  expect(tide.records[0]!.actions![0]).toMatchObject({ verb: "proliferate", object: "any" });
  const patron = grammarClauseRecords({ name: "Generous Patron", typeLine: "Creature — Elf Advisor", oracleText: "When this creature enters, support 2." });
  expect(patron.records[0]!.actions![0]).toMatchObject({ verb: "support", object: "other target creatures", amount: "2" });
  const cotton = grammarClauseRecords({ name: "Farmer Cotton", typeLine: "Legendary Creature — Halfling Peasant", oracleText: "When this creature enters, create X 1/1 white Halfling creature tokens and X Food tokens." });
  expect(cotton.records[0]!.actions!.map((a) => a.object)).toEqual(["X 1/1 white Halfling creature tokens", "X Food tokens"]);
});

test("spells given affinity are a cost reduction, the store's form", () => {
  const pearl = grammarClauseRecords({ name: "Pearl-Ear, Imperial Advisor", typeLine: "Legendary Creature — Fox Advisor", oracleText: "Enchantment spells you cast have affinity for Auras." });
  expect(pearl.records[0]!.actions![0]).toMatchObject({ verb: "cost-modify" });
});

test("a phase trigger's control is whose turns it watches", () => {
  expect(phaseControl("At the beginning of your upkeep")).toBe("you");
  expect(phaseControl("At the beginning of combat on your turn")).toBe("you");
  expect(phaseControl("At the beginning of each opponent's upkeep")).toBe("opp");
  expect(phaseControl("At the beginning of each combat")).toBe("any");
  expect(phaseControl("At the beginning of each player's draw step")).toBe("any");
});

test("labelling round 1: payments, antecedents, amounts and delayed triggers as the store writes them", () => {
  const one = (name: string, typeLine: string, oracleText: string) => grammarClauseRecords({ name, typeLine, oracleText }).records;
  // A "can't ... unless ... pays" keeps its payment apart.
  expect(one("Propaganda", "Enchantment", "Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.")[0]!.actions![0])
    .toMatchObject({ verb: "cant", object: "attack you", unless: { cost: "{2} for each creature they control that's attacking you", payer: "controller" } });
  // "untap it" after a target is that target; "its controller investigates" is that player.
  expect(one("High Stride", "Instant", "Target creature gets +1/+3 and gains reach until end of turn. Untap it.")[0]!.actions!.at(-1)).toMatchObject({ verb: "untap", object: "target creature" });
  expect(one("Fateful Absence", "Instant", "Destroy target creature or planeswalker. Its controller investigates.")[0]!.actions![1]).toMatchObject({ verb: "investigate", object: "its controller" });
  // A stated count is the amount.
  expect(one("Explore", "Sorcery", "You may play an additional land this turn.")[0]!.actions![0]).toMatchObject({ verb: "play", amount: "1" });
  // A spell shuffling itself leaves the stack; a card revealed from hand moves from the hand.
  expect(one("Beacon of Immortality", "Instant", "Double target player's life total. Shuffle Beacon of Immortality into its owner's library.")[0]!.actions![1]).toMatchObject({ verb: "shuffle", fromZone: "stack" });
  expect(one("Retraced Image", "Sorcery", "Reveal a card in your hand, then put that card onto the battlefield if it has the same name as a permanent.")[0]!.actions![0]).toMatchObject({ verb: "put", fromZone: "hand" });
  // A whole-clause delayed trigger is the clause's trigger; a mid-sentence one is not.
  expect(one("Vizkopa Guildmage", "Creature — Human Wizard", "{1}{W}{B}: Whenever you gain life this turn, each opponent loses that much life.")[0]!.trigger).toMatchObject({ event: "life-gained", control: "you" });
  expect(one("Ghostway", "Instant", "Exile each creature you control. Return those cards to the battlefield under their owner's control at the beginning of the next end step.")[0]!.trigger).toBeUndefined();
  // "You and Humans you control have hexproof": the class's grant.
  expect(one("Sigarda, Heron's Grace", "Legendary Creature — Angel", "You and Humans you control have hexproof.")[0]!.actions![0]).toMatchObject({ verb: "grant-ability", object: "hexproof" });
});

test("labelling round 2: pronouns name their antecedent, and a move says where it goes and how", () => {
  const one = (name: string, typeLine: string, oracleText: string) => grammarClauseRecords({ name, typeLine, oracleText }).records;
  // An Aura's trigger on its host: "it" is the enchanted creature.
  expect(one("Bestial Fury", "Enchantment — Aura", "Whenever enchanted creature becomes blocked, it gets +4/+0 and gains trample until end of turn.")[0]!.actions![0])
    .toMatchObject({ verb: "modify-pt", object: "enchanted creature" });
  // "put that card on top" after a search comes from the library; a cast "without paying its mana cost" is still "that card".
  expect(one("Cruel Tutor", "Sorcery", "Search your library for a card, then shuffle and put that card on top. You lose 2 life.")[0]!.actions!.find((a) => a.verb === "put"))
    .toMatchObject({ fromZone: "library" });
  expect(one("Sunforger", "Artifact — Equipment", "{R}{W}, Unattach this Equipment: Search your library for a red or white instant card with mana value 4 or less and cast that card without paying its mana cost. Then shuffle.")[0]!.actions!.find((a) => a.verb === "cast"))
    .toMatchObject({ object: "that card" });
  // "from all hands and graveyards": one exile from each; "return her ... transformed" transforms too.
  expect(one("Worldfire", "Sorcery", "Exile all permanents. Exile all cards from all hands and graveyards. Each player's life total becomes 1.")[0]!.actions!.filter((a) => a.verb === "exile").map((a) => a.fromZone))
    .toEqual(["battlefield", "hand", "graveyard"]);
  expect(one("Liliana, Heretical Healer", "Legendary Creature — Human Cleric", "Whenever another nontoken creature you control dies, exile Liliana, Heretical Healer, then return her to the battlefield transformed under her owner's control.")[0]!.actions!.map((a) => a.verb))
    .toContain("transform");
});

test("labelling round 3: zones and players the sentence implies", () => {
  const one = (name: string, typeLine: string, oracleText: string) => grammarClauseRecords({ name, typeLine, oracleText }).records;
  // A dies trigger's "that card", a countered spell's exile.
  expect(one("Demonic Vigor", "Enchantment — Aura", "When enchanted creature dies, return that card to its owner's hand.")[0]!.actions![0]).toMatchObject({ verb: "return", fromZone: "graveyard" });
  expect(one("Void Shatter", "Instant", "Counter target spell. If that spell is countered this way, exile it instead of putting it into its owner's graveyard.")[0]!.actions![1]).toMatchObject({ verb: "exile", object: "it", fromZone: "stack" });
  // "exile up to two target cards from a single graveyard"; "up to" is not a destination.
  expect(one("Shred Memory", "Instant", "Exile up to four target cards from a single graveyard.")[0]!.actions![0]).toMatchObject({ verb: "exile", object: "up to four target cards from a single graveyard", fromZone: "graveyard" });
  // A whose-life-total names the player; an actor's "their graveyard" names the actor.
  expect(one("Magister Sphinx", "Artifact Creature — Sphinx", "When this creature enters, target player's life total becomes 10.")[0]!.actions![0]).toMatchObject({ verb: "set-life", object: "target player" });
  expect(one("Scrabbling Claws", "Artifact", "{T}: Target player exiles a card from their graveyard.")[0]!.actions![0]).toMatchObject({ object: "a card from target player's graveyard" });
  // A phase trigger's "it" with the clause's own "this creature" is the card.
  expect(one("Cactuar", "Creature — Plant", "At the beginning of your end step, if this creature didn't enter the battlefield this turn, return it to its owner's hand.")[0]!.actions![0])
    .toMatchObject({ verb: "return", object: "this creature", fromZone: "battlefield" });
  // A defined X is no paid X.
  expect(one("Heronblade Elite", "Creature — Human Warrior", "{T}: Add X mana of any one color, where X is this creature's power.")[0]!.actions![0]).not.toHaveProperty("amount");
});

// #1210 task 1: a punctuated ability word, and a game-start delayed effect.
const readCard = (name: string, typeLine: string, oracleText: string, keywords: string[] = []) => grammarClauseRecords({ name, typeLine, oracleText, keywords });

test("an ability word with ? ! or - in it labels the clause and is neither trigger subject nor object (#1210)", () => {
  const sq = readCard("The Unbeatable Squirrel Girl", "Legendary Creature — Squirrel Human Hero",
    "Do You Like Squirrels? — Whenever The Unbeatable Squirrel Girl enters or attacks, create a 1/1 green Squirrel creature token.\nI LOVE Squirrels! — {1}{G}{G}{G}: Create X 1/1 green Squirrel creature tokens, where X is the number of Squirrels you control.", ["I LOVE Squirrels!"]);
  expect(sq.blocker).toBeUndefined();
  expect(sq.complete).toBe(true);
  expect(sq.records.filter((r) => r.trigger).map((r) => r.trigger!.event).sort()).toEqual(["attacks", "enters"]);
  expect(sq.records[0]!.actions![0]).toMatchObject({ verb: "create" });
  const tally = readCard("Tallyman of Nurgle", "Creature — Astartes Warrior",
    "Lifelink\nThe Seven-fold Chant — At the beginning of your end step, if a creature died this turn, you draw a card and you lose 1 life. If seven or more creatures died this turn, instead you draw seven cards and you lose 7 life.", ["Lifelink", "The Seven-fold Chant"]);
  expect(tally.blocker).toBeUndefined();
  expect(tally.complete).toBe(true);
});

test("a game-start reveal records only the delayed effect's actions, with no trigger (#1210)", () => {
  const dross = readCard("Chancellor of the Dross", "Creature — Phyrexian Vampire",
    "You may reveal this card from your opening hand. If you do, at the beginning of the first upkeep, each opponent loses 3 life, then you gain life equal to the life lost this way.\nFlying, lifelink", ["Flying", "Lifelink"]);
  expect(dross.blocker).toBeUndefined();
  expect(dross.records[0]).toMatchObject({ abilityType: "static" });
  expect(dross.records[0]!.trigger).toBeUndefined();
  expect(dross.records[0]!.actions!.map((a) => a.verb)).toEqual(["lose-life", "gain-life"]);
  expect(dross.records[0]!.actions![0]).toMatchObject({ object: "each opponent", amount: "3" });
  const cases: [string, string, string, string[]][] = [
    ["Chancellor of the Annex", "Creature — Phyrexian Angel", "You may reveal this card from your opening hand. If you do, when each opponent casts their first spell of the game, counter that spell unless that player pays {1}.\nFlying\nWhenever an opponent casts a spell, counter it unless that player pays {1}.", ["counter-spell"]],
    ["Chancellor of the Forge", "Creature — Phyrexian Giant", "You may reveal this card from your opening hand. If you do, at the beginning of the first upkeep, create a 1/1 red Phyrexian Goblin creature token with haste.\nWhen this creature enters, create X 1/1 red Phyrexian Goblin creature tokens with haste, where X is the number of creatures you control.", ["create"]],
    ["Chancellor of the Spires", "Creature — Phyrexian Sphinx", "You may reveal this card from your opening hand. If you do, at the beginning of the first upkeep, each opponent mills seven cards.\nFlying\nWhen this creature enters, you may cast target instant or sorcery card from an opponent's graveyard without paying its mana cost.", ["mill"]],
    ["Chancellor of the Tangle", "Creature — Phyrexian Treefolk", "You may reveal this card from your opening hand. If you do, at the beginning of your first main phase of the game, add {G}.\nReach, vigilance", ["add-mana"]],
    ["Sphinx of Foresight", "Creature — Sphinx", "You may reveal this card from your opening hand. If you do, scry 3 at the beginning of your first upkeep.\nFlying\nAt the beginning of your upkeep, scry 1.", ["scry"]],
  ];
  for (const [name, type, text, verbs] of cases) {
    const g = readCard(name, type, text);
    expect(g.blocker, name).toBeUndefined();
    expect(g.complete, name).toBe(true);
    expect(g.records[0]!.trigger, name).toBeUndefined();
    expect(g.records[0]!.actions!.map((a) => a.verb), name).toEqual(verbs);
  }
  expect(readCard("Chancellor of the Annex", "Creature", cases[0]![2]).records[0]!.actions![0]).toMatchObject({ verb: "counter-spell", unless: { payer: "opponent" } });
  // ...the same action the card's own second clause reads.
  const annex = readCard("Chancellor of the Annex", "Creature", cases[0]![2]).records;
  expect(annex[0]!.actions![0]!.unless).toEqual(annex.at(-1)!.actions![0]!.unless);
});

test("a labelled keyword line stays a keyword line, and a labelled cost the segmenter missed refuses (#1210 review)", () => {
  const arms = readCard("Paladin's Arms", "Artifact — Equipment", "Lightbringer and Hero's Shield — Equip {4}");
  expect(arms.complete).toBe(true);
  expect(arms.records).toMatchObject([{ id: 1, abilityType: "none", actions: [{ verb: "none" }] }]);
  const blitz = readCard("Blitzball Stadium", "Land", "Go for the Goal! — {3}, {T}: Until end of turn, target creature gains \"Whenever this creature deals combat damage to a player, draw a card.\" and it can't be blocked this turn.");
  expect(blitz.complete).toBe(false);
  expect(blitz.blocker).toMatchObject({ clause: 1, kind: "action" });
  const strax = readCard("Strax", "Creature — Sontaran", "Grenades! — {2}, {T}, Sacrifice an artifact: This creature deals 2 damage to any target.");
  expect(strax.complete).toBe(false);
});

test("a mana cost behind a label the segmenter missed makes the clause activated, and derive's input carries the cost (#1210)", async () => {
  const text = "Do You Like Squirrels? — Whenever The Unbeatable Squirrel Girl enters or attacks, create a 1/1 green Squirrel creature token.\nI LOVE Squirrels! — {1}{G}{G}{G}: Create X 1/1 green Squirrel creature tokens, where X is the number of Squirrels you control.";
  const g = readCard("The Unbeatable Squirrel Girl", "Legendary Creature — Squirrel Human Hero", text, ["I LOVE Squirrels!"]);
  expect(g.records.find((r) => r.id === 2)).toMatchObject({ abilityType: "activated" });
  const { clauseCosts, clauseTexts } = await import("../derive-input.js");
  const doc = { oracleText: text, keywords: ["I LOVE Squirrels!"], typeLine: "Legendary Creature — Squirrel Human Hero" };
  const activated = new Set(g.records.filter((r) => r.abilityType === "activated").map((r) => r.id));
  expect(clauseCosts(doc)[2]).toBeUndefined();
  expect(clauseCosts(doc, activated)[2]).toBe("{1}{G}{G}{G}");
  expect(clauseTexts(doc, activated)[2]).toMatch(/^Create X 1\/1 green Squirrel/);
});

// #1210 task 2: six more shapes.
test("energy payment, replacement lead-in, duration lead, look-at-top, 'who doesn't', roll-a-die (#1210)", () => {
  const turret = readCard("Consulate Turret", "Artifact", "{T}: You get {E} (an energy counter).\n{T}, Pay {E}{E}{E}: This artifact deals 2 damage to target player or planeswalker.");
  expect(turret.blocker).toBeUndefined();
  // The segmenter classes "{T}, Pay {E}{E}{E}:" static; the payment is a cost of an activated clause.
  expect(turret.records[1]).toMatchObject({ abilityType: "activated" });
  expect(turret.records[1]!.actions!.map((a) => a.verb)).toEqual(["remove-counter", "deal-damage"]);
  expect(turret.records[1]!.actions![0]).toMatchObject({ object: "energy counter", amount: "3" });

  const warden = readCard("Crowd-Control Warden", "Creature — Human Soldier", "As this creature enters or is turned face up, put X +1/+1 counters on it, where X is the number of other creatures you control.\nDisguise {3}{G/W}{G/W} (You may cast this card face down for {3} as a 2/2 creature with ward {2}. Turn it face up any time for its disguise cost.)", ["Disguise"]);
  expect(warden.blocker).toBeUndefined();
  expect(warden.records[0]).toMatchObject({ abilityType: "static" });
  expect(warden.records[0]!.actions![0]).toMatchObject({ verb: "add-counter", object: "+1/+1", amount: "the number of other creatures you control" });

  const familiar = readCard("Ertai's Familiar", "Creature — Illusion", "Phasing (This phases in or out before you untap during each of your untap steps. While it's phased out, it's treated as though it doesn't exist.)\nWhen this creature phases out or leaves the battlefield, mill three cards.\n{U}: Until your next upkeep, this creature can't phase out.", ["Phasing"]);
  expect(familiar.blocker).toBeUndefined();
  expect(familiar.records.at(-1)!.actions![0]).toMatchObject({ verb: "cant", object: "phase out" });
  expect(familiar.records[1]!.trigger).toMatchObject({ event: "phases-out", subject: "this creature" });

  const viv = readCard("Vivien's Invocation", "Sorcery", "Look at the top seven cards of your library. You may put a creature card from among them onto the battlefield. Put the rest on the bottom of your library in a random order. When a creature is put onto the battlefield this way, it deals damage equal to its power to target creature an opponent controls.");
  // The reflexive "When a creature is put onto the battlefield this way" has no reading (only "when you do"
  // does): the card stays incomplete, but the first clause reads.
  expect(viv.blocker).toMatchObject({ clause: 2, kind: "trigger" });
  expect(viv.records[0]!.actions![0]).toMatchObject({ verb: "put", object: "a creature card from the top seven cards of your library", fromZone: "library", toZone: "battlefield", optional: true });
  expect(viv.records[0]!.actions![1]).toMatchObject({ verb: "put", object: "the rest of the top seven cards of your library", fromZone: "library", toZone: "library" });

  const wernog = readCard("Wernog, Rider's Chaplain", "Legendary Creature — Human Cleric", "When Wernog, Rider's Chaplain enters or leaves the battlefield, each opponent may investigate. Each opponent who doesn't loses 1 life. You investigate X times, where X is one plus the number of opponents who investigated this way.");
  expect(wernog.blocker).toBeUndefined();
  const w = wernog.records.flatMap((r) => r.actions!);
  expect(w.find((a) => a.verb === "lose-life")).toMatchObject({ object: "each opponent who doesn't investigate", amount: "1" });
  // The comma in the card's name hid the segmenter's two-event flag: "enters or leaves" is two records.
  expect(wernog.records.map((r) => r.trigger?.event)).toEqual(["enters", "leaves"]);
  expect(w.find((a) => a.verb === "investigate")).toBeDefined();

  const xeno = readCard("Xenosquirrels", "Creature — Squirrel", "This creature enters with two +1/+1 counters on it.\nAfter you roll a die, you may remove a +1/+1 counter from this creature. If you do, increase or decrease the result by 1.");
  expect(xeno.blocker).toBeUndefined();
  const x = xeno.records[1]!;
  expect(x).toMatchObject({ abilityType: "static" });
  expect(x.trigger).toMatchObject({ event: "roll-dice" });
  expect(x.actions![0]).toMatchObject({ verb: "remove-counter", optional: true });
});

// #1210 task 2 review: what the six readings must not break on cards that were already right.
test("cards of a looked-at library are yours, and the exiled card is not what a cost tapped (#1210)", async () => {
  const bargain = readCard("Rakshasa's Bargain", "Instant", "Look at the top four cards of your library. Put two of them into your hand and the rest into your graveyard.");
  expect(bargain.records[0]!.actions).toMatchObject([
    { verb: "put", object: "two of the top four cards of your library", fromZone: "library", toZone: "hand" },
    { verb: "put", object: "the rest of the top four cards of your library", fromZone: "library", toZone: "graveyard" },
  ]);
  const nightwatch = readCard("Gurmag Nightwatch", "Creature — Zombie", "When this creature enters, look at the top three cards of your library. You may put one of those cards back on top of your library. Put the rest into your graveyard.");
  expect(nightwatch.records[0]!.actions![0]).toMatchObject({ object: "one of the top three cards of your library", toZone: "library" });
  const durnan = readCard("Durnan of the Yawning Portal", "Legendary Creature — Human Warrior", "Whenever Durnan of the Yawning Portal attacks, exile a creature card from the top four cards of your library. For as long as that card remains exiled, you may cast it. That spell has undaunted.");
  expect(durnan.records[0]!.actions!.find((a) => a.verb === "cast")).toMatchObject({ object: "the exiled creature card", fromZone: "exile" });
  // "it becomes plotted" is a status, never an animation.
  const luck = readCard("Make Your Own Luck", "Sorcery", "Look at the top three cards of your library. You may exile a nonland card from among them. If you do, it becomes plotted. Put the rest into your hand.");
  expect(luck.records[0]!.actions!.map((a) => a.verb)).toEqual(["exile", "put"]);
  expect(luck.records[0]!.actions![0]).toMatchObject({ fromZone: "library", object: "a nonland card from the top three cards of your library" });
  // The punished opponents keep the store's wording, which derive reads into a negated did.
  const fandaniel = readCard("Fandaniel, Telophoroi Ascian", "Legendary Creature — Human", "At the beginning of your end step, each opponent may sacrifice a nontoken creature of their choice. Each opponent who doesn't loses 2 life for each instant and sorcery card in your graveyard.");
  expect(fandaniel.records[0]!.actions![1]).toMatchObject({ verb: "lose-life", object: "each opponent who doesn't sacrifice" });
  const nissa = readCard("Nissa, Genesis Mage", "Legendary Planeswalker — Nissa", "+2: Untap up to two target creatures and up to two target lands.");
  expect(nissa.records[0]!.actions!.map((a) => a.object)).toEqual(["up to two target creatures", "up to two target lands"]);
  const ashiok = readCard("Ashiok", "Legendary Planeswalker — Ashiok", "−7: Target player exiles the top X cards of their library, where X is the total mana value of cards you own in exile.");
  expect(ashiok.records[0]!.actions![0]).toMatchObject({ verb: "exile", amount: "the total mana value of cards you own in exile" });
  // An energy payment the segmenter left static is the cost of an activated clause.
  const surveillance = readCard("Consulate Surveillance", "Enchantment", "When this enchantment enters, you get {E}{E}{E}{E} (four energy counters).\nPay {E}{E}: Prevent all damage that would be dealt to you this turn by a source of your choice.");
  expect(surveillance.records.at(-1)).toMatchObject({ abilityType: "activated" });
  // Dermotaxi: the copy is of the exiled card, never of the creatures tapped to pay.
  const { grammarClauseRecords: records } = await import("./clause-record.js");
  const { deriveInputOf } = await import("../derive-input.js");
  const { deriveCardTags } = await import("../derive/derive.js");
  const card = { name: "Dermotaxi", typeLine: "Artifact — Vehicle", oracleText: "Imprint — As this Vehicle enters, exile a creature card from a graveyard.\nTap two untapped creatures you control: Until end of turn, this Vehicle becomes a copy of the exiled card, except it's a Vehicle artifact in addition to its other types.", keywords: [] };
  const g = records(card);
  const tags = deriveCardTags(deriveInputOf(card as never, "x", card.name, g.records, undefined, g.readings));
  const copy = tags.abilities.find((a) => a.effect.kind === "clone");
  expect(copy?.emits?.[0]?.subject).toMatchObject({ control: "any" });
  expect(copy?.emits?.[0]?.subject.type).toBeUndefined();
});

test("a 'who doesn't' with no declined choice before it refuses; an exile that moved the cards leaves the rest in exile (#1210 review)", () => {
  expect(readCard("X", "Sorcery", "Each opponent who doesn't loses 3 life.").complete).toBe(false);
  const g = readCard("Y", "Sorcery", "Exile the top three cards of your library. Put one of them into your hand.");
  expect(g.records[0]!.actions![1]).toMatchObject({ verb: "put", fromZone: "exile" });
  const durnan = readCard("Durnan of the Yawning Portal", "Legendary Creature — Human Warrior", "Whenever Durnan of the Yawning Portal attacks, look at the top four cards of your library. You may exile a creature card from among them. Put the rest on the bottom of your library in any order.");
  expect(durnan.records[0]!.actions![1]).toMatchObject({ verb: "put", fromZone: "library", toZone: "library" });
});

test("Time and Tide: 'Simultaneously' is a timing word, the two phasing verbs are the actions (CR 702.26a, #1210 task 3)", () => {
  const g = readCard("Time and Tide", "Instant", "Simultaneously, all phased-out creatures phase in and all creatures with phasing phase out.");
  expect(g.complete).toBe(true);
  expect(g.records[0]!.actions!.map((a) => a.verb)).toEqual(["phase-in", "phase-out"]);
});

test("Pulse of Llanowar: the basic-land colour replacement is one `other` action, never add-mana (#1210 task 4)", () => {
  const g = readCard("Pulse of Llanowar", "Enchantment", "If a basic land you control is tapped for mana, it produces mana of a color of your choice instead of any other type.");
  expect(g.complete).toBe(true);
  expect(g.records[0]!.actions!.map((a) => a.verb)).toEqual(["other"]);
});

test("Crowd-Control Warden: after the 'As this creature enters or is turned face up' lead-in, 'it' is the card, so the counter emit is self", async () => {
  const { deriveInputOf } = await import("../derive-input.js");
  const { deriveCardTags } = await import("../derive/derive.js");
  const card = { name: "Crowd-Control Warden", typeLine: "Creature — Human Soldier", oracleText: "As this creature enters or is turned face up, put X +1/+1 counters on it, where X is the number of other creatures you control.", keywords: [] as string[] };
  const g = grammarClauseRecords(card);
  const tags = deriveCardTags(deriveInputOf(card as never, "x", card.name, g.records, undefined, g.readings));
  expect(tags.abilities[0]!.emits?.[0]).toMatchObject({ verb: "counter-added", subject: { counter: "+1/+1", self: true } });
});

test("Astrid Peth: a stored record split off a compound does not take the printed trigger of the clause segment() numbered the same", async () => {
  const { deriveInputOf } = await import("../derive-input.js");
  const { deriveCardTags } = await import("../derive/derive.js");
  const card = { name: "Astrid Peth", typeLine: "Legendary Creature — Human Peasant", keywords: [] as string[],
    oracleText: "Whenever Astrid Peth enters or attacks, create a Food token.\nBrand-new Sky — Whenever you sacrifice a Clue or Food, Astrid Peth explores." };
  const act = (verb: string, object: string) => [{ verb, object, fromZone: null, toZone: null, amount: verb === "create" ? "1" : null, optional: false }];
  const stored = [
    { id: 1, abilityType: "triggered", trigger: { event: "enters", subject: "Astrid Peth", control: "you" }, actions: act("create", "a Food token") },
    { id: 2, abilityType: "triggered", trigger: { event: "attacks", subject: "Astrid Peth", control: "you" }, actions: act("create", "a Food token") },
    { id: 3, abilityType: "triggered", trigger: { event: "sacrificed", subject: "a Clue or Food", control: "you" }, actions: act("explore", "Astrid Peth") },
  ];
  const tags = deriveCardTags(deriveInputOf(card as never, "x", card.name, stored as never));
  // The sacrifice trigger carries the explore, never the Food: no ability pairs it with a create-token emit.
  const sacrifice = tags.abilities.filter((a) => a.trigger?.verbs?.includes("sacrifice" as never));
  expect(sacrifice.length).toBeGreaterThan(0);
  expect(sacrifice.flatMap((a) => a.emits ?? []).map((e) => e.verb)).not.toContain("create-token");
  expect(tags.abilities.filter((a) => a.trigger?.verbs?.includes("attacks" as never)).flatMap((a) => a.emits ?? []).map((e) => e.verb)).toContain("create-token");
});

test("a 'look at the top card' whose later 'it' / 'that card' is never resolved blocks, rather than read complete with the claim missing (#1210 review)", () => {
  expect(readCard("Domri Rade", "Legendary Planeswalker — Domri", "+1: Look at the top card of your library. If it's a creature card, you may reveal it and put it into your hand.").complete).toBe(false);
  expect(readCard("Puresight Merrow", "Creature — Merfolk Wizard", "{W/U}, {Q}: Look at the top card of your library. You may exile that card.").complete).toBe(false);
  // A look whose "of them" / "the rest" picks the library up is still skipped, and the rest is milled by you.
  const sp = readCard("Strategic Planning", "Sorcery", "Look at the top three cards of your library. Put one of them into your hand and the rest into your graveyard.");
  expect(sp.complete).toBe(true);
  expect(sp.records[0]!.actions!.map((a) => a.verb)).toEqual(["put", "put"]);
  expect(sp.records[0]!.actions![0]).toMatchObject({ fromZone: "library" });
});
