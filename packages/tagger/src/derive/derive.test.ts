import { expect, test } from "vitest";
import { deriveAbilities, deriveCardTags } from "./derive.js";
import type { Characteristics } from "../schema.js";

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

test("an activated drain ability carries the clause's real cost", () => {
  // Lampad of Death's Vigil: "{1}, Sacrifice a creature: Each opponent loses 1 life and you gain 1
  // life." schema.ts: an absent `cost` means "not an activated ability" -- that distinction is
  // load-bearing, and drainAbility built its literal without ever setting the field.
  const { abilities } = deriveAbilities(
    [{
      id: 1,
      abilityType: "activated",
      actions: [
        { verb: "lose-life", object: "each opponent" },
        { verb: "gain-life", object: "you" },
      ],
    }],
    undefined,
    undefined,
    { 1: "{1}, Sacrifice a creature" },
  );
  const drain = abilities.find((a) => a.effect.kind === "drain");
  expect(drain?.cost).toBe("{1}, Sacrifice a creature");
  // Merges two source actions -- no single amount is attributable, so it stays unset rather than
  // guessed.
  expect(drain?.amount).toBeUndefined();
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

test("a bare \"this\" effect object is the card itself", () => {
  // Reassembling Skeleton records "Return this card from your graveyard" as object "this", and
  // SELF_REFERENCE demands a noun after it -- so the recursion was NOT marked self, and edges.ts's
  // self-recursion gate never fired. Every graveyard fill in the deck "enabled" a Skeleton that only
  // ever returns itself. Optimus Prime is the same shape.
  //
  // The trigger side has always accepted bare "this" (Bojuka Bog); the effect side could not, because
  // an object beginning "this turn ..." is a different thing. Matching the object EXACTLY removes
  // that ambiguity -- "this turn" is not "this".
  const { abilities } = deriveAbilities([{
    id: 1, abilityType: "activated",
    actions: [{ verb: "return", object: "this", fromZone: "graveyard", toZone: "battlefield" }],
  }]);
  expect(abilities[0].effect.subject?.self).toBe(true);
  expect(abilities[0].effect.subject?.zone).toBe("graveyard");
});

test("a PRONOUN effect object inherits self from a self-referential trigger", () => {
  // Enduring Curiosity: "When Enduring Curiosity dies, ... return IT to the battlefield". The object
  // is a bare pronoun and the trigger names the card, so "it" is the card. Without this the recursion
  // reads as returning a generic creature and any fill enables it.
  const { abilities } = deriveAbilities([{
    id: 1, abilityType: "triggered",
    trigger: { event: "dies", subject: "Enduring Curiosity", control: "you" },
    actions: [{ verb: "return", object: "it", fromZone: "graveyard", toZone: "battlefield" }],
  }], "Enduring Curiosity");
  const rec = abilities.find((a) => a.effect.kind === "graveyard-recursion");
  expect(rec?.effect.subject?.self).toBe(true);
});

test("a pronoun whose trigger names something ELSE is not self", () => {
  // Kaya's Ghostform returns "that card" — the enchanted permanent, which is another card. The
  // inheritance must follow the antecedent, not assume the card itself.
  const { abilities } = deriveAbilities([{
    id: 1, abilityType: "triggered",
    trigger: { event: "dies", subject: "enchanted permanent", control: "you" },
    actions: [{ verb: "return", object: "that card", fromZone: "graveyard", toZone: "battlefield" }],
  }], "Kaya's Ghostform");
  const rec = abilities.find((a) => a.effect.kind === "graveyard-recursion");
  expect(rec?.effect.subject?.self).toBeUndefined();
});

test("a recursion records WHOSE graveyard it reads", () => {
  // Persist, Takenuma, Grave Endeavor, Luminous Broodmoth all read "from YOUR graveyard", but the
  // possessive lives in the ZONE PHRASE -- which the normalizer moves into `fromZone: "graveyard"`
  // and drops the owner of. Every recursion therefore derived control "any", and
  // `graveyardFillMatches` wildcards that: Noxious Gearhulk, Pongify and Sheoldred's Edict all fill an
  // OPPONENT's graveyard (control "opp", which targeted-removal modelling gets right), and every one
  // of them "enabled" every reanimation in the deck. ~12 of the panel's graveyard-recursion false
  // claims are this one axis.
  //
  // The clause TEXT still has the word, and derivation already receives it.
  const yours = deriveAbilities([{
    id: 1, abilityType: "spell",
    actions: [{ verb: "return", object: "target creature card", fromZone: "graveyard", toZone: "battlefield" }],
  }], undefined, { 1: "Return target creature card from your graveyard to the battlefield." });
  expect(yours.abilities[0].effect.subject?.control).toBe("you");

  const theirs = deriveAbilities([{
    id: 1, abilityType: "spell",
    actions: [{ verb: "return", object: "target creature card", fromZone: "graveyard", toZone: "battlefield" }],
  }], undefined, { 1: "Return target creature card from an opponent's graveyard to the battlefield." });
  expect(theirs.abilities[0].effect.subject?.control).toBe("opp");

  // "A graveyard" is genuinely either — Reanimate and Necromancy really do reach an opponent's, and
  // that is how Feed the Swarm feeds Grave Researcher. It must stay a wildcard.
  const any = deriveAbilities([{
    id: 1, abilityType: "spell",
    actions: [{ verb: "return", object: "target creature card", fromZone: "graveyard", toZone: "battlefield" }],
  }], undefined, { 1: "Put target creature card from a graveyard onto the battlefield under your control." });
  expect(any.abilities[0].effect.subject?.control).toBe("any");
});

test("a COUNT phrase supplies a magnitude, not a subject", () => {
  // "This Spacecraft gets +1/+0 for each ARTIFACT you control" (Uthros Research Craft) pumps ITSELF;
  // the artifacts are the count. The noun was being installed as the effect's subject, so Uthros
  // derived a `static:pump` anthem over every artifact in the deck -- 8 of the 25 false claims in the
  // `static` slice, which at 52% precision is the engine's worst family.
  //
  // Same rule the self-reference truncation already applies: everything from the count cue onward is
  // a MAGNITUDE, not a subject. A real anthem states its subject BEFORE the cue and keeps it.
  const uthros = deriveAbilities([{
    id: 1, abilityType: "static",
    actions: [{ verb: "modify-pt", object: "+1/+0 for each artifact you control" }],
  }]);
  expect(uthros.abilities[0]?.effect.subject).toBeUndefined();

  const filigree = deriveAbilities([{
    id: 1, abilityType: "static",
    actions: [{ verb: "modify-pt", object: "Filigree Attendant's power is equal to the number of artifacts you control" }],
  }]);
  expect(filigree.abilities[0]?.effect.subject).toBeUndefined();

  const elturel = deriveAbilities([{
    id: 1, abilityType: "static",
    actions: [{ verb: "modify-pt", object: "+X/+0 where X is the number of lands defending player controls" }],
  }]);
  expect(elturel.abilities[0]?.effect.subject).toBeUndefined();

  // A genuine anthem names its subject BEFORE the count and must keep it.
  const anthem = deriveAbilities([{
    id: 1, abilityType: "static",
    actions: [{ verb: "modify-pt", object: "creatures you control get +1/+1 for each Zombie you control" }],
  }]);
  expect(anthem.abilities[0]?.effect.subject).toMatchObject({ type: "creature", control: "you" });
});

test("creatures that can't attack YOU are the opponent's", () => {
  // Propaganda and Sphere of Safety tax the ATTACKER, which in a single-deck analysis is never a card
  // in this deck. Sphere derived control "you" (the possessive leaked out of "planeswalkers you
  // control") and Propaganda derived "any", so both taxed the deck's own creatures.
  const sphere = deriveAbilities([{
    id: 1, abilityType: "static",
    actions: [{ verb: "cant", object: "creatures attack you or planeswalkers you control unless their controller pays {X} for each of those creatures" }],
  }]);
  expect(sphere.abilities[0]?.effect.subject?.control).toBe("opp");

  // Propaganda's object names its creatures only INSIDE the count phrase ("for each creature they
  // control"), so the count truncation leaves no type at all and `namesItsTargets` drops the subject
  // outright. That is the stronger outcome -- no static edge rather than an opponent-scoped one --
  // and the two rules reinforce each other here.
  const propaganda = deriveAbilities([{
    id: 1, abilityType: "static",
    actions: [{ verb: "cant", object: "attack you unless their controller pays {2} for each creature they control that's attacking you" }],
  }]);
  expect(propaganda.abilities[0]?.effect.subject).toBeUndefined();
});

test("a granted keyword recovers WHO receives it, and only forms an edge when it is typal", () => {
  // Svyelun: "Other MERFOLK you control have ward {1}". The clause records `grant-ability` with the
  // thing GRANTED as its object -- "ward {1}" -- and the recipient is nowhere in the action, so the
  // card derived no ability at all and Master of Waves (a Merfolk) got no edge. 467 corpus clauses
  // carry a grant-ability action. This was the largest single defect the recall measurement found.
  //
  // The recipient is recovered from the clause text, which still has it. But a grant is only allowed
  // to form edges when it is TYPAL: "creatures you control gain haste until end of turn" applies to
  // every creature in the deck, which is the ordinary-card claim the rubric calls false and the mesh
  // that made `static` the worst family in the engine. Naming a subtype is what makes it a synergy.
  const svyelun = deriveAbilities([{
    id: 1, abilityType: "static",
    actions: [{ verb: "grant-ability", object: "ward {1}" }],
  }], "Svyelun of Sea and Sky", { 1: "Other Merfolk you control have ward {1}." });
  const grant = svyelun.abilities.find((a) => a.effect.kind === "keyword-grant");
  expect(grant?.effect.subject).toMatchObject({ subtype: "merfolk", control: "you" });

  // A grant to every creature keeps its theme tag and forms no static edge: the recipient names no
  // subtype, so nothing typal survives and `namesItsTargets` drops the subject outright.
  const generic = deriveAbilities([{
    id: 1, abilityType: "static",
    actions: [{ verb: "grant-ability", object: "trample" }],
  }], "Spidersilk Armor", { 1: "Creatures you control get +0/+1 and have reach." });
  const g2 = generic.abilities.find((a) => a.effect.kind === "keyword-grant");
  expect(g2?.effect.subject).toBeUndefined();
});

test("a recipient is the last SENTENCE before the verb, and a comma-separated typal list survives", () => {
  // The setup before a grant is not who receives it. Incandescent Soulstoke's "You may put an
  // ELEMENTAL creature card onto the battlefield. That creature gains haste" was reading the
  // Elemental out of the setup sentence, and Anger's "As long as ... you control a MOUNTAIN,
  // creatures you control have haste" was reading the condition — both handed the grant a subtype
  // the card never grants to.
  const soulstoke = deriveAbilities([{
    id: 1, abilityType: "activated",
    actions: [{ verb: "grant-ability", object: "haste" }],
  }], "Incandescent Soulstoke", {
    1: "You may put an Elemental creature card from your hand onto the battlefield. That creature gains haste until end of turn.",
  });
  expect(soulstoke.abilities.find((a) => a.effect.kind === "keyword-grant")?.effect.subject).toBeUndefined();

  const anger = deriveAbilities([{
    id: 1, abilityType: "static",
    actions: [{ verb: "grant-ability", object: "haste" }],
  }], "Anger", { 1: "As long as this card is in your graveyard and you control a Mountain, creatures you control have haste." });
  expect(anger.abilities.find((a) => a.effect.kind === "keyword-grant")?.effect.subject).toBeUndefined();

  // But a recipient may LIST its types, and those commas are part of the recipient. Raphael grants
  // lifelink to four tribes; splitting on every comma left only the last one.
  const raphael = deriveAbilities([{
    id: 1, abilityType: "static",
    actions: [{ verb: "grant-ability", object: "lifelink" }],
  }], "Raphael, Fiendish Savior", { 1: "Other Demons, Devils, Imps, and Tieflings you control get +1/+1 and have lifelink." });
  expect(raphael.abilities.find((a) => a.effect.kind === "keyword-grant")?.effect.subject)
    .toMatchObject({ subtype: ["demon", "devil", "imp", "tiefling"] });
});

test("a copy recovers WHO becomes the copy, and only forms an edge when it is typal", () => {
  // The same defect one verb over. Shapesharer: "Target SHAPESHIFTER becomes a copy of target
  // creature" records `copy` with the copy SOURCE as its object -- "target creature" -- so the
  // RECIPIENT, the thing that names a subtype, is lost exactly as a grant's was. 124 corpus clauses
  // carry a `copy` action. Universal Automaton, a Shapeshifter in the same deck, got no edge.
  const shapesharer = deriveAbilities([{
    id: 1, abilityType: "activated",
    actions: [{ verb: "copy", object: "target creature" }],
  }], "Shapesharer", { 1: "{2}{U}: Target Shapeshifter becomes a copy of target creature until your next turn." });
  const clone = shapesharer.abilities.find((a) => a.effect.kind === "clone");
  expect(clone?.effect.subject).toMatchObject({ subtype: "shapeshifter" });

  // Same guard as the grant: a copy whose recipient names no subtype reaches the whole board, so it
  // keeps its theme tag and forms no edge. The setup sentence before it is not the recipient either.
  const mass = deriveAbilities([{
    id: 1, abilityType: "activated",
    actions: [{ verb: "copy", object: "that creature" }],
  }], "Mirror Sheen", { 1: "Choose a creature you control. Each other creature you control becomes a copy of that creature until end of turn." });
  expect(mass.abilities.find((a) => a.effect.kind === "clone")?.effect.subject).toBeUndefined();
});

// A card's own NAME is not a type line. `parseSubtypes` tokenises against the closed SUBTYPES list,
// so "Expedition Map" yielded subtype `map`, "Mount Doom" yielded `mount`, and Donna Noble -- a
// Legendary Creature -- Human -- yielded `noble`. 14 subjects across 11 corpus cards. A wrong
// subtype does not widen an edge, it DELETES it (subject.ts:145), so each one was a card silently
// unable to match anything. Printed characteristics come from Scryfall; text parsing must never
// invent them out of a proper noun.
test("a subject that is the card's own name contributes no subtype", () => {
  const { abilities } = deriveAbilities([{
    id: 1,
    abilityType: "triggered",
    trigger: { event: "enters", subject: "Expedition Map" },
    actions: [{ verb: "draw", object: "you", amount: "1" }],
  }], "Expedition Map");
  expect(abilities[0].trigger?.subject.subtype).toBeUndefined();
});

test("the card's name is stripped before parsing, leaving the half a deck can supply", () => {
  // Donna Noble is a Legendary Creature -- Human. "Noble" is her surname, not her type.
  const { abilities } = deriveAbilities([{
    id: 1,
    abilityType: "triggered",
    trigger: { event: "attacks", subject: "Donna Noble or a creature it's paired with" },
    actions: [{ verb: "draw", object: "you", amount: "1" }],
  }], "Donna Noble");
  expect(abilities[0].trigger?.subject.subtype).toBeUndefined();
  expect(abilities[0].trigger?.subject.type).toBe("creature");
});

// A real typal payoff whose subtype happens to sit in the card's name must SURVIVE the strip:
// Lathliss watches other Dragons, and deleting that subtype would delete the deck it is built for.
test("stripping the name leaves a genuine typal subject alone", () => {
  const { abilities } = deriveAbilities([{
    id: 1,
    abilityType: "triggered",
    trigger: { event: "enters", subject: "another nontoken Dragon you control" },
    actions: [{ verb: "draw", object: "you", amount: "1" }],
  }], "Lathliss, Dragon Queen");
  expect(abilities[0].trigger?.subject.subtype).toBe("dragon");
});

// SUPERSEDED by the disjunction test below. This originally asserted that the subtype branch was
// DROPPED, which was the honest stopgap while SubjectFilter could not express an OR across the
// type/subtype boundary — missing rather than wrong. `anyOf` now carries it properly, and the cost
// of the stopgap was recall miss #183 (Magda losing her Dragons).

// The compound "Dragon creature" is a genuine AND and must not be caught by the OR rule.
test("a compound type and subtype with no OR is untouched", () => {
  const { abilities } = deriveAbilities([{
    id: 1,
    abilityType: "triggered",
    trigger: { event: "enters", subject: "another Dragon creature you control" },
    actions: [{ verb: "draw", object: "you", amount: "1" }],
  }], "Scalelord Reckoner");
  expect(abilities[0].trigger?.subject.type).toBe("creature");
  expect(abilities[0].trigger?.subject.subtype).toBe("dragon");
});

// "When Eye of Nidhogg is put into a graveyard from the battlefield, return IT to its owner's hand"
// returns the card ITSELF. The trigger side has been marked self since the self-ETB work, but the
// EFFECT side only recognised "this creature", a bare pronoun, or an inherited antecedent -- never
// the model writing the card's own NAME as the object. The false subtype that stripCardName removes
// was accidentally masking this: with it gone, Necromancy "enabled" Eye of Nidhogg's recursion of
// itself. Self-reference is the biggest defect family this engine has had.
test("an effect object naming the card itself is marked self", () => {
  const { abilities } = deriveAbilities([{
    id: 1,
    abilityType: "triggered",
    trigger: { event: "leaves", subject: "Eye of Nidhogg" },
    actions: [{ verb: "return", object: "Eye of Nidhogg", fromZone: "graveyard", toZone: "hand" }],
  }], "Eye of Nidhogg");
  const rec = abilities.find((a) => a.effect.kind === "graveyard-recursion");
  expect(rec?.effect.subject?.self).toBe(true);
});

// Necromancy clause 1: `cast "this spell"` then `sacrifice "it"`. The pronoun's antecedent is the
// card itself, but antecedentFor SKIPS a self-referencing earlier action while hunting for a class,
// so "it" fell through untyped -- and an untyped emit is a wildcard that satisfies every consumer
// filter. Necromancy, a REANIMATION spell, thereby "filled the graveyard" for anything recursive.
// Same family as every other self-reference loss: the card is talking about itself.
test("a pronoun object whose antecedent is the card itself emits self, not a wildcard", () => {
  const { abilities } = deriveAbilities([{
    id: 1,
    abilityType: "static",
    actions: [
      { verb: "cast", object: "this spell", optional: true },
      { verb: "sacrifice", object: "it" },
    ],
  }], "Necromancy");
  const emits = abilities.flatMap((a) => a.emits ?? []);
  expect(emits.length).toBeGreaterThan(0);
  for (const e of emits) expect(e.subject.self).toBe(true);
});

// A cross-slot OR is a real DISJUNCTION. "another creature or Vehicle you control" (Prowl) and
// "an artifact or Dragon card" (Magda) name two alternatives, and `type` and `subtype` are separate
// fields the matcher ANDs. The first fix dropped the subtype branch — missing rather than wrong,
// but it cost Magda her Dragons and left recall miss #183 open. SubjectFilter now carries `anyOf`.
test("a cross-slot OR becomes a disjunction, not a dropped branch", () => {
  const { abilities } = deriveAbilities([{
    id: 1,
    abilityType: "triggered",
    trigger: { event: "enters", subject: "another creature or Vehicle you control" },
    actions: [{ verb: "add-counter", object: "+1/+1" }],
  }], "Prowl, Pursuit Vehicle");
  const s = abilities[0].trigger!.subject;
  expect(s.anyOf).toEqual([{ type: "creature" }, { subtype: "vehicle" }]);
  // The AND is gone: neither branch is asserted on the outer subject.
  expect(s.type).toBeUndefined();
  expect(s.subtype).toBeUndefined();
  // Shared fields stay OUTSIDE the branches — "you control" governs both alternatives.
  expect(s.control).toBe("you");
});

test("a compound with no OR is still a plain AND", () => {
  const { abilities } = deriveAbilities([{
    id: 1,
    abilityType: "triggered",
    trigger: { event: "enters", subject: "another Dragon creature you control" },
    actions: [{ verb: "draw", object: "you", amount: "1" }],
  }], "Scalelord Reckoner");
  const s = abilities[0].trigger!.subject;
  expect(s.anyOf).toBeUndefined();
  expect(s.type).toBe("creature");
  expect(s.subtype).toBe("dragon");
});

// A TRIGGER is a consumer signal in its own right, independent of what the effect does. Geode Rager
// reads "Landfall — Whenever a land you control enters, goad each creature target player controls":
// `goad` maps to no effect kind and no emit, so the action was unclaimed, the clause pushed no
// ability at all, and the LANDFALL TRIGGER went with it. Every land in the deck stopped feeding it.
// 83 corpus clauses lose a legal `enters` trigger this way, plus cast 23, sacrificed 22, attacks 18,
// dies 12.
test("a triggered clause keeps its trigger even when no action is claimable", () => {
  const { abilities, unclaimed } = deriveAbilities([{
    id: 1,
    abilityType: "triggered",
    trigger: { event: "enters", subject: "a land you control", control: "you" },
    actions: [{ verb: "other", object: "goad each creature target player controls" }],
  }], "Geode Rager");
  expect(abilities).toHaveLength(1);
  expect(abilities[0].trigger?.verbs).toEqual(["enters"]);
  expect(abilities[0].trigger?.subject.type).toBe("land");
  // The effect is still honestly empty — we know WHEN it triggers, not what it does.
  expect(abilities[0].effect.kind).toBe("");
  // ...and the action is still reported as unclaimed, so the gap stays visible.
  expect(unclaimed).toHaveLength(1);
});

// A clause that DID produce an ability must not gain a second, empty one.
test("a claimable action does not also produce a bare trigger ability", () => {
  const { abilities } = deriveAbilities([{
    id: 1,
    abilityType: "triggered",
    trigger: { event: "enters", subject: "a land you control", control: "you" },
    actions: [{ verb: "gain-life", object: "you", amount: "1" }],
  }], "Courser of Kruphix");
  expect(abilities).toHaveLength(1);
  expect(abilities[0].effect.kind).toBe("lifegain");
});

// An UNKNOWN trigger event has no verb to record, so there is nothing to keep.
test("an unrecognised trigger event still produces no ability", () => {
  const { abilities, unknownTriggers } = deriveAbilities([{
    id: 1,
    abilityType: "triggered",
    trigger: { event: "damage-dealt", subject: "this creature", control: "you" },
    actions: [{ verb: "other", object: "something" }],
  }], "Flumph");
  expect(abilities).toHaveLength(0);
  expect(unknownTriggers).toContain("damage-dealt");
});

// "When the chosen player LOSES THE GAME, you win the game" (Shinryu) is normalized by the clause
// layer into the `life-lost` event. Losing the game is not losing life, so the trigger is simply
// wrong, and every life-loss card in the deck falsely feeds it — which is how a judged-false panel
// claim (Disciple of the Vault -> Shinryu) surfaced it.
//
// Refused rather than reinterpreted: the engine has no "loses the game" event, so the honest answer
// is an unknown trigger, not a near-miss. One corpus card has this shape, of four life-lost triggers.
//
// The WIN action itself still derives its own kind (effect-kind.ts's win-game mapping, added
// threshold-lines task 3) -- an untriggered `win-game` ability, exactly the same shape the
// taps-for-mana refusal above already produces for `add-mana`. The refusal is of the TRIGGER, not
// of the effect.
test("a life-lost trigger on a loses-the-game clause is refused, but its win effect survives untriggered", () => {
  const { abilities, unknownTriggers } = deriveAbilities(
    [{
      id: 1,
      abilityType: "triggered",
      trigger: { event: "life-lost", subject: "the chosen player", control: "opponent" },
      actions: [{ verb: "other", object: "you win the game" }],
    }],
    "Shinryu, Transcendent Rival",
    { 1: "When the chosen player loses the game, you win the game." },
  );
  expect(abilities).toHaveLength(1);
  expect(abilities[0].trigger).toBeUndefined();
  expect(abilities[0].effect.kind).toBe("win-game");
  expect(unknownTriggers).toContain("loses-the-game");
});

// A real life-loss trigger on a card that ALSO mentions winning the game must survive.
test("a genuine life-loss trigger is untouched", () => {
  const { abilities } = deriveAbilities(
    [{
      id: 1,
      abilityType: "triggered",
      trigger: { event: "life-lost", subject: "an opponent", control: "opp" },
      actions: [{ verb: "draw", object: "you", amount: "1" }],
    }],
    "Some Drain Payoff",
    { 1: "Whenever an opponent loses life, draw a card." },
  );
  expect(abilities[0].trigger?.verbs).toEqual(["lose-life"]);
});

// "When this enchantment leaves the battlefield, that creature's controller sacrifices it"
// (Necromancy, Animate Dead) is DRAWBACK text on a reanimation spell, not a sacrifice outlet: the
// permanent that would be the outlet is the thing leaving, and you would only ever do it because an
// opponent destroyed it. Its sacrifice/dies emits made Necromancy a sac outlet feeding Zulaport
// Cutthroat and Gixian Puppeteer — two claims the user judged FALSE in the blind agreement draw,
// hours after the untyped half of this same defect was fixed in 8ab9e1d.
test("a sacrifice triggered by the card's own departure supplies nothing", () => {
  const { abilities } = deriveAbilities([{
    id: 1,
    abilityType: "triggered",
    trigger: { event: "leaves", subject: "this enchantment", control: "you" },
    actions: [{ verb: "sacrifice", object: "that creature" }],
  }], "Necromancy");
  const emits = abilities.flatMap((a) => a.emits ?? []);
  expect(emits.filter((e) => e.verb === "sacrifice" || e.verb === "dies")).toHaveLength(0);
});

// Butcher of Malakir is the counter-case and must keep working: "whenever THIS CREATURE or another
// creature you control dies, each opponent sacrifices a creature" is a real aristocrats payoff — and
// note it DOES include the card's own death, so self-vs-other is not the distinction. The event is:
// `leaves` is a permanent departing and undoing what it did, `dies` is the aristocrats shape.
test("a death trigger watching the whole board still supplies its sacrifice", () => {
  const { abilities } = deriveAbilities([{
    id: 1,
    abilityType: "triggered",
    trigger: { event: "dies", subject: "this creature or another creature you control", control: "you" },
    actions: [{ verb: "sacrifice", object: "a creature of their choice" }],
  }], "Butcher of Malakir");
  const emits = abilities.flatMap((a) => a.emits ?? []);
  expect(emits.some((e) => e.verb === "dies")).toBe(true);
});

// A self-death trigger with a REAL payoff keeps it — only the sacrifice is suppressed, not the clause.
test("a self-death trigger still supplies its other emits", () => {
  const { abilities } = deriveAbilities([{
    id: 1,
    abilityType: "triggered",
    trigger: { event: "dies", subject: "this creature", control: "you" },
    actions: [{ verb: "create", object: "two 1/1 white Soldier creature tokens" }],
  }], "Some Death Payoff");
  expect(abilities.flatMap((a) => a.emits ?? []).some((e) => e.verb === "enters")).toBe(true);
});

// Finding 1 (2026-08-11 review): the labelling loop in deriveAbilities and the clauseCosts arg it
// reads were pinned by NOTHING — `repeats.test.ts` calls `repeatsFor` directly, so `i < abilities
// .length && false` on the labelling loop, or dropping `clauseCosts` from the deriveCardTags ->
// deriveAbilities call, both left all 413 tagger tests green. This goes through the real wiring: a
// {T} cost supplied only via the clauseCosts channel (never clauseTexts) must reach repeatsFor and
// produce "per-cycle". Verified by hand: disabling the labelling loop fails with
// "expected undefined to be 'per-cycle'"; dropping the clauseCosts threading in deriveCardTags fails
// with "expected 'repeatable' to be 'per-cycle'" (an activated ability with no cost falls through to
// rule 9, repeatable, rather than going unlabelled — still a failure, just a different wrong value).
const MINIMAL_CHARACTERISTICS: Characteristics = {
  types: [], subtypes: [], colors: [], identity: [], cmc: 0, power: null, toughness: null,
  token: false, keywords: [],
};

test("deriveAbilities threads clauseCosts through to repeatsFor's labelling loop", () => {
  const { abilities } = deriveAbilities(
    [{ id: 1, abilityType: "activated", actions: [{ verb: "draw", object: "you" }] }],
    undefined,
    { 1: "Draw a card." },
    { 1: "{T}" },
  );
  expect(abilities).toHaveLength(1);
  expect(abilities[0].repeats).toBe("per-cycle");
});

test("deriveCardTags threads clauseCosts all the way from DeriveInput to the labelled ability", () => {
  const tags = deriveCardTags({
    oracleId: "test-oracle-id",
    clauses: [{ id: 1, abilityType: "activated", actions: [{ verb: "draw", object: "you" }] }],
    characteristics: MINIMAL_CHARACTERISTICS,
    clauseTexts: { 1: "Draw a card." },
    clauseCosts: { 1: "{T}" },
  });
  expect(tags.abilities).toHaveLength(1);
  expect(tags.abilities[0].repeats).toBe("per-cycle");
});

test("an activated ability carries its real activation cost, not an empty string", () => {
  // Gogo, Master of Mimicry: "{X}{X}, {T}: Copy target activated or triggered ability you control
  // X times." segment.ts's classify() splits the cost out of the body before derivation sees it,
  // so the cost arrives as the fourth argument, keyed by clause id. Documented at repeats.ts:12-14.
  const { abilities } = deriveAbilities(
    [{
      id: 1,
      abilityType: "activated",
      actions: [{ verb: "copy", object: "target activated or triggered ability you control", amount: "X" }],
    }],
    "Gogo, Master of Mimicry",
    { 1: "Copy target activated or triggered ability you control X times." },
    { 1: "{X}{X}, {T}" },
  );
  expect(abilities[0].cost).toBe("{X}{X}, {T}");
});

test("an activated ability with no cost string keeps an empty cost rather than dropping the field", () => {
  // The field is declared on every activated ability so a consumer can tell "no cost recorded"
  // from "not an activated ability". Absent cost data is the empty string, as before.
  const { abilities } = deriveAbilities([{
    id: 1, abilityType: "activated", actions: [{ verb: "draw", object: "a card" }],
  }]);
  expect(abilities[0].cost).toBe("");
});

test("an ability records the amount of the action that produced it", () => {
  // Kaya, Ghost Assassin -2: "Each opponent loses 2 life and you gain 2 life." One clause, two
  // actions, each with its own amount -- so the amount belongs to the ability, never to the card.
  const { abilities } = deriveAbilities([{
    id: 1,
    abilityType: "activated",
    actions: [
      { verb: "lose-life", object: "each opponent", amount: "2" },
      { verb: "gain-life", object: "you", amount: "2" },
    ],
  }]);
  expect(abilities[0].amount).toBe("2");
  expect(abilities[1].amount).toBe("2");
});

test("an amount stays a STRING, because X is a legitimate value", () => {
  // Gogo, Master of Mimicry copies "X times". Coercing to a number gives NaN, the same failure
  // pressure.ts:41-43 guards against for a `*` power -- one card poisoning a whole curve.
  const { abilities } = deriveAbilities([{
    id: 1,
    abilityType: "activated",
    actions: [{ verb: "copy", object: "target activated or triggered ability you control", amount: "X" }],
  }]);
  expect(abilities[0].amount).toBe("X");
});

test("an action with no amount leaves the field unset -- refused, not defaulted to 1", () => {
  const { abilities } = deriveAbilities([{
    id: 1, abilityType: "activated", actions: [{ verb: "draw", object: "a card" }],
  }]);
  expect(abilities[0].amount).toBeUndefined();
  expect("amount" in abilities[0]).toBe(false);
});

test("a trigger carries its numeric threshold", () => {
  // The Millennium Calendar, third and fourth clauses: "When there are 1,000 or more time counters
  // on The Millennium Calendar, sacrifice it and each opponent loses 1,000 life." One printed
  // trigger, one action here (life loss); the derived ability must carry the threshold.
  // Without it the corpus reads this card as winning the turn it makes one time counter.
  const { abilities } = deriveAbilities(
    [{
      id: 1,
      abilityType: "triggered",
      trigger: { event: "counter-added", subject: "time counters on The Millennium Calendar", control: "you" },
      actions: [{ verb: "lose-life", object: "each opponent", amount: "1,000" }],
    }],
    "The Millennium Calendar",
    { 1: "When there are 1,000 or more time counters on The Millennium Calendar, sacrifice it and each opponent loses 1,000 life." },
  );
  expect(abilities[0].trigger?.threshold).toEqual({ atLeast: 1000 });
  expect(abilities[0].amount).toBe("1,000");
});

test("a trigger with no threshold leaves the field unset", () => {
  // Welcoming Vampire: "Whenever one or more other creatures you control with power 2 or less
  // enter, draw a card." Exclusion 1 does the work here: "one or more" yields atLeast 1 and is
  // dropped. The card's "power 2 or LESS" never reaches exclusion 2 at all, because COMPARISON
  // matches only "or more"/"or greater"/"at least" -- worth knowing, since the stat gate is not
  // what is protecting this card.
  const { abilities } = deriveAbilities(
    [{
      id: 1,
      abilityType: "triggered",
      trigger: { event: "enters", subject: "another creature you control", control: "you" },
      actions: [{ verb: "draw", object: "a card" }],
    }],
    "Welcoming Vampire",
    { 1: "Whenever one or more other creatures you control with power 2 or less enter, draw a card." },
  );
  expect(abilities[0].trigger?.verbs).toEqual(["enters"]);
  expect(abilities[0].trigger?.threshold).toBeUndefined();
  expect(abilities[0].trigger && "threshold" in abilities[0].trigger).toBe(false);
});

// threshold-lines task 3, fix round 2 (owner's ruling): extra-phase now records WHICH phase, so
// this is the end-to-end wiring check -- effect-kind.ts decides the phase name, derive.ts's
// effectSubject attaches it to Ability.effect.subject.phase. Sphinx of the Second Sun's real
// stored oracleText, fetched from the corpus: "At the beginning of each of your postcombat main
// phases, there is an additional beginning phase after this phase." This is activation supply per
// design spec §6.4 (phase "beginning" brings an untap step), unlike Obeka/Paradox Haze's "upkeep".
test("an extra-phase ability's subject records WHICH phase, end to end", () => {
  const { abilities } = deriveAbilities(
    [{
      id: 1,
      abilityType: "triggered",
      trigger: { event: "phase", subject: "your postcombat main phase", control: "you" },
      actions: [{ verb: "extra-turn", object: "beginning phase" }],
    }],
    "Sphinx of the Second Sun",
    { 1: "At the beginning of each of your postcombat main phases, there is an additional beginning phase after this phase." },
  );
  expect(abilities[0].effect.kind).toBe("extra-phase");
  expect(abilities[0].effect.subject?.phase).toBe("beginning");
});

test("a trigger the card's own text never names is REFUSED, not derived", () => {
  // Parnesse, the Subtle Brush triggers on being TARGETED and on COPYING a spell — neither of which
  // VERB_VOCAB can spell — and its stored clauses answered `enters` and `cast`. That made this
  // deck's own commander claim 17 synergies, every one false.
  const clauses = [{
    id: 1, abilityType: "triggered" as const,
    trigger: { event: "enters", subject: "you or a permanent you control becomes the target", control: "opponent" },
    actions: [{ verb: "counter-spell", object: "that spell or ability" }],
  }];
  const text = "Whenever you or a permanent you control becomes the target of a spell or ability an opponent controls, counter that spell or ability unless that player pays 4 life.\nWhenever you copy a spell, up to one target opponent may also copy that spell.";
  const out = deriveAbilities(clauses, "Parnesse, the Subtle Brush", { 1: text }, undefined, text);
  expect(out.unknownTriggers).toContain("phantom:enters");
  expect(out.abilities.some((a) => a.trigger !== undefined)).toBe(false);
});

test("the guard is CARD-scoped, so a modal clause keeps its trigger", () => {
  // `segment()` splits "When Kairi dies, choose one —" into a trigger clause and one clause per
  // mode, and a mode's own text does not repeat the trigger. Scoping the guard per clause was
  // measured and refuses 18 real triggers of exactly this shape to catch 1 phantom.
  const clauses = [{
    id: 2, abilityType: "triggered" as const,
    trigger: { event: "dies", subject: "this creature" },
    actions: [{ verb: "return", object: "target nonland permanents" }],
  }];
  // The CARD's text is what the guard reads, and it carries the "dies" the mode clause lacks.
  const card = "When Kairi, the Swirling Sky dies, choose one —\nReturn any number of target nonland permanents with total mana value 6 or less to their owners' hands.";
  const out = deriveAbilities(clauses, "Kairi, the Swirling Sky", { 2: card }, undefined, card);
  expect(out.unknownTriggers).not.toContain("phantom:dies");
  expect(out.abilities.some((a) => a.trigger?.verbs.includes("dies"))).toBe(true);
});

test("no oracleText disables the guard rather than guessing", () => {
  const clauses = [{
    id: 1, abilityType: "triggered" as const,
    trigger: { event: "enters", subject: "a creature" },
    actions: [{ verb: "draw", object: "a card" }],
  }];
  expect(deriveAbilities(clauses, "Whatever").unknownTriggers).not.toContain("phantom:enters");
});

// `damage-dealt` names no DIRECTION, and the two directions are opposite facts.
test("a combat-damage trigger reaches the verb the engine already had", () => {
  const clauses = [{
    id: 1, abilityType: "triggered" as const,
    trigger: { event: "damage-dealt", subject: "this creature", control: "you" },
    actions: [{ verb: "draw", object: "a card" }],
  }];
  const text = "Whenever this creature deals combat damage to a player, draw a card.";
  const out = deriveAbilities(clauses, "Whatever", { 1: text }, undefined, text);
  expect(out.abilities[0]?.trigger?.verbs).toEqual(["combat-damage"]);
});

test("noncombat damage takes the other verb, not the combat one", () => {
  const clauses = [{
    id: 1, abilityType: "triggered" as const,
    trigger: { event: "damage-dealt", subject: "this creature", control: "you" },
    actions: [{ verb: "draw", object: "a card" }],
  }];
  const text = "Whenever this creature deals damage to a player, draw a card.";
  const out = deriveAbilities(clauses, "Whatever", { 1: text }, undefined, text);
  expect(out.abilities[0]?.trigger?.verbs).toEqual(["non-combat-damage"]);
});

test("RECEIVING damage is refused, never given the dealing verb", () => {
  // Hornet Nest: "Whenever this creature is dealt damage, create that many 1/1 Insect tokens."
  // Mapped to `combat-damage` it would claim Hornet Nest DEALS damage — the opposite fact.
  const clauses = [{
    id: 1, abilityType: "triggered" as const,
    trigger: { event: "damage-dealt", subject: "this creature", control: "you" },
    actions: [{ verb: "create-token", object: "1/1 green Insect creature tokens" }],
  }];
  const text = "Whenever this creature is dealt damage, create that many 1/1 green Insect creature tokens with flying and deathtouch.";
  const out = deriveAbilities(clauses, "Hornet Nest", { 1: text }, undefined, text);
  expect(out.unknownTriggers).toContain("damage-received");
  expect(out.abilities.some((a) => a.trigger !== undefined)).toBe(false);
});
