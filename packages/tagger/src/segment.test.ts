import { expect, test } from "vitest";
import { effectActions, grantedToOwnToken, segment } from "./segment.js";

// Every card here is one the extraction experiment or the quality audit got wrong.

test("a single-line spell is one clause", () => {
  const c = segment("Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.");
  expect(c).toHaveLength(1);
  expect(c[0].kind).toBe("ability");
  expect(c[0].id).toBe(1);
});

test("keyword lines are marked, not dropped — a dropped clause is indistinguishable from a vanilla card", () => {
  const c = segment(
    "Flying, first strike, lifelink, protection from Demons and from Dragons",
    ["Flying", "First strike", "Lifelink", "Protection"],
  );
  expect(c).toHaveLength(1);
  expect(c[0].kind).toBe("keyword");
});

test("keywords plus real text split into separate clauses", () => {
  const c = segment("Flying, deathtouch\nWhen this creature dies, draw a card.", ["Flying", "Deathtouch"]);
  expect(c.map((x) => x.kind)).toEqual(["keyword", "ability"]);
});

test("Bitterblossom: the upkeep ability survives as one clause", () => {
  const c = segment("At the beginning of your upkeep, you lose 1 life and create a 1/1 black Faerie Rogue creature token with flying.");
  expect(c).toHaveLength(1);
  expect(c[0].text).toContain("beginning of your upkeep");
});

test("Kura: modal bullets become separate clauses linked to their parent", () => {
  const c = segment([
    "Flying, deathtouch",
    "When Kura dies, choose one —",
    "• Search your library for up to three land cards, reveal them, put them into your hand, then shuffle.",
    "• Create an X/X green Spirit creature token, where X is the number of lands you control.",
  ].join("\n"), ["Flying", "Deathtouch"]);
  const modes = c.filter((x) => x.kind === "mode");
  expect(modes).toHaveLength(2);
  // Both modes hang off the "choose one" clause — the model cannot merge or drop one.
  expect(new Set(modes.map((m) => m.parentId)).size).toBe(1);
  expect(modes[0].text).toContain("into your hand");
  expect(modes[1].text).toContain("Create an X/X green Spirit");
});

test("ability words are stripped to a marker so the clause text is the rule itself", () => {
  const c = segment("Landfall — Whenever a land you control enters, mill a card.");
  expect(c[0].marker).toBe("Landfall");
  expect(c[0].text).toBe("Whenever a land you control enters, mill a card.");
});

test("an activated cost is split off, not mistaken for an ability word", () => {
  const c = segment("{2}, {T}: Create a 0/0 colorless Construct artifact creature token.");
  expect(c[0].marker).toBeUndefined();
  expect(c[0].abilityType).toBe("activated");
  expect(c[0].cost).toBe("{2}, {T}");
  expect(c[0].text).toBe("Create a 0/0 colorless Construct artifact creature token.");
});

test("a sacrifice COST is captured, not left as prose the model may or may not record", () => {
  // Phyrexian Tower failed the known-wrong gate because the model sometimes put the sacrifice in
  // the cost string and sometimes in actions. An aristocrats deck needs to see it either way.
  const c = segment("{T}: Add {C}.\n{T}, Sacrifice a creature: Add {B}{B}.");
  expect(c[1].cost).toBe("{T}, Sacrifice a creature");
  expect(c[1].abilityType).toBe("activated");
});

test("abilityType is derived, not asked — the model disagreed with itself on it", () => {
  expect(segment("Counter target spell.", [], "Instant")[0].abilityType).toBe("spell");
  expect(segment("Exile target creature.", [], "Sorcery")[0].abilityType).toBe("spell");
  expect(segment("Whenever a land you control enters, mill a card.", [], "Creature")[0].abilityType).toBe("triggered");
  expect(segment("Creatures you control get +1/+1.", [], "Enchantment")[0].abilityType).toBe("static");
  expect(segment("At the beginning of your upkeep, draw a card.", [], "Artifact")[0].abilityType).toBe("triggered");
});

test("Urza's Saga: chapters are their own clauses, each carrying its numeral", () => {
  const c = segment([
    "(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)",
    "I — This Saga gains \"{T}: Add {C}.\"",
    "II — This Saga gains \"{2}, {T}: Create a 0/0 colorless Construct artifact creature token with 'This creature gets +1/+1 for each artifact you control.'\"",
    "III — Search your library for an artifact card with mana value 1 or less, put it onto the battlefield, then shuffle.",
  ].join("\n"));
  const chapters = c.filter((x) => x.kind === "chapter");
  expect(chapters.map((x) => x.marker)).toEqual(["I", "II", "III"]);
  // The reminder-only first line still occupies a slot, so ids account for every printed line.
  expect(c[0].kind).toBe("reminder");
});

