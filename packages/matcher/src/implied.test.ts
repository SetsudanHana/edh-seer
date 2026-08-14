import { expect, test } from "vitest";
import type { Characteristics, GameEvent } from "@mtg/tagger";
import { impliedEvents, impliedGraveyardEvents } from "./implied.js";
import { impliedCounterEvents, selfFillTypes } from "./implied.js";

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

test("a nontoken leaves@battlefield (a dies) implies a typed enters@graveyard; a token does not", () => {
  const emits: GameEvent[] = [
    { verb: "leaves", subject: { control: "you", token: false, zone: "battlefield", type: "creature" } },
    { verb: "leaves", subject: { control: "you", token: true, zone: "battlefield" } },
  ];
  const out = impliedGraveyardEvents(emits);
  expect(out).toHaveLength(1);
  expect(out[0]).toEqual({ verb: "enters", subject: { control: "you", token: false, zone: "graveyard", type: "creature" } });
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
