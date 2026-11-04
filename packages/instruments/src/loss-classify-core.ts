/** PURE CORE OF `loss-classify.ts` (#1485): argue every lost and gained pair mechanically.
 *
 *  A pair key is `tag|producer|consumer`. The CHANGED card is the `pairDetail` entry's; the counterpart is the other name. When the counterpart is the
 *  CONSUMER it hears the tag through a trigger, and that trigger's subject decides what the pair is worth:
 *    self   the trigger is about the card ITSELF ("whenever this creature is dealt damage"): a pair into it from another card's event is probably false
 *           (a self-fight half that GAINED +79 pairs into other cards' self triggers, #1474)
 *    class  a trigger about a class of objects: a LOST pair into one is a true edge gone, and has to be argued by a person
 *    other  no matching trigger: a static, the counterpart is the PRODUCER, a `[via token]` hop
 *  The tag family (what precedes the first `:`, `tagFamily` in derive-impact-core) is the trigger verb: `damaged:creature` is heard by a trigger whose
 *  `verbs` include `damaged`. A LOST pair existed at BASE so it reads the counterpart's BASE row, a GAINED one its HEAD row (the other side if that one is
 *  missing); a counterpart absent from both is counted as `noRow`, never guessed.
 *
 *  The rows come from the `derive-impact --json` file itself (`rows`, compact), never from Mongo, whose stored rows can be stale. */
import { eventTagKeys } from "@edh-seer/matcher/edges";
import { tagFamily } from "./derive-impact-core.js";

/** A filter reduced to what prints: nulls and `false` dropped. */
export type Subj = Record<string, unknown>;
export interface CompactEmit { verb: string; subject?: Subj; dealer?: Subj }
export interface CompactAbility {
  kind: string;
  grantedBy?: number;
  trigger?: { verbs: string[]; subject?: Subj };
  emits?: CompactEmit[];
}
/** One derived row of a name on one side. A name can map to several ids (the tokens collection has 105 duplicate names), so a side holds ALL of them. */
export interface RowVariant { id: string; abilities: CompactAbility[] }
export interface CompactRows { [name: string]: { base?: RowVariant[]; head?: RowVariant[] } }
export interface ImpactJson {
  pairDetail: { id?: string; name: string; lost: string[]; gained: string[] }[];
  /** Added by derive-impact --json (#1485): the compact rows of every card named in `pairDetail`. NOT `rows`, which is the report's own {totals, changes}. */
  pairRows: CompactRows;
}

/** The compact rows of every card named in a lost or gained pair, from the in-memory rows of each side (every row is derived whatever `--cards` says). */
export function buildPairRows(
  pairDetail: { name?: string; lost: string[]; gained: string[] }[],
  base: Iterable<{ id: string; name: string; tags: { abilities?: any[] } | null | undefined }>,
  head: Iterable<{ id: string; name: string; tags: { abilities?: any[] } | null | undefined }>,
): CompactRows {
  const wanted = new Set<string>();
  for (const c of pairDetail) for (const k of [...c.lost, ...c.gained]) { const [, p = "", q = ""] = k.split("|"); wanted.add(p); wanted.add(q); }
  const out: CompactRows = {};
  for (const [side, rows] of [["base", base], ["head", head]] as const) {
    for (const r of rows) {
      if (!wanted.has(r.name)) continue;
      const e = (out[r.name] ??= {});
      (e[side] ??= []).push({ id: r.id, abilities: compactRow(r.tags) });
    }
  }
  for (const e of Object.values(out)) for (const side of ["base", "head"] as const) e[side]?.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]!]));
}

/** Why a file cannot be classified at all, or undefined. A JSON from before #1485 has a `rows` (the report's {totals, changes}) and no `pairRows`. */
export function inputProblem(data: Partial<ImpactJson>): string | undefined {
  return data.pairRows ? undefined : "this JSON has no `pairRows` (written before #1485; its `rows` is the report's own): re-run derive-impact with --json";
}

const subj = (s: unknown): Subj | undefined => {
  if (!s || typeof s !== "object") return undefined;
  const out: Subj = {};
  for (const [k, v] of Object.entries(s as Subj)) if (v !== null && v !== undefined && v !== false) out[k] = v;
  return out;
};

