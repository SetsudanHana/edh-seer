import type { DeckReport } from "../types.js";

/** THE CARDS THAT FIT NO THEME, SPLIT INTO THOSE A SLOT CAN COME FROM AND THOSE IT CANNOT.
 *
 *  Persona round 2026-09-29 (first-cuts): 8 over, 7 cuts, and the eighth found by hand in "Fits no
 *  theme", skipping the removal and protection. `free` is the cards that fit no theme, are neither
 *  interaction nor protection, and fill no role that is at or under its target -- Arcane Signet in a
 *  deck with Ramp at exactly 11 of 11 opens the gap the cut was meant to avoid. `held` is the rest,
 *  in input order. #1085: the "Fits no theme" line listed Sol Ring, Arcane Signet and Patriar's Seal
 *  on exactly that deck, and used to carry a hand-written "unless removal or protection" caveat;
 *  this filter now does that job, so the line lists `free` only. */
export function offThemeSplit(
  offTheme: readonly string[],
  report: Pick<DeckReport, "cards" | "slack" | "buildParents">,
): { free: string[]; held: string[] } {
  const keep = new Set(["targetedRemoval", "stackInteraction", "boardWipe", "graveyardHate", "protection"]);
  const spare = new Set((report.slack ?? []).flatMap((s) => report.buildParents?.find((p) => p.name === s.category)?.leaves ?? [s.category]));
  // Only a role WITH a target can be at or under it: stax and burn are in no parent (#1085).
  const targeted = new Set((report.buildParents ?? []).flatMap((p) => p.leaves));
  const guarded = new Set(report.cards
    .filter((r) => r.roles?.some((x) => keep.has(x) || (x !== "lands" && targeted.has(x) && !spare.has(x))))
    .map((r) => r.cardName ?? r.name));
  const free: string[] = [];
  const held: string[] = [];
  for (const n of offTheme) (guarded.has(n) ? held : free).push(n);
  return { free, held };
}
