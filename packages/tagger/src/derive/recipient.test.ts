import { expect, test } from "vitest";
import { actionRecipients } from "./recipient.js";

test("a permanent's controller getting the payout is an opponent", () => {
  // Pongify, Beast Within, Crib Swap, Generous Gift. Rules-wise you MAY point removal at your own
  // permanent, so this is a play-pattern judgment and not a fact -- taken deliberately, because it
  // only ever REMOVES edges. Without it the Ape is control "any", and "any" matches "you" on either
  // side (matcher/src/subject.ts), so Pongify reads as a token producer for your own token payoffs.
  expect(actionRecipients("Destroy target creature. It can't be regenerated. Its controller creates a 3/3 green Ape creature token."))
    .toEqual({ create: "opp" });
  expect(actionRecipients("Destroy target permanent an opponent controls. Its controller may search their library for a basic land card."))
    .toEqual({ search: "opp" });
});

test("a player named as an opponent is an opponent", () => {
  expect(actionRecipients("Target opponent draws two cards.")).toEqual({ draw: "opp" });
  expect(actionRecipients("Each opponent mills three cards.")).toEqual({ mill: "opp" });
  // Every player but you IS the set of opponents.
  expect(actionRecipients("Each other player draws a card.")).toEqual({ draw: "opp" });
});

test("a player named as a player is any player, and stays unstated", () => {
  // "any" is what the object text already parses to, and it is CORRECT here -- claiming `opp` would
  // be the wrong answer, not a sharper one. Nothing is returned so nothing is overridden.
  expect(actionRecipients("Target player draws a card.")).toEqual({});
  expect(actionRecipients("Each player creates a 1/1 white Soldier creature token.")).toEqual({});
});

test("\"that player\" takes the control of whoever the clause already named", () => {
  // Massacre Wurm. The antecedent is in the same clause, so this needs no judgment at all.
  expect(actionRecipients("Whenever a creature an opponent controls dies, that player mills two cards."))
    .toEqual({ mill: "opp" });
  // No opponent named first, so the antecedent is a plain player and the answer stays unstated.
  expect(actionRecipients("Choose target player. That player draws a card.")).toEqual({});
});

test("the actor must sit against its OWN verb", () => {
  // "each opponent loses 1 life and you gain 1 life" is the single most common drain wording in the
  // corpus. The recipient belongs to the life LOSS; reading it onto the gain would hand your own
  // lifegain payoffs to the opponent. 50 of the 86 actions measured are this shape.
  // The loss IS the opponent's; the gain is yours, and must not inherit the loss's actor.
  expect(actionRecipients("Whenever this creature dies, each opponent loses 1 life and you gain 1 life."))
    .toEqual({ "lose-life": "opp" });
  // Flumph: "each" between the actor and the verb means they are not this verb's actor alone.
  expect(actionRecipients("Whenever this creature is dealt damage, you and target opponent each draw a card."))
    .toEqual({});
});

test("life loss follows its actor too", () => {
  // Massacre Wurm: "Whenever a creature an opponent controls dies, that player loses 2 life." The
  // object is "that player", which parses to "any", and "any" matches "you" -- so a card that
  // punishes YOU for losing life matched it.
  expect(actionRecipients("Whenever a creature an opponent controls dies, that player loses 2 life."))
    .toEqual({ "lose-life": "opp" });
  // Symmetric life loss stays "any", which is what it is.
  expect(actionRecipients("Each player loses 3 life.")).toEqual({});
});

test("a sacrifice the OPPONENT makes is the opponent's creature dying", () => {
  // Dictate of Erebos: "whenever a creature you control dies, EACH OPPONENT sacrifices a creature of
  // their choice." The object is "creature of their choice", which parses to control `any`, and
  // `any` matches `you` on either side -- so Dictate "supplied" Zulaport Cutthroat's payoff for YOUR
  // creatures dying. The actor is named right there in the clause.
  expect(actionRecipients("Whenever a creature you control dies, each opponent sacrifices a creature of their choice."))
    .toEqual({ sacrifice: "opp" });
  expect(actionRecipients("Each opponent discards a card.")).toEqual({ discard: "opp" });
  // Your own sacrifice outlet is untouched.
  expect(actionRecipients("Sacrifice another creature: draw a card.")).toEqual({});
});
