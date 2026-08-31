/** A DECKLIST IN A URL, because there is no server to keep one in.
 *
 *  Every other way to share an analysis needs storage: a short link is a row in a database, and this
 *  app is 16,402 static files on a CDN with nothing behind them. The decklist itself is the only
 *  thing that has to travel, and it compresses well — measured over the 71 calibration decks, a
 *  Moxfield export encodes to a median of 1,243 characters and a worst case of 1,972, so the whole
 *  URL fits inside the ~2,000 characters every platform that matters will carry.
 *
 *  IN THE FRAGMENT, NOT THE QUERY. A fragment is never sent to the host, so a shared deck does not
 *  land in someone's access log, and it does not split the page's cache entry or its canonical URL.
 *
 *  NATIVE COMPRESSION, NO DEPENDENCY. `CompressionStream("deflate-raw")` is in every browser this
 *  app targets. Where it is missing the payload is stored uncompressed and marked as such, because a
 *  longer link beats a broken one. */

/** The first character of every payload says how the rest was encoded. Without it, a browser with no
 *  `CompressionStream` would write plain payloads that a browser with one would try to inflate. */
const DEFLATED = "1";
const PLAIN = "0";

/** The fragment key. `#calibrate` is an existing route on this same hash, so the payload is a
 *  key=value pair rather than a bare string and the two cannot be confused for one another. */
export const SHARE_KEY = "deck";

/** Refuses anything a platform would truncate rather than handing out a link that loses its tail
 *  silently. 2,000 is the practical floor across the places people paste links; the measured worst
 *  case of the 71 calibration decks is 1,972. */
export const MAX_PAYLOAD = 2_000;

/** WHAT A READER PASTED, MINUS WHAT THE ANALYSER IGNORES. A Moxfield line carries a set code, a
 *  collector number and sometimes a foil marker, none of which reach the engine — `parseDecklistText`
 *  strips them before a single card is looked up. Dropping them here costs the link nothing it was
 *  using and buys 10% of its length back.
 *
 *  The quantity survives, because 34 Mountains and one Mountain are different decks. */
export function tidyDecklist(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => line.replace(/\s*\([A-Za-z0-9]{2,5}\)\s*[\dA-Za-z-]*\s*(?:\*[^*]*\*)?\s*$/, "").trim())
    .join("\n");
}

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromBase64Url = (s: string): Uint8Array => {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
};

/** Feeds bytes through a compression stream and collects the result.
 *
 *  Built from a `ReadableStream` rather than `new Blob([...]).stream()`, which jsdom does not
 *  implement — a test environment that cannot run the code is indistinguishable from code that does
 *  not work.
 *
 *  The one cast is `pipeThrough`'s. A compression stream ACCEPTS any `BufferSource` and EMITS
 *  `Uint8Array`, but `WritableStream` is invariant in its chunk type, so the wider input side cannot
 *  be assigned to the narrower pair the signature asks for. The alternative is widening every byte
 *  array in this module to `BufferSource`, which would lose the type where it is actually useful. */
type ByteStream = { readable: ReadableStream<Uint8Array>; writable: WritableStream<BufferSource> };

const through = async (bytes: Uint8Array, stream: ByteStream): Promise<Uint8Array> => {
  const source = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(bytes); controller.close(); },
  });
  const chunks: Uint8Array[] = [];
  const reader = source
    .pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)
    .getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
};

/** COMMANDERS AND DECK IN ONE STRING. A form feed separates them: it cannot occur in a decklist a
 *  human pasted, and unlike a blank line it cannot be produced accidentally by the text itself —
 *  which matters because the deck half legitimately contains blank lines between sections. */
const SEPARATOR = "\f";

export async function encodeShare(deck: { commanders: string; decklist: string }): Promise<string | null> {
  const text = `${tidyDecklist(deck.commanders)}${SEPARATOR}${tidyDecklist(deck.decklist)}`;
  const bytes = new TextEncoder().encode(text);
  let payload: string;
  if (typeof CompressionStream === "function") {
    payload = DEFLATED + toBase64Url(await through(bytes, new CompressionStream("deflate-raw")));
  } else {
    payload = PLAIN + toBase64Url(bytes);
  }
  // A LINK THAT LOSES ITS TAIL IS WORSE THAN NO LINK, because it fails at the far end, in someone
  // else's browser, as a deck that is quietly missing cards.
  return payload.length > MAX_PAYLOAD ? null : payload;
}

export async function decodeShare(payload: string): Promise<{ commanders: string; decklist: string } | null> {
  try {
    const kind = payload[0];
    const body = fromBase64Url(payload.slice(1));
    const bytes = kind === DEFLATED
      ? await through(body, new DecompressionStream("deflate-raw"))
      : kind === PLAIN ? body : null;
    if (!bytes) return null;
    const [commanders, decklist] = new TextDecoder().decode(bytes).split(SEPARATOR);
    // A payload with no separator is not one of ours, however well it decoded.
    if (decklist === undefined) return null;
    return { commanders, decklist };
  } catch {
    // Truncated, hand-edited, or from a version that wrote something else. A link that does not
    // decode leaves the reader on an empty paste box, which is the same place they would be with no
    // link at all.
    return null;
  }
}

/** Reads the payload out of a location hash, or null when there is none. Tolerates the hash being
 *  written with or without its leading `#`, and ignores any other key sharing the fragment. */
export function payloadFromHash(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  return params.get(SHARE_KEY);
}

export function shareUrl(origin: string, pathname: string, payload: string): string {
  return `${origin}${pathname}#${SHARE_KEY}=${payload}`;
}
