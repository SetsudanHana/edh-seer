import type { DeckReport, GraphNode } from "../types.js";
import { TYPE_ORDER, primaryType } from "./deck-shape.js";
import { isUnread } from "./unread.js";

/** One square of the deck waffle: one COPY of one physical card. */
export interface WaffleSquare {
  /** The physical card. Repeated across a card's copies -- the key is the index, not this. */
  name: string;
  /** Its composition type, or `null` for a land. Lands are not a slice (`primaryType`): they are
   *  ~38% of a Commander deck and would drown the composition question, and the owner already
   *  ruled that deck statistics run over nonlands. The waffle keeps that ruling by giving a land a
   *  neutral square instead of adding a seventh hue to `TYPE_SEGMENT_HUE`. */
  type: string | null;
  /** WHICH OF THE TWO FAILURES THIS IS, and they are not the same one. `unresolved` never reached
   *  the corpus at all and is usually a typo; `unread` resolved and carries no derived tags, so it
   *  forms no edge and reaches no theme. Only the first is something a reader can fix by editing
   *  the list. */
  state: "read" | "unread" | "unresolved";
  isCommander: boolean;
}

/** THE DECK AS ONE SQUARE PER CARD -- the census, the coverage and the unresolved list as a single
 *  picture the reader can COUNT.
 *
 *  ONE SQUARE PER COPY, and that is the whole conceit: a hundred squares for a hundred cards, so
 *  the grid is the deck's real size and a player's 24 Mountains are 24 squares. A node is one
 *  DISTINCT card (`copies` carries the rest), which is right for a graph and wrong for a picture
 *  of a deck.
 *
 *  ONE SQUARE PER PHYSICAL CARD, NOT PER FACE. A multi-face card is one node per printed face
 *  (faces-as-nodes, task 7) and the front face decides the type -- the same basis `typeSlices`
 *  counts it under, so the waffle and the census cannot disagree. Counting both faces is the
 *  "2 of the 1 unread" defect this repo has now fixed in four separate files.
 *
 *  GROUPED, because a hundred ungrouped squares is noise rather than a census: commander first (it
 *  is the recognition anchor -- the first thing an EDH player checks to see whether the tool read
 *  their deck), then `TYPE_ORDER`, then lands, then the names that never resolved. */
export function waffleSquares(
  nodes: readonly GraphNode[],
  cards: DeckReport["cards"],
  missing: readonly string[],
): WaffleSquare[] {
  const commanders = new Set(cards.filter((c) => c.isCommander).map((c) => c.cardName ?? c.name));
  const unread = new Set(cards.filter(isUnread).map((c) => c.cardName ?? c.name));

  // The FRONT face survives, exactly as `CardList`'s unread grid resolves the same collision: a
  // back face's id is `face:<n>:<name>`, and its own `face` field is what marks it.
  const physical = nodes.filter((n) => n.face === undefined && n.isToken !== true);

  const cardSquares = physical.map((n) => ({
    name: n.cardName ?? n.id,
    type: primaryType(n.types),
    copies: n.copies ?? 1,
  }));

  // Commander first, then TYPE_ORDER, then lands. `indexOf` on a six-element literal is not worth
  // a lookup map, and the order has to be stated somewhere a reader can see it.
  const rank = (s: { name: string; type: string | null }): number =>
    commanders.has(s.name) ? -1 : s.type === null ? TYPE_ORDER.length : TYPE_ORDER.indexOf(s.type as never);

  const ordered = cardSquares
    .slice()
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

  const squares: WaffleSquare[] = [];
  for (const s of ordered) {
    for (let i = 0; i < s.copies; i++) {
      squares.push({
        name: s.name,
        type: s.type,
        state: unread.has(s.name) ? "unread" : "read",
        // ONLY THE FIRST COPY IS THE COMMANDER'S SQUARE. A commander is a singleton in practice,
        // but the flag drives a 2x2 span in the view and two of them would break the grid.
        isCommander: commanders.has(s.name) && i === 0,
      });
    }
  }
  // LAST, ALWAYS: a name that never resolved has no type and no copies to expand, and putting it
  // anywhere but the end would mean sorting a card by a fact it does not have.
  for (const name of missing) {
    squares.push({ name, type: null, state: "unresolved", isCommander: false });
  }
  return squares;
}
