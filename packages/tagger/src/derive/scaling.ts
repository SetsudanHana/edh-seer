/** What a payoff's magnitude COUNTS, as one of the engine's closed SCALING_BASES.
 *
 *  This channel was already built and already consumed: `edges.ts` copies `effect.scaling` onto every
 *  Reason at four sites, `impact.ts` weights a reason by it, and `buckets.ts` reads it. The FLAT
 *  population carried it on 1,781 cards. The derived population carried it on ZERO — derivation
 *  simply never set it — so flipping TAGS_SOURCE to `derived` took the whole channel dark without
 *  anyone measuring the loss. This file is the repair.
 *
 *  Read from the ACTION's own `amount` and `object`, never from the clause text. "Draw a card for
 *  each creature you control, then create a Treasure token" states one count, and it belongs to the
 *  draw; reading the clause would make the Treasure per-creature too. That is the same cross-action
 *  bleed `recipient.ts` is bounded to avoid. It costs reach — 221 corpus actions carry the count in
 *  their own fields and a further 329 mentions live only in the clause — and the reach is not worth a
 *  wrong basis, which is consumed as if it were true.
 *
 *  A count the vocabulary cannot name (Dragonspark Reactor's charge counters) stays UNSET, which the
 *  engine already reads as "fixed". */
import type { Action } from "../canonicalize.js";
import type { ScalingBasis, SubjectFilter } from "../schema.js";
import { parseSubject } from "./subject.js";

