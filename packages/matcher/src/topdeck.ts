import type { DeckCard } from "./types.js";

/** A payoff that reads a RANDOM card off your own library, and what your library actually gives it.
 *
 *  Hidetsugu and Kairi's death trigger — "exile the top card of your library, target opponent loses
 *  life equal to its mana value, and if it's an instant or sorcery you may cast it without paying
 *  its mana cost" — is the whole reason a deck like `hidetsugu-and-kairi-like-to-multiply` runs 21
 *  spells at mana value 6 or more. The engine stated nothing about it.
 *
 *  **AND IT IS DELIBERATELY NOT AN EDGE.** The pairwise version was considered and REFUSED on this
 *  repo's own rule. A tutor earns its edges by CHOOSING — Flamekin Harbinger really does relate to
 *  every Elemental, and a bare-type tutor ("a creature card") is refused precisely because it names
 *  no particular card. This trigger chooses nothing: the card exiled is whatever is on top, so a
 *  claim about Skull Storm would be true of every instant and sorcery in the deck equally, which is
 *  the registered "a claim that applies to a card merely for being an ordinary card is false". The
 *  only thing that separates Skull Storm from Pongify here is MAGNITUDE, and magnitude has no
 *  channel that ships (the supply:demand discount has been refused three times).
 *
 *  So it is reported the way `deckSlack` reports a surplus: at DECK level, naming no member. The
 *  card is a real payoff, the number is a real property of your library, and nothing invents an
 *  attribution.
 *
 *  Population: 25 cards in the derived corpus carry an ability whose amount names a mana value, of
 *  which this predicate keeps the subset reading YOUR OWN library — the rest read an opponent's
 *  library (Keen Duelist, Nashi), a spell being cast (Imp's Mischief, Thor) or a permanent you
 *  sacrifice (Imskir Iron-Eater, Megatron). */
export interface TopdeckPayoff {
  card: string;
  /** Expected mana value of one hit, over the WHOLE library. Lands are included because a land
   *  really is exiled and really does pay out zero — the owner's "read mana value without lands"
   *  ruling is about a quality denominator, where no cost term could ever touch a land, and this is
   *  the opposite situation. */
  meanManaValue: number;
  /** The same mean with lands dropped: what a hit is worth WHEN it is not a land. Both are shipped
   *  for the reason the castability bracket ships two bounds — one number here would hide which
   *  half of the deck the reader is being told about. */
  nonlandMeanManaValue: number;
  /** Share of the library that is a land, i.e. the share of hits that pay out nothing. */
  landShare: number;
  /** The free-cast half, when the card has one: the types it can cast and the share of your library
   *  that matches. Absent when the card only reads a mana value. */
  castable?: { types: string[]; share: number };
}

/** "Exile the top card of your library", "look at the top three cards of your library". YOUR
 *  library, spelled out — an opponent's is the same sentence with a different pronoun and is a
 *  different fact (their curve, not yours). */
const OWN_TOPDECK = /\btop (?:card|cards|\w+ cards?) of your library\b/i;

const typesOf = (dc: DeckCard): string[] =>
  dc.tags?.characteristics.types ?? dc.card.typeLine.toLowerCase().split(/[^a-z]+/).filter(Boolean);

export function topdeckPayoffs(
  deck: readonly DeckCard[],
  commanderNames: readonly string[] = [],
): TopdeckPayoff[] {
  const commanders = new Set(commanderNames);
  const library = deck.filter((dc) => !commanders.has(dc.card.name));
  if (library.length === 0) return [];
  const nonland = library.filter((dc) => !typesOf(dc).includes("land"));
  const mean = (rows: readonly DeckCard[]): number =>
    rows.length === 0 ? 0
      : Math.round((rows.reduce((n, dc) => n + (dc.card.manaValue ?? 0), 0) / rows.length) * 100) / 100;

  const out: TopdeckPayoff[] = [];
  for (const dc of deck) {
    if (!OWN_TOPDECK.test(dc.card.oracleText ?? "")) continue;
    const abilities = dc.tags?.abilities ?? [];
    if (!abilities.some((a) => /mana value/i.test(String(a.amount ?? "")))) continue;
    // The free cast rides the SAME trigger and is a separate fact, so it is read separately: a
    // `cast` emit whose card comes from anywhere but hand is a card cast off the top or out of
    // exile, and its `type` list is what the trigger can actually take.
    const freeCast = abilities.flatMap((a) => a.emits ?? [])
      .find((e) => e.verb === "cast" && e.subject.fromZone !== undefined && e.subject.fromZone !== "hand"
        && e.subject.type !== undefined);
    const types = freeCast === undefined ? []
      : (Array.isArray(freeCast.subject.type) ? freeCast.subject.type : [freeCast.subject.type!]);
    out.push({
      card: dc.card.name,
      meanManaValue: mean(library),
      nonlandMeanManaValue: mean(nonland),
      landShare: Math.round(((library.length - nonland.length) / library.length) * 100) / 100,
      ...(types.length > 0
        ? {
          castable: {
            types,
            share: Math.round(
              (library.filter((c) => typesOf(c).some((t) => types.includes(t))).length / library.length) * 100,
            ) / 100,
          },
        }
        : {}),
    });
  }
  return out;
}
