/** FREE. Re-scores the frozen panel against the CURRENT engine. Run after every change.
 *
 *  Spec: `docs/superpowers/specs/2026-08-05-edge-precision-measurement-design.md` §23-24.
 *
 *  This is the paired replacement for fresh sampling. The pairs never change, so a difference between
 *  two runs is the ENGINE, not a new draw of the dice — which is what three consecutive "no
 *  measurable change" verdicts and one 6-point move on an untouched population were really saying.
 *
 *  Prints precision on the panel, and the JUDGING DEBT: claims the engine makes today that no verdict
 *  covers. The debt is the honest part. A change that adds claims cannot flatter itself, because its
 *  new claims count as owed rather than as real, and the precision figure is explicitly conditional
 *  on the debt being small.
 *
 *  Usage: tsx src/bin/panel-score.ts [--worksheet out.jsonl] */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  connect, loadConfig, mongoLookup, normalizeName, parseDecklistSections, resolveNames,
} from "@mtg/data";
import { ComboIndex } from "@mtg/engine";
import { createTagsLookup } from "@mtg/tagger";
import { analyzeDeckStructured, buildDeckCards, type CardTagsLookup } from "../index.js";
import { claimFor } from "./precision-core.js";
import { scorePanel, wilsonPanel, type PanelClaim, type PanelVerdict } from "./panel-core.js";

const PANEL = "docs/measurements/panel";
const DECKS = "packages/cli/decks/calibration";
const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : undefined;
};

const pairs = (JSON.parse(readFileSync(`${PANEL}/pairs.json`, "utf8")) as {
  pairs: { producer: string; consumer: string; deck: string }[];
}).pairs;
const cache = readFileSync(`${PANEL}/verdicts.jsonl`, "utf8").split("\n")
  .filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as PanelVerdict);

const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const tags: CardTagsLookup = createTagsLookup(store.db, "derived");

// Scored DECK BY DECK through `analyzeDeckStructured`, the same entry point the sampling instrument
// used and the same one the product uses. Calling `pairReasons` directly skips the deck-level passes
// -- chosenType resolution above all, which picks the deck's dominant subtype -- and a panel that
// skips them measures something adjacent to the engine rather than the engine. Found the hard way:
// the chosenType fix moved nothing until this was corrected.
const wantedByDeck = new Map<string, Set<string>>();
for (const p of pairs) {
  if (!wantedByDeck.has(p.deck)) wantedByDeck.set(p.deck, new Set());
  wantedByDeck.get(p.deck)!.add(`${p.producer}|${p.consumer}`);
}

const current: PanelClaim[] = [];
const oracle = new Map<string, string>();
let missingDecks = 0;
for (const [deck, want] of wantedByDeck) {
  const file = `${DECKS}/${deck}.txt`;
  if (!existsSync(file)) { missingDecks++; continue; }
  const sections = parseDecklistSections(readFileSync(file, "utf8"));
  const { cards, combos } = await resolveNames([...sections.commanders, ...sections.deck], lookup);
  for (const c of cards) oracle.set(c.name, (c as { oracleText?: string }).oracleText ?? "");
  const cmd = new Set(sections.commanders.map(normalizeName));
  const deckCards = await buildDeckCards(cards, lookup, tags);
  const report = analyzeDeckStructured(
    deckCards, cards.filter((c) => cmd.has(normalizeName(c.name))).map((c) => c.name),
    undefined, undefined, new ComboIndex(combos),
  );
  for (const e of report.edges) {
    for (const r of e.reasons) {
      if (!r.producer || !r.consumer) continue;
      if (!want.has(`${r.producer}|${r.consumer}`)) continue;
      current.push({ producer: r.producer, consumer: r.consumer, tag: r.tag });
    }
  }
}

// One claim, one verdict, one count. `pairReasons` can return the same (producer, consumer, tag)
// twice -- two reasons differing only by effectKind, the known display-layer duplicate -- and the
// panel keys verdicts by claim, so counting both would weight that claim double for no reason.
// (The sampling instrument counted reasons, duplicates included; the panel counts claims. The two
// measures are therefore not identical, which is one more reason not to compare their levels.)
const seenClaim = new Set<string>();
const distinct = current.filter((c) => {
  const k = `${c.producer}|${c.consumer}|${c.tag}`;
  if (seenClaim.has(k)) return false;
  seenClaim.add(k);
  return true;
});
console.log(`  (${current.length - distinct.length} duplicate claims collapsed)`);

const s = scorePanel(distinct, cache);
const [lo, hi] = wilsonPanel(s.real, s.real + s.false);
console.log(`frozen panel — ${pairs.length} pairs, ${cache.length} cached verdicts`);
if (missingDecks) console.log(`  decks not found: ${missingDecks}`);
console.log(`  claims the engine makes on the panel today: ${distinct.length}`);
console.log(`  real ${s.real} | false ${s.false} | uncertain ${s.uncertain}`);
console.log(`  PRECISION ${s.precision === null ? "n/a" : `${(s.precision * 100).toFixed(1)}% [${lo.toFixed(1)}, ${hi.toFixed(1)}]`}`);
console.log(`  judging DEBT (claims with no verdict): ${s.unjudged.length}`);
// The debt is not a footnote: until it is judged, precision is only bounded. Printing the bound
// stops the headline being read as settled when a third of the claims are unaccounted for.
if (s.unjudged.length) {
  const worst = s.real / (s.real + s.false + s.unjudged.length);
  const best = (s.real + s.unjudged.length) / (s.real + s.false + s.unjudged.length);
  console.log(`    -> until it is judged, true panel precision is bounded [${(worst * 100).toFixed(1)}, ${(best * 100).toFixed(1)}]`);
}
console.log(`  cached verdicts the engine no longer claims: ${s.dropped}`);

const out = arg("--worksheet");
if (out && s.unjudged.length) {
  writeFileSync(out, `${s.unjudged.map((c, id) => JSON.stringify({
    id, producer: c.producer, consumer: c.consumer, tag: c.tag,
    claim: claimFor(c.tag, c.producer, c.consumer),
    producerOracle: oracle.get(c.producer) ?? "", consumerOracle: oracle.get(c.consumer) ?? "",
  })).join("\n")}\n`);
  console.log(`\n  wrote the debt as a worksheet -> ${out}`);
}
await store.close();
