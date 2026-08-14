import { expect, test } from "vitest";
import { parseSubject } from "./subject.js";

test("control comes from the possessive phrase, defaulting to any", () => {
  expect(parseSubject("a creature you control").control).toBe("you");
  expect(parseSubject("each creature your opponents control").control).toBe("opp");
  expect(parseSubject("target opponent").control).toBe("opp");
  expect(parseSubject("target creature").control).toBe("any");
});

/** COMBAT NAMES THE OPPONENT WITHOUT SAYING "OPPONENT".
 *
 *  `control: "any"` is not a neutral unknown -- `matcher/subject.ts:39` skips the control check
 *  entirely when either side is `any`, so a phrase this parser does not recognise becomes a
 *  PERMISSION rather than a missing fact. Mjölnir, Storm Hammer's "tap target creature defending
 *  player controls" derived `control: "any"` and satisfied Hawkeye, Master Marksman's "whenever
 *  Hawkeye becomes tapped" (`control: "you", self: true`) -- an opponent's creature being tapped
 *  read as your own creature being tapped.
 *
 *  Measured over the derived corpus before writing this: 12 clause actions say "defending player",
 *  11 of them on an `attacks` trigger the card's own controller owns, and the 12th (Elturel
 *  Survivors) is a characteristic-defining "+X/+0 where X is the number of lands defending player
 *  controls" on an attacker. All 12 mean an opponent. "attacking player" appears once, on an
 *  `attacks`/opponent trigger, and means an opponent too. */
test("combat role words name an opponent", () => {
  expect(parseSubject("target creature defending player controls").control).toBe("opp");
  expect(parseSubject("defending player").control).toBe("opp");
  expect(parseSubject("up to one target instant or sorcery card from defending player's graveyard").control).toBe("opp");
  expect(parseSubject("attacking player").control).toBe("opp");
});

/** REFUSED, and the refusal is the point. "that player" names an ANTECEDENT, not a role: 12 clause
 *  actions carry it across five different trigger shapes (`enters`, `damage-dealt`, `attacks`,
 *  `upkeep`, and none at all), so the phrase alone cannot say whose. Resolving it needs the
 *  antecedent machinery, not a vocabulary entry, and guessing "opp" here would re-create the exact
 *  defect above in the other direction. */
test("`that player` is not resolvable from the phrase and stays any", () => {
  expect(parseSubject("up to one target creature that player controls").control).toBe("any");
});

test("a subject with no card type is a player — the absence of type IS the encoding", () => {
  // Zulaport Cutthroat's drain subject is {control:"opp", token:null} with no type at all.
  expect(parseSubject("each opponent")).toEqual({ control: "opp", token: null, scope: "each" });
  expect(parseSubject("you")).toEqual({ control: "you", token: null });
});

test("card types are recognised singular and plural", () => {
  expect(parseSubject("target creature").type).toBe("creature");
  expect(parseSubject("creatures you control").type).toBe("creature");
  expect(parseSubject("target artifact or enchantment").type).toEqual(["artifact", "enchantment"]);
  // Was asserted as bare "permanent", which is the defect this line used to bless: `permanent`
  // expands to include land, so "nonland permanent" matched exactly the thing it excludes. See
  // "a negated type is resolved to the types it actually leaves" below.
  expect(parseSubject("target nonland permanent").type)
    .toEqual(["creature", "artifact", "enchantment", "planeswalker", "battle"]);
});

test("token is tri-state and always explicit", () => {
  expect(parseSubject("a creature token you control").token).toBe(true);
  expect(parseSubject("a nontoken creature you control").token).toBe(false);
  expect(parseSubject("target creature").token).toBeNull();
});

test("negated control flips you-control to opp, not any", () => {
  expect(parseSubject("target creature you don't control").control).toBe("opp");
  expect(parseSubject("target creature you don’t control").control).toBe("opp");
  // guard: the positive case must still work once negation is checked first.
  expect(parseSubject("creatures you control").control).toBe("you");
});

test("negated token phrasing is recognised alongside nontoken", () => {
  expect(parseSubject("target creature that isn't a token").token).toBe(false);
  expect(parseSubject("target creature that is not a token").token).toBe(false);
  // guard: the positive case must still work.
  expect(parseSubject("a creature token you control").token).toBe(true);
});

