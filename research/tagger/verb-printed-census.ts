// LOCAL RESEARCH ONLY (#1321 phase 1): census, per stored ACTION, of the verb the clause was filed under against the PRINTED text of the action's own clause.
// FREE: reads Mongo (cards, cardClauses, cardTagsDerived), writes nothing, changes no derive output. ~1 min (the blast-radius pass re-derives each flagged card once).
// An action is "misfiled" when its clause (reminder text stripped) prints NONE of the verb's words (`WORDS` below: FLIP_VERB_WORDS + the verb's first word + legitimate paraphrase).
// Which records are read follows what derive used: a card whose derived row says `clauseSource: "grammar"` is read from `grammarClauseRecords`, every other from `cardClauses.canonical`.
// Blast radius: re-derive the card with the one action removed; "emits" = emits lost, "kinds" = abilities / effect kinds lost.
// Run from the repo root after `set -a && source packages/tagger/.env && set +a`:
//   npx tsx research/tagger/verb-printed-census.ts [--examples 3] [--dump <verb>] [--no-blast]
import { connect, loadConfig } from "@edh-seer/data";
import { clauseCosts, clauseTexts, deriveInputOf } from "../../packages/tagger/src/derive-input.js";
import { deriveCardTags } from "../../packages/tagger/src/derive/derive.js";
import { GUARDED_VERBS, guardExempt, verbPrint } from "../../packages/tagger/src/derive/verb-words.js";
import { grammarClauseRecords } from "../../packages/tagger/src/grammar/clause-record.js";
import type { CardTags } from "../../packages/tagger/src/schema.js";

const args = process.argv.slice(2);
const argOf = (f: string): string | undefined => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const EXAMPLES = Number(argOf("--examples") ?? 3), DUMP = argOf("--dump"), BLAST = !args.includes("--no-blast");

const SKIP = new Set(["none", "other"]);
type Act = { verb: string; object?: string; fromZone?: string | null; toZone?: string | null };
type Rec = { id: number; abilityType?: string; actions: Act[] };
const store = await connect(loadConfig());
const derived = store.db.collection<{ oracleId: string; clauseSource?: string; isToken?: boolean }>("cardTagsDerived");
const clauseCol = store.db.collection<{ oracleId: string; canonical: Rec[] }>("cardClauses");
const rows = await derived.find({}, { projection: { oracleId: 1, clauseSource: 1, isToken: 1 } }).toArray();
const canon = new Map<string, Rec[]>();
for await (const d of clauseCol.find({}, { projection: { oracleId: 1, canonical: 1 } })) canon.set(d.oracleId, d.canonical);

type Flag = { where: "card" | "none"; source: "model" | "grammar"; name: string; oracleId: string; clause: number; k: number; verb: string; object: string; text: string; emits: number; kinds: number; lostEmits?: string[] };
const totals = { model: 0, grammar: 0, tokenRows: 0, noText: 0, noRecords: 0, exempt: 0 };
const perVerb = new Map<string, { total: number; modelTotal: number; grammarTotal: number; flags: Flag[] }>();
const flags: { flag: Flag; card: Record<string, unknown>; recs: Rec[]; readings: unknown }[] = [];

const BATCH = 500;
for (let b = 0; b < rows.length; b += BATCH) {
  const batch = rows.slice(b, b + BATCH);
  const cards = new Map<string, Record<string, unknown>>();
  for (const c of await store.cards.find({ _id: { $in: batch.map((r) => r.oracleId) } } as never).toArray()) cards.set(c._id as unknown as string, c as never);
  for (const row of batch) {
    const card = cards.get(row.oracleId);
    if (!card) { totals.tokenRows++; continue; }
    const source: "model" | "grammar" = row.clauseSource === "grammar" ? "grammar" : "model";
    let recs: Rec[] | undefined, readings: unknown;
    if (source === "grammar") { const g = grammarClauseRecords(card as never); recs = g.records as never; readings = g.readings; } else recs = canon.get(row.oracleId);
    if (!recs) { totals.noRecords++; continue; }
    const activated = new Set(recs.filter((r) => r.abilityType === "activated").map((r) => r.id));
    const texts = clauseTexts(card as never, activated), costs = clauseCosts(card as never, activated);
    for (const r of recs) {
      const text = texts[r.id];
      r.actions.forEach((a, k) => {
        if (SKIP.has(a.verb)) return;
        const v = perVerb.get(a.verb) ?? { total: 0, modelTotal: 0, grammarTotal: 0, flags: [] };
        perVerb.set(a.verb, v);
        v.total++; totals[source]++; if (source === "model") v.modelTotal++; else v.grammarTotal++;
        if (text === undefined) { totals.noText++; return; }
        const where = verbPrint(a.verb, text, costs[r.id], String(card.oracleText ?? ""));
        if (where === "own") return;
        if (where === "none" && guardExempt(a)) { totals.exempt++; return; } // a reading derive already has for it (an energy add-mana): the guard keeps it
        const stripped = (costs[r.id] ? `${costs[r.id]} : ${text}` : text).replace(/\([^()]*\)/g, " ").replace(/\s+/g, " ").trim();
        const flag: Flag = { where, source, name: String(card.name), oracleId: row.oracleId, clause: r.id, k, verb: a.verb, object: String(a.object ?? ""), text: stripped, emits: 0, kinds: 0 };
        v.flags.push(flag);
        flags.push({ flag, card, recs, readings });
      });
    }
  }
}

