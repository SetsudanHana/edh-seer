/** THE QUALITY CALIBRATION SCORE, the tested half (spec
 *  docs/superpowers/specs/2026-09-27-card-quality-per-role-design.md, §Validation). */

/** Of the cards players cut from a deck, the share that score BELOW the deck's median in their role:
 *  a quality score that agrees with players puts what they cut in the bottom half. A cut with no
 *  percentile in its role is not counted -- nothing claimed, nothing scored. */
export function consensusCutAgreement(deck: {
  cuts: string[];
  roleOf: Map<string, string[]>;
  pct: Map<string, Map<string, number>>;
}): { agree: number; total: number } {
  let agree = 0, total = 0;
  for (const cut of deck.cuts) {
    for (const role of deck.roleOf.get(cut) ?? []) {
      const mine = deck.pct.get(cut)?.get(role);
      if (mine === undefined) continue;
      const all = [...deck.pct.values()].map((m) => m.get(role)).filter((v): v is number => v !== undefined).sort((a, b) => a - b);
      const median = all[Math.floor(all.length / 2)]!;
      total++;
      if (mine < median) agree++;
    }
  }
  return { agree, total };
}
