// LOCAL RESEARCH ONLY (#896 task 4): every reference object in the stored clauses and what derive's
// resolver (`packages/tagger/src/derive/references.ts`) points it at. Prints the counts and writes one
// line per reference to docs/measurements/card-grammar/references-<label>.jsonl, so a resolver change
// is diffed reference by reference (H3): `npx tsx research/tagger/reference-census.ts <label>`.
//
// CEILING: reads the stored clauses as the model wrote them, before derive's mode-header trigger
// inheritance (#846), so a mode bullet's reference shows the bullet's own trigger.
import { mkdirSync, writeFileSync } from "node:fs";
import { connect, loadConfig } from "@edh-seer/data";
import { antecedentIsSelf, antecedentSource, antecedentText, exiledAcrossClauses, PRONOUN_OBJECT } from "../../packages/tagger/src/derive/references.js";
import { isSelfSubject, SELF_REFERENCE } from "../../packages/tagger/src/derive/self-reference.js";

const label = process.argv[2] ?? "current";
const TYPED = /^(?:that|those) (?:creature|permanent|spell|token|land|artifact|enchantment|planeswalker|card|player|opponent)s?$/i;
const s = await connect(loadConfig());
const rows: string[] = [];
const by: Record<string, number> = {}, events: Record<string, [number, string[]]> = {};
for await (const d of s.db.collection("cardClauses").find({ isToken: { $ne: true } }, { projection: { name: 1, canonical: 1 } }) as any) {
  let lastExiled: string | undefined;
  for (const raw of d.canonical ?? []) {
    const r = exiledAcrossClauses(raw, lastExiled, d.name);
    lastExiled = r.lastExiled;
    const actions = r.clause.actions ?? [];
    actions.forEach((a: any, i: number) => {
      const printed = (raw.actions?.[i]?.object ?? "").trim();
      const o = (a.object ?? "").trim();
      let kind: string, text: string | undefined;
      if (o !== printed) { kind = "earlier clause"; text = o; }
      else if (PRONOUN_OBJECT.test(o)) {
        const src = antecedentSource(actions, i, r.clause.trigger?.subject, d.name as string);
        const t = (r.clause.trigger?.subject ?? "").trim();
        const selfTrigger = SELF_REFERENCE.test(t) || isSelfSubject(t, d.name);
        kind = antecedentIsSelf(actions, i, d.name) ? "self (action)" : src.to === "trigger" && selfTrigger ? "self (trigger)" : src.to === "action" ? "this clause" : src.to;
        text = antecedentText(actions, src, r.clause.trigger?.subject, "");
      } else if (TYPED.test(o)) { kind = "typed (controller only)"; }
      else return;
      by[kind] = (by[kind] ?? 0) + 1;
      if (kind === "trigger") {
        const k = `${r.clause.trigger?.event} -> ${a.verb}`;
        const e = (events[k] ??= [0, []]); e[0]++; if (e[1].length < 3) e[1].push(`${d.name}: ${o}`);
      }
      rows.push(JSON.stringify({ card: d.name, clause: raw.id, action: i, object: printed, kind, text: text ?? null, event: r.clause.trigger?.event ?? null, verb: a.verb }));
    });
  }
}
await s.close();
mkdirSync("docs/measurements/card-grammar", { recursive: true });
rows.sort();
writeFileSync(`docs/measurements/card-grammar/references-${label}.jsonl`, rows.join("\n") + "\n");
console.log(`${rows.length} references:`, by);
console.log("resolved to the trigger's subject, by event -> verb:");
for (const [k, [n, ex]] of Object.entries(events).sort((a, b) => b[1][0] - a[1][0]).slice(0, 20)) console.log(String(n).padStart(6), k.padEnd(32), ex.join(" | "));
