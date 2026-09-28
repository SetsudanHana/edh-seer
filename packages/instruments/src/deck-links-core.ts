/** THE DECK LINKS, the tested half (owner 2026-09-28: a fix no instrument sees is a case the
 *  instruments lack). Some links exist only in a DECK: a token node (Asinine Antics' Cursed Role
 *  entering feeds Doomwake Giant, #564) or a token another card makes (Summon: Fenrir's land feeds
 *  Fat Chocobo's Bird, #519). The compass runs pairs in isolation and cannot see them, so these are
 *  checked on the deck's own graph. */
export interface DeckLink { from: string; to: string; tag: string }

export function missingLinks(graph: { edges: readonly { from: string; to: string; tags: readonly string[] }[] }, rows: readonly DeckLink[]): DeckLink[] {
  return rows.filter((r) => !graph.edges.some((e) => e.from === r.from && e.to === r.to && e.tags.includes(r.tag)));
}
