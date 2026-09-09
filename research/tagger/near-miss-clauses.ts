/** AC3: for every bought card whose trigger line prints a near-miss reading, what EVENT did the
 *  stored clause record? Baral's shape ("counters a spell" -> counter-added), measured for the whole
 *  family instead of one witness. Free, read-only. */
import { connect, loadConfig } from "@edh-seer/data";
import { CLAUSES_COLLECTION, type CardClausesDoc } from "../../packages/tagger/src/clause-store.js";
const store = await connect(loadConfig());
const FAMILIES: [string, RegExp][] = [
  ["counters a spell", /(when|whenever)[^.]{0,60}\bcounters? (a|that|target|one or more)? ?spell|(when|whenever)[^.]{0,40}\b(is|are) countered/i],
  ["counter removed", /(when|whenever)[^.]{0,60}\b(remove|removed)\b[^.]{0,30}\bcounters?\b|(when|whenever)[^.]{0,60}\bcounters? [^.]{0,20}(is|are) removed/i],
  ["mana spent/paid", /(when|whenever)[^.]{0,40}\b(spend|spent|pay|pays|paid)\b[^.]{0,30}(mana|\{|cost)/i],
  ["unattached", /(when|whenever)[^.]{0,40}\bunattached/i],
  ["renowned", /(when|whenever)[^.]{0,40}\brenowned/i],
  ["plotted", /(when|whenever)[^.]{0,40}\bplot/i],
  ["returned to hand", /(when|whenever)[^.]{0,50}\b(returned|return) [^.]{0,30}\bhand/i],
  ["state trigger", /(when|whenever)[^.]{0,30}\b(control|have|has) (no|fewer|more|seven|\d)|(when|whenever) there (are|is) (no|\w+ or more|\w+ or fewer)/i],
  ["foretell", /(when|whenever)[^.]{0,40}\bforetell/i],
  ["tapped for mana", /(when|whenever)[^.]{0,40}\btapped for mana/i],
  ["play a land", /(when|whenever)[^.]{0,40}\bplays? a land/i],
  ["exiled (passive)", /(when|whenever)[^.]{0,50}\b(is|are) (put into exile|exiled)\b/i],
  ["gains control", /(when|whenever)[^.]{0,40}\bgains? control/i],
  ["becomes target", /(when|whenever)[^.]{0,40}\bbecomes? the target/i],
  ["extra turn", /(when|whenever)[^.]{0,40}\bextra turn/i],
  ["when you do", /\bwhen you do\b/i],
  // The second round (2026-09-09): families judged NOT a word, kept so the reading can be re-checked.
  ["mana added (trigger head)", /(when|whenever)[^.]{0,60}\b(adds?|causes? [^.]{0,20} to add)\b[^.]{0,10}(one or more )?(mana|\{[WUBRGC])/i],
  ["resolves", /(when|whenever)[^.]{0,40}\bresolves?\b/i],
  ["loses the game", /(when|whenever)[^.]{0,40}\bloses? the game/i],
  ["is dealt damage", /(when|whenever)[^.]{0,60}\b(is|are) dealt/i],
  ["becomes saddled", /(when|whenever)[^.]{0,40}\bbecomes? saddled/i],
  ["put into library (trigger)", /(when|whenever)[^.]{0,50}\bput (on top of|into|on the bottom of) [^.]{0,15}librar/i],
  ["stickers", /(when|whenever)[^.]{0,40}\bsticker/i],
];
const docs = await store.db.collection<CardClausesDoc>(CLAUSES_COLLECTION).find({}).toArray();
const byId = new Map(docs.map((d) => [String(d.oracleId), d]));
const cards = await store.cards.find({ "legalities.commander": "legal" } as never, { projection: { name: 1, oracleText: 1 } }).toArray() as unknown as { _id: unknown; name: string; oracleText?: string }[];
for (const [label, re] of FAMILIES) {
  const events = new Map<string, string[]>();
  let printed = 0, bought = 0;
  for (const c of cards) {
    const text = (c.oracleText ?? "").replace(/\([^)]*\)/g, "");
    if (!re.test(text)) continue;
    printed++;
    const d = byId.get(String(c._id));
    if (!d) continue;
    bought++;
    const evs = [...new Set(d.canonical.map((cl) => cl.trigger?.event).filter(Boolean))] as string[];
    const key = evs.join("+") || "(no trigger recorded)";
    events.set(key, [...(events.get(key) ?? []), c.name]);
  }
  console.log(`\n=== ${label}: ${printed} printed, ${bought} bought ===`);
  for (const [k, v] of [...events].sort((a, b) => b[1].length - a[1].length))
    console.log(`  ${String(v.length).padStart(4)}  ${k.padEnd(40)} ${v.slice(0, 4).join(" · ")}`);
}
// "you get {E}" is an ACTION (CR 107.14: an energy counter). What verb did the bought clauses use?
const energy = new Map<string, number>();
for (const d of docs) for (const cl of d.canonical) for (const a of cl.actions ?? []) {
  if (/\{E\}|energy/i.test(a.object ?? "")) energy.set(a.verb ?? "?", (energy.get(a.verb ?? "?") ?? 0) + 1);
}
console.log("\n=== energy actions by verb (should be add-counter) ===", [...energy]);
await store.close(); process.exit(0);
