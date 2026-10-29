/** THE PURE HALF OF `derive-impact.ts` (#1410): what an engine change did to the derived corpus, as plain
 *  data diffs. No Mongo, no git, no modules of either commit -- the bin loads both trees and feeds these.
 *
 *  Four reports: derived ROWS (per field set diffs, source flips), GRAMMAR (complete flag and record JSON),
 *  PAIR REASONS (membership tag|producer|consumer, with magnitude and attribute moves apart), and the paste-ready SUMMARY. */
import { createHash } from "node:crypto";
import type { CardTags } from "@edh-seer/tagger/schema";
import type { Dropped } from "./dropped-clauses-core.js";
import { diffMembership, type Membership } from "./role-ratchet-core.js";

/** EVERY FIELD OF A DERIVED ROW IS COMPARED except these, which are constants of the pipeline (not derived from the card's text). */
export const CONSTANT_FIELDS = ["oracleId", "schemaVersion", "promptVersion", "model", "pinned"] as const;
/** Exhaustive over `CardTags`: a new field is a TYPE ERROR here until someone says whether it is derived (compared) or a constant. */
export const FIELD_KIND: Record<keyof CardTags, "compared" | "constant"> = {
  oracleId: "constant", schemaVersion: "constant", promptVersion: "constant", model: "constant", pinned: "constant",
  characteristics: "compared", abilities: "compared", manaLines: "compared", staticFixer: "compared", landFetch: "compared",
  isOneShot: "compared", suspendOnly: "compared", unknownTriggers: "compared", unclaimed: "compared",
};
const CONSTANTS: ReadonlySet<string> = new Set(CONSTANT_FIELDS);

/** Every own key but the constants, in key order, so the JSON is stable. A key `FIELD_KIND` does not know is still compared. */
export const pick = (t: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(t).filter(([k]) => !CONSTANTS.has(k)).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));

/** A row as the report keeps it: the picked fields as JSON (comparable, small) and the winner of `deriveRow`. */
export interface RowSnap { name: string; fromGrammar: boolean; pick: string }
export const snapOf = (name: string, tags: Record<string, unknown>, fromGrammar: boolean): RowSnap => ({ name, fromGrammar, pick: JSON.stringify(pick(tags)) });

export interface FieldDiff { removed: string[]; added: string[] }