test("Innkeeper's Talent: level markers are their own clauses", () => {
  const c = segment([
    "(Gain the next level as a sorcery to add its ability.)",
    "At the beginning of combat on your turn, put a +1/+1 counter on target creature you control.",
    "{G}: Level 2",
    "Permanents you control with counters on them have ward {1}.",
  ].join("\n"));
  expect(c.map((x) => x.kind)).toEqual(["reminder", "ability", "level", "ability"]);
});

test("clause ids are contiguous from 1, so a missing record is detectable", () => {
  const c = segment("Flying\nWhenever this creature attacks, draw a card.\n{T}: Add {G}.", ["Flying"]);
  expect(c.map((x) => x.id)).toEqual([1, 2, 3]);
});

test("segmentation is deterministic — the property the model could not provide", () => {
  const text = "When Kura dies, choose one —\n• Search your library.\n• Create a token.";
  expect(segment(text)).toEqual(segment(text));
});

test("a run of adjacent mana symbols is still an activated cost", () => {
  // Izzet Locket was misfiled as a static ability because the cost regex allowed only one brace
  // group per comma-separated part, so its sacrifice was never split off.
  const c = segment("{U/R}{U/R}{U/R}{U/R}, {T}, Sacrifice this artifact: Draw two cards.");
  expect(c[0].abilityType).toBe("activated");
  expect(c[0].cost).toBe("{U/R}{U/R}{U/R}{U/R}, {T}, Sacrifice this artifact");
  expect(c[0].costActions).toEqual(["sacrifice"]);
});

test("a long cost part is still an activated cost", () => {
  // Master Transmuter's third cost part is 49 characters, over the 40-character cap the pattern
  // allowed per part, so the whole ability fell through to `static` — losing the return cost AND
  // giving the card the wildcard-lord shape that false-edge meshes are made of. 583 corpus cards
  // were typed static this way.
  const c = segment("{U}, {T}, Return an artifact you control to its owner's hand: You may put an artifact card from your hand onto the battlefield.");
  expect(c[0].abilityType).toBe("activated");
  expect(c[0].cost).toBe("{U}, {T}, Return an artifact you control to its owner's hand");
  expect(c[0].costActions).toEqual(["return"]);
});

test("a sentence that merely mentions a cost word is not an activated cost", () => {
  // The cap was the only thing stopping a long prefix from being read as a cost. A cost part never
  // spans a sentence, so the period is what bounds it now.
  const c = segment("Whenever you sacrifice a permanent, you may exile it. If you do: draw a card.");
  expect(c[0].abilityType).toBe("triggered");
  expect(c[0].cost).toBeUndefined();
});

test("a trigger cue beats a colon later in the clause", () => {
  // Glaring Fleshraker grants a token an activated ability whose cost is not a mana symbol, so
  // `extractGranted` leaves it inline — and its colon then offered itself as this clause's cost.
  // No activated ability's cost begins "Whenever", so the cue decides first.
  const c = segment('Whenever you cast a colorless spell, create a 0/1 colorless Eldrazi Spawn creature token with "Sacrifice this token: Add {C}."');
  expect(c[0].abilityType).toBe("triggered");
  expect(c[0].cost).toBeUndefined();
});

test("cost actions are derived, and mana and tapping are never among them", () => {
  expect(segment("{T}, Sacrifice a creature: Add {B}{B}.")[0].costActions).toEqual(["sacrifice"]);
  expect(segment("{2}, Discard a card: Draw a card.")[0].costActions).toEqual(["discard"]);
  // Nothing triggers on paying mana or tapping the source, so neither becomes an action.
  expect(segment("{3}{R}: Create a 1/1 red Goblin creature token.")[0].costActions).toBeUndefined();
  expect(segment("{T}: Add {C}.")[0].costActions).toBeUndefined();
});

test("paying life is a cost action spelled with the legal verb lose-life, not pay-life", () => {
  // pay-life is not a VERBS member (normalize-prompt.ts); the model would have to invent an illegal
  // verb or substitute one, which is the drift this pipeline exists to remove. lose-life is legal,
  // correct by the rules, and already reaches life-loss payoffs.
  expect(segment("Pay 2 life: Draw a card.")[0].costActions).toEqual(["lose-life"]);
});

test("a trigger embedded after a sentence becomes its own clause", () => {
  // Lapis Orb: one run recorded the delayed trigger, the next ignored it.
  const c = segment("Add {U}. When you spend this mana to cast a Dragon creature spell, scry 2.");
  expect(c).toHaveLength(2);
  expect(c[0].text).toBe("Add {U}.");
  expect(c[1].abilityType).toBe("triggered");
  expect(c[1].text.startsWith("When you spend")).toBe(true);
});

