/** CARDS THAT DO THE SAME OR A SIMILAR JOB (#1341; owner 2026-10-24: "take Soul Warden for example and
 *  click to see cards that show the same or similar effects").
 *
 *  PURE, NO I/O: derived tags in, a ranked list out. build-static calls it once per page card.
 *
 *  THE OWNER'S DEFINITION, per ability: the event it listens for, WHAT IT PRODUCES, the amount, and the
 *  repeatability. WHAT IT PRODUCES IS THE GATE: a card whose abilities share no output key with the
 *  seed's is not similar however close its trigger is. The other three dimensions decide the tier and
 *  the order inside it, and every difference is a structured chip so the page says WHY, not a percentage.
 *
 *  OUTPUT KEYS are the engine's own: `eventKey` through `splitKey` (partners-core), so "what it produces"
 *  means exactly what the partner pages mean by it.
 *
 *  TIERS (best ability pair decides):
 *  - `same`:   same output, kind, trigger verbs and subject, amount and repeats, same card types, and
 *              neither card has an output or keyword the other lacks. `other` ("another creature") and a
 *              "may" are ignored: Soul Warden and Soul's Attendant are the same job.
 *  - `close`:  same output and the same trigger verbs (or both untriggered), differing in trigger
 *              subject, amount, repeats, ability kind or card type, or the cards differ in extra
 *              outputs / keywords (Auriok Champion: + protection).
 *  - `output`: same output, a different trigger verb or an untriggered/triggered split (Blood Artist
 *              gains life when a creature DIES, not when one enters).
 *
 *  CEILING: a MIRROR effect is not surfaced as such. Suture Priest's second ability makes an opponent
 *  lose life when THEIR creature enters, which is the same trigger turned on the other player; it shares
 *  no output with Soul Warden, so only its gain-life half matches (as a close, with "+ lose life"). A mirror
 *  tier would need an output-with-flipped-subject comparison. */
import type { CardTags, GameEvent, SubjectFilter } from "@edh-seer/tagger";
import { isRefusedTrigger } from "./claims.js";
import { REPEATS_LADDER, factAmountOf, factKindOf, type FactAmount, type FactKind } from "./member-facts.js";
import { eventKey, splitKey } from "./partners-core.js";
import { VERB_PHRASES, emitPhrase, emitSubjectNoun } from "./sentence.js";

/** What a card carries here: the same pair `partners-core` builds per card (a card and its derived tags), flattened. */
export interface SimilarCard { id: number; name: string; tags: CardTags | null }

export type SimilarTier = "same" | "close" | "output";
export type ChipDim = "trigger" | "amount" | "repeats" | "type" | "kind" | "extra" | "missing";
export interface Chip { dim: ChipDim; label: string }
export interface Comparison { tier: SimilarTier; chips: Chip[]; score: number }
export interface SimilarHit extends Comparison { id: number; name: string }

type Ability = CardTags["abilities"][number];
type Amount = FactAmount;
interface Output { key: string; label: string }
export interface AbilitySig {
  kind: FactKind;
  /** Sorted trigger verbs, null on an untriggered ability. */
  verbs: string[] | null;
  subject: SubjectFilter | null;
  outputs: Output[];
  amount: Amount;
  repeats: Ability["repeats"];
}
interface CardSig {
  abilities: AbilitySig[];
  outputs: Map<string, string>;
  keywords: string[];
  types: string[];
  identity: string[];
}

const TIER_RANK: Record<SimilarTier, number> = { same: 0, close: 1, output: 2 };
const KIND_LABEL: Record<FactKind, string> = {
  spell: "when cast", triggered: "a triggered ability", activated: "an activated ability",
  static: "a static ability", replacement: "a replacement effect",
};
const REPEAT_LABEL: Record<string, string> = {
  once: "once only", "per-cycle": "once each turn of yours", "per-turn": "once each player's turn",
  repeatable: "every time it happens", continuous: "always on",
};

