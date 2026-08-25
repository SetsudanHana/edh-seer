/** The one map from a `BuildCategory` key to the words a reader sees — shared by every surface
 *  that renders a category, so a category can be renamed once instead of drifting between copies.
 *
 *  `BuildBenchmarks.tsx` and `CutList.tsx` both used to print `c.category` raw whenever a key had
 *  no local label -- `graveyardHate` first (fixed 2026-08-20, CONFLICT 9), then the slack chip in
 *  `CutList.tsx` shipping "targetedRemoval 14/10 (+4)" to the reader (F3, same day) because its
 *  own file had no map to fall back to at all. One shared module means a THIRD surface can only
 *  ever be missing an import, never missing an entry. */
export const BUILD_CATEGORY_LABEL: Record<string, string> = {
  ramp: "Ramp",
  draw: "Draw",
  cardSelection: "Card selection",
  impulseDraw: "Impulse draw",
  targetedRemoval: "Removal",
  stackInteraction: "Stack interaction",
  boardWipe: "Board wipes",
  burn: "Burn & drain",
  stax: "Stax",
  protection: "Protection",
  tutor: "Tutors",
  graveyardHate: "Graveyard hate",
  lands: "Lands",
};
