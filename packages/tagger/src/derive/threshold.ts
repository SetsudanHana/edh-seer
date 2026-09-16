/** A numeric condition on when a trigger fires — The Millennium Calendar's "when there are 1,000 or
 *  more time counters".
 *
 *  DIFFERENT FROM `Ability.amount`. The amount is how big the effect is ("each opponent loses 1,000
 *  life"); the threshold is how many it takes before the ability fires at all. One slot for both
 *  would make those two 1,000s indistinguishable, and they are the difference between a card that
 *  wins and a card that does nothing.
 *
 *  Without it the corpus reads The Millennium Calendar as "whenever a time counter is added, each
 *  opponent loses life" — an engine that believes the card wins on turn one.
 *
 *  THE PARSE IS EASY AND THE GATES ARE THE WORK. 208 corpus sentences carry a numeric comparison
 *  inside a condition; only 81 are thresholds. See
 *  `docs/superpowers/specs/2026-08-14-resource-ledger-design.md` section 6. */
import type { SubjectFilter } from "../schema.js";
import { parseSubject } from "./subject.js";
import { mentionsSelf } from "./self-reference.js";

/** Spelled numbers that appear in a Magic threshold. Not a general word-to-number table: the
 *  vocabulary printed on cards is small and closed, and a wider one invites matching prose. */
const WORD_NUMBER: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, twenty: 20,
};

/** `\d+(?:,\d{3})*` and NOT `\d+`, because `\b\d+\b` matches "000" inside "1,000" — the word
 *  boundary sits after the comma, so Calendar's threshold parses as ZERO. Also not `[\d,]*`, which
 *  would swallow the comma that ends a clause ("if you control three, draw a card"). */
const NUMBER = `(\\d+(?:,\\d{3})*|${Object.keys(WORD_NUMBER).join("|")})`;

/** "N or more", "N or greater", "at least N" — the three spellings the corpus uses. */
const COMPARISON = new RegExp(`\\b${NUMBER}\\s+or\\s+(?:more|greater)\\b|\\bat\\s+least\\s+${NUMBER}\\b`, "gi");

/** A threshold conditions an ability. Without a cue the number is a magnitude, which is
 *  `Ability.amount`'s business. `unless` is the restriction's spelling of the same fact: Gadrak
 *  "can't attack unless you control four or more artifacts" is on at four, exactly as Chrome Steed
 *  is on "as long as you control three or more artifacts" (59 corpus statics, 2026-09-16). */
const CONDITION_CUE = /\b(?:if|when there are|whenever|as long as|only if|unless)\b/i;

/** A stat comparison is ALREADY `SubjectFilter.stats`, which `Reason.hasStatPredicate` already
 *  reads. Two slots claiming one fact is the collision `notType` and `umbrella` were introduced to
 *  prevent. Anchored to the words immediately before the number so "power 4 or greater" is caught
 *  while "four or more lands" in a sentence that mentions power elsewhere is not. 29 corpus
 *  matches. */
const STAT_SHAPE = /\b(?:power|toughness|mana value|life total)\b[^.]{0,25}$/i;

/** THE ONE LATER SENTENCE THAT IS NOT A RIDER. "Activate only if you control three or more
 *  artifacts" (Urza's Workshop, Argent Sphinx; 28 corpus) always follows the effect as its own
 *  sentence, and it gates the WHOLE ability (CR 602.5): nothing happens at all below the count,
 *  which is the opposite of Primal Amulet's counter going on regardless. So exclusion 3 lets it
 *  through, and only it. */
const ACTIVATION_RESTRICTION = /\.\s+Activate only if\b[^.]*$/i;

function valueOf(raw: string): number {
  const word = WORD_NUMBER[raw.toLowerCase()];
  return word ?? Number(raw.replace(/,/g, ""));
}

/** The winning comparison in `text`, chosen by walking every candidate and applying the same three
 *  exclusions `thresholdFor` has always applied — run ONCE, here, so `thresholdFor` and
 *  `thresholdSubjectFor` can never disagree about which comparison is the trigger's.
 *
 *  That disagreement was a real bug, not a hypothetical one: `thresholdSubjectFor` used to run its
 *  own independent `.exec()` over the raw text, so on a sentence with TWO comparisons it could pick
 *  a different one than `thresholdFor` did. Persistent Marshstalker is the witness -- "whenever you
 *  attack with one or more Rats, if there are seven or more cards in your graveyard" carries "one or
 *  more Rats" (excluded by #1, an English plural) AND "seven or more cards" (the real threshold), and
 *  the independent exec picked the FIRST one up, pairing `threshold: {atLeast: 7}` with
 *  `thresholdSubject: {subtype: "rat"}` -- a number and a noun from two different sentences. */
