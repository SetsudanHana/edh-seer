/** PRECON PACKAGE SCORE (#767): checks every built precon page's upgrade packages against the
 *  measures pre-registered in `docs/plans/2026-09-30-precon-upgrade-package.md` (see
 *  `precon-package-score-core.ts`). Each package's deck is analysed again with its swaps made, the
 *  way the site analyses a list, so the band, the mana base and the synergy score are the report's
 *  own numbers after the swaps rather than the builder's claims about them.
 *
 *    npx tsx packages/instruments/src/precon-package-score.ts [--pages <dir>] [--static static-out | https://edhseer.cards/static]
 *                                                             [--precons packages/data/precons.json] [--only "<precon name>"]
 *
 *  `--pages` (a directory or a URL) defaults to the precon pages `build-precons` wrote into the static build. A page with no
 *  `packages` counts as a miss on S1, which is the baseline before the package ships. Exits 1 on any
 *  hard violation. */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { docToCard } from "@edh-seer/data/docs";
import { normalizeName } from "@edh-seer/data/names";
import { preconDecklist, type Precon } from "@edh-seer/data/precons";
import { analyzeDecklist } from "@edh-seer/matcher/orchestrate";
import { ingredients, rolesOfCard, type Role } from "@edh-seer/matcher/quality";
import { slugOf } from "@edh-seer/matcher/slug";
import { StaticLookup } from "@edh-seer/matcher/static-lookup";
import type { UpgradePackage, UpgradeSwap } from "@edh-seer/matcher/upgrade-package";
import {
  hardViolations, s1Share, s2Kept, s2Sample, swapsOf, S1_FLOOR, S2_KEPT, S2_SAMPLE, type Band, type Violation,
} from "./precon-package-score-core.js";
import { STATIC_BASE, staticFetch } from "./static-deck.js";

