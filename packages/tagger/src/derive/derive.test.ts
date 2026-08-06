import { expect, test } from "vitest";
import { deriveAbilities } from "./derive.js";

test("one ability per action, sharing the clause kind and trigger", () => {
  // Kaya, Ghost Assassin -2: "Each opponent loses 2 life and you gain 2 life."
  const { abilities } = deriveAbilities([{
    id: 1,
    abilityType: "activated",
    actions: [
      { verb: "lose-life", object: "each opponent", amount: "2" },
      { verb: "gain-life", object: "you", amount: "2" },
    ],
  }]);
  // Also a drain: opponent life loss + your matching gain, pushed alongside the two per-action
  // abilities rather than instead of them (Task 7).
  expect(abilities).toHaveLength(3);
  expect(abilities[0].kind).toBe("activated");
  expect(abilities[0].effect.kind).toBe("player-life-loss");
  expect(abilities[1].effect.kind).toBe("lifegain");
  expect(abilities[2].effect.kind).toBe("drain");
  expect(abilities[2].kind).toBe("activated");
});

test("a triggered clause puts its trigger on every ability it produces", () => {
  const { abilities } = deriveAbilities([{
    id: 1,
    abilityType: "triggered",
    trigger: { event: "dies", subject: "a creature you control" },
    actions: [{ verb: "lose-life", object: "each opponent" }, { verb: "gain-life", object: "you" }],
  }]);
  // Also a drain (Task 7): opponent life loss + your matching gain. Every ability, including the
  // drain, carries the clause's shared trigger.
  expect(abilities).toHaveLength(3);
  for (const a of abilities) {
    expect(a.kind).toBe("triggered");
    expect(a.trigger?.verbs).toEqual(["dies"]);
    expect(a.trigger?.subject).toEqual({ control: "you", token: null, type: "creature" });
  }
  expect(abilities.map((a) => a.effect.kind).sort()).toEqual(["drain", "lifegain", "player-life-loss"]);
});

test("removal produces an ability with no effect kind but a usable emit", () => {
  const { abilities, unclaimed } = deriveAbilities([{
    id: 1, abilityType: "spell", actions: [{ verb: "destroy", object: "target creature" }],
  }]);
  expect(abilities).toHaveLength(1);
  expect(abilities[0].kind).toBe("on-cast");
  expect(abilities[0].effect.kind).toBe("");
  expect(abilities[0].emits?.[0].verb).toBe("dies");
  expect(unclaimed).toHaveLength(0);
  // No subject when there is no kind: matcher's edges.ts adds a `static:${kind}` tag for any
  // static ability that HAS a subject, so an empty kind plus a subject emits a junk `static:` tag
  // that can match another card's junk tag and form an edge that is not real.
  expect(abilities[0].effect.subject).toBeUndefined();
});

test("a spell clause maps to on-cast, not static -- segment.ts assigns abilityType 'spell' to every instant/sorcery clause", () => {
  const { abilities } = deriveAbilities([{
    id: 1, abilityType: "spell", actions: [{ verb: "deal-damage", object: "any target" }],
  }]);
  expect(abilities).toHaveLength(1);
  expect(abilities[0].kind).toBe("on-cast");
  expect(abilities[0].effect.kind).toBe("damage");
});

test("a known near-miss trigger verb normalizes through VERB_ALIASES", () => {
  const { abilities, unknownTriggers } = deriveAbilities([{
    id: 1,
    abilityType: "triggered",
    trigger: { event: "die", subject: "a creature you control" },
    actions: [{ verb: "draw", object: "you" }],
  }]);
  expect(abilities).toHaveLength(1);
  expect(abilities[0].trigger?.verbs).toEqual(["dies"]);
  expect(unknownTriggers).toHaveLength(0);
});

test("an unrecognized trigger verb is dropped from the ability, not asserted as a lie, and reported", () => {
  const { abilities, unknownTriggers } = deriveAbilities([{
    id: 1,
    abilityType: "triggered",
    trigger: { event: "nonsense-verb", subject: "a creature you control" },
    actions: [{ verb: "draw", object: "you" }],
  }]);
  expect(abilities).toHaveLength(1);
  expect(abilities[0].trigger).toBeUndefined();
  expect(unknownTriggers).toEqual(["nonsense-verb"]);
});

test("an action no rule claims is reported, never silently dropped", () => {
  const { abilities, unclaimed } = deriveAbilities([{
    id: 1, abilityType: "static", actions: [{ verb: "other", object: "flip a coin" }],
  }]);
  expect(abilities).toHaveLength(0);
  expect(unclaimed).toEqual([{ verb: "other", object: "flip a coin" }]);
});

test("inert clauses contribute nothing and are not unclaimed", () => {
  const { abilities, unclaimed } = deriveAbilities([{ id: 1, actions: [{ verb: "none" }] }]);
  expect(abilities).toHaveLength(0);
  expect(unclaimed).toHaveLength(0);
});

