import { expect, test } from "vitest";
import type { Characteristics, GameEvent } from "@edh-seer/tagger";
import { impliedEvents, impliedGraveyardEvents, impliedCounterEvents, enterAsCopyAbilities, keywordAbilities, proliferateAbilities, selfFillTypes, selfLeavesTypes } from "./implied.js";
import type { CardTags } from "@edh-seer/tagger";

const chars = (types: string[], subtypes: string[] = []): Characteristics => ({
  types, subtypes, colors: [], identity: [], cmc: 0, power: null, toughness: null, token: false, keywords: [],
});

test("a nonland permanent implies both cast and enters carrying its full types+subtypes", () => {
  const ev = impliedEvents(chars(["creature"], ["human", "wizard"]));
  const cast = ev.find((e) => e.verb === "cast");
  const enters = ev.find((e) => e.verb === "enters");
  expect(cast).toBeDefined();
  expect(enters).toBeDefined();
  expect(enters!.subject.type).toBe("creature");
  expect(enters!.subject.subtype).toEqual(["human", "wizard"]);
  expect(enters!.subject.token).toBe(false);
  expect(enters!.subject.control).toBe("you");
  expect(cast!.subject.subtype).toEqual(["human", "wizard"]);
});

test("an instant/sorcery implies cast only (no enters)", () => {
  const ev = impliedEvents(chars(["instant"]));
  expect(ev.map((e) => e.verb)).toEqual(["cast"]);
  expect(ev[0].subject.type).toBe("instant");
});

test("a land implies enters only (landfall), never cast", () => {
  const ev = impliedEvents(chars(["land"], ["island"]));
  expect(ev.map((e) => e.verb)).toEqual(["enters"]);
  expect(ev[0].subject.type).toBe("land");
  expect(ev[0].subject.token).toBe(false);
});

test("a transform card's implied events come from its FRONT face only", () => {
  // Dowsing Device // Geode Grotto. The union says land, so the card claimed to supply LANDFALL --
  // "transform is not an enters event", judged twice -- and being a land suppressed its cast
  // entirely, though Dowsing Device is an artifact you cast for {2}.
  const ev = impliedEvents({
    ...chars(["artifact", "land"], ["cave"]),
    faces: [{ types: ["artifact"], subtypes: [] }],
  });
  const enters = ev.find((e) => e.verb === "enters")!;
  expect(enters.subject.type).toBe("artifact");
  expect(enters.subject.subtype).toBeUndefined();
  expect(ev.find((e) => e.verb === "cast")).toBeDefined();
});

test("a transform card whose BACK face is the creature implies no attacks", () => {
  // Azusa's Many Journeys // Likeness of the Seeker: Enchantment — Saga on the front. The union
  // typed it a creature, so it supplied attacks and combat-damage it can never make on arrival.
  const ev = impliedEvents({
    ...chars(["enchantment", "creature"], ["saga", "human", "monk"]),
    faces: [{ types: ["enchantment"], subtypes: ["saga"] }],
  });
  expect(ev.map((e) => e.verb).sort()).toEqual(["cast", "enters"]);
  expect(ev.find((e) => e.verb === "enters")!.subject.subtype).toBe("saga");
});

test("a modal DFC casts its spell half AND plays its land half", () => {
  // Fell the Profane // Fell Mire. Read as one union subject the card was a LAND, so it implied no
  // cast at all -- 98 corpus MDFCs supplying nothing to any spellcasting payoff -- and the enters
  // it did imply claimed an INSTANT arrives on the battlefield. Per face, each half is exactly one
  // of those and never both.
  const ev = impliedEvents({
    ...chars(["instant", "land"]),
    faces: [{ types: ["instant"], subtypes: [] }, { types: ["land"], subtypes: [] }],
  });
  expect(ev.filter((e) => e.verb === "cast").map((e) => e.subject.type)).toEqual(["instant"]);
  expect(ev.filter((e) => e.verb === "enters").map((e) => e.subject.type)).toEqual(["land"]);
});

test("an adventure creature enters as the CREATURE, never as the sorcery", () => {
  // Faerie Guidemother // Gift of the Fae. Both halves are cast, so both contribute a cast -- but
  // only the creature half ever hits the battlefield or attacks.
  const ev = impliedEvents({
    ...chars(["creature", "sorcery"], ["faerie", "adventure"]),
    faces: [
      { types: ["creature"], subtypes: ["faerie"] },
      { types: ["sorcery"], subtypes: ["adventure"] },
    ],
  });
  expect(ev.filter((e) => e.verb === "cast").map((e) => e.subject.type).sort()).toEqual(["creature", "sorcery"]);
  expect(ev.filter((e) => e.verb === "enters").map((e) => e.subject.type)).toEqual(["creature"]);
  expect(ev.filter((e) => e.verb === "attacks").map((e) => e.subject.type)).toEqual(["creature"]);
});

