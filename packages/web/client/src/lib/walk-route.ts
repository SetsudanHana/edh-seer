/** THE GOLD ROUTE FOLLOWS REAL LINKS (owner, 2026-09-28, #769: a tap on Wicked Role with The Rani
 *  in the middle drew one straight dotted line between two cards that are not linked, through cards
 *  it does not touch). A walk's route is a list of cards in which each one is linked to the next;
 *  a step to a card the middle doesn't reach goes the shortest way through the links there, hop by
 *  hop, and every card on the way joins the route. */

/** The shortest path from `from` to `to` along `links`, both ends included, or null when no chain of
 *  links joins them. Breadth-first, so ties go to the link met first. */
export function shortestPath(from: string, to: string, links: (id: string) => Iterable<string>): string[] | null {
  if (from === to) return [from];
  const came = new Map<string, string>([[from, from]]);
  let ring = [from];
  while (ring.length) {
    const next: string[] = [];
    for (const id of ring) {
      for (const n of links(id)) {
        if (came.has(n)) continue;
        came.set(n, id);
        if (n === to) {
          const path = [to];
          for (let at = id; at !== from; at = came.get(at)!) path.push(at);
          path.push(from);
          return path.reverse();
        }
        next.push(n);
      }
    }
    ring = next;
  }
  return null;
}

/** The route after the middle moves from `from` to `to`. `trail` is the route before, without the
 *  middle; the result is the route after, without the new middle, at most `cap` cards long.
 *
 *  - A card already on the route is a step back to it: the route is cut there.
 *  - Any other card is a step on, through the cards on the shortest path to it. A path that crosses
 *    the route loops back on itself, and the loop is cut out, so the route never holds a card twice
 *    and each card is still linked to the next.
 *  - A card no chain of links reaches (a search, a card page's own link) is not a step: the route
 *    starts again from it.
 *  - Past the cap the oldest cards drop off the front, which leaves every remaining step a link. */
export function stepRoute(trail: readonly string[], from: string, to: string, links: (id: string) => Iterable<string>, cap = 6): string[] {
  const back = trail.indexOf(to);
  if (back >= 0) return trail.slice(0, back);
  const path = shortestPath(from, to, links);
  if (!path) return [];
  const out: string[] = [];
  for (const id of [...trail, ...path.slice(0, -1)]) {
    const i = out.indexOf(id);
    if (i >= 0) out.length = i;
    out.push(id);
  }
  return out.slice(-cap);
}