const emitList = (t: CardTags): string[] => t.abilities.flatMap((a) => (a.emits ?? []).map((e) => `${a.clause}:${e.verb}`));
const kindBag = (t: CardTags): Map<string, number> => { const m = new Map<string, number>(); for (const a of t.abilities) { const key = `${a.clause}:${a.effect?.kind ?? a.kind}`; m.set(key, (m.get(key) ?? 0) + 1); } return m; };
const bagDiff = (before: string[], after: string[]): string[] => { const n = new Map<string, number>(); for (const x of after) n.set(x, (n.get(x) ?? 0) + 1); return before.filter((x) => { const c = n.get(x) ?? 0; if (c > 0) { n.set(x, c - 1); return false; } return true; }); };
// Blast radius is measured on the MISFILED ("none") actions only: a clause mix-up ("card") is kept by the guard.
if (BLAST) {
  const baseCache = new Map<string, CardTags>();
  for (const { flag, card, recs, readings } of flags) {
    if (flag.where !== "none") continue;
    const input = (rs: Rec[]) => deriveInputOf(card as never, flag.oracleId, flag.name, rs as never, undefined, flag.source === "grammar" ? readings as never : undefined);
    try {
      const baseKey = `${flag.source}:${flag.oracleId}`;
      const base = baseCache.get(baseKey) ?? deriveCardTags(input(recs));
      baseCache.set(baseKey, base);
      const without = recs.map((r) => r.id === flag.clause ? { ...r, actions: r.actions.filter((_, i) => i !== flag.k) } : r);
      const after = deriveCardTags(input(without));
      const lost = bagDiff(emitList(base), emitList(after));
      flag.emits = lost.length; flag.lostEmits = lost.map((x) => x.split(":")[1]!);
      const kb = kindBag(base), ka = kindBag(after);
      for (const [key, n] of kb) flag.kinds += Math.max(0, n - (ka.get(key) ?? 0));
    } catch { flag.emits = -1; flag.kinds = -1; }
  }
}

const rank = [...perVerb.entries()].map(([verb, v]) => {
  const none = v.flags.filter((f) => f.where === "none");
  return { verb, ...v, none, mixups: v.flags.length - none.length, guarded: GUARDED_VERBS.has(verb), emits: none.reduce((n, f) => n + Math.max(0, f.emits), 0), kinds: none.reduce((n, f) => n + Math.max(0, f.kinds), 0), withBlast: none.filter((f) => f.emits > 0 || f.kinds > 0).length };
}).sort((a, b) => b.none.length - a.none.length || b.mixups - a.mixups || b.total - a.total);

if (DUMP) {
  for (const f of perVerb.get(DUMP)?.flags ?? []) console.log(`${f.where} | ${f.source} | ${f.name} [${f.clause}#${f.k}] ${f.verb} :: ${f.object} || ${f.text}${f.lostEmits?.length ? `  {lost ${[...new Set(f.lostEmits)].join(",")}}` : ""}`);
} else {
  const sum = (src: string, w?: string) => rank.reduce((n, r) => n + r.flags.filter((f) => f.source === src && (w === undefined || f.where === w)).length, 0);
  console.log(`actions scanned ${totals.model + totals.grammar} (model ${totals.model}, grammar ${totals.grammar}); misfiled (printed nowhere on the card) ${sum("model", "none") + sum("grammar", "none")} (model ${sum("model", "none")}, grammar ${sum("grammar", "none")}); clause mix-ups (printed elsewhere on the card) ${sum("model", "card") + sum("grammar", "card")}; token rows skipped ${totals.tokenRows}; no clause text ${totals.noText}; no records ${totals.noRecords}; exempt from the guard (energy add-mana, derive reads it as counter-added) ${totals.exempt}`);
  console.log(`verb | actions | misfiled (c) | mix-ups (b) | rate (c) | (c) with an emit or ability lost | emits lost | abilities lost | guarded`);
  for (const r of rank) {
    if (r.flags.length === 0) continue;
    console.log(`${r.verb} | ${r.total} | ${r.none.length} | ${r.mixups} | ${(100 * r.none.length / r.total).toFixed(1)}% | ${r.withBlast} | ${r.emits} | ${r.kinds} | ${r.guarded ? "YES" : "no"}`);
    const ex = [...r.none].sort((a, b) => (b.emits + b.kinds) - (a.emits + a.kinds) || a.name.localeCompare(b.name)).slice(0, EXAMPLES);
    for (const f of ex) console.log(`    ${f.name} [${f.source} ${f.clause}] ${f.verb} :: ${f.object.slice(0, 70)} || ${f.text.slice(0, 160)}${f.emits || f.kinds ? `  {emits ${f.emits}${f.lostEmits?.length ? ` ${[...new Set(f.lostEmits)].join("/")}` : ""}, kinds ${f.kinds}}` : ""}`);
  }
  console.log(`verbs with 0 flagged: ${rank.filter((r) => r.flags.length === 0).map((r) => `${r.verb}(${r.total})`).join(", ")}`);
}
await store.close();
