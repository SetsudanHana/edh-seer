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

/** THE UNDRAWN EDGES A FOCUS BRINGS BACK. The board's top-k budget is a picture cut, not a truth
 *  cut (see `drawnEdges`), and the card dock lists every edge -- so a hover or a selection, which
 *  are both computed over the WHOLE graph, lit partners the board had no line to. Owner-reported
 *  on the Rani deck 2026-09-05: The Rani selected, Doomwake Giant and Grim Guardian ringed, and no
 *  edge between them, because the budget kept Rani's four strongest and those two are implied
 *  `enters:enchantment` at equal weight. A focused card shows every claim the dock shows; the
 *  resting board keeps its budget. `flowPairs` is keyed `from>to`, as `flowEdgeByPair` is. */
export function litUndrawn<L extends { source: { id: string }; target: { id: string } }>(
  undrawn: readonly L[],
  hoveredId: string | null,
  flowPairs: ReadonlySet<string> | ReadonlyMap<string, unknown>,
): L[] {
  return undrawn.filter((l) =>
    flowPairs.has(`${l.source.id}>${l.target.id}`)
    || (hoveredId !== null && (l.source.id === hoveredId || l.target.id === hoveredId)));
}
