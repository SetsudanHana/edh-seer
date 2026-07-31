import type { Card } from "@mtg/engine";

/** Whether a card is legal as a commander on its own: a legendary creature, or any
 *  card whose rules text explicitly grants it (planeswalkers that "can be your
 *  commander", the "choose a Background" partners' Background half, etc.). */
function canBeCommander(card: Card): boolean {
  const type = card.typeLine.toLowerCase();
  const oracle = card.oracleText.toLowerCase();
  if (oracle.includes("can be your commander")) return true;
  if (type.includes("background")) return true;
  return type.includes("legendary") && type.includes("creature");
}

/** Whether a card signals that it is one half of a two-commander pair — a Partner /
 *  Partner with / Friends forever / Doctor's companion ability, a "choose a Background"
 *  creature, or a Background itself (a Background is only ever the second half of a
 *  pair). Checked on BOTH of the first two cards so the pair is found regardless of
 *  which half the export listed first (a Background often precedes its creature). */
function formsAPair(card: Card): boolean {
  const type = card.typeLine.toLowerCase();
  const oracle = card.oracleText.toLowerCase();
  return (
    type.includes("background") ||
    oracle.includes("partner") ||
    oracle.includes("friends forever") ||
    oracle.includes("doctor's companion") ||
    oracle.includes("choose a background")
  );
}

/**
 * Best-effort commander detection for a decklist with no explicit Commander section
 * or commander field. Commander decks always have a commander, and exports that omit
 * the section almost always list it first, so we look only at the first one or two
 * resolved cards (in paste order) rather than scanning the whole 99 — a deck is full
 * of legendary creatures in the 99, and grabbing an arbitrary one would mislabel the
 * deck's identity.
 *
 * Returns the detected commander(s), or an empty array when the first card is not
 * commander-legal (e.g. an alphabetised list that happens to start on a spell), in
 * which case the caller should treat the deck as having no known commander rather
 * than guess.
 */
export function detectCommanders(deckCardsInOrder: Card[]): Card[] {
  const first = deckCardsInOrder[0];
  if (!first || !canBeCommander(first)) return [];

  const commanders = [first];
  const second = deckCardsInOrder[1];
  // A second commander only when the second is itself commander-legal AND one of the
  // two advertises a pairing (partner, or a Background pair in either order). Checking
  // both halves is what distinguishes a real pair from a lone commander that merely
  // happens to sit above another legendary card in the list.
  if (second && canBeCommander(second) && (formsAPair(first) || formsAPair(second))) {
    commanders.push(second);
  }
  return commanders;
}
