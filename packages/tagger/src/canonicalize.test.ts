import { expect, test } from "vitest";
import { canonicalAction, canonicalActions, canonicalize, canonicalTrigger } from "./canonicalize.js";

test("a default origin is normalised away, a stated one is not", () => {
  // The whole point: "put ... from a GRAVEYARD onto the battlefield" is Reanimate, and dropping
  // that origin split reanimation on templating alone — Animate Dead says "Return" and kept it.
  // CHANGED 2026-09-07: an explicit `library` is a STATED zone (CR 400.1) and is now kept. It used
  // to be nulled as "the verb's implied default", which made it indistinguishable from unstated.
  expect(canonicalActions([{ verb: "put", fromZone: "library", toZone: "battlefield" }])[0].fromZone).toBe("library");
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
  // NARROWED 2026-09-07. This used to also assert that `fromZone: "library"` and `fromZone: null`
  // collapse together; they no longer do, because an unstated origin is not a stated one (CR 400.1,
  // 400.7). What still holds is the rest of the collapse: a dropped `reveal`, and a trigger
  // recorded as the string "none" meaning the same as no trigger at all.
  const a = canonicalize([{ id: 1, trigger: { event: "none" }, actions: [{ verb: "reveal" }, { verb: "put", fromZone: "library", toZone: "hand" }] }]);
  const b = canonicalize([{ id: 1, actions: [{ verb: "put", fromZone: "library", toZone: "hand" }] }]);
  expect(a).toEqual(b);
});

test("the two origins that used to collapse are now distinct records", () => {
  const stated = canonicalize([{ id: 1, actions: [{ verb: "put", fromZone: "library", toZone: "hand" }] }]);
  const unstated = canonicalize([{ id: 1, actions: [{ verb: "put", fromZone: null, toZone: "hand" }] }]);
  expect(stated).not.toEqual(unstated);
});

test("order of actions is preserved — it is data, not spelling", () => {
  const acts = canonicalActions([{ verb: "exile" }, { verb: "deal-damage" }]);
  expect(acts.map((x) => x.verb)).toEqual(["exile", "deal-damage"]);
});

// AN UNSTATED ORIGIN IS NOT A LIBRARY ORIGIN (owner ruling, 2026-09-07). This file used to collapse
// both to `null` for put/exile/search/return, on the reasoning that "the DEFAULT origin of a move is
// implied by the verb, so an unstated fromZone and an explicit `library` are the same fact".
//
// CR 400.1 lists library as one of the seven zones, on the same footing as graveyard and exile, and
// CR 400.7 makes the zone change itself the event: "an object that moves from one zone to another
// becomes a NEW object with no memory of its previous existence". The origin is the mechanic, not
// bookkeeping — which is why "cast from a graveyard" (601.2a, via the stack) and "put from a
// graveyard" behave differently under a "can't enter from a graveyard" effect.
//
// The corpus shows the assumption failing hardest on `exile`, where UNSTATED is the mode: 1,023 of
// 2,118 actions state no origin against 358 that say library. Exile usually happens from the
// battlefield or a graveyard, so encoding those 1,023 as library-equivalent invents a zone.
test("an explicit library origin survives canonicalisation", () => {
  expect(canonicalAction({ verb: "put", object: "that card", fromZone: "library", toZone: "hand" }).fromZone)
    .toBe("library");
  expect(canonicalAction({ verb: "exile", object: "the top card", fromZone: "library" }).fromZone)
    .toBe("library");
});

test("an unstated origin stays null, and is no longer the same value as library", () => {
  const unstated = canonicalAction({ verb: "put", object: "a +1/+1 counter", toZone: undefined });
  expect(unstated.fromZone).toBeNull();
  const stated = canonicalAction({ verb: "put", object: "that card", fromZone: "library", toZone: "hand" });
  expect(stated.fromZone).not.toBe(unstated.fromZone);
});

// The half that was always right and must not regress: a NON-default origin is the whole card.
test("a non-library origin is still preserved verbatim", () => {
  for (const z of ["graveyard", "exile", "battlefield", "hand", "stack"]) {
    expect(canonicalAction({ verb: "return", object: "target card", fromZone: z }).fromZone).toBe(z);
  }
});
