/** FREE, throwaway. Live false claims of one cause, with FULL oracle text on both sides.
 *  Written because judging on truncated text produced 12 wrong verdicts in one family. */
import { existsSync, readFileSync } from "node:fs";
import {
  connect, loadConfig, mongoLookup, normalizeName, parseDecklistSections, resolveNames,
} from "@edh-seer/data";
import { ComboIndex } from "@edh-seer/engine";
import { createTagsLookup } from "@edh-seer/tagger";
import { analyzeDeckStructured, buildDeckCards, type CardTagsLookup } from "../index.js";
import type { PanelVerdict } from "./panel-core.js";

// Filter by CAUSE, or by TAG family with "tag:<verb>" -- the false set is now concentrated by tag
// (graveyard-recursion is 33 claims spread across two causes) rather than by cause alone.
const WANT = process.argv[2] ?? "false-care";
const TAG = WANT.startsWith("tag:") ? WANT.slice(4) : undefined;
const FROM = Number(process.argv[3] ?? 0);
const N = Number(process.argv[4] ?? 12);
const PANEL = "docs/measurements/panel";
const DECKS = "packages/cli/decks/calibration";
const pairs = (JSON.parse(readFileSync(`${PANEL}/pairs.json`, "utf8")) as { pairs: { producer: string; consumer: string; deck: string }[] }).pairs;
const cache = new Map(readFileSync(`${PANEL}/verdicts.jsonl`, "utf8").split("\n").filter((l) => l.trim())
  .map((l) => JSON.parse(l) as PanelVerdict).map((v) => [`${v.producer}|${v.consumer}|${v.tag}`, v]));

const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const tags: CardTagsLookup = createTagsLookup(store.db, "derived");
const byDeck = new Map<string, Set<string>>();
for (const p of pairs) {
  if (!byDeck.has(p.deck)) byDeck.set(p.deck, new Set());
  byDeck.get(p.deck)!.add(`${p.producer}|${p.consumer}`);
}
const oracle = new Map<string, string>();
const seen = new Set<string>();
const hits: PanelVerdict[] = [];
for (const [deck, want] of byDeck) {
  const file = `${DECKS}/${deck}.txt`;
  if (!existsSync(file)) continue;
  const sections = parseDecklistSections(readFileSync(file, "utf8"));
  const { cards, combos } = await resolveNames([...sections.commanders, ...sections.deck], lookup);
  for (const c of cards) oracle.set(c.name, (c as { oracleText?: string }).oracleText ?? "");
  const cmd = new Set(sections.commanders.map(normalizeName));
  const report = analyzeDeckStructured(
    await buildDeckCards(cards, lookup, tags),
    cards.filter((c) => cmd.has(normalizeName(c.name))).map((c) => c.name),
    undefined, undefined, new ComboIndex(combos),
  );
  for (const e of report.edges) for (const r of e.reasons) {
    if (!r.producer || !r.consumer || !want.has(`${r.producer}|${r.consumer}`)) continue;
    const k = `${r.producer}|${r.consumer}|${r.tag}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const v = cache.get(k);
    if (v?.verdict !== "false") continue;
    if (TAG ? r.tag.split(":")[0] === TAG : v.cause === WANT) hits.push(v);
  }
}
console.log(`${WANT}: ${hits.length} live; showing ${FROM}..${FROM + N}\n`);
for (const v of hits.slice(FROM, FROM + N)) {
  console.log(`### [${v.tag}] ${v.producer}  ->  ${v.consumer}   (${v.cause})`);
  console.log(`  NOTE: ${v.note}`);
  console.log(`  P: ${(oracle.get(v.producer) ?? "").replace(/\n/g, " / ")}`);
  console.log(`  C: ${(oracle.get(v.consumer) ?? "").replace(/\n/g, " / ")}\n`);
}
await store.close();
