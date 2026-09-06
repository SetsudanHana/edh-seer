/** HOW OFTEN THE DETECTOR NAMES A DECK WHAT ITS BUILDER NAMED IT (vocabulary, 2026-09-06).
 *
 *  The EDHREC population (`packages/cli/decks/edhrec/<theme>/`) is a labelled set for free: every
 *  deck sits in the directory of the theme EDHREC tagged it with. For each theme: how many of its
 *  decks carry the member as the TOP archetype, in the top three, or at all -- and what the top
 *  label was when it is not. A declared member (no signal) scores 0 by construction and says so.
 *
 *    npx tsx research/archetype-recall.ts [--dir packages/cli/decks/edhrec] [--verbose] */
import { readFileSync, readdirSync } from "node:fs";
import { connect, loadConfig, mongoLookup, parseDecklistSections, resolveNames } from "@edh-seer/data";
import { ComboIndex } from "@edh-seer/engine";
import { createTagsLookup } from "@edh-seer/tagger";
import { analyzeDeckStructured, buildDeckCards, loadTokenTags } from "../packages/matcher/src/index.js";
import { DETECTABLE } from "../packages/matcher/src/archetype-vocabulary.js";

const DIR = process.argv.includes("--dir") ? process.argv[process.argv.indexOf("--dir") + 1]! : "packages/cli/decks/edhrec";
const VERBOSE = process.argv.includes("--verbose");
const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const tags = createTagsLookup(store.db);
const tokenTags = await loadTokenTags(store.db as never);

type Row = { theme: string; deck: string; ranked: string[] };
const rows: Row[] = [];
// A flat directory (the 71 calibration decks) has no labels: every deck lands in theme "" and only
// the per-deck ranking prints, which is the before/after diff the log wants.
const entries = readdirSync(DIR, { withFileTypes: true });
const groups = entries.some((e) => e.isDirectory()) ? entries.filter((e) => e.isDirectory()).map((e) => e.name).sort() : [""];
for (const theme of groups) {
  const sub = theme === "" ? DIR : `${DIR}/${theme}`;
  for (const f of readdirSync(sub).filter((f) => f.endsWith(".txt")).sort()) {
    const { commanders, deck } = parseDecklistSections(readFileSync(`${sub}/${f}`, "utf8"));
    const { cards, combos } = await resolveNames([...commanders, ...deck], lookup);
    const dcs = await buildDeckCards(cards, lookup, tags);
    const r = analyzeDeckStructured(dcs, commanders, undefined, undefined, new ComboIndex(combos), undefined, tokenTags);
    rows.push({ theme, deck: f.replace(/\.txt$/, ""), ranked: (r.strategies ?? []).map((s) => s.name) });
    if (VERBOSE) console.log(`${theme}/${f}: ${(r.strategies ?? []).map((s) => `${s.label} ${(s.confidence * 100).toFixed(0)}%`).join(" · ")}`);
  }
}
await store.close?.();

if (groups[0] === "") { await store.close?.(); process.exit(0); }
console.log("theme          | n  | top-1 | top-3 | any | detectable | top label when missed");
let t1 = 0, t3 = 0, any = 0, n = 0;
for (const theme of [...new Set(rows.map((r) => r.theme))]) {
  const rs = rows.filter((r) => r.theme === theme);
  const hit1 = rs.filter((r) => r.ranked[0] === theme).length;
  const hit3 = rs.filter((r) => r.ranked.slice(0, 3).includes(theme)).length;
  const hitAny = rs.filter((r) => r.ranked.includes(theme)).length;
  const missed = new Map<string, number>();
  for (const r of rs) if (r.ranked[0] !== theme) missed.set(r.ranked[0] ?? "-", (missed.get(r.ranked[0] ?? "-") ?? 0) + 1);
  const top = [...missed].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(", ");
  console.log(`${theme.padEnd(14)} | ${String(rs.length).padStart(2)} | ${String(hit1).padStart(5)} | ${String(hit3).padStart(5)} | ${String(hitAny).padStart(3)} | ${DETECTABLE.has(theme as never) ? "yes" : "no "}        | ${top}`);
  t1 += hit1; t3 += hit3; any += hitAny; n += rs.length;
}
console.log(`\ntotal ${n}: top-1 ${t1} (${(100 * t1 / n).toFixed(0)}%), top-3 ${t3} (${(100 * t3 / n).toFixed(0)}%), any ${any} (${(100 * any / n).toFixed(0)}%)`);