test("an ability granted in quotes becomes its own clause", () => {
  // Progenitor Mimic broke the completeness invariant: clause 1 held two abilities, so the model
  // invented id 1.1 in one run and 2 in the other trying to split it itself.
  const c = segment('You may have this creature enter as a copy of any creature on the battlefield, except it has "At the beginning of your upkeep, create a token that\'s a copy of this creature."');
  expect(c).toHaveLength(2);
  expect(c[1].kind).toBe("granted");
  expect(c[1].parentId).toBe(1);
  expect(c[1].abilityType).toBe("triggered");
  expect(c[0].text).toContain("that ability");
});

test("quoted flavour or a name is not mistaken for a granted ability", () => {
  const c = segment('As this enchantment enters, choose a nonland card name.');
  expect(c).toHaveLength(1);
  expect(c.filter((x) => x.kind === "granted")).toHaveLength(0);
});

test("planeswalker loyalty abilities are activated, with the loyalty symbol as the cost", () => {
  // Aminatou's "+1: Draw a card" was typed static: a loyalty cost is not a mana symbol, so the
  // general cost pattern never matched it.
  const plus = segment("+1: Draw a card, then put a card from your hand on top of your library.", [], "Legendary Planeswalker — Aminatou");
  expect(plus[0].abilityType).toBe("activated");
  expect(plus[0].cost).toBe("+1");
  expect(plus[0].text.startsWith("Draw a card")).toBe(true);
  // Both hyphen and the real minus sign appear in printed oracle text.
  expect(segment("-3: Exile target permanent.", [], "Legendary Planeswalker")[0].abilityType).toBe("activated");
  expect(segment("−8: You get an emblem.", [], "Legendary Planeswalker")[0].cost).toBe("−8");
  expect(segment("0: Draw a card.", [], "Legendary Planeswalker")[0].cost).toBe("0");
});

test("a mode inherits its parent's ability type", () => {
  // Bow of Nylea's modes were typed static, reading as a permanent's standing effect rather than
  // as part of an activated ability.
  const c = segment("{1}{G}, {T}: Choose one —\n• Put a +1/+1 counter on each of up to two target creatures.\n• Bow of Nylea deals 2 damage to target creature with flying.", [], "Legendary Artifact");
  expect(c[0].abilityType).toBe("activated");
  const modes = c.filter((x) => x.kind === "mode");
  expect(modes).toHaveLength(2);
  expect(modes.every((m) => m.abilityType === "activated")).toBe(true);
});

test("a bare modal intro keeps its own clause instead of vanishing", () => {
  // Cryptic Command prints "Choose two —" on its own line. The ability-word pattern ate the whole
  // line, leaving an empty body that produced NO clause, and the first bullet then invented an
  // empty unlabelled parent to hang off. The intro states no action of its own, so it is inert:
  // the modes carry the actions.
  const c = segment("Choose two —\n• Counter target spell.\n• Return target permanent to its owner's hand.\n• Tap all creatures your opponents control.\n• Draw a card.", [], "Instant");
  expect(c[0].kind).toBe("modal");
  expect(c[0].marker).toBe("Choose two");
  const modes = c.filter((x) => x.kind === "mode");
  expect(modes).toHaveLength(4);
  expect(modes.every((m) => m.parentId === c[0].id)).toBe(true);
  expect(c.filter((x) => x.text === "" && x.kind === "ability")).toHaveLength(0);
});

test("a keyword with a non-mana cost is still a keyword", () => {
  // Alpharael prints "Ward—Discard a card at random." The ability-word pattern stripped "Ward"
  // before the keyword check could see it, so the line was typed as a static ability while the
  // bracket form ("Ward {2}") was correctly inert — the same keyword split by cost notation.
  const c = segment("Ward—Discard a card at random.\nVoid — Whenever Alpharael attacks, defending player loses half their life, rounded up.", ["Ward", "Void"], "Legendary Creature — Human Warrior");
  expect(c[0].kind).toBe("keyword");
  expect(c[0].abilityType).toBeUndefined();
  // "Void" is an ability word, not a printed keyword of this card's rules text — it still labels.
  expect(c[1].kind).toBe("ability");
  expect(c[1].marker).toBe("Void");
  expect(c[1].abilityType).toBe("triggered");
});

