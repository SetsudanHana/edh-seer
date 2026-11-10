import { describe, expect, test } from "vitest";
import { deriveCardTags, deriveInputOf } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import type { DeckCard } from "./types.js";
import fixtures from "./conditional-sweeps.fixtures.json" with { type: "json" };

/** #1586 -- A CONDITIONAL SWEEP REACHES THE SUBTYPES ITS CONDITION LEAVES, NOT EVERY ONE. Oracle text and clause records are the corpus's own (Mongo, 2026-11-10); derive carries the condition on the sweep's emit (derive/sweep-narrowing.ts) and
 *  the matcher's `sweepsEveryPermanent` reads it. Consumers: Tiana / Mazzy (an Aura of yours dies), Teysa (a Clue of yours dies), Kirri (returns a Plant), and the self triggers of a Vehicle (Hovership, Fire Nation Warship) and an Equipment (Krovod Haunch). */
type Fx = { source: Record<string, unknown>; canonical: ClauseRecord[] };
const F = fixtures as unknown as Record<string, Fx>;
const H = loadHierarchy();
const card = (name: string): DeckCard => ({ card: F[name]!.source as unknown as DeckCard["card"], tags: deriveCardTags(deriveInputOf(F[name]!.source as never, name, name, F[name]!.canonical)) as CardTags });
const tags = (p: string, c: string): string[] => [...new Set(pairReasons(card(p), card(c), H).filter((r) => r.producer === p && r.consumer === c).map((r) => r.tag))];
const SUBTYPE_CONSUMERS = ["Tiana, Ship's Caretaker", "Mazzy, Truesword Paladin", "Teysa, Opulent Oligarch", "Kirri, Talented Sprout", "Unidentified Hovership", "Krovod Haunch", "Fire Nation Warship"];

describe("CONTROL: an unconditional sweep (Apocalypse) feeds the subtype consumers it always did", () => {
  test("Apocalypse x Kirri / Unidentified Hovership", () => {
    expect(tags("Apocalypse", "Kirri, Talented Sprout")).toContain("graveyard-recursion:plant");
    expect(tags("Apocalypse", "Unidentified Hovership")).toContain("leaves:vehicle");
  });
});

describe("a sweep whose number the player opens (X, counters) keeps every subtype: decided from the oracle text", () => {
  // "Destroy each nonland permanent with mana value X or less" / "equal to the number of charge counters": the player picks the number, so a Plant, an Aura, a Clue of any mana value is reachable.
  test.each(["Karn's Sylex", "Gaze of Granite", "Ratchet Bomb", "Engineered Explosives", "Blast Zone", "The Moment", "The Filigree Sylex"])("%s x Kirri, Tiana, Teysa", (p) => {
    expect(tags(p, "Kirri, Talented Sprout")).toContain("graveyard-recursion:plant");
    expect(tags(p, "Tiana, Ship's Caretaker")).toContain("dies:aura");
    expect(tags(p, "Teysa, Opulent Oligarch")).toContain("dies:clue");
  });
});

describe("a sweep narrowed to the same name of an opponent's permanent (Deputy of Detention) feeds no subtype consumer", () => {
  test("Deputy of Detention", () => {
    for (const c of SUBTYPE_CONSUMERS) expect(tags("Deputy of Detention", c), `Deputy of Detention x ${c}`).toEqual([]);
  });
});

/** Mists of Lorien ("target nonland permanent and each other nonland permanent with the same mana value") and Renet ("each other nonland permanent that entered this turn") take YOUR permanents too: a Hovership cast this turn is returned, and Mists can target an Aura or a Vehicle
 *  directly. A card's own subtype-keyed leave trigger is heard, as the self-trigger gate hears Aven Riftwatcher; Deputy of Detention takes only an opponent's permanents ("that player controls"), so it stays refused. */
describe("a sweep of your own permanents under a mana value or a turn still reaches a self trigger keyed by subtype", () => {
  test.each(["Mists of Lórien", "Renet, Temporal Apprentice"])("%s x Unidentified Hovership: leaves:vehicle", (p) => {
    expect(tags(p, "Unidentified Hovership")).toContain("leaves:vehicle");
  });
  test.each(["Animate Dead", "Dance of the Dead"])("Mists of Lórien x %s: leaves:aura", (c) => {
    expect(tags("Mists of Lórien", c)).toContain("leaves:aura");
  });
  test.each(["Animate Dead", "Dance of the Dead", "Unidentified Hovership"])("CONTROL: Deputy of Detention x %s stays unpaired", (c) => {
    expect(tags("Deputy of Detention", c)).toEqual([]);
  });
  test("CONTROL: a subtype payoff that is not the card's own is still refused (no dies, no recursion from a bounce)", () => {
    for (const p of ["Mists of Lórien", "Renet, Temporal Apprentice"]) for (const c of ["Tiana, Ship's Caretaker", "Mazzy, Truesword Paladin", "Teysa, Opulent Oligarch", "Kirri, Talented Sprout", "Krovod Haunch", "Fire Nation Warship"]) expect(tags(p, c), `${p} x ${c}`).toEqual([]);
  });
});

