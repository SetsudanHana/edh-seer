import type { CardTags } from "@edh-seer/tagger";
import type { DeckCard } from "./types.js";

/** WHO A DECK CARD LETS ATTACK ROUND DEFENDER (#1756; CR 702.3b: a creature with defender can't attack). `all`: every defender the deck runs. `wall`: Wall creatures only. */
type Scope = "all" | "wall";

/** The printed shapes of a line that hands OTHER creatures "can attack as though they didn't have defender", each with the defenders it covers. Matched with `includes` on a lowercased line, reminder text removed.
 *  A card that only frees ITSELF ("this creature can attack ...", Mirror Wall) matches none, which is the point.
 *  CEILING: a targeted or attached enabler (Assault Formation, Walking Bulwark, Warmonger's Chariot: one creature at a time; Animate Wall: one Wall) clears every defender it could name, so each wall -> attack payoff pair is read as real, though only one wall attacks per activation.
 *  CEILING: matched on printed text, not a derived field (the tags carry no "can attack despite defender" grant). Guardians of Oboro ("Modified creatures you control ...") and The Pride of Hull Clade (a targeted creature you control, defender or not) are not matched. */
const ENABLER_SHAPES: readonly (readonly [string, Scope])[] = [
  ["creatures you control can attack as though they didn't have defender", "all"], // High Alert, Felothar the Steadfast, Ghalta the Immovable
  ["each creature you control with defender", "all"], // Arcades, the Strategist
  ["creatures you control with defender can attack", "all"], // Wakestone Gargoyle
  ["target creature with defender", "all"], // Assault Formation, Walking Bulwark
  ["as long as equipped creature has defender, it can attack as though", "all"], // Warmonger's Chariot
  ["wall creatures can attack as though", "wall"], // Rolling Stones
  ["enchanted wall can attack as though", "wall"], // Animate Wall
];

const GETS_ROUND = "didn't have defender";

/** The scopes the deck's cards grant: empty when no card in it is an enabler. Reads each card's printed oracle text, curly apostrophes folded. */
export function defenderScopes(deck: readonly DeckCard[]): Set<Scope> {
  const out = new Set<Scope>();
  for (const dc of deck) {
    if (dc.isToken) continue;
    for (const raw of (dc.card.oracleText ?? "").split("\n")) {
      const paren = raw.indexOf("(");
      const line = (paren < 0 ? raw : raw.slice(0, paren)).toLowerCase().replaceAll("’", "'");
      if (!line.includes(GETS_ROUND)) continue;
      for (const [shape, scope] of ENABLER_SHAPES) if (line.includes(shape)) out.add(scope);
    }
  }
  return out;
}

const covered = (scopes: ReadonlySet<Scope>, subtypes: readonly string[]): boolean =>
  scopes.has("all") || (scopes.has("wall") && subtypes.some((s) => s.toLowerCase() === "wall"));

/** THIS DECK'S COPY OF A CARD'S TAGS WITH `defender` CLEARED where an enabler in the deck covers it, so the implied `attacks` is supplied again. A copy, never the shared object: the tags are cached and reused by other decks. */
export function freeDefenders(tags: CardTags, scopes: ReadonlySet<Scope>): CardTags {
  if (scopes.size === 0) return tags;
  const chars = tags.characteristics;
  const faces = chars.faces?.some((f) => f.defender === true && covered(scopes, f.subtypes));
  const whole = chars.defender === true && covered(scopes, chars.subtypes);
  if (!faces && !whole) return tags;
  const { defender: _whole, ...rest } = chars;
  return {
    ...tags,
    characteristics: {
      ...(whole ? rest : chars),
      ...(chars.faces ? { faces: chars.faces.map((f) => {
        if (f.defender !== true || !covered(scopes, f.subtypes)) return f;
        const { defender: _face, ...bare } = f;
        return bare;
      }) } : {}),
    },
  };
}
