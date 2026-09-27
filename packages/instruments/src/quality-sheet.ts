/** THE OWNER'S JUDGING SHEET for card quality per role (spec
 *  docs/superpowers/specs/2026-09-27-card-quality-per-role-design.md, §Validation). Nothing reads the
 *  score until this sheet is judged.
 *
 *  Per role: the 25 corpus cards players touch most in precons (how often a card appears in the EDHREC
 *  precon pages' add and cut lists), ordered by our percentile, each with its ingredients.
 *
 *    npx tsx packages/instruments/src/quality-sheet.ts      # writes SHEET.md and the click-through SHEET.html
 *                                                            # in docs/measurements/2026-09-27-card-quality/
 *
 *  Needs Mongo (the ingredients) and the EDHREC cache (`research/web/precon-vs-edhrec.ts`). Free. */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { connect, docToCard, loadConfig } from "@edh-seer/data";
import type { CardTags } from "@edh-seer/tagger";
import { ingredients, loadQualityWeights, qualityScore, rolesOfCard, ROLES, type Role } from "@edh-seer/matcher/quality";
import type { DeckCard } from "@edh-seer/matcher/types";
import { BUILD_CATEGORIES } from "@edh-seer/matcher/build";
import { renderQualitySheet, type QualitySheetRole } from "./quality-sheet-html.js";

const repo = resolve(import.meta.dirname, "..", "..", "..");
const cache = join(repo, ".edhrec-cache", "precon");
const outDir = join(repo, "docs", "measurements", "2026-09-27-card-quality");
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(" // ")[0]!.replace(/[^a-z0-9]+/g, " ").trim();

type Page = { container?: { json_dict?: { cardlists?: { header: string; cardviews: { name: string }[] }[] } } } | null;
const usage = new Map<string, number>();
for (const f of readdirSync(cache).filter((f) => f.startsWith("precon_") && f.endsWith(".json"))) {
  const page = JSON.parse(readFileSync(join(cache, f), "utf8")) as Page;
  for (const l of page?.container?.json_dict?.cardlists ?? []) {
    if (!/^(Cards|Lands) to (Add|Cut)$/.test(l.header)) continue;
    for (const v of l.cardviews) usage.set(norm(v.name), (usage.get(norm(v.name)) ?? 0) + 1);
  }
}

const store = await connect(loadConfig());
const tags = new Map<string, CardTags>();
for await (const t of store.db.collection<CardTags>("cardTagsDerived").find({})) tags.set(t.oracleId, t);
const used: DeckCard[] = [];
for await (const card of store.cards.find({})) {
  if (!usage.has(norm(card.name))) continue;
  const t = tags.get(card._id);
  if (t) used.push({ card: { ...card, ...docToCard(card) }, tags: t } as unknown as DeckCard);
}
await store.close();

// THE CORPUS PERCENTILE, from the built name index (`q` aligned with `r`), so the sheet shows the same
// number the site will carry.
const staticDir = join(repo, "static-out");
const version = (JSON.parse(readFileSync(join(staticDir, "manifest.json"), "utf8")) as { version: string }).version;
const indexRows = (JSON.parse(readFileSync(join(staticDir, version, "name-index.json"), "utf8")) as { cards: { name: string; r?: number[]; q?: number[] }[] }).cards;
const pctOf = new Map(indexRows.filter((c) => c.r && c.q).map((c) => [c.name, new Map(c.r!.map((code, j) => [BUILD_CATEGORIES[code]!, c.q![j]!] as const))] as const));
const htmlRoles: QualitySheetRole[] = [];

const w = loadQualityWeights();
const lines = [
  "# Card quality per role — judging sheet",
  "",
  "Mark any card whose position in its role is wrong, and why. Nothing reads these scores until this sheet is judged.",
  "",
  `Weights fitted at DERIVE ${w.deriveVersion}, RULES ${w.rulesVersion}. A FALLBACK role is scored on mana value and timing only.`,
];
for (const role of ROLES as readonly Role[]) {
  const rows = used.filter((d) => rolesOfCard(d).includes(role))
    .map((d) => ({ d, ing: ingredients(d, role), n: usage.get(norm(d.card.name)) ?? 0 }))
    .map((r) => ({ ...r, s: qualityScore(r.ing, w.roles[role]) }))
    .filter((r) => r.s !== null)
    .sort((a, b) => b.n - a.n).slice(0, 25)
    .sort((a, b) => b.s! - a.s!);
  if (rows.length === 0) continue;
  const rw = w.roles[role];
  lines.push("", `## ${role}${rw.fallback ? " (FALLBACK)" : ""}`, "", `pairs ${rw.pairs}; held-out fit ${(100 * rw.heldOutAccuracy).toFixed(1)}%, mana value ${(100 * rw.baselineAccuracy).toFixed(1)}%, fallback ${(100 * rw.fallbackAccuracy).toFixed(1)}%`, "", "| # | card | score | ingredients | precon lists | wrong? why |", "|---|---|---|---|---|---|");
  rows.forEach((r, i) => lines.push(`| ${i + 1} | ${r.d.card.name} | ${r.s!.toFixed(2)} | ${Object.entries(r.ing).map(([k, v]) => `${k} ${v}`).join(", ")} | ${r.n} | |`));
  htmlRoles.push({
    role, fallback: rw.fallback,
    note: `${rw.fallback ? "Scored on mana value and timing only (the fit did not beat mana value alone). " : "Scored on the fitted weights. "}Held-out: fit ${(100 * rw.heldOutAccuracy).toFixed(1)}%, mana value ${(100 * rw.baselineAccuracy).toFixed(1)}%, fallback ${(100 * rw.fallbackAccuracy).toFixed(1)}%, from ${rw.pairs} player swaps.`,
    cards: rows.map((r) => {
      const card = r.d.card as { name: string; manaCost?: string; typeLine?: string; oracleText?: string };
      return { name: card.name, cost: card.manaCost ?? "", typeLine: card.typeLine ?? "", oracle: card.oracleText ?? "", percentile: pctOf.get(card.name)?.get(role) ?? -1, ingredients: r.ing as Record<string, number>, preconLists: r.n };
    }),
  });
}
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "SHEET.md"), `${lines.join("\n")}\n`);
writeFileSync(join(outDir, "SHEET.html"), renderQualitySheet(htmlRoles, "Card quality per role — judging sheet"));
console.log(`wrote ${join(outDir, "SHEET.md")} and SHEET.html`);
