import { expect, test } from "vitest";
import rocks from "./ramp-colour.fixtures.json" with { type: "json" };
import { pAtLeast, seen } from "@edh-seer/engine";
import { fixerCredit, staticFixer, type LibraryFixer } from "./static-fixers.js";
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
  // The "All lands are Xs" and "Lands you control are Xs" forms.
  expect(staticFixer(real("Stormtide Leviathan"))).toEqual({ colours: ["U"], covers: "lands" });
  expect(staticFixer(real("Swampbenders"))).toEqual({ colours: ["B"], covers: "lands" });
});

test("an unconditional 'spend mana as though any color' fixes all mana", () => {
  expect(staticFixer(real("Chromatic Orrery"))).toEqual({ colours: WUBRG, covers: "all-mana" });
  expect(staticFixer(real("Mycosynth Lattice"))).toEqual({ colours: WUBRG, covers: "all-mana" });
});

test("the near misses are refused", () => {
  // Restricted to a card type (Vizier of the Menagerie: "spend mana of any type to cast creature spells"). Emissary's Ploy is the same branch
  // but is banned in Commander, so derive never ran on it and its fixture row is null: asserting on it proved nothing.
  expect(staticFixer(real("Vizier of the Menagerie"))).toBeNull();
  // Spend-as-any restricted to a card type or to abilities: the sentence has more after "color".
  expect(staticFixer(real("Oath of Nissa"))).toBeNull();
  expect(staticFixer(real("Agatha's Soul Cauldron"))).toBeNull();
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

// --- the third coverage tier: BASIC lands only (Pulse of Llanowar, #1210) -------------------------------------------
const fx = (name: string, covers: LibraryFixer["covers"], colours: LibraryFixer["colours"] = ["W", "U", "B", "R", "G"]): LibraryFixer =>
  ({ dc: { card: { name } } as unknown as DeckCard, colours, covers });
const always = () => true;

/** The formula as it stood before `newBasics`, kept here verbatim so the new one is proved equal when no basics fixer is out. */
const oldCredit = (fixers: LibraryFixer[], turn: number, newLands: number, newAll: number, n: number): number => {
  const pAny = pAtLeast(1, fixers.length, seen(turn), n);
  const all = fixers.filter((f) => f.covers === "all-mana");
  const pAll = all.length > 0 ? pAtLeast(1, all.length, seen(turn), n) : 0;
  return Math.floor(pAny * Math.min(newLands, newAll) + pAll * Math.max(0, newAll - newLands) + 1e-9);
};

test("with no basics fixer the credit is the old number, for any basics count", () => {
  for (const fixers of [[fx("Lantern", "lands")], [fx("Orrery", "all-mana")], [fx("Lantern", "lands"), fx("Orrery", "all-mana")], [fx("A", "lands"), fx("B", "lands")]]) {
    for (let turn = 1; turn <= 9; turn++) for (const newLands of [0, 3, 12, 20]) for (const newAll of [0, 3, 12, 25]) for (const newBasics of [0, 5, 12]) {
      const got = fixerCredit(fixers, "G", turn, always, Math.min(newBasics, newLands), newLands, newAll, 99).extra;
      expect(got, `${fixers.map((f) => f.covers)} T${turn} L${newLands} A${newAll} B${newBasics}`).toBe(oldCredit(fixers, turn, newLands, newAll, 99));
    }
  }
});

test("a basics fixer credits only the basic lands it newly reaches", () => {
  const pulse = [fx("Pulse of Llanowar", "basics")];
  // 6 new basics, 10 new lands in all: Pulse reaches the basics alone.
  const p = pAtLeast(1, 1, seen(5), 99);
  expect(fixerCredit(pulse, "G", 5, always, 6, 10, 10, 99).extra).toBe(Math.floor(p * 6 + 1e-9));
  expect(fixerCredit(pulse, "G", 5, always, 0, 10, 10, 99).extra).toBe(0);
  // A lands fixer reaches the nonbasics too; with both out the credit covers all ten.
  const both = [fx("Pulse of Llanowar", "basics"), fx("Lantern", "lands")];
  const pb = pAtLeast(1, 2, seen(5), 99), pl = pAtLeast(1, 1, seen(5), 99);
  expect(fixerCredit(both, "G", 5, always, 6, 10, 10, 99).extra).toBe(Math.floor(pb * 6 + pl * 4 + 1e-9));
  // An all-mana fixer additionally reaches the non-lands.
  const all = [fx("Pulse of Llanowar", "basics"), fx("Orrery", "all-mana")];
  expect(fixerCredit(all, "G", 5, always, 6, 10, 15, 99).extra).toBe(Math.floor(pb * 6 + pl * 4 + pl * 5 + 1e-9));
});

test("a derived `basics` cover stays `basics` and is never widened to lands", () => {
  const dc = { card: { name: "Pulse of Llanowar" }, tags: { staticFixer: { covers: "basics", colours: WUBRG } } } as unknown as DeckCard;
  expect(staticFixer(dc)).toEqual({ colours: WUBRG, covers: "basics" });
});