test("only the creature face carries power and toughness", () => {
  // Marang River Regent // Coil and Catch is a 4/4 Dragon and an Instant — Omen. The instant is not
  // a 4/4, and a stats-conditioned consumer must not be told it is.
  const ev = impliedEvents({
    ...chars(["creature", "instant"], ["dragon", "omen"]),
    power: "4", toughness: "4",
    faces: [
      { types: ["creature"], subtypes: ["dragon"] },
      { types: ["instant"], subtypes: ["omen"] },
    ],
  });
  const creature = ev.find((e) => e.verb === "cast" && e.subject.type === "creature")!;
  const instant = ev.find((e) => e.verb === "cast" && e.subject.type === "instant")!;
  expect(creature.subject.power).toBe(4);
  // 0 is how `parseStat` reports "no printed power", and is exactly what a single-face instant
  // reads -- so the spell half is now indistinguishable from any other instant, which is the point.
  expect(instant.subject.power).toBe(0);
  expect(instant.subject.toughness).toBe(0);
  expect(impliedEvents(chars(["instant"]))[0].subject.power).toBe(0);
});

test("identical faces collapse rather than emitting the same event twice", () => {
  // Wear // Tear is Instant // Instant.
  const ev = impliedEvents({
    ...chars(["instant"]),
    faces: [{ types: ["instant"], subtypes: [] }, { types: ["instant"], subtypes: [] }],
  });
  expect(ev.map((e) => e.verb)).toEqual(["cast"]);
});

test("without faces the union still drives the implied events", () => {
  const ev = impliedEvents(chars(["creature"], ["wizard"]));
  expect(ev.map((e) => e.verb).sort()).toEqual(["attacks", "cast", "combat-damage", "enters"]);
});

test("a single subtype collapses to a bare string (matches SubjectFilter convention)", () => {
  const ev = impliedEvents(chars(["artifact"], ["equipment"]));
  const enters = ev.find((e) => e.verb === "enters")!;
  expect(enters.subject.subtype).toBe("equipment");
});

test("every synthesised baseline event is marked implied", () => {
  const chars = {
    types: ["creature"], subtypes: ["wizard"], colors: [], identity: [],
    cmc: 2, power: "2", toughness: "2", token: false, keywords: [],
  };
  const events = impliedEvents(chars);
  // cast + enters + attacks + combat-damage
  expect(events).toHaveLength(4);
  for (const e of events) {
    expect(e.implied, `${e.verb} must be marked implied`).toBe(true);
  }
});

test("a land implies only a marked enters", () => {
  const chars = {
    types: ["land"], subtypes: [], colors: [], identity: [],
    cmc: 0, power: null, toughness: null, token: false, keywords: [],
  };
  const events = impliedEvents(chars);
  expect(events.map((e) => e.verb)).toEqual(["enters"]);
  expect(events[0].implied).toBe(true);
});

test("mill and discard imply an untyped enters@graveyard", () => {
  const emits: GameEvent[] = [
    { verb: "mill", subject: { control: "opp", token: null } },
    { verb: "discard", subject: { control: "you", token: null } },
  ];
  const out = impliedGraveyardEvents(emits);
  expect(out).toHaveLength(2);
  expect(out.every((e) => e.verb === "enters" && e.subject.zone === "graveyard")).toBe(true);
  expect(out[0].subject.type).toBeUndefined();
});

test("a nontoken dies implies a typed enters@graveyard; a token does not; a LEAVES fills nothing", () => {
  const emits: GameEvent[] = [
    { verb: "dies", subject: { control: "you", token: false, zone: "battlefield", type: "creature" } },
    { verb: "dies", subject: { control: "you", token: true, zone: "battlefield" } },
    // A flicker, a bounce or an exile: the permanent left and went anywhere but a graveyard.
    { verb: "leaves", subject: { control: "you", token: false, zone: "battlefield", type: "creature" } },
  ];
  const out = impliedGraveyardEvents(emits);
  expect(out).toHaveLength(1);
  expect(out[0]).toEqual({ verb: "enters", subject: { control: "you", token: false, zone: "graveyard", type: "creature" } });
});

test("selfLeavesTypes stamps the card's own types on an untyped self leaves and touches nothing else", () => {
  const events: GameEvent[] = [
    { verb: "leaves", subject: { control: "you", token: null, self: true, zone: "battlefield" } },
    { verb: "leaves", subject: { control: "you", token: null, type: "creature", zone: "battlefield" } },
    { verb: "enters", subject: { control: "you", token: null, self: true, zone: "battlefield" } },
  ];
  const out = selfLeavesTypes(events, chars(["artifact", "creature"], ["golem"]));
  expect(out[0].subject.type).toEqual(["artifact", "creature"]);
  expect(out[0].subject.subtype).toEqual(["golem"]);
  expect(out[1]).toEqual(events[1]);
  expect(out[2]).toEqual(events[2]);
});