/** The entries of one field as JSON strings: an array's members, an object's `key: value` pairs, a scalar itself; absent is none. Duplicates are kept. */
function entriesOf(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) return v.map((x) => JSON.stringify(x));
  if (typeof v === "object") return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${JSON.stringify(x)}`);
  return [JSON.stringify(v)];
}
const counts = (xs: string[]): Map<string, number> => { const m = new Map<string, number>(); for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1); return m; };

/** Per field, the entries only BEFORE (removed) and only AFTER (added), as MULTISETS: `[X, X] -> [X]` removes one X (the #1391 dedupe shape), an entry that moved from two
 *  copies to three adds one. A field with no change is absent. Entries that are the same multiset in another order are a permutation, listed as `(reordered)`.
 *  CEILING: an object-valued field is compared per key, so a reorder of its keys is invisible (JSON key order is not a derive fact). */
export function fieldDiff(before: string, after: string): Record<string, FieldDiff> {
  const a = JSON.parse(before) as Record<string, unknown>, b = JSON.parse(after) as Record<string, unknown>;
  const out: Record<string, FieldDiff> = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const was = counts(entriesOf(a[k])), now = counts(entriesOf(b[k]));
    const removed: string[] = [], added: string[] = [];
    for (const [e, c] of was) for (let i = now.get(e) ?? 0; i < c; i++) removed.push(e);
    for (const [e, c] of now) for (let i = was.get(e) ?? 0; i < c; i++) added.push(e);
    if (removed.length === 0 && added.length === 0 && Array.isArray(a[k]) && JSON.stringify(a[k]) !== JSON.stringify(b[k])) { out[k] = { removed: [`(reordered) ${JSON.stringify(a[k])?.slice(0, 200)}`], added: [`(reordered) ${JSON.stringify(b[k])?.slice(0, 200)}`] }; continue; }
    if (removed.length || added.length) out[k] = { removed, added };
  }
  return out;
}

export type RowStatus = "same" | "changed" | "added" | "removed" | "flip-only";
export interface RowChange { id: string; name: string; status: RowStatus; sourceBefore?: "grammar" | "model"; sourceAfter?: "grammar" | "model"; fields: Record<string, FieldDiff> }
export interface RowTotals { same: number; changed: number; added: number; removed: number; sourceFlipped: number; sourceFlippedIdenticalTags: number }

const sourceOf = (r: RowSnap): "grammar" | "model" => (r.fromGrammar ? "grammar" : "model");

/** Compare one card's row at BASE with HEAD. `flip-only`: the winner moved and the tags did not. */
export function compareRow(id: string, base: RowSnap | undefined, head: RowSnap | undefined): RowChange {
  const name = (head ?? base)?.name ?? id;
  if (!base && !head) return { id, name, status: "same", fields: {} };
  if (!base) return { id, name, status: "added", sourceAfter: sourceOf(head!), fields: {} };
  if (!head) return { id, name, status: "removed", sourceBefore: sourceOf(base), fields: {} };
  const flipped = base.fromGrammar !== head.fromGrammar;
  const tagsSame = base.pick === head.pick;
  const src = { sourceBefore: sourceOf(base), sourceAfter: sourceOf(head) };
  if (tagsSame) return { id, name, status: flipped ? "flip-only" : "same", ...(flipped ? src : {}), fields: {} };
  return { id, name, status: "changed", ...src, fields: fieldDiff(base.pick, head.pick) };
}

export function classifyRows(base: Map<string, RowSnap>, head: Map<string, RowSnap>): { totals: RowTotals; changes: RowChange[] } {
  const totals: RowTotals = { same: 0, changed: 0, added: 0, removed: 0, sourceFlipped: 0, sourceFlippedIdenticalTags: 0 };
  const changes: RowChange[] = [];
  for (const id of [...new Set([...base.keys(), ...head.keys()])].sort()) {
    const c = compareRow(id, base.get(id), head.get(id));
    if (c.status === "same") { totals.same++; continue; }
    changes.push(c);
    if (c.status === "changed") totals.changed++;
    else if (c.status === "added") totals.added++;
    else if (c.status === "removed") totals.removed++;
    else totals.sourceFlippedIdenticalTags++;
    if (c.sourceBefore && c.sourceAfter && c.sourceBefore !== c.sourceAfter) totals.sourceFlipped++;
  }
  changes.sort((x, y) => x.name.localeCompare(y.name) || x.id.localeCompare(y.id));
  return { totals, changes };
}

// ---- grammar ----

export interface GrammarSnap { complete: boolean; records: string }
export interface GrammarEntry { id: string; name: string; base: GrammarSnap; head: GrammarSnap }
export interface GrammarReport { completeBase: number; completeHead: number; gained: string[]; lost: string[]; recordsChanged: string[] }

/** `records` is compared only where a side is complete: an incomplete reading's records are never used, so their churn is noise. */
export function grammarReport(entries: GrammarEntry[]): GrammarReport {
  const r: GrammarReport = { completeBase: 0, completeHead: 0, gained: [], lost: [], recordsChanged: [] };
  for (const e of entries) {
    if (e.base.complete) r.completeBase++;
    if (e.head.complete) r.completeHead++;
    if (!e.base.complete && e.head.complete) r.gained.push(e.name);
    else if (e.base.complete && !e.head.complete) r.lost.push(e.name);
    else if (e.base.complete && e.head.complete && e.base.records !== e.head.records) r.recordsChanged.push(e.name);
  }
  for (const l of [r.gained, r.lost, r.recordsChanged]) l.sort();
  return r;
}

// ---- pair reasons ----

/** The fields of a reason besides its membership key (tag|producer|consumer) and magnitude that the report watches. Not `text`, ability indexes or `enabledBy`. */
export const ATTR_FIELDS = ["effectKind", "repeatability", "scaling", "perTurn", "hasStatPredicate", "producerIsToken", "consumerIsToken", "producerFace", "consumerFace"] as const;
export type ReasonLike = { tag: string; producer?: string; consumer?: string; magnitude?: unknown } & { [K in (typeof ATTR_FIELDS)[number]]?: unknown };

export const memberKey = (r: ReasonLike): string => `${r.tag}|${r.producer ?? ""}|${r.consumer ?? ""}`;
const magOf = (r: ReasonLike): string => JSON.stringify(r.magnitude ?? null);
/** The family of a tag: what precedes its first `:` (`attacks:creature` -> `attacks`). Takes a member key or a tag. */
export const tagFamily = (key: string): string => { const tag = key.split("|")[0] ?? ""; return tag.split(":")[0] ?? tag; };

export interface ReasonMoves {
  /** Membership: a (tag, producer, consumer) present on one side only. */
  gained: string[]; lost: string[];
  /** Present on both sides with a different SET of magnitudes. */
  magnitude: { key: string; before: string[]; after: string[] }[];
  /** Present on both sides with the same magnitudes and a different attribute: the fields that differ. */
  attrs: { key: string; fields: string[] }[];
}

/** Membership moves apart from magnitude-only moves and attribute-only moves. Several reasons may share a member key (one per magnitude).
 *  CEILING: attributes are compared between the first reason of each magnitude on each side; a key whose reasons differ only in a later duplicate is not seen. */
export function diffReasons(base: ReasonLike[], head: ReasonLike[]): ReasonMoves {
  const group = (rs: ReasonLike[]): Map<string, Map<string, ReasonLike>> => {
    const m = new Map<string, Map<string, ReasonLike>>();
    for (const r of rs) {
      const k = memberKey(r);
      const mags = m.get(k) ?? new Map<string, ReasonLike>();
      if (!mags.has(magOf(r))) mags.set(magOf(r), r);
      m.set(k, mags);
    }
    return m;
  };
  const b = group(base), h = group(head);
  const out: ReasonMoves = { gained: [], lost: [], magnitude: [], attrs: [] };
  for (const k of new Set([...b.keys(), ...h.keys()])) {
    const mb = b.get(k), mh = h.get(k);
    if (!mb) { out.gained.push(k); continue; }
    if (!mh) { out.lost.push(k); continue; }
    const before = [...mb.keys()].sort(), after = [...mh.keys()].sort();
    if (JSON.stringify(before) !== JSON.stringify(after)) { out.magnitude.push({ key: k, before, after }); continue; }
    const fields = new Set<string>();
    for (const [m, rb] of mb) for (const f of ATTR_FIELDS) if (JSON.stringify(rb[f] ?? null) !== JSON.stringify(mh.get(m)![f] ?? null)) fields.add(f);
    if (fields.size) out.attrs.push({ key: k, fields: [...fields].sort() });
  }
  out.gained.sort(); out.lost.sort();
  out.magnitude.sort((x, y) => (x.key < y.key ? -1 : 1)); out.attrs.sort((x, y) => (x.key < y.key ? -1 : 1));
  return out;
}

export type CardPairs = { id: string; name: string } & ReasonMoves;
const movedOf = (c: ReasonMoves): number => c.gained.length + c.lost.length + c.magnitude.length + c.attrs.length;
export interface PairsReport {
  gained: number; lost: number; magnitude: number; attrs: number;
  attrFields: { field: string; count: number }[];
  /** membership moves by tag family */
  families: { family: string; gained: number; lost: number }[];
  top: { name: string; gained: number; lost: number; magnitude: number; attrs: number }[];
  /** The OTHER card of each moved membership key (the producer or consumer that is not the changed card), ranked by moves:
   *  one card losing a reason with 50 changed cards is `lost: 50`, however the keys differ. */
  byCounterpart: { name: string; gained: number; lost: number }[];
}

export function pairsReport(cards: CardPairs[], top = 20): PairsReport {
  const fam = new Map<string, { gained: number; lost: number }>();
  const other = new Map<string, { gained: number; lost: number }>();
  const fields = new Map<string, number>();
  let gained = 0, lost = 0, magnitude = 0, attrs = 0;
  const bump = (c: CardPairs, k: string, dir: "gained" | "lost") => {
    const f = fam.get(tagFamily(k)) ?? { gained: 0, lost: 0 };
    f[dir]++; fam.set(tagFamily(k), f);
    const [, producer = "", consumer = ""] = k.split("|");
    const counterpart = producer !== c.name ? producer : consumer;
    const o = other.get(counterpart) ?? { gained: 0, lost: 0 };
    o[dir]++; other.set(counterpart, o);
  };
  for (const c of cards) {
    gained += c.gained.length; lost += c.lost.length; magnitude += c.magnitude.length; attrs += c.attrs.length;
    c.gained.forEach((k) => bump(c, k, "gained")); c.lost.forEach((k) => bump(c, k, "lost"));
    for (const a of c.attrs) for (const f of a.fields) fields.set(f, (fields.get(f) ?? 0) + 1);
  }
  const byMoves = <T extends { name: string; gained: number; lost: number }>(x: T, y: T) => (y.gained + y.lost) - (x.gained + x.lost) || x.name.localeCompare(y.name);
  return {
    gained, lost, magnitude, attrs,
    attrFields: [...fields].map(([field, count]) => ({ field, count })).sort((a, b) => b.count - a.count || a.field.localeCompare(b.field)),
    families: [...fam].map(([family, v]) => ({ family, ...v })).sort((a, b) => (b.gained + b.lost) - (a.gained + a.lost) || a.family.localeCompare(b.family)),
    top: cards.filter((c) => movedOf(c) > 0).map((c) => ({ name: c.name, gained: c.gained.length, lost: c.lost.length, magnitude: c.magnitude.length, attrs: c.attrs.length }))
      .sort((a, b) => (b.gained + b.lost + b.magnitude + b.attrs) - (a.gained + a.lost + a.magnitude + a.attrs) || a.name.localeCompare(b.name)).slice(0, top),
    byCounterpart: [...other].map(([name, v]) => ({ name, ...v })).sort(byMoves).slice(0, top),
  };
}

// ---- matcher selection, sample, cache ----

export type MatcherMode = "own" | "head";
/** Each side's OWN matcher is the default and the truth. `head` is an explicit isolation option: HEAD's matcher on both sides, to see what the rows alone did. */
export function chooseMatcher(flag: string | undefined): MatcherMode {
  if (flag === undefined || flag === "own") return "own";
  if (flag === "head") return "head";
  throw new Error(`--matcher takes own or head, not ${flag}`);
}

/** Pair-reason and role code that is not a matcher file the report measures: files NAMED here changed but no instrument of this report reads them. */
export const OFF_PATH_INSTRUMENTS: { test: RegExp; instrument: string }[] = [
  { test: /\/(similar|redundan)[\w-]*\.ts$/, instrument: "research/matcher/similar-census.ts" },
  { test: /\/build-static[\w-]*\.ts$/, instrument: "research/matcher/static-parity.ts (+ the static-out snapshot)" },
];
/** The instrument that does read an off-path matcher file, or a plain statement that none does. */
export const instrumentFor = (file: string): string => OFF_PATH_INSTRUMENTS.find((o) => o.test.test(file))?.instrument ?? "none in this report";

export interface MatcherCodeSplit { onPath: string[]; offPath: { file: string; instrument: string }[] }
/** Split the changed paths (repo-relative) that are matcher, engine or data source into those the pair / role code IMPORTS (`reachable`, from the import graph) and those it does not.
 *  Tests, fixtures, snapshots and the scoring tables are neither: they are not code the pair reasons run. A changed file that is reachable counts wherever it lives (a tagger module too). */
export function splitMatcherCode(paths: string[], reachable: ReadonlySet<string>): MatcherCodeSplit {
  const nonCode = (f: string): boolean => /\.test\.ts$/.test(f) || /\/fixtures\//.test(f) || /\.(fixtures|labels)[.\w-]*\.json$/.test(f);
  const table = /(compass-report|theme-stats|rate-stats|quality-weights|staples|VALIDATION)/;
  const onPath = paths.filter((f) => !nonCode(f) && reachable.has(f)).sort();
  const offPath = paths
    .filter((f) => !nonCode(f) && !reachable.has(f) && !table.test(f) && f.endsWith(".ts") && /^packages\/(matcher\/src|engine\/src|data\/src)\//.test(f) && (!f.includes("/bin/") || instrumentFor(f) !== "none in this report"))
    .sort().map((file) => ({ file, instrument: instrumentFor(file) }));
  return { onPath, offPath };
}

/** A stable, seeded sample of ids: ranked by an FNV-1a hash of `seed + id`, so adding a card moves at most one member. */
export function sampleIds(ids: string[], n: number, seed = "derive-impact"): string[] {
  const h = (s: string): number => { let x = 0x811c9dc5; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; } return x; };
  return ids.map((id) => ({ id, h: h(seed + id) })).sort((a, b) => a.h - b.h || (a.id < b.id ? -1 : 1)).slice(0, Math.max(0, n)).map((x) => x.id);
}

export interface TreeStat { isDirectory: boolean; isSymbolicLink: boolean; uid: number; mode: number }
/** May a cached tree be imported? A real directory (not a link) owned by the caller and not writable by group or others: on a shared machine anyone else could plant code in it. */
export function treeVerdict(st: TreeStat, uid: number): "ok" | string {
  if (st.isSymbolicLink) return "is a symlink";
  if (!st.isDirectory) return "is not a directory";
  if (st.uid !== uid) return `owned by uid ${st.uid}, not ${uid}`;
  if ((st.mode & 0o022) !== 0) return "writable by group or others";
  return "ok";
}
/** A fingerprint of the repo's top-level node_modules listing; the cached tree links into it, so a different listing means dangling or missing modules. */
export const nodeModulesHash = (names: string[]): string => createHash("sha1").update([...names].sort().join("\n")).digest("hex");

// ---- summary ----

// ---- ratchets ----

/** What the two by-name ratchets measure on one commit's rows. */
export interface RatchetInputs { dropped: Dropped; roles: Membership; /** commander-legal cards with no derived row (role-ratchet's untagged gate) */ untagged: string[] }
type Pair = [string, string];
export interface RatchetReport {
  dropped: { base: { cards: number; actions: number }; head: { cards: number; actions: number }; newKeys: Pair[]; fixedKeys: Pair[]; vsBank: { gained: number; lost: number } };
  roles: { base: { cards: number; memberships: number }; head: { cards: number; memberships: number }; gained: Pair[]; lost: Pair[]; vsBank: { gained: number; lost: number } };
  /** The untagged gate `role-ratchet` also fails on: cards with no derived row. newly = untagged at HEAD not at BASE (or the bank); nowTagged the reverse. */
  untagged: { base: number; head: number; newly: string[]; nowTagged: string[]; vsBankNew: string[]; vsBankTagged: string[] };
}
const countDropped = (d: Dropped): { cards: number; actions: number } => ({ cards: Object.keys(d).length, actions: Object.values(d).reduce((a, k) => a + k.length, 0) });
const countRoles = (m: Membership): { cards: number; memberships: number } => ({ cards: Object.keys(m).length, memberships: Object.values(m).reduce((a, k) => a + k.length, 0) });

/** BASE -> HEAD for both ratchets (set-based, by card, as the bins diff), and HEAD against the banked snapshots: what `--bank` would change. */
export function ratchetReport(base: RatchetInputs, head: RatchetInputs, banked: RatchetInputs): RatchetReport {
  const d = diffMembership(head.dropped, base.dropped), r = diffMembership(head.roles, base.roles);
  const minus = (x: string[], y: string[]): string[] => { const o = new Set(y); return [...new Set(x)].filter((n) => !o.has(n)).sort(); };
  const bd = diffMembership(head.dropped, banked.dropped), br = diffMembership(head.roles, banked.roles);
  return {
    dropped: { base: countDropped(base.dropped), head: countDropped(head.dropped), newKeys: d.gained, fixedKeys: d.lost, vsBank: { gained: bd.gained.length, lost: bd.lost.length } },
    roles: { base: countRoles(base.roles), head: countRoles(head.roles), gained: r.gained, lost: r.lost, vsBank: { gained: br.gained.length, lost: br.lost.length } },
    untagged: { base: new Set(base.untagged).size, head: new Set(head.untagged).size, newly: minus(head.untagged, base.untagged), nowTagged: minus(base.untagged, head.untagged), vsBankNew: minus(head.untagged, banked.untagged), vsBankTagged: minus(banked.untagged, head.untagged) },
  };
}
const some = (xs: Pair[], sign: "+" | "-", max = 5): string => xs.slice(0, max).map(([c, k]) => `${c} ${sign}${k}`).join("; ") + (xs.length > max ? `; ... (+${xs.length - max} more)` : "");

export function formatRatchets(r: RatchetReport): string[] {
  const d = r.dropped, o = r.roles, u = r.untagged;
  return [
    `role-ratchet gained ${o.gained.length}, lost ${o.lost.length} (${n(o.base.memberships)} -> ${n(o.head.memberships)} memberships)${o.gained.length ? `; gained: ${some(o.gained, "+")}` : ""}${o.lost.length ? `; lost: ${some(o.lost, "-")}` : ""}; against the banked snapshot: gained ${o.vsBank.gained}, lost ${o.vsBank.lost}; untagged ${u.base} -> ${u.head}${u.newly.length || u.nowTagged.length ? ` (newly ${u.newly.length}${u.newly.length ? `: ${u.newly.slice(0, 5).join(", ")}` : ""}, tagged now ${u.nowTagged.length}${u.nowTagged.length ? `: ${u.nowTagged.slice(0, 5).join(", ")}` : ""})` : ""}, against the banked list ${u.vsBankNew.length} new / ${u.vsBankTagged.length} tagged now`,
    `dropped-clauses ${n(d.base.actions)} -> ${n(d.head.actions)} (new ${d.newKeys.length}, fixed ${d.fixedKeys.length}${d.newKeys.length + d.fixedKeys.length ? `: ${[d.newKeys.length ? some(d.newKeys, "+") : "", d.fixedKeys.length ? some(d.fixedKeys, "-") : ""].filter(Boolean).join("; ")}` : ""}); against the banked snapshot: new ${d.vsBank.gained}, fixed ${d.vsBank.lost}`,
  ];
}

export interface SideInfo { ref: string; sha: string; deriveVersion: number }
export interface PairSection extends PairsReport { cards: number; skipped: string[] }
export interface ImpactReport {
  base: SideInfo; head: SideInfo & { dirty: boolean };
  matcher: MatcherMode;
  /** Files the pair / role code imports (import graph) that differ between BASE and the working tree. */
  matcherCode: string[];
  /** Matcher / engine / data source files that differ and are NOT on that path, with the instrument that does read them. */
  matcherOffPath: { file: string; instrument: string }[];
  /** How many cards the sample drew from. */
  samplePopulation?: number;
  rows: { totals: RowTotals; changes: RowChange[] };
  grammar: GrammarReport;
  /** Pair reasons of the changed rows (and the cards that make them). */
  pairs?: PairSection;
  /** Pair reasons of a seeded sample of cards, changed or not: what a matcher-only change does. */
  sample?: PairSection;
  /** What the token nodes cover: token docs, those with a derived row (the rest are synthesized), and the nodes the cards' allParts yield on each side. */
  tokens?: { docs: number; withRow: number; nodesBase: number; nodesHead: number };
  /** In-memory role-ratchet and dropped-clauses, BASE -> HEAD and against the banked snapshots. */
  ratchets?: RatchetReport;
}

/** WHAT THIS REPORT DOES NOT MEASURE. A 0 printed beside any of these is silence, not a measurement: say so in the report and the summary. */
export const NOT_MEASURED: string[] = [
  "similar / redundancy ranking (research/matcher/similar-census.ts)",
  "build-static / static-out shape (research/matcher/static-parity.ts and the static-out snapshot)",
  "deck-level analyze outputs: support / feeder scores, commander boost, archetypes and themes, deck math, per-deck roles and token roles, combos, anthems under a state, the deck-specific reason options",
  "reason text and claimCount",
  "token-vs-token pairs",
  "scoring tables: quality weights, theme-stats, rate-stats, staples",
  "normalize / segment changes (cardClauses is a fixed input)",
  "panel, recall, compass, pair-calibration",
  "packages/web and packages/cli",
  "upcoming (not_legal) spoilers in the two ratchets, which keep the raw commander-legal filter",
  "stale Mongo rows derive-corpus never deletes: a card 'removed' here is still served there",
  "matcher-only effects outside the sample (see its coverage line), and matcher imports the graph cannot see (dynamic paths, generated files)",
];

const n = (x: number): string => x.toLocaleString("en-US");
const headName = (r: ImpactReport): string => `${r.head.sha} working tree${r.head.dirty ? " (dirty)" : ""}`;

function pairLine(label: string, p: PairSection): string {
  const fields = p.attrFields.length ? ` [${p.attrFields.map((f) => `${f.field} x${f.count}`).join(", ")}]` : "";
  return `${label} (${p.cards} cards): membership +${n(p.gained)} gained, -${n(p.lost)} lost; magnitude-only ${n(p.magnitude)}; attributes changed ${n(p.attrs)}${fields}`
    + (p.families.length ? `; by family ${p.families.slice(0, 5).map((f) => `${f.family} +${f.gained}/-${f.lost}`).join(", ")}` : "");
}

/** The plain statement of what a sample of `k` cards out of `population` can see: a matcher-only move touching m cards is missed with probability (1-k/N)^m. */
export function sampleCoverage(k: number, population: number): string {
  if (population <= 0 || k <= 0) return "no sample";
  const p = k / population, miss = (m: number): string => `${Math.round(Math.pow(1 - p, m) * 100)}%`;
  const m95 = Math.ceil(Math.log(0.05) / Math.log(1 - p));
  return `sample of ${n(k)} of ${n(population)} cards (${(p * 100).toFixed(2)}%); a move touching 1 card is missed ${miss(1)}, 10 cards ${miss(10)}, 100 cards ${miss(100)}; fewer than ~${n(m95)} cards touched is likely (>5%) missed`;
}

/** The paste-ready block for a commit message or the DERIVE_VERSION comment. */
export function formatSummary(r: ImpactReport, topChanged = 10): string {
  const t = r.rows.totals;
  const lines = [
    `derive-impact ${r.base.sha} (DERIVE_VERSION ${r.base.deriveVersion}) -> ${headName(r)} (DERIVE_VERSION ${r.head.deriveVersion}); matcher: ${r.matcher === "own" ? "each side's own" : "HEAD's on both sides (isolation)"}`,
    `rows: ${n(t.same)} same, ${n(t.changed)} changed, ${n(t.added)} added, ${n(t.removed)} removed; source flips ${t.sourceFlipped} (${t.sourceFlippedIdenticalTags} with identical tags)`,
  ];
  // Ranked by entries moved (removed + added across fields), then by name.
  const size = (c: RowChange): number => Object.values(c.fields).reduce((a, d) => a + d.removed.length + d.added.length, 0);
  const changed = r.rows.changes.filter((c) => c.status !== "flip-only").sort((a, b) => size(b) - size(a) || a.name.localeCompare(b.name));
  if (changed.length) lines.push(`top changed: ${changed.slice(0, topChanged).map((c) => c.name).join("; ")}${changed.length > topChanged ? `; +${changed.length - topChanged} more` : ""}`);
  lines.push(`grammar complete: ${n(r.grammar.completeBase)} -> ${n(r.grammar.completeHead)} (${r.grammar.gained.length} gained, ${r.grammar.lost.length} lost, ${r.grammar.recordsChanged.length} with changed records)`);
  if (r.matcherCode.length) lines.push(`MATCHER CODE DIFFERS on the pair/role path (${r.matcherCode.length} file(s): ${r.matcherCode.slice(0, 4).join(", ")}${r.matcherCode.length > 4 ? ", ..." : ""}): pair reasons below cover changed rows only; matcher-only effects are measured on the sample`);
  for (const o of r.matcherOffPath) lines.push(`  changed but NOT on the pair/role path, not measured here: ${o.file} (instrument: ${o.instrument})`);
  if (r.pairs) {
    lines.push(pairLine("pair reasons of changed rows", r.pairs));
    if (r.pairs.skipped.length) lines.push(`  not paired (${r.pairs.skipped.length}): ${r.pairs.skipped.slice(0, 8).join("; ")}${r.pairs.skipped.length > 8 ? "; ..." : ""}`);
  } else lines.push("pair reasons: not run");
  if (r.sample) {
    lines.push(pairLine("matcher sample, seeded", r.sample));
    lines.push(`matcher-only coverage: ${sampleCoverage(r.sample.cards, r.samplePopulation ?? 0)}`);
  }
  if (r.tokens) lines.push(`tokens: ${n(r.tokens.docs)} token docs, ${n(r.tokens.withRow)} with a derived row and ${n(r.tokens.docs - r.tokens.withRow)} synthesized as the engine does; token nodes the cards create: BASE ${n(r.tokens.nodesBase)}, HEAD ${n(r.tokens.nodesHead)}; a changed token row is paired against every card, makers against the nodes; token-vs-token pairs are not covered`);
  if (r.pairs) lines.push("pair options: deck-specific landTypes / enterWatchers / revenantToughness are off (the card-page reading); face names are disambiguated corpus-wide");
  lines.push(`NOT measured: ${NOT_MEASURED.join("; ")}`);
  lines.push(...(r.ratchets ? formatRatchets(r.ratchets) : ["ratchets: not run"]));
  return lines.join("\n");
}

function pairBlock(out: string[], title: string, p: PairSection): void {
  out.push("", title);
  out.push(`membership: gained ${n(p.gained)}, lost ${n(p.lost)}; magnitude-only ${n(p.magnitude)}; attributes changed ${n(p.attrs)}`);
  if (p.attrFields.length) out.push(`attribute fields: ${p.attrFields.map((f) => `${f.field} x${f.count}`).join(", ")}`);
  out.push("by tag family (membership):");
  p.families.forEach((f) => out.push(`  ${f.family}  +${n(f.gained)} -${n(f.lost)}`));
  out.push("top cards by moved reasons:");
  p.top.forEach((c) => out.push(`  ${c.name}  +${n(c.gained)} -${n(c.lost)} mag ${n(c.magnitude)} attr ${n(c.attrs)}`));
  out.push("other cards whose reasons with these cards moved most:");
  p.byCounterpart.forEach((c) => out.push(`  ${c.name}  +${n(c.gained)} -${n(c.lost)}`));
  if (p.skipped.length) { out.push("not paired:"); p.skipped.forEach((x) => out.push(`  ${x}`)); }
}

/** The whole human-readable report: per changed card, grammar lists, pairs, then the summary. */
export function formatReport(r: ImpactReport): string {
  const out: string[] = [];
  out.push("== NOT MEASURED BY THIS REPORT ==", ...NOT_MEASURED.map((x) => `  - ${x}`), "");
  out.push("== ROWS ==");
  for (const c of r.rows.changes) {
    const src = c.sourceBefore !== c.sourceAfter && c.sourceBefore && c.sourceAfter ? ` [${c.sourceBefore} -> ${c.sourceAfter}]` : "";
    out.push(`${c.status.toUpperCase()} ${c.name}${src}${c.status === "flip-only" ? " (tags identical)" : ""}`);
    for (const [k, d] of Object.entries(c.fields)) {
      d.removed.forEach((x) => out.push(`  - ${k}: ${x}`));
      d.added.forEach((x) => out.push(`  + ${k}: ${x}`));
    }
  }
  out.push("", "== GRAMMAR ==");
  out.push(`complete ${n(r.grammar.completeBase)} -> ${n(r.grammar.completeHead)}`);
  r.grammar.gained.forEach((x) => out.push(`  + complete: ${x}`));
  r.grammar.lost.forEach((x) => out.push(`  - complete: ${x}`));
  r.grammar.recordsChanged.forEach((x) => out.push(`  ~ records: ${x}`));
  if (r.pairs) pairBlock(out, `== PAIR REASONS OF CHANGED ROWS (${r.pairs.cards} cards, matcher: ${r.matcher}) ==`, r.pairs);
  if (r.sample) pairBlock(out, `== MATCHER SAMPLE (${r.sample.cards} seeded cards, matcher: ${r.matcher}) ==`, r.sample);
  if (r.ratchets) {
    out.push("", "== RATCHETS (BASE -> HEAD; against the banked snapshots: what --bank would change) ==");
    r.ratchets.roles.gained.forEach(([c, k]) => out.push(`  role-ratchet  ${c}  +${k}`));
    r.ratchets.roles.lost.forEach(([c, k]) => out.push(`  role-ratchet  ${c}  -${k}`));
    r.ratchets.dropped.newKeys.forEach(([c, k]) => out.push(`  dropped-clauses  ${c}  +${k}`));
    r.ratchets.dropped.fixedKeys.forEach(([c, k]) => out.push(`  dropped-clauses  ${c}  -${k}`));
  }
  out.push("", "== SUMMARY ==", formatSummary(r));
  return out.join("\n");
}
