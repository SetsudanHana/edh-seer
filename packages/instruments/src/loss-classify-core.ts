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
export interface CompactRows { [name: string]: { base?: CompactAbility[]; head?: CompactAbility[] } }
export interface ImpactJson {
  pairDetail: { id?: string; name: string; lost: string[]; gained: string[] }[];
  /** Added by derive-impact --json: the compact rows of every card named in `pairDetail`. */
  rows?: CompactRows;
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
 *  `self` / `class`: a trigger of the counterpart is heard under exactly this tag; `class` wins when one tag is heard by both kinds (a person reads it).
 *  `ambiguous`: no trigger carries the tag's class key, but one carries the family (verb): never read as class or self, listed for a person.
 *  `unmatched`: the counterpart is the consumer and has no trigger of the family at all (a static, a granted or implied path this does not model): warned, never `other`.
 *  `other`: the counterpart is the PRODUCER, or the pair is a `[via token]` hop. */
export function classifyPair(dir: "lost" | "gained", changed: string, key: string, rows: CompactRows): { klass: Klass; counterpart: string; family: string; tag: string; filter?: string } {
  const [tag = "", producer = "", consumer = ""] = key.split("|");
  const family = tagFamily(key);
  const counterpart = producer === changed && consumer !== changed ? consumer : consumer === changed && producer !== changed ? producer : changed;
  const base = { counterpart, family, tag };
  if (!(producer === changed && consumer !== changed) || tag.includes("[via token]")) return { klass: "other", ...base };
  const entry = rows[counterpart];
  const abilities = dir === "lost" ? entry?.base ?? entry?.head : entry?.head ?? entry?.base;
  if (!abilities) return { klass: "noRow", ...base };
  const triggers = abilities.filter((a) => a.trigger) as (CompactAbility & { trigger: NonNullable<CompactAbility["trigger"]> })[];
  const exact = triggers.filter((a) => triggerTagKeys(a.trigger).includes(tag));
  if (exact.length) {
    const cls = exact.find((a) => !a.trigger.subject?.self);
    return cls ? { klass: "class", ...base, filter: filterText(cls.trigger.subject) } : { klass: "self", ...base };
  }
  const sameFamily = triggers.filter((a) => a.trigger.verbs.some((v) => v === family) || triggerTagKeys(a.trigger).some((k) => tagFamily(k) === family));
  if (sameFamily.length) return { klass: "ambiguous", ...base };
  return { klass: "unmatched", ...base };
}

export interface ClassCounts { self: number; class: number; other: number; ambiguous: number; unmatched: number; noRow: number }
export interface CardClassified {
  name: string;
  lost: ClassCounts; gained: ClassCounts;
  /** Every class-trigger counterpart: the only pairs a person has to read. */
  classList: { dir: "lost" | "gained"; counterpart: string; family: string; filter: string }[];
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
  const rows = data.rows ?? {};
  const cards: CardClassified[] = [];
  const fam = new Map<string, { matched: number; ambiguous: number; unmatched: number }>();
  for (const c of data.pairDetail) {
    if (only && c.name !== only) continue;
    if (!c.lost.length && !c.gained.length) continue;
    const out: CardClassified = { name: c.name, lost: zero(), gained: zero(), classList: [], ambiguousList: [], lostToClass: [], gainedToSelf: [] };
    const seen = new Set<string>();
    for (const dir of ["lost", "gained"] as const) {
      for (const key of c[dir]) {
        const r = classifyPair(dir, c.name, key, rows);
        out[dir][r.klass]++;
        if (r.klass === "self" || r.klass === "class" || r.klass === "ambiguous" || r.klass === "unmatched") {
          const f = fam.get(r.family) ?? { matched: 0, ambiguous: 0, unmatched: 0 };
          if (r.klass === "ambiguous") f.ambiguous++; else if (r.klass === "unmatched") f.unmatched++; else f.matched++;
          fam.set(r.family, f);
        }
        if (r.klass === "class") {
          const id = `${dir}|${r.counterpart}|${r.family}|${r.filter}`;
          if (!seen.has(id)) { seen.add(id); out.classList.push({ dir, counterpart: r.counterpart, family: r.family, filter: r.filter! }); }
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
  const counts = (c: ClassCounts) => `self ${c.self}, class ${c.class}, ambiguous ${c.ambiguous}, unmatched ${c.unmatched}, other ${c.other}, no row ${c.noRow}`;
  for (const c of r.cards) {
    lines.push(`${c.name}`);
    lines.push(`  lost ${sum(c.lost)}: ${counts(c.lost)}`);
    lines.push(`  gained ${sum(c.gained)}: ${counts(c.gained)}`);
    if (c.classList.length) {
      lines.push("  class-trigger counterparts (read these):");
      for (const x of c.classList) lines.push(`    ${x.dir.padEnd(6)} ${x.counterpart}  [${x.family}: ${x.filter}]`);
    }
    if (c.ambiguousList.length) {
      lines.push("  AMBIGUOUS (no trigger carries the tag's class key; only the family matches -- read these):");
      for (const x of c.ambiguousList) lines.push(`    ${x.dir.padEnd(6)} ${x.counterpart}  [${x.tag}]`);
    }
    if (c.lostToClass.length) lines.push(`  LOST->CLASS (${c.lostToClass.length}, each must be argued): ${c.lostToClass.join("; ")}`);
    if (c.gainedToSelf.length) lines.push(`  GAINED->SELF (${c.gainedToSelf.length}, probable false edges): ${c.gainedToSelf.join("; ")}`);
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
  const t = (c: ClassCounts) => `self ${c.self}, class ${c.class}, other ${c.other}, ambiguous ${c.ambiguous}, unmatched ${c.unmatched}`;
  lines.push(`summary: ${r.cards.length} card(s); lost ${sum(tot.lost)} (${t(tot.lost)}, no row ${tot.lost.noRow}); gained ${sum(tot.gained)} (${t(tot.gained)}); LOST->CLASS ${r.cards.reduce((n, c) => n + c.lostToClass.length, 0)}, GAINED->SELF ${r.cards.reduce((n, c) => n + c.gainedToSelf.length, 0)}`);
  return lines.join("\n");
}
