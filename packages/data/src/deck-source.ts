/** A deck split the way `parseDecklistSections` splits a pasted list, so an imported deck and a
 *  pasted one are the same thing by the time anything downstream sees them. Names repeat by
 *  quantity: four Forests are four entries. */
export interface DeckSections {
  commanders: string[];
  deck: string[];
  /** CR 702.139, outside the 100. Absent when the source named none. Moxfield reads its
   *  `companions` board; Archidekt its per-card `companion` flag (measured 2026-09-23). */
  companions?: string[];
}

export type FetchFn = typeof fetch;

/** Carries the STATUS, not just a message, because the caller has to tell two very different things
 *  apart and cannot do it by reading prose:
 *
 *  - 404 means the reader pasted a private or deleted deck. That is a normal answer to a normal
 *    mistake, and it must not make us treat the site as unhealthy.
 *  - 429 or a 5xx means the site is telling us to stop, and everything must stop.
 *
 *  Without the distinction, one reader pasting a private deck would silence the importer for
 *  everyone for a minute. */
export class DeckFetchError extends Error {
  constructor(
    readonly source: string,
    readonly status: number,
  ) {
    super(`${source} fetch failed: ${status}`);
    this.name = "DeckFetchError";
  }

  /** Their problem, not ours: back off. Anything else is the reader's input. */
  get isUpstreamDistress(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

/** THE MOST A DECK SITE'S ANSWER MAY WEIGH, in bytes (security review 2026-09-25). A 100-card deck
 *  with Moxfield's full card objects is a few hundred KB; a body many times that is not a deck, and
 *  parsing it whole would spend the importer's memory on someone else's mistake or on a hostile
 *  upstream. 8 MB is generous for a real list and a fraction of a Worker's 128 MB. */
export const MAX_DECK_BYTES = 8 * 1024 * 1024;

/** A deck site's JSON, refused with a 413 when it is larger than `MAX_DECK_BYTES`. The declared
 *  length is checked before reading and the real length after, because a missing or false
 *  `Content-Length` is exactly the case the cap is for. */
export async function readDeckJson(res: Response, source: string): Promise<unknown> {
  const declared = Number(res.headers.get("Content-Length") ?? "0");
  if (declared > MAX_DECK_BYTES) throw new DeckFetchError(source, 413);
  const text = await res.text();
  if (text.length > MAX_DECK_BYTES) throw new DeckFetchError(source, 413);
  return JSON.parse(text);
}
