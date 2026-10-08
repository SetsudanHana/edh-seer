/** STATIC COLOUR FIXERS (owner, 2026-10-08, #1115): "after you play cards like Chromatic Lantern your color
 *  issues disappear, you are only bounded by the landcount". A card whose STATIC text makes OTHER mana sources
 *  produce colours, read once. Leaf module: imports only the engine's hypergeometric and a type.
 *
 *  Read from the printed FRONT FACE, one whole line at a time, anchored at both ends. A line is a fixer only when
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
 *  CEILING: BASIC lands only (Sovereign's Realm, a conspiracy) and a grant to CREATURES or ARTIFACTS (Cryptolith
 *  Rite) are not land fixing: they cover a different set than "lands", so they are refused rather than costed.
 *  CEILING: a grant that REPLACES the land's types (Celestial Dawn "Lands you control are Plains.") strips the
 *  land's own colours, and a CHOSEN type (Realmwright) names no colour here.
 *  CEILING: the BACK face (Mystic Skull // Mystic Monstrosity) is another card on another turn.
 *  CEILING: a one-turn or one-spell effect (Divergent Growth, North Star, Five-Finger Discount) is not a board. */
import { pAtLeast, seen } from "@edh-seer/engine";
import type { DeckCard } from "./types.js";

export type FixerColour = "W" | "U" | "B" | "R" | "G";

export interface StaticFixer {
  colours: FixerColour[];
  /** "lands": only lands you control gain the colours. "all-mana": any mana you spend, rocks and dorks too. */
  covers: "lands" | "all-mana";
}

const WUBRG: FixerColour[] = ["W", "U", "B", "R", "G"];
const BASIC: Record<string, FixerColour> = { plains: "W", island: "U", swamp: "B", mountain: "R", forest: "G" };

// A card that is never in a legal Commander decklist, so its static is never on a board we audit.
const NOT_IN_A_DECK = /\b(vanguard|plane|phenomenon|conspiracy|scheme|ongoing scheme)\b/i;

const LANTERN = /^lands you control have "\{t\}: add one mana of any color\."$/;
const EVERY_TYPE = /^lands you control are every basic land type in addition to their other types\.$/;
const ONE_TYPE = /^(?:each land is|all lands are|lands you control are) (?:an? )?(plains|island|swamp|mountain|forest)(?:s|es)? in addition to (?:its|their) other (?:land )?types\.$/;
const SPEND = /^(?:you|players) may spend mana as though it were mana of any (?:color|type)\.$/;

export function staticFixer(dc: DeckCard): StaticFixer | null {
  if (NOT_IN_A_DECK.test(dc.card.typeLine ?? "")) return null;
  const front = (dc.card.oracleText ?? "").split(/^\/\/$/m)[0]!;
  for (const raw of front.replace(/\([^()]*\)/g, "").toLowerCase().split("\n")) {
    const line = raw.trim();
    if (LANTERN.test(line) || EVERY_TYPE.test(line)) return { colours: WUBRG, covers: "lands" };
    const one = ONE_TYPE.exec(line);
    if (one) return { colours: [BASIC[one[1]!]!], covers: "lands" };
    if (SPEND.test(line)) return { colours: WUBRG, covers: "all-mana" };
  }
  return null;
}

export interface LibraryFixer extends StaticFixer { dc: DeckCard }

/** The static fixers among a library's cards. */
export const libraryFixers = (library: readonly DeckCard[]): LibraryFixer[] =>
  library.flatMap((dc) => { const f = staticFixer(dc); return f ? [{ dc, ...f }] : []; });

/** THE CREDIT A DECK'S STATIC FIXERS GIVE ONE COLOUR AT ONE DEADLINE, shared by the colour audit and the mana base
 *  score so the two give one number (#1115). The caller says which fixers are out by `turn` and how many sources
 *  each kind newly reaches: `newLands`, the lands that were not already a source of the colour; `newAll`, every
 *  source of any mana that was not. The deck holds one or two copies and not every game draws one, so the credit is
 *  weighted by P(at least one is seen by `turn`) -- the `seen` that `minCopies` prices a turn with -- and FLOORED,
 *  the direction both readers under-claim in. Lands are covered by either kind; the rest only by the all-mana kind.
 *  The float noise is rounded off before the floor, so 0.15 x 40 reads as 6 and not 5. */
export function fixerCredit(
  fixers: readonly LibraryFixer[], color: FixerColour, turn: number, isOut: (dc: DeckCard, turn: number) => boolean,
  newLands: number, newAll: number, libraryLength: number,
): { extra: number; by: string[] } {
  const out = fixers.filter((f) => f.colours.includes(color) && isOut(f.dc, turn));
  if (out.length === 0) return { extra: 0, by: [] };
  const pAny = pAtLeast(1, out.length, seen(turn), libraryLength);
  const allMana = out.filter((f) => f.covers === "all-mana");
  const pAll = allMana.length > 0 ? pAtLeast(1, allMana.length, seen(turn), libraryLength) : 0;
  const extra = Math.floor(pAny * Math.min(newLands, newAll) + pAll * Math.max(0, newAll - newLands) + 1e-9);
  return { extra, by: out.map((f) => f.dc.card.name) };
}
