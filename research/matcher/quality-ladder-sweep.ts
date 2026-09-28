/** ONE-SHOT (issue #691): consensus-cut agreement and pair accuracy for candidate fallback ladders,
 *  computed in memory from Mongo so each variant costs seconds instead of a 6-minute static build.
 *
 *    [KEEP_OLD=protection,boardWipe] npx tsx research/matcher/quality-ladder-sweep.ts <pairs.json>
 *
 *  `current` is whatever quality-weights.json ships; every other variant replaces the weights of each
 *  role that ships its fallback. KEEP_OLD leaves the named roles on theirs in the last variant.
 *  `pairs.json` is `gen-quality-weights.ts --dump-pairs`. Prints; writes nothing. */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { connect, docToCard, loadConfig } from "../../packages/data/src/index.js";
import type { CardTags } from "../../packages/tagger/src/index.js";
import { isSubstantive } from "../../packages/matcher/src/partners-core.js";
import { qualityTable } from "../../packages/matcher/src/quality-percentiles.js";
import { loadQualityWeights, type Ingredient } from "../../packages/matcher/src/quality.js";
import { pairAccuracy, usablePair, type Pair } from "../../packages/matcher/src/quality-fit.js";
import { consensusCutAgreement } from "../../packages/instruments/src/quality-score-core.js";
import type { DeckCard } from "../../packages/matcher/src/types.js";

const repo = resolve(import.meta.dirname, "..", "..");
const pairs = (JSON.parse(readFileSync(process.argv[2]!, "utf8")) as Pair[]).filter(usablePair);
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(" // ")[0]!.replace(/[^a-z0-9]+/g, " ").trim();

const store = await connect(loadConfig());
const tags = new Map<string, CardTags>();
for await (const t of store.db.collection<CardTags>("cardTagsDerived").find({})) tags.set(t.oracleId, t);
const seen = new Set<string>();
const corpus: DeckCard[] = [];
for await (const card of store.cards.find({})) {
  const legal = !(card as { legalities?: Record<string, string> }).legalities
    || Object.values((card as { legalities: Record<string, string> }).legalities).some((v) => v !== "not_legal");
  const d = { card: { ...card, ...docToCard(card) }, tags: tags.get(card._id) ?? null } as unknown as DeckCard;
  if (!legal || !isSubstantive(d) || seen.has(d.card.name)) continue;
  seen.add(d.card.name);
  corpus.push(d);
}
await store.close();

const dump = JSON.parse(readFileSync(join(repo, "docs", "measurements", "2026-09-27-precon-calibration", "precon-dump.json"), "utf8")) as Record<string, { theirCuts: { name: string; rate: number }[] }>;
const decklists = JSON.parse(readFileSync(join(repo, "packages", "data", "precons.json"), "utf8")) as { name: string; commanders: string[]; cards: { name: string }[] }[];