test("scope separates spot removal from a wipe, and a pump from an anthem", () => {
  expect(parseSubject("target creature").scope).toBe("target");
  expect(parseSubject("each creature your opponents control").scope).toBe("each");
  expect(parseSubject("all creatures").scope).toBe("all");
  // A bare plural is a mass effect even with no explicit quantifier: this is the anthem case.
  expect(parseSubject("creatures you control").scope).toBe("all");
  // A bare singular says nothing about scope; leave it unset rather than guessing.
  expect(parseSubject("a creature").scope).toBeUndefined();
});

test("umbrella nouns (spell, permanent) yield to a concrete type once one is named", () => {
  // matcher's PSEUDO_TYPE_SETS.spell is every card type except land, so collecting "spell" alongside
  // "instant"/"sorcery" made pairReasons claim any nonland card supplies an instant/sorcery cast.
  expect(parseSubject("instant or sorcery spell").type).toEqual(["instant", "sorcery"]);
  // With no concrete type present, "spell" is all there is, and must still stand for it.
  expect(parseSubject("target spell").type).toBe("spell");
});

test("a subtype is recovered from the object text, singular and plural", () => {
  // Without this a kindred anthem names nothing edges.ts can match: `namesItsTargets` requires a
  // type OR a subtype, so "Zombies you control get +1/+1" derived a subjectless static effect and
  // formed no edge at all.
  expect(parseSubject("Zombies you control").subtype).toBe("zombie");
  expect(parseSubject("target Goblin").subtype).toBe("goblin");
  // Irregular plurals the vocabulary spells differently from the text.
  expect(parseSubject("Elves you control").subtype).toBe("elf");
  expect(parseSubject("Allies you control").subtype).toBe("ally");
  // A subtype narrows a type; both survive.
  const both = parseSubject("other Zombie creatures you control");
  expect(both.type).toBe("creature");
  expect(both.subtype).toBe("zombie");
  // Two subtypes are an OR, the same encoding `type` already uses.
  expect(parseSubject("Sliver and Zombie creatures you control").subtype).toEqual(["sliver", "zombie"]);
});

test("a plural subtype alone makes the effect a mass one, so a kindred anthem is an anthem", () => {
  // parseScope only saw plural CARD TYPES, so "Zombies you control" left scope unset and
  // namesItsTargets rejected it even once the subtype was recovered.
  expect(parseSubject("Zombies you control").scope).toBe("all");
  // A bare singular subtype still says nothing about scope.
  expect(parseSubject("target Goblin").scope).toBe("target");
  expect(parseSubject("a Goblin").scope).toBeUndefined();
});

test("ordinary nouns in object text are not mistaken for subtypes", () => {
  // The vocabulary is closed, so the guard is that nothing outside it matches -- these are the
  // words that actually appear in object text.
  for (const t of ["three counters from among artifacts you control", "cards in your hand",
    "target creature", "each opponent", "a token you control", "all nonland permanents"]) {
    expect(parseSubject(t).subtype, t).toBeUndefined();
  }
});

test("numeric conditions written in the object text survive as StatPredicates", () => {
  // Without this the compass's power-matters category cannot tell Welcoming Vampire's gated
  // trigger from any unconditional ETB payoff -- the linking tag is identical.
  expect(parseSubject("other creatures you control with power 2 or less").stats)
    .toEqual([{ metric: "power", op: "lte", value: 2 }]);
  expect(parseSubject("a creature with toughness 4 or greater").stats)
    .toEqual([{ metric: "toughness", op: "gte", value: 4 }]);
  expect(parseSubject("target creature").stats).toBeUndefined();
});

test("a colour named in the text is a real constraint, not decoration", () => {
  // parseSubject reads type, subtype, control, token and stats -- and dropped colour entirely, so
  // Defiler of Dreams' "blue permanent spells" derived as ALL permanents/spells and fanned out to
  // 89 consumers in a mono-blue deck. SubjectFilter has carried a `colors` field all along and
  // edges.ts already counts it as naming-its-targets; nothing ever filled it in.
  expect(parseSubject("blue permanent spells")).toMatchObject({ colors: ["U"] });
  expect(parseSubject("white creatures you control")).toMatchObject({ colors: ["W"] });
  expect(parseSubject("black and red spells")).toMatchObject({ colors: ["B", "R"] });
  expect(parseSubject("green creature cards in your graveyard")).toMatchObject({ colors: ["G"] });
});

