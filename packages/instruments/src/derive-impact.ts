/** FREE, READ-ONLY (#1410). What an engine change does to the derived corpus, measured IN MEMORY at two commits:
 *  BASE is `git archive`d into a per-user cache (~/.cache/edh-impact/<sha>), HEAD is the WORKING TREE, so it runs on uncommitted work.
 *  Mongo is read (`cards`, `cardClauses`, `tokens`) and never written; the stored `cardTagsDerived` is not read at all,
 *  so the numbers do not depend on what the last derive-corpus left there.
 *
 *  Usage: npx tsx packages/instruments/src/derive-impact.ts <BASE-ref> [--cards "A|B"] [--json out.json] [--pairs N] [--no-pairs] [--no-ratchets] [--pair-sample N] [--matcher own|head]
 *    --cards        restrict what is REPORTED to these card names (every row is still derived: pair reasons need the other cards)
 *    --pairs N      pair reasons for at most N changed rows (default all); --no-pairs skips them (and the sample)
 *    --pair-sample N  pair reasons for N seeded, stable cards, changed or not: what a MATCHER-only change does. Default: SAMPLE_DEFAULT when the
 *                   matcher's code differs between BASE and the working tree, else 0
 *    --no-ratchets  skip the in-memory role-ratchet and dropped-clauses (BASE -> HEAD, and HEAD against the banked snapshots)
 *    --workers N    worker threads for the pair phase (default: every core but one); the output does not depend on it
 *    --matcher      `own` (default): each side's own matcher, which is the truth. `head`: HEAD's on both sides, to isolate what the rows alone did
 *
 *  The pure diffs are in derive-impact-core.ts. Rows mirror derive-corpus: a card with no answered clause doc that the grammar reads completely
 *  derives from its printed text (`clauseSource: "grammar"`); every other clause doc goes through `deriveRow`. Pair reasons are over every other
 *  derived card AND the token nodes `collectTokenNodes` builds from them (the maker->token `creates` reasons too; a token with no derived row is synthesized as the engine does),
 *  tags from the in-memory rows of that side. */
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, posix, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { connect, loadConfig } from "@edh-seer/data";
import { createPool, defaultWorkers } from "@edh-seer/data/parallel";
import {
  chooseMatcher, classifyRows, formatReport, ratchetReport, grammarReport, nodeModulesHash, pairsReport, sampleIds, snapOf, splitMatcherCode, treeVerdict,
  type CardPairs, type GrammarEntry, type RatchetInputs, type ImpactReport, type PairSection, type RowSnap,
} from "./derive-impact-core.js";
import { reach } from "./derive-impact-graph.js";
import { measureDropped, measureRoles, type DroppedTagger, type RoleDetectors } from "./ratchet-measure.js";
import type { PairItem, PairResult, Setup } from "./derive-impact-worker.js";

/** Cards in the matcher sample when the matcher's code differs. About 0.4 s per card on 9 workers (both sides, against every card). */
const SAMPLE_DEFAULT = 300;
const REPO = resolve(import.meta.dirname, "../../..");
const git = (...args: string[]): string => execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 1 << 28 }).trim();

const { positionals, values } = parseArgs({
  allowPositionals: true, strict: true,
  options: { cards: { type: "string" }, json: { type: "string" }, pairs: { type: "string" }, "no-pairs": { type: "boolean", default: false }, "no-ratchets": { type: "boolean", default: false }, "pair-sample": { type: "string" }, workers: { type: "string" }, matcher: { type: "string" } },
});
if (positionals.length !== 1) { console.error('usage: derive-impact.ts <BASE-ref> [--cards "A|B"] [--json out.json] [--pairs N] [--no-pairs] [--no-ratchets] [--pair-sample N] [--workers N] [--matcher own|head]'); process.exit(2); }
const only = values.cards ? new Set(values.cards.split("|").map((s) => s.trim()).filter(Boolean)) : null;
const num = (v: string | undefined, dflt: number, flag: string): number => {
  if (v === undefined) return dflt;
  const x = Number(v);
  if (!Number.isFinite(x) || x < 0) { console.error(`${flag} takes a non-negative number`); process.exit(2); }
  return x;
};
const pairCap = num(values.pairs, Infinity, "--pairs");
const matcherMode = chooseMatcher(values.matcher);