const arg = (name: string, fallback?: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback; };
const repo = resolve(import.meta.dirname, "..", "..", "..");
const source = arg("--static", join(repo, "static-out"))!;
const remote = /^https?:\/\//.test(source);
const baseUrl = remote ? source.replace(/\/$/, "") : STATIC_BASE;
const fetchImpl: typeof fetch = remote ? fetch : staticFetch(source);
const version = (await (await fetchImpl(`${baseUrl}/manifest.json`)).json() as { version: string }).version;
const pagesDir = arg("--pages", remote ? `${baseUrl}/${version}/precons` : join(source, version, "precons"))!;
/** A page by slug, from a directory or from a deployed site. */
async function readPage(slug: string): Promise<Page | null> {
  if (/^https?:\/\//.test(pagesDir)) {
    const res = await fetch(`${pagesDir}/${slug}.json`);
    return res.ok ? await res.json() as Page : null;
  }
  const file = join(pagesDir, `${slug}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as Page : null;
}
const only = arg("--only");

interface Page { slug: string; name: string; packages?: UpgradePackage[] }

const lookup = new StaticLookup(baseUrl, fetchImpl);
async function analyse(decklist: string, commanders: readonly string[]) {
  const { report } = await analyzeDecklist(decklist, commanders.join("\n"), async (names) => {
    const l = new StaticLookup(baseUrl, fetchImpl);
    await l.prefetch(names);
    return { lookup: l, tagsLookup: l, tokenTags: await l.tokenTags(), tokenArt: (ids: string[]) => l.tokenArt(ids) };
  });
  return {
    band: (report.bracket?.band ?? "1-2") as Band,
    mana: report.deckMath?.lands.manaBase?.total ?? 0,
    synergy: report.synergyOverall ?? 0,
  };
}

async function deckCard(name: string) {
  await lookup.prefetch([normalizeName(name)]);
  const doc = await lookup.findByName(normalizeName(name));
  return doc ? { doc, dc: { card: docToCard(doc), tags: await lookup.findOne(doc._id) } } : null;
}

/** The precon with the package's swaps made: each cut removes one copy, each add is one card. */
function swapped(p: Precon, pkg: UpgradePackage): Precon {
  const cards = p.cards.map((c) => ({ ...c }));
  for (const s of swapsOf(pkg)) {
    const c = cards.find((x) => x.name === s.out.name && x.count > 0);
    if (c) c.count--;
    cards.push({ name: s.in.name, count: 1 });
  }
  return { ...p, cards: cards.filter((c) => c.count > 0) };
}

const precons = (JSON.parse(readFileSync(arg("--precons", join(repo, "packages", "data", "precons.json"))!, "utf8")) as Precon[]);
// THE SLUG AS `build-precons` MAKES IT, reprints numbered in the same order.
const taken = new Set<string>();
const rows = precons.map((p) => {
  let slug = slugOf(`${p.name} ${p.setName}`);
  for (let n = 2; taken.has(slug); n++) slug = `${slugOf(`${p.name} ${p.setName}`)}-${n}`;
  taken.add(slug);
  return { p, slug };
}).filter((r) => !only || r.p.name === only);
const sample = new Set(s2Sample(rows).map((r) => r.slug));

const violations: (Violation & { slug: string })[] = [];
const pages: Page[] = [];
const s2: { slug: string; before: number; after: number }[] = [];
let missing = 0;
for (const { p, slug } of rows) {
  const page = await readPage(slug);
  if (!page) { missing++; console.log(`${slug}: no page`); continue; }
  pages.push(page);
  if (!page.packages?.length) { console.log(`${slug}: no packages`); continue; }
  const before = await analyse(preconDecklist(p), p.commanders);
  const deck = new Set([...p.commanders, ...p.cards.map((c) => c.name)]);
  const identity = new Set((await Promise.all(p.commanders.map(deckCard))).flatMap((c) => c?.doc.colorIdentity ?? []));
  const identities = new Map<string, readonly string[] | null>();
  const roleFacts = new Map<UpgradeSwap, Awaited<ReturnType<typeof roleOf>>>();
  async function roleOf(s: UpgradeSwap) {
    const [cut, add] = await Promise.all([deckCard(s.out.name), deckCard(s.in.name)]);
    if (!cut || !add || !s.role) return null;
    return { cutRoles: rolesOfCard(cut.dc), addRoles: rolesOfCard(add.dc), cut: ingredients(cut.dc, s.role as Role), add: ingredients(add.dc, s.role as Role) };
  }
  const line: string[] = [];
  for (const pkg of page.packages) {
    for (const s of swapsOf(pkg)) {
      if (!identities.has(s.in.name)) identities.set(s.in.name, (await deckCard(s.in.name))?.doc.colorIdentity ?? null);
      if (s.kind === "role") roleFacts.set(s, await roleOf(s));
    }
    const after = await analyse(preconDecklist(swapped(p, pkg)), p.commanders);
    const v = hardViolations(pkg, {
      commanders: p.commanders, deck, identity,
      identityOf: (n) => identities.get(n) ?? null,
      bandAfter: after.band, manaBefore: before.mana, manaAfter: after.mana,
      role: (s) => roleFacts.get(s) ?? null,
    });
    violations.push(...v.map((x) => ({ ...x, slug })));
    if (pkg.target === 3 && sample.has(slug)) s2.push({ slug, before: before.synergy, after: after.synergy });
    line.push(`${pkg.target}: ${swapsOf(pkg).length} swaps, band ${pkg.from}->${after.band}, mana ${before.mana}->${after.mana}${v.length ? `, ${v.length} violation(s)` : ""}`);
  }
  console.log(`${slug}: ${line.join(" | ")}`);
}

const s1 = s1Share(pages);
const kept = s2Kept(s2);
console.log("");
for (const m of ["H1", "H2", "H3", "H4", "H5"] as const) {
  const hits = violations.filter((v) => v.measure === m);
  console.log(`${m}: ${hits.length ? `FAIL ${hits.length}` : "pass"}${hits.slice(0, 5).map((v) => `\n    ${v.slug} @${v.target}: ${v.detail}`).join("")}`);
}
console.log(`S1: ${(100 * s1).toFixed(1)}% of ${pages.length} precons have 5+ swaps at every target (floor ${100 * S1_FLOOR}%) -- ${s1 >= S1_FLOOR ? "pass" : "MISS"}`);
console.log(`S2: ${s2.length ? `${kept} of ${s2.length} sampled precons kept their synergy (floor ${S2_KEPT} of ${S2_SAMPLE}) -- ${kept >= S2_KEPT ? "pass" : "MISS"}` : "no target-3 packages in the sample"}`);
if (missing) console.log(`${missing} precon(s) had no page in ${pagesDir}`);
if (violations.length) process.exit(1);
