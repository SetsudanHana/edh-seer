/** An Aura's "Enchant X" line RESTRICTS what "enchanted Y" can be, and derivation reads only the
 *  second. Kaya's Ghostform says `Enchant creature or planeswalker you control` and then `When
 *  enchanted permanent dies` — derived as `type: permanent`, so a LAND satisfied it. Free, read-only.
 *
 *  Counts only the cards where the two lines DISAGREE, since an aura whose Enchant line and subject
 *  both say "creature" loses nothing today. */
import { connect, loadConfig } from "@mtg/data";
import { DERIVED_COLLECTION } from "../clause-store.js";
import type { Ability } from "../schema.js";

const store = await connect(loadConfig());

const ENCHANT_LINE = /^Enchant ([^\n]+)$/m;
const ENCHANTED_SUBJECT = /\benchanted (permanent|creature|land|artifact|player|planeswalker)\b/gi;

const cards = await store.cards.find({ oracleText: /\benchanted /i } as never).toArray() as unknown as
  { _id: string; name: string; typeLine?: string; oracleText?: string }[];

const derivedIds = new Set((await store.db.collection(DERIVED_COLLECTION).find({}).project({ oracleId: 1 }).toArray())
  .map((d) => (d as unknown as { oracleId: string }).oracleId));

let disagree = 0, inDerived = 0;
const rows: string[] = [];
for (const c of cards) {
  const text = c.oracleText ?? "";
  const line = text.match(ENCHANT_LINE)?.[1]?.toLowerCase();
  if (!line) continue;
  const nouns = new Set([...text.matchAll(ENCHANTED_SUBJECT)].map((m) => m[1].toLowerCase()));
  // The disagreement that matters: the subject says a WIDER word than the Enchant line allows.
  const wide = [...nouns].filter((n) => n === "permanent" && !/\bpermanent\b/.test(line));
  if (!wide.length) continue;
  disagree++;
  const d = derivedIds.has(c._id);
  if (d) inDerived++;
  const der = d ? await store.db.collection(DERIVED_COLLECTION).findOne({ oracleId: c._id } as never) : null;
  const trig = ((der as unknown as { abilities?: Ability[] } | null)?.abilities ?? [])
    .map((a) => `${(a.trigger?.verbs ?? []).join("/") || a.kind}:${JSON.stringify(a.trigger?.subject?.type ?? null)}`);
  rows.push(`  ${d ? "DERIVED " : "        "}${c.name}\n     Enchant ${line}\n     subject says: ${[...nouns].join(", ")}${trig.length ? `\n     derives: ${trig.join(" · ")}` : ""}`);
}
console.log(`cards whose "enchanted permanent" is WIDER than their Enchant line: ${disagree}, of which ${inDerived} in the derived corpus\n`);
for (const r of rows) console.log(r);

await store.close();
process.exit(0);
