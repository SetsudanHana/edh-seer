/** A deck split the way `parseDecklistSections` splits a pasted list, so an imported deck and a
 *  pasted one are the same thing by the time anything downstream sees them. Names repeat by
 *  quantity: four Forests are four entries. */
export interface DeckSections {
  commanders: string[];
  deck: string[];
  /** CR 702.139, outside the 100. Absent when the source named none -- and absent from every
   *  Archidekt import today. CEILING: Archidekt's companion shape (category name, includedInDeck)
   *  has not been measured on a real deck, and guessing it would import a card as the wrong thing. */
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