describe("Desynchronization (not historic) bounces a Plant or an Aura, never a Vehicle or a Clue", () => {
  test("x Unidentified Hovership: no leaves:vehicle", () => {
    expect(tags("Desynchronization", "Unidentified Hovership").filter((t) => t.startsWith("leaves"))).toEqual([]);
  });
  test("x Kirri: returns to hand, not the graveyard, so no recursion fill either way", () => {
    expect(tags("Desynchronization", "Kirri, Talented Sprout")).toEqual([]);
  });
});

describe("Urza, Planeswalker -10 spares the artifacts you control", () => {
  test.each(["Teysa, Opulent Oligarch", "Krovod Haunch", "Fire Nation Warship", "Unidentified Hovership"])("x %s (an artifact of yours): no pair", (c) => {
    expect(tags("Urza, Planeswalker", c).filter((t) => t.startsWith("dies") || t.startsWith("leaves"))).toEqual([]);
  });
  test.each(["Tiana, Ship's Caretaker", "Mazzy, Truesword Paladin"])("CONTROL: x %s (an Aura of yours dies): still paired", (c) => {
    expect(tags("Urza, Planeswalker", c)).toContain("dies:aura");
  });
});

describe("Glyph of Reincarnation: its \"target Wall\" is the blocker, not a Wall it returns", () => {
  test.each(["Apocalypse", "Karn's Sylex", "Urza, Planeswalker", "Ratchet Bomb"])("%s x Glyph of Reincarnation: no graveyard-recursion", (p) => {
    expect(tags(p, "Glyph of Reincarnation").filter((t) => t.startsWith("graveyard-recursion"))).toEqual([]);
  });
});

/** The first build carried the relation on every mass put as well and lost 65,053 reasons: a card that "enters thanks to" a mass put is tested against the put's emit as a filter, and a relation there is refused. These keep what they had. */
describe("CONTROL: a mass put from a graveyard still feeds the self-triggers of what it returns", () => {
  test.each([["Faith's Reward", "Aven Riftwatcher"], ["Second Sunrise", "Aven Riftwatcher"]])("%s x %s", (p, c) => {
    expect(tags(p, c).length).toBeGreaterThan(0);
  });
});

/** A sweep's relation (the same mana value as the target, entered this turn, the same name) is no printed characteristic: the card's OWN "when this leaves the battlefield" is still heard by a sweep that can take it. The self-trigger gate strips it from the emit it
 *  uses as a filter, as it strips `zone`, `counter` and `entersTapped`. The first build lost 150+ such pairs per sweep (Mists of Lorien, Renet, Deputy of Detention). */
describe("a conditional sweep still reaches the self trigger of what it can take", () => {
  test.each(["Mists of Lórien", "Renet, Temporal Apprentice", "Deputy of Detention", "Desynchronization", "Urza, Planeswalker"])("%s x Aven Riftwatcher (when this creature leaves)", (p) => {
    expect(tags(p, "Aven Riftwatcher")).toContain("leaves:creature");
  });
});

/** The same strip on the graveyard-fill gate: Eye of Singularity ("destroy each permanent with the same name as another permanent") still fills the graveyard for a card that returns itself from it (the first build lost 263 such pairs). */
describe("a sweep with a name relation still fills the graveyard for a self-recursion", () => {
  test("Eye of Singularity x Abzan Devotee", () => {
    expect(tags("Eye of Singularity", "Abzan Devotee").some((t) => t.startsWith("graveyard-recursion"))).toBe(true);
  });
});

/** Kaya's +1 gives a nontoken creature "When this creature dies ..." (`grantedBy` + `self`): the trigger is the HOST's, a creature, so Urza's spare of YOUR artifacts and planeswalkers is not Kaya's (a planeswalker). A granted trigger is not judged on the grantor's printed characteristics against the spare. */
describe("a trigger granted to another creature is judged on the host, not the grantor", () => {
  test("Urza, Planeswalker x Kaya the Inexorable: dies:creature", () => {
    expect(tags("Urza, Planeswalker", "Kaya the Inexorable")).toContain("dies:creature");
  });
});

/** A consumer keyed on a card TYPE sees the spare as well as one keyed on a subtype: "whenever an artifact you control is put into a graveyard" (Marionette Master, Psychomancer) is not heard by Urza's -10, which leaves your artifacts indestructible. */
describe("the spare is read on the type path", () => {
  test.each(["Psychomancer", "Marionette Master"])("Urza, Planeswalker x %s: no dies:artifact", (c) => {
    expect(tags("Urza, Planeswalker", c).filter((t) => t.startsWith("dies"))).toEqual([]);
  });
  test("CONTROL: Urza x a creature payoff stays (Aven Riftwatcher)", () => {
    expect(tags("Urza, Planeswalker", "Aven Riftwatcher")).toContain("leaves:creature");
  });
});
