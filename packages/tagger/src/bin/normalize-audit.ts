import { scratchDir } from "@edh-seer/data";
/** Dumps a judgeable sample of clauses for an ACCURACY read against oracle text.
 *
 *  Self-consistency and accuracy are different questions and only the first is automatic. A
 *  normalizer can be perfectly reproducible and reproducibly wrong, so this samples the clauses
 *  where BOTH runs agreed — the set a double-run pipeline would trust without review — and prints
 *  each beside its source text for a human (or a fresh reader) to judge.
 *
 *  Usage: tsx src/bin/normalize-audit.ts <dir> [n] [seed] [--disagreed] */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? scratchDir("normalize-held100");
const N = Number(process.argv[3] ?? 30);
const SEED = Number(process.argv[4] ?? 5);
const WANT_DISAGREED = process.argv.includes("--disagreed");

interface Rec { id: number; abilityType?: string; trigger?: { event?: string } | null; actions?: { verb?: string; object?: string; fromZone?: string | null; toZone?: string | null }[] }
interface Row { name: string; clauses: { id: number; kind: string; text: string; cost?: string }[]; output: { clauses?: Rec[] } }

const r1 = JSON.parse(readFileSync(join(dir, "run1.json"), "utf8")) as Row[];
const r2 = new Map((JSON.parse(readFileSync(join(dir, "run2.json"), "utf8")) as Row[]).map((r) => [r.name, r]));
const key = (c?: Rec): string => JSON.stringify([c?.abilityType, c?.trigger?.event ?? null,
  (c?.actions ?? []).map((a) => [a.verb, a.fromZone ?? null, a.toZone ?? null])]);

const pool: { name: string; text: string; kind: string; cost?: string; rec: Rec; other?: Rec }[] = [];
for (const a of r1) {
  const b = r2.get(a.name);
  const cb = new Map(((b?.output.clauses) ?? []).map((c) => [c.id, c]));
  for (const rec of a.output.clauses ?? []) {
    const src = a.clauses.find((c) => c.id === rec.id);
    if (!src || src.kind === "keyword" || src.kind === "reminder") continue;
    const agrees = key(rec) === key(cb.get(rec.id));
    if (agrees === WANT_DISAGREED) continue;
    pool.push({ name: a.name, text: src.text, kind: src.kind, cost: src.cost, rec, other: cb.get(rec.id) });
  }
}

let x = SEED;
const rnd = (): number => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; };
for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }

const render = (rec?: Rec): string => {
  const acts = (rec?.actions ?? []).map((t) => {
    const z = t.fromZone || t.toZone ? ` ${t.fromZone ?? "?"}>${t.toZone ?? "?"}` : "";
    return `${t.verb}(${String(t.object ?? "").slice(0, 30)})${z}`;
  }).join("; ");
  const trg = rec?.trigger?.event;
  return `${rec?.abilityType}${trg ? ` on(${trg})` : ""}: ${acts || "(none)"}`;
};

console.log(`${pool.length} ${WANT_DISAGREED ? "DISAGREED" : "agreed"} non-keyword clauses; showing ${Math.min(N, pool.length)}\n`);
for (const p of pool.slice(0, N)) {
  console.log(`${p.name.slice(0, 34).padEnd(36)} [${p.kind}]${p.cost ? ` cost="${p.cost}"` : ""}`);
  console.log(`  TEXT: ${p.text.slice(0, 110)}`);
  console.log(`  ==>   ${render(p.rec)}`);
  if (WANT_DISAGREED) console.log(`  vs    ${render(p.other)}`);
}