test("a level divider carries its marker and cost, not a meaningless body", () => {
  // "{1}{G}: Level 2" always matched the activated-cost pattern first, so the branch written for
  // levels never ran and the clause text was the literal divider label.
  const c = segment("{1}{G}: Level 2\nWhenever you attack, put a +1/+1 counter on target attacking creature.", [], "Enchantment — Class");
  expect(c[0].kind).toBe("level");
  expect(c[0].marker).toBe("Level 2");
  expect(c[0].cost).toBe("{1}{G}");
  expect(c[0].text).toBe("");
});

test("effect actions are derived from the effect, not the condition or a quoted grant", () => {
  // Each of these was a false positive in the precision check against stored model output.
  expect(effectActions("Whenever you draw a card, this creature gets +1/+1 until end of turn."))
    .toEqual(["modify-pt"]);                       // the draw is the condition, not the effect
  expect(effectActions('You get an emblem with "Creatures you control get +1/+1."'))
    .toEqual(["emblem"]);                          // the +1/+1 belongs to the emblem, not this clause
  expect(effectActions("Spells and abilities your opponents control can't cause you to sacrifice permanents or discard cards."))
    .toEqual([]);                                  // a restriction states what does NOT happen
  expect(effectActions("Add {R}{R}{R}. Spend this mana only to cast instant or sorcery spells."))
    .toEqual(["add-mana"]);                        // "to cast" restricts the mana; it casts nothing
  expect(effectActions("(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)", "reminder"))
    .toEqual([]);                                  // an inert clause states no action at all
});

test("the clauses that drifted into `other` now carry their verbs", () => {
  // Plasma Caster came back "exile,deal-damage" on one run and a lone "other" on the next.
  const c = segment("{4}, {T}: Choose target creature. Exile it, then it deals 3 damage to you.", [], "Artifact");
  expect(c[0].effectActions).toContain("deal-damage=3");
  expect(c[0].effectActions).toContain("exile");
  // "put a +1/+1 counter" is add-counter, never put — put is exclusively zone movement.
  const h = segment("Each creature you control gets +1/+1. Put a +1/+1 counter on target creature.", [], "Legendary Planeswalker");
  expect(h[0].effectActions).toContain("add-counter");
  expect(h[0].effectActions).not.toContain("put");
});

test("the four vocabulary gaps the planeswalker audit found are now derived", () => {
  // An emblem is not a token, so it is not `create` — the model split between create and other
  // across runs, which was the largest source of residual planeswalker drift.
  expect(effectActions('You get an emblem with "Creatures you control get +1/+1."'))
    .toEqual(["emblem"]);
  // Kiora's emblem: fight is mutual damage, and without a verb it came back as `other`.
  expect(effectActions("Whenever a creature you control enters, you may have it fight target creature."))
    .toEqual(["fight"]);
  // Sorin Markov: a life total being SET is not lose-life — how much is lost depends on the total.
  expect(effectActions("Target opponent's life total becomes 10."))
    .toEqual(["set-life=10"]);
  // Jace, Wielder of Mysteries came back as draw(you) — the seven is the whole card.
  expect(effectActions("Draw seven cards. Then if your library has no cards in it, you win the game."))
    .toEqual(["draw=7"]);
});

test("proliferate is a verb, not free text in `object`", () => {
  // Thrummingbird's only real clause came back as verb "other", object "proliferate", which
  // actionEffectKind and actionEmits both ignore — so the card derived ZERO abilities and read as a
  // vanilla bear, the exact failure this layer exists to prevent.
  expect(effectActions("Whenever this creature deals damage to a player, proliferate."))
    .toEqual(["proliferate"]);
  // A REPLACEMENT effect states no proliferate of its own. Tekuthal doubles someone else's, and
  // claiming the verb here would emit a `proliferate` event the card never produces.
  expect(effectActions("If you would proliferate, proliferate twice instead.")).toEqual([]);
});

test("amounts survive as digits however the card spells them", () => {
  expect(effectActions("Draw a card.")).toEqual(["draw=1"]);
  expect(effectActions("Sarkhan deals 3 damage to any target.")).toEqual(["deal-damage=3"]);
  expect(effectActions("Each opponent loses two life.")).toEqual(["lose-life=2"]);
  expect(effectActions("Create X 1/1 white Soldier creature tokens.")).toEqual(["create=X"]);
});

test("the multi-face separator line is not a clause", () => {
  // The corpus joins faces with a bare "//" line. It used to get its own slot on every one of the
  // 116 multi-face cards in the calibration scope, so the model was asked about a printed
  // separator and the answer was paid for.
  const c = segment("Destroy target artifact.\n//\nDestroy target enchantment.", [], "Instant // Instant");
  expect(c).toHaveLength(2);
  expect(c.map((x) => x.text)).toEqual(["Destroy target artifact.", "Destroy target enchantment."]);
  // Ids stay contiguous, so the completeness invariant still holds.
  expect(c.map((x) => x.id)).toEqual([1, 2]);
});

