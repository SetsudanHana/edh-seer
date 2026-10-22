/** CARDS PUT FROM THE TOP OF YOUR LIBRARY INTO YOUR HAND WITHOUT A SEARCH (#1302, owner ruling 2026-10-22). CR 121.5: "If an effect moves cards
 *  from a player's library to that player's hand without using the word 'draw,' the player has not drawn those cards." Dark Confidant, Ad Nauseam, Fact
 *  or Fiction, Impulse, Dig Through Time, Coiling Oracle's hand branch: card advantage, but not a draw (no draw payoff sees it) and not a tutor (no
 *  library search). The effect kind is `to-hand`; this module reads the three facts about it off the stored put. */

const COUNT: Record<string, string> = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", twenty: "20",
};

/** Everything that was just singled out reaches the hand: "the rest", "all cards revealed this way", "each of those cards", "the revealed cards". */
const EVERYTHING = /^(?:the rest\b|all\b|each of\b|the other chosen\b|(?:the )?(?:revealed|chosen) cards\b|those cards\b|the cards (?:they )?revealed\b)/;
/** An open count: "X cards from among them", "any number of ...", "that many cards". */
const OPEN_COUNT = /^(?:x\b|any number of\b|that many\b)/;
const LEADING_COUNT = /^(?:up to )?(one|two|three|four|five|six|seven|eight|nine|ten|twenty|\d+)\b/;

/** HOW MANY CARDS REACH THE HAND from this put, read off its object: a digit string ("1", "2"; "up to two" is its upper bound), `X` (an open count: "X cards",
 *  "any number of", "that many"), `pile` (a whole pile, size not fixed: Fact or Fiction), or `all` (everything just singled out: "the rest", "all cards revealed
 *  this way"). A single named card ("that card", "it", "the other", "a historic card") is "1". CEILING: "up to two" and "you may" are not told apart from "two": the amount is
 *  the most that reaches the hand. */
export function toHandAmount(object: string): string {
  const o = object.trim().toLowerCase().replace(/\s+into your hand$/, "");
  if (/\bpiles?\b/.test(o) && !/^(?:a|one) card from\b/.test(o)) return "pile";
  if (EVERYTHING.test(o)) return "all";
  if (OPEN_COUNT.test(o)) return "X";
  const n = LEADING_COUNT.exec(o)?.[1];
  if (n !== undefined) return COUNT[n] ?? n;
  return "1";
}

/** A look at, or a reveal of, MORE THAN ONE card off the top: "look at the top four cards", "reveal the top five cards", "look at that many cards from the top".
 *  Not "exile the top six cards" (no look) and not "look at the top card" (one card is no choice). */
const LOOKS_AT_MANY = /\b(?:look at|reveals?) (?:the )?top (?:two|three|four|five|six|seven|eight|nine|ten|twenty|\d+|x) cards\b|\b(?:look at|reveals?) (?:that many|the top x) cards\b|\blook at twice x cards\b|\bthat many cards from the top\b/i;
/** A put that names a PICK: "one of them", "two of the top seven cards", "a historic card", "the revealed card", "the other". Not "that card" / "it" (the card a
 *  reveal turned up) and not "the rest". */
const PICK = /^(?:up to )?(?:one|two|three|four|five|six|seven|eight|nine|ten|x|\d+|a|an|any number of|the other)\b|^the (?:revealed|chosen) card$/;

/** A pointer back at the card a selection picked: "You may reveal a land card from among them and put THAT CARD into your hand" (Nessian Wanderer). */
const POINTER = /^(?:that card|it|the revealed card)$/;
/** The clause itself makes the pick: "a land card FROM AMONG THEM", "an opponent chooses one of them" (Karn, Scion of Urza). */
const PICKS_IN_CLAUSE = /\bfrom among (?:them|those cards)\b|\bchooses? (?:one|two|three|a card|any number) of (?:them|those)\b/i;

