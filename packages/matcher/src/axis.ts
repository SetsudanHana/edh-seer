import type { Reason } from "@mtg/engine";

/** The deck's strategy axis as a tag→weight map. Anchored by the commander's theme
 *  tags (weight 1) and widened by dominant deck themes (weight = deckFreq/maxFreq). A
 *  generic commander with no distinctive tags cedes the axis to the deck's themes. */
export function buildAxis(commanderThemeTags: Set<string>, deckFreq: Map<string, number>): Map<string, number> {
  const maxFreq = Math.max(0, ...deckFreq.values());
  const axis = new Map<string, number>();
  for (const tag of new Set<string>([...commanderThemeTags, ...deckFreq.keys()])) {
    const commanderWeight = commanderThemeTags.has(tag) ? 1 : 0;
    const themeWeight = maxFreq > 0 ? (deckFreq.get(tag) ?? 0) / maxFreq : 0;
    const w = Math.max(commanderWeight, themeWeight);
    if (w > 0) axis.set(tag, w);
  }
  return axis;
}

/** Multiplier for an edge's contribution: 1 when the edge touches nothing on-axis,
 *  up to 1+boost when a reason is fully on-axis. Uses the strongest on-axis reason. */
export function axisFactor(reasons: Reason[], axis: Map<string, number>, boost: number): number {
  let maxW = 0;
  for (const r of reasons) {
    const w = axis.get(r.tag) ?? 0;
    if (w > maxW) maxW = w;
  }
  return 1 + boost * maxW;
}
