/** Diff the game's OWN vocabulary against ours, from the Comprehensive Rules. Free, read-only.
 *
 *  Every gap this project has found so far came from a witness — someone read a card and noticed a
 *  wrong answer. That finds defects one at a time and only in families somebody happened to look at.
 *  The CR enumerates the closed lists the game actually has, so a diff finds gaps BY CONSTRUCTION.
 *
 *  Three CR sections carry named game concepts:
 *    700.x  general concepts   — dies, historic, party, outlaw, modified, crime, expend, descended
 *    701.x  keyword ACTIONS    — what a card tells you to DO (verbs)
 *    702.x  keyword ABILITIES  — what a card HAS (keywords)
 *
 *  Ranked by CORPUS DEMAND, never by rule count. The keyword sweep of 2026-08-14 got its top three
 *  wrong by ranking on printed cards, and this project's standing rule is to count the consumers.
 *
 *  READ THE 700.x BLOCK; TREAT 701/702 AS CANDIDATES ONLY. The CR writes English ("Create",
 *  "Counter", "Exile") while our vocabularies use engine spellings ("create-token", "counter-added",
 *  a zone on the verb), so a literal diff reports covered concepts as gaps. The 701/702 rows below
 *  are therefore an UPPER BOUND needing manual reconciliation, and their top entries — Counter 6185,
 *  Play 5776, Create 4191 — are exactly that artifact rather than real holes. 700.x has no such
 *  problem: those concepts are named nowhere in our vocabularies under any spelling.
 *
 *  Requires the cached rules text: `tsx src/bin/fetch-comp-rules.ts` first. */
import { readFileSync, readdirSync } from "node:fs";
import { connect, loadConfig } from "@mtg/data";
import { TRIGGERS } from "../normalize-prompt.js";
import { VERB_VOCAB } from "../schema.js";
import { KEYWORD_ABILITIES } from "../derive/subtypes.js";

const dir = ".cr-cache";
const file = readdirSync(dir).filter((f) => f.endsWith(".txt")).sort().pop();
if (!file) throw new Error(`no cached rules in ${dir} — run fetch-comp-rules.ts first`);
const cr = readFileSync(`${dir}/${file}`, "utf8");
console.log(`rules: ${file}\n`);

/** A section heading is the rule number followed by a SHORT title — "701.4. Behold". A rule that
 *  continues into prose ("700.1. Anything that happens...") is not a heading, so cap the length. */
const headings = (prefix: string): { rule: string; term: string }[] =>
  [...cr.matchAll(new RegExp(`^(${prefix}\\.\\d+)\\. (.{2,40})$`, "gm"))]
    .map((m) => ({ rule: m[1], term: m[2].trim() }))
    .filter((h) => !/[.,;:]$/.test(h.term));

/** 700.x defines its concepts in prose, so pull the NOUN each rule is about from its own phrasing —
 *  "Some cards refer to X", "The term X means", "A player commits a crime as..." */
const concepts700 = [...cr.matchAll(/^(700\.\d+)\. (.{20,400}?)(?:\.|$)/gm)]
  .map((m) => ({ rule: m[1], text: m[2] }))
  .map(({ rule, text }) => {
    const t = text.match(/[Ss]ome cards refer to (?:whether a player has [“"])?([a-z' \[\]]+?)(?:[”"]|\.|,| this turn| permanents| creatures|$)/)
      ?? text.match(/The term ([a-z\[\]]+)/)
      ?? text.match(/A player'?s? ([a-z]+) (?:to|consists)/)
      ?? text.match(/Some abilities trigger [“"]Whenever you ([a-z]+)/);
    return { rule, term: t?.[1]?.trim() ?? "", text };
  })
  .filter((c) => c.term !== "");

const store = await connect(loadConfig());
/** How many corpus cards print the term at all. Supply-side interest; 0 means the game has the
 *  concept and no card we hold uses it, which is a real answer. */
const demand = async (term: string): Promise<number> => {
  // Match the STEM, since the CR titles a concept in the gerund ("committing a crime") while cards
  // print the conjugated verb ("commits a crime"). Without this, 700.13 read as 0 corpus cards
  // against a true 21.
  const stem = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").split(/\s+/)[0].replace(/(ing|ed|s)$/, "");
  return store.cards.countDocuments({ oracleText: new RegExp(`\\b${stem}`, "i") } as never);
};

const ours = new Set<string>([
  ...TRIGGERS, ...VERB_VOCAB, ...KEYWORD_ABILITIES,
].map((t) => String(t).toLowerCase()));
/** Our words are hyphenated engine spellings ("gain-life", "counter-added"); the CR writes English. */
const known = (term: string): boolean => {
  const t = term.toLowerCase();
  return ours.has(t) || ours.has(t.replace(/\s+/g, "-")) || [...ours].some((o) => o.replace(/-/g, " ") === t);
};

for (const [label, rows] of [
  ["700.x GENERAL CONCEPTS", concepts700],
  ["701.x KEYWORD ACTIONS", headings("701")],
  ["702.x KEYWORD ABILITIES", headings("702")],
] as [string, { rule: string; term: string }[]][]) {
  const gaps: { rule: string; term: string; n: number }[] = [];
  for (const r of rows) {
    if (known(r.term)) continue;
    gaps.push({ rule: r.rule, term: r.term, n: await demand(r.term) });
  }
  console.log(`=== ${label} — ${rows.length} in the rules, ${gaps.length} not matched by a LITERAL diff ===`);
  if (label.startsWith("701") || label.startsWith("702")) {
    console.log(`  (upper bound: our spellings differ from the CR's English, so covered concepts appear here)`);
  }
  for (const g of gaps.sort((a, b) => b.n - a.n)) {
    if (g.n === 0) continue;
    console.log(`  ${String(g.n).padStart(5)} cards  ${g.rule.padEnd(8)} ${g.term}`);
  }
  const silent = gaps.filter((g) => g.n === 0);
  console.log(`  (${silent.length} more with ZERO corpus cards: ${silent.map((g) => g.term).slice(0, 14).join(", ")}${silent.length > 14 ? ", …" : ""})\n`);
}

await store.close();
process.exit(0);