function selectThreshold(text: string): { atLeast: number; start: number; end: number } | undefined {
  if (!CONDITION_CUE.test(text)) return undefined;

  for (const match of text.matchAll(COMPARISON)) {
    const raw = match[1] ?? match[2];
    if (!raw) continue;
    const atLeast = valueOf(raw);
    if (!Number.isFinite(atLeast)) continue;

    // EXCLUSION 1: "one or more" is an English plural meaning "any", not a counted condition.
    // Emitting atLeast:1 would be a wrong sentence dressed as data. 98 of 208 corpus matches.
    // This range check also does a second, unrelated job it was never asked to do: a broken
    // NUMBER pattern that mis-parses "1,000" down to "000" (see the sabotage check in
    // threshold.test.ts) yields atLeast:0, which is <=1 and gets silently absorbed HERE. That is
    // why the sabotaged regex is observed to return `undefined` rather than the `{ atLeast: 0 }`
    // its own parse produces -- a future regression in NUMBER will present as an ordinary refusal,
    // not a visible failure, contrary to this file's header promise that gaps "stay visible".
    if (atLeast <= 1) continue;

    // EXCLUSION 2: a stat comparison is SubjectFilter.stats' fact, not this one.
    if (STAT_SHAPE.test(text.slice(0, match.index))) continue;

    // EXCLUSION 3: a comparison after "Then", or outside the clause's first sentence, conditions a
    // RIDER, not the trigger. Primal Amulet reads "put a charge counter on this artifact. Then if
    // there are four or more charge counters on it, you may remove those counters and transform it"
    // -- the counter goes on REGARDLESS, so gating the counter-placement at 4 is a false sentence.
    // 13 of the 58 thresholds this gate shipped without it were of that shape.
    //
    // BOTH halves are needed and neither is redundant. Kuja, Genome Sorcerer is caught by the
    // "Then" test ONLY -- segment() rewrites its quoted granted ability and leaves no sentence
    // period -- while Omnath, Rabble Rousing and Dowsing Device are caught by the sentence test
    // only. Do not simplify this to one predicate.
    //
    // THE TRADE, accepted by the owner: the predicate refuses the whole clause, so ~7 currently
    // CORRECT thresholds are lost with the 12 wrong ones. A missing answer beats a wrong one.
    const before = text.slice(0, match.index);
    if (/\bThen\b/.test(before) || (before.includes(". ") && !ACTIVATION_RESTRICTION.test(before))) continue;

    return { atLeast, start: match.index ?? 0, end: (match.index ?? 0) + match[0].length };
  }
  return undefined;
}

/** The threshold stated by `text`, or `undefined` when it states none. On any ability kind: a
 *  trigger's intervening if (CR 603.4), a static's "as long as" (CR 611.3a), an activation
 *  restriction's "activate only if" (CR 602.5) and a restriction's "unless" all gate the ability on
 *  the same count.
 *
 *  Refuses rather than guesses, as `repeatsFor` does: an unrecognised numeric condition leaves the
 *  field unset and stays visible as a gap. */
export function thresholdFor(text: string): { atLeast: number } | undefined {
  const m = selectThreshold(text);
  return m ? { atLeast: m.atLeast } : undefined;
}

/** A zone-scoped card count is not a battlefield count. "Eight or more permanent cards in your
 *  graveyard" and "thirteen cards in your hand" both name a COUNT of cards sitting in a zone, not a
 *  class of permanents on the battlefield -- and no `SubjectFilter` can say "in your graveyard", so
 *  reading `type: "permanent"` off "permanent cards in your graveyard" (The Everflowing Well) claims
 *  "permanents you control", the opposite zone from the one printed.
 *
 *  General to every zone rather than an allow-list of "hand": refusing beats guessing, and a zone
 *  word this doesn't know about is a gap that stays visible instead of a wrong sentence. `life` stays
 *  a separate alternative -- "twenty or more life" names no zone phrase at all. */
const NON_PERMANENT_NOUN = /\bin (?:your|their|a|each|all) [^.]{0,20}(?:hand|graveyard|library|exile)\b|\blife\b/i;

/** WHOSE board the count is of, read from the words that END just before the number. The
 *  controller sits on the wrong side of the number for `parseSubject` to see it -- "you control
 *  three or more artifacts" scrapes the noun "artifacts" and read as `control: any`, so an
 *  OPPONENT's count ("if an opponent controls seven or more lands", Avatar of Fury) was
 *  indistinguishable from yours and would have edged to your own cards. Measured 2026-09-16 on the
 *  88 static/activated clauses that carry a typed count: 218 of 235 derived trigger thresholds read
 *  `any`. */
