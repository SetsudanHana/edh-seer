import { expect, test } from "vitest";
import { effectActions, segment } from "./segment.js";

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
