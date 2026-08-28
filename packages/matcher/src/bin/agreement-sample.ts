/** Draws the blinded worksheet for the JUDGE-AGREEMENT measurement, and scores it afterwards.
 *  Spec: `docs/superpowers/specs/2026-08-06-judge-agreement-design.md`, registered before drawing.
 *
 *  FREE: no API key, no model, no spend.
 *
 *  Every precision number this project reports is denominated in ONE judge's verdicts, and that
 *  judge is Claude. §22–23 re-judged 150 claims and agreed 150/150, pre-registered as uninformative:
 *  a judge agreeing with itself measures nothing. This draws claims the engine makes TODAY, strips
 *  the cached verdict, and asks the user — the authority — to judge them cold. A disagreement is the
 *  judge's error by definition.
 *
 *  Stratified by MY OWN cached verdict, because the measured bias is directional and the two
 *  columns have different registered thresholds (REAL ≤8%, FALSE ≤10%).
 *
 *  Writes:
 *    <out>/worksheet.jsonl   what gets judged — two cards, full oracle text, and NO verdict
 *    <out>/sheet.html        the same rows as ONE SELF-CONTAINED PAGE that writes the JSONL itself
 *    <out>/key.json          the cached verdict per id, sealed until judgments are on disk
 *
 *  Usage:
 *    tsx src/bin/agreement-sample.ts [--real 45] [--false 35] [--seed N] [--out DIR]
 *                                    [--round r4] [--exclude a.jsonl,b.jsonl] [--keep-owner]
 *    tsx src/bin/agreement-sample.ts --score DIR      # after DIR/verdicts.jsonl exists
 *
 *  **ROWS THE OWNER HAS ALREADY JUDGED ARE DROPPED BY DEFAULT, and that is stronger than
 *  `--exclude`.** Re-showing a claim the judge has seen measures their memory, not their rubric —
 *  and the cache now carries owner verdicts from three blind rounds, a false-stratum CENSUS and
 *  several family re-judges, which no list of worksheet files covers. `--keep-owner` restores the
 *  old file-list-only behaviour. `--exclude` still takes prior worksheets, comma-separated.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  connect, loadConfig, mongoLookup, normalizeName, parseDecklistSections, resolveNames, scratchDir } from "@edh-seer/data";
import { ComboIndex } from "@edh-seer/engine";
import { createTagsLookup } from "@edh-seer/tagger";
import { analyzeDeckStructured, buildDeckCards, type CardTagsLookup } from "../index.js";
import { claimFor } from "./precision-core.js";
import { sample, seededRng } from "./precision-core.js";
import { renderAgreementSheet, type AgreementRow } from "./agreement-sheet-html.js";
import { scoreStratum } from "./agreement-core.js";
import type { PanelVerdict } from "./panel-core.js";

const PANEL = "docs/measurements/panel";
const DECKS = "packages/cli/decks/calibration";
const arg = (flag: string, fallback: string): string => {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const SCORE = arg("--score", "");
const N_REAL = Number(arg("--real", "45"));
const N_FALSE = Number(arg("--false", "35"));
const SEED = Number(arg("--seed", "20260806"));
const OUT = arg("--out", scratchDir("agreement"));
const ROUND = arg("--round", "round 4");
const EXCLUDE = arg("--exclude", "");
const KEEP_OWNER = process.argv.includes("--keep-owner");

if (SCORE !== "") {
  // SCORING IS IN THE SAME FILE AS THE DRAW ON PURPOSE: round 3 committed its scorer before the
  // answers existed, and a scorer that ships with the draw cannot be written to fit them.
  const key = (JSON.parse(readFileSync(join(SCORE, "key.json"), "utf8")) as { cached: Record<string, string> }).cached;
  const jsonl = (f: string) => readFileSync(join(SCORE, f), "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
  const rows = new Map<number, { producer: string; consumer: string; tag: string }>(
    jsonl("worksheet.jsonl").map((r) => [r.id as number, r as { producer: string; consumer: string; tag: string }]),
  );
  const human = new Map<number, { verdict: string; note: string }>(
    jsonl("verdicts.jsonl").map((r) => [r.id as number, { verdict: String(r.verdict), note: String(r.note ?? "") }]),
  );
  console.log(`judged ${human.size} | key ${Object.keys(key).length}`);
  const pct = (r: number, n: number) => (n === 0 ? "—" : `${r.toFixed(1)}%`);
  for (const stratum of ["real", "false"] as const) {
    const s = scoreStratum(stratum, key, new Map([...human].map(([i, v]) => [i, v.verdict])));
    console.log(`\n${stratum.toUpperCase()} stratum n=${s.n}: strict ${pct(s.strictRate, s.n)} (${s.strict}/${s.n}) [${s.strictBound[0].toFixed(1)}, ${s.strictBound[1].toFixed(1)}]  lenient ${pct(s.lenientRate, s.lenientN)} (${s.lenient}/${s.lenientN}) [${s.lenientBound[0].toFixed(1)}, ${s.lenientBound[1].toFixed(1)}]  partial=${s.partial}`);
    for (const i of s.disagreed) {
      const r = rows.get(i)!;
      console.log(`  #${String(i).padEnd(3)}${human.get(i)!.verdict.padEnd(8)} ${r.producer} -> ${r.consumer} [${r.tag}]`);
      const note = human.get(i)!.note;
      if (note) console.log(`        ${note.slice(0, 160)}`);
    }
  }
  process.exit(0);
}

/** Claims already judged in an earlier draw. Re-showing one measures memory, not rubric. */
const seenBefore = new Set<string>(
  EXCLUDE === "" ? [] : EXCLUDE.split(",").flatMap((f) =>
    readFileSync(f.trim(), "utf8").split("\n").filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as { producer: string; consumer: string; tag: string })
      .map((r) => `${r.producer}|${r.consumer}|${r.tag}`)),
);

