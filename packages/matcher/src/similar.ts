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
 *  GATE KEYS ARE THE RAW `eventKey`, NOT `supplyForms` (which widens a key to everything it satisfies), ON
 *  PURPOSE: a Goblin-token maker and a generic token maker are different outputs, however well the first
 *  would feed a consumer of the second. Similarity asks "does it do this", not "does it feed that".
 *
 *  WHO RECEIVES IT is part of the output for the verbs below: `eventKey` carries no recipient, so gaining
 *  life yourself, an opponent losing life and damage to you would all collide. `you` and `not you` are
 *  different outputs (gated apart); an opponent versus any target within `not you` is a `recipient` chip.
 *
 *  So "target player gains life" and "each player draws" gate apart from "you gain life" / "you draw" ON
 *  PURPOSE: a card that feeds the opponent is not the card that feeds you. The same goes for who gets a created token.
 *
 *  SCOPE: for removal-shaped outputs (dies, exile, sacrifice, counters ...) one target versus each/all is a
 *  different job (Doom Blade is not Wrath of God): it is a `scope` chip and puts the pair in `output`.
 *
 *  CARD TIER is the WORST over the seed's abilities that share an output with the candidate, each against
 *  its own best partner. One lucky pair (Zulaport's and Blood Artist's self-death splits match each other)
 *  must not hide that the main abilities differ.
 *
 *  CEILING: a MIRROR effect is not surfaced as such. Suture Priest's second ability makes an opponent
 *  lose life when THEIR creature enters, which is the same trigger turned on the other player; it shares
 *  no output with Soul Warden, so only its gain-life half matches (as a close, with "+ lose life"). A mirror
 *  tier would need an output-with-flipped-subject comparison. */
import type { CardTags, GameEvent, SubjectFilter } from "@edh-seer/tagger";
import { isRefusedTrigger } from "./claims.js";
import { REPEATS_LADDER, factAmountOf, factKindOf, type FactAmount, type FactKind } from "./member-facts.js";
import { eventKey, splitKey } from "./partners-core.js";
import { VERB_PHRASES, emitSubjectNoun } from "./sentence.js";

/** What a card carries here: the same pair `partners-core` builds per card (a card and its derived tags), flattened. */
export interface SimilarCard { id: number; name: string; tags: CardTags | null }

export type SimilarTier = "same" | "close" | "output";
export type ChipDim = "scope" | "trigger" | "amount" | "repeats" | "type" | "kind" | "extra" | "missing" | "recipient";
export interface Chip { dim: ChipDim; label: string }
export interface Comparison { tier: SimilarTier; chips: Chip[]; score: number }
export interface SimilarHit extends Comparison { id: number; name: string }

type Ability = CardTags["abilities"][number];
type Amount = FactAmount;
type Who = "you" | "opp" | "any";
/** `key` is the gate key (raw eventKey plus a `@you`/`@other` recipient class where the verb has one). */
interface Output { key: string; who: Who | null; scope: "one" | "many" | null; event: GameEvent }
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
  /** gate key -> an event that has it (for labels). */
  outputs: Map<string, GameEvent>;
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

/** Verbs whose recipient the key does not carry. A token created or entering is the same question: whose it is. */
const RECIPIENT_VERBS = new Set(["gain-life", "lose-life", "draw", "discard", "mill", "non-combat-damage", "create-token"]);
const hasRecipient = (e: GameEvent): boolean => RECIPIENT_VERBS.has(e.verb) || (e.verb === "enters" && e.subject.token === true);
/** Verbs where one target and each/all are different jobs. */
const SCOPE_VERBS = new Set(["dies", "exiled", "leaves", "sacrifice", "counter-added", "taps", "untaps", "gains-control", "counter-spell"]);
/** A chip's noun for what a card does, never a sentence. */
const NOUN: Record<string, string> = {
  "gain-life": "life gain", "lose-life": "life loss", draw: "card draw", discard: "discard", mill: "mill",
  "non-combat-damage": "damage", "combat-damage": "combat damage", damaged: "being dealt damage",
  dies: "death", leaves: "leaving the battlefield", exiled: "exile", sacrifice: "sacrifice", "counter-added": "counters",
  taps: "tapping", untaps: "untapping", search: "library search", shuffle: "shuffling", transform: "transforming",
  transforms: "transforming", enchant: "enchanting", attached: "attaching", cast: "casting spells", "land-play": "land drops",
  "gains-control": "control change", "counter-spell": "counterspell", proliferate: "proliferate", scry: "scry", surveil: "surveil",
};

