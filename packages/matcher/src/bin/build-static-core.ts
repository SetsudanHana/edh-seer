export interface StaticCombo { cards: string[]; result: string }

/** The alphabetically-first card of a combo. A combo is contained in a deck only if EVERY one of
 *  its cards is present, so it can only match when its anchor is present — which makes indexing by
 *  the anchor EXACT rather than a heuristic, and puts each combo in exactly one bucket. */
export function anchorOf(comboCards: string[]): string {
  return [...comboCards].sort()[0];
}

export function comboIndex(combos: StaticCombo[]): Map<string, StaticCombo[]> {
  const out = new Map<string, StaticCombo[]>();
  for (const c of combos) {
    const a = anchorOf(c.cards);
    const bucket = out.get(a);
    if (bucket) bucket.push({ cards: c.cards, result: c.result });
    else out.set(a, [{ cards: c.cards, result: c.result }]);
  }
  return out;
}

/** ONE PATH SEGMENT, ALWAYS. A split card's normalized name contains `//`, which would write
 *  outside the output directory; `encodeURIComponent` escapes the separator and is also exactly
 *  what the client's `fetch` URL needs, so the two sides cannot disagree about the rule. */
export function cardFileName(normalizedName: string): string {
  return encodeURIComponent(normalizedName);
}
