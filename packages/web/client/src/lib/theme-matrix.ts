import type { DeckReport } from "../types.js";

type Group = NonNullable<DeckReport["archetypes"]>[number];

/** What a dot in this cell is CLAIMING.
 *
 *  `earned` — the card does something the group is about: it consumes the group's event (an
 *  authored trigger or static), or it produces the event through an authored effect.
 *  `implied` — the card's supply of the event was SYNTHESISED (`Reason.impliedProducer`): it
 *  supplies merely by existing, because any nonland is cast and any permanent enters. */
export type Membership = "earned" | "implied" | null;

export interface MatrixRow {
  name: string;
  /** One state per column, in the columns' own order. */
  cells: Membership[];
  /** Memberships the card earned. Rows rank on this, not on `count`. */
  earned: number;
  /** Every membership, earned or implied. */
  count: number;
}

export interface ThemeMatrix {
  /** ONE DEFINITION OF "IN THIS GROUP", AND IT LIVES HERE (T15). `ArchetypeBoard` ranked and sized
   *  its groups on `cards.length`, which counts a card that joined by being played -- every nonland
   *  is cast, every permanent enters -- so on an Enchantress deck `Spellslinger` read 61 of 99 cards
   *  and led the panel. `earned` is the same split this grid already ranks its rows on. */
  columns: {
    category: string;
    label: string;
    /** Cards that DO something about this group: the consumer side, or a producer the card really
     *  authored rather than the synthesised baseline. */
    earned: number;
    /** Every member, earned or implied. `cards.length` restricted to nonlands. */
    total: number;
  }[];
  /** Cards in at least one group, most-connected first. */
  rows: MatrixRow[];
  /** THE HONEST REGION: cards in no group at all. Names, not a number, because a reader deciding
   *  what to cut needs to know WHICH -- and this is the list a cut conversation starts from. */
  unaffiliated: string[];
  /** Totals over the whole grid, for the sentence above it. */
  earnedTotal: number;
  impliedTotal: number;
}

/** A REASON NAMES THE PHYSICAL CARD; A GROUP'S `cards` NAME THE FACE. Measured on the example deck:
 *  `groupEdgesByArchetype` fills `cards` from `edge.a`/`edge.b` ("Fable of the Mirror-Breaker")
 *  while the reasons under the same edge say `producer: "Fable of the Mirror-Breaker // Reflection
 *  of Kiki-Jiki"`. Joining on the name alone left EVERY multi-face card unattributable -- 8 of 61
 *  in Spellslinger, 8 of 62 in Tokens Go Wide -- and they would have defaulted silently to whatever
 *  the classifier's else-branch was. This is the twelfth site of the join the 2026-08-27 wave fixed
 *  in eleven others -- and the THIRTEENTH was this same file, because the split was applied when
 *  building `earnedSets` and not when testing membership, so every `//` card read as being in no
 *  group at all (AL3, 2026-09-20). Both directions are joined here now: a name is matched on any of
 *  its faces, and the columns count the cells rather than asking the sets again. */
const facesOf = (name: string): string[] => (name.includes(" // ") ? [name, ...name.split(" // ")] : [name]);

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

  const sets = groups.map((g) => new Set(g.cards));
  // WHICH SIDE OF THE PAIR THE CARD WAS. A consumer CARES about the event -- an authored trigger or
  // static -- so it always earned its place. A producer earned it only when the supply was
  // authored; `impliedProducer` marks the synthesised baseline the matcher adds so that "any
  // nonland is cast" and "any permanent enters" can feed a payoff at all.
  const earnedSets = groups.map((g) => {
    const earned = new Set<string>();
    for (const p of g.pairs) {
      for (const r of p.reasons) {
        if (r.consumer) for (const n of facesOf(r.consumer)) earned.add(n);
        if (r.producer && !r.impliedProducer) for (const n of facesOf(r.producer)) earned.add(n);
      }
    }
    return earned;
  });

  const all = nonlandNames.map((name) => {
    // THE SAME SPLIT, ON THE ROW SIDE (AL3). A row name comes from the graph's whole-card nodes, so
    // a multi-face card arrives JOINED while a group's `cards` hold the FACE -- the mirror of the
    // case `facesOf` was written for, and the site it was not applied to.
    const faces = facesOf(name);
    const cells: Membership[] = sets.map((s, i) =>
      !faces.some((f) => s.has(f)) ? null
        : faces.some((f) => earnedSets[i]!.has(f)) ? "earned" : "implied");
    return {
      name,
      cells,
      earned: cells.filter((c) => c === "earned").length,
      count: cells.filter((c) => c !== null).length,
    };
  });

  return {
    // Counted over the NONLAND rows, so the figure matches the grid a reader is looking at rather
    // than a group's raw `cards`, which can name a land.
    columns: groups.map((g, i) => ({
      category: g.category,
      label: g.label,
      // COUNTED OFF THE CELLS THE GRID ALREADY DREW, not by asking the sets a second time. The
      // second ask was a second copy of the face join, and it went stale while the first was fixed.
      earned: all.filter((r) => r.cells[i] === "earned").length,
      total: all.filter((r) => r.cells[i] !== null).length,
    })),
    // EARNED FIRST, and that is a change of meaning rather than of taste. Ranking on total
    // memberships put `Mystic Remora` -- implied in all seven of its groups, earning none of them
    // -- above cards doing three things on purpose. What a reader is looking for at the top of this
    // grid is the cards the deck is built on, which is the earned count.
    rows: all.filter((r) => r.count > 0)
      .sort((a, b) => b.earned - a.earned || b.count - a.count || a.name.localeCompare(b.name)),
    unaffiliated: all.filter((r) => r.count === 0).map((r) => r.name).sort((a, b) => a.localeCompare(b)),
    earnedTotal: all.reduce((s, r) => s + r.earned, 0),
    impliedTotal: all.reduce((s, r) => s + (r.count - r.earned), 0),
  };
}
