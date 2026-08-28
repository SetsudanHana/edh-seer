import { writeFileSync, readFileSync } from "node:fs";
import { connect, docToCard, loadConfig, mongoLookup, normalizeName, parseDecklistText, type CardDoc } from "@edh-seer/data";
import type { CardTags } from "@edh-seer/tagger";
import { buildGraph, type CardGraph } from "../graph.js";
import { toHtml } from "../graph-html.js";
import { addEventEdges, orphanCards } from "../graph-events.js";
import { loadHierarchy } from "../hierarchy.js";
import type { DeckCard } from "../types.js";

/** Export a FILTERED card subgraph, as a self-contained HTML viewer (`--out x.html`) or as
 *  Cytoscape JSON for Cytoscape Desktop and Gephi (any other extension).
 *
 *  There is deliberately no --all: the corpus is ~35k card nodes and ~350k edges, which renders
 *  as an unreadable hairball in every tool. Offering the flag would make the first thing anyone
 *  tries the thing that convinces them the graph is useless.
 *
 *  Usage:
 *    npx tsx packages/matcher/src/bin/graph-export.ts --subtype wizard [--limit 500] [--out f.html]
 *    npx tsx packages/matcher/src/bin/graph-export.ts --deck packages/cli/decks/inalla.txt
 *    npx tsx packages/matcher/src/bin/graph-export.ts --identity R --limit 300
 *
 *  Add --events to overlay the matcher's synergy edges as reified `event:` nodes (stage 2). Stage 1
 *  on its own shows what cards SHARE; only the event edges show why they work together. */
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
  const events = process.argv.includes("--events");
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
  let subtypeRe: RegExp | undefined;

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
    subtypeRe = new RegExp(`—[^/]*\\b${subtype.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    docs = await cards.find({ typeLine: { $regex: subtypeRe } }).limit(limit).toArray();
  } else {
    docs = await cards
      .find({ colorIdentity: { $not: { $elemMatch: { $nin: [...identity!.toUpperCase()] } } } })
      .limit(limit)
      .toArray();
  }

  // MUST run before buildGraph: reassigning docs afterwards would leave the stage-1 nodes and the
  // event layer describing two different card sets, which silently reports every non-overlapping
  // card as connected.
  if (events) {
    // A corpus slice is ~60% tagged, so a plain --limit spends 40% of the budget on cards that can
    // form no event edge at all. Over-fetch and keep the tagged ones, so --events actually fills the
    // graph it was asked for. Untagged cards are still reported, never silently treated as isolated.
    if (!deck && docs.length > 0) {
      const wide = subtype
        ? await cards.find({ typeLine: { $regex: subtypeRe! } }).limit(limit * 4).toArray()
        : await cards.find({ colorIdentity: { $not: { $elemMatch: { $nin: [...identity!.toUpperCase()] } } } }).limit(limit * 4).toArray();
      const tagged = new Set(
        (await store.db.collection("cardTags").find({ oracleId: { $in: wide.map((d) => d._id) } }).project({ oracleId: 1 }).toArray())
          .map((t) => t.oracleId as string),
      );
      const preferred = wide.filter((d) => tagged.has(d._id));
      if (preferred.length > 0) docs = preferred.slice(0, limit);
    }
  }

  let g = buildGraph(docs);

  if (events) {
    // O(n^2) reason calls -- see the ponytail note in graph-events.ts. Warn rather than cap, since
    // the honest answer for a big selection is "this will take a while", not a silently smaller graph.
    if (docs.length > 300) console.warn(`--events on ${docs.length} cards: ~${docs.length ** 2} pair evaluations, this will take a moment`);
    const tagsFor = async (d: CardDoc): Promise<CardTags | null> =>
      (await store.db.collection("cardTags").findOne({ oracleId: d._id })) as CardTags | null;
    const deckCards: DeckCard[] = [];
    for (const d of docs) deckCards.push({ card: docToCard(d), tags: await tagsFor(d) });
    g = addEventEdges(g, deckCards, loadHierarchy());
    const orphans = orphanCards(g, deckCards);
    const untagged = deckCards.filter((d) => !d.tags).length;
    console.log(`  event nodes: ${g.nodes.filter((n) => n.kind === "event").length}`);
    console.log(`  cards forming no event edge: ${orphans.length}${untagged ? ` (plus ${untagged} untagged, i.e. unknown rather than unconnected)` : ""}`);
  }

  const label = deck ?? (subtype ? `subtype: ${subtype}` : `identity: ${identity}`);
  writeFileSync(out, out.endsWith(".html") ? toHtml(g, label) : JSON.stringify(toCytoscape(g), null, 1));
  console.log(`${docs.length} cards -> ${g.nodes.length} nodes, ${g.edges.length} edges -> ${out}`);
  await store.close();
}

main().catch((err) => {
  console.error("graph-export failed:", err);
  process.exit(1);
});