/** WHETHER THE CARDS THAT REACH THE HAND ARE A CHOICE from a larger look (Impulse, Dig Through Time, Browse, Akal Pakal): somebody picks which of at least two
 *  looked-at cards go to the hand. NOT a pile (the split is the choice, `amount` says `pile`), not everything, not a card chosen at random, not the one card a reveal
 *  turned up (Dark Confidant, Coiling Oracle, Demonic Consultation's reveal-until). The Impulse line (owner ruling 2026-10-02, card selection) reads this.
 *  CEILING: "for each of those cards, put that card into your hand unless an opponent pays 3 life" (Sword-Point Diplomacy) and "put that card ... for each" shapes are no pick. */
export function toHandChooses(object: string, clauseText: string): boolean {
  const amount = toHandAmount(object);
  if (amount === "pile" || amount === "all") return false;
  if (/\bat random\b/i.test(object)) return false;
  if (!LOOKS_AT_MANY.test(clauseText)) return false;
  const o = object.trim().toLowerCase().replace(/\s+into your hand$/, "");
  return PICK.test(o) || (POINTER.test(o) && PICKS_IN_CLAUSE.test(clauseText));
}

/** ANOTHER PLAYER'S CARD: "the card target opponent revealed", "the cards they revealed". Their library, their hand. */
const FOREIGN_CARD = /\b(?:opponents?|they|that player|defending player)\b[^,]*\brevealed\b/i;
const FOREIGN_HAND = /\binto (?:their|that player's|his or her|an opponent's|its owner's) hand\b/i;

/** THE CARD'S TEXT TYPES THE CARD, whatever the stored object says (owner ruling 2026-09-16: a dig restricted to a class is a typed search, `digNamesAClass`): the put's own sentence holds
 *  "If it's a land card, ... put it into your hand" (Dryad Greenseeker, Archghoul of Thraben) or "reveal a land card from among them and put it into your hand" (Nessian Wanderer). An object
 *  of "it" / "that card" / "the revealed card" says none of that. Coiling Oracle's "Otherwise, put that card into your hand" has no condition in its sentence and is not typed.
 *  CEILING: only the put's OWN sentence is read; a condition one sentence earlier ("If it's a land card, you may put it onto the battlefield. If you don't, put it into your hand", Risen Reef) is not. */
const TYPED_CONDITION = /\bif (?:it's|it is|that card is|the card is) an? (?!card\b)[^,.]*\bcards?\b/i;
const TYPED_FROM_AMONG = /\b(?:an?|any number of|up to \w+|all) (?!cards?\b)[^.]*?\bcards?\b[^.]*\bfrom among (?:them|those)\b/i;
function clauseTypesTheCard(clauseText: string): boolean {
  return clauseText.split(/(?<=\.)\s+/).some((sentence) => /\binto your hand\b/i.test(sentence) && (TYPED_CONDITION.test(sentence) || TYPED_FROM_AMONG.test(sentence)));
}

/** Is this `put library -> hand` the top of YOUR OWN library going to YOUR hand, with no search and no class? The clause must say "top" (a whole-library reveal is a tutor: Guided
 *  Passage), must not search (the search ability claims its own put), must say "your library", must not type the card (a typed dig is `search`, or unclaimed), and must not hand the card to
 *  another player (Goblin Guide) or take the card another player revealed (Keen Duelist's second put). Needs the clause text: without it a search cannot be ruled out. CEILING: "each
 *  player" clauses that say "their library" (Conundrum Sphinx, Wandering Archaic) are not read: the player count is not an effect subject. CEILING: "for each of those cards, put that
 *  card into your hand unless an opponent pays 3 life" (Sword-Point Diplomacy) reads `amount` 1, not the number of cards that get through. */
export function putsTopCardsIntoYourHand(object: string, clauseText: string): boolean {
  if (clauseText === "") return false;
  if (!/\btop\b/i.test(clauseText) || /\bsearch(?:es|ed|ing)?\b/i.test(clauseText) || !/\byour library\b/i.test(clauseText)) return false;
  return !FOREIGN_HAND.test(clauseText) && !FOREIGN_CARD.test(object) && !clauseTypesTheCard(clauseText);
}