test("a clause that drains and gains also yields a drain ability", () => {
  // Zulaport Cutthroat: "Whenever this creature or another creature you control dies,
  // each opponent loses 1 life and you gain 1 life." Live tags record this as `drain`.
  const { abilities } = deriveAbilities([{
    id: 1,
    abilityType: "triggered",
    trigger: { event: "dies", subject: "a creature you control" },
    actions: [
      { verb: "lose-life", object: "each opponent" },
      { verb: "gain-life", object: "you" },
    ],
  }]);
  const kinds = abilities.map((a) => a.effect.kind).sort();
  expect(kinds).toEqual(["drain", "lifegain", "player-life-loss"]);
  const drain = abilities.find((a) => a.effect.kind === "drain");
  expect(drain?.trigger?.verbs).toEqual(["dies"]);
  expect(drain?.effect.subject).toEqual({ control: "opp", token: null, scope: "each" });
});

test("gaining life alone is not a drain", () => {
  const { abilities } = deriveAbilities([{
    id: 1, abilityType: "static", actions: [{ verb: "gain-life", object: "you" }],
  }]);
  expect(abilities.map((a) => a.effect.kind)).toEqual(["lifegain"]);
});

test("the clause vocabulary's trigger names are translated into engine verbs", () => {
  // normalize-prompt.ts's TRIGGERS names the EVENT ("life-gained"); the engine names the ACTION
  // ("gain-life"). Untranslated, Sanguine Bond is a payoff that consumes nothing.
  const { abilities, unknownTriggers } = deriveAbilities([{
    id: 1, abilityType: "triggered",
    trigger: { event: "life-gained", subject: "you", control: "you" },
    actions: [{ verb: "lose-life", object: "target opponent" }],
  }]);
  expect(abilities[0]?.trigger?.verbs).toEqual(["gain-life"]);
  expect(unknownTriggers).toEqual([]);
});

test("a graveyard-recursion effect keeps the zone its subject lives in", () => {
  // edges.ts draws the reanimator edge only when effect.subject.zone === "graveyard"; the clause
  // states that zone on the ACTION, so parseSubject alone can never recover it.
  const { abilities } = deriveAbilities([{
    id: 1, abilityType: "spell",
    actions: [{ verb: "return", object: "chosen creature cards", fromZone: "graveyard", toZone: "battlefield" }],
  }]);
  expect(abilities[0]?.effect).toMatchObject({ kind: "graveyard-recursion" });
  expect(abilities[0]?.effect.subject?.zone).toBe("graveyard");
});

test("a static ability that does not name WHICH permanents it applies to gets no subject", () => {
  // Psychosis Crawler: "its power and toughness are each equal to the number of cards in your hand"
  // is a self-referential P/T definition, not an anthem. edges.ts matches a static effect subject
  // against every other card's characteristics and treats each unset field as a wildcard, so a
  // typeless subject here is a `static:pump` lord over the entire deck.
  const { abilities } = deriveAbilities([{
    id: 1, abilityType: "static",
    actions: [{ verb: "modify-pt", object: "Psychosis Crawler's power and toughness are each equal to the number of cards in your hand" }],
  }]);
  expect(abilities[0]?.effect.kind).toBe("pump");
  expect(abilities[0]?.effect.subject).toBeUndefined();

  // A real anthem names its targets and keeps the subject it needs.
  const anthem = deriveAbilities([{
    id: 1, abilityType: "static", actions: [{ verb: "modify-pt", object: "creatures you control" }],
  }]).abilities;
  expect(anthem[0]?.effect.subject).toMatchObject({ type: "creature", control: "you" });

  // The guard is for static edges only — a triggered/on-cast pump still carries its subject.
  const pumpSpell = deriveAbilities([{
    id: 1, abilityType: "spell", actions: [{ verb: "modify-pt", object: "it" }],
  }]).abilities;
  expect(pumpSpell[0]?.effect.subject).toBeDefined();
});

test("a static pump naming a type but no scope (a single permanent) is not an anthem", () => {
  // Animate Dead, All That Glitters, Ethereal Armor, Ancestral Mask, Sage's Reverie: "enchanted
  // creature" names a type (creature) but picks out exactly one permanent, not the deck. Naming a
  // type alone is not enough -- before the scope guard this drew a lord edge to every creature in
  // the pool.
  const enchanted = deriveAbilities([{
    id: 1, abilityType: "static", actions: [{ verb: "modify-pt", object: "enchanted creature" }],
  }]).abilities;
  expect(enchanted[0]?.effect.subject).toBeUndefined();

  // Storm-Kiln Artist: "this creature" is the same single-permanent case, spelled differently.
  const thisCreature = deriveAbilities([{
    id: 1, abilityType: "static", actions: [{ verb: "modify-pt", object: "this creature" }],
  }]).abilities;
  expect(thisCreature[0]?.effect.subject).toBeUndefined();

  // A real mass anthem (scope "all") still keeps its subject.
  const anthem = deriveAbilities([{
    id: 1, abilityType: "static", actions: [{ verb: "modify-pt", object: "creatures you control" }],
  }]).abilities;
  expect(anthem[0]?.effect.subject).toMatchObject({ type: "creature", scope: "all" });
});

