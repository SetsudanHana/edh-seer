/** TWO QUESTIONS ABOUT "IS THIS CARD A LAND", AND THEY ARE NOT THE SAME (#1167). Fifteen modules each
 *  carried their own test with three different readings -- the whole `//` line (Build), the front
 *  face (goldfish, deck rules) -- so 33 transform/flip cards with a land only on the back (Treasure
 *  Map, Growing Rites of Itlimoc, ...) were lands in Build and spells in the goldfish. Now there
 *  are exactly two predicates, each with one meaning:
 *
 *  - `isLandCard`: the RULES question. A card in a library, hand or any zone other than the
 *    battlefield or stack has only its front face's characteristics (CR 712.8a), whatever the
 *    layout. A `Sorcery // Land` modal DFC is a NONLAND card to Keruga, Lutri and the other
 *    companions. For deck-construction rules.
 *  - `countsAsLand`: the DECK-BUILDING count (owner ruling 2026-08-31). A modal DFC with a land
 *    face counts as a land -- you really can play that side -- everything else is its front face.
 *    For land counts, the mana model and Build.
 *
 *  Neither is "has a land face anywhere": that is a graph label, see `wire-graph.ts`.
 *
 *  Lives in `@edh-seer/engine` because the engine's own deck stats need it and cannot import the
 *  matcher; `@edh-seer/matcher/typeline` re-exports both, which is where callers import from. */
type LandProbe = { typeLine?: string; layout?: string };

const frontLine = (card: LandProbe): string => (card.typeLine ?? "").split("//")[0]!;

export function isLandCard(card: LandProbe): boolean {
  return /\bland\b/i.test(frontLine(card));
}

export function countsAsLand(card: LandProbe): boolean {
  return card.layout === "modal_dfc" ? /\bland\b/i.test(card.typeLine ?? "") : isLandCard(card);
}

/** A transform or flip card whose back is a land (owner ruling 2026-10-10, #1174: "things that do
 *  transform are not ramp"). It is a spell by both predicates above, and it is never ramp: not its
 *  land back's mana ability, not its front's Treasures on transforming. An adventure or split half
 *  is cast from hand and a modal DFC's back is playable, so neither is one. */
export function transformsIntoLand(card: LandProbe): boolean {
  return (card.layout === "transform" || card.layout === "flip")
    && (card.typeLine ?? "").split("//").slice(1).some((b) => /\bland\b/i.test(b));
}
