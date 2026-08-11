import { pAtLeast, seen } from "@mtg/engine";
import type { DeckMath } from "@mtg/engine";
import { deckAvailability } from "./availability.js";
import { detectAnswerClasses } from "./build.js";
import { manaAudit } from "./mana-audit.js";
import { recommendedLands } from "./land-count.js";
import type { DeckCard, Hierarchy } from "./types.js";

/** The classes the doctrine says every deck should be able to answer (design §12.3), in the order
 *  they are reported.
 *
 *  Reported even at ZERO, always: 27 of the 71 calibration decks carry no artifact removal and 26
 *  no enchantment removal, and a table that lists only what a deck has cannot say so. The absent
 *  row is the finding. */
export const ANSWER_CLASSES = [
  "creature", "artifact", "enchantment", "planeswalker", "land", "graveyard",
] as const;

/** How many demand shapes reach the report. The tail is long and mostly single-consumer noise;
 *  the panel is a summary, and `bin/deck-availability.ts` prints all of them. */
const DEMAND_ROWS = 6;

/** The deck-math block of a report: what the deck demands of itself, and what it can answer.
 *
 *  Every number here is a probability of having DRAWN something by a turn, so all of
 *  `hypergeometric.ts`'s caveats ride along -- no mulligans, no opponent, and `seen(T) = 7 + T`
 *  ignores card draw, which makes every figure conservative for a deck that draws.
 *
 *  Supply is UNWEIGHTED: four Ashnod's Altars and four Fling effects count the same. That needs the
 *  scaling-channel repair (`2026-08-06-count-matters-design.md` §§5-7), and until then the caveat
 *  travels with the number rather than the number travelling alone. */
export function computeDeckMath(
  deck: readonly DeckCard[],
  hierarchy: Hierarchy,
  commanderNames: readonly string[] = [],
  turn = 5,
): DeckMath {
  const commanders = new Set(commanderNames);
  const library = deck.length - deck.filter((dc) => commanders.has(dc.card.name)).length;
  const classes = detectAnswerClasses([...deck]);

  const answers = ANSWER_CLASSES.map((cls) => {
    const members = classes.get(cls) ?? new Set<string>();
    const fromCommandZone = [...members].some((n) => commanders.has(n));
    const inLibrary = [...members].filter((n) => !commanders.has(n)).length;
    return {
      class: cls,
      count: members.size,
      fromCommandZone,
      available: fromCommandZone ? 1 : pAtLeast(1, inLibrary, seen(turn), library),
    };
  });

  const demand = deckAvailability(deck, hierarchy, { turn, commanderNames: [...commanderNames] })
    .filter((r) => r.consumers > 0)
    .slice(0, DEMAND_ROWS)
    .map((r) => ({
      key: r.key,
      consumers: r.consumers,
      suppliers: r.suppliers,
      available: r.available,
      fromCommandZone: r.fromCommandZone,
    }));

  const colors = manaAudit(deck, { commanderNames }).map((r) => ({
    color: r.color,
    supplied: r.supplied,
    ...(r.worst
      ? { worst: { pips: r.worst.pips, turn: r.worst.turn, required: r.worst.required, cards: r.worst.cards } }
      : {}),
  }));

  const rec = recommendedLands(deck, { commanderNames });
  const lands = {
    actual: rec.actual,
    target: rec.target,
    avgManaValue: Math.round(rec.avgManaValue * 100) / 100,
    rampPlusDraw: rec.rampPlusDraw,
    fastMana: rec.fastMana,
  };

  return { turn, seen: seen(turn), library, answers, lands, colors, demand };
}