const COUNT_CONTROLLER = /\b(you|an opponent|each opponent|your opponents|opponents|defending player|each player|a player|that player)\s+controls?\s+(?:at\s+least\s+)?$/i;
/** "five or more Islands ON THE BATTLEFIELD" (Harbor Serpent): a board count with no controller. */
const ON_THE_BATTLEFIELD = /\bon the battlefield\b/i;

/** WHAT the threshold counts. `thresholdFor` returns the number; this returns the noun, and without
 *  it a win condition claims every card in the deck. Revel in Riches counts TREASURES, Hellkite
 *  Tyrant ARTIFACTS, and both derive an untyped subject today.
 *
 *  Reads the words after `selectThreshold`'s winning match and stops at the clause end, so "ten or
 *  more Treasures, you win the game" yields "treasures" and not the whole sentence. Refuses when the
 *  noun is not a countable permanent — a zone-scoped card count (`NON_PERMANENT_NOUN`) or a
 *  self-reference (`mentionsSelf`) is not one, and neither is a noun `parseSubject` cannot type.
 *
 *  A BOARD COUNT OR NOTHING. The matcher judges the subject against a card's PRINTED
 *  characteristics, and that is only a true test of a count of permanents someone controls. An
 *  EVENT count wears the same grammar and is not one: "you've cast three or more spells this turn"
 *  (The Howling Abomination), "attacked with three or more Merfolk this turn" (Deepway Navigator),
 *  "two or more creatures died under your control this turn" (Gimli) -- a Merfolk in the deck does
 *  not satisfy "attacked with three Merfolk" by being one. Nor is an attachment count ("enchanted by
 *  three or more Auras", Ancestral Mask's shape) -- an Aura in the deck is not one on this
 *  creature. So the count must be introduced by `<someone> control(s)` or end `on the battlefield`;
 *  everything else refuses, and stays visible as a gap (CEILING: the attachment counts, 3 corpus). */
export function thresholdSubjectFor(text: string): SubjectFilter | undefined {
  const m = selectThreshold(text);
  if (!m) return undefined;
  const nounMatch = /^\s+([^,.]+)/.exec(text.slice(m.end));
  if (!nounMatch) return undefined;
  const noun = nounMatch[1].trim();
  if (noun === "" || NON_PERMANENT_NOUN.test(noun)) return undefined;
  // Colfenor's Urn: "if three or more cards have been exiled with THIS ARTIFACT" is about the Urn's
  // own exile pile, not a deck-wide class of artifacts -- and unlike a trigger subject field, this
  // noun is scraped from free prose, so the self-reference can sit anywhere in it, not just the head.
  if (mentionsSelf(noun)) return undefined;
  const controller = COUNT_CONTROLLER.exec(text.slice(0, m.start))?.[1]?.toLowerCase();
  if (controller === undefined && !ON_THE_BATTLEFIELD.test(noun)) return undefined;
  const control: SubjectFilter["control"] = controller === undefined || /^(?:each|a|that) player$/.test(controller) ? "any"
    : controller === "you" ? "you" : "opp";
  const subject = parseSubject(noun);
  const hasType = subject.type !== undefined || subject.subtype !== undefined;
  return hasType ? { ...subject, control } : undefined;
}

/** Per-exclusion tallies for `ledger-coverage.ts`'s §8 breakdown. */
export interface ThresholdTally {
  excluded1: number;
  excluded2: number;
  excluded3: number;
  accepted: number;
}

/** The same walk as `thresholdFor`, but visits every qualifying comparison in `text` instead of
 *  stopping at the first one, and tallies which exclusion (if any) it hit into `tally`. Exists so
 *  coverage reporting can show "exclusion 1 refused N, exclusion 2 refused M, ..." without changing
 *  `thresholdFor`'s own signature or first-match-wins behaviour. */
export function tallyThresholds(text: string, tally: ThresholdTally): void {
  if (!CONDITION_CUE.test(text)) return;

  for (const match of text.matchAll(COMPARISON)) {
    const raw = match[1] ?? match[2];
    if (!raw) continue;
    const atLeast = valueOf(raw);
    if (!Number.isFinite(atLeast)) continue;

    if (atLeast <= 1) { tally.excluded1++; continue; }
    if (STAT_SHAPE.test(text.slice(0, match.index))) { tally.excluded2++; continue; }
    const before = text.slice(0, match.index);
    if (/\bThen\b/.test(before) || (before.includes(". ") && !ACTIVATION_RESTRICTION.test(before))) { tally.excluded3++; continue; }
    tally.accepted++;
  }
}
