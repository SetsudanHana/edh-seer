/** THE DECK LINKS (see `deck-links-core.ts`): for each row of `packages/instruments/data/deck-links.json`,
 *  analyse its deck against a local static build and fail when the link is missing from the graph.
 *
 *    npx tsx packages/instruments/src/deck-links.ts [--static static-out]
 *
 *  Free: files only (the static build, no Mongo). Exits 1 on any missing link. */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { missingLinks, type DeckLink } from "./deck-links-core.js";
import { analyzeStaticDeck } from "./static-deck.js";

const arg = (name: string, fallback: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1]! : fallback; };
const repo = resolve(import.meta.dirname, "..", "..", "..");
const source = arg("--static", join(repo, "static-out"));
const rows = JSON.parse(readFileSync(join(repo, "packages", "instruments", "data", "deck-links.json"), "utf8")) as (DeckLink & { deck: string; commander?: string; issue: number })[];

let missing = 0;
for (const deck of [...new Set(rows.map((r) => r.deck))]) {
  const mine = rows.filter((r) => r.deck === deck);
  const data = await analyzeStaticDeck(join(repo, deck), source, mine[0]!.commander);
  const lost = missingLinks(data.graph ?? { edges: [] }, mine);
  missing += lost.length;
  console.log(`${deck}: ${lost.length ? lost.map((l) => `MISSING #${(l as { issue?: number }).issue} ${l.from} -> ${l.to} (${l.tag})`).join("; ") : `all ${mine.length} links present`}`);
}
if (missing) { console.error(`${missing} deck link(s) missing`); process.exit(1); }
