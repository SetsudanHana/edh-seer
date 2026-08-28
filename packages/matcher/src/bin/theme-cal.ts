/** Re-derives BASELINE_CAP over packages/cli/decks/calibration (71 decks). For each candidate cap
 *  it records the top-2 themes every deck selects, then reports how many decks CHANGE ANSWER
 *  versus the previous cap. A trustworthy cap sits on a PLATEAU — a band where that number is 0.
 *  The IDF floor this replaces was trusted for exactly that reason (2.2 and 2.5 were identical)
 *  and was still overfit, so also print the per-deck answers for eyeballing. */
import { readFileSync, readdirSync } from "node:fs";
import { connect, loadConfig, mongoLookup, resolveNames, parseDecklistSections, normalizeName } from "@edh-seer/data";
import { ComboIndex } from "@edh-seer/engine";
import type { CardTags } from "@edh-seer/tagger";
import { analyzeDeckStructured, buildDeckCards, type CardTagsLookup } from "../index.js";
import { themeMembership, themeCandidates } from "../themes.js";

const CAPS = [0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7];
const dir = process.argv[2] ?? "packages/cli/decks/calibration";

const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const cardTagsCol = store.db.collection<CardTags>("cardTags");
const tagsLookup: CardTagsLookup = { findOne: (oracleId) => cardTagsCol.findOne({ oracleId }) };

// Resolve every deck once; only the cap varies, and resolution is the slow part.
const decks: { name: string; cards: Awaited<ReturnType<typeof buildDeckCards>>; report: ReturnType<typeof analyzeDeckStructured> }[] = [];
for (const file of readdirSync(dir).filter((f) => f.endsWith(".txt")).sort()) {
  const sections = parseDecklistSections(readFileSync(`${dir}/${file}`, "utf8"));
  const { cards, combos } = await resolveNames([...sections.commanders, ...sections.deck], lookup);
  const cmdNorm = new Set(sections.commanders.map(normalizeName));
  const commanderNames = cards.filter((c) => cmdNorm.has(normalizeName(c.name))).map((c) => c.name);
  const deckCards = await buildDeckCards(cards, lookup, tagsLookup);
  const report = analyzeDeckStructured(deckCards, commanderNames, undefined, undefined, new ComboIndex(combos));
  decks.push({ name: file.replace(/\.txt$/, ""), cards: deckCards, report });
}
await store.close();

/** The deck's top-2 themes at a given cap: axis order, statics dropped, unselective tags skipped,
 *  and a floor of 5 members so a 2-card coincidence can't name the deck. */
function topThemes(d: (typeof decks)[number], cap: number): string[] {
  const axisOrder = (d.report.axis ?? []).map((a) => a.tag);
  const reasons = d.report.edges.flatMap((e) => e.reasons);
  const byTag = new Map(
    themeMembership(d.cards, reasons, themeCandidates(axisOrder), cap).map((t) => [t.tag, t]),
  );
  const out: string[] = [];
  for (const tag of axisOrder) {
    const t = byTag.get(tag);
    if (!t || !t.selective || t.members.length < 5) continue;
    out.push(tag);
    if (out.length === 2) break;
  }
  return out;
}

let previous: string[][] | null = null;
for (const cap of CAPS) {
  const answers = decks.map((d) => topThemes(d, cap));
  const changed = previous ? answers.filter((a, i) => a.join("|") !== previous![i].join("|")).length : NaN;
  const empty = answers.filter((a) => a.length === 0).length;
  console.log(`cap ${cap.toFixed(2)}  changed-vs-previous ${String(changed).padStart(3)}  decks-with-no-theme ${empty}`);
  previous = answers;
}

// Per-deck answers at the incumbent cap, for the named assertions in Step 4.
console.log("\n--- per deck @ 0.55 ---");
for (const d of decks) console.log(`${d.name.padEnd(46)} ${topThemes(d, 0.55).join(", ") || "(none)"}`);