/** The part of a derived row classification reads: each ability's kind, `grantedBy`, trigger verbs + subject, emits (verb + subject + dealer). */
export function compactRow(tags: { abilities?: any[] } | null | undefined): CompactAbility[] {
  return (tags?.abilities ?? []).map((a) => {
    const out: CompactAbility = { kind: a.kind };
    if (a.grantedBy !== undefined) out.grantedBy = a.grantedBy;
    if (a.trigger) out.trigger = { verbs: [...(a.trigger.verbs ?? [])], ...(subj(a.trigger.subject) ? { subject: subj(a.trigger.subject) } : {}) };
    if (a.emits?.length) out.emits = a.emits.map((e: any) => ({ verb: e.verb, ...(subj(e.subject) ? { subject: subj(e.subject) } : {}), ...(subj(e.dealer) ? { dealer: subj(e.dealer) } : {}) }));
    return out;
  });
}

export type Klass = "self" | "class" | "other" | "ambiguous" | "unmatched" | "noRow";
const filterText = (s: Subj | undefined): string => Object.entries(s ?? {}).filter(([k]) => k !== "self").map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join(" ") || "(any)";

/** EVERY TAG KEY A TRIGGER CAN BE HEARD AS: the pairs code's own `eventTagKeys` (edges.ts) over each of its verbs, which fills the implied class and zone
 *  (`enters-graveyard:`), plus the single-type / single-subtype narrowings `keyedOn` makes when the consumer's list meets a producer ("an instant or sorcery"
 *  reaching a sorcery is `cast:sorcery`). The tag of a reason is `eventTagKey({ ...trigger, subject: keyedOn(trigger.subject, emit.subject) })`, so a tag
 *  that is none of these keys was not made by this trigger. */
export function triggerTagKeys(t: NonNullable<CompactAbility["trigger"]>): string[] {
  const subject = (t.subject ?? {}) as Record<string, unknown>;
  const list = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : v === undefined ? [] : [v as string]);
  const variants: Record<string, unknown>[] = [subject];
  const subs = list(subject.subtype), types = list(subject.type);
  if (subs.length >= 2) for (const x of subs) variants.push({ ...subject, subtype: x });
  else if (subs.length === 0 && types.length >= 2) for (const x of types) variants.push({ ...subject, type: x });
  const keys = new Set<string>();
  for (const verb of t.verbs) for (const v of variants) for (const k of eventTagKeys({ verb, subject: v } as never, undefined)) keys.add(k);
  return [...keys];
}

/** Classify one pair of one changed card.
 *  WHICH TRIGGER IS READ: the one that HEARS the tag, the consumer's. If the counterpart is the consumer (the changed card produces), that is the counterpart's;
 *  if the CHANGED card is the consumer, it is the changed card's own (`consumer-side`, its BASE row for a lost pair, HEAD for a gained one). A `[via token]` hop is
 *  read the same way with the suffix stripped, and labelled. `other` is only a pair naming neither side as the changed card (a token subject's relays).
 *  `self` / `class`: a trigger carries exactly the tag; `class` wins when one tag is heard by both kinds (a person reads it).
 *  `ambiguous`: no trigger carries the tag's class key but one carries the family; or a name maps to several ids whose classes differ. Never read as class or self.
 *  `unmatched`: the consumer has no trigger of the family at all (a static, a granted or implied path this does not model): warned, never `other`. */
export function classifyPair(dir: "lost" | "gained", changed: string, key: string, rows: CompactRows): { klass: Klass; counterpart: string; family: string; tag: string; via: boolean; consumerSide: boolean; filter?: string } {
  const [rawTag = "", producer = "", consumer = ""] = key.split("|");
  const via = rawTag.includes(" [via token]");
  const tag = rawTag.replace(" [via token]", "");
  const family = tagFamily(key);
  const consumerSide = consumer === changed;
  const counterpart = consumerSide ? producer : producer === changed ? consumer : changed;
  const base = { counterpart, family, tag: rawTag, via, consumerSide };
  if (producer !== changed && consumer !== changed) return { klass: "other", ...base };
  const reader = consumerSide ? changed : consumer; // the card whose triggers hear the tag
  const entry = rows[reader];
  const variants = dir === "lost" ? entry?.base ?? entry?.head : entry?.head ?? entry?.base;
  if (!variants?.length) return { klass: "noRow", ...base };
  const each = variants.map((v) => classifyOn(v.abilities, tag, family));
  const first = each[0]!;
  if (each.every((x) => x.klass === first.klass)) return { ...first, ...base };
  return { klass: "ambiguous", ...base };
}