test("a static drain is guarded the same way -- naming a type with no scope drops the subject", () => {
  // Same wildcard-mesh risk as the pump case above: a static-typed drain clause built its subject
  // without routing through namesItsTargets, so it could reproduce the whole-deck mesh too.
  const { abilities } = deriveAbilities([{
    id: 1, abilityType: "static",
    actions: [
      { verb: "lose-life", object: "enchanted creature's controller" },
      { verb: "gain-life", object: "you" },
    ],
  }]);
  const drain = abilities.find((a) => a.effect.kind === "drain");
  expect(drain).toBeDefined();
  expect(drain?.effect.subject).toBeUndefined();
});

test("the trigger's own control field wins over whatever the object text repeats", () => {
  // "Whenever you cast a spell" normalizes to subject "a spell" + control "you"; reading only the
  // text widened Consuming Aberration to every spell anyone casts.
  const { abilities } = deriveAbilities([{
    id: 1, abilityType: "triggered",
    trigger: { event: "cast", subject: "a spell", control: "you" },
    actions: [{ verb: "put", object: "those cards", toZone: "graveyard" }],
  }]);
  expect(abilities[0]?.trigger?.subject.control).toBe("you");

  // Underworld Dreams: "Whenever an opponent draws a card, ... deals 1 damage to that player."
  // `draw` rather than `draw-step` -- the vocabulary gained a real draw event once the persist gate
  // refused this exact card for answering one, and `draw-step` no longer bridges to a verb.
  const opp = deriveAbilities([{
    id: 1, abilityType: "triggered",
    trigger: { event: "draw", subject: "a player", control: "opponent" },
    actions: [{ verb: "deal-damage", object: "that player" }],
  }]).abilities;
  expect(opp[0]?.trigger?.verbs).toEqual(["draw"]);
  expect(opp[0]?.trigger?.subject.control).toBe("opp");
});

test("the retired `draw-step` bridge no longer fakes a draw event", () => {
  // It used to map to `draw`, so "at the beginning of your draw step" meshed with every draw
  // payoff. Now it has no engine verb and surfaces as an unknown trigger instead of a false edge.
  const { abilities, unknownTriggers } = deriveAbilities([{
    id: 1, abilityType: "triggered",
    trigger: { event: "draw-step", subject: "you", control: "you" },
    actions: [{ verb: "draw", object: "a card" }],
  }]);
  expect(unknownTriggers).toEqual(["draw-step"]);
  expect(abilities[0]?.trigger).toBeUndefined();
});

test("proliferate derives on both sides of the vocabulary bridge", () => {
  // Source: Thrummingbird. `proliferate` had no clause verb, so this arrived as verb "other" and
  // the card derived nothing at all. effect-kind.ts and emits.ts both already carried a
  // proliferate row that could never fire.
  const source = deriveAbilities([{
    id: 1,
    abilityType: "triggered",
    trigger: { event: "damage-dealt", subject: "this creature", control: "you" },
    actions: [{ verb: "proliferate", object: "" }],
  }]);
  expect(source.abilities).toHaveLength(1);
  expect(source.abilities[0].effect.kind).toBe("proliferate");
  expect(source.abilities[0].emits?.map((e) => e.verb)).toEqual(["proliferate"]);
  expect(source.unclaimed).toEqual([]);

  // Payoff: "whenever you proliferate". TRIGGERS had no member for it either, so the payoff side
  // could not name the event its own source side now emits.
  const payoff = deriveAbilities([{
    id: 1,
    abilityType: "triggered",
    trigger: { event: "proliferate", subject: "you", control: "you" },
    actions: [{ verb: "draw", object: "a card" }],
  }]);
  expect(payoff.unknownTriggers).toEqual([]);
  expect(payoff.abilities[0].trigger?.verbs).toEqual(["proliferate"]);
});

test("a kindred anthem names its targets, so it survives the static-subject guard", () => {
  // "Zombies you control get +1/+1": namesItsTargets checks subject.subtype, which parseSubject
  // never set, so the whole subject was dropped and no edge formed against any Zombie.
  const { abilities } = deriveAbilities([{
    id: 1,
    abilityType: "static",
    actions: [{ verb: "modify-pt", object: "Zombies you control" }],
  }]);
  expect(abilities).toHaveLength(1);
  expect(abilities[0].effect.kind).toBe("pump");
  expect(abilities[0].effect.subject).toEqual({
    control: "you", token: null, subtype: "zombie", scope: "all",
  });
});

