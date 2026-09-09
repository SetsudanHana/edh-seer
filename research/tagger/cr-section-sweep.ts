/** THE FULLER SWEEP: every section of the Comprehensive Rules, with our coverage verdict.
 *
 *  Everything found before this was found because someone THOUGHT OF IT — a section I happened to
 *  pick, or a mechanic the owner happened to name (adventure, omen, initiative, firebending). That is
 *  still luck, one level up from reading cards one at a time. The 700s are where the game puts its
 *  per-mechanic rules — Saga is 714, Adventure 715, Omen 720, the monarch 725 — so enumerating the
 *  section list turns "did we miss a mechanic?" into a finite checklist that can be ticked.
 *
 *  Each section carries a hand-written STATUS. A section with NO status is reported as UNREVIEWED and
 *  the bin exits non-zero: when WotC adds section 734, it shows up here rather than being discovered
 *  a year later by a wrong edge. Free, read-only.
 *
 *  Reads the committed `cr-keywords.json`; regenerate it with `gen-cr-keywords.ts` after a rules
 *  update. */
import { connect, loadConfig } from "@edh-seer/data";
import crKeywords from "../../packages/tagger/src/derive/cr-keywords.json" with { type: "json" };

import { SECTIONS as STATUS, type Status, type Verdict } from "../../packages/tagger/src/derive/cr-sections.js";

// Reads the COMMITTED section list, not the gitignored rules cache, so it runs in a fresh clone.
const sections = crKeywords.sections.map((s) => [s.rule, s.name] as [string, string]);
const file = `cr-keywords.json (rules ${crKeywords.version})`;

const store = await connect(loadConfig());
const count = async (s: Status): Promise<number | null> => {
  if (s.probe) return store.cards.countDocuments({ oracleText: s.probe } as never);
  if (s.typeLine) return store.cards.countDocuments({ typeLine: s.typeLine } as never);
  if (s.layout) return store.cards.countDocuments({ layout: s.layout } as never);
  return null;
};

console.log(`${file}\nCR 7xx sections: ${sections.length}\n`);
const unreviewed: string[] = [];
const rows: { rule: string; name: string; v: Verdict; n: number | null; note: string }[] = [];
for (const [rule, name] of sections) {
  const s = STATUS[rule];
  if (!s) { unreviewed.push(`${rule}. ${name}`); continue; }
  rows.push({ rule, name, v: s.verdict, n: await count(s), note: s.note });
}

for (const v of ["OPEN", "PARTIAL", "MODELLED", "N/A"] as Verdict[]) {
  const group = rows.filter((r) => r.v === v).sort((a, b) => (b.n ?? -1) - (a.n ?? -1));
  console.log(`=== ${v} (${group.length}) ===`);
  for (const r of group) {
    console.log(`  ${r.rule}. ${r.name.padEnd(28)} ${r.n === null ? "" : `${String(r.n).padStart(5)} cards`}  ${r.note}`);
  }
  console.log();
}

if (unreviewed.length) {
  console.log(`\nUNREVIEWED (${unreviewed.length}) — cr-sections.test.ts fails on these too:\n  ${unreviewed.join("\n  ")}`);
  await store.close(); process.exit(1);
}
console.log(`judged: ${rows.length} of ${sections.length} sections. Rank the OPEN rows above by their card counts.`);
await store.close();
process.exit(0);
