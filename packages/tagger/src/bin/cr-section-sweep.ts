/** THE FULLER SWEEP: every section of CR 7xx "Additional Rules", with our coverage verdict.
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
import { connect, loadConfig } from "@mtg/data";
import crKeywords from "../derive/cr-keywords.json" with { type: "json" };

type Verdict = "MODELLED" | "PARTIAL" | "OPEN" | "N/A";
interface Status { verdict: Verdict; note: string; probe?: RegExp; typeLine?: RegExp; layout?: string }

/** One row per CR 7xx section. `probe` counts the corpus cards the section can reach, so an OPEN row
 *  carries its own size and the list can be ranked rather than merely listed. */
const STATUS: Record<string, Status> = {
  "700": { verdict: "PARTIAL", note: "general concepts; modified/outlaw/party/descended still unmodelled as subject filters" },
  "701": { verdict: "MODELLED", note: "keyword actions — complete + ratcheted by cr-completeness.test.ts" },
  "702": { verdict: "PARTIAL", note: "keyword abilities — 6 short of the CR, ratcheted as MTGJSON_LAG" },
  "703": { verdict: "OPEN", note: "turn-based actions — never swept" },
  "704": { verdict: "PARTIAL", note: "state-based actions — Sagas closed 2026-08-15, legend rule / 0-loyalty / poison open" },
  "705": { verdict: "OPEN", note: "coin flips — no event, no vocabulary", probe: /flips? a coin/i },
  "706": { verdict: "PARTIAL", note: "dice — `dice-rolled` trigger added 2026-08-15, no effect model", probe: /rolls? a d/i },
  "707": { verdict: "PARTIAL", note: "copying — `copy` verb and trigger exist; no model of what a copy IS" },
  "708": { verdict: "OPEN", note: "face-down spells/permanents — manifest and cloak emit `enters`, nothing knows they are face down", probe: /face down/i },
  "709": { verdict: "MODELLED", note: "split cards — playableFaces lists both halves", layout: "split" },
  "710": { verdict: "MODELLED", note: "flip cards — FRONT_FACE_ONLY allow-list", layout: "flip" },
  "711": { verdict: "PARTIAL", note: "leveler cards — `level-up` trigger exists, level bands unmodelled", layout: "leveler" },
  "712": { verdict: "MODELLED", note: "double-faced cards — DERIVE_VERSION 30, one face at a time" },
  "713": { verdict: "N/A", note: "substitute cards are a physical-play convenience" },
  "714": { verdict: "MODELLED", note: "Saga — sagaEvents ships the 714.4 self-sacrifice", typeLine: /Saga/ },
  "715": { verdict: "OPEN", note: "Adventurer — 715.3d exile-then-playable unmodelled; 715.4 zone types WRONG (see gap-sweep stub §3.2)", layout: "adventure" },
  "716": { verdict: "OPEN", note: "Class cards — class levels unmodelled entirely", typeLine: /Class/ },
  "717": { verdict: "N/A", note: "Attractions live in a separate deck, never the 99" },
  "718": { verdict: "OPEN", note: "Prototype — alternative cost AND different characteristics, the adventure shape again", probe: /\bPrototype\b/i },
  "719": { verdict: "OPEN", note: "Case cards — solve condition unmodelled", typeLine: /— Case/ },
  "720": { verdict: "OPEN", note: "Omen — 720.3d shuffles into library, never a graveyard; unmodelled" },
  "721": { verdict: "MODELLED", note: "Station — charge counters via KEYWORD_EMITS" },
  "722": { verdict: "PARTIAL", note: "Preparation cards — playableFaces lists the faces, the prepare mechanic itself is unmodelled", layout: "prepare" },
  "723": { verdict: "N/A", note: "controlling another player — 2 corpus cards, no synergy shape" },
  "724": { verdict: "OPEN", note: "ending turns and phases — 'end the turn' skips everything, invisible to the clock model", probe: /end the turn/i },
  "725": { verdict: "MODELLED", note: "monarch — trigger word added 2026-08-15" },
  "726": { verdict: "MODELLED", note: "initiative — trigger word added 2026-08-15" },
  "727": { verdict: "N/A", note: "restarting the game — 2 corpus cards" },
  "728": { verdict: "MODELLED", note: "rad counters — already in COUNTER_KINDS", probe: /rad counter/i },
  "729": { verdict: "N/A", note: "subgames — Shahrazad and friends, not EDH-relevant" },
  "730": { verdict: "OPEN", note: "merging with permanents — mutate; a merged permanent is several cards in one", probe: /\bmutate\b/i },
  "731": { verdict: "MODELLED", note: "day and night — trigger word added 2026-08-15" },
  "732": { verdict: "N/A", note: "taking shortcuts is a play convention" },
  "733": { verdict: "N/A", note: "handling illegal actions is a judge procedure" },
};

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
  console.error(`UNREVIEWED SECTIONS — the rules gained a mechanic nobody has judged:\n  ${unreviewed.join("\n  ")}`);
  await store.close();
  process.exit(1);
}
console.log(`every 7xx section has a verdict.`);
await store.close();
process.exit(0);
