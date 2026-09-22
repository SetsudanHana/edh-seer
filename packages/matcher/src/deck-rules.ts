import type { Card } from "@edh-seer/engine";

/** CARDS THAT CHANGE HOW A DECK IS BUILT, AS DATA (owner, 2026-09-22).
 *
 *  Every Commander-legal card whose printed text changes deck construction was listed from the
 *  corpus before a line of this was written (2026-09-22): 12 "any number of cards named", 2 "up to
 *  N cards named" (Nazgûl, Seven Dwarves), 10 companions, 3 "choose a color before the game begins"
 *  commanders and Sovereign's Realm. Each is a row below, keyed on the sentence the card PRINTS, so
 *  a reprint or a new card with the same wording is covered without a code change.
 *
 *  AND A CARD NO ROW RECOGNISES IS REPORTED, NEVER PASSED. `CONSTRUCTION_WORDING` is the net under
 *  the table: a card that talks about the starting deck, or what a deck can have, and matches no
 *  row, becomes "changes a deck-building rule this tool does not check". That is the readiness for
 *  mechanics announced after this was written -- they surface on day one, and supporting one is a
 *  new row rather than a new code path. A silent pass on a rule we never modelled would be the
 *  worst answer this file could give. */

/** How a player's deck is built: every slot one entry per COPY, the commander(s) included, since
 *  CR 702.139b counts the commander as part of the starting deck in a Commander game. */
export interface StartingDeck {
  cards: readonly Card[];
  commanders: readonly Card[];
}

/** The sentences that mean "this card changes deck construction". Broad on purpose: a false
 *  "not checked" costs a reader one line, a missed rule costs them a wrong answer. */
const CONSTRUCTION_WORDING = /starting deck|a deck can have|a deck may have|your deck can't/i;
// NOT "before the game begins" on its own (review, 2026-09-22): three corpus cards print it in a
// rule-zero or flavour clause that builds nothing, and the net called each a deck-building rule.
// The one construction use of that phrase -- choosing a colour -- is a named row below.

/** The front face's type line -- a card in a library is its front face (CR 712.8a). */
const frontType = (c: Card): string => (c.typeLine ?? "").split(" // ")[0]!.toLowerCase();
const isLand = (c: Card): boolean => frontType(c).includes("land");
const PERMANENT_TYPES = ["artifact", "battle", "creature", "enchantment", "land", "planeswalker"];
const isPermanent = (c: Card): boolean => PERMANENT_TYPES.some((t) => frontType(c).includes(t));
const CARD_TYPES = ["artifact", "battle", "creature", "enchantment", "instant", "kindred", "land", "planeswalker", "sorcery", "tribal"];

/** A companion's condition, checked against the starting deck. `undefined` means met; a string is
 *  what is off, naming cards where that helps; `null` means this tool cannot judge it. */
type Verdict = { off: string; cards: string[] } | undefined | null;

/** `one`/`many` are the whole predicate, so "1 card is a permanent over mana value 2" and "3 cards
 *  are permanents over mana value 2" both read as sentences. */
const failing = (deck: StartingDeck, bad: (c: Card) => boolean, one: string, many: string): Verdict => {
  const names = [...new Set(deck.cards.filter(bad).map((c) => c.name))].sort();
  return names.length === 0 ? undefined
    : { off: names.length === 1 ? `1 card ${one}` : `${names.length} cards ${many}`, cards: names };
};

/** THE TEN COMMANDER-LEGAL COMPANIONS, keyed on the condition each prints after "Companion —".
 *  Three more companion texts exist in the corpus (The Companion of the Wilds, Treizeci, Lutri,
 *  Pauper Otter) and all three are `not_legal` in Commander, which the banned/not-legal rule
 *  already reports. */
