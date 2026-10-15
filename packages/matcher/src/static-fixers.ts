/** STATIC COLOUR FIXERS (owner, 2026-10-08, #1115): "after you play cards like Chromatic Lantern your color
 *  issues disappear, you are only bounded by the landcount". A card whose STATIC text makes OTHER mana sources
 *  produce colours. Leaf module: imports only the engine's hypergeometric and a type.
 *
 *  Read by derive from the printed FRONT FACE, one whole line at a time, anchored at both ends. A line is a fixer only when
 *  it is the entire ability: that is what refuses a granted ability inside quotes (Lae'zel's "perpetually gains
 *  ..."), a condition ("As long as you control six or more lands, ..." The World Tree), a duration ("Until end of
 *  turn ..." Divergent Growth), a restriction ("... to cast creature spells" Emissary's Ploy, Vizier of the
 *  Menagerie) and a one-spell grant (North Star) without a list of exceptions.
 *
 *  Corpus census 2026-10-08 (every card each pattern matches, then the type filter below):
 *  - lands have "{T}: Add one mana of any color.": Chromatic Lantern, Joiner Adept, Dune Chanter, Wrenn and
 *    Realmbreaker, Greenhouse (Room, front half); Birds of Paradise Avatar (vanguard) is dropped by type.
 *  - lands are every basic land type: Prismatic Omen, Dryad of the Ilysian Grove, Leyline of the Guildpact.
 *  - one basic land type: Urborg, Tomb of Yawgmoth and Blanket of Night (Swamp), Yavimaya, Cradle of Growth
 *    (Forest), Stormtide Leviathan and Khod, Etlan Shiis Envoy (Island), Swampbenders (Swamp).
 *  - spend mana as though any colour, unconditional: Chromatic Orrery, Mycosynth Lattice; Mycosynthwave (plane)
 *    is dropped by type.
 *
 *  Refused on purpose, each a near miss:
 *  CEILING: a CONDITIONAL grant (The World Tree, Worldknit) is not read: whether the condition holds is the
 *  board's question, and under-claiming is the direction this audit takes.
 *  BASIC lands only (Pulse of Llanowar, "it produces mana of a color of your choice", #1210) is read as `covers: "basics"` and
 *  costed by `fixerCredit`'s third tier; Sovereign's Realm (a conspiracy) and Mirri (a vanguard) are dropped by type.
 *  CEILING: a grant to CREATURES or ARTIFACTS (Cryptolith Rite) is not land fixing: it covers a different set than "lands", so it
 *  is refused rather than costed.
 *  CEILING: `land-score`'s suggestion list does not skip a basics fixer the way it skips an all-mana one: Pulse makes no colour
 *  of its own (no mana line), so it never reaches the rock branch there and needs no skip.
 *  CEILING: a grant that REPLACES the land's types (Celestial Dawn "Lands you control are Plains.") strips the
 *  land's own colours, and a CHOSEN type (Realmwright) names no colour here.
 *  CEILING: the BACK face (Mystic Skull // Mystic Monstrosity) is another card on another turn.
 *  CEILING: a one-turn or one-spell effect (Divergent Growth, North Star, Five-Finger Discount) is not a board. */
import { pAtLeast, seen } from "@edh-seer/engine";
import { parseTypeLine } from "./typeline.js";
import type { DeckCard } from "./types.js";

export type FixerColour = "W" | "U" | "B" | "R" | "G";

export interface StaticFixer {
  colours: FixerColour[];
  /** "lands": only lands you control gain the colours. "all-mana": any mana you spend, rocks and dorks too. "basics": only BASIC lands (Pulse of Llanowar). */
  covers: "lands" | "all-mana" | "basics";
}

/** Read from the derived `CardTags.staticFixer` (#1169, task 2a); derive's `static-fixer` reader owns the line patterns and the refusals
 *  listed above, and its census is identical to the printed-text detector this replaced (15 cards, 0 differences; 16 since Pulse of Llanowar, #1210). `covers: "all"` is
 *  `all-mana` here. */
export function staticFixer(dc: DeckCard): StaticFixer | null {
  const f = dc.tags?.staticFixer;
  return f ? { colours: f.colours as FixerColour[], covers: f.covers === "all" ? "all-mana" : f.covers === "basics" ? "basics" : "lands" } : null;
}

/** A BASIC land (supertype Basic) on its front face; a basic is never double-faced. */
export const isBasicLand = (dc: DeckCard): boolean => parseTypeLine((dc.card.typeLine ?? "").split(" // ")[0]!).supertypes.includes("basic");

export interface LibraryFixer extends StaticFixer { dc: DeckCard }

/** The static fixers among a library's cards. */
export const libraryFixers = (library: readonly DeckCard[]): LibraryFixer[] =>
  library.flatMap((dc) => { const f = staticFixer(dc); return f ? [{ dc, ...f }] : []; });

/** THE CREDIT A DECK'S STATIC FIXERS GIVE ONE COLOUR AT ONE DEADLINE, shared by the colour audit and the mana base
 *  score so the two give one number (#1115). The caller says which fixers are out by `turn` and how many sources
 *  each kind newly reaches: `newBasics`, the BASIC lands that were not already a source of the colour; `newLands`,
 *  every land that was not (basics included); `newAll`, every source of any mana that was not. The deck holds one
 *  or two copies and not every game draws one, so the credit is weighted by P(at least one is seen by `turn`) --
 *  the `seen` that `minCopies` prices a turn with -- and FLOORED, the direction both readers under-claim in.
 *
 *  THREE COVERAGE TIERS (#1210, Pulse of Llanowar): a new basic land is reached by ANY fixer; another new land by a
 *  lands or all-mana fixer; a non-land source by an all-mana fixer only. With no basics fixer out, `pAny` equals
 *  `pLandsOrAll` and the sum collapses to the two-tier formula this had, number for number.
 *  The float noise is rounded off before the floor, so 0.15 x 40 reads as 6 and not 5. */
export function fixerCredit(
  fixers: readonly LibraryFixer[], color: FixerColour, turn: number, isOut: (dc: DeckCard, turn: number) => boolean,
  newBasics: number, newLands: number, newAll: number, libraryLength: number,
): { extra: number; by: string[] } {
  const out = fixers.filter((f) => f.colours.includes(color) && isOut(f.dc, turn));
  if (out.length === 0) return { extra: 0, by: [] };
  const p = (n: number): number => (n > 0 ? pAtLeast(1, n, seen(turn), libraryLength) : 0);
  const pAny = p(out.length);
  const pLandsOrAll = p(out.filter((f) => f.covers !== "basics").length);
  const pAll = p(out.filter((f) => f.covers === "all-mana").length);
  const basics = Math.min(newBasics, newLands, newAll);
  const lands = Math.min(newLands, newAll);
  const extra = Math.floor(pAny * basics + pLandsOrAll * (lands - basics) + pAll * Math.max(0, newAll - newLands) + 1e-9);
  return { extra, by: out.map((f) => f.dc.card.name) };
}