test("abilityType is decided per FACE, not from the joined type line", () => {
  // Malakir Rebirth // Malakir Mire is Instant // Land. The joined line contains "Instant", so the
  // LAND face's lines used to default to "spell" -- which derive maps to "on-cast", the
  // spellslinger mesh this layer already had to fix once. 27 clauses in the calibration scope.
  const c = segment(
    "Until end of turn, target creature you control gains \"When this creature dies, return it to the battlefield tapped under its owner's control.\"\n//\nThis land enters tapped.\n{T}: Add {B}.",
    [], "Instant // Land",
  );
  const spellFace = c.find((x) => x.text.startsWith("Until end of turn"));
  const landFace = c.find((x) => x.text.startsWith("This land enters tapped"));
  expect(spellFace?.abilityType).toBe("spell");
  expect(landFace?.abilityType).toBe("static");
});

test("a trigger behind an ability-word label is still a trigger", () => {
  // 18 of the 83 refusals on the --refresh-other run were `unexpected-trigger`, and most were this:
  // the trigger cue is real but sits behind a flavour label, so `classify` -- which tests the RAW
  // text -- typed the ability static and the gate then refused the model for answering correctly.
  // ABILITY_WORD strips the label for the marker, but only for pure-letter labels of <=24 chars,
  // and none of these qualify: "Allons-y!" carries punctuation, "Lord of the Pyrrhian Legions" is
  // 28 characters, "∞" is not a letter at all.
  const tenth = segment("Allons-y! — Whenever you attack, exile cards from the top of your library.", [], "Legendary Creature");
  expect(tenth[0].abilityType).toBe("triggered");

  const anrakyr = segment("Lord of the Pyrrhian Legions — Whenever Anrakyr the Traveller attacks, you may cast an artifact spell from your hand.", [], "Legendary Artifact Creature");
  expect(anrakyr[0].abilityType).toBe("triggered");

  const mindStone = segment("∞ — At the beginning of your end step, exile up to one other target nonland permanent you control.", [], "Legendary Artifact");
  expect(mindStone[0].abilityType).toBe("triggered");
});

test("a label before a non-trigger does not turn the ability into one", () => {
  // The label is not evidence of anything by itself; only the cue behind it is. Murkfiend Liege's
  // "Untap all green and/or blue creatures you control during each other player's untap step" is a
  // genuine static ability, and the model answering `untaps` there is a real refusal to keep.
  const liege = segment("Untap all green and/or blue creatures you control during each other player's untap step.", [], "Creature");
  expect(liege[0].abilityType).toBe("static");

  const landfall = segment("Landfall — Creatures you control get +1/+1.", [], "Enchantment");
  expect(landfall[0].abilityType).toBe("static");
});

test("a mode carrying its OWN trigger keeps it, rather than inheriting the parent's type", () => {
  // Outpost Siege and Mirrodin Besieged: the parent is "As this enchantment enters, choose X" --
  // genuinely static -- and each mode is a full triggered ability in its own right. Inheriting the
  // parent's type unconditionally typed both modes static, and the gate then refused the card for
  // answering the trigger that is plainly printed on it.
  const c = segment(
    "As this enchantment enters, choose Khans or Dragons.\n• Khans — At the beginning of your upkeep, exile the top card of your library.\n• Dragons — Whenever a creature you control leaves the battlefield, this enchantment deals 1 damage to any target.",
    [], "Enchantment",
  );
  const modes = c.filter((x) => x.kind === "mode");
  expect(modes).toHaveLength(2);
  expect(modes.map((m) => m.abilityType)).toEqual(["triggered", "triggered"]);
  expect(c.find((x) => x.kind === "ability")?.abilityType).toBe("static");
});

test("a clause stating two trigger conditions is marked as such", () => {
  // Ichor Wellspring fires on entering AND on dying, but the schema's `trigger` holds ONE event, so
  // the model answers such a clause with two records and numbers the second one itself. That was
  // 16 refusals across the two refresh runs, and 429 cards carry the shape corpus-wide. The gate
  // cannot tell a legitimate overflow from a hallucinated clause without knowing which clauses
  // genuinely state two conditions, so the segmenter -- which already owns what a clause IS -- says.
  const wellspring = segment("When this artifact enters or is put into a graveyard from the battlefield, draw a card.", [], "Artifact");
  expect(wellspring[0].multiTrigger).toBe(true);

  const conscription = segment("When this enchantment enters and whenever you draw your third card each turn, amass Zombies 3.", [], "Enchantment");
  expect(conscription[0].multiTrigger).toBe(true);

  const sovereign = segment("Whenever this creature enters or attacks, create a 1/1 green Elemental creature token.", [], "Creature");
  expect(sovereign[0].multiTrigger).toBe(true);
});

