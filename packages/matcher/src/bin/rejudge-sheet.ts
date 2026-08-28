import { join } from "node:path";
/** A JUDGING SHEET FOR ONE FAMILY, with the facts that family's verdict actually turns on. Free.
 *
 *  `panel-score.ts --worksheet` writes producer/consumer/tag/claim plus ORACLE TEXT only, and that
 *  is not enough for every family: a cost-reduction judgement turns on the consumer's COLOUR, TYPE
 *  and MANA COST, which the owner had to look up by hand on 2026-08-19. This joins them.
 *
 *  It also carries the CACHED verdict and who made it, because the reason to re-judge is usually
 *  that the rubric moved: the 9 `static:cost-reduction` falses were judged by Claude when cost
 *  reduction was excluded as "a deck role, not a synergy", and the owner OVERTURNED that on
 *  2026-08-18 — the same producers now carry the owner's own REAL verdicts on other consumers.
 *
 *  Writes two files from one pass:
 *    <out>.md     — the sheet to read and judge from
 *    <out>.jsonl  — the same rows as PanelVerdict records with `verdict` BLANK.
 *
 *  **DO NOT DROP THE BLANK FILE INTO `docs/measurements/panel/`.** `panel-build.ts` folds in every
 *  file matching `verdicts-*.jsonl` BY PREFIX, so an unfilled sheet would merge empty verdicts into
 *  the cache. Fill it first, then rename it to `verdicts-<name>.jsonl` and rebuild. The sheet ships
 *  under `docs/measurements/` without the prefix for exactly that reason.
 *
 *    npx tsx packages/matcher/src/bin/rejudge-sheet.ts --tag static:cost-reduction --verdict false \
 *      --out /tmp/cost-reduction-rejudge
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { connect, loadConfig, mongoLookup, normalizeName, parseDecklistSections, resolveNames, scratchDir } from "@edh-seer/data";
import { ComboIndex } from "@edh-seer/engine";
import { createTagsLookup } from "@edh-seer/tagger";
import { analyzeDeckStructured, buildDeckCards, loadTokenTags } from "../index.js";
import { renderSheet } from "./rejudge-sheet-html.js";
import { claimFor } from "./precision-core.js";

const arg = (f: string): string | undefined => {
  const i = process.argv.indexOf(f);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const TAG = arg("--tag");
const WANT = arg("--verdict") ?? "false";
const OUT = arg("--out") ?? scratchDir("rejudge-sheet");
const PANEL = "docs/measurements/panel";
const DECKS = "packages/cli/decks/calibration";

interface Cached { producer: string; consumer: string; tag: string; verdict: string; cause?: string; note?: string }
const cache = new Map<string, Cached>();
for (const line of readFileSync(`${PANEL}/verdicts.jsonl`, "utf8").split("\n")) {
  if (!line.trim()) continue;
  const v = JSON.parse(line) as Cached;
  cache.set(`${v.producer}|${v.consumer}|${v.tag}`, v);
}

const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const tags = createTagsLookup(store.db, "derived");
const tokenTags = await loadTokenTags(store.db);
const cards = store.db.collection<{ name: string; oracleText?: string; typeLine?: string; manaCost?: string; colors?: string[] }>("cards");

/** Live claims, with the deck each was seen in — the deck is what makes a claim checkable. */
const live = new Map<string, { producer: string; consumer: string; tag: string; decks: Set<string> }>();
for (const file of readdirSync(DECKS).filter((f) => f.endsWith(".txt")).sort()) {
  const sections = parseDecklistSections(readFileSync(`${DECKS}/${file}`, "utf8"));
  const { cards: cs, combos } = await resolveNames([...sections.commanders, ...sections.deck], lookup);
  const cmd = new Set(sections.commanders.map(normalizeName));
  const deckCards = await buildDeckCards(cs, lookup, tags);
  const report = analyzeDeckStructured(
    deckCards, cs.filter((c) => cmd.has(normalizeName(c.name))).map((c) => c.name),
    undefined, undefined, new ComboIndex(combos), undefined, tokenTags,
  );
  for (const e of report.edges) for (const r of e.reasons) {
    if (!r.producer || !r.consumer) continue;
    if (TAG && r.tag !== TAG) continue;
    const key = `${r.producer}|${r.consumer}|${r.tag}`;
    const cached = cache.get(key);
    if (!cached || cached.verdict !== WANT) continue;
    const row = live.get(key) ?? { producer: r.producer, consumer: r.consumer, tag: r.tag, decks: new Set<string>() };
    row.decks.add(file.replace(/\.txt$/, ""));
    live.set(key, row);
  }
}

