import { expect, test } from "vitest";
import { actionEmits } from "./emits.js";

test("removal emits a death event even though it has no payoff kind", () => {
  const e = actionEmits({ verb: "destroy", object: "target creature" });
  expect(e).toHaveLength(1);
  expect(e[0].verb).toBe("dies");
  expect(e[0].subject).toEqual({ control: "any", token: null, type: "creature", scope: "target" });
});

test("a token maker emits both the creation and the entry", () => {
  const e = actionEmits({ verb: "create", object: "a 1/1 white Soldier creature token" });
  expect(e.map((x) => x.verb)).toEqual(["create-token", "enters"]);
});

test("life change emits with the affected player as subject", () => {
  expect(actionEmits({ verb: "lose-life", object: "each opponent" })[0])
    .toEqual({ verb: "lose-life", subject: { control: "opp", token: null, scope: "each" } });
});

test("an action with no event contributes nothing rather than a guess", () => {
  expect(actionEmits({ verb: "other", object: "flip a coin" })).toEqual([]);
  expect(actionEmits({ verb: "none", object: "" })).toEqual([]);
});

// "life total becomes N" only loses life if the current total is above N — direction depends on
// state derivation cannot see (17 corpus cards set it upward, e.g. Captive Audience to 4; only
// Sorin Markov sets an opponent's down). A guessed lose-life here wires the wrong direction.
test("set-life emits nothing because the direction depends on the current life total", () => {
  expect(actionEmits({ verb: "set-life", object: "target opponent" })).toEqual([]);
});

test("play only emits land-play for an actual land -- 'play that card' is not a land drop", () => {
  expect(actionEmits({ verb: "play", object: "a land card" }).map((e) => e.verb)).toEqual(["land-play"]);
  // Ark of Hunger: "play that card" plays whatever was exiled, not necessarily a land -- an
  // unconditional land-play emit here would wire a false landfall edge.
  expect(actionEmits({ verb: "play", object: "that card" })).toEqual([]);
});

test("a move's events come from where it lands, not from the verb alone", () => {
  expect(actionEmits({ verb: "put", object: "those cards", toZone: "graveyard" }).map((e) => e.verb))
    .toEqual(["enters-graveyard"]);
  expect(actionEmits({ verb: "return", object: "chosen creature cards", fromZone: "graveyard", toZone: "battlefield" }).map((e) => e.verb))
    .toEqual(["enters"]);
  // A bounce to hand lands nowhere anything triggers on, so it emits nothing rather than guessing.
  expect(actionEmits({ verb: "return", object: "target creature", toZone: "hand" })).toEqual([]);
});


test("entering tapped is not a tap EVENT", () => {
  // 192 of the 295 corpus cards with a tap action record object "this" -- Bojuka Bog and every
  // other land that enters tapped -- plus "it"/"that land"/"the token" for Farseek and Evolving
  // Wilds. A permanent arriving in a tapped state causes no tap event by the rules: nothing
  // triggers on it. Emitting one made `taps:any` a 12%-of-deck pseudo-event that won the theme axis
  // in decks with nothing to do with tapping.
  expect(actionEmits({ verb: "tap", object: "this" })).toEqual([]);
  expect(actionEmits({ verb: "tap", object: "it" })).toEqual([]);
  expect(actionEmits({ verb: "tap", object: "that land" })).toEqual([]);
  expect(actionEmits({ verb: "tap", object: "the token" })).toEqual([]);

  // A tap aimed at permanents already on the battlefield IS an event, and the vocabulary marks
  // those with a scope.
  expect(actionEmits({ verb: "tap", object: "target creature" }).map((e) => e.verb)).toEqual(["taps"]);
  expect(actionEmits({ verb: "tap", object: "all creatures your opponents control" }).map((e) => e.verb)).toEqual(["taps"]);
});

test("a move records the zone it came FROM, so origin-constrained triggers can be satisfied", () => {
  // "Return target creature card from your graveyard to the battlefield" is what River Kelpie's
  // "enters from a graveyard" is waiting for. The clause states the origin on the ACTION, and the
  // object text usually does not repeat it ("return it to the battlefield"), so the emit has to take
  // it from `fromZone` rather than from `parseSubject` alone.
  const [enters] = actionEmits({
    verb: "return", object: "it", fromZone: "graveyard", toZone: "battlefield",
  });
  expect(enters.verb).toBe("enters");
  expect(enters.subject.fromZone).toBe("graveyard");

  const [fromExile] = actionEmits({
    verb: "put", object: "target creature card", fromZone: "exile", toZone: "battlefield",
  });
  expect(fromExile.subject.fromZone).toBe("exile");
});

