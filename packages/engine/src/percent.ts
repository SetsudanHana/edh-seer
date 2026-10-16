/** ONE RENDERER FOR A PROBABILITY, because two copies is how two surfaces start disagreeing — which
 *  is exactly what happened here (roadmap N6). The CLI floored a probability at 1% and the web
 *  `CardList` did not, so the same measured-impossible cast read "1%" in one surface and "0%" in the
 *  other.
 *
 *  A MEASURED ZERO IS A MEASUREMENT AND PRINTS 0%. The floor exists so a real chance never reads as
 *  "cannot happen"; a model that cannot price a card REFUSES, and a refusal prints an em dash. So
 *  the two cases are separated rather than conflated: exactly zero prints `0%`, and anything that
 *  merely rounds to zero prints `<1%` — flooring it to "1%" overstates a one-in-a-thousand chance
 *  two hundred fold.
 *
 *  Node and browser alike: pure arithmetic, no imports, its own subpath so the client never pulls the
 *  barrel (which readFileSync's its tag weights at module load). */
export function percent(p: number): string {
  if (p <= 0) return "0%";
  const rounded = Math.round(p * 100);
  return rounded === 0 ? "<1%" : `${rounded}%`;
}

/** A policy interval, collapsed to ONE figure when the two ends render the same — "62% – 62%" reads
 *  as a broken range, and a range whose ends round alike IS one figure. */
export function band(low: number, high: number): string {
  const l = percent(low), h = percent(high);
  return l === h ? l : `${l} – ${h}`;
}

/** How far apart the two play policies must sit before a reader is shown BOTH (owner's call,
 *  2026-08-26). The interval is the PLAY POLICY and never an error bar — the low end holds up two
 *  mana before casting an accelerant, the high end spends everything on acceleration and is a ceiling
 *  no real deck plays to.
 *
 *  MEASURED over the 71 decks at the headline cell: width min 0.1 · median 6.5 · p75 8.9 · p90 14.5 ·
 *  MAX 36.1pp, and 22 of 71 decks are wider than this threshold. So most decks were being told the
 *  same thing twice, while `iz-it-izzet` genuinely reads 30% – 67% and no single number can stand for
 *  it. The same shape `castability.ts` ships for its mana-versus-colour line, whose own rule reads
 *  "below it the second number says the same thing twice". */
export const POLICY_COLLAPSE = 0.08;

/** A policy interval, collapsed to the CONSERVATIVE end when the policy barely matters.
 *
 *  THE LOW END IS THE ONE THAT SURVIVES, because it holds up two mana and that is nearer how a deck
 *  is really played; collapsing to the ceiling would print a figure no real deck reaches. AVERAGING
 *  THE TWO IS REFUSED: on `iz-it-izzet` the midpoint is 48%, a value neither policy ever produces —
 *  a number about no game. */
export function policyBand(low: number, high: number): string {
  return high - low < POLICY_COLLAPSE ? percent(low) : band(low, high);
}

/** WHEN A POLICY INTERVAL IS SHOWN AS A RANGE, and the only place that decides it, so `policyBand`
 *  and the words that name its ends cannot disagree about whether there are two ends. */
export function isPolicyRange(low: number, high: number): boolean {
  return high - low >= POLICY_COLLAPSE;
}

/** WHICH END IS WHICH, in one set of words for every surface (persona rounds 2026-10-14..15: every
 *  seat asked which end applies to their game). Short on purpose; the figures come from the caller.
 *  The low end is nearer real play; the high end is a ceiling. */
export const POLICY_LOW_WORDS = "if you hold up two mana";
export const POLICY_HIGH_WORDS = "if you spend it all on ramp";

/** "34% if you hold up two mana, 53% if you spend it all on ramp" -- or "" when the interval collapsed
 *  to one figure, because a single figure has no ends to name. Never averages the two. */
export function policyEnds(low: number, high: number): string {
  return isPolicyRange(low, high)
    ? `${percent(low)} ${POLICY_LOW_WORDS}, ${percent(high)} ${POLICY_HIGH_WORDS}`
    : "";
}

/** The once-per-block legend for a compact surface (a table of ranges) where per-cell words do not
 *  fit. Says what each end is and what moves a game between them. */
export const POLICY_LEGEND =
  "Where a figure is a range, the low end holds up two mana before casting ramp, which is nearer how a real deck is played, "
  + "and the high end spends everything on ramp, a ceiling. Your own games fall between the two.";
