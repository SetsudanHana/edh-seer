/** THE QUALITY FIT, from what players cut and add (spec
 *  docs/superpowers/specs/2026-09-27-card-quality-per-role-design.md).
 *
 *  Pairs: for every cached EDHREC precon page, its top 10 "Cards to Cut" by `unpopularity` against
 *  its top 20 "Cards to Add" by inclusion, kept when the two share a role, weighted by the product of
 *  the two rates; plus each written upgrade guide's cut -> add pairs, weight 1, when the local-only
 *  guide files exist. Writes `packages/matcher/quality-weights.json`.
 *
 *  FREE: Mongo and the EDHREC cache (fill it with `research/web/precon-vs-edhrec.ts`). No model.
 *
 *    tsx src/bin/gen-quality-weights.ts [--check] [--dump-pairs <file.json>]
 *
 *  Regenerate after any DERIVE or RULES bump: `quality-weights.test.ts` fails until you do. */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, docToCard, loadConfig } from "@edh-seer/data";
import { DERIVE_VERSION, type CardTags } from "@edh-seer/tagger";
import { fitAll, type Pair } from "../quality-fit.js";
import { ingredients, rolesOfCard } from "../quality.js";
import { RULES_VERSION } from "../rules.js";
import type { DeckCard } from "../types.js";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..", "..", "..");
const out = join(here, "..", "..", "quality-weights.json");
const cache = join(repo, ".edhrec-cache", "precon");
const guides = join(repo, "docs", "measurements", "2026-09-27-precon-calibration", "guides");

interface View { name: string; num_decks?: number; potential_decks?: number; unpopularity?: number; url?: string }
type Page = { container?: { json_dict?: { cardlists?: { header: string; cardviews: View[] }[] } } } | null;
const lists = (p: Page) => p?.container?.json_dict?.cardlists ?? [];
/** One key for a name however a source spells it: accents folded, the front face of a two-faced card. */
const key = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(" // ")[0]!.replace(/[^a-z0-9]+/g, " ").trim();

async function main(): Promise<void> {
  if (!existsSync(join(cache, "precon.json"))) throw new Error(`no EDHREC cache at ${cache} -- run research/web/precon-vs-edhrec.ts first`);
  const store = await connect(loadConfig());
  const tags = new Map<string, CardTags>();
  for await (const t of store.db.collection<CardTags>("cardTagsDerived").find({})) tags.set(t.oracleId, t);
  const byName = new Map<string, DeckCard>();
  for await (const card of store.cards.find({})) {
    const t = tags.get(card._id);
    if (!t) continue;
    const d = { card: { ...card, ...docToCard(card) }, tags: t } as unknown as DeckCard;
    if (!byName.has(key(card.name))) byName.set(key(card.name), d);
  }
  await store.close();

  const pairs: Pair[] = [];
  let dropped = 0;
  const rolesMemo = new Map<string, ReturnType<typeof rolesOfCard>>();
  const roles = (d: DeckCard) => rolesMemo.get(d.card.name) ?? rolesMemo.set(d.card.name, rolesOfCard(d)).get(d.card.name)!;
  const addPairs = (set: string, cuts: { name: string; w: number }[], adds: { name: string; w: number }[]) => {
    for (const c of cuts) for (const a of adds) {
      const x = byName.get(key(c.name)), y = byName.get(key(a.name));
      if (!x || !y) { dropped++; continue; }
      const yRoles = roles(y);
      for (const role of roles(x).filter((r) => yRoles.includes(r))) {
        pairs.push({ role, set, cut: ingredients(x, role), add: ingredients(y, role), weight: c.w * a.w });
      }
    }
  };

  const index = lists(JSON.parse(readFileSync(join(cache, "precon.json"), "utf8")) as Page)
    .flatMap((l) => l.cardviews.map((v) => ({ set: l.header, slug: (v.url ?? "").replace(/^\/precon\//, "") })));
  let pages = 0;
  for (const f of readdirSync(cache).filter((f) => f.startsWith("precon_") && f.endsWith(".json")).sort()) {
    const page = JSON.parse(readFileSync(join(cache, f), "utf8")) as Page;
    if (!page) continue;
    pages++;
    const slug = f.replace(/^precon_/, "").replace(/\.json$/, "");
    const set = index.find((e) => e.slug === slug)?.set ?? slug;
    const cuts = [...(lists(page).find((l) => l.header === "Cards to Cut")?.cardviews ?? [])]
      .sort((a, b) => (b.unpopularity ?? 0) - (a.unpopularity ?? 0)).slice(0, 10)
      .map((v) => ({ name: v.name, w: v.unpopularity ?? 0 }));
    const adds = [...(lists(page).find((l) => l.header === "Cards to Add")?.cardviews ?? [])]
      .sort((a, b) => (b.num_decks ?? 0) - (a.num_decks ?? 0)).slice(0, 20)
      .map((v) => ({ name: v.name, w: (v.num_decks ?? 0) / Math.max(1, v.potential_decks ?? 1) }));
    addPairs(set, cuts, adds);
  }
  let guideFiles = 0;
  if (existsSync(guides)) {
    for (const f of readdirSync(guides).filter((f) => f.endsWith(".json")).sort()) {
      const g = JSON.parse(readFileSync(join(guides, f), "utf8")) as { set: string; guides: { in: { card: string }[]; out: { card: string }[] }[] };
      guideFiles++;
      for (const one of g.guides) addPairs(g.set, one.out.map((c) => ({ name: c.card, w: 1 })), one.in.map((c) => ({ name: c.card, w: 1 })));
    }
  }

  const dumpAt = process.argv.indexOf("--dump-pairs");
  if (dumpAt >= 0 && process.argv[dumpAt + 1]) writeFileSync(process.argv[dumpAt + 1]!, JSON.stringify(pairs));
  const weights = fitAll(pairs, { deriveVersion: DERIVE_VERSION, rulesVersion: RULES_VERSION });
  const json = `${JSON.stringify(weights, null, 2)}\n`;
  console.log(`${pages} EDHREC precon pages, ${guideFiles} guide files -> ${pairs.length} pairs; ${dropped} dropped (card not in the corpus)`);
  for (const [role, w] of Object.entries(weights.roles)) {
    console.log(`  ${role.padEnd(17)} pairs ${String(w.pairs).padStart(5)}  held-out ${(100 * w.heldOutAccuracy).toFixed(1).padStart(5)}%  mana-value baseline ${(100 * w.baselineAccuracy).toFixed(1).padStart(5)}%  fallback ${(100 * w.fallbackAccuracy).toFixed(1).padStart(5)}%${w.fallback ? "  FALLBACK" : `  ${JSON.stringify(w.weights)}`}`);
  }
  if (process.argv.includes("--check")) {
    if (!existsSync(out) || readFileSync(out, "utf8") !== json) { console.error("quality-weights.json is stale -- re-run gen-quality-weights.ts"); process.exit(1); }
    return;
  }
  writeFileSync(out, json);
}

main().catch((err) => { console.error("gen-quality-weights failed:", err); process.exit(1); });