function classifyOn(abilities: CompactAbility[], tag: string, family: string): { klass: Klass; filter?: string } {
  const triggers = abilities.filter((a) => a.trigger) as (CompactAbility & { trigger: NonNullable<CompactAbility["trigger"]> })[];
  const exact = triggers.filter((a) => triggerTagKeys(a.trigger).includes(tag));
  if (exact.length) {
    const cls = exact.find((a) => !a.trigger.subject?.self);
    return cls ? { klass: "class", filter: filterText(cls.trigger.subject) } : { klass: "self" };
  }
  const sameFamily = triggers.filter((a) => a.trigger.verbs.some((v) => v === family) || triggerTagKeys(a.trigger).some((k) => tagFamily(k) === family));
  return { klass: sameFamily.length ? "ambiguous" : "unmatched" };
}

export interface ClassCounts { self: number; class: number; other: number; ambiguous: number; unmatched: number; noRow: number }
export interface CardClassified {
  name: string;
  lost: ClassCounts; gained: ClassCounts;
  /** Every class-trigger counterpart: the only pairs a person has to read. */
  classList: { dir: "lost" | "gained"; counterpart: string; family: string; filter: string; /** "", "via token", "consumer-side" or both */ note: string }[];
  /** Pairs read through the changed card's OWN trigger, and pairs that are a `[via token]` hop. */
  consumerSide: number; viaToken: number;
  /** Pairs whose tag no trigger carries but whose family one does: a person reads these too. */
  ambiguousList: { dir: "lost" | "gained"; counterpart: string; tag: string }[];
  /** LOST pairs into a class trigger: each must be argued. */
  lostToClass: string[];
  /** GAINED pairs into another card's self trigger: probable false edges. */
  gainedToSelf: string[];
}
export interface ClassifiedReport {
  cards: CardClassified[];
  /** Per tag family over the whole file: pairs heard exactly, matched only by family, and into a consumer with no trigger of it. */
  families: { family: string; matched: number; ambiguous: number; unmatched: number }[];
}

const zero = (): ClassCounts => ({ self: 0, class: 0, other: 0, ambiguous: 0, unmatched: 0, noRow: 0 });

export function classifyReport(data: ImpactJson, only?: string): ClassifiedReport {
  const rows = data.pairRows ?? {};
  const cards: CardClassified[] = [];
  const fam = new Map<string, { matched: number; ambiguous: number; unmatched: number }>();
  for (const c of data.pairDetail) {
    if (only && c.name !== only) continue;
    if (!c.lost.length && !c.gained.length) continue;
    const out: CardClassified = { name: c.name, lost: zero(), gained: zero(), classList: [], consumerSide: 0, viaToken: 0, ambiguousList: [], lostToClass: [], gainedToSelf: [] };
    const seen = new Set<string>();
    for (const dir of ["lost", "gained"] as const) {
      for (const key of c[dir]) {
        const r = classifyPair(dir, c.name, key, rows);
        out[dir][r.klass]++;
        if (r.consumerSide) out.consumerSide++;
        if (r.via) out.viaToken++;
        if (r.klass === "self" || r.klass === "class" || r.klass === "ambiguous" || r.klass === "unmatched") {
          const f = fam.get(r.family) ?? { matched: 0, ambiguous: 0, unmatched: 0 };
          if (r.klass === "ambiguous") f.ambiguous++; else if (r.klass === "unmatched") f.unmatched++; else f.matched++;
          fam.set(r.family, f);
        }
        if (r.klass === "class") {
          const note = [r.via ? "via token" : "", r.consumerSide ? "consumer-side" : ""].filter(Boolean).join(", ");
          const id = `${dir}|${r.counterpart}|${r.family}|${r.filter}|${note}`;
          if (!seen.has(id)) { seen.add(id); out.classList.push({ dir, counterpart: r.counterpart, family: r.family, filter: r.filter!, note }); }
          if (dir === "lost" && !out.lostToClass.includes(r.counterpart)) out.lostToClass.push(r.counterpart);
        }
        if (r.klass === "ambiguous" && !out.ambiguousList.some((x) => x.dir === dir && x.counterpart === r.counterpart && x.tag === r.tag)) out.ambiguousList.push({ dir, counterpart: r.counterpart, tag: r.tag });
        if (dir === "gained" && r.klass === "self" && !out.gainedToSelf.includes(r.counterpart)) out.gainedToSelf.push(r.counterpart);
      }
    }
    cards.push(out);
  }
  return { cards, families: [...fam].map(([family, v]) => ({ family, ...v })).sort((a, b) => a.family.localeCompare(b.family)) };
}

