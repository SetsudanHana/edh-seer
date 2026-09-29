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

const out = process.argv[2] ?? "docs/measurements/2026-09-29-edge-magnitude-v1";
mkdirSync(out, { recursive: true });
const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const tags = createTagsLookup(store.db, "derived");
const tokenTags = await loadTokenTags(store.db);
type Row = { deck: string; producer: string; consumer: string; tag: string; m: string; text: string; authored: boolean; unknown: boolean };
const rows: Row[] = [];
const fmt = (m?: EdgeMagnitude): string =>
  !m ? "1–1" : `${m.floor}–${m.ceiling ?? "∞"}${m.scalesWith ? ` per ${m.scalesWith}` : ""}${m.instant ? " · instant" : ""}${m.batched ? " · batched" : ""}${m.unknown ? " · UNKNOWN" : ""}`;
for (const f of readdirSync(CALIBRATION_DECKS).filter((x) => x.endsWith(".txt")).sort()) {
  const sections = parseDecklistSections(readFileSync(`${CALIBRATION_DECKS}/${f}`, "utf8"));
  const { cards, combos } = await resolveNames([...sections.commanders, ...sections.deck], lookup);
  const cmd = new Set(sections.commanders.map(normalizeName));
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
writeFileSync(`${out}/RESULT.md`, `# Edge magnitude v1 — coverage\n\n\`\`\`\n${summary}\n\`\`\`\n`);
writeFileSync(`${out}/sheet.md`, `# Edge magnitude — owner spot-check\n\nMark each row right or wrong. A wrong row is a parser or composition defect.\n\n${sheet}\n`);
await store.close();
