/** ONE-SHOT (edge magnitude, spec 2026-09-29 §7): coverage of `Reason.magnitude` on the 71
 *  calibration decks, and the owner's spot-check sheet -- every worked pair the spec names that the
 *  decks hold, plus a seeded draw of 20 authored producers across families.
 *
 *    npx tsx research/matcher/magnitude-coverage.ts docs/measurements/2026-09-29-edge-magnitude-v1 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { connect, loadConfig, mongoLookup, normalizeName, parseDecklistSections, resolveNames, CALIBRATION_DECKS } from "../../packages/data/src/index.js";
import { ComboIndex, type EdgeMagnitude } from "../../packages/engine/src/index.js";
import { createTagsLookup } from "../../packages/tagger/src/index.js";
import { analyzeDeckStructured, buildDeckCards, loadTokenTags } from "../../packages/matcher/src/index.js";
import { MAGNITUDE_EVENT_FAMILIES } from "../../packages/matcher/src/edge-magnitude.js";
import { rng } from "../../packages/matcher/src/goldfish.js";
import { SHEET_CSS, cardPanel, esc, sheetScript, type SheetCard } from "../../packages/instruments/src/rejudge-sheet-html.js";

const out = process.argv[2] ?? "docs/measurements/2026-09-29-edge-magnitude-v1";
mkdirSync(out, { recursive: true });
const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const tags = createTagsLookup(store.db, "derived");
const tokenTags = await loadTokenTags(store.db);
type Row = { deck: string; producer: string; consumer: string; tag: string; m: string; text: string; authored: boolean; unknown: boolean };
const rows: Row[] = [];
/** The printed card behind a reason's name, for the sheet's panels. A token node is not a deck card. */
const printed = new Map<string, SheetCard>();
const fmt = (m?: EdgeMagnitude): string =>
  !m ? "1–1" : `${m.floor}–${m.ceiling ?? "∞"}${m.scalesWith ? ` per ${m.scalesWith}` : ""}${m.instant ? " · instant" : ""}${m.batched ? " · batched" : ""}${m.unknown ? " · UNKNOWN" : ""}`;
for (const f of readdirSync(CALIBRATION_DECKS).filter((x) => x.endsWith(".txt")).sort()) {
  const sections = parseDecklistSections(readFileSync(`${CALIBRATION_DECKS}/${f}`, "utf8"));
  const { cards, combos } = await resolveNames([...sections.commanders, ...sections.deck], lookup);
  const cmd = new Set(sections.commanders.map(normalizeName));
  for (const c of cards) {
    const x = c as { name: string; manaCost?: string; typeLine?: string; colors?: string[]; oracleText?: string };
    printed.set(x.name, { name: x.name, cost: x.manaCost ?? "", typeLine: x.typeLine ?? "", colors: x.colors ?? [], oracle: x.oracleText ?? "" });
  }
  const report = analyzeDeckStructured(await buildDeckCards(cards, lookup, tags),
    cards.filter((c) => cmd.has(normalizeName(c.name))).map((c) => c.name), undefined, undefined, new ComboIndex(combos), undefined, tokenTags);
  for (const e of report.edges) for (const r of e.reasons) {
    if (!MAGNITUDE_EVENT_FAMILIES.has(r.tag.split(":")[0]!)) continue;
    rows.push({ deck: f, producer: r.producer ?? "", consumer: r.consumer ?? "", tag: r.tag,
      m: fmt(r.magnitude), text: r.text, authored: r.producerAbility !== undefined, unknown: r.magnitude?.unknown === true });
  }
}
const authored = rows.filter((r) => r.authored);
const known = authored.filter((r) => !r.unknown).length;
const byM = Object.entries(rows.reduce<Record<string, number>>((a, r) => { a[r.m] = (a[r.m] ?? 0) + 1; return a; }, {}))
  .sort((a, b) => b[1] - a[1]).slice(0, 15);
const summary = [
  `event-family reasons: ${rows.length}`,
  `authored producers: ${authored.length}; with a known count: ${known} (${(100 * known / authored.length).toFixed(1)}%); flagged unknown: ${authored.length - known}`,
  `forecast (spec §7.2): ~10,100 known of ~13,099 authored (~77%), ~2,300 flagged; more than 10 points short means the parser is wrong`,
  `by magnitude: ${byM.map(([k, n]) => `${k} ${n}`).join(" | ")}`,
].join("\n");
console.log(summary);
// ONE row per worked card the spec names, where the decks hold it -- not the first ten matches.
const WORKED = ["Grand Crescendo", "Krenko's Command", "Craterhoof Behemoth", "Wrath of God", "Avenger of Zendikar",
  "Hardened Scales", "Welcoming Vampire", "Soundwave", "Living Death", "Impact Tremors", "Purphoros", "Skullclamp"];
