import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseDecklistSections } from "@edh-seer/data";

/** WHAT DOES `FLOW_FANOUT_CAP` ACTUALLY HIDE? (owner question, 2026-09-03.)
 *
 *  The cap is 6, and the constant's own comment justified it with "at 6 the cap truncates 10.5% of
 *  node-directions". That figure is TRUE AND ABOUT THE WRONG POPULATION, which is what this
 *  measures: it weights every node-direction equally, and readers do not open cards uniformly. Both
 *  the ego view's list and the board's own ranking put the most-connected cards first, so the cards
 *  a reader opens are exactly the ones the cap bites hardest.
 *
 *  Measured 2026-09-03 over the 71 calibration decks, 8,573 node-directions:
 *
 *    fan size, all:    p50 3 · p90 7  · p95 12 · p99 37 · max 81
 *    fan size, top-10: p50 9 · p90 34 · p95 42 · p99 58 · max 81
 *
 *    cap  all-cut  top10-cut  median-fan-kept  ego nodes p50/p90/max
 *    6      10.1%      61.2%             67%            5/11/13
 *    7       8.5%      57.4%             78%            5/11/15
 *    10      5.9%      44.3%            100%            5/11/21
 *    15      4.0%      31.6%            100%            5/11/31
 *    20      3.0%      23.7%            100%            5/11/41
 *
 *  Read it in two places. The `top10-cut` column is the reader-facing truncation rate and it is
 *  61.2% at the shipped cap, six times the figure the constant was defended with. The `ego nodes`
 *  column is what a bigger cap COSTS, and it is nothing below the 90th percentile -- p50 5 and p90
 *  11 at every cap, because raising it changes hubs only.
 *
 *  THROUGH THE RUNNING SERVER on purpose. The directed graph is the wire-graph projection, several
 *  steps past `analyzeDeckStructured`'s undirected `edges`, and rebuilding that chain here would be
 *  a second definition of the thing being measured.
 *
 *  Free: reads only, no API spend, no writes. Needs the web server up.
 *
 *    cd packages/web && NODE_OPTIONS="--import tsx" npx nest start
 *    npx tsx packages/matcher/src/bin/fanout-cap.ts
 */
const API = process.env.API ?? "http://localhost:3001";
const DECK_DIR = join(process.cwd(), "packages", "cli", "decks", "calibration");
const CAPS = [6, 7, 10, 15, 20];

function pct(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
}

async function main(): Promise<void> {

  /** One entry per (card, direction): how many edges that card has in that direction. */
  const fans: number[] = [];
  /** The same, but only for the cards that rank top-10 by TOTAL partners in their deck -- the rows a
   *  reader actually reaches for, since the list is ranked by exactly that. */
  const hubFans: number[] = [];
  /** Distinct partners per card, both directions: the number the list row prints. */
  const totals: number[] = [];
  let decks = 0;

  for (const file of readdirSync(DECK_DIR).filter((f) => f.endsWith(".txt")).sort()) {
    const sections = parseDecklistSections(readFileSync(join(DECK_DIR, file), "utf8"));
    // THROUGH THE RUNNING SERVER, not a local re-derivation. The directed graph is the wire-graph
    // PROJECTION, several steps past `analyzeDeckStructured`'s undirected `edges`, and rebuilding
    // that chain here would be a second definition of the thing being measured.
    const res = await fetch(`${API}/api/analyze`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decklist: sections.deck.join("\n"), commanders: sections.commanders.join("\n") }),
    });
    if (!res.ok) { console.error(`skip ${file}: ${res.status}`); continue; }
    const r = await res.json() as { graph?: { edges: { from: string; to: string }[] } };
    const edges = r.graph?.edges ?? [];
    if (edges.length === 0) continue;
    decks++;

    const down = new Map<string, number>();
    const up = new Map<string, number>();
    const partners = new Map<string, Set<string>>();
    for (const e of edges) {
      down.set(e.from, (down.get(e.from) ?? 0) + 1);
      up.set(e.to, (up.get(e.to) ?? 0) + 1);
      for (const [self, other] of [[e.from, e.to], [e.to, e.from]] as const) {
        if (!partners.has(self)) partners.set(self, new Set());
        partners.get(self)!.add(other);
      }
    }
    const ranked = [...partners.entries()].sort((a, b) => b[1].size - a[1].size);
    const topTen = new Set(ranked.slice(0, 10).map(([id]) => id));
    for (const [id, set] of ranked) {
      totals.push(set.size);
      for (const m of [down, up]) {
        const n = m.get(id) ?? 0;
        if (n === 0) continue;
        fans.push(n);
        if (topTen.has(id)) hubFans.push(n);
      }
    }
  }
  console.log(`decks: ${decks}, node-directions: ${fans.length}, top-10 node-directions: ${hubFans.length}`);
  console.log(`fan size, all:    p50 ${pct(fans, 50)} · p90 ${pct(fans, 90)} · p95 ${pct(fans, 95)} · p99 ${pct(fans, 99)} · max ${Math.max(...fans)}`);
  console.log(`fan size, top-10: p50 ${pct(hubFans, 50)} · p90 ${pct(hubFans, 90)} · p95 ${pct(hubFans, 95)} · p99 ${pct(hubFans, 99)} · max ${Math.max(...hubFans)}`);
  console.log(`partners per card: p50 ${pct(totals, 50)} · p90 ${pct(totals, 90)} · p95 ${pct(totals, 95)} · max ${Math.max(...totals)}`);
  console.log("");
  console.log("cap  all-cut  top10-cut  median-fan-kept  ego nodes p50/p90/max");
  for (const cap of CAPS) {
    const allCut = fans.filter((n) => n > cap).length / fans.length;
    const hubCut = hubFans.filter((n) => n > cap).length / hubFans.length;
    const kept = hubFans.map((n) => Math.min(n, cap) / n);
    // An ego view is the focus plus min(cap, fan) in each direction.
    const egoNodes = totals.map((t) => 1 + Math.min(t, 2 * cap));
    console.log(
      `${String(cap).padEnd(4)} ${(allCut * 100).toFixed(1).padStart(6)}% ${(hubCut * 100).toFixed(1).padStart(9)}%`
      + ` ${(pct(kept, 50) * 100).toFixed(0).padStart(14)}%`
      + ` ${String(pct(egoNodes, 50)).padStart(12)}/${pct(egoNodes, 90)}/${Math.max(...egoNodes)}`,
    );
  }
}

void main();
