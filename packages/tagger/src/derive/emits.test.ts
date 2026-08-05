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
