import type { DeckCoverage } from "@edh-seer/engine";
import type { DeckCard } from "./types.js";

/** Names listed before the rest become a count. The legality report caps its lists at eight for the
 *  same reason: a paste can produce dozens, and a list that long stops being read. */
const NAME_CAP = 8;

/** How much of the deck the SYNERGY engine could actually read, or `undefined` when it read all of
 *  it — a report with nothing to admit should say nothing.
 *
 *  THE DEFECT THIS CLOSES IS A SILENCE. A card that resolves against the corpus but carries no
 *  derived tags forms NO edges, carries NO theme and cannot reach an archetype, and it looked
 *  exactly like a fully analysed card: `MissingCards` reports only the names that failed to RESOLVE.
 *  **Measured on `precon-party-time`: 52 of 100 cards derived, so 48 were invisible to every synergy
 *  number on the page and nothing said so.** The 71 calibration decks run ~99% derived, which is
 *  precisely why no instrument here ever saw it — the corpus was bought FOR those decks.
 *
 *  THE CLAIM IS NARROW BECAUSE THE LOSS IS NARROW, and over-stating it would be its own wrong
 *  answer. `detectBuildRules` matches mostly on ORACLE TEXT and TYPE LINE, and the mana model, land
 *  count, castability, legality, bracket and combo detection all read PRINTED data — every one of
 *  those still works on an underived card. What is lost is the synergy layer and the theme built on
 *  top of it. */
export function deckCoverage(deck: readonly DeckCard[]): { coverage: DeckCoverage } | undefined {
  const underived = deck.filter((dc) => dc.tags === null || dc.tags === undefined);
  if (underived.length === 0) return undefined;
  const names = [...new Set(underived.map((dc) => dc.card.name))].sort();
  const shown = names.slice(0, NAME_CAP);
  const card = (n: number): string => `${n} card${n === 1 ? "" : "s"}`;
  return {
    coverage: {
      resolved: deck.length,
      derived: deck.length - underived.length,
      underivedNames: shown,
      more: names.length - shown.length,
      caveat: `${card(underived.length)} of ${deck.length} are not in the read corpus yet, so they`
        + " form no synergy edges and carry no theme. Their mana cost, type and text still count"
        + " everywhere else in this report.",
    },
  };
}
