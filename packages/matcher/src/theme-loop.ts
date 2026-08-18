import type { ThemeMembership } from "./themes.js";

/** RANK A THEME BY THE LOOP IT CLOSES, NOT BY HOW OFTEN ITS WORDS APPEAR.
 *
 *  Owner's argument, 2026-08-19: "if you are really a tribal deck you also have consumers that
 *  benefit of given tribe." A deck that merely PLAYS creatures supplies `enters:creature` from
 *  every creature's implied entry and pays off none of it; a Wizards deck supplies wizards AND runs
 *  cards that trigger on one entering. Both sides authored is what makes a plan.
 *
 *  `themeMembership` already draws that line and nothing read it for ranking: `surplus` is the
 *  cards whose AUTHORED text supplies the event, `baseline` the implied producers (a creature
 *  entering because it is a creature), `payoffs` the cards that trigger on it. So the universal
 *  bucket that defeated family-grouped ranking — `enters:creature`, biggest family in nearly every
 *  EDH deck (`specs/2026-08-19-theme-family-ranking-design.md` §6) — is mostly BASELINE here, and
 *  scores near zero without any fold, any threshold, or any corpus statistic.
 *
 *  `min` and not a product: a theme needs BOTH sides, and one side of forty against another of one
 *  is a single payoff with a lot of noise, not a bigger plan than two against two. The minimum says
 *  exactly that and cannot be gamed by piling on one side.
 *
 *  SUPPLY IS `surplus + baseline`, AND THE FIRST CUT GOT THAT WRONG — MEASURED. Counting only the
 *  AUTHORED surplus reads a Dragon deck's `enters:dragon` as a tiny loop, because a Dragon entering
 *  is an IMPLIED producer and lands in `baseline`: for a tribal theme the supply IS the deck's own
 *  creatures. Meanwhile `enters:creature` collects real authored surplus from token makers and
 *  blink effects, so the universal bucket won again — modal headline 16 → 21 of 71 and subtype
 *  primaries 6 → 1, worse than doing nothing. The payoff side stays the gate (a tag with no
 *  consumers closes no loop and cannot rank at all), which is the owner's argument: "if you are
 *  really a tribal deck you also have consumers that benefit of given tribe." */
export function rankThemesByLoop(
  membership: readonly ThemeMembership[],
  tfidf: ReadonlyMap<string, number>,
): string[] {
  return membership
    .map((m) => ({ tag: m.tag, loop: Math.min(m.surplus.length + m.baseline.length, m.payoffs.length) }))
    .filter((r) => r.loop > 0)
    .sort((a, b) =>
      b.loop - a.loop
      // A tie on loop size is broken by the OLD ranking, which is the right thing for it to decide:
      // between two closed loops of equal size, the rarer and denser one is the better headline.
      || (tfidf.get(b.tag) ?? 0) - (tfidf.get(a.tag) ?? 0)
      || a.tag.localeCompare(b.tag))
    .map((r) => r.tag);
}
