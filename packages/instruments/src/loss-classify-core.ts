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

export type Klass = "self" | "class" | "other" | "noRow";
const filterText = (s: Subj | undefined): string => Object.entries(s ?? {}).filter(([k]) => k !== "self").map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join(" ") || "(any)";

/** Classify one pair of one changed card. */
export function classifyPair(dir: "lost" | "gained", changed: string, key: string, rows: CompactRows): { klass: Klass; counterpart: string; family: string; filter?: string } {
  const [tag = "", producer = "", consumer = ""] = key.split("|");
  const family = tagFamily(key);
  const counterpart = producer === changed && consumer !== changed ? consumer : consumer === changed && producer !== changed ? producer : changed;
  if (!(producer === changed && consumer !== changed) || tag.includes("[via token]")) return { klass: "other", counterpart, family };
  const entry = rows[counterpart];
  const abilities = dir === "lost" ? entry?.base ?? entry?.head : entry?.head ?? entry?.base;
  if (!abilities) return { klass: "noRow", counterpart, family };
  const hits = abilities.filter((a) => a.trigger?.verbs.includes(family));
  const cls = hits.find((a) => !a.trigger?.subject?.self);
  if (cls) return { klass: "class", counterpart, family, filter: filterText(cls.trigger?.subject) };
  if (hits.length) return { klass: "self", counterpart, family };
  return { klass: "other", counterpart, family };
}

export interface ClassCounts { self: number; class: number; other: number; noRow: number }
export interface CardClassified {
  name: string;
  lost: ClassCounts; gained: ClassCounts;
  /** Every class-trigger counterpart: the only pairs a person has to read. */
  classList: { dir: "lost" | "gained"; counterpart: string; family: string; filter: string }[];
  /** LOST pairs into a class trigger: each must be argued. */
  lostToClass: string[];
  /** GAINED pairs into another card's self trigger: probable false edges. */
  gainedToSelf: string[];
}
export interface ClassifiedReport { cards: CardClassified[] }

export function classifyReport(data: ImpactJson, only?: string): ClassifiedReport {
  const rows = data.rows ?? {};
  const cards: CardClassified[] = [];
  for (const c of data.pairDetail) {
    if (only && c.name !== only) continue;
    if (!c.lost.length && !c.gained.length) continue;
    const out: CardClassified = { name: c.name, lost: { self: 0, class: 0, other: 0, noRow: 0 }, gained: { self: 0, class: 0, other: 0, noRow: 0 }, classList: [], lostToClass: [], gainedToSelf: [] };
    const seen = new Set<string>();
    for (const dir of ["lost", "gained"] as const) {
      for (const key of c[dir]) {
        const r = classifyPair(dir, c.name, key, rows);
        out[dir][r.klass]++;
        if (r.klass === "class") {
          const id = `${dir}|${r.counterpart}|${r.family}|${r.filter}`;
          if (!seen.has(id)) { seen.add(id); out.classList.push({ dir, counterpart: r.counterpart, family: r.family, filter: r.filter! }); }
          if (dir === "lost" && !out.lostToClass.includes(r.counterpart)) out.lostToClass.push(r.counterpart);
        }
        if (dir === "gained" && r.klass === "self" && !out.gainedToSelf.includes(r.counterpart)) out.gainedToSelf.push(r.counterpart);
      }
    }
    cards.push(out);
  }
  return { cards };
}

const sum = (cs: ClassCounts) => cs.self + cs.class + cs.other + cs.noRow;
export function formatClassified(r: ClassifiedReport): string {
  const lines: string[] = [];
  const tot = { lost: { self: 0, class: 0, other: 0, noRow: 0 }, gained: { self: 0, class: 0, other: 0, noRow: 0 } };
  for (const c of r.cards) {
    lines.push(`${c.name}`);
    lines.push(`  lost ${sum(c.lost)}: self ${c.lost.self}, class ${c.lost.class}, other ${c.lost.other}, no row ${c.lost.noRow}`);
    lines.push(`  gained ${sum(c.gained)}: self ${c.gained.self}, class ${c.gained.class}, other ${c.gained.other}, no row ${c.gained.noRow}`);
    if (c.classList.length) {
      lines.push("  class-trigger counterparts (read these):");
      for (const x of c.classList) lines.push(`    ${x.dir.padEnd(6)} ${x.counterpart}  [${x.family}: ${x.filter}]`);
    }
    if (c.lostToClass.length) lines.push(`  LOST->CLASS (${c.lostToClass.length}, each must be argued): ${c.lostToClass.join("; ")}`);
    if (c.gainedToSelf.length) lines.push(`  GAINED->SELF (${c.gainedToSelf.length}, probable false edges): ${c.gainedToSelf.join("; ")}`);
    for (const k of ["self", "class", "other", "noRow"] as const) { tot.lost[k] += c.lost[k]; tot.gained[k] += c.gained[k]; }
    lines.push("");
  }
  lines.push(`summary: ${r.cards.length} card(s); lost ${sum(tot.lost)} (self ${tot.lost.self}, class ${tot.lost.class}, other ${tot.lost.other}, no row ${tot.lost.noRow}); gained ${sum(tot.gained)} (self ${tot.gained.self}, class ${tot.gained.class}, other ${tot.gained.other}); LOST->CLASS ${r.cards.reduce((n, c) => n + c.lostToClass.length, 0)}, GAINED->SELF ${r.cards.reduce((n, c) => n + c.gainedToSelf.length, 0)}`);
  return lines.join("\n");
}
