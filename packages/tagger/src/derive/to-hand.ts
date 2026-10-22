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

// Every scan below is linear: `indexOf` / `lastIndexOf` on a lowercase copy, or a regex whose classes are bounded (`{0,N}`) and never sit beside a space-matching quantifier (CodeQL js/polynomial-redos).
const lower = (s: string): string => s.toLowerCase();
const sentencesOf = (clause: string): string[] => clause.split(/(?<=[.!?])\s+/);
const NUMBER = /^(one|two|three|four|five|six|seven|eight|nine|ten|twenty|\d{1,2})$/;
const countOf = (word: string): string => COUNT[word] ?? word;

/** A sentence that is the OTHER branch of an alternative: "Otherwise, put one of them into your hand", "If you don't put the card onto the battlefield, put it into your hand", "... put each of those cards into your hand
 *  INSTEAD", or one that opens on a condition ("If you control more creatures than each other player, put two of those cards"). Two hand-puts where the second is such a branch are alternatives, not a sequence. */
const OTHER_BRANCH = /\botherwise\b|\bif you (?:don't|do not|didn't|did not)\b|\bif it (?:isn't|is not|doesn't)\b|\binstead\b|^if\b/i;
/** The put points back at a card or cards an earlier sentence picked: "... and put THAT CARD into your hand", "put the revealed cards", "put it". */
const POINTS_BACK = /\bput(?:s)? (?:it|that card|those cards|them|the (?:revealed|chosen) cards?|the card)\b/i;

/** The words of a sentence that name WHAT IS TAKEN, from its verb to "from among" (or to "into your hand"): "a creature card and/or a land card" in "You may put a creature card and/or a land card from among them into your hand",
 *  "the revealed cards" in "Put the revealed cards into your hand". `undefined` when the sentence puts nothing in the hand. The segment starts after the LAST of reveal / put / choose / take / " and " before the end. */
function pickSegment(sentence: string): string | undefined {
  const t = lower(sentence);
  const into = t.indexOf("into your hand");
  const among = t.lastIndexOf("from among", into >= 0 ? into : t.length);
  const end = among >= 0 ? among : into;
  if (end < 0) return undefined;
  const before = t.slice(Math.max(0, end - 200), end);
  const at = Math.max(before.lastIndexOf("reveal "), before.lastIndexOf("put "), before.lastIndexOf("choose "), before.lastIndexOf("take "), before.lastIndexOf(" and "));
  if (at < 0) return before.trim();
  const marker = before.startsWith(" and ", at) ? 5 : before.startsWith("reveal ", at) || before.startsWith("choose ", at) ? 7 : before.startsWith("take ", at) ? 5 : 4;
  return before.slice(at + marker).trim();
}

/** HOW MANY a pick segment takes: a leading quantifier ("up to two", "two", "any number of" = all, "all"), else the number of "a/an <class> card" items it lists ("a creature card and/or a land card" = 2; "a Cleric card, a Rogue card,
 *  a Warrior card, and/or a Wizard card" = 4; "a creature or land card" = 1). `undefined` for a pointer ("the revealed cards", "it") or when it names nothing countable. */
function quantityOf(segment: string | undefined): string | undefined {
  if (segment === undefined) return undefined;
  const s = segment.trim();
  if (s.startsWith("any number of") || /^(?:all|each)\b/.test(s)) return "all";
  const upTo = /^up to (\w{1,6})\b/.exec(s)?.[1];
  const first = upTo ?? /^(\w{1,6})\b/.exec(s)?.[1];
  if (first !== undefined && (NUMBER.test(first) || (upTo !== undefined && first === "x"))) return countOf(first);
  if (first === "x") return "X";
  // "or" alone offers ONE card of either kind ("a Mount creature card or a Plains card", "a land card or a card with {X}"); "and/or" lists cards you may take together.
  let items = 0;
  for (const _ of s.matchAll(/\ban? [^,]{0,40}?\bcards?\b/g)) items++;
  return items === 0 ? undefined : s.includes("and/or") ? String(items) : "1";
}

const pointedQuantity = (sentence: string): string | undefined => quantityOf(pickSegment(sentence));
/** A plural pointer ("the chosen cards", "those cards", "them") at a pick that names ONE card ("each opponent chooses a different nonland card from among them": Manifold Insights) is every card those picks chose, not one:
 *  the pointed-at count only counts when it is a number of its own. */
const plural = (q: string | undefined, pointer: string | undefined): string | undefined => (q === "1" && /\b(?:cards|them)\b/.test(pointer ?? "") ? undefined : q);

