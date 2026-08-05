/** Scores the arms written by schema-experiment.ts.
 *
 *  Prints two things: mechanical metrics that need no judgment (parse failures, dropped cards,
 *  clause counts, and the exact-match rate between the two identical arms — that last one is the
 *  determinism number), then a per-card side-by-side for a hand audit against oracle text.
 *
 *  Usage: tsx src/bin/experiment-compare.ts <dir> [--card substring] */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? "/tmp/schema-exp";
const cardIdx = process.argv.indexOf("--card");
const onlyCard = cardIdx > 0 ? process.argv[cardIdx + 1].toLowerCase() : null;

interface Row { name: string; oracleText: string; output: Record<string, unknown> }
const arms = new Map<string, Row[]>();
for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
  arms.set(f.replace(/\.json$/, ""), JSON.parse(readFileSync(join(dir, f), "utf8")) as Row[]);
}

const abilitiesOf = (o: Record<string, unknown>): Record<string, unknown>[] => {
  const a = (o?.abilities ?? o?.results ?? []) as unknown;
  return Array.isArray(a) ? (a as Record<string, unknown>[]) : [];
};

/** One line per ability, in whichever schema it came from. */
function summarize(o: Record<string, unknown>): string[] {
  if (o?.PARSE_FAILED) return ["  !! PARSE FAILED"];
  if (o?.MISSING_FROM_BATCH) return ["  !! DROPPED FROM BATCH"];
  const abilities = abilitiesOf(o);
  if (abilities.length === 0) return ["  (no abilities)"];
  return abilities.map((ab) => {
    const trig = ab.trigger as { event?: string } | undefined;
    const head = `${ab.abilityType ?? ab.kind ?? "?"}${trig?.event ? ` on(${trig.event})` : ""}`;
    // Schema A: actions[] with a closed verb list.
    if (Array.isArray(ab.actions)) {
      const acts = (ab.actions as Record<string, unknown>[]).map((a) => {
        const zones = a.fromZone || a.toZone ? ` ${a.fromZone ?? "?"}->${a.toZone ?? "?"}` : "";
        return `${a.verb}(${String(a.object ?? "").slice(0, 28)})${zones}`;
      });
      return `  ${head}: ${acts.join(", ")}`;
    }
    // Schema B: effects[] plus continuous/replacement machinery.
    if (Array.isArray(ab.effects)) {
      const eff = (ab.effects as Record<string, unknown>[]).map((e) => {
        const sel = e.selector as { quantifier?: string; types?: string[] } | undefined;
        const zones = e.fromZone || e.toZone ? ` ${e.fromZone ?? "?"}->${e.toZone ?? "?"}` : "";
        return `${e.action}(${sel?.quantifier ?? ""}${sel?.types?.length ? " " + sel.types.join("/") : ""})${zones}`;
      });
      const cont = ab.continuous as { layer?: number; duration?: string } | undefined;
      const rep = ab.replacement as { replacedEvent?: string; replacementKind?: string } | undefined;
      const extra = [
        cont ? `L${cont.layer}/${cont.duration}` : "",
        rep ? `REPLACES(${rep.replacedEvent}:${rep.replacementKind})` : "",
      ].filter(Boolean).join(" ");
      return `  ${head}: ${eff.join(", ")}${extra ? "  [" + extra + "]" : ""}`;
    }
    // Production schema: effect.kind + emits.
    const e = ab.effect as { kind?: string } | undefined;
    const emits = (ab.emits as { verb?: string }[] | undefined) ?? [];
    const t2 = ab.trigger as { verbs?: string[] } | undefined;
    return `  ${ab.kind ?? "?"}${t2?.verbs ? ` on[${t2.verbs.join("/")}]` : ""} -> ${e?.kind ?? "?"}${emits.length ? ` emits[${emits.map((x) => x.verb).join(",")}]` : ""}`;
  });
}

// ---- mechanical metrics (no judgment required) ----
console.log("=== MECHANICAL METRICS ===");
for (const [name, rows] of arms) {
  const failed = rows.filter((r) => r.output?.PARSE_FAILED).length;
  const dropped = rows.filter((r) => r.output?.MISSING_FROM_BATCH).length;
  const empty = rows.filter((r) => !r.output?.PARSE_FAILED && !r.output?.MISSING_FROM_BATCH && abilitiesOf(r.output).length === 0).length;
  const clauses = rows.reduce((s, r) => s + abilitiesOf(r.output).length, 0);
  console.log(`${name.padEnd(18)} cards=${String(rows.length).padStart(3)}  parseFail=${failed}  droppedFromBatch=${dropped}  emptyAbilities=${empty}  totalClauses=${clauses}`);
}

const a = arms.get("A-single"), b = arms.get("A-single-rerun");
if (a && b) {
  let identical = 0;
  for (const r of a) {
    const other = b.find((x) => x.name === r.name);
    if (other && JSON.stringify(r.output) === JSON.stringify(other.output)) identical++;
  }
  console.log(`\nDETERMINISM (A-single vs A-single-rerun): ${identical}/${a.length} byte-identical (${((identical / a.length) * 100).toFixed(0)}%)`);
}

// ---- side-by-side for hand audit ----
console.log("\n=== PER CARD ===");
const names = [...(arms.values().next().value ?? [])].map((r: Row) => r.name);
for (const name of names) {
  if (onlyCard && !name.toLowerCase().includes(onlyCard)) continue;
  const first = [...arms.values()][0].find((r) => r.name === name);
  console.log(`\n############ ${name}`);
  console.log(`ORACLE: ${(first?.oracleText ?? "").replace(/\n/g, " | ").slice(0, 190)}`);
  for (const [armName, rows] of arms) {
    const row = rows.find((r) => r.name === name);
    if (!row) continue;
    console.log(`-- ${armName}`);
    for (const line of summarize(row.output)) console.log(line);
  }
}
if (!existsSync(dir)) console.log(`(no such dir: ${dir})`);