test("mill/discard do NOT imply a leaves (Blood Artist must stay unfed)", () => {
  const emits: GameEvent[] = [{ verb: "mill", subject: { control: "opp", token: null } }];
  const out = impliedGraveyardEvents(emits);
  expect(out.some((e) => e.verb === "leaves")).toBe(false);
});

test("a proliferate emit implies one untyped counter-added (control carried)", () => {
  const out = impliedCounterEvents([{ verb: "proliferate", subject: { control: "you", token: null } }] as GameEvent[]);
  expect(out).toHaveLength(1);
  expect(out[0]).toEqual({ verb: "counter-added", subject: { control: "you", token: null } });
});

test("non-proliferate verbs imply no counter-added", () => {
  const out = impliedCounterEvents([
    { verb: "mill", subject: { control: "opp", token: null } },
    { verb: "counter-added", subject: { control: "you", token: null, counter: "+1/+1" } },
  ] as GameEvent[]);
  expect(out).toHaveLength(0);
});

test("a graveyard fill of the card ITSELF carries the card's own types", () => {
  // Myriad Landscape, Buried Ruin and Inventors' Fair all sacrifice themselves, and the clause records
  // the object as a bare "this" — so the fill was UNTYPED, and `graveyardFillMatches` wildcards an
  // untyped fill onto any typed recursion consumer on purpose (a milled card's type is genuinely
  // unknown). A LAND sacrificing itself then "supplied" Bloodline Necromancer's Vampire recursion and
  // Archaeomancer's instant recursion.
  //
  // The type is not unknown here: the card that hit the graveyard is this card, and `self` says so.
  const land = chars(["Land"]);
  const fills = selfFillTypes(
    [{ verb: "enters", subject: { control: "any", token: null, self: true, zone: "graveyard" } }],
    land,
  );
  expect(fills[0].subject.type).toEqual(["land"]);
  // A fill that is NOT self-referential stays untyped: a milled card really could be anything.
  const other = selfFillTypes(
    [{ verb: "enters", subject: { control: "any", token: null, zone: "graveyard" } }], land,
  );
  expect(other[0].subject.type).toBeUndefined();
});

// A card's own cast event must advertise its COLOURS, or every colour-narrowed cast trigger matches
// nothing: Aragorn, the Uniter watches white, blue, red and green spells and found none of the deck.
// 53 cast triggers across 44 corpus cards filter on colour.
test("an implied cast event carries the card's colours", () => {
  const ev = impliedEvents({
    types: ["Creature"], subtypes: [], colors: ["U", "W"], identity: ["U", "W"],
    cmc: 3, power: "2", toughness: "2", token: false, keywords: [],
  } as never);
  const cast = ev.find((e) => e.verb === "cast");
  expect(cast?.subject.colors).toEqual(["U", "W"]);
});

test("a colourless card's implied cast event says so rather than omitting colour", () => {
  const ev = impliedEvents({
    types: ["Artifact"], subtypes: [], colors: [], identity: [],
    cmc: 2, power: null, toughness: null, token: false, keywords: [],
  } as never);
  expect(ev.find((e) => e.verb === "cast")?.subject.colors).toEqual([]);
});

// A basic land's own entry must ADVERTISE the supertype, or a producer that fetches "a basic land
// card" cannot be satisfied by the basic it actually fetches. This is the half that 09ce98d proved
// load-bearing for legendary: setting the flag only on the demanding side silently cost five real
// edges, because the producer's own entry never claimed what it was.
test("a basic land's implied entry advertises the supertype", () => {
  const ev = impliedEvents(chars(["basic", "land"], ["forest"]));
  expect(ev.find((e) => e.verb === "enters")?.subject.basic).toBe(true);
});

// The producer half of the keyword filter, set for the same reason the supertypes are: a consumer
// demanding flying that no producer can advertise deletes real edges rather than narrowing false
// ones (09ce98d's measured lesson — the one-sided cut cost 5).
test("a card's implied events advertise its printed keywords", () => {
  const ev = impliedEvents({ ...chars(["creature"], ["bird"]), keywords: ["Flying", "Vigilance"] });
  expect(ev.find((e) => e.verb === "enters")?.subject.keyword).toEqual(["flying", "vigilance"]);
});

test("a card with no keywords advertises none", () => {
  expect(impliedEvents(chars(["creature"])).find((e) => e.verb === "enters")?.subject.keyword)
    .toBeUndefined();
});