const sum = (cs: ClassCounts) => cs.self + cs.class + cs.other + cs.ambiguous + cs.unmatched + cs.noRow;
export function formatClassified(r: ClassifiedReport): string {
  const lines: string[] = [];
  const tot = { lost: zero(), gained: zero() };
  let consumerSide = 0, viaToken = 0;
  const counts = (c: ClassCounts) => `self ${c.self}, class ${c.class}, ambiguous ${c.ambiguous}, unmatched ${c.unmatched}, other ${c.other}, no row ${c.noRow}`;
  for (const c of r.cards) {
    lines.push(`${c.name}`);
    lines.push(`  lost ${sum(c.lost)}: ${counts(c.lost)}`);
    lines.push(`  gained ${sum(c.gained)}: ${counts(c.gained)}`);
    if (c.consumerSide || c.viaToken) lines.push(`  of those: ${c.consumerSide} consumer-side (read from ${c.name}'s own trigger), ${c.viaToken} via token`);
    if (c.classList.length) {
      lines.push("  class-trigger counterparts (read these):");
      for (const x of c.classList) lines.push(`    ${x.dir.padEnd(6)} ${x.counterpart}  [${x.family}: ${x.filter}]${x.note ? `  (${x.note})` : ""}`);
    }
    if (c.ambiguousList.length) {
      lines.push("  AMBIGUOUS (no trigger carries the tag's class key; only the family matches -- read these):");
      for (const x of c.ambiguousList) lines.push(`    ${x.dir.padEnd(6)} ${x.counterpart}  [${x.tag}]`);
    }
    if (c.lostToClass.length) lines.push(`  LOST->CLASS (${c.lostToClass.length}, each must be argued): ${c.lostToClass.join("; ")}`);
    if (c.gainedToSelf.length) lines.push(`  GAINED->SELF (${c.gainedToSelf.length}, probable false edges): ${c.gainedToSelf.join("; ")}`);
    consumerSide += c.consumerSide; viaToken += c.viaToken;
    for (const k of Object.keys(tot.lost) as (keyof ClassCounts)[]) { tot.lost[k] += c.lost[k]; tot.gained[k] += c.gained[k]; }
    lines.push("");
  }
  if (r.families.length) {
    lines.push("per family (matched / ambiguous / unmatched):");
    for (const f of r.families) lines.push(`  ${f.family.padEnd(22)} ${f.matched} / ${f.ambiguous} / ${f.unmatched}`);
    const um = r.families.filter((f) => f.unmatched > 0);
    if (um.length) lines.push(`WARNING: ${um.reduce((n, f) => n + f.unmatched, 0)} pair(s) into a consumer with no trigger matching the tag: ${um.map((f) => `${f.family} ${f.unmatched}`).join(", ")}`);
    lines.push("");
  }
  const t = (c: ClassCounts) => `self ${c.self}, class ${c.class}, other ${c.other}, ambiguous ${c.ambiguous}, unmatched ${c.unmatched}, no row ${c.noRow}`;
  lines.push(`summary: ${r.cards.length} card(s); lost ${sum(tot.lost)} (${t(tot.lost)}); gained ${sum(tot.gained)} (${t(tot.gained)}); consumer-side ${consumerSide}, via token ${viaToken}; LOST->CLASS ${r.cards.reduce((n, c) => n + c.lostToClass.length, 0)}, GAINED->SELF ${r.cards.reduce((n, c) => n + c.gainedToSelf.length, 0)}`);
  return lines.join("\n");
}

/** A report whose pairs are mostly `no row` argued nothing (a file without the counterparts' rows): refuse it rather than print numbers that look like a result. */
export function noRowProblem(r: ClassifiedReport): string | undefined {
  let all = 0, none = 0;
  for (const c of r.cards) for (const d of [c.lost, c.gained]) { all += sum(d); none += d.noRow; }
  return all > 0 && none * 2 > all ? `${none} of ${all} pairs have no row in the file: it does not carry the counterparts' rows, so nothing was argued` : undefined;
}
