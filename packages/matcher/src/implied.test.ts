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
    front: { types: ["artifact"], subtypes: [] },
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
    front: { types: ["enchantment"], subtypes: ["saga"] },
  });
  expect(ev.map((e) => e.verb).sort()).toEqual(["cast", "enters"]);
  expect(ev.find((e) => e.verb === "enters")!.subject.subtype).toBe("saga");
});

test("without a front face the union still drives the implied events", () => {
  // A modal DFC really is castable on either half, so nothing narrows and the union is what is
  // read. PRE-EXISTING and untouched here: `isLand` is checked against that union, so an
  // Instant // Land MDFC implies enters and NOT cast, though you may cast the instant half. That is
  // a separate gap in the same family; narrowing it needs a "castable faces" list, not a front face.
  const ev = impliedEvents(chars(["instant", "land"]));
  expect(ev.map((e) => e.verb)).toEqual(["enters"]);
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