const pairs = (JSON.parse(readFileSync(`${PANEL}/pairs.json`, "utf8")) as {
  pairs: { producer: string; consumer: string; deck: string }[];
}).pairs;
const cache = readFileSync(`${PANEL}/verdicts.jsonl`, "utf8").split("\n")
  .filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as PanelVerdict);
// Later verdicts win, matching how panel-core resolves the cache.
const verdictOf = new Map<string, PanelVerdict>();
for (const v of cache) verdictOf.set(`${v.producer}|${v.consumer}|${v.tag}`, v);

const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const tags: CardTagsLookup = createTagsLookup(store.db, "derived");
interface Facts { name: string; cost: string; typeLine: string; colors: string[]; oracle: string }
const facts = new Map<string, Facts>();

/** Every claim the engine makes on the panel today, deduped, with its cached verdict attached. */
interface Claim { producer: string; consumer: string; tag: string; verdict: string; implied: boolean; decks: Set<string> }
const claims = new Map<string, Claim>();
const byDeck = new Map<string, { producer: string; consumer: string }[]>();
for (const p of pairs) {
  if (!byDeck.has(p.deck)) byDeck.set(p.deck, []);
  byDeck.get(p.deck)!.push({ producer: p.producer, consumer: p.consumer });
}
let ownerSkipped = 0;
for (const [deck, wanted] of byDeck) {
  const sections = parseDecklistSections(readFileSync(join(DECKS, `${deck}.txt`), "utf8"));
  const { cards, combos } = await resolveNames([...sections.commanders, ...sections.deck], lookup);
  for (const c of cards) {
    facts.set(c.name, {
      name: c.name, cost: c.manaCost ?? "", typeLine: c.typeLine ?? "",
      colors: c.colors ?? [], oracle: c.oracleText ?? "",
    });
  }
  const commanders = cards
    .filter((c) => new Set(sections.commanders.map(normalizeName)).has(normalizeName(c.name)))
    .map((c) => c.name);
  const dc = await buildDeckCards(cards, lookup, tags);
  const report = analyzeDeckStructured(dc, commanders, undefined, undefined, new ComboIndex(combos));
  const want = new Set(wanted.map((w) => `${w.producer}|${w.consumer}`));
  for (const e of report.edges) {
    for (const r of e.reasons) {
      if (!r.producer || !r.consumer) continue;
      const undirected = want.has(`${r.producer}|${r.consumer}`) || want.has(`${r.consumer}|${r.producer}`);
      if (!undirected) continue;
      const key = `${r.producer}|${r.consumer}|${r.tag}`;
      const v = verdictOf.get(key);
      if (!v || (v.verdict !== "real" && v.verdict !== "false")) continue;
      if (seenBefore.has(key)) continue;
      // A verdict the OWNER already made is not a blind row: it is their own answer read back.
      if (!KEEP_OWNER && (v.note ?? "").startsWith("USER VERDICT")) { ownerSkipped++; continue; }
      const row = claims.get(key) ?? { producer: r.producer, consumer: r.consumer, tag: r.tag, verdict: v.verdict, implied: r.impliedProducer === true, decks: new Set<string>() };
      row.decks.add(deck);
      claims.set(key, row);
    }
  }
}

const all = [...claims.values()];
const pool = {
  real: all.filter((c) => c.verdict === "real"),
  false: all.filter((c) => c.verdict === "false"),
};
console.log(`unseen judged claims the engine still makes: real ${pool.real.length} | false ${pool.false.length}`
  + (EXCLUDE ? ` (excluding ${seenBefore.size} from prior worksheets)` : "")
  + (KEEP_OWNER ? "" : ` (excluding ${ownerSkipped} owner-judged)`));

const rng = seededRng(SEED);
const drawn = [...sample(pool.real, N_REAL, rng), ...sample(pool.false, N_FALSE, rng)];
// Shuffle so the worksheet order carries no signal about which stratum a row came from.
for (let i = drawn.length - 1; i > 0; i--) {
  const j = Math.floor(rng() * (i + 1));
  [drawn[i], drawn[j]] = [drawn[j], drawn[i]];
}

const blank: Facts = { name: "", cost: "", typeLine: "", colors: [], oracle: "" };
const sheet: AgreementRow[] = drawn.map((c, id) => ({
  id, tag: c.tag, decks: [...c.decks],
  producer: { ...(facts.get(c.producer) ?? blank), name: c.producer },
  consumer: { ...(facts.get(c.consumer) ?? blank), name: c.consumer },
  claim: claimFor(c.tag, c.producer, c.consumer, c.implied),
}));

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "worksheet.jsonl"), `${drawn.map((c, id) => JSON.stringify({
  id, producer: c.producer, consumer: c.consumer, tag: c.tag,
  claim: claimFor(c.tag, c.producer, c.consumer, c.implied),
  producerOracle: facts.get(c.producer)?.oracle ?? "",
  consumerOracle: facts.get(c.consumer)?.oracle ?? "",
})).join("\n")}\n`);
writeFileSync(join(OUT, "sheet.html"), renderAgreementSheet(sheet, ROUND));
writeFileSync(join(OUT, "key.json"), `${JSON.stringify({
  seed: SEED, round: ROUND, drawnAt: new Date().toISOString(),
  cached: Object.fromEntries(drawn.map((c, id) => [id, c.verdict])),
}, null, 1)}\n`);

console.log(`drew ${drawn.length} rows -> ${OUT}/sheet.html (judge here), ${OUT}/worksheet.jsonl, cached verdicts sealed in ${OUT}/key.json`);
await store.close();