test("an emit with no stated origin keeps none", () => {
  // Unset means "any origin" on the consumer side, and a guessed origin here would be the wrong kind
  // of answer: a token being created comes from nowhere at all.
  const emits = actionEmits({ verb: "create", object: "a 1/1 white Soldier creature token" });
  for (const e of emits) expect(e.subject.fromZone).toBeUndefined();
});

// An add-counter action's OBJECT is the counter kind itself - Omo's is "everything", Prowl's is
// "+1/+1" - so the emit can state which counter it adds. Without it every counter placer emitted an
// untyped counter-added that wildcarded onto any counter payoff. 297 of the corpus's 350
// add-counter actions name a kind in the closed dictionary.
test("a counter-added emit carries the kind of counter it adds", () => {
  expect(actionEmits({ verb: "add-counter", object: "+1/+1" })[0].subject.counter).toBe("+1/+1");
  expect(actionEmits({ verb: "add-counter", object: "everything" })[0].subject.counter).toBe("everything");
  // The model writes the noun both ways.
  expect(actionEmits({ verb: "add-counter", object: "charge counter" })[0].subject.counter).toBe("charge");
});

// Proliferate and "put those counters on" name no kind at all. Inventing one would be consumed as
// if it were true, and an untyped counter-added is already wildcarded on purpose.
test("an add-counter naming no known kind states none", () => {
  expect(actionEmits({ verb: "add-counter", object: "those counters" })[0].subject.counter).toBeUndefined();
  expect(actionEmits({ verb: "add-counter", object: "target creature" })[0].subject.counter).toBeUndefined();
});

// A NAMED token states its type on the TOKEN, not on the cards that happen to share its subtype.
// "Create two Treasure tokens" parses to {token: true, subtype: "treasure"} with no type, because
// "token" is not a type word — and matcher's `expandTypes` then falls back to the CARD hierarchy,
// which answers `treasure -> artifact+creature` because Goldhound is an "Artifact Creature —
// Treasure Dog". That made Big Score, an Instant with no creature anywhere, feed Warstorm Surge's
// "whenever a creature you control enters". 164 subtype-only enters emits corpus-wide; 81 false
// reasons once producers that are themselves creatures are excluded — those supply a creature
// entering with their own body, which is a real edge and nothing to do with the token.
test("a named token's type comes from the token, not from cards sharing its subtype", () => {
  const enters = actionEmits({ verb: "create", object: "two Treasure tokens" })
    .find((e) => e.verb === "enters")!;
  expect(enters.subject.type).toBe("artifact");
  expect(enters.subject.subtype).toBe("treasure");
});

// The same gap in the other direction, and the reason the defect looked non-uniform: `blood`,
// `gold` and `junk` are ABSENT from hierarchy.json, so those emits expanded to the empty set and
// failed EVERY typed consumer — including the correct `enters:artifact`. This half is a RECALL fix.
test("a token subtype absent from the card hierarchy still gets its type", () => {
  for (const [object, subtype] of [["a Blood token", "blood"], ["a Junk token", "junk"]]) {
    const enters = actionEmits({ verb: "create", object }).find((e) => e.verb === "enters")!;
    expect(enters.subject.type, object).toBe("artifact");
    expect(enters.subject.subtype, object).toBe(subtype);
  }
});

// An authored type is the card's own words and outranks the lookup: "a 1/1 white Soldier creature
// token" already says creature. The map only fills a type that is MISSING.
test("an authored token type is not overwritten by the token lookup", () => {
  const enters = actionEmits({ verb: "create", object: "a 1/1 white Soldier creature token" })
    .find((e) => e.verb === "enters")!;
  expect(enters.subject.type).toBe("creature");
});

// Unknown stays unknown. A token subtype the collection does not carry gets no type invented for
// it — the same refusal `parseCounter` makes for an unknown counter kind.
test("an unrecognised token subtype states no type rather than guessing", () => {
  const enters = actionEmits({ verb: "create", object: "a Grobnar token" })
    .find((e) => e.verb === "enters")!;
  expect(enters.subject.type).toBeUndefined();
});
