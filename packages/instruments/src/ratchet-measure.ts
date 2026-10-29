/** THE MEASURING HALF of the two by-name ratchets, as functions of their inputs (#1410 task 2). `dropped-clauses.ts` and `role-ratchet.ts` feed them rows read from Mongo;
 *  `derive-impact.ts` feeds them each commit's in-memory rows and that commit's own tagger and matcher modules. One computation, so the report and the ratchets cannot drift. */
import type { CardDoc } from "@edh-seer/data";
import type { ClauseRecord } from "@edh-seer/tagger";
import { droppedKeys, partialKeys, type Dropped, type UnclaimedLike } from "./dropped-clauses-core.js";
import { mergeMembership, type Membership } from "./role-ratchet-core.js";

/** The tagger functions `measureDropped` calls: the module of the commit being measured. */
export interface DroppedTagger {
  grammarClauseRecords: (card: never) => { records: ClauseRecord[]; readings?: unknown };
  deriveAbilitiesOf: (input: never) => { spliced: ReadonlySet<number | string> };
  deriveInputOf: (...args: never[]) => never;
  grantedTokenClauses: (card: never) => ReadonlySet<number>;
  clauseTexts: (card: never) => Record<number, string>;
  INERT_VERBS: ReadonlySet<string>;
}
/** The fields of a derived row the ratchet reads. */
export interface DroppedRow { clauseSource?: "grammar" | "model"; abilities?: { clause?: number }[]; unclaimed?: UnclaimedLike[]; manaLines?: unknown[] }

export interface DroppedMeasure {
  measured: Dropped;
  /** Per card, the clause ids derive REPORTED in `CardTags.unclaimed`. */
  reportedBy: Record<string, ReadonlySet<string>>;
  underived: number; noRecords: number; actions: number;
  underivedNames: string[]; noRecordNames: string[];
}

/** The dropped-action keys of every card in `inEngine`, exactly as `dropped-clauses.ts` computes them. A row derived from the grammar reads
 *  `grammarClauseRecords(card).records`; a model row the stored clause doc's `canonical` (`canonicalOf`). */
export function measureDropped(inEngine: readonly CardDoc[], rowOf: (id: string) => DroppedRow | undefined, canonicalOf: (id: string) => ClauseRecord[] | undefined, t: DroppedTagger): DroppedMeasure {
  const out: DroppedMeasure = { measured: {}, reportedBy: {}, underived: 0, noRecords: 0, actions: 0, underivedNames: [], noRecordNames: [] };
  for (const d of inEngine) {
    const row = rowOf(d._id);
    if (!row) { out.underived++; out.underivedNames.push(d.name); continue; }
    const g = row.clauseSource === "grammar" ? t.grammarClauseRecords(d as never) : undefined;
    const records = g ? g.records : canonicalOf(d._id);
    if (!records) { out.noRecords++; out.noRecordNames.push(d.name); continue; }
    const abilityClauses = new Set((row.abilities ?? []).flatMap((a) => (a.clause === undefined ? [] : [a.clause])));
    const granted = t.grantedTokenClauses(d as never);
    const hasManaLines = (row.manaLines?.length ?? 0) > 0;
    const texts = t.clauseTexts(d as never);
    const isLand = /\bLand\b/.test(d.typeLine ?? "");
    const homes = { abilityClauses, granted, hasManaLines, spliced: new Set<number | string>(), isLand, texts, cardName: d.name };
    // PARTIAL drops: derive's own `unclaimed` entries on a clause that carries an ability (Condemn's tuck beside its gain-life).
    const partial = partialKeys(records, row.unclaimed ?? [], homes);
    // The spliced set is derive's own: a clause with no ability is the only one that can have been spliced, so derive again just for those cards.
    let keys = droppedKeys(records, homes);
    // Gate on ANY clause with a real action and no ability, before any exclusion, so a `:spliced` key never depends on an unrelated drop.
    const mayBeSpliced = records.some((r) => !abilityClauses.has(r.id) && !granted.has(r.id) && (r.actions ?? []).some((a) => !t.INERT_VERBS.has(a.verb ?? "")));
    if (mayBeSpliced) {
      const { spliced } = t.deriveAbilitiesOf((t.deriveInputOf as (...a: unknown[]) => never)(d, d._id, d.name, records, undefined, g?.readings));
      keys = droppedKeys(records, { ...homes, spliced });
    }
    keys = [...keys, ...partial].sort();
    if (keys.length > 0) {
      out.measured[d.name] = keys; out.actions += keys.length;
      out.reportedBy[d.name] = new Set((row.unclaimed ?? []).map((u) => String(u.clause)));
    }
  }
  return out;
}

/** The matcher detectors `measureRoles` calls: the module of the commit being measured. */
export interface RoleDetectors {
  detectBuildCategories: (dc: never) => Map<string, Set<string>>;
  detectAnswerClasses: (dc: never) => Map<string, { cards: Iterable<string> }>;
  detectWincons: (dc: never) => Map<string, Set<string>>;
}
/** Role, answer and wincon membership by card name, exactly as `role-ratchet.ts` computes it over `dc` (a DeckCard per commander-legal card). */
export function measureRoles(dc: readonly unknown[], t: RoleDetectors): Membership {
  const m = new Map<string, string[]>();
  const add = (n: string, k: string): void => { m.set(n, [...(m.get(n) ?? []), k]); };
  for (const [cat, set] of t.detectBuildCategories(dc as never)) for (const n of set) add(n, `role:${cat}`);
  for (const [cls, mem] of t.detectAnswerClasses(dc as never)) for (const n of mem.cards) add(n, `answer:${cls}`);
  // detectWincons is per card too: each rule's `winconClass` plus `go-wide` (creature-token makers), no deck threshold.
  for (const [cls, set] of t.detectWincons(dc as never)) for (const n of set) add(n, `wincon:${cls}`);
  return mergeMembership([m]);
}
