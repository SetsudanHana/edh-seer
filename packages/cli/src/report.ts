import type { DeckReport } from "@mtg/engine";

export function formatReport(report: DeckReport): string {
  const lines: string[] = [];

  lines.push("=== Commanders ===");
  lines.push(report.commanders.length ? `  ${report.commanders.join(", ")}` : "  (none specified)");

  lines.push("");
  lines.push("=== Deck cohesion ===");
  if (report.cohesion) {
    const secondary = report.cohesion.secondary ? ` / ${report.cohesion.secondary}` : "";
    lines.push(`  Theme: ${report.cohesion.theme}${secondary}`);
    lines.push(`  Cohesion: ${report.cohesion.score.toFixed(2)} (${report.cohesion.label})`);
  } else {
    lines.push("  (no themes)");
  }

  lines.push("");
  lines.push("=== Card synergies (ranked) ===");
  for (const c of report.cards.slice(0, 20)) {
    const tag = c.isCommander ? " [commander]" : "";
    const plural = c.partnerCount === 1 ? "" : "s";
    // ONE ROW PER CARD, with its count: the analyzer collapses copies into a single node so six
    // basics are one relation and not six identical ones, and the count is how the row still says
    // the deck runs six. The graph has shown this as a "x6" badge since it shipped.
    const copies = report.quantities?.[c.name];
    const qty = copies ? ` x${copies}` : "";
    lines.push(`[${c.score.toFixed(2)}] ${c.name}${qty}${tag} — synergizes with ${c.partnerCount} card${plural}`);
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

  // CANDIDATES, with the argument attached — never a verdict. See matcher's `cut-list.ts` for the
  // three ways this list is wrong, all of which point the same direction: a relation the engine
  // cannot express looks exactly like a card doing nothing.
  if (report.cutList && report.cutList.length > 0) {
    lines.push("");
    lines.push("=== Cut candidates ===");
    lines.push("  Not a verdict: a card the engine cannot connect looks the same as one that does nothing.");
    for (const c of report.cutList) {
      lines.push(`  [${c.rating.toFixed(1)}] ${c.name}`);
      lines.push(`      ${c.reasons.join("; ")}`);
    }
  }
  if (report.slack && report.slack.length > 0) {
    lines.push("");
    lines.push("=== Where the slack is ===");
    lines.push("  Categories you carry more of than the target. The category, never a member — nothing here");
    lines.push("  ranks two ramp cards against each other.");
    for (const s of report.slack) {
      lines.push(`  ${s.category}: ${s.count}/${s.target} (+${s.over})`);
    }
  }

  return lines.join("\n");
}