const t0 = Date.now();
const log = (s: string): void => { console.error(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`); };

// ---- the BASE tree, in a per-user cache ----
const baseSha = git("rev-parse", "--verify", `${positionals[0]}^{commit}`);
const PKGS = ["tagger", "matcher", "data", "engine"];
const uid = process.getuid?.() ?? -1;
const CACHE = join(homedir(), ".cache", "edh-impact");
mkdirSync(CACHE, { recursive: true, mode: 0o700 });
const verdictOf = (p: string): string => { const st = lstatSync(p); return treeVerdict({ isDirectory: st.isDirectory(), isSymbolicLink: st.isSymbolicLink(), uid: st.uid, mode: st.mode }, uid); };
if (verdictOf(CACHE) !== "ok") { console.error(`${CACHE} is not safe to import code from: ${verdictOf(CACHE)}`); process.exit(1); }
const nmHash = nodeModulesHash(readdirSync(join(REPO, "node_modules")));
const baseRoot = join(CACHE, baseSha);
const HOUR = 3600_000;
/** A cached tree we may import: a real directory owned by us, not writable by others, completed against this node_modules. Anything else is moved aside, never deleted (another run may be using it). */
function usable(): boolean {
  if (!lstatSyncSafe(baseRoot)) return false;
  const v = verdictOf(baseRoot);
  let why = v === "ok" ? "" : v;
  if (!why) {
    try { const c = JSON.parse(readFileSync(join(baseRoot, ".complete"), "utf8")) as { sha?: string; nm?: string }; if (c.sha !== baseSha || c.nm !== nmHash) why = "node_modules listing or sha differs from the one it was built against"; }
    catch { why = "no .complete"; }
  }
  if (!why) return true;
  const aside = `${baseRoot}.rejected-${process.pid}-${Date.now()}`;
  log(`cached tree ${baseRoot} rejected (${why}); moved to ${aside}`);
  renameSync(baseRoot, aside);
  return false;
}
function lstatSyncSafe(p: string): boolean { try { lstatSync(p); return true; } catch { return false; } }
// Half-built trees live in `<sha>.build-*`; one without `.complete` that is over an hour old is dead and may go.
for (const e of readdirSync(CACHE)) {
  const p = join(CACHE, e);
  if (e.includes(".build-") && !existsSync(join(p, ".complete")) && Date.now() - statSync(p).mtimeMs > HOUR) rmSync(p, { recursive: true, force: true });
}
if (!usable()) {
  const build = mkdtempSync(join(CACHE, `${baseSha}.build-`)); // mode 0700
  const tar = execFileSync("git", ["archive", baseSha, ...PKGS.map((p) => `packages/${p}`)], { cwd: REPO, maxBuffer: 1 << 30 });
  execFileSync("tar", ["-x", "-C", build], { input: tar, maxBuffer: 1 << 28 });
  // Third-party modules come from the repo's node_modules; `@edh-seer/*` must point at THIS tree's packages, or BASE's tagger would import HEAD's data.
  // The links name the FINAL path (absolute), so they are good once the rename below lands.
  mkdirSync(join(build, "node_modules", "@edh-seer"), { recursive: true });
  for (const e of readdirSync(join(REPO, "node_modules"))) if (e !== "@edh-seer") symlinkSync(join(REPO, "node_modules", e), join(build, "node_modules", e));
  for (const p of PKGS) symlinkSync(join(baseRoot, "packages", p), join(build, "node_modules", "@edh-seer", p));
  writeFileSync(join(build, ".complete"), JSON.stringify({ sha: baseSha, nm: nmHash }));
  try { renameSync(build, baseRoot); log(`BASE ${baseSha.slice(0, 8)} archived to ${baseRoot}`); }
  catch (e) {
    // Another run landed the same sha first: use its tree if it passes the same checks; our own build dir is ours to remove.
    rmSync(build, { recursive: true, force: true });
    if (!usable()) throw e;
  }
} else log(`BASE ${baseSha.slice(0, 8)} tree reused from ${baseRoot}`);

// ---- both sides' modules, by absolute path ----
interface Side {
  deriveRow: (i: { doc: any; source: any; isToken: boolean }) => { tags: any; fromGrammar: boolean };
  grammarClauseRecords: (c: any) => { complete: boolean; records: any[]; readings?: any };
  deriveCardTags: (i: any) => any;
  deriveInputOf: (...a: any[]) => any;
  deriveScopeFilter: () => Record<string, unknown>;
  segmentHash: (t: string, ty: string, k: string[]) => string;
  deriveVersion: number;
  tagger: DroppedTagger;
  matcher: RoleDetectors;
  /** packages/data docs.ts of THAT commit: a change to how a card document becomes a Card is part of what is measured. */
  docToCard: (d: never) => unknown;
  isStickerCard: (d: never) => boolean;
}
async function loadSide(root: string): Promise<Side> {
  const imp = (rel: string): Promise<any> => import(pathToFileURL(join(root, rel)).href);
  const [w, g, d, i, s, sc, tg, mt, dt] = await Promise.all([
    imp("packages/tagger/src/derive-worker.ts"), imp("packages/tagger/src/grammar/clause-record.ts"), imp("packages/tagger/src/derive/derive.ts"),
    imp("packages/tagger/src/derive-input.ts"), imp("packages/tagger/src/clause-store.ts"), imp("packages/tagger/src/derive-scope.ts"),
    imp("packages/tagger/src/index.ts"), imp("packages/matcher/src/index.ts"), imp("packages/data/src/docs.ts"),
  ]);
  return { deriveRow: w.deriveRow, grammarClauseRecords: g.grammarClauseRecords, deriveCardTags: d.deriveCardTags, deriveInputOf: i.deriveInputOf, segmentHash: s.segmentHash, deriveScopeFilter: sc.deriveScopeFilter, deriveVersion: d.DERIVE_VERSION, tagger: tg, matcher: mt, docToCard: dt.docToCard, isStickerCard: dt.isStickerCard };
}
const [B, H] = [await loadSide(baseRoot), await loadSide(REPO)];

// ---- did code the pair / role path RUNS change? (tracked changes AND new files; the import graph, in both trees) ----
const PAIR_ROLE_ENTRIES = ["edges", "faces", "tokens", "token-tags", "hierarchy", "build", "wincon", "types"].map((f) => `packages/matcher/src/${f}.ts`);
/** CEILING: analyze.ts is on the path for `collectTokenNodes` / `disambiguateFaceNames` only, but its imports are not followed (they are the whole deck pipeline), so an edit anywhere in analyze.ts counts as on-path. */
const ANALYZE = "packages/matcher/src/analyze.ts";
function reachIn(root: string): Set<string> {
  const pkgExports = new Map<string, { exports?: Record<string, string>; main?: string }>();
  const pkg = (name: string) => { let p = pkgExports.get(name); if (!p) { try { p = JSON.parse(readFileSync(join(root, "packages", name, "package.json"), "utf8")); } catch { p = {}; } pkgExports.set(name, p!); } return p!; };
  const resolveSpec = (from: string, spec: string): string | undefined => {
    if (spec.startsWith(".")) { const t = posix.normalize(posix.join(posix.dirname(from), spec.replace(/\.js$/, ".ts"))); return existsSync(join(root, t)) ? t : undefined; }
    const m = /^@edh-seer\/([\w-]+)(\/.*)?$/.exec(spec);
    if (!m) return undefined;
    const p = pkg(m[1]!), key = m[2] ? `.${m[2]}` : ".";
    const target = p.exports?.[key] ?? (key === "." ? p.main : undefined);
    return target ? `packages/${m[1]}/${target.replace(/^\.\//, "")}` : undefined;
  };
  const r = reach(PAIR_ROLE_ENTRIES, (rel) => { try { return readFileSync(join(root, rel), "utf8"); } catch { return undefined; } }, resolveSpec);
  r.add(ANALYZE);
  return r;
}
const reachable = new Set([...reachIn(REPO), ...reachIn(baseRoot)]);
const changedPaths = [...new Set([
  ...git("diff", "--name-only", baseSha, "--", "packages").split("\n"),
  ...git("ls-files", "--others", "--exclude-standard", "--", "packages").split("\n"),
].filter(Boolean))];
const { onPath: matcherCode, offPath: matcherOffPath } = splitMatcherCode(changedPaths, reachable);
const headSha = git("rev-parse", "--short=8", "HEAD");
const dirty = git("status", "--porcelain", "--", "packages").length > 0;
log(`matcher: ${matcherMode}; ${reachable.size} files on the pair/role path; changed on it: ${matcherCode.length ? `${matcherCode.length} (${matcherCode.slice(0, 5).join(", ")})` : "none"}; changed off it: ${matcherOffPath.length}`);
const sampleN = values["no-pairs"] ? 0 : num(values["pair-sample"], matcherCode.length ? SAMPLE_DEFAULT : 0, "--pair-sample");

// ---- Mongo, read-only ----
const store = await connect(loadConfig());
const clauseDocs = await store.db.collection("cardClauses").find({}).toArray() as any[];
const tokenIds = clauseDocs.filter((d) => d.isToken).map((d) => d.oracleId as string);
const tokenDocs = await store.db.collection("tokens").find({}).toArray() as any[];
const tokenSrc = new Map(tokenDocs.map((t) => [t._id as string, t]));
const scopeOf = async (s: Side): Promise<Set<string>> => new Set((await store.cards.find(s.deriveScopeFilter() as never).project({ _id: 1 }).toArray() as any[]).map((c) => c._id as string));
const [scopeB, scopeH] = [await scopeOf(B), await scopeOf(H)];
const allCards = await store.cards.find({}).toArray() as any[];
const cardById = new Map(allCards.map((c) => [c._id as string, c]));
log(`read ${clauseDocs.length} clause docs (${tokenIds.length} tokens), ${allCards.length} cards (derive scope BASE ${scopeB.size}, HEAD ${scopeH.size})`);

// ---- rows + grammar, both sides ----
interface Row { snap: RowSnap; tags: any }
type RowMap = Map<string, Row>;
const rowsB: RowMap = new Map(), rowsH: RowMap = new Map();
const answered = new Map(clauseDocs.filter((d) => !d.isToken).map((d) => [d.oracleId as string, d.segmentHash as string])); // each side compares it with ITS OWN segmentHash of the current text
const grammarOnlyB = new Set<string>(), grammarOnlyH = new Set<string>();
const grammarEntries: GrammarEntry[] = [];
for (const c of allCards) {
  const gb = B.grammarClauseRecords(c), gh = H.grammarClauseRecords(c);
  grammarEntries.push({ id: c._id, name: c.name, base: { complete: gb.complete, records: JSON.stringify(gb.records) }, head: { complete: gh.complete, records: JSON.stringify(gh.records) } });
  for (const [side, g, rows, only_, scope] of [[B, gb, rowsB, grammarOnlyB, scopeB], [H, gh, rowsH, grammarOnlyH, scopeH]] as const) {
    if (!scope.has(c._id) || !g.complete) continue;
    if (answered.get(c._id) === side.segmentHash(c.oracleText ?? "", c.typeLine ?? "", c.keywords ?? [])) continue;
    only_.add(c._id);
    const tags = side.deriveCardTags(side.deriveInputOf(c, c._id, c.name, g.records, undefined, g.readings));
    rows.set(c._id, { snap: snapOf(c.name, tags, true), tags });
  }
}
log(`grammar pass over ${allCards.length} cards done; grammar-only rows BASE ${grammarOnlyB.size}, HEAD ${grammarOnlyH.size}`);
for (const doc of clauseDocs) {
  const source = doc.isToken ? tokenSrc.get(doc.oracleId) : cardById.get(doc.oracleId);
  if (!source) continue;
  for (const [side, rows, only_] of [[B, rowsB, grammarOnlyB], [H, rowsH, grammarOnlyH]] as const) {
    if (!doc.isToken && only_.has(doc.oracleId)) continue;
    const r = side.deriveRow({ doc, source, isToken: !!doc.isToken });
    rows.set(doc.oracleId, { snap: snapOf(doc.name, r.tags, r.fromGrammar), tags: r.tags });
  }
}
log(`rows derived: BASE ${rowsB.size}, HEAD ${rowsH.size}`);

const keep = (name: string): boolean => !only || only.has(name);
const snaps = (m: RowMap): Map<string, RowSnap> => new Map([...m].filter(([, r]) => keep(r.snap.name)).map(([id, r]) => [id, r.snap]));
const rows = classifyRows(snaps(rowsB), snaps(rowsH));
const grammar = grammarReport(grammarEntries.filter((e) => keep(e.name)));

// ---- the two by-name ratchets, in memory (the bins' own measuring functions, each commit's own tagger / matcher / docs.ts, no Mongo write) ----
let ratchets: ReturnType<typeof ratchetReport> | undefined;
if (!values["no-ratchets"]) {
  const canonical = new Map(clauseDocs.filter((d) => !d.isToken).map((d) => [d.oracleId as string, d.canonical]));
  const measure = (side: Side, rowsOf: RowMap, detectors: RoleDetectors): RatchetInputs => {
    // The bins' population: every commander-legal card, stickers skipped (by THIS commit's isStickerCard), by name.
    const inEngine = allCards.filter((c) => c.legalities?.commander === "legal" && !side.isStickerCard(c as never)).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const dropped = measureDropped(inEngine, (id) => { const r = rowsOf.get(id); return r ? { ...r.tags, clauseSource: r.snap.fromGrammar ? "grammar" : "model" } : undefined; }, (id) => canonical.get(id), side.tagger).measured;
    const dc = inEngine.map((d) => ({ card: side.docToCard(d as never), tags: rowsOf.get(d._id)?.tags ?? null }));
    return { dropped, roles: measureRoles(dc, detectors), untagged: dc.filter((x) => x.tags === null).map((x) => (x.card as { name: string }).name) };
  };
  const bank = (f: string): unknown => JSON.parse(readFileSync(join(REPO, "packages/instruments", f), "utf8"));
  const bankedDropped = bank("dropped-clauses.json") as RatchetInputs["dropped"], bankedRoles = bank("role-membership.json") as RatchetInputs["roles"], bankedUntagged = bank("role-membership-untagged.json") as string[];
  ratchets = ratchetReport(measure(B, rowsB, matcherMode === "own" ? B.matcher : H.matcher), measure(H, rowsH, H.matcher), { dropped: bankedDropped, roles: bankedRoles, untagged: bankedUntagged });
  log(`ratchets measured: dropped-clauses ${ratchets.dropped.base.actions} -> ${ratchets.dropped.head.actions}, role-ratchet gained ${ratchets.roles.gained.length} lost ${ratchets.roles.lost.length}, untagged ${ratchets.untagged.base} -> ${ratchets.untagged.head}`);
}

// ---- pair reasons, spread over worker threads (results come back in input order, so the report equals a one-worker run) ----
let samplePopulation: number | undefined;
let pairs: PairSection | undefined, sample: PairSection | undefined, tokens: ImpactReport["tokens"];
const pairDetail: CardPairs[] = [], sampleDetail: CardPairs[] = [];
if (!values["no-pairs"]) {
  const tagsOf = (m: RowMap) => new Map([...m].map(([id, r]) => [id, r.tags]));
  const docs = new Map<string, any>();
  for (const id of new Set([...rowsB.keys(), ...rowsH.keys()])) if (cardById.has(id) && !tokenSrc.has(id)) docs.set(id, cardById.get(id));
  const setup: Setup = { baseRoot, repo: REPO, ownMatcher: matcherMode === "own", tagsB: tagsOf(rowsB), tagsH: tagsOf(rowsH), docs, tokenDocs };
  const pool = createPool<PairItem, PairResult>(new URL("./derive-impact-worker.ts", import.meta.url), { workers: num(values.workers, defaultWorkers(), "--workers"), heapMb: 8192 });
  try {
    await pool.broadcast(setup);
    const world = (await pool.map([{ id: "", name: "", isToken: false, info: true }]))[0]!.info!;
    tokens = { docs: tokenDocs.length, withRow: tokenIds.length, nodesBase: world.nodesBase, nodesHead: world.nodesHead };
    log(`pair worlds built in the workers (token nodes: BASE ${world.nodesBase}, HEAD ${world.nodesHead})`);
    const skipped: string[] = [];
    const changedRows = rows.changes.filter((c) => c.status === "changed" || c.status === "added" || c.status === "removed").slice(0, pairCap);
    const items: PairItem[] = changedRows.map((c) => ({ id: c.id, name: c.name, isToken: tokenSrc.has(c.id) }));
    const results = await pool.map(items);
    results.forEach((r, i) => {
      const it = items[i]!;
      // A card with no document, or a token no card makes, has no node to pair.
      if (r.present && (it.isToken || cardById.has(it.id))) pairDetail.push(r.detail);
      else skipped.push(`${it.name} (${it.isToken ? "token no card makes" : "no card document"})`);
    });
    pairs = { ...pairsReport(pairDetail), cards: pairDetail.length, skipped };
    log(`pair reasons of ${pairDetail.length} changed rows done`);
    if (sampleN > 0) {
      const taken = new Set(items.map((i) => i.id));
      const candidates = [...docs.keys()].filter((id) => rowsH.has(id) && !taken.has(id));
      samplePopulation = candidates.length;
      const ids = sampleIds(candidates, sampleN);
      for (const r of await pool.map(ids.map((id): PairItem => ({ id, name: (cardById.get(id) as { name: string }).name, isToken: false })))) sampleDetail.push(r.detail);
      sample = { ...pairsReport(sampleDetail), cards: ids.length, skipped: [] };
      log(`matcher sample of ${ids.length} cards done`);
    }
  } finally { await pool.close(); }
}

const report: ImpactReport = {
  base: { ref: positionals[0]!, sha: baseSha.slice(0, 8), deriveVersion: B.deriveVersion }, head: { ref: "HEAD", sha: headSha, deriveVersion: H.deriveVersion, dirty },
  matcher: matcherMode, matcherCode, matcherOffPath, ...(samplePopulation ? { samplePopulation } : {}), rows, grammar, ...(pairs ? { pairs } : {}), ...(sample ? { sample } : {}), ...(tokens ? { tokens } : {}), ...(ratchets ? { ratchets } : {}),
};
console.log(formatReport(report));
if (values.json) writeFileSync(values.json, JSON.stringify({ ...report, pairDetail, sampleDetail }, null, 1));
log(`done, wall ${((Date.now() - t0) / 1000).toFixed(1)}s`);
await store.close();