/** A count OF A GRAVEYARD'S CONTENTS: "in your graveyard", "in all graveyards", "in each graveyard". */
const GRAVEYARD_COUNT = /\bin (?:your|a|an|each|their|all|its owner's) [^.,;]{0,30}graveyards?\b/i;

/** A COUNT OF WHAT IS ON A BATTLEFIELD: "Goblins you control", "Zombies on the battlefield".
 *
 *  MEASURED 2026-09-04, and it is why this exists: 662 corpus cards state a count phrase and this
 *  file read only the 156 that count a graveyard. Krenko, Mob Boss -- "X 1/1 red Goblin creature
 *  tokens, where X is the number of Goblins you control" -- derived NO scaling and NO subject, so
 *  the one thing his deck is built around was invisible to every layer that reads either. */
const BATTLEFIELD_COUNT = /\b(?:you control|on the battlefield)\b/i;

/** Order matters. A graveyard count is per-graveyard even when the thing counted is a creature --
 *  SCALING_ALIASES maps "per-graveyard-creature" to per-graveyard, so that is the canonical reading
 *  and it must be tested before per-creature can claim Diregraf Colossus. */
const BASES: [RegExp, ScalingBasis][] = [
  // MENTIONING A GRAVEYARD IS NOT COUNTING ONE. This row used to carry a bare `\bgraveyards?\b`
  // alternative, and it claimed 3 of the 17 per-graveyard payoffs in the derived corpus for cards
  // that count nothing there: Stonespeaker Crystal EXILES "any number of target players' graveyards"
  // and Glimpse the Impossible counts "each card put INTO your graveyard this way" — its own exiled
  // cards. A false basis is not inert: impact.ts weights by it, buckets.ts and wincon.ts read it.
  // "into" is excluded for free by requiring a space after "in".
  [GRAVEYARD_COUNT, "per-graveyard"],
  [/\bopponents?\b|\bplayers? in the game\b|\beach player\b/i, "per-opponent"],
  [/\bcreatures?\b/i, "per-creature"],
  [/\b(?:permanents?|artifacts?|enchantments?|lands?|devotion)\b/i, "per-permanent"],
  [/\bspells?\s+you'?ve\s+cast\b|\bstorm\b|\bspells?\s+cast\b/i, "per-cast-or-spell"],
  // LAST, AND ONLY WHEN A BOARD IS NAMED. Every row above tests a noun this one cannot name -- a
  // creature type, an artifact subtype, a Shrine -- so it claims what the closed vocabulary has no
  // better word for: a Goblin on the battlefield is a permanent. It must stay last, or "creatures
  // you control" would stop being `per-creature`.
  [BATTLEFIELD_COUNT, "per-permanent"],
];

/** The noun a count actually counts. Matching the whole string reads the LOCATION as the basis:
 *  Dragonspark Reactor's "the number of charge counters on this artifact" counts counters, not
 *  artifacts, and the table would have called it per-permanent off the word "artifact". Everything
 *  from " on " is dropped for that reason; " in " is kept, because "in your graveyard" IS the basis. */
const COUNTED = /\b(?:for each|number of)\s+([^.,;]{1,60})/i;

/** "WHERE X IS THE NUMBER OF ..." DEFINES X FOR THE WHOLE CLAUSE, and the own-text rule still holds:
 *  the count reaches only an action whose amount IS that bare X, never a sibling with a fixed
 *  amount. Burakos, Party Leader -- "defending player loses X life and you create X Treasure
 *  tokens, where X is the number of creatures in your party" -- keeps the tail on neither action
 *  after normalization, so both derived `x-cost` and no subject (owner, 2026-09-05). */
const DEFINES_X = /\bwhere x is (?:the number of|equal to the number of)\s+([^.,;]{1,60})/i;
const isBareX = (action: Action): boolean => /^x$/i.test((action.amount ?? "").trim());
/** The text the count is read from: the action's own, or the clause's definition of its X. */
const countedText = (action: Action, clauseText?: string): string => {
  const own = `${action.amount ?? ""} ${action.object ?? ""}`;
  if (COUNTED.test(own)) return own;
  const defined = clauseText && isBareX(action) ? DEFINES_X.exec(clauseText)?.[1] : undefined;
  return defined ? `number of ${defined}` : own;
};

/** A PARTY IS A BOARD COUNT OF FOUR TYPES (CR 700.7): up to one each of Cleric, Rogue, Warrior and
 *  Wizard among creatures you control. CEILING: the cap of four is a magnitude the engine does not
 *  model; the count is read as "creatures you control that are one of these", which is the same
 *  set of cards, over-counted past four. 43 corpus cards say party. */
const PARTY = /\bin your party\b/i;
const PARTY_TYPES = ["cleric", "rogue", "warrior", "wizard"];

/** WHAT a graveyard count counts, as a subject the matcher can compare a fill against.
 *
 *  The BASIS is not the subject: Cavalier of Flame counts LAND cards in your graveyard, Glamdring
 *  instants and sorceries, Bonehoard creatures — all three `per-graveyard`. An edge drawn off the
 *  basis alone would claim that milling any card feeds all of them, which is 676 candidate pairs in
 *  the 71 decks and mostly wrong-type. With this, `edges.ts` can put the fill through
 *  `graveyardFillMatches` exactly as a reanimator demand goes through it.
 *
 *  The OWNER matters and is read from the same phrase: "your graveyard" is yours, "all graveyards" is
 *  anyone's, and "their graveyard" is the OPPONENT's — Riverchurn Monument mills each target player
 *  for the size of THEIR yard, which your own fillers do not feed. */
export function scalingSubject(action: Action, clauseText?: string): SubjectFilter | undefined {
  const text = countedText(action, clauseText);
  const counted = COUNTED.exec(text);
  if (!counted) return undefined;
  const noun = counted[1];

  if (GRAVEYARD_COUNT.test(text)) {
    const subject = parseSubject(noun.split(/\s{1,4}in\s{1,4}/i)[0]);
    subject.zone = "graveyard";
    subject.control = /\btheir\b/i.test(noun) ? "opp"
      : /\ball graveyards?\b|\beach graveyard\b/i.test(noun) ? "any"
      : "you";
    return subject;
  }

  if (PARTY.test(noun)) return { type: "creature", subtype: PARTY_TYPES, zone: "battlefield", control: "you", token: null };

  // A BOARD COUNT, AND THE GRAVEYARD BRANCH GETS FIRST REFUSAL. "Creature cards in your graveyard"
  // names neither a controller nor the battlefield, so the order is what keeps a graveyard count
  // from claiming a board -- the same precedence `BASES` states above.
  if (!BATTLEFIELD_COUNT.test(noun)) return undefined;
  const subject = parseSubject(noun.split(/\s{1,4}(?:you control|on the battlefield)\b/i)[0]);
  subject.zone = "battlefield";
  // "ON THE BATTLEFIELD" IS EVERYONE'S BOARD and "you control" is yours -- the same distinction the
  // graveyard branch draws between "your graveyard" and "all graveyards", and it decides whether an
  // opponent's Goblins count toward the number.
  subject.control = /\byou control\b/i.test(noun) ? "you" : "any";
  return subject;
}

export function actionScaling(action: Action, clauseText?: string): ScalingBasis | undefined {
  const text = countedText(action, clauseText);
  // A bare X the clause never defines is the cost the player chose, whatever noun follows it.
  if (isBareX(action) && !COUNTED.test(text)) return "x-cost";
  const counted = COUNTED.exec(text);
  if (!counted) return undefined;
  const noun = counted[1].split(/\s{1,4}on\s{1,4}/i)[0];
  for (const [re, basis] of BASES) if (re.test(noun)) return basis;
  return undefined;
}