test("a static clause never proliferates -- it modifies someone else's", () => {
  // Tekuthal: "If you would proliferate, proliferate twice instead." Giving `proliferate` a clause
  // verb made the normalizer reach for it here too, and emitting the event would claim Tekuthal
  // proliferates when it only doubles what another card does. Unclaimed rather than dropped, so the
  // action stays visible.
  const { abilities, unclaimed } = deriveAbilities([{
    id: 1, abilityType: "static", actions: [{ verb: "proliferate", object: "any" }],
  }]);
  expect(abilities).toEqual([]);
  expect(unclaimed).toHaveLength(1);
  // The guard is about the clause kind, not the verb: an activated or triggered proliferate stands.
  const active = deriveAbilities([{
    id: 1, abilityType: "activated", actions: [{ verb: "proliferate", object: "" }],
  }]);
  expect(active.abilities[0].effect.kind).toBe("proliferate");
});

test("the escape-hatch trigger forms no edges", () => {
  // A guard, not new behaviour: `other` reaches derivation only because TRIGGERS now offers it, and
  // the whole safety of that addition is that the engine's VERB_VOCAB does not contain it. Adding
  // "other" there later would silently mesh every card that ever used the hatch with every other.
  const { abilities, unknownTriggers } = deriveAbilities([{
    id: 1, abilityType: "triggered",
    trigger: { event: "other", subject: "you choose a Ring-bearer" },
    actions: [{ verb: "draw", object: "you" }],
  }]);
  expect(abilities[0].trigger).toBeUndefined();
  expect(unknownTriggers).toEqual(["other"]);
});

test("a self-referential effect names ITSELF, not whatever else the sentence mentions", () => {
  // Excalibur, Sword of Eden: "This spell costs {X} less to cast, where X is the total mana value
  // of historic permanents you control." The subject is THIS SPELL; "historic permanents you
  // control" is the X-counting condition. parseSubject scanned the whole string, found
  // permanents/spell/you control, and namesItsTargets passed on words the effect does not apply to
  // -- so edges.ts fanned one card out to 97 consumers, the widest mesh in the derived population.
  const { abilities } = deriveAbilities([{
    id: 1, abilityType: "static",
    actions: [{ verb: "cost-modify", object: "this spell costs {X} less to cast, where X is the total mana value of historic permanents you control" }],
  }]);
  expect(abilities[0].effect.kind).toBe("cost-reduction");
  // The kind survives, so the card keeps its theme tag; the subject does not, so it forms no edges.
  expect(abilities[0].effect.subject).toBeUndefined();
});

test("a real lord still names its targets", () => {
  // The bound in the other direction: Foundry Inspector reduces OTHER cards' costs and must keep
  // the subject that earns it those edges.
  const { abilities } = deriveAbilities([{
    id: 1, abilityType: "static",
    actions: [{ verb: "cost-modify", object: "artifact spells you cast cost {1} less to cast" }],
  }]);
  expect(abilities[0].effect.kind).toBe("cost-reduction");
  // Only the type is asserted: `control` reads "any" here, because parseControl matches
  // "you control"/"your" and this card says "you CAST". Real, separate, and harmless in a singleton
  // deck where every card is yours -- noted rather than fixed under a mesh change.
  expect(abilities[0].effect.subject).toMatchObject({ type: "artifact" });
});

test("a trigger that watches the card ITSELF is marked, and one that watches others is not", () => {
  // The defect behind 74% of all false edges in the 2026-08-05 precision measurement. At the clause
  // layer the distinction is plain -- Gray Merchant says "this creature", Agate Instigator says
  // "another creature you control" -- but parseSubject reduced BOTH to {type: creature}, so the
  // matcher could not tell a self-ETB from a real other-creature payoff and credited every land and
  // rock in the deck with supplying it.
  const selfEtb = deriveAbilities([{
    id: 1, abilityType: "triggered",
    trigger: { event: "enters", subject: "this creature", control: "you" },
    actions: [{ verb: "lose-life", object: "each opponent" }],
  }]);
  expect(selfEtb.abilities[0].trigger?.subject.self).toBe(true);

  const others = deriveAbilities([{
    id: 1, abilityType: "triggered",
    trigger: { event: "enters", subject: "another creature you control", control: "you" },
    actions: [{ verb: "deal-damage", object: "each opponent" }],
  }]);
  expect(others.abilities[0].trigger?.subject.self).toBeUndefined();

  // "a creature" watches any creature, including other players'. Not self.
  const any = deriveAbilities([{
    id: 1, abilityType: "triggered",
    trigger: { event: "enters", subject: "a creature", control: "any" },
    actions: [{ verb: "lose-life", object: "you" }],
  }]);
  expect(any.abilities[0].trigger?.subject.self).toBeUndefined();
});

