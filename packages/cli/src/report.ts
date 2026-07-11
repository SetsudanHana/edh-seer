import type { DeckReport } from "@mtg/engine";

export function formatReport(report: DeckReport): string {
  const lines: string[] = [];

  lines.push("=== Top synergies ===");
  for (const edge of report.edges.slice(0, 15)) {
    lines.push(`[${edge.score}] ${edge.a} + ${edge.b}`);
    for (const r of edge.reasons) {
      lines.push(`    - ${r.text}`);
    }
  }

  lines.push("");
  lines.push("=== Combos ===");
  if (report.combos.length === 0) {
    lines.push("  (none found)");
  } else {
    for (const c of report.combos) {
      lines.push(`  ${c.cards.join(" + ")} => ${c.result}`);
    }
  }

  lines.push("");
  lines.push("=== Themes ===");
  for (const t of report.themes.slice(0, 10)) {
    lines.push(`  ${t.tag}: ${t.count}`);
  }

  lines.push("");
  lines.push("=== Roles ===");
  lines.push(`  ramp: ${report.roles.ramp}  draw: ${report.roles.draw}  removal: ${report.roles.removal}`);

  return lines.join("\n");
}