test("a colourless subject is not the same as an unstated one", () => {
  // "colorless" is a real constraint that must not be read as "no constraint", and a subject that
  // says nothing about colour must stay unset rather than claim every colour.
  expect(parseSubject("colorless creatures")).toMatchObject({ colors: ["C"] });
  expect(parseSubject("creatures you control").colors).toBeUndefined();
});

test("two umbrella nouns together INTERSECT, they do not OR", () => {
  // "Permanent spell" is a spell that is also a permanent. Both words are umbrellas, so neither
  // narrowed the other and both survived as `["permanent","spell"]` -- which matcher's expandTypes
  // UNIONS, reaching every card type including instant and sorcery. Defiler of Flesh's "whenever you
  // cast a black permanent spell" was fed by every black spell in its deck, instants included.
  // Same resolution as the negation case below and for the same reason: concrete types, because a
  // token list is ORed downstream.
  expect(parseSubject("a black permanent spell").type)
    .toEqual(["creature", "artifact", "enchantment", "planeswalker", "battle"]);
  expect(parseSubject("a permanent spell")).toMatchObject({
    type: ["creature", "artifact", "enchantment", "planeswalker", "battle"],
  });
  // A LAND is a permanent but is never cast, which is exactly what the intersection removes.
  expect(parseSubject("a permanent spell").type).not.toContain("land");
});

test("the umbrella the intersection came from is RECORDED, so the tag keeps its name", () => {
  // Exactly the problem `notType` already solves one line down in themeSubjectKey: `type` now holds
  // the five types "permanent spell" resolves to, and keying on the first of them reads the claim
  // out as "cast:creature" -- rendered to a user as "a creature being cast" about Hylda's Crown of
  // Winter, which is an Artifact. Recording the umbrella keeps the tag `cast:permanent`, which is
  // both accurate and what the panel's cached verdicts are already keyed on.
  expect(parseSubject("a black permanent spell").umbrella).toBe("permanent");
  // Not set where nothing was intersected -- a lone umbrella is already its own name, and a
  // concrete type outranks it.
  expect(parseSubject("target spell").umbrella).toBeUndefined();
  expect(parseSubject("a creature spell").umbrella).toBeUndefined();
});

test("a single umbrella noun still stands for itself", () => {
  // Nothing to intersect with, so these must not change: "spell" is every nonland type and
  // "permanent" is every permanent type, and both are the honest reading on their own.
  expect(parseSubject("target spell").type).toBe("spell");
  expect(parseSubject("target permanent").type).toBe("permanent");
});

test("a concrete type still beats both umbrellas", () => {
  // "Creature spell" is a creature; the umbrella is noise once a real type is named, and the
  // intersection must not fire ahead of that rule.
  expect(parseSubject("a creature spell").type).toBe("creature");
  expect(parseSubject("an artifact permanent spell").type).toBe("artifact");
});

test("a negated type is resolved to the types it actually leaves", () => {
  // "noncreature spell" collapsed to the bare umbrella `spell`, which matcher's PSEUDO_TYPE_SETS
  // expands to every nonland type INCLUDING creature -- so Mystic Remora, Saruman and The Mechanist
  // drew an edge from every creature spell in the deck, the exact opposite of what they say.
  // 197 such mentions across 185 corpus cards.
  //
  // Resolved to concrete types here rather than emitted as a `noncreature` token, because
  // expandTypes UNIONS a subject's type tokens: ["permanent","nonland"] would union to everything
  // and read wider than either word alone.
  expect(parseSubject("target noncreature spell").type)
    .toEqual(["artifact", "enchantment", "planeswalker", "instant", "sorcery", "battle"]);
  // "nonland permanent" is the intersection, not either set: no lands, and no instants or sorceries
  // either, because it is still a permanent. 85 mentions, the commonest of the family.
  expect(parseSubject("target nonland permanent").type)
    .toEqual(["creature", "artifact", "enchantment", "planeswalker", "battle"]);
  // A negation with no umbrella to narrow leaves every other card type.
  expect(parseSubject("target noncreature").type)
    .toEqual(["artifact", "enchantment", "instant", "sorcery", "planeswalker", "land", "battle"]);
});