/** THE CLASS (OR CLASSES) A PICK SEGMENT RESTRICTS THE CARD TO: "a creature card" -> "creature"; "a Cleric card, a Rogue card, a Warrior card, and/or a Wizard card" -> "Cleric, Rogue, Warrior, or Wizard"; "a creature card and/or a land card" -> "creature or land";
 *  "a creature, land, or planeswalker card" as printed. `""` is a restriction with no readable class ("a card that's exactly those colors", "a card with a kicker ability", "cards of the chosen type"); `undefined` is no restriction,
 *  and "cards with the chosen name" is none (Tamiyo, Desperate Research: a name is not a class). Reads the ORIGINAL case (the lowercase copy has the same offsets). */
function classOfSegment(original: string, segment: string): string | undefined {
  const at = lower(original).indexOf(segment);
  const text = at >= 0 ? original.slice(at, at + segment.length) : segment;
  const pieces: string[] = [];
  let rest = text, predicate = "";
  for (let guard = 0; guard < 8; guard++) {
    const m = /\bcards?\b/i.exec(rest);
    if (!m) break;
    pieces.push(rest.slice(0, m.index));
    rest = rest.slice(m.index + m[0].length);
    if (!/^\s*(?:,|and\/or\b|or\b)/.test(rest.slice(0, 12))) { predicate = rest.slice(0, 80); break; }
  }
  const cleaned = pieces
    .map((piece) => piece.replace(/^[\s,]+/, "").replace(/^(?:and\/or|or|and) /i, "").replace(/^(?:up to \w+|any number of|all|each|one|two|three|four|five|x|\d{1,2}|an?) /i, "").replace(/\band\/or\b/gi, "or").trim());
  const classes = cleaned.filter((piece) => piece !== "");
  // "a land card or a card with {X}": one alternative has no readable class, so the union has none.
  if (classes.length > 0 && cleaned.some((piece) => piece === "")) return "";
  if (/\bnames?\b|\bnamed\b/i.test(predicate)) return undefined;
  if (classes.length === 0) return /^\s*(?:with|that|whose|of)\b/i.test(predicate) ? "" : undefined;
  if (classes.length === 1) return classes[0]!;
  return classes.length === 2 ? `${classes[0]} or ${classes[1]}` : `${classes.slice(0, -1).join(", ")}, or ${classes[classes.length - 1]}`;
}

/** THE CLASS A SENTENCE RESTRICTS THE CARD TO, or `undefined` when it names none (owner ruling 2026-09-16: a dig restricted to a class is a typed search; 2026-10-22: it is also hand-fill, and
 *  stays type-aware). `""` is a restriction whose class is not readable. Three shapes:
 *   - a condition: "If it's a Zombie card", "If it's a noncreature, nonland card", "If a planeswalker card is revealed this way";
 *   - a pick: "reveal a land card from among them", "up to two creature cards with mana value X or less from among them", "any number of cards of the chosen type from among them", "choose a card that's exactly those colors from among them";
 *   - a reveal-until: "until you reveal a creature card", "an Elf or Elemental card", "a card of the chosen kind" (Abundant Harvest). NOT "a card with the chosen name" (that is named, below).
 *  CEILING: the class is the words before "card(s)" as printed; a hybrid or parenthetical is passed to parseSubject as is, and the subject keeps whatever it can read. */
