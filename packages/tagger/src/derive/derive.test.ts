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

  const opp = deriveAbilities([{
    id: 1, abilityType: "triggered",
    trigger: { event: "draw-step", subject: "a player", control: "opponent" },
    actions: [{ verb: "deal-damage", object: "that player" }],
  }]).abilities;
  expect(opp[0]?.trigger?.subject.control).toBe("opp");
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