test("a trigger naming the card by its own name is self too", () => {
  // Urza's clause says subject "Urza, Lord High Artificer" -- the model names the card rather than
  // saying "this creature", and that is just as self-referential.
  const byName = deriveAbilities([{
    id: 1, abilityType: "triggered",
    trigger: { event: "enters", subject: "Urza, Lord High Artificer", control: "you" },
    actions: [{ verb: "create", object: "a Construct token" }],
  }], "Urza, Lord High Artificer");
  expect(byName.abilities[0].trigger?.subject.self).toBe(true);
});

test("a bare \"this\" subject is self too", () => {
  // Bojuka Bog and Zhalfirin Void both record trigger subject "this" with no noun after it, which
  // the noun-anchored SELF_REFERENCE missed. 22 self-ETB rows survived the first gate on this alone.
  const bare = deriveAbilities([{
    id: 1, abilityType: "triggered",
    trigger: { event: "enters", subject: "this", control: "you" },
    actions: [{ verb: "exile", object: "target player's graveyard", fromZone: "graveyard" }],
  }]);
  expect(bare.abilities[0].trigger?.subject.self).toBe(true);

  // Still not self when it names others alongside itself.
  const withOthers = deriveAbilities([{
    id: 1, abilityType: "triggered",
    trigger: { event: "dies", subject: "this creature or another creature you control", control: "you" },
    actions: [{ verb: "lose-life", object: "each opponent" }],
  }]);
  expect(withOthers.abilities[0].trigger?.subject.self).toBeUndefined();
});

test("a card referring to itself by its FIRST word is self", () => {
  // Imskir Iron-Eater's clause says trigger subject "Imskir" -- the short name its own rules text
  // uses. The short-name rule only split on a comma ("Urza, Lord High Artificer" -> "Urza"), so a
  // legendary without one slipped through and its ETB was credited to every permanent in the deck.
  const byShortName = deriveAbilities([{
    id: 1, abilityType: "triggered",
    trigger: { event: "enters", subject: "Imskir", control: "you" },
    actions: [{ verb: "draw", object: "card", amount: "X" }],
  }], "Imskir Iron-Eater");
  expect(byShortName.abilities[0].trigger?.subject.self).toBe(true);
});

test("a first word that is a creature type is NOT a self-reference", () => {
  // The bound. Goblin Bombardment's first word is a real subtype, and "whenever a Goblin enters" is
  // a genuine typal payoff -- marking it self would delete exactly the edges a Goblin deck is made
  // of. Checked against the subtype vocabulary rather than guessed.
  const typal = deriveAbilities([{
    id: 1, abilityType: "triggered",
    trigger: { event: "enters", subject: "Goblin", control: "you" },
    actions: [{ verb: "deal-damage", object: "any target" }],
  }], "Goblin Bombardment");
  expect(typal.abilities[0].trigger?.subject.self).toBeUndefined();
});

test("an action whose actor the clause names emits for that actor, not for you", () => {
  // Pongify. Without the clause text the Ape is control "any", and "any" matches "you" on either
  // side (matcher/src/subject.ts), so a removal spell formed a token-producer edge with every token
  // payoff in the deck. The clause text is free -- segment() is deterministic -- so this costs no
  // re-buy of the corpus.
  const clause = {
    id: 1,
    abilityType: "spell",
    actions: [
      { verb: "destroy", object: "target creature" },
      { verb: "create", object: "a 3/3 green Ape creature token" },
    ],
  };
  const texts = { 1: "Destroy target creature. It can't be regenerated. Its controller creates a 3/3 green Ape creature token." };

  const { abilities } = deriveAbilities([clause], undefined, texts);
  const create = abilities.find((a) => a.emits?.some((e) => e.verb === "create-token"));
  expect(create?.emits?.every((e) => e.subject.control === "opp")).toBe(true);
  expect(create?.effect.subject?.control).toBe("opp");

  // The destroy in the same clause does not inherit the CREATE's actor. It reads `opp` for its own
  // reason -- targeted removal with no stated controller, decided 2026-08-06 -- not because the
  // recipient override leaked onto it.
  const destroy = abilities.find((a) => a.emits?.some((e) => e.verb === "dies"));
  expect(destroy?.emits?.[0].subject.control).toBe("opp");

  // Without the text nothing changes -- the map is optional and absent means "say nothing".
  const before = deriveAbilities([clause]).abilities
    .find((a) => a.emits?.some((e) => e.verb === "create-token"));
  expect(before?.emits?.[0].subject.control).toBe("any");
});