export function classIn(sentence: string, allowCondition = true): string | undefined {
  const t = lower(sentence);
  if (NAMED_UNTIL.test(t)) return undefined;
  if (/\bcards? of (?:that|the chosen) (?:type|kind)\b/.test(t) || /\bshares an? (?:card |creature )?type\b/.test(t) || t.includes("for each card type")) return "";
  const until = t.indexOf("until you reveal ");
  if (until >= 0) {
    const rest = sentence.slice(until + 17, until + 17 + 120).replace(/^(?:an?|the) /i, "");
    const card = /\bcards?\b/i.exec(rest);
    const stop = rest.indexOf(".");
    if (card && (stop < 0 || card.index < stop)) return rest.slice(0, card.index).trim().replace(/^(?:two|three|four|five) /i, "");
  }
  if (t.includes("from among")) {
    const segment = pickSegment(t.includes("into your hand") ? sentence : `${sentence} into your hand`);
    if (segment !== undefined && segment !== "") { const cls = classOfSegment(sentence, segment); if (cls !== undefined) return cls; }
  }
  if (!allowCondition) return undefined;
  // A condition on the card with no "<class> card" in it: "If that card is snow", "if it has three or more colored mana symbols in its mana cost" (Omnath), "if its mana value is ...".
  const snow = /\bif (?:it's|it is|that card is) (snow|legendary|basic|nonbasic|colorless|multicolored|historic)\b/i.exec(sentence);
  if (snow) return snow[1]!;
  if (/\bif (?:it|that card) has\b|\bif (?:its|that card's) mana value\b/i.test(sentence)) return "";
  const cond = /\bif (?:it's|it is|that card is|the card is) an? /i.exec(sentence);
  if (cond) {
    const rest = sentence.slice(cond.index + cond[0].length, cond.index + cond[0].length + 140);
    const card = /\bcards?\b/i.exec(rest), stop = rest.indexOf(".");
    if (card && card.index > 0 && (stop < 0 || card.index < stop)) return rest.slice(0, card.index).trim();
    return undefined;
  }
  const revealedThisWay = /\bif an? ([^.]{0,100}?) cards? (?:is|are) revealed this way\b/i.exec(sentence);
  return revealedThisWay ? revealedThisWay[1]!.trim() : undefined;
}

/** "a card with the chosen name" in a reveal-until: Demonic Consultation, Divining Witch, Spoils of the Vault. A tutor in effect (owner 2026-10-22), though nothing printed says "search". NOT the
 *  look-at-N-and-take-the-hits shape (Desperate Research, Tamiyo, Wood Sage: "put all of them with that name"), which may find nothing and is plain hand-fill. */
const NAMED_UNTIL = /\buntil you reveal (?:an? card (?:with|named)[^.]{0,60}?\bname|an? card named|the named card)/i;
/** A put that nets zero cards: it replaces a draw ("If you would draw a card, ... instead": Abundance, Underrealm Lich, Tomorrow) or swaps cards with the top of the library (Scroll Rack: "Put that many cards from the top
 *  of your library into your hand. Then ... put them on top of your library"). Owner 2026-10-22: card selection, not hand-fill. */
const REPLACES_A_DRAW = /\bif you would draw a card\b/i;
const isSwap = (t: string): boolean => { const a = t.indexOf("that many cards"); return a >= 0 && t.indexOf("on top of your library", a) >= 0; };

/** ANOTHER PLAYER'S CARD: "the card target opponent revealed", "the cards they revealed". Their library, their hand. */
const FOREIGN_CARD = /\b(?:opponents?|they|that player|defending player)\b[^,]{0,80}\brevealed\b/i;
const FOREIGN_HAND = /\binto (?:their|that player's|his or her|an opponent's|its owner's) hand\b/i;

/** SOMEBODY ELSE PICKS THE CARDS YOU GET: "An opponent chooses one of them. Put that card into your hand" (Karn, Scion of Urza), "each opponent chooses a different nonland card from among them" (Manifold Insights). NOT an opponent who picks the
 *  PILE (Truth or Tale: "An opponent chooses one of those piles", then YOU pick a card from it: your own one-of-N pick) and not "choose an opponent". Sentence by sentence, with `includes`, so it is linear. */
function opponentPicksCards(sentences: readonly string[]): boolean {
  return sentences.some((raw) => {
    const t = lower(raw);
    return (t.includes("opponent") || t.includes("that player") || t.includes("defending player")) && t.includes("chooses") && !t.includes("pile")
      && (t.includes("of them") || t.includes("of those") || t.includes("from among"));
  });
}

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
 *  Duelist's second put). Needs the clause text: without it a search cannot be ruled out. `nth` is which of the clause's hand-puts this is (Follow the Lumarets: one, or two instead): it reads THAT put's sentence.
 *  THE COUNT AND THE CHOICE ARE READ FROM THE PICK SENTENCE, not from the stored object's spelling (review of d7f7a5c5): the object is "the revealed card" on one card and "a creature card and/or a land card from among them" on
 *  another with the same words printed. The object is the fallback when the clause holds no pick.
 *  CEILING: "each player" clauses that say "their library" (Conundrum Sphinx, Wandering Archaic) are not read: the player count is not an effect subject.
 *  CEILING: only the put's own sentence and the nearest earlier sentence with "from among" / "until you reveal" (when the put points back) are read for a class or a count; Risen Reef's "If you don't put the card onto the
 *  battlefield, put it into your hand" has none.
 *  CEILING: "for each of those cards, put that card into your hand unless an opponent pays 3 life" (Sword-Point Diplomacy) reads count X, not the number of cards that get through. */
export function readToHand(object: string, clauseText: string, objectTyped: boolean, nth = 0): ToHandRead | undefined {
  if (clauseText === "") return undefined;
  if (!/\btop\b/i.test(clauseText) || /\bsearch(?:es|ed|ing)?\b/i.test(clauseText) || !/\byour library\b/i.test(clauseText)) return undefined;
  if (FOREIGN_HAND.test(clauseText) || FOREIGN_CARD.test(object)) return undefined;
  const sentences = sentencesOf(clauseText);
  const hand = sentences.map((text, at) => ({ text, at })).filter(({ text }) => /\binto your hand\b/i.test(text));
  const mine = hand[Math.min(nth, hand.length - 1)] ?? { text: "", at: 0 };
  // The sentence that holds the pick when this put only points at it: the nearest earlier one saying "from among" or "until you reveal" (Break Out puts a sentence about the battlefield between them).
  let back = -1;
  if (POINTS_BACK.test(mine.text)) for (let i = mine.at - 1; i >= Math.max(0, mine.at - 3); i--) { const t = lower(sentences[i]!); if (t.includes("from among") || t.includes("until you reveal")) { back = i; break; } }
  if (back < 0 && POINTS_BACK.test(mine.text) && mine.at > 0) back = mine.at - 1;
  const pointed = back >= 0 ? sentences[back]! : undefined;
  // "the rest" / "the other" is what a sibling put LEFT (Genesis Ultimatum: "any number of permanent cards ... onto the battlefield and the rest into your hand"): the class belongs to the sibling, not to this put.
  const complement = /^the (?:rest|other)\b/i.test(object.trim());
  const cls = complement ? undefined : classIn(mine.text) ?? (pointed !== undefined ? classIn(pointed, false) : undefined);
  // The count: the pick sentence's own quantity, else the pointed-back one's, else "until you reveal three ...", else the object's.
  let amount = toHandAmount(object, mine.text);
  if (amount !== "pile" && !complement) {
    const untilN = /\buntil you reveal (two|three|four|five|\d{1,2}) /i.exec(clauseText)?.[1];
    // A reveal-until takes the first card it finds, or the N it says ("until you reveal three nonland cards"), however many classes it lists (An Unearthly Child: a Doctor, a companion or a Vehicle).
    const untilPick = pointed !== undefined && lower(pointed).includes("until you reveal");
    const q = quantityOf(pickSegment(mine.text)) ?? (untilPick ? undefined : pointed !== undefined ? plural(pointedQuantity(`${pointed} into your hand`), pickSegment(mine.text)) : undefined) ?? (untilN !== undefined ? countOf(lower(untilN)) : untilPick ? "1" : undefined);
    const perEach = /\bfor each\b/i.test(mine.text) || (pointed !== undefined && /\bfor each\b/i.test(pointed));
    if (q !== undefined) amount = q === "1" && perEach ? "X" : q;
  }
  // A SEQUENCE of hand-puts (Memories Returning: one, then one, then the other) is cards to hand; an ALTERNATIVE (instead / otherwise / opens on an if) is another branch of the same pick.
  const sequence = hand.length >= 2 && hand.slice(1).every(({ text }) => !OTHER_BRANCH.test(text));
  const o = lower(object).trim().replace(/\s+into your hand$/, "");
  const picks = lower(mine.text).includes("from among") || (pointed !== undefined && lower(pointed).includes("from among")) || PICK.test(o)
    || (POINTER.test(o) && /\bfrom among (?:them|those cards)\b|\bchooses? (?:one|two|three|a card|any number) of (?:them|those)\b/i.test(clauseText));
  const chooses = amount !== "pile" && amount !== "all" && !sequence && !/\bat random\b/i.test(object) && !opponentPicksCards(sentences) && LOOKS_AT_MANY.test(clauseText) && picks;
  return {
    ...(objectTyped || cls !== undefined ? { typed: { cls: cls ?? "", fromObject: objectTyped } } : {}),
    named: NAMED_UNTIL.test(clauseText),
    netZero: REPLACES_A_DRAW.test(clauseText) || isSwap(lower(clauseText)),
    amount,
    chooses,
  };
}

/** WHETHER THE CARDS THAT REACH THE HAND ARE A CHOICE from a larger look (Impulse, Dig Through Time, Browse, Akal Pakal): YOU pick which of at least two looked-at cards go to the hand. NOT a pile (the split is the choice, `amount`
 *  says `pile`), not everything, not a card chosen at random, not a card an OPPONENT picks (Karn), not the one card a reveal turned up (Dark Confidant, Coiling Oracle, Demonic Consultation's reveal-until), not a sequence of picks
 *  (Memories Returning). The Impulse line (owner ruling 2026-10-02, card selection) reads this. The first hand-put of the clause. */
export function toHandChooses(object: string, clauseText: string): boolean {
  return readToHand(object, clauseText.includes("your library") ? clauseText : `${clauseText} your library top`, false)?.chooses ?? false;
}
