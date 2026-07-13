import type { DeckReport } from "@mtg/engine";

export function formatReport(report: DeckReport): string {
  const lines: string[] = [];

  lines.push("=== Commanders ===");
  lines.push(report.commanders.length ? `  ${report.commanders.join(", ")}` : "  (none specified)");

  lines.push("");
  lines.push("=== Card synergies (ranked) ===");
  for (const c of report.cards.slice(0, 20)) {
    const tag = c.isCommander ? " [commander]" : "";
    const plural = c.partnerCount === 1 ? "" : "s";
    lines.push(`[${c.score}] ${c.name}${tag} — synergizes with ${c.partnerCount} card${plural}`);
    for (const p of c.topPartners.slice(0, 3)) {
      for (const r of p.reasons) {
        lines.push(`    - ${p.name}: ${r.text}`);
      }
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