function outputLabel(e: GameEvent): string {
  const phrase = emitPhrase([e]);
  if (phrase) return phrase;
  const verb = VERB_PHRASES[e.verb] ?? e.verb.replace(/-/g, " ");
  const noun = e.subject.type !== undefined || e.subject.subtype !== undefined ? emitSubjectNoun(e.subject) : undefined;
  return noun ? `${noun} ${verb}` : verb;
}

function amountOf(a: Ability): Amount {
  if (a.replacement === true && a.change) return { kind: a.change.op, value: a.change.value };
  return factAmountOf(a.amount);
}

export function signatureOf(card: SimilarCard): AbilitySig[] {
  return sigOf(card).abilities;
}

const sigCache = new WeakMap<object, CardSig>();
function sigOf(card: SimilarCard): CardSig {
  const key = card.tags ?? card;
  const hit = sigCache.get(key);
  if (hit) return hit;
  const abilities: AbilitySig[] = [];
  const outputs = new Map<string, string>();
  for (const a of card.tags?.abilities ?? []) {
    if (!a.emits || a.emits.length === 0 || isRefusedTrigger(a)) continue;
    const own = new Map<string, string>();
    for (const e of a.emits) {
      const label = outputLabel(e);
      for (const k of splitKey(eventKey(e))) if (!own.has(k)) own.set(k, label);
    }
    for (const [k, l] of own) if (!outputs.has(k)) outputs.set(k, l);
    abilities.push({
      kind: factKindOf(a),
      verbs: a.trigger ? [...a.trigger.verbs].sort() : null,
      subject: a.trigger?.subject ?? null,
      outputs: [...own].map(([k, label]) => ({ key: k, label })),
      amount: amountOf(a),
      repeats: a.repeats,
    });
  }
  const ch = card.tags?.characteristics;
  const sig: CardSig = {
    abilities, outputs,
    keywords: [...new Set((ch?.keywords ?? []).map((k) => k.toLowerCase()))].sort(),
    types: [...(ch?.types ?? [])].sort(),
    identity: ch?.identity ?? [],
  };
  sigCache.set(key, sig);
  return sig;
}

// ---- labels -----------------------------------------------------------------------------------

const IRREGULAR_PLURAL: Record<string, string> = { elf: "elves", wolf: "wolves", dwarf: "dwarves", thief: "thieves" };
const plural = (w: string): string => IRREGULAR_PLURAL[w.toLowerCase()] ?? (w.endsWith("s") ? w : `${w}s`);
const list = (v: string | string[] | undefined): string[] => (v === undefined ? [] : [v].flat());
const sameSet = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
const sorted = (v: string | string[] | undefined): string[] => [...list(v)].sort();

function subjectWords(s: SubjectFilter, pl: boolean): string {
  const subs = list(s.subtype).map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  const words = subs.length > 0 ? subs : list(s.type);
  const nouns = (words.length > 0 ? words : ["permanent"]).map((w) => (pl ? plural(w) : w)).join(" or ");
  return `${s.token === true ? "token " : s.token === false ? "nontoken " : ""}${nouns}`;
}

function subjectLabel(s: SubjectFilter): string {
  if (s.self === true) return "itself only";
  if (s.control === "you") return `your ${subjectWords(s, true)} only`;
  if (s.control === "opp") return `opponents' ${subjectWords(s, true)} only`;
  return `any ${subjectWords(s, false)}`;
}

function triggerLabel(sig: AbilitySig): string {
  if (!sig.verbs || !sig.subject) return KIND_LABEL[sig.kind];
  const s = sig.subject;
  const base = s.self === true ? "this card" : (emitSubjectNoun(s) ?? "a permanent");
  const who = s.self === true ? "" : s.control === "you" ? " you control" : s.control === "opp" ? " an opponent controls" : "";
  const verbs = sig.verbs.map((v) => VERB_PHRASES[v] ?? v.replace(/-/g, " ")).join(" or ");
  return `when ${base}${who} ${verbs}`;
}