const COMPANIONS: { condition: RegExp; check: (d: StartingDeck) => Verdict }[] = [
  {
    // Lutri: singleton already forces this, EXCEPT for the cards that print their own exemption.
    condition: /each nonland card in your starting deck has a different name/i,
    check: (d) => {
      const seen = new Map<string, number>();
      for (const c of d.cards) if (!isLand(c)) seen.set(c.name, (seen.get(c.name) ?? 0) + 1);
      const dup = [...seen].filter(([, n]) => n > 1).map(([name]) => name).sort();
      return dup.length === 0 ? undefined : { off: `${dup.length} nonland ${dup.length === 1 ? "name repeats" : "names repeat"}`, cards: dup };
    },
  },
  { condition: /only cards with even mana values/i,
    check: (d) => failing(d, (c) => c.manaValue % 2 !== 0, "has an odd mana value", "have an odd mana value") },
  { condition: /only cards with odd mana values and land cards/i,
    check: (d) => failing(d, (c) => !isLand(c) && c.manaValue % 2 !== 1, "is neither a land nor odd in mana value", "are neither lands nor odd in mana value") },
  { condition: /only cards with mana value 3 or greater and land cards/i,
    check: (d) => failing(d, (c) => !isLand(c) && c.manaValue < 3, "is a nonland card under mana value 3", "are nonland cards under mana value 3") },
  { condition: /each permanent card in your starting deck has mana value 2 or less/i,
    check: (d) => failing(d, (c) => isPermanent(c) && c.manaValue > 2, "is a permanent over mana value 2", "are permanents over mana value 2") },
  {
    // Kaheera. A changeling IS every creature type (CR 702.73a), so it qualifies.
    condition: /each creature card in your starting deck is a cat, elemental, nightmare, dinosaur, or beast card/i,
    check: (d) => failing(d, (c) => frontType(c).includes("creature")
      && !(c.keywords ?? []).some((k) => k.toLowerCase() === "changeling")
      && !/\b(cat|elemental|nightmare|dinosaur|beast)\b/.test(frontType(c).split("—")[1] ?? ""),
    "is a creature of another type", "are creatures of another type"),
  },
  {
    // Umori: SOME one card type is shared by every nonland card.
    condition: /each nonland card in your starting deck shares a card type/i,
    check: (d) => {
      const nonland = d.cards.filter((c) => !isLand(c));
      if (nonland.length === 0) return undefined;
      const shared = CARD_TYPES.some((t) => nonland.every((c) => frontType(c).includes(t)));
      return shared ? undefined : { off: "the nonland cards do not all share one card type", cards: [] };
    },
  },
  {
    // Jegantha: a mana symbol printed twice in one cost, hybrid and {X} included.
    condition: /no card in your starting deck has more than one of the same mana symbol in its mana cost/i,
    check: (d) => failing(d, (c) => {
      const syms = (c.manaCost ?? "").match(/\{[^}]+\}/g) ?? [];
      return new Set(syms).size !== syms.length;
    }, "repeats a mana symbol in its cost", "repeat a mana symbol in their cost"),
  },
  {
    // Yorion: CR 903.5a makes the minimum AND the maximum 100, so twenty over the minimum cannot
    // be built. Said as the rule it is rather than as a count the deck could fix.
    condition: /at least twenty cards more than the minimum deck size/i,
    check: () => ({ off: "a Commander deck is exactly 100 cards, so it can never be twenty over the minimum", cards: [] }),
  },
  {
    // Zirda: "has an activated ability" is not something this engine can read reliably off text
    // (a keyword like equip is one, a quoted ability granted to something else is not). NOT CHECKED
    // is the honest answer, and it is said, not skipped.
    condition: /each permanent card in your starting deck has an activated ability/i,
    check: () => null,
  },
];

const COMPANION_LINE = /Companion —([^\n(]*)/i;
export const isCompanionCard = (c: Card): boolean => COMPANION_LINE.test(c.oracleText ?? "");

/** "A deck can have any number of cards named X" -- CR 903.5b's own printed exception. */
export const ANY_NUMBER_NAMED = /a deck can have any number of cards named/i;
/** "A deck can have up to nine cards named Nazgûl" -- the capped form, two corpus cards. */
const UP_TO_NAMED = /a deck can have up to (\w+) cards named/i;
const WORD_NUMBER: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
  twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20,
};
/** The printed cap, or undefined when the card says "up to" something this cannot read. */
const printedCap = (text: string): number | undefined => {
  const cap = UP_TO_NAMED.exec(text)?.[1]?.toLowerCase();
  if (!cap) return undefined;
  return WORD_NUMBER[cap] ?? (/^\d+$/.test(cap) ? Number(cap) : undefined);
};

/** How many copies this card may have in one deck: 1, a printed cap, or unlimited.
 *
 *  A CAP THIS CANNOT READ IS UNLIMITED HERE AND REPORTED BY THE NET (review, 2026-09-22). Falling
 *  back to 1 would flag a legal deck as a duplicate violation, which is the silent wrong answer this
 *  file exists to avoid; `constructionFindings` names the card as not checked instead. */
