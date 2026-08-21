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

// KEYWORD ACTIONS EXPAND INTO THE PRIMITIVES THE RULES SAY THEY ARE. The clause records the card's
// own word; derivation gives the matcher ordinary events. Each expectation is CR 701's definition.
test("connive is draw-then-discard, the pattern the community calls looting", () => {
  // 701.50: "draws a card, then discards a card."
  const ev = actionEmits({ verb: "connive", object: "this creature" });
  expect(ev.map((e) => e.verb).sort()).toEqual(["discard", "draw"]);
});

test("recruit is connive's shape too, per 701.70", () => {
  // "Draw a card, then discard a card. If you discarded a nonland card this way, create a 1/1 white
  // Human Soldier." The token is CONDITIONAL and deliberately not emitted.
  const ev = actionEmits({ verb: "recruit", object: "you" });
  expect(ev.map((e) => e.verb).sort()).toEqual(["discard", "draw"]);
  expect(ev.some((e) => e.verb === "create-token")).toBe(false);
});

test("bolster places a +1/+1 counter, and says WHICH counter", () => {
  // 701.39: "Put N +1/+1 counters on that creature." The object names the recipient, not the
  // counter, so an untyped emit would wildcard onto poison and time payoffs.
  const ev = actionEmits({ verb: "bolster", object: "a creature you control" });
  expect(ev.map((e) => e.verb)).toEqual(["counter-added"]);
  expect(ev[0].subject.counter).toBe("+1/+1");
});

test("blight is the SIGN that makes the counter kind a map and not a constant", () => {
  // 701.68: "put N -1/-1 counters on a creature you control."
  expect(actionEmits({ verb: "blight", object: "a creature you control" })[0].subject.counter).toBe("-1/-1");
});

test("investigate creates a token and something enters; manifest does NOT create one", () => {
  // 701.16 investigate: "Create a Clue token." 701.40 manifest: "Put that CARD onto the battlefield
  // face down" — a card, never a token.
  expect(actionEmits({ verb: "investigate", object: "a Clue token" }).map((e) => e.verb).sort())
    .toEqual(["create-token", "enters"]);
  expect(actionEmits({ verb: "manifest", object: "the top card of your library" }).map((e) => e.verb))
    .toEqual(["enters"]);
});

test("a keyword the rules give no event emits nothing at all", () => {
  // goad 701.15 and regenerate 701.19 are a status and a replacement effect. They earn a VERB so the
  // clause survives, and no emit, because there is no event to claim.
  expect(actionEmits({ verb: "goad", object: "target creature" })).toEqual([]);
  expect(actionEmits({ verb: "regenerate", object: "this creature" })).toEqual([]);
});

test("rolling dice emits the event 7 corpus consumers watch; flipping a coin emits nothing", () => {
  // CR 706.1 — 162 corpus cards instruct a roll against 7 that trigger on one, so supply was never
  // the scarce side; it simply had no verb to arrive as.
  expect(actionEmits({ verb: "roll-dice", object: "a d20" }).map((e) => e.verb)).toEqual(["dice-rolled"]);
  // CR 705 — 81 cards flip and ZERO trigger on another card's flip. A flip is self-contained
  // ("flip a coin. If you win the flip, ..."), and even Okaun and Zndrsplt flip and pay off on one
  // card. A word with no event, like goad and vote.
  expect(actionEmits({ verb: "flip-coin", object: "a coin" })).toEqual([]);
});

// FAMILY A (panel, 2026-08-20): an UNSTATED controller is the ability's controller, not a wildcard
// that satisfies an opponent-facing trigger. `parseControl` returns "any" for anything it cannot
// read and `matcher/subject.ts` treats "any" as a PERMISSION — measured, 3,157 of 4,137 emits carry
// it against 108 triggers demanding an opponent.
test("an unstated controller defaults to you on the verbs the rules pin to the controller", () => {
  expect(actionEmits({ verb: "draw", object: "a card" }, "Draw a card.")[0].subject.control).toBe("you");
  expect(actionEmits({ verb: "mill", object: "three cards" }, "Mill three cards.")[0].subject.control).toBe("you");
  expect(actionEmits({ verb: "sacrifice", object: "another creature" }, "Sacrifice another creature.")[0].subject.control)
    .toBe("you");
});