// PRINTED KEYWORDS WERE A DEAD CHANNEL. `Characteristics.keywords` comes straight off the Scryfall
// payload and MTGJSON's 220 keyword abilities are already generated into vocabulary.json, but the
// only reader anywhere in the matcher was graph.ts, drawing keyword nodes for the graph view.
// Nothing in edge formation looked at it. Measured on the normalized corpus: 23 cards have Lifelink
// and never say "gain" in their own text, and NOT ONE emitted gain-life, against 7 corpus consumers
// whose trigger watches exactly that. 13 of the 17 cards whose entire text is keyword lines derived
// zero abilities.
//
// Every mapping below is justified by the keyword's PRINTED REMINDER TEXT, mined from the corpus —
// printed text is data, the same discipline the oracle-text invariant demands.
const kw = (keywords: string[], types = ["creature"]) => ({ ...chars(types), keywords });

test("lifelink supplies a life-gain event", () => {
  // "Damage dealt by this creature also causes you to gain that much life."
  const ev = impliedEvents(kw(["lifelink"]));
  const gain = ev.find((e) => e.verb === "gain-life");
  expect(gain).toBeDefined();
  expect(gain!.subject.control).toBe("you");
  expect(gain!.implied).toBe(true);
});

test("extort supplies both halves of its drain", () => {
  // "each opponent loses 1 life and you gain that much life."
  const ev = impliedEvents(kw(["extort"]));
  expect(ev.find((e) => e.verb === "gain-life")?.subject.control).toBe("you");
  expect(ev.find((e) => e.verb === "lose-life")?.subject.control).toBe("opp");
});

test("annihilator makes the DEFENDING player sacrifice, not you", () => {
  // "defending player sacrifices two permanents of their choice."
  const ev = impliedEvents(kw(["annihilator"]));
  expect(ev.find((e) => e.verb === "sacrifice")?.subject.control).toBe("opp");
});

test("counter keywords name the kind of counter they add", () => {
  // modular/evolve/mentor/training/graft/riot/bloodthirst/undying all say +1/+1.
  expect(impliedEvents(kw(["evolve"])).find((e) => e.verb === "counter-added")?.subject.counter)
    .toBe("+1/+1");
  // "return it to the battlefield ... with a -1/-1 counter on it."
  expect(impliedEvents(kw(["persist"])).find((e) => e.verb === "counter-added")?.subject.counter)
    .toBe("-1/-1");
  // "Players dealt combat damage by this creature also get three poison counters."
  expect(impliedEvents(kw(["toxic"])).find((e) => e.verb === "counter-added")?.subject.counter)
    .toBe("poison");
});

test("amass both adds a counter and makes a token", () => {
  // "Put a +1/+1 counter on an Army you control. ... create a 0/0 black Zombie Army creature token"
  const ev = impliedEvents(kw(["amass"]));
  expect(ev.find((e) => e.verb === "counter-added")?.subject.counter).toBe("+1/+1");
  const token = ev.find((e) => e.verb === "create-token");
  expect(token).toBeDefined();
  expect(token!.subject.token).toBe(true);
});

// CYCLING IS THE LARGEST SINGLE KEYWORD GAP: 393 printed cards, and only 3 of the 33 in the derived
// corpus emitted a `draw`. The segmenter marks a keyword line inert (segment.ts), which is right for
// "Flying" and wrong here, because cycling's reminder text IS the ability.
test("cycling supplies both halves of its own reminder", () => {
  // "Cycling {3} ({3}, Discard this card: Draw a card.)" — Savai Triome.
  const ev = impliedEvents(kw(["Cycling"], ["land"]));
  expect(ev.find((e) => e.verb === "draw")?.subject.control).toBe("you");
  expect(ev.find((e) => e.verb === "discard")?.subject.control).toBe("you");
});

// Scryfall stamps the umbrella `Cycling` on typecycling cards TOO, but their printed reminder
// searches the library instead of drawing. 90 of the 393 are this shape, so an unconditional draw
// would be a wrong sentence on every one of them rather than a missing one.
test("typecycling discards but does NOT draw, because it searches instead", () => {
  // "Plainscycling {2} ({2}, Discard this card: Search your library for a Plains card ...)" —
  // Eternal Dragon, which carries Plainscycling, Landcycling, Typecycling AND Cycling.
  const ev = impliedEvents(kw(["Plainscycling", "Landcycling", "Typecycling", "Cycling"]));
  expect(ev.find((e) => e.verb === "discard")).toBeDefined();
  expect(ev.find((e) => e.verb === "draw")).toBeUndefined();
});

// The discard is the card itself hitting the graveyard, and that reaches recursion payoffs through
// the existing implied-fill path rather than any new machinery.
test("cycling's discard implies a graveyard fill", () => {
  const fills = impliedGraveyardEvents(impliedEvents(kw(["Cycling"])));
  expect(fills.find((e) => e.verb === "enters" && e.subject.zone === "graveyard")).toBeDefined();
});

