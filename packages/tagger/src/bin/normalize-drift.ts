import { scratchDir } from "@edh-seer/data";
/** Groups the drift between two normalizer runs into categories, so a large sample stays readable.
 *  Reports WHICH field disagrees and, for actions, which verb pairs are being swapped — the shape
 *  that tells you whether the residual is a few enumerable ambiguities or a long tail.
 *
 *  Usage: tsx src/bin/normalize-drift.ts <dir> */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? scratchDir("normalize-held100");
interface Rec { id: number; abilityType?: string; trigger?: { event?: string } | null; actions?: { verb?: string; fromZone?: string | null; toZone?: string | null; object?: string }[] }
interface Row { name: string; clauses: { id: number; kind: string; text: string }[]; output: { clauses?: Rec[] } }

const r1 = JSON.parse(readFileSync(join(dir, "run1.json"), "utf8")) as Row[];
const r2 = JSON.parse(readFileSync(join(dir, "run2.json"), "utf8")) as Row[];
const byName = new Map(r2.map((r) => [r.name, r]));

const field = new Map<string, number>();
const verbSwap = new Map<string, number>();
const zoneSwap = new Map<string, number>();
const examples = new Map<string, string>();
let clauses = 0, drifted = 0;

for (const a of r1) {
  const b = byName.get(a.name);
  if (!b) continue;
  const ca = new Map((a.output.clauses ?? []).map((c) => [c.id, c]));
  const cb = new Map((b.output.clauses ?? []).map((c) => [c.id, c]));
  for (const [id, x] of ca) {
    const y = cb.get(id);
    clauses++;
    if (!y) { field.set("clause missing in run2", (field.get("clause missing in run2") ?? 0) + 1); drifted++; continue; }
    const av = (x.actions ?? []).map((t) => t.verb ?? "?");
    const bv = (y.actions ?? []).map((t) => t.verb ?? "?");
    const az = (x.actions ?? []).map((t) => `${t.fromZone ?? ""}>${t.toZone ?? ""}`);
    const bz = (y.actions ?? []).map((t) => `${t.fromZone ?? ""}>${t.toZone ?? ""}`);
    const hits: string[] = [];
    if (x.abilityType !== y.abilityType) hits.push("abilityType");
    if ((x.trigger?.event ?? null) !== (y.trigger?.event ?? null)) hits.push("trigger.event");
    if (av.length !== bv.length) hits.push("action count");
    else if (av.join() !== bv.join()) {
      hits.push("verb choice");
      for (let i = 0; i < av.length; i++) if (av[i] !== bv[i]) verbSwap.set([av[i], bv[i]].sort().join(" vs "), (verbSwap.get([av[i], bv[i]].sort().join(" vs ")) ?? 0) + 1);
    } else if (az.join() !== bz.join()) {
      hits.push("zones");
      for (let i = 0; i < az.length; i++) if (az[i] !== bz[i]) zoneSwap.set(`${av[i]}: ${az[i]} vs ${bz[i]}`, (zoneSwap.get(`${av[i]}: ${az[i]} vs ${bz[i]}`) ?? 0) + 1);
    }
    if (hits.length === 0) continue;
    drifted++;
    const key = hits.join("+");
    field.set(key, (field.get(key) ?? 0) + 1);
    if (!examples.has(key)) {
      const cl = a.clauses.find((c) => c.id === id);
      examples.set(key, `${a.name} [${id}] ${(cl?.text ?? "").slice(0, 70)}\n        run1 ${av.join(",")} | run2 ${bv.join(",")}`);
    }
  }
}

console.log(`clauses compared: ${clauses}   drifted: ${drifted} (${((drifted / clauses) * 100).toFixed(1)}%)\n`);
console.log("WHICH FIELD DISAGREES");
for (const [k, n] of [...field].sort((x, y) => y[1] - x[1])) {
  console.log(`  ${String(n).padStart(3)}  ${k}`);
  const ex = examples.get(k);
  if (ex) console.log(`        ${ex}`);
}
if (verbSwap.size) {
  console.log("\nVERB PAIRS BEING SWAPPED (a short list means enumerable ambiguity; a long tail means not)");
  for (const [k, n] of [...verbSwap].sort((x, y) => y[1] - x[1]).slice(0, 15)) console.log(`  ${String(n).padStart(3)}  ${k}`);
}
if (zoneSwap.size) {
  console.log("\nZONE DISAGREEMENTS");
  for (const [k, n] of [...zoneSwap].sort((x, y) => y[1] - x[1]).slice(0, 10)) console.log(`  ${String(n).padStart(3)}  ${k}`);
}