export function copyLimit(c: Card): number {
  const text = c.oracleText ?? "";
  if (/\bbasic\b/i.test(c.typeLine ?? "") || ANY_NUMBER_NAMED.test(text)) return Infinity;
  if (UP_TO_NAMED.test(text)) return printedCap(text) ?? Infinity;
  return 1;
}

/** "Your starting deck can't have basic land cards" -- Sovereign's Realm. */
const NO_BASICS = /your starting deck can't have basic land cards/i;
/** "choose a color before the game begins" -- CR 903.4b, on the commander. The ONE copy of this
 *  pattern; `legality.ts` re-exports `choosesColour` from here. */
const CHOOSES_COLOUR = /choose a colou?r before the game begins/i;
export const choosesColour = (card: Card): boolean => CHOOSES_COLOUR.test(card.oracleText ?? "");

/** Every construction sentence some rule above reads. A card whose wording matches
 *  `CONSTRUCTION_WORDING` but none of these is the unmodelled case. */
const KNOWN: RegExp[] = [
  ...COMPANIONS.map((r) => r.condition), ANY_NUMBER_NAMED, UP_TO_NAMED, NO_BASICS, CHOOSES_COLOUR,
];

export interface RuleFinding {
  rule: "companion" | "construction" | "unchecked";
  detail: string;
  cards: string[];
}

/** The companion's condition against the starting deck (CR 702.139a/b). */
export function companionFindings(companion: Card, deck: StartingDeck): RuleFinding[] {
  const condition = COMPANION_LINE.exec(companion.oracleText ?? "")?.[1]?.trim();
  if (condition === undefined) {
    return [{ rule: "companion", detail: `${companion.name} has no Companion ability, so it cannot be your companion`, cards: [companion.name] }];
  }
  const row = COMPANIONS.find((r) => r.condition.test(condition));
  const verdict = row ? row.check(deck) : null;
  if (verdict === null) {
    return [{ rule: "unchecked", detail: `${companion.name}'s condition is not checked here: "${condition}"`, cards: [companion.name] }];
  }
  if (verdict === undefined) return [];
  return [{ rule: "companion", detail: `${companion.name}'s condition is not met: ${verdict.off}`, cards: verdict.cards }];
}

/** Construction rules printed on cards IN the deck, and the net for wording nothing here reads. */
export function constructionFindings(deck: StartingDeck): RuleFinding[] {
  const out: RuleFinding[] = [];
  const distinct = [...new Map(deck.cards.map((c) => [c.name, c])).values()];

  // Sovereign's Realm, when it is in the deck.
  const realm = distinct.find((c) => NO_BASICS.test(c.oracleText ?? ""));
  if (realm) {
    const basics = distinct.filter((c) => /\bbasic\b/i.test(c.typeLine ?? "") && isLand(c)).map((c) => c.name).sort();
    if (basics.length > 0) {
      out.push({ rule: "construction", detail: `${realm.name} says your starting deck can't have basic land cards`, cards: basics });
    }
  }

  // THE NET. Companions in the 99 are not their own rule (the ability works from outside the
  // game), so a companion card in the deck is not "unmodelled" either.
  // A card already reported as banned or not legal is not ALSO a rule to model: Un-cards print
  // construction jokes, and saying so twice buries the finding that matters.
  const unmodelled = distinct.filter((c) => {
    const text = c.oracleText ?? "";
    if (c.commanderLegality === "banned" || c.commanderLegality === "not_legal") return false;
    const unreadCap = UP_TO_NAMED.test(text) && printedCap(text) === undefined;
    return unreadCap || (CONSTRUCTION_WORDING.test(text) && !KNOWN.some((re) => re.test(text)) && !isCompanionCard(c));
  }).map((c) => c.name).sort();
  if (unmodelled.length > 0) {
    out.push({
      rule: "unchecked",
      detail: `${unmodelled.length === 1 ? "this card changes" : "these cards change"} a deck-building rule this tool does not check`,
      cards: unmodelled,
    });
  }
  return out;
}

/** The commander's colour identity, widened by one chosen colour where the commander prints
 *  "choose a color before the game begins" (CR 903.4b). The choice is not in a decklist, so the
 *  identity rule accepts cards of exactly ONE colour outside the printed identity and reports only
 *  when the outsiders need two or more. */
export function allowsChosenColour(commanders: readonly Card[]): boolean {
  return commanders.some(choosesColour);
}
