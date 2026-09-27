/** THE QUALITY CALIBRATION SCORE (spec docs/superpowers/specs/2026-09-27-card-quality-per-role-design.md).
 *
 *  Prints, per role, what the committed fit says (pairs, held-out accuracy against mana value alone
 *  and against the fallback, and whether the role ships on the fallback), then the pooled
 *  consensus-cut agreement over every precon in the dump: of the cards players cut most (cut rate at
 *  least 0.4), the share our per-role percentile puts below the deck's median in that role.
 *
 *    npx tsx packages/instruments/src/quality-score.ts [--dump <precon-dump.json>] [--static static-out]
 *
 *  The dump is `research/web/precon-vs-edhrec.ts --dump`; the percentiles are the name index's `q`.
 *  Exits 1 when a role that is NOT on the fallback fails to beat mana value alone. Free. */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { BUILD_CATEGORIES } from "@edh-seer/matcher/build";
import { loadQualityWeights } from "@edh-seer/matcher/quality";
import { consensusCutAgreement } from "./quality-score-core.js";

const arg = (name: string, fallback?: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback; };
const repo = resolve(import.meta.dirname, "..", "..", "..");
const dumpPath = arg("--dump", join(repo, "docs", "measurements", "2026-09-27-precon-calibration", "precon-dump.json"))!;
const staticDir = arg("--static", join(repo, "static-out"))!;
const pct = (x: number) => `${(100 * x).toFixed(1).padStart(5)}%`;

const w = loadQualityWeights();
let failed = false;
console.log(`quality weights fitted at DERIVE ${w.deriveVersion}, RULES ${w.rulesVersion}`);
for (const [role, r] of Object.entries(w.roles)) {
  console.log(`  ${role.padEnd(17)} pairs ${String(r.pairs).padStart(5)}  fit ${pct(r.heldOutAccuracy)}  mana value ${pct(r.baselineAccuracy)}  fallback ${pct(r.fallbackAccuracy)}  ${r.fallback ? "ships FALLBACK" : "ships FIT"}`);
  if (!r.fallback && r.heldOutAccuracy <= r.baselineAccuracy) failed = true;
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(" // ")[0]!.replace(/[^a-z0-9]+/g, " ").trim();
if (existsSync(dumpPath) && existsSync(join(staticDir, "manifest.json"))) {
  const version = (JSON.parse(readFileSync(join(staticDir, "manifest.json"), "utf8")) as { version: string }).version;
  const index = (JSON.parse(readFileSync(join(staticDir, version, "name-index.json"), "utf8")) as { cards: { name: string; r?: number[]; q?: number[] }[] }).cards;
  const byName = new Map(index.map((c) => [norm(c.name), c] as const));
  const dump = JSON.parse(readFileSync(dumpPath, "utf8")) as Record<string, { theirCuts: { name: string; rate: number }[]; ourAdds: string[]; theirAdds: { name: string }[] }>;
  const decklists = JSON.parse(readFileSync(join(repo, "packages", "data", "precons.json"), "utf8")) as { name: string; commanders: string[]; cards: { name: string }[] }[];
  let agree = 0, total = 0, decks = 0;
  for (const [deckName, d] of Object.entries(dump)) {
    const list = decklists.find((p) => p.name === deckName);
    if (!list) continue;
    const roleOf = new Map<string, string[]>(), pctOf = new Map<string, Map<string, number>>();
    for (const n of [...list.commanders, ...list.cards.map((c) => c.name)].map(norm)) {
      const row = byName.get(n);
      if (!row?.r || !row.q) continue;
      const roles = row.r.map((i) => BUILD_CATEGORIES[i]!);
      roleOf.set(n, roles);
      pctOf.set(n, new Map(roles.map((role, j) => [role, row.q![j]!] as const).filter(([, v]) => v >= 0)));
    }
    const cuts = d.theirCuts.filter((c) => c.rate >= 0.4).map((c) => c.name);
    const r = consensusCutAgreement({ cuts, roleOf, pct: pctOf });
    agree += r.agree; total += r.total; decks++;
  }
  console.log(`\nconsensus-cut agreement over ${decks} precons: ${agree}/${total} (${total ? ((100 * agree) / total).toFixed(1) : "-"}%) -- spec target above 70%`);
} else {
  console.log(`\n(no dump at ${dumpPath} or no static build at ${staticDir}: consensus-cut agreement skipped)`);
}
if (failed) { console.error("a role ships its fit without beating mana value alone"); process.exit(1); }
