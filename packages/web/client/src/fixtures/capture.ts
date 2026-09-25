/** Captures a board fixture by analysing a decklist through the app's OWN pipeline and reshaping
 *  the result into what board-trial.ts wants: `{ graph, buildCategories, combos }`.
 *
 *  Through `analyzeDeckStatic` on purpose -- the exact function the browser runs -- so a fixture
 *  cannot drift from what the app renders. Until 2026-09-25 this POSTed to the NestJS API on :3001;
 *  the server is gone, and the static path needs no database: it reads `/static` shards, by default
 *  the live site's, or a local build's with `BOARD_FIXTURE_STATIC`.
 *
 *  Usage:
 *    npx tsx capture.ts <name> <decklist.txt> [<name> <decklist.txt> ...]
 *    BOARD_FIXTURE_STATIC=http://localhost:5173/static npx tsx capture.ts ...   # a local static-out
 *
 *  Free to re-run: no model call anywhere on this path.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { analyzeDeckStatic } from "../api.static.js";

const STATIC = process.env.BOARD_FIXTURE_STATIC ?? "https://edhseer.cards/static";

async function capture(name: string, deckPath: string): Promise<void> {
  const body = await analyzeDeckStatic(readFileSync(deckPath, "utf8"), undefined, STATIC, fetch);

  // Only the three fields a trial reads. The rest of the report is a large document the board
  // never touches, and checking it in would make every fixture a merge conflict waiting to happen.
  const fixture = {
    graph: body.graph,
    buildCategories: body.report.buildCategories ?? [],
    combos: body.report.combos ?? [],
  };
  const out = new URL(`./${name}-graph.json`, import.meta.url).pathname;
  writeFileSync(out, JSON.stringify(fixture));

  // Every node is a card in the projected shape -- there is no `kind` discriminant to filter on.
  const missing = body.missing ?? [];
  console.log(
    `${name.padEnd(28)} ${String(body.graph.nodes.length).padStart(4)} card nodes · ` +
    `${String(body.graph.edges.length).padStart(5)} edges · ` +
    `undirected ${body.graph.undirectedReasons} · offDeck ${body.graph.offDeckReasons} · ` +
    `resolved ${body.resolvedCount}/${body.totalCount}` +
    (missing.length > 0 ? ` · MISSING ${missing.length}: ${missing.slice(0, 3).join(", ")}` : ""),
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.length % 2 !== 0) {
    console.error("usage: npx tsx capture.ts <name> <decklist.txt> [<name> <decklist.txt> ...]");
    process.exit(1);
  }
  // Serial, not Promise.all: each deck is a few hundred shard reads, and the point is a
  // reproducible capture rather than a fast one.
  for (let i = 0; i < args.length; i += 2) await capture(args[i], args[i + 1]);
}

main().catch((e) => { console.error(e); process.exit(1); });
