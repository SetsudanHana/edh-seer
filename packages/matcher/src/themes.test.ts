import { expect, test } from "vitest";
import { themeCandidates, themeMembership } from "./themes.js";
import type { Reason } from "@mtg/engine";
import type { DeckCard } from "./types.js";

const card = (name: string, abilities: NonNullable<DeckCard["tags"]>["abilities"]): DeckCard => ({
  card: { name, typeLine: "Creature", oracleText: "", keywords: [], colors: [], manaValue: 0 } as never,
  tags: {
    oracleId: name, schemaVersion: 1, promptVersion: 1, model: "t",
    characteristics: { types: ["creature"], subtypes: ["wizard"], colors: [], identity: [], cmc: 1, power: "1", toughness: "1", token: false, keywords: [] },
    abilities,
  },
});

const reason = (tag: string, producer: string, consumer: string, implied?: boolean): Reason => ({
  tag, text: `${consumer} / ${producer}`, producer, consumer,
  ...(implied ? { impliedProducer: true } : {}),
});

test("baseline suppliers are separated from surplus producers and payoffs", () => {
  const payoff = card("Payoff", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { subtype: "wizard", control: "you", token: false } },
    effect: { kind: "draw-card" },
  }]);
  const maker = card("Token Maker", [{
    kind: "triggered",
    trigger: { verbs: ["attacks"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "token-generation", subject: { subtype: "wizard", control: "you", token: true } },
    emits: [{ verb: "enters", subject: { subtype: "wizard", control: "you", token: true } }],
  }]);
  const vanilla = card("Vanilla Wizard", []);

  const reasons = [
    reason("enters:wizard", "Token Maker", "Payoff"),
    reason("enters:wizard", "Vanilla Wizard", "Payoff", true),
  ];
  const [t] = themeMembership([payoff, maker, vanilla], reasons, ["enters:wizard"]);

  expect(t.surplus).toContain("Token Maker");
  expect(t.baseline).toContain("Vanilla Wizard");
  expect(t.payoffs).toContain("Payoff");
  expect(t.surplus).not.toContain("Vanilla Wizard");
});

test("a trigger-only payoff is not credited as a surplus supplier", () => {
  // Payoff's ability has a trigger naming "enters:wizard" but no emits -- it consumes the tag,
  // it does not supply it. cardThemeTags would fold the trigger verb in and wrongly mark it
  // surplus; authoredSurplusTags must not.
  const payoff = card("Payoff", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { subtype: "wizard", control: "you", token: false } },
    effect: { kind: "draw-card" },
  }]);
  const maker = card("Token Maker", [{
    kind: "triggered",
    trigger: { verbs: ["attacks"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "token-generation", subject: { subtype: "wizard", control: "you", token: true } },
    emits: [{ verb: "enters", subject: { subtype: "wizard", control: "you", token: true } }],
  }]);

  const reasons = [reason("enters:wizard", "Token Maker", "Payoff")];
  const [t] = themeMembership([payoff, maker], reasons, ["enters:wizard"]);

  expect(t.surplus).not.toContain("Payoff");
  expect(t.payoffs).toContain("Payoff");
  expect(t.surplus).toContain("Token Maker");
});

test("a selective tag admits its baseline; an unselective one does not", () => {
  // One payoff, and 9 cards that supply the tag purely by existing: 9/10 of the deck.
  const payoff = card("Payoff", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "draw-card" },
  }]);
  const fuel = Array.from({ length: 9 }, (_, i) => card(`Bear ${i}`, []));
  const reasons = fuel.map((f) => reason("enters:creature", f.card.name, "Payoff", true));

  const [broad] = themeMembership([payoff, ...fuel], reasons, ["enters:creature"], 0.55);
  expect(broad.selective, "9 of 10 cards qualify by existing").toBe(false);
  expect(broad.members).not.toContain("Bear 0");
  expect(broad.members).toContain("Payoff");

  // Same shape, but only 2 of 10 cards supply it.
  const few = fuel.slice(0, 2).map((f) => reason("enters:wizard", f.card.name, "Payoff", true));
  const [narrow] = themeMembership([payoff, ...fuel], few, ["enters:wizard"], 0.55);
  expect(narrow.selective).toBe(true);
  expect(narrow.members).toContain("Bear 0");
});

test("a static tag never nominates a theme", () => {
  // static:pump claimed 90 of 92 cards on nashi-sole-survivor; an anthem is a payoff of whatever
  // theme supplies its subject, not a theme.
  expect(themeCandidates(["enters:wizard", "static:pump", "static:cost-reduction", "enters:land"]))
    .toEqual(["enters:wizard", "enters:land"]);
});

test("a replacement effect supplies surplus rather than consuming", () => {
  const doubler = card("Token Doubler", [{
    kind: "static",
    effect: { kind: "token-doubling", subject: { type: "creature", control: "you", token: true } },
  }]);
  const payoff = card("Payoff", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "draw-card" },
  }]);
  const reasons: Reason[] = [{
    tag: "enters:creature", text: "x", producer: "Token Doubler", consumer: "Payoff",
    effectKind: "token-doubling",
  }];
  const [t] = themeMembership([doubler, payoff], reasons, ["enters:creature"]);
  expect(t.surplus, "a doubler multiplies the event stream, so it produces").toContain("Token Doubler");
  expect(t.payoffs).not.toContain("Token Doubler");
});
