/** THE BOARD DRAWS THE DRAWN SET; EVERYTHING ELSE READS THE WHOLE GRAPH.
 *
 *  `projectDeckGraph` returns every card-pair edge and marks the top-k union `drawn` (2026-09-05).
 *  Before that it RETURNED only the union, so the drawer, the pair list and the count all
 *  inherited the board's thinning: on the Rani deck Grim Guardian had 34 producers and the drawer
 *  said "Fed by 0 -- None", because a per-node budget over equal-weight edges keeps none of them.
 *  This is the one filter the force layout applies; no list or count goes through it.
 *
 *  An edge with no `drawn` field is drawn: graphs written before the flag were already thinned. */
export function drawnEdges<E extends { drawn?: boolean }>(edges: readonly E[]): E[] {
  return edges.filter((e) => e.drawn !== false);
}
