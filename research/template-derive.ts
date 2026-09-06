/** W19 MEASUREMENT: three counts per role over the 71 calibration decks -- what the deck RUNS, what
 *  the flat floor (Command Zone plus the archetype shift) TARGETS, and what the HYPERGEOMETRIC gives
 *  for a stated requirement "at least k of this role among the cards seen by turn t, with
 *  probability p". Where the hypergeometric and the deck agree and the flat floor disagrees, the
 *  flat floor is the wrong template. Free: Mongo reads and pure functions.
 *
 *  THE REQUIREMENTS ARE STATED, NOT FITTED. Generic rows first; the strategy-conditioned ones are
 *  the owner's question ("landfall runs more lands, control more interaction") written as k/t/p,
 *  and the whole point of the run is to see whether the numbers they produce look like the decks.
 *
 *  Usage: tsx src/bin/template-derive.ts [--verbose] */
import { readFileSync, readdirSync } from "node:fs";
import { connect, loadConfig, mongoLookup, parseDecklistSections, resolveNames } from "@edh-seer/data";
import { minCopies } from "@edh-seer/engine";
import { minSources } from "../packages/matcher/src/mulligan.js";
import { createTagsLookup } from "@edh-seer/tagger";
import { analyzeDeckStructured, buildDeckCards, loadTokenTags } from "../packages/matcher/src/index.js";

const DIR = process.argv.includes("--dir") ? process.argv[process.argv.indexOf("--dir") + 1]! : "packages/cli/decks/calibration";
const VERBOSE = process.argv.includes("--verbose");
/** Decks are read from `DIR` and, one level down, from each subdirectory: `--dir packages/cli/decks/edhrec`
 *  groups the rows by the archetype directory `edhrec-population.ts` wrote them under, so a per-theme
 *  table reads "what does a landfall deck run" from decks CHOSEN as landfall, not detected as it. */
