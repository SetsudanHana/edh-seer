import type { CardGraph, GraphEdge, GraphNode } from "./graph.js";
import type { DeckCard, Hierarchy } from "./types.js";
import { directedReasons } from "./edges.js";

/** Attach the matcher's synergy edges to a stage-1 card graph, reified as EVENT nodes.
 *
 *  The brief's §4.6 rule: nodes are event keys, cards attach to them by role, and card-to-card
 *  synergy is a derived two-hop view rather than something stored. That is not just tidiness -- it
 *  is the difference between `n * m` edges and `n + m`. In a Wizard deck where 50 creatures emit
 *  `enters:wizard` and 10 payoffs listen for it, storing pairs costs 500 edges that all say the same
 *  thing; one event node costs 60 and says it once, legibly.
 *
 *  Reifying is also what makes the question you actually want to ask answerable by walking: "what
 *  supplies `dies:creature` in this deck, and what pays it off" is the node's in- and out-edges.
 *
 *  Edges come from `directedReasons`, so they are exactly the engine's edges -- the same function
 *  the deck analysis and the compass regression run on. A graph that computed its own would drift.
 *
 *  ponytail: O(n^2) calls to `directedReasons`, one per ordered pair. Fine for the few-hundred-card
 *  subgraphs the exporter produces (a 100-card deck is ~10k calls, well under a second) and the
 *  reason `--events` warns above a few hundred cards. Batch by event key if that ever binds. */
export function addEventEdges(g: CardGraph, deck: DeckCard[], h: Hierarchy): CardGraph {
  const nodes = new Map(g.nodes.map((n) => [n.id, n]));
  const edges = new Map(g.edges.map((e) => [edgeKey(e), e]));

  /** A card is only addressable here if it is already a node in the stage-1 graph, which keys on
   *  oracle id. An untagged card has no reasons to contribute and is skipped quietly.
   *
   *  A TAGGED card missing from the graph is a caller bug, and a loud one on purpose: it means the
   *  graph and the deck describe different card sets, which does not fail — it silently produces a
   *  graph where the non-overlapping cards look perfectly connected because nothing ever asked about
   *  them. That shipped once already, from a `buildGraph` call sitting one statement too early. */
  const missing: string[] = [];
  const idOf = (d: DeckCard): string | null => {
    if (!d.tags) return null;
    const id = "card:" + d.tags.oracleId;
    if (!nodes.has(id)) { missing.push(d.card.name); return null; }
    return id;
  };

  const addEvent = (tag: string): string => {
    const id = "event:" + tag;
    if (!nodes.has(id)) nodes.set(id, { id, kind: "event", label: tag });
    return id;
  };
  const addEdge = (from: string, to: string, kind: GraphEdge["kind"]): void => {
    const e: GraphEdge = { from, to, kind };
    const k = edgeKey(e);
    if (!edges.has(k)) edges.set(k, e);
  };

  for (const producer of deck) {
    const pid = idOf(producer);
    if (!pid) continue;
    for (const consumer of deck) {
      if (consumer === producer) continue;
      const cid = idOf(consumer);
      if (!cid) continue;
      for (const r of directedReasons(producer, consumer, h)) {
        const ev = addEvent(r.tag);
        addEdge(pid, ev, "EMITS");
        addEdge(ev, cid, "TRIGGERS");
      }
    }
  }

  if (missing.length > 0) {
    const shown = [...new Set(missing)].slice(0, 3).join(", ");
    throw new Error(
      `addEventEdges: ${new Set(missing).size} tagged deck cards are not nodes in the graph (${shown}...). ` +
        "The graph and the deck must be built from the same card list -- otherwise the cards present " +
        "in only one of them are reported as connected without ever being examined.",
    );
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

/** Edges are deduped on their whole identity: the same pair can produce the same reason tag from
 *  several abilities, and one `EMITS` edge already says everything those repeats would. */
const edgeKey = (e: GraphEdge): string => `${e.from}|${e.to}|${e.kind}`;

/** Cards with no event edge in either direction -- the deck's orphans.
 *
 *  Takes the deck rather than reading the graph alone, because "forms no edge" and "we never parsed
 *  this card" look identical in a graph and mean opposite things. An untagged card is UNKNOWN, not
 *  unconnected, and reporting it as an orphan is the dead-weight diagnostic being confidently wrong
 *  exactly where it has the least information. The caller reports those separately. */
export function orphanCards(g: CardGraph, deck: DeckCard[]): GraphNode[] {
  const connected = new Set<string>();
  for (const e of g.edges) {
    if (e.kind === "EMITS") connected.add(e.from);
    if (e.kind === "TRIGGERS") connected.add(e.to);
  }
  const known = new Set(deck.filter((d) => d.tags).map((d) => "card:" + d.tags!.oracleId));
  return g.nodes.filter((n) => n.kind === "card" && known.has(n.id) && !connected.has(n.id));
}
