import type { TagStats } from "@edh-seer/engine";

/** WHETHER THE COMMITTED `theme-stats.json` STILL COUNTS THE CORPUS IT RANKS (#720).
 *
 *  `theme-stats-drift.test.ts` asserts every verb FAMILY is present, which catches a verb the
 *  artifact has never seen and nothing else: a stale COUNT passes it. Proven 2026-09-07, when the
 *  file sat unregenerated for eight PRs (#182-#241) with the suite green, and swapping only the
 *  artifact flipped the top theme on 5 of the 71 decks, two of them live defects on main
 *  (nashi-sole-survivor, mono-blue-blink). This compares every count against a fresh recount.
 *
 *  EXACT, NOT WITHIN A TOLERANCE. Regenerating is free (`gen-theme-stats.ts`, no model), and idf is
 *  a log of a ratio, so there is no size of drift that is known to be harmless to a ranking. */
export interface ThemeStatsDrift {
  fresh: boolean;
  /** Committed N against the recount's. */
  n: { committed: number; fresh: number };
  /** Tags whose count moved, largest move first. */
  changed: { tag: string; committed: number; fresh: number }[];
  /** Tags the recount has and the artifact lacks: each scores idf's MAXIMUM today. */
  missing: string[];
  /** Tags the artifact carries and no card does any more. */
  gone: string[];
}

export function compareThemeStats(committed: TagStats, recount: TagStats): ThemeStatsDrift {
  const changed: ThemeStatsDrift["changed"] = [];
  const missing: string[] = [];
  const gone: string[] = [];
  for (const [tag, fresh] of Object.entries(recount.counts)) {
    const was = committed.counts[tag];
    if (was === undefined) missing.push(tag);
    else if (was !== fresh) changed.push({ tag, committed: was, fresh });
  }
  for (const tag of Object.keys(committed.counts)) if (!(tag in recount.counts)) gone.push(tag);
  changed.sort((a, b) => Math.abs(b.fresh - b.committed) - Math.abs(a.fresh - a.committed) || a.tag.localeCompare(b.tag));
  missing.sort(); gone.sort();
  return {
    fresh: committed.N === recount.N && changed.length === 0 && missing.length === 0 && gone.length === 0,
    n: { committed: committed.N, fresh: recount.N },
    changed, missing, gone,
  };
}

/** The report a failing run prints: what moved, the biggest first, and the fix. */
export function driftReport(d: ThemeStatsDrift, show = 15): string {
  if (d.fresh) return `theme-stats: fresh -- N=${d.n.fresh}, every count matches`;
  const lines = [`theme-stats: STALE -- N ${d.n.committed} committed, ${d.n.fresh} in the corpus; ${d.changed.length} counts moved, ${d.missing.length} tags missing, ${d.gone.length} gone`];
  for (const t of d.missing.slice(0, show)) lines.push(`  missing ${t} (scores the maximum idf until regenerated)`);
  for (const c of d.changed.slice(0, show)) lines.push(`  ${c.tag}: ${c.committed} -> ${c.fresh}`);
  for (const t of d.gone.slice(0, show)) lines.push(`  gone ${t}`);
  lines.push("regenerate (free): npx tsx packages/matcher/src/bin/gen-theme-stats.ts");
  return lines.join("\n");
}