test("a named actor is ignored when the clause has two actions of that verb", () => {
  // The cue localises the actor to one verb, not to one ACTION. "Target opponent draws a card, then
  // you draw a card" would otherwise hand the first draw's actor to both. A missing answer beats a
  // wrong one, so an ambiguous clause is left exactly as the object text parsed it.
  const actions = [{ verb: "draw", object: "a card" }, { verb: "draw", object: "two cards" }];
  const { abilities } = deriveAbilities(
    [{ id: 1, abilityType: "spell", actions }],
    undefined,
    { 1: "Target opponent draws a card. You draw two cards." },
  );
  expect(abilities.map((a) => a.emits?.[0].subject.control)).toEqual(["any", "any"]);

  // One action of that verb is unambiguous, so the actor IS applied.
  const one = deriveAbilities(
    [{ id: 1, abilityType: "spell", actions: [actions[0]] }],
    undefined,
    { 1: "Target opponent draws a card." },
  );
  expect(one.abilities[0].emits?.[0].subject.control).toBe("opp");
});

test("a permanent arriving tapped emits no tap event", () => {
  // Will of the Sultai ("Return all land cards from your graveyard to the battlefield tapped"),
  // Mechtitan Core, The Darkness Crystal. Nothing triggers on a permanent ENTERING tapped -- by the
  // rules it never becomes tapped, it arrives that way. emits.ts already gates this on the subject
  // having a SCOPE, which "all land cards" satisfies, so the guard missed exactly the mass-return
  // wording. The clause text is the only place the entry state survives.
  const clause = {
    id: 1,
    abilityType: "spell",
    actions: [
      { verb: "return", object: "all land cards from your graveyard", toZone: "battlefield" },
      { verb: "tap", object: "all land cards" },
    ],
  };
  const texts = { 1: "Return all land cards from your graveyard to the battlefield tapped." };
  const { abilities } = deriveAbilities([clause], undefined, texts);
  expect(abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "taps")).toEqual([]);
  // The return still enters the battlefield -- only the tap event is dropped.
  expect(abilities.flatMap((a) => a.emits ?? []).some((e) => e.verb === "enters")).toBe(true);

  // A tap aimed at something already on the battlefield is a real event and is untouched.
  const real = deriveAbilities(
    [{ id: 1, abilityType: "activated", actions: [{ verb: "tap", object: "target creature" }] }],
    undefined,
    { 1: "Sacrifice an Eldrazi Scion: Tap target creature." },
  );
  expect(real.abilities.flatMap((a) => a.emits ?? []).some((e) => e.verb === "taps")).toBe(true);
});

test("a trigger on tapping for mana is not a tap event any card can supply", () => {
  // Forsaken Monument ("Whenever you tap a permanent for {C}") and Wild Growth ("Whenever enchanted
  // land is tapped for mana"). Tapping a permanent FOR MANA is something the player does, and the
  // engine deliberately emits nothing for it -- costActions drops tapping the source, because
  // nothing triggers on it. So no producer can ever legitimately satisfy such a trigger, and every
  // match it forms is false: Drowner of Hope's "Tap target creature" is not a mana tap.
  const { abilities, unknownTriggers } = deriveAbilities(
    [{ id: 1, abilityType: "triggered", trigger: { event: "taps", subject: "a permanent", control: "you" }, actions: [{ verb: "add-mana", object: "{C}" }] }],
    undefined,
    { 1: "Whenever you tap a permanent for {C}, add an additional {C}." },
  );
  expect(abilities.every((a) => a.trigger === undefined)).toBe(true);
  expect(unknownTriggers).toContain("taps-for-mana");

  // A plain becomes-tapped trigger is untouched -- Unctus is a real payoff for Merrow Reejerey.
  const plain = deriveAbilities(
    [{ id: 1, abilityType: "triggered", trigger: { event: "taps", subject: "this creature", control: "you" }, actions: [{ verb: "draw", object: "a card" }] }],
    undefined,
    { 1: "Whenever this creature becomes tapped, draw a card, then discard a card." },
  );
  expect(plain.abilities[0].trigger?.verbs).toEqual(["taps"]);
});

test("a self-referential effect subject is marked self, not left as a bare type", () => {
  // Reassembling Skeleton, Enduring Innocence, Metalwork Colossus: "return THIS card from your
  // graveyard". All 160 graveyard-recursion effects in the corpus carried NO self marker, so
  // edges.ts read every one as recursion of a generic creature card and let any graveyard fill
  // enable it -- Buried Ruin sacrificing itself (a land) "enabled" Metalwork Colossus returning
  // itself. effectSubject already DETECTS the self-reference to avoid parsing the condition after
  // it; it just threw the fact away.
  const { abilities } = deriveAbilities([{
    id: 1, abilityType: "activated",
    actions: [{ verb: "return", object: "this card", fromZone: "graveyard", toZone: "hand" }],
  }]);
  expect(abilities[0].effect.subject?.self).toBe(true);
  expect(abilities[0].effect.subject?.zone).toBe("graveyard");

  // A recursion naming a CLASS is not self, and must keep working as it does today.
  const other = deriveAbilities([{
    id: 1, abilityType: "on-cast",
    actions: [{ verb: "return", object: "target creature card", fromZone: "graveyard", toZone: "battlefield" }],
  }]);
  expect(other.abilities[0].effect.subject?.self).toBeUndefined();
  expect(other.abilities[0].effect.subject?.type).toBe("creature");
});

