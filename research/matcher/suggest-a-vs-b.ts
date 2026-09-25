/** DECK SUGGESTIONS, A VS B (roadmap AO2; spec docs/superpowers/specs/2026-09-24-deck-suggestions-design.md
 *  §4). The gate before any UI is built: does the cheap candidate pool (A, each deck card's shipped
 *  partner list, `pi`) find what the full search (B, every admissible card the engine can join to
 *  the deck) finds?
 *
 *  A is `suggestForDeck` itself -- the exact lists a player would see, verified by the engine.
 *  B is every nonland, in-identity card not in the deck that shares an event form with the deck
 *  (the same supply/demand forms `partners-core` indexes on), joined to each nonland deck card with
 *  `directedReasons` in both directions. Both are ranked by `suggest.ts`, so a difference is the
 *  POOL, never the ranking.
 *
 *  Offline: everything is read from `static-out/` (card docs, derived tags, oracle text). Run from
 *  the repo root after a rebuild:
 *
 *    npx tsx research/matcher/suggest-a-vs-b.ts
 *
 *  B IS CACHED PER DECK under `B_CACHE` (it reads only the corpus, never `pi`, and took 7.4 h
 *  serially). Fill the cache in parallel first, one process per shard, then run with no flags:
 *
 *    for i in 0 1 2 3 4 5 6 7; do npx tsx research/matcher/suggest-a-vs-b.ts --only-b --shard $i/8 & done; wait
 *
 *  Delete the cache after a derive or engine change -- it is keyed by deck name only. */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { docToCard } from "@edh-seer/data/docs";
import { normalizeName, parseDecklistSections, CALIBRATION_DECKS } from "@edh-seer/data";
import type { CardDoc } from "@edh-seer/data";
import type { CardTags } from "@edh-seer/tagger";
import type { DeckReport } from "@edh-seer/engine";
import { StaticLookup, shardOf } from "../../packages/matcher/src/static-lookup.js";
import { analyzeResolvedDeck, resolveDeck, type AnalysisSources } from "../../packages/matcher/src/orchestrate.js";
import { suggestForDeck, type DeckSuggestions } from "../../packages/matcher/src/suggest-static.js";
import {
  answerList, gapList, planList, type Candidate, type IndexCard,
} from "../../packages/matcher/src/suggest.js";
import { candidatePool } from "../../packages/matcher/src/suggest.js";
import { maxAxisWeight } from "../../packages/matcher/src/axis.js";
import type { Reason } from "@edh-seer/engine";
import { eventKeysForDemand } from "../../packages/matcher/src/suggest-keys.js";
import { demandForms, demandKeysOf, supplyForms, supplyKeysOf } from "../../packages/matcher/src/partners-core.js";
import { BUILD_CATEGORIES, BUILD_PARENTS } from "../../packages/matcher/src/build.js";
import { POOL_CLASSES } from "../../packages/matcher/src/answer-pool.js";
import { directedReasons } from "../../packages/matcher/src/edges.js";
import { loadHierarchy } from "../../packages/matcher/src/hierarchy.js";
import { faceDeckCards } from "../../packages/matcher/src/faces.js";
import { deckLandTypes } from "../../packages/matcher/src/chosen-type.js";
import type { DeckCard } from "../../packages/matcher/src/types.js";

const DECK_DIR = process.env.DECK_DIR ?? CALIBRATION_DECKS;
const OUT = "static-out";
const TOP = 10;
const PASS = 8;
const NO_TOKEN_NODES = { tokensMediate: false };
const B_CACHE = ".superpowers/sdd/2026-09-24-deck-suggestions/b-cache";
const ONLY_B = process.argv.includes("--only-b");
const SHARD = (() => {
  const i = process.argv.indexOf("--shard");
  const [k, n] = i < 0 ? [0, 1] : process.argv[i + 1]!.split("/").map(Number);
  return { k: k!, n: n! };
})();

/** Distinct URLs `suggestForDeck` asks for, per deck: the browser's network cost, which node's wall
 *  time hides. Reset around each call. */
const asked = new Set<string>();
const fileFetch = (async (url: string) => {
  asked.add(String(url));
  const path = join(OUT, new URL(url, "file:///").pathname);
  try {
    const body = readFileSync(path, "utf8");
    return { ok: true, status: 200, json: async () => JSON.parse(body) } as Response;
  } catch {
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  }
}) as unknown as typeof fetch;

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? NaN : s.length % 2 ? s[s.length >> 1]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