const worked = WORKED.map((n) => rows.find((r) => r.producer.startsWith(n) || r.consumer.startsWith(n))).filter((r): r is Row => r !== undefined);
const random = rng(20260929);
const pool = rows.filter((r) => r.authored && !worked.includes(r));
const drawn: Row[] = [];
while (drawn.length < 20 && pool.length) drawn.push(pool.splice(Math.floor(random() * pool.length), 1)[0]!);
const cell = (s: string): string => s.replace(/\|/g, "/");
const sheet = ["| # | deck | producer | consumer | tag | magnitude | reason | right? |", "|---|---|---|---|---|---|---|---|",
  ...[...worked, ...drawn].map((r, i) => `| ${i + 1} | ${r.deck.replace(".txt", "")} | ${cell(r.producer)} | ${cell(r.consumer)} | ${r.tag} | ${r.m} | ${cell(r.text)} | |`)].join("\n");
// THE JUDGING PAGE, from the shared sheet parts so it looks and exports like every other sheet.
const judged = [...worked, ...drawn];
const panel = (name: string, role: string): string =>
  cardPanel(printed.get(name) ?? { name, cost: "", typeLine: "token", colors: [], oracle: "(a token this deck makes)" }, role);
const claims = judged.map((r, i) => `
    <article class="claim" id="claim-${i}" data-index="${i}">
      <header class="claim-head">
        <span class="num">${i + 1}<span class="of">/${judged.length}</span></span>
        <div class="claim-title">
          <h2>${esc(r.producer)} <span class="arrow">&rarr;</span> ${esc(r.consumer)}</h2>
          <p class="meta"><code>${esc(r.tag)}</code> &middot; <span class="deck">${esc(r.deck.replace(".txt", ""))}</span></p>
        </div>
        <span class="state" data-state="unjudged">unjudged</span>
      </header>
      <div class="cards">${panel(r.producer, "producer")}${panel(r.consumer, "consumer")}</div>
      <div class="claim-sentence">
        <span class="ask">Is this how many times the producer fires the consumer, per use?</span>
        <p class="sentence magnitude">${esc(r.m)}</p>
        <p class="meta">${esc(r.text)}</p>
      </div>
      <div class="verdicts" role="group" aria-label="Verdict for row ${i + 1}">
        <button type="button" class="v v-real" data-v="right">right</button>
        <button type="button" class="v v-false" data-v="wrong">wrong</button>
        <button type="button" class="v v-uncertain" data-v="unsure">unsure</button>
        <input type="text" class="why" placeholder="what it should be (optional)" aria-label="Note for row ${i + 1}" />
      </div>
    </article>`).join("");
const LINE = `    function line(i) {
      return JSON.stringify({ deck: rows[i].deck, producer: rows[i].producer, consumer: rows[i].consumer, tag: rows[i].tag,
        magnitude: rows[i].m, verdict: verdicts[i], note: notes[i] || "" });
    }
`;
writeFileSync(`${out}/sheet.html`, `<title>Edge magnitude check</title>
${SHEET_CSS}
<style>
  .state[data-state="right"] { color: var(--real); border-color: var(--real); }
  .state[data-state="wrong"] { color: var(--false); border-color: var(--false); }
  .state[data-state="unsure"] { color: var(--uncertain); border-color: var(--uncertain); }
  .sentence.magnitude { font-family: var(--mono); font-size: 1.35rem; }
</style>
<div class="wrap">
  <header class="masthead">
    <div>
      <span class="kicker">edge magnitude v1 &middot; spot-check</span>
      <h1>${judged.length} links, each with how many times the producer fires the consumer</h1>
      <p class="sub">Judge the <em>number</em>: floor&ndash;ceiling per use (&infin; = unbounded, with what it scales with),
        <em>instant</em> when the producer can act at instant speed, <em>batched</em> when a "one or more" payoff hears the
        batch once, <em>UNKNOWN</em> when no amount was recorded (read as 1). Not whether the link should exist.</p>
    </div>
  </header>
  ${claims}
</div>
<div class="out"><details><summary>JSONL output</summary><pre id="json">judge a row to start</pre></details></div>
<div class="dock">
  <span class="progress"><span id="done">0</span> / ${judged.length}</span>
  <span class="bar"><i id="fill"></i></span>
  <button type="button" id="copy" disabled>copy JSONL</button>
  <button type="button" class="ghost" id="reset">reset</button>
</div>
<script id="rows" type="application/json">${JSON.stringify(judged.map((r) => ({ deck: r.deck.replace(".txt", ""), producer: r.producer, consumer: r.consumer, tag: r.tag, m: r.m }))).replace(/</g, "\\u003c")}</script>
${sheetScript(LINE)}
`);
writeFileSync(`${out}/RESULT.md`, `# Edge magnitude v1 — coverage\n\n\`\`\`\n${summary}\n\`\`\`\n`);
writeFileSync(`${out}/sheet.md`, `# Edge magnitude — owner spot-check\n\nMark each row right or wrong. A wrong row is a parser or composition defect.\n\n${sheet}\n`);
await store.close();
