/** THE LAST AXIS: what card text can narrow a subject BY, against what `SubjectFilter` can express.
 *
 *  Every previous sweep took a closed list from somewhere — TRIGGERS, VERBS, CR 701, CR 7xx sections,
 *  EFFECT_KINDS — and diffed it. There is no closed list of subject qualifiers anywhere in the rules,
 *  so this one is driven from the CORPUS: count how often each way of narrowing a subject is printed,
 *  and mark whether `SubjectFilter` has a slot for it.
 *
 *  This axis matters more than its size suggests. Subject WIDTH is historically this engine's largest
 *  false-edge source — `legendary` (09ce98d), `basic` (D), `keyword` (2026-08-14) and `notKeyword`
 *  (2026-08-15) were each added because a missing slot let a subject reach the whole deck.
 *
 *  Free, read-only. Counts are corpus-wide, per the vocabulary ruling: the derived corpus is 2,541
 *  cards of the owner's own decks and a slot is sized against every card we hold. */
import { connect, loadConfig } from "@edh-seer/data";
import { DERIVED_COLLECTION } from "../clause-store.js";

const store = await connect(loadConfig());
const derivedIds = new Set((await store.db.collection(DERIVED_COLLECTION).find({}).project({ oracleId: 1 }).toArray())
  .map((d) => (d as unknown as { oracleId: string }).oracleId));

/** `have` names the SubjectFilter field, or null when there is no slot at all. */
const QUALIFIERS: { text: string; probe: RegExp; have: string | null }[] = [
  // --- covered, listed so the sweep reports coverage rather than only gaps
  { text: "card type", probe: /\btarget (creature|artifact|enchantment|land)\b/i, have: "type" },
  { text: "colour", probe: /\b(white|blue|black|red|green) (creature|permanent|spell)\b/i, have: "colors" },
  { text: "power/toughness predicate", probe: /power \d|toughness \d|power (or less|or greater)/i, have: "stats" },
  { text: "mana value predicate", probe: /mana value \d|mana value (or less|or greater)/i, have: "stats" },
  { text: "a counter on it", probe: /with a .{0,18}counter on (it|them)/i, have: "counter" },
  { text: "legendary", probe: /\blegendary\b/i, have: "legendary" },
  { text: "basic", probe: /\bbasic land\b/i, have: "basic" },
  { text: "token / nontoken", probe: /\bnontoken\b|\btoken\b/i, have: "token" },
  { text: "with [keyword]", probe: /\bwith (flying|trample|deathtouch|lifelink|vigilance)\b/i, have: "keyword" },
  { text: "without [keyword]", probe: /\bwithout (flying|first strike)\b/i, have: "notKeyword" },

  // --- the candidates
  { text: "TAPPED / UNTAPPED state", probe: /\b(tapped|untapped) (creature|artifact|permanent|land|token)/i, have: null },
  { text: "ATTACKING / BLOCKING state", probe: /\b(attacking|blocking) (creature|permanent)\b/i, have: null },
  { text: "named [card name]", probe: /\bnamed [A-Z]/, have: null },
  { text: "a COMMANDER", probe: /\b(a |your )commanders?\b(?! damage)/i, have: null },
  { text: "FACE-DOWN", probe: /\bface-down\b|\bface down\b/i, have: null },
  { text: "MODIFIED (CR 700.9)", probe: /\bmodified\b/i, have: null },
  { text: "OUTLAW (CR 700.12)", probe: /\boutlaws?\b/i, have: null },
  { text: "SNOW supertype", probe: /\bsnow\b/i, have: null },
  { text: "ENCHANTED / EQUIPPED (the aura or Equipment host)", probe: /\b(enchanted|equipped) (creature|permanent|land|artifact)\b/i, have: null },
  { text: "MONSTROUS / SUSPECTED / GOADED status", probe: /\b(monstrous|suspected|goaded)\b/i, have: null },
  { text: "cast or entered THIS TURN", probe: /(cast|entered) (the battlefield )?this turn/i, have: null },
  { text: "MULTICOLORED / MONOCOLORED", probe: /\bmulticolored\b|\bmonocolored\b/i, have: null },
];

const rows: { text: string; have: string | null; corpus: number; derived: number }[] = [];
for (const q of QUALIFIERS) {
  const cards = await store.cards.find({ oracleText: q.probe } as never).project({ _id: 1 })
    .toArray() as unknown as { _id: string }[];
  rows.push({ text: q.text, have: q.have, corpus: cards.length, derived: cards.filter((c) => derivedIds.has(c._id)).length });
}

const show = (label: string, filter: (r: typeof rows[number]) => boolean) => {
  console.log(`\n=== ${label} ===`);
  for (const r of rows.filter(filter).sort((a, b) => b.corpus - a.corpus)) {
    console.log(`  ${String(r.corpus).padStart(5)} corpus / ${String(r.derived).padStart(3)} derived   ${r.text}${r.have ? `   [${r.have}]` : ""}`);
  }
};
show("NO SLOT — a subject narrowed this way derives WIDER than printed", (r) => r.have === null);
show("covered", (r) => r.have !== null);

await store.close();
process.exit(0);