/** Every card in the corpus as the engine sees it, keyed by printed name. */
function loadCorpus(version: string): Map<string, DeckCard> {
  const dir = join(OUT, version, "cards");
  const out = new Map<string, DeckCard>();
  for (const f of readdirSync(dir)) {
    const shard = JSON.parse(readFileSync(join(dir, f), "utf8")) as Record<string, { card: CardDoc; tags: CardTags | null }>;
    for (const e of Object.values(shard)) {
      if (!out.has(e.card.name)) out.set(e.card.name, { card: { ...e.card, ...docToCard(e.card) } as DeckCard["card"], tags: e.tags });
    }
  }
  return out;
}

async function main(): Promise<void> {
  const version = (JSON.parse(readFileSync(join(OUT, "manifest.json"), "utf8")) as { version: string }).version;
  const lookup = new StaticLookup("http://static", fileFetch);
  const sources: AnalysisSources = {
    lookup, tagsLookup: lookup, tokenTags: await lookup.tokenTags(),
    tokenArt: (ids: string[]) => lookup.tokenArt(ids),
  };
  const [rows, vocab] = await Promise.all([lookup.nameIndex(), lookup.nameIndexVocabulary()]);
  const landT = vocab.types.indexOf("land");
  const index: IndexCard[] = rows.map((r, pos) => ({
    pos, name: r.name, slug: r.slug, identity: r.identity, mv: r.mv ?? 0,
    isLand: (r.t ?? []).includes(landT),
    roles: (r.r ?? []).map((i) => BUILD_CATEGORIES[i]!), answers: (r.a ?? []).map((i) => POOL_CLASSES[i]!),
  }));
  const corpus = loadCorpus(version);
  const h = loadHierarchy();
  // Each card's supply/demand FORMS, once.
  const formsOf = new Map<string, { s: Set<string>; d: Set<string> }>();
  for (const c of index) {
    const dc = corpus.get(c.name);
    if (!dc) continue;
    formsOf.set(c.name, {
      s: new Set(supplyKeysOf(dc).flatMap(supplyForms)),
      d: new Set(demandKeysOf(dc).flatMap(demandForms)),
    });
  }
  const eventKeys = Object.keys((await lookup.eventFrequency()).supply ?? {});
  const interactionBand = BUILD_PARENTS.find((p) => p.key === "interaction")!.costBand;

  const overlap: Record<string, number[]> = {};
  const worst: { deck: string; list: string; hit: number; missed: string[] }[] = [];
  const perKind = { build: 0, answers: 0, synergy: 0 };
  const findingsEmpty = { build: 0, answers: 0, synergy: 0 };
  const findingsTotal = { build: 0, answers: 0, synergy: 0 };
  let untranslatable = 0;
  let roleMismatch = 0;
  let roleChecked = 0;
  const sample: { deck: string; card: string; connection: string; reason: string }[] = [];
  const started = Date.now();
  // DIAGNOSTIC (2026-09-24, suspect 3): is B's top 10 breadth? Card frequency across decks' B plan
  // top 10, where A's plan picks rank in B's full plan order, and the connection counts at the top.
  const bTopFreq = new Map<string, number>();
  const aRankInB: number[] = [];
  const bPlanFreq = new Map<string, number>();
  const conn: { deck: string; aTop: number; bTop: number; b10: number; aMissingFromB: number }[] = [];
  let stale = 0;
  const aMs: number[] = [];
  const quality: number[] = [];
  const near: number[] = [];
  const cardFetches: number[] = [];
  const eventFetches: number[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => { if (String(args[0]).includes("stale pair")) stale++; else warn(...args); };

  const files = readdirSync(DECK_DIR).filter((f) => f.endsWith(".txt")).sort().filter((_, i) => i % SHARD.n === SHARD.k);
  mkdirSync(B_CACHE, { recursive: true });
  for (const file of files) {
    const deckName = file.replace(/\.txt$/, "");
    const sections = parseDecklistSections(readFileSync(join(DECK_DIR, file), "utf8"));
    await lookup.prefetch([...sections.commanders, ...sections.deck].map(normalizeName));
    const { cards, combos, commanderResolved, commanderColorIdentity } =
      await resolveDeck(sections.commanders, sections.deck, lookup);
    const report = await analyzeResolvedDeck(cards, combos, commanderResolved, sources) as unknown as DeckReport;

    // ROLE PARITY (whole-branch review, PR #447): the report's roles for a card must equal its `r`.
    const atName = new Map(index.map((c) => [c.name, c] as const));
    for (const c of report.cards) {
      const row = atName.get(c.cardName ?? c.name);
      if (!row || c.face !== undefined) continue;
      roleChecked++;
      if ([...(c.roles ?? [])].sort().join() !== [...row.roles].sort().join()) roleMismatch++;
    }

    // B: every admissible card sharing an event form with the deck, joined by the engine.
    const physical = [...new Set(report.cards.filter((c) => !c.isCompanion).map((c) => c.cardName ?? c.name))];
    const inDeck = new Set(physical);
    const identity = new Set(commanderColorIdentity);
    const nonland = physical.filter((n) => !atName.get(n)?.isLand && corpus.has(n));
    const deckS = new Set(nonland.flatMap((n) => [...(formsOf.get(n)?.s ?? [])]));
    const deckD = new Set(nonland.flatMap((n) => [...(formsOf.get(n)?.d ?? [])]));
    const opts = { ...NO_TOKEN_NODES, landTypes: deckLandTypes(physical.map((n) => corpus.get(n)).filter((x): x is DeckCard => !!x)) };
    const reasonsOf = (x: DeckCard, y: DeckCard): Reason[] => faceDeckCards(x).flatMap((xf) => faceDeckCards(y).flatMap((yf) =>
      [...directedReasons(xf, yf, h, opts), ...directedReasons(yf, xf, h, opts)]));
    const axis = new Map(((report as unknown as { axis?: { tag: string; weight: number }[] }).axis ?? []).map((a) => [a.tag, a.weight] as const));
    const onPlan = new Map<number, number>();
    const poolB = new Map<number, Candidate>();
    const cacheFile = join(B_CACHE, `${deckName}.json`);
    if (existsSync(cacheFile)) {
      for (const [pos, deckCards, w] of JSON.parse(readFileSync(cacheFile, "utf8")) as [number, string[], number][]) {
        poolB.set(pos, { card: index[pos]!, connections: deckCards.map((deckCard) => ({ deckCard, score: 1 })), score: deckCards.length });
        onPlan.set(pos, w);
      }
    } else {
    for (const c of index) {
      if (c.isLand || inDeck.has(c.name) || !c.identity.every((x) => identity.has(x))) continue;
      const f = formsOf.get(c.name);
      if (!f) continue;
      if (![...f.s].some((k) => deckD.has(k)) && ![...f.d].some((k) => deckS.has(k))) continue;
      const y = corpus.get(c.name)!;
      const connections = [];
      for (const n of nonland) {
        const x = corpus.get(n)!;
        // Asked the way `suggest-static.ts` asks: a pair, no token nodes, face by face, the deck's land types.
        let rs: Reason[] = [];
        try { rs = reasonsOf(x, y); } catch { rs = []; }
        if (rs.length > 0) {
          connections.push({ deckCard: n, score: 1 });
          onPlan.set(c.pos, (onPlan.get(c.pos) ?? 0) + maxAxisWeight(rs, axis));
        }
      }
      if (connections.length > 0) poolB.set(c.pos, { card: c, connections, score: connections.length });
    }
    writeFileSync(cacheFile, JSON.stringify([...poolB.values()].map((c) =>
      [c.card.pos, c.connections.map((x) => x.deckCard), onPlan.get(c.card.pos) ?? 0])));
    }
    if (ONLY_B) { process.stderr.write(`${deckName}: pool B ${poolB.size} cached (${Math.round((Date.now() - started) / 1000)} s)\n`); continue; }

    // A: what a player would see.
    asked.clear();
    const aStart = Date.now();
    const a: DeckSuggestions = await suggestForDeck({ report, commanderColorIdentity, baseUrl: "http://static", fetchImpl: fileFetch });

    // THE LISTS, BOTH SIDES RANKED BY `suggest.ts`.
    const compare = (list: string, aNames: string[], bTop: Candidate[]): void => {
      if (bTop.length === 0) return;
      const want = bTop.slice(0, TOP).map((c) => c.card.name);
      const hit = want.filter((n) => aNames.includes(n)).length;
      (overlap[list] ??= []).push(hit / Math.min(TOP, want.length));
      worst.push({ deck: deckName, list, hit: hit / Math.min(TOP, want.length), missed: want.filter((n) => !aNames.includes(n)) });
    };
    const aPlan = [...a.plan.map((c) => c.name), ...Object.values(a.build).flat().concat(Object.values(a.answers).flat())
      .filter((c) => c.alsoPlan).map((c) => c.name)];
    compare("plan-breadth", aPlan, planList(poolB, TOP));
    const bAll = planList(poolB, Infinity);
    // ON-PLAN RANKING: sum of each edge's axis weight (off-plan edges ~0), then the usual order.
    // Pool vs pool under ONE ranking: A' = B's candidates that A's pi union also holds.
    const byPlan = (xs: Candidate[]): Candidate[] => xs.filter((c) => c.connections.length >= 2)
      .sort((p, q) => (onPlan.get(q.card.pos) ?? 0) - (onPlan.get(p.card.pos) ?? 0) || q.connections.length - p.connections.length
        || p.card.mv - q.card.mv || p.card.name.localeCompare(q.card.name, "en"));
    const piMap = new Map<string, readonly (readonly [number, number, ...number[]])[]>();
    for (const n of nonland) { const ids = lookup.partnerIds(normalizeName(n)); if (ids?.length) piMap.set(n, ids); }
    const poolA = candidatePool({ names: inDeck, identity, pi: piMap }, index);
    const bPlan = byPlan([...poolB.values()]);
    const aPlan2 = byPlan([...poolB.values()].filter((c) => poolA.has(c.card.pos)));
    // THE GATE LINE: A's actual plan list against B ranked the way A now ranks, on the axis.
    compare("plan", aPlan, bPlan);
    // TIE-TOLERANT READOUT: B's on-plan scores run in near-ties (Amarant: thirty spell payoffs within
    // 3%), so an exact top-10 overlap reads a 16.8 pick as a miss beside a 17.3. Each of A's plan
    // picks scored against B's #10, and how many reach 95% of it.
    const ref = onPlan.get(bPlan[TOP - 1]?.card.pos ?? -1) ?? 0;
    if (ref > 0) {
      const mine = a.plan.map((c) => onPlan.get(atName.get(c.name)?.pos ?? -1) ?? 0);
      quality.push(mine.length ? mine.reduce((t, x) => t + Math.min(1, x / ref), 0) / mine.length : 0);
      near.push(mine.filter((x) => x >= 0.95 * ref).length);
    }
    // POOL CEILING: B's order restricted to A's pool -- what A could reach with a perfect shortlist.
    compare("pool-ceiling", aPlan2.slice(0, TOP).map((c) => c.card.name), bPlan.slice(0, TOP));
    // B's finding lists in A's post-engine order: cost band first, then on-plan weight.
    const onBand = (xs: Candidate[], band: readonly [number, number]): Candidate[] => {
      const inB = (c: Candidate): number => Number(c.card.mv >= band[0] && c.card.mv <= band[1]);
      return [...xs].sort((p, q) => inB(q) - inB(p) || (onPlan.get(q.card.pos) ?? 0) - (onPlan.get(p.card.pos) ?? 0)
        || q.connections.length - p.connections.length || p.card.mv - q.card.mv || p.card.name.localeCompare(q.card.name, "en"));
    };
    for (const c of bPlan.slice(0, TOP)) bPlanFreq.set(c.card.name, (bPlanFreq.get(c.card.name) ?? 0) + 1);
    if (deckName.startsWith(process.env.SHOW_DECK ?? "braids")) {
      console.log(`[${deckName}] axis top: ${[...axis].slice(0, 8).map(([t, w]) => `${t} ${w.toFixed(2)}`).join(", ")}`);
      console.log(`[${deckName}] B on-plan top ${TOP}: ${bPlan.slice(0, TOP).map((c) => `${c.card.name} (${(onPlan.get(c.card.pos) ?? 0).toFixed(1)}/${c.connections.length})`).join("; ")}`);
      for (const w of (process.env.WATCH ?? "").split(",").filter(Boolean)) {
        const pos = atName.get(w)?.pos ?? -1;
        const i = bPlan.findIndex((c) => c.card.pos === pos);
        console.log(`[${deckName}] WATCH ${w}: B on-plan rank ${i < 0 ? "absent" : i + 1}, on-plan ${(onPlan.get(pos) ?? 0).toFixed(2)}, connections ${poolB.get(pos)?.connections.length ?? 0}, in A pool ${poolA.has(pos)} with ${poolA.get(pos)?.connections.length ?? 0} pi connections, pool rank by connections ${[...poolA.values()].filter((c) => c.connections.length >= 2).sort((p, q) => q.connections.length - p.connections.length).findIndex((c) => c.card.pos === pos) + 1}`);
      }
      for (const d of (report.deckMath?.demand ?? []).filter((x) => (x.suppliers === 0 && x.consumers > 0) || x.key.includes("damage"))) {
        console.log(`[${deckName}] DEMAND ${d.key} (available ${d.available}, suppliers ${d.suppliers}, consumers ${d.consumers}): ${(a.synergy[d.key] ?? []).map((c) => `${c.name} (${c.connections.length})`).join("; ") || "-"}`);
      }
      for (const r of a.routes) console.log(`[${deckName}] ROUTE ${r.route!.from.length} cards reach ${r.route!.to} through ${r.name} (${r.route!.from.slice(0, 4).join(", ")}...)`);
      console.log(`[${deckName}] A actual plan: ${aPlan.map((n) => { const c = poolB.get(atName.get(n)?.pos ?? -1); return `${n} (${(c ? onPlan.get(c.card.pos) ?? 0 : 0).toFixed(1)}/${c?.connections.length ?? 0})`; }).join("; ")}`);
      console.log(`[${deckName}] A' on-plan top ${TOP}: ${aPlan2.slice(0, TOP).map((c) => `${c.card.name} (${(onPlan.get(c.card.pos) ?? 0).toFixed(1)}/${c.connections.length})`).join("; ")}`);
    }
    for (const c of bAll.slice(0, TOP)) bTopFreq.set(c.card.name, (bTopFreq.get(c.card.name) ?? 0) + 1);
    let missing = 0;
    for (const n of a.plan.map((c) => c.name)) {
      const i = bAll.findIndex((c) => c.card.name === n);
      if (i < 0) missing++; else aRankInB.push(i + 1);
    }
    conn.push({ deck: deckName, aTop: a.plan[0]?.connections.length ?? 0, bTop: bAll[0]?.connections.length ?? 0,
      b10: bAll[TOP - 1]?.connections.length ?? 0, aMissingFromB: missing });
    for (const g of report.buildParents ?? []) {
      if (g.target <= 0 || g.count >= g.target) continue;
      const band = BUILD_PARENTS.find((p) => p.name === g.name)?.costBand ?? [0, Infinity] as const;
      compare(`build:${g.name}`, (a.build[g.name] ?? []).map((c) => c.name), onBand(gapList(poolB, g.leaves, band, Infinity), band));
    }
    for (const r of report.deckMath?.answers ?? []) {
      if (r.class === "graveyard" || r.count >= r.required) continue;
      compare(`answers:${r.class}`, (a.answers[r.class] ?? []).map((c) => c.name), onBand(answerList(poolB, r.class, interactionBand, Infinity), interactionBand));
    }

    // HONESTY READOUT.
    for (const [kind, lists] of [["build", a.build], ["answers", a.answers], ["synergy", a.synergy]] as const) {
      const vals = Object.values(lists);
      findingsTotal[kind] += vals.length;
      findingsEmpty[kind] += vals.filter((l) => l.length === 0).length;
      if (vals.some((l) => l.length > 0)) perKind[kind]++;
    }
    for (const d of report.deckMath?.demand ?? []) {
      if (d.available !== null && d.suppliers === 0 && d.consumers > 0 && eventKeysForDemand(d.key, eventKeys).length === 0) untranslatable++;
    }
    const shown = [...a.plan, ...Object.values(a.build).flat()];
    if (shown.length > 0) {
      const pick = shown[(deckName.length * 7) % shown.length]!;
      sample.push({ deck: deckName, card: pick.name, connection: pick.connections[0]!, reason: pick.reasons[0]! });
    }
    aMs.push(Date.now() - aStart);
    const deckShards = new Set(physical.map((n) => `/cards/${shardOf(normalizeName(n))}.json`));
    cardFetches.push([...asked].filter((u) => u.includes("/cards/") && ![...deckShards].some((d) => u.endsWith(d))).length);
    eventFetches.push([...asked].filter((u) => u.includes("/events/")).length);
    process.stderr.write(`${deckName}: A ${Date.now() - aStart} ms, pool A ${a.plan.length} plan, pool B ${poolB.size} (${Math.round((Date.now() - started) / 1000)} s)\n`);
  }

  if (ONLY_B) return;
  console.log(`PASS MARK (fixed 2026-09-24): A >= ${PASS} of B's top ${TOP} on the median deck, per list`);
  console.log(`decks ${files.length}; static-out ${version}\n`);
  const kinds = new Map<string, number[]>();
  for (const [list, xs] of Object.entries(overlap)) {
    const kind = list.split(":")[0]!;
    kinds.set(kind, [...(kinds.get(kind) ?? []), ...xs]);
  }
  for (const [kind, xs] of kinds) {
    const med = median(xs) * TOP;
    console.log(`${kind.padEnd(8)} lists ${String(xs.length).padStart(3)}  median ${med.toFixed(1)}/${TOP}  min ${(Math.min(...xs) * TOP).toFixed(1)}/${TOP}  ${med >= PASS ? "PASS" : "FAIL"}`);
  }
  const q = [...quality].sort((x, y) => x - y);
  console.log(`plan quality (A's picks' on-plan / B's #${TOP}, capped 1): median ${median(q).toFixed(2)}, p25 ${q[q.length >> 2]!.toFixed(2)}, min ${q[0]!.toFixed(2)}`);
  console.log(`plan picks within 95% of B's #${TOP}, per deck (of ${8}): median ${median(near)}, p25 ${[...near].sort((x, y) => x - y)[near.length >> 2]}`);
  const hist = (overlap.plan ?? []).reduce<number[]>((h, x) => { h[Math.round(x * TOP)]++; return h; }, Array(TOP + 1).fill(0));
  console.log(`plan hits per deck, 0..${TOP}: ${hist.join(" ")}`);
  console.log("\nworst 5 lists (cards B has and A misses):");
  for (const w of worst.sort((x, y) => x.hit - y.hit).slice(0, 5)) {
    console.log(`  ${w.deck} ${w.list} ${(w.hit * TOP).toFixed(0)}/${TOP}: ${w.missed.join(", ")}`);
  }
  console.log(`\nDIAGNOSTIC: B plan top-${TOP} cards by number of decks (of ${files.length}):`);
  for (const [n, k] of [...bTopFreq].sort((x, y) => y[1] - x[1]).slice(0, 20)) console.log(`  ${String(k).padStart(3)}  ${n}`);
  console.log(`on-plan ranking, B top-${TOP} by decks:`);
  for (const [n, k] of [...bPlanFreq].sort((x, y) => y[1] - x[1]).slice(0, 10)) console.log(`  ${String(k).padStart(3)}  ${n}`);
  console.log(`distinct cards across all on-plan B top-${TOP}s: ${bPlanFreq.size}`);
  console.log(`distinct cards across all B plan top-${TOP}s: ${bTopFreq.size} (of ${files.length * TOP} slots)`);
  const r = [...aRankInB].sort((x, y) => x - y);
  console.log(`A plan picks' rank in B plan order: n ${r.length}, median ${median(r)}, p25 ${r[r.length >> 2]}, p75 ${r[(r.length * 3) >> 2]}; A picks absent from B plan: ${conn.reduce((t, c) => t + c.aMissingFromB, 0)}`);
  console.log(`connections, median over decks: A #1 ${median(conn.map((c) => c.aTop))}, B #1 ${median(conn.map((c) => c.bTop))}, B #${TOP} ${median(conn.map((c) => c.b10))}`);
  console.log(`\ndecks with >= 1 card, per finding kind: build ${perKind.build}, answers ${perKind.answers}, synergy ${perKind.synergy} (of ${files.length})`);
  console.log(`findings ending in "nothing connects": build ${findingsEmpty.build}/${findingsTotal.build}, answers ${findingsEmpty.answers}/${findingsTotal.answers}, synergy ${findingsEmpty.synergy}/${findingsTotal.synergy}`);
  console.log(`unmet demand keys translating to no event key: ${untranslatable}`);
  console.log(`suggestForDeck wall time per deck (node, warm file reads): median ${median(aMs)} ms, max ${Math.max(...aMs)} ms`);
  console.log(`card shards fetched beyond the deck's own, per deck: median ${median(cardFetches)}, max ${Math.max(...cardFetches)} (~11 KB each); events shards: median ${median(eventFetches)}, max ${Math.max(...eventFetches)} (~16 KB each)`);
  console.log(`stale pairs dropped by live verification: ${stale}`);
  console.log(`role parity (report roles vs name-index r): ${roleChecked - roleMismatch}/${roleChecked}`);
  console.log(`\nprecision sample (judge each against both cards' oracle text, fetched, never from memory):`);
  for (const s of sample.slice(0, 20)) console.log(`  [${s.deck}] ${s.connection} + ${s.card}: ${s.reason}`);
}

void main();
