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