test("a negation that narrows nothing leaves the subject alone", () => {
  // "nonartifact creature" is still a creature; the engine has no way to say "and not an artifact",
  // and inventing one would be a wrong answer rather than a missing one. Unchanged from today.
  expect(parseSubject("target nonartifact creature").type).toBe("creature");
  // "nontoken" is a token state, not a card type -- parseToken already carries it, and it must not
  // be mistaken for a type negation.
  expect(parseSubject("a nontoken black creature")).toMatchObject({ type: "creature", token: false });
  // Supertypes are not card types. Neither of these may reach the type filter.
  expect(parseSubject("target nonlegendary creature card").type).toBe("creature");
  expect(parseSubject("target nonbasic land").type).toBe("land");
});

test("a negated subject keeps the scope its plural states", () => {
  // parseScope reads mass effects off the plural, and the negation path must not lose it:
  // "ten nonland permanents" is an all-scope subject.
  expect(parseSubject("ten nonland permanents").scope).toBe("all");
  expect(parseSubject("target noncreature spell").scope).toBe("target");
});

test("\"of the chosen type\" is recorded, not dropped", () => {
  // Chronicle of Victory, Morophon, Dawn-Blessed Pennant, Herald's Horn, Kindred Discovery: an
  // as-enters choice the subject then refers back to. `chosenType` has existed in the schema since
  // the flat tagger -- matcher/src/chosen-type.ts resolves it against the deck's dominant subtype,
  // and edges.ts already counts it as a real narrowing filter -- but parseSubject never set it, so
  // the derived path dropped the constraint entirely and the subject matched every spell.
  //
  // 10 of the panel's ~65 subject-mismatch rows are this: Chronicle of Victory "triggering" on
  // Stroke of Midnight, Fellwar Stone, Banner of Kinship -- none of which has a creature type at all.
  expect(parseSubject("spell of the chosen type")).toMatchObject({ type: "spell", chosenType: true });
  expect(parseSubject("a creature you control of the chosen type"))
    .toMatchObject({ type: "creature", control: "you", chosenType: true });
  // The wording varies; the meaning does not.
  expect(parseSubject("creatures of the chosen type").chosenType).toBe(true);
  expect(parseSubject("Creature spells of the chosen type").chosenType).toBe(true);
  // A subject that names a real subtype is NOT a chooser and must keep parsing as itself.
  expect(parseSubject("other Merfolk creatures you control").chosenType).toBeUndefined();
  expect(parseSubject("target creature").chosenType).toBeUndefined();
});

test("an ORIGIN zone named in the text is a real constraint", () => {
  // "Whenever a player casts a spell FROM A GRAVEYARD" (River Kelpie), "whenever you cast a
  // legendary spell FROM YOUR HAND" (Jodah), "whenever you cast a Dragon creature spell from your
  // graveyard" (Rivaz). The origin is the whole point of these cards, and `zone` cannot carry it:
  // `zone` means the zone the subject LIVES in, and normalizeZoneEvent forces "battlefield" onto
  // every enters event, so an origin stored there would be overwritten or, worse, read by
  // graveyardFillMatches as a graveyard FILL.
  expect(parseSubject("a spell from a graveyard").fromZone).toBe("graveyard");
  expect(parseSubject("a Dragon creature spell from your graveyard").fromZone).toBe("graveyard");
  expect(parseSubject("spell from your hand").fromZone).toBe("hand");
  expect(parseSubject("a card from exile").fromZone).toBe("exile");
  // "from anywhere" WIDENS rather than narrows (Bloodchief Ascension, Syr Konrad). An unset
  // fromZone already means "any origin", so recording it would be noise.
  expect(parseSubject("a card is put into an opponent's graveyard from anywhere").fromZone).toBeUndefined();
  expect(parseSubject("a spell").fromZone).toBeUndefined();
});

test("an origin zone does not disturb the rest of the subject", () => {
  // The zone words are also ordinary nouns. "graveyard" must not leak into type or subtype, and the
  // control/type the text states must survive alongside the origin.
  expect(parseSubject("a Dragon creature spell from your graveyard"))
    .toMatchObject({ type: "creature", subtype: "dragon", fromZone: "graveyard" });
});

