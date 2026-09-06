/** BUILD-SCORE SNAPSHOT over a decks directory, one JSON line per deck: `buildScore`, each parent's
 *  count/target, the ranked strategies and (once it exists) the template blend. Free: Mongo reads
 *  and pure functions. Run before and after a template change and diff with `--diff a.jsonl b.jsonl`.
 *
 *  Usage: tsx research/build-scores.ts [--dir packages/cli/decks/calibration] > before.jsonl
 *         tsx research/build-scores.ts --diff before.jsonl after.jsonl */
import { readFileSync, readdirSync } from "node:fs";

const argv = process.argv;
const arg = (k: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);

type Row = {
  deck: string; group: string; buildScore: number;
  parents: Record<string, { count: number; target: number }>;
  strategies: { name: string; confidence: number }[];
  template?: unknown;
};

if (argv.includes("--diff")) {
  const read = (p: string) => new Map(readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Row).map((r) => [r.deck, r]));
  const a = read(argv[argv.indexOf("--diff") + 1]!);
  const b = read(argv[argv.indexOf("--diff") + 2]!);
  const moves: { deck: string; from: number; to: number; parents: string }[] = [];
  for (const [deck, ra] of a) {
    const rb = b.get(deck);
    if (!rb) continue;
    const d = rb.buildScore - ra.buildScore;
    const parents = Object.keys(ra.parents).filter((p) => ra.parents[p]!.target !== rb.parents[p]?.target)
      .map((p) => `${p} ${ra.parents[p]!.target}->${rb.parents[p]!.target}`).join(", ");
    if (Math.abs(d) >= 0.005 || parents) moves.push({ deck, from: ra.buildScore, to: rb.buildScore, parents });
  }
  const scores = (m: Map<string, Row>) => [...m.values()].map((r) => r.buildScore);
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  console.log(`decks ${a.size}; mean buildScore ${mean(scores(a)).toFixed(3)} -> ${mean(scores(b)).toFixed(3)}; moved ${moves.length}, up ${moves.filter((m) => m.to > m.from).length}, down ${moves.filter((m) => m.to < m.from).length}`);
  for (const m of moves.sort((x, y) => Math.abs(y.to - y.from) - Math.abs(x.to - x.from)).slice(0, Number(arg("--top") ?? 40)))
    console.log(`  ${m.deck.padEnd(48)} ${m.from.toFixed(2)} -> ${m.to.toFixed(2)}  ${m.parents}`);
  process.exit(0);
}

const { connect, loadConfig, mongoLookup, parseDecklistSections, resolveNames } = await import("@edh-seer/data");
const { createTagsLookup } = await import("@edh-seer/tagger");
const { analyzeDeckStructured, buildDeckCards, loadTokenTags } = await import("../packages/matcher/src/index.js");

const DIR = arg("--dir") ?? "packages/cli/decks/calibration";
function deckFiles(): { file: string; group: string }[] {
  const out: { file: string; group: string }[] = [];
  for (const e of readdirSync(DIR, { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith(".txt")) out.push({ file: `${DIR}/${e.name}`, group: "" });
    if (e.isDirectory()) for (const f of readdirSync(`${DIR}/${e.name}`)) if (f.endsWith(".txt")) out.push({ file: `${DIR}/${e.name}/${f}`, group: e.name });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const tags = createTagsLookup(store.db);
const tokenTags = await loadTokenTags(store.db as never);
for (const { file, group } of deckFiles()) {
  const { commanders, deck } = parseDecklistSections(readFileSync(file, "utf8"));
  const { cards } = await resolveNames([...commanders, ...deck], lookup);
  const dcs = await buildDeckCards(cards, lookup, tags);
  const r = analyzeDeckStructured(dcs, commanders, undefined, undefined, undefined, undefined, tokenTags) as never as {
    buildScore?: number; buildParents?: { name: string; count: number; target: number }[];
    strategies?: { name: string; confidence: number }[]; template?: unknown;
  };
  const row: Row = {
    deck: file.slice(DIR.length + 1).replace(/\.txt$/, ""), group, buildScore: r.buildScore ?? 0,
    parents: Object.fromEntries((r.buildParents ?? []).map((p) => [p.name, { count: p.count, target: p.target }])),
    strategies: (r.strategies ?? []).map((s) => ({ name: s.name, confidence: +s.confidence.toFixed(3) })),
    ...(r.template ? { template: r.template } : {}),
  };
  console.log(JSON.stringify(row));
}
await store.close?.();
