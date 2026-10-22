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
export function toHandAmount(object: string, sentence = ""): string {
  const o = object.trim().toLowerCase().replace(/\s+into your hand$/, "");
  if (/\bpiles?\b/.test(o) && !/^(?:a|one) card from\b/.test(o)) return "pile";
  if (EVERYTHING.test(o)) return "all";
  if (OPEN_COUNT.test(o)) return "X";
  const n = LEADING_COUNT.exec(o)?.[1];
  if (n !== undefined) return COUNT[n] ?? n;
  // ONE PUT PER <X> ("For each card type, you may put a card of that type from among the revealed cards into your hand": Atraxa, Grand Unifier, Hurkyl): as many as there are Xs.
  return /\bfor each\b/i.test(sentence) ? "X" : "1";
}

/** A look at, or a reveal of, MORE THAN ONE card off the top: "look at the top four cards", "reveal the top five cards", "look at that many cards from the top".
 *  Not "exile the top six cards" (no look) and not "look at the top card" (one card is no choice). */
const LOOKS_AT_MANY = /\b(?:look at|reveals?) (?:the )?top (?:two|three|four|five|six|seven|eight|nine|ten|twenty|\d+|x) cards\b|\b(?:look at|reveals?) (?:that many|the top x) cards\b|\blook at twice x cards\b|\b(?:look at|reveals?) a number of cards\b|\bthat many cards from the top\b/i;
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
  // THE CHOICE IS YOURS (owner 2026-10-22): "An opponent chooses one of them. Put that card into your hand" (Karn, Scion of Urza) and an opponent's split (Truth or Tale: "a card from the chosen pile") hand you what they left.
  if (OPPONENT_DECIDES.test(clauseText)) return false;
  if (!LOOKS_AT_MANY.test(clauseText)) return false;
  const o = object.trim().toLowerCase().replace(/\s+into your hand$/, "");
  return PICK.test(o) || (POINTER.test(o) && PICKS_IN_CLAUSE.test(clauseText));
}

/** Somebody else decides which cards you get: "An opponent chooses one of them", "target opponent separates those cards into two piles". Not YOUR pick. */
const OPPONENT_DECIDES = /\b(?:an? opponent|target opponent|each opponent|that player|defending player)\s+(?:chooses?|separates?|splits?)\b|\bopponent[^.]*\bchooses?\b[^.]*\bof (?:them|those)/i;