test("an ordinary trigger, and an `or` in the EFFECT, are not two conditions", () => {
  // The bound only holds if this stays tight: every clause wrongly marked here buys the model one
  // free unchallenged clause on that card.
  const plain = segment("Whenever this creature attacks, draw a card or discard a card.", [], "Creature");
  expect(plain[0].multiTrigger).toBeUndefined();

  const targets = segment("When this creature enters, destroy target artifact or enchantment.", [], "Creature");
  expect(targets[0].multiTrigger).toBeUndefined();
});

test("a Station threshold does not hide the trigger behind it", () => {
  // Spacecraft print their threshold abilities as "3+ | Whenever ...". The pipe prefix is a label
  // like an ability word, but LABEL only knew the em-dash form, so Uthros Research Craft and
  // Entropic Battlecruiser typed a printed trigger as static and the gate refused both on every run.
  const uthros = segment("Station\n3+ | Whenever you cast an artifact spell, draw a card.\n12+ | Flying", [], "Artifact — Spacecraft");
  const trig = uthros.find((c) => c.text.includes("Whenever you cast"));
  expect(trig?.abilityType).toBe("triggered");
  // The keyword-only threshold line stays what it was.
  expect(uthros.find((c) => c.text.includes("Flying"))?.abilityType).toBe("static");
});

test("two conditions joined through a second subject still count as two", () => {
  // Scrap Trawler: "Whenever this creature dies or another artifact you control is put into a
  // graveyard from the battlefield". The second limb names its own subject before the verb, so the
  // verb-anchored TWO_CONDITIONS missed it and the model's split read as an invented id.
  const trawler = segment("Whenever this creature dies or another artifact you control is put into a graveyard from the battlefield, return to your hand target artifact card in your graveyard with lesser mana value.", [], "Artifact Creature");
  expect(trawler[0].multiTrigger).toBe(true);
});

test("an `or` joining two SUBJECTS of ONE verb is one condition, not two", () => {
  // "Whenever this creature or another permanent enters from a graveyard" (River Kelpie) states one
  // event with two subjects, not two events. Marking it multiTrigger told the model to answer the
  // clause twice, and the overflow record landed on the id of the trailing keyword clause -- so the
  // gate saw a trigger on a non-triggered clause AND a duplicate id, and refused the whole card.
  //
  // Eight of the fifteen refusals in the 2026-08-06 refresh are this exact shape: River Kelpie,
  // Hammer of Nazahn, Possibility Technician, Dowsing Device, Titans' Vanguard, Wand of Orcus,
  // Tarrian's Soulcleaver, Lumbering Worldwagon. Every one has a two-subject trigger followed by a
  // printed keyword.
  //
  // The discriminator is whether the FIRST limb has an event verb of its own before the "or":
  // Scrap Trawler's "dies or ... is put" does, River Kelpie's "this creature or another permanent
  // enters" does not -- the two nouns share one verb.
  const kelpie = segment("Whenever this creature or another permanent enters from a graveyard, draw a card.\nPersist", [], "Creature");
  expect(kelpie[0].multiTrigger).toBeUndefined();

  const hammer = segment("Whenever Hammer of Nazahn or another Equipment you control enters, you may attach that Equipment to target creature you control.", [], "Legendary Artifact — Equipment");
  expect(hammer[0].multiTrigger).toBeUndefined();

  const kavu = segment("Whenever this creature or another Kavu you control enters, exile the top card of your library.", [], "Creature — Kavu");
  expect(kavu[0].multiTrigger).toBeUndefined();
});

// Scryfall's `keywords` lists ability WORDS and keyword ACTIONS beside keyword abilities, so a line
// can start with one and still state a real ability. 585 lines over 578 cards were being made inert
// this way; found because the persist gate refused Dark Dabbling and the refusal was worth reading.
test("an ability-word label is not a keyword line, so its ability survives", () => {
  // Krosan Beast: a static pump that was thrown away whole.
  const cl = segment("Threshold — This creature gets +7/+7 as long as there are seven or more cards in your graveyard.", ["Threshold"], "Creature — Beast");
  expect(cl[0].kind).not.toBe("keyword");
  // Red Death, Shipwrecker: an ACTIVATED ability behind an ability word.
  const red = segment("Alluring Eyes — {T}: Goad target creature an opponent controls.", ["Goad"], "Creature — Fish");
  expect(red[0].kind).not.toBe("keyword");
});