test("a pronoun object inherits the subject from the search that found it", () => {
  // Every fetchland is two actions: search "your library for a Swamp or Mountain card", then put
  // "that card" onto the battlefield. The EMIT comes from the put, whose object is a pronoun, so the
  // enters event was untyped -- and an untyped producer subject wildcards past every consumer filter
  // in the matcher. Windswept Heath's fetch therefore "supplied" every enters trigger in the deck.
  const { abilities } = deriveAbilities([{
    id: 1,
    abilityType: "activated",
    actions: [
      { verb: "search", object: "your library for a Swamp or Mountain card" },
      { verb: "put", object: "that card", toZone: "battlefield" },
    ],
  }]);
  const enters = abilities.flatMap((a) => a.emits ?? []).find((e) => e.verb === "enters");
  expect(enters?.subject.subtype).toEqual(["swamp", "mountain"]);

  // A real object is never overwritten by an earlier search.
  const typed = deriveAbilities([{
    id: 1,
    abilityType: "activated",
    actions: [
      { verb: "search", object: "your library for a Swamp or Mountain card" },
      { verb: "put", object: "target creature card", toZone: "battlefield" },
    ],
  }]);
  expect(typed.abilities.flatMap((a) => a.emits ?? []).find((e) => e.verb === "enters")?.subject.type).toBe("creature");
});

test("a flicker's pronoun return inherits the thing it exiled", () => {
  // Y'shtola Rhul: "exile target creature you control, then return IT to the battlefield". Same
  // shape as the fetch, different verbs -- and an untyped enters emit is a wildcard that satisfies
  // every self-ETB in the deck.
  const { abilities } = deriveAbilities([{
    id: 1,
    abilityType: "triggered",
    actions: [
      { verb: "exile", object: "target creature you control", fromZone: "battlefield", toZone: "exile" },
      { verb: "return", object: "it", fromZone: "exile", toZone: "battlefield" },
    ],
  }]);
  const enters = abilities.flatMap((a) => a.emits ?? []).find((e) => e.verb === "enters");
  expect(enters?.subject.type).toBe("creature");
  expect(enters?.subject.control).toBe("you");
});

test("a card that returns ITSELF emits an entry marked self", () => {
  // Reassembling Skeleton, Drownyard Temple, Leyline of Resonance: "return THIS card from your
  // graveyard to the battlefield". The emit was untyped, and an untyped subject is a wildcard that
  // satisfies every consumer filter -- including another card's own ETB, which its own re-entry can
  // never be. The emit is KEPT (a Skeleton returning is a real creature entering for anyone watching
  // creatures); it is only marked as being the card itself.
  const { abilities } = deriveAbilities([{
    id: 1, abilityType: "activated",
    actions: [{ verb: "return", object: "this card", fromZone: "graveyard", toZone: "battlefield" }],
  }]);
  const enters = abilities.flatMap((a) => a.emits ?? []).find((e) => e.verb === "enters");
  expect(enters).toBeDefined();
  expect(enters?.subject.self).toBe(true);
});

test("a pronoun with no earlier action falls back to the trigger's subject", () => {
  // Kaya's Ghostform: "When ENCHANTED PERMANENT dies or is put into exile, return THAT CARD to the
  // battlefield." The antecedent is in the trigger, not in an earlier action, so the action-scan
  // found nothing and the emit stayed untyped.
  const { abilities } = deriveAbilities([{
    id: 1, abilityType: "triggered",
    trigger: { event: "dies", subject: "enchanted creature you control", control: "you" },
    actions: [{ verb: "return", object: "that card", toZone: "battlefield" }],
  }]);
  const enters = abilities.flatMap((a) => a.emits ?? []).find((e) => e.verb === "enters");
  expect(enters?.subject.type).toBe("creature");
});

test("the pronouns the corpus actually uses are all recognised", () => {
  // Measured off the 107 untyped enters emits: "searched card" (Verdant Catacombs), "the exiled
  // card" (Identity Thief), "the chosen card" (Daretti), "one of those cards" (Cultivate).
  for (const pronoun of ["searched card", "the searched card", "the exiled card", "the chosen card", "one of those cards", "those cards", "them"]) {
    const { abilities } = deriveAbilities([{
      id: 1, abilityType: "activated",
      actions: [
        { verb: "search", object: "your library for a basic land card" },
        { verb: "put", object: pronoun, toZone: "battlefield" },
      ],
    }]);
    const enters = abilities.flatMap((a) => a.emits ?? []).find((e) => e.verb === "enters");
    expect(enters?.subject.type, `pronoun: ${pronoun}`).toBe("land");
  }
});