// A CYCLED CARD IS A KNOWN CARD. An ordinary discard takes an unknown card out of your hand, so its
// fill is untyped on purpose and wildcards onto any typed recursion consumer. Cycling discards
// ITSELF, and leaving that untyped let Deceptive Landscape — a Land — "enable" World Breaker
// returning World Breaker, a claim the panel already holds a FALSE verdict on.
test("cycling's fill is self-marked, so it carries the card's own printed types", () => {
  const c = kw(["Cycling"], ["land"]);
  const fill = impliedGraveyardEvents(impliedEvents(c))
    .find((e) => e.verb === "enters" && e.subject.zone === "graveyard")!;
  expect(fill.subject.self).toBe(true);
  expect(selfFillTypes([fill], c)[0].subject.type).toEqual(["land"]);
});

// An ordinary discard still has nothing to stamp — the card leaving your hand really is unknown.
test("a non-self discard's fill stays untyped", () => {
  const out = impliedGraveyardEvents([{ verb: "discard", subject: { control: "you", token: null } }]);
  expect(out[0].subject.self).toBeUndefined();
});

// STORM IS DELIBERATELY EXCLUDED. Its reminder says "copy it for each spell cast before it" — a copy
// put onto the stack is NOT cast, so a `cast` emit would be a wrong sentence, not a missing one.
test("storm supplies no cast event, because a copy is not cast", () => {
  const ev = impliedEvents(kw(["storm"], ["instant"]));
  expect(ev.filter((e) => e.verb === "cast")).toHaveLength(1); // the card's own cast, nothing added
});

// AN ALTERNATIVE CASTING COST IS NEVER AN EMIT GAP — the family rule, tested once for all fifteen.
// `impliedEvents` already pushes a `cast` for every nonland card, so a keyword describing ANOTHER
// way to cast the same card adds a second, wider cast rather than a missing one. Flashback ranked #2
// on the keyword gap list until this was measured: 212 of 212 flashback cards are Instants or
// Sorceries and every one already implied its cast.
test("keywords that only re-cast the same card add no cast event", () => {
  for (const k of ["flashback", "escape", "foretell", "bestow", "evoke", "rebound", "mutate",
    "warp", "kicker", "convoke", "flash", "morph", "disguise", "enchant"]) {
    const ev = impliedEvents(kw([k], ["sorcery"]));
    expect(ev.filter((e) => e.verb === "cast"), `${k} must not add a second cast`).toHaveLength(1);
  }
});

// THE LAST FOUR EMIT-BEARING KEYWORDS, closing the vein. Each is justified by its printed reminder.
test("cumulative upkeep ages the permanent and then kills it", () => {
  // "At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it
  // unless you pay its upkeep cost for each age counter on it."
  const ev = impliedEvents(kw(["cumulative upkeep"]));
  expect(ev.find((e) => e.verb === "counter-added")?.subject.counter).toBe("age");
  expect(ev.find((e) => e.verb === "sacrifice")?.subject.self).toBe(true);
  expect(ev.find((e) => e.verb === "dies")?.subject.self).toBe(true);
});

test("echo sacrifices the permanent that does not pay", () => {
  // "At the beginning of your upkeep, if this came under your control since the beginning of your
  // last upkeep, sacrifice it unless you pay its echo cost."
  const ev = impliedEvents(kw(["echo"]));
  expect(ev.find((e) => e.verb === "sacrifice")?.subject.self).toBe(true);
  expect(ev.find((e) => e.verb === "dies")?.subject.self).toBe(true);
});

test("station names the counter kind it adds", () => {
  // "Tap another creature you control: Put charge counters equal to its power on this Spacecraft."
  expect(impliedEvents(kw(["station"], ["artifact"])).find((e) => e.verb === "counter-added")?.subject.counter)
    .toBe("charge");
});

// MADNESS IS A DISCARD CONSUMER, NOT A PRODUCER. "If you discard this card, discard it into exile.
// When you do, cast it for its madness cost or put it into your graveyard." The card supplies no
// discard — it is conditional on YOU discarding it by some other means — and what it does supply
// goes to EXILE, not the graveyard. Cycling is the contrast: cycling pays its own cost to discard.
test("madness supplies no discard, because it does not do the discarding", () => {
  expect(impliedEvents(kw(["madness"], ["instant"])).filter((e) => e.verb === "discard")).toHaveLength(0);
});

