/** WHERE A CLAUSE'S EVENT ROW JUMPS TO (roadmap AJ4, spec C5): the partner group already rendered
 *  further down the same page.
 *
 *  A PLAIN ANCHOR, not an in-place filter. Anchors work with JavaScript off, which the prerendered
 *  page needs, and they hold no state to get wrong on a phone.
 *
 *  ONE FUNCTION, BOTH READERS. The React page writes the link and the prerendered HTML writes the
 *  target -- or the other way round on a crawler -- so a second spelling of this id is a link that
 *  goes nowhere in exactly one of the two. The event key carries `|`, `:` and commas; an id may
 *  not, so everything outside a-z0-9 folds to a dash. */
export const groupAnchor = (event: string): string =>
  `event-${event.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
