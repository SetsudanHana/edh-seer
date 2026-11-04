/** WHOSE GRAVEYARD A CARD LEAVES (#1470). The graveyard an action takes from is the one its PRINTED source names. `zoneOwner` (derive.ts) reads a direct
 *  "from your graveyard"; three printed shapes it cannot read leave the graveyard-leave emit and the recursion subject at `any` (or worse), and an `any`
 *  graveyard is a wildcard to every opponent-side mill (Maddening Cacophony, Memory Vampire, Undead Alchemist, Szadek):
 *   - a POINTER at cards already named: "Choose up to two target permanent cards in your graveyard ... Return THOSE CARDS to your hand" (Song of Inspiration),
 *     "the other one" (Phyrexian Grimoire), the Adamant clause of Once and Future;
 *   - a LIST: "put a creature card ... from your hand or graveyard onto the battlefield" (Swift Warkite, Nahiri, Danitha);
 *   - a CHOOSER: "target opponent chooses one of the top two cards of YOUR graveyard" (Phyrexian Grimoire), "an opponent's choice from your graveyard" (Tasigur):
 *     the player who chooses is not the owner of the graveyard and never becomes its control.
 *  Returns `you` only; an opponent's or any graveyard is never read as yours, and a source that cannot be read returns undefined (the caller leaves `any`).
 *  CEILING: a pointer resolves against the CARD's whole text and only when that text names no graveyard but your own; a card naming two players' graveyards stays unread. */

/** A pointer: the object names no zone and no owner, it points at what an earlier sentence chose. */
const POINTER = /^(?:(?:those|these|the chosen|the exiled|the returned|the other) cards?|that card|the other(?: one)?|those|them|it|one of (?:them|those cards)|each of them|the rest)$/i;
/** The object itself names your graveyard: "from your graveyard", "in your graveyard", "card from the top two cards of ... chosen card from your graveyard". */
const OBJECT_YOURS = /\b(?:from|in) your (?:own )?graveyard\b/i;
/** Any graveyard that is not (only) yours, stated in this text. "an opponent's choice" is a chooser and does not match: only a possessive directly before "graveyard". */
const OTHER_GRAVEYARD = /\b(?:an? |each |every |target |any )?(?:opponent|player)'s graveyards?\b|\b(?:that player|defending player|its owner|their|his or her|each player's|all|each|every|a|any|another|one|two) (?:own )?graveyards?\b|\b(?:an? |each |every )?graveyards\b|\bfrom (?:a|any|each|another) graveyard\b|\bin (?:a|any|each|another) graveyard\b/i;
/** "your hand or graveyard", "your graveyard and/or hand", "your hand and/or graveyard". */
const YOUR_LIST = /\bfrom your (?:hand|library),? (?:or|and\/or|and) (?:your )?graveyard\b|\bfrom your graveyard,? (?:or|and\/or|and) (?:your )?(?:hand|library)\b|\bfrom your (?:hand|library),? (?:or|and\/or|and) (?:from )?(?:your )?graveyard\b|\bgraveyard and\/or hand\b/i;
/** Your graveyard as the card's source or home, anywhere in the text. */
const YOUR_GRAVEYARD = /\b(?:in|from|into) your graveyard\b|\byour graveyard\b/i;

export function graveyardOwner(action: { object?: string | null; fromZone?: string | null }, clauseText: string, cardText: string): "you" | undefined {
  if (action.fromZone !== "graveyard") return undefined;
  const object = (action.object ?? "").trim();
  // A graveyard the object itself puts on another player stays unread, before anything in the clause can claim it.
  // ...and so does one object naming both ("a creature card from an opponent's graveyard and a creature card from your graveyard", Dawnbreak Reclaimer): two owners in one emit is not readable as either.
  if (OTHER_GRAVEYARD.test(object)) return undefined;
  if (OBJECT_YOURS.test(object)) return "you";
  if (YOUR_LIST.test(clauseText) && !OTHER_GRAVEYARD.test(clauseText)) return "you";
  if (POINTER.test(object)) {
    const text = cardText !== "" ? cardText : clauseText;
    if (YOUR_GRAVEYARD.test(text) && !OTHER_GRAVEYARD.test(text)) return "you";
  }
  return undefined;
}