test("\"historic\" is recorded as the constraint it is", () => {
  // Jhoira, Basim Ibn Ishaq, Glóin, Rona, The Sixth Doctor: "whenever you cast a HISTORIC spell".
  // The engine had no way to say it, so the subject read as the bare umbrella `spell` and every card
  // in the deck satisfied it. That cost 11 real claims the moment `castSelfSupplied` started gating
  // unconstrained cast watchers -- the trigger really does narrow, we just could not hear it.
  //
  // Historic is a printed fact, not a judgment: artifact, legendary, or Saga (18 corpus clauses).
  expect(parseSubject("historic spell")).toMatchObject({ type: "spell", historic: true });
  expect(parseSubject("Historic spells you cast").historic).toBe(true);
  expect(parseSubject("another nontoken historic permanent you control").historic).toBe(true);
  // A NEGATED mention is not the constraint (Desynchronization). Better unset than inverted.
  expect(parseSubject("each nonland permanent that's not historic").historic).toBeUndefined();
  expect(parseSubject("a spell").historic).toBeUndefined();
});

test("a negation is RECORDED as itself, not only as the types it leaves", () => {
  // The resolved list is what the matcher needs (see the test above: expandTypes UNIONS type tokens,
  // so a `noncreature` token in that array would read wider than either word). But it is not what the
  // card SAYS, and the difference reaches the user: `themeSubjectKey` takes the first element of the
  // list, so Valley Floodcaller's noncreature trigger keyed as `cast:artifact` and the reason text
  // read "Valley Floodcaller triggers on an artifact being cast; Rakdos Charm supplies it" -- of an
  // INSTANT. It also grouped noncreature-spell payoffs with artifact-cast payoffs on the theme axis.
  //
  // So both are kept: `type` for matching, `notType` for saying what it is. 144 such subjects across
  // 132 corpus cards.
  expect(parseSubject("target noncreature spell")).toMatchObject({
    type: ["artifact", "enchantment", "planeswalker", "instant", "sorcery", "battle"],
    notType: ["creature"],
  });
  expect(parseSubject("target nonland permanent").notType).toEqual(["land"]);
  // A negation that narrows nothing ("nonartifact creature" is still a creature) leaves the subject
  // alone, and must not claim a constraint the matcher is not applying.
  expect(parseSubject("target nonartifact creature").notType).toBeUndefined();
  expect(parseSubject("target creature").notType).toBeUndefined();
});

test("a compound type is an AND, not an OR", () => {
  // "Other ARTIFACT CREATURES you control get +1/+1" (Master of Etherium, Unctus) derives
  // type: ["creature","artifact"] -- and in this schema a type ARRAY means OR, because that is what
  // "target artifact or enchantment" needs. So Sol Ring satisfied Master of Etherium's anthem, and
  // Goreclaw (a plain Bear) satisfied Weaver of Harmony's ENCHANTMENT-creature anthem.
  //
  // The same structural gap as `notType` in the negation case, seen from the other side: the type
  // array cannot express a conjunction, so the conjunction needs its own field.
  expect(parseSubject("other artifact creatures you control"))
    .toMatchObject({ allTypes: ["artifact", "creature"], control: "you" });
  expect(parseSubject("other enchantment creatures you control").allTypes).toEqual(["enchantment", "creature"]);
  // A genuine OR must stay an OR.
  expect(parseSubject("target artifact or enchantment").allTypes).toBeUndefined();
  expect(parseSubject("target artifact or enchantment").type).toEqual(["artifact", "enchantment"]);
  // A single type is not a conjunction.
  expect(parseSubject("creatures you control").allTypes).toBeUndefined();
});

// "LEGENDARY creatures you control get +2/+2" (Serah Farron) and "+X/+X where X is the number of
// legendary creatures" (Jodah, the Unifier) derived a subject of EVERY creature, because legendary
// is a SUPERTYPE and SubjectFilter had no filter for it. Those two anthems were the widest meshes in
// the derived population at x53 and x51. 45 corpus cards name legendary in a subject.
// `historic` is the precedent: a boolean, matched against the card's printed characteristics.
test("a legendary subject records the supertype", () => {
  expect(parseSubject("legendary creatures you control").legendary).toBe(true);
  expect(parseSubject("each legendary creature you control").legendary).toBe(true);
});

test("a subject with no supertype does not claim one", () => {
  expect(parseSubject("creatures you control").legendary).toBeUndefined();
});

