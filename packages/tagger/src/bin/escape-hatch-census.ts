/** WHAT THE CLAUSE LAYER STILL CANNOT SAY. Free, read-only.
 *
 *  `normalize-corpus.ts` has always ended its own doc comment with "whatever still says `other` is
 *  the next punch list", and nothing printed that list. This does.
 *
 *  Two escape hatches, counted apart because they are fixed by DIFFERENT vocabularies and the
 *  2026-08-15 ruling that split `VOCAB_VERSION` from `TRIGGER_VOCAB_VERSION` is the same
 *  distinction: an `other` ACTION wants a VERBS member, an `other` TRIGGER wants a TRIGGERS member,
 *  and a card stuck on one is not helped by adding to the other.
 *
 *  READ THE OBJECTS BEFORE RANKING A GAP. This file exists because counting the cards says only how
 *  big the hole is, never what shape it is — and this project has three separate records of a
 *  vocabulary item being mis-ranked by counting instead of reading. */
import { connect, loadConfig } from "@mtg/data";
import { CLAUSES_COLLECTION } from "../clause-store.js";

const store = await connect(loadConfig());
const docs = await store.db.collection(CLAUSES_COLLECTION).find({}).toArray() as unknown as {
  name: string;
  normalizeVersion: number;
  canonical?: { abilityType?: string; trigger?: { event?: string }; actions?: { verb?: string; object?: string }[] }[];
}[];

interface Hit { name: string; object: string; version: number }
const actions: Hit[] = [];
const triggers: Hit[] = [];
for (const d of docs) {
  for (const c of d.canonical ?? []) {
    if (c.trigger?.event === "other") triggers.push({ name: d.name, object: "(trigger)", version: d.normalizeVersion });
    for (const a of c.actions ?? []) {
      if (a.verb === "other") actions.push({ name: d.name, object: (a.object ?? "").trim(), version: d.normalizeVersion });
    }
  }
}

const cards = (h: Hit[]) => new Set(h.map((x) => x.name)).size;
console.log(`clause docs ${docs.length}`);
console.log(`  \`other\` ACTIONS : ${actions.length} over ${cards(actions)} cards  (wants a VERBS member)`);
console.log(`  \`other\` TRIGGERS: ${triggers.length} over ${cards(triggers)} cards  (wants a TRIGGERS member)`);

/** Group by the leading verb phrase of the object, which is what a new VERBS member would have to
 *  name. Crude on purpose: the point is to surface families to READ, not to classify them. */
const head = (o: string) => o.toLowerCase().replace(/^(you may |target |each |all |another )/, "").split(/[ ,.]/).slice(0, 2).join(" ");
const byHead = new Map<string, Hit[]>();
for (const a of actions) byHead.set(head(a.object), [...(byHead.get(head(a.object)) ?? []), a]);

console.log(`\n=== \`other\` ACTION families, biggest first (${byHead.size} distinct heads) ===`);
for (const [h, hits] of [...byHead].sort((a, b) => b[1].length - a[1].length).slice(0, 30)) {
  const names = [...new Set(hits.map((x) => x.name))];
  console.log(`\n  ${String(hits.length).padStart(3)}x  "${h}"  — ${names.length} card(s)`);
  for (const hit of hits.slice(0, 3)) console.log(`         ${hit.name} (v${hit.version}): ${hit.object.slice(0, 110)}`);
}

console.log(`\n=== cards whose TRIGGER is on the escape hatch ===`);
for (const t of [...new Set(triggers.map((x) => x.name))].slice(0, 40)) console.log(`  ${t}`);

await store.close();
process.exit(0);
