/** FREE, READ-ONLY (#1410). What an engine change does to the derived corpus, measured IN MEMORY at two commits:
 *  BASE is `git archive`d into a per-user cache (~/.cache/edh-impact/<sha>), HEAD is the WORKING TREE, so it runs on uncommitted work.
 *  Mongo is read (`cards`, `cardClauses`, `tokens`) and never written; the stored `cardTagsDerived` is not read at all,
 *  so the numbers do not depend on what the last derive-corpus left there.
 *
 *  Usage: npx tsx packages/instruments/src/derive-impact.ts <BASE-ref> [--cards "A|B"] [--json out.json] [--pairs N] [--no-pairs] [--pair-sample N] [--matcher own|head]
 *    --cards        restrict what is REPORTED to these card names (every row is still derived: pair reasons need the other cards)
 *    --pairs N      pair reasons for at most N changed rows (default all); --no-pairs skips them (and the sample)
 *    --pair-sample N  pair reasons for N seeded, stable cards, changed or not: what a MATCHER-only change does. Default: SAMPLE_DEFAULT when the
 *                   matcher's code differs between BASE and the working tree, else 0
 *    --workers N    worker threads for the pair phase (default: every core but one); the output does not depend on it
 *    --matcher      `own` (default): each side's own matcher, which is the truth. `head`: HEAD's on both sides, to isolate what the rows alone did
 *
 *  The pure diffs are in derive-impact-core.ts. Rows mirror derive-corpus: a card with no answered clause doc that the grammar reads completely
 *  derives from its printed text (`clauseSource: "grammar"`); every other clause doc goes through `deriveRow`. Pair reasons are over every other
 *  derived card AND the token nodes `collectTokenNodes` builds from them (the maker->token `creates` reasons too), tags from the in-memory rows of that side. */
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { connect, docToCard, loadConfig } from "@edh-seer/data";
import { createPool, defaultWorkers } from "@edh-seer/data/parallel";
import {
  chooseMatcher, classifyRows, formatReport, grammarReport, matcherCodeFiles, nodeModulesHash, pairsReport, sampleIds, snapOf, treeVerdict,
  type CardPairs, type GrammarEntry, type ImpactReport, type PairSection, type RowSnap,
} from "./derive-impact-core.js";
import type { PairItem, PairResult, Setup } from "./derive-impact-worker.js";

/** Cards in the matcher sample when the matcher's code differs. About 1.3 s per card (both sides, against every card). */
const SAMPLE_DEFAULT = 150;
const REPO = resolve(import.meta.dirname, "../../..");
const git = (...args: string[]): string => execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 1 << 28 }).trim();

const { positionals, values } = parseArgs({
  allowPositionals: true, strict: true,
  options: { cards: { type: "string" }, json: { type: "string" }, pairs: { type: "string" }, "no-pairs": { type: "boolean", default: false }, "pair-sample": { type: "string" }, workers: { type: "string" }, matcher: { type: "string" } },
});
if (positionals.length !== 1) { console.error('usage: derive-impact.ts <BASE-ref> [--cards "A|B"] [--json out.json] [--pairs N] [--no-pairs] [--pair-sample N] [--workers N] [--matcher own|head]'); process.exit(2); }
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
}
async function loadSide(root: string): Promise<Side> {
  const imp = (rel: string): Promise<any> => import(pathToFileURL(join(root, rel)).href);
  const [w, g, d, i, s, sc] = await Promise.all([
    imp("packages/tagger/src/derive-worker.ts"), imp("packages/tagger/src/grammar/clause-record.ts"), imp("packages/tagger/src/derive/derive.ts"),
    imp("packages/tagger/src/derive-input.ts"), imp("packages/tagger/src/clause-store.ts"), imp("packages/tagger/src/derive-scope.ts"),
  ]);
  return { deriveRow: w.deriveRow, grammarClauseRecords: g.grammarClauseRecords, deriveCardTags: d.deriveCardTags, deriveInputOf: i.deriveInputOf, segmentHash: s.segmentHash, deriveScopeFilter: sc.deriveScopeFilter, deriveVersion: d.DERIVE_VERSION };
}
const [B, H] = [await loadSide(baseRoot), await loadSide(REPO)];