function outputOf(e: GameEvent, key: string): Output {
  const scope = SCOPE_VERBS.has(e.verb) ? (e.subject.scope === "each" || e.subject.scope === "all" ? "many" : "one") : null;
  if (!hasRecipient(e)) return { key, who: null, scope, event: e };
  const c = e.subject.control;
  const who: Who = c === "you" ? "you" : c === "opp" ? "opp" : "any";
  return { key: `${key}@${who === "you" ? "you" : "other"}`, who, scope, event: e };
}

/** The output as a noun phrase for a chip, with no article: "life loss", "Spirit token", "death", "exile". */
function outputNoun(e: GameEvent): string {
  const s = e.subject;
  if (e.verb === "create-token" || (e.verb === "enters" && s.token === true)) {
    const w = list(s.subtype)[0] ?? list(s.type)[0] ?? "";
    return `${w ? `${w.charAt(0).toUpperCase()}${w.slice(1)} ` : ""}token`;
  }
  if (e.verb === "enters") return "entering the battlefield";
  const base = NOUN[e.verb] ?? e.verb.replace(/-/g, " ");
  return s.control === "opp" && RECIPIENT_VERBS.has(e.verb) && e.verb !== "gain-life" ? `opponent ${base}` : base;
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
  const outputs = new Map<string, GameEvent>();
  for (const a of card.tags?.abilities ?? []) {
    if (!a.emits || a.emits.length === 0 || isRefusedTrigger(a)) continue;
    const own = new Map<string, Output>();
    for (const e of a.emits) for (const k of splitKey(eventKey(e))) { const o = outputOf(e, k); if (!own.has(o.key)) own.set(o.key, o); }
    for (const o of own.values()) if (!outputs.has(o.key)) outputs.set(o.key, o.event);
    abilities.push({
      kind: factKindOf(a),
      verbs: a.trigger ? [...a.trigger.verbs].sort() : null,
      subject: a.trigger?.subject ?? null,
      outputs: [...own.values()],
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

/** THE CANDIDATE'S ACTUAL SCOPE, not "only" the difference: "any creature", "your creatures", "your Goblins". */
function subjectLabel(s: SubjectFilter): string {
  if (s.self === true) return s.control === "you" || s.control === undefined ? "itself" : `itself (${s.control})`;
  if (s.control === "you") return `your ${subjectWords(s, true)}`;
  if (s.control === "opp") return `an opponent's ${subjectWords(s, true)}`;
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

const RECIPIENT_LABEL: Record<Who, string> = { you: "you", opp: "opponents only", any: "any player or target" };

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

/** How many facets of the trigger subject differ. `other` is ignored: "another creature" is the same event.
 *  `control` counts for a self subject too: "this creature or another creature you control dies" splits into a
 *  self ability that Blood Artist's own split (control: you) must not hide the difference of. */
function subjectFacets(a: SubjectFilter, b: SubjectFilter): number {
  if ((a.self === true) !== (b.self === true)) return 1;
  return (a.control !== b.control ? 1 : 0) + ((a.token ?? null) !== (b.token ?? null) ? 1 : 0)
    + (sameSet(sorted(a.type), sorted(b.type)) ? 0 : 1) + (sameSet(sorted(a.subtype), sorted(b.subtype)) ? 0 : 1);
}

interface Pair { tier: SimilarTier; score: number; shared: Output; mine: Output }

/** NUMERIC ONLY: no label is built here. Called for every candidate in a bucket. */
function evalPair(a: AbilitySig, b: AbilitySig, shared: Output, mine: Output, sameTypes: boolean): Pair {
  let score = 0;
  const verbsEqual = (a.verbs === null && b.verbs === null) || (a.verbs !== null && b.verbs !== null && sameSet(a.verbs, b.verbs));
  let differs = false;
  const scopeDiffers = mine.scope !== null && shared.scope !== null && mine.scope !== shared.scope;
  if (scopeDiffers) score += 4;
  if (verbsEqual) {
    if (a.subject && b.subject) { const n = subjectFacets(a.subject, b.subject); if (n > 0) { differs = true; score += 2 * n; } }
    if (a.kind !== b.kind) { differs = true; score += 2; }
  } else score += 4;
  const ad = amountDistance(a.amount, b.amount);
  const rd = repeatsDistance(a.repeats, b.repeats);
  const wd = mine.who !== shared.who ? 1 : 0;
  if (ad > 0 || rd > 0 || wd > 0 || !sameTypes) differs = true;
  score += ad + rd + wd + (sameTypes ? 0 : 1);
  return { tier: !verbsEqual || scopeDiffers ? "output" : differs ? "close" : "same", score, shared, mine };
}

function pairChips(a: AbilitySig, b: AbilitySig, p: Pair, sameTypes: boolean, typeChip: string): Chip[] {
  const chips: Chip[] = [];
  const verbsEqual = (a.verbs === null && b.verbs === null) || (a.verbs !== null && b.verbs !== null && sameSet(a.verbs, b.verbs));
  if (verbsEqual) {
    if (a.subject && b.subject && subjectFacets(a.subject, b.subject) > 0) chips.push({ dim: "trigger", label: subjectLabel(b.subject) });
    if (a.kind !== b.kind) chips.push({ dim: "kind", label: KIND_LABEL[b.kind] });
  } else chips.push({ dim: "trigger", label: triggerLabel(b) });
  if (p.mine.scope !== null && p.shared.scope !== null && p.mine.scope !== p.shared.scope) {
    chips.push({ dim: "scope", label: p.shared.scope === "many" ? `each ${subjectWords(p.shared.event.subject, false)}` : "one target" });
  }
  if (amountDistance(a.amount, b.amount) > 0) chips.push({ dim: "amount", label: amountLabel(b.amount, p.shared.event.verb) });
  if (repeatsDistance(a.repeats, b.repeats) > 0) chips.push({ dim: "repeats", label: b.repeats === undefined ? "repeat rate not stated" : (REPEAT_LABEL[b.repeats] ?? b.repeats) });
  if (p.mine.who !== p.shared.who && p.shared.who !== null) chips.push({ dim: "recipient", label: RECIPIENT_LABEL[p.shared.who] });
  if (!sameTypes) chips.push({ dim: "type", label: typeChip });
  return chips;
}

const better = (x: Pair, y: Pair | null): boolean => y === null || TIER_RANK[x.tier] < TIER_RANK[y.tier] || (x.tier === y.tier && x.score < y.score);

interface Ranked { tier: SimilarTier; score: number; pairs: [AbilitySig, AbilitySig, Pair][] }

/** Gate and tier, numerically. null when no seed ability shares an output key with a candidate ability.
 *  `a` is the seed; `b` is the candidate (`mine` is the seed's output, `shared` the candidate's). */
function rank(a: CardSig, b: CardSig): Ranked | null {
  const sameTypes = sameSet(a.types, b.types);
  const pairs: [AbilitySig, AbilitySig, Pair][] = [];
  for (const x of a.abilities) {
    let best: Pair | null = null;
    let bestY: AbilitySig | null = null;
    for (const y of b.abilities) {
      for (const mine of x.outputs) {
        const shared = y.outputs.find((o) => o.key === mine.key);
        if (!shared) continue;
        const p = evalPair(x, y, shared, mine, sameTypes);
        if (better(p, best)) { best = p; bestY = y; }
      }
    }
    if (best && bestY) pairs.push([x, bestY, best]);
  }
  if (pairs.length === 0) return null;
  let tier: SimilarTier = "same";
  let score = 0;
  for (const [, , p] of pairs) { if (TIER_RANK[p.tier] > TIER_RANK[tier]) tier = p.tier; score += p.score; }
  let extras = 0;
  for (const k of b.outputs.keys()) if (!a.outputs.has(k)) extras++;
  for (const k of a.outputs.keys()) if (!b.outputs.has(k)) extras++;
  for (const kw of b.keywords) if (!a.keywords.includes(kw)) extras++;
  for (const kw of a.keywords) if (!b.keywords.includes(kw)) extras++;
  // A card with something extra or missing is not the same job; the difference never moves it between close and output.
  if (extras > 0 && tier === "same") tier = "close";
  return { tier, score: score + extras, pairs };
}

function chipsOf(a: CardSig, b: CardSig, r: Ranked): Chip[] {
  const sameTypes = sameSet(a.types, b.types);
  const typeChip = b.types.join(" ");
  const chips: Chip[] = [];
  const seen = new Set<string>();
  const add = (c: Chip) => { const k = `${c.dim}:${c.label}`; if (!seen.has(k)) { seen.add(k); chips.push(c); } };
  for (const [x, y, p] of r.pairs) for (const c of pairChips(x, y, p, sameTypes, typeChip)) add(c);
  // ONE CHIP PER VERB: a card that creates a token also "enters" one, and two types of the same verb are one difference to a reader.
  const verbs = new Set<string>();
  const once = (dim: string, e: GameEvent): boolean => {
    const v = `${dim}:${e.verb === "enters" && e.subject.token === true ? "create-token" : e.verb}`;
    if (verbs.has(v)) return false;
    verbs.add(v);
    return true;
  };
  for (const [k, e] of b.outputs) if (!a.outputs.has(k) && once("extra", e)) add({ dim: "extra", label: `+ ${outputNoun(e)}` });
  for (const kw of b.keywords) if (!a.keywords.includes(kw)) add({ dim: "extra", label: `+ ${kw}` });
  for (const [k, e] of a.outputs) if (!b.outputs.has(k) && once("missing", e)) add({ dim: "missing", label: `no ${outputNoun(e)}` });
  for (const kw of a.keywords) if (!b.keywords.includes(kw)) add({ dim: "missing", label: `no ${kw}` });
  return chips;
}

/** Reusable by the deck context (#1342): how `cand` differs from `seed`, null when it does not do the same job at all. */
export function compareCards(seed: SimilarCard, cand: SimilarCard): Comparison | null {
  const a = sigOf(seed);
  const b = sigOf(cand);
  const r = rank(a, b);
  return r && { tier: r.tier, score: r.score, chips: chipsOf(a, b, r) };
}

export interface SimilarOptions {
  /** Maximum hits; default 24. */
  limit?: number;
  /** Colour identity letters allowed (a commander's identity): a candidate must be a subset. */
  identityWithin?: readonly string[];
}

const order = (x: { tier: SimilarTier; score: number; name: string }, y: { tier: SimilarTier; score: number; name: string }): number =>
  TIER_RANK[x.tier] - TIER_RANK[y.tier] || x.score - y.score || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0);

/** BUCKETED BY OUTPUT KEY ONCE; each seed compares only the buckets of its own keys. Scores and tiers are
 *  numeric; chip labels are built only for the `limit` survivors, which are kept by bounded insertion
 *  rather than sorting the bucket.
 *
 *  BIG-BUCKET RISK: the common outputs (`gain-life`, `draw`, `enters|creature` tokens) hold thousands of
 *  cards, so one seed on such a key compares against that whole bucket. Measured on a synthetic bucket of 5,000 one-ability gain-life cards (2026-10-24, this machine, vitest): 0.86 ms per seed, so 18k seeds in a 5k bucket is ~16 s; real cards carry several abilities, so re-measure on the build.
 *  If it bites, index a bucket by trigger verb as well rather than truncate it. */
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
      const limit = opts.limit ?? 24;
      if (limit <= 0) return [];
      const seed = cards[si]!;
      const allowed = opts.identityWithin ? new Set(opts.identityWithin) : null;
      const seen = new Set<number>([si]);
      const top: { ci: number; tier: SimilarTier; score: number; name: string; r: Ranked }[] = [];
      for (const k of sigs[si]!.outputs.keys()) {
        for (const ci of buckets.get(k) ?? []) {
          if (seen.has(ci)) continue;
          seen.add(ci);
          const cand = cards[ci]!;
          if (cand.name === seed.name) continue;
          if (allowed && !sigs[ci]!.identity.every((c) => allowed.has(c))) continue;
          const r = rank(sigs[si]!, sigs[ci]!);
          if (!r) continue;
          const item = { ci, tier: r.tier, score: r.score, name: cand.name, r };
          if (top.length >= limit && order(item, top[top.length - 1]!) >= 0) continue;
          let at2 = top.length;
          while (at2 > 0 && order(item, top[at2 - 1]!) < 0) at2--;
          top.splice(at2, 0, item);
          if (top.length > limit) top.pop();
        }
      }
      return top.map((t) => ({ id: cards[t.ci]!.id, name: t.name, tier: t.tier, score: t.score, chips: chipsOf(sigs[si]!, sigs[t.ci]!, t.r) }));
    },
  };
}