test("a keyword ACTION used as a verb is a sentence, not a keyword line", () => {
  // Death Ward is one line and the leading word is a printed keyword.
  const cl = segment("Regenerate target creature.", ["Regenerate"], "Instant");
  expect(cl[0].kind).not.toBe("keyword");
});

test("real keyword lines stay inert", () => {
  expect(segment("Flying", ["Flying"], "Creature — Bird")[0].kind).toBe("keyword");
  expect(segment("Ward {2}", ["Ward"], "Creature — Fish")[0].kind).toBe("keyword");
  expect(segment("Flying, trample", ["Flying", "Trample"], "Creature — Dragon")[0].kind).toBe("keyword");
  // An Aura's enchant restriction states no action and is correctly inert — no period, no em dash.
  expect(segment("Enchant creature you control", ["Enchant"], "Enchantment — Aura")[0].kind).toBe("keyword");
});

// AN ACTION A PLAYER TAKES IS AN EVENT TOO (roadmap G2c, owner's correction 2026-08-21). The
// original EVENT_VERB list held only things that HAPPEN TO a permanent, so a trigger head naming two
// player actions was never flagged, the model answered it with one event, and the other was silently
// dropped with no selector able to see it. Mirkwood Bats -- "Whenever you create or sacrifice a
// token" -- derives `sacrifice` alone and is in the owner's own smooth-criminal deck.
// MEASURED corpus-wide: 30 cards carry such a head and the segmenter flagged 0; widening the list
// flags 48 more cards in total and loses none.
test("a trigger naming two player actions is a multiTrigger clause", () => {
  const bats = segment("Flying\nWhenever you create or sacrifice a token, each opponent loses 1 life.");
  expect(bats.find((c) => /create or sacrifice/.test(c.text))?.multiTrigger).toBe(true);
  // The families the sweep found, each with a named witness.
  expect(segment("Whenever you cycle or discard a card, scry 1.")[0].multiTrigger).toBe(true);
  expect(segment("Whenever you play a land or cast a spell, draw a card.")[0].multiTrigger).toBe(true);
  expect(segment("Whenever you cast a white spell or a Plains you control enters, you gain 1 life.")[0].multiTrigger).toBe(true);
});

/** ONE EVENT WITH TWO SUBJECTS IS STILL ONE EVENT -- the distinction the "or" branch has always
 *  required a verb on both sides to make. Widening the verb list must not blur it, or eight cards
 *  with a two-subject trigger get told to answer one clause twice (the failure recorded above). */
test("two subjects sharing one event are still not a multiTrigger", () => {
  expect(segment("Whenever this creature or another permanent enters, draw a card.")[0].multiTrigger).toBeUndefined();
  expect(segment("Whenever you cast an instant or sorcery spell, put a +1/+1 counter on this creature.")[0].multiTrigger).toBeUndefined();
  expect(segment("Whenever one or more creatures you control enter, draw a card.")[0].multiTrigger).toBeUndefined();
});

/** 1b, the round-4 census's biggest false family. A quoted ability granted to a token the clause
 *  itself creates belongs to the TOKEN, which already derives it from its own row -- attributing it
 *  to the card as well states the relation twice, and every noncreature spell in the deck edged to
 *  Vivi's Persistence AND to its Wizard. Owner's ruling, six times over: "the token that X produces
 *  triggers on it, not this instant." */
test("a grant to a token the clause creates is selected, and a grant to your own creatures is not", () => {
  const vivi = segment(
    'Create a 0/1 black Wizard creature token with "Whenever you cast a noncreature spell, this token deals 1 damage to each opponent."',
  );
  const granted = vivi.find((c) => c.kind === "granted");
  expect(granted).toBeDefined();
  expect([...grantedToOwnToken(vivi)]).toEqual([granted!.id]);

  // Bello, Bard of the Brambles grants to permanents YOU CONTROL. The trigger is real and belongs
  // to those creatures, so a blanket refusal of every granted clause would be a second wrong answer.
  const bello = segment(
    'During your turn, each non-Equipment artifact you control with mana value 4 or greater is a 4/4 Elemental creature in addition to its other types and has indestructible, haste, and "Whenever this creature deals combat damage to a player, draw a card."',
  );
  expect(bello.some((c) => c.kind === "granted")).toBe(true);
  expect(grantedToOwnToken(bello).size).toBe(0);
});

/** The cue reads the PARENT and never the granted text, because the word "token" routinely appears
 *  inside the granted ability itself: Kaito, Cunning Infiltrator's emblem creates a Ninja token, and
 *  the clause that grants it merely says "You get an emblem with that ability". An emblem is the
 *  same wrong sentence one object over and is deliberately left alone -- it has no node for the
 *  relation to move to, so refusing it would delete a claim rather than relocate it. */