const UNIT: Record<string, string> = { "gain-life": "life", "lose-life": "life", "non-combat-damage": "damage" };
function amountLabel(a: Amount, verb: string): string {
  if (a.kind === "plus") return `+${a.value}`;
  if (a.kind === "times") return `x${a.value}`;
  if (a.kind === "variable") return "X";
  if (a.kind === "unstated") return "amount not stated";
  const unit = UNIT[verb] ?? (verb === "draw" ? (a.value === 1 ? "card" : "cards") : "");
  return unit ? `${a.value} ${unit}` : String(a.value);
}

// ---- distances --------------------------------------------------------------------------------

/** Fixed to fixed: a one-step change is the nearest, bigger ones drift out, capped below the fixed<->variable step. */
function amountDistance(a: Amount, b: Amount): number {
  if (a.kind === b.kind) {
    if (!("value" in a) || !("value" in b)) return 0;
    return a.value === b.value ? 0 : 1 + Math.min(Math.abs(a.value - b.value) - 1, 8) / 10;
  }
  return a.kind === "unstated" || b.kind === "unstated" ? (a.kind === "variable" || b.kind === "variable" ? 1.5 : 3) : 3;
}

function repeatsDistance(a: Ability["repeats"], b: Ability["repeats"]): number {
  if (a === b) return 0;
  if (a === undefined || b === undefined) return 2;
  return Math.abs(REPEATS_LADDER.indexOf(a as never) - REPEATS_LADDER.indexOf(b as never));
}

/** How many facets of the trigger subject differ. `other` is ignored: "another creature" is the same event. */
function subjectFacets(a: SubjectFilter, b: SubjectFilter): number {
  if ((a.self === true) !== (b.self === true)) return 1;
  if (a.self === true) return 0;
  return (a.control !== b.control ? 1 : 0) + ((a.token ?? null) !== (b.token ?? null) ? 1 : 0)
    + (sameSet(sorted(a.type), sorted(b.type)) ? 0 : 1) + (sameSet(sorted(a.subtype), sorted(b.subtype)) ? 0 : 1);
}

function compareAbilities(a: AbilitySig, b: AbilitySig, shared: string, sameTypes: boolean, typeChip: string): Comparison {
  const chips: Chip[] = [];
  let score = 0;
  const verbsEqual = (a.verbs === null && b.verbs === null) || (a.verbs !== null && b.verbs !== null && sameSet(a.verbs, b.verbs));
  if (verbsEqual) {
    if (a.subject && b.subject) {
      const n = subjectFacets(a.subject, b.subject);
      if (n > 0) { chips.push({ dim: "trigger", label: subjectLabel(b.subject) }); score += 2 * n; }
    }
    if (a.kind !== b.kind) { chips.push({ dim: "kind", label: KIND_LABEL[b.kind] }); score += 2; }
  } else {
    chips.push({ dim: "trigger", label: triggerLabel(b) });
    score += 4;
  }
  const verb = shared.split("|")[0] ?? "";
  const ad = amountDistance(a.amount, b.amount);
  if (ad > 0) { chips.push({ dim: "amount", label: amountLabel(b.amount, verb) }); score += ad; }
  const rd = repeatsDistance(a.repeats, b.repeats);
  if (rd > 0) { chips.push({ dim: "repeats", label: b.repeats === undefined ? "repeat rate not stated" : (REPEAT_LABEL[b.repeats] ?? b.repeats) }); score += rd; }
  if (!sameTypes) { chips.push({ dim: "type", label: typeChip }); score += 1; }
  const tier: SimilarTier = !verbsEqual ? "output" : chips.length > 0 ? "close" : "same";
  return { tier, chips, score };
}