// ---- did the matcher's code change? (tracked changes AND new files) ----
const taggerExports = (JSON.parse(readFileSync(join(REPO, "packages/tagger/package.json"), "utf8")) as { exports: Record<string, string> }).exports;
const taggerPairTime = Object.entries(taggerExports).filter(([k]) => k !== ".").map(([, v]) => `packages/tagger/${v.replace(/^\.\//, "")}`);
const changedPaths = [...new Set([
  ...git("diff", "--name-only", baseSha, "--", "packages").split("\n"),
  ...git("ls-files", "--others", "--exclude-standard", "--", "packages").split("\n"),
].filter(Boolean))];
const matcherCode = matcherCodeFiles(changedPaths, taggerPairTime);
const headSha = git("rev-parse", "--short=8", "HEAD");
const dirty = git("status", "--porcelain", "--", "packages").length > 0;
log(`matcher: ${matcherMode}; matcher code ${matcherCode.length ? `DIFFERS (${matcherCode.length} file(s): ${matcherCode.slice(0, 5).join(", ")})` : "is the same"}`);
const sampleN = values["no-pairs"] ? 0 : num(values["pair-sample"], matcherCode.length ? SAMPLE_DEFAULT : 0, "--pair-sample");

// ---- Mongo, read-only ----
const store = await connect(loadConfig());
const clauseDocs = await store.db.collection("cardClauses").find({}).toArray() as any[];
const tokenIds = clauseDocs.filter((d) => d.isToken).map((d) => d.oracleId as string);
const tokenDocs = await store.db.collection("tokens").find({}).toArray() as any[];
const tokenSrc = new Map(tokenDocs.map((t) => [t._id as string, t]));
const printingToToken = new Map<string, string>();
for (const t of tokenDocs) for (const p of (t.printingIds ?? []) as string[]) printingToToken.set(p, t._id);
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

// ---- pair reasons, spread over worker threads (results come back in input order, so the report equals a one-worker run) ----
let pairs: PairSection | undefined, sample: PairSection | undefined;
const pairDetail: CardPairs[] = [], sampleDetail: CardPairs[] = [];
if (!values["no-pairs"]) {
  const tagsOf = (m: RowMap) => new Map([...m].map(([id, r]) => [id, r.tags]));
  const cards = new Map<string, any>();
  for (const id of new Set([...rowsB.keys(), ...rowsH.keys()])) if (cardById.has(id) && !tokenSrc.has(id)) cards.set(id, docToCard(cardById.get(id) as never));
  const setup: Setup = { baseRoot, repo: REPO, ownMatcher: matcherMode === "own", tagsB: tagsOf(rowsB), tagsH: tagsOf(rowsH), cards, tokenIds: new Set(tokenSrc.keys()), printingToToken };
  const pool = createPool<PairItem, PairResult>(new URL("./derive-impact-worker.ts", import.meta.url), { workers: num(values.workers, defaultWorkers(), "--workers"), heapMb: 8192 });
  try {
    await pool.broadcast(setup);
    log("pair worlds built in the workers");
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
      const ids = sampleIds([...cards.keys()].filter((id) => rowsH.has(id) && !taken.has(id)), sampleN);
      for (const r of await pool.map(ids.map((id): PairItem => ({ id, name: (cardById.get(id) as { name: string }).name, isToken: false })))) sampleDetail.push(r.detail);
      sample = { ...pairsReport(sampleDetail), cards: ids.length, skipped: [] };
      log(`matcher sample of ${ids.length} cards done`);
    }
  } finally { await pool.close(); }
}

const report: ImpactReport = {
  base: { ref: positionals[0]!, sha: baseSha.slice(0, 8), deriveVersion: B.deriveVersion }, head: { ref: "HEAD", sha: headSha, deriveVersion: H.deriveVersion, dirty },
  matcher: matcherMode, matcherCode, rows, grammar, ...(pairs ? { pairs } : {}), ...(sample ? { sample } : {}),
};
console.log(formatReport(report));
if (values.json) writeFileSync(values.json, JSON.stringify({ ...report, pairDetail, sampleDetail }, null, 1));
log(`done, wall ${((Date.now() - t0) / 1000).toFixed(1)}s`);
await store.close();
