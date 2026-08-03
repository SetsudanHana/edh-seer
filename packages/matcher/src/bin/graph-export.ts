import { writeFileSync, readFileSync } from "node:fs";
import { connect, loadConfig, mongoLookup, normalizeName, parseDecklistText, type CardDoc } from "@mtg/data";
import { buildGraph, type CardGraph } from "../graph.js";

/** Export a FILTERED card subgraph as Cytoscape JSON, readable by Cytoscape Desktop and Gephi.
 *
 *  There is deliberately no --all: the corpus is ~35k card nodes and ~350k edges, which renders
 *  as an unreadable hairball in every tool. Offering the flag would make the first thing anyone
 *  tries the thing that convinces them the graph is useless.
 *
 *  Usage:
 *    npx tsx packages/matcher/src/bin/graph-export.ts --subtype wizard [--limit 500] [--out f.cyjs]
 *    npx tsx packages/matcher/src/bin/graph-export.ts --deck packages/cli/decks/inalla.txt
 *    npx tsx packages/matcher/src/bin/graph-export.ts --identity R --limit 300 */
const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};

/** Cytoscape's own JSON shape: a flat elements array of { data: {...} }. */
function toCytoscape(g: CardGraph): unknown {
  return {
    elements: [
      ...g.nodes.map((n) => ({ data: { id: n.id, kind: n.kind, label: n.label, ...n.props } })),
      ...g.edges.map((e, i) => ({ data: { id: `e${i}`, source: e.from, target: e.to, kind: e.kind } })),
    ],
  };
}

async function main(): Promise<void> {
  const subtype = arg("subtype");
  const deck = arg("deck");
  const identity = arg("identity");
  const limit = Number(arg("limit") ?? 500);
  const out = arg("out") ?? "graph.cyjs";

  if (!subtype && !deck && !identity) {
    console.error("need one of --subtype <name> | --deck <path> | --identity <WUBRG letters>");
    console.error("(there is no --all: a full-corpus export is an unreadable hairball)");
    process.exit(1);
  }

  const store = await connect(loadConfig());
  const cards = store.db.collection<CardDoc>("cards");
  let docs: CardDoc[];

  if (deck) {
    const lookup = mongoLookup(store);
    docs = [];
    for (const name of new Set(parseDecklistText(readFileSync(deck, "utf8")))) {
      const d = await lookup.findByName(normalizeName(name));
      if (d) docs.push(d as CardDoc);
    }
  } else if (subtype) {
    // Match the subtype as a whole word after the em dash, on either face. The argument is escaped
    // before it reaches the pattern: a metacharacter would otherwise either throw (unbalanced
    // paren) or, worse, silently widen the query -- `--subtype "wiz.rd"` matching more than asked.
    const re = new RegExp(`—[^/]*\\b${subtype.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    docs = await cards.find({ typeLine: { $regex: re } }).limit(limit).toArray();
  } else {
    docs = await cards
      .find({ colorIdentity: { $not: { $elemMatch: { $nin: [...identity!.toUpperCase()] } } } })
      .limit(limit)
      .toArray();
  }

  const g = buildGraph(docs);
  writeFileSync(out, JSON.stringify(toCytoscape(g), null, 1));
  console.log(`${docs.length} cards -> ${g.nodes.length} nodes, ${g.edges.length} edges -> ${out}`);
  await store.close();
}

main().catch((err) => {
  console.error("graph-export failed:", err);
  process.exit(1);
});
