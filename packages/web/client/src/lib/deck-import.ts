import { deckSourceOf } from "@edh-seer/data/deck-url";
import type { DeckSections } from "@edh-seer/data/deck-source";

export { deckSourceOf };

/** WHAT THE READER IS TOLD, AND WHAT THEY CAN DO ABOUT IT.
 *
 *  The importer is allowed to refuse -- it is paced to one request a second and it opens a breaker
 *  when a deck site is unwell -- so every one of these states is reachable by an ordinary reader on an
 *  ordinary day. Each says what happened and names the way out, and the way out is always the same and
 *  always available: the decklist can be pasted as text. A dead form with "Error: 429" on it would be
 *  the same information and none of the help. */
const MESSAGES: Record<number, string> = {
  404: "That deck is private, or the link is wrong. Make it public, or paste the decklist instead.",
  429: "The importer is busy right now. Try again in a few seconds, or paste the decklist instead.",
  503: "Importing is paused for a moment. Try again shortly, or paste the decklist instead.",
  502: "Could not read that deck — the site may have changed. Paste the decklist instead.",
};

const UNREACHABLE =
  "Could not reach the importer. Check your connection, or paste the decklist instead.";

/** Names repeated by quantity, back into the `N Name` lines the form holds.
 *
 *  Order of first appearance is kept, so a list stays in the order the deck site returned it rather
 *  than being alphabetised into something the reader did not recognise. */
export function toDecklistLines(names: string[]): string {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].map(([name, n]) => `${n} ${name}`).join("\n");
}

export interface ImportedDeck {
  commanders: string;
  decklist: string;
}

/** Fetches one deck and returns it as the two fields the form already has.
 *
 *  Same origin, relative path: the Worker is routed onto this site's own domain, so there is no CORS
 *  and no base URL to configure or get wrong per environment. */
export async function importDeck(
  source: string,
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ImportedDeck> {
  let res: Response;
  try {
    res = await fetchImpl(`/api/import/${source}/${encodeURIComponent(id)}`);
  } catch {
    throw new Error(UNREACHABLE);
  }
  if (!res.ok) throw new Error(MESSAGES[res.status] ?? MESSAGES[502]);
  const sections = (await res.json()) as DeckSections;
  return {
    commanders: toDecklistLines(sections.commanders ?? []),
    decklist: toDecklistLines(sections.deck ?? []),
  };
}
