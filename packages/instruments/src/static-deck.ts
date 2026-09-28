/** A DECK ANALYSED AGAINST A LOCAL STATIC BUILD, the way the site does it (`analyzeDecklist` fed a
 *  `StaticLookup`), for the deck-level instruments: the suggestion anti-list and the deck links. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeDecklist } from "@edh-seer/matcher/orchestrate";
import { StaticLookup } from "@edh-seer/matcher/static-lookup";

export const STATIC_BASE = "http://static.local";

export function staticFetch(source: string): typeof fetch {
  return (async (input: string | URL | Request) => {
    const path = join(source, new URL(String(input)).pathname);
    if (!existsSync(path)) return new Response("not found", { status: 404 });
    return new Response(readFileSync(path), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

export async function analyzeStaticDeck(deckPath: string, source: string, commander?: string) {
  const fetchImpl = staticFetch(source);
  return analyzeDecklist(readFileSync(deckPath, "utf8"), commander, async (names) => {
    const lookup = new StaticLookup(STATIC_BASE, fetchImpl);
    await lookup.prefetch(names);
    return { lookup, tagsLookup: lookup, tokenTags: await lookup.tokenTags(), tokenArt: (ids: string[]) => lookup.tokenArt(ids) };
  });
}