const w = loadQualityWeights();
const original = structuredClone(w.roles);
const LADDER = { frequency: 1e6, rateFloor: 1e3, manaValue: -2, timing: 0.5 };
const KEEP_OLD = new Set((process.env.KEEP_OLD ?? "").split(",").filter(Boolean));
const VARIANTS: Record<string, Partial<Record<Ingredient, number>> | null> = {
  current: null,
  "freq > mv > timing": { frequency: 1e6, manaValue: -2, timing: 0.5 },
  "freq > rateCeil > mv > timing": { frequency: 1e6, rateCeiling: 1e3, manaValue: -2, timing: 0.5 },
  "freq > rateFloor > mv > timing": { frequency: 1e6, rateFloor: 1e3, manaValue: -2, timing: 0.5 },
  "rateCeil > mv > timing": { rateCeiling: 1e3, manaValue: -2, timing: 0.5 },
  "ladder, KEEP_OLD roles on the old fallback": LADDER,
};
for (const [label, ladder] of Object.entries(VARIANTS)) {
  for (const [role, r] of Object.entries(original)) {
    Object.assign(w.roles[role as keyof typeof w.roles], r.fallback && ladder && !(ladder === LADDER && KEEP_OLD.has(role)) ? { weights: ladder, fallback: false } : r);
  }
  const table = qualityTable(corpus);
  let agree = 0, total = 0;
  const byRole = new Map<string, { agree: number; total: number }>();
  for (const [deckName, d] of Object.entries(dump)) {
    const list = decklists.find((p) => p.name === deckName);
    if (!list) continue;
    const roleOf = new Map<string, string[]>(), pct = new Map<string, Map<string, number>>();
    for (const n of [...list.commanders, ...list.cards.map((c) => c.name)]) {
      const q = table.get(n) ?? table.get(n.split(" // ")[0]!);
      if (!q) continue;
      roleOf.set(norm(n), [...q.keys()]);
      pct.set(norm(n), new Map(q));
    }
    const cuts = d.theirCuts.filter((c) => c.rate >= 0.4).map((c) => norm(c.name));
    const r = consensusCutAgreement({ cuts, roleOf, pct });
    agree += r.agree; total += r.total;
    for (const cut of cuts) for (const role of roleOf.get(cut) ?? []) {
      const one = consensusCutAgreement({ cuts: [cut], roleOf: new Map([[cut, [role]]]), pct });
      const acc = byRole.get(role) ?? { agree: 0, total: 0 };
      acc.agree += one.agree; acc.total += one.total; byRole.set(role, acc);
    }
  }
  const roles = [...byRole].sort((a, b) => b[1].total - a[1].total).map(([r, a]) => `${r} ${a.agree}/${a.total}`).join(", ");
  const pairAcc = Object.entries(original).filter(([, r]) => r.fallback).map(([role]) => {
    const mine = pairs.filter((p) => p.role === role);
    return mine.length >= 20 ? `${role} ${(100 * pairAccuracy(mine, w.roles[role as keyof typeof w.roles].weights)).toFixed(1)}%` : null;
  }).filter(Boolean).join(", ");
  console.log(`${label.padEnd(32)} agreement ${agree}/${total} (${((100 * agree) / total).toFixed(1)}%)\n    by role: ${roles}\n    all-pairs accuracy (fallback roles): ${pairAcc}`);
}

// WHY: per role, ties at the median, and the cuts whose outcome the ladder changed.
const outcome = (ladder: Partial<Record<Ingredient, number>> | null) => {
  for (const [role, r] of Object.entries(original)) Object.assign(w.roles[role as keyof typeof w.roles], r.fallback && ladder ? { weights: ladder, fallback: false } : r);
  const table = qualityTable(corpus);
  const out = new Map<string, number>();
  for (const [deckName, d] of Object.entries(dump)) {
    const list = decklists.find((p) => p.name === deckName);
    if (!list) continue;
    const pct = new Map<string, Map<string, number>>();
    for (const n of [...list.commanders, ...list.cards.map((c) => c.name)]) { const q = table.get(n) ?? table.get(n.split(" // ")[0]!); if (q) pct.set(norm(n), new Map(q)); }
    for (const c of d.theirCuts.filter((c) => c.rate >= 0.4)) for (const role of pct.get(norm(c.name))?.keys() ?? []) {
      const one = consensusCutAgreement({ cuts: [norm(c.name)], roleOf: new Map([[norm(c.name), [role]]]), pct });
      if (one.total) out.set(`${deckName} | ${role} | ${c.name}`, one.agree);
    }
  }
  return out;
};
const before = outcome(null), after = outcome(VARIANTS["freq > rateFloor > mv > timing"]!);
const ties = (m: Map<string, number>) => [...m.values()].filter((v) => v === 0.5).length;
console.log(`\nties at the median: current ${ties(before)}, ladder ${ties(after)}`);
const moved = [...before].filter(([k, v]) => after.get(k) !== v).map(([k, v]) => `${v}->${after.get(k)}  ${k}`);
const worse = moved.filter((l) => /^(1|0\.5)->(0\.5|0)\b/.test(l) && !l.startsWith("0.5->0.5"));
console.log(`moved ${moved.length}; worse ${worse.filter((l) => !/^0\.5->0\.5/.test(l)).length}`);
const count = new Map<string, number>();
for (const l of worse) { const card = l.split(" | ").slice(1).join(" | "); count.set(card, (count.get(card) ?? 0) + 1); }
console.log([...count].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, n]) => `  ${n}x ${k}`).join("\n"));
