import { expect, test } from "vitest";
import { canonicalActions, canonicalize, canonicalTrigger } from "./canonicalize.js";

test("a default origin is normalised away, a stated one is not", () => {
  // The whole point: "put ... from a GRAVEYARD onto the battlefield" is Reanimate, and dropping
  // that origin split reanimation on templating alone — Animate Dead says "Return" and kept it.
  expect(canonicalActions([{ verb: "put", fromZone: "library", toZone: "battlefield" }])[0].fromZone).toBeNull();
  expect(canonicalActions([{ verb: "put", fromZone: null, toZone: "battlefield" }])[0].fromZone).toBeNull();
  expect(canonicalActions([{ verb: "put", fromZone: "graveyard", toZone: "battlefield" }])[0].fromZone).toBe("graveyard");
  // Scavenging Ooze and Bojuka Bog: for exile the origin IS the card.
  expect(canonicalActions([{ verb: "exile", fromZone: "graveyard" }])[0].fromZone).toBe("graveyard");
  // Kura vs Cultivate — the destination must always survive.
  expect(canonicalActions([{ verb: "put", toZone: "hand" }])[0].toZone).toBe("hand");
});

test("facts the model was never entitled to choose collapse to one encoding", () => {
  expect(canonicalActions([])).toEqual([{ verb: "none" }]);                 // empty ≡ [none]
  expect(canonicalActions([{ verb: "reveal" }])).toEqual([{ verb: "none" }]); // bookkeeping only
  expect(canonicalActions([{ verb: "cast", fromZone: "exile", toZone: "stack" }])[0].toZone).toBeNull();
  expect(canonicalTrigger({ event: "none" })).toBeUndefined();
  expect(canonicalTrigger(null)).toBeUndefined();
  expect(canonicalTrigger({ event: "upkeep" })?.event).toBe("upkeep");
});

test("two spellings of one clause canonicalise to the same record", () => {
  const a = canonicalize([{ id: 1, trigger: { event: "none" }, actions: [{ verb: "reveal" }, { verb: "put", fromZone: "library", toZone: "hand" }] }]);
  const b = canonicalize([{ id: 1, actions: [{ verb: "put", fromZone: null, toZone: "hand" }] }]);
  expect(a).toEqual(b);
});

test("order of actions is preserved — it is data, not spelling", () => {
  const acts = canonicalActions([{ verb: "exile" }, { verb: "deal-damage" }]);
  expect(acts.map((x) => x.verb)).toEqual(["exile", "deal-damage"]);
});
