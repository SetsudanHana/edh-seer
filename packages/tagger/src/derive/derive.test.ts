import { describe, expect, it, test } from "vitest";
import { manaAdded, unitAmount, stampSelfLoss, deriveAbilities, abilityKey, amountCovered, countCovered, exilesTopOfLibrary, deriveCardTags, entersUnderAnotherPlayer, textForClause } from "./derive.js";
import { grammarClauseRecords } from "../grammar/clause-record.js";
import { targetsASpellEarlier, actionEmits } from "./emits.js";
import { exileNamesOnlyGraveyards } from "./effect-kind.js";
import { victimDeclines } from "./recipient.js";
import { graveyardReplacement } from "./graveyard-replacement.js";
import { deriveInputOf } from "../derive-input.js";
import { segment } from "../segment.js";
import type { Ability, Characteristics } from "../schema.js";

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

test("a STATIC graveyard-recursion keeps its subject, singular or not", () => {
  // Lurrus of the Dream-Den: "you may cast one permanent spell with mana value 2 or less from your
  // graveyard". The whole-deck-lord guard dropped the singular subject, and both recursion passes in
  // edges.ts skip a subjectless recursion, so 66 corpus cards (Lurrus, Karador, Gisa and Geralf,
  // Gravecrawler) formed no recursion edge at all.
  const { abilities } = deriveAbilities([{
    id: 3, abilityType: "static",
    actions: [{ verb: "cast", object: "a permanent spell with mana value 2 or less", fromZone: "graveyard" }],
  }]);
  const rec = abilities.find((a) => a.effect.kind === "graveyard-recursion");
  expect(rec?.effect.subject).toMatchObject({ zone: "graveyard", umbrella: "permanent" });
  expect(rec?.effect.subject?.stats).toEqual([{ metric: "mana-value", op: "lte", value: 2 }]);
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

// J12 (2026-08-25): A BACKGROUND'S WHOLE PURPOSE IS BUFFING THE OTHER COMMANDER, and it was reading
// as synergising with nothing. The grant's recipient comes from the clause TEXT (`grantRecipient`),
// and the guard beside it demanded a SUBTYPE — so "Commander creatures you own" was dropped as if it
// were the whole-deck claim "creatures you control gain haste". A commander is one card, or two.
// Measured: of the 71 decks exactly 4 run two commanders, all four run a Background, and the edges
// between the pair read 0 · 0 · 0 · 1 before this and 0 · 1 · 1 · 2 after.
test("a grant narrowed to commanders keeps its subject, though it names no subtype", () => {
  const { abilities } = deriveAbilities(
    [{ id: 1, abilityType: "static", actions: [{ verb: "grant-ability", object: "that ability" }] }],
    "Feywild Visitor",
    { 1: "Commander creatures you own have that ability" },
  );
  expect(abilities).toHaveLength(1);
  expect(abilities[0].effect.subject?.commander).toBe(true);
  expect(abilities[0].effect.subject?.type).toBe("creature");
});

// REVERSED BY THE OWNER, 2026-09-28 (#711): a STATIC grant to every creature you control links to each
// creature it applies to, the #561 go-wide shape. A one-shot grant and anyone's board stay refused.
test("a static grant to every creature you control keeps its recipient; a one-shot one does not", () => {
  const grant = (text: string) => deriveAbilities(
    [{ id: 1, abilityType: "static", actions: [{ verb: "grant-ability", object: "haste" }] }],
    "Anger",
    { 1: text },
  ).abilities[0]?.effect.subject;
  expect(grant("Creatures you control have haste")).toMatchObject({ type: "creature", control: "you" });
  expect(grant("Other blue creatures you control have haste.")).toMatchObject({ type: "creature", control: "you", colors: ["U"] });
  expect(grant("Each other creature you control has haste.")).toMatchObject({ type: "creature", control: "you" });
  expect(grant("Creatures you control gain haste until end of turn.")).toBeUndefined();
  // One-shot by its verb, whatever the duration -- or none at all.
  expect(grant("Creatures you control gain haste until end of combat.")).toBeUndefined();
  expect(grant("{T}: Creatures you control gain haste.")).toBeUndefined();
  expect(grant("All creatures have haste.")).toBeUndefined();
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
  // Since #896 task 6 the action grammar reads each phrase's OWN actor, so the printed text answers
  // what the cue could not: the first draw is the opponent's, the second yours.
  expect(abilities.map((a) => a.emits?.[0].subject.control)).toEqual(["opp", "you"]);

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

test("a tap effect under a trigger that says enters/becomes tapped still emits taps (#1215)", () => {
  // Champions of the Shoal: "Whenever this creature enters or becomes tapped, tap up to one target
  // creature and put a stun counter on it." ARRIVES_TAPPED read the TRIGGER's "enters or becomes
  // tapped" and dropped the effect's real tap. Only the effect may speak for the arrival state.
  const text = "Whenever this creature enters or becomes tapped, tap up to one target creature and put a stun counter on it.";
  const actions = [
    { verb: "tap", object: "up to one target creature", optional: true },
    { verb: "add-counter", object: "a stun counter", amount: "1" },
  ];
  const { abilities } = deriveAbilities(
    [
      { id: 1, abilityType: "triggered", trigger: { event: "enters", subject: "this creature", control: "you" }, actions },
      { id: 2, abilityType: "triggered", trigger: { event: "taps", subject: "this creature", control: "you" }, actions },
    ],
    "Champions of the Shoal",
    { 1: text, 2: text },
  );
  // One ability per action: each trigger (enters, taps) carries a taps emit and a counter emit.
  const tappers = abilities.filter((a) => (a.emits ?? []).some((e) => e.verb === "taps"));
  expect(tappers.flatMap((a) => a.trigger?.verbs ?? []).sort()).toEqual(["enters", "taps"]);

  // The effect's own arrival state is still no event, trigger or not.
  const arrival = deriveAbilities(
    [{ id: 1, abilityType: "triggered", trigger: { event: "enters", subject: "this creature", control: "you" }, actions: [{ verb: "put", object: "target land", toZone: "battlefield" }, { verb: "tap", object: "target land" }] }],
    "Some Card",
    { 1: "When this creature enters, put target land onto the battlefield tapped." },
  );
  expect(arrival.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "taps")).toEqual([]);
});

test("a token created tapped is not tapped by an effect (CR 603.2e, Mobilize 702.181a) (#1215)", () => {
  const tapsOf = (clauses: Parameters<typeof deriveAbilities>[0], name: string, texts: Record<number, string>) =>
    deriveAbilities(clauses, name, texts).abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "taps");
  const create = (object: string, amount = "2") => ({ verb: "create", object, amount });

  // THE GRAMMAR PATH (Army of the Damned, a spell with no trigger to hide behind): the grammar itself
  // appends the companion `{verb:"tap", object:{ref:"sentence"}}` after "create ... tapped".
  for (const [name, oracleText] of [
    ["Army of the Damned", "Create thirteen tapped 2/2 black Zombie creature tokens."],
    ["Royal Warden", "When this creature enters, create two tapped 2/2 black Necron Warrior artifact creature tokens."],
  ] as const) {
    const card = { name, typeLine: "Sorcery", oracleText, keywords: [] as string[] };
    const g = grammarClauseRecords(card);
    const tags = deriveCardTags(deriveInputOf(card as never, "x", name, g.records, undefined, g.readings));
    expect(tags.abilities.some((a) => (a.emits ?? []).some((e) => e.verb === "create-token"))).toBe(true);
    expect(tags.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "taps")).toEqual([]);
  }
  // Royal Warden / Alchemist's Talent shape: the grammar adds a companion tap on the created token.
  expect(tapsOf(
    [{ id: 1, abilityType: "triggered", trigger: { event: "enters", subject: "this creature", control: "you" }, actions: [create("two tapped 2/2 black Necron Warrior artifact creature tokens"), { verb: "tap", object: "them" }] }],
    "Royal Warden", { 1: "When this creature enters, create two tapped 2/2 black Necron Warrior artifact creature tokens." },
  )).toEqual([]);
  // The tap names the created phrase itself (Leering Onlooker).
  expect(tapsOf(
    [{ id: 1, abilityType: "activated", actions: [create("two tapped 1/1 black Bat creature tokens with flying"), { verb: "tap", object: "two tapped 1/1 black Bat creature tokens with flying" }] }],
    "Leering Onlooker", { 1: "Create two tapped 1/1 black Bat creature tokens with flying." },
  )).toEqual([]);
  // "tap those tokens" is a reference to the created tokens, not a wildcard token tap (Dog Walker).
  expect(tapsOf(
    [{ id: 1, abilityType: "triggered", trigger: { event: "turned-face-up", subject: "this creature", control: "you" }, actions: [create("two tapped 1/1 white Dog creature tokens"), { verb: "tap", object: "those tokens" }] }],
    "Dog Walker", { 1: "When this creature is turned face up, create two tapped 1/1 white Dog creature tokens." },
  )).toEqual([]);
  // Mobilize-shaped: enter tapped and attacking.
  expect(tapsOf(
    [{ id: 1, abilityType: "triggered", trigger: { event: "attacks", subject: "this creature", control: "you" }, actions: [create("a tapped and attacking token that's a copy of target creature you control", "1"), { verb: "tap", object: "it" }] }],
    "Sandstorm Crasher", { 1: "Whenever this creature attacks, create a tapped and attacking token that's a copy of target creature you control." },
  )).toEqual([]);

  // A tap of something already on the battlefield, in the same clause, is still an event.
  const both = tapsOf(
    [{ id: 1, abilityType: "spell", actions: [create("two tapped Treasure tokens"), { verb: "tap", object: "them" }, { verb: "tap", object: "target creature" }] }],
    "Some Spell", { 1: "Create two tapped Treasure tokens, then tap target creature." },
  );
  expect(both).toHaveLength(1);
  expect(both[0]!.subject.scope).toBe("target");
  expect(tapsOf(
    [{ id: 1, abilityType: "spell", actions: [create("a Treasure token", "1"), { verb: "tap", object: "target creature" }] }],
    "Some Spell", { 1: "Create a Treasure token, then tap target creature." },
  )).toHaveLength(1);
});

test("a trigger on a permanent entering TRANSFORMED is not an enters trigger", () => {
  // Corruption of Towashi: "Whenever a permanent you control transforms or a permanent you control
  // enters transformed, you may draw a card." The normalizer kept "enters transformed" in the
  // SUBJECT of an `enters` clause, and derive read it as every permanent entering -- 23 deck cards
  // "reached Alandra through it" on the Ghyrson route list (2026-09-25). No engine event means
  // "enters transformed" (CR 701.27a: transforming is turning over a permanent already there), so
  // the trigger is refused; the card's `transform` clause still stands.
  const { abilities, unknownTriggers } = deriveAbilities(
    [
      { id: 2, abilityType: "triggered", trigger: { event: "transform", subject: "a permanent you control", control: "you" }, actions: [{ verb: "draw", object: "a card", amount: "1", optional: true }] },
      { id: 3, abilityType: "triggered", trigger: { event: "enters", subject: "a permanent you control enters transformed", control: "you" }, actions: [{ verb: "draw", object: "a card", amount: "1", optional: true }] },
    ],
    "Corruption of Towashi",
    { 2: "Whenever a permanent you control transforms or a permanent you control enters transformed, you may draw a card. Do this only once each turn." },
  );
  expect(abilities.flatMap((a) => a.trigger?.verbs ?? [])).toEqual(["transform"]);
  expect(unknownTriggers).toContain("enters-transformed");
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

  // A STATIC grant to every creature you control keeps its recipient since the owner's 2026-09-28
  // ruling (#711, Anger's haste), and since #857 when it follows an anthem in the same sentence
  // (Spidersilk Armor). A ONE-SHOT grant ("gain ... until end of turn") is still refused.
  const generic = deriveAbilities([{
    id: 1, abilityType: "static",
    actions: [{ verb: "grant-ability", object: "reach" }],
  }], "Spidersilk Armor", { 1: "Creatures you control get +0/+1 and have reach." });
  const g2 = generic.abilities.find((a) => a.effect.kind === "keyword-grant");
  expect(g2?.effect.subject).toMatchObject({ control: "you", type: "creature" });
  const oneShot = deriveAbilities([{ id: 1, abilityType: "spell", actions: [{ verb: "grant-ability", object: "trample" }] }],
    "Overrun-ish", { 1: "Creatures you control get +3/+3 and gain trample until end of turn." }).abilities.find((a) => a.effect.kind === "keyword-grant");
  expect(oneShot?.effect.subject?.type).toBeUndefined();
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
  // No Mountain read out of the condition; the recipient is every creature you control (#711). A
  // haste grant derives as `speed-increase`, so this reads the ability, not a `keyword-grant`.
  expect(anger.abilities[0]?.effect.subject).toMatchObject({ type: "creature", control: "you" });
  expect(anger.abilities[0]?.effect.subject?.subtype).toBeUndefined();

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

// RECALL V6 #92 AND #125 (2026-09-10): the disjunction was handled on the TRIGGER path only, and
// even there the outer subject kept `allTypes` while the branch lost it -- Canoptek Spyder's
// "another nontoken artifact creature or Vehicle" derived `anyOf` AND `allTypes: [artifact,
// creature]`, so a Vehicle that is not a creature (Necron Monolith) never matched. The EMIT path
// read the object with a bare `parseSubject`, so Skullport Merchant's "sacrifice another creature
// or a Treasure" derived a creature WITH SUBTYPE Treasure, which nothing is. Both now go through
// the parser itself, where every caller gets the same reading.
test("a cross-slot OR keeps the compound type in its branch and leaves no allTypes outside", () => {
  const { abilities } = deriveAbilities([{
    id: 1,
    abilityType: "triggered",
    trigger: { event: "enters", subject: "another nontoken artifact creature or Vehicle you control" },
    actions: [{ verb: "draw", object: "a card", amount: "1" }],
  }], "Canoptek Spyder");
  const s = abilities[0].trigger!.subject;
  expect(s.anyOf).toEqual([{ type: ["creature", "artifact"], allTypes: ["artifact", "creature"] }, { subtype: "vehicle" }]);
  expect(s.allTypes).toBeUndefined();
  expect(s.type).toBeUndefined();
  expect(s.token).toBe(false);
  expect(s.other).toBe(true);
});

test("a cross-slot OR in a sacrifice object is a disjunction on the emit", () => {
  const { abilities } = deriveAbilities([{
    id: 1,
    abilityType: "activated",
    actions: [
      { verb: "sacrifice", object: "another creature or a Treasure" },
      { verb: "draw", object: "a card", amount: "1" },
    ],
  }], "Skullport Merchant");
  const sac = abilities.flatMap((a) => a.emits ?? []).find((e) => e.verb === "sacrifice")!;
  expect(sac.subject.anyOf).toEqual([{ type: "creature" }, { subtype: "treasure" }]);
  expect(sac.subject.type).toBeUndefined();
  expect(sac.subject.subtype).toBeUndefined();
  expect(sac.subject.other).toBe(true);
});

// AND THE REMOVAL THAT NAMES TWO CLASSES STILL LEAVES THE BATTLEFIELD. Bounce Off's "return target
// creature or Vehicle to its owner's hand" and Gravkill's "exile target creature or Spacecraft"
// derived NOTHING the moment their objects became disjunctions: the permanent-shaped test read
// only the outer type. Three corpus cards went to zero abilities before this test existed.
test("a bounce over a cross-slot OR still emits leaves", () => {
  const { abilities } = deriveAbilities([{
    id: 1,
    abilityType: "spell",
    actions: [{ verb: "return", object: "target creature or Vehicle", fromZone: null, toZone: "hand" }],
  }], "Bounce Off");
  const leaves = abilities.flatMap((a) => a.emits ?? []).find((e) => e.verb === "leaves")!;
  expect(leaves).toBeDefined();
  expect(leaves.subject.anyOf).toEqual([{ type: "creature" }, { subtype: "vehicle" }]);
});

// RECALL V6 #62 AND #104 (2026-09-10): Morbid Opportunist's clause carries `control: "you"` on
// "whenever one or more other creatures die" -- the normalizer's guess, and the printed phrase names
// no controller, so nothing an opponent lost fed it (Feed the Swarm, Braids). The clause field
// overrides the subject text on purpose ("whenever you cast a spell" normalizes to subject "a
// spell"), but on a PERMANENT-EVENT verb the controller is the permanent's, and a printed phrase
// that says neither "you control" nor "your" cannot promise yours. 44 corpus triggers flip; a self
// trigger and a phrase that says "you control" keep the clause's answer.
test("a permanent-event trigger whose printed phrase names no controller is any, whatever the clause says", () => {
  const { abilities } = deriveAbilities([{
    id: 1, abilityType: "triggered",
    trigger: { event: "dies", subject: "one or more other creatures", control: "you" },
    actions: [{ verb: "draw", object: "a card", amount: "1" }],
  }], "Morbid Opportunist", { 1: "Whenever one or more other creatures die, draw a card. This ability triggers only once each turn." });
  expect(abilities[0].trigger!.subject.control).toBe("any");
});

test("the clause's you stands when the printed phrase says you control", () => {
  const { abilities } = deriveAbilities([{
    id: 1, abilityType: "triggered",
    trigger: { event: "enters", subject: "a legendary creature", control: "you" },
    actions: [{ verb: "draw", object: "a card", amount: "1" }],
  }], "Tinybones Joins Up", { 1: "Whenever a legendary creature you control enters, draw a card." });
  expect(abilities[0].trigger!.subject.control).toBe("you");
});

test("a self trigger keeps the clause's you", () => {
  const { abilities } = deriveAbilities([{
    id: 1, abilityType: "triggered",
    trigger: { event: "dies", subject: "Junji", control: "you" },
    actions: [{ verb: "draw", object: "a card", amount: "1" }],
  }], "Junji, the Midnight Sky", { 1: "When Junji dies, draw a card." });
  expect(abilities[0].trigger!.subject.self).toBe(true);
  expect(abilities[0].trigger!.subject.control).toBe("you");
});

// A COUNTER PUT ON THE CARD ITSELF IS A SELF EMIT (owner-reported 2026-09-17): Primal Amulet's
// charge counter lands on Primal Amulet, so it can never be Exemplar of Light's "whenever you put
// +1/+1 counters on THIS creature". The object names the counter; the clause text names where.
test("a counter put on this card is a self emit; one put on another permanent is not", () => {
  const emitOf = (text: string, name: string, object = "+1/+1", verb = "add-counter") => deriveAbilities(
    [{ id: 1, abilityType: "triggered", trigger: { event: "cast", subject: "a spell", control: "you" }, actions: [{ verb, object, amount: "1" }] }],
    name, { 1: text },
  ).abilities.flatMap((a) => a.emits ?? []).find((e) => e.verb === "counter-added");
  expect(emitOf("Whenever you cast an instant or sorcery spell, put a charge counter on this artifact.", "Primal Amulet", "charge counter")?.subject.self).toBe(true);
  expect(emitOf("Whenever you gain life, put a +1/+1 counter on this creature.", "Wall of Limbs")?.subject.self).toBe(true);
  expect(emitOf("This creature enters with two +1/+1 counters on it.", "Towering Titan")?.subject.self).toBe(true);
  expect(emitOf("Whenever you cast a spell, put a +1/+1 counter on Fathom Mage.", "Fathom Mage")?.subject.self).toBe(true);
  expect(emitOf("Whenever you cast a spell, put a +1/+1 counter on target creature.", "Placer")?.subject.self).toBeUndefined();
  expect(emitOf("Whenever you cast a spell, put a +1/+1 counter on each creature you control.", "Anthem")?.subject.self).toBeUndefined();
  expect(emitOf("Whenever you cast a spell, exile target creature, then return it to the battlefield with a +1/+1 counter on it.", "Blinker")?.subject.self).toBeUndefined();
  // "on it" after a trigger naming ANOTHER creature is that creature (The Great Henge; the panel's
  // Henge -> Dusk Legion Duelist is REAL). After a self trigger it is the card.
  const henge = deriveAbilities([{ id: 1, abilityType: "triggered", trigger: { event: "enters", subject: "a nontoken creature", control: "you" },
    actions: [{ verb: "add-counter", object: "+1/+1", amount: "1" }, { verb: "draw", object: "a card", amount: "1" }] }],
    "The Great Henge", { 1: "Whenever a nontoken creature you control enters, put a +1/+1 counter on it and draw a card." })
    .abilities.flatMap((a) => a.emits ?? []).find((e) => e.verb === "counter-added");
  expect(henge?.subject.self).toBeUndefined();
  const attacks = deriveAbilities([{ id: 1, abilityType: "triggered", trigger: { event: "attacks", subject: "this creature", control: "you" },
    actions: [{ verb: "add-counter", object: "+1/+1", amount: "1" }] }],
    "Grower", { 1: "Whenever this creature attacks, put a +1/+1 counter on it." })
    .abilities.flatMap((a) => a.emits ?? []).find((e) => e.verb === "counter-added");
  expect(attacks?.subject.self).toBe(true);
  // Both recipients in one clause: nothing is claimed either way.
  expect(emitOf("Whenever you cast a spell, put a +1/+1 counter on target creature and a charge counter on this artifact.", "Both")?.subject.self).toBeUndefined();
  // THE CONSUMER SIDE, passive: "whenever one or more +1/+1 counters are put on this creature" is a
  // trigger on the card itself, though the model's subject is the counter (Fathom Mage, Herd
  // Baloth). A trigger on "a creature you control" is not; an emit's "on this creature" after the
  // comma does not leak into the trigger.
  const trig = (text: string, subject: string, name: string) => deriveAbilities(
    [{ id: 1, abilityType: "triggered", trigger: { event: "counter-added", subject, control: "you" }, actions: [{ verb: "draw", object: "a card", amount: "1" }] }],
    name, { 1: text },
  ).abilities[0]?.trigger?.subject;
  expect(trig("Whenever one or more +1/+1 counters are put on this creature, draw a card.", "a +1/+1 counter", "Fathom Mage")).toMatchObject({ self: true, control: "you" });
  expect(trig("Whenever one or more +1/+1 counters are put on Fathom Mage, draw a card.", "a +1/+1 counter", "Fathom Mage")).toMatchObject({ self: true });
  expect(trig("Whenever one or more +1/+1 counters are put on a creature you control, draw a card.", "a +1/+1 counter", "Simic Ascendancy")?.self).toBeUndefined();
  // THE ACTIVE FORM (DERIVE 155): the model's subject is the recipient, so the kind is read off the
  // trigger phrase. Exemplar of Light triggers on +1/+1 counters and not on Sorin's lifelink counter;
  // a kindless "one or more counters" stays unset (and is NOT an ore counter); a kind after the
  // comma belongs to the effect, not the trigger.
  expect(trig("Whenever you put one or more +1/+1 counters on this creature, draw a card.", "this creature", "Exemplar of Light")).toMatchObject({ self: true, counter: "+1/+1" });
  expect(trig("Whenever you put one or more -1/-1 counters on a creature, draw a card.", "a creature", "Hapatra, Vizier of Poisons")?.counter).toBe("-1/-1");
  expect(trig("Whenever one or more counters are removed from this creature, draw a card.", "a counter", "Shadow Urchin")?.counter).toBeUndefined();
  expect(trig("Whenever you put one or more counters on a creature, put a charge counter on this artifact.", "a creature", "Both")?.counter).toBeUndefined();
  // DERIVE 156: the card's SHORT name is self on every face; {E} is an energy counter.
  expect(trig("Whenever one or more +1/+1 counters are put on Lonis, investigate that many times.", "Lonis with +1/+1 counters", "Lonis, Genetics Expert")).toMatchObject({ self: true, counter: "+1/+1" });
  expect(trig("Whenever one or more +1/+1 counters are put on Berta, draw a card.", "a +1/+1 counter", "Berta, Wise Extrapolator")?.self).toBe(true);
  expect(trig("Whenever you get one or more {E}, this creature gets +2/+2 until end of turn.", "energy", "Territorial Gorger")?.counter).toBe("energy");
  // A replacement on the card's OWN counters is self (Mowu); on a class it is not (Caradora).
  const repl = (text: string, name: string) => deriveAbilities(
    [{ id: 1, abilityType: "static", actions: [{ verb: "add-counter", object: "+1/+1", amount: "that many plus one" }] }], name, { 1: text },
  ).abilities.find((a) => (a.trigger?.verbs ?? []).includes("counter-added"))?.trigger?.subject;
  expect(repl("If one or more +1/+1 counters would be put on Mowu, that many plus one +1/+1 counters are put on it instead.", "Mowu, Loyal Companion")).toMatchObject({ self: true, counter: "+1/+1" });
  expect(repl("If one or more +1/+1 counters would be put on a creature or Vehicle you control, that many plus one +1/+1 counters are put on it instead.", "Caradora, Heart of Alacria")?.self).toBeUndefined();
  // DERIVE 158: a counter REMOVED from the card itself is self too, by noun or by short name.
  const rem = (text: string, subject: string, name: string) => deriveAbilities(
    [{ id: 1, abilityType: "triggered", trigger: { event: "counter-removed", subject, control: "you" }, actions: [{ verb: "draw", object: "a card", amount: "1" }] }], name, { 1: text },
  ).abilities[0]?.trigger?.subject;
  expect(rem("Whenever one or more loyalty counters are removed from Chandra, she deals that much damage to target opponent.", "a loyalty counter", "Chandra, Fire Artisan")).toMatchObject({ self: true, counter: "loyalty" });
  // "The LAST time counter ... WHILE IT'S EXILED" narrows the event past any field: refused (#896 task 5).
  expect(rem("When the last time counter is removed from this card while it's exiled, create a 2/2 black Knight creature token.", "a time counter", "Riftmarked Knight")).toBeUndefined();
  expect(rem("Whenever a counter is removed from a permanent you control, draw a card.", "a counter", "Watcher")?.self).toBeUndefined();
  // The EMIT side: counters removed from the card itself, named in the activation COST, are self;
  // removed from a target are not.
  const remEmit = (cost: string, text: string, object: string, name: string) => deriveAbilities(
    [{ id: 1, abilityType: "activated", actions: [{ verb: "remove-counter", object, amount: "twelve" }, { verb: "draw", object: "seven cards", amount: "7" }] }], name, { 1: text }, { 1: cost },
  ).abilities.flatMap((a) => a.emits ?? []).find((e) => e.verb === "counter-removed")?.subject;
  expect(remEmit("{1}{U}, {T}, Remove twelve time counters from Trenzalore Clocktower and exile it", "Shuffle your graveyard and hand into your library, then draw seven cards.", "time counter", "Trenzalore Clocktower")).toMatchObject({ self: true, counter: "time" });
  expect(remEmit("{T}, Remove a time counter from target permanent", "Draw a card.", "time counter", "Clock")?.self).toBeUndefined();
  // A MOVE is a removal from itself and an addition to others: only the removal is self.
  const move = deriveAbilities(
    [{ id: 1, abilityType: "triggered", trigger: { event: "upkeep", subject: "you", control: "you" }, actions: [{ verb: "remove-counter", object: "+1/+1" }, { verb: "add-counter", object: "+1/+1" }] }],
    "Forgotten Ancient", { 1: "At the beginning of your upkeep, you may move any number of +1/+1 counters from this creature onto other creatures." },
  ).abilities.flatMap((a) => a.emits ?? []);
  expect(move.find((e) => e.verb === "counter-removed")?.subject.self).toBe(true);
  expect(move.find((e) => e.verb === "counter-added")?.subject.self).toBeUndefined();
  // A GRANTED counter trigger is the recipients', not self (Danny Pink).
  const granted = deriveAbilities(
    [{ id: 2, abilityType: "triggered", trigger: { event: "counter-added", subject: "this creature", control: "you" }, actions: [{ verb: "draw", object: "a card", amount: "1" }] }],
    "Danny Pink", { 2: "Whenever one or more counters are put on this creature for the first time each turn, draw a card." }, undefined,
    "Mentor\nCreatures you control have \"Whenever one or more counters are put on this creature for the first time each turn, draw a card.\"",
  ).abilities[0]?.trigger?.subject;
  expect(granted?.self).toBeUndefined();
  expect(granted).toMatchObject({ control: "you", type: "creature" });
  // A static grant ("have") with a colour: Unctus's blue creatures, not Unctus and not every creature.
  const unctus = deriveAbilities(
    [{ id: 2, abilityType: "triggered", trigger: { event: "taps", subject: "this creature", control: "you" }, actions: [{ verb: "draw", object: "a card", amount: "1" }] }],
    "Unctus, Grand Metatect", { 2: "Whenever this creature becomes tapped, draw a card, then discard a card." }, undefined,
    "Other blue creatures you control have \"Whenever this creature becomes tapped, draw a card, then discard a card.\"",
  ).abilities[0]?.trigger?.subject;
  expect(unctus?.self).toBeUndefined();
  expect(unctus).toMatchObject({ control: "you", type: "creature" });
  expect(unctus?.colors).toBeUndefined(); // CEILING, see adoptGrantedRecipient
  expect(trig("Whenever you put a counter on a creature you control, put a +1/+1 counter on this creature.", "a counter", "Grower")?.self).toBeUndefined();
  // Adapt and monstrosity are self by rule.
  expect(emitOf("Adapt 2", "Incubation Druid", "2", "adapt")?.subject.self).toBe(true);
});

test("a list subject's own commas do not cut the printed phrase before you control", () => {
  const { abilities } = deriveAbilities([{
    id: 1, abilityType: "triggered",
    trigger: { event: "enters", subject: "another Frog, Rabbit, Raccoon, or Squirrel", control: "you" },
    actions: [{ verb: "add-counter", object: "+1/+1", amount: "1" }],
  }], "Valley Mightcaller", { 1: "Whenever another Frog, Rabbit, Raccoon, or Squirrel you control enters, put a +1/+1 counter on this creature." });
  expect(abilities[0].trigger!.subject.control).toBe("you");
});

test("a class subject that merely says this turn still flips to any", () => {
  const { abilities } = deriveAbilities([{
    id: 1, abilityType: "triggered",
    trigger: { event: "dies", subject: "a creature dealt damage by this creature this turn", control: "you" },
    actions: [{ verb: "create", object: "a 2/2 black Zombie creature token", amount: "1" }],
  }], "Wight", { 1: "Whenever a creature dealt damage by this creature this turn dies, create a 2/2 black Zombie creature token." });
  expect(abilities[0].trigger!.subject.control).toBe("any");
});

// A BACK FACE NAMES ITSELF TOO. `isSelfSubject` read the short name of the FIRST face only, so
// "Whenever Venom attacks" on Eddie Brock // Venom was never self -- a class with no type, kept
// `you` by the clause -- and the any-flip above would have widened it to every attacker.
test("a back face's own name is a self trigger", () => {
  const { abilities } = deriveAbilities([{
    id: 3, abilityType: "triggered",
    trigger: { event: "attacks", subject: "Venom", control: "you" },
    actions: [{ verb: "sacrifice", object: "another creature", optional: true }],
  }], "Eddie Brock // Venom, Lethal Protector", { 3: "Whenever Venom attacks, you may sacrifice another creature." });
  expect(abilities[0].trigger!.subject.self).toBe(true);
  expect(abilities[0].trigger!.subject.control).toBe("you");
});

// AND A BARE NAME THAT IS NOT SELF IS NOT A CLASS EITHER: only a subject with a type, subtype or
// keyword flips. "When Jumblebones leaves the battlefield" names the token Ozox makes -- no type
// word at all -- and widening it to `any` would make an untyped leaves over everyone's board.
test("a bare name the self test does not know keeps the clause's you", () => {
  const { abilities } = deriveAbilities([{
    id: 1, abilityType: "triggered",
    trigger: { event: "leaves", subject: "Jumblebones", control: "you" },
    actions: [{ verb: "draw", object: "a card", amount: "1" }],
  }], "Ozox, the Clattering King", { 1: "When Jumblebones leaves the battlefield, draw a card." });
  // Since #896 task 5 the name is held: `named`, which only a Jumblebones matches -- not a class.
  expect(abilities[0].trigger!.subject).toMatchObject({ named: "jumblebones" });
  expect(abilities[0].trigger!.subject.type).toBeUndefined();
});

// LAZOTEP QUARRY (recall v6 #172): "exile target creature card with mana value X from your
// graveyard. Create a token that's a copy of it" -- an exile from YOUR graveyard that then USES the
// card is recursion, not hate and not nothing, and its target is yours: the targeted-removal
// default read it as an opponent's. Lara Croft's "exile ... from a graveyard ... you may play a card
// from exile" is the same shape over any graveyard (roadmap AF7a).
test("an exile from your graveyard that copies the card is recursion over your graveyard", () => {
  const { abilities } = deriveAbilities([{
    id: 3, abilityType: "activated",
    actions: [
      { verb: "sacrifice", object: "a Desert" },
      { verb: "exile", object: "target creature card with mana value X", fromZone: "graveyard", toZone: "exile" },
      { verb: "create", object: "a token that's a copy of it, except it's a 4/4 black Zombie", amount: "1" },
    ],
  }], "Lazotep Quarry", { 3: "Exile target creature card with mana value X from your graveyard. Create a token that's a copy of it, except it's a 4/4 black Zombie. Activate only as a sorcery." });
  const rec = abilities.find((a) => a.effect.kind === "graveyard-recursion");
  expect(rec?.effect.subject?.control).toBe("you");
  expect(rec?.effect.subject?.zone).toBe("graveyard");
  const leaves = abilities.flatMap((a) => a.emits ?? []).find((e) => e.verb === "leaves");
  expect(leaves?.subject.control).toBe("you");
});

test("an exile from a graveyard that you may then play is recursion over any graveyard", () => {
  const { abilities } = deriveAbilities([{
    id: 2, abilityType: "triggered",
    trigger: { event: "attacks", subject: "Lara Croft, Tomb Raider", control: "you" },
    actions: [
      { verb: "exile", object: "up to one target legendary artifact card or legendary land card", fromZone: "graveyard", toZone: "exile" },
      { verb: "add-counter", object: "discovery", amount: "1" },
      { verb: "play", object: "a card from exile with a discovery counter on it" },
    ],
  }], "Lara Croft, Tomb Raider", { 2: "Whenever Lara Croft attacks, exile up to one target legendary artifact card or legendary land card from a graveyard and put a discovery counter on it. You may play a card from exile with a discovery counter on it this turn." });
  const rec = abilities.find((a) => a.effect.kind === "graveyard-recursion");
  expect(rec?.effect.subject?.control).toBe("any");
});

// #729 (owner ruling 2026-10-09): a card that USES a card from an OPPONENT's graveyard derives as
// recursion over their yard -- Gruesome Encore, Espers to Magicite -- so it joins the cards that
// mill opponents. Clause shapes below are the stored `cardClauses` answers, not hand-made ones.
const oppRecursion = (abilities: { effect: { kind?: string; subject?: { control?: string; type?: unknown; zone?: string } } }[]) =>
  abilities.find((a) => a.effect.kind === "graveyard-recursion")?.effect.subject;

test("Gruesome Encore puts a creature from an opponent's graveyard onto the battlefield: recursion over opp", () => {
  const text = "Put target creature card from an opponent's graveyard onto the battlefield under your control. It gains haste. Exile it at the beginning of the next end step. If that creature would leave the battlefield, exile it instead of putting it anywhere else.";
  const { abilities } = deriveAbilities([{
    id: 1, abilityType: "spell",
    actions: [
      { verb: "exile", object: "target creature card from an opponent's graveyard", fromZone: "graveyard", toZone: "battlefield" },
      { verb: "grant-ability", object: "haste" },
      { verb: "exile", object: "it", fromZone: "battlefield", toZone: "exile" },
    ],
  }], "Gruesome Encore", { 1: text }, undefined, text);
  const s = oppRecursion(abilities);
  expect(s?.control).toBe("opp");
  expect(s?.type).toBe("creature");
  expect(s?.zone).toBe("graveyard");
});

test("Espers to Magicite exiles every opponent graveyard AND copies a creature from it: hate and recursion", () => {
  const text = "Exile each opponent's graveyard. When you do, choose up to one target creature card exiled this way. Create a token that's a copy of that card, except it's an artifact and it loses all other card types.";
  const { abilities } = deriveAbilities([
    { id: 1, abilityType: "spell", actions: [{ verb: "exile", object: "each opponent's graveyard" }] },
    { id: 2, abilityType: "triggered", trigger: { event: "reflexive", subject: "exile each opponent's graveyard", control: "you" },
      actions: [{ verb: "create", object: "a token that's a copy of target creature card exiled this way, except it's an artifact and it loses all other card types", amount: "1" }] },
  ], "Espers to Magicite", { 1: "Exile each opponent's graveyard.", 2: "When you do, choose up to one target creature card exiled this way. Create a token that's a copy of that card, except it's an artifact and it loses all other card types." }, undefined, text);
  const s = oppRecursion(abilities);
  expect(s?.control).toBe("opp");
  expect(s?.type).toBe("creature");
  expect(abilities.some((a) => a.effect.kind === "graveyard-hate")).toBe(true);
});

test("Hedonist's Trove and Kefka play or cast what they exiled from an opponent's graveyard: recursion over opp", () => {
  const trove = "When this enchantment enters, exile target opponent's graveyard.\nYou may play lands from among cards exiled with this enchantment.\nYou may cast spells from among cards exiled with this enchantment. You can't cast more than one spell this way each turn.";
  const a = deriveAbilities([
    { id: 1, abilityType: "triggered", trigger: { event: "enters", subject: "this", control: "you" }, actions: [{ verb: "exile", object: "target opponent's graveyard", fromZone: "graveyard", toZone: "exile" }] },
    { id: 2, abilityType: "static", actions: [{ verb: "play", object: "lands from among cards exiled with this enchantment", optional: true }] },
    { id: 3, abilityType: "static", actions: [{ verb: "cast", object: "spells from among cards exiled with this enchantment", optional: true }] },
  ], "Hedonist's Trove", { 1: "When this enchantment enters, exile target opponent's graveyard.", 2: "You may play lands from among cards exiled with this enchantment.", 3: "You may cast spells from among cards exiled with this enchantment." }, undefined, trove).abilities;
  expect(oppRecursion(a)?.control).toBe("opp");
  const kefka = "At the beginning of your end step, exile a card at random from each opponent's graveyard. You may cast any number of spells from among cards exiled this way without paying their mana costs. Then each player who owns a spell you cast this way loses life equal to its mana value.";
  const b = deriveAbilities([
    { id: 2, abilityType: "triggered", trigger: { event: "end-step", subject: "your turn", control: "you" }, actions: [
      { verb: "exile", object: "a card at random from each opponent's graveyard", fromZone: "graveyard", toZone: "exile" },
      { verb: "cast", object: "any number of spells from among cards exiled this way", fromZone: "exile", toZone: "stack", optional: true },
    ] },
  ], "Kefka, Dancing Mad", { 2: kefka }, undefined, kefka).abilities;
  expect(oppRecursion(b)?.control).toBe("opp");
});

test("Flawless Forgery and Saruman copy and cast the exiled card: recursion over opp, typed", () => {
  const ff = "Exile target instant or sorcery card from an opponent's graveyard. Copy that card. You may cast the copy without paying its mana cost.";
  const a = deriveAbilities([{ id: 2, abilityType: "spell", actions: [
    { verb: "exile", object: "target instant or sorcery card from an opponent's graveyard", fromZone: "graveyard", toZone: "exile" },
    { verb: "copy", object: "that card" }, { verb: "cast", object: "the copy", optional: true },
  ] }], "Flawless Forgery", { 2: ff }, undefined, ff).abilities;
  expect(oppRecursion(a)?.control).toBe("opp");
  expect(oppRecursion(a)?.type).toEqual(["instant", "sorcery"]);
  const sar = "When one or more cards are milled this way, exile target enchantment, instant, or sorcery card with equal or lesser mana value than that spell from an opponent's graveyard. Copy the exiled card. You may cast the copy without paying its mana cost.";
  const b = deriveAbilities([{ id: 3, abilityType: "triggered", trigger: { event: "milled", subject: "one or more cards", control: "any" }, actions: [
    { verb: "exile", object: "target enchantment, instant, or sorcery card with equal or lesser mana value than that spell from an opponent's graveyard", fromZone: "graveyard", toZone: "exile" },
    { verb: "copy", object: "the exiled card" }, { verb: "cast", object: "the copy", optional: true },
  ] }], "Saruman of Many Colors", { 3: sar }, undefined, sar).abilities;
  expect(oppRecursion(b)?.control).toBe("opp");
});

test("Uchuulon exiles a creature card as a cost of copying ITSELF: stays hate, uses nothing", () => {
  const text = "At the beginning of your end step, exile up to one target creature card from an opponent's graveyard. If you do, create a token that's a copy of this creature.";
  const { abilities } = deriveAbilities([{ id: 2, abilityType: "triggered", trigger: { event: "end-step", subject: "you", control: "you" }, actions: [
    { verb: "exile", object: "up to one target creature card", fromZone: "graveyard", toZone: "exile", optional: true },
    { verb: "create", object: "a token that's a copy of this creature", amount: "1" },
  ] }], "Uchuulon", { 2: text }, undefined, text);
  expect(oppRecursion(abilities)).toBeUndefined();
  expect(abilities.some((a) => a.effect.kind === "graveyard-hate")).toBe(true);
});

// Soundwave, Sonic Spy: "their" in a combat-damage-to-a-player trigger is the damaged player, an opponent.
test("exiling from THEIR graveyard after combat damage to a player is a recursion over an opponent's yard", () => {
  const text = "Whenever one or more creature tokens you control deal combat damage to a player, exile target instant or sorcery card with mana value equal to the damage dealt from their graveyard. Copy it. You may cast the copy without paying its mana cost.";
  const { abilities } = deriveAbilities([{ id: 2, abilityType: "triggered", trigger: { event: "combat-damage", subject: "one or more creature tokens you control", control: "you" }, actions: [
    { verb: "exile", object: "target instant or sorcery card with mana value equal to the damage dealt", fromZone: "graveyard", toZone: "exile" },
    { verb: "copy", object: "it" }, { verb: "cast", object: "the copy", optional: true },
  ] }], "Soundwave, Sonic Spy", { 2: text }, undefined, text);
  expect(oppRecursion(abilities)?.control).toBe("opp");
});

// #1250 task 3: Tinybones casts from "that player's graveyard" -- the player it damaged, an opponent.
// The zone's owner was dropped, so the recursion read control `any` and a graveyard filler of YOUR own
// (Lively Dirge) was paired to it.
test("'that player's graveyard' after combat damage to a player by your creature is an opponent's yard", () => {
  const text = "Whenever Tinybones deals combat damage to a player, you may cast target nonland permanent card from that player's graveyard, and mana of any type can be spent to cast that spell.";
  const { abilities } = deriveAbilities([{ id: 2, abilityType: "triggered", trigger: { event: "damage-dealt", subject: "Tinybones", control: "you" }, actions: [
    { verb: "cast", object: "target nonland permanent card from that player's graveyard", fromZone: "graveyard", toZone: "stack", optional: true },
  ] }], "Tinybones, the Pickpocket", { 2: text }, undefined, text);
  const rec = abilities.find((a) => a.effect.kind === "graveyard-recursion")!;
  expect(rec.effect.subject?.control).toBe("opp");
  // Only the card LEAVING their graveyard is theirs; YOU cast it.
  expect(rec.emits?.find((e) => e.verb === "leaves")?.subject.control).toBe("opp");
  expect(rec.emits?.find((e) => e.verb === "cast")?.subject.control).not.toBe("opp");
});

test("'that player's graveyard' after ANYONE's combat damage, or a target player, is left unresolved", () => {
  const text = "Whenever a creature deals combat damage to a player, you may cast target instant card from that player's graveyard.";
  const { abilities } = deriveAbilities([{ id: 2, abilityType: "triggered", trigger: { event: "damage-dealt", subject: "a creature", control: "any" }, actions: [
    { verb: "cast", object: "target instant card from that player's graveyard", fromZone: "graveyard", toZone: "stack", optional: true },
  ] }], "Some Thief", { 2: text }, undefined, text);
  expect(abilities.find((a) => a.effect.kind === "graveyard-recursion")?.effect.subject?.control).toBe("any");
});

// #1252: "that player loses the game" after damage to a player is the DAMAGED player, an opponent (the emit
// read `you`, which a self "you lose the game" ability must not share).
const losesGame = (abilities: ReturnType<typeof deriveAbilities>["abilities"]) =>
  abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "loses-game");
const loseGameClause = (trigger: { event: string; subject: string; control: string }, text: string, object = "that player", cardName = "X") =>
  deriveAbilities([{ id: 3, abilityType: "triggered", trigger, actions: [{ verb: "lose-game", object }] }], cardName, { 3: text }, undefined, text);

test("'that player loses the game' after combat damage dealt by the card itself is the opponent", () => {
  const text = "Whenever Phage deals combat damage to a player, that player loses the game.";
  const { abilities } = loseGameClause({ event: "damage-dealt", subject: "this", control: "you" }, text, "that player", "Phage the Untouchable");
  expect(losesGame(abilities).map((e) => e.subject.control)).toEqual(["opp"]);
});

test("'that player loses the game' after equipped creature's combat damage (Vorpal Sword) is the opponent", () => {
  const text = "Whenever equipped creature deals combat damage to a player, that player loses the game.";
  const { abilities } = loseGameClause({ event: "damage-dealt", subject: "equipped creature, combat damage to a player", control: "you" }, text, "that player", "Vorpal Sword");
  expect(losesGame(abilities).map((e) => e.subject.control)).toEqual(["opp"]);
});

test("'that player loses the game' after NON-combat damage to an opponent (Atemsis) is the opponent", () => {
  const text = "Whenever Atemsis deals damage to an opponent, you may reveal your hand. If cards with at least six different mana values are revealed this way, that player loses the game.";
  const { abilities } = deriveAbilities([{ id: 3, abilityType: "triggered", trigger: { event: "damage-dealt", subject: "Atemsis", control: "you" }, actions: [
    { verb: "reveal", object: "your hand", optional: true }, { verb: "lose-game", object: "that player" },
  ] }], "Atemsis, All-Seeing", { 3: text }, undefined, text);
  expect(losesGame(abilities).map((e) => e.subject.control)).toEqual(["opp"]);
});

test("'that player loses the game' after anyone's combat damage stays unresolved, and 'you lose the game' stays yours", () => {
  const anyone = "Whenever a creature deals combat damage to a player, that player loses the game.";
  expect(losesGame(loseGameClause({ event: "damage-dealt", subject: "a creature", control: "any" }, anyone).abilities).map((e) => e.subject.control)).not.toContain("opp");
  const etb = "When Phage enters, if you didn't cast it from your hand, you lose the game.";
  expect(losesGame(loseGameClause({ event: "enters", subject: "this", control: "you" }, etb, "you", "Phage the Untouchable").abilities).map((e) => e.subject.control)).toEqual(["you"]);
  const pact = "At the beginning of your upkeep, you lose the game unless you pay {2}{U}.";
  expect(losesGame(loseGameClause({ event: "beginning-of-upkeep", subject: "your", control: "you" }, pact, "you", "Pact of Negation").abilities).map((e) => e.subject.control)).toEqual(["you"]);
});

// #1263: every cued "that player <verb>" after the card's own side's damage to a player is the DAMAGED player.
const emitControls = (abilities: ReturnType<typeof deriveAbilities>["abilities"], verb: string) =>
  abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === verb).map((e) => e.subject.control);
const thatPlayerClause = (trigger: { event: string; subject: string; control: string }, text: string, verb: string, object: string, cardName: string, extra: Record<string, unknown> = {}) =>
  deriveAbilities([{ id: 3, abilityType: "triggered", trigger, actions: [{ verb, object, ...extra }] }], cardName, { 3: text }, undefined, text).abilities;

test("'that player discards' after the card's own combat damage (Chilling Apparition) is an opponent's discard", () => {
  const text = "Whenever this creature deals combat damage to a player, that player discards a card.";
  expect(emitControls(thatPlayerClause({ event: "damage-dealt", subject: "this creature", control: "you" }, text, "discard", "a card", "Chilling Apparition"), "discard")).toEqual(["opp"]);
});

test("'that player loses half their life' after equipped creature's damage (Quietus Spike) is an opponent's loss", () => {
  const text = "Whenever equipped creature deals combat damage to a player, that player loses half their life, rounded up.";
  expect(emitControls(thatPlayerClause({ event: "damage-dealt", subject: "equipped creature", control: "you" }, text, "lose-life", "half their life, rounded up", "Quietus Spike"), "lose-life")).toEqual(["opp"]);
});

test("'that player mills' after damage by a creature you control (Anowon) is an opponent's mill", () => {
  const text = "Whenever one or more Rogues you control deal combat damage to a player, that player mills a card for each 1 damage dealt to them.";
  expect(emitControls(thatPlayerClause({ event: "damage-dealt", subject: "one or more Rogues you control", control: "you" }, text, "mill", "a card for each 1 damage dealt to them", "Anowon, the Ruin Thief"), "mill")).toEqual(["opp"]);
});

test("'that player discards': the trigger's own `self` flag reaches the recipient reading (derive plumbing)", () => {
  // The text names the damager "Chilling", neither "this ..." nor the card's full name, so only trigger.subject.self resolves it.
  const text = "Whenever Chilling deals combat damage to a player, that player discards a card.";
  expect(emitControls(thatPlayerClause({ event: "damage-dealt", subject: "this creature", control: "you" }, text, "discard", "a card", "Chilling Apparition"), "discard")).toEqual(["opp"]);
});

test("'that player discards' after ANYONE's combat damage stays `any`", () => {
  const text = "Whenever a creature deals combat damage to a player, that player discards a card.";
  expect(emitControls(thatPlayerClause({ event: "damage-dealt", subject: "a creature", control: "any" }, text, "discard", "a card", "Some Card"), "discard")).toEqual(["any"]);
});

test("'that player gets two poison counters' after the card's own damage (Marsh Viper) is an opponent's counter", () => {
  const text = "Whenever this creature deals damage to a player, that player gets two poison counters.";
  expect(emitControls(thatPlayerClause({ event: "damage-dealt", subject: "this creature", control: "you" }, text, "add-counter", "poison", "Marsh Viper", { amount: "2" }), "counter-added")).toEqual(["opp"]);
});

test("'that player exiles the top ten cards of their library' after the card's own damage (Raven Guild Master) is theirs", () => {
  const text = "Whenever this creature deals combat damage to a player, that player exiles the top ten cards of their library.";
  expect(emitControls(thatPlayerClause({ event: "damage-dealt", subject: "this creature", control: "you" }, text, "exile", "the top ten cards of that player's library", "Raven Guild Master", { fromZone: "library", toZone: "exile" }), "exiled")).toEqual(["opp"]);
});

test("an exile from a graveyard that uses nothing stays hate", () => {
  const { abilities } = deriveAbilities([{
    id: 1, abilityType: "activated",
    actions: [
      { verb: "exile", object: "target card", fromZone: "graveyard", toZone: "exile" },
      { verb: "gain-life", object: "you", amount: "2" },
    ],
  }], "Some Hate", { 1: "Exile target card from a graveyard. You gain 2 life." });
  expect(abilities.some((a) => a.effect.kind === "graveyard-recursion")).toBe(false);
  expect(abilities.some((a) => a.effect.kind === "graveyard-hate")).toBe(true);
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
test("a life-lost trigger on a loses-the-game clause is read as loses-game (AC11), and its win effect survives", () => {
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
  // The printed event is `loses-game` (an engine verb since AC11 batch 1), but since #896 task 5 the
  // trigger grammar reads "THE CHOSEN player": one player the matcher cannot pick out, a narrowing,
  // which refuses the claim (owner, 2026-10-01). The win effect survives.
  expect(abilities[0].trigger).toBeUndefined();
  expect(unknownTriggers).toContain("narrowing:loses-game");
  expect(abilities[0].effect.kind).toBe("win-game");
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

test("an action whose object states no count leaves the field unset -- refused, not defaulted to 1", () => {
  const { abilities } = deriveAbilities([{
    id: 1, abilityType: "activated", actions: [{ verb: "draw", object: "that many cards" }],
  }]);
  expect(abilities[0].amount).toBeUndefined();
  expect("amount" in abilities[0]).toBe(false);
  // "a card" STATES one (DERIVE 161): that is a reading of the card, not a default.
  expect(deriveAbilities([{ id: 1, abilityType: "activated", actions: [{ verb: "draw", object: "a card" }] }]).abilities[0].amount).toBe("1");
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
  expect(abilities[0].threshold).toEqual({ atLeast: 1000 });
  expect(abilities[0].amount).toBe("1,000");
});

/** THE SIZE OF THE TRIGGERING EVENT (2026-09-25). Ghyrson Starn fires on "exactly 1 damage", and
 *  without the amount the engine joined every pinger to him -- Eidolon of the Great Revel's 2, Flame-
 *  Kin War Scout's 4. The clause layer drops it (its trigger is `damage-dealt` by "another source you
 *  control"), so it is read off the printed trigger head, as `threshold` is. The clause below is
 *  Ghyrson's as `cardClauses` holds it. */
test("a damage trigger carries the amount it requires, read off the printed trigger", () => {
  const ghyrson = deriveAbilities(
    [{
      id: 2,
      abilityType: "triggered",
      trigger: { event: "damage-dealt", subject: "another source you control", control: "you" },
      actions: [{ verb: "deal-damage", object: "that permanent or player", amount: "2" }],
    }],
    "Ghyrson Starn, Kelermorph",
    { 2: "Whenever another source you control deals exactly 1 damage to a permanent or player, Ghyrson Starn deals 2 damage to that permanent or player." },
  );
  expect(ghyrson.abilities[0].trigger?.amount).toEqual({ op: "eq", value: 1 });
  // The EFFECT's amount is a different fact and stays where it was.
  expect(ghyrson.abilities[0].amount).toBe("2");

  const dragonborn = deriveAbilities(
    [{
      id: 1,
      abilityType: "triggered",
      trigger: { event: "damage-dealt", subject: "a source you control", control: "you" },
      actions: [{ verb: "draw", object: "a card", optional: true }],
    }],
    "Dragonborn Champion",
    { 1: "Whenever a source you control deals 5 or more damage to a player, you may draw a card." },
  );
  expect(dragonborn.abilities[0].trigger?.amount).toEqual({ op: "gte", value: 5 });
});

test("a damage trigger that states no amount, or says \"one or more\" creatures, leaves it unset", () => {
  for (const text of [
    "Whenever a source you control deals damage to an opponent, draw a card.",
    "Whenever one or more creatures you control deal combat damage to a player, draw a card.",
  ]) {
    const { abilities } = deriveAbilities(
      [{
        id: 1,
        abilityType: "triggered",
        trigger: { event: "damage-dealt", subject: "a source you control", control: "you" },
        actions: [{ verb: "draw", object: "a card" }],
      }],
      "Some Card",
      { 1: text },
    );
    expect(abilities[0].trigger).toBeDefined();
    expect("amount" in abilities[0].trigger!).toBe(false);
  }
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
  expect(abilities[0].threshold).toBeUndefined();
  expect("threshold" in abilities[0]).toBe(false);
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
  // Since #896 task 5 the printed preamble is read: the event is BECOMES-TARGET, which the engine
  // refuses by name. The stored path's phantom guard still answers for an unprinted trigger.
  expect(out.unknownTriggers).toContain("becomes-target");
  expect(out.abilities.some((a) => a.trigger !== undefined)).toBe(false);
  const unprinted = deriveAbilities(clauses, "Parnesse, the Subtle Brush", { 1: "Counter that spell or ability unless that player pays 4 life." }, undefined, "Counter that spell or ability unless that player pays 4 life.");
  expect(unprinted.unknownTriggers).toContain("phantom:enters");
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

test("RECEIVING damage is its own verb, never the dealing one (AF7d)", () => {
  // Hornet Nest: "Whenever this creature is dealt damage, create that many 1/1 Insect tokens."
  // Mapped to `combat-damage` it would claim Hornet Nest DEALS damage — the opposite fact. Stored
  // under the older `damage-dealt` spelling, the text decides; under the clause word `damaged`
  // (Stuffy Doll, normalized after the 09-09 walk) the map decides. Both derive `damaged` on self.
  const clauses = [{
    id: 1, abilityType: "triggered" as const,
    trigger: { event: "damage-dealt", subject: "this creature", control: "you" },
    actions: [{ verb: "create-token", object: "1/1 green Insect creature tokens" }],
  }];
  const text = "Whenever this creature is dealt damage, create that many 1/1 green Insect creature tokens with flying and deathtouch.";
  const out = deriveAbilities(clauses, "Hornet Nest", { 1: text }, undefined, text);
  expect(out.unknownTriggers).not.toContain("damage-received");
  expect(out.abilities[0]?.trigger).toMatchObject({ verbs: ["damaged"], subject: { self: true, control: "you" } });

  const doll = deriveAbilities(
    [{ id: 1, abilityType: "triggered" as const, trigger: { event: "damaged", subject: "this creature", control: "you" },
      actions: [{ verb: "deal-damage", object: "target player", amount: "that much" }] }],
    "Stuffy Doll",
    { 1: "Whenever this creature is dealt damage, it deals that much damage to target player." },
    undefined, "Whenever this creature is dealt damage, it deals that much damage to target player.",
  );
  expect(doll.abilities[0]?.trigger).toMatchObject({ verbs: ["damaged"], subject: { self: true } });
});

// `damage-dealt` IS WHERE AN INVENTED TRIGGER HIDES: it is the event the normalizer reaches for when
// it cannot spell one, and its branch sat ABOVE the phantom guard in the chain, returning a verb of
// its own and never being checked. 3 of the 180 damage-dealt clauses are cards whose text never says
// "damage" at all.
test("a damage trigger on a card that never mentions damage is refused", () => {
  // Path of Ancestry: "When that mana is spent to cast a creature spell that shares a creature type
  // with your commander, scry 1." Derived as "whenever a creature commander you control deals
  // noncombat damage, scry" — a wrong sentence, and its real trigger is inexpressible (no verb
  // covers "mana is spent"), so honest silence is the answer.
  const clauses = [{
    id: 1, abilityType: "triggered" as const,
    trigger: { event: "damage-dealt", control: "you",
      subject: "that mana is spent to cast a creature spell that shares a creature type with your commander" },
    actions: [{ verb: "scry", object: "1" }],
  }];
  const text = "When that mana is spent to cast a creature spell that shares a creature type with "
    + "your commander, scry 1.";
  const out = deriveAbilities(clauses, "Path of Ancestry", { 1: text }, undefined,
    `{T}: Add one mana of any color in your commander's color identity. ${text}`);
  expect(out.abilities.find((a) => a.trigger)?.trigger).toBeUndefined();
  // Since #896 task 5 the printed event is read: mana spent, which the engine refuses by name.
  expect(out.unknownTriggers).toContain("mana-spent");
});

// CR 701.7 `create` IS A TRIGGER EVENT (2026-08-21). `create-token` was always a legal VERB as an
// ACTION and the trigger side was missing, so a card watching token creation could not be recorded —
// the same story `copy` has in the TRIGGERS list. The owner named the witness from memory against a
// claim this repo carried in two files: Mirkwood Bats, "Whenever you create or sacrifice a token".
test("a create trigger derives the create-token verb", () => {
  const { abilities } = deriveAbilities([{
    id: 1,
    abilityType: "triggered",
    trigger: { event: "create", subject: "a token", control: "you" },
    actions: [{ verb: "lose-life", object: "each opponent", amount: "1" }],
  }]);
  expect(abilities[0].trigger?.verbs).toContain("create-token");
});

// A MULTIPLIER'S NARROWING LIVES INSIDE ITS OBJECT, and dropping it claims every card the nouns
// match. MEASURED: re-normalizing gave Raphael, the Muscle and Mjölnir, Hammer of Thor the subjects
// {creature, you, all} and {creature, any, all}, taking MESHED 288 -> 405 (60 + 57, the whole
// regression). The kind survives — product classifiers want it — and the claim about WHICH cards
// does not, which is CR 614's own rule in `replacement.ts` applied one layer over.
test("a multiplier narrowed by something unrepresentable keeps its kind and claims no cards", () => {
  const counters = deriveAbilities([{
    id: 1,
    abilityType: "static",
    actions: [{ verb: "double", object: "all damage that creatures you control with counters on them would deal" }],
  }]).abilities[0];
  expect(counters.effect.kind).toBe("damage-multiplier");
  expect(counters.effect.subject).toBeUndefined();

  const equipped = deriveAbilities([{
    id: 1,
    abilityType: "static",
    actions: [{ verb: "double", object: "all damage equipped creature would deal" }],
  }]).abilities[0];
  expect(equipped.effect.subject).toBeUndefined();

  // UNNARROWED MULTIPLIERS ARE UNTOUCHED: Gratuitous Violence's "creatures you control" is a class
  // this filter can hold, and the static edge it forms is a true sentence about those creatures.
  const plain = deriveAbilities([{
    id: 1,
    abilityType: "static",
    actions: [{ verb: "double", object: "all damage creatures you control would deal" }],
  }]).abilities[0];
  expect(plain.effect.subject).toBeDefined();
});

describe("an orphan clause id still finds the sentence it was split out of (K3c)", () => {
  const texts = {
    1: "Flying",
    2: "Whenever this creature enters or attacks, target opponent sacrifices a creature or planeswalker of their choice, discards a card, and loses 3 life.",
  };

  test("the model's extra clause for an OR-trigger adopts the sentence, matched on its event", () => {
    // Archon of Cruelty: segment() produces 2 clauses, the normalizer stores 3. Clause 3 is the
    // `attacks` half and has no text of its own, so `actionRecipients` never ran and the sacrifice
    // derived `control: "any"` where the enters half derived `"opp"` -- one sentence, two answers.
    expect(textForClause({ id: 3, trigger: { event: "attacks" } }, texts)).toBe(texts[2]);
  });

  test("a DECIMAL sub-id reads its base segment directly", () => {
    expect(textForClause({ id: "2.1" as unknown as number, trigger: { event: "attacks" } }, texts)).toBe(texts[2]);
  });

  test("a clause with its OWN text is untouched", () => {
    expect(textForClause({ id: 1, trigger: undefined }, texts)).toBe("Flying");
  });

  test("AMBIGUITY RETURNS NOTHING — a missing answer beats words from another ability", () => {
    // Two sentences could be the source, so adopting either would let a recipient or a controller
    // default fire on a DIFFERENT ability's words.
    const two = { 1: "Whenever this creature attacks, draw a card.", 2: "Whenever this creature attacks, each opponent loses 1 life." };
    expect(textForClause({ id: 5, trigger: { event: "attacks" } }, two)).toBe("");
    // And an orphan with no trigger at all has nothing to match on.
    expect(textForClause({ id: 9, trigger: undefined }, texts)).toBe("");
  });
});

/** 1b. The whole clause goes, not just its trigger: what is quoted on a created token is a complete
 *  ability, so keeping the effect and dropping the trigger would leave the card claiming to deal the
 *  damage its Wizard deals. Both directions, because the guard is only correct if the SAME clause
 *  still derives when its receiver is not a created token (Bello, an Equipment, a copy-self grant). */
test("a clause granted to a token the card creates derives nothing, and the same clause derives without the guard", () => {
  const clause = {
    id: 2,
    abilityType: "triggered",
    trigger: { event: "cast", subject: "a noncreature spell", control: "you" },
    actions: [{ verb: "deal-damage", object: "each opponent", amount: "1" }],
  };
  const text = 'Create a 0/1 black Wizard creature token with "Whenever you cast a noncreature spell, this token deals 1 damage to each opponent."';

  const guarded = deriveAbilities([clause], "Vivi's Persistence", { 2: text }, undefined, text, new Set([2]));
  expect(guarded.abilities).toEqual([]);

  const unguarded = deriveAbilities([clause], "Vivi's Persistence", { 2: text }, undefined, text);
  expect(unguarded.abilities.some((a) => a.trigger?.verbs?.includes("cast"))).toBe(true);
});

// M4 (2026-08-25): A COUNTER COMING OFF IS THE OPPOSITE EVENT, AND THE CLAUSE ALREADY SAYS SO — in
// its SUBJECT, which is where this pipeline keeps putting the direction (`taps-for-mana`,
// `loses-the-game`, `damage-dealt` all read a string the model left behind rather than the event
// name). Derived as written, Chandra, Fire Artisan claims to trigger when counters are ADDED, so
// every counter-placer in the deck falsely feeds a trigger that fires when they LEAVE.
test("a counter trigger whose subject says the counters were removed is read as counter-removed, never inverted", () => {
  const removed = deriveAbilities([{
    id: 1,
    abilityType: "triggered",
    trigger: { event: "counter-added", subject: "loyalty counters removed from Chandra", control: "you" },
    actions: [{ verb: "deal-damage", object: "target opponent", amount: "that much" }],
  }], "Chandra, Fire Artisan");
  // Refused into unknownTriggers until 2026-09-09; now `counter-removed` is an engine verb (AC11).
  expect(removed.unknownTriggers).not.toContain("counter-removed");
  expect(removed.abilities.some((a) => a.trigger?.verbs?.includes("counter-removed"))).toBe(true);
  expect(removed.abilities.some((a) => a.trigger?.verbs?.includes("counter-added"))).toBe(false);

  // …and the ADDING half is untouched, which is the direction that matters: a planeswalker names
  // both in different sentences, so a card-scoped test would have refused this one too.
  const added = deriveAbilities([{
    id: 1,
    abilityType: "triggered",
    trigger: { event: "counter-added", subject: "a +1/+1 counter on a creature you control", control: "you" },
    actions: [{ verb: "draw", object: "a card" }],
  }], "Whatever");
  expect(added.unknownTriggers).not.toContain("counter-removed");
  expect(added.abilities.some((a) => a.trigger?.verbs?.includes("counter-added"))).toBe(true);
});

// Oracle text from the corpus (static-out v-fe4412373506).
const POLYMORPH_TEXT = "Destroy target creature. It can't be regenerated. Its controller reveals cards from the top of their library until they reveal a creature card. The player puts that card onto the battlefield, then shuffles all other cards revealed this way into their library.";
const PROTEUS_STAFF_TEXT = "{2}{U}, {T}: Put target creature on the bottom of its owner's library. That creature's controller reveals cards from the top of their library until they reveal a creature card. The player puts that card onto the battlefield and the rest on the bottom of their library in any order. Activate only as a sorcery.";

/** THE POLYMORPH FAMILY READS AS PLAYED (owner ruling 2026-10-02, #962): on your own creature, so the
 *  creature it removes and the one it puts down are both yours. Polymorph's stored clause. */
test("Polymorph removes your creature and puts a creature from your library onto the battlefield", () => {
  const { abilities } = deriveAbilities([{ id: 1, abilityType: "spell", actions: [
    { verb: "destroy", object: "target creature", fromZone: null, toZone: null, amount: null, optional: false },
    { verb: "cant", object: "be regenerated", fromZone: null, toZone: null, amount: null, optional: false },
    { verb: "put", object: "that creature card", fromZone: "library", toZone: "battlefield", amount: null, optional: false },
  ] }], "Polymorph", { 1: POLYMORPH_TEXT }, undefined, POLYMORPH_TEXT);
  const emits = abilities.flatMap((a) => a.emits ?? []);
  expect(emits.find((e) => e.verb === "dies")?.subject.control).toBe("you");
  expect(emits.find((e) => e.verb === "enters")?.subject).toMatchObject({ control: "you", type: "creature", fromZone: "library" });
});

test("Proteus Staff's tuck is the creature it trades away", () => {
  const { abilities } = deriveAbilities([{ id: 1, abilityType: "activated", actions: [
    { verb: "put", object: "target creature", fromZone: "battlefield", toZone: "library", amount: null, optional: false },
    { verb: "put", object: "a creature card", fromZone: "library", toZone: "battlefield", amount: null, optional: false },
    { verb: "put", object: "the rest", fromZone: "library", toZone: "library", amount: null, optional: false },
  ] }], "Proteus Staff", { 1: PROTEUS_STAFF_TEXT.slice(PROTEUS_STAFF_TEXT.indexOf(": ") + 2) }, { 1: "{2}{U}, {T}" }, PROTEUS_STAFF_TEXT);
  const emits = abilities.flatMap((a) => a.emits ?? []);
  expect(emits.find((e) => e.verb === "leaves")?.subject).toMatchObject({ control: "you", type: "creature" });
  expect(emits.find((e) => e.verb === "enters")?.subject).toMatchObject({ control: "you", type: "creature", fromZone: "library" });
});

/** ROADMAP I7. A permanent entering under a controller the schema cannot name claims nothing. */
describe("entersUnderAnotherPlayer", () => {
  it("fires on Chaos Warp — the owner of the target gets the random top card", () => {
    expect(entersUnderAnotherPlayer(
      "The owner of target permanent shuffles it into their library, then reveals the top card of "
      + "their library. If it's a permanent card, they put it onto the battlefield.",
    )).toBe(true);
  });

  it("fires on the its-controller-fetches-a-basic cycle", () => {
    expect(entersUnderAnotherPlayer(
      "Exile target creature. Its controller may search their library for a basic land card, put "
      + "that card onto the battlefield tapped, then shuffle.",
    )).toBe(true);
  });

  it("REFUSES to fire when the card says the permanent enters under YOUR control", () => {
    // Curse of Unbinding: revealed off the enchanted player's library, but yours on the battlefield.
    expect(entersUnderAnotherPlayer(
      "At the beginning of enchanted player's upkeep, that player reveals cards from the top of "
      + "their library until they reveal a creature card. Put that card onto the battlefield under "
      + "your control.",
    )).toBe(false);
  });

  it("REFUSES to fire when the card also searches YOUR library — two puts, one of them real", () => {
    // Demolition Field. The clause layer records no owner per action, so a card-level refusal would
    // delete the real half; over-claiming on one card beats deleting a true claim.
    expect(entersUnderAnotherPlayer(
      "Destroy target nonbasic land an opponent controls. That land's controller may search their "
      + "library for a basic land card, put it onto the battlefield, then shuffle. You may search "
      + "your library for a basic land card, put it onto the battlefield, then shuffle.",
    )).toBe(false);
  });

  it("does not fire on 'each player', which names no antecedent controller", () => {
    // Field of Ruin: "each player" includes YOU, so you really do get a basic.
    expect(entersUnderAnotherPlayer(
      "Destroy target nonbasic land an opponent controls. Each player searches their library for a "
      + "basic land card, puts it onto the battlefield, then shuffles.",
    )).toBe(false);
  });

  // OWNER RULING 2026-10-02 (#962): a target-any card is read by its PRIMARY use. A creature that
  // reveals its controller a creature card in exchange is the polymorph family, played on your own
  // creature; Chaos Warp and Path to Exile are removal first and stay refused.
  it("does not fire on the polymorph family, which is played on your own creature", () => {
    expect(entersUnderAnotherPlayer(POLYMORPH_TEXT)).toBe(false);
    expect(entersUnderAnotherPlayer(PROTEUS_STAFF_TEXT)).toBe(false);
  });

  it("does not fire on a search of your OWN library", () => {
    expect(entersUnderAnotherPlayer(
      "Return this land to its owner's hand: Search your library for a Gate card, put it onto the "
      + "battlefield, then shuffle.",
    )).toBe(false);
  });
});

/** THE FACE REACHES THE ABILITY. `segment.ts` records which face prints each clause; this threads
 *  that through `DeriveInput` the same way `clauseTexts` and `clauseCosts` already travel -- free,
 *  recomputed rather than stored, because segmentation is deterministic.
 *
 *  Nothing READS the field yet, and that is deliberate: the population is byte-identical with it
 *  (33,862 edges / 43,376 reasons / MESHED 287), and the defect it would let the matcher fix has no
 *  witness in this corpus -- ZERO back-face abilities make a self-referential claim on a card whose
 *  faces differ in type. The fact is recorded so the split can be built on data when one appears. */
test("an ability carries the face its clause is printed on, and the front face carries none", () => {
  const tags = deriveCardTags({
    oracleId: "test-face",
    clauses: [
      { id: 1, abilityType: "static", actions: [{ verb: "draw", object: "you" }] },
      { id: 2, abilityType: "activated", actions: [{ verb: "add-mana", object: "{B}" }] },
    ],
    characteristics: MINIMAL_CHARACTERISTICS,
    clauseTexts: { 1: "Draw a card.", 2: "Add {B}." },
    // Clause 2 sits on the back face; clause 1 on the front.
    clauseFaces: { 2: 1 },
  });
  expect(tags.abilities).toHaveLength(2);
  expect(tags.abilities[0].face).toBeUndefined();
  expect(tags.abilities[1].face).toBe(1);
});

// ON AN `attacks` TRIGGER THE STATE IS THE EVENT. "Whenever a creature you control attacking causes
// a triggered ability to trigger" (Firebender Ascension), "whenever a creature attacking one of your
// opponents ..." (Seifer): the attacker IS attacking, and demanding the state from the implied
// `attacks` producer -- which never states it -- would delete every real edge these have. Kept on
// every other verb: "whenever an attacking creature DIES" is a narrowing the death alone lacks.
test("a combat state on an attacks trigger is dropped; on a dies trigger it is kept", () => {
  const seifer = deriveAbilities([{
    id: 1, abilityType: "triggered",
    trigger: { event: "attacks", subject: "a creature attacking one of your opponents" },
    actions: [{ verb: "draw", object: "a card", amount: "1" }],
  }]).abilities;
  expect(seifer[0].trigger?.subject.combat).toBeUndefined();
  const kardur = deriveAbilities([{
    id: 1, abilityType: "triggered",
    trigger: { event: "dies", subject: "an attacking creature" },
    actions: [{ verb: "lose-life", object: "each opponent", amount: "1" }],
  }]).abilities;
  expect(kardur[0].trigger?.subject.combat).toBe("attacking");
});

// TIMING, THE SMALLEST MODEL THAT HOLDS A RULING. Owner (2026-08-22, upheld): Ayara -> Death Tyrant
// is REAL because "a sac outlet can eat an attacking creature" -- an activated ability is used at
// instant speed, in combat, and a sorcery is not. So an emit from an activated ability (loyalty and
// "activate only as a sorcery" excepted), an instant, or a flash spell is stamped `instantSpeed`,
// and a combat-state demand accepts such a producer. Blasphemous Edict stays refused.
test("an emit from an activated ability, an instant or a flash spell is instant-speed; a sorcery is not", () => {
  const outlet = deriveAbilities(
    [{ id: 1, abilityType: "activated", actions: [{ verb: "sacrifice", object: "another creature" }, { verb: "draw", object: "a card" }] }],
    "Ayara", { 1: "{T}, Sacrifice another black creature: Draw a card." }, { 1: "{T}, Sacrifice another black creature" },
  ).abilities;
  expect(outlet.find((a) => a.emits?.some((e) => e.verb === "dies"))?.emits?.every((e) => e.instantSpeed === true)).toBe(true);
  const sorcerySpeed = deriveAbilities(
    [{ id: 1, abilityType: "activated", actions: [{ verb: "sacrifice", object: "a creature" }] }],
    "Altar", { 1: "{2}, Sacrifice a creature: Draw a card. Activate only as a sorcery." }, { 1: "{2}, Sacrifice a creature" },
  ).abilities;
  expect(sorcerySpeed[0].emits?.[0].instantSpeed).toBeUndefined();
  const loyalty = deriveAbilities(
    [{ id: 1, abilityType: "activated", actions: [{ verb: "destroy", object: "target creature" }] }],
    "Walker", { 1: "−3: Destroy target creature." }, { 1: "−3" },
  ).abilities;
  expect(loyalty[0].emits?.[0].instantSpeed).toBeUndefined();
  const edict = deriveCardTags({
    oracleId: "edict", clauses: [{ id: 1, abilityType: "spell", actions: [{ verb: "sacrifice", object: "thirteen creatures" }] }],
    characteristics: { ...MINIMAL_CHARACTERISTICS, types: ["sorcery"] },
  });
  expect(edict.abilities[0].emits?.[0].instantSpeed).toBeUndefined();
  const instant = deriveCardTags({
    oracleId: "rollick", clauses: [{ id: 1, abilityType: "spell", actions: [{ verb: "destroy", object: "target creature" }] }],
    characteristics: { ...MINIMAL_CHARACTERISTICS, types: ["instant"] },
  });
  expect(instant.abilities[0].emits?.[0].instantSpeed).toBe(true);
  const flash = deriveCardTags({
    oracleId: "flash", clauses: [{ id: 1, abilityType: "spell", actions: [{ verb: "destroy", object: "target creature" }] }],
    characteristics: { ...MINIMAL_CHARACTERISTICS, types: ["sorcery"], keywords: ["Flash"] },
  });
  expect(flash.abilities[0].emits?.[0].instantSpeed).toBe(true);
});

// A DELAYED SACRIFICE IS NOT INSTANT SPEED (#1250). Reflection of Kiki-Jiki's "Sacrifice it at the
// beginning of the next end step" happens on a delayed trigger, so no player can aim it at an attacker
// and Kardur's "an attacking creature dies" was owner-judged FALSE. The token it makes keeps the stamp.
test("an emit from a delayed 'at the beginning of the next end step' sacrifice is not instant-speed", () => {
  const text = "{1}, {T}: Create a token that's a copy of another target nonlegendary creature you control, except it has haste. Sacrifice it at the beginning of the next end step.";
  const abilities = deriveAbilities(
    [{ id: 1, abilityType: "activated", actions: [{ verb: "create", object: "a token that's a copy of another target nonlegendary creature you control" }, { verb: "sacrifice", object: "it" }] }],
    "Reflection", { 1: text }, { 1: "{1}, {T}" },
  ).abilities;
  const made = abilities.find((a) => a.emits?.some((e) => e.verb === "create-token"));
  expect(made?.emits?.filter((e) => e.verb !== "dies").every((e) => e.instantSpeed === true)).toBe(true);
  const sac = abilities.filter((a) => a.emits?.some((e) => e.verb === "sacrifice"));
  expect(sac.length).toBeGreaterThan(0);
  for (const a of sac) expect(a.emits?.some((e) => e.instantSpeed === true)).toBe(false);
});

// ...the guard's edges (#1250 review). It reads the action's OWN sentence and only a delay naming a LATER moment.
test("the delayed-action guard: an instant's delayed sacrifice, a delayed return beside an immediate exile, and the non-delays", () => {
  const stamped = (a: { emits?: { instantSpeed?: true }[] }) => a.emits?.some((e) => e.instantSpeed === true);
  // (d) an instant spell's delayed sacrifice is de-stamped, like an activated ability's.
  const reanimate = deriveCardTags({
    oracleId: "ap", clauses: [{ id: 1, abilityType: "spell", actions: [{ verb: "put", object: "target creature card from a graveyard", toZone: "battlefield" }, { verb: "sacrifice", object: "it" }] }],
    clauseTexts: { 1: "Put target creature card from a graveyard onto the battlefield under your control. It gains haste. Sacrifice it at the beginning of the next end step." },
    characteristics: { ...MINIMAL_CHARACTERISTICS, types: ["instant"] },
  });
  const sacs = reanimate.abilities.filter((a) => a.emits?.some((e) => e.verb === "sacrifice"));
  expect(sacs.length).toBeGreaterThan(0);
  for (const a of sacs) expect(stamped(a)).toBe(false);
  // (a) "Exile X, then return it ... at the beginning of the next end step": the exile stays instant, the return does not.
  const blink = deriveAbilities(
    [{ id: 1, abilityType: "activated", actions: [{ verb: "exile", object: "target creature you control", fromZone: "battlefield", toZone: "exile" }, { verb: "return", object: "it", fromZone: "exile", toZone: "battlefield" }] }],
    "Blinker", { 1: "{T}: Exile target creature you control, then return it to the battlefield at the beginning of the next end step." }, { 1: "{T}" },
  ).abilities;
  expect(blink.filter((a) => a.emits?.some((e) => e.verb === "exiled")).every(stamped)).toBe(true);
  const back = blink.filter((a) => a.emits?.some((e) => e.verb === "enters"));
  expect(back.length).toBeGreaterThan(0);
  for (const a of back) expect(stamped(a)).toBe(false);
  // (b) "each end step" and (c) "until end of turn" are not delays of the action.
  for (const [text, actions] of [
    ["{T}: Sacrifice a creature at the beginning of each end step.", [{ verb: "sacrifice", object: "a creature" }]],
    ["{T}: Sacrifice a creature. It gains haste until end of turn.", [{ verb: "sacrifice", object: "a creature" }]],
  ] as const) {
    const abs = deriveAbilities([{ id: 1, abilityType: "activated", actions: [...actions] }], "N", { 1: text }, { 1: "{T}" }).abilities;
    const sac = abs.filter((a) => a.emits?.some((e) => e.verb === "sacrifice"));
    expect(sac.length, text).toBeGreaterThan(0);
    for (const a of sac) expect(stamped(a), text).toBe(true);
  }
});

// "AT END OF COMBAT" IS NOT A DELAY PAST COMBAT (#1250 branch review). CR 511.2: the ability triggers as
// the end of combat step begins; CR 511.3: creatures leave combat only as that step ends. So Goblin Sappers'
// "Destroy it at end of combat" still kills an ATTACKING creature and keeps its instant-speed stamp.
test("an emit from a 'destroy it at end of combat' keeps instantSpeed (the creature is still attacking)", () => {
  const abs = deriveAbilities(
    [{ id: 1, abilityType: "activated", actions: [{ verb: "cant", object: "be blocked this turn" }, { verb: "destroy", object: "target creature you control" }, { verb: "destroy", object: "this creature" }] }],
    "Goblin Sappers", { 1: "Target creature you control can't be blocked this turn. Destroy it and this creature at end of combat." }, { 1: "{R}{R}, {T}" },
  ).abilities;
  const kills = abs.filter((a) => a.emits?.some((e) => e.verb === "dies"));
  expect(kills.length).toBeGreaterThan(0);
  expect(kills.some((a) => a.emits?.some((e) => e.instantSpeed === true))).toBe(true);
});

// THE EERIE HALF, AND THE CHANNEL THAT WAS SUPPOSED TO CATCH ITS ABSENCE. "Whenever you fully unlock
// a Room" was recorded by the clause layer as `unlocked` and derived to nothing, and
// `unknownTriggers` -- the field that exists so a dropped trigger is visible -- was computed and then
// discarded by `deriveCardTags`, so every persisted doc read as if nothing had ever been unknown.
test("an unlocked trigger derives to the unlock verb, and an unknown event is persisted as unknown", () => {
  const eerie = deriveCardTags({
    oracleId: "leech",
    clauses: [
      { id: 1, abilityType: "triggered", trigger: { event: "unlocked", subject: "a Room", control: "you" }, actions: [{ verb: "lose-life", object: "each opponent", amount: "1" }] },
      { id: 2, abilityType: "triggered", trigger: { event: "no-such-event", subject: "a Room", control: "you" }, actions: [{ verb: "draw", object: "a card", amount: "1" }] },
    ],
    characteristics: MINIMAL_CHARACTERISTICS,
  });
  expect(eerie.abilities.some((a) => a.trigger?.verbs.includes("unlock"))).toBe(true);
  expect(eerie.unknownTriggers).toEqual(["no-such-event"]);
  const clean = deriveCardTags({ oracleId: "clean", clauses: [], characteristics: MINIMAL_CHARACTERISTICS });
  expect("unknownTriggers" in clean).toBe(false);
});

// THE MODEL DROPPED THE ZONE (money layer, 2026-09-05): Desecrated Tomb's raw answer is subject
// "one or more creature cards" with no zone, identical to The Ozolith's battlefield leave, and every
// death in the deck fed it. The clause TEXT still says "leave your graveyard", and derive has it.
test("a leaves trigger whose text names the graveyard derives zone graveyard; a battlefield one does not", () => {
  const tomb = deriveCardTags({
    oracleId: "tomb",
    clauses: [{
      id: 1, abilityType: "triggered",
      trigger: { event: "leaves", subject: "one or more creature cards", control: "you" },
      actions: [{ verb: "create", object: "a 1/1 black Bat creature token with flying" }],
    }],
    clauseTexts: { 1: "Whenever one or more creature cards leave your graveyard, create a 1/1 black Bat creature token with flying." },
    characteristics: MINIMAL_CHARACTERISTICS,
  });
  const tombTrigger = tomb.abilities.find((a) => a.trigger?.verbs.includes("leaves"))!.trigger!;
  expect(tombTrigger.subject.zone).toBe("graveyard");
  expect(tombTrigger.subject.withoutDying).toBeUndefined();

  const ozolith = deriveCardTags({
    oracleId: "ozolith",
    clauses: [{
      id: 1, abilityType: "triggered",
      trigger: { event: "leaves", subject: "a creature you control", control: "you" },
      actions: [{ verb: "add-counter", object: "those counters" }],
    }],
    clauseTexts: { 1: "Whenever a creature you control leaves the battlefield, if it had counters on it, put those counters on The Ozolith." },
    characteristics: MINIMAL_CHARACTERISTICS,
  });
  // "if it had counters on it" is an intervening if derive cannot check: refused since #896 task 5
  // (owner, 2026-10-01). Its demand on the deck survives as a cares tag.
  expect(ozolith.abilities.find((a) => a.trigger?.verbs.includes("leaves"))).toBeUndefined();
  expect(ozolith.unknownTriggers).toContain("if:leaves");
  expect(ozolith.abilities.some((a) => a.conditionCares?.includes("counter-added:any"))).toBe(true);
});

test("a leaves trigger that says without dying, or if it didn't die, derives withoutDying", () => {
  const port = deriveCardTags({
    oracleId: "port-mage",
    clauses: [{
      id: 1, abilityType: "triggered",
      trigger: { event: "leaves", subject: "one or more other creatures you control", control: "you" },
      actions: [{ verb: "draw", object: "a card", amount: "1" }],
    }],
    clauseTexts: { 1: "Whenever one or more other creatures you control leave the battlefield without dying, draw a card." },
    characteristics: MINIMAL_CHARACTERISTICS,
  });
  expect(port.abilities[0].trigger?.subject.withoutDying).toBe(true);

  const taeko = deriveCardTags({
    oracleId: "taeko",
    clauses: [{
      id: 1, abilityType: "triggered",
      trigger: { event: "leaves", subject: "another creature you control", control: "you" },
      actions: [{ verb: "scry", object: "1", amount: "1" }, { verb: "add-counter", object: "+1/+1" }],
    }],
    clauseTexts: { 1: "Whenever another creature you control leaves the battlefield, if it didn't die, scry 1 and put a +1/+1 counter on Taeko." },
    characteristics: MINIMAL_CHARACTERISTICS,
  });
  expect(taeko.abilities.every((a) => a.trigger?.subject.withoutDying === true)).toBe(true);
});

test("a flicker derives leaves from its exile half and enters from its return half, both about the target", () => {
  const ephemerate = deriveCardTags({
    oracleId: "ephemerate",
    clauses: [{
      id: 1, abilityType: "spell",
      actions: [
        { verb: "exile", object: "target creature you control", fromZone: "battlefield", toZone: "exile" },
        { verb: "return", object: "it", fromZone: "exile", toZone: "battlefield" },
      ],
    }],
    clauseTexts: { 1: "Exile target creature you control, then return it to the battlefield under its owner's control." },
    characteristics: { ...MINIMAL_CHARACTERISTICS, types: ["instant"] },
  });
  const verbs = ephemerate.abilities.flatMap((a) => (a.emits ?? []).map((e) => e.verb)).sort();
  expect(verbs).toEqual(["enters", "exiled", "leaves"]);
  const leaves = ephemerate.abilities.flatMap((a) => a.emits ?? []).find((e) => e.verb === "leaves")!;
  expect(leaves.subject.control).toBe("you");
  expect(leaves.subject.type).toBe("creature");
  expect(ephemerate.abilities.some((a) => a.effect.kind === "flicker")).toBe(true);
});

test("targeted removal by exile, and a targeted bounce, leave under the opponent's control; a self bounce is yours", () => {
  const swords = deriveCardTags({
    oracleId: "swords",
    clauses: [{
      id: 1, abilityType: "spell",
      actions: [{ verb: "exile", object: "target creature", fromZone: null, toZone: "exile" }, { verb: "gain-life", object: "its controller" }],
    }],
    clauseTexts: { 1: "Exile target creature. Its controller gains life equal to its power." },
    characteristics: { ...MINIMAL_CHARACTERISTICS, types: ["instant"] },
  });
  const swordsLeaves = swords.abilities.flatMap((a) => a.emits ?? []).find((e) => e.verb === "leaves")!;
  expect(swordsLeaves.subject.control).toBe("opp");

  const unsummon = deriveCardTags({
    oracleId: "unsummon",
    clauses: [{
      id: 1, abilityType: "spell",
      actions: [{ verb: "return", object: "target creature", fromZone: "battlefield", toZone: "hand" }],
    }],
    clauseTexts: { 1: "Return target creature to its owner's hand." },
    characteristics: { ...MINIMAL_CHARACTERISTICS, types: ["instant"] },
  });
  expect(unsummon.abilities.flatMap((a) => a.emits ?? []).find((e) => e.verb === "leaves")!.subject.control).toBe("opp");

  const lion = deriveCardTags({
    oracleId: "lion",
    clauses: [{
      id: 1, abilityType: "triggered",
      trigger: { event: "enters", subject: "this creature", control: "you" },
      actions: [{ verb: "return", object: "a creature you control", fromZone: "battlefield", toZone: "hand" }],
    }],
    clauseTexts: { 1: "When this creature enters, return a creature you control to its owner's hand." },
    characteristics: { ...MINIMAL_CHARACTERISTICS, types: ["creature"] },
  });
  const lionLeaves = lion.abilities.flatMap((a) => a.emits ?? []).find((e) => e.verb === "leaves")!;
  expect(lionLeaves.subject.control).toBe("you");
  expect(lionLeaves.subject.type).toBe("creature");
});

test("a targeted reanimation from a graveyard keeps `any`; a targeted exile from one reads `opp`", () => {
  // The bounce rule above turns a targeted `leaves` to the opponent's. A GRAVEYARD leave must not
  // join it: Reanimate is aimed at your own graveyard as readily as theirs, and "whenever one or more
  // creature cards leave YOUR graveyard" (Desecrated Tomb) would refuse an `opp` producer.
  const reanimate = deriveCardTags({
    oracleId: "reanimate", name: "Reanimate",
    clauses: [{
      id: 1, abilityType: "spell",
      actions: [
        { verb: "put", object: "target creature card from a graveyard", fromZone: "graveyard", toZone: "battlefield" },
        { verb: "lose-life", object: "you", amount: "that card's mana value" },
      ],
    }],
    clauseTexts: { 1: "Put target creature card from a graveyard onto the battlefield under your control. You lose life equal to that card's mana value." },
    characteristics: { ...MINIMAL_CHARACTERISTICS, types: ["sorcery"] },
  });
  const leaves = reanimate.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "leaves");
  expect(leaves.map((e) => [e.subject.zone, e.subject.control])).toEqual([["graveyard", "any"]]);

  const cremate = deriveCardTags({
    oracleId: "cremate", name: "Cremate",
    clauses: [{ id: 1, abilityType: "spell", actions: [{ verb: "exile", object: "target card from a graveyard", fromZone: "graveyard", toZone: null }] }],
    clauseTexts: { 1: "Exile target card from a graveyard." },
    characteristics: { ...MINIMAL_CHARACTERISTICS, types: ["instant"] },
  });
  const exiled = cremate.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "leaves");
  expect(exiled.map((e) => [e.subject.zone, e.subject.control])).toEqual([["graveyard", "opp"]]);
});

test("a card exiling ITSELF emits a self leaves", () => {
  const phoenix = deriveCardTags({
    oracleId: "phoenix", name: "Lamplight Phoenix",
    clauses: [{
      id: 1, abilityType: "triggered",
      trigger: { event: "dies", subject: "this creature", control: "you" },
      actions: [{ verb: "exile", object: "this creature", fromZone: null, toZone: "exile" }],
    }],
    clauseTexts: { 1: "When this creature dies, exile it." },
    characteristics: { ...MINIMAL_CHARACTERISTICS, types: ["creature"] },
  });
  const leaves = phoenix.abilities.flatMap((a) => a.emits ?? []).find((e) => e.verb === "leaves")!;
  expect(leaves.subject.self).toBe(true);
});

// 2026-09-05, owner: Black Market Connections must count as a draw ENGINE. Its canonical clauses are
// the corpus's own: the trigger is `main-phase` (no `Verb`), and the three modes state no trigger.
test("a modal phase trigger's modes inherit its event for the repeats label", () => {
  const bmc = deriveCardTags({
    oracleId: "bmc", name: "Black Market Connections",
    clauses: [
      { id: 1, abilityType: "triggered", trigger: { event: "main-phase", subject: "you", control: "you" }, actions: [{ verb: "none" }] },
      { id: 2, abilityType: "triggered", actions: [{ verb: "lose-life", object: "you", amount: "1" }, { verb: "create", object: "a Treasure token", amount: "1" }] },
      { id: 3, abilityType: "triggered", actions: [{ verb: "draw", object: "a card", amount: "1" }, { verb: "lose-life", object: "you", amount: "2" }] },
    ],
    clauseTexts: {
      1: "At the beginning of your first main phase, choose one or more --",
      2: "Sell Contraband -- Create a Treasure token. You lose 1 life.",
      3: "Buy Information -- Draw a card. You lose 2 life.",
    },
    characteristics: { ...MINIMAL_CHARACTERISTICS, types: ["enchantment"] },
  });
  const draw = bmc.abilities.find((a) => a.effect.kind === "draw-card")!;
  expect(draw.repeats).toBe("per-cycle");
  expect(bmc.abilities.every((a) => a.repeats === "per-cycle")).toBe(true);
});

/** THE REQUIREMENT RIDES ON THE ABILITY. `clauseRequires` is the fourth per-clause channel beside
 *  texts, costs and faces, and it reaches every ability the clause produces. */
test("deriveCardTags carries a clause's requirement onto its abilities", () => {
  const tags = deriveCardTags({
    name: "Goblin Surveyor", characteristics: MINIMAL_CHARACTERISTICS,
    clauses: [{ id: 3, abilityType: "activated", actions: [{ verb: "draw", object: "a card", amount: "1" }] }],
    clauseTexts: { 3: "Draw a card." }, clauseCosts: { 3: "{3}, Exile this card from your graveyard" },
    clauseRequires: { 3: { marker: "speed", min: 4 } },
  } as never);
  expect(tags.abilities.map((a) => a.requires)).toEqual([{ marker: "speed", min: 4 }]);
});

test("a clause whose text carries a marker condition derives the requirement", () => {
  const tags = deriveCardTags({
    name: "Grave Venerations", characteristics: MINIMAL_CHARACTERISTICS,
    clauses: [{ id: 1, abilityType: "triggered", trigger: { event: "end-step", control: "you" }, actions: [{ verb: "return", object: "up to one target creature card", fromZone: "graveyard", toZone: "hand" }] }],
    clauseTexts: { 1: "At the beginning of your end step, if you're the monarch, return up to one target creature card from your graveyard to your hand." },
  } as never);
  expect(tags.abilities.every((a) => a.requires?.marker === "monarch")).toBe(true);
  expect(tags.abilities.length).toBeGreaterThan(0);
});

// ---- the panel's controller family (2026-09-06) ----

test("an action with no player named is the controller's: 'draw a card' is you drawing", () => {
  // Priest of Forgotten Gods. Derived `any`, the draw met Orcish Bowmasters' "whenever an opponent
  // draws" (owner-judged FALSE). A player-shaped cue still wins: "target player draws" stays any.
  const { abilities } = deriveAbilities([{ id: 1, abilityType: "activated", actions: [{ verb: "draw", object: "a card", amount: "1" }] }], undefined, { 1: "You add {B}{B} and draw a card." });
  expect(abilities[0].emits?.[0]?.subject.control).toBe("you");
  const named = deriveAbilities([{ id: 1, abilityType: "activated", actions: [{ verb: "draw", object: "a card", amount: "1" }] }], undefined, { 1: "Target player draws a card." });
  expect(named.abilities[0].emits?.[0]?.subject.control).toBe("any");
});

// A STATED "YOU MAY PUT" IS YOU ACTING ON THEIR CARD (first derive-152 diff, 2026-09-17): the
// recursion subject keeps the graveyard it names; only the entry is yours.
test("'you may put ... from that player's graveyard' keeps the subject's graveyard, and the entry is yours", () => {
  const text = "When this creature enters, for each opponent, you may put up to one target creature card from that player's graveyard onto the battlefield under your control.";
  const { abilities } = deriveAbilities([{ id: 1, abilityType: "triggered", trigger: { event: "enters", subject: "this creature", control: "you" }, actions: [
    { verb: "put", object: "up to one target creature card from that player's graveyard", fromZone: "graveyard", toZone: "battlefield" },
  ] }], "Sepulchral Primordial", { 1: text });
  const rec = abilities.find((a) => a.effect.kind === "graveyard-recursion");
  expect(rec?.effect.subject?.control).not.toBe("you");
  expect(rec?.emits?.find((e) => e.verb === "enters")?.subject.control).toBe("you");
});

test("what you put onto the battlefield enters under YOUR control (CR 110.2a)", () => {
  // Misty Rainforest: the put names no player, so the fetched land's entry read `any` and satisfied
  // Deep Gnome Terramancer's "lands enter under an OPPONENT's control" (owner-judged FALSE 2026-09-09).
  const misty = "Search your library for a Forest or Island card, put it onto the battlefield, then shuffle.";
  const { abilities } = deriveAbilities([{ id: 1, abilityType: "activated", actions: [
    { verb: "search", object: "your library for a Forest or Island card", fromZone: "library" },
    { verb: "put", object: "it", fromZone: "library", toZone: "battlefield" },
  ] }], "Misty Rainforest", { 1: misty }, { 1: "{T}, Pay 1 life, Sacrifice this land" }, misty);
  const enters = abilities.flatMap((a) => a.emits ?? []).find((e) => e.verb === "enters");
  expect(enters?.subject.control).toBe("you");
  // A put that names a player keeps what it says: Path to Exile's land is the CONTROLLER's.
  const path = "Exile target creature. Its controller may search their library for a basic land card, put that card onto the battlefield tapped, then shuffle.";
  const named = deriveAbilities([{ id: 1, abilityType: "spell", actions: [
    { verb: "exile", object: "target creature" },
    { verb: "search", object: "their library for a basic land card", fromZone: "library" },
    { verb: "put", object: "that card", fromZone: "library", toZone: "battlefield" },
  ] }], "Path to Exile", { 1: path }, undefined, path);
  expect(named.abilities.flatMap((a) => a.emits ?? []).find((e) => e.verb === "enters")?.subject.control).not.toBe("you");
  // A recursion's EFFECT subject is untouched: "from a graveyard" stays any, the kill-theirs-take-it reading.
  const reanimate = "Put target creature card from a graveyard onto the battlefield under your control. You lose life equal to its mana value.";
  const r = deriveAbilities([{ id: 1, abilityType: "spell", actions: [
    { verb: "put", object: "target creature card from a graveyard", fromZone: "graveyard", toZone: "battlefield" },
    { verb: "lose-life", object: "you" },
  ] }], "Reanimate", { 1: reanimate }, undefined, reanimate);
  expect(r.abilities.find((a) => a.effect.kind === "graveyard-recursion")?.effect.subject?.control).toBe("any");
});

test("'that creature' inherits the controller of the creature the trigger named", () => {
  // The Sibsig Ceremony: "Whenever a creature you control enters, destroy that creature" is YOUR
  // creature dying, and derived `dies creature/any` it fed Massacre Wurm's opponents-only trigger.
  const { abilities } = deriveAbilities([{
    id: 1, abilityType: "triggered", trigger: { event: "enters", subject: "a creature you control", control: "you" },
    actions: [{ verb: "destroy", object: "that creature" }],
  }]);
  const dies = abilities.flatMap((a) => a.emits ?? []).find((e) => e.verb === "dies");
  expect(dies?.subject).toMatchObject({ type: "creature", control: "you" });
});

test("a counter placed 'on this creature' is a self trigger", () => {
  // Evolution Witness: the counter is the subject, the recipient is the card itself.
  const { abilities } = deriveAbilities([{
    id: 1, abilityType: "triggered",
    trigger: { event: "counter-added", subject: "one or more +1/+1 counters on this creature", control: "you" },
    actions: [{ verb: "return", object: "target permanent card", fromZone: "graveyard", toZone: "hand" }],
  }]);
  expect(abilities[0].trigger?.subject.self).toBe(true);
});

// AN AURA'S ENCHANT LINE BOUNDS ITS "ENCHANTED PERMANENT" (UX sweep 2026-09-06, E1). Kaya's
// Ghostform read as "any permanent you control dies", and the site's own example deck printed "When
// Fabled Passage dies, Kaya's Ghostform brings a card back" -- six false rows from one subject.
test("\"enchanted permanent\" is bounded by the card's own Enchant line", () => {
  const text = "Enchant creature or planeswalker you control\nWhen enchanted permanent dies or is put into exile, return that card to the battlefield under your control.";
  const clauses = [{
    id: 2, abilityType: "triggered" as const,
    trigger: { event: "dies", subject: "enchanted permanent", control: "you" },
    actions: [{ verb: "return", object: "that card", fromZone: "graveyard", toZone: "battlefield" }],
  }];
  const { abilities } = deriveAbilities(clauses, "Kaya's Ghostform", { 2: text }, undefined, text);
  expect(abilities[0]?.trigger?.subject.type).toEqual(["creature", "planeswalker"]);
  expect(abilities[0]?.trigger?.subject.control).toBe("you");
  // And the RETURN -- "that card" -- is the same creature or planeswalker, so the entry it emits is
  // typed too; an untyped "permanent enters" here is how Dress Down "entered thanks to" it.
  const enters = abilities[0]?.emits?.find((e) => e.verb === "enters");
  expect(enters?.subject.type).toEqual(["creature", "planeswalker"]);
  // Without the card's text there is no Enchant line to read, and nothing is guessed.
  const blind = deriveAbilities(clauses, "Kaya's Ghostform", { 2: "When enchanted permanent dies or is put into exile, return that card to the battlefield under your control." });
  expect(blind.abilities[0]?.trigger?.subject.type).toBe("permanent");
});

test("the Enchant bound: a permanent line is a no-op, reminder text is dropped, and a two-face card reads its own face", () => {
  const ghost = (text: string) => deriveAbilities(
    [{ id: 2, abilityType: "triggered" as const, trigger: { event: "dies", subject: "enchanted permanent", control: "you" },
      actions: [{ verb: "return", object: "that card", fromZone: "graveyard", toZone: "battlefield" }] }],
    "Aura", { 2: text }, undefined, text,
  );
  // "Enchant permanent" narrows nothing and stays permanent.
  expect(ghost("Enchant permanent\nWhen enchanted permanent dies, return that card to the battlefield.").abilities[0]?.trigger?.subject.type).toBe("permanent");
  // Reminder text after the line is not part of the type list.
  expect(ghost("Enchant creature (Target a creature as you cast this. This card enters attached to that creature.)\nWhen enchanted permanent dies, return that card to the battlefield.").abilities[0]?.trigger?.subject.type).toBe("creature");
  // Two faces, two Enchant lines: the clause on face 1 reads face 1's line, not face 0's.
  const twoFaced = deriveAbilities(
    [
      { id: 1, abilityType: "none" as const, actions: [{ verb: "none", object: "Enchant creature" }] },
      { id: 2, abilityType: "none" as const, actions: [{ verb: "none", object: "Enchant land" }] },
      { id: 3, abilityType: "triggered" as const, trigger: { event: "dies", subject: "enchanted permanent", control: "you" },
        actions: [{ verb: "return", object: "that card", fromZone: "graveyard", toZone: "battlefield" }] },
    ],
    "Two Auras",
    { 1: "Enchant creature", 2: "Enchant land", 3: "When enchanted permanent dies, return that card to the battlefield." },
    undefined,
    "Enchant creature\n// Enchant land\nWhen enchanted permanent dies, return that card to the battlefield.",
    undefined, { 1: 0, 2: 1, 3: 1 },
  );
  expect(twoFaced.abilities[0]?.trigger?.subject.type).toBe("land");
});

/** MATOYA TRIGGERED ON NOTHING. "Whenever you scry, draw a card. Whenever you surveil, draw a card."
 *  is the whole card, and both abilities derived with NO trigger at all — `normalizeTriggerVerb`
 *  checks the clause event against the closed `VERB_VOCAB`, and `scry`/`surveil` were legal CLAUSE
 *  events (normalize-prompt.ts, since 2026-08-15, with Matoya named in its own comment) that were
 *  never ENGINE events. The two vocabularies are different lists and this was the gap between them.
 *
 *  MEASURED 2026-09-07 over the 21,317 clause docs: 15 corpus cards trigger on scry, 10 on surveil,
 *  4 on search — and not one of them could form an edge, in either direction, ever. */
test("a scry or surveil trigger survives derivation instead of being dropped", () => {
  const out = deriveAbilities([
    { id: 1, abilityType: "triggered" as const,
      trigger: { event: "scry", subject: "you", control: "you" },
      actions: [{ verb: "draw", object: "a card" }] },
    { id: 2, abilityType: "triggered" as const,
      trigger: { event: "surveil", subject: "you", control: "you" },
      actions: [{ verb: "draw", object: "a card" }] },
  ], "Matoya, Archon Elder");
  expect(out.abilities.map((a) => a.trigger?.verbs)).toEqual([["scry"], ["surveil"]]);
  expect(out.unknownTriggers).toEqual([]);
});

/** CR 701.23b: searching a hidden zone "isn't required to find some or all of those cards even if
 *  they're present". The three corpus consumers that watch a search — Archivist of Oghma, Ob Nixilis
 *  Unshackled, Wan Shi Tong Librarian — all watch an OPPONENT search, and the trigger must be
 *  RECORDED with that control so the matcher can refuse it, rather than dropped so nothing can. */
test("an opponent-scoped search trigger is recorded, not discarded", () => {
  const out = deriveAbilities([
    { id: 1, abilityType: "triggered" as const,
      trigger: { event: "search", subject: "their library", control: "opponent" },
      actions: [{ verb: "draw", object: "a card" }] },
  ], "Archivist of Oghma");
  expect(out.abilities[0]?.trigger?.verbs).toEqual(["search"]);
  expect(out.unknownTriggers).toEqual([]);
});

/** MAKING A WORD AN ENGINE VERB MAKES A HALLUCINATION OF IT LIVE. While `scry` returned null from
 *  `normalizeTriggerVerb` an invented scry trigger was inert — the verb was dropped whatever the
 *  card said. Now it derives, so the phantom guard has to be able to see it, and `triggerHasCue`
 *  answers TRUE for any event with no `TRIGGER_CUES` row. The row was added with the verb.
 *
 *  NOT HYPOTHETICAL: `clause-store.ts` records "while scrying" as one of the three real witnesses
 *  for `proliferate` being used as a dumping ground for events the vocabulary could not spell. */
test("an invented scry trigger is refused as phantom when the card never says scry", () => {
  const text = "When this creature enters, draw a card.";
  const out = deriveAbilities(
    [{ id: 1, abilityType: "triggered" as const,
       trigger: { event: "scry", subject: "you", control: "you" },
       actions: [{ verb: "draw", object: "a card" }] }],
    "Invented Scryer", { 1: text }, undefined, text,
  );
  // Since #896 task 5 the PRINTED trigger wins: the card triggers on entering, whatever the store said.
  expect(out.abilities[0]?.trigger).toMatchObject({ verbs: ["enters"], subject: { self: true } });
  // With no printed trigger word the stored path answers, and its phantom guard refuses.
  const bare = "Draw a card.";
  const unprinted = deriveAbilities(
    [{ id: 1, abilityType: "triggered" as const,
       trigger: { event: "scry", subject: "you", control: "you" },
       actions: [{ verb: "draw", object: "a card" }] }],
    "Invented Scryer", { 1: bare }, undefined, bare,
  );
  expect(unprinted.abilities[0]?.trigger).toBeUndefined();
  expect(unprinted.unknownTriggers).toContain("phantom:scry");
});

/** The mirror, so the guard cannot be tightened into deleting the real ones: Matoya prints the word
 *  and must keep its triggers. All 27 corpus consumers print theirs — measured 2026-09-07, zero
 *  exceptions — which is what made the cue rows free. */
test("a real scry trigger survives the phantom guard because the card prints the word", () => {
  const text = "Whenever you scry, draw a card.";
  const out = deriveAbilities(
    [{ id: 1, abilityType: "triggered" as const,
       trigger: { event: "scry", subject: "you", control: "you" },
       actions: [{ verb: "draw", object: "a card" }] }],
    "Matoya, Archon Elder", { 1: text }, undefined, text,
  );
  expect(out.abilities[0]?.trigger?.verbs).toEqual(["scry"]);
  expect(out.unknownTriggers).toEqual([]);
});

/** CR 114.2: the player who gets the emblem owns and controls it. Chandra, Roaring Flame's −7 gives
 *  it to each opponent she hits; Elspeth gives it to you. The clause object says only "an emblem
 *  with that ability", so the control is read off the printed sentence (`emblemRecipient`). */
test("an emblem grant's control is the recipient the sentence names", () => {
  const grant = (text: string) => {
    const clauses = [{
      id: 5, abilityType: "activated" as const,
      actions: [
        { verb: "deal-damage", object: "each opponent", fromZone: null, toZone: null, amount: "6", optional: false },
        { verb: "emblem", object: "an emblem with that ability", fromZone: null, toZone: null, amount: null, optional: false },
      ],
    }];
    const { abilities } = deriveAbilities(clauses, "Chandra, Roaring Flame", { 5: text }, { 5: "−7" });
    return abilities.find((a) => a.effect.kind === "emblem")!.effect.subject!.control;
  };
  expect(grant("Chandra deals 6 damage to each opponent. Each player dealt damage this way gets an emblem with that ability.")).toBe("opp");
  expect(grant("You get an emblem with that ability.")).toBe("you");
});

/** "EXILE HER, THEN RETURN HER TO THE BATTLEFIELD" (owner, 2026-09-08, the Chandra, Fire of Kaladesh
 *  page: Horn of Gondor's own ETB read as supplied by Chandra). The Origins flip-walkers and their
 *  kin say "her" and "him" where every other card says "it", and the pronoun list did not know the
 *  words, so "her" parsed as a noun with no class: an untyped `enters` emit with no self flag, a
 *  wildcard that satisfied every entry trigger in the deck. Nine corpus cards, all planeswalkers. */
test("a gendered pronoun for the card itself is a self reference, not a wildcard", () => {
  const { abilities } = deriveAbilities([{
    id: 2, abilityType: "activated",
    actions: [
      { verb: "deal-damage", object: "target player or planeswalker", amount: "1" },
      { verb: "exile", object: "Chandra" },
      { verb: "return", object: "her", fromZone: "exile", toZone: "battlefield" },
    ],
  }], "Chandra, Fire of Kaladesh // Chandra, Roaring Flame",
  { 2: "Chandra deals 1 damage to target player or planeswalker. If Chandra has dealt 3 or more damage this turn, exile her, then return her to the battlefield transformed under her owner's control." },
  { 2: "{T}" });
  const enters = abilities.flatMap((a) => a.emits ?? []).find((e) => e.verb === "enters");
  expect(enters).toBeDefined();
  expect(enters!.subject.self).toBe(true);
  const ajani = deriveAbilities([{
    id: 1, abilityType: "triggered", trigger: { event: "dies", subject: "a Cat you control", control: "you" },
    actions: [{ verb: "exile", object: "Ajani" }, { verb: "return", object: "him", fromZone: "exile", toZone: "battlefield" }],
  }], "Ajani, Nacatl Pariah // Ajani, Nacatl Avenger", { 1: "Whenever a Cat you control dies, you may exile Ajani, then return him to the battlefield transformed under his owner's control." });
  expect(ajani.abilities.flatMap((a) => a.emits ?? []).find((e) => e.verb === "enters")!.subject.self).toBe(true);
});

// ROADMAP AC12: an ability as an object.
test("Gogo copies activated or triggered abilities, and says which (AC12)", () => {
  const text = "Copy target activated or triggered ability you control X times. You may choose new targets for the copies.";
  const { abilities } = deriveAbilities([{
    id: 1, abilityType: "activated", actions: [{ verb: "copy", object: "target activated or triggered ability you control", amount: "X" }],
  }], "Gogo, Master of Mimicry", { 1: text }, { 1: "{X}{X}, {T}" }, text);
  expect(abilities[0]?.effect.kind).toBe("copy-ability");
  expect(abilities[0]?.effect.subject?.abilityKind).toEqual(["activated", "triggered"]);
  expect(abilities[0]?.effect.subject?.control).toBe("you");
});

test("Rings of Brighthearth copies THAT ability, and the kind comes from its activate trigger (AC12)", () => {
  const text = "Whenever you activate an ability, if it isn't a mana ability, you may pay {2}. If you do, copy that ability.";
  const { abilities } = deriveAbilities([{
    id: 1, abilityType: "triggered", trigger: { event: "activate", subject: "an ability", control: "you" },
    actions: [{ verb: "copy", object: "that ability", optional: true }],
  }], "Rings of Brighthearth", { 1: text }, undefined, text);
  expect(abilities[0]?.effect.kind).toBe("copy-ability");
  expect(abilities[0]?.effect.subject?.abilityKind).toEqual(["activated"]);
});

// THE KIND LIVES IN THE TRIGGER WHENEVER THE OBJECT IS A PRONOUN, and `activate` was only the
// first shape of that. "Whenever a creature ... causes a TRIGGERED ability of that creature to
// trigger, copy that ability" says the kind in its trigger subject and "that ability" carries
// none, so the copy-ability pass fell back to BOTH kinds and claimed activated copies neither
// card can make (measured 2026-09-20 on Aboleth Spawn and Firebender Ascension).
test("a copier whose trigger names the ability kind inherits it onto the effect (AC12)", () => {
  const text = "Whenever a creature entering under an opponent's control causes a triggered ability of that creature to trigger, you may copy that ability.";
  const { abilities } = deriveAbilities([{
    id: 1, abilityType: "triggered",
    trigger: { event: "enters", subject: "a creature entering under an opponent's control that causes a triggered ability of that creature to trigger", control: "opponent" },
    actions: [{ verb: "copy", object: "that ability", optional: true }],
  }], "Aboleth Spawn", { 1: text }, undefined, text);
  expect(abilities[0]?.effect.kind).toBe("copy-ability");
  expect(abilities[0]?.effect.subject?.abilityKind).toEqual(["triggered"]);
  // And the seat it copies from is the opponent's -- the matcher refuses the edge on this field.
  expect(abilities[0]?.effect.subject?.control).toBe("opp");
});

// The same shape on YOUR side, where the trigger event is outside the Verb union ("other") and the
// derived trigger is therefore dropped: the raw clause subject still says "triggered ability".
test("the kind is read off the RAW trigger subject when the event is not a known verb", () => {
  const text = "Whenever a creature you control attacking causes a triggered ability of that creature to trigger, copy that ability. You may choose new targets for the copy.";
  const { abilities } = deriveAbilities([{
    id: 1, abilityType: "triggered",
    trigger: { event: "other", subject: "a creature you control attacking causes a triggered ability of that creature to trigger", control: "you" },
    actions: [{ verb: "copy", object: "that ability" }],
  }], "Firebender Ascension", { 1: text }, undefined, text);
  expect(abilities[0]?.effect.kind).toBe("copy-ability");
  expect(abilities[0]?.effect.subject?.abilityKind).toEqual(["triggered"]);
  // Your side, so the matcher's `opp` gate does not refuse it.
  expect(abilities[0]?.effect.subject?.control).not.toBe("opp");
});

// ROADMAP AC13: a grant to a TOKEN class keeps its subject (Springleaf Parade), a grant to a bare
// type class still does not (the whole-deck lord edge stays refused).
test("a grant to creature TOKENS keeps its token subject; a grant to creatures still refuses", () => {
  const tokens = deriveAbilities([{
    id: 1, abilityType: "static", actions: [{ verb: "grant-ability", object: "that ability" }],
  }], "Springleaf Parade", { 1: "Creature tokens you control have \"{T}: Add one mana of any color.\"" });
  expect(tokens.abilities[0]?.effect.kind).toBe("keyword-grant");
  expect(tokens.abilities[0]?.effect.subject).toMatchObject({ token: true, type: "creature", control: "you" });
  const creatures = deriveAbilities([{
    id: 1, abilityType: "static", actions: [{ verb: "grant-ability", object: "haste" }],
  }], "Fervor", { 1: "Creatures you control gain haste until end of turn." });
  // A one-shot grant to every creature stays refused (#711 admits the static one).
  expect(creatures.abilities[0]?.effect.subject).toBeUndefined();
});

// RECALL v4 SACRIFICE FAMILY (2026-09-09).
test("a cost sacrifice is the controller's even when the effect names other players (CR 701.17a)", () => {
  const text = "Any number of target players each lose 2 life and sacrifice a creature of their choice. You add {B}{B} and draw a card.";
  const { abilities } = deriveAbilities([{
    id: 1, abilityType: "activated",
    actions: [{ verb: "sacrifice", object: "two other creatures" }, { verb: "lose-life", object: "any number of target players", amount: "2" }, { verb: "sacrifice", object: "a creature of their choice" }],
  }], "Priest of Forgotten Gods", { 1: text }, { 1: "{T}, Sacrifice two other creatures" }, text);
  const sacs = abilities.flatMap((a) => (a.emits ?? []).filter((e) => e.verb === "sacrifice"));
  expect(sacs[0]?.subject.control).toBe("you");   // the cost
  expect(sacs[1]?.subject.control).toBe("any");   // the edict on other players
});

test("a granted 'when this creature dies' watches the recipient, not the card that granted it", () => {
  const card = "Until end of turn, target creature you control gains \"When this creature dies, return it to the battlefield tapped under its owner's control.\"";
  const granted = "When this creature dies, return it to the battlefield tapped under its owner's control.";
  const { abilities } = deriveAbilities([
    { id: 1, abilityType: "spell", actions: [{ verb: "grant-ability", object: "that ability" }] },
    { id: 2, abilityType: "triggered", trigger: { event: "dies", subject: "this creature", control: "you" }, actions: [{ verb: "return", object: "it", fromZone: "graveyard", toZone: "battlefield" }] },
  ], "Not Dead After All", { 1: card.split(" gains ")[0]!, 2: granted }, undefined, card);
  const t = abilities.find((a) => a.trigger)?.trigger;
  expect(t?.verbs).toEqual(["dies"]);
  expect(t?.subject.self).toBeUndefined();
  expect(t?.subject).toMatchObject({ type: "creature", control: "you" });
});

// RECALL v4 #144 (2026-09-09): a self-or-class trigger keeps its self half as a twin.
test("'this creature or another enchantment you control enters' derives the class half AND a self twin", () => {
  const { abilities } = deriveAbilities([{
    id: 1, abilityType: "triggered",
    trigger: { event: "enters", subject: "this creature or another enchantment you control", control: "you" },
    actions: [{ verb: "tap", object: "up to one target creature" }],
  }], "Fear of Sleep Paralysis");
  const triggers = abilities.map((a) => a.trigger?.subject);
  expect(triggers).toContainEqual({ control: "you", token: null, type: "enchantment" });
  expect(triggers).toContainEqual({ control: "you", token: null, type: "creature", self: true });
});

test("the self twin keeps the class half's origin zone (River Kelpie)", () => {
  const { abilities } = deriveAbilities([{
    id: 1, abilityType: "triggered",
    trigger: { event: "enters", subject: "this creature or another permanent from a graveyard", control: "any" },
    actions: [{ verb: "draw", object: "a card" }],
  }], "River Kelpie");
  const self = abilities.find((a) => a.trigger?.subject?.self === true)?.trigger?.subject;
  expect(self).toMatchObject({ type: "creature", fromZone: "graveyard" });
});

// RECALL v4 #120 (2026-09-09): a damage multiplier's trigger names the DEALER, which is the half a
// damage emit records and the matcher compares. Fiery Emancipation used to demand `permanent` (the
// victim), which Khalni Ambush's typeless fight dealer could never satisfy.
test("a damage multiplier watches the source that deals, not the thing dealt to", () => {
  const text = "If a source you control would deal damage to a permanent or player, it deals triple that damage to that permanent or player instead.";
  const { abilities } = deriveAbilities([{
    id: 1, abilityType: "static",
    actions: [{ verb: "triple", object: "damage dealt by a source you control to a permanent or player" }],
  }], "Fiery Emancipation", { 1: text });
  const a = abilities[0]!;
  expect(a.effect.kind).toBe("damage-multiplier");
  expect(a.trigger?.verbs).toEqual(["combat-damage", "non-combat-damage"]);
  expect(a.trigger?.subject).toEqual({ control: "you", token: null });
  expect(a.emits ?? []).toEqual([]);
  // Gratuitous Violence narrows to creatures, which is a demand the matcher can check on a dealer.
  const gv = deriveAbilities([{
    id: 1, abilityType: "static",
    actions: [{ verb: "double", object: "damage dealt by a creature you control" }],
  }], "Gratuitous Violence", { 1: "If a creature you control would deal damage to a permanent or player, it deals double that damage to that permanent or player instead." });
  expect(gv.abilities[0]?.trigger?.subject).toMatchObject({ control: "you", type: "creature" });
  // And a fight's dealer is the fighting CREATURE (CR 701.14a), which is what that demand checks.
  const fight = deriveAbilities([{
    id: 1, abilityType: "spell",
    actions: [{ verb: "fight", object: "target creature you control and target creature you don't control" }],
  }], "Khalni Ambush", { 1: "Target creature you control fights target creature you don't control." });
  const dmg = fight.abilities.flatMap((x) => x.emits ?? []).find((e) => e.verb === "non-combat-damage");
  expect(dmg?.dealer).toEqual({ control: "you", token: null, type: "creature" });
});

// ISSUE #562: Brash Taunter. "This creature fights another target creature" names the card first,
// but the fight's emit is the OTHER creature being dealt damage -- so it is not the card itself, and
// a deck's "a creature is dealt damage" payoffs have a supplier.
test("a fight naming the card itself first damages the other creature, not self", () => {
  const { abilities } = deriveAbilities([{
    id: 1, abilityType: "activated",
    actions: [{ verb: "fight", object: "this creature and another target creature" }],
  }], "Brash Taunter", { 1: "{2}{R}, {T}: This creature fights another target creature." });
  const dmg = abilities.flatMap((x) => x.emits ?? []).find((e) => e.verb === "non-combat-damage");
  expect(dmg?.subject).toMatchObject({ type: "creature", scope: "target" });
  expect(dmg?.subject.self).toBeUndefined();
});

// RECALL v4 #28 (2026-09-09): Hellish Rebuke -> Valgavoth, Terror Eater. An edict granted to
// OPPONENTS' permanents fills THEIR graveyard, and Valgavoth plays what would land there.
test("a granted trigger on opponents' permanents makes THEIR permanent die, not the instant", () => {
  const card = "Until end of turn, permanents your opponents control gain \"When this permanent deals damage to the player who cast Hellish Rebuke, sacrifice this permanent. You lose 2 life.\"";
  const granted = "When this permanent deals damage to the player who cast Hellish Rebuke, sacrifice this permanent. You lose 2 life.";
  const { abilities } = deriveAbilities([
    { id: 1, abilityType: "spell", actions: [{ verb: "grant-ability", object: "that ability" }] },
    { id: 2, abilityType: "triggered", trigger: { event: "damage-dealt", subject: "this permanent", control: "any" },
      actions: [{ verb: "lose-life", object: "you", amount: "2" }, { verb: "sacrifice", object: "this permanent" }] },
  ], "Hellish Rebuke", { 1: card.split(" gain ")[0]!, 2: granted }, undefined, card);
  // The trigger itself is narrowed to damage dealt TO THE PLAYER WHO CAST Hellish Rebuke, which no
  // field holds: refused since #896 task 5 (owner, 2026-10-01). The grant still lands on THEIR
  // permanent, which the emits below show.
  expect(abilities.find((a) => a.trigger)).toBeUndefined();
  const dies = abilities.flatMap((a) => a.emits ?? []).find((e) => e.verb === "dies");
  expect(dies?.subject).toMatchObject({ type: "permanent", control: "opp" });
  expect(dies?.subject.self).toBeUndefined();
  // "You lose 2 life" is said by the OPPONENT's permanent, so it is the opponent who loses it.
  const loses = abilities.flatMap((a) => a.emits ?? []).find((e) => e.verb === "lose-life");
  expect(loses?.subject.control).toBe("opp");
});

test("a card that exiles what would hit an opponent's graveyard AND plays it is a recursion over their fills", () => {
  const valgavoth = "Flying, lifelink\nWard—Sacrifice three nonland permanents.\nIf a card you didn't control would be put into an opponent's graveyard from anywhere, exile it instead.\nDuring your turn, you may play cards exiled with Valgavoth. If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost.";
  const { abilities } = deriveAbilities([], "Valgavoth, Terror Eater", {}, undefined, valgavoth);
  expect(abilities).toContainEqual({
    kind: "static", repeats: "continuous",
    effect: { kind: "graveyard-recursion", subject: { control: "opp", token: null, zone: "graveyard" }, intercepted: true },
  });
  // Dauthi Voidwalker plays ONE such card, via its own sacrifice; still a payoff over their fills.
  const dauthi = "Shadow\nIf a card would be put into an opponent's graveyard from anywhere, instead exile it with a void counter on it.\n{T}, Sacrifice this creature: Choose an exiled card an opponent owns with a void counter on it. You may play it this turn without paying its mana cost.";
  expect(deriveAbilities([], "Dauthi Voidwalker", {}, undefined, dauthi).abilities.find((a) => a.effect.kind === "graveyard-recursion")?.effect.intercepted).toBe(true);
  // Leyline of the Void exiles and plays nothing: hate, not a payoff.
  const leyline = "If Leyline of the Void is in your opening hand, you may begin the game with it on the battlefield.\nIf a card would be put into an opponent's graveyard from anywhere, exile it instead.";
  expect(deriveAbilities([], "Leyline of the Void", {}, undefined, leyline).abilities).toEqual([]);
});

// RECALL v5 #196 (2026-09-10): Cavalier of Thorns -> Twinflame Travelers. A doubler that names WHOSE
// triggered abilities it doubles ("a triggered ability of another Elemental you control") rather
// than WHICH event -- the axis `doubles` has no slot for, recorded as its ceiling on 2026-08-22.
// Eight corpus cards sit on it: Harmonic Prodigy, Twinflame Travelers, Roaming Throne, Annie Joins
// Up, Bifur, Katara, Clara Oswald, Splinter. The whole-board doublers (Mirror Room) and the
// attachment ones (Wizard's Staff) stay silent, as before.
test("a doubler that names WHOSE triggers it doubles records that class as `doublesOf`", () => {
  const derive = (name: string, text: string) => deriveAbilities([
    { id: 1, abilityType: "static", actions: [{ verb: "trigger-again", object: "that ability" }] },
  ], name, { 1: text }).abilities.find((a) => a.effect.kind === "trigger-doubling");
  expect(derive("Twinflame Travelers", "If a triggered ability of another Elemental you control triggers, it triggers an additional time.")?.doublesOf)
    .toEqual({ control: "you", token: null, subtype: "elemental" });
  expect(derive("Harmonic Prodigy", "If a triggered ability of a Shaman or another Wizard you control triggers, that ability triggers an additional time.")?.doublesOf)
    .toEqual({ control: "you", token: null, subtype: ["shaman", "wizard"] });
  expect(derive("Annie Joins Up", "If a triggered ability of a legendary creature you control triggers, that ability triggers an additional time.")?.doublesOf)
    .toEqual({ control: "you", token: null, legendary: true, type: "creature" });
  expect(derive("Delney, Streetwise Lookout", "If a triggered ability of a creature you control with power 2 or less triggers, that ability triggers an additional time.")?.doublesOf)
    .toMatchObject({ type: "creature", stats: [{ metric: "power", op: "lte", value: 2 }] });
  // The whole board is not a class: Mirror Room doubles everything and claims nothing.
  const room = derive("Mirror Room // Fractured Realm", "If a triggered ability of a permanent you control triggers, that ability triggers an additional time.");
  expect(room?.doublesOf).toBeUndefined();
  expect(room?.doubles).toBeUndefined();
  // An attachment is board state, not a class.
  expect(derive("Wizard's Staff", "If a triggered ability of equipped creature triggers, that ability triggers an additional time.")?.doublesOf).toBeUndefined();
  // The event frame is untouched: Panharmonicon still records WHICH, and no WHOSE.
  const pan = derive("Panharmonicon", "If an artifact or creature entering causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.");
  expect(pan?.doubles).toEqual(["enters"]);
  expect(pan?.doublesOf).toBeUndefined();
});

// RECALL v5 #2 (2026-09-10): Cybermen Squadron -> Solemn Simulacrum. "Nonlegendary artifact
// creatures you control have myriad" named its recipients by TYPE, and the typal gate admitted only
// a subtype, a commander or a token class -- so the grant derived no subject and reached nothing.
// Owner ruling 2026-09-10, extending the typed-tutor ruling of 2026-09-07: a TYPE narrowing
// (artifact / enchantment / land / legendary / planeswalker creatures, legendary permanents) picks out
// particular cards and is a synergy; a STATE narrowing (attacking, tapped, equipped, face-down) is
// not, and the whole board ("creatures you control") stays refused.
test("a grant to a TYPE-narrowed class keeps its recipient; a state-narrowed or whole-board one does not", () => {
  const grant = (name: string, text: string, granted = "flying") => deriveAbilities([
    { id: 1, abilityType: "static", actions: [{ verb: "grant-ability", object: granted }] },
  ], name, { 1: text }).abilities.find((a) => a.effect.kind === "keyword-grant")?.effect.subject;
  expect(grant("Cybermen Squadron", "Nonlegendary artifact creatures you control have myriad.", "myriad"))
    .toMatchObject({ control: "you", allTypes: ["artifact", "creature"] });
  expect(grant("Enchanted Evening Host", "Enchantment creatures you control have lifelink.", "lifelink"))
    .toMatchObject({ control: "you", allTypes: ["enchantment", "creature"] });
  expect(grant("Legendary Anthem", "Legendary creatures you control have hexproof.", "hexproof"))
    .toMatchObject({ control: "you", legendary: true, type: "creature" });
  expect(grant("Walker Guard", "Each other planeswalker you control has hexproof.", "hexproof"))
    .toMatchObject({ control: "you", type: "planeswalker" });
  // Unchanged refusals: anyone's whole board, and board state dressed as a class. (Your own whole
  // board is a class since #711.)
  expect(grant("Concordant Crossroads", "All creatures have haste.", "haste")).toBeUndefined();
  expect(grant("Nontoken Anthem", "Nontoken creatures you control have vigilance.", "vigilance")).toBeUndefined();
  expect(grant("Tapped Anthem", "Other tapped creatures you control have hexproof.", "hexproof")).toBeUndefined();
  expect(grant("Mithril Coat", "Equipped creature has indestructible.", "indestructible")).toBeUndefined();
  // Unchanged admissions: a subtype, a token class.
  expect(grant("Elvish Anthem", "Other Elves you control have vigilance.", "vigilance")).toMatchObject({ subtype: "elf" });
});

// OWNER, 2026-09-16 (recall v7 #178): the class inside an intervening-if is the trigger's class
// when the trigger subject is the bare `spell` -- Alania "synergizes with instant, sorcery and
// Otter spells"; the once-per-turn half is dropped. A trigger that already narrows keeps its own.
test("Alania's 'first instant, sorcery or Otter spell' if-clause becomes the cast trigger's class", () => {
  const text = "Whenever you cast a spell, if it's the first instant spell, the first sorcery spell, or the first Otter spell other than Alania you've cast this turn, you may have target opponent draw a card. If you do, copy that spell. You may choose new targets for the copy.";
  const { abilities } = deriveAbilities([{
    id: 1, abilityType: "triggered",
    trigger: { event: "cast", subject: "a spell", control: "you" },
    actions: [{ verb: "copy", object: "that spell" }],
  }], "Alania, Divergent Storm", { 1: text });
  const trig = abilities.find((a) => a.trigger?.verbs.includes("cast"))?.trigger;
  expect(trig?.subject.type).toBeUndefined();
  expect(trig?.subject.anyOf).toEqual([{ type: "instant" }, { type: "sorcery" }, { type: "spell", subtype: "otter" }]);
  const { abilities: plain } = deriveAbilities([{
    id: 1, abilityType: "triggered",
    trigger: { event: "cast", subject: "a noncreature spell", control: "you" },
    actions: [{ verb: "draw", object: "a card" }],
  }], "Prowess Payoff", { 1: "Whenever you cast a noncreature spell, if it's the first noncreature spell you've cast this turn, draw a card." });
  expect(plain[0]?.trigger?.subject.anyOf).toBeUndefined();
});

// THE THRESHOLD IS ON THE ABILITY, NOT THE TRIGGER (2026-09-16; recall v6 #77, v7 #79). A static or
// an activated ability gated on a board count had nowhere to carry it, and Gadrak -- whose `cant`
// action maps to no kind -- derived no ability at all, so the one thing the card asks of its deck
// was invisible.
test("a static gated on a typed count keeps a kindless ability that carries the count", () => {
  const { abilities } = deriveAbilities(
    [{ id: 1, abilityType: "static", actions: [{ verb: "cant", object: "attack unless you control four or more artifacts" }] }],
    "Gadrak, the Crown-Scourge",
    { 1: "Gadrak can't attack unless you control four or more artifacts." },
  );
  expect(abilities).toHaveLength(1);
  expect(abilities[0]).toMatchObject({ kind: "static", effect: { kind: "" }, threshold: { atLeast: 4 },
    thresholdSubject: { type: "artifact", control: "you" } });
  expect(abilities[0].trigger).toBeUndefined();
});

test("a static gated on a graveyard count keeps an ability that carries the count (AF7c; an `evasion` since #1315, once kindless)", () => {
  // Cephalid Inkmage: until DERIVE 151 a graveyard card count was refused as "not a class of
  // permanent" and the clause derived nothing. It is a fill demand now, and the one thing the
  // card asks of its deck -- a full graveyard -- rides on the kindless ability.
  const { abilities } = deriveAbilities(
    [{ id: 1, abilityType: "static", actions: [{ verb: "cant", object: "be blocked as long as there are seven or more cards in your graveyard" }] }],
    "Cephalid Inkmage",
    { 1: "This creature can't be blocked as long as there are seven or more cards in your graveyard." },
  );
  expect(abilities).toHaveLength(1);
  expect(abilities[0]).toMatchObject({ kind: "static", effect: { kind: "evasion" }, threshold: { atLeast: 7 },
    thresholdSubject: { control: "you", zone: "graveyard" } });
});

test("an activated ability carries its activation restriction's count", () => {
  // Urza's Workshop, second ability. The mana ability derives as before; the count rides on it.
  const { abilities } = deriveAbilities(
    [{ id: 1, abilityType: "activated", actions: [{ verb: "add-mana", object: "{C}", amount: "for each Urza's land you control" }] }],
    "Urza's Workshop",
    { 1: "Add {C} for each Urza's land you control. Activate only if you control three or more artifacts." },
  );
  expect(abilities).toHaveLength(1);
  expect(abilities[0]).toMatchObject({ kind: "activated", effect: { kind: "mana-generation" }, threshold: { atLeast: 3 },
    thresholdSubject: { type: "artifact", control: "you" } });
});

// MIND FUNERAL: the put's actor is the opponent, so the fill is theirs -- an opponent's graveyard
// filling never fed your Animate Dead, and only a printed-text cue in the delve pass said so.
test("a put with a named actor fills THAT player's graveyard; an object naming its own controller keeps it", () => {
  const funeral = deriveAbilities(
    [{ id: 1, abilityType: "spell", actions: [
      { verb: "reveal", object: "cards from the top of target opponent's library until four land cards are revealed" },
      { verb: "put", object: "all cards revealed this way", fromZone: "library", toZone: "graveyard" },
    ] }],
    "Mind Funeral",
    { 1: "Target opponent reveals cards from the top of their library until four land cards are revealed. That player puts all cards revealed this way into their graveyard." },
  ).abilities;
  const mill = funeral.find((a) => a.effect.kind === "mill");
  expect(mill?.effect.subject?.control).toBe("opp");
  expect(mill?.emits?.every((e) => e.subject.control === "opp")).toBe(true);

  // Visions of Dread's shape: the opponent acts, YOUR creature enters. (The corpus row for the card
  // itself has the model dropping "under your control" from the object and reads `opp` on both
  // counts -- a clause-layer gap, not this rule's; the object here states the controller.)
  const visions = deriveAbilities(
    [{ id: 1, abilityType: "spell", actions: [
      { verb: "put", object: "a creature card from their graveyard onto the battlefield under your control", fromZone: "graveyard", toZone: "battlefield" },
    ] }],
    "Visions of Dread",
    { 1: "Target opponent puts a creature card of their choice from their graveyard onto the battlefield under your control." },
  ).abilities;
  const enters = visions.flatMap((a) => a.emits ?? []).find((e) => e.verb === "enters");
  expect(enters?.subject.control).toBe("you");
});

// AF7b: the processor demand and the `exiled` event (recall v5 #160, Oblivion Sower -> Ulamog's Nullifier).
test("a processor derives exile-processing on an opponent's cards, and an exile emits `exiled`", () => {
  const nullifier = deriveAbilities(
    [{ id: 1, abilityType: "triggered", trigger: { event: "cast", subject: "this spell", control: "you" },
      actions: [{ verb: "put", object: "two cards your opponents own", fromZone: "exile", toZone: "graveyard" }, { verb: "counter-spell", object: "target spell" }] }],
    "Ulamog's Nullifier",
    { 1: "When you cast this spell, you may put two cards your opponents own from exile into their owners' graveyards. If you do, counter target spell." },
  ).abilities;
  const processing = nullifier.find((a) => a.effect.kind === "exile-processing");
  expect(processing?.effect.subject?.control).toBe("opp");

  const sower = deriveAbilities(
    [{ id: 1, abilityType: "triggered", trigger: { event: "enters", subject: "this creature", control: "you" },
      actions: [{ verb: "exile", object: "the top four cards of target opponent's library", fromZone: "library" }] }],
    "Oblivion Sower",
    { 1: "When you cast this spell, target opponent exiles the top four cards of their library." },
  ).abilities;
  const exiled = sower.flatMap((a) => a.emits ?? []).find((e) => e.verb === "exiled");
  expect(exiled?.subject).toMatchObject({ control: "opp", fromZone: "library" });

  // The clause word maps to the verb of the same name.
  const doctor = deriveAbilities(
    [{ id: 1, abilityType: "triggered", trigger: { event: "exiled", subject: "one or more other cards from anywhere", control: "any" },
      actions: [{ verb: "draw", object: "a card" }] }],
    "The War Doctor",
    { 1: "Whenever one or more other cards are put into exile from anywhere, draw a card." },
  ).abilities;
  expect(doctor[0]?.trigger?.verbs).toEqual(["exiled"]);
});

// Flameshadow Conjuring: the end-step exile of the token the clause made is `temporary`, not a
// second ability -- read as one, every entering creature earned "...Flameshadow Conjuring triggers"
// beside "...makes a token" (+62 rows on the 71, 2026-09-16).
test("the temporary-token rider makes no second ability", () => {
  const text = "Whenever a nontoken creature enters under your control, you may pay {R}. If you do, create a token that's a copy of that creature. That token gains haste. Exile it at the beginning of the next end step.";
  const { abilities } = deriveAbilities(
    [{ id: 1, abilityType: "triggered", trigger: { event: "enters", subject: "a nontoken creature", control: "you" },
      actions: [{ verb: "create", object: "a token that's a copy of that creature" }, { verb: "grant-ability", object: "haste" }, { verb: "exile", object: "it", toZone: "exile" }] }],
    "Flameshadow Conjuring", { 1: text }, undefined, text,
  );
  expect(abilities.find((a) => a.effect.kind === "token-generation")?.temporary).toBe(true);
  expect(abilities.some((a) => (a.emits ?? []).some((e) => e.verb === "exiled"))).toBe(false);
});

/** THE PAYMENT RIDES ONTO THE ABILITY VERBATIM (CR 118.12a; DERIVE 159). Derivation records what
 *  the card says; what a floor of "a {1} tax per opponent spell" is worth is the rate axis's call. */
test("an action's unless-payment is carried onto the ability", () => {
  const { abilities } = deriveAbilities([{
    id: 1, abilityType: "triggered",
    trigger: { event: "cast", subject: "a spell", control: "opponent" },
    actions: [{ verb: "draw", object: "a card", amount: "1", optional: true, unless: { cost: "{1}", payer: "opponent" } }],
  }], "Rhystic Study");
  expect(abilities[0]?.unless).toEqual({ cost: "{1}", payer: "opponent" });
  const plain = deriveAbilities([{ id: 1, abilityType: "on-cast", actions: [{ verb: "draw", object: "two cards", amount: "2" }] }], "Divination");
  expect(plain.abilities[0]?.unless).toBeUndefined();
});

/** A MANA ABILITY'S AMOUNT IS THE MANA IT ADDS (DERIVE 160), read off the object when the clause
 *  states none. Oracle texts verified in the corpus 2026-09-17: Sol Ring "{T}: Add {C}{C}."; Arcane
 *  Signet "Add one mana of any color in your commander's color identity."; Talisman of Dominance
 *  "Add {U} or {B}."; Gilded Lotus "Add three mana of any one color."; Cabal Coffers "Add {B} for
 *  each Swamp you control." */
test("a mana ability's amount is the mana it adds; a counted or X object keeps its scaling text, an energy object stays unset", () => {
  const added = (object: string, amount?: string) => deriveAbilities([{ id: 1, abilityType: "activated", actions: [{ verb: "add-mana", object, ...(amount ? { amount } : {}) }] }], "Rock").abilities[0]?.amount;
  expect(added("{C}{C}")).toBe("2");
  expect(added("one mana of any color in your commander's color identity")).toBe("1");
  expect(added("{U} or {B}")).toBe("1");
  expect(added("{G}{G}, {U}{U}, or {R}{R}")).toBe("2");
  expect(added("three mana of any one color")).toBe("3");
  expect(added("{G/U}")).toBe("1");
  expect(added("{B} for each Swamp you control")).toBe("for each swamp you control"); // #1265: what scales keeps its text
  expect(added("X mana of any one color", "X")).toBe("x"); // one case (#1265): the line's lowercase scale text
  expect(added("{C}", "for each Urza's land you control")).toBe("for each urza's land you control");
  expect(manaAdded("{E}{E}")).toBeUndefined();
});

/** A COUNTED ACTION'S AMOUNT IS READ OFF ITS OBJECT when the clause states none (DERIVE 161).
 *  Object shapes are the census's own (2026-09-17): "a card" led 558 unset draws and 1,037 unset
 *  discards; "up to two basic land cards" the searches; "target creature card" the returns. */
test("a unit amount comes off the object: a card is one, up to two is two, all and that many stay unset", () => {
  expect(unitAmount("draw", "a card")).toBe("1");
  expect(unitAmount("draw", "two cards")).toBe("2");
  expect(unitAmount("draw", "cards equal to the number of creatures you control")).toBeUndefined();
  expect(unitAmount("draw", "that many cards")).toBeUndefined();
  expect(unitAmount("draw", "target player")).toBeUndefined();
  expect(unitAmount("discard", "a card")).toBe("1");
  expect(unitAmount("discard", "your hand")).toBeUndefined();
  expect(unitAmount("search", "your library for up to two basic land cards")).toBe("2");
  expect(unitAmount("search", "your library for a card")).toBe("1");
  expect(unitAmount("search", "your library")).toBeUndefined();
  expect(unitAmount("search", "a card")).toBe("1"); // Vampiric Tutor's object, the library dropped
  expect(unitAmount("search", "up to two basic land cards")).toBe("2");
  expect(unitAmount("return", "target creature card from your graveyard to your hand")).toBe("1");
  expect(unitAmount("return", "all creature cards from your graveyard")).toBeUndefined();
  expect(unitAmount("untap", "up to three lands")).toBe("3");
  expect(unitAmount("untap", "X target creatures")).toBe("X");
  expect(unitAmount("copy", "that spell")).toBe("1");
  expect(unitAmount("create-token", "a 1/1 white Soldier creature token")).toBe("1");
  expect(unitAmount("scry", "2")).toBe("2");
  expect(unitAmount("add-counter", "+1/+1")).toBeUndefined();
  // Through derive: Merfolk Looter's discard reads 1 now, and a stated amount is never overwritten.
  const { abilities } = deriveAbilities([{ id: 1, abilityType: "activated", actions: [{ verb: "draw", object: "a card", amount: "1" }, { verb: "discard", object: "a card" }] }], "Merfolk Looter");
  expect(abilities.map((a) => a.amount)).toEqual(["1", "1"]);
});

/** EXHAUST REACHES DERIVE THROUGH THE PRINTED TEXT (CR 702.177a): the segmenter strips the ability
 *  word, so the clause never says it. Loot, the Pathfinder, "Exhaust — {U}, {T}: Draw three cards." */
test("an Exhaust line in the printed text makes its ability once, matched on the cost", () => {
  const clauses = [{ id: 1, abilityType: "activated", actions: [{ verb: "draw", object: "three cards", amount: "3" }] }];
  const printed = "Exhaust — {G}, {T}: Add three mana of any one color.\nExhaust — {U}, {T}: Draw three cards.";
  expect(deriveAbilities(clauses, "Loot, the Pathfinder", undefined, { 1: "{U}, {T}" }, printed).abilities[0]?.repeats).toBe("once");
  expect(deriveAbilities(clauses, "Looter", undefined, { 1: "{U}, {T}" }, "{U}, {T}: Draw three cards.").abilities[0]?.repeats).toBe("per-cycle");
});

/** WHICH CLAUSE PRINTED IT (roadmap AJ4, spec C2). The card page reads down the card, so each
 *  ability has to say which printed line it came from. Without the stamp the page could only ZIP
 *  the clause list against the ability list, and a zip is wrong on every row of any card whose
 *  first clause derives nothing -- Samut has 4 clauses and 3 abilities and every zipped row lies. */
test("every ability carries the id of the clause that printed it", () => {
  const { abilities } = deriveAbilities([
    // A keyword line that derives nothing, which is exactly what makes a positional zip wrong.
    { id: 1, abilityType: "static", actions: [] },
    { id: 2, abilityType: "triggered", trigger: { event: "dies", subject: "a creature you control" },
      actions: [{ verb: "lose-life", object: "each opponent" }, { verb: "gain-life", object: "you" }] },
    { id: 3, abilityType: "activated", actions: [{ verb: "draw", object: "a card" }] },
  ]);
  // Clause 1 produced nothing; the rest name their own clause, not their position.
  expect(abilities.every((a) => a.clause !== undefined)).toBe(true);
  expect(new Set(abilities.filter((a) => a.effect?.kind === "draw-card").map((a) => a.clause))).toEqual(new Set([3]));
  for (const a of abilities.filter((a) => a.trigger)) expect(a.clause).toBe(2);
  // And no ability claims the clause that derived nothing.
  expect(abilities.some((a) => a.clause === 1)).toBe(false);
});

/** AN AURA ON AN OPPONENT'S CREATURE WATCHES THE OPPONENT'S CREATURE (owner 2026-09-23, AN7). Nurgle's
 *  Rot: "Enchant creature an opponent controls / When enchanted creature dies, ...". The trigger
 *  derived `control: you`, so a deck report claimed "When Viscera Seer dies, Nurgle's Rot triggers"
 *  and scored the Aura above Midnight Reaper. The Enchant line says whose creature it is. */
test("an Aura that enchants an opponent's creature gives its host trigger the opponent's side", () => {
  const tags = deriveCardTags({
    oracleId: "test-nurgle",
    clauses: [{ id: 1, abilityType: "triggered", trigger: { event: "dies", subject: "enchanted creature" },
      actions: [{ verb: "create-token", object: "a 1/3 black Demon creature token", amount: "1" }] }],
    characteristics: { ...MINIMAL_CHARACTERISTICS, types: ["enchantment"], subtypes: ["aura"],
      enchants: { control: "opp", token: null, type: "creature" } },
    clauseTexts: { 1: "When enchanted creature dies, return this card to its owner's hand and you create a 1/3 black Demon creature token." },
  });
  const trigger = tags.abilities.find((a) => a.trigger)!.trigger!;
  expect(trigger.subject.control).toBe("opp");
});

test("an Aura on any creature keeps the reading it had (the open One with the Kami question)", () => {
  const tags = deriveCardTags({
    oracleId: "test-kami",
    clauses: [{ id: 1, abilityType: "triggered", trigger: { event: "dies", subject: "enchanted creature" },
      actions: [{ verb: "create-token", object: "a 1/1 colorless Spirit creature token", amount: "1" }] }],
    characteristics: { ...MINIMAL_CHARACTERISTICS, types: ["enchantment"], subtypes: ["aura"],
      enchants: { control: "you", token: null, type: "creature" } },
    clauseTexts: { 1: "When enchanted creature dies, create a 1/1 colorless Spirit creature token." },
  });
  expect(tags.abilities.find((a) => a.trigger)!.trigger!.subject.control).not.toBe("opp");
});

/** "THE" IS NOT A NAME (DERIVE 172, persona round 2026-09-25). A card named "The Sackville-Bagginses"
 *  shortened itself to the first word of its name, which is the article, so the clause subject
 *  "Sackville-Bagginses" was never self: the ETB read as "whenever a permanent you control enters"
 *  and joined Kindred Discovery. And the same fallback made stripCardName delete EVERY "the" from a
 *  "The ..." card's clause text. */
test("a name that starts with 'The' is self without the article, and the article is not a name", () => {
  const enters = (subject: string, name: string, text: string) => deriveAbilities(
    [{ id: 1, abilityType: "triggered", trigger: { event: "enters", subject, control: "you" }, actions: [{ verb: "draw", object: "a card", amount: "1" }] }],
    name, { 1: text },
  ).abilities[0]?.trigger?.subject;
  const oracle = "When The Sackville-Bagginses enter, you may sacrifice another creature or artifact.";
  expect(enters("Sackville-Bagginses", "The Sackville-Bagginses", oracle)).toMatchObject({ self: true });
  expect(enters("The Sackville-Bagginses", "The Sackville-Bagginses", oracle)).toMatchObject({ self: true });
  // "the" alone never names the card.
  expect(enters("the", "The Sackville-Bagginses", "When the creature enters, draw a card.")?.self).toBeUndefined();
  // A typal subject on a "The ..." card stays typal: the article is not stripped out of it.
  expect(enters("a creature", "The Ur-Dragon", "Whenever a creature you control enters, draw a card.")?.self).toBeUndefined();
});

// ISSUE #559: Folk Hero. "Commander creatures you own have 'Whenever you cast a spell that shares a
// creature type with this creature, draw a card.'" The class is the COMMANDER'S types, a deck fact,
// so the derive marks it; the subject used to read as any creature spell.
test("a shared-type trigger granted to commander creatures is marked for the commander", () => {
  const card = "Commander creatures you own have \"Whenever you cast a spell that shares a creature type with this creature, draw a card. This ability triggers only once each turn.\"";
  const { abilities } = deriveAbilities([
    { id: 1, abilityType: "static", actions: [{ verb: "grant-ability", object: "that ability" }] },
    { id: 2, abilityType: "triggered", trigger: { event: "cast", subject: "a spell that shares a creature type with this creature", control: "you" },
      actions: [{ verb: "draw", object: "a card", amount: "1" }] },
  ], "Folk Hero", { 1: "Commander creatures you own have", 2: "Whenever you cast a spell that shares a creature type with this creature, draw a card." }, undefined, card);
  expect(abilities.find((a) => a.trigger)?.trigger?.subject.sharesTypeWith).toBe("commander");
});

test("a shared-type trigger on the card itself is pinned to the card's own creature types (#559)", () => {
  const tags = deriveCardTags({
    oracleId: "x", name: "Kin Keeper",
    characteristics: { types: ["creature"], subtypes: ["Elf", "Druid"], colors: [], identity: [], cmc: 2, power: "1", toughness: "1", token: false, keywords: [] },
    clauses: [{ id: 1, abilityType: "triggered", trigger: { event: "cast", subject: "a spell that shares a creature type with this creature", control: "you" },
      actions: [{ verb: "draw", object: "a card", amount: "1" }] }],
    clauseTexts: { 1: "Whenever you cast a spell that shares a creature type with this creature, draw a card." },
    oracleText: "Whenever you cast a spell that shares a creature type with this creature, draw a card.",
  } as never);
  const s = tags.abilities.find((a) => a.trigger)?.trigger?.subject;
  expect(s?.subtype).toEqual(["elf", "druid"]);
  expect(s?.sharesTypeWith).toBeUndefined();
});

// ISSUE #625: Haunted One. A Background's grant is the commander's ability, so "this creature" and
// "it" are the commander, and "share a creature type with it" is the commander's types.
test("a Background's granted text is about the commander, not the Background (#625)", () => {
  const oracle = "Commander creatures you own have \"Whenever this creature becomes tapped, it and other creatures you control that share a creature type with it each get +2/+0 and gain undying until end of turn.\"";
  const granted = "Whenever this creature becomes tapped, it and other creatures you control that share a creature type with it each get +2/+0 and gain undying until end of turn.";
  const tags = deriveCardTags({
    oracleId: "h", name: "Haunted One", oracleText: oracle,
    characteristics: { types: ["legendary", "enchantment"], subtypes: ["Background"], colors: ["B"], identity: ["B"], cmc: 3, power: null, toughness: null, token: false, keywords: [] },
    clauses: [
      // The stored clauses, verbatim (cardClauses, 2026-09-27).
      { id: 1, abilityType: "static" },
      { id: 2, abilityType: "triggered", trigger: { event: "taps", subject: "this creature", control: "you" },
        actions: [{ verb: "modify-pt", object: "it", amount: "+2/+0" },
          { verb: "modify-pt", object: "other creatures you control that share a creature type with it", amount: "+2/+0" },
          { verb: "grant-ability", object: "it and other creatures you control that share a creature type with it gain undying" }] },
    ],
    clauseTexts: { 1: "Commander creatures you own have", 2: granted },
  } as never);
  expect(JSON.stringify(tags.abilities)).not.toContain('"self":true');
  const trig = tags.abilities.find((a) => a.trigger)?.trigger;
  expect(trig?.subject).toMatchObject({ commander: true, type: "creature" });
  const shared = tags.abilities.filter((a) => a.effect.subject?.sharesTypeWith === "commander");
  expect(shared.length).toBeGreaterThan(0);
  // Never broader than "creatures you control" (review: the undying grant parsed as `control: any`).
  for (const a of shared) expect(a.effect.subject).toMatchObject({ type: "creature", control: "you" });
});

// ISSUE #565: "Whenever AN enchanted creature dies" (Hateful Eidolon) watches a creature wearing an
// Aura -- CR 700.9 modified -- not every death. An Aura's own "enchanted creature" is its host, untouched.
test("an enchanted- or equipped-creature trigger is a modified creature", () => {
  const trig = (subject: string, name: string) => deriveAbilities([{
    id: 1, abilityType: "triggered", trigger: { event: "dies", subject, control: "you" },
    actions: [{ verb: "draw", object: "a card", amount: "1" }],
  }], name, { 1: `Whenever ${subject} dies, draw a card.` }).abilities.find((a) => a.trigger)?.trigger?.subject;
  expect(trig("an enchanted creature", "Hateful Eidolon")?.modified).toBe(true);
  expect(trig("an equipped creature you control", "Stone Haven Outfitter")?.modified).toBe(true);
  expect(trig("enchanted creature", "Some Aura")?.modified).toBeUndefined();
});

// Codie, Ravenous Codex's activated clause came back as `grant-ability` (2026-09-27); the review of the
// first fix found it rewrote EVERY grant in the clause, losing a sibling hexproof grant.
test("a grant whose clause 'becomes prepared' is a prepare -- that grant only", () => {
  const grant = (object: string) => ({ verb: "grant-ability", object, fromZone: null, toZone: null, amount: null, optional: false });
  const emitVerbs = (r: ReturnType<typeof deriveAbilities>) => r.abilities.flatMap((a) => (a.emits ?? []).map((e) => e.verb));
  const codie = deriveAbilities([{ id: 2, abilityType: "activated", actions: [grant("each creature you control")] }] as never, "Codie",
    { 2: "Each creature you control becomes prepared." });
  expect(emitVerbs(codie)).toContain("prepared");
  const two = deriveAbilities([{ id: 1, abilityType: "static", actions: [grant("prepared"), grant("hexproof until end of turn")] }] as never, "X",
    { 1: "Each creature you control becomes prepared and gains hexproof until end of turn." });
  expect(emitVerbs(two).filter((v) => v === "prepared")).toHaveLength(1);
  expect(two.abilities.some((a) => a.effect.kind === "keyword-grant")).toBe(true);
});

/** A GRANT TO THE SPELLS YOU CAST NAMES THEM (#681; owner ruling 2026-09-28: it links to every
 *  matching spell, the shape cost reducers already have). Anhelo, the Painter and Yidris, Maelstrom
 *  Wielder derived a keyword-grant with no recipient, so their precons read 0 commander links. */
test("a grant to spells you cast recovers the spell class, like a cost reducer's subject", () => {
  const anhelo = deriveAbilities([{
    id: 2, abilityType: "static",
    actions: [{ verb: "grant-ability", object: "casualty 2" }],
  }], "Anhelo, the Painter", { 2: "The first instant or sorcery spell you cast each turn has casualty 2." });
  expect(anhelo.abilities.find((a) => a.effect.kind === "keyword-grant")?.effect.subject)
    .toMatchObject({ type: ["instant", "sorcery"], control: "you" });

  const yidris = deriveAbilities([{
    id: 2, abilityType: "triggered", trigger: { event: "damage-dealt", subject: "Yidris", control: "you" },
    actions: [{ verb: "grant-ability", object: "spells cast from your hand this turn gain cascade" }],
  }], "Yidris, Maelstrom Wielder", { 2: "Whenever Yidris deals combat damage to a player, as you cast spells from your hand this turn, they gain cascade." });
  expect(yidris.abilities.find((a) => a.effect.kind === "keyword-grant")?.effect.subject)
    .toMatchObject({ type: "spell", control: "you" });

  // A grant to every CREATURE stays refused (the go-wide ruling covers attack payoffs and counts,
  // not anthem grants): only a class of spells you cast is admitted.
  const generic = deriveAbilities([{
    id: 1, abilityType: "static",
    actions: [{ verb: "grant-ability", object: "haste" }],
  }], "Fervor", { 1: "Creatures you control have haste." });
  expect(generic.abilities.find((a) => a.effect.kind === "keyword-grant")?.effect.subject).toBeUndefined();
});

/** A SPELL GRANT WHOSE CLASS THE FILTER CANNOT HOLD STAYS REFUSED (#681 audit of all 39). "From your
 *  hand" is every spell you cast in practice, so Yidris keeps it; "from exile", "multicolored",
 *  "exactly three colors" and "if mana from an artifact was spent" narrow to cards the subject would
 *  not name, and linking every spell would be a silent wrong answer. */
test("a spell grant narrowed by zone, colour count or spent mana is refused, not widened", () => {
  const grant = (name: string, text: string) => deriveAbilities([{ id: 1, abilityType: "static", actions: [{ verb: "grant-ability", object: "cascade" }] }], name, { 1: text })
    .abilities.find((a) => a.effect.kind === "keyword-grant")?.effect.subject;
  expect(grant("Hoarding Broodlord", "Spells you cast from exile have convoke.")).toBeUndefined();
  expect(grant("The Twelfth Doctor", "The first spell you cast from anywhere other than your hand each turn has demonstrate.")).toBeUndefined();
  expect(grant("Fallaji Wayfarer", "Multicolored spells you cast have convoke.")).toBeUndefined();
  expect(grant("Threefold Signal", "Each spell you cast that's exactly three colors has replicate {3}.")).toBeUndefined();
  expect(grant("Shadow the Hedgehog", "Each spell you cast has split second if mana from an artifact was spent to cast it.")).toBeUndefined();
  expect(grant("Maelstrom Nexus", "The first spell you cast each turn has cascade.")).toMatchObject({ type: "spell", control: "you" });
  expect(grant("Quandrix, the Proof", "Instant and sorcery spells you cast from your hand have cascade.")).toMatchObject({ type: ["instant", "sorcery"], control: "you" });
});

/** A PRINTED "Casualty 2" is the same outlet on the spell itself (Make Disappear; 18 corpus cards).
 *  Scryfall's keyword list drops the number, so it is read from the keyword line. */
test("a printed casualty keyword line derives an on-cast sacrifice of a creature with that power", () => {
  const r = deriveAbilities([
    { id: 1, abilityType: "none", actions: [{ verb: "none", object: "Casualty 1" }] },
    { id: 2, abilityType: "spell", actions: [{ verb: "counter", object: "target spell" }] },
  ], "Make Disappear", { 1: "Casualty 1", 2: "Counter target spell unless its controller pays {2}." });
  const sac = r.abilities.flatMap((a) => (a.emits ?? []).map((e) => ({ kind: a.kind, e }))).find((x) => x.e.verb === "sacrifice");
  expect(sac?.kind).toBe("on-cast");
  expect(sac?.e.subject).toMatchObject({ type: "creature", control: "you", stats: [{ metric: "power", op: "gte", value: 1 }] });
});

/** AN "OR" LIMB THE CLAUSE LAYER CANNOT HOLD IS A TWIN TRIGGER (compass misses, 2026-09-28). Syr
 *  Konrad triggers on three limbs, and a ClauseRecord trigger holds ONE event, so the stored clause
 *  kept only "another creature dies" and every mill card lost its link. Each extra limb derives a twin
 *  with the same effect, in the shape a single-limb card of that event already derives. */
test("Syr Konrad's 'or put into a graveyard from anywhere' and 'or leaves your graveyard' limbs are twin triggers", () => {
  const konrad = deriveAbilities([{
    id: 1, abilityType: "triggered", trigger: { event: "dies", subject: "another creature", control: "any" },
    actions: [{ verb: "deal-damage", object: "each opponent", amount: "1" }],
  }], "Syr Konrad, the Grim", { 1: "Whenever another creature dies, or a creature card is put into a graveyard from anywhere other than the battlefield, or a creature card leaves your graveyard, Syr Konrad deals 1 damage to each opponent." });
  const triggers = konrad.abilities.filter((a) => a.effect.kind === "damage").map((a) => a.trigger);
  expect(triggers.map((t) => t?.verbs[0])).toEqual(["dies", "enters-graveyard", "leaves"]);
  expect(triggers[1]?.subject).toMatchObject({ type: "creature", control: "any" });
  expect(triggers[2]?.subject).toMatchObject({ type: "creature", control: "you", zone: "graveyard" });
  // AN "OR" IN THE EFFECT IS NOT A TRIGGER LIMB (review): only the preamble before the effect is read.
  const effectOr = deriveAbilities([{ id: 1, abilityType: "triggered", trigger: { event: "dies", subject: "another creature", control: "any" }, actions: [{ verb: "draw", object: "you", amount: "1" }] }],
    "Test", { 1: "Whenever another creature dies, draw a card, or a creature card is put into a graveyard from anywhere if you control a Zombie." });
  expect(effectOr.abilities.filter((a) => a.trigger).map((a) => a.trigger?.verbs[0])).toEqual(["dies"]);
  // A single-limb trigger derives no twin.
  const one = deriveAbilities([{ id: 1, abilityType: "triggered", trigger: { event: "dies", subject: "another creature", control: "any" }, actions: [{ verb: "draw", object: "you", amount: "1" }] }],
    "Test", { 1: "Whenever another creature dies, draw a card." });
  expect(one.abilities.filter((a) => a.trigger).length).toBe(1);
});

/** "ASSIGNS COMBAT DAMAGE EQUAL TO ITS TOUGHNESS" RELATES TO CREATURES WHOSE TOUGHNESS EXCEEDS THEIR
 *  POWER (owner ruling 2026-09-28: Doran, the Siege Tower links to Wall of Omens). A static
 *  damage-multiplier over that stat line, from the clause TEXT: the 24 corpus cards store it as
 *  `other`, `modify-pt` or nothing. Only a whole-board recipient is a class; "this creature",
 *  "target creature" and an Aura's or Equipment's host are not. */
test("a toughness-damage rule is a static over creatures whose toughness exceeds their power", () => {
  const sub = (name: string, text: string) => deriveAbilities([{ id: 1, abilityType: "static", actions: [{ verb: "other", object: text }] }], name, { 1: text })
    .abilities.find((a) => a.effect.kind === "damage-multiplier")?.effect.subject;
  expect(sub("Doran, the Siege Tower", "Each creature assigns combat damage equal to its toughness rather than its power."))
    .toMatchObject({ type: "creature", control: "any", stats: [{ metric: "toughness", op: "gt", vs: "power" }] });
  expect(sub("Assault Formation", "Each creature you control assigns combat damage equal to its toughness rather than its power."))
    .toMatchObject({ type: "creature", control: "you", stats: [{ metric: "toughness", op: "gt", vs: "power" }] });
  expect(sub("Arcades, the Strategist", "Each creature you control with defender assigns combat damage equal to its toughness rather than its power and can attack as though it didn't have defender."))
    .toMatchObject({ type: "creature", control: "you", keyword: ["defender"] });
  expect(sub("Streetwise Negotiator", "This creature assigns combat damage equal to its toughness rather than its power.")).toBeUndefined();
  expect(sub("Gauntlets of Light", "Enchanted creature gets +0/+2 and assigns combat damage equal to its toughness rather than its power.")).toBeUndefined();
  expect(sub("Plagon, Lord of the Beach", "Target creature you control assigns combat damage equal to its toughness rather than its power this turn.")).toBeUndefined();
});

// #711 PART 2 (owner ruling 2026-09-28): three more shapes of "a grant to every creature you control".
test("a quoted grant the model left without an action still names its recipient", () => {
  const ev = deriveAbilities([{ id: 2, abilityType: "static", actions: [] }], "Enduring Vitality",
    { 2: "Creatures you control have \"{T}: Add one mana of any color.\"" }).abilities;
  expect(ev[0]?.effect).toMatchObject({ kind: "keyword-grant", subject: { type: "creature", control: "you" } });
  // What derive actually receives: `segment()` rewrites the quote to "that ability".
  // ...and what the canonical record holds: a single placeholder action, verb "none".
  const seg = deriveAbilities([{ id: 2, abilityType: "static", actions: [{ verb: "none" }] }], "Enduring Vitality",
    { 2: "Creatures you control have that ability" }).abilities;
  expect(seg[0]?.effect).toMatchObject({ kind: "keyword-grant", subject: { type: "creature", control: "you" } });
  // A static clause with no action and no quoted grant stays empty.
  expect(deriveAbilities([{ id: 2, abilityType: "static", actions: [] }], "Nothing", { 2: "This spell can't be countered." }).abilities).toHaveLength(0);
});

test("casting a class of spells as though they had flash is a static grant to that class", () => {
  const flash = (text: string) => deriveAbilities([{ id: 2, abilityType: "static", actions: [{ verb: "cast", object: "spells", optional: true }] }], "Shimmer Myr", { 2: text })
    .abilities.find((a) => a.effect.kind === "speed-increase")?.effect.subject;
  expect(flash("You may cast artifact spells as though they had flash.")).toMatchObject({ type: "artifact", control: "you" });
  // Only the unconditional hand cast: a zone or a condition leaves it unread.
  expect(flash("You may cast artifact spells from your graveyard as though they had flash.")).toBeUndefined();
  expect(flash("During your turn, you may cast creature spells as though they had flash.")).toBeUndefined();
  // No class, no claim: every nonland card is not a class (Vedalken Orrery).
  expect(flash("You may cast spells as though they had flash.")).toBeUndefined();
});

test("doubling power and toughness is a pump over the class it names", () => {
  const ug = deriveAbilities([{ id: 1, abilityType: "triggered", trigger: { event: "begin-combat", subject: "you", control: "you" },
    actions: [{ verb: "double", object: "the power and toughness of each creature you control" }] }], "Unnatural Growth",
  { 1: "At the beginning of each combat, double the power and toughness of each creature you control until end of turn." }).abilities[0]!;
  expect(ug.repeats).toBe("per-cycle");
  expect(ug.effect).toMatchObject({ kind: "pump", subject: { type: "creature", control: "you", scope: "each" } });
});

// #715 (owner lost-pair re-judge 2026-09-28): two enter payoffs the derive layer starved.
test("a reveal-until dig types the card it puts onto the battlefield", () => {
  const text = "Whenever one or more creatures you control deal combat damage to a player, you may sacrifice one of them. If you do, reveal cards from the top of your library until you reveal a creature card that shares a creature type with the sacrificed creature. Put that card onto the battlefield and the rest on the bottom of your library in a random order.";
  const emits = deriveAbilities([{ id: 1, abilityType: "triggered", trigger: { event: "damage-dealt", subject: "one or more creatures you control", control: "you" },
    actions: [{ verb: "sacrifice", object: "one of them", optional: true }, { verb: "put", object: "that card", fromZone: "library", toZone: "battlefield" }] }],
  "Descendants' Fury", { 1: text }).abilities.flatMap((a) => a.emits ?? []);
  expect(emits.find((e) => e.verb === "enters")?.subject).toMatchObject({ type: "creature", fromZone: "library" });
});

test("a zone-less return after an exile in the same clause is a flicker", () => {
  const flicker = (text: string, actions: { verb: string; object: string }[]) => deriveAbilities([{ id: 2, abilityType: "activated", actions }],
    "Jill, Shiva's Dominant", { 2: text }).abilities.find((a) => a.effect.kind === "flicker");
  expect(flicker("Exile Jill, then return it to the battlefield transformed under its owner's control.",
    [{ verb: "exile", object: "Jill" }, { verb: "return", object: "it" }])?.emits?.[0]).toMatchObject({ verb: "enters", subject: { self: true, fromZone: "exile" } });
  // No exile before it: a bounce-to-hand "return" is not rewritten.
  expect(flicker("Return it to its owner's hand.", [{ verb: "return", object: "it" }])).toBeUndefined();
});

test("a self re-entry 'returned transformed' is marked as the back face (CR 712.14a, #715)", () => {
  const reEntry = (text: string, object = "it") => deriveAbilities([{ id: 2, abilityType: "activated",
    actions: [{ verb: "exile", object: "Jill" }, { verb: "return", object }] }], "Jill, Shiva's Dominant", { 2: text })
    .abilities.flatMap((a) => a.emits ?? []).find((e) => e.verb === "enters");
  expect(reEntry("Exile Jill, then return it to the battlefield transformed under its owner's control.")?.subject.transformed).toBe(true);
  // The corpus's other phrasings: a gendered pronoun (Ajani), "tapped and transformed" (Ojer Taq).
  expect(reEntry("Exile Jill, then return him to the battlefield transformed under his owner's control.", "him")?.subject.transformed).toBe(true);
  expect(reEntry("Exile Jill, then return it to the battlefield tapped and transformed under its owner's control.")?.subject.transformed).toBe(true);
  // "put ... onto the battlefield transformed" (Startled Awake), the other verb the rule names.
  expect(deriveAbilities([{ id: 2, abilityType: "activated", actions: [{ verb: "put", object: "this card", fromZone: "graveyard", toZone: "battlefield" }] }],
    "Startled Awake", { 2: "Put this card from your graveyard onto the battlefield transformed under your control." })
    .abilities.flatMap((a) => a.emits ?? []).find((e) => e.verb === "enters")?.subject.transformed).toBe(true);
  // Front face up by default (CR 712.14): no mark.
  expect(reEntry("Exile Jill, then return it to the battlefield under its owner's control.")?.subject.transformed).toBeUndefined();
});

// #716 (owner lost-pair re-judge 2026-09-28).
test("a destroy whose controller gets copies back kills YOUR creature (Saw in Half, #513)", () => {
  const text = "Destroy target creature. If that creature dies this way, its controller creates two tokens that are copies of that creature, except their power is half that creature's power and their toughness is half that creature's toughness. Round up each time.";
  const dies = deriveAbilities([{ id: 1, abilityType: "spell", actions: [{ verb: "destroy", object: "target creature" }] }], "Saw in Half", { 1: text }, {}, text)
    .abilities.flatMap((a) => a.emits ?? []).find((e) => e.verb === "dies");
  expect(dies?.subject.control).toBe("you");
  // An ordinary targeted destroy stays aimed at an opponent.
  const bolt = deriveAbilities([{ id: 1, abilityType: "spell", actions: [{ verb: "destroy", object: "target creature" }] }], "Murder", { 1: "Destroy target creature." }, {}, "Destroy target creature.")
    .abilities.flatMap((a) => a.emits ?? []).find((e) => e.verb === "dies");
  expect(bolt?.subject.control).toBe("opp");
});

test("an object naming 'in your graveyard' supplies the zone the model left out", () => {
  const emry = deriveAbilities([{ id: 3, abilityType: "activated", actions: [{ verb: "cast", object: "target artifact card in your graveyard", optional: true }] }],
    "Emry, Lurker of the Loch", { 3: "Choose target artifact card in your graveyard. You may cast that card this turn." }).abilities;
  expect(emry.find((a) => a.effect.kind === "graveyard-recursion")?.effect.subject).toMatchObject({ type: "artifact", zone: "graveyard" });
});

// #717 (owner lost-pair re-judge 2026-09-28): two statics.
test("a cost reduction over 'spell you cast' is your class, with its stat-vs-stat narrowing", () => {
  const doran = deriveAbilities([{ id: 1, abilityType: "static", actions: [{ verb: "cost-modify", object: "creature spell you cast with toughness greater than its power", amount: "-1" }] }],
    "Doran, Besieged by Time", { 1: "Each creature spell you cast with toughness greater than its power costs {1} less to cast." }).abilities[0]!;
  expect(doran.effect).toMatchObject({ kind: "cost-reduction", subject: { type: "creature", control: "you", scope: "all", stats: [{ metric: "toughness", op: "gt", vs: "power" }] } });
  // A narrowing no field holds stays unread, not widened (Baral's first spell each turn).
  const baral = deriveAbilities([{ id: 1, abilityType: "static", actions: [{ verb: "cost-modify", object: "the first instant or sorcery spell you cast each turn", amount: "-1" }] }],
    "Baral", { 1: "The first instant or sorcery spell you cast each turn costs {1} less to cast." }).abilities[0];
  expect(baral?.effect.subject?.control).not.toBe("you");
});

test("'if you would draw a card ... instead' is a draw replacement, a payoff for draws", () => {
  const archive = deriveAbilities([{ id: 2, abilityType: "static", actions: [{ verb: "draw", object: "two cards" }] }],
    "Alhammarret's Archive", { 2: "If you would draw a card except the first one you draw in each of your draw steps, draw two cards instead." }).abilities;
  const payoff = archive.find((a) => a.trigger?.verbs.includes("draw"));
  expect(payoff?.effect.kind).toBe("draw-card");
  // It draws nothing of its own: no draw emit from the replacement.
  expect(archive.some((a) => (a.emits ?? []).some((e) => e.verb === "draw"))).toBe(false);
});

// Edge magnitude (spec 2026-09-29): the count and the batching, as derive records them.
test("a token maker records its count: Krenko's Command 2, Grand Crescendo X", () => {
  const krenko = deriveAbilities([{ id: 1, abilityType: "spell", actions: [{ verb: "create", object: "two 1/1 red Goblin creature tokens", amount: "2" }] }],
    "Krenko's Command", { 1: "Create two 1/1 red Goblin creature tokens." }).abilities;
  expect(krenko.find((a) => a.effect.kind === "token-generation")?.count).toEqual({ floor: 2, ceiling: 2 });
  const crescendo = deriveAbilities([{ id: 1, abilityType: "spell", actions: [{ verb: "create", object: "X 1/1 green and white Citizen creature tokens", amount: "X" }] }],
    "Grand Crescendo", { 1: "Create X 1/1 green and white Citizen creature tokens." }).abilities;
  expect(crescendo.find((a) => a.effect.kind === "token-generation")?.count).toEqual({ floor: 0, ceiling: null, scalesWith: "mana" });
});

test("'whenever one or more ... enter' is batched; 'whenever a creature enters' is not (CR 603.2c)", () => {
  const batched = deriveAbilities([{ id: 1, abilityType: "triggered",
    trigger: { event: "enters", subject: "one or more other creatures you control with power 2 or less", control: "you" },
    actions: [{ verb: "draw", object: "a card" }] }], "Welcoming Vampire",
    { 1: "Whenever one or more other creatures you control with power 2 or less enter, draw a card." }).abilities;
  expect(batched[0]?.trigger?.batched).toBe(true);
  const single = deriveAbilities([{ id: 1, abilityType: "triggered",
    trigger: { event: "enters", subject: "a creature you control", control: "you" },
    actions: [{ verb: "deal-damage", object: "each opponent", amount: "1" }] }], "Impact Tremors",
    { 1: "Whenever a creature you control enters, this enchantment deals 1 damage to each opponent." }).abilities;
  expect(single[0]?.trigger?.batched).toBeUndefined();
});

test("'one or more' in the EFFECT does not batch the trigger", () => {
  const out = deriveAbilities([{ id: 1, abilityType: "triggered",
    trigger: { event: "enters", subject: "a land you control", control: "you" },
    actions: [{ verb: "create", object: "one or more 1/1 tokens" }] }], "Test Card",
    { 1: "Whenever a land you control enters, create one or more 1/1 tokens." }).abilities;
  expect(out[0]?.trigger?.batched).toBeUndefined();
});

// Owner's edge-magnitude sheet (2026-09-29): a pronoun put inherits WHAT the search found and HOW MANY.
test("'put those cards onto the battlefield' after a search is the searched class, up to its count (The Five Doctors)", () => {
  const text = "Search your library and/or graveyard for up to five Doctor cards, reveal them, and put them into your hand. If you search your library this way, shuffle. If this spell was kicked, put those cards onto the battlefield instead of putting them into your hand.";
  const out = deriveAbilities([{ id: 2, abilityType: "spell", actions: [
    { verb: "search", object: "up to five Doctor cards", fromZone: "library" },
    { verb: "search", object: "up to five Doctor cards", fromZone: "graveyard" },
    { verb: "reveal", object: "them" },
    { verb: "shuffle", object: "your library" },
    { verb: "put", object: "those cards", toZone: "hand" },
    { verb: "put", object: "those cards", toZone: "battlefield" },
  ] }], "The Five Doctors", { 2: text }).abilities;
  const enters = out.find((a) => (a.emits ?? []).some((e) => e.verb === "enters"));
  // Not "your library": the zone the shuffle names is no thing a pronoun can mean.
  expect(enters?.emits?.find((e) => e.verb === "enters")?.subject.subtype).toBe("doctor");
  expect(enters?.count).toEqual({ floor: 0, ceiling: 5 });
});

test("a put of the 'searched cards' inherits the search's count (Canoptek Wraith, up to two lands)", () => {
  const text = "When this creature deals combat damage to a player, you may pay {3} and sacrifice it. If you do, choose a land you control. Then search your library for up to two basic land cards which have the same name as the chosen land, put them onto the battlefield tapped, then shuffle.";
  const out = deriveAbilities([{ id: 2, abilityType: "triggered", trigger: { event: "damage-dealt", subject: "this creature", control: "you" }, actions: [
    { verb: "sacrifice", object: "this" },
    { verb: "search", object: "up to two basic land cards which have the same name as the chosen land", fromZone: "library" },
    { verb: "put", object: "searched cards", fromZone: "library", toZone: "battlefield" },
    { verb: "shuffle", object: "your library" },
  ] }], "Canoptek Wraith", { 2: text }).abilities;
  const enters = out.find((a) => (a.emits ?? []).some((e) => e.verb === "enters"));
  expect(enters?.count).toEqual({ floor: 0, ceiling: 2 });
});

test("an open threshold is no count, and a compound zone is no antecedent (review of DERIVE 200)", () => {
  const put = (text: string, actions: { verb: string; object: string; fromZone?: string; toZone?: string }[]) =>
    deriveAbilities([{ id: 1, abilityType: "spell", actions }], "Test Card", { 1: text }).abilities
      .find((a) => (a.emits ?? []).some((e) => e.verb === "enters"));
  // "two or more" states no fixed number: the put stays uncounted rather than 2-2.
  expect(put("Return two or more creature cards from your graveyard to the battlefield.", [
    { verb: "search", object: "two or more creature cards", fromZone: "graveyard" },
    { verb: "put", object: "them", toZone: "battlefield" },
  ])?.count).toBeUndefined();
  // "your hand and graveyard" is a zone: the pronoun walks past it to the searched class.
  const typed = put("Search your library for a creature card, shuffle your hand and graveyard into your library, then put that card onto the battlefield.", [
    { verb: "search", object: "a creature card", fromZone: "library" },
    { verb: "shuffle", object: "your hand and graveyard into your library" },
    { verb: "put", object: "that card", toZone: "battlefield" },
  ]);
  expect(typed?.emits?.find((e) => e.verb === "enters")?.subject.type).toBe("creature");
});

// #798 (owner's edge-magnitude sheet, 2026-09-29): Garna draws only for an ATTACKING creature's death.
test("'draw a card if it was attacking. Otherwise, ...' puts the combat state on the draw only (Garna)", () => {
  const text = "Whenever another creature you control dies, draw a card if it was attacking. Otherwise, Garna deals 1 damage to each opponent.";
  const out = deriveAbilities([{ id: 1, abilityType: "triggered",
    trigger: { event: "dies", subject: "another creature you control", control: "you" },
    actions: [{ verb: "draw", object: "a card", amount: "1" }, { verb: "deal-damage", object: "each opponent", amount: "1" }] }],
  "Garna, Bloodfist of Keld", { 1: text }).abilities;
  expect(out.find((a) => a.effect.kind === "draw-card")?.trigger?.subject.combat).toBe("attacking");
  // "Otherwise" is every other death: no combat state, and "not attacking" is not expressible.
  expect(out.find((a) => a.effect.kind === "damage")?.trigger?.subject.combat).toBeUndefined();
});

// Real oracle text only: Echoing Assault, first reached for here from memory, sacrifices at the NEXT END STEP.
test("a token sacrificed AT END OF COMBAT, or decayed, dies attacking; one sacrificed at the next end step does not (#798)", () => {
  const death = (name: string, text: string, object: string, rider = "it") => deriveAbilities([{ id: 1, abilityType: "triggered",
    trigger: { event: "attacks", subject: "you", control: "you" },
    actions: [{ verb: "create", object, amount: "1" }, { verb: "sacrifice", object: rider }] }], name, { 1: text })
    .abilities.flatMap((a) => a.emits ?? []).find((e) => e.verb === "dies");
  expect(death("Mordor Trebuchet", "Whenever you attack with one or more Goblins and/or Orcs, create a 2/1 colorless Construct artifact creature token with flying named Ballistic Boulder that's tapped and attacking. Sacrifice that token at end of combat.",
    "a 2/1 colorless Construct artifact creature token with flying named Ballistic Boulder", "that token")?.subject.combat).toBe("attacking");
  expect(death("Jadar, Ghoulcaller of Nephalia", "At the beginning of your end step, if you control no creatures with decayed, create a 2/2 black Zombie creature token with decayed.",
    "a 2/2 black Zombie creature token with decayed")?.subject.combat).toBe("attacking");
  expect(death("Urabrask's Forge", "At the beginning of combat on your turn, put an oil counter on this artifact, then create an X/1 red Phyrexian Horror creature token with trample and haste, where X is the number of oil counters on this artifact. Sacrifice that token at the beginning of the next end step.",
    "an X/1 red Phyrexian Horror creature token with trample and haste", "that token")?.subject.combat).toBeUndefined();
});

test("the self-or-class twin keeps the combat state its condition set (review of #798)", () => {
  const out = deriveAbilities([{ id: 1, abilityType: "triggered",
    trigger: { event: "dies", subject: "this creature or another creature you control", control: "you" },
    actions: [{ verb: "draw", object: "a card", amount: "1" }] }], "Test Card",
    { 1: "Whenever this creature or another creature you control dies, draw a card if it was attacking." }).abilities;
  const draws = out.filter((a) => a.effect.kind === "draw-card");
  expect(draws.length).toBeGreaterThan(1);
  for (const d of draws) expect(d.trigger?.subject.combat).toBe("attacking");
});

// #896 task 4: what a reference points at.
test("'exile it' after a death is the dying card, in the graveyard: no battlefield leave (Mari, the Killing Quill, #823)", () => {
  const mari = deriveAbilities([{ id: 1, abilityType: "triggered", trigger: { event: "dies", subject: "a creature an opponent controls", control: "opponent" },
    actions: [{ verb: "exile", object: "it" }, { verb: "add-counter", object: "hit", amount: "1" }] } as never], "Mari, the Killing Quill",
  { 1: "Whenever a creature an opponent controls dies, exile it with a hit counter on it." }).abilities;
  const exiled = mari.flatMap((a) => a.emits ?? []).find((e) => e.verb === "exiled");
  expect(exiled?.subject).toMatchObject({ control: "opp", type: "creature", fromZone: "graveyard", ref: "trigger" });
  const leaves = mari.flatMap((a) => a.emits ?? []).find((e) => e.verb === "leaves");
  expect(leaves?.subject.fromZone).toBe("graveyard");
});

test("after a reveal, 'it' is the revealed card, not the triggering object (Matter Reshaper)", () => {
  const out = deriveAbilities([{ id: 1, abilityType: "triggered", trigger: { event: "dies", subject: "this creature", control: "you" },
    actions: [{ verb: "put", object: "it", fromZone: "library", toZone: "battlefield", optional: true }] } as never], "Matter Reshaper",
  { 1: "When this creature dies, reveal the top card of your library. You may put it onto the battlefield if it's a permanent card with mana value 3 or less. Otherwise, put that card into your hand." }).abilities;
  expect(out.flatMap((a) => a.emits ?? []).some((e) => e.subject.ref === "trigger")).toBe(false);
});

test("a trigger that names a player or a time is no referent: 'cast it' on your upkeep is not 'cast you' (Galvanoth)", () => {
  const out = deriveAbilities([{ id: 1, abilityType: "triggered", trigger: { event: "upkeep", subject: "you", control: "you" },
    actions: [{ verb: "cast", object: "it", fromZone: "library" }] } as never], "Galvanoth",
  { 1: "At the beginning of your upkeep, you may look at the top card of your library. If it's an instant or sorcery card, you may cast it without paying its mana cost." }).abilities;
  expect(out.flatMap((a) => a.emits ?? []).every((e) => e.subject.ref === undefined)).toBe(true);
});

test("'the exiled cards' in a later clause are what an earlier clause exiled (Petradon)", () => {
  const flicker = deriveAbilities([
    { id: 1, abilityType: "triggered", trigger: { event: "enters", subject: "this creature", control: "you" },
      actions: [{ verb: "exile", object: "two target lands", fromZone: "battlefield", toZone: "exile" }] },
    { id: 2, abilityType: "triggered", trigger: { event: "leaves", subject: "this creature", control: "you" },
      actions: [{ verb: "return", object: "the exiled cards", fromZone: "exile", toZone: "battlefield" }] },
  ] as never, "Petradon", { 1: "When this creature enters, exile two target lands.", 2: "When this creature leaves the battlefield, return the exiled cards to the battlefield under their owners' control." })
    .abilities.find((a) => a.effect.kind === "flicker");
  expect(flicker?.effect.subject?.type).toBe("land");
  expect(flicker?.effect.subject?.self).toBeUndefined();
});

// #886 (#726 loop research): a return that marks what it returns cannot bring the same creature back twice.
test("a return with a finality counter, or a keyword counter the trigger excludes, is once per object", () => {
  const derive = (name: string, clause: object, text: string) => deriveAbilities([{ id: 1, ...clause } as never], name, { 1: text }).abilities
    .find((a) => a.effect.kind === "graveyard-recursion");
  const dies = (subject: string) => ({ event: "dies", subject, control: "you" });
  const back = { verb: "return", object: "it", fromZone: "graveyard", toZone: "battlefield" };
  expect(derive("Meathook Massacre II", { abilityType: "triggered", trigger: dies("a creature you control"),
    actions: [{ ...back, object: "that card" }, { verb: "add-counter", object: "finality", amount: "1" }] },
    "Whenever a creature you control dies, you may pay 3 life. If you do, return that card under your control with a finality counter on it.")?.oncePerObject).toBe(true);
  expect(derive("Luminous Broodmoth", { abilityType: "triggered", trigger: dies("a creature you control without flying"),
    actions: [back, { verb: "add-counter", object: "flying counter" }] },
    "Whenever a creature you control without flying dies, return it to the battlefield under its owner's control with a flying counter on it.")?.oncePerObject).toBe(true);
  // A +1/+1 counter marks nothing the trigger reads: the creature can come back again.
  expect(derive("Test Card", { abilityType: "triggered", trigger: dies("a creature you control"),
    actions: [back, { verb: "add-counter", object: "+1/+1", amount: "1" }] },
    "Whenever a creature you control dies, return it to the battlefield with a +1/+1 counter on it.")?.oncePerObject).toBeUndefined();
  // A finality counter on some OTHER object marks nothing about the returned card (review).
  expect(derive("Test Card", { abilityType: "triggered", trigger: dies("a creature you control"),
    actions: [back, { verb: "add-counter", object: "finality", amount: "1" }] },
    "Whenever a creature you control dies, return it to the battlefield. Put a finality counter on target creature an opponent controls.")?.oncePerObject).toBeUndefined();
});

// #887 (#726 loop research): a flicker's "return that card" is what the exile named.
test("a flicker's subject is the exiled class, not the pronoun (Displacer Kitten)", () => {
  const kitten = deriveAbilities([{ id: 1, abilityType: "triggered", trigger: { event: "cast", subject: "a noncreature spell", control: "you" },
    actions: [{ verb: "exile", object: "up to one target nonland permanent you control", fromZone: "battlefield", toZone: "exile", optional: true },
      { verb: "return", object: "that card", fromZone: "exile", toZone: "battlefield" }] } as never], "Displacer Kitten",
  { 1: "Whenever you cast a noncreature spell, exile up to one target nonland permanent you control, then return that card to the battlefield under its owner's control." })
    .abilities.find((a) => a.effect.kind === "flicker");
  expect(kitten?.effect.subject?.control).toBe("you");
  expect(kitten?.effect.subject?.notType).toEqual(["land"]);
  expect(kitten?.effect.subject?.self).toBeUndefined();
  // A cross-clause "the exiled cards" is never the trigger's subject: it is what the earlier clause
  // exiled (Petradon; review of #895, then #896 task 4).
  const petradon = deriveAbilities([
    { id: 1, abilityType: "triggered", trigger: { event: "enters", subject: "this creature", control: "you" },
      actions: [{ verb: "exile", object: "two target lands", fromZone: "battlefield", toZone: "exile" }] },
    { id: 2, abilityType: "triggered", trigger: { event: "leaves", subject: "this creature", control: "you" },
      actions: [{ verb: "return", object: "the exiled cards", fromZone: "exile", toZone: "battlefield" }] },
  ] as never, "Petradon", { 1: "When this creature enters, exile two target lands.", 2: "When this creature leaves the battlefield, return the exiled cards to the battlefield under their owners' control." })
    .abilities.find((a) => a.effect.kind === "flicker");
  expect(petradon).toBeDefined();
  expect(petradon?.effect.subject?.type).toBe("land");
});

// #801 (#726 loop research): a return "at the beginning of the next end step" cannot close a loop this turn.
test("a return at the beginning of the next end step is delayed; the exile before it and a token's end-step sacrifice are not", () => {
  const derive = (name: string, clause: object, text: string) => deriveAbilities([{ id: 1, ...clause } as never], name, { 1: text }).abilities;
  const shirei = derive("Shirei, Shizo's Caretaker", { abilityType: "triggered",
    trigger: { event: "dies", subject: "a creature you control with power 1 or less", control: "you" },
    actions: [{ verb: "return", object: "that card", fromZone: "graveyard", toZone: "battlefield" }] },
    "Whenever a creature you control with power 1 or less dies, return that card to the battlefield under its owner's control at the beginning of the next end step.");
  expect(shirei.find((a) => a.effect.kind === "graveyard-recursion")?.delayedUntil).toBe("next-end-step");
  const random = derive("Random Encounter", { abilityType: "spell",
    actions: [{ verb: "exile", object: "any number of target creatures you control" }, { verb: "return", object: "those creatures", toZone: "hand" }] },
    "At the beginning of the next end step, return those creatures to their owner's hand.");
  expect(random.find((a) => (a.emits ?? []).some((e) => e.verb === "exiled"))?.delayedUntil).toBeUndefined();
  const nahiri = derive("Nahiri's Resolve", { abilityType: "triggered", trigger: { event: "upkeep", subject: "you", control: "you" },
    actions: [{ verb: "exile", object: "any number of creatures you control" }, { verb: "return", object: "those cards", fromZone: "exile", toZone: "battlefield" }] },
    "At the beginning of your upkeep, exile any number of creatures you control, then return those cards to the battlefield under their owner's control at the beginning of your next upkeep.");
  expect(nahiri.find((a) => (a.emits ?? []).some((e) => e.verb === "enters"))?.delayedUntil).toBe("next-upkeep");
  expect(nahiri.find((a) => (a.emits ?? []).some((e) => e.verb === "exiled"))?.delayedUntil).toBeUndefined();
  const forge = derive("Urabrask's Forge", { abilityType: "triggered", trigger: { event: "beginning-of-combat", subject: "you", control: "you" },
    actions: [{ verb: "create", object: "an X/1 red Phyrexian Horror creature token with trample and haste", amount: "1" }, { verb: "sacrifice", object: "that token" }] },
    "At the beginning of combat on your turn, put an oil counter on this artifact, then create an X/1 red Phyrexian Horror creature token with trample and haste, where X is the number of oil counters on this artifact. Sacrifice that token at the beginning of the next end step.");
  for (const a of forge) expect(a.delayedUntil).toBeUndefined();
});

// #803 (#726 loop research): what an instant or sorcery sets up happens once -- the spell is gone.
test("an instant's granted 'when this creature dies, return it' happens once; a permanent's stays repeatable (Undying Malice)", () => {
  const text = 'Until end of turn, target creature gains "When this creature dies, return it to the battlefield tapped under its owner\'s control with a +1/+1 counter on it."';
  const clauses = [
    { id: 1, abilityType: "spell", actions: [{ verb: "grant-ability", object: "that ability" }] },
    { id: 2, abilityType: "triggered", trigger: { event: "dies", subject: "this creature", control: "you" },
      actions: [{ verb: "return", object: "it", fromZone: "graveyard", toZone: "battlefield" }, { verb: "add-counter", object: "+1/+1", amount: "1" }] },
  ] as never;
  const recursion = (types: string[]) => deriveCardTags({ oracleId: "o", name: "Undying Malice", clauses,
    characteristics: { ...MINIMAL_CHARACTERISTICS, types }, clauseTexts: { 1: text, 2: "When this creature dies, return it to the battlefield tapped under its owner's control with a +1/+1 counter on it." }, oracleText: text,
  }).abilities.find((a) => a.effect.kind === "graveyard-recursion");
  expect(recursion(["instant"])?.repeats).toBe("once");
  expect(recursion(["enchantment"])?.repeats).not.toBe("once");
});

test("only the SPELL face's abilities repeat once: Bonecrusher Giant's creature trigger stays repeatable (review of #803)", () => {
  const tags = deriveCardTags({ oracleId: "o", name: "Bonecrusher Giant // Stomp",
    clauses: [
      { id: 1, abilityType: "triggered", trigger: { event: "becomes-target", subject: "this creature", control: "you" }, actions: [{ verb: "deal-damage", object: "that spell's controller", amount: "2" }] },
      { id: 2, abilityType: "spell", actions: [{ verb: "deal-damage", object: "any target", amount: "2" }] },
    ] as never,
    characteristics: { ...MINIMAL_CHARACTERISTICS, types: ["creature", "instant"], layout: "adventure",
      faces: [{ types: ["creature"], subtypes: ["giant"] }, { types: ["instant"], subtypes: ["adventure"] }] } as never,
    clauseTexts: { 1: "Whenever this creature becomes the target of a spell, this creature deals 2 damage to that spell's controller.", 2: "Stomp deals 2 damage to any target." },
    clauseFaces: { 1: 0, 2: 1 },
  });
  expect(tags.abilities.find((a) => a.kind === "triggered")?.repeats).not.toBe("once");
});

test("only the DELAYED return in a clause is delayed; an immediate return beside it is not (Gift of Immortality, Swift Warkite; review of #801)", () => {
  const gift = deriveAbilities([{ id: 1, abilityType: "triggered", trigger: { event: "dies", subject: "enchanted creature", control: "you" },
    actions: [{ verb: "return", object: "that card", fromZone: "graveyard", toZone: "battlefield" }, { verb: "return", object: "this card", fromZone: "graveyard", toZone: "battlefield" }] }],
  "Gift of Immortality", { 1: "When enchanted creature dies, return that card to the battlefield under its owner's control. Return this card to the battlefield attached to that creature at the beginning of the next end step." }).abilities
    .filter((a) => (a.emits ?? []).some((e) => e.verb === "enters"));
  expect(gift.map((a) => a.delayedUntil)).toEqual([undefined, "next-end-step"]);
  const warkite = deriveAbilities([{ id: 1, abilityType: "triggered", trigger: { event: "enters", subject: "this creature", control: "you" },
    actions: [{ verb: "put", object: "a creature card with mana value 3 or less", fromZone: "hand", toZone: "battlefield" }, { verb: "return", object: "it", toZone: "hand" }] }],
  "Swift Warkite", { 1: "When this creature enters, you may put a creature card with mana value 3 or less from your hand or graveyard onto the battlefield. That creature gains haste. Return it to your hand at the beginning of the next end step." }).abilities;
  expect(warkite.find((a) => (a.emits ?? []).some((e) => e.verb === "enters"))?.delayedUntil).toBeUndefined();
});

// #846: a mode bullet the model left without a trigger takes its header's (Hullbreaker Horror, the
// corpus clauses). Without it the bounce derived with no trigger and no repeats, and never fired.
test("a mode with no trigger of its own takes the trigger of the 'choose' header above it", () => {
  const text = "Whenever you cast a spell, choose up to one —\n• Return target spell you don't control to its owner's hand.\n• Return target nonland permanent to its owner's hand.";
  const out = deriveAbilities([
    { id: 3, abilityType: "triggered", trigger: { event: "cast", subject: "a spell", control: "you" }, actions: [{ verb: "none" }] },
    { id: 4, abilityType: "triggered", actions: [{ verb: "return", object: "target spell you don't control", fromZone: "stack", toZone: "hand", optional: true }] },
    { id: 5, abilityType: "triggered", actions: [{ verb: "return", object: "target nonland permanent", fromZone: "battlefield", toZone: "hand", optional: true }] },
  ], "Hullbreaker Horror", { 3: "Whenever you cast a spell, choose up to one —", 4: "Return target spell you don't control to its owner's hand.", 5: "Return target nonland permanent to its owner's hand." }, undefined, text).abilities;
  const bounces = out.filter((a) => a.effect.kind === "bounce");
  expect(bounces).toHaveLength(2);
  for (const b of bounces) {
    expect(b.trigger?.verbs).toEqual(["cast"]);
    expect(b.trigger?.subject).toMatchObject({ control: "you", type: "spell" });
    expect(b.repeats).toBe("repeatable");
  }
  // The header's DERIVED trigger is copied: Teval's Judgment's graveyard exit stays a graveyard exit.
  const teval = deriveAbilities([
    { id: 1, abilityType: "triggered", trigger: { event: "leaves", subject: "one or more cards", control: "you" }, actions: [{ verb: "none" }] },
    { id: 2, abilityType: "triggered", actions: [{ verb: "draw", object: "a card", amount: "1" }] },
  ], "Teval's Judgment", { 1: "Whenever one or more cards leave your graveyard, choose one that hasn't been chosen this turn —", 2: "Draw a card." },
  undefined, "Whenever one or more cards leave your graveyard, choose one that hasn't been chosen this turn —\n• Draw a card.").abilities;
  const header = teval.find((a) => a.clause === 1)!.trigger!;
  expect(header.subject.zone).toBe("graveyard");
  expect(teval.find((a) => a.effect.kind === "draw-card")?.trigger).toEqual(header);
  // A replacement bullet keeps the damage trigger it synthesizes (Rankle and Torbran's fifth mode).
  const rt = deriveAbilities([
    { id: 2, abilityType: "triggered", trigger: { event: "damage-dealt", subject: "Rankle and Torbran", control: "you" }, actions: [{ verb: "none" }] },
    { id: 5, abilityType: "triggered", actions: [{ verb: "deal-damage", object: "that much damage plus 2" }] },
  ], "Rankle and Torbran", { 2: "Whenever Rankle and Torbran deals combat damage to a player or battle, choose any number —", 5: "If a source would deal damage to a player or battle this turn, it deals that much damage plus 2 instead." }).abilities;
  expect(rt.find((a) => a.clause === 5)?.trigger?.verbs).not.toEqual(["combat-damage"]);
  // A static clause in between ends the inheritance.
  const cut = deriveAbilities([
    { id: 1, abilityType: "triggered", trigger: { event: "cast", subject: "a spell", control: "you" }, actions: [{ verb: "none" }] },
    { id: 2, abilityType: "static", actions: [{ verb: "cant", object: "be countered" }] },
    { id: 3, abilityType: "triggered", actions: [{ verb: "draw", object: "a card" }] },
  ], "X", { 1: "Whenever you cast a spell, choose one —", 2: "This spell can't be countered.", 3: "Draw a card." }, undefined, "Whenever you cast a spell, choose one —").abilities;
  expect(cut.find((a) => a.effect.kind === "draw-card")?.trigger).toBeUndefined();
});

// #860: "copy the exiled card" names the card an IMPRINT clause exiled from your hand -- a separate
// clause, so the in-clause antecedent never saw it and the copy read as a clone. Live clause shapes.
test("an imprinted card is the antecedent of 'the exiled card' in a later clause (Isochron Scepter)", () => {
  const text = "Imprint — When this artifact enters, you may exile an instant card with mana value 2 or less from your hand.\n{2}, {T}: You may copy the exiled card. If you do, you may cast the copy without paying its mana cost.";
  const out = deriveAbilities([
    { id: 1, abilityType: "triggered", trigger: { event: "enters", subject: "this artifact" }, actions: [{ verb: "exile", object: "an instant card with mana value 2 or less from your hand", fromZone: "hand", toZone: "exile", optional: true }] },
    { id: 2, abilityType: "activated", actions: [{ verb: "copy", object: "the exiled card", optional: true }, { verb: "cast", object: "the copy", optional: true }] },
  ], "Isochron Scepter", {
    1: "When this artifact enters, you may exile an instant card with mana value 2 or less from your hand.",
    2: "You may copy the exiled card. If you do, you may cast the copy without paying its mana cost.",
  }, { 2: "{2}, {T}" }, text).abilities.filter((a) => a.clause === 2);
  expect(out.map((a) => a.effect.kind)).not.toContain("clone");
  expect(out.some((a) => a.effect.kind === "copy-spell")).toBe(true);
  // "The copy" is what the COPY copied, not the nearest thing named (Surge to Victory: a creature pump
  // sits between the exile and the copy).
  const surge = deriveAbilities([
    { id: 1, abilityType: "spell", actions: [
      { verb: "exile", object: "target instant or sorcery card from your graveyard", fromZone: "graveyard", toZone: "exile" },
      { verb: "modify-pt", object: "creatures you control" },
    ] },
    { id: 2, abilityType: "triggered", trigger: { event: "damage-dealt", subject: "a creature you control dealing combat damage to a player", control: "you" },
      actions: [{ verb: "copy", object: "the exiled card" }, { verb: "cast", object: "the copy", optional: true }] },
  ], "Surge to Victory", { 1: "Exile target instant or sorcery card from your graveyard. Creatures you control get +X/+0 until end of turn, where X is that card's mana value.", 2: "Whenever a creature you control deals combat damage to a player this turn, copy the exiled card. You may cast the copy without paying its mana cost." }).abilities;
  expect(surge.filter((a) => a.clause === 2).map((a) => a.effect.kind)).not.toContain("clone");
  expect(surge.flatMap((a) => a.emits ?? []).find((e) => e.verb === "cast")?.subject.type).toEqual(["instant", "sorcery"]);
  const cast = out.flatMap((a) => a.emits ?? []).find((e) => e.verb === "cast");
  expect(cast?.subject).toMatchObject({ type: "instant", stats: [{ metric: "mana-value", op: "lte", value: 2 }] });
});

// #857: Mikaeus, the Unhallowed's undying grant lost its recipient AND its keyword. The live clause.
// Owner 2026-10-02 (Rowan): a life payment the store recorded as no action is added from the grammar,
// so Toxic Deluge's additional cost feeds a "life you lost this turn" payoff.
test("a life payment the store left out is added (Toxic Deluge)", () => {
  const out = deriveAbilities([{ id: 1, abilityType: "spell", actions: [{ verb: "none" }] }] as never, "Toxic Deluge",
    { 1: "As an additional cost to cast this spell, pay X life." }).abilities;
  expect(out.flatMap((a) => a.emits ?? []).some((e) => e.verb === "lose-life" && e.subject.control === "you")).toBe(true);
});

/** LANDWALK IS ONE KEYWORD WITH A LAND TYPE (CR 702.14): "islandwalk" is not in the keyword list
 *  by name, so 47 grants carried no keyword (Lord of Atlantis, Goblin King; S-T1, 2026-10-06). */
test("a landwalk grant names its landwalk (Lord of Atlantis)", () => {
  const lord = deriveAbilities([{ id: 1, abilityType: "static", actions: [{ verb: "modify-pt", object: "other merfolk", amount: "+1/+1" }, { verb: "grant-ability", object: "islandwalk" }] }],
    "Lord of Atlantis", { 1: "Other Merfolk get +1/+1 and have islandwalk." }).abilities.find((a) => a.effect.kind === "keyword-grant")!;
  expect(lord.grants).toEqual(["islandwalk"]);
  const gloves = deriveAbilities([{ id: 1, abilityType: "static", actions: [{ verb: "grant-ability", object: "artifact landwalk" }] }],
    "Vectis Gloves", { 1: "Equipped creature gets +2/+0 and has artifact landwalk." }).abilities.find((a) => a.effect.kind === "keyword-grant")!;
  expect(gloves.grants).toEqual(["landwalk"]);
  // A word ending in "walk" that names no land is no keyword (review of #1050).
  const side = deriveAbilities([{ id: 1, abilityType: "static", actions: [{ verb: "grant-ability", object: "\"Sidewalk\"" }] }],
    "X", { 1: "Creatures you control have \"Sidewalk\"." }).abilities.find((a) => a.effect.kind === "keyword-grant");
  expect(side?.grants ?? []).not.toContain("sidewalk");
});

test("a board-wide keyword grant keeps its recipient and names the keyword (Mikaeus, the Unhallowed)", () => {
  const out = deriveAbilities([{ id: 3, abilityType: "static", actions: [
    { verb: "modify-pt", object: "other non-Human creatures you control", amount: "+1/+1" },
    { verb: "grant-ability", object: "undying" },
  ] }], "Mikaeus, the Unhallowed", { 3: "Other non-Human creatures you control get +1/+1 and have undying." }).abilities;
  const grant = out.find((a) => a.effect.kind === "keyword-grant")!;
  expect(grant.grants).toEqual(["undying"]);
  expect(grant.effect.subject).toMatchObject({ control: "you", other: true, type: "creature", notSubtype: ["human"] });
  // Two keywords in one grant, and a word that is no keyword ability is not one.
  const lord = deriveAbilities([{ id: 1, abilityType: "static", actions: [{ verb: "grant-ability", object: "flying and first strike" }] }],
    "X", { 1: "Other Merfolk you control have flying and first strike." }).abilities.find((a) => a.effect.kind === "keyword-grant")!;
  expect(lord.grants).toEqual(["first strike", "flying"]);
  // A keyword inside a quoted ABILITY is that ability's, not a grant; a quoted keyword list is one.
  const wild = deriveAbilities([{ id: 1, abilityType: "static", actions: [{ verb: "grant-ability", object: "\"[\u22124]: Create a 4/4 green Beast creature token with trample.\"" }] }],
    "Way of the Wildspeaker", { 1: "Planeswalkers you control gain \"[\u22124]: Create a 4/4 green Beast creature token with trample.\"" }).abilities.find((a) => a.effect.kind === "keyword-grant");
  expect(wild?.grants).toBeUndefined();
  const zhulodok = deriveAbilities([{ id: 1, abilityType: "static", actions: [{ verb: "grant-ability", object: "\"Cascade, cascade.\"" }] }],
    "Zhulodok, Void Gorger", { 1: "Colorless spells you cast from your hand with mana value 7 or greater gain \"Cascade, cascade.\"" }).abilities.find((a) => a.effect.kind === "keyword-grant");
  expect(zhulodok?.grants).toEqual(["cascade"]);
  // An unhyphenated "nontoken" recipient stays refused, as before.
  const riot = deriveAbilities([{ id: 1, abilityType: "static", actions: [{ verb: "grant-ability", object: "riot" }] }],
    "Uncivil Unrest", { 1: "Nontoken creatures you control have riot." }).abilities.find((a) => a.effect.kind === "keyword-grant")!;
  expect(riot.grants).toEqual(["riot"]);
  expect(riot.effect.subject?.type).toBeUndefined();
});

// Owner 2026-10-02 (redundant keywords): a grant to the TRIGGERING object says so, so the matcher can
// see the attacker already has the keyword. A target, or the card itself, is not the trigger's object.
test("a keyword grant to the triggering object is ref: trigger (Stonehoof Chieftain)", () => {
  const grant = (name: string, subject: string, text: string) => deriveAbilities([{ id: 1, abilityType: "triggered",
    trigger: { event: "attacks", subject, control: "you" }, actions: [{ verb: "grant-ability", object: "trample" }] }],
    name, { 1: text }).abilities.find((a) => a.effect.kind === "keyword-grant")!;
  expect(grant("Stonehoof Chieftain", "another creature you control",
    "Whenever another creature you control attacks, it gains trample and indestructible until end of turn.").effect.subject?.ref).toBe("trigger");
  expect(grant("Stensian Sanguinist", "you",
    "Whenever you attack, target creature gains trample until end of turn.").effect.subject?.ref).toBeUndefined();
  expect(grant("Witch-Maw Nephilim", "this creature",
    "Whenever this creature attacks, it gains trample until end of turn.").effect.subject?.ref).toBeUndefined();
});

// #900: the pronoun after a reveal is the revealed card -- not the dying creature itself.
test("Matter Reshaper puts the revealed permanent onto the battlefield, never itself", () => {
  const reshaper = deriveAbilities(
    [{ id: 1, abilityType: "triggered", trigger: { event: "dies", subject: "this creature", control: "you" },
      actions: [{ verb: "put", object: "it", toZone: "battlefield", optional: true }] }],
    "Matter Reshaper",
    { 1: "When this creature dies, reveal the top card of your library. You may put it onto the battlefield if it's a permanent card with mana value 3 or less. Otherwise, put that card into your hand." },
  ).abilities;
  const enters = reshaper.flatMap((a) => a.emits ?? []).find((e) => e.verb === "enters");
  expect(enters?.subject).toMatchObject({ type: "permanent", fromZone: "library" });
  expect(enters?.subject.self).toBeUndefined();
});

// #896 TASK 5: THE TRIGGER GRAMMAR WINS, AND WHAT DERIVE CANNOT CHECK REFUSES (owner, 2026-10-01).
test("an intervening if or a narrowing derive cannot represent refuses the claim; one it can is claimed", () => {
  const trig = (text: string, event: string, name = "Some Card") => deriveAbilities([{
    id: 1, abilityType: "triggered", trigger: { event, subject: "x", control: "you" },
    actions: [{ verb: "draw", object: "a card", amount: "1" }],
  }], name, { 1: text });
  // Refused: "if it was kicked" and "attacks alone" are checked by nothing.
  const kicked = trig("When this creature enters, if it was kicked, draw a card.", "enters");
  expect(kicked.abilities.some((a) => a.trigger)).toBe(false);
  expect(kicked.unknownTriggers).toContain("if:enters");
  expect(trig("Whenever a creature you control attacks alone, draw a card.", "attacks").unknownTriggers).toContain("narrowing:attacks");
  // Claimed: a SOURCE-zone condition narrows no event (Inalla's eminence), CR 504.1's draw is the only
  // one Bowmasters leaves out, and a window ("this turn") is when, not which.
  expect(trig("Whenever another nontoken Wizard you control enters, if Inalla is in the command zone or on the battlefield, draw a card.", "enters", "Inalla, Archmage Ritualist").abilities[0]?.trigger?.verbs).toEqual(["enters"]);
  expect(trig("Whenever an opponent draws a card except the first one they draw in each of their draw steps, draw a card.", "draw").abilities[0]?.trigger).toMatchObject({ verbs: ["draw"], subject: { control: "opp" } });
});

test("the printed event and whose it is win over the stored ones", () => {
  // Stored as the model wrote it: event `other`, control `you`. Printed: any creature's death.
  const { abilities } = deriveAbilities([{
    id: 1, abilityType: "triggered", trigger: { event: "other", subject: "a creature", control: "you" },
    actions: [{ verb: "draw", object: "a card", amount: "1" }],
  }], "Some Card", { 1: "Whenever a creature dies, draw a card." });
  expect(abilities[0]?.trigger).toMatchObject({ verbs: ["dies"], subject: { type: "creature", control: "any" } });
});

test("CR 903.5b: Guardian Project's 'doesn't have the same name' claims, as a name the deck holds once", () => {
  const { abilities, unknownTriggers } = deriveAbilities([{
    id: 1, abilityType: "triggered", trigger: { event: "enters", subject: "a nontoken creature you control", control: "you" },
    actions: [{ verb: "draw", object: "a card", amount: "1" }],
  }], "Guardian Project", { 1: "Whenever a nontoken creature you control enters, if it doesn't have the same name as another creature you control or a creature card in your graveyard, draw a card." });
  expect(unknownTriggers).toEqual([]);
  expect(abilities[0]?.trigger?.subject).toMatchObject({ type: "creature", token: false, uniqueName: true });
});

// #731 / #896 task 6: a counter placement's subject is its printed target, not "a permanent".
test("a counter placement targets what the text targets", () => {
  const { abilities } = deriveAbilities([{ id: 1, abilityType: "spell", actions: [{ verb: "add-counter", object: "+1/+1" }] }],
    "Some Card", { 1: "Put a +1/+1 counter on target creature." });
  expect(abilities[0]?.effect).toMatchObject({ kind: "counter-placement", subject: { type: "creature", scope: "target" } });
  expect(abilities[0]?.emits?.[0]).toMatchObject({ verb: "counter-added", subject: { type: "creature", counter: "+1/+1" } });
});

// #896 task 6: the action grammar takes zone moves. The store filed Lurking Predators' "put that card
// on the bottom of your library" as a put into the GRAVEYARD, a mill that fed every graveyard payoff;
// the printed destination is the library. A stored "look at the top X" put the grammar has no
// reading for leaves every put as stored (Belisarius Cawl): two readings never align to three.
test("a zone move takes the printed destination; unequal counts of a zone verb stay as stored", () => {
  const predators = deriveAbilities(
    [{ id: 1, abilityType: "triggered", trigger: { event: "cast", subject: "a spell", control: "opp" },
      actions: [{ verb: "put", object: "it", fromZone: "library", toZone: "battlefield" }, { verb: "put", object: "that card", fromZone: "library", toZone: "graveyard", optional: true }] }],
    "Lurking Predators",
    { 1: "Whenever an opponent casts a spell, reveal the top card of your library. If it's a creature card, put it onto the battlefield. Otherwise, you may put that card on the bottom of your library." },
  ).abilities;
  expect(predators.flatMap((a) => a.emits ?? []).some((e) => e.verb === "mill")).toBe(false);

  const cawl = deriveAbilities(
    [{ id: 1, abilityType: "activated", actions: [{ verb: "put", object: "the top X cards of your library", fromZone: "library" },
      { verb: "put", object: "an artifact card", fromZone: "library", toZone: "hand", optional: true }, { verb: "put", object: "the rest", fromZone: "library", toZone: "library" }] }],
    "Belisarius Cawl",
    { 1: "Look at the top X cards of your library. You may reveal an artifact card from among them and put it into your hand. Put the rest on the bottom of your library in a random order." },
  ).abilities;
  expect(cawl.find((a) => a.effect.kind === "search")?.effect.subject?.type).toBe("artifact");
});

// A grant's object is the ability, never a thing a pronoun can mean: "That creature gains haste until
// end of turn. Sacrifice it" (Incandescent Soulstoke) sacrifices the Elemental the put brought in.
test("a pronoun's antecedent skips a grant", () => {
  const soulstoke = deriveAbilities(
    [{ id: 1, abilityType: "activated", actions: [{ verb: "put", object: "an Elemental creature card from your hand", fromZone: "hand", toZone: "battlefield", optional: true },
      { verb: "grant-ability", object: "haste" }, { verb: "sacrifice", object: "it" }] }],
    "Incandescent Soulstoke",
    { 1: "You may put an Elemental creature card from your hand onto the battlefield. That creature gains haste until end of turn. Sacrifice it at the beginning of the next end step." },
  ).abilities;
  expect(soulstoke.flatMap((a) => a.emits ?? []).find((e) => e.verb === "sacrifice")?.subject.subtype).toBe("elemental");
});

/** CR 110.2a: AN OBJECT PUT ONTO THE BATTLEFIELD ENTERS UNDER THE CONTROL OF WHOEVER PUT IT (#963).
 *  Nissa, Leyline Tamer's stored clause has two puts -- the creature to the battlefield, the rest to
 *  the library -- so the single-actor cue refused and the creature read `any`. No player is named, so
 *  you put it. A named putter ("the player puts", Proteus Staff) is not this rule's. */
test("a put onto the battlefield with no player named enters under your control", () => {
  const text = "Draw a card. Then if this is the first time this ability has resolved this turn, reveal cards from the top of your library until you reveal a creature card. Put that card onto the battlefield and the rest on the bottom of your library in a random order.";
  const { abilities } = deriveAbilities([{ id: 2, abilityType: "triggered", trigger: { event: "enters", subject: "a land you control", control: "you" }, actions: [
    { verb: "draw", object: "a card", fromZone: null, toZone: null, amount: "1", optional: false },
    { verb: "put", object: "that creature card", fromZone: "library", toZone: "battlefield", amount: null, optional: false },
    { verb: "put", object: "the rest", fromZone: "library", toZone: "library", amount: null, optional: false },
  ] }], "Nissa, Leyline Tamer", { 2: text }, {}, `Deathtouch, vigilance\nLandfall — Whenever a land you control enters, ${text.charAt(0).toLowerCase()}${text.slice(1)}`);
  expect(abilities.flatMap((a) => a.emits ?? []).find((e) => e.verb === "enters")?.subject.control).toBe("you");
});

// #697: a draw with no player named is the controller's (CR 608.2c), even in a sentence that names an
// opponent elsewhere; a draw that names its player keeps that player.
test("an unnamed draw is yours; a named one is the player it names", () => {
  const draw = (text: string, abilityType: "spell" | "triggered" = "spell") => deriveAbilities([{
    id: 1, abilityType, ...(abilityType === "triggered" ? { trigger: { event: "cast", subject: "a spell", control: "opponent" } } : {}),
    actions: [{ verb: "draw", object: "a card", amount: "1" }],
  }], "Some Card", { 1: text }).abilities.flatMap((a) => a.emits ?? []).find((e) => e.verb === "draw")?.subject.control;
  expect(draw("Draw a card if an opponent has cast a blue or black spell this turn.")).toBe("you");
  expect(draw("Whenever an opponent casts their first noncreature spell each turn, draw a card unless that player pays {X}.", "triggered")).toBe("you");
  expect(draw("Each player draws a card.")).toBe("any");
  expect(draw("Target opponent draws a card.")).toBe("opp");
});

// #797: a god is a creature only under its devotion condition, read by the action grammar.
test("a card whose own static says it isn't a creature under a condition is marked creatureOnlyIf", () => {
  const god = (text: string, types = ["legendary", "enchantment", "creature"]) => deriveCardTags({
    oracleId: "god", name: "Purphoros, God of the Forge",
    clauses: [{ id: 1, abilityType: "static", actions: [{ verb: "cant", object: "be a creature" }] }],
    characteristics: { ...MINIMAL_CHARACTERISTICS, types },
    clauseTexts: { 1: text },
  }).characteristics.creatureOnlyIf;
  expect(god("As long as your devotion to red is less than five, Purphoros isn't a creature.")).toBe(true);
  // Not a creature in the first place: nothing to mark.
  expect(god("As long as your devotion to red is less than five, Purphoros isn't a creature.", ["enchantment"])).toBeUndefined();
  expect(god("Purphoros can't block.")).toBeUndefined();
});

// A CURSE'S ENCHANTED PLAYER IS AN OPPONENT (owner 2026-10-07, persona round 2026-10-07): Maddening
// Hex's "Whenever enchanted player casts a noncreature spell" was refused as a narrowing
// (`narrowing:cast`, one player the matcher cannot pick out), so its damage had no trigger at all.
// On a Curse that player is an opponent; on any other Aura the refusal stands.
test("a Curse reads its enchanted player as an opponent, and keeps the trigger", () => {
  const input = (subtypes: string[]) => ({
    oracleId: "hex",
    clauses: [{ id: 2, abilityType: "triggered" as const, trigger: { event: "cast", subject: "a noncreature spell", control: "opponent" },
      actions: [{ verb: "deal-damage", object: "that player", amount: "the result" }] }],
    characteristics: { ...MINIMAL_CHARACTERISTICS, types: ["enchantment"], subtypes },
    clauseTexts: { 2: "Whenever enchanted player casts a noncreature spell, roll a d6. This Aura deals damage to that player equal to the result." },
    oracleText: "Enchant player\nWhenever enchanted player casts a noncreature spell, roll a d6. This Aura deals damage to that player equal to the result. Then attach this Aura to another one of your opponents chosen at random.",
  });
  const curse = deriveCardTags(input(["aura", "curse"]) as never);
  const damage = curse.abilities.find((a) => a.effect?.kind === "damage")!;
  expect(damage.trigger?.verbs).toEqual(["cast"]);
  expect(damage.trigger?.subject.control).toBe("opp");
  expect(curse.unknownTriggers ?? []).not.toContain("narrowing:cast");
  const aura = deriveCardTags(input(["aura"]) as never);
  expect(aura.unknownTriggers).toContain("narrowing:cast");
});

// A SPEED GRANT CARRIES ITS KEYWORDS (#1079): Chocobo Knights' "creatures you control with counters on
// them gain double strike" is the `speed-increase` kind, and only `keyword-grant` recorded `grants`,
// so the sentence could only say "grants haste".
test("a speed grant records which keyword it grants", () => {
  const tags = deriveCardTags({
    oracleId: "chocobo",
    clauses: [{ id: 1, abilityType: "triggered", trigger: { event: "attacks", subject: "you", control: "you" },
      actions: [{ verb: "grant-ability", object: "creatures you control with counters on them gain double strike until end of turn" }] }],
    characteristics: MINIMAL_CHARACTERISTICS,
    clauseTexts: { 1: "Whenever you attack, creatures you control with counters on them gain double strike until end of turn." },
  } as never);
  const speed = tags.abilities.find((a) => a.effect?.kind === "speed-increase")!;
  expect(speed.grants).toEqual(["double strike"]);
});

// A DOUBLE-STRIKE GRANT READ AS THE VERB `double` STILL RECORDS WHAT IT GRANTS (#1141): the normalizer
// filed Akim's "gain double strike" as a `double` action, effect-kind answers speed-increase, and with
// no `grants` the sentence says "grants haste" (the #1079 defect) and the edge defaults to haste.
test("a double-strike grant read as the verb double records its keywords", () => {
  const speedOf = (text: string, object: string) => deriveCardTags({
    oracleId: "doubled",
    clauses: [{ id: 1, abilityType: "activated", actions: [{ verb: "double", object }] }],
    characteristics: MINIMAL_CHARACTERISTICS,
    clauseTexts: { 1: text },
  } as never).abilities.find((a) => a.effect?.kind === "speed-increase");
  expect(speedOf("{3}{U}{R}{W}: Creature tokens you control gain double strike until end of turn.", "Creature tokens you control")?.grants)
    .toEqual(["double strike"]);
  expect(speedOf("Amass Orcs X, then Goblins and Orcs you control gain double strike and haste until end of turn.", "Goblins and Orcs you control")?.grants)
    .toEqual(["double strike", "haste"]);
});

// AND WHEN THE SAME CLAUSE ALSO CARRIES A GRANT-ABILITY ACTION (review of 6194cb57): Assault on
// Osgiliath's stored clause is `double` + `grant-ability` (haste), and the grant-ability branch alone
// recorded ["haste"], losing the double strike the clause prints.
test("a clause with both a double and a grant-ability action records every speed keyword it prints", () => {
  const ability = deriveCardTags({
    oracleId: "assault",
    clauses: [{ id: 1, abilityType: "spell", actions: [{ verb: "double", object: "Goblins and Orcs you control" }, { verb: "grant-ability", object: "haste" }] }],
    characteristics: MINIMAL_CHARACTERISTICS,
    clauseTexts: { 1: "Amass Orcs X, then Goblins and Orcs you control gain double strike and haste until end of turn." },
  } as never).abilities.find((a) => a.effect?.kind === "speed-increase");
  expect([...(ability?.grants ?? [])].sort()).toEqual(["double strike", "haste"]);
});

// "IF IT WAS A CREATURE" ON A SELF DIES TRIGGER IS REPRESENTED (#1250). Enduring Curiosity's intervening if was refused
// (`if:dies`), which left the recursion a TRIGGERLESS triggered ability: "return it" read as `ref: "trigger"` over
// `control: any`, so another card's graveyard fill (Smoke Bomb sacrificing itself) fed it. Oracle text as printed.
test("an Enduring card's self dies trigger survives 'if it was a creature', and its return is the card itself", () => {
  const text = "When Enduring Curiosity dies, if it was a creature, return it to the battlefield under its owner's control. It's an enchantment. (It's not a creature.)";
  const { abilities, unknownTriggers } = deriveAbilities([{
    id: 3, abilityType: "triggered", trigger: { event: "dies", subject: "Enduring Curiosity", control: "you" },
    actions: [
      { verb: "return", object: "it", fromZone: "graveyard", toZone: "battlefield" },
      { verb: "animate", object: "it" },
    ],
  }], "Enduring Curiosity", { 3: text }, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, true);
  expect(unknownTriggers ?? []).toEqual([]);
  const recursion = abilities.find((a) => a.effect.kind === "graveyard-recursion")!;
  expect(recursion.trigger?.verbs).toContain("dies");
  expect(recursion.trigger?.subject.self).toBe(true);
  expect(recursion.effect.subject?.self).toBe(true);
});

// ...BUT NOT ON A CARD THAT IS ONLY SOMETIMES A CREATURE (#1250 review). Weatherseed Totem is an Artifact, a creature only once
// animated, so "if it was a creature" is a real condition (CR 603.4): the trigger stays refused rather than claim every artifact death.
test("Weatherseed Totem's 'if it was a creature' dies trigger stays refused", () => {
  const text = "When this artifact is put into a graveyard from the battlefield, if it was a creature, return this card to its owner's hand.";
  const { abilities, unknownTriggers } = deriveAbilities([{
    id: 3, abilityType: "triggered", trigger: { event: "dies", subject: "this artifact", control: "you" },
    actions: [{ verb: "return", object: "this card", fromZone: "graveyard", toZone: "hand" }],
  }], "Weatherseed Totem", { 3: text }, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, false);
  expect(unknownTriggers).toContain("if:dies");
  expect(abilities.some((a) => a.trigger?.verbs.includes("dies"))).toBe(false);
});

test("a refusal that read only timing or a count keeps the exact class and the claim: not flagged (Squall, Cunning Evasion)", () => {
  // "a creature you control attacks alone, it gains double strike": the object is still a creature you control.
  const t1 = "Whenever a creature you control attacks alone, it gains double strike until end of turn.";
  const sq = deriveAbilities(
    [{ id: 1, abilityType: "triggered", trigger: { event: "attacks", subject: "a creature you control", control: "you" },
      actions: [{ verb: "double", object: "it", fromZone: null, toZone: null, amount: null, optional: false }] }],
    "Squall, SeeD Mercenary", { 1: t1 }, undefined, t1);
  expect(sq.unknownTriggers).toContain("narrowing:attacks");
  expect(sq.abilities.length).toBeGreaterThan(0);
  expect(sq.abilities.every((a) => a.trigger === undefined && a.claimsNothing === undefined)).toBe(true);
  expect(sq.abilities.flatMap((a) => a.emits ?? []).every((e) => e.subject.ref === "trigger" && e.subject.type === "creature")).toBe(true);
  // becomes blocked (#1375: now a live trigger): "return it" is a creature you control.
  const { abilities } = deriveAbilities(
    [{ id: 1, abilityType: "triggered", trigger: { event: "becomes-blocked", subject: "a creature you control", control: "you" },
      actions: [{ verb: "return", object: "it", fromZone: "battlefield", toZone: "hand", amount: null, optional: true }] }],
    "Cunning Evasion",
    { 1: "Whenever a creature you control becomes blocked, you may return it to its owner's hand." },
  );
  // #1375: `becomes-blocked` is a verb, so the trigger is LIVE and bounds the 'it' (a ref to the trigger over a creature you control) instead of a refused trigger leaving it loose.
  expect(abilities.every((a) => a.trigger?.verbs[0] === "becomes-blocked" && a.claimsNothing === undefined)).toBe(true);
  expect(abilities.flatMap((a) => a.emits ?? []).every((e) => e.subject.ref === "trigger" && e.subject.type === "creature")).toBe(true);
});

test("an `if:` refusal flags a typed object: Koll's 'if it was enchanted or equipped' return", () => {
  const t = "Whenever another nontoken creature you control dies, if it was enchanted or equipped, return it to its owner's hand.";
  const { abilities, unknownTriggers } = deriveAbilities(
    [{ id: 1, abilityType: "triggered", trigger: { event: "dies", subject: "another nontoken creature you control", control: "you" },
      actions: [{ verb: "return", object: "it", fromZone: "graveyard", toZone: "hand", amount: null, optional: false }] }],
    "Koll, the Forgemaster", { 1: t }, undefined, t);
  expect(unknownTriggers.some((u) => u.startsWith("if:"))).toBe(true);
  expect(abilities.length).toBeGreaterThan(0);
  expect(abilities.every((a) => a.trigger === undefined && a.claimsNothing === "refused-trigger")).toBe(true);
});

test("a refused 'deals damage to you' destroys an OPPONENT's creature (No Mercy), and is not flagged", () => {
  const t = "Whenever a creature deals damage to you, destroy it.";
  const { abilities, unknownTriggers } = deriveAbilities(
    [{ id: 1, abilityType: "triggered", trigger: { event: "damage-dealt", subject: "a creature", control: "opponent" },
      actions: [{ verb: "destroy", object: "it", fromZone: null, toZone: null, amount: null, optional: false }] }],
    "No Mercy", { 1: t }, undefined, t);
  expect(unknownTriggers).toContain("narrowing:damage-dealt");
  const emits = abilities.flatMap((a) => a.emits ?? []);
  expect(emits.length).toBeGreaterThan(0);
  for (const e of emits) { expect(e.subject.control).toBe("opp"); expect(e.subject.type).toBe("creature"); }
  expect(abilities.every((a) => a.claimsNothing === undefined)).toBe(true);
});

test("a trigger about THIS card makes its 'it' the card itself (#1253, Goblin Cadets' becomes-blocked half)", () => {
  // #1375: `becomes-blocked` is an engine verb, so the trigger derives and the 'it' is the card itself through the self subject.
  const text = "Whenever this creature becomes blocked, target opponent gains control of it. (This removes this creature from combat.)";
  const { abilities, unknownTriggers } = deriveAbilities(
    [{ id: 1, abilityType: "triggered", trigger: { event: "becomes-blocked", subject: "this creature", control: "you" },
      actions: [{ verb: "gain-control", object: "it", fromZone: null, toZone: null, amount: null, optional: false }] }],
    "Goblin Cadets",
    { 1: text },
  );
  expect(unknownTriggers ?? []).not.toContain("becomes-blocked");
  expect(abilities.length).toBeGreaterThan(0);
  for (const a of abilities) {
    expect(a.trigger?.verbs).toEqual(["becomes-blocked"]);
    expect(a.trigger?.subject.self).toBe(true);
    expect(a.claimsNothing).toBeUndefined();
    // The live self trigger bounds the 'it': a ref to the trigger, whose subject is the card itself.
    for (const e of a.emits ?? []) expect(e.subject.ref).toBe("trigger");
  }
});

test("a STILL-refused trigger about THIS card makes its 'it' the card itself, and withdraws nothing (#1253, Tar Pit Warrior; `becomes-target` has no engine verb)", () => {
  const text = "When this creature becomes the target of a spell or ability, sacrifice it.";
  const { abilities, unknownTriggers } = deriveAbilities(
    [{ id: 1, abilityType: "triggered", trigger: { event: "becomes-target", subject: "this creature", control: "you" },
      actions: [{ verb: "sacrifice", object: "it", fromZone: null, toZone: null, amount: null, optional: false }] }],
    "Tar Pit Warrior",
    { 1: text },
  );
  expect(unknownTriggers).toContain("becomes-target");
  const emits = abilities.flatMap((a) => a.emits ?? []);
  expect(emits.length).toBeGreaterThan(0);
  for (const a of abilities) { expect(a.trigger).toBeUndefined(); expect(a.claimsNothing).toBeUndefined(); }
  for (const e of emits) { expect(e.subject.self).toBe(true); expect(e.subject.ref).toBeUndefined(); }
});

// #1375 review: Mirror Shield's granted "Whenever a creature with deathtouch blocks or becomes blocked BY THIS CREATURE": the watched creature is the opposing one and "this creature" is the blocker.
// The stored clause 3 reads `becomes-blocked` with subject "this creature", which would be a live self trigger on an Equipment. The trigger is refused instead.
test("Mirror Shield's 'becomes blocked by this creature' is refused, never a live self trigger (#1375)", () => {
  const text = "Equipped creature gets +0/+2 and has hexproof and \"Whenever a creature with deathtouch blocks or becomes blocked by this creature, destroy that creature.\"\nEquip {2} ({2}: Attach to target creature you control. Equip only as a sorcery.)";
  const stored = [
    { id: 1, abilityType: "static", actions: [{ verb: "modify-pt", object: "equipped creature", amount: "+0/+2" }, { verb: "grant-ability", object: "hexproof" }] },
    { id: 2, abilityType: "triggered", trigger: { event: "blocks", subject: "a creature with deathtouch", control: "any" }, actions: [{ verb: "destroy", object: "that creature" }] },
    { id: 3, abilityType: "triggered", trigger: { event: "becomes-blocked", subject: "this creature", control: "you" }, actions: [{ verb: "destroy", object: "a creature with deathtouch blocking this creature" }] },
    { id: 3, abilityType: "none", actions: [{ verb: "none", object: "Equip {2}" }] },
  ] as never;
  const card = { name: "Mirror Shield", typeLine: "Artifact — Equipment", oracleText: text, keywords: [] as string[] };
  const g = grammarClauseRecords(card as never);
  for (const [path, records] of [["model", stored], ["grammar", g.records]] as const) {
    const tags = deriveCardTags(deriveInputOf(card as never, "x", card.name, records as never, undefined, path === "grammar" ? g.readings : undefined));
    const live = tags.abilities.filter((a) => a.trigger?.verbs?.includes("becomes-blocked" as never));
    expect(live, path).toHaveLength(0);
    expect(tags.unknownTriggers ?? [], path).not.toEqual([]);
    if (path === "model") expect(tags.unknownTriggers).toContain("blocked-by-self"); // the grammar path refuses the same phrase as a narrowing
  }
});

// #1381: "becomes blocked by <creatures>" carries the blocker (oracle text from the corpus, 2026-10-27).
describe("becomes blocked by <creatures> (#1381, CR 509.3c-e)", () => {
  const viaGrammar = (name: string, typeLine: string, oracleText: string) => {
    const card = { name, typeLine, oracleText, keywords: [] as string[] };
    const g = grammarClauseRecords(card as never);
    return deriveCardTags(deriveInputOf(card as never, "x", name, g.records, undefined, g.readings));
  };
  const blocked = (tags: ReturnType<typeof viaGrammar>) => tags.abilities.filter((a) => a.trigger?.verbs?.includes("becomes-blocked" as never));

  test("Ogre Leadfoot: by an artifact creature, once per blocker", () => {
    const tags = viaGrammar("Ogre Leadfoot", "Creature — Ogre Soldier", "Whenever this creature becomes blocked by an artifact creature, destroy that creature.");
    const [t] = blocked(tags);
    expect(t!.trigger!.blocker).toMatchObject({ type: expect.arrayContaining(["creature", "artifact"]) });
    expect(t!.trigger!.batched).toBeUndefined();
    expect(t!.trigger!.subject.self).toBe(true);
    expect(t!.repeats).toBe("repeatable");
    expect(tags.unknownTriggers ?? []).not.toContain("narrowing:becomes-blocked");
  });

  test("Serra Inquisitors: by one or more black creatures is batched, once a combat", () => {
    const tags = viaGrammar("Serra Inquisitors", "Creature — Human Cleric", "Whenever this creature blocks or becomes blocked by one or more black creatures, this creature gets +2/+0 until end of turn.");
    const [t] = blocked(tags);
    expect(t!.trigger!.blocker).toMatchObject({ type: "creature", colors: ["B"] });
    expect(t!.trigger!.batched).toBe(true);
    expect(t!.repeats).toBe("per-cycle");
    // The blocks half is out of scope: it keeps refusing the class.
    expect(tags.unknownTriggers).toContain("narrowing:blocks");
    expect(tags.unknownTriggers ?? []).not.toContain("narrowing:becomes-blocked");
  });

  test("Engulfing Slagwurm: by a creature is {type: creature}, once per blocker, and the blocks half still derives", () => {
    const tags = viaGrammar("Engulfing Slagwurm", "Creature — Wurm", "Whenever this creature blocks or becomes blocked by a creature, destroy that creature. You gain life equal to that creature's toughness.");
    const [t] = blocked(tags);
    expect(t!.trigger!.blocker).toEqual({ control: "any", token: null, type: "creature" });
    expect(t!.trigger!.batched).toBeUndefined();
    expect(t!.repeats).toBe("repeatable");
    expect(tags.abilities.some((a) => a.trigger?.verbs?.includes("blocks" as never) && a.trigger.blocker === undefined)).toBe(true);
    expect(tags.unknownTriggers ?? []).toEqual([]);
  });

  test("Cockatrice: the blocks half stays its OWN refused ability beside the live becomes-blocked half", () => {
    const tags = viaGrammar("Cockatrice", "Creature — Cockatrice", "Flying\nWhenever this creature blocks or becomes blocked by a non-Wall creature, destroy that creature at end of combat.");
    const [t] = blocked(tags);
    expect(t!.trigger!.blocker).toMatchObject({ type: "creature", notSubtype: ["wall"] });
    const dies = tags.abilities.filter((a) => a.emits?.some((e) => e.verb === "dies"));
    expect(dies).toHaveLength(2);
    const half = dies.find((a) => a !== t)!;
    expect(half.trigger).toBeUndefined();
    expect(half.claimsNothing).toBeUndefined(); // as at 396: no `ref: trigger` in its emits, so no claimsNothing
    expect(tags.unknownTriggers).toEqual(["narrowing:blocks"]);
  });

  test("Hezrou: a plain 'one or more creatures you control become blocked' stays batched (no blocker)", () => {
    const [t] = blocked(viaGrammar("Test Hezrou", "Creature — Demon", "Whenever one or more creatures you control become blocked, each blocking creature gets -1/-1 until end of turn."));
    expect(t!.trigger!.batched).toBe(true);
    expect(t!.trigger!.blocker).toBeUndefined();
  });

  test("a batched SUBJECT and a 'by' phrase on one trigger is refused: grammar path, and the stored branch (no printed trigger word)", () => {
    const text = "Whenever one or more creatures you control become blocked by a creature, draw a card.";
    const tags = viaGrammar("Test Witness", "Enchantment", text);
    expect(blocked(tags)).toHaveLength(0);
    expect(tags.unknownTriggers).toContain("narrowing:becomes-blocked");
    // The stored branch is reached only when the grammar reads no preamble: with no printed "Whenever" the model's record is what derives.
    const bare = "One or more creatures you control become blocked by a creature, draw a card.";
    const card = { name: "Test Witness", typeLine: "Enchantment", oracleText: bare, keywords: [] as string[] };
    const stored = [{ id: 1, abilityType: "triggered", trigger: { event: "becomes-blocked", subject: "one or more creatures you control", control: "you" }, actions: [{ verb: "draw", object: "a card" }] }] as never;
    const viaStored = deriveCardTags(deriveInputOf(card as never, "x", card.name, stored, undefined, undefined));
    expect(blocked(viaStored)).toHaveLength(0);
    expect(viaStored.unknownTriggers).toContain("narrowing:becomes-blocked");
  });

  test("a plain 'becomes blocked' has no blocker and stays once a round", () => {
    const [t] = blocked(viaGrammar("Test Charger", "Creature — Elephant", "Whenever this creature becomes blocked, it gets +2/+2 until end of turn."));
    expect(t!.trigger!.blocker).toBeUndefined();
    expect(t!.repeats).toBe("per-cycle");
  });

  test("a blocker phrase with a negated card type is read in full (Catacomb Dragon: 'a nonartifact, non-Dragon creature', #1383)", () => {
    const tags = viaGrammar("Catacomb Dragon", "Creature — Dragon", "Flying\nWhenever this creature becomes blocked by a nonartifact, non-Dragon creature, that creature gets -X/-0 until end of turn, where X is half the creature's power, rounded down.");
    expect(blocked(tags)).toHaveLength(1);
    expect(blocked(tags)[0]!.trigger!.blocker).toMatchObject({ type: "creature", notType: ["artifact"], notSubtype: ["dragon"] });
    expect(tags.unknownTriggers ?? []).not.toContain("narrowing:becomes-blocked");
  });

  test("readBlocker's guard counts only notType / notSubtype / notColors: a legendary or token negation (carried by parse as legendary:false / token:false) still refuses", () => {
    const tags = viaGrammar("Test Charger", "Creature — Ogre", "Whenever this creature becomes blocked by a nonlegendary creature, destroy that creature.");
    expect(blocked(tags)).toHaveLength(0);
    expect(tags.unknownTriggers).toContain("narrowing:becomes-blocked");
  });

  test("the STORED branch (no printed trigger word, so the grammar reads nothing) sets the blocker off the printed phrase, once per blocker, and refuses an unreadable one", () => {
    const mk = (name: string, oracleText: string) => {
      const card = { name, typeLine: "Creature — Ogre Soldier", oracleText, keywords: [] as string[] };
      const stored = [{ id: 1, abilityType: "triggered", trigger: { event: "becomes-blocked", subject: "this creature", control: "you" }, actions: [{ verb: "destroy", object: "that creature" }] }] as never;
      return deriveCardTags(deriveInputOf(card as never, "x", name, stored, undefined, undefined));
    };
    const tags = mk("Ogre Leadfoot", "This creature becomes blocked by an artifact creature, destroy that creature.");
    const [t] = blocked(tags);
    expect(t!.trigger!.blocker).toMatchObject({ type: expect.arrayContaining(["creature", "artifact"]) });
    expect(t!.trigger!.batched).toBeUndefined();
    expect(t!.repeats).toBe("repeatable");
    const bad = mk("X", "This creature becomes blocked by a creature with lesser power, destroy that creature.");
    expect(blocked(bad)).toHaveLength(0);
    expect(bad.unknownTriggers).toContain("narrowing:becomes-blocked");
  });
});

test("Goblin Cadets' 'blocks or becomes blocked' derives BOTH halves as live self triggers (#1373, #1375)", () => {
  const text = "Whenever this creature blocks or becomes blocked, target opponent gains control of it. (This removes this creature from combat.)";
  const { abilities, unknownTriggers } = deriveAbilities(
    [{ id: 1, abilityType: "triggered", trigger: { event: "becomes-blocked", subject: "this creature", control: "you" },
      actions: [{ verb: "gain-control", object: "it", fromZone: null, toZone: null, amount: null, optional: false }] }],
    "Goblin Cadets",
    { 1: text },
  );
  expect(unknownTriggers ?? []).not.toContain("becomes-blocked");
  for (const verb of ["blocks", "becomes-blocked"]) {
    const live = abilities.filter((a) => a.trigger?.verbs.includes(verb as never));
    expect(live, verb).toHaveLength(1);
    expect(live[0]!.trigger!.subject.self, verb).toBe(true);
  }
});

test("a pure 'Whenever this creature becomes blocked' card derives a self becomes-blocked trigger (#1375)", () => {
  const card = { name: "Test Charger", typeLine: "Creature — Elephant", oracleText: "Whenever this creature becomes blocked, it gets +2/+2 until end of turn.", keywords: [] as string[] };
  const g = grammarClauseRecords(card as never);
  const tags = deriveCardTags(deriveInputOf(card as never, "x", card.name, g.records, undefined, g.readings));
  const t = tags.abilities.find((a) => a.trigger?.verbs?.includes("becomes-blocked" as never));
  expect(t).toBeDefined();
  expect(t!.trigger!.subject.self).toBe(true);
  expect(t!.trigger!.subject.type).toBe("creature");
  expect(tags.unknownTriggers ?? []).not.toContain("becomes-blocked");
});

test("Sacred Ground's returned land is YOURS: control you, not the opponent whose spell caused it (#1253)", () => {
  const t = "Whenever a spell or ability an opponent controls causes a land to be put into your graveyard from the battlefield, return that card to the battlefield.";
  const g = grammarClauseRecords({ name: "Sacred Ground", oracleText: t, typeLine: "Enchantment", manaCost: "{1}{W}", keywords: [] } as never);
  const { abilities } = deriveAbilities(g.records, "Sacred Ground", { 1: t }, undefined, t);
  const emits = abilities.flatMap((a) => a.emits ?? []);
  expect(emits.length).toBeGreaterThan(0);
  for (const e of emits) { expect(e.subject.control).toBe("you"); expect(e.subject.type).toBe("land"); }
});

// A REFUSED TRIGGER WITH NO CLASS LEFT CLAIMS NOTHING (#1253, owner ruling). Pure Intentions' "return THOSE
// CARDS": the trigger subject ("cards") names no class either, so the ref'd emit is every card in any
// graveyard. The ability keeps its kind and effect kind and is marked; a sibling the grammar DID read is not.
test("a refused trigger whose object has no class anywhere is flagged claimsNothing; a read sibling is not", () => {
  const t1 = "Whenever a spell or ability an opponent controls causes you to discard cards this turn, return those cards from your graveyard to your hand.";
  const t2 = "When a spell or ability an opponent controls causes you to discard this card, return this card from your graveyard to your hand.";
  const { abilities, unknownTriggers } = deriveAbilities(
    [
      { id: 1, abilityType: "triggered", trigger: { event: "discarded", subject: "cards", control: "you" },
        actions: [{ verb: "return", object: "those cards", fromZone: "graveyard", toZone: "hand", amount: null, optional: false }] },
      { id: 2, abilityType: "triggered", trigger: { event: "dies", subject: "Pure Intentions", control: "you" },
        actions: [{ verb: "draw", object: "a card", fromZone: null, toZone: null, amount: "1", optional: false }] },
    ],
    "Pure Intentions", { 1: t1, 2: "When Pure Intentions dies, draw a card." }, undefined, `${t1}\n${t2}`);
  expect(unknownTriggers.length).toBeGreaterThan(0);
  const refused = abilities.filter((a) => a.clause === 1);
  expect(refused.length).toBeGreaterThan(0);
  for (const a of refused) { expect(a.trigger).toBeUndefined(); expect(a.kind).toBe("triggered"); expect(a.claimsNothing).toBe("refused-trigger"); }
  expect(refused[0]!.effect.kind).toBe("graveyard-recursion");
  expect(abilities.filter((a) => a.clause === 2).every((a) => a.claimsNothing === undefined)).toBe(true);
});

test("the refused trigger's class is copied onto 'it gains X': Battlegrace Angel's creature you control, not flagged", () => {
  const t = "Whenever a creature you control attacks alone, it gains lifelink until end of turn.";
  const { abilities, unknownTriggers } = deriveAbilities(
    [{ id: 1, abilityType: "triggered", trigger: { event: "attacks", subject: "a creature you control", control: "you" },
      actions: [{ verb: "grant-ability", object: "lifelink", fromZone: null, toZone: null, amount: null, optional: false }] }],
    "Battlegrace Angel", { 1: t }, undefined, t);
  expect(unknownTriggers).toContain("narrowing:attacks");
  const grant = abilities.find((a) => a.effect.kind === "keyword-grant")!;
  expect(grant.effect.subject).toMatchObject({ ref: "trigger", type: "creature" });
  expect(abilities.every((a) => a.claimsNothing === undefined)).toBe(true);
});

test("an `if:` flags only when it tests the object: Captain America's first-time count and Scytheclaw Raptor's turn do not", () => {
  const cap = "Whenever a creature you control becomes tapped during your turn, if it's the first time that creature has become tapped this turn, untap it.";
  const a = deriveAbilities(
    [{ id: 1, abilityType: "triggered", trigger: { event: "taps", subject: "a creature you control", control: "you" },
      actions: [{ verb: "untap", object: "it", fromZone: null, toZone: null, amount: null, optional: false }] }],
    "Captain America, Living Legend", { 1: cap }, undefined, cap);
  expect(a.unknownTriggers.some((u) => u.startsWith("if:"))).toBe(true);
  expect(a.abilities.every((x) => x.claimsNothing === undefined)).toBe(true);
  // "them" is the player who cast, not the spell: no ref, a player.
  const raptor = "Whenever a player casts a spell, if it's not their turn, this creature deals 4 damage to them.";
  const r = deriveAbilities(
    [{ id: 1, abilityType: "triggered", trigger: { event: "cast", subject: "a spell", control: "any" },
      actions: [{ verb: "deal-damage", object: "them", fromZone: null, toZone: null, amount: "4", optional: false }] }],
    "Scytheclaw Raptor", { 1: raptor }, undefined, raptor);
  const dmg = r.abilities.flatMap((x) => x.emits ?? []);
  expect(dmg.length).toBeGreaterThan(0);
  for (const e of dmg) { expect(e.subject.ref).toBeUndefined(); expect(e.subject.type).toBeUndefined(); }
  expect(r.abilities.every((x) => x.claimsNothing === undefined)).toBe(true);
});

test("'if this card is exiled, put it onto the battlefield' returns the card itself, not the attacker (Senu)", () => {
  const t = "When a legendary creature you control attacks and isn't blocked, if this card is exiled, put it onto the battlefield attacking.";
  const { abilities } = deriveAbilities(
    [{ id: 1, abilityType: "triggered", trigger: { event: "attacks", subject: "a legendary creature you control", control: "you" },
      actions: [{ verb: "put", object: "it", fromZone: "exile", toZone: "battlefield", amount: null, optional: false }] }],
    "Senu, Keen-Eyed Protector", { 1: t }, undefined, t);
  const emits = abilities.flatMap((a) => a.emits ?? []);
  expect(emits.length).toBeGreaterThan(0);
  for (const e of emits) { expect(e.subject.self).toBe(true); expect(e.subject.ref).toBeUndefined(); }
  expect(abilities.find((a) => a.effect.kind === "flicker")?.effect.subject?.self).toBe(true);
});

test("Sacred Ground's recursion takes the returned land's class: type land, control you (no longer any card in any graveyard)", () => {
  const t = "Whenever a spell or ability an opponent controls causes a land to be put into your graveyard from the battlefield, return that card to the battlefield.";
  const g = grammarClauseRecords({ name: "Sacred Ground", oracleText: t, typeLine: "Enchantment", manaCost: "{1}{W}", keywords: [] } as never);
  const { abilities } = deriveAbilities(g.records, "Sacred Ground", { 1: t }, undefined, t);
  const rec = abilities.find((a) => a.effect.kind === "graveyard-recursion")!;
  expect(rec.effect.subject).toMatchObject({ type: "land", control: "you", zone: "graveyard", fromZone: "battlefield" });
});

test("'in your graveyard' is YOUR graveyard, as 'from your graveyard' (Victimize, corpus text and stored clause)", () => {
  const t = "Choose two target creature cards in your graveyard. Sacrifice a creature. If you do, return the chosen cards to the battlefield tapped.";
  const { abilities } = deriveAbilities(
    [{ id: 1, abilityType: "spell", actions: [
      { verb: "sacrifice", object: "a creature", fromZone: null, toZone: null, amount: null, optional: false },
      { verb: "return", object: "the chosen cards", fromZone: "graveyard", toZone: "battlefield", amount: null, optional: true },
      { verb: "tap", object: "the chosen cards", fromZone: null, toZone: null, amount: null, optional: false }] }],
    "Victimize", { 1: t }, undefined, t);
  const rec = abilities.find((a) => a.effect.kind === "graveyard-recursion")!;
  expect(rec.effect.subject?.control).toBe("you");
});

test("'in your graveyard' is read off the ACTION's object first: Neyam Shai Murad's 'their graveyard' is not yours", () => {
  const t = "Whenever Neyam Shai Murad deals combat damage to a player, you may have that player return target permanent card from their graveyard to their hand. If you do, that player chooses a permanent card in your graveyard, then you put it onto the battlefield under your control.";
  const { abilities } = deriveAbilities(
    [{ id: 1, abilityType: "triggered", trigger: { event: "damage-dealt", subject: "Neyam Shai Murad", control: "you" }, actions: [
      { verb: "return", object: "target permanent card from that player's graveyard", fromZone: "graveyard", toZone: "hand", amount: null, optional: true },
      { verb: "put", object: "a permanent card in your graveyard chosen by that player", fromZone: "graveyard", toZone: "battlefield", amount: null, optional: false }] }],
    "Neyam Shai Murad", { 1: t }, undefined, t);
  const recs = abilities.filter((a) => a.effect.kind === "graveyard-recursion");
  expect(recs).toHaveLength(2);
  expect(recs[0]!.effect.subject?.control).not.toBe("you");
  expect(recs[1]!.effect.subject?.control).toBe("you");
});

test("Hedron Blade's blockers are not 'it': the trigger subject's class is not copied when it follows 'blocked by'", () => {
  const t = "Whenever equipped creature becomes blocked by one or more colorless creatures, it gains deathtouch until end of turn.";
  const { abilities } = deriveAbilities(
    [{ id: 1, abilityType: "triggered", trigger: { event: "becomes-blocked", subject: "one or more colorless creatures", control: "any" },
      actions: [{ verb: "grant-ability", object: "equipped creature gains deathtouch until end of turn", fromZone: null, toZone: null, amount: null, optional: false }] }],
    "Hedron Blade", { 1: t }, undefined, t);
  const grant = abilities.find((a) => a.effect.kind === "keyword-grant")!;
  expect(grant.effect.subject?.colors).toBeUndefined();
  expect(grant.effect.subject?.type).toBeUndefined();
});

test("a mode bullet of a refused header reads the header's object: 'It gains X' is the creature you control (inherited)", () => {
  const { abilities } = deriveAbilities(
    [
      { id: 1, abilityType: "triggered", trigger: { event: "attacks", subject: "a creature you control", control: "you" }, actions: [] },
      { id: 2, abilityType: "triggered", actions: [{ verb: "grant-ability", object: "indestructible", fromZone: null, toZone: null, amount: null, optional: false }] },
    ],
    "Modal Attacker",
    { 1: "Whenever a creature you control attacks alone, choose one —", 2: "It gains indestructible until end of turn." },
    undefined, "Whenever a creature you control attacks alone, choose one —\n• It gains indestructible until end of turn.",
  );
  const grant = abilities.find((a) => a.clause === 2 && a.effect.kind === "keyword-grant")!;
  // CEILING (pre-existing, every modal bullet): the bullet re-reads its header's event WITHOUT the header's
  // narrowing ("alone"), so it keeps a plain `attacks` trigger rather than a refusal. What it grants to is the
  // part this choice fixes: without it the subject was `{control: any}` with no ref -- every permanent.
  expect(grant.effect.subject).toMatchObject({ ref: "trigger", type: "creature" });
});

// #1264 review: the "self-loss" stamp is a pure step on the final ability.
describe("stampSelfLoss", () => {
  const loses = { verb: "loses-game", subject: { control: "you", token: null } } as never;
  const base = { kind: "triggered", effect: { kind: "" } } as unknown as Ability;
  test("a refused trigger whose emits are all 'you lose the game' stays 'refused-trigger'", () => {
    expect(stampSelfLoss({ ...base, emits: [loses], claimsNothing: "refused-trigger" }).claimsNothing).toBe("refused-trigger");
    expect(stampSelfLoss({ ...base, emits: [loses] }).claimsNothing).toBe("self-loss");
  });
  test("every emit must be the loss: a loss plus a draw, an opponent's loss or no emits gets no reason", () => {
    const draw = { verb: "draw", subject: { control: "you", token: null } } as never;
    const oppLoses = { verb: "loses-game", subject: { control: "opp", token: null } } as never;
    expect(stampSelfLoss({ ...base, emits: [loses, draw] }).claimsNothing).toBeUndefined();
    expect(stampSelfLoss({ ...base, emits: [oppLoses] }).claimsNothing).toBeUndefined();
    expect(stampSelfLoss({ ...base, emits: [] }).claimsNothing).toBeUndefined();
    expect(stampSelfLoss(base).claimsNothing).toBeUndefined();
  });
});

// #1295 (derive 348): control, owner and edict markers read off the shape of the sentence.
describe("#1295 removal-shaped emits", () => {
  const typeLineOf = (name: string): string => (/^(Innocent Blood|Diabolic Edict)$/.test(name) ? "Sorcery" : "Instant");
  /** Derive a card the way production does: the grammar's own records when `records` is absent (clauseSource: grammar),
   *  the stored model records (verbatim from cardClauses) otherwise. */
  const emitsOf = (name: string, oracleText: string, typeLine = typeLineOf(name), records?: Parameters<typeof deriveInputOf>[3]) => {
    const card = { name, typeLine, oracleText, keywords: [] as string[] };
    const g = records ? undefined : grammarClauseRecords(card as never);
    const tags = deriveCardTags(deriveInputOf(card as never, "x", name, records ?? g!.records, undefined, g?.readings));
    return tags.abilities.flatMap((a) => (a.emits ?? []).map((e) => ({ ...e, clause: a.clause })));
  };

  test("Diabolic Edict: the targeted player is marked, and the creature is not itself targeted", () => {
    const e = emitsOf("Diabolic Edict", "Target player sacrifices a creature of their choice.").filter((x) => x.verb === "sacrifice" || x.verb === "dies");
    expect(e.map((x) => x.verb).sort()).toEqual(["dies", "sacrifice"]);
    for (const x of e) { expect(x.subject.edict).toBe(true); expect(x.subject.scope).toBeUndefined(); }
  });

  test("an edict aimed at several targets, or with a verb after 'and', is marked (Priest of Forgotten Gods, Will of the Abzan)", () => {
    const priest = emitsOf("Priest of Forgotten Gods", "{T}, Sacrifice two other creatures: Any number of target players each lose 2 life and sacrifice a creature of their choice. You add {B}{B} and draw a card. (Activate only as an instant.)", "Creature — Human Cleric")
      .filter((x) => x.verb === "dies" && x.subject.edict === true);
    expect(priest.length).toBeGreaterThan(0);
    const will = emitsOf("Will of the Abzan", "Choose one. If you control a commander as you cast this spell, you may choose both instead.\n• Any number of target opponents each sacrifice a creature with the greatest power among creatures that player controls and lose 3 life.\n• Return target creature card from your graveyard to the battlefield.", "Instant", [
      { id: 1, abilityType: "spell", actions: [] },
      { id: 2, abilityType: "spell", actions: [{ verb: "lose-life", object: "any number of target opponents", amount: "3", optional: false }, { verb: "sacrifice", object: "a creature with the greatest power among creatures that player controls", optional: false }] },
      { id: 3, abilityType: "spell", actions: [{ verb: "return", object: "target creature card from your graveyard", fromZone: "graveyard", toZone: "battlefield", optional: false }] },
    ])
      .filter((x) => x.verb === "dies" && x.subject.edict === true);
    expect(will.length).toBeGreaterThan(0);
    // the victim's option is not an edict
    const dragon = emitsOf("Demanding Dragon", "Flying\nWhen this creature enters, it deals 5 damage to target opponent unless that player sacrifices a creature of their choice.", "Creature — Dragon")
      .filter((x) => x.verb === "sacrifice");
    for (const x of dragon) expect(x.subject.edict).toBeUndefined();
    // "unless target opponent sacrifices ..." matches the edict wording, and only the victim's-option guard keeps it unmarked.
    const tormentor = emitsOf("Indulgent Tormentor", "Flying\nAt the beginning of your upkeep, draw a card unless target opponent sacrifices a creature of their choice or pays 3 life.", "Creature — Demon", [
      { id: 1, abilityType: "none", actions: [{ verb: "none", object: "Flying" }] },
      // The stored record for this card has no sacrifice action; a model that wrote the unless-clause out as one would give this.
      { id: 2, abilityType: "triggered", trigger: { event: "upkeep", subject: "you", control: "you" }, actions: [{ verb: "draw", object: "a card", amount: "1" }, { verb: "sacrifice", object: "a creature of their choice", optional: true }] },
    ])
      .filter((x) => x.verb === "sacrifice" || x.verb === "dies");
    expect(tormentor.length).toBeGreaterThan(0);
    for (const x of tormentor) expect(x.subject.edict).toBeUndefined();
  });

  test("an edict is marked only when the player is TARGETED: Innocent Blood and a bare sacrifice are not", () => {
    const innocent = emitsOf("Innocent Blood", "Each player sacrifices a creature of their choice.").filter((x) => x.verb === "sacrifice" || x.verb === "dies");
    expect(innocent.length).toBeGreaterThan(0);
    for (const x of innocent) expect(x.subject.edict).toBeUndefined();
    const opp = emitsOf("Sheoldred's Edict", "Each opponent sacrifices a creature of their choice.", "Instant").filter((x) => x.verb === "sacrifice");
    for (const x of opp) expect(x.subject.edict).toBeUndefined();
  });

  test("an alternative the victim may decline is marked (Star Athlete, Enchanter's Bane, Thornplate, Disorienting Choice, Livio)", () => {
    const star = emitsOf("Star Athlete", "Menace\nWhenever this creature attacks, choose up to one target nonland permanent. Its controller may sacrifice it. If they don't, this creature deals 5 damage to that player.", "Creature — Human Warrior", [
      { id: 1, abilityType: "none", actions: [{ verb: "none", object: "Menace" }] },
      { id: 2, abilityType: "triggered", trigger: { event: "attacks", subject: "this creature", control: "you" }, actions: [{ verb: "deal-damage", object: "that player", amount: "5", optional: false }, { verb: "sacrifice", object: "target nonland permanent", optional: true }] },
    ]).filter((x) => x.verb === "sacrifice" || x.verb === "dies");
    expect(star.length).toBe(2);
    for (const x of star) expect(x.victimMay).toBe(true);
    const bane = emitsOf("Enchanter's Bane", "At the beginning of your end step, target enchantment deals damage equal to its mana value to its controller unless that player sacrifices it.", "Enchantment", [
      { id: 1, abilityType: "triggered", trigger: { event: "end-step", subject: "you", control: "you" }, actions: [{ verb: "deal-damage", object: "target enchantment's controller", amount: "target enchantment's mana value", optional: false }, { verb: "sacrifice", object: "target enchantment", optional: true }] },
    ]).filter((x) => x.verb === "sacrifice" || x.verb === "dies");
    expect(bane.length).toBe(2);
    for (const x of bane) expect(x.victimMay).toBe(true);
    const livio = emitsOf("Livio, Oathsworn Sentinel", "{1}{W}: Choose another target creature. Its controller may exile it with an aegis counter on it.", "Legendary Creature — Human Soldier", [
      { id: 1, abilityType: "activated", actions: [{ verb: "exile", object: "another target creature", fromZone: "battlefield", toZone: "exile", optional: true }] },
    ]).filter((x) => x.verb === "exiled" || x.verb === "leaves");
    expect(livio.length).toBeGreaterThan(0);
    for (const x of livio) expect(x.victimMay).toBe(true);
  });

  test("a plain removal, and a sacrifice YOU may make, carry no victimMay", () => {
    for (const x of emitsOf("Doom Blade", "Destroy target nonblack creature.", "Instant")) expect(x.victimMay).toBeUndefined();
    const cost = emitsOf("Some Spell", "You may sacrifice a creature. If you do, draw a card.", "Instant").filter((x) => x.verb === "sacrifice");
    for (const x of cost) expect(x.victimMay).toBeUndefined();
  });

  const damageEmits = (name: string, text: string, typeLine: string) => emitsOf(name, text, typeLine).filter((x) => x.verb === "non-combat-damage");

  test("a damage REDIRECT is marked: 'is dealt to any target instead' (Harm's Way, Shining Shoal, Glarecaster, Mirrorwood Treefolk, Ward of Piety, Zhalfirin Crusader, Captain's Maneuver; owner ruling 2026-10-22, #1294)", () => {
    const cards: [string, string, string][] = [
      ["Harm's Way", "The next 2 damage that a source of your choice would deal to you and/or permanents you control this turn is dealt to any target instead.", "Instant"],
      ["Ward of Piety", "Enchant creature\n{1}{W}: The next 1 damage that would be dealt to enchanted creature this turn is dealt to any target instead.", "Enchantment — Aura"],
      ["Captain's Maneuver", "The next X damage that would be dealt to target creature, planeswalker, or player this turn is dealt to another target creature, planeswalker, or player instead.", "Instant"],
    ];
    for (const [n, t, ty] of cards) {
      const d = damageEmits(n, t, ty);
      expect(d.length, n).toBeGreaterThan(0);
      for (const x of d) expect(x.redirect, n).toBe(true);
    }
  });

  test("prevent-then-deal DEALS the damage and is no redirect (Refraction Trap, Divine Deflection, Vengeful Archon)", () => {
    const cards: [string, string, string][] = [
      ["Refraction Trap", "Prevent the next 3 damage that a source of your choice would deal to you and/or permanents you control this turn. If damage is prevented this way, Refraction Trap deals that much damage to any target.", "Instant"],
      ["Divine Deflection", "Prevent the next X damage that would be dealt to you and/or permanents you control this turn. If damage is prevented this way, Divine Deflection deals that much damage to any target.", "Instant"],
      ["Vengeful Archon", "Flying\n{X}: Prevent the next X damage that would be dealt to you this turn. If damage is prevented this way, this creature deals that much damage to target player or planeswalker.", "Creature — Archon"],
      ["Lightning Bolt", "Lightning Bolt deals 3 damage to any target.", "Instant"],
      ["Ram Through", "Target creature you control deals damage equal to its power to target creature you don't control. If the creature you control has trample, excess damage is dealt to that creature's controller instead.", "Instant"],
    ];
    for (const [n, t, ty] of cards) for (const x of damageEmits(n, t, ty)) expect(x.redirect, n).toBeUndefined();
  });

  test("damage the VICTIM may have dealt reads as the victim's option (Requiem Monolith: 'That creature's controller may have this artifact deal 1 damage to it'); a plain deal does not", () => {
    const monolith = "{T}: Until end of turn, target creature gains \"Whenever this creature is dealt damage, you draw that many cards and lose that much life.\" That creature's controller may have this artifact deal 1 damage to it. Activate only as a sorcery.";
    expect(victimDeclines(monolith, "deal-damage")).toBe(true);
    expect(victimDeclines("Lightning Bolt deals 3 damage to any target.", "deal-damage")).toBe(false);
    expect(victimDeclines("Target opponent may have this card deal 4 damage to them. If they don't, you draw three cards.", "deal-damage")).toBe(true);
    // Pandemonium: the controller picks a target, so it is damage someone aims.
    expect(victimDeclines("Whenever a creature enters, that creature's controller may have it deal damage equal to its power to any target.", "deal-damage")).toBe(false);
  });

  test("another word on the card does not set the target's control (Premature Burial, Blazing Hope, Soul Snare)", () => {
    const burial = emitsOf("Premature Burial", "Destroy target nonblack creature that entered since your last turn ended.").filter((x) => x.verb === "dies");
    expect(burial.map((x) => x.subject.control)).toEqual(["opp"]);
    const hope = emitsOf("Blazing Hope", "Exile target creature with power greater than or equal to your life total.").filter((x) => x.verb === "exiled");
    expect(hope.map((x) => x.subject.control)).toEqual(["opp"]);
    const snare = emitsOf("Soul Snare", "{W}, Sacrifice this enchantment: Exile target creature that's attacking you or a planeswalker you control.", "Enchantment").filter((x) => x.verb === "exiled");
    expect(snare.map((x) => x.subject.control)).toEqual(["opp"]);
  });

  test("a stated control still reads: 'creature you control' and 'creature an opponent controls' are untouched", () => {
    const own = emitsOf("Some Blink", "Exile target creature you control, then return it to the battlefield under its owner's control.", "Instant").filter((x) => x.verb === "exiled");
    expect(own.map((x) => x.subject.control)).toEqual(["you"]);
    const theirs = emitsOf("Some Removal", "Destroy target creature an opponent controls.", "Instant").filter((x) => x.verb === "dies");
    expect(theirs.map((x) => x.subject.control)).toEqual(["opp"]);
  });

  test("the unbracketed reading of a cleave card is the cast with cleave: Alchemist's Retrieval bounces ANY nonland permanent", () => {
    const e = emitsOf("Alchemist's Retrieval", "Cleave {1}{U} (You may cast this spell for its cleave cost. If you do, remove the words in square brackets.)\nReturn target nonland permanent [you control] to its owner's hand.", "Instant", [
      { id: 1, abilityType: "none", actions: [{ verb: "none", object: "Cleave {1}{U}" }] },
      { id: 2, abilityType: "spell", actions: [{ verb: "return", object: "target nonland permanent you control" }] },
    ]).filter((x) => x.verb === "leaves");
    expect(e.length).toBe(1);
    expect(e[0]!.subject.control).not.toBe("you");
  });

  test("'you own' is the owner, not an opponent's permanent (Become Anonymous, Northampton Farm)", () => {
    const become = emitsOf("Become Anonymous", "Exile target nontoken creature you own and the top two cards of your library in a face-down pile, shuffle that pile, then cloak those cards. They enter tapped.", "Instant", [
      { id: 1, abilityType: "spell", actions: [{ verb: "exile", object: "target nontoken creature you own", fromZone: "battlefield", toZone: "exile" }, { verb: "exile", object: "the top two cards of your library", fromZone: "library", toZone: "exile" }, { verb: "shuffle", object: "that pile" }, { verb: "cloak", object: "those cards" }, { verb: "tap", object: "those cards" }] },
    ]).filter((x) => x.verb === "exiled" && x.subject.scope === "target");
    expect(become.length).toBe(1);
    expect(become[0]!.subject.owner).toBe("you");
    expect(become[0]!.subject.control).not.toBe("opp");
    const farm = emitsOf("Northampton Farm", "{T}: Add {C}.\n{1}, {T}: Exile target creature you own.\n{2}, {T}, Sacrifice this land: Return a creature card exiled with this land to the battlefield under your control. Return each other card exiled with this land to its owner's hand.", "Land")
      .filter((x) => x.verb === "exiled" && x.subject.scope === "target");
    expect(farm.length).toBe(1);
    expect(farm[0]!.subject.owner).toBe("you");
    expect(farm[0]!.subject.control).not.toBe("opp");
  });

  test("'its controller sacrifices it' after a pump of YOUR creature sacrifices your creature (Celestial Sword)", () => {
    const e = emitsOf("Celestial Sword", "{3}, {T}: Target creature you control gets +3/+3 until end of turn. Its controller sacrifices it at the beginning of the next end step.", "Artifact")
      .filter((x) => x.verb === "sacrifice");
    expect(e.length).toBe(1);
    expect(e[0]!.subject.control).toBe("you");
    // ...while a destroy followed by the opponent's controller is still theirs (Pongify's shape).
    const theirs = emitsOf("Some Edict", "Destroy target creature. Its controller sacrifices a land.", "Instant").filter((x) => x.verb === "sacrifice");
    expect(theirs.every((x) => x.subject.control === "opp")).toBe(true);
  });

  test("the same cues do not fire on the wrong noun (Lay Down Arms, Flash Foliage, Tree of Redemption)", () => {
    // "the number of Plains YOU control" is a count, not the antecedent of "its controller".
    const arms = emitsOf("Lay Down Arms", "Exile target creature with mana value less than or equal to the number of Plains you control. Its controller gains 3 life.", "Sorcery");
    expect(arms.filter((x) => x.verb === "gain-life").map((x) => x.subject.control)).toEqual(["opp"]);
    expect(arms.filter((x) => x.verb === "exiled").map((x) => x.subject.control)).toEqual(["opp"]);
    // The token blocking a creature that attacks you is YOURS; only the attacker is theirs.
    const foliage = emitsOf("Flash Foliage", "Cast this spell only during combat after blockers are declared.\nCreate a 1/1 green Saproling creature token that's blocking target creature attacking you.\nDraw a card.", "Instant")
      .filter((x) => x.verb === "create-token");
    expect(foliage.length).toBeGreaterThan(0);
    expect(foliage.every((x) => x.subject.control === "you")).toBe(true);
    // "your life total" as the OBJECT is the player's, not a condition on something else.
    const tree = emitsOf("Tree of Redemption", "Defender\n{T}: Exchange your life total with this creature's toughness.", "Creature — Plant")
      .filter((x) => x.subject.control === "any");
    expect(tree).toEqual([]);
  });

  test("a creature that crewed it is yours (Getaway Car)", () => {
    const e = emitsOf("Getaway Car", "Haste\nWhenever this Vehicle attacks or blocks, return up to one target creature that crewed it this turn to its owner's hand.\nCrew 1", "Artifact — Vehicle")
      .filter((x) => x.verb === "leaves");
    expect(e.length).toBeGreaterThan(0);
    expect(e.every((x) => x.subject.control === "you")).toBe(true);
  });

  test("'destroy that creature' after a TARGETED pump is the target: Depressurize keeps its target scope", () => {
    const e = emitsOf("Depressurize", "Target creature gets -3/-0 until end of turn. Then if that creature's power is 0 or less, destroy it.", "Instant", [
      { id: 1, abilityType: "spell", actions: [{ verb: "modify-pt", object: "target creature", amount: "-3/-0" }, { verb: "destroy", object: "that creature", optional: false }] },
    ]).filter((x) => x.verb === "dies");
    expect(e.length).toBeGreaterThan(0);
    for (const x of e) { expect(x.subject.scope).toBe("target"); expect(x.subject.control).toBe("opp"); }
  });

  test("'that creature' after an UNTARGETED antecedent or the card itself gains no target scope", () => {
    const sibsig = emitsOf("The Sibsig Ceremony", "Whenever a creature you control enters, destroy that creature.", "Enchantment", [
      { id: 1, abilityType: "triggered", trigger: { event: "enters", subject: "a creature", control: "you" }, actions: [{ verb: "destroy", object: "that creature", optional: false }] },
    ]).filter((x) => x.verb === "dies");
    for (const x of sibsig) expect(x.subject.scope).toBeUndefined();
    const own = emitsOf("Test Card", "Sacrifice this creature. Destroy that creature.", "Instant", [
      { id: 1, abilityType: "spell", actions: [{ verb: "sacrifice", object: "this creature", optional: false }, { verb: "destroy", object: "that creature", optional: false }] },
    ]).filter((x) => x.verb === "dies");
    for (const x of own) expect(x.subject.scope).toBeUndefined();
  });

  test("a copy token is controlled by its creator, and 'sacrifice them' is those tokens (Venser, Fervent Forger)", () => {
    const e = emitsOf("Venser, Fervent Forger", "Flash\nWhen Venser enters, choose one —\n• Copy target instant or sorcery spell an opponent controls twice. You may choose new targets for the copies.\n• Create two tokens that are copies of target permanent an opponent controls. They gain haste. At the beginning of the next end step, sacrifice them.", "Legendary Creature — Human Wizard", [
      { id: 1, abilityType: "none", actions: [{ verb: "none", object: "Flash" }] },
      { id: 2, abilityType: "triggered", trigger: { event: "enters", subject: "this", control: "you" }, actions: [] },
      { id: 3, abilityType: "triggered", actions: [{ verb: "copy", object: "target instant or sorcery spell an opponent controls", amount: "2", optional: true }] },
      { id: 4, abilityType: "triggered", actions: [{ verb: "create", object: "token copies of target permanent an opponent controls with haste", amount: "2", optional: false }, { verb: "sacrifice", object: "them", optional: false }] },
    ]).filter((x) => x.clause === 4);
    expect(e.map((x) => x.verb)).toEqual(["create-token", "enters", "sacrifice", "dies"]);
    for (const x of e) { expect(x.subject.control).toBe("you"); expect(x.subject.scope).toBeUndefined(); expect(x.subject.token).toBe(true); }
  });

  test("'target attacking creature' in a trigger of YOUR attack is yours (CR 508.1a): Scrappy Bruiser; blockers, spells and other triggers stay", () => {
    const bruiser = emitsOf("Scrappy Bruiser", "Whenever this creature attacks, up to one target attacking creature gets +2/+0 and gains trample until end of turn. Return that creature to its owner's hand at end of combat.", "Creature — Human", [
      { id: 1, abilityType: "triggered", trigger: { event: "attacks", subject: "this creature", control: "you" }, actions: [{ verb: "modify-pt", object: "up to one target attacking creature", amount: "+2/+0" }, { verb: "return", object: "that creature", toZone: "hand", optional: false }] },
    ]).filter((x) => x.verb === "leaves");
    expect(bruiser.length).toBeGreaterThan(0);
    for (const x of bruiser) expect(x.subject.control).toBe("you");
    const frenzy = emitsOf("Blood Frenzy", "Target attacking or blocking creature gets +4/+0 until end of turn. Destroy that creature at the beginning of the next end step.", "Instant", [
      { id: 1, abilityType: "spell", actions: [{ verb: "modify-pt", object: "target attacking or blocking creature", amount: "+4/+0" }, { verb: "destroy", object: "that creature", optional: false }] },
    ]).filter((x) => x.verb === "dies");
    for (const x of frenzy) expect(x.subject.control).toBe("opp");
  });

  test("a death replacement riding on damage does not scope its anaphor (Burn from Within, Smite the Deathless); 'destroy that creature instead' of damage does (Kill-Suit Cultist)", () => {
    const burn = emitsOf("Burn from Within", "Burn from Within deals X damage to any target. If a creature is dealt damage this way, it loses indestructible until end of turn. If that creature would die this turn, exile it instead.", "Sorcery", [
      { id: 1, abilityType: "spell", actions: [{ verb: "deal-damage", object: "any target", amount: "X" }, { verb: "exile", object: "that creature", optional: false }] },
    ]).filter((x) => x.verb === "exiled" || x.verb === "leaves");
    for (const x of burn) expect(x.subject.scope).toBeUndefined();
    const cultist = emitsOf("Kill-Suit Cultist", "{B}, Sacrifice this creature: The next time damage would be dealt to target creature this turn, destroy that creature instead.", "Creature — Human", [
      { id: 1, abilityType: "activated", actions: [{ verb: "prevent", object: "damage to target creature" }, { verb: "destroy", object: "that creature", optional: false }] },
    ]).filter((x) => x.verb === "dies");
    expect(cultist.some((x) => x.subject.scope === "target")).toBe(true);
  });

  test("review fixes: 'that card' put from a library is not the exile target (Transmogrify), a player antecedent and a token antecedent scope nothing", () => {
    const trans = emitsOf("Transmogrify", "Destroy target creature. Its controller reveals cards from the top of their library until they reveal a creature card. That player puts that card onto the battlefield, then shuffles the rest into their library.", "Sorcery", [
      { id: 1, abilityType: "spell", actions: [{ verb: "exile", object: "target creature", fromZone: "battlefield", toZone: "exile", optional: false }, { verb: "reveal", object: "cards from the top of their library until a creature card is revealed", optional: false }, { verb: "put", object: "that creature card", fromZone: "library", toZone: "battlefield", optional: false }, { verb: "shuffle", object: "the rest into their library", optional: false }] },
    ]).filter((x) => x.verb === "enters");
    expect(trans.length).toBeGreaterThan(0);
    for (const x of trans) expect(x.subject.scope).toBeUndefined();
    const player = emitsOf("Test Mill", "Target player mills a card. Destroy that creature.", "Sorcery", [
      { id: 1, abilityType: "spell", actions: [{ verb: "mill", object: "target player", amount: "1", optional: false }, { verb: "destroy", object: "that creature", optional: false }] },
    ]).filter((x) => x.verb === "dies");
    for (const x of player) expect(x.subject.scope).toBeUndefined();
    const role = emitsOf("Test Role", "Create a Royal Role token attached to target creature. Destroy that creature.", "Sorcery", [
      { id: 1, abilityType: "spell", actions: [{ verb: "create", object: "a Royal Role token attached to target creature", optional: false }, { verb: "destroy", object: "that creature", optional: false }] },
    ]).filter((x) => x.verb === "dies");
    for (const x of role) expect(x.subject.scope).toBeUndefined();
  });

  test("an attack trigger that is NOT yours keeps `opp`: 'Whenever a creature attacks you, destroy target attacking creature'", () => {
    const e = emitsOf("Test Deterrent", "Whenever a creature attacks you, destroy target attacking creature.", "Enchantment", [
      { id: 1, abilityType: "triggered", trigger: { event: "attacks", subject: "a creature", control: "opp" }, actions: [{ verb: "destroy", object: "target attacking creature", optional: false }] },
    ]).filter((x) => x.verb === "dies");
    expect(e.length).toBeGreaterThan(0);
    for (const x of e) expect(x.subject.control).toBe("opp");
  });

  test("a copy token keeps a recipient the head names, and a token that is not a copy is untouched", () => {
    const opp = emitsOf("Test Copier", "Target opponent creates a token that's a copy of target creature you control.", "Sorcery", [
      { id: 1, abilityType: "spell", actions: [{ verb: "create", object: "token that's a copy of target creature you control", amount: "1", optional: false }] },
    ]).filter((x) => x.verb === "create-token");
    expect(opp.length).toBeGreaterThan(0);
    // The recipient the sentence names ("target opponent creates") keeps the token: it is theirs.
    for (const x of opp) expect(x.subject.control).toBe("opp");
    const each = emitsOf("Test Each", "Each player creates a token that's a copy of target creature an opponent controls.", "Sorcery", [
      { id: 1, abilityType: "spell", actions: [{ verb: "create", object: "token that's a copy of target creature an opponent controls", amount: "1", optional: false }] },
    ]).filter((x) => x.verb === "create-token");
    expect(each.length).toBeGreaterThan(0);
    for (const x of each) expect(x.subject.control).toBe("any");
    const beast = emitsOf("Beast Within", "Destroy target permanent. Its controller creates a 3/3 green Beast creature token.", "Instant")
      .filter((x) => x.verb === "create-token");
    expect(beast.length).toBeGreaterThan(0);
    // "its controller creates" is a recipient (controlOf calls it `opp`); a token that is not a copy never reaches the copy branch.
    for (const x of beast) expect(x.subject.control).toBe("opp");
  });
});

// #1295 item 3: an O-ring return waits for its source; a return on one branch only is not a blink.
test("a return paired with an 'until this leaves the battlefield' exile is delayed until the source leaves; a conditional return is marked; a plain blink and 'if you do' are neither (Constable of the Realm, Unyielding Gatekeeper, Flicker, Eldrazi Displacer)", () => {
  const flicker = (name: string, clause: object, text: string) => deriveAbilities([{ id: 1, ...clause } as never], name, { 1: text }).abilities.find((a) => a.effect.kind === "flicker");
  const constable = flicker("Constable of the Realm", { abilityType: "triggered", trigger: { event: "counter-added", subject: "a +1/+1 counter on this creature", control: "you" },
    actions: [{ verb: "exile", object: "up to one other target nonland permanent", toZone: "exile", optional: true }, { verb: "return", object: "that permanent", fromZone: "exile", toZone: "battlefield" }] },
  "Whenever one or more +1/+1 counters are put on this creature, exile up to one other target nonland permanent until this creature leaves the battlefield.");
  expect(constable?.delayedUntil).toBe("source-leaves");
  expect(constable?.returnIf).toBeUndefined();
  const gatekeeper = flicker("Unyielding Gatekeeper", { abilityType: "triggered", trigger: { event: "turned-face-up", subject: "this creature", control: "you" },
    actions: [{ verb: "exile", object: "another target nonland permanent" }, { verb: "return", object: "it", fromZone: "exile", toZone: "battlefield" }, { verb: "tap", object: "it" }] },
  "When this creature is turned face up, exile another target nonland permanent. If you controlled it, return it to the battlefield tapped. Otherwise, its controller creates a 2/2 white and blue Detective creature token.");
  expect(gatekeeper?.returnIf).toBe(true);
  expect(gatekeeper?.delayedUntil).toBeUndefined();
  const vindictive = flicker("Vindictive Triumph", { abilityType: "spell",
    actions: [{ verb: "exile", object: "target creature or planeswalker" }, { verb: "return", object: "it", fromZone: "exile", toZone: "battlefield" }] },
  "Exile target creature or planeswalker. If that permanent's mana value was 3 or less, return it to the battlefield tapped under your control. Exile it at the beginning of the next end step.");
  expect(vindictive?.returnIf).toBe(true);
  const displacer = flicker("Eldrazi Displacer", { abilityType: "activated",
    actions: [{ verb: "exile", object: "another target creature" }, { verb: "return", object: "it", fromZone: "exile", toZone: "battlefield" }] },
  "{2}{C}: Exile another target creature, then return it to the battlefield tapped under its owner's control.");
  expect(displacer?.returnIf).toBeUndefined();
  expect(displacer?.delayedUntil).toBeUndefined();
  const ifYouDo = flicker("Some Blinker", { abilityType: "triggered", trigger: { event: "enters", subject: "this creature", control: "you" },
    actions: [{ verb: "exile", object: "target creature you control" }, { verb: "return", object: "it", fromZone: "exile", toZone: "battlefield" }] },
  "When this creature enters, you may exile target creature you control. If you do, return it to the battlefield under its owner's control.");
  expect(ifYouDo?.returnIf).toBeUndefined();
});

// #1295 item 4 leftovers: two grammar-complete cards derived NOTHING for their removal (Venser's Diffusion, Teferi, Hero of Dominaria -3).
describe("a bounce 'or suspended card' and a tuck from the battlefield derive a leave (#1295 item 4)", () => {
  const leaves = (name: string, text: string, actions: object[], abilityType: "spell" | "activated" = "spell") => {
    const { abilities } = deriveAbilities([{ id: 1, abilityType, actions } as never], name, { 1: text }, abilityType === "activated" ? { 1: "−3" } : undefined);
    return abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "leaves");
  };
  test("Venser's Diffusion: the permanent half is a bounce off the battlefield, the suspended-card half is not read", () => {
    const e = leaves("Venser's Diffusion", "Return target nonland permanent or suspended card to its owner's hand.",
      [{ verb: "return", object: "target nonland permanent or suspended card", fromZone: null, toZone: "hand", optional: false }]);
    expect(e).toHaveLength(1);
    // An unstated origin leaves the emit's fromZone unset, which the removal rule reads as the battlefield (like every other unstated-origin bounce).
    expect(e[0]?.subject).toMatchObject({ scope: "target", notType: ["land"] });
    expect(e[0]?.subject.zone).toBeUndefined();
  });
  test("a card alone ('target suspended card') gives no battlefield emit", () => {
    expect(leaves("Test Card", "Return target suspended card to its owner's hand.",
      [{ verb: "return", object: "target suspended card", fromZone: null, toZone: "hand", optional: false }])).toEqual([]);
  });
  test("Teferi, Hero of Dominaria -3: 'third from the top' tucks a target permanent off the battlefield", () => {
    const e = leaves("Teferi, Hero of Dominaria", "Put target nonland permanent into its owner's library third from the top.",
      [{ verb: "put", object: "target nonland permanent", fromZone: "battlefield", toZone: "library", optional: false }], "activated");
    expect(e).toHaveLength(1);
    expect(e[0]?.subject).toMatchObject({ scope: "target", notType: ["land"], fromZone: "battlefield" });
  });
  test("Oust (unstated origin, a creature) tucks too; a put from a graveyard or the hand is not a battlefield tuck", () => {
    expect(leaves("Oust", "Put target creature into its owner's library second from the top.",
      [{ verb: "put", object: "target creature", fromZone: null, toZone: "library", optional: false }])).toHaveLength(1);
    expect(leaves("Test Gy", "Put target creature card from your graveyard on top of your library.",
      [{ verb: "put", object: "target creature card", fromZone: "graveyard", toZone: "library", optional: false }]).every((x) => x.subject.zone === "graveyard")).toBe(true);
    expect(leaves("Test Gy", "Put target creature card from your graveyard on top of your library.",
      [{ verb: "put", object: "target creature card", fromZone: "graveyard", toZone: "library", optional: false }]).some((x) => x.subject.fromZone === "battlefield")).toBe(false);
    expect(leaves("Brainstorm", "Put two cards from your hand on top of your library.",
      [{ verb: "put", object: "two cards from your hand", fromZone: "hand", toZone: "library", optional: false }])).toEqual([]);
  });
});

// #1295 item 5: a coin-flip branch is not a sure effect, so a losing-side shrink on your own creature is not removal.
describe("an action on one side of a coin flip is marked onFlip (#1295 item 5)", () => {
  const flips = (text: string, actions: object[]) =>
    deriveAbilities([{ id: 1, abilityType: "activated", actions } as never], "Test Card", { 1: text }, { 1: "{1}" }).abilities.map((a) => [a.effect.kind, a.onFlip]);
  test("Orcish Captain: the +2/+0 is the win side, the -0/-2 the lose side, the flip itself neither", () => {
    const r = flips("Flip a coin. If you win the flip, target Orc creature gets +2/+0 until end of turn. If you lose the flip, it gets -0/-2 until end of turn.",
      [{ verb: "flip-coin", object: "coin flip" }, { verb: "modify-pt", object: "target Orc creature", amount: "+2/+0" }, { verb: "modify-pt", object: "target Orc creature", amount: "-0/-2" }]);
    expect(r.find(([k]) => k === "pump")?.[1]).toBe("win");
    expect(r.find(([k]) => k === "debuff")?.[1]).toBe("lose");
    expect(r.find(([k]) => k === "")?.[1]).toBeUndefined();
  });
  test("a flip with no branch marks nothing: a shrink after a bare 'Flip a coin.' is not on a side", () => {
    const r = flips("Flip a coin. Target creature gets -0/-2 until end of turn.",
      [{ verb: "flip-coin", object: "coin flip" }, { verb: "modify-pt", object: "target creature", amount: "-0/-2" }]);
    expect(r.every(([, f]) => f === undefined)).toBe(true);
  });
});

// Review of derive 354: the side was found by the FIRST sentence containing the amount, so a shared amount (Bangchuckers' two "2 damage") or a short one ("1") took the wrong sentence.
describe("each action takes its own sentence's coin-flip side (#1295 item 5 review)", () => {
  const sides = (text: string, actions: object[]) =>
    deriveAbilities([{ id: 1, abilityType: "activated", actions } as never], "Test Card", { 1: text }, { 1: "{T}" }).abilities.map((a) => [a.effect.kind, a.onFlip]);
  const flip = { verb: "flip-coin", object: "coin flip" };
  test("Winter Sky: the draw is the LOSE side, the damage the win side", () => {
    const r = sides("Flip a coin. If you win the flip, Winter Sky deals 1 damage to each creature and each player. If you lose the flip, each player draws a card.",
      [flip, { verb: "deal-damage", object: "each creature and each player", amount: "1" }, { verb: "draw", object: "a card" }]);
    expect(r.filter(([k]) => k === "damage").every(([, f]) => f === "win")).toBe(true);
    expect(r.find(([k]) => k === "draw-card")?.[1]).toBe("lose");
  });
  test("Goblin Bangchuckers: two '2 damage' actions land on opposite sides", () => {
    const r = sides("Flip a coin. If you win the flip, this creature deals 2 damage to any target. If you lose the flip, this creature deals 2 damage to itself.",
      [flip, { verb: "deal-damage", object: "any target", amount: "2" }, { verb: "deal-damage", object: "itself", amount: "2" }]);
    expect(r.filter(([k]) => k === "damage").map(([, f]) => f)).toEqual(["win", "lose"]);
  });
  test("Chaotic Strike: an unconditional 'Draw a card.' after the win-side pump is not on a side, and its '1' does not take the +1/+1 sentence", () => {
    const r = sides("Flip a coin. If you win the flip, target creature gets +1/+1 until end of turn. Draw a card.",
      [flip, { verb: "modify-pt", object: "target creature", amount: "+1/+1" }, { verb: "draw", object: "a card", amount: "1" }]);
    expect(r.find(([k]) => k === "pump")?.[1]).toBe("win");
    expect(r.find(([k]) => k === "draw-card")?.[1]).toBeUndefined();
  });
  test("Krark, the Thumbless: no amounts, the return is the lose side and the copy the win side", () => {
    const r = sides("Whenever you cast an instant or sorcery spell, flip a coin. If you lose the flip, return that spell to its owner's hand. If you win the flip, copy that spell, and you may choose new targets for the copy.",
      [flip, { verb: "return", object: "that spell", toZone: "hand" }, { verb: "copy", object: "that spell" }]);
    expect(r.find(([k]) => k === "bounce")?.[1]).toBe("lose");
    expect(r.find(([k]) => k === "copy-spell")?.[1]).toBe("win");
  });
});

// #1295 item 4 review: Plan for All Outcomes ("the owner of up to one other target nonland permanent puts it on their choice of the top or bottom") read "it" as the trigger's
// subject, "this enchantment", and derived a false SELF tuck beside an unclaimed real one.
test("Plan for All Outcomes: the tuck is the targeted permanent, with no self leaves", () => {
  const card = { name: "Plan for All Outcomes", typeLine: "Enchantment", keywords: [], oracleText:
    "When this enchantment enters, the owner of up to one other target nonland permanent puts it on their choice of the top or bottom of their library." } as never;
  const g = grammarClauseRecords(card);
  expect(g.complete).toBe(true);
  const { abilities } = deriveAbilities(g.records, "Plan for All Outcomes", { 1: (card as { oracleText: string }).oracleText });
  const leaves = abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "leaves");
  expect(leaves.some((e) => e.subject.self === true)).toBe(false);
  expect(leaves).toHaveLength(1);
  expect(leaves[0]).toMatchObject({ tuck: true, subject: { scope: "target", notType: ["land"] } });
});

// #1299 task 2: `unclaimed` is persisted, as `unknownTriggers` is, and carries the clause that printed it.
describe("CardTags.unclaimed", () => {
  const derive = (clauses: Parameters<typeof deriveCardTags>[0]["clauses"], extra: Partial<Parameters<typeof deriveCardTags>[0]> = {}) =>
    deriveCardTags({ oracleId: "x", clauses, characteristics: MINIMAL_CHARACTERISTICS, ...extra });

  test("an action no rule claims is persisted with its clause id", () => {
    const tags = derive([{ id: 7, abilityType: "static", actions: [{ verb: "other", object: "flip a coin", fromZone: null, toZone: "hand" }] }]);
    expect(tags.unclaimed).toEqual([{ clause: 7, verb: "other", object: "flip a coin", toZone: "hand" }]);
  });

  test("an inert-only clause leaves the key absent", () => {
    const tags = derive([{ id: 1, abilityType: "static", actions: [{ verb: "none" }] }]);
    expect("unclaimed" in tags).toBe(false);
  });

  test("a mana clause that became a mana line is not unclaimed", () => {
    const tags = derive([{ id: 1, abilityType: "activated", actions: [{ verb: "add-mana", object: "{C}{C}" }] }],
      { clauseTexts: { 1: "Add {C}{C}." }, clauseCosts: { 1: "{T}" } });
    expect("unclaimed" in tags).toBe(false);
  });

  test("a clause whose every action is claimed leaves the key absent", () => {
    const tags = derive([{ id: 1, abilityType: "spell", actions: [{ verb: "destroy", object: "target creature" }] }]);
    expect("unclaimed" in tags).toBe(false);
  });
});

// #1301: a `put` that is the DESTINATION of an effect derive claims in the same clause is that ability's `toZone`, not an orphan.
describe("a put that is another effect's destination (#1301)", () => {
  const putOf = (object: string, fromZone: string, toZone: string) => ({ verb: "put", object, fromZone, toZone });
  const searchAction = { verb: "search", object: "your library for a basic land card", fromZone: "library" };
  const searchAbility = (abilities: Ability[]) => abilities.find((a) => a.effect.kind === "search")!;

  test("search then 'put it into your hand' sets the search's toZone and claims the put (Abzan Monument)", () => {
    const { abilities, unclaimed } = deriveAbilities([{ id: 1, abilityType: "spell", actions: [searchAction, putOf("it", "library", "hand"), { verb: "shuffle", object: "your library" }] }], undefined, { 1: "Search your library for a basic land card, reveal it, put it into your hand, then shuffle." });
    expect(searchAbility(abilities).toZone).toBe("hand");
    expect(unclaimed.filter((u) => u.verb === "put")).toEqual([]);
  });

  test("...onto the battlefield, for the opponent's own search too (Path to Exile, Boseiju)", () => {
    const { abilities, unclaimed } = deriveAbilities([{ id: 1, abilityType: "spell", actions: [{ verb: "exile", object: "target creature", fromZone: "battlefield", toZone: "exile" }, searchAction, putOf("that card", "library", "battlefield"), { verb: "tap", object: "that card" }] }], undefined, { 1: "Exile target creature. Its controller may search their library for a basic land card, put that card onto the battlefield tapped, then shuffle." }, undefined, "Exile target creature. Its controller may search their library for a basic land card, put that card onto the battlefield tapped, then shuffle.");
    expect(searchAbility(abilities).toZone).toBe("battlefield");
    expect(unclaimed.filter((u) => u.verb === "put")).toEqual([]);
  });

  test("a put of something else beside a search stays unclaimed and sets nothing", () => {
    const { abilities, unclaimed } = deriveAbilities([{ id: 1, abilityType: "spell", actions: [searchAction, putOf("the top card of your library", "library", "hand")] }], undefined, { 1: "Search your library for a basic land card, reveal it, then shuffle. Put the top card of your library into your hand." });
    expect(searchAbility(abilities).toZone).toBeUndefined();
    expect(unclaimed.filter((u) => u.verb === "put")).toHaveLength(1);
  });

  test("a put with no search in its clause is untouched", () => {
    const { abilities, unclaimed } = deriveAbilities([{ id: 1, abilityType: "spell", actions: [putOf("it", "library", "hand")] }], undefined, { 1: "Reveal the top card of your library. Put it into your hand." });
    expect(abilities.some((a) => a.toZone !== undefined)).toBe(false);
    // Untouched by the search destination, and since #1302 (CR 121.5) claimed by its own kind: the top card into your hand is `to-hand`.
    expect(abilities.filter((a) => a.effect.kind === "to-hand")).toHaveLength(1);
    expect(unclaimed).toHaveLength(0);
  });

  test("dig remainder: 'put the rest on the bottom' beside the dig's own put is claimed, with no emit (Acclaimed Contender)", () => {
    const { abilities, unclaimed } = deriveAbilities([{ id: 1, abilityType: "triggered", trigger: { event: "enters", subject: "this creature" },
      actions: [putOf("a revealed Knight card", "library", "hand"), putOf("the rest", "library", "library")] }], undefined, { 1: "Put the rest on the bottom of your library in a random order." });
    expect(unclaimed.filter((u) => u.object === "the rest")).toEqual([]);
    expect(abilities.flatMap((a) => a.emits ?? []).some((e) => e.verb === "enters")).toBe(false);
    expect(abilities.some((a) => a.toZone !== undefined)).toBe(false);
  });

  test("'the rest' with nothing it could be the rest of, and 'the rest' into the graveyard, stay unclaimed", () => {
    const lone = deriveAbilities([{ id: 1, abilityType: "spell", actions: [putOf("the rest", "library", "library")] }], undefined, { 1: "Put the rest on the bottom of your library." });
    expect(lone.unclaimed).toHaveLength(1);
    // "the rest into your graveyard" is a mill by the zone rules and stays one: the remainder rule only reads library>library.
    const yard = deriveAbilities([{ id: 1, abilityType: "spell", actions: [putOf("a card", "library", "hand"), putOf("the rest", "library", "graveyard")] }], undefined, { 1: "Put one into your hand and the rest into your graveyard." });
    expect(yard.abilities.some((a) => a.effect.kind === "mill")).toBe(true);
    expect(yard.abilities.some((a) => a.toZone !== undefined)).toBe(false);
  });

  test("counter then 'put it on top of its owner's library instead' sets the counter's toZone (Memory Lapse)", () => {
    const { abilities, unclaimed } = deriveAbilities([{ id: 1, abilityType: "spell", actions: [{ verb: "counter-spell", object: "target spell" }, putOf("that spell", "stack", "library")] }], undefined, { 1: "Counter target spell. If that spell is countered this way, put it on top of its owner's library instead of into that player's graveyard." });
    expect(abilities.find((a) => a.emits?.some((e) => e.verb === "counter-spell"))!.toZone).toBe("library");
    expect(unclaimed.filter((u) => u.verb === "put")).toEqual([]);
  });

  test("a counter with no put has no destination", () => {
    const { abilities } = deriveAbilities([{ id: 1, abilityType: "spell", actions: [{ verb: "counter-spell", object: "target spell" }] }]);
    expect(abilities.some((a) => a.toZone !== undefined)).toBe(false);
  });

  test("a put that derives its own `enters` still gives the search its toZone, and keeps that ability as it was (Rampant Growth)", () => {
    const text = "Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.";
    const clause = { id: 1, abilityType: "spell" as const, actions: [searchAction, putOf("that card", "library", "battlefield"), { verb: "shuffle", object: "your library" }] };
    const { abilities, unclaimed } = deriveAbilities([clause], undefined, { 1: text }, undefined, text);
    expect(searchAbility(abilities).toZone).toBe("battlefield");
    const enters = abilities.find((a) => a.emits?.some((e) => e.verb === "enters"))!;
    expect(enters.toZone).toBeUndefined();
    expect(unclaimed.filter((u) => u.verb === "put")).toEqual([]);
  });

  test("Path to Exile: the opponent's search holds battlefield and stays the opponent's", () => {
    const text = "Exile target creature. Its controller may search their library for a basic land card, put that card onto the battlefield tapped, then shuffle.";
    const { abilities } = deriveAbilities([{ id: 1, abilityType: "spell", actions: [{ verb: "exile", object: "target creature", fromZone: "battlefield", toZone: "exile" }, { verb: "search", object: "their library for a basic land card", fromZone: "library" }, putOf("that card", "library", "battlefield")] }], undefined, { 1: text }, undefined, text);
    const search = searchAbility(abilities);
    expect(search.toZone).toBe("battlefield");
    expect(search.effect.subject?.control).toBe("opp");
  });

  test("a split over two destinations holds the first (Cultivate); a put from the hand after a search of the same words sets nothing", () => {
    const text = "Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.";
    const split = deriveAbilities([{ id: 1, abilityType: "spell", actions: [{ verb: "search", object: "up to two basic land cards", fromZone: "library" }, putOf("one", "library", "battlefield"), putOf("the other", "library", "hand")] }], undefined, { 1: text }, undefined, text);
    expect(searchAbility(split.abilities).toZone).toBe("battlefield");
    const hand = deriveAbilities([{ id: 1, abilityType: "spell", actions: [{ verb: "search", object: "your library for a basic land card", fromZone: "library" }, putOf("a basic land card", "hand", "battlefield")] }]);
    expect(searchAbility(hand.abilities).toZone).toBeUndefined();
  });

  test("the zone-tail strip is linear on a long run of spaces", () => {
    const t0 = performance.now();
    deriveAbilities([{ id: 1, abilityType: "spell", actions: [searchAction, putOf("a b" + " ".repeat(50_000) + "x", "library", "hand")] }]);
    expect(performance.now() - t0).toBeLessThan(100);
  });

  test("the zone-tail strip is linear on many zone words (CodeQL, #1304)", () => {
    const t0 = performance.now();
    deriveAbilities([{ id: 1, abilityType: "spell", actions: [searchAction, putOf("x on " + "a in ".repeat(20_000) + "x", "library", "hand")] }]);
    expect(performance.now() - t0).toBeLessThan(100);
  });
});

describe("Ability.librarySearch: whose library a printed search reads (#1266)", () => {
  const spell = (actions: object[], text?: string) => deriveAbilities([{ id: 1, abilityType: "spell" as const, actions }], undefined, text ? { 1: text } : undefined, undefined, text).abilities;
  const owner = (abilities: Ability[]) => abilities.filter((a) => a.effect.kind === "search").map((a) => a.librarySearch);

  test("your library, a bare object with fromZone library, and 'your library and/or graveyard' are yours", () => {
    expect(owner(spell([{ verb: "search", object: "your library for a card", fromZone: null }], "Search your library for a card, put it into your hand, then shuffle."))).toEqual(["yours"]);
    expect(owner(spell([{ verb: "search", object: "a card", fromZone: "library" }], "Search your library for a card."))).toEqual(["yours"]);
    expect(owner(spell([{ verb: "search", object: "a card", fromZone: "library" }]))).toEqual(["yours"]);
    expect(owner(spell([{ verb: "search", object: "your library and/or graveyard", fromZone: null }], "Search your library and/or graveyard for a card named X."))).toEqual(["yours"]);
  });

  test("another player's library, or another player searching, is other", () => {
    expect(owner(spell([{ verb: "search", object: "that player's library for a card", fromZone: "library" }], "Target player loses 1 life. Search that player's library for a card."))).toEqual(["other"]);
    expect(owner(spell([{ verb: "search", object: "a card", fromZone: "library" }], "Each of them searches their library for a card."))).toEqual(["other"]);
    expect(owner(spell([{ verb: "search", object: "a card", fromZone: "library" }], "Each friend searches their library for a card."))).toEqual(["other"]);
    expect(owner(spell([{ verb: "search", object: "their library for a basic land card", fromZone: "library" }], "Exile target creature. Its controller may search their library for a basic land card."))).toEqual(["other"]);
  });

  test("a graveyard-only search, and a typed dig, carry no field", () => {
    expect(spell([{ verb: "search", object: "a card", fromZone: "graveyard" }], "Search your graveyard for a card.").some((a) => a.librarySearch !== undefined)).toBe(false);
    const dig = spell([{ verb: "put", object: "a creature card from the top five cards of your library", fromZone: "library", toZone: "hand" }], "Look at the top five cards of your library. Put a creature card from among them into your hand.");
    expect(dig.some((a) => a.effect.kind === "search")).toBe(true);
    expect(dig.some((a) => a.librarySearch !== undefined)).toBe(false);
  });
});

describe("Ability.librarySearch: stored-answer shapes (#1266)", () => {
  const spell = (actions: object[], text: string) => deriveAbilities([{ id: 1, abilityType: "spell" as const, actions }], undefined, { 1: text }, undefined, text).abilities;
  const owner = (abilities: Ability[]) => abilities.filter((a) => a.effect.kind === "search").map((a) => a.librarySearch);

  test("a model-written dig that says `search` but prints none carries no field (Winota)", () => {
    const text = "Look at the top six cards of your library. You may put a Human creature card from among them onto the battlefield tapped and attacking.";
    expect(owner(spell([{ verb: "search", object: "a Human creature card", fromZone: "library", toZone: "battlefield" }], text))).toEqual([undefined]);
  });

  test("a comma lead-in is no actor: 'Whenever ... deals combat damage to a player, search your library' is yours (Kodama)", () => {
    expect(owner(spell([{ verb: "search", object: "basic land card", fromZone: "library" }], "Whenever a modified creature you control deals combat damage to a player, search your library for a basic land card."))).toEqual(["yours"]);
  });

  test("two searches in one clause are read by their own printed verb (Demolition Field)", () => {
    const text = "Destroy target nonbasic land an opponent controls. That land's controller may search their library for a basic land card. You may search your library for a basic land card.";
    expect(owner(spell([{ verb: "search", object: "their library for a basic land card", fromZone: "library" }, { verb: "search", object: "your library for a basic land card", fromZone: "library" }], text))).toEqual(["other", "yours"]);
  });

  test("'your graveyard, hand, and/or library' is yours (Boonweaver Giant)", () => {
    expect(owner(spell([{ verb: "search", object: "your graveyard, hand, and/or library for an Aura card", fromZone: null }], "When this creature enters, you may search your graveyard, hand, and/or library for an Aura card."))).toEqual(["yours"]);
  });
});

describe("Ability.librarySearch: owner after the zone list, and non-library searches (#1266 review)", () => {
  const spell = (actions: object[], text: string) => deriveAbilities([{ id: 1, abilityType: "spell" as const, actions }], undefined, { 1: text }, undefined, text).abilities;
  const owner = (abilities: Ability[]) => abilities.filter((a) => a.effect.kind === "search").map((a) => a.librarySearch);

  test("'the graveyard, hand, and library of that spell's controller' is other (Invasive Surgery)", () => {
    const text = "Counter target instant or sorcery spell. Delirium -- Search the graveyard, hand, and library of that spell's controller for any number of cards with the same name as that spell, exile them, then that player shuffles.";
    expect(owner(spell([{ verb: "search", object: "any number of cards with the same name as that spell", fromZone: "graveyard" }], text))).toEqual(["other"]);
  });

  test("'the library of target opponent' is other", () => {
    expect(owner(spell([{ verb: "search", object: "a card", fromZone: "library" }], "Search the library of target opponent for a card."))).toEqual(["other"]);
  });

  test("a search of a pile is not a library search (Phyrexian Portal)", () => {
    const text = "Search the other pile for a card, put it into your hand.";
    expect(owner(spell([{ verb: "search", object: "a card", fromZone: "library" }], text))).toEqual([undefined]);
  });
});

describe("a stored search of a bare library takes its card from the put that follows (#1266, Tempt with Discovery)", () => {
  const searches = (actions: object[]) => deriveAbilities([{ id: 1, abilityType: "spell" as const, actions }]).abilities.filter((a) => a.effect.kind === "search");
  const put = (object: string) => ({ verb: "put", object, fromZone: "library", toZone: "battlefield" });
  test("'your library' then a put of 'a land card' types the search land, and keeps whose library it is", () => {
    const [mine] = searches([{ verb: "search", object: "your library", fromZone: "library" }, put("a land card")]);
    expect(mine!.effect.subject?.type).toBe("land");
    expect(mine!.librarySearch).toBe("yours");
    const [theirs] = searches([{ verb: "search", object: "their library", fromZone: "library" }, put("a land card")]);
    expect(theirs!.effect.subject?.type).toBe("land");
    expect(theirs!.librarySearch).toBe("other");
  });
  test("a put of a pronoun leaves the search untyped", () => {
    const [s] = searches([{ verb: "search", object: "your library", fromZone: "library" }, put("it")]);
    expect(s!.effect.subject?.type).toBeUndefined();
  });
});

describe("retarget: a change-the-target of a TARGET spell or ability (#1266, CR 115.7)", () => {
  const spell = (object: string, verb = "other") => deriveAbilities([{ id: 1, abilityType: "spell" as const, actions: [{ verb, object }] }]);
  const retargets = (r: ReturnType<typeof spell>) => r.abilities.filter((a) => a.effect.kind === "retarget");

  test("'change the target of target spell with a single target' is a retarget of a targeted spell (Misdirection)", () => {
    const r = spell("change the target of target spell with a single target");
    const [a] = retargets(r);
    expect(a!.effect.subject).toMatchObject({ type: "spell", scope: "target" });
    expect(a!.effect.subject?.abilityKind).toBeUndefined();
    expect(r.unclaimed).toHaveLength(0);
  });

  test("'choose new targets for target spell' is one too (Redirect)", () => {
    const r = spell("choose new targets for target spell");
    expect(retargets(r)).toHaveLength(1);
    expect(r.unclaimed).toHaveLength(0);
  });

  test("'target spell or ability' names the spell AND both ability kinds (Bolt Bend, Willbender)", () => {
    const [a] = retargets(spell("change the target of target spell or ability with a single target"));
    expect(a!.effect.subject).toMatchObject({ type: "spell", scope: "target", abilityKind: ["activated", "triggered"] });
  });

  test("'target activated ability' is the activated kind alone (Reroute)", () => {
    const [a] = retargets(spell("change the target of target activated ability with a single target"));
    expect(a!.effect.subject?.abilityKind).toEqual(["activated"]);
    expect(a!.effect.subject?.scope).toBe("target");
  });

  test("a class of spell keeps its type, and a 'that targets only ...' tail is cut so only type and scope are carried (Muck Drubb)", () => {
    const [a] = retargets(spell("change the target of target instant or sorcery spell with a single target to this creature"));
    expect(a!.effect.subject?.type).toEqual(["instant", "sorcery"]);
    const [b] = retargets(spell("change the target of target spell that targets only a single creature to this creature"));
    expect(b!.effect.subject).toMatchObject({ type: "spell", scope: "target" });
  });

  test("the model's cost-modify misfile of the same words is read by its words (Divert)", () => {
    expect(retargets(spell("change the target of target spell or ability with a single target", "cost-modify"))).toHaveLength(1);
    expect(retargets(spell("change the targets of target instant or sorcery spell", "cost-modify"))).toHaveLength(1);
  });

  test("the model's words under cost-modify or exchange with the head in the CLAUSE are read from it (Shunt, Silver Wyvern, Spellskite, Meddle)", () => {
    const from = (verb: string, object: string, text: string, abilityType: "spell" | "activated" = "spell") =>
      deriveAbilities([{ id: 1, abilityType, actions: [{ verb, object }] }], undefined, { 1: text });
    const shunt = from("cost-modify", "target spell with a single target", "Change the target of target spell with a single target.");
    expect(retargets(shunt)).toHaveLength(1);
    expect(shunt.unclaimed).toHaveLength(0);
    const wyvern = from("cost-modify", "the target of target spell or ability that targets only this creature", "{U}: Change the target of target spell or ability that targets only this creature. The new target must be a creature.", "activated");
    expect(retargets(wyvern)[0]!.effect.subject).toMatchObject({ type: "spell", scope: "target", abilityKind: ["activated", "triggered"] });
    const skite = from("exchange", "a target of target spell or ability and this creature", "{U/P}: Change a target of target spell or ability to this creature.", "activated");
    expect(retargets(skite)).toHaveLength(1);
    const meddle = from("cost-modify", "change that spell's target to another creature", "If target spell has only one target and that target is a creature, change that spell's target to another creature.");
    expect(retargets(meddle)[0]!.effect.subject).toMatchObject({ type: "spell", scope: "target" });
  });

  test("a sibling `other` action of a retargeting clause is not read as a second retarget (Wyll's Reversal)", () => {
    const text = "You may choose new targets for the target spell or ability. Then copy it. You may choose new targets for the copy.";
    const r = deriveAbilities([{ id: 1, abilityType: "spell" as const, actions: [
      { verb: "other", object: "choose new targets for the target spell or ability" }, { verb: "copy", object: "that spell or ability" }, { verb: "other", object: "choose new targets for the copy" }] }], undefined, { 1: text });
    expect(retargets(r)).toHaveLength(1);
  });

  test("a retarget action in a clause that also gains control of a spell is the steal's rider, whatever the model wrote (Aethersnatch)", () => {
    const text = "Gain control of target spell. You may choose new targets for it.";
    const r = deriveAbilities([{ id: 1, abilityType: "spell" as const, actions: [{ verb: "gain-control", object: "target spell" }, { verb: "other", object: "choose new targets for target spell" }] }], undefined, { 1: text });
    expect(retargets(r)).toHaveLength(0);
  });

  test("a steal's 'choose new targets for it' is no retarget (Commandeer)", () => {
    const text = "Gain control of target noncreature spell. You may choose new targets for it.";
    const r = deriveAbilities([{ id: 1, abilityType: "spell" as const, actions: [{ verb: "gain-control", object: "target noncreature spell" }, { verb: "other", object: "you may choose new targets for it" }] }], undefined, { 1: text });
    expect(retargets(r)).toHaveLength(0);
  });

  test("your OWN COPY is not stack interaction (#491)", () => {
    for (const object of ["choose new targets for the copy", "you may choose new targets for the copy", "the copy may have new targets chosen for it"]) {
      expect(retargets(spell(object))).toHaveLength(0);
    }
    expect(retargets(spell("choose new targets for the copy", "grant-ability"))).toHaveLength(0);
  });

  test("a bare 'that spell' or 'it' is no target spell and stays unclaimed", () => {
    expect(retargets(spell("the spell's controller may choose new targets for it"))).toHaveLength(0);
    expect(retargets(spell("choose new targets for that spell"))).toHaveLength(0);
  });

  test("a text change is not a target change", () => {
    expect(retargets(spell("Change the text of target spell or permanent by replacing all instances of one color word with another"))).toHaveLength(0);
  });

  test("the head scan is linear on a long run of spaces", () => {
    const t0 = performance.now();
    spell("change the target of " + " ".repeat(50_000) + "target spell");
    spell("choose new targets for ".repeat(5_000) + "x");
    expect(performance.now() - t0).toBeLessThan(200);
  });
});

describe("evasion: a restriction on being blocked (#1315, CR 509.1b)", () => {
  const run = (abilityType: "static" | "spell" | "triggered" | "activated", object: string, text: string, name = "Test") =>
    deriveAbilities([{ id: 1, abilityType, actions: [{ verb: "cant", object }] }] as never, name, { 1: text }, undefined, text).abilities;
  const evasion = (a: ReturnType<typeof run>) => a.filter((x) => x.effect.kind === "evasion");

  test("an Aura's 'enchanted creature can't be blocked' is a static evasion with no named host (Cloak of Mists, Aqueous Form)", () => {
    const [a] = evasion(run("static", "be blocked", "Enchanted creature can't be blocked.", "Cloak of Mists"));
    expect(a!.kind).toBe("static");
    expect(a!.effect.subject).toBeUndefined();
  });

  test("the restricted forms all read (Invisibility, Seeker, Kithkin Armor, Field of Reality, Canopy Cover)", () => {
    for (const [object, text] of [
      ["be blocked except by Walls", "Enchanted creature can't be blocked except by Walls."],
      ["be blocked except by artifact creatures and/or white creatures", "Enchanted creature can't be blocked except by artifact creatures and/or white creatures."],
      ["be blocked by creatures with power 3 or greater", "Enchanted creature can't be blocked by creatures with power 3 or greater."],
      ["be blocked by Spirits", "Enchanted creature can't be blocked by Spirits."],
      ["be blocked except by creatures with flying or reach", "Enchanted creature can't be blocked except by creatures with flying or reach."],
    ] as const) expect(evasion(run("static", object, text)), text).toHaveLength(1);
  });

  test("a creature's own 'this creature can't be blocked' in a trigger is self (Cunning Survivor)", () => {
    const [a] = evasion(run("triggered", "this creature can't be blocked", "Whenever you cycle or discard a card, this creature gets +1/+0 until end of turn and can't be blocked this turn.", "Cunning Survivor"));
    expect(a!.effect.subject?.self).toBe(true);
  });

  test("a one-shot 'target creature can't be blocked this turn' names its target", () => {
    const [a] = evasion(run("spell", "be blocked this turn", "Target creature can't be blocked this turn."));
    expect(a!.effect.subject).toMatchObject({ type: "creature", scope: "target" });
  });

  test("sentences the model files as `cant | ... be blocked ...` but the card does not print are not evasion (protection, defender, swampwalk)", () => {
    expect(evasion(run("static", "be blocked by Vampires, be blocked by Werewolves, or be blocked by Zombies", "Protection from Vampires, from Werewolves, and from Zombies"))).toHaveLength(0);
    expect(evasion(run("activated", "this creature can't be blocked by defender creatures as though it didn't have defender", "{2}{G}: This creature can attack this turn as though it didn't have defender."))).toHaveLength(0);
    expect(evasion(run("static", "be blocked as though they didn't have swampwalk", "Creatures with swampwalk can be blocked as though they didn't have swampwalk."))).toHaveLength(0);
  });

  test("a granted ability's 'this creature can't be blocked' is evasion with no named subject, never self (Rime Transfusion)", () => {
    const [a] = evasion(run("activated", "this creature can't be blocked this turn except by snow creatures", "Enchanted creature gets +2/+1 and has \"{S}: This creature can't be blocked this turn except by snow creatures.\"", "Rime Transfusion"));
    expect(a!.effect.subject?.self).toBeUndefined();
    expect(a!.effect.subject?.type).toBeUndefined();
  });

  test("'must be blocked' filed as a cant, 'can't block' and a payable block restriction are not evasion", () => {
    expect(evasion(run("static", "not be blocked", "Gorm must be blocked if able."))).toHaveLength(0);
    expect(evasion(run("spell", "target creature can't block this turn", "Target creature can't block this turn."))).toHaveLength(0);
    const tax = run("static", "be blocked unless defending player pays {3}", "This creature can't be blocked unless defending player pays {3}.");
    expect(evasion(tax)).toHaveLength(0);
    expect(tax.some((x) => x.effect.kind === "tax")).toBe(true);
  });
});

describe("a spell answered by a return, exile or steal is a spell ON THE STACK, and a chosen spell keeps its target (#1266)", () => {
  const run = (records: object[], text: string) => deriveAbilities(records as never, "Test", { 1: text, 2: text }, undefined, text).abilities;
  const emitsOf = (abilities: Ability[], verb: string) => abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === verb);

  test("'return target spell or permanent' is a leave of the spell off the stack AND of the permanent off the battlefield (Venser)", () => {
    const t = "When this creature enters, return target spell or permanent to its owner's hand.";
    const leaves = emitsOf(run([{ id: 1, abilityType: "triggered", trigger: { event: "enters", subject: "this creature" }, actions: [{ verb: "return", object: "target spell or permanent", toZone: "hand" }] }], t), "leaves");
    expect(leaves.find((e) => e.subject.fromZone === "stack")!.subject).toMatchObject({ type: "spell", scope: "target", fromZone: "stack" });
    expect(leaves.find((e) => e.subject.fromZone === "battlefield")!.subject.type).toEqual(["creature", "artifact", "enchantment", "planeswalker", "battle"]);
  });

  test("'target spell or creature' keeps its creature half off the battlefield (Unsubstantiate)", () => {
    const leaves = emitsOf(run([{ id: 1, abilityType: "spell", actions: [{ verb: "return", object: "target spell or creature", toZone: "hand" }] }], "Return target spell or creature to its owner's hand."), "leaves");
    expect(leaves.map((e) => [e.subject.type, e.subject.fromZone]).sort()).toEqual([["creature", "battlefield"], ["spell", "stack"]]);
  });

  test("'target spell or permanent with mana value 1 or greater' puts the mana value on the spell half (Divide by Zero)", () => {
    const leaves = emitsOf(run([{ id: 1, abilityType: "spell", actions: [{ verb: "return", object: "target spell or permanent with mana value 1 or greater", toZone: "hand" }] }], "Return target spell or permanent with mana value 1 or greater to its owner's hand."), "leaves");
    expect(leaves.find((e) => e.subject.fromZone === "stack")!.subject.stats).toEqual([{ metric: "mana-value", op: "gte", value: 1 }]);
  });

  test("'exile that spell' after 'counter target artifact or enchantment spell' keeps the card types (Defabricate, Deny Existence)", () => {
    const t = "Counter target artifact or enchantment spell. If that spell is countered this way, exile it instead of putting it into its owner's graveyard.";
    const [e] = emitsOf(run([{ id: 1, abilityType: "spell", actions: [{ verb: "counter-spell", object: "target artifact or enchantment spell" }, { verb: "exile", object: "that spell", fromZone: "stack", toZone: "exile" }] }], t), "exiled");
    expect(e!.subject).toMatchObject({ type: ["artifact", "enchantment"], scope: "target", fromZone: "stack" });
    const split = emitsOf(run([{ id: 1, abilityType: "spell", actions: [{ verb: "vote", object: "denial or duplication" }, { verb: "counter-spell", object: "the spell" }] }], "Choose target instant or sorcery spell. If denial gets more votes, counter the spell."), "counter-spell");
    expect(split[0]!.subject).toMatchObject({ type: ["instant", "sorcery"], scope: "target" });
    expect(split[0]!.subject.fromZone).toBeUndefined();
  });

  test("the card a countered spell puts onto the battlefield has the card types the sentence names (Desertion)", () => {
    const t = "Counter target spell. If an artifact or creature spell is countered this way, put that card onto the battlefield under your control instead of into its owner's graveyard.";
    const [e] = emitsOf(run([{ id: 1, abilityType: "spell", actions: [{ verb: "counter-spell", object: "target spell" }, { verb: "put", object: "that card", fromZone: "stack", toZone: "battlefield" }] }], t), "enters");
    expect([e!.subject.type].flat().sort()).toEqual(["artifact", "creature"]);
    expect(e!.subject.fromZone).toBe("stack");
  });

  test("a mixed object the model stored as `stack` still has its permanent half on the battlefield (Swat Away)", () => {
    const leaves = emitsOf(run([{ id: 1, abilityType: "spell", actions: [{ verb: "put", object: "target spell or creature", fromZone: "stack", toZone: "library" }] }], "The owner of target spell or creature puts it on their choice of the top or bottom of their library."), "leaves");
    expect(leaves.map((e) => [e.subject.type, e.subject.fromZone]).sort()).toEqual([["creature", "battlefield"], ["spell", "stack"]]);
  });

  test("'return target spell' is a leave off the stack, not the battlefield (Reprieve)", () => {
    const leaves = emitsOf(run([{ id: 1, abilityType: "spell", actions: [{ verb: "return", object: "target spell", fromZone: "stack", toZone: "hand" }] }], "Return target spell to its owner's hand."), "leaves");
    expect(leaves).toHaveLength(1);
    expect(leaves[0]!.subject).toMatchObject({ type: "spell", scope: "target", fromZone: "stack" });
  });

  test("'gain control of target noncreature spell' is a spell that is not a creature, on the stack, targeted (Commandeer)", () => {
    const [g] = emitsOf(run([{ id: 1, abilityType: "spell", actions: [{ verb: "gain-control", object: "target noncreature spell" }] }], "Gain control of target noncreature spell."), "gains-control");
    expect(g!.subject).toMatchObject({ type: "spell", notType: ["creature"], scope: "target", fromZone: "stack", control: "you" });
  });

  test("a spell that targets only a permanent is a spell, not a permanent (Chef's Kiss)", () => {
    const [g] = emitsOf(run([{ id: 1, abilityType: "spell", actions: [{ verb: "gain-control", object: "target spell that targets only a single permanent or player" }] }], "Gain control of target spell that targets only a single permanent or player."), "gains-control");
    expect(g!.subject).toMatchObject({ type: "spell", scope: "target", fromZone: "stack", restricted: true });
  });

  test("'exile target instant or sorcery spell that targets you' is an exile of those spells off the stack (Shell of the Last Kappa)", () => {
    const [e] = emitsOf(run([{ id: 1, abilityType: "activated", actions: [{ verb: "exile", object: "target instant or sorcery spell that targets you", fromZone: "stack", toZone: "exile" }] }], "{3}, {T}: Exile target instant or sorcery spell that targets you."), "exiled");
    expect(e!.subject).toMatchObject({ type: ["instant", "sorcery"], scope: "target", fromZone: "stack" });
  });

  test("'exile target spell with mana value 4 or less' is off the stack and carries the mana value (Spell Queller)", () => {
    const abilities = run([{ id: 1, abilityType: "triggered", trigger: { event: "enters", subject: "this creature" }, actions: [{ verb: "exile", object: "target spell with mana value 4 or less", toZone: "exile" }] }], "When this creature enters, exile target spell with mana value 4 or less.");
    for (const verb of ["exiled", "leaves"]) {
      expect(emitsOf(abilities, verb)[0]!.subject).toMatchObject({ type: "spell", scope: "target", fromZone: "stack", stats: [{ metric: "mana-value", op: "lte", value: 4 }] });
    }
  });

  test("'counter the chosen spell' after 'Choose target spell' is a targeted counter (Swallowed by Leviathan)", () => {
    const t = "Choose target spell. Surveil 2, then counter the chosen spell unless its controller pays {1} for each card in your graveyard.";
    const [c] = emitsOf(run([{ id: 1, abilityType: "spell", actions: [{ verb: "surveil", object: "2" }, { verb: "counter-spell", object: "the chosen spell" }] }], t), "counter-spell");
    expect(c!.subject).toMatchObject({ type: "spell", scope: "target" });
  });

  test("Split Decision's 'counter the spell' and Invert Polarity's steal and counter are targeted", () => {
    const split = run([{ id: 1, abilityType: "spell", actions: [{ verb: "vote", object: "denial or duplication" }, { verb: "counter-spell", object: "the spell" }] }], "Will of the council -- Choose target instant or sorcery spell. Starting with you, each player votes for denial or duplication. If denial gets more votes, counter the spell.");
    expect(emitsOf(split, "counter-spell")[0]!.subject.scope).toBe("target");
    const t = "Choose target spell, then flip a coin. If you win the flip, gain control of that spell and you may choose new targets for it. If you lose the flip, counter that spell.";
    const invert = run([{ id: 1, abilityType: "spell", actions: [{ verb: "flip-coin", object: "a coin" }, { verb: "gain-control", object: "that spell" }, { verb: "counter-spell", object: "that spell" }] }], t);
    expect(emitsOf(invert, "counter-spell")[0]!.subject.scope).toBe("target");
    expect(emitsOf(invert, "gains-control")[0]!.subject).toMatchObject({ type: "spell", scope: "target", fromZone: "stack" });
  });

  test("a bid stored as one `other` still counters 'that spell', targeted (Mages' Contest)", () => {
    const t = "You and target spell's controller bid life. You start the bidding with a bid of 1. In turn order, each player may raise the high bid. The bidding ends if the high bid stands. The high bidder loses life equal to the high bid. If you win the bidding, counter that spell.";
    const [c] = emitsOf(run([{ id: 1, abilityType: "spell", actions: [{ verb: "other", object: t }] }], t), "counter-spell");
    expect(c!.subject).toMatchObject({ type: "spell", scope: "target" });
  });

  test("'counter that spell' on a trigger that names no target spell is NOT targeted (Counterbalance, Kira)", () => {
    const cb = run([{ id: 1, abilityType: "triggered", trigger: { event: "cast", subject: "a spell", control: "opponent" }, actions: [{ verb: "counter-spell", object: "that spell" }] }], "Whenever an opponent casts a spell, you may reveal the top card of your library. If you do, counter that spell if it has the same mana value as the revealed card.");
    expect(emitsOf(cb, "counter-spell")[0]!.subject.scope).toBeUndefined();
    const kira = run([{ id: 1, abilityType: "triggered", trigger: { event: "becomes-target", subject: "this creature" }, actions: [{ verb: "counter-spell", object: "that spell" }] }], "Whenever a creature you control becomes the target of a spell or ability for the first time each turn, counter that spell.");
    expect(emitsOf(kira, "counter-spell")[0]!.subject.scope).toBeUndefined();
  });

  test("the sentence scan is linear on a long text", () => {
    const t0 = performance.now();
    const text = "target ".repeat(20_000) + "x. " + "a. ".repeat(20_000) + "counter that spell";
    expect(targetsASpellEarlier(text, "that spell")).toBe(false);
    expect(targetsASpellEarlier("target ".repeat(20_000) + "spell. counter that spell", "that spell")).toBe(true);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

// #1266 (graveyardHate): an `exiled` emit from a graveyard says whose graveyard it is, so a rule can tell hate from
// "exile that card from YOUR graveyard" (Necropotence, delve-shaped costs, Living Death's round trip).
describe("#1266 graveyard owner on an exiled emit", () => {
  const exiledOf = (clauses: Parameters<typeof deriveAbilities>[0], name: string, texts: Record<number, string>) =>
    deriveAbilities(clauses, name, texts).abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "exiled");

  it("Necropotence: a discard exiled from your graveyard is yours", () => {
    const [e] = exiledOf([{ id: 2, abilityType: "triggered", trigger: { event: "discarded", subject: "a card", control: "you" },
      actions: [{ verb: "exile", object: "that card", fromZone: "graveyard", toZone: "exile" }] }],
    "Necropotence", { 2: "Whenever you discard a card, exile that card from your graveyard." });
    expect(e?.subject.fromZone).toBe("graveyard");
    expect(e?.subject.owner).toBe("you");
  });

  it("a discard trigger by you that names no graveyard still puts the card in yours", () => {
    const [e] = exiledOf([{ id: 2, abilityType: "triggered", trigger: { event: "discarded", subject: "a card", control: "you" },
      actions: [{ verb: "exile", object: "that card", fromZone: "graveyard", toZone: "exile" }] }],
    "Test Card", { 2: "Whenever you discard a card, exile it." });
    expect(e?.subject.owner).toBe("you");
  });

  it("Purgatory: a card put into your graveyard, exiled, is yours (fromZone read off the zone the event names)", () => {
    const [e] = exiledOf([{ id: 1, abilityType: "triggered", trigger: { event: "dies", subject: "a nontoken creature", control: "you" },
      actions: [{ verb: "exile", object: "that card" }] }],
    "Purgatory", { 1: "Whenever a nontoken creature is put into your graveyard from the battlefield, exile that card." });
    expect(e?.subject.fromZone).toBe("graveyard");
    expect(e?.subject.owner).toBe("you");
  });

  it("an opponent's creature dying and exiled is not yours", () => {
    const [e] = exiledOf([{ id: 1, abilityType: "triggered", trigger: { event: "dies", subject: "a creature", control: "opp" },
      actions: [{ verb: "exile", object: "that card" }] }],
    "Test Card", { 1: "Whenever a creature an opponent controls dies, exile it." });
    expect(e?.subject.owner).not.toBe("you");
  });

  it("exile target card from your graveyard: yours", () => {
    const [e] = exiledOf([{ id: 1, abilityType: "spell", actions: [{ verb: "exile", object: "target card from your graveyard", fromZone: "graveyard", toZone: "exile" }] }],
    "Test Card", { 1: "Exile target card from your graveyard." });
    expect(e?.subject.owner).toBe("you");
  });

  it("a cost that exiles another card from your graveyard (Helbrute, delve-shaped): yours", () => {
    const [e] = exiledOf([{ id: 2, abilityType: "static", actions: [{ verb: "exile", object: "another creature card", fromZone: "graveyard", toZone: "exile" }] }],
    "Helbrute", { 2: "You may cast this card from your graveyard by exiling another creature card from your graveyard in addition to paying its other costs." });
    expect(e?.subject.owner).toBe("you");
  });

  it("Living Death: each player exiles from their own graveyard and gets the cards back, which is no one else's yard", () => {
    const [e] = exiledOf([{ id: 1, abilityType: "spell", actions: [
      { verb: "exile", object: "all creature cards from their graveyard", fromZone: "graveyard", toZone: "exile" },
      { verb: "sacrifice", object: "all creatures they control" },
      { verb: "put", object: "all cards they exiled this way", fromZone: "exile", toZone: "battlefield" }] }],
    "Living Death", { 1: "Each player exiles all creature cards from their graveyard, then sacrifices all creatures they control, then puts all cards they exiled this way onto the battlefield." });
    expect(e?.subject.owner).toBe("you");
  });

  it("each player exiling from their graveyard with nothing coming back is not yours (Grave Consequences)", () => {
    const [e] = exiledOf([{ id: 1, abilityType: "spell", actions: [{ verb: "exile", object: "any number of cards from their graveyard", fromZone: "graveyard", toZone: "exile" }] }],
    "Grave Consequences", { 1: "Each player may exile any number of cards from their graveyard." });
    expect(e?.subject.owner).not.toBe("you");
  });

  it("exile up to three target cards from a single graveyard: not yours, from the graveyard", () => {
    const [e] = exiledOf([{ id: 2, abilityType: "triggered", trigger: { event: "enters", subject: "this creature", control: "you" },
      actions: [{ verb: "exile", object: "up to three target cards from a single graveyard", fromZone: "graveyard", toZone: "exile" }] }],
    "Decompose", { 2: "When this enters, exile up to three target cards from a single graveyard." });
    expect(e?.subject.fromZone).toBe("graveyard");
    expect(e?.subject.owner).not.toBe("you");
  });

  it("Erebos's Intervention: 'target cards from graveyards' with no stored zone is a graveyard exile, not yours", () => {
    const [e] = exiledOf([{ id: 3, abilityType: "spell", actions: [{ verb: "exile", object: "up to twice X target cards from graveyards" }] }],
    "Erebos's Intervention", { 3: "Exile up to twice X target cards from graveyards." });
    expect(e?.subject.fromZone).toBe("graveyard");
    expect(e?.subject.owner).not.toBe("you");
  });

  it.each([
    ["Blue Mage's Cane", "up to one target instant or sorcery card from defending player's graveyard", "Whenever this creature attacks, exile up to one target instant or sorcery card from defending player's graveyard."],
    ["Abstergo Entertainment", "all graveyards", "Then exile all graveyards."],
    ["Nurgle's Conscription", "that player's graveyard", "Then exile that player's graveyard."],
    ["Crabomination", "a card at random from target opponent's graveyard", "Target opponent exiles a card at random from their graveyard."],
    ["Cry of the Carnarium", "all creature cards in all graveyards that were put there from the battlefield this turn", "Exile all creature cards in all graveyards that were put there from the battlefield this turn."],
  ])("%s: the exile names a graveyard, so it is a graveyard exile and not yours", (name, object, text) => {
    const [e] = exiledOf([{ id: 1, abilityType: "spell", actions: [{ verb: "exile", object }] }], name, { 1: text });
    expect(e?.subject.fromZone).toBe("graveyard");
    expect(e?.subject.owner).not.toBe("you");
  });

  it("Nurgle's Conscription: that player's graveyard after 'from an opponent's graveyard' is the opponent's", () => {
    const abilities = deriveAbilities([{ id: 1, abilityType: "spell", actions: [
      { verb: "put", object: "target creature card from an opponent's graveyard", fromZone: "graveyard", toZone: "battlefield" },
      { verb: "exile", object: "that player's graveyard" }] }],
    "Nurgle's Conscription", { 1: "Put target creature card from an opponent's graveyard onto the battlefield tapped under your control, then exile that player's graveyard." }).abilities;
    const ex = abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "exiled");
    expect(ex.length).toBeGreaterThan(0);
    expect(ex.every((e) => e.subject.control === "opp" && e.subject.owner !== "you" && e.subject.fromZone === "graveyard")).toBe(true);
  });

  it("Go Blank: exile that player's graveyard is not yours", () => {
    const [e] = exiledOf([{ id: 1, abilityType: "spell", actions: [{ verb: "exile", object: "that player's graveyard", fromZone: "graveyard", toZone: "exile" }] }],
    "Go Blank", { 1: "Target player discards two cards. Then exile that player's graveyard." });
    expect(e?.subject.owner).not.toBe("you");
  });

  it("a battlefield half beside the graveyard half keeps the model's zone (Angel of Serenity)", () => {
    const [e] = exiledOf([{ id: 2, abilityType: "triggered", trigger: { event: "enters", subject: "this creature", control: "you" },
      actions: [{ verb: "exile", object: "up to three other target creatures from the battlefield and/or creature cards from graveyards" }] }],
    "Angel of Serenity", { 2: "When this creature enters, you may exile up to three other target creatures from the battlefield and/or creature cards from graveyards." });
    expect(e?.subject.fromZone).toBeUndefined();
  });

  it("a replacement rider's exile is not read as a graveyard exile here (Bosium Strip, #1306)", () => {
    const es = exiledOf([{ id: 1, abilityType: "activated", actions: [{ verb: "exile", object: "instant and sorcery spells from the top of your graveyard" }] }],
    "Bosium Strip", { 1: "Until end of turn, you may cast instant and sorcery spells from the top of your graveyard. If a spell cast this way would be put into a graveyard, exile it instead." });
    expect(es.every((e) => e.subject.fromZone !== "graveyard")).toBe(true);
  });

  it("a replacement rider's 'exile it instead' keeps its emit unmarked (Maestros Ascendancy, #1306)", () => {
    const es = exiledOf([{ id: 1, abilityType: "static", actions: [{ verb: "exile", object: "a spell cast this way", fromZone: "graveyard", toZone: "exile" }] }],
    "Maestros Ascendancy", { 1: "If a spell cast this way would be put into your graveyard, exile it instead." });
    expect(es.every((e) => e.subject.owner === undefined)).toBe(true);
  });

  it("'from the battlefield OR creature card from a graveyard' is not a graveyard-only object (Savior of Ollenbock)", () => {
    expect(exileNamesOnlyGraveyards("up to one other target creature from the battlefield or creature card from a graveyard")).toBe(false);
    expect(exileNamesOnlyGraveyards("up to three other target creatures from the battlefield and/or creature cards from graveyards")).toBe(false);
    expect(exileNamesOnlyGraveyards("up to twice X target cards from graveyards")).toBe(true);
  });

  it("'this artifact and all cards from all graveyards' does not zone the self-exile to a graveyard (Silent Gravestone)", () => {
    const es = exiledOf([{ id: 2, abilityType: "activated", actions: [{ verb: "exile", object: "this artifact and all cards from all graveyards" }] }],
    "Silent Gravestone", { 2: "{3}, {T}: Exile this artifact and all cards from all graveyards." });
    expect(es.every((e) => e.subject.fromZone !== "graveyard")).toBe(true);
  });

  it("a rider's 'a spell cast from your graveyard this way' is left unmarked (Gale, #1306)", () => {
    const es = exiledOf([{ id: 1, abilityType: "triggered", trigger: { event: "cast", subject: "an instant or sorcery spell", control: "you" },
      actions: [{ verb: "exile", object: "a spell cast from your graveyard this way", fromZone: "graveyard", toZone: "exile" }] }],
    "Gale", { 1: "Whenever you cast a spell, you may cast up to one target card from your graveyard. If a spell cast from your graveyard this way would be put into your graveyard, exile it instead." });
    expect(es.every((e) => e.subject.owner === undefined)).toBe(true);
  });

  it.each([
    ["Promise of Tomorrow", { event: "dies", subject: "a creature you control", control: "you" }, "Whenever a creature you control dies, exile it.", "you"],
    ["Cyclopean Mummy", { event: "dies", subject: "this creature", control: "you" }, "When this creature dies, exile it.", "you"],
    ["Eater of Virtue", { event: "dies", subject: "equipped creature", control: "you" }, "Whenever equipped creature dies, exile it.", "you"],
    ["Mari, the Killing Quill", { event: "dies", subject: "a creature an opponent controls", control: "opp" }, "Whenever a creature an opponent controls dies, exile it with a hit counter on it.", undefined],
    ["Mimic Vat", { event: "dies", subject: "a nontoken creature", control: "any" }, "Whenever a nontoken creature dies, you may exile that card.", undefined],
  ] as const)("%s: the card a dies trigger exiles is in the graveyard of whoever the trigger names", (name, trigger, text, owner) => {
    const [e] = exiledOf([{ id: 1, abilityType: "triggered", trigger: { ...trigger }, actions: [{ verb: "exile", object: "it" }] }], name, { 1: text });
    expect(e?.subject.ref).toBe("trigger");
    expect(e?.subject.fromZone).toBe("graveyard");
    expect(e?.subject.owner).toBe(owner);
  });

  it("Nightmare Shepherd: the graveyard-hate EFFECT of an own-trigger exile is owned by you too", () => {
    const a = deriveAbilities([{ id: 1, abilityType: "triggered", trigger: { event: "dies", subject: "another nontoken creature you control", control: "you" }, actions: [{ verb: "exile", object: "it", fromZone: "graveyard", toZone: "exile" }] }],
      "Nightmare Shepherd", { 1: "Whenever another nontoken creature you control dies, you may exile it." }).abilities;
    expect(a.find((x) => x.effect.kind === "graveyard-hate")?.effect.subject?.owner).toBe("you");
  });

  it("Mairsil: 'from your hand or graveyard' is your graveyard (owner you, no graveyard-hate)", () => {
    const a = deriveAbilities([{ id: 1, abilityType: "triggered", trigger: { event: "enters", subject: "Mairsil", control: "you" }, actions: [{ verb: "exile", object: "an artifact or creature card from your hand or graveyard", fromZone: "graveyard", toZone: "exile" }] }],
      "Mairsil, the Pretender", { 1: "When Mairsil enters, you may exile an artifact or creature card from your hand or graveyard and put a cage counter on it." }).abilities;
    expect(a.some((x) => x.effect.kind === "graveyard-hate")).toBe(false);
    expect(a.flatMap((x) => x.emits ?? []).filter((e) => e.verb === "exiled").every((e) => e.subject.owner === "you")).toBe(true);
  });

  it("Planar Void: another card put into any graveyard stays not yours", () => {
    const [e] = exiledOf([{ id: 1, abilityType: "triggered", trigger: { event: "put-into-graveyard", subject: "another card", control: "any" }, actions: [{ verb: "exile", object: "that card" }] }],
      "Planar Void", { 1: "Whenever another card is put into a graveyard from anywhere, exile that card." });
    expect(e?.subject.owner).toBeUndefined();
  });

  it.each([
    ["Carrion Rats", "Whenever this creature attacks or blocks, any player may exile a card from their graveyard."],
    ["Grave Consequences", "Each player may exile any number of cards from their graveyard."],
    ["Axebane Ferox", "Whenever this creature becomes the target of a spell or ability an opponent controls, counter it unless that player exiles cards with total mana value 4 or greater from their graveyard."],
    ["Lost in Thought", "Its controller may exile three cards from their graveyard for that player to ignore this effect until end of turn."],
  ])("%s: an exile the victim chooses is `victimMay`", (name, text) => {
    const es = exiledOf([{ id: 1, abilityType: "static", actions: [{ verb: "exile", object: "cards from their graveyard", fromZone: "graveyard", toZone: "exile" }] }], name, { 1: text });
    expect(es.length).toBeGreaterThan(0);
    expect(es.every((e) => e.victimMay === true)).toBe(true);
  });

  it.each([
    ["Augusta, Order Returned", "Whenever Augusta attacks, each player exiles a card from their graveyard."],
    ["Curse of Oblivion", "At the beginning of enchanted player's upkeep, that player exiles two cards from their graveyard."],
    ["Mudhole", "Target player exiles all land cards from their graveyard."],
  ])("%s: a FORCED exile is not victimMay", (name, text) => {
    const es = exiledOf([{ id: 1, abilityType: "spell", actions: [{ verb: "exile", object: "cards from their graveyard", fromZone: "graveyard", toZone: "exile" }] }], name, { 1: text });
    expect(es.length).toBeGreaterThan(0);
    expect(es.every((e) => e.victimMay !== true)).toBe(true);
  });

  it("an exile that names a hand AND a graveyard keeps the zone the model gave (Identity Crisis stays unzoned)", () => {
    const [e] = exiledOf([{ id: 1, abilityType: "spell", actions: [{ verb: "exile", object: "all cards from target player's hand and graveyard" }] }],
    "Identity Crisis", { 1: "Exile all cards from target player's hand and graveyard." });
    expect(e?.subject.fromZone).toBeUndefined();
  });
});

// #1266 task 2 / #1306: "If <X> would be put into a graveyard, exile it instead" is one shape per kind of X.
describe("#1266 graveyard replacement effects", () => {
  const ab = (clauses: Parameters<typeof deriveAbilities>[0], name: string, texts: Record<number, string>) => deriveAbilities(clauses, name, texts).abilities;
  const exiledEmits = (abilities: Ability[]) => abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "exiled" || e.verb === "leaves");

  it("Leyline of the Void: an opponent's graveyard replacement is graveyard-hate over opp", () => {
    const a = ab([{ id: 2, abilityType: "static", actions: [{ verb: "exile", object: "a card" }] }], "Leyline of the Void",
      { 2: "If a card would be put into an opponent's graveyard from anywhere, exile it instead." });
    const hate = a.find((x) => x.effect.kind === "graveyard-hate");
    expect(hate?.effect.subject?.control).toBe("opp");
    // CR 614.6: the replaced event never happens, so the card never entered (or left) a graveyard: an exiled emit and no `leaves`, no graveyard origin.
    const em = a.flatMap((x) => x.emits ?? []);
    expect(em.some((e) => e.verb === "leaves")).toBe(false);
    expect(em.filter((e) => e.verb === "exiled").length).toBeGreaterThan(0);
    expect(em.every((e) => e.subject.owner !== "you" && e.subject.fromZone !== "graveyard" && e.subject.zone !== "graveyard")).toBe(true);
    expect(em.filter((e) => e.verb === "exiled").every((e) => e.subject.control === "opp")).toBe(true);
  });

  it("Anafenza and Dauthi Voidwalker: hate over opp, an exiled emit and no graveyard leave", () => {
    for (const [name, object, text] of [
      ["Dauthi Voidwalker", "a card", "If a card would be put into an opponent's graveyard from anywhere, instead exile it with a void counter on it."],
      ["Anafenza, the Foremost", "that card", "If a nontoken creature an opponent owns would die or a creature card not on the battlefield would be put into an opponent's graveyard, exile that card instead."],
    ] as const) {
      const a = ab([{ id: 2, abilityType: "static", actions: [{ verb: "exile", object }] }], name, { 2: text });
      expect(a.find((x) => x.effect.kind === "graveyard-hate")?.effect.subject?.control, name).toBe("opp");
      const em = a.flatMap((x) => x.emits ?? []);
      expect(em.some((e) => e.verb === "leaves" || e.subject.fromZone === "graveyard"), name).toBe(false);
    }
  });

  it("Rest in Peace's replacement supplies no graveyard leave either", () => {
    const a = ab([{ id: 2, abilityType: "static", actions: [{ verb: "exile", object: "a card or token" }] }], "Rest in Peace",
      { 2: "If a card or token would be put into a graveyard from anywhere, exile it instead." });
    expect(a.flatMap((x) => x.emits ?? []).some((e) => e.verb === "leaves")).toBe(false);
  });

  it("Sins of the Past: the card's own NAMED exile is not the rider (Invoke Calamity shape)", () => {
    const a = ab([{ id: 1, abilityType: "spell", actions: [
      { verb: "cast", object: "target instant or sorcery card from your graveyard", fromZone: "graveyard", toZone: "stack" },
      { verb: "exile", object: "that spell" },
      { verb: "exile", object: "Sins of the Past" }] }], "Sins of the Past",
    { 1: "Until end of turn, you may cast target instant or sorcery card from your graveyard without paying its mana cost. If that spell would be put into your graveyard, exile it instead. Exile Sins of the Past." });
    const ex = a.flatMap((x) => x.emits ?? []).filter((e) => e.verb === "exiled");
    expect(ex.filter((e) => e.subject.fromZone === "stack")).toHaveLength(1);
    expect(ex.some((e) => e.subject.self === true)).toBe(true);
  });

  it("Yawgmoth's Testament (a library replacement) and Samurai of the Pale Curtain (permanents only) are not read", () => {
    expect(graveyardReplacement("If a card would be put into your graveyard or exile from anywhere this turn, put it on the bottom of your library instead.")).toBeUndefined();
    expect(graveyardReplacement("If a permanent would be put into a graveyard, exile it instead.")).toBeUndefined();
    // the two other cards whose sentence says "instead exile": neither is graveyard hate
    expect(graveyardReplacement("If Ugin's Nexus would be put into a graveyard from the battlefield, instead exile it and take an extra turn after this one.")).toBeUndefined();
    expect(graveyardReplacement("If a card would be put into enchanted player's graveyard from anywhere, instead that card is revealed and put on the bottom of that player's library.")).toBeUndefined();
    expect(graveyardReplacement("If a card would be put into an opponent's graveyard from anywhere, instead exile it with a void counter on it.")).toEqual({ kind: "hate", whose: "opp" });
    expect(graveyardReplacement("If a card or token would be put into a graveyard from anywhere, exile it instead.")?.kind).toBe("hate");
  });

  it("Rest in Peace: 'a graveyard' replacement is graveyard-hate over any", () => {
    const a = ab([{ id: 2, abilityType: "static", actions: [{ verb: "exile", object: "a card or token" }] }], "Rest in Peace",
      { 2: "If a card or token would be put into a graveyard from anywhere, exile it instead." });
    const hate = a.find((x) => x.effect.kind === "graveyard-hate");
    expect(hate?.effect.subject?.control).toBe("any");
    expect(exiledEmits(a).some((e) => e.subject.owner === "you")).toBe(false);
  });

  it("Dryad Militant: an instant or sorcery replacement is graveyard-hate typed instant/sorcery over any", () => {
    const a = ab([{ id: 2, abilityType: "static", actions: [{ verb: "exile", object: "an instant or sorcery card", fromZone: "graveyard" }] }], "Dryad Militant",
      { 2: "If an instant or sorcery card would be put into a graveyard from anywhere, exile it instead." });
    const hate = a.find((x) => x.effect.kind === "graveyard-hate");
    expect(hate?.effect.subject?.control).toBe("any");
    expect(hate?.effect.subject?.type).toEqual(["instant", "sorcery"]);
  });

  it("Valgavoth: 'a card you didn't control ... an opponent's graveyard' is graveyard-hate over opp", () => {
    const a = ab([{ id: 3, abilityType: "static", actions: [{ verb: "exile", object: "a card you didn't control" }] }], "Valgavoth, Terror Eater",
      { 3: "If a card you didn't control would be put into an opponent's graveyard from anywhere, exile it instead." });
    expect(a.find((x) => x.effect.kind === "graveyard-hate")?.effect.subject?.control).toBe("opp");
  });

  it("Sanctifier en-Vec: 'a black or red permanent, spell, or card not on the battlefield' is graveyard-hate over any", () => {
    const a = ab([{ id: 3, abilityType: "static", actions: [{ verb: "exile", object: "it" }] }], "Sanctifier en-Vec",
      { 3: "If a black or red permanent, spell, or card not on the battlefield would be put into a graveyard, exile it instead." });
    expect(a.find((x) => x.effect.kind === "graveyard-hate")?.effect.subject?.control).toBe("any");
  });

  it.each([
    ["Magus of the Will", "cards", "If a card would be put into your graveyard from anywhere this turn, exile that card instead."],
    ["Walk-In Closet", "a card", "When you unlock this door, you may cast spells from your graveyard this turn, and if a card would be put into your graveyard from anywhere this turn, exile it instead."],
  ])("%s: a replacement on YOUR graveyard is no hate and carries no owner", (name, object, text) => {
    const a = ab([{ id: 1, abilityType: "static", actions: [{ verb: "exile", object, fromZone: "graveyard", toZone: "exile" }] }], name, { 1: text });
    expect(a.some((x) => x.effect.kind === "graveyard-hate")).toBe(false);
    expect(exiledEmits(a).every((e) => e.subject.owner === undefined && e.subject.fromZone !== "graveyard")).toBe(true);
  });

  it("a card replacing ITSELF is neither hate nor owned (Waildrifter)", () => {
    const a = ab([{ id: 1, abilityType: "static", actions: [{ verb: "exile", object: "it" }] }], "Waildrifter", { 1: "If Waildrifter would be put into a graveyard from anywhere, exile it instead." });
    expect(a.some((x) => x.effect.kind === "graveyard-hate")).toBe(false);
  });

  it("Kess's rider exiles the spell from the STACK: exiled and leaves say stack, none say graveyard", () => {
    const a = ab([{ id: 2, abilityType: "static", actions: [
      { verb: "cast", object: "an instant or sorcery spell from your graveyard", fromZone: "graveyard", toZone: "stack" },
      { verb: "exile", object: "a spell cast this way", fromZone: "graveyard", toZone: "exile" }] }], "Kess, Dissident Mage",
    { 2: "Once during each of your turns, you may cast an instant or sorcery spell from your graveyard. If a spell cast this way would be put into your graveyard, exile it instead." });
    const rider = exiledEmits(a).filter((e) => e.subject.type === "spell");
    expect(rider.map((e) => e.verb).sort()).toEqual(["exiled", "leaves"]);
    expect(rider.every((e) => e.subject.fromZone === "stack" && e.subject.control === "you")).toBe(true);
    // (the CAST leaves the graveyard, and that is a different, true `leaves`)
    expect(exiledEmits(a).filter((e) => e.verb === "exiled").some((e) => e.subject.fromZone === "graveyard")).toBe(false);
  });

  it("Mavinda: the model's duplicate exile of the cast target is dropped, the rider is the stack exile", () => {
    const a = ab([{ id: 2, abilityType: "activated", actions: [
      { verb: "exile", object: "target instant or sorcery card from your graveyard" },
      { verb: "cast", object: "target instant or sorcery card from your graveyard", fromZone: "graveyard", toZone: "stack" },
      { verb: "exile", object: "that spell" }] }], "Mavinda, Students' Advocate",
    { 2: "{0}: You may cast target instant or sorcery card from your graveyard this turn. If that spell would be put into your graveyard, exile it instead." });
    const ex = exiledEmits(a).filter((e) => e.verb === "exiled");
    expect(ex).toHaveLength(1);
    expect(ex[0]?.subject.fromZone).toBe("stack");
  });

  it("Grip of Amnesia: the exiled cards are cards, not a spell", () => {
    const a = ab([{ id: 1, abilityType: "spell", actions: [{ verb: "counter-spell", object: "target spell" }, { verb: "exile", object: "all cards from target spell's controller's graveyard" }] }], "Grip of Amnesia",
      { 1: "Counter target spell unless its controller exiles all cards from their graveyard." });
    const ex = a.flatMap((x) => x.emits ?? []).filter((e) => e.verb === "exiled");
    expect(ex.length).toBeGreaterThan(0);
    expect(ex.every((e) => e.subject.type !== "spell")).toBe(true);
  });

  it("Bloodbond March: the returned cards are cards, not a spell", () => {
    const a = ab([{ id: 1, abilityType: "triggered", trigger: { event: "cast", subject: "a creature spell", control: "any" },
      actions: [{ verb: "return", object: "all cards with the same name as that spell", fromZone: "graveyard", toZone: "battlefield" }] }], "Bloodbond March",
    { 1: "Whenever a player casts a creature spell, each player returns all cards with the same name as that spell from their graveyard to the battlefield." });
    expect(a.flatMap((x) => x.emits ?? []).filter((e) => e.verb === "enters").every((e) => e.subject.type === "creature")).toBe(true);
  });
});

// #1266 (burn): the recipient a damage / life-loss ability states is the subject it carries, on the effect AND on the emit.
describe("#1266 burn: who a damage or life loss hits", () => {
  const abil = (clauses: Parameters<typeof deriveAbilities>[0], name: string, texts: Record<number, string>) => deriveAbilities(clauses, name, texts).abilities;
  const dmg = (a: ReturnType<typeof abil>) => a.filter((x) => x.effect.kind === "damage");
  const branches = (s: { anyOf?: { player?: boolean; type?: unknown; control?: string }[] } | undefined) => s?.anyOf ?? [];
  const monstrous = (object: string, text: string, name = "Wildfire Cerberus") => abil([{ id: 2, abilityType: "triggered", trigger: { event: "becomes-monstrous", subject: "this creature", control: "you" },
    actions: [{ verb: "deal-damage", object, amount: "2" }] }], name, { 2: text });

  it("Wildfire Cerberus: 'each opponent and each creature they control' keeps the opponent AND the creatures, both the opponent's", () => {
    const [a] = dmg(monstrous("each opponent and each creature they control", "When this creature becomes monstrous, it deals 2 damage to each opponent and each creature they control."));
    const eff = branches(a!.effect.subject);
    expect(eff.some((b) => b.player === true && b.control === "opp")).toBe(true);
    expect(eff.some((b) => b.type === "creature" && b.control === "opp")).toBe(true);
    // The emits are one event per half: the opponent (untyped) and the opponent's creatures.
    const halves = a!.emits!.filter((e) => e.verb === "non-combat-damage").map((e) => e.subject);
    expect(halves.some((s) => s.type === undefined && s.control === "opp")).toBe(true);
    expect(halves.some((s) => s.type === "creature" && s.control === "opp")).toBe(true);
  });

  it("Kumano Faces Kakkazan: the player half is kept beside the planeswalkers", () => {
    const [a] = dmg(abil([{ id: 1, abilityType: "triggered", trigger: { event: "chapter", subject: "this saga", control: "you" },
      actions: [{ verb: "deal-damage", object: "each opponent and each planeswalker they control", amount: "1" }] }], "Kumano Faces Kakkazan",
    { 1: "I — This Saga deals 1 damage to each opponent and each planeswalker they control." }));
    expect(branches(a!.effect.subject).some((b) => b.player === true)).toBe(true);
    const halves = a!.emits!.map((e) => e.subject);
    expect(halves.some((s) => s.type === "planeswalker" && s.control === "opp")).toBe(true);
    expect(halves.some((s) => s.type === undefined && s.control === "opp")).toBe(true);
  });

  it("Chandra's Flame Wave: 'target player and each creature that player controls' is a player and the creatures", () => {
    const [a] = dmg(abil([{ id: 1, abilityType: "spell", actions: [{ verb: "deal-damage", object: "target player and each creature that player controls", amount: "2" }] }], "Chandra's Flame Wave",
      { 1: "Chandra's Flame Wave deals 2 damage to target player and each creature that player controls." }));
    expect(branches(a!.effect.subject).some((b) => b.player === true)).toBe(true);
    const halves = a!.emits!.map((e) => e.subject);
    expect(halves.some((s) => s.type === undefined && s.scope === "target")).toBe(true);
    expect(halves.some((s) => s.type === "creature")).toBe(true);
  });

  it("Lava Spike: the EMIT of 'target player or planeswalker' keeps the player (it was typed planeswalker)", () => {
    const [a] = dmg(abil([{ id: 1, abilityType: "spell", actions: [{ verb: "deal-damage", object: "target player or planeswalker", amount: "3" }] }], "Lava Spike",
      { 1: "Lava Spike deals 3 damage to target player or planeswalker." }));
    const halves = a!.emits!.map((e) => e.subject);
    expect(halves.some((s) => s.type === undefined && s.scope === "target")).toBe(true);
    expect(halves.some((s) => s.type === "planeswalker")).toBe(true);
  });

  it.each([
    ["Pyroclastic Elemental", "target player", "{1}{R}{R}: This creature deals 1 damage to target player."],
    ["Sudden Impact", "target player", "Sudden Impact deals damage to target player equal to the number of cards in that player's hand."],
    ["Anathemancer", "target player", "When this creature enters, it deals damage to target player equal to the number of nonbasic lands that player controls."],
    ["Runeflare Trap", "target player", "Runeflare Trap deals damage to target player equal to the number of cards in that player's hand."],
    ["Fire and Brimstone", "target player who attacked this turn", "Fire and Brimstone deals 4 damage to target player who attacked this turn and 4 damage to you."],
    ["Knight Rampager", "target opponent chosen at random", "When this creature dies, it deals 4 damage to target opponent chosen at random."],
    ["Hired Claw", "target opponent", "Whenever you attack with one or more Lizards, this creature deals 1 damage to target opponent."],
  ])("%s: damage to '%s' is PLAYER-ONLY, on the effect and the emit (#1294; it read like 'any target')", (name, object, text) => {
    const [a] = dmg(abil([{ id: 1, abilityType: "spell", actions: [{ verb: "deal-damage", object, amount: "1" }] }], name, { 1: text }));
    expect(a!.effect.subject?.player).toBe(true);
    expect(a!.effect.subject?.scope).toBe("target");
    expect(a!.effect.subject?.type).toBeUndefined();
    expect(a!.emits!.every((e) => e.subject.player === true && e.subject.scope === "target")).toBe(true);
    expect(a!.effect.subject?.control).toBe(object.startsWith("target opponent") ? "opp" : "any");
  });

  it("a creature-only target stays creature-typed (Garruk Relentless 0: 'target creature')", () => {
    const [a] = dmg(abil([{ id: 2, abilityType: "activated", actions: [{ verb: "deal-damage", object: "target creature", amount: "3" }] }], "Garruk Relentless",
      { 2: "0: Garruk deals 3 damage to target creature. That creature deals damage equal to its power to him." }));
    expect(a!.effect.subject?.type).toBe("creature");
    expect(a!.emits![0]!.subject.type).toBe("creature");
  });

  it("Lightning Bolt: 'any target' stays untyped, so it can hit a player", () => {
    const [a] = dmg(abil([{ id: 1, abilityType: "spell", actions: [{ verb: "deal-damage", object: "any target", amount: "3" }] }], "Lightning Bolt", { 1: "Lightning Bolt deals 3 damage to any target." }));
    expect(a!.effect.subject?.type).toBeUndefined();
    expect(a!.effect.subject?.anyOf).toBeUndefined();
    expect(a!.emits![0]!.subject.type).toBeUndefined();
  });

  it("Sell-Sword Brute: 'deals 2 damage to you' is yours, on the effect and the emit", () => {
    const [a] = dmg(abil([{ id: 1, abilityType: "triggered", trigger: { event: "dies", subject: "this creature", control: "you" }, actions: [{ verb: "deal-damage", object: "you", amount: "2" }] }], "Sell-Sword Brute",
      { 1: "When this creature dies, it deals 2 damage to you." }));
    expect(a!.effect.subject?.control).toBe("you");
    expect(a!.emits![0]!.subject.control).toBe("you");
  });

  it("Caesar: 'you lose 1 life' is yours and is no life loss aimed at an opponent", () => {
    const a = abil([{ id: 2, abilityType: "triggered", trigger: { event: "attacks", subject: "you", control: "you" }, actions: [{ verb: "draw", object: "a card", amount: "1" }, { verb: "lose-life", object: "you", amount: "1" }] }], "Caesar, Legion's Emperor",
      { 2: "You draw a card and you lose 1 life." });
    expect(a.some((x) => x.effect.kind === "player-life-loss")).toBe(false);
    expect(a.flatMap((x) => x.emits ?? []).filter((e) => e.verb === "lose-life").every((e) => e.subject.control === "you")).toBe(true);
  });

  it("Banewasp Affliction: 'that creature's controller loses life' is a player, not the creature, and not you", () => {
    const [a] = abil([{ id: 1, abilityType: "triggered", trigger: { event: "dies", subject: "enchanted creature", control: "any" }, actions: [{ verb: "lose-life", object: "that creature's controller", amount: "equal to its toughness" }] }], "Banewasp Affliction",
      { 1: "When enchanted creature dies, that creature's controller loses life equal to its toughness." });
    expect(a!.effect.kind).toBe("player-life-loss");
    expect(a!.effect.subject?.type).toBeUndefined();
    const e = a!.emits!.find((x) => x.verb === "lose-life")!;
    expect(e.subject.type).toBeUndefined();
    expect(e.subject.control).not.toBe("you");
  });

  it("Caltrops: 'deals 1 damage to it' (the attacking creature) is a creature on the effect too", () => {
    const [a] = dmg(abil([{ id: 1, abilityType: "triggered", trigger: { event: "attacks", subject: "a creature", control: "any" }, actions: [{ verb: "deal-damage", object: "it", amount: "1" }] }], "Caltrops",
      { 1: "Whenever a creature attacks, this artifact deals 1 damage to it." }));
    expect(a!.effect.subject?.type).toBe("creature");
  });

  it("Thunderbreak Regent: 'that player' after an opponent's spell is an opponent, not the trigger's controller", () => {
    const [a] = dmg(abil([{ id: 1, abilityType: "triggered", trigger: { event: "becomes-target", subject: "a Dragon you control", control: "you" }, actions: [{ verb: "deal-damage", object: "that player", amount: "3" }] }], "Thunderbreak Regent",
      { 1: "Whenever a Dragon you control becomes the target of a spell or ability an opponent controls, this creature deals 3 damage to that player." }));
    expect(a!.effect.subject?.control).toBe("opp");
    expect(a!.emits![0]!.subject.control).toBe("opp");
  });

  it("Erratic Explosion: 'that permanent or player' keeps a player branch and does not take the trigger's control", () => {
    const [a] = dmg(abil([{ id: 1, abilityType: "triggered", trigger: { event: "cast", subject: "a spell", control: "you" }, actions: [{ verb: "deal-damage", object: "that permanent or player", amount: "X" }] }], "Erratic Explosion",
      { 1: "Whenever you cast a spell, Erratic Explosion deals damage equal to that card's mana value to that permanent or player." }));
    expect(a!.effect.subject?.control).toBe("any");
    expect(branches(a!.effect.subject).some((b) => b.player === true)).toBe(true);
  });

  it("Wrathful Red Dragon: 'any target that isn't a Dragon' is still any target (untyped, a player can be hit)", () => {
    const [a] = dmg(abil([{ id: 1, abilityType: "triggered", trigger: { event: "damaged", subject: "a Dragon you control", control: "you" }, actions: [{ verb: "deal-damage", object: "any target that isn't a Dragon", amount: "that much" }] }], "Wrathful Red Dragon",
      { 1: "Whenever a Dragon you control is dealt damage, it deals that much damage to any target that isn't a Dragon." }));
    expect(a!.emits![0]!.subject.type).toBeUndefined();
    expect(a!.emits![0]!.subject.subtype).toBeUndefined();
  });

  it("Curse of Leeches: 'they lose 1 life' after 'enchanted player' is not yours", () => {
    const a = abil([{ id: 3, abilityType: "triggered", trigger: { event: "upkeep", subject: "enchanted player", control: "any" }, actions: [{ verb: "lose-life", object: "enchanted player", amount: "1" }, { verb: "gain-life", object: "you", amount: "1" }] }], "Curse of Leeches",
      { 3: "At the beginning of enchanted player's upkeep, they lose 1 life and you gain 1 life." });
    const loss = a.flatMap((x) => x.emits ?? []).filter((e) => e.verb === "lose-life");
    expect(loss.length).toBeGreaterThan(0);
    expect(loss.every((e) => e.subject.control !== "you")).toBe(true);
  });

  it("a relative clause or a name holding an 'or' / comma is not a list (Phyrexian Atlas, Gollum, Backdraft): no invented branch, no extra untyped event", () => {
    const loss = (object: string, text: string, name: string) => abil([{ id: 1, abilityType: "triggered", trigger: { event: "upkeep", subject: "you", control: "you" }, actions: [{ verb: "lose-life", object, amount: "2" }] }], name, { 1: text })
      .filter((x) => x.effect.kind === "player-life-loss");
    const atlas = loss("each opponent who has three or more poison counters", "At the beginning of your upkeep, each opponent who has three or more poison counters loses 2 life.", "Phyrexian Atlas");
    const gollum = loss("each opponent dealt combat damage this game by a creature named Gollum, Obsessed Stalker", "At the beginning of your upkeep, each opponent dealt combat damage this game by a creature named Gollum, Obsessed Stalker loses 2 life.", "Gollum, Obsessed Stalker");
    for (const a of [...atlas, ...gollum]) {
      expect(a.effect.subject?.anyOf).toBeUndefined();
      expect(a.emits!.filter((e) => e.verb === "lose-life")).toHaveLength(1);
      expect(a.emits![0]!.subject.anyOf).toBeUndefined();
    }
    const [back] = dmg(abil([{ id: 1, abilityType: "spell", actions: [{ verb: "deal-damage", object: "target player who cast one or more sorcery spells this turn", amount: "6" }] }], "Backdraft",
      { 1: "Backdraft deals damage to target player who cast one or more sorcery spells this turn." }));
    expect(back!.effect.subject?.anyOf).toBeUndefined();
    expect(back!.emits!.filter((e) => e.verb === "non-combat-damage")).toHaveLength(1);
  });

  it("paying life is a cost, not a loss dealt: 'unless they pay 2 life' (Blood Clock) has no life-loss kind, its emit stays; 'pay X life ... each other player loses X life' (Bond of Agony) keeps it", () => {
    const [clock] = abil([{ id: 1, abilityType: "triggered", trigger: { event: "upkeep", subject: "each player", control: "any" }, actions: [{ verb: "lose-life", object: "they", amount: "2" }] }], "Blood Clock",
      { 1: "At the beginning of each player's upkeep, that player returns a permanent they control to its owner's hand unless they pay 2 life." });
    expect(clock!.effect.kind).not.toBe("player-life-loss");
    expect(clock!.emits!.some((e) => e.verb === "lose-life")).toBe(true);
    const [bond] = abil([{ id: 1, abilityType: "spell", actions: [{ verb: "lose-life", object: "each other player", amount: "X" }] }], "Bond of Agony",
      { 1: "As an additional cost to cast this spell, pay X life. Each other player loses X life." });
    expect(bond!.effect.kind).toBe("player-life-loss");
  });

  it("Rabid Bite: 'target creature you control deals damage' makes a creature the dealer; a card's own damage keeps the card", () => {
    const [bite] = dmg(abil([{ id: 1, abilityType: "spell", actions: [{ verb: "deal-damage", object: "target creature you don't control", amount: "equal to its power" }] }], "Rabid Bite",
      { 1: "Target creature you control deals damage equal to its power to target creature you don't control." }));
    expect(bite!.emits![0]!.dealer).toMatchObject({ type: "creature", control: "you" });
    const [bolt] = dmg(abil([{ id: 1, abilityType: "spell", actions: [{ verb: "deal-damage", object: "any target", amount: "3" }] }], "Lightning Bolt", { 1: "Lightning Bolt deals 3 damage to any target." }));
    expect(bolt!.emits![0]!.dealer?.type).toBeUndefined();
  });

  it("Power Sink / Drain Power: 'lose all unspent mana' is no life loss", () => {
    const a = abil([{ id: 1, abilityType: "spell", actions: [{ verb: "counter-spell", object: "target spell" }, { verb: "lose-life", object: "all unspent mana" }] }], "Power Sink",
      { 1: "Counter target spell unless its controller pays {X}. If that player doesn't, they tap all lands with mana abilities they control and lose all unspent mana." });
    expect(a.some((x) => x.effect.kind === "player-life-loss")).toBe(false);
  });

  it("the fight-back half names the card itself: Tahngarth ('~'), Garruk ('him'), Polukranos ('this') are self damage, not damage to any target", () => {
    const selfOf = (object: string, name: string, text: string) => dmg(abil([{ id: 2, abilityType: "activated", actions: [{ verb: "deal-damage", object: "target creature" }, { verb: "deal-damage", object }] }], name, { 2: text }))
      .find((x) => x.effect.subject?.type === undefined)!;
    const tah = selfOf("~", "Tahngarth, Talruum Hero", "{1}{R}, {T}: Tahngarth deals damage equal to its power to target creature. That creature deals damage equal to its power to Tahngarth.");
    expect(tah.effect.subject?.self).toBe(true);
    expect(tah.emits![0]!.subject.self).toBe(true);
    const garruk = selfOf("him", "Garruk Relentless // Garruk, the Veil-Cursed", "0: Garruk deals 3 damage to target creature. That creature deals damage equal to its power to him.");
    expect(garruk.effect.subject?.self).toBe(true);
    // The emit is the bare card, not the antecedent "target creature" with a self flag on it (a planeswalker typed creature).
    expect(garruk.emits![0]!.subject.type).toBeUndefined();
    expect(garruk.emits![0]!.subject.scope).toBeUndefined();
    expect(garruk.emits![0]!.subject.self).toBe(true);
    // "him" with no fight-back sentence stays what it was (Roiling Vortex's "them" is a player, never read as the card).
    const [other] = dmg(abil([{ id: 1, abilityType: "triggered", trigger: { event: "cast", subject: "a spell", control: "any" }, actions: [{ verb: "deal-damage", object: "him" }] }], "Some Card",
      { 1: "Whenever a spell is cast, Some Card deals 2 damage to him." }));
    expect(other!.effect.subject?.self).not.toBe(true);
  });

  it("a damage or life-loss REPLACEMENT is no new source: Treacherous Link, Pyromancer's Gauntlet, Bloodletter of Aclazotz, Tainted Remedy, Harm's Way derive no burn kind; Deflecting Palm's reflect keeps it", () => {
    const kinds = (verb: string, object: string, text: string, name: string) =>
      abil([{ id: 1, abilityType: "static", actions: [{ verb, object }] }], name, { 1: text }).map((x) => x.effect.kind);
    const burn = (k: string[]) => k.some((x) => x === "damage" || x === "player-life-loss");
    expect(burn(kinds("deal-damage", "enchanted creature's controller", "All damage that would be dealt to enchanted creature is dealt to its controller instead.", "Treacherous Link"))).toBe(false);
    expect(burn(kinds("deal-damage", "that permanent or player", "If a red instant or sorcery spell you control would deal damage to a permanent or player, it deals that much damage plus 2 to that permanent or player instead.", "Pyromancer's Gauntlet"))).toBe(false);
    expect(burn(kinds("lose-life", "they", "If an opponent would lose life during your turn, they lose twice that much life instead.", "Bloodletter of Aclazotz"))).toBe(false);
    expect(burn(kinds("lose-life", "that player", "If an opponent would gain life, that player loses that much life instead.", "Tainted Remedy"))).toBe(false);
    // A redirect whose NEW recipient reaches a player or any target is still burn (the old role counted it): Harm's Way, Reflect Damage, Megatron's excess, Captain's Maneuver.
    expect(burn(kinds("deal-damage", "any target", "The next 2 damage that a source of your choice would deal to you this turn is dealt to any target instead.", "Harm's Way"))).toBe(true);
    expect(burn(kinds("deal-damage", "that source's controller", "The next time a source of your choice would deal damage this turn, that damage is dealt to that source's controller instead.", "Reflect Damage"))).toBe(true);
    expect(burn(kinds("deal-damage", "that creature's controller", "If excess damage would be dealt to that creature this way, instead that damage is dealt to that creature's controller and you convert Megatron.", "Megatron"))).toBe(true);
    expect(burn(kinds("deal-damage", "another target creature, planeswalker, or player", "The next X damage that would be dealt to target creature, planeswalker, or player this turn is dealt to another target creature, planeswalker, or player instead.", "Captain's Maneuver"))).toBe(true);
    // ...but a redirect onto the card or the enchanted creature's own controller is not.
    expect(burn(kinds("deal-damage", "Daughter of Autumn", "{W}: The next 1 damage that would be dealt to target white creature this turn is dealt to Daughter of Autumn instead.", "Daughter of Autumn"))).toBe(false);
    expect(burn(kinds("deal-damage", "target player or planeswalker", "Flames of the Blood Hand deals 4 damage to target player or planeswalker. The damage can't be prevented. If that player would gain life this turn, that player gains no life instead.", "Flames of the Blood Hand"))).toBe(true);
    expect(burn(kinds("lose-life", "each player who discarded a card with the greatest mana value", "Each player who discarded a card with the greatest mana value among cards discarded this way loses life equal to that mana value.", "Scythe Specter"))).toBe(true);
    expect(burn(kinds("deal-damage", "that source's controller", "If damage is prevented this way, Deflecting Palm deals that much damage to that source's controller.", "Deflecting Palm"))).toBe(true);
  });

  it("a life total SET is neither damage nor life loss (The Golden Throne, Arbiter of Knollridge)", () => {
    const throne = abil([{ id: 1, abilityType: "static", actions: [{ verb: "exile", object: "The Golden Throne" }, { verb: "set-life", object: "1" }] }], "The Golden Throne",
      { 1: "If you would lose the game, instead exile The Golden Throne and your life total becomes 1." });
    expect(throne.some((x) => ["player-life-loss", "damage", "drain"].includes(x.effect.kind))).toBe(false);
    const arbiter = abil([{ id: 1, abilityType: "triggered", trigger: { event: "enters", subject: "this creature", control: "you" }, actions: [{ verb: "set-life", object: "each player's life total", amount: "the highest life total among all players" }] }], "Arbiter of Knollridge",
      { 1: "When this creature enters, each player's life total becomes the highest life total among all players." });
    expect(arbiter.some((x) => ["player-life-loss", "damage", "drain"].includes(x.effect.kind))).toBe(false);
  });
});

// #1266 (wincon): the clause layer stores a win as the VERB `win-game` ("you win the game": Epic Struggle, Thassa's Oracle, Laboratory Maniac), and only the `other` escape hatch ever
// reached the `win-game` kind: 1 corpus card derived it, ~60 printed it.
test("a win-game VERB derives the win-game kind (Epic Struggle, Laboratory Maniac)", () => {
  const epic = deriveAbilities(
    [{ id: 1, abilityType: "triggered", trigger: { event: "upkeep", subject: "you", control: "you" },
      actions: [{ verb: "win-game", object: "the game" }] }],
    "Epic Struggle", { 1: "At the beginning of your upkeep, if you control twenty or more creatures, you win the game." },
  ).abilities;
  expect(epic.map((a) => a.effect.kind)).toEqual(["win-game"]);
  const maniac = deriveAbilities(
    [{ id: 1, abilityType: "static", actions: [{ verb: "win-game", object: "you" }] }],
    "Laboratory Maniac", { 1: "If you would draw a card while your library has no cards in it, you win the game instead." },
  ).abilities;
  expect(maniac.map((a) => a.effect.kind)).toEqual(["win-game"]);
});

// CR 701.17a: milling is the top cards of a library into the graveyard. "Exiles the top N cards of their library" is an exile, never a mill.
test("exiling the top of a library is not a mill (Sire of Stagnation, Ulamog, Lidless Gaze)", () => {
  const notMill = (a: { effect: { kind: string }; emits?: { verb: string }[] }): boolean => a.effect.kind !== "mill" && !(a.emits ?? []).some((e) => e.verb === "mill");
  const sire = deriveAbilities(
    [{ id: 2, abilityType: "triggered", trigger: { event: "enters", subject: "a land", control: "opponent" },
      actions: [{ verb: "mill", object: "that player", amount: "2" }, { verb: "draw", object: "you", amount: "2" }] }],
    "Sire of Stagnation", { 2: "Whenever a land an opponent controls enters, that player exiles the top two cards of their library and you draw two cards." },
  ).abilities;
  expect(sire.every(notMill)).toBe(true);
  expect(sire.some((a) => (a.emits ?? []).some((e) => e.verb === "exiled" && e.subject.fromZone === "library"))).toBe(true);
  // The clause already carries the exile as an action of its own: the mill is dropped, not doubled.
  const gaze = deriveAbilities(
    [{ id: 1, abilityType: "spell", actions: [{ verb: "mill", object: "the top card of each player's library" },
      { verb: "exile", object: "those cards", fromZone: "library", toZone: "exile" }] }],
    "Lidless Gaze", { 1: "Exile the top card of each player's library." },
  ).abilities;
  expect(gaze.every(notMill)).toBe(true);
  // A real mill, and a clause that says both words, stay mills.
  const real = deriveAbilities(
    [{ id: 1, abilityType: "spell", actions: [{ verb: "mill", object: "target player", amount: "3" }] }],
    "Traumatize-like", { 1: "Target player mills three cards." },
  ).abilities;
  expect(real.some((a) => a.effect.kind === "mill")).toBe(true);
});

describe("exile-from-the-top rewrite (#1266 review)", () => {
  const milled = (a: { effect: { kind: string }; emits?: { verb: string }[] }): boolean => a.effect.kind === "mill" || (a.emits ?? []).some((e) => e.verb === "mill");
  test("an exile from YOUR library stays yours, and its restating follow-up is no second exile (Chandra, Heart of Fire; Atsushi)", () => {
    for (const [name, object, followUp, text] of [
      ["Chandra, Heart of Fire", "top three cards of your library", "cards exiled this way", "Discard your hand, then exile the top three cards of your library. Until end of turn, you may play cards exiled this way."],
      ["Atsushi, the Blazing Sky", "the top two cards of your library", "those cards", "Exile the top two cards of your library. Until the end of your next turn, you may play those cards."],
    ] as const) {
      const ab = deriveAbilities([{ id: 1, abilityType: "activated", actions: [
        { verb: "mill", object, fromZone: null, toZone: null, amount: "3", optional: false },
        { verb: "exile", object: followUp, fromZone: null, toZone: null, amount: null, optional: false },
        { verb: "play", object: followUp, fromZone: null, toZone: null, amount: null, optional: true }] }], name, { 1: text }).abilities;
      const exiles = ab.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "exiled");
      expect(exiles.length, name).toBe(1);
      expect(exiles[0]!.subject.control, name).toBe("you");
      expect(exiles[0]!.subject.fromZone, name).toBe("library");
      expect(ab.some(milled), name).toBe(false);
    }
  });
  test("a clause that says both mills and exiles stays a mill (Tibalt's Trickery)", () => {
    const ab = deriveAbilities(
      [{ id: 1, abilityType: "spell", actions: [{ verb: "counter-spell", object: "target spell" }, { verb: "mill", object: "target spell's controller", amount: "1, 2, or 3 at random" }] }],
      "Tibalt's Trickery", { 1: "Counter target spell. Its controller mills that many cards, then exiles cards from the top of their library until they exile a nonland card." },
    ).abilities;
    expect(ab.some(milled)).toBe(true);
  });
  test("the exile-top test is linear on a long run of 'exile top ' (CodeQL)", () => {
    const t0 = performance.now();
    expect(exilesTopOfLibrary("exile top ".repeat(20_000))).toBe(false);
    expect(performance.now() - t0).toBeLessThan(100);
    expect(exilesTopOfLibrary("That player exiles the top two cards of their library.")).toBe(true);
    expect(exilesTopOfLibrary("Exile target creature. Look at the top card of your library.")).toBe(false);
  });
});

describe("host: an effect on the attached permanent (#1315)", () => {
  // Oracle text read from the corpus 2026-10-22. `viaGrammar` is the path a grammar-derived card takes (`clauseSource: "grammar"`), `viaModel` the stored model clauses.
  const viaGrammar = (name: string, typeLine: string, oracleText: string) => {
    const card = { name, typeLine, oracleText, keywords: [] as string[] };
    const g = grammarClauseRecords(card);
    return deriveCardTags(deriveInputOf(card as never, "x", name, g.records, undefined, g.readings)).abilities;
  };
  const viaModel = (name: string, oracleText: string, clauses: Parameters<typeof deriveAbilities>[0]) => {
    const texts: Record<number, string> = {};
    for (const c of segment(oracleText, [], "Enchantment — Aura")) texts[c.id] = c.text;
    return deriveAbilities(clauses, name, texts, undefined, oracleText).abilities;
  };
  /** kind -> host flag, for the kinds a host marker is read for, in order; the other abilities (draws, recursion, triggers) are ignored. */
  const KINDS = ["pump", "debuff", "keyword-grant", "speed-increase", "type-grant", "ability-loss", "animate", "evasion"];
  const hosts = (abilities: Ability[]) => abilities.filter((a) => KINDS.includes(a.effect.kind)).map((a) => `${a.effect.kind}:${a.host === true}`);

  test("Rancor, both paths: the pump and the trample grant are on the host; the return trigger has no marker", () => {
    const text = "Enchant creature\nEnchanted creature gets +2/+0 and has trample.\nWhen this Aura is put into a graveyard from the battlefield, return it to its owner's hand.";
    const model = viaModel("Rancor", text, [
      { id: 1, abilityType: "none", actions: [{ verb: "none", object: "Enchant creature" }] },
      { id: 2, abilityType: "static", actions: [{ verb: "modify-pt", object: "enchanted creature +2/+0" }, { verb: "grant-ability", object: "enchanted creature has trample" }] },
      { id: 3, abilityType: "triggered", trigger: { event: "dies", subject: "this Aura", control: "you" }, actions: [{ verb: "return", object: "it", fromZone: "graveyard", toZone: "hand" }] },
    ] as never);
    expect(hosts(model)).toEqual(["pump:true", "keyword-grant:true"]);
    expect(model.filter((a) => a.host).every((a) => a.effect.subject === undefined)).toBe(true);
    expect(hosts(viaGrammar("Rancor", "Enchantment — Aura", text))).toEqual(["pump:true", "keyword-grant:true"]);
  });

  test("Ethereal Armor (pump + first strike), Battle Mastery (speed-increase), Aqueous Form (evasion), Cursed Flesh (debuff + fear)", () => {
    expect(hosts(viaGrammar("Ethereal Armor", "Enchantment — Aura", "Enchant creature\nEnchanted creature gets +1/+1 for each enchantment you control and has first strike."))).toEqual(["pump:true", "keyword-grant:true"]);
    expect(hosts(viaGrammar("Battle Mastery", "Enchantment — Aura", "Enchant creature\nEnchanted creature has double strike. (It deals both first-strike and regular combat damage.)"))).toEqual(["speed-increase:true"]);
    expect(hosts(viaGrammar("Aqueous Form", "Enchantment — Aura", "Enchant creature\nEnchanted creature can't be blocked.\nWhenever enchanted creature attacks, scry 1."))).toEqual(["evasion:true"]);
    expect(hosts(viaGrammar("Cursed Flesh", "Enchantment — Aura", "Enchant creature\nEnchanted creature gets -1/-1 and has fear."))).toEqual(["debuff:true", "keyword-grant:true"]);
  });

  test("Deep Freeze (stored model clauses): the defender grant, the ability loss and the Wall are on the host", () => {
    const text = "Enchant creature\nEnchanted creature has base power and toughness 0/4, has defender, loses all other abilities, and is a blue Wall in addition to its other colors and types.";
    const out = hosts(viaModel("Deep Freeze", text, [
      { id: 1, abilityType: "none", actions: [{ verb: "none", object: "Enchant creature" }] },
      { id: 2, abilityType: "static", actions: [
        { verb: "modify-pt", object: "enchanted creature", amount: "0/4" },
        { verb: "grant-ability", object: "enchanted creature gains defender" },
        { verb: "cant", object: "enchanted creature can't have abilities other than defender" },
        { verb: "animate", object: "enchanted creature becomes a blue Wall in addition to its other colors and types" },
      ] },
    ] as never));
    expect(out).toEqual(["keyword-grant:true", "ability-loss:true", "animate:true"]);
  });

  test("'it' after 'As long as enchanted creature ...' is the host (Fists of the Demigod, Rune of Might, Favor of Jukai)", () => {
    expect(hosts(viaGrammar("Fists of the Demigod", "Enchantment — Aura", "Enchant creature\nAs long as enchanted creature is black, it gets +1/+1 and has wither.\nAs long as enchanted creature is red, it gets +1/+1 and has first strike."))).toEqual(["pump:true", "keyword-grant:true", "pump:true", "keyword-grant:true"]);
    expect(hosts(viaGrammar("Rune of Might", "Enchantment — Aura Rune", "Enchant permanent\nWhen this Aura enters, draw a card.\nAs long as enchanted permanent is a creature, it gets +1/+1 and has trample."))).toEqual(["pump:true", "keyword-grant:true"]);
    // The Channel half is a different permanent: a target creature, no host.
    expect(hosts(viaGrammar("Favor of Jukai", "Enchantment — Aura", "Enchant artifact or creature\nAs long as enchanted permanent is a creature, it gets +3/+3 and has reach.\nChannel — {1}{G}, Discard this card: Target creature gets +3/+3 and gains reach until end of turn."))).toEqual(["pump:true", "keyword-grant:true", "pump:false", "keyword-grant:false"]);
  });

  test("a model-stored 'it' recipient follows the same rule (the either-or Aura's 'Otherwise, it gets -3/-3')", () => {
    const text = "Enchant creature\nEnchanted creature gets +3/+3 as long as it's a Zombie. Otherwise, it gets -3/-3.";
    const clauses = [
      { id: 1, abilityType: "none", actions: [{ verb: "none", object: "Enchant creature" }] },
      { id: 2, abilityType: "static", actions: [{ verb: "modify-pt", object: "it", amount: "+3/+3" }, { verb: "modify-pt", object: "it", amount: "-3/-3" }] },
    ] as never;
    expect(hosts(viaModel("Clutch of Undeath", text, clauses))).toEqual(["pump:true", "debuff:true"]);
    expect(hosts(viaGrammar("Clutch of Undeath", "Enchantment — Aura", text))).toEqual(["pump:true", "debuff:true"]);
  });

  test("another class on the same card is not the host (Inner Demon, Vampirism, Mammoth Harness)", () => {
    // Inner Demon: the Aura's own buff is the host; the ETB's "all non-Demon creatures get -2/-2" is a board effect.
    expect(hosts(viaGrammar("Inner Demon", "Enchantment — Aura", "Enchant creature\nEnchanted creature gets +2/+2, has flying, and is a Demon in addition to its other types.\nWhen this Aura enters, all non-Demon creatures get -2/-2 until end of turn.")))
      .toEqual(["pump:true", "keyword-grant:true", "type-grant:true", "debuff:false"]);
    expect(hosts(viaGrammar("Vampirism", "Enchantment — Aura", "Enchant creature\nWhen this Aura enters, draw a card at the beginning of the next turn's upkeep.\nEnchanted creature gets +1/+1 for each other creature you control.\nOther creatures you control get -1/-1.")))
      .toEqual(["pump:true", "debuff:false"]);
    const harness = "Enchant creature\nEnchanted creature loses flying.\nWhenever enchanted creature blocks or becomes blocked by a creature, the other creature gains first strike until end of turn.";
    const model = viaModel("Mammoth Harness", harness, [
      { id: 1, abilityType: "none", actions: [{ verb: "none", object: "Enchant creature" }] },
      { id: 2, abilityType: "static", actions: [{ verb: "cant", object: "flying" }] },
      { id: 3, abilityType: "triggered", trigger: { event: "blocks", subject: "enchanted creature", control: "any" }, actions: [{ verb: "grant-ability", object: "first strike until end of turn" }] },
      { id: 4, abilityType: "triggered", trigger: { event: "becomes-blocked", subject: "enchanted creature", control: "any" }, actions: [{ verb: "grant-ability", object: "first strike until end of turn" }] },
    ] as never);
    expect(hosts(model)).toEqual(["keyword-grant:false", "keyword-grant:false"]);
    expect(hosts(viaGrammar("Mammoth Harness", "Enchantment — Aura", harness)).includes("keyword-grant:true")).toBe(false);
  });

  test("the Magemarks buff a CLASS of enchanted creatures, not their own host (Guardian's Magemark)", () => {
    const out = viaGrammar("Guardian's Magemark", "Enchantment — Aura", "Flash\nEnchant creature\nCreatures you control that are enchanted get +1/+1.");
    expect(hosts(out)).toEqual(["pump:false"]);
  });

  test("an Equipment's 'equipped creature' is the host (Bonesplitter)", () => {
    expect(hosts(viaGrammar("Bonesplitter", "Artifact — Equipment", "Equipped creature gets +2/+0.\nEquip {1}"))).toEqual(["pump:true", "keyword-grant:false"]); // the second is the Equip keyword itself: no recipient
  });

  test("a condition ahead of the recipient is not the recipient (Hexgold Halberd's 'During your turn, equipped creature has first strike and trample')", () => {
    expect(hosts(viaGrammar("Hexgold Halberd", "Artifact — Equipment", "During your turn, equipped creature has first strike and trample.\nEquip {2}{R}")).slice(0, 1)).toEqual(["keyword-grant:true"]);
  });

  test("'it' after a trigger on the host is the host (Thunderous Might, Reaper's Talisman, Writ of Passage); not a trigger on 'this creature or equipped creature' (Razorfield Ripper), not 'equipped creature and Zombies' (Wand of Orcus)", () => {
    const might = viaModel("Thunderous Might", "Enchant creature\nWhenever enchanted creature attacks, it gets +X/+0 until end of turn, where X is your devotion to red.", [
      { id: 1, abilityType: "none", actions: [{ verb: "none", object: "Enchant creature" }] },
      { id: 2, abilityType: "triggered", trigger: { event: "attacks", subject: "enchanted creature", control: "you" }, actions: [{ verb: "modify-pt", object: "it", amount: "X/0, where X is your devotion to red" }] },
    ] as never);
    expect(hosts(might)).toEqual(["pump:true"]);
    expect(hosts(viaGrammar("Reaper's Talisman", "Artifact — Equipment", "Whenever equipped creature attacks, it gains deathtouch until end of turn.\nEquip {2}")).slice(0, 1)).toEqual(["keyword-grant:true"]);
    const writ = viaModel("Writ of Passage", "Enchant creature\nWhenever enchanted creature attacks, if its power is 2 or less, it can't be blocked this turn.", [
      { id: 1, abilityType: "none", actions: [{ verb: "none", object: "Enchant creature" }] },
      { id: 2, abilityType: "triggered", trigger: { event: "attacks", subject: "enchanted creature", control: "you" }, actions: [{ verb: "cant", object: "be blocked this turn" }] },
    ] as never);
    expect(hosts(writ)).toEqual(["evasion:true"]);
    const ripper = viaModel("Razorfield Ripper", "Whenever this creature or equipped creature attacks, you get {E}, then it gets +X/+X until end of turn, where X is the amount of {E} you have.", [
      { id: 1, abilityType: "triggered", trigger: { event: "attacks", subject: "this creature or equipped creature", control: "you" }, actions: [{ verb: "modify-pt", object: "it", amount: "X" }] },
    ] as never);
    expect(hosts(ripper)).toEqual(["pump:false"]);
    const wand = viaModel("Wand of Orcus", "Whenever equipped creature attacks or blocks, it and Zombies you control gain deathtouch until end of turn.", [
      { id: 1, abilityType: "triggered", trigger: { event: "attacks", subject: "equipped creature", control: "you" }, actions: [{ verb: "grant-ability", object: "equipped creature and Zombies you control gain deathtouch until end of turn" }] },
    ] as never);
    // One per limb of "attacks or blocks" since #1373 made `blocks` a verb (the text reads the second limb): neither is the host.
    expect(hosts(wand)).toEqual(["keyword-grant:false", "keyword-grant:false"]);
  });

  test("review of 41a1da15: a plural class, a grant to another class, and a LOSS are not host (Kor Blademaster, Gemcutter Buccaneer, Earthbind)", () => {
    const kor = viaModel("Kor Blademaster", "Double strike\nEquipped Warriors you control have double strike.", [
      { id: 1, abilityType: "none", actions: [{ verb: "none", object: "Double strike" }] },
      { id: 2, abilityType: "static", actions: [{ verb: "grant-ability", object: "double strike" }] },
    ] as never);
    expect(hosts(kor)).toEqual(["speed-increase:false"]);
    const gem = viaModel("Gemcutter Buccaneer", "Whenever this creature or another Pirate you control enters, create a tapped Treasure token.\nTreasures you control are Equipment in addition to their other types and have \"Equipped creature gets +2/+0,\" equip Pirate {1}, and equip {3}.", [
      { id: 2, abilityType: "static", actions: [{ verb: "grant-ability", object: "Treasures you control are Equipment in addition to their other types" }, { verb: "grant-ability", object: "Equipped creature gets +2/+0" }, { verb: "grant-ability", object: "equip {3}" }] },
    ] as never);
    expect(gem.some((a) => a.host)).toBe(false);
    const earth = viaModel("Earthbind", "Enchant creature\nWhen this Aura enters, if enchanted creature has flying, this Aura deals 2 damage to that creature and this Aura gains \"Enchanted creature loses flying.\"", [
      { id: 1, abilityType: "none", actions: [{ verb: "none", object: "Enchant creature" }] },
      { id: 2, abilityType: "triggered", trigger: { event: "enters", subject: "this Aura", control: "you" }, actions: [{ verb: "deal-damage", object: "enchanted creature", amount: "2" }, { verb: "grant-ability", object: "Enchanted creature loses flying" }] },
    ] as never);
    expect(earth.some((a) => a.host)).toBe(false);
  });

  test("the host's controller is a player, not the host", () => {
    const a = deriveAbilities([{ id: 1, abilityType: "static", actions: [{ verb: "grant-ability", object: "enchanted creature's controller has hexproof" }] }] as never, "Test", { 1: "Enchanted creature's controller has hexproof." }).abilities;
    expect(a.some((x) => x.host)).toBe(false);
    // ... and "Enchanted creatures you control have shroud" (Greater Auramancy) is a class.
    expect(deriveAbilities([{ id: 1, abilityType: "static", actions: [{ verb: "grant-ability", object: "enchanted creatures you control have shroud" }] }] as never, "Test", { 1: "Enchanted creatures you control have shroud." }).abilities.some((x) => x.host)).toBe(false);
    // ... and a Curse's "enchanted player" is a player.
    const curse = deriveAbilities([{ id: 1, abilityType: "static", actions: [{ verb: "grant-ability", object: "enchanted player has hexproof" }] }] as never, "Test", { 1: "Enchanted player has hexproof." }).abilities;
    expect(curse.some((x) => x.host)).toBe(false);
  });
});

describe("grantedBy: the clause that grants a quoted ability (#1315)", () => {
  const derive = (name: string, typeLine: string, oracleText: string, model?: Parameters<typeof deriveAbilities>[0]) => {
    const card = { name, typeLine, oracleText, keywords: [] as string[] };
    const g = grammarClauseRecords(card);
    return model
      ? deriveCardTags(deriveInputOf(card as never, "x", name, model, undefined, undefined)).abilities
      : deriveCardTags(deriveInputOf(card as never, "x", name, g.records, undefined, g.readings)).abilities;
  };
  const by = (abilities: Ability[]) => abilities.map((a) => `${a.clause}:${a.grantedBy ?? "-"}`);

  test("the quoted ability's clause names the granting clause (Sunbond, Dragon Mantle, Pendrell Flux, Splinter Twin)", () => {
    expect(by(derive("Sunbond", "Enchantment — Aura", "Enchant creature\nEnchanted creature has \"Whenever you gain life, put that many +1/+1 counters on this creature.\""))).toEqual(["2:-", "3:2"]);
    expect(by(derive("Dragon Mantle", "Enchantment — Aura", "Enchant creature\nWhen this Aura enters, draw a card.\nEnchanted creature has \"{R}: This creature gets +1/+0 until end of turn.\""))).toEqual(["2:-", "3:-", "4:3"]);
    expect(by(derive("Pendrell Flux", "Enchantment — Aura", "Enchant creature\nEnchanted creature has \"At the beginning of your upkeep, sacrifice this creature unless you pay its mana cost.\""))).toEqual(["2:-", "3:2"]);
    expect(by(derive("Splinter Twin", "Enchantment — Aura", "Enchant creature\nEnchanted creature has \"{T}: Create a token that's a copy of this creature, except it has haste. Exile that token at the beginning of the next end step.\""))).toEqual(["2:-", "3:2"]);
  });

  test("the model path (stored clauses) carries it too (Dragon Mantle)", () => {
    const text = "Enchant creature\nWhen this Aura enters, draw a card.\nEnchanted creature has \"{R}: This creature gets +1/+0 until end of turn.\"";
    const a = derive("Dragon Mantle", "Enchantment — Aura", text, [
      { id: 1, abilityType: "none", actions: [{ verb: "none", object: "Enchant creature" }] },
      { id: 2, abilityType: "triggered", trigger: { event: "enters", subject: "this Aura", control: "you" }, actions: [{ verb: "draw", object: "a card", amount: "1" }] },
      { id: 3, abilityType: "static", actions: [{ verb: "grant-ability", object: "that ability" }] },
      { id: 4, abilityType: "activated", actions: [{ verb: "modify-pt", object: "this creature", amount: "+1/+0 until end of turn" }] },
    ] as never);
    expect(a.filter((x) => x.grantedBy !== undefined).map((x) => [x.clause, x.grantedBy])).toEqual([[4, 3]]);
  });

  test("an ability no clause grants carries none (Rancor, Bonesplitter)", () => {
    expect(derive("Bonesplitter", "Artifact — Equipment", "Equipped creature gets +2/+0.\nEquip {1}").some((a) => a.grantedBy !== undefined)).toBe(false);
    expect(derive("Rancor", "Enchantment — Aura", "Enchant creature\nEnchanted creature gets +2/+0 and has trample.").some((a) => a.grantedBy !== undefined)).toBe(false);
  });
});

describe("restriction: a host that can't attack or block (#1315, CR 508.1c, 509.1b)", () => {
  const derive = (name: string, typeLine: string, oracleText: string) => {
    const card = { name, typeLine, oracleText, keywords: [] as string[] };
    const g = grammarClauseRecords(card);
    return deriveCardTags(deriveInputOf(card as never, "x", name, g.records, undefined, g.readings)).abilities;
  };
  const rs = (abilities: Ability[]) => abilities.filter((a) => a.effect.kind === "restriction").map((a) => `${(a.restricts ?? []).join("+")}:${a.host === true}`);
  const AURA = "Enchantment — Aura";

  test("Pacifism, Utopia Vow, Pillory of the Sleepless, Compulsory Rest: attack and block, on the host", () => {
    expect(rs(derive("Pacifism", AURA, "Enchant creature\nEnchanted creature can't attack or block."))).toEqual(["attack+block:true"]);
    expect(rs(derive("Utopia Vow", AURA, "Enchant creature\nEnchanted creature can't attack or block.\nEnchanted creature has \"{T}: Add one mana of any color.\""))).toEqual(["attack+block:true"]);
    expect(rs(derive("Pillory of the Sleepless", AURA, "Enchant creature\nEnchanted creature can't attack or block.\nEnchanted creature has \"At the beginning of your upkeep, you lose 1 life.\""))).toEqual(["attack+block:true"]);
    expect(rs(derive("Compulsory Rest", AURA, "Enchant creature\nEnchanted creature can't attack or block.\nEnchanted creature has \"{2}, Sacrifice this creature: You gain 2 life.\""))).toEqual(["attack+block:true"]);
  });

  test("the either-or Auras' 'Otherwise, it can't ...' half is on the host (Mishra's Domination: block; Bonds of Faith: attack and block)", () => {
    const card = { name: "Mishra's Domination", typeLine: AURA, oracleText: "Enchant creature\nAs long as you control enchanted creature, it gets +2/+2. Otherwise, it can't block.", keywords: [] as string[] };
    const stored = [
      { id: 1, abilityType: "none", actions: [{ verb: "none", object: "Enchant creature" }] },
      { id: 2, abilityType: "static", actions: [{ verb: "modify-pt", object: "enchanted creature", amount: "+2/+2" }, { verb: "cant", object: "enchanted creature can't block" }] },
    ] as never;
    expect(rs(deriveCardTags(deriveInputOf(card as never, "x", card.name, stored)).abilities)).toEqual(["block:true"]);
    expect(rs(derive("Bonds of Faith", AURA, "Enchant creature\nEnchanted creature gets +2/+2 as long as it's a Human. Otherwise, it can't attack or block."))).toEqual(["attack+block:true"]);
  });

  test("Arrest: the activation lock is not a restriction on attacking or blocking", () => {
    expect(rs(derive("Arrest", AURA, "Enchant creature\nEnchanted creature can't attack or block, and its activated abilities can't be activated."))).toEqual(["attack+block:true"]);
  });

  test("another class or the card itself is not the host (Bedlam, Moat, Gravecrawler)", () => {
    expect(rs(derive("Bedlam", "Enchantment", "Creatures can't block."))).toEqual(["block:false"]);
    expect(rs(derive("Moat", "Enchantment", "Creatures without flying can't attack."))).toEqual(["attack:false"]);
    expect(rs(derive("Gravecrawler", "Creature — Zombie", "This creature can't block.\nYou may cast this card from your graveyard as long as you control a Zombie."))).toEqual(["block:false"]);
  });

  test("Aragorn, King of Gondor: one restriction (the target half), the monarch half is conditional; Childhood Horror, Barrage of Boulders, Wirecat derive none", () => {
    const aragorn = derive("Aragorn, King of Gondor", "Legendary Creature \u2014 Human Noble", "Vigilance, lifelink\nWhen Aragorn enters, you become the monarch.\nWhenever Aragorn attacks, up to one target creature can't block this turn. If you're the monarch, creatures can't block this turn.");
    expect(rs(aragorn)).toEqual(["block:false"]);
    expect(rs(derive("Childhood Horror", "Creature \u2014 Horror", "Flying\nThreshold \u2014 As long as there are seven or more cards in your graveyard, this creature gets +2/+2 and can't block."))).toEqual([]);
    expect(rs(derive("Barrage of Boulders", "Sorcery", "Barrage of Boulders deals 1 damage to each creature you don't control.\nFerocious \u2014 If you control a creature with power 4 or greater, creatures can't block this turn."))).toEqual([]);
    expect(rs(derive("Wirecat", "Artifact Creature \u2014 Cat", "This creature can't attack or block if an enchantment is on the battlefield."))).toEqual([]);
    expect(rs(derive("Test Aura", AURA, "Enchant creature\nAs long as enchanted creature is red, it gets +1/+1 and can't block."))).toEqual([]);
  });

  test("a long run of spaces in a restriction or evasion recipient is linear (CodeQL js/polynomial-redos)", () => {
    const t0 = performance.now();
    for (const [object, text] of [["block", `a${" ".repeat(40_000)}b can't block`], ["be blocked", `a${" ".repeat(40_000)}b can't be blocked`]] as const) {
      deriveAbilities([{ id: 1, abilityType: "static", actions: [{ verb: "cant", object }] }] as never, "Test", { 1: text }, undefined, text);
    }
    deriveAbilities([{ id: 1, abilityType: "static", actions: [{ verb: "cant", object: "block" }] }] as never, "Test", { 1: `\u201c`.repeat(30_000) + " can't block" });
    expect(performance.now() - t0).toBeLessThan(500);
  });

  test("not a restriction: can't be blocked (evasion), can't attack you (Vow of Flight, Propaganda's tax), must attack", () => {
    expect(rs(derive("Aqueous Form", AURA, "Enchant creature\nEnchanted creature can't be blocked."))).toEqual([]);
    expect(rs(derive("Vow of Flight", AURA, "Enchant creature\nEnchanted creature gets +2/+2, has flying, and can't attack you or planeswalkers you control."))).toEqual([]);
    expect(rs(derive("Propaganda", "Enchantment", "Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you."))).toEqual([]);
    expect(derive("Propaganda", "Enchantment", "Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.").some((a) => a.effect.kind === "tax")).toBe(true);
  });
});

// #1373 (owner ruling 2026-10-27): `blocks` is an engine verb. It was a clause word (and 192 stored rows carried it) with no `VERB_VOCAB` member, so
// `normalizeTriggerVerb` dropped the trigger and a modal header with "attacks or blocks" (Elder Gargaroth) gave its modes the attacks visit only.
describe("#1373 the blocks trigger", () => {
  const deriveText = (name: string, typeLine: string, oracleText: string) => {
    const card = { name, typeLine, oracleText, keywords: [] as string[] };
    const g = grammarClauseRecords(card as never);
    return deriveCardTags(deriveInputOf(card as never, "x", name, g.records, undefined, g.readings));
  };

  test("Elder Gargaroth's three modes derive under BOTH the attacks and the blocks visit", () => {
    const tags = deriveText("Elder Gargaroth", "Creature — Beast", "Reach, vigilance, trample\nWhenever this creature attacks or blocks, choose one —\n• Create a 3/3 green Beast creature token.\n• You gain 3 life.\n• Draw a card.");
    for (const verb of ["attacks", "blocks"]) {
      const mine = tags.abilities.filter((a) => a.trigger?.verbs?.includes(verb as never));
      const kinds = mine.flatMap((a) => (a.emits ?? []).map((e) => e.verb));
      expect(kinds, verb).toEqual(expect.arrayContaining(["create-token", "gain-life", "draw"]));
      for (const a of mine) expect(a.trigger?.subject.self, verb).toBe(true);
    }
    expect(tags.unknownTriggers ?? []).not.toContain("blocks");
  });

  test("a pure 'Whenever this creature blocks' card (Goldenglow Moth) derives a self blocks trigger", () => {
    const tags = deriveText("Goldenglow Moth", "Creature — Insect", "Flying\nWhenever this creature blocks, you may gain 4 life.");
    const t = tags.abilities.find((a) => a.trigger?.verbs?.includes("blocks" as never));
    expect(t).toBeDefined();
    expect(t!.trigger!.subject.self).toBe(true);
    expect(t!.trigger!.subject.type).toBe("creature");
    expect(tags.unknownTriggers ?? []).not.toContain("blocks");
  });

  test("the blocking state is the event on a blocks trigger, as the attacking state is on an attack", () => {
    const { abilities } = deriveAbilities([{ id: 1, abilityType: "triggered", trigger: { event: "blocks", subject: "a blocking creature you control", control: "you" }, actions: [{ verb: "draw", object: "a card" }] }]);
    expect(abilities[0]!.trigger?.verbs).toEqual(["blocks"]);
    expect(abilities[0]!.trigger?.subject.combat).toBeUndefined();
  });
});

// #1375: "blocks or becomes blocked" is stored as two records too (Escaped Null, Slinking Giant: the keyword line before it shifts the numbering, so the second record has no text of its own).
test("a textless 'becomes-blocked' record beside the 'blocks' record that already reads both halves derives ONE becomes-blocked ability (Escaped Null)", () => {
  const text = "Whenever this creature blocks or becomes blocked, it gets +5/+0 until end of turn.";
  const pump = { verb: "modify-pt", object: "it", amount: "+5/+0", fromZone: null, toZone: null, optional: false };
  const r = deriveAbilities([
    { id: 2, abilityType: "triggered", trigger: { event: "blocks", subject: "this creature", control: "you" }, actions: [pump] },
    { id: 3, abilityType: "triggered", trigger: { event: "becomes-blocked", subject: "this creature", control: "you" }, actions: [pump] },
  ], "Escaped Null", { 1: "Lifelink", 2: text }, undefined, `Lifelink\n${text}`);
  const mine = (verb: string) => r.abilities.filter((a) => a.trigger?.verbs.includes(verb as never));
  expect(mine("blocks")).toHaveLength(1);
  expect(mine("becomes-blocked")).toHaveLength(1);
  expect(r.spliced.has(3)).toBe(true);
});

// #1373 review: the model stores "attacks or blocks" as TWO records (Howling Golem, Jedit Ojanen, Sapphire Dragon, Goblin Psychopath: 50 cards); `segment()` numbers the
// sentence once, so the second record has no text of its own and adopts the sentence. The first record's grammar reading already covers both halves, so the second
// one derived a duplicate blocks ability. It is folded into the covering clause (`spliced`), as a re-homed twin is.
test("a textless 'blocks' record beside the 'attacks' record that already reads both halves derives ONE blocks ability (Howling Golem)", () => {
  const text = "Whenever this creature attacks or blocks, each player draws a card.";
  const draw = { verb: "draw", object: "each player", amount: "1", fromZone: null, toZone: null, optional: false };
  const r = deriveAbilities([
    { id: 1, abilityType: "triggered", trigger: { event: "attacks", subject: "this creature", control: "you" }, actions: [draw] },
    { id: 2, abilityType: "triggered", trigger: { event: "blocks", subject: "this creature", control: "you" }, actions: [draw] },
  ], "Howling Golem", { 1: text }, undefined, text);
  const draws = r.abilities.filter((a) => a.effect.kind !== "" || (a.emits ?? []).some((e) => e.verb === "draw"));
  expect(draws.filter((a) => a.trigger?.verbs.includes("attacks" as never))).toHaveLength(1);
  expect(draws.filter((a) => a.trigger?.verbs.includes("blocks" as never))).toHaveLength(1);
  expect(r.spliced.has(2)).toBe(true);
});

// #1376: the fold runs on EVERY event, not only blocks / becomes-blocked.
test("a textless 'attacks' record beside the 'enters' record that already reads 'enters or attacks' derives ONE attacks ability", () => {
  const text = "Whenever this creature enters or attacks, draw a card.";
  const draw = { verb: "draw", object: "you", amount: "1", fromZone: null, toZone: null, optional: false };
  const r = deriveAbilities([
    { id: 1, abilityType: "triggered", trigger: { event: "enters", subject: "this creature", control: "you" }, actions: [draw] },
    { id: 2, abilityType: "triggered", trigger: { event: "attacks", subject: "this creature", control: "you" }, actions: [draw] },
  ], "Enter Attacker", { 1: text }, undefined, text);
  expect(r.abilities.filter((a) => a.trigger?.verbs.includes("attacks" as never))).toHaveLength(1);
  expect(r.spliced.has(2)).toBe(true);
});

// The model stores a split sub-record under a fractional id (Korvold: "enters or attacks" is 2 and 2.1); clauseTexts only has the integer key.
test("a textless twin with a split id (2.1) folds into its covering clause", () => {
  const text = "Whenever this creature enters or attacks, draw a card.";
  const draw = { verb: "draw", object: "you", amount: "1", fromZone: null, toZone: null, optional: false };
  const r = deriveAbilities([
    { id: 2, abilityType: "triggered", trigger: { event: "enters", subject: "this creature", control: "you" }, actions: [draw] },
    { id: 2.1, abilityType: "triggered", trigger: { event: "attacks", subject: "this creature", control: "you" }, actions: [draw] },
  ], "Split Id", { 2: text }, undefined, text);
  expect(r.abilities.filter((a) => a.trigger?.verbs.includes("attacks" as never))).toHaveLength(1);
  expect(r.spliced.has(2.1)).toBe(true);
});

// Primeval Herald's twin carried the same effect.subject keys in another order; JSON.stringify called them different and the duplicates stayed.
test("abilityKey compares objects regardless of key order and ignores clause / amount / count", () => {
  const a = { clause: 1, amount: "1", effect: { kind: "x", subject: { control: "you", token: true, basic: true, type: ["land"] } } } as never;
  const b = { clause: 2, count: 3, effect: { subject: { control: "you", token: true, type: ["land"], basic: true }, kind: "x" } } as never;
  expect(abilityKey(a)).toBe(abilityKey(b));
  // JSON.stringify drops an explicit-undefined field; so must the key.
  expect(abilityKey({ clause: 1, effect: { kind: "x", gate: undefined } } as never)).toBe(abilityKey({ clause: 1, effect: { kind: "x" } } as never));
  expect(abilityKey({ clause: 1, effect: { kind: "y" } } as never)).not.toBe(abilityKey({ clause: 1, effect: { kind: "z" } } as never));
});

// #1373 review of the fold: a textless blocks record is folded ONLY when every one of its abilities has an exact match among the covering clause's, so a fold is always a
// pure removal. Velukan Dragon's blocks record read the pump amount without the comma the covering clause's reading has, so the dice-rolled copy (identical) used to be
// dropped while the pump stayed: a half fold that changed which readings survive.
test("a textless blocks record with ANY ability the covering clause lacks is not folded at all (Velukan Dragon)", () => {
  const text = "Whenever this creature attacks or blocks, roll a six-sided die. This creature gets +X/+0 until end of turn, where X is the result minus 1.";
  const acts = (extra: boolean) => [
    { verb: "roll-dice", object: "a six-sided die", fromZone: null, toZone: null, amount: null, optional: false },
    { verb: "modify-pt", object: "this creature", amount: "+X/+0, where X is the result minus 1", fromZone: null, toZone: null, optional: false },
    ...(extra ? [{ verb: "draw", object: "you", amount: "1", fromZone: null, toZone: null, optional: false }] : []),
  ];
  const run = (extra: boolean) => deriveAbilities([
    { id: 1, abilityType: "triggered", trigger: { event: "attacks", subject: "this creature", control: "you" }, actions: acts(false) },
    { id: 2, abilityType: "triggered", trigger: { event: "blocks", subject: "this creature", control: "you" }, actions: acts(extra) },
  ], "Velukan Dragon", { 1: text }, undefined, text);
  const clause2 = (r: ReturnType<typeof run>) => r.abilities.filter((a) => a.clause === 2);
  // Control: both records read alike, so the whole textless clause folds.
  const alike = run(false);
  expect(clause2(alike)).toHaveLength(0);
  expect(alike.spliced.has(2)).toBe(true);
  // One ability of the textless clause has no counterpart in the covering clause: NOTHING of it is folded, the identical dice-rolled copy included.
  const richer = run(true);
  expect(clause2(richer).some((a) => (a.emits ?? []).some((e) => e.verb === "dice-rolled"))).toBe(true);
  expect(clause2(richer).some((a) => (a.emits ?? []).some((e) => e.verb === "draw"))).toBe(true);
  expect(richer.spliced.has(2)).toBe(false);
});

// THE DIRECTION OF THE COVER (#1373 review): a twin is dropped only when the covering clause says at least as much. A twin that carries an amount the covering clause lacks is RICHER and survives;
// a twin without an amount beside a covering clause that has one is POORER and folds.
describe("the blocks twin fold covers a poorer twin and never a richer one", () => {
  const text = "Whenever this creature attacks or blocks, it gains trample until end of turn.";
  const run = (coveringAmount: string | null, twinAmount: string | null) => {
    const act = (amount: string | null) => [{ verb: "grant-ability", object: "it gains trample until end of turn", amount, fromZone: null, toZone: null, optional: false }];
    return deriveAbilities([
      { id: 1, abilityType: "triggered", trigger: { event: "attacks", subject: "this creature", control: "you" }, actions: act(coveringAmount) },
      { id: 2, abilityType: "triggered", trigger: { event: "blocks", subject: "this creature", control: "you" }, actions: act(twinAmount) },
    ], "Fold Direction", { 1: text }, undefined, text);
  };
  test("(a) a twin with an amount beside a covering record without one is NOT folded, and its amount survives", () => {
    const r = run(null, "7");
    expect(r.spliced.has(2)).toBe(false);
    expect(r.abilities.some((a) => a.clause === 2 && a.amount === "7")).toBe(true);
  });
  test("(b) the mirror, a twin without an amount beside a covering record with one, folds", () => {
    const r = run("7", null);
    expect(r.spliced.has(2)).toBe(true);
    expect(r.abilities.filter((a) => a.clause === 2)).toHaveLength(0);
    expect(r.abilities.some((a) => a.clause === 1 && a.trigger?.verbs.includes("blocks" as never) && a.amount === "7")).toBe(true);
  });
  test("an identical twin folds (Dusk Urchins shape)", () => {
    expect(run("7", "7").spliced.has(2)).toBe(true);
  });
  test("a twin with amount '1' beside a covering '2' is NOT folded and its '1' survives (#1380)", () => {
    const r = run("2", "1");
    expect(r.spliced.has(2)).toBe(false);
    expect(r.abilities.some((a) => a.clause === 2 && a.amount === "1")).toBe(true);
  });
  test("a comma-only respelling folds (#1380)", () => {
    expect(run("+X/+X, where X is the number of cards in your hand", "+X/+X where X is the number of cards in your hand").spliced.has(2)).toBe(true);
  });
  test("the Mana-Charged Dragon shape folds: the twin's X/0 sits inside the covering +X/+0 (#1380)", () => {
    expect(run("+X/+0, where X is the amount of mana spent", "X/0").spliced.has(2)).toBe(true);
  });
  test("a covering amount holding the twin's only as a sub-token does not fold (#1380)", () => {
    expect(run("12", "1").spliced.has(2)).toBe(false);
  });
});

describe("amountCovered / countCovered, the blocks twin fold's value comparison (#1380)", () => {
  test("an absent twin amount is covered; an absent covering one is not", () => {
    expect(amountCovered(undefined, undefined)).toBe(true);
    expect(amountCovered(undefined, "2")).toBe(true);
    expect(amountCovered("1", undefined)).toBe(false);
  });
  test("the sign is kept: -1/-1 is not covered by +1/+1", () => {
    expect(amountCovered("-1/-1", "+1/+1")).toBe(false);
  });
  test("a bare 1 is not covered by +1/+1, nor 2 by 0/2", () => {
    expect(amountCovered("1", "+1/+1")).toBe(false);
    expect(amountCovered("2", "0/2")).toBe(false);
    expect(amountCovered("1", "12")).toBe(false);
  });
  test("X/0 is covered by +X/+0 with its trailing explanation", () => {
    expect(amountCovered("X/0", "+X/+0, where X is the amount of mana spent")).toBe(true);
  });
  test("the twin that reads only X's definition is covered by the X/X amount that explains it (Freelance Muscle)", () => {
    expect(amountCovered("the greatest power and/or toughness among other creatures you control", "+X/+X, where X is the greatest power and/or toughness among other creatures you control")).toBe(true);
    expect(amountCovered("other creatures you control", "+X/+X, where X is the greatest power and/or toughness among other creatures you control")).toBe(false);
  });
  test("a comma-only respelling is covered", () => {
    expect(amountCovered("+X/+X where X is the number of cards", "+X/+X, where X is the number of cards")).toBe(true);
  });
  test("an absent twin count is covered; equal counts are; differing or absent covering ones are not", () => {
    expect(countCovered(undefined, undefined)).toBe(true);
    expect(countCovered(undefined, { floor: 1, ceiling: 1 })).toBe(true);
    expect(countCovered({ floor: 1, ceiling: 1 }, { floor: 1, ceiling: 1 })).toBe(true);
    expect(countCovered({ floor: 1, ceiling: 1 }, { floor: 2, ceiling: 2 })).toBe(false);
    expect(countCovered({ floor: 1, ceiling: 1 }, undefined)).toBe(false);
  });
});

// #1391: a clause with several grant-ability actions gives each keyword-grant ability the UNION of the grants, so
// the abilities were JSON-identical twins; the first is kept.
describe("keyword-grant twins from one clause fold (#1391)", () => {
  const grammarAbilities = (name: string, typeLine: string, oracleText: string) => {
    const card = { name, typeLine, oracleText, keywords: [] as string[] };
    const g = grammarClauseRecords(card as never);
    return deriveCardTags(deriveInputOf(card as never, "x", name, g.records, undefined, g.readings)).abilities;
  };
  test("Colossus of Akros: two grant-ability actions on a static clause derive ONE grant", () => {
    const ab = grammarAbilities("Colossus of Akros", "Artifact Creature — Golem", "As long as this creature is monstrous, it has trample and can attack as though it didn't have defender.");
    const grants = ab.filter((a) => a.effect?.kind === "keyword-grant");
    expect(grants).toHaveLength(1);
    expect(grants[0]!.grants).toEqual(["trample"]);
  });
  test("Silverquill Pledgemage: cast and copy readings, one grant each (2 abilities, not 4)", () => {
    const ab = grammarAbilities("Silverquill Pledgemage", "Creature — Human Warlock", "Whenever you cast or copy an instant or sorcery spell, this creature gains your choice of flying or lifelink until end of turn.");
    const grants = ab.filter((a) => a.effect?.kind === "keyword-grant");
    expect(grants).toHaveLength(2);
    expect(grants.map((a) => a.trigger?.verbs?.join("|")).sort()).toEqual(["cast", "copy"]);
    for (const a of grants) expect(a.grants).toEqual(["flying", "lifelink"]);
  });
  test("grants in DIFFERENT clauses are not folded (the fold is per clause)", () => {
    const ab = grammarAbilities("Test Anthem", "Creature — Elf", "Whenever this creature attacks, it gains flying until end of turn.\nWhenever this creature blocks, it gains flying until end of turn.");
    const grants = ab.filter((a) => a.effect?.kind === "keyword-grant");
    expect(grants).toHaveLength(2);
    expect(new Set(grants.map((a) => a.clause)).size).toBe(2);
  });
});

// #1391 part 2: the model stores an "X or Y" trigger as TWO records with the SAME id (62 stored cards). They are each other's sibling, so each takes only its own event's reading.
describe("two records sharing one id are a split compound (#1391)", () => {
  const act = (verb: string, object: string, extra: object = {}) => ({ verb, object, amount: null, fromZone: null, toZone: null, optional: false, ...extra });
  const trig = (id: number, event: string, subject: string, actions: object[]) => ({ id, abilityType: "triggered", trigger: { event, subject, control: "you" }, actions });
  const verbsOf = (r: ReturnType<typeof deriveAbilities>) => r.abilities.map((a) => a.trigger?.verbs.join("+"));

  test("Duggan: 'enters or attacks' stored as two id-2 records derives one enters and one attacks ability", () => {
    const text = "Whenever Duggan, Private Detective enters or attacks, investigate.";
    const r = deriveAbilities([
      trig(2, "enters", "Duggan", [act("investigate", "a Clue")]),
      trig(2, "attacks", "Duggan", [act("investigate", "a Clue")]),
    ], "Duggan, Private Detective", { 1: "Duggan, Private Detective gets +1/+1 as long as you've drawn two or more cards this turn.", 2: text }, undefined, text);
    expect(verbsOf(r)).toEqual(["enters", "attacks"]);
  });

  test("Derevi: 'enters and whenever a creature you control deals combat damage to a player' derives four abilities", () => {
    const text = "When Derevi, Empyrial Tactician enters and whenever a creature you control deals combat damage to a player, you may tap or untap target permanent.";
    const r = deriveAbilities([
      trig(2, "enters", "Derevi, Empyrial Tactician", [act("tap", "target permanent", { optional: true }), act("untap", "target permanent", { optional: true })]),
      trig(2, "damage-dealt", "a creature you control", [act("tap", "target permanent", { optional: true }), act("untap", "target permanent", { optional: true })]),
    ], "Derevi, Empyrial Tactician", { 2: text }, undefined, text);
    expect(r.abilities).toHaveLength(4);
    expect(verbsOf(r).filter((v) => v === "enters")).toHaveLength(2);
  });

  test("Goldspan Dragon: 'attacks or becomes the target of a spell' derives attacks once, not twice", () => {
    const text = "Whenever this creature attacks or becomes the target of a spell, create a Treasure token.";
    const r = deriveAbilities([
      trig(2, "attacks", "this creature", [act("create", "a Treasure token", { amount: "1" })]),
      trig(2, "becomes-target", "this creature", [act("create", "a Treasure token", { amount: "1" })]),
    ], "Goldspan Dragon", { 1: "Flying, haste", 2: text }, undefined, `Flying, haste\n${text}`);
    // The becomes-target half has no engine verb: like a refused-only record (Curator of Mysteries, Desert Warfare), it derives a TRIGGER-LESS token-generation (no `claimsNothing`: nothing in it points back at the trigger), and
    // "becomes-target" lands in unknownTriggers. The attacks half is one live token-generation, not two.
    expect(r.abilities.map((a) => [a.trigger?.verbs, a.effect.kind])).toEqual([[["attacks"], "token-generation"], [undefined, "token-generation"]]);
    expect(r.unknownTriggers).toContain("becomes-target");
  });

  test("Ultron's Auxiliary: stored 'dies' + 'exiled' keeps both limbs, each once (the second record must not borrow 'dies')", () => {
    const text = "Whenever another artifact is put into your graveyard from the battlefield or an artifact card is put into your graveyard from anywhere other than the battlefield, put a +1/+1 counter on this creature.";
    const counter = act("add-counter", "+1/+1", { amount: "1" });
    const r = deriveAbilities([
      trig(2, "dies", "another artifact", [counter]),
      trig(2, "exiled", "an artifact card from anywhere other than the battlefield", [counter]),
    ], "Ultron's Auxiliary", { 1: "Menace", 2: text }, undefined, `Menace\n${text}`);
    expect(verbsOf(r)).toEqual(["dies", "enters-graveyard"]);
  });

  test("Balor: a modal header stored as two same-id records reaches each mode under BOTH limbs, once each", () => {
    const head = "Whenever this creature attacks or dies, choose one or more. Each mode must target a different player.";
    const none = [{ verb: "none" }];
    const r = deriveAbilities([
      { id: 2, abilityType: "triggered", trigger: { event: "attacks", subject: "this creature", control: "you" }, actions: none },
      { id: 2, abilityType: "triggered", trigger: { event: "dies", subject: "this creature", control: "you" }, actions: none },
      { id: 3, abilityType: "triggered", actions: [act("draw", "target opponent", { amount: "3" }), act("discard", "target opponent", { amount: "3" })] },
      { id: 4, abilityType: "triggered", actions: [act("sacrifice", "a nontoken artifact of target opponent's choice")] },
      { id: 5, abilityType: "triggered", actions: [act("deal-damage", "target opponent", { amount: "the number of cards in target opponent's hand" })] },
    ] as never, "Balor", {
      1: "Flying", 2: head, 3: "Target opponent draws three cards, then discards three cards at random.",
      4: "Target opponent sacrifices a nontoken artifact of their choice.", 5: "This creature deals damage to target opponent equal to the number of cards in their hand.",
    }, undefined, `Flying\n${head}\n• Target opponent draws three cards, then discards three cards at random.\n• Target opponent sacrifices a nontoken artifact of their choice.\n• This creature deals damage to target opponent equal to the number of cards in their hand.`);
    const under = (verb: string, id: number) => r.abilities.filter((a) => a.clause === id && a.trigger?.verbs.includes(verb as never)).length;
    // Mode 3 has two actions (draw, discard): one ability each per limb.
    for (const [id, n] of [[3, 2], [4, 1], [5, 1]] as const) { expect(under("attacks", id), `mode ${id} attacks`).toBe(n); expect(under("dies", id), `mode ${id} dies`).toBe(n); }
  });
});

// #1391 F2: "you and <player> each <verb>" is one action per player, yours and theirs, not two JSON-identical `any` abilities.
describe("'you and <player> each' derives yours and theirs (#1391 F2)", () => {
  const act = (verb: string, object: string, amount: string | null = null) => ({ verb, object, amount, fromZone: null, toZone: null, optional: false });
  const run = (name: string, event: string, text: string, actions: ReturnType<typeof act>[]) =>
    deriveAbilities([{ id: 1, abilityType: "triggered", trigger: { event, subject: "this creature", control: "you" }, actions }] as never, name, { 1: text }, undefined, text).abilities;
  const ctl = (abs: ReturnType<typeof run>) => abs.map((a) => `${a.emits?.[0]?.verb}:${a.emits?.[0]?.subject.control}`);

  test("Farsight Adept (stored draw x2): your draw and the target opponent's", () => {
    const abs = run("Farsight Adept", "enters", "When this creature enters, you and target opponent each draw a card.", [act("draw", "a card", "1"), act("draw", "a card", "1")]);
    expect(ctl(abs)).toEqual(["draw:you", "draw:opp"]);
    expect(abs[1]?.effect.subject?.scope).toBe("target");
  });

  test("Thran Spider (stored create x2): your Powerstone and the target opponent's", () => {
    const abs = run("Thran Spider", "enters", "When this creature enters, you and target opponent each create a tapped Powerstone token.", [act("create", "a tapped Powerstone token", "1"), act("create", "a tapped Powerstone token", "1")]);
    expect(abs.map((a) => `${a.effect.kind}:${a.effect.subject?.control}`)).toEqual(["token-generation:you", "token-generation:opp"]);
  });

  // Real oracle text and real stored records (Mongo cardClauses, 2026-10-28), through BOTH paths: the model's stored answer and the grammar's own records.
  const both = (name: string, typeLine: string, oracleText: string, stored: unknown[]) => {
    const card = { name, typeLine, oracleText, keywords: [] as string[] };
    const g = grammarClauseRecords(card as never);
    return [["model", stored], ["grammar", g.records]].map(([path, records]) => [path as string, deriveCardTags(deriveInputOf(card as never, "x", name, records as never, undefined, path === "grammar" ? g.readings : undefined)).abilities] as const);
  };
  const players = (abs: ReturnType<typeof run>, verb: string) => abs.flatMap((a) => a.emits ?? []).filter((e) => e.verb === verb).map((e) => e.subject.control);

  test("Cait: draw and discard for you and for the defending player, never the defending player's as yours", () => {
    const text = "During your turn, Cait has indestructible.\nWhenever Cait attacks, you and defending player each draw a card, then discard a card. Put two +1/+1 counters on Cait if you discarded the card with the greatest mana value among those cards or tied for greatest.";
    const stored = [
      { id: 1, abilityType: "static", actions: [{ verb: "grant-ability", object: "indestructible", fromZone: null, toZone: null }] },
      { id: 2, abilityType: "triggered", trigger: { event: "attacks", subject: "this creature", control: "you" }, actions: [act("draw", "you"), act("draw", "defending player"), act("discard", "you"), act("discard", "defending player"), act("add-counter", "+1/+1", "2")] },
    ];
    for (const [path, abs] of both("Cait, Cage Brawler", "Legendary Creature — Human Warrior", text, stored)) {
      expect(players(abs, "draw"), path).toEqual(["you", "opp"]);
      expect(players(abs, "discard"), path).toEqual(["you", "opp"]);
    }
  });

  test("a back-referenced player is never read as you: Diviner Spirit and Black Widow, Intel Expert (#1391 F2 review)", () => {
    const diviner = both("Diviner Spirit", "Creature — Spirit", "Whenever this creature deals combat damage to a player, you and that player each draw that many cards.",
      [{ id: 1, abilityType: "triggered", trigger: { event: "damage-dealt", subject: "this creature", control: "you" }, actions: [act("draw", "you", "that many"), act("draw", "that player", "that many")] }]);
    const widow = both("Black Widow, Intel Expert", "Legendary Creature — Human Spy Hero", "First strike\nWhenever Black Widow deals combat damage to an opponent, you and that player each draw two cards.",
      [{ id: 2, abilityType: "triggered", trigger: { event: "damage-dealt", subject: "this creature", control: "you" }, actions: [act("draw", "you", "2"), act("draw", "that player", "2")] }]);
    // The grammar path (the card's own records). The model's raw stored "that player" is read as `you` by derive itself (same at 403); the pipeline's row switch (deriveRow) is tested in derive-worker.test.ts.
    for (const [path, abs] of [...diviner, ...widow]) if (path === "grammar") expect(players(abs, "draw"), path).toEqual(["any", "any"]);
  });

  test("a store that wrote ONE action for the pair keeps it once (nothing doubled, nothing rewritten)", () => {
    const abs = run("Farsight Adept", "enters", "When this creature enters, you and target opponent each draw a card.", [act("draw", "a card", "1")]);
    expect(abs).toHaveLength(1);
  });
  // Real oracle text and the real stored records (Mongo cardClauses, dumped 2026-10-29).
  const rec = (verb: string, object: string, extra: Record<string, unknown> = {}) => ({ verb, object, ...extra });
  const trig = (event: string, subject: string, control: string, actions: unknown[], id = 1) => ({ id, abilityType: "triggered", trigger: { event, subject, control }, actions });
  const all = (c: ReturnType<typeof both>, check: (path: string, abs: ReturnType<typeof run>) => void) => { for (const [path, abs] of c) check(path, abs); };

  test("#1403: Twist Allegiance's exchange reads you, then the opponent, on both paths", () => {
    const text = "You and target opponent each gain control of all creatures the other controls until end of turn. Untap those creatures. Those creatures gain haste until end of turn.";
    const stored = [{ id: 1, abilityType: "spell", actions: [rec("gain-control", "all creatures target opponent controls"), rec("gain-control", "all creatures you control"), rec("untap", "those creatures"), rec("grant-ability", "haste")] }];
    all(both("Twist Allegiance", "Instant", text, stored), (path, abs) => expect(players(abs, "gains-control"), `Twist Allegiance ${path}`).toEqual(["you", "opp"]));
    expect(grammarClauseRecords({ name: "Twist Allegiance", typeLine: "Instant", oracleText: text, keywords: [] } as never).complete).toBe(true);
  });

  test("#1403: Game of Chaos keeps the opponent's life loss and gain (an unreadable tail never shifts the aligned readings)", () => {
    const text = "Flip a coin. If you win the flip, you gain 1 life and target opponent loses 1 life, and you decide whether to flip again. If you lose the flip, you lose 1 life and that opponent gains 1 life, and that player decides whether to flip again. Double the life stakes with each flip.";
    const stored = [{ id: 1, abilityType: "spell", actions: [rec("flip-coin", "a coin"), rec("gain-life", "you", { amount: "1" }), rec("lose-life", "target opponent", { amount: "1" }), rec("other", "you decide whether to flip again"), rec("lose-life", "you", { amount: "1" }), rec("gain-life", "that opponent", { amount: "1" }), rec("other", "that player decides whether to flip again"), rec("double", "the life stakes")] }];
    all(both("Game of Chaos", "Sorcery", text, stored).filter(([path]) => path === "model"), (path, abs) => { // the card is not grammar-complete: only the model path derives, and it reads the printed text with parseActions
      expect(players(abs, "gain-life"), `Game of Chaos gain ${path}`).toEqual(["you", "opp"]);
      expect(players(abs, "lose-life"), `Game of Chaos lose ${path}`).toEqual(["opp", "you"]);
    });
  });

  test("#1403: a back-referenced amount never replaces the stored one (Oft-Nabbed Goat)", () => {
    const text = "{1}: Draw a card. Gain control of this creature and put a -1/-1 counter on it. Only your opponents may activate this ability and only as a sorcery.\nWhen this creature dies, if it had one or more -1/-1 counters on it, its owner draws that many cards and each other player loses that much life.";
    const stored = [{ id: 1, abilityType: "activated", actions: [rec("draw", "a card"), rec("gain-control", "this creature"), rec("add-counter", "-1/-1")] }, { id: 2, abilityType: "triggered", trigger: { event: "dies", subject: "this creature", control: "any" }, actions: [rec("draw", "its owner", { amount: "the number of -1/-1 counters on it" }), rec("lose-life", "each other player", { amount: "the number of -1/-1 counters on it" })] }];
    all(both("Oft-Nabbed Goat", "Creature — Goat", text, stored).filter(([path]) => path === "model"), (path, abs) => {
      const c2 = abs.filter((a) => a.clause === 2);
      expect(c2.map((a) => a.amount), path).toEqual(["the number of -1/-1 counters on it", "the number of -1/-1 counters on it"]);
      expect(c2.every((a) => (a.count?.scalesWith as { counter?: string } | undefined)?.counter === "-1/-1"), path).toBe(true);
    });
  });

  test("#1403: a granted 'prevent damage to this creature' is not the granting card's self reference (Torrent of Lava, Caduceus)", () => {
    const torrent = "Torrent of Lava deals X damage to each creature without flying.\nAs long as Torrent of Lava is on the stack, each creature has \"{T}: Prevent the next 1 damage that would be dealt to this creature by Torrent of Lava this turn.\"";
    const tStored = [{ id: 1, abilityType: "spell", actions: [rec("deal-damage", "each creature without flying", { amount: "X" })] }, { id: 2, abilityType: "spell", actions: [rec("grant-ability", "each creature: Prevent the next 1 damage that would be dealt to this creature by Torrent of Lava this turn.")] }, { id: 3, abilityType: "activated", actions: [rec("prevent", "the next 1 damage that would be dealt to this creature by Torrent of Lava this turn")] }];
    const cad = "Equipped creature has lifelink.\nAs long as you have 30 or more life, equipped creature gets +5/+5 and has indestructible and \"Prevent all damage that would be dealt to this creature.\"\nEquip {W}{W}";
    const cStored = [{ id: 1, abilityType: "static", actions: [rec("grant-ability", "lifelink")] }, { id: 2, abilityType: "static", actions: [rec("modify-pt", "equipped creature", { amount: "+5/+5" }), rec("grant-ability", "indestructible"), rec("prevent", "all damage that would be dealt to this creature")] }, { id: 3, abilityType: "none", actions: [rec("none", "Equip {W}{W}")] }];
    // Torrent of Lava is grammar-complete (both paths); Caduceus is model-only.
    for (const [name, typeLine, text, stored, paths] of [["Torrent of Lava", "Sorcery", torrent, tStored, ["model", "grammar"]], ["Caduceus, Staff of Hermes", "Legendary Artifact — Equipment", cad, cStored, ["model"]]] as const) {
      all(both(name, typeLine, text, stored as never).filter(([path]) => (paths as readonly string[]).includes(path)), (path, abs) => {
        const prevented = abs.flatMap((x) => x.emits ?? []).filter((e) => e.verb === "prevented");
        expect(prevented.length, `${name} ${path} emits a prevented`).toBeGreaterThan(0);
        expect(prevented.map((e) => e.subject.self), `${name} ${path}`).toEqual(prevented.map(() => undefined));
      });
    }
  });

  test("#1403: 'an opponent of your choice gains control of it' is the opponent's gain (Khârn the Betrayer)", () => {
    const text = "Berzerker — Khârn the Betrayer attacks or blocks each combat if able.\nSigil of Corruption — When you lose control of Khârn the Betrayer, draw two cards.\nThe Betrayer — If damage would be dealt to Khârn the Betrayer, prevent that damage and an opponent of your choice gains control of it.";
    const stored = [{ id: 1, abilityType: "static", actions: [rec("cant", "not attack or block")] }, { id: 2, abilityType: "triggered", trigger: { event: "loses-control", subject: "Khârn the Betrayer", control: "you" }, actions: [rec("draw", "card", { amount: "2" })] }, { id: 3, abilityType: "static", actions: [rec("prevent", "damage to Khârn the Betrayer"), rec("gain-control", "Khârn the Betrayer")] }];
    all(both("Khârn the Betrayer", "Legendary Creature — Astartes Berserker", text, stored).filter(([path]) => path === "model"), (path, abs) => expect(players(abs, "gains-control"), `Khârn ${path}`).toEqual(["opp"]));
    // The damage prevented is dealt to Khârn itself: a self reference, so a "damage dealt to YOU is prevented" payoff (Selfless Squire) is not fed by it.
    all(both("Khârn the Betrayer", "Legendary Creature — Astartes Berserker", text, stored).filter(([path]) => path === "model"), (path, abs) =>
      expect(abs.flatMap((x) => x.emits ?? []).filter((e) => e.verb === "prevented").map((e) => e.subject.self), `Khârn prevented ${path}`).toEqual([true]));
  });

  test("#1395: another player's half is never yours", () => {
    all(both("Shattergang Brothers", "Legendary Creature — Goblin Artificer", "{2}{B}, Sacrifice a creature: Each other player sacrifices a creature.\n{2}{R}, Sacrifice an artifact: Each other player sacrifices an artifact.\n{2}{G}, Sacrifice an enchantment: Each other player sacrifices an enchantment.",
      [1, 2, 3].map((id, k) => ({ id, abilityType: "activated", actions: [rec("sacrifice", ["a creature", "an artifact", "an enchantment"][k]!), rec("sacrifice", ["a creature", "an artifact", "an enchantment"][k]!)] }))),
      (path, abs) => expect(players(abs, "sacrifice"), `Shattergang ${path}`).toEqual(["you", "opp", "you", "opp", "you", "opp"]));
    const text = "Whenever this creature attacks, you and defending player each discard a card or sacrifice a permanent. You draw a card for each land card put into a graveyard this way.\nEncore {6}{B}{B} ({6}{B}{B}, Exile this card from your graveyard: For each opponent, create a token copy that attacks that opponent this turn if able. They gain haste. Sacrifice them at the beginning of the next end step. Activate only as a sorcery.)";
    all(both("Eumidian Wastewaker", "Creature — Insect Cleric", text, [trig("attacks", "this creature", "you", [rec("discard", "a card", { optional: true }), rec("sacrifice", "a permanent", { optional: true }), rec("discard", "a card", { optional: true }), rec("sacrifice", "a permanent", { optional: true }), rec("draw", "a card", { amount: "for each land card put into a graveyard this way" })])]),
      (path, abs) => {
        expect(players(abs, "discard"), `Eumidian discard ${path}`).toEqual(["you", "opp"]);
        expect(players(abs, "sacrifice"), `Eumidian sacrifice ${path}`).toEqual(["you", "opp"]);
        expect(players(abs, "draw"), `Eumidian draw ${path}`).toEqual(["you"]);
      });
    all(both("Words of Wisdom", "Instant", "You draw two cards, then each other player draws a card.", [{ id: 1, abilityType: "spell", actions: [rec("draw", "you", { amount: "2" }), rec("draw", "each other player", { amount: "1" })] }]),
      (path, abs) => expect(players(abs, "draw"), `Words of Wisdom ${path}`).toEqual(["you", "opp"]));
    all(both("Savra, Queen of the Golgari", "Legendary Creature — Elf Shaman", "Whenever you sacrifice a black creature, you may pay 2 life. If you do, each other player sacrifices a creature of their choice.\nWhenever you sacrifice a green creature, you may gain 2 life.",
      [trig("sacrificed", "a black creature", "you", [rec("sacrifice", "a creature of their choice", { optional: true })]), trig("sacrificed", "a green creature", "you", [rec("gain-life", "you", { amount: "2", optional: true })], 2)]),
      (path, abs) => expect(players(abs, "sacrifice"), `Savra ${path}`).toEqual(["opp"]));
  });

  test("#1395: 'each other player' under a trigger that is not yours includes you, so it stays any (Hive Mind, Curse of Echoes)", () => {
    all(both("Hive Mind", "Enchantment", "Whenever a player casts an instant or sorcery spell, each other player copies that spell. Each of those players may choose new targets for their copy.",
      [trig("cast", "an instant or sorcery spell", "any", [rec("copy", "that spell")])]),
      (path, abs) => expect(players(abs, "copy"), `Hive Mind ${path}`).not.toContain("opp"));
    all(both("Curse of Echoes", "Enchantment — Aura Curse", "Enchant player\nWhenever enchanted player casts an instant or sorcery spell, each other player may copy that spell and may choose new targets for the copy they control.",
      [{ id: 1, abilityType: "none", actions: [{ verb: "none", object: "Enchant player" }] }, trig("cast", "an instant or sorcery spell", "opponent", [rec("copy", "that spell", { optional: true })], 2)]),
      (path, abs) => expect(players(abs, "copy"), `Curse of Echoes ${path}`).not.toContain("opp"));
  });

  test("#1395: the reading never overrides a stated control, and a chooser does not own the card (Wormfang Crab, Allure of the Unknown)", () => {
    all(both("Wormfang Crab", "Creature — Nightmare Crab", "This creature can't be blocked.\nWhen this creature enters, an opponent chooses a permanent you control other than this creature and exiles it.\nWhen this creature leaves the battlefield, return the exiled card to the battlefield under its owner's control.",
      [{ id: 1, abilityType: "static", actions: [rec("cant", "be blocked")] }, trig("enters", "this creature", "you", [rec("exile", "a permanent you control other than this creature", { fromZone: "battlefield", toZone: "exile" })], 2), trig("leaves", "this creature", "you", [rec("return", "the exiled card", { fromZone: "exile", toZone: "battlefield" })], 3)]),
      (path, abs) => expect(players(abs, "exiled"), `Wormfang ${path}`).not.toContain("opp"));
    all(both("Allure of the Unknown", "Sorcery", "Reveal the top six cards of your library. An opponent exiles a nonland card from among them, then you put the rest into your hand. That opponent may cast the exiled card without paying its mana cost.",
      [{ id: 1, abilityType: "spell", actions: [rec("reveal", "the top six cards of your library"), rec("exile", "a nonland card from among them"), rec("put", "the rest", { fromZone: "library", toZone: "hand" }), rec("cast", "the exiled card", { fromZone: "exile", toZone: "stack", optional: true })] }]),
      (path, abs) => expect(players(abs, "exiled"), `Allure ${path}`).not.toContain("opp"));
  });

  test("#1395: a cost discard and 'search your library' stay yours beside another player's name (Urborg Syphon-Mage, Aerial Surveyor)", () => {
    all(both("Urborg Syphon-Mage", "Creature — Human Spellshaper", "{2}{B}, {T}, Discard a card: Each other player loses 2 life. You gain life equal to the life lost this way.",
      [{ id: 1, abilityType: "activated", actions: [rec("discard", "a card"), rec("lose-life", "each other player", { amount: "2" }), rec("gain-life", "you", { amount: "equal to the life lost this way" })] }]),
      (path, abs) => expect(players(abs, "discard"), `Syphon-Mage ${path}`).toEqual(["you"]));
    all(both("Aerial Surveyor", "Artifact — Vehicle", "Flying\nWhenever this Vehicle attacks, if defending player controls more lands than you, search your library for a basic Plains card, put it onto the battlefield tapped, then shuffle.\nCrew 2",
      [{ id: 1, abilityType: "none", actions: [{ verb: "none", object: "Flying" }] }, trig("attacks", "this", "you", [rec("search", "your library for a basic Plains card", { fromZone: "library" }), rec("put", "it", { fromZone: "library", toZone: "battlefield" }), rec("tap", "it"), rec("shuffle", "your library")], 2), { id: 3, abilityType: "none", actions: [{ verb: "none", object: "Crew 2" }] }]),
      (path, abs) => expect(players(abs, "search"), `Surveyor ${path}`).toEqual(["you"]));
  });

  test("#1395: Soul Ransom's cost discard is the opponent's, so it stays any (only your opponents may activate)", () => {
    all(both("Soul Ransom", "Enchantment — Aura", "Enchant creature\nYou control enchanted creature.\nDiscard two cards: This Aura's controller sacrifices it, then draws two cards. Only your opponents may activate this ability.",
      [{ id: 1, abilityType: "none", actions: [{ verb: "none", object: "Enchant creature" }] }, { id: 2, abilityType: "static", actions: [rec("gain-control", "enchanted creature")] },
        { id: 3, abilityType: "activated", actions: [rec("discard", "two cards"), rec("draw", "cards", { amount: "2" }), rec("sacrifice", "this Aura")] }]),
      (path, abs) => expect(players(abs, "discard"), `Soul Ransom ${path}`).not.toContain("you"));
  });
  test("#1395: 'that player' is never the controller: Angel of Destiny and Benevolent Offering gain life for you and for them", () => {
    all(both("Angel of Destiny", "Creature — Angel Cleric", "Flying, double strike\nWhenever a creature you control deals combat damage to a player, you and that player each gain that much life.\nAt the beginning of your end step, if you have at least 15 life more than your starting life total, each player this creature attacked this turn loses the game.",
      [{ id: 1, abilityType: "none", actions: [{ verb: "none", object: "Flying, double strike" }] }, trig("damage-dealt", "a creature you control", "you", [rec("gain-life", "you", { amount: "that much" }), rec("gain-life", "that player", { amount: "that much" })], 2),
        trig("end-step", "you", "you", [rec("lose-game", "each player this creature attacked this turn")], 3)]),
      // CEILING: the grammar path reads the pair's shared any / each actor for both halves (action.ts both-branch), so your own half is `any` there, never `you`.
      (path, abs) => expect(players(abs, "gain-life"), `Angel ${path}`).toEqual(path === "model" ? ["you", "any"] : ["any", "any"]));
    all(both("Benevolent Offering", "Instant", "Choose an opponent. You and that player each create three 1/1 white Spirit creature tokens with flying.\nChoose an opponent. You gain 2 life for each creature you control and that player gains 2 life for each creature they control.",
      [{ id: 1, abilityType: "spell", actions: [rec("create", "1/1 white Spirit creature token with flying", { amount: "3" })] },
        { id: 2, abilityType: "spell", actions: [rec("gain-life", "you", { amount: "2 for each creature you control" }), rec("gain-life", "chosen opponent", { amount: "2 for each creature they control" })] }]),
      // The grammar does not read "Choose an opponent." clauses, so its path derives no gain-life here; the stored (model) answer is the one that counts.
      (path, abs) => { if (path === "model") expect(players(abs, "gain-life"), `Benevolent ${path}`).toEqual(["you", "opp"]); });
  });

  test("#1395: 'that player' still inherits an opponent antecedent (Suspended Sentence)", () => {
    all(both("Suspended Sentence", "Instant", "Destroy target creature an opponent controls. That player loses 3 life. Exile Suspended Sentence with three time counters on it.\nSuspend 3—{1}{B} (Rather than cast this card from your hand, you may pay {1}{B} and exile it with three time counters on it. At the beginning of your upkeep, remove a time counter. When the last is removed, you may cast it without paying its mana cost.)",
      [{ id: 1, abilityType: "spell", actions: [rec("destroy", "target creature an opponent controls"), rec("lose-life", "that player", { amount: "3" }), rec("exile", "Suspended Sentence"), rec("add-counter", "time", { amount: "3" })] }, { id: 2, abilityType: "spell", actions: [rec("other", "Suspend 3—{1}{B}")] }]),
      (path, abs) => expect(players(abs, "lose-life"), `Suspended Sentence ${path}`).toEqual(["opp"]));
  });
  test("#1395: the gainer of a control change is not you when the object is yours (Twist Allegiance, Reins of Power, Iroh, Donate), and stays you when it is not", () => {
    const gc = (o: string) => rec("gain-control", o);
    all(both("Twist Allegiance", "Sorcery", "You and target opponent each gain control of all creatures the other controls until end of turn. Untap those creatures. Those creatures gain haste until end of turn.",
      [{ id: 1, abilityType: "spell", actions: [gc("all creatures target opponent controls"), gc("all creatures you control")] }]),
      (path, abs) => { if (path === "model") expect(players(abs, "gains-control"), `Twist Allegiance ${path}`).toEqual(["you", "opp"]); });
    all(both("Reins of Power", "Instant", "Untap all creatures you control and all creatures target opponent controls. You and that opponent each gain control of all creatures the other controls until end of turn. Those creatures gain haste until end of turn.",
      [{ id: 1, abilityType: "spell", actions: [gc("all creatures the target opponent controls"), gc("all creatures you control")] }]),
      (path, abs) => { if (path === "model") expect(players(abs, "gains-control"), `Reins of Power ${path}`).toEqual(["you", "opp"]); });
    all(both("Iroh, Tea Master", "Legendary Creature — Human Citizen Ally", "When Iroh enters, create a Food token.\nAt the beginning of combat on your turn, you may have target opponent gain control of target permanent you control. When you do, create a 1/1 white Ally creature token. Put a +1/+1 counter on that token for each permanent you own that your opponents control.",
      [trig("enters", "Iroh, Tea Master", "you", []), trig("begin-combat", "you", "you", [rec("gain-control", "target permanent you control", { optional: true })], 2), trig("other", "you giving control of a permanent to an opponent", "you", [], 3)]),
      (path, abs) => expect(players(abs, "gains-control"), `Iroh ${path}`).toEqual(["opp"]));
    all(both("Donate", "Sorcery", "Target player gains control of target permanent you control.", [{ id: 1, abilityType: "spell", actions: [gc("target permanent you control")] }]),
      (path, abs) => expect(players(abs, "gains-control"), `Donate ${path}`).toEqual(["opp"]));
    all(both("Temporary Insanity", "Instant", "Untap target creature with power less than the number of cards in your graveyard and gain control of it until end of turn. That creature gains haste until end of turn.",
      [{ id: 1, abilityType: "spell", actions: [gc("target creature with power less than the number of cards in your graveyard")] }]),
      (path, abs) => { if (path === "model") expect(players(abs, "gains-control"), `Temporary Insanity ${path}`).toEqual(["you"]); });
    all(both("Coveted Falcon", "Artifact Creature — Bird", "Flying\nWhenever this creature attacks, gain control of target permanent you own but don't control.\nDisguise {1}{U}\nWhen this creature is turned face up, target opponent gains control of any number of target permanents you control. Draw a card for each one they gained control of this way.",
      [trig("attacks", "this creature", "you", [gc("target permanent you own but don't control")], 2), trig("turned-face-up", "this creature", "you", [gc("any number of target permanents you control")], 4)]),
      (path, abs) => { if (path === "model") expect(players(abs, "gains-control"), `Coveted Falcon ${path}`).toEqual(["you", "opp"]); });
  });
  test("#1395: control-change branches that moved cards (Hithlain Rope, Assault Suit, Infernal Denizen, Juxtapose, Coveted Falcon's own object)", () => {
    const gc = (o: string) => rec("gain-control", o);
    all(both("Hithlain Rope", "Artifact", "This artifact can't be sacrificed.\n{1}, {T}: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle. The player to your right gains control of this artifact.\n{2}, {T}: Draw a card. The player to your right gains control of this artifact.",
      [{ id: 2, abilityType: "activated", actions: [rec("search", "a basic land card", { fromZone: "library" }), rec("put", "it", { fromZone: "library", toZone: "battlefield" }), rec("shuffle", "your library"), gc("this artifact")] },
        { id: 3, abilityType: "activated", actions: [rec("draw", "a card", { amount: "1" }), gc("this artifact")] }]),
      (path, abs) => expect(players(abs, "gains-control"), `Hithlain Rope ${path}`).toEqual(["opp", "opp"]));
    all(both("Assault Suit", "Artifact — Equipment", "Equipped creature gets +2/+2, has haste, can't attack you or planeswalkers you control, and can't be sacrificed.\nAt the beginning of each opponent's upkeep, you may have that player gain control of equipped creature until end of turn. If you do, untap it.\nEquip {3}",
      [trig("upkeep", "you", "opponent", [rec("gain-control", "equipped creature", { optional: true }), rec("untap", "equipped creature")], 2)]),
      (path, abs) => expect(players(abs, "gains-control"), `Assault Suit ${path}`).toEqual(["opp"]));
    all(both("Infernal Denizen", "Creature — Demon", "At the beginning of your upkeep, sacrifice two Swamps. If you can't, tap this creature, and an opponent may gain control of a creature you control of their choice for as long as this creature remains on the battlefield.\n{T}: Gain control of target creature for as long as this creature remains on the battlefield.",
      [trig("upkeep", "you", "you", [rec("sacrifice", "two Swamps"), rec("tap", "this creature"), rec("gain-control", "a creature you control of their choice", { optional: true })]), { id: 2, abilityType: "activated", actions: [gc("target creature")] }]),
      (path, abs) => { if (path === "model") expect(players(abs, "gains-control"), `Infernal Denizen ${path}`).toEqual(["opp", "you"]); });
    all(both("Juxtapose", "Sorcery", "You and target player exchange control of the creature you each control with the greatest mana value. Then exchange control of artifacts the same way. If two or more permanents a player controls are tied for greatest, their controller chooses one of them.",
      [{ id: 1, abilityType: "spell", actions: [gc("the creature you control with the greatest mana value"), gc("the creature target player controls with the greatest mana value"), gc("an artifact you control"), gc("an artifact target player controls")] }]),
      (path, abs) => { if (path === "model") expect(players(abs, "gains-control"), `Juxtapose ${path}`).toEqual(["opp", "you", "opp", "you"]); });
    // The own-object rule alone, with NO clause text to lean on (Coveted Falcon's turned-face-up half).
    expect(actionEmits(gc("any number of target permanents you control") as never)[0]?.subject.control).toBe("opp");
    expect(actionEmits(gc("target creature with power less than or equal to the number of creatures you control") as never)[0]?.subject.control).toBe("you");
  });
  test("#1395: a textless twin takes its partner's reading, so Wernog keeps one ability set per limb (grammar records, 6 abilities)", () => {
    const text = "When Wernog, Rider's Chaplain enters or leaves the battlefield, each opponent may investigate. Each opponent who doesn't loses 1 life. You investigate X times, where X is one plus the number of opponents who investigated this way.\nPartner—Friends forever (You can have two commanders if both have this ability.)";
    const card = { name: "Wernog, Rider's Chaplain", typeLine: "Legendary Creature — Human", oracleText: text, keywords: ["Investigate", "Partner"] };
    const g = grammarClauseRecords(card as never);
    const abs = deriveCardTags(deriveInputOf(card as never, "x", card.name, g.records as never, undefined, g.readings)).abilities;
    expect(abs).toHaveLength(6);
    expect(abs.filter((a) => a.emits?.some((e) => e.verb === "create-token" && e.subject.control === "any"))).toHaveLength(0);
  });

  test("#1395: another player's phrase joined by 'and each other player' is not the owner's draw (Oft-Nabbed Goat)", () => {
    all(both("Oft-Nabbed Goat", "Creature — Goat", "{1}: Draw a card. Gain control of this creature and put a -1/-1 counter on it. Only your opponents may activate this ability and only as a sorcery.\nWhen this creature dies, if it had one or more -1/-1 counters on it, its owner draws that many cards and each other player loses that much life.",
      [{ id: 1, abilityType: "activated", actions: [rec("draw", "you", { amount: "1" }), rec("gain-control", "this creature"), rec("add-counter", "-1/-1", { amount: "1" })] },
        trig("dies", "this creature", "you", [rec("draw", "its owner", { amount: "the number of -1/-1 counters on it" }), rec("lose-life", "each other player", { amount: "the number of -1/-1 counters on it" })], 2)]),
      (path, abs) => { if (path === "model") expect(abs.filter((a) => a.clause === 2).flatMap((a) => a.emits ?? []).filter((e) => e.verb === "draw").map((e) => e.subject.control), `Goat ${path}`).toEqual(["you"]); });
  });
  test("#1395: a textless record borrows the reading of the sibling whose sentence names ITS event, not the first identical one (Tome of Legends)", () => {
    const text = "This artifact enters with a page counter on it.\nWhenever your commander enters or attacks, put a page counter on this artifact.\n{1}, {T}, Remove a page counter from this artifact: Draw a card.";
    const card = { name: "Tome of Legends", typeLine: "Artifact — Book", oracleText: text, keywords: [] as string[] };
    const g = grammarClauseRecords(card as never);
    const abs = deriveCardTags(deriveInputOf(card as never, "x", card.name, g.records as never, undefined, g.readings)).abilities;
    const limb = (verb: string) => abs.filter((a) => a.trigger?.verbs.includes(verb as never)).map((a) => JSON.stringify([a.emits, a.effect, a.amount]));
    expect(limb("attacks")).toHaveLength(1);
    expect(limb("attacks")).toEqual(limb("enters"));
  });
});

