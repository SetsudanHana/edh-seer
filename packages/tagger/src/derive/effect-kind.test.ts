import { expect, test } from "vitest";
import { actionEffectKind } from "./effect-kind.js";

test("the origin zone decides the kind, because the zone is the card", () => {
  // Scavenging Ooze, Bojuka Bog.
  expect(actionEffectKind({ verb: "exile", fromZone: "graveyard" })).toBe("graveyard-hate");
  // Removal by exile has no payoff kind at all.
  expect(actionEffectKind({ verb: "exile", fromZone: null })).toBeNull();
  // Reanimate, Necromancy say "put"; Animate Dead says "return". Same effect, same kind.
  expect(actionEffectKind({ verb: "put", fromZone: "graveyard", toZone: "battlefield" })).toBe("graveyard-recursion");
  expect(actionEffectKind({ verb: "return", fromZone: "graveyard", toZone: "battlefield" })).toBe("graveyard-recursion");
});

test("plain verb lookups", () => {
  expect(actionEffectKind({ verb: "create" })).toBe("token-generation");
  expect(actionEffectKind({ verb: "deal-damage" })).toBe("damage");
  expect(actionEffectKind({ verb: "draw" })).toBe("draw-card");
  expect(actionEffectKind({ verb: "add-mana" })).toBe("mana-generation");
  expect(actionEffectKind({ verb: "add-counter" })).toBe("counter-placement");
  expect(actionEffectKind({ verb: "modify-pt" })).toBe("pump");
  expect(actionEffectKind({ verb: "untap" })).toBe("untap");
  expect(actionEffectKind({ verb: "proliferate" })).toBe("proliferate");
  expect(actionEffectKind({ verb: "animate" })).toBe("animate");
  expect(actionEffectKind({ verb: "copy" })).toBe("clone");
  expect(actionEffectKind({ verb: "extra-combat" })).toBe("extra-combat");
});

test("life change splits by who it happens to", () => {
  expect(actionEffectKind({ verb: "gain-life", object: "you" })).toBe("lifegain");
  expect(actionEffectKind({ verb: "lose-life", object: "each opponent" })).toBe("player-life-loss");
});

test("an action with no home in the closed 29 produces null, never a near miss", () => {
  expect(actionEffectKind({ verb: "destroy" })).toBeNull();
  expect(actionEffectKind({ verb: "fight" })).toBeNull();
  expect(actionEffectKind({ verb: "other", object: "flip a coin" })).toBeNull();
  // The closed 29 has no counterspell kind. `tax` means a cost increase (Thalia-style), a
  // different game action from countering a spell outright -- mapping the two together would
  // falsely mesh counterspells with stax payoffs. Returns null and surfaces via the unclaimed
  // list instead of a near-miss kind.
  expect(actionEffectKind({ verb: "counter-spell" })).toBeNull();
});

test("every kind the table can return is a member of the closed set", async () => {
  const { EFFECT_KINDS } = await import("../schema.js");
  const samples = ["create", "deal-damage", "draw", "add-mana", "add-counter", "modify-pt",
    "untap", "proliferate", "animate", "copy", "extra-combat", "gain-life", "lose-life"];
  for (const verb of samples) {
    const kind = actionEffectKind({ verb });
    if (kind) expect(EFFECT_KINDS).toContain(kind);
  }
});

test("recursion is keyed on the graveyard origin, not on one templating of the move", () => {
  // Muldrotha says PLAY/CAST from the graveyard rather than moving a card; keying only on
  // put/return lost the whole card.
  expect(actionEffectKind({ verb: "play", object: "a land from your graveyard", fromZone: "graveyard", toZone: "battlefield" }))
    .toBe("graveyard-recursion");
  expect(actionEffectKind({ verb: "cast", object: "a permanent spell from your graveyard", fromZone: "graveyard" }))
    .toBe("graveyard-recursion");
});

test("exile-and-return-to-the-battlefield is a flicker; the return carries the kind", () => {
  expect(actionEffectKind({ verb: "return", object: "it", fromZone: "exile", toZone: "battlefield" })).toBe("flicker");
  // The exile half states no payoff of its own -- one Ability per action, and this one is inert.
  expect(actionEffectKind({ verb: "exile", object: "target creature you control", fromZone: "battlefield", toZone: "exile" }))
    .toBeNull();
});

test("putting cards into a graveyard is the payoff mill already names", () => {
  expect(actionEffectKind({ verb: "put", object: "those cards", toZone: "graveyard" })).toBe("top-manipulation");
  // ...but a graveyard ORIGIN still wins: that is recursion, not a fill.
  expect(actionEffectKind({ verb: "put", object: "target creature card", fromZone: "graveyard", toZone: "battlefield" }))
    .toBe("graveyard-recursion");
});

test("self-mill is a graveyard entry from the LIBRARY, not any move into a graveyard", () => {
  // canonicalAction nulls an unstated/library origin, so from:null IS the self-mill case.
  expect(actionEffectKind({ verb: "put", object: "those cards", fromZone: null, toZone: "graveyard" }))
    .toBe("top-manipulation");
  // Moving a permanent off the battlefield into a graveyard is removal; calling it a
  // top-manipulation payoff would mesh removal with every mill deck.
  expect(actionEffectKind({ verb: "put", object: "target creature", fromZone: "battlefield", toZone: "graveyard" }))
    .toBeNull();
});