// SUSPEND IS REFUSED for the same reason, found on its own witness rather than by reasoning: its
// time counters sit on a card in EXILE, not on a permanent you control, so no counters-matter payoff
// can see them. A suspended card is a PROLIFERATE payoff — demand, not supply. The only consumer the
// mapping reached was Regenerations Restored, whose trigger watches its OWN time counters.
test("suspend supplies no counter, because the counters are on an exiled card", () => {
  expect(impliedEvents(kw(["suspend"], ["sorcery"])).filter((e) => e.verb === "counter-added"))
    .toHaveLength(0);
});

// Pump is an EFFECT kind, not an emitted event — a different channel entirely.
test("prowess and exalted add no event", () => {
  const before = impliedEvents(chars(["creature"])).length;
  expect(impliedEvents(kw(["prowess", "exalted"]))).toHaveLength(before);
});

test("a card with no keywords is unchanged", () => {
  expect(impliedEvents(kw([]))).toEqual(impliedEvents(chars(["creature"])));
});

test("a nonbasic land's implied entry claims no supertype", () => {
  const ev = impliedEvents(chars(["land"], ["plains", "swamp"]));
  expect(ev.find((e) => e.verb === "enters")?.subject.basic).toBeUndefined();
});

// CR 704.5s: a Saga goes to its owner's graveyard after its final chapter. A state-based action, so
// no card text states it and derivation, which reads text, cannot see it.
test("a Saga supplies its own guaranteed death", () => {
  // Summon: Fenrir — "Enchantment Creature — Saga Wolf", printed reminder "Sacrifice after III."
  const ev = impliedEvents(chars(["enchantment", "creature"], ["saga", "wolf"]));
  expect(ev.find((e) => e.verb === "sacrifice")?.subject.self).toBe(true);
  const dies = ev.find((e) => e.verb === "dies");
  expect(dies?.subject.self).toBe(true);
  // The death carries the card's printed identity, or it wildcards onto typed consumers.
  expect(dies?.subject.type).toEqual(["enchantment", "creature"]);
  expect(dies?.subject.control).toBe("you");
});

test("a TRANSFORMING Saga is exiled, never dies, and supplies neither", () => {
  // Azusa's Many Journeys // Likeness of the Seeker — "III — Exile this Saga, then return it to the
  // battlefield transformed." The matcher never sees oracle text, so the discriminator is the type
  // line: measured over all 234 corpus Sagas, multi-face <=> transform is exact (44 of 44).
  const ev = impliedEvents({
    ...chars(["enchantment", "creature"], ["saga", "human", "monk"]),
    faces: [{ types: ["enchantment"], subtypes: ["saga"] }],
  });
  expect(ev.filter((e) => e.verb === "sacrifice" || e.verb === "dies")).toHaveLength(0);
});

test("a non-Saga enchantment supplies no death", () => {
  expect(impliedEvents(chars(["enchantment"], ["aura"]))
    .filter((e) => e.verb === "sacrifice" || e.verb === "dies")).toHaveLength(0);
});

// THE DEMAND HALF OF THE KEYWORD CHANNEL. `KEYWORD_EMITS` has been rich since 2026-08-14, but a
// keyword whose reminder text is a TRIGGERED ability had no path at all: the segmenter makes a
// keyword line inert, so `tags.abilities` never holds it.
test("a keyword whose reminder is a triggered ability supplies the TRIGGER", () => {
  // "Prowess (Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn.)"
  const a = keywordAbilities(kw(["Prowess"]));
  expect(a).toHaveLength(1);
  expect(a[0].trigger?.verbs).toEqual(["cast"]);
  expect(a[0].effect.kind).toBe("pump");
  // The subject must resolve to the NARROWED type list, or `castSelfSupplied` refuses it as an
  // unconstrained cast watcher and the keyword forms no edge at all.
  expect(a[0].trigger?.subject.notType).toContain("creature");
});

test("extort watches casting, and the argument form is matched too", () => {
  // "Extort (Whenever you cast a spell, you may pay {W/B}...)" — its subject is UNNARROWED, so
  // `castSelfSupplied` refuses every implied producer and only an authored cast emit can feed it.
  // Correct, and measured: that is why extort is not the member of this table that moves anything.
  expect(keywordAbilities(kw(["Extort"]))[0].trigger?.verbs).toEqual(["cast"]);
  expect(keywordAbilities(kw(["Ward {2}"]))).toHaveLength(0);
});

test("a keyword that watches its OWN attack or entry supplies no trigger", () => {
  // Every attack- and block-triggered keyword watches itself, so no other card can supply it —
  // and evolve is refused for a different reason: its intervening if compares the entering
  // creature against this one's stats, which no SubjectFilter can express.
  for (const k of ["Exalted", "Battle cry", "Mentor", "Annihilator 2", "Evolve", "Undying"]) {
    expect(keywordAbilities(kw([k])), k).toHaveLength(0);
  }
});

