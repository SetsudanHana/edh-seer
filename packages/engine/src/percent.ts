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
