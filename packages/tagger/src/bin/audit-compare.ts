/** Prints oracle text with the CURRENT stored tags beside freshly-tagged output, for scoring a
 *  prompt change against the same cards. Reads tag-batch-api's batch-N.json / batch-N-out.json
 *  pairs; touches nothing in the database.
 *
 *  Usage: tsx src/bin/audit-compare.ts <dir> [--only name-substring] */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { connect, loadConfig } from "@edh-seer/data";

const dir = process.argv[2];
const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx > 0 ? process.argv[onlyIdx + 1].toLowerCase() : null;

const summarize = (abilities: Record<string, unknown>[]): string =>
  abilities.map((a) => {
    const eff = a.effect as { kind?: string } | undefined;
    const trig = a.trigger as { verbs?: string[] } | undefined;
    const emits = (a.emits as { verb?: string; subject?: { counter?: string } }[] | undefined) ?? [];
    const parts = [`${a.kind}`];
    if (trig?.verbs) parts.push(`on[${trig.verbs.join("/")}]`);
    parts.push(`-> ${eff?.kind ?? "?"}`);
    if (emits.length) parts.push(`emits[${emits.map((e) => e.verb + (e.subject?.counter ? `:${e.subject.counter}` : "")).join(",")}]`);
    return parts.join(" ");
  }).join("  ||  ") || "(none)";

const s = await connect(loadConfig());
const tcol = s.db.collection("cardTags");
let changed = 0, same = 0;
for (const f of readdirSync(dir).filter((x) => /^batch-\d+\.json$/.test(x)).sort()) {
  const cards = JSON.parse(readFileSync(join(dir, f), "utf8")) as { oracleId: string; name: string; oracleText: string }[];
  const outFile = join(dir, f.replace(/\.json$/, "-out.json"));
  const results = JSON.parse(readFileSync(outFile, "utf8")) as { oracleId: string; abilities: Record<string, unknown>[] }[];
  const byId = new Map(results.map((r) => [r.oracleId, r.abilities]));
  for (const c of cards) {
    if (only && !c.name.toLowerCase().includes(only)) continue;
    const old = (await tcol.findOne({ oracleId: c.oracleId as never })) as unknown as { abilities?: Record<string, unknown>[] } | null;
    const before = summarize(old?.abilities ?? []);
    const after = summarize(byId.get(c.oracleId) ?? []);
    if (before === after) same++; else changed++;
    console.log(`\n### ${c.name}`);
    console.log(`ORACLE: ${c.oracleText.replace(/\n/g, " | ").slice(0, 150)}`);
    console.log(`BEFORE: ${before}`);
    console.log(`AFTER : ${after}${before === after ? "   (unchanged)" : ""}`);
  }
}
console.log(`\n[changed ${changed}, unchanged ${same}]`);
await s.close();