const names = [...new Set([...live.values()].flatMap((r) => [r.producer, r.consumer]))];
const docs = await cards.find({ name: { $in: names } }).toArray();
const card = new Map(docs.map((d) => [d.name, d]));
const fmt = (n: string): string => {
  const d = card.get(n);
  if (!d) return `**${n}** — (not in the corpus)`;
  return `**${n}** — \`${d.manaCost ?? "—"}\` · ${d.typeLine ?? "?"} · colours ${d.colors?.length ? d.colors.join("") : "none"}`;
};

const rows = [...live.values()].sort((a, b) => a.producer.localeCompare(b.producer));
const md: string[] = [
  `# Re-judge sheet — ${TAG ?? "all tags"}, cached verdict \`${WANT}\``, "",
  `${rows.length} live claims. Each row carries what this family's judgement turns on — the`,
  "consumer's MANA COST, TYPE LINE and COLOURS — which the plain worksheet does not.", "",
  "Fill the `verdict` field in the .jsonl beside this file (`real` / `false` / `uncertain`), then",
  "drop it into `docs/measurements/panel/` as `verdicts-<name>.jsonl` and rebuild.", "",
];
for (const [i, r] of rows.entries()) {
  const c = cache.get(`${r.producer}|${r.consumer}|${r.tag}`)!;
  const authored = (c.note ?? "").startsWith("USER VERDICT") ? "OWNER" : "Claude";
  md.push(`## ${i + 1}. ${r.producer} → ${r.consumer}`, "",
    `- tag \`${r.tag}\` · seen in: ${[...r.decks].join(", ")}`,
    `- cached: **${c.verdict}** by ${authored}${c.cause ? ` (cause: ${c.cause})` : ""}`,
    `- note: ${(c.note ?? "").trim() || "—"}`, "",
    `- producer ${fmt(r.producer)}`,
    `  > ${String(card.get(r.producer)?.oracleText ?? "").replace(/\n/g, "\n  > ")}`, "",
    `- consumer ${fmt(r.consumer)}`,
    `  > ${String(card.get(r.consumer)?.oracleText ?? "").replace(/\n/g, "\n  > ")}`, "");
}
writeFileSync(`${OUT}.md`, `${md.join("\n")}\n`);

// AND AN INTERACTIVE SHEET, because judging 10 claims in a text file means holding the verdict
// vocabulary and the JSONL shape in your head while reading oracle text. The page carries the same
// facts, one claim at a time, and writes the JSONL itself. Self-contained: no fonts, no scripts, no
// styles fetched from anywhere, so it renders under a strict CSP.
const payload = rows.map((r) => {
  const c = cache.get(`${r.producer}|${r.consumer}|${r.tag}`)!;
  const facts = (n: string) => {
    const d = card.get(n);
    return { name: n, cost: d?.manaCost ?? "", typeLine: d?.typeLine ?? "", colors: d?.colors ?? [], oracle: d?.oracleText ?? "" };
  };
  return {
    producer: facts(r.producer), consumer: facts(r.consumer), tag: r.tag,
    // THE SENTENCE BEING JUDGED. The first cut of the sheet did not show it at all — the cached note
    // sat where the claim belonged, so the last thing read before clicking was Claude's OLD
    // reasoning. `Calibrate.tsx` had the answer already: it hides the engine's reasons until asked,
    // because seeing what the engine believes anchors the verdict to it.
    claim: claimFor(r.tag, r.producer, r.consumer),
    decks: [...r.decks], cachedVerdict: c.verdict, cause: c.cause ?? "",
    judgedBy: (c.note ?? "").startsWith("USER VERDICT") ? "owner" : "Claude",
    note: (c.note ?? "").replace(/^USER VERDICT[^.]*\.\s*/, "").trim(),
  };
});
writeFileSync(`${OUT}.html`, renderSheet(payload, TAG ?? "all tags", WANT));
console.log(`${rows.length} rows -> ${OUT}.md, ${OUT}.jsonl and ${OUT}.html`);
writeFileSync(`${OUT}.jsonl`, `${rows.map((r) => JSON.stringify({
  producer: r.producer, consumer: r.consumer, tag: r.tag,
  verdict: "", cause: "", note: "USER VERDICT (cost-reduction re-judge, 2026-08-20). ",
})).join("\n")}\n`);
process.exit(0);