// A GRAVEYARD IS A ZONE, and the three CR rules for what a multi-face card IS there disagree with
// each other — which is why `layout` had to be carried and why `faces` alone cannot decide it.
test("in a zone a card is its FRONT face, except a split card, which combines", () => {
  const fill = (chars: Characteristics) => selfFillTypes(
    [{ verb: "enters", subject: { control: "you", token: null, zone: "graveyard", self: true } }], chars,
  )[0].subject.type;
  const base = { subtypes: [], colors: [], identity: [], cmc: 2, power: null, toughness: null,
    token: false, keywords: [] };
  // 715.4 — Brazen Borrower in a graveyard is a Creature and NOT an Instant.
  expect(fill({ ...base, types: ["creature", "instant"], layout: "adventure",
    faces: [{ types: ["creature"], subtypes: [] }, { types: ["instant"], subtypes: [] }] })).toEqual(["creature"]);
  // 712.4a — an Instant // Land modal DFC is an Instant there, which is why it must not satisfy a
  // payoff counting LAND cards in your graveyard.
  expect(fill({ ...base, types: ["instant", "land"], layout: "modal_dfc",
    faces: [{ types: ["instant"], subtypes: [] }, { types: ["land"], subtypes: [] }] })).toEqual(["instant"]);
  // 709.4 — a split card really does have both halves' characteristics in every zone but the stack.
  expect(fill({ ...base, types: ["instant", "sorcery"], layout: "split",
    faces: [{ types: ["instant"], subtypes: [] }, { types: ["sorcery"], subtypes: [] }] }))
    .toEqual(["instant", "sorcery"]);
});

// C2c, the other half: a SELF fill carries the card's own supertype flags even when the clause
// already named a type. Burnished Hart is an Artifact Creature whose ability sacrifices it as a
// CREATURE, so the emit arrives with `type: creature` and used to skip the stamp entirely — leaving
// a genuinely historic card invisible to a historic-matters payoff.
test("a self graveyard fill carries historic even when the clause named a different type", () => {
  const chars = (types: string[], subtypes: string[] = []): Characteristics => ({
    types, subtypes, colors: [], identity: [], cmc: 3, power: null, toughness: null,
    token: false, keywords: [],
  });
  const fill = (subject: Record<string, unknown>): GameEvent =>
    ({ verb: "enters", subject: { control: "you", token: null, zone: "graveyard", self: true, ...subject } } as GameEvent);

  // "Sacrifice this creature" on an Artifact Creature — the type is stated, the supertype is not.
  const [hart] = selfFillTypes([fill({ type: "creature" })], chars(["artifact", "creature"]));
  expect(hart.subject.historic).toBe(true);
  expect(hart.subject.type).toBe("creature");

  // A plain creature stamps nothing, which is what keeps this from being a blanket true.
  const [bear] = selfFillTypes([fill({ type: "creature" })], chars(["creature"], ["bear"]));
  expect(bear.subject.historic).toBeUndefined();

  // The untyped path still stamps the printed types AND the flags.
  const [saga] = selfFillTypes([fill({})], chars(["enchantment"], ["saga"]));
  expect(saga.subject.historic).toBe(true);
  expect(saga.subject.subtype).toEqual(["saga"]);
});

// A PROLIFERATE HAS A DEMAND, NOT ONLY A SUPPLY. `impliedCounterEvents` has made a proliferate
// SUPPLY an untyped counter-added since it shipped; nothing made it ASK for one, so Radstorm and
// Virulent Silencer were two producers with no edge between them (recall miss, spec 26.3).
const tags = (abilities: unknown[]): CardTags => ({
  oracleId: "x", schemaVersion: 1, promptVersion: 1, model: "t",
  characteristics: { types: ["instant"], subtypes: [], colors: [], identity: [], cmc: 0, power: null, toughness: null, token: false, keywords: [] },
  abilities: abilities as CardTags["abilities"],
});
const PROLIFERATES = tags([{ kind: "on-cast", effect: { kind: "proliferate" }, emits: [{ verb: "proliferate", subject: { control: "any", token: null } }] }]);

test("a card that proliferates DEMANDS a counter source", () => {
  const a = proliferateAbilities(PROLIFERATES);
  expect(a).toHaveLength(1);
  expect(a[0].trigger?.verbs).toEqual(["counter-added"]);
  expect(a[0].effect.kind).toBe("proliferate");
  // Untyped on purpose: proliferate takes another of EACH kind already there, and it may choose an
  // OPPONENT's permanent or player -- Virulent Silencer's poison counters are a real target.
  expect(a[0].trigger?.subject.counter).toBeUndefined();
  expect(a[0].trigger?.subject.control).toBe("any");
});

test("a card that does not proliferate demands nothing", () => {
  expect(proliferateAbilities(tags([
    { kind: "triggered", effect: { kind: "counter-placement" }, emits: [{ verb: "counter-added", subject: { control: "any", token: null, counter: "+1/+1" } }] },
  ]))).toHaveLength(0);
});

