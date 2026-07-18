import type { Report } from "./score.js";

export const PASS_THRESHOLD = 0.8;

export function formatReport(report: Report): string {
  const gate = report.f1 >= PASS_THRESHOLD ? "PASS" : "FAIL";
  const pct = (n: number): string => (n * 100).toFixed(1) + "%";
  const lines = [
    `cards scored: ${report.cards.length}`,
    `chars exact:  ${pct(report.charsExactRate)}`,
    `precision:    ${pct(report.precision)}`,
    `recall:       ${pct(report.recall)}`,
    `F1:           ${pct(report.f1)}  [gate ${pct(PASS_THRESHOLD)} → ${gate}]`,
  ];
  const misses = report.cards.filter((c) => !c.charsExact || c.abilityFP || c.abilityFN);
  if (misses.length) {
    lines.push("", "misses:");
    for (const m of misses) {
      lines.push(
        `  ${m.oracleId}: chars=${m.charsExact ? "ok" : "MISMATCH"} fp=${m.abilityFP} fn=${m.abilityFN}`,
      );
    }
  }
  return lines.join("\n");
}
