/** FREE. The repeatability distribution across the derived corpus, plus a sample per label so a
 *  human can check that a label means what it says. A label nobody has read is decoration.
 *
 *  Usage: tsx src/bin/repeats-report.ts [--sample N] [--refused <path.json>] */
import { writeFileSync } from "node:fs";
import { connect, loadConfig } from "@mtg/data";
import type { Ability, CardTags } from "../schema.js";
import { segment } from "../segment.js";
import { deriveAbilities } from "../derive/derive.js";
import type { CardClausesDoc } from "../clause-store.js";

const SAMPLE = Number(process.argv[process.argv.indexOf("--sample") + 1]) || 4;
const store = await connect(loadConfig());
const derived = store.db.collection("cardTagsDerived");
const clausesCol = store.db.collection<CardClausesDoc>("cardClauses");
const refusedOut = process.argv.includes("--refused")
  ? process.argv[process.argv.indexOf("--refused") + 1]
  : undefined;
const refused: { name: string; clauseText: string; cost: string; ability: unknown }[] = [];

const counts = new Map<string, number>();
const samples = new Map<string, string[]>();
let abilities = 0;

for await (const d of derived.find({}) as never as AsyncIterable<CardTags & { name?: string }>) {
  const abilitiesArr = d.abilities ?? [];
  // Recover the (text, cost) that fed EVERY ability of this card, not just the refused ones, so
  // they line up positionally with `abilitiesArr` -- only bother when there is a refusal to record.
  const triples = refusedOut && abilitiesArr.some((a) => a.repeats === undefined)
    ? await refusedTriples(d.oracleId, d.name)
    : undefined;

  abilitiesArr.forEach((a, i) => {
    abilities++;
    const key = a.repeats ?? "REFUSED";
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const bucket = samples.get(key) ?? [];
    if (bucket.length < SAMPLE) {
      bucket.push(`${d.name ?? d.oracleId} [${a.kind}${a.trigger ? ` on ${a.trigger.verbs.join("/")}` : ""}]`);
      samples.set(key, bucket);
    }
    if (refusedOut && a.repeats === undefined) {
      const t = triples?.[i];
      refused.push({ name: t?.name ?? d.name ?? d.oracleId, clauseText: t?.text ?? "", cost: t?.cost ?? "", ability: a });
    }
  });
}

console.log(`abilities ${abilities}`);
for (const [k, n] of [...counts].sort((a, b) => b[1] - a[1])) {
  console.log(`\n  ${k.padEnd(11)} ${String(n).padStart(5)}  ${((n / abilities) * 100).toFixed(1)}%`);
  for (const s of samples.get(k) ?? []) console.log(`      ${s}`);
}
if (refusedOut) {
  writeFileSync(refusedOut, JSON.stringify(refused, null, 1));
  console.log(`\nwrote ${refused.length} refused abilities -> ${refusedOut}`);
}
process.exit(0);

/** Rebuild, for one card, the exact (ability, clauseText, cost) triples `deriveAbilities` produced --
 *  positionally parallel to `cardTagsDerived`'s stored `abilities` array. `cardTagsDerived` carries
 *  only the OUTPUT ability, not the clause text/cost that fed `repeatsFor`, so a refusal's evidence
 *  has to be recomputed rather than read back. `segment()` is deterministic over the same inputs
 *  `derive-corpus.ts` used, and running `deriveAbilities` ONE CLAUSE AT A TIME reproduces the
 *  full-corpus call byte-for-byte -- nothing in that function reads a previous clause's state -- while
 *  also handing back which clause's text/cost produced each ability, which the batched call throws
 *  away. */
async function refusedTriples(
  oracleId: string,
  fallbackName?: string,
): Promise<{ ability: Ability; text: string; cost: string; name: string }[]> {
  const cd = await clausesCol.findOne({ oracleId });
  const card = await store.cards.findOne({ _id: oracleId } as never) as
    { oracleText?: string; keywords?: string[]; typeLine?: string } | null;
  const name = cd?.name ?? fallbackName ?? oracleId;
  const segClauses = segment(card?.oracleText ?? "", card?.keywords ?? [], card?.typeLine ?? "");
  const clauseTexts: Record<number, string> = {};
  const clauseCosts: Record<number, string> = {};
  for (const c of segClauses) { clauseTexts[c.id] = c.text; if (c.cost) clauseCosts[c.id] = c.cost; }

  const out: { ability: Ability; text: string; cost: string; name: string }[] = [];
  for (const clause of cd?.canonical ?? []) {
    const text = clauseTexts[clause.id] ?? "";
    const cost = clauseCosts[clause.id] ?? "";
    const { abilities: clauseAbilities } = deriveAbilities([clause], name, clauseTexts, clauseCosts);
    for (const ability of clauseAbilities) out.push({ ability, text, cost, name });
  }
  return out;
}
