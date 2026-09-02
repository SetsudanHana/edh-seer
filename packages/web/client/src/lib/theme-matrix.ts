import type { DeckReport } from "../types.js";

type Group = NonNullable<DeckReport["archetypes"]>[number];

export interface MatrixRow {
  name: string;
  /** One flag per column, in the columns' own order. */
  member: boolean[];
  count: number;
}

export interface ThemeMatrix {
  columns: { category: string; label: string }[];
  /** Cards in at least one group, most-connected first. */
  rows: MatrixRow[];
  /** THE HONEST REGION: cards in no group at all. Names, not a number, because a reader deciding
   *  what to cut needs to know WHICH -- and this is the list a cut conversation starts from. */
  unaffiliated: string[];
}

/** WHICH CARDS BELONG TO WHICH OF THIS DECK'S MECHANISMS, as a matrix.
 *
 *  A MATRIX AND NOT A TREEMAP, and the deck measures the argument rather than the argument being
 *  asserted: on the review deck the six groups claim 152 memberships across 82 nonland cards. A
 *  treemap has to put each card in exactly one cell, so it would have to drop 70 of those
 *  memberships and say nothing about it. Overlap is the fact here, not noise around it.
 *
 *  COLUMN ORDER IS THE ENGINE'S AND IS NEVER RE-SORTED. `archetypes` arrives ranked by pair count
 *  (`mechanisms.ts`), which is what a group CLAIMS rather than what it reaches -- see
 *  `ArchetypeBoard`'s own note that four groups all read "70 cards" while their pair counts ran 334
 *  to 440. Re-sorting here would put this panel and that ranking into disagreement.
 *
 *  ROWS ARE NONLAND, and the caller decides that: this file gets names, not types, so the land rule
 *  stays the one `primaryType` already owns instead of a second copy growing here. */
export function themeMatrix(
  archetypes: DeckReport["archetypes"],
  nonlandNames: readonly string[],
): ThemeMatrix | null {
  const groups: Group[] = archetypes ?? [];
  if (groups.length === 0 || nonlandNames.length === 0) return null;

  const columns = groups.map((g) => ({ category: g.category, label: g.label }));
  const sets = groups.map((g) => new Set(g.cards));

  const all = nonlandNames.map((name) => {
    const member = sets.map((s) => s.has(name));
    return { name, member, count: member.filter(Boolean).length };
  });

  return {
    columns,
    // Most-connected first, name breaking the tie -- the same ordering rule every ranked list in
    // this report uses, so a reader who has learnt it once does not relearn it here.
    rows: all.filter((r) => r.count > 0).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    unaffiliated: all.filter((r) => r.count === 0).map((r) => r.name).sort((a, b) => a.localeCompare(b)),
  };
}