// Helm of the Host, Quantum Misalignment and Vesuvan Duplimancy all make a copy "except it isn't
// legendary". Reading that as a legendary constraint inverts the card.
test("a negated legendary is not a legendary constraint", () => {
  expect(parseSubject("a token that's a copy of equipped creature, except the token isn't legendary").legendary)
    .toBeUndefined();
  expect(parseSubject("nonlegendary creatures you control").legendary).toBeUndefined();
});

// A KEYWORD IS NOT A TYPE, so nothing in SubjectFilter could carry it and the narrowing was simply
// dropped: Favorable Winds' "creatures you control with flying get +1/+1" derived
// {type: creature, scope: all} and anthemed EVERY creature, the same over-wide subject legendary had.
// 1,836 corpus cards print a keyword-narrowed subject, 108 inside the derived corpus.
test("a subject narrowed by a keyword records it", () => {
  expect(parseSubject("creatures you control with flying").keyword).toEqual(["flying"]);
  expect(parseSubject("other creatures you control with defender").keyword).toEqual(["defender"]);
  expect(parseSubject("spells with flash you cast").keyword).toEqual(["flash"]);
});

// The token half of the same fact, and the reason this is not consumer-only: a Bird token WITH
// flying has to be able to satisfy Favorable Winds. 98 of the 114 keyword-narrowed subjects in the
// derived corpus are token objects like this one.
test("a created token's keywords are recorded, so it can satisfy a keyword payoff", () => {
  expect(parseSubject("a 1/1 blue Bird creature token with flying").keyword).toEqual(["flying"]);
});

// 17 of the corpus cases join two keywords with "and" and NOT ONE says "or", so the list is ALL-of.
test("two keywords joined by and are both demanded", () => {
  expect(parseSubject("1/1 green Insect creature tokens with flying and deathtouch").keyword)
    .toEqual(["deathtouch", "flying"]);
});

test("a subject naming no keyword claims none", () => {
  expect(parseSubject("creatures you control").keyword).toBeUndefined();
  expect(parseSubject("target creature").keyword).toBeUndefined();
});

// "with flashback COST equal to its mana cost" (Snapcaster Mage, Will of the Jeskai) is not a
// subject that demands flashback — it is the cost of a grant. The same shape as BASIC_LAND_TYPE.
test("a keyword followed by cost is not a keyword demand", () => {
  expect(parseSubject("target instant or sorcery card in your graveyard gains flashback until end of turn with flashback cost equal to its mana cost").keyword)
    .toBeUndefined();
});

// Fifteen keyword abilities are also KEYWORD COUNTERS (Comprehensive Rules 122.1b), so "with a
// flying counter on it" is a counter filter and not a keyword one. `parseCounter` already owns it.
test("a keyword counter is a counter, not a keyword demand", () => {
  const s = parseSubject("a creature you control with a flying counter on it");
  expect(s.counter).toBe("flying");
  expect(s.keyword).toBeUndefined();
});

// COUNTER KINDS ARE A CLOSED DICTIONARY, and cards either PRODUCE them or CARE about them - the same
// shape as tokens. `SubjectFilter.counter` has been in the schema all along and the matcher's
// counter-presence pass reads it, but the derive layer never wrote it, so it was a dead channel:
// a +1/+1 producer wildcarded onto a poison or time consumer. Commander Salt carries the same thing
// as a `counter_type` qualifier, 17 uses in one deck.
test("a subject filtered on counter presence records the kind", () => {
  expect(parseSubject("a creature you control with a +1/+1 counter on it").counter).toBe("+1/+1");
  expect(parseSubject("exiled card an opponent owns with a void counter on it").counter).toBe("void");
});

test("a counter-added trigger subject records the kind it names", () => {
  expect(parseSubject("one or more +1/+1 counters").counter).toBe("+1/+1");
  expect(parseSubject("+1/+1 counters on a creature you control").counter).toBe("+1/+1");
});

test("a subject naming no counter claims none", () => {
  expect(parseSubject("a creature you control").counter).toBeUndefined();
  // "counters" with no kind is the proliferate shape: the kind is board-state dependent and
  // unknowable, and an invented one would be consumed as if it were true.
  expect(parseSubject("those counters").counter).toBeUndefined();
});

