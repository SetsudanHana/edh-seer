import { expect, test } from "vitest";
import rocks from "./ramp-colour.fixtures.json" with { type: "json" };
import { staticFixer } from "./static-fixers.js";
import type { DeckCard } from "./types.js";

/** Cards as the corpus prints them (#1115). */
const real = (name: keyof typeof rocks) => rocks[name] as unknown as DeckCard;
const WUBRG = ["W", "U", "B", "R", "G"];

test("Lantern-style and every-basic-type statics fix every colour for lands", () => {
  for (const n of ["Chromatic Lantern", "Joiner Adept", "Prismatic Omen"] as const) {
    expect(staticFixer(real(n)), n).toEqual({ colours: WUBRG, covers: "lands" });
  }
});

test("a land-type static fixes its own colour, for lands", () => {
  expect(staticFixer(real("Urborg, Tomb of Yawgmoth"))).toEqual({ colours: ["B"], covers: "lands" });
  expect(staticFixer(real("Yavimaya, Cradle of Growth"))).toEqual({ colours: ["G"], covers: "lands" });
});

test("an unconditional 'spend mana as though any color' fixes all mana", () => {
  expect(staticFixer(real("Chromatic Orrery"))).toEqual({ colours: WUBRG, covers: "all-mana" });
  expect(staticFixer(real("Mycosynth Lattice"))).toEqual({ colours: WUBRG, covers: "all-mana" });
});

test("the near misses are refused", () => {
  // Restricted to a card type or a number of spells.
  expect(staticFixer(real("Emissary's Ploy"))).toBeNull();
  expect(staticFixer(real("Vizier of the Menagerie"))).toBeNull();
  // Conditional, and one-turn.
  expect(staticFixer(real("The World Tree"))).toBeNull();
  expect(staticFixer(real("Divergent Growth"))).toBeNull();
  // Replaces the land's types rather than adding to them.
  expect(staticFixer(real("Celestial Dawn"))).toBeNull();
  // The static is on the BACK face.
  expect(staticFixer(real("Mystic Skull // Mystic Monstrosity"))).toBeNull();
  // A plain rock and a plain land.
  expect(staticFixer(real("Sol Ring"))).toBeNull();
  expect(staticFixer(real("Island"))).toBeNull();
});

test("a Room's front door is read", () => {
  expect(staticFixer(real("Greenhouse // Rickety Gazebo"))).toEqual({ colours: WUBRG, covers: "lands" });
});
