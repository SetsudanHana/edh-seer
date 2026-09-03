/** A deck split the way `parseDecklistSections` splits a pasted list, so an imported deck and a
 *  pasted one are the same thing by the time anything downstream sees them. Names repeat by
 *  quantity: four Forests are four entries. */
export interface DeckSections {
  commanders: string[];
  deck: string[];
}

export type FetchFn = typeof fetch;

interface MoxfieldEntry {
  quantity?: unknown;
  card?: { name?: unknown };
}
interface MoxfieldBoard {
  cards?: Record<string, MoxfieldEntry>;
}
interface MoxfieldDeck {
  boards?: Record<string, MoxfieldBoard | undefined>;
}

export function parseMoxfieldId(input: string): string | null {
  const m = input.match(/moxfield\.com\/decks\/([\w-]+)/i);
  if (m) return m[1];
  if (/^[\w-]+$/.test(input)) return input;
  return null;
}

/** Copy count, clamped exactly as `sections.ts` clamps a pasted line. Same untrusted input, same
 *  bound: a deck claiming `quantity: 1e9` allocates a billion strings otherwise. */
function quantityOf(entry: MoxfieldEntry): number {
  const raw = typeof entry.quantity === "number" ? entry.quantity : 1;
  return Math.min(100, Math.max(1, Math.floor(raw)));
}

function namesFromBoard(board: MoxfieldBoard | undefined, boardName: string): string[] {
  const out: string[] = [];
  for (const [key, entry] of Object.entries(board?.cards ?? {})) {
    const name = entry?.card?.name;
    // THE KEY IS NOT THE NAME. In v2 the map was keyed by card name; in v3 it is keyed by
    // `uniqueCardId` ("Egj3v"), and the previous version of this file returned those keys as card
    // names -- 75 unresolvable strings, no error, no missing-card warning that meant anything.
    // Refusing here is the difference between a broken import and a silently wrong deck.
    if (typeof name !== "string" || name === "") {
      throw new Error(`Moxfield response shape changed: ${boardName}.${key} has no card.name`);
    }
    for (let i = 0; i < quantityOf(entry); i++) out.push(name);
  }
  return out;
}

/** v3 carries twelve boards. Two are the deck; the rest are not, and taking them all would import
 *  a maybeboard as if the player had built it. `attractions`, `contraptions`, `planes`, `schemes`,
 *  `stickers` and `signatureSpells` cannot legally appear in an EDH decklist at all. `companions`
 *  and `sideboard` sit outside the 100, and `tokens` are nodes this engine derives itself. */
export function moxfieldDeckToSections(json: unknown): DeckSections {
  const boards = (json as MoxfieldDeck | null)?.boards;
  if (!boards || typeof boards !== "object" || !boards.mainboard) {
    throw new Error("Moxfield response shape changed: no boards.mainboard");
  }
  return {
    commanders: namesFromBoard(boards.commanders, "commanders"),
    deck: namesFromBoard(boards.mainboard, "mainboard"),
  };
}

/** `userAgent` has no default ON PURPOSE. Moxfield issues a per-consumer User-Agent and the terms
 *  attached to ours are a named, permanent ban if we misbehave; a default would let a fresh clone
 *  fire anonymous traffic under our IP and burn a string we cannot get back. Absent = refuse. */
export async function fetchMoxfieldDeck(
  id: string,
  userAgent: string,
  fetchImpl: FetchFn = fetch,
): Promise<DeckSections> {
  if (!userAgent?.trim()) {
    throw new Error("MOXFIELD_UA is required to fetch a Moxfield deck; refusing to send an unidentified request");
  }
  const res = await fetchImpl(
    `https://api2.moxfield.com/v3/decks/all/${encodeURIComponent(id)}`,
    { headers: { "User-Agent": userAgent, Accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`Moxfield fetch failed: ${res.status}`);
  return moxfieldDeckToSections(await res.json());
}