// A BLANKET DEFAULT WOULD BE WRONG, which is why this is a verb list: "destroy target permanent"
// and "tap target creature" name no player either and are routinely aimed at an opponent's board.
test("verbs whose object can be anyone's keep their unstated control", () => {
  expect(actionEmits({ verb: "tap", object: "target creature" })[0].subject.control).toBe("any");
  expect(actionEmits({ verb: "destroy", object: "target permanent" })[0].subject.control).toBe("any");
});

// THE SENTENCE DECIDES, NOT THE OBJECT — reading `action.object` alone cost two REAL panel claims.
// Dark Deal ("each player discards all the cards in their hand, then draws that many cards") and
// Ruin Grinder ("each player draws seven cards") derive an action whose object is just "cards",
// with the player named earlier in the sentence; both really do make an OPPONENT draw, which is
// what Orcish Bowmasters and Scrawling Crawler watch for.
test("a player named anywhere in the clause blocks the default", () => {
  const withText = actionEmits({ verb: "draw", object: "seven cards" }, "Each player draws seven cards.");
  expect(withText[0].subject.control).toBe("any");
  // NO CLAUSE TEXT IS "SAY NOTHING", never "guess you" — Pongify's Ape token goes to the destroyed
  // permanent's controller, and from the object text alone it reads as yours.
  expect(actionEmits({ verb: "draw", object: "a card" }, undefined)[0].subject.control).toBe("any");
  expect(actionEmits({ verb: "draw", object: "cards" }, "Target opponent draws a card.")[0].subject.control)
    .toBe("any");
});

// A RECIPIENT IS NOT A SUBJECT (2026-08-22). `parseSubject` reads type words out of whatever text it
// is handed, so Arcane Denial's draw -- whose object the model records as "target spell's
// controller", correctly naming WHO draws -- produced `type: spell` and the theme tag `draw:spell`.
// One card then took a whole deck's headline, because `rankThemes` adds a tag's `:any` sibling's
// strength to its own: `draw:spell` inherited all 29 cards of `draw:any` and `birb-control` read
// "draw" at cohesion 0.02, one card of 78.
test("a player-shaped object gives a draw no card type", () => {
  const e = actionEmits({ verb: "draw", object: "target spell's controller" })[0];
  expect(e.subject.type).toBeUndefined();
  expect(actionEmits({ verb: "draw", object: "you" })[0].subject.type).toBeUndefined();
  // A REAL card type on a draw survives: "draw a card" says nothing, but a typed draw is rare and
  // must not be swallowed by this guard.
  expect(actionEmits({ verb: "draw", object: "a creature card" })[0].subject.type).toBe("creature");
  // Ledger Shredder's "this creature connives" names the permanent whose ability it is, not the card
  // drawn -- the same defect with a permanent in place of a player, and it took three decks'
  // headlines to cohesion 0.02 on a single card.
  expect(actionEmits({ verb: "draw", object: "this creature" })[0].subject.type).toBeUndefined();
  // AND THROUGH A KEYWORD: `connive` IS a draw and a discard (CR 701.50), so the action verb is
  // `connive` while the emit carrying the bad subject is `draw`. Keying the guard on the action verb
  // missed this and cost a re-derive to discover.
  const connive = actionEmits({ verb: "connive", object: "this creature" }).find((e) => e.verb === "draw")!;
  expect(connive.subject.type).toBeUndefined();
});

/** THE PLAYER HALF IS KEPT, and it is load-bearing: `lose-life` with `{control: "opp"}` is how a
 *  drain finds its victim, and `lose-life:opp` is a tag with real consumers. Only the card type,
 *  which was never in the sentence, is dropped. */
test("a life change still carries the player it happens to", () => {
  expect(actionEmits({ verb: "lose-life", object: "each opponent" })[0].subject)
    .toEqual({ control: "opp", token: null, scope: "each" });
});
