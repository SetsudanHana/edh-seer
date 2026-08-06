import { expect, test } from "vitest";
import { parseSubject } from "./subject.js";

test("control comes from the possessive phrase, defaulting to any", () => {
  expect(parseSubject("a creature you control").control).toBe("you");
  expect(parseSubject("each creature your opponents control").control).toBe("opp");
  expect(parseSubject("target opponent").control).toBe("opp");
  expect(parseSubject("target creature").control).toBe("any");
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