// Comprehensive Rules 122.1b is the authority on which keywords a KEYWORD COUNTER can be:
// "flying, first strike, double strike, deathtouch, decayed, exalted, haste, hexproof,
// indestructible, lifelink, menace, reach, shadow, trample, and vigilance". The hand-written
// dictionary invented a `ward` counter (no such thing) and omitted decayed, exalted and shadow.
test("every keyword counter named by rule 122.1b is in the dictionary", () => {
  const rules122_1b = [
    "flying", "first strike", "double strike", "deathtouch", "decayed", "exalted", "haste",
    "hexproof", "indestructible", "lifelink", "menace", "reach", "shadow", "trample", "vigilance",
  ];
  for (const k of rules122_1b) {
    expect(parseSubject(`a creature with a ${k} counter on it`).counter).toBe(k);
  }
});

// 122.1c-g: the counters with rules text of their own.
test("the counters with their own rules are in the dictionary", () => {
  for (const k of ["shield", "stun", "loyalty", "poison", "defense"]) {
    expect(parseSubject(`a permanent with a ${k} counter on it`).counter).toBe(k);
  }
});

// Urza's Saga reads "artifact card with mana cost {0} or {1}" — an ENUMERATION, not a comparison, so
// STAT_RE ("mana value N or less") never saw it. It derived as a bare artifact tutor, which is
// indistinguishable from Fabricate, so the tutor gate correctly refused it and recall miss #189
// (Urza's Saga / Stonecoil Serpent) stayed open.
test("an enumerated mana cost becomes a mana-value predicate", () => {
  const s = parseSubject("artifact card with mana cost {0} or {1}");
  expect(s.stats).toEqual([{ metric: "mana-value", op: "lte", value: 1 }]);
});

// {0} or {1} is exactly "1 or less" because the run starts at zero. {1} or {2} is NOT "2 or less" —
// that would admit a 0-cost card the text excludes. Refuse rather than widen: a silent wrong answer
// is worse than a missing one.
test("an enumeration not starting at zero is refused rather than widened", () => {
  expect(parseSubject("artifact card with mana cost {1} or {2}").stats).toBeUndefined();
});

test("the existing comparison form still parses", () => {
  expect(parseSubject("a creature card with mana value 2 or less").stats)
    .toEqual([{ metric: "mana-value", op: "lte", value: 2 }]);
});

// BASIC is the other supertype, and it was inexpressible. "Search your library for a basic land
// card" emitted {type: land} and nothing more, so at the authored-emit identity check — the one
// place an emit sits on the FILTER side — every NONBASIC land satisfied it. That is about half the
// false edges the 2026-08-13 board fixtures showed on self-ETB lands: Wayfarer's Bauble, Fabled
// Passage, Myriad Landscape and Terrain Generator all say basic and all reached Shadowy Backstreet.
// 65 actions across 50 corpus docs. `legendary` is the precedent, four lines above.
test("a basic subject records the supertype", () => {
  expect(parseSubject("a basic land card").basic).toBe(true);
  expect(parseSubject("up to two basic land cards").basic).toBe(true);
  expect(parseSubject("basic Island, Swamp, or Mountain card").basic).toBe(true);
});

test("a subject with no basic supertype does not claim one", () => {
  expect(parseSubject("a land card").basic).toBeUndefined();
  expect(parseSubject("target creature").basic).toBeUndefined();
});

// "Nonbasic lands you control" (Blood Moon and its family) is the negation, and reading it as a
// basic constraint inverts the card exactly as a negated legendary does.
test("a negated basic is not a basic constraint", () => {
  expect(parseSubject("nonbasic lands you control").basic).toBeUndefined();
  expect(parseSubject("a land that isn't basic").basic).toBeUndefined();
});

// "Basic land TYPE" is the SUBTYPE sense — Forest, Island, Swamp, Mountain, Plains — and says
// nothing about the supertype. Vesuva and Prismatic Omen have it; a bare /\bbasic\b/ would read
// them as demanding basic lands, which is the opposite of what they do. 3 corpus actions.
test("a basic land TYPE is the subtype sense, not the supertype", () => {
  expect(parseSubject("lands you control have every basic land type in addition to their other types")
    .basic).toBeUndefined();
  expect(parseSubject("a basic land type").basic).toBeUndefined();
});
