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

/** A threshold conditions a trigger. Without a cue the number is a magnitude, which is
 *  `Ability.amount`'s business. */
const CONDITION_CUE = /\b(?:if|when there are|whenever|as long as|only if)\b/i;

/** A stat comparison is ALREADY `SubjectFilter.stats`, which `Reason.hasStatPredicate` already
 *  reads. Two slots claiming one fact is the collision `notType` and `umbrella` were introduced to
 *  prevent. Anchored to the words immediately before the number so "power 4 or greater" is caught
 *  while "four or more lands" in a sentence that mentions power elsewhere is not. 29 corpus
 *  matches. */
const STAT_SHAPE = /\b(?:power|toughness|mana value|life total)\b[^.]{0,25}$/i;

function valueOf(raw: string): number {
  const word = WORD_NUMBER[raw.toLowerCase()];
  return word ?? Number(raw.replace(/,/g, ""));
}

/** The trigger threshold stated by `text`, or `undefined` when it states none.
 *
 *  Refuses rather than guesses, as `repeatsFor` does: an unrecognised numeric condition leaves the
 *  field unset and stays visible as a gap. */
export function thresholdFor(text: string): { atLeast: number } | undefined {
  if (!CONDITION_CUE.test(text)) return undefined;

  for (const match of text.matchAll(COMPARISON)) {
    const raw = match[1] ?? match[2];
    if (!raw) continue;
    const atLeast = valueOf(raw);
    if (!Number.isFinite(atLeast)) continue;

    // EXCLUSION 1: "one or more" is an English plural meaning "any", not a counted condition.
    // Emitting atLeast:1 would be a wrong sentence dressed as data. 98 of 208 corpus matches.
    if (atLeast <= 1) continue;

    // EXCLUSION 2: a stat comparison is SubjectFilter.stats' fact, not this one.
    if (STAT_SHAPE.test(text.slice(0, match.index))) continue;

    return { atLeast };
  }
  return undefined;
}
