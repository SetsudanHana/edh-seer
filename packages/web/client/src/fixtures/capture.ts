/** Captures a board fixture by POSTing a decklist to a RUNNING api and reshaping the response into
 *  what board-trial.ts wants: `{ graph, buildCategories, combos }`.
 *
 *  Through the real endpoint on purpose. The analyze deps are wired inline in the Nest module
 *  (data.module.ts), so a generator that built its own graph would be a second copy of ~60 lines of
 *  load-bearing wiring -- resolve, tags lookup, addEventEdges, attachRolesAndArt -- free to drift
 *  from what the app actually renders. A fixture that drifts from the app is worse than no fixture.
 *
 *  Usage, with the api up on :3001 (needs the env sourced; see CLAUDE.md):
 *    npx tsx capture.ts <name> <decklist.txt> [<name> <decklist.txt> ...]
 *
 *  Free to re-run: no model call anywhere on this path, just mongo and the corpus.
 */
import { readFileSync, writeFileSync } from "node:fs";

const API = process.env.BOARD_FIXTURE_API ?? "http://localhost:3001/api/analyze";

async function capture(name: string, deckPath: string): Promise<void> {
  const res = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decklist: readFileSync(deckPath, "utf8") }),
  });
  if (!res.ok) throw new Error(`${name}: ${res.status} ${await res.text()}`);
  const body = await res.json() as {
    graph: { nodes: unknown[]; edges: unknown[] };
    report: { buildCategories?: unknown[]; combos?: unknown[] };
    missing?: string[];
    resolvedCount?: number;
    totalCount?: number;
  };

  // Only the three fields a trial reads. The rest of the report is a large document the board
  // never touches, and checking it in would make every fixture a merge conflict waiting to happen.
  const fixture = {
    graph: body.graph,
    buildCategories: body.report.buildCategories ?? [],
    combos: body.report.combos ?? [],
  };
  const out = new URL(`./${name}-graph.json`, import.meta.url).pathname;
  writeFileSync(out, JSON.stringify(fixture));

  const cards = body.graph.nodes.filter((n) => (n as { kind: string }).kind === "card").length;
  const missing = body.missing ?? [];
  console.log(
    `${name.padEnd(28)} ${String(cards).padStart(4)} card nodes · ` +
    `${String(body.graph.edges.length).padStart(5)} edges · ` +
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
  // Serial, not Promise.all: each request is a few hundred mongo reads, and the point is a
  // reproducible capture rather than a fast one.
  for (let i = 0; i < args.length; i += 2) await capture(args[i], args[i + 1]);
}

// Not top-level await -- tsx transforms this tree as CJS, which does not support it.
main().catch((e) => { console.error(e); process.exit(1); });
