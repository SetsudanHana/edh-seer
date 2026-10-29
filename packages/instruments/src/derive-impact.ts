/** FREE, READ-ONLY (#1410). What an engine change does to the derived corpus, measured IN MEMORY at two commits:
 *  BASE is `git archive`d into a temp dir (cached by sha), HEAD is the WORKING TREE, so it runs on uncommitted work.
 *  Mongo is read (`cards`, `cardClauses`, `tokens`) and never written; the stored `cardTagsDerived` is not read at all,
 *  so the numbers do not depend on what the last derive-corpus left there.
 *
 *  Usage: npx tsx packages/instruments/src/derive-impact.ts <BASE-ref> [--cards "A|B"] [--json out.json] [--pairs N] [--no-pairs] [--matcher auto|own|head]
 *    --cards     restrict what is REPORTED to these card names (every row is still derived: pair reasons need the other cards)
 *    --pairs N   pair reasons for at most N changed cards (default all); --no-pairs skips them
 *    --matcher   `auto` (default): each side's own matcher when a matcher/engine source file differs between BASE and HEAD, else HEAD's for both
 *
 *  The pure diffs are in derive-impact-core.ts. Rows mirror derive-corpus: a card whose text has no answered clause doc and that the
 *  grammar reads completely derives from its printed text (`clauseSource: "grammar"`); every other clause doc goes through `deriveRow`.
 *  Pair reasons are keyed tag|producer|consumer|magnitude over every other derived (non-token) card, tags from the in-memory rows of that side. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { connect, docToCard, loadConfig } from "@edh-seer/data";
import {
  classifyRows, diffReasonKeys, formatReport, grammarReport, pairsReport, reasonKey, snapOf,
  type CardPairs, type GrammarEntry, type ImpactReport, type RowSnap,
} from "./derive-impact-core.js";

const REPO = resolve(import.meta.dirname, "../../..");
const git = (...args: string[]): string => execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 1 << 28 }).trim();

const { positionals, values } = parseArgs({
  allowPositionals: true, strict: true,
  options: { cards: { type: "string" }, json: { type: "string" }, pairs: { type: "string" }, "no-pairs": { type: "boolean", default: false }, matcher: { type: "string", default: "auto" } },
});
if (positionals.length !== 1) { console.error('usage: derive-impact.ts <BASE-ref> [--cards "A|B"] [--json out.json] [--pairs N] [--no-pairs] [--matcher auto|own|head]'); process.exit(2); }
const only = values.cards ? new Set(values.cards.split("|").map((s) => s.trim()).filter(Boolean)) : null;
const pairCap = values.pairs !== undefined ? Number(values.pairs) : Infinity;
if (Number.isNaN(pairCap) || pairCap < 0) { console.error("--pairs takes a non-negative number"); process.exit(2); }

const log = (s: string): void => { console.error(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`); };
const t0 = Date.now();

// ---- the BASE tree ----
const baseSha = git("rev-parse", "--verify", `${positionals[0]}^{commit}`);
const baseRoot = join(tmpdir(), `edh-impact-${baseSha}`);
const PKGS = ["tagger", "matcher", "data", "engine"];
if (!existsSync(join(baseRoot, ".complete"))) {
  const part = `${baseRoot}.partial-${process.pid}`;
  rmSync(part, { recursive: true, force: true });
  mkdirSync(part, { recursive: true });
  const tar = execFileSync("git", ["archive", baseSha, ...PKGS.map((p) => `packages/${p}`)], { cwd: REPO, maxBuffer: 1 << 30 });
  execFileSync("tar", ["-x", "-C", part], { input: tar, maxBuffer: 1 << 28 });
  rmSync(baseRoot, { recursive: true, force: true });
  renameSync(part, baseRoot);
  // Third-party modules come from the repo's node_modules; `@edh-seer/*` must point at THIS tree's packages, or BASE's tagger would import HEAD's data.
  // Made after the rename: the links are absolute.
  mkdirSync(join(baseRoot, "node_modules", "@edh-seer"), { recursive: true });
  for (const e of readdirSync(join(REPO, "node_modules"))) if (e !== "@edh-seer") symlinkSync(join(REPO, "node_modules", e), join(baseRoot, "node_modules", e));
  for (const p of PKGS) symlinkSync(join(baseRoot, "packages", p), join(baseRoot, "node_modules", "@edh-seer", p));
  writeFileSync(join(baseRoot, ".complete"), baseSha);
  log(`BASE ${baseSha.slice(0, 8)} archived to ${baseRoot}`);
} else log(`BASE ${baseSha.slice(0, 8)} tree reused from ${baseRoot}`);

// ---- both sides' modules, by absolute path ----
interface Side {
  deriveRow: (i: { doc: any; source: any; isToken: boolean }) => { tags: any; fromGrammar: boolean };
  grammarClauseRecords: (c: any) => { complete: boolean; records: any[]; readings?: any };
  deriveCardTags: (i: any) => any;
  deriveInputOf: (...a: any[]) => any;
  deriveScopeFilter: () => Record<string, unknown>;
  segmentHash: (t: string, ty: string, k: string[]) => string;
  matcher: { pairReasonsAcrossFaces: (a: any, b: any, h: any) => any[]; loadHierarchy: () => any };
}
async function loadSide(root: string): Promise<Side> {
  const imp = (rel: string): Promise<any> => import(pathToFileURL(join(root, rel)).href);
  const [w, g, d, i, s, m, sc] = await Promise.all([
    imp("packages/tagger/src/derive-worker.ts"), imp("packages/tagger/src/grammar/clause-record.ts"), imp("packages/tagger/src/derive/derive.ts"),
    imp("packages/tagger/src/derive-input.ts"), imp("packages/tagger/src/clause-store.ts"), imp("packages/matcher/src/index.ts"), imp("packages/tagger/src/derive-scope.ts"),
  ]);
  return { deriveRow: w.deriveRow, grammarClauseRecords: g.grammarClauseRecords, deriveCardTags: d.deriveCardTags, deriveInputOf: i.deriveInputOf, segmentHash: s.segmentHash, deriveScopeFilter: sc.deriveScopeFilter, matcher: m };
}
const [B, H] = [await loadSide(baseRoot), await loadSide(REPO)];

// ---- did the matcher itself change? ----
const matcherFiles = git("diff", "--name-only", baseSha, "--", "packages/matcher", "packages/engine/src").split("\n").filter(Boolean)
  .filter((f) => (f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.includes("/fixtures/") && !f.includes("/bin/")) || f.endsWith("hierarchy.json"));
const matcherMode = values.matcher === "own" || values.matcher === "head" ? values.matcher : matcherFiles.length > 0 ? "own" : "head";
log(`matcher: ${matcherMode}${matcherFiles.length ? ` (${matcherFiles.length} matcher/engine source file(s) differ: ${matcherFiles.slice(0, 5).join(", ")})` : " (no matcher/engine source differs)"}`);

// ---- Mongo, read-only ----
const store = await connect(loadConfig());
const clauseDocs = await store.db.collection("cardClauses").find({}).toArray() as any[];
const tokenIds = clauseDocs.filter((d) => d.isToken).map((d) => d.oracleId);
const tokenSrc = new Map((await store.db.collection("tokens").find({ _id: { $in: tokenIds } } as never).toArray() as any[]).map((t) => [t._id as string, t]));
const inScope = new Set((await store.cards.find(H.deriveScopeFilter() as never).project({ _id: 1 }).toArray() as any[]).map((c) => c._id as string));
const allCards = await store.cards.find({}).toArray() as any[];
const cardById = new Map(allCards.map((c) => [c._id as string, c]));
log(`read ${clauseDocs.length} clause docs (${tokenIds.length} tokens), ${allCards.length} cards (${inScope.size} in derive scope)`);

// ---- rows + grammar, both sides ----
interface Row { snap: RowSnap; tags: any }
type RowMap = Map<string, Row>;
const rowsB: RowMap = new Map(), rowsH: RowMap = new Map();
const answered = new Map(clauseDocs.filter((d) => !d.isToken).map((d) => [d.oracleId as string, d.segmentHash as string])); // the stored hash; each side compares it with ITS OWN segmentHash of the current text
const grammarOnlyB = new Set<string>(), grammarOnlyH = new Set<string>();
const grammarEntries: GrammarEntry[] = [];
for (const c of allCards) {
  const gb = B.grammarClauseRecords(c), gh = H.grammarClauseRecords(c);
  grammarEntries.push({ id: c._id, name: c.name, base: { complete: gb.complete, records: JSON.stringify(gb.records) }, head: { complete: gh.complete, records: JSON.stringify(gh.records) } });
  if (!inScope.has(c._id)) continue;
  for (const [side, g, rows, only_] of [[B, gb, rowsB, grammarOnlyB], [H, gh, rowsH, grammarOnlyH]] as const) {
    if (!g.complete) continue;
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

// ---- pair reasons ----
let pairs: ImpactReport["pairs"];
let pairDetail: CardPairs[] = [];
if (!values["no-pairs"]) {
  const hB = (matcherMode === "own" ? B : H).matcher, hH = H.matcher;
  const hierB = hB.loadHierarchy(), hierH = hH.loadHierarchy();
  const subjects = rows.changes.filter((c) => (c.status === "changed" || c.status === "added" || c.status === "removed") && cardById.has(c.id)).slice(0, pairCap);
  const ids = [...new Set([...rowsB.keys(), ...rowsH.keys()])].filter((id) => cardById.has(id)).sort();
  const deck = (id: string, rowsOf: RowMap) => { const r = rowsOf.get(id); return r ? { card: docToCard(cardById.get(id) as never), tags: r.tags } : null; };
  const othersB = new Map(ids.map((id) => [id, deck(id, rowsB)])), othersH = new Map(ids.map((id) => [id, deck(id, rowsH)]));
  let done = 0;
  for (const s of subjects) {
    const sb = othersB.get(s.id) ?? null, sh = othersH.get(s.id) ?? null;
    const kb = new Set<string>(), kh = new Set<string>();
    for (const id of ids) {
      if (id === s.id) continue;
      const ob = othersB.get(id), oh = othersH.get(id);
      // Keys carry both card names, so a key from one other card never collides with another's. A side with no row for either card has no reasons.
      if (sb && ob) for (const r of hB.pairReasonsAcrossFaces(sb, ob, hierB)) kb.add(reasonKey(r));
      if (sh && oh) for (const r of hH.pairReasonsAcrossFaces(sh, oh, hierH)) kh.add(reasonKey(r));
    }
    const d = diffReasonKeys(kb, kh);
    pairDetail.push({ id: s.id, name: s.name, ...d });
    if (++done % 10 === 0) log(`pair reasons ${done}/${subjects.length}`);
  }
  pairs = { ...pairsReport(pairDetail), cards: subjects.length };
}

const report: ImpactReport = { base: baseSha.slice(0, 8), head: "working tree", matcher: matcherMode, rows, grammar, ...(pairs ? { pairs } : {}) };
console.log(formatReport(report));
if (values.json) writeFileSync(values.json, JSON.stringify({ ...report, pairDetail, grammarFlips: { gained: grammar.gained, lost: grammar.lost, recordsChanged: grammar.recordsChanged } }, null, 1));
log(`done, wall ${((Date.now() - t0) / 1000).toFixed(1)}s`);
await store.close();