function deckFiles(): { file: string; group: string }[] {
  const out: { file: string; group: string }[] = [];
  for (const e of readdirSync(DIR, { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith(".txt")) out.push({ file: `${DIR}/${e.name}`, group: "" });
    if (e.isDirectory()) for (const f of readdirSync(`${DIR}/${e.name}`)) if (f.endsWith(".txt")) out.push({ file: `${DIR}/${e.name}/${f}`, group: e.name });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

interface Req { k: number; turn: number; p: number; why: string }
/** The generic requirement per parent, and the strategy-conditioned one where the owner named a
 *  strategy that wants more. `minCopies` inverts P(X >= k | 99, K, seen(turn)) >= p. */
const GENERIC: Record<string, Req> = {
  Ramp: { k: 1, turn: 3, p: 0.8, why: "a ramp piece by turn 3, 80%" },
  Consistency: { k: 1, turn: 4, p: 0.85, why: "a draw piece by turn 4, 85%" },
  Interaction: { k: 1, turn: 4, p: 0.8, why: "an answer by turn 4, 80%" },
  // 3-by-3 at 90% is the requirement the population builds to: 37 lands hits it under the mulligan,
  // and 37 is the median. 4-by-4 overshoots because ramp and land-fetch substitute for the fourth drop.
  lands: { k: 3, turn: 3, p: 0.9, why: "three land drops by turn 3, 90%" },
};
// NO "CONTROL" ROW: the archetype detector has no control member (the repo's ruling is that control is
// interaction CONTENT, a role, not a synergy archetype), and a regex on the names matched the +1/+1
// COUNTERS archetype on the first run -- 28 decks read as control. The strategy-conditioned
// interaction requirement waits for a signal that is not the interaction count itself.
function requirementFor(parent: string, strategies: string[], theme: string): Req {
  if (parent === "lands" && (strategies.includes("landfall") || /\bland/i.test(theme))) return { k: 6, turn: 6, p: 0.8, why: "landfall: a drop every turn through 6, 80%" };
  return GENERIC[parent]!;
}

const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const tags = createTagsLookup(store.db);
const tokenTags = await loadTokenTags(store.db as never);
/** `hyper` is raw (no mulligan); `mull` prices the owner's policy (free 7, then a forced 6, keep on
 *  2-4 lands) via `minSources` -- EXACT for lands, an UPPER BOUND on the help for any other role,
 *  since a player keeps on lands and not on ramp. The truth for a role sits between the two. */
type Row = { deck: string; parent: string; actual: number; flat: number; hyper: number; mull: number; req: string; strategies: string[]; group: string };
const rows: Row[] = [];
const lowCoverage: string[] = [];
for (const { file, group } of deckFiles()) {
  const { commanders, deck } = parseDecklistSections(readFileSync(file, "utf8"));
  const { cards, missing } = await resolveNames([...commanders, ...deck], lookup);
  const dcs = await buildDeckCards(cards, lookup, tags);
  // Coverage: a card the corpus cannot resolve, or one with no derived tags, is a card the roles do
  // not count. A deck under 95% read is still measured but FLAGGED -- its role counts run low.
  const unread = dcs.filter((d) => !d.tags).length;
  const covered = 1 - (missing.length + unread) / (commanders.length + deck.length);
  if (covered < 0.95) lowCoverage.push(`${file.slice(DIR.length + 1)}: ${(covered * 100).toFixed(0)}% read (${missing.length} unresolved, ${unread} unread)`);
  const r = analyzeDeckStructured(dcs, commanders, undefined, undefined, undefined, undefined, tokenTags);
  const strategies = (r.strategies ?? []).map((s) => s.name);
  const theme = r.cohesion?.theme ?? "";
  const name = file.slice(DIR.length + 1).replace(/\.txt$/, "");
  for (const p of r.buildParents ?? []) {
    // A wipe is not a by-turn requirement (owner, 2026-09-06): "one by turn 7 at 60%" priced to six
    // per deck, and the population runs two. It stays doctrine -- 3, and 6 for superfriends -- so
    // the row carries the flat target in every column and measures nothing.
    if (p.name === "Board wipes") { rows.push({ deck: name, parent: p.name, actual: p.count, flat: p.target, hyper: p.target, mull: p.target, req: "wipes: doctrine, not derived", strategies, group }); continue; }
    const req = requirementFor(p.name, strategies, theme);
    rows.push({ deck: name, parent: p.name, actual: p.count, flat: p.target, hyper: minCopies(req.k, req.turn, req.p), mull: minSources(req.k, req.turn, req.p) ?? -1, req: req.why, strategies, group });
  }
  const lands = r.deckMath?.lands;
  if (lands) {
    const req = requirementFor("lands", strategies, theme);
    rows.push({ deck: name, parent: "lands", actual: lands.actual, flat: lands.target, hyper: minCopies(req.k, req.turn, req.p), mull: minSources(req.k, req.turn, req.p) ?? -1, req: req.why, strategies, group });
  }
}
await store.close?.();

const parents = [...new Set(rows.map((r) => r.parent))];
function table(all: Row[], label: string): void {
console.log(`\n${label}: decks ${new Set(all.map((r) => r.deck)).size}`);
console.log("parent         | n  | actual | flat | hyper | mull | err flat | err hyper | err mull | w2 flat | w2 hyper | w2 mull");
for (const p of parents) {
  const rs = all.filter((r) => r.parent === p);
  const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]!; };
  const mad = (f: (r: Row) => number) => rs.reduce((a, r) => a + Math.abs(f(r) - r.actual), 0) / rs.length;
  const within = (f: (r: Row) => number) => rs.filter((r) => Math.abs(f(r) - r.actual) <= 2).length;
  const c = (x: number | string, w: number) => String(x).padStart(w);
  console.log(`${p.padEnd(14)} | ${c(rs.length, 2)} | ${c(med(rs.map((r) => r.actual)), 6)} | ${c(med(rs.map((r) => r.flat)), 4)} | ${c(med(rs.map((r) => r.hyper)), 5)} | ${c(med(rs.map((r) => r.mull)), 4)} | ${c(mad((r) => r.flat).toFixed(2), 8)} | ${c(mad((r) => r.hyper).toFixed(2), 9)} | ${c(mad((r) => r.mull).toFixed(2), 8)} | ${c(within((r) => r.flat), 7)} | ${c(within((r) => r.hyper), 8)} | ${c(within((r) => r.mull), 7)}`);
}
}
const groups = [...new Set(rows.map((r) => r.group))].filter(Boolean).sort();
if (groups.length === 0) table(rows, "all");
else for (const g of groups) table(rows.filter((r) => r.group === g), g);
if (lowCoverage.length) { console.log(`\nFLAGGED, under 95% read (${lowCoverage.length}):`); for (const l of lowCoverage) console.log("  " + l); }
console.log("\nrequirements used:");
for (const why of [...new Set(rows.map((r) => r.req))]) console.log("  " + why + ` -> raw ${rows.find((r) => r.req === why)!.hyper}, with mulligan ${rows.find((r) => r.req === why)!.mull} copies (n=${rows.filter((r) => r.req === why).length})`);
if (VERBOSE) for (const r of rows) console.log(`${r.deck} | ${r.parent} | actual ${r.actual} flat ${r.flat} hyper ${r.hyper} mull ${r.mull} | ${r.strategies.join(',')}`);
