/** THE PURE HALF OF `derive-impact.ts` (#1410): what an engine change did to the derived corpus, as plain
 *  data diffs. No Mongo, no git, no modules of either commit -- the bin loads both trees and feeds these.
 *
 *  Four reports: derived ROWS (per field set diffs, source flips), GRAMMAR (complete flag and record JSON),
 *  PAIR REASONS (keyed `tag|producer|consumer|magnitude`, gained and lost), and the paste-ready SUMMARY. */

/** The fields compared, the same pick as research/tagger/derive-identity.ts. */
export const PICKED_FIELDS = ["abilities", "unclaimed", "characteristics", "manaLines", "staticFixer", "landFetch", "isOneShot", "suspendOnly", "unknownTriggers"] as const;

export const pick = (t: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(PICKED_FIELDS.map((k) => [k, t[k]]));

/** A row as the report keeps it: the picked fields as JSON (comparable, small) and the winner of `deriveRow`. */
export interface RowSnap { name: string; fromGrammar: boolean; pick: string }
export const snapOf = (name: string, tags: Record<string, unknown>, fromGrammar: boolean): RowSnap => ({ name, fromGrammar, pick: JSON.stringify(pick(tags)) });

export interface FieldDiff { removed: string[]; added: string[] }

/** The entries of one field as JSON strings: an array's members, an object's `key: value` pairs, a scalar itself; absent is none. */
function entriesOf(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) return v.map((x) => JSON.stringify(x));
  if (typeof v === "object") return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${JSON.stringify(x)}`);
  return [JSON.stringify(v)];
}

/** Per field, the entries only BEFORE (removed) and only AFTER (added). A field with no change is absent. Set-based, as derive-identity is. */
export function fieldDiff(before: string, after: string): Record<string, FieldDiff> {
  const a = JSON.parse(before) as Record<string, unknown>, b = JSON.parse(after) as Record<string, unknown>;
  const out: Record<string, FieldDiff> = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const was = new Set(entriesOf(a[k])), now = new Set(entriesOf(b[k]));
    const removed = [...was].filter((x) => !now.has(x)), added = [...now].filter((x) => !was.has(x));
    // Same entries in another order, or a scalar that moved to undefined: the JSON differs and no entry does. Keep it visible.
    if (removed.length === 0 && added.length === 0 && JSON.stringify(a[k]) !== JSON.stringify(b[k])) { out[k] = { removed: [`(reordered) ${JSON.stringify(a[k])?.slice(0, 200)}`], added: [`(reordered) ${JSON.stringify(b[k])?.slice(0, 200)}`] }; continue; }
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

export interface ReasonLike { tag: string; producer?: string; consumer?: string; magnitude?: unknown }
export const reasonKey = (r: ReasonLike): string => `${r.tag}|${r.producer ?? ""}|${r.consumer ?? ""}|${JSON.stringify(r.magnitude ?? null)}`;
/** The family of a tag: what precedes its first `:` (`attacks:creature` -> `attacks`). */
export const tagFamily = (key: string): string => { const tag = key.split("|")[0] ?? ""; return tag.split(":")[0] ?? tag; };

export function diffReasonKeys(base: Iterable<string>, head: Iterable<string>): { gained: string[]; lost: string[] } {
  const b = new Set(base), h = new Set(head);
  return { gained: [...h].filter((k) => !b.has(k)).sort(), lost: [...b].filter((k) => !h.has(k)).sort() };
}

export interface CardPairs { id: string; name: string; gained: string[]; lost: string[] }
export interface PairsReport {
  gained: number; lost: number;
  families: { family: string; gained: number; lost: number }[];
  top: { name: string; gained: number; lost: number }[];
  /** The OTHER card of each moved reason (the key's producer or consumer that is not the changed card), ranked by moves:
   *  one card losing a reason with 50 changed cards is `lost: 50`, however the keys differ. */
  byCounterpart: { name: string; gained: number; lost: number }[];
}

/** Group by tag family, rank cards by moved reasons (gained + lost), and count how many changed cards each moved key appears on.
 *  A reason between two changed cards is seen from both sides; counts are of (card, key) pairs as the per-card lists hold them. */
export function pairsReport(cards: CardPairs[], top = 20): PairsReport {
  const fam = new Map<string, { gained: number; lost: number }>();
  const other = new Map<string, { gained: number; lost: number }>();
  let gained = 0, lost = 0;
  const bump = (c: CardPairs, k: string, dir: "gained" | "lost") => {
    const f = fam.get(tagFamily(k)) ?? { gained: 0, lost: 0 };
    f[dir]++; fam.set(tagFamily(k), f);
    const [, producer = "", consumer = ""] = k.split("|");
    const counterpart = producer !== c.name ? producer : consumer;
    const o = other.get(counterpart) ?? { gained: 0, lost: 0 };
    o[dir]++; other.set(counterpart, o);
  };
  for (const c of cards) {
    gained += c.gained.length; lost += c.lost.length;
    c.gained.forEach((k) => bump(c, k, "gained")); c.lost.forEach((k) => bump(c, k, "lost"));
  }
  return {
    gained, lost,
    families: [...fam].map(([family, v]) => ({ family, ...v })).sort((a, b) => (b.gained + b.lost) - (a.gained + a.lost) || a.family.localeCompare(b.family)),
    top: cards.filter((c) => c.gained.length + c.lost.length > 0).map((c) => ({ name: c.name, gained: c.gained.length, lost: c.lost.length }))
      .sort((a, b) => (b.gained + b.lost) - (a.gained + a.lost) || a.name.localeCompare(b.name)).slice(0, top),
    byCounterpart: [...other].map(([name, v]) => ({ name, ...v })).sort((a, b) => (b.gained + b.lost) - (a.gained + a.lost) || a.name.localeCompare(b.name)).slice(0, top),
  };
}

// ---- summary ----

export interface ImpactReport {
  base: string; head: string; matcher: "head" | "own";
  rows: { totals: RowTotals; changes: RowChange[] };
  grammar: GrammarReport;
  pairs?: PairsReport & { cards: number };
  /** wall seconds, never part of a byte-for-byte comparison of two runs: kept out of the JSON by the bin. */
}

const n = (x: number): string => x.toLocaleString("en-US");

/** The paste-ready block for a commit message or the DERIVE_VERSION comment. */
export function formatSummary(r: ImpactReport, topChanged = 10): string {
  const t = r.rows.totals;
  const lines = [
    `derive-impact ${r.base} -> ${r.head}`,
    `rows: ${n(t.same)} same, ${n(t.changed)} changed, ${n(t.added)} added, ${n(t.removed)} removed; source flips ${t.sourceFlipped} (${t.sourceFlippedIdenticalTags} with identical tags)`,
  ];
  // Ranked by entries moved (removed + added across fields), then by name.
  const size = (c: RowChange): number => Object.values(c.fields).reduce((a, d) => a + d.removed.length + d.added.length, 0);
  const changed = r.rows.changes.filter((c) => c.status !== "flip-only").sort((a, b) => size(b) - size(a) || a.name.localeCompare(b.name));
  if (changed.length) lines.push(`top changed: ${changed.slice(0, topChanged).map((c) => c.name).join("; ")}${changed.length > topChanged ? `, +${changed.length - topChanged} more` : ""}`);
  lines.push(`grammar complete: ${n(r.grammar.completeBase)} -> ${n(r.grammar.completeHead)} (${r.grammar.gained.length} gained, ${r.grammar.lost.length} lost, ${r.grammar.recordsChanged.length} with changed records)`);
  if (r.pairs) lines.push(`pair reasons (${r.pairs.cards} changed cards, ${r.matcher === "own" ? "each side's own matcher" : "HEAD matcher both sides"}): +${n(r.pairs.gained)} gained, -${n(r.pairs.lost)} lost${r.pairs.families.length ? `; by family ${r.pairs.families.slice(0, 5).map((f) => `${f.family} +${f.gained}/-${f.lost}`).join(", ")}` : ""}`);
  else lines.push("pair reasons: not run");
  return lines.join("\n");
}

/** The whole human-readable report: per changed card, grammar lists, pairs, then the summary. */
export function formatReport(r: ImpactReport): string {
  const out: string[] = [];
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
  if (r.pairs) {
    out.push("", `== PAIR REASONS (${r.pairs.cards} changed cards, matcher: ${r.matcher}) ==`);
    out.push(`gained ${n(r.pairs.gained)}, lost ${n(r.pairs.lost)}`);
    out.push("by tag family:");
    r.pairs.families.forEach((f) => out.push(`  ${f.family}  +${n(f.gained)} -${n(f.lost)}`));
    out.push("top cards by moved reasons:");
    r.pairs.top.forEach((c) => out.push(`  ${c.name}  +${n(c.gained)} -${n(c.lost)}`));
    out.push("other cards whose reasons with the changed cards moved most:");
    r.pairs.byCounterpart.forEach((c) => out.push(`  ${c.name}  +${n(c.gained)} -${n(c.lost)}`));
  }
  out.push("", "== SUMMARY ==", formatSummary(r));
  return out.join("\n");
}