// DROPPED: "an unstated actor on a player-facing verb is YOU". It fixed 2 sampled rows (Mind's Eye
// wanting an OPPONENT to draw, fed by a card that draws for you) and broke a gold pair twice --
// Magus of the Wheel reads "each player discards their hand, THEN draws seven cards", so its actor
// is not adjacent to the verb and the adjacency rule that prevents cross-action bleed cannot see it.
// Loosening that rule to reach it is the cross-action bleed recipient.ts exists to avoid. A missing
// answer beats a wrong one; the draw-control sub-family stays open.

test("targeted removal that names no controller is opponent-facing", () => {
  // The largest remaining sub-family in the 2026-08-07 draw: Big Game Hunter and Bitter Triumph
  // "supplied" The Meathook Massacre's payoff for creatures YOU control dying, because "destroy
  // target creature" states no controller, parses to `any`, and `any` matches `you` on either side.
  //
  // A DECISION, not a reading (user, 2026-08-06): the card genuinely does not say whose creature
  // dies. It is called `opp` because that is where removal gets pointed, and like "its controller ->
  // opp" it only ever removes edges.
  const { abilities } = deriveAbilities([{
    id: 1, abilityType: "spell", actions: [{ verb: "destroy", object: "target creature with power 4 or greater" }],
  }]);
  expect(abilities.flatMap((a) => a.emits ?? []).find((e) => e.verb === "dies")?.subject.control).toBe("opp");

  // MASS removal hits your board too and stays `any`.
  const wrath = deriveAbilities([{
    id: 1, abilityType: "spell", actions: [{ verb: "destroy", object: "all creatures" }],
  }]);
  expect(wrath.abilities.flatMap((a) => a.emits ?? []).find((e) => e.verb === "dies")?.subject.control).toBe("any");

  // A stated controller is never overridden.
  const yours = deriveAbilities([{
    id: 1, abilityType: "spell", actions: [{ verb: "destroy", object: "target creature you control" }],
  }]);
  expect(yours.abilities.flatMap((a) => a.emits ?? []).find((e) => e.verb === "dies")?.subject.control).toBe("you");

  // A SACRIFICE outlet is your own board and is untouched -- this is the aristocrats edge the engine
  // most wants to find.
  const outlet = deriveAbilities([{
    id: 1, abilityType: "activated", actions: [{ verb: "sacrifice", object: "another creature" }],
  }]);
  expect(outlet.abilities.flatMap((a) => a.emits ?? []).find((e) => e.verb === "dies")?.subject.control).toBe("any");
});

test("\"this X or another Y\" watches Y, not the union of X and Y", () => {
  // Kappa Cannoneer: "Whenever this creature or another artifact you control enters". The self half
  // and the class half name DIFFERENT types, and parseSubject UNIONS a subject's type tokens, so the
  // trigger read as "creature OR artifact" -- and Arcane Signet, a mana rock, "supplied" a creature
  // entering. The class half is the only part the deck can supply; the self half is the card's own
  // entry, which nothing else provides.
  //
  // 26 trigger subjects in the corpus have this shape and 14 name different types on the two sides.
  // Seven are the constellation template ("this creature or another enchantment you control"), where
  // the union made every creature entering trigger Eidolon of Blossoms.
  const { abilities } = deriveAbilities([{
    id: 1,
    abilityType: "triggered",
    trigger: { event: "enters", subject: "this creature or another artifact you control", control: "you" },
    actions: [{ verb: "add-counter", object: "+1/+1", amount: "1" }],
  }]);
  expect(abilities[0].trigger?.subject.type).toBe("artifact");
  // Still not a self-trigger: the deck genuinely supplies the other half.
  expect(abilities[0].trigger?.subject.self).toBeUndefined();
});

test("a self-or-class subject naming the SAME type is unchanged", () => {
  // Zulaport Cutthroat's "this creature or another creature you control" is the aristocrats payoff
  // this engine most wants to find. Stripping the self half must leave it exactly as it was.
  const { abilities } = deriveAbilities([{
    id: 1,
    abilityType: "triggered",
    trigger: { event: "dies", subject: "this creature or another creature you control", control: "you" },
    actions: [{ verb: "lose-life", object: "each opponent" }],
  }]);
  expect(abilities[0].trigger?.subject).toEqual({ control: "you", token: null, type: "creature" });
});

test("a subtype on the class half survives the strip", () => {
  // Risen Reef: "this creature or another Elemental you control". The class half names a subtype and
  // no card type, which is a narrower and more honest filter than {creature + elemental}.
  const { abilities } = deriveAbilities([{
    id: 1,
    abilityType: "triggered",
    trigger: { event: "enters", subject: "this creature or another Elemental you control", control: "you" },
    actions: [{ verb: "draw", object: "a card" }],
  }]);
  expect(abilities[0].trigger?.subject.subtype).toBe("elemental");
  expect(abilities[0].trigger?.subject.type).toBeUndefined();
});