/** The best comparison of two cards, or null when no ability of the seed shares an output key with one of the candidate's: THE GATE. */
function compareSigs(a: CardSig, b: CardSig): Comparison | null {
  let best: Comparison | null = null;
  const sameTypes = sameSet(a.types, b.types);
  const typeChip = b.types.join(" ");
  for (const x of a.abilities) {
    for (const y of b.abilities) {
      const shared = x.outputs.find((o) => y.outputs.some((p) => p.key === o.key));
      if (!shared) continue;
      const c = compareAbilities(x, y, shared.key, sameTypes, typeChip);
      if (best === null || TIER_RANK[c.tier] < TIER_RANK[best.tier] || (c.tier === best.tier && c.score < best.score)) best = c;
    }
  }
  if (best === null) return null;
  // CARD-LEVEL DIFFERENCES: what one card does or has that the other does not. They add distance and
  // keep a same-job pair from reading as identical, but never move a card between `close` and `output`.
  const chips = [...best.chips];
  let score = best.score;
  for (const [k, l] of b.outputs) if (!a.outputs.has(k)) { chips.push({ dim: "extra", label: `+ ${l}` }); score += 1; }
  for (const kw of b.keywords) if (!a.keywords.includes(kw)) { chips.push({ dim: "extra", label: `+ ${kw}` }); score += 1; }
  for (const [k, l] of a.outputs) if (!b.outputs.has(k)) { chips.push({ dim: "missing", label: `lacks ${l}` }); score += 1; }
  for (const kw of a.keywords) if (!b.keywords.includes(kw)) { chips.push({ dim: "missing", label: `lacks ${kw}` }); score += 1; }
  return { tier: best.tier === "same" && chips.length > 0 ? "close" : best.tier, chips, score };
}

/** Reusable by the deck context (#1342): how `cand` differs from `seed`, null when it does not do the same job at all. */
export function compareCards(seed: SimilarCard, cand: SimilarCard): Comparison | null {
  return compareSigs(sigOf(seed), sigOf(cand));
}

export interface SimilarOptions {
  /** Maximum hits; default 24. */
  limit?: number;
  /** Colour identity letters allowed (a commander's identity): a candidate must be a subset. */
  identityWithin?: readonly string[];
}

/** BUCKETED BY OUTPUT KEY ONCE; each seed compares only the buckets of its own keys.
 *
 *  BIG-BUCKET RISK: the common outputs (`gain-life`, `draw`, `enters|creature` tokens) hold thousands of
 *  cards, so one seed on such a key compares against that whole bucket, and abilities are compared pairwise
 *  inside each pair of cards. ~18k seeds over ~32k cards is the build-static cost to measure (task 2);
 *  if it bites, the way down is to index a bucket by trigger verb as well, not to truncate it. */
export function similarIndex(cards: readonly SimilarCard[]) {
  const sigs = cards.map(sigOf);
  const at = new Map<number, number>();
  const buckets = new Map<string, number[]>();
  cards.forEach((c, i) => {
    at.set(c.id, i);
    for (const k of sigs[i]!.outputs.keys()) {
      const b = buckets.get(k);
      if (b) b.push(i); else buckets.set(k, [i]);
    }
  });
  return {
    similarTo(seedId: number, opts: SimilarOptions = {}): SimilarHit[] {
      const si = at.get(seedId);
      if (si === undefined) return [];
      const seed = cards[si]!;
      const allowed = opts.identityWithin ? new Set(opts.identityWithin) : null;
      const seen = new Set<number>([si]);
      const hits: SimilarHit[] = [];
      for (const k of sigs[si]!.outputs.keys()) {
        for (const ci of buckets.get(k) ?? []) {
          if (seen.has(ci)) continue;
          seen.add(ci);
          const cand = cards[ci]!;
          if (cand.name === seed.name) continue;
          if (allowed && !sigs[ci]!.identity.every((c) => allowed.has(c))) continue;
          const c = compareSigs(sigs[si]!, sigs[ci]!);
          if (c) hits.push({ id: cand.id, name: cand.name, ...c });
        }
      }
      hits.sort((x, y) => TIER_RANK[x.tier] - TIER_RANK[y.tier] || x.score - y.score || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
      return hits.slice(0, opts.limit ?? 24);
    },
  };
}