/** ANOTHER PLAYER'S CARD: "the card target opponent revealed", "the cards they revealed". Their library, their hand. */
const FOREIGN_CARD = /\b(?:opponents?|they|that player|defending player)\b[^,]*\brevealed\b/i;
const FOREIGN_HAND = /\binto (?:their|that player's|his or her|an opponent's|its owner's) hand\b/i;

const sentencesOf = (clause: string): string[] => clause.split(/(?<=[.!?])\s+/);
/** A sentence that is the OTHER branch of a condition, or a fallback: "Otherwise, put that card into your hand" (Coiling Oracle, Nissa Vastwood Seer), "If you don't put the card onto the battlefield, put it into your hand" (Risen Reef).
 *  It takes whatever the condition did not, so the class of the condition is not its class. */
const OTHER_BRANCH = /\botherwise\b|\bif you (?:don't|do not)\b|\bif it (?:isn't|is not|doesn't)\b/i;
/** The put points back at a card or cards an earlier sentence picked: "... and put THAT CARD into your hand", "put the revealed cards". */
const POINTS_BACK = /\bput(?:s)? (?:it|that card|those cards|them|the (?:revealed|chosen) cards?|the card)\b/i;

/** THE CLASS A SENTENCE RESTRICTS THE CARD TO, or `undefined` when it names none (owner ruling 2026-09-16: a dig restricted to a class is a typed search; 2026-10-22: it is also hand-fill, and
 *  stays type-aware). `""` is a restriction whose class is not readable ("a card of the chosen type", "shares a card type with it", "for each card type"). Three shapes:
 *   - a condition: "If it's a Zombie card", "If it's a noncreature, nonland card", "If a planeswalker card is revealed this way";
 *   - a pick: "reveal a land card from among them", "up to two creature cards with mana value X or less from among them", "any number of cards of the chosen type from among them";
 *   - a reveal-until: "until you reveal a creature card", "an Elf or Elemental card", "a card of the chosen kind" (Abundant Harvest). NOT "a card with the chosen name" (that is named, below).
 *  CEILING: the class is the words before "card(s)" as printed; a hybrid or parenthetical is passed to parseSubject as is, and the subject keeps whatever it can read. */
export function classIn(sentence: string, allowCondition = true): string | undefined {
  if (NAMED_UNTIL.test(sentence)) return undefined;
  if (/\bcards? of (?:that|the chosen) (?:type|kind)\b/i.test(sentence) || /\bshares an? (?:card |creature )?type\b/i.test(sentence) || /\bfor each card type\b/i.test(sentence)) return "";
  const until = /\buntil you reveal (?:an? |the )?([^.]*?)\s*cards?\b/i.exec(sentence);
  if (until) return until[1]!.trim();
  const pick = /\b(?:an?|any number of|up to \w+|all|each|one|two|three)\s+(?!cards?\b)([^.]*?)\s*cards?\b[^.]*?\bfrom among\b/i.exec(sentence);
  if (pick && !/\b(?:put|reveal)\b/i.test(pick[1]!)) return pick[1]!.trim();
  // A pick restricted by a PREDICATE, not a word before "card": "a card with a kicker ability from among them", "a card that's exactly two colors from among them". The class is not readable (""), the restriction is real.
  if (/\b(?:an?|any number of|up to \w+|all|each|one|two|three)\s+cards?\s+(?:with|that|whose|of)\b[^.]*?\bfrom among\b/i.test(sentence)) return "";
  if (!allowCondition) return undefined;
  // A condition on the card with no "<class> card" in it: "If that card is snow", "if it has three or more colored mana symbols in its mana cost" (Omnath), "if its mana value is ...".
  const snow = /\bif (?:it's|it is|that card is) (snow|legendary|basic|nonbasic|colorless|multicolored|historic)\b/i.exec(sentence);
  if (snow) return snow[1]!;
  if (/\bif (?:it|that card) has\b|\bif (?:its|that card's) mana value\b/i.test(sentence)) return "";
  const cond = /\bif (?:it's|it is|that card is|the card is) an? (?!card\b)([^.]*?)\s*cards?\b/i.exec(sentence)
    ?? /\bif an? ([^.]*?)\s*cards? (?:is|are) revealed this way\b/i.exec(sentence);
  return cond ? cond[1]!.trim() : undefined;
}

/** "a card with the chosen name" in a reveal-until: Demonic Consultation, Divining Witch, Spoils of the Vault. A tutor in effect (owner 2026-10-22), though nothing printed says "search". NOT the
 *  look-at-N-and-take-the-hits shape (Desperate Research, Tamiyo, Wood Sage: "put all of them with that name"), which may find nothing and is plain hand-fill. */
const NAMED_UNTIL = /\buntil you reveal (?:an? card (?:with|named)[^.]*?\bname|an? card named|the named card)/i;
/** A put that nets zero cards: it replaces a draw ("If you would draw a card, ... instead": Abundance, Underrealm Lich, Tomorrow) or swaps cards with the top of the library (Scroll Rack: "Put that many cards from the top
 *  of your library into your hand. Then ... put them on top of your library"). Owner 2026-10-22: card selection, not hand-fill. */
const REPLACES_A_DRAW = /\bif you would draw a card\b/i;
const SWAP = /\bthat many cards\b[\s\S]*\bon top of your library\b/i;

export interface ToHandRead {
  /** The clause restricts the cards to a class; `cls` is the printed class (possibly `""`, unreadable). `fromObject`: the stored put object names it already. */
  typed?: { cls: string; fromObject: boolean };
  named: boolean;
  netZero: boolean;
  amount: string;
  chooses: boolean;
}

/** WHAT A `put library -> hand` IS, when it is the top of YOUR OWN library going to YOUR hand with no printed search (#1302), or `undefined` when it is not: a clause with a search (the search ability claims its
 *  own put), without "top" (a whole-library reveal is a tutor: Guided Passage), without "your library", handing the card to another player (Goblin Guide), or taking the card another player revealed (Keen
 *  Duelist's second put). Needs the clause text: without it a search cannot be ruled out.
 *  CEILING: "each player" clauses that say "their library" (Conundrum Sphinx, Wandering Archaic) are not read: the player count is not an effect subject.
 *  CEILING: only the put's own sentence and the one before it (when the put points back) are read for a class; Risen Reef's "If you don't put the card onto the battlefield, put it into your hand" has none. */
export function readToHand(object: string, clauseText: string, objectTyped: boolean): ToHandRead | undefined {
  if (clauseText === "") return undefined;
  if (!/\btop\b/i.test(clauseText) || /\bsearch(?:es|ed|ing)?\b/i.test(clauseText) || !/\byour library\b/i.test(clauseText)) return undefined;
  if (FOREIGN_HAND.test(clauseText) || FOREIGN_CARD.test(object)) return undefined;
  const sentences = sentencesOf(clauseText);
  const hand = sentences.map((text, at) => ({ text, at })).filter(({ text }) => /\binto your hand\b/i.test(text));
  let cls: string | undefined;
  // "the rest" / "the other" is what a sibling put LEFT (Genesis Ultimatum: "any number of permanent cards ... onto the battlefield and the rest into your hand"): the class belongs to the sibling, not to this put.
  const complement = /^the (?:rest|other)\b/i.test(object.trim());
  for (const { text, at } of complement ? [] : hand) {
    if (OTHER_BRANCH.test(text)) continue;
    // A condition one sentence back is the OTHER branch's too (Coiling Oracle): only a pick or a reveal-until is pointed back at.
    cls = classIn(text) ?? (POINTS_BACK.test(text) && at > 0 ? classIn(sentences[at - 1]!, false) : undefined);
    if (cls !== undefined) break;
  }
  const own = hand.find(({ text }) => !OTHER_BRANCH.test(text))?.text ?? hand[0]?.text ?? "";
  return {
    ...(objectTyped ? { typed: { cls: "", fromObject: true } } : cls !== undefined ? { typed: { cls, fromObject: false } } : {}),
    named: NAMED_UNTIL.test(clauseText),
    netZero: REPLACES_A_DRAW.test(clauseText) || SWAP.test(clauseText),
    amount: toHandAmount(object, own),
    chooses: toHandChooses(object, clauseText),
  };
}
