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
