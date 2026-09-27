/** COMMANDER PRECONS FROM MTGJSON (owner, 2026-09-27: "making pages for precons, cause those do not
 *  change"). MTGJSON publishes every preconstructed deck: `DeckList.json` names them, one file per
 *  deck holds its cards, and `SetList.json` names the sets. This is the pure half -- no network,
 *  no disk -- so the parse is testable; `bin/ingest-precons.ts` does the fetching.
 *
 *  ONLY WHAT A DECK PAGE NEEDS, AND NOTHING PRICED: the deck's name, its set and date, its
 *  commanders and its cards by name and count. */

/** One entry of MTGJSON's `DeckList.json` `data`. */
export interface MtgjsonDeckListEntry { code: string; fileName: string; name: string; releaseDate: string | null; type: string }
/** One entry of MTGJSON's `SetList.json` `data`, the fields read here. */
export interface MtgjsonSetEntry { code: string; name: string }
/** A card in a deck file (`CardDeck`), the fields read here. */
export interface MtgjsonDeckCard { name: string; count: number }
/** A deck file's `data`, the fields read here. */
export interface MtgjsonDeck {
  code: string; name: string; releaseDate: string | null; type: string;
  commander?: MtgjsonDeckCard[]; mainBoard?: MtgjsonDeckCard[];
}

export interface Precon {
  name: string;
  /** MTGJSON's deck file name, unique per deck: the stable key a re-run updates. */
  fileName: string;
  setCode: string;
  setName: string;
  /** `YYYY-MM-DD`, or null where MTGJSON has none. */
  releaseDate: string | null;
  commanders: string[];
  /** Every card but the commanders, by name, with its count; sorted by name. */
  cards: { name: string; count: number }[];
}

/** A deck file name MTGJSON publishes (`PartyTime_CLB`): letters, digits, `_` and `-`. Anything
 *  else from the list is not used, because the name becomes both a URL and a file on disk. */
export const SAFE_FILE_NAME = /^[A-Za-z0-9_-]{1,120}$/;

/** MTGJSON's own deck type for a Commander precon. */
export const COMMANDER_DECK = "Commander Deck";

/** The Commander precons in a deck list, oldest first, ties by name. */
export function commanderDecks(list: readonly MtgjsonDeckListEntry[]): MtgjsonDeckListEntry[] {
  return list.filter((d) => d.type === COMMANDER_DECK && SAFE_FILE_NAME.test(d.fileName))
    .sort((a, b) => (a.releaseDate ?? "").localeCompare(b.releaseDate ?? "") || a.name.localeCompare(b.name));
}

/** A deck file as a `Precon`, or null when it has no commander (a deck we cannot page). Counts of
 *  the same name add up: MTGJSON lists a foil and a non-foil printing of a card apart. */
export function preconOf(entry: MtgjsonDeckListEntry, deck: MtgjsonDeck, sets: ReadonlyMap<string, string>): Precon | null {
  const commanders = [...new Set((deck.commander ?? []).map((c) => c.name))];
  if (commanders.length === 0) return null;
  const counts = new Map<string, number>();
  for (const c of deck.mainBoard ?? []) {
    if (commanders.includes(c.name)) continue;
    counts.set(c.name, (counts.get(c.name) ?? 0) + c.count);
  }
  return {
    name: deck.name || entry.name,
    fileName: entry.fileName,
    setCode: entry.code,
    setName: sets.get(entry.code.toUpperCase()) ?? entry.code,
    releaseDate: deck.releaseDate ?? entry.releaseDate,
    commanders,
    cards: [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** The decklist a report reads: the commanders first, marked as such, then every card. */
export function preconDecklist(p: Precon): string {
  return ["Commander", ...p.commanders.map((c) => `1 ${c}`), "", "Deck", ...p.cards.map((c) => `${c.count} ${c.name}`)].join("\n");
}
