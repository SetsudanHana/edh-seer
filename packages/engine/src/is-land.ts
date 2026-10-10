/** ONE ANSWER TO "IS THIS CARD A LAND IN THE DECK" (#1167). Fifteen modules each carried their own
 *  test with three different readings -- the whole `//` line (Build), the front face (goldfish, deck
 *  rules) -- so 33 transform/flip cards with a land only on the back (Treasure Map, Growing Rites of
 *  Itlimoc, ...) were lands in Build and spells in the goldfish.
 *
 *  A MODAL DFC counts if EITHER face is a land: you really can play that side (owner 2026-08-31).
 *  Every other layout is its FRONT face: a transform or flip card's land back is reached by
 *  transforming a permanent already in play (CR 712.8a: a card in hand is its front face), and a
 *  split or adventure card's other half is not a land. Deliberately not "has a land face anywhere" --
 *  that is a graph label, see `wire-graph.ts`.
 *
 *  Lives in `@edh-seer/engine` because the engine's own deck stats need it and cannot import the
 *  matcher; `@edh-seer/matcher/typeline` re-exports it, which is where callers import it from. */
export function isLand(card: { typeLine?: string; layout?: string }): boolean {
  const line = card.typeLine ?? "";
  const played = card.layout === "modal_dfc" ? line : line.split("//")[0]!;
  return /\bland\b/i.test(played);
}
