/** Every trigger line in the WHOLE corpus, bucketed by whether TRIGGERS can spell it. Free.
 *
 *  THE DERIVED CORPUS IS NOT THE CORPUS. `cardTagsDerived` covers the 2,541 cards in the 71
 *  calibration decks; `cards` holds ~34,000. Ranking a vocabulary gap by derived-corpus demand
 *  measures which mechanics the owner's current decks happen to play, which is the wrong question:
 *  a word costs nothing to add now and costs a re-ask of every affected card to add later, so the
 *  list should be built for any deck someone brings.
 *
 *  Owner's ruling, 2026-08-15. Every "N derived" figure quoted before this bin existed understates
 *  the case for a word, sometimes by two orders of magnitude. */
import { connect, loadConfig } from "@mtg/data";
import { TRIGGERS } from "../normalize-prompt.js";

const store = await connect(loadConfig());

/** A printed phrase for each TRIGGERS member — how a CARD says the event, not how we spell it.
 *  Deliberately loose: this asks "can the vocabulary express this line at all", so a near match is a
 *  yes and the residue is what matters. */
const SPELLABLE: [string, RegExp][] = [
  ["enters", /\benters?\b|enters the battlefield/i],
  ["dies", /\bdies\b|put into a graveyard from the battlefield/i],
  ["leaves", /\bleaves?\b|\bleave\b/i],
  ["attacks", /\battacks?\b/i],
  ["blocks", /\bblocks?\b/i],
  ["taps", /\bbecomes? tapped\b|\btaps?\b/i],
  ["untaps", /\buntaps?\b|becomes? untapped/i],
  ["cast", /\bcasts?\b/i],
  ["upkeep", /\bupkeep\b/i],
  ["begin-combat", /beginning of combat/i],
  ["end-step", /\bend step\b/i],
  ["draw", /\bdraws?\b/i],
  ["draw-step", /\bdraw step\b/i],
  ["main-phase", /\bmain phase\b/i],
  ["combat-damage-step", /combat damage step/i],
  ["damage-dealt", /\bdamage\b/i],
  ["life-gained", /\bgains? \d|\bgains? life\b/i],
  ["life-lost", /\bloses? \d|\bloses? life\b/i],
  ["counter-added", /\bcounters?\b/i],
  ["sacrificed", /\bsacrific/i],
  ["discarded", /\bdiscards?\b/i],
  ["milled", /\bmills?\b|put into .{0,20}graveyard from .{0,15}library/i],
  ["turned-face-up", /turned face up|turns? face up/i],
  ["level-up", /\blevel\b/i],
  ["chapter", /\blore counter\b/i],
  ["proliferate", /\bproliferate/i],
  ["search", /\bsearch(es)?\b/i],
  ["becomes-target", /becomes? the target/i],
  ["scry", /\bscr(y|ies)\b/i],
  ["surveil", /\bsurveils?\b/i],
  ["unlocked", /\bunlocks?\b/i],
  ["transform", /\btransforms?\b/i],
  // The batch under consideration, so its corpus-wide reach can be read off the same table.
  ["copy (NEW)", /\bcopy\b|\bcopies\b/i],
  ["crime (NEW)", /commits? a crime/i],
  ["expend (NEW)", /\bexpends?\b/i],
  ["descended (NEW)", /\bdescended\b/i],
  ["day-night (NEW)", /becomes? night|becomes? day/i],
  ["dice-rolled (NEW)", /rolls? .{0,12}dic?e|\bdie roll/i],
  ["dungeon-completed (NEW)", /completes? a dungeon/i],
  ["monarch (NEW)", /becomes? the monarch/i],
  ["ring-tempts (NEW)", /Ring tempts you|Ring-bearer/i],
  ["clash (NEW)", /\bclash\b/i],
];

const cards = await store.cards.find({ oracleText: /^(when|whenever|at the beginning)/im } as never)
  .project({ name: 1, oracleText: 1 }).toArray() as unknown as { name: string; oracleText?: string }[];

const hits = new Map<string, number>();
const residue: { name: string; line: string }[] = [];
let lines = 0;
for (const c of cards) {
  for (const raw of (c.oracleText ?? "").split("\n")) {
    const line = raw.trim();
    if (!/^(when|whenever|at the beginning)/i.test(line)) continue;
    lines++;
    // Only the trigger HEAD — what fires it. Past the first comma is the effect, whose words would
    // otherwise satisfy nearly every pattern above.
    const head = line.slice(0, line.includes(", ") ? line.indexOf(", ") : line.length);
    const matched = SPELLABLE.filter(([, re]) => re.test(head)).map(([name]) => name);
    if (matched.length === 0) { residue.push({ name: c.name, line: head.slice(0, 110) }); continue; }
    for (const m of matched) hits.set(m, (hits.get(m) ?? 0) + 1);
  }
}

console.log(`corpus cards with a trigger line: ${cards.length}\ntrigger lines: ${lines}\n`);
console.log(`=== reach of each TRIGGERS member, WHOLE CORPUS (a line can match more than one) ===`);
for (const [k, n] of [...hits].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(6)}  ${k}`);
console.log(`\n  members with ZERO corpus lines: ${TRIGGERS.filter((t) => !hits.has(t) && !["other", "none"].includes(t)).join(", ")}`);

console.log(`\n=== RESIDUE — trigger heads no member can spell: ${residue.length} lines ===`);
const words = new Map<string, number>();
for (const r of residue) {
  for (const w of r.line.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/)) {
    if (w.length < 4 || ["when", "whenever", "this", "that", "your", "with", "from", "each", "they", "their", "you"].includes(w)) continue;
    words.set(w, (words.get(w) ?? 0) + 1);
  }
}
console.log(`  most common words in the residue:`);
for (const [w, n] of [...words].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(`    ${String(n).padStart(5)}  ${w}`);
console.log(`\n  sample residue lines:`);
for (const r of residue.slice(0, 25)) console.log(`    ${r.name}: ${r.line}`);

await store.close();
process.exit(0);
