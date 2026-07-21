import type { GoldPair, Outcome } from "./eval-pairs-core.js";

export interface PairResult {
  pair: GoldPair;
  outcome: Outcome;
}

export interface CompassReport {
  total: number;
  pass: number;
  recall: number;
  perCategory: Record<string, { pass: number; total: number }>;
  /** Non-PASS outcomes tallied by cause: a NoEdgeCause label or "WRONG-REASON". */
  causes: Record<string, number>;
}

/** Aggregate per-pair results into overall + per-category recall and a cause histogram. */
export function buildReport(results: PairResult[]): CompassReport {
  const perCategory: Record<string, { pass: number; total: number }> = {};
  const causes: Record<string, number> = {};
  let pass = 0;
  for (const { pair, outcome } of results) {
    const cat = (perCategory[pair.category] ??= { pass: 0, total: 0 });
    cat.total++;
    if (outcome.status === "PASS") {
      pass++;
      cat.pass++;
    } else {
      const label = outcome.status === "NO-EDGE" ? outcome.noEdgeCause ?? "NO-EDGE" : "WRONG-REASON";
      causes[label] = (causes[label] ?? 0) + 1;
    }
  }
  const total = results.length;
  return { total, pass, recall: total ? pass / total : 0, perCategory, causes };
}

/** Terse multi-line stdout table: overall recall, per-category recall, cause histogram. */
export function formatReport(report: CompassReport): string {
  const lines: string[] = [];
  lines.push(`overall recall: ${report.pass}/${report.total} (${(report.recall * 100).toFixed(0)}%)`);
  lines.push("per category:");
  for (const [cat, { pass, total }] of Object.entries(report.perCategory).sort()) {
    lines.push(`  ${cat.padEnd(18)} ${pass}/${total}`);
  }
  lines.push("causes:");
  for (const [cause, n] of Object.entries(report.causes).sort()) {
    lines.push(`  ${cause.padEnd(18)} ${n}`);
  }
  return lines.join("\n");
}