test("a token named only inside the granted ability does not select the grant", () => {
  const kaito = segment(
    'You get an emblem with "Whenever a player casts a spell, you create a 2/1 blue Ninja creature token."',
  );
  expect(kaito.some((c) => c.kind === "granted")).toBe(true);
  expect(grantedToOwnToken(kaito).size).toBe(0);
});

/** WHICH FACE A CLAUSE IS PRINTED ON. The loop has always tracked this in order to classify each
 *  clause against its OWN face's type line, and then dropped it -- so downstream a back-face ability
 *  and a front-face one were indistinguishable and both matched the card's UNION of types.
 *
 *  Owner, 2026-08-27: "we should split the edges between front and back of a card ... they produce
 *  separate events". Measured over the derived corpus: 113 of 2,767 cards are multi-face, carrying
 *  224 clauses and 171 derived abilities on a face after the first. */
test("a clause records which face prints it, and only when there is more than one", () => {
  const dfc = segment(
    "Malakir Rebirth deals no damage.\n//\nMalakir Mire enters tapped.\n{T}: Add {B}.",
    [],
    "Instant // Land",
  );
  // The front face carries no marker: absent means "the only face", which is every ordinary card.
  expect(dfc[0].face).toBeUndefined();
  expect(dfc[1].face).toBe(1);
  expect(dfc[2].face).toBe(1);

  // A single-face card is untouched, so nothing about the common case changes.
  const plain = segment("Draw a card.\nGain 2 life.", [], "Sorcery");
  expect(plain.every((c) => c.face === undefined)).toBe(true);
});

/** THE COST PREFIX IS READ BY A LINEAR SCAN — issue #19, `js/redos`.
 *
 *  The pattern this replaced let a phrase part contain the comma and the whitespace that separate
 *  parts, so every comma was a fork and a line that ultimately FAILED cost 2^parts:
 *  16 parts 154ms · 18 parts 1.4s · 20 parts 13s, on 59 characters. Real oracle lines reach 18
 *  comma-separated parts, and the whole 34,081-card corpus segmented in 32.7s against 206ms after.
 *
 *  A TIME BUDGET rather than an implementation, so any linear rewrite passes. 20 parts costs the old
 *  pattern roughly 13 seconds against this budget of one, and costs this scan ~0ms.
 *
 *  THE INPUT MUST FAIL TO MATCH, and that is the whole test. Given a well-formed cost the old
 *  pattern succeeded immediately; the blowup lives only in the failing case, so a trailing "{"
 *  (a brace that never closes, which no part can accept) is what separates the two. */
test("the activated-cost scan is linear on a line that cannot be a cost", () => {
  const line = `${Array(20).fill("a").join(", ")}{`;
  const started = performance.now();
  const c = segment(line, [], "Artifact");
  expect(performance.now() - started).toBeLessThan(1_000);
  expect(c[0].abilityType).toBe("static");
});

/** The grammar the scan keeps, one case per rule, because a faster wrong answer is still wrong.
 *  Every one of these was verified byte-identical against the pattern over the whole corpus. */
test("the cost grammar is unchanged by the linear rewrite", () => {
  // A colon with no whitespace after it is not a cost — Level up's "Level 2" reads the same way.
  expect(segment("{T}:Add {G}.", [], "Land")[0].abilityType).toBe("static");
  // A part that mixes a phrase and a brace run is not a cost part.
  expect(segment("Pay {2}: Draw a card.", [], "Artifact")[0].abilityType).toBe("static");
  // A period cannot sit inside a cost, which is what keeps a whole sentence out.
  expect(segment("Sacrifice a creature. Then tap: Draw a card.", [], "Artifact")[0].abilityType).toBe("static");
  // An empty part is not a part — a leading or doubled comma is not a cost list. NO PRINTED
  // WITNESS: the whole corpus segments byte-identically with this guard removed, so it is stated
  // here rather than left as decoration nothing exercises.
  expect(segment(", {T}: Draw a card.", [], "Artifact")[0].abilityType).toBe("static");
  // A phrase part over 80 characters is not a cost.
  expect(segment(`${"a".repeat(81)}, {T}: Draw a card.`, [], "Artifact")[0].abilityType).toBe("static");
  // ...and at 80 it still is, so the bound is the one the pattern carried.
  const long = segment(`Sacrifice ${"a".repeat(70)}, {T}: Draw a card.`, [], "Artifact")[0];
  expect(long.abilityType).toBe("activated");
  expect(long.cost).toBe(`Sacrifice ${"a".repeat(70)}, {T}`);
});