test("one demand however many times the card proliferates", () => {
  const twice = tags([
    { kind: "on-cast", effect: { kind: "proliferate" }, emits: [{ verb: "proliferate", subject: { control: "any", token: null } }] },
    { kind: "activated", effect: { kind: "proliferate" }, emits: [{ verb: "proliferate", subject: { control: "any", token: null } }] },
  ]);
  expect(proliferateAbilities(twice)).toHaveLength(1);
});

// AN ENTER-AS-A-COPY REPLACEMENT IS A REASON TO BE BLINKED, and the card carried no demand for it.
// Sakashima the Impostor derives exactly `{kind: static, effect: {kind: clone}}` -- no subject, no
// emit -- so a flicker that makes it re-enter (and re-choose what it copies) formed no edge.
test("a card that enters as a copy asks to be made to enter", () => {
  const a = enterAsCopyAbilities("You may have Sakashima the Impostor enter as a copy of any creature on the battlefield, except its name is Sakashima the Impostor.", chars(["creature"], ["shapeshifter"]));
  expect(a).toHaveLength(1);
  expect(a[0].trigger?.verbs).toEqual(["enters"]);
  expect(a[0].trigger?.subject.self).toBe(true);
  expect(a[0].effect.kind).toBe("clone");
});

test("a class recipient is NOT this card's own demand", () => {
  // Essence of the Wild: "Creatures you control enter as a copy of this creature." Infinite
  // Reflection: "Nontoken creatures you control enter as a copy of enchanted creature." The
  // replacement applies to OTHER permanents; this card's own entry copies nothing, so a self
  // demand here would be a false claim. Exactly 2 of the 66 corpus cards printing the cue.
  expect(enterAsCopyAbilities("Creatures you control enter as a copy of this creature.", chars(["creature"], ["shapeshifter"]))).toHaveLength(0);
  expect(enterAsCopyAbilities("Nontoken creatures you control enter as a copy of enchanted creature.", chars(["creature"], ["shapeshifter"]))).toHaveLength(0);
});

test("a card with no copy replacement asks for nothing", () => {
  expect(enterAsCopyAbilities("When this creature enters, draw a card.", chars(["creature"], ["shapeshifter"]))).toHaveLength(0);
  expect(enterAsCopyAbilities("", chars(["creature"], ["shapeshifter"]))).toHaveLength(0);
  // "create a token that's a copy of" is a DIFFERENT family -- the token enters as the copy, not
  // this card, and it already has its own pass (`copySubject`).
  expect(enterAsCopyAbilities("Create a token that's a copy of target creature you control.", chars(["creature"], ["shapeshifter"]))).toHaveLength(0);
});

test("one demand however the template is dressed", () => {
  // Protean Raider wears an ability word; Copy Enchantment is not a creature; Imposter Mech says
  // "this Vehicle". All three are the same printed replacement.
  for (const t of [
    "Raid — If you attacked this turn, you may have this creature enter as a copy of any creature on the battlefield.",
    "You may have this enchantment enter as a copy of any enchantment on the battlefield.",
    "You may have this Vehicle enter as a copy of a creature an opponent controls, except it's a Vehicle artifact.",
  ]) expect(enterAsCopyAbilities(t, chars(["creature"], ["shapeshifter"])), t).toHaveLength(1);
});

// A Room is the only thing that can be fully unlocked, so it is the only implied supply for the eerie
// half; nothing else advertises `unlock`.
test("a Room implies being fully unlocked; a plain enchantment does not", () => {
  const room = impliedEvents(chars(["enchantment"], ["room"]));
  expect(room.some((e) => e.verb === "unlock" && e.implied)).toBe(true);
  const aura = impliedEvents(chars(["enchantment"], ["aura"]));
  expect(aura.some((e) => e.verb === "unlock")).toBe(false);
});

/** START YOUR ENGINES! IS A TRIGGER ON AN OPPONENT LOSING LIFE (CR 702.179): speed goes up once
 *  on each of your turns when one does, and every speed payoff hangs off that. 40 commander-legal
 *  cards print it and all of them derived the reminder as `none` (roadmap W9, owner 2026-09-05). */
test("start your engines! watches an opponent losing life and gains speed", () => {
  const a = keywordAbilities(kw(["Start your engines!"]));
  expect(a).toHaveLength(1);
  expect(a[0].trigger?.verbs).toEqual(["lose-life"]);
  expect(a[0].trigger?.subject.control).toBe("opp");
  expect(a[0].effect.kind).toBe("speed");
  // The PLAYER's marker, not the card's: the effect names you, as a lifegain does.
  expect(a[0].effect.subject?.control).toBe("you");
});
