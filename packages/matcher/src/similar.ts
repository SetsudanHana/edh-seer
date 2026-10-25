/** CARDS THAT DO THE SAME OR A SIMILAR JOB (#1341; owner 2026-10-24: "take Soul Warden for example and
 *  click to see cards that show the same or similar effects").
 *
 *  NOT `same-job.ts` (`sameJob`), AND WHY. That one is role-and-printed-text based, built for swap suggestions ("which card
 *  fills the slot this one fills"); this file is ability-signature based (what each ability listens for, produces, how
 *  much, how often). They answer different questions and will disagree. Owner ruling 2026-10-25: #1342 uses this file
 *  only; sameJob stays in swap suggestions and is never shown in that panel.
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
 *  - `outcome`: DECK CONTEXT ONLY (#1342), never produced by `similarIndex` or a card page; `compareCards` yields it
 *              only when asked (`drainIsDamage`) and only when the plain comparison found nothing. The same job by a
 *              different event: damage to each opponent and an opponent losing life (Impact Tremors, Corpse Knight)
 *              both take opponents' life total down, so a deck holding both has said the same thing twice. It is
 *              not folded into `output` because the card page's answer to "same output" stays the engine's own key;
 *              and amplifiers break the equivalence (a damage doubler or a life-loss prevention touches only one of
 *              the two), which the deck pass, not this file, accounts for.
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

export type SimilarTier = "same" | "close" | "output" | "outcome";
export type ChipDim = "outcome" | "scope" | "trigger" | "amount" | "repeats" | "type" | "kind" | "extra" | "missing" | "recipient";
export interface Chip { dim: ChipDim; label: string }
export interface Comparison { tier: SimilarTier; chips: Chip[]; score: number }
export interface SimilarHit extends Comparison { id: number; name: string }

type Ability = CardTags["abilities"][number];
type Amount = FactAmount;
type Who = "you" | "opp" | "any";
/** `key` is the gate key (raw eventKey plus a `@you`/`@other` recipient class where the verb has one). */
interface Output { key: string; who: Who | null; scope: "one" | "many" | null; event: GameEvent;
  /** Set only on a drain-swapped output (#1342): the candidate's real event, which labels read, while `event` carries the swapped verb. */
  orig?: GameEvent }
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
  /** Outputs that open the gate on their own. */
  strong: number;
}

/** Supertypes (CR 205.4a) ride in `characteristics.types` but are not card types: a legendary creature and a creature are the same type here. */
const SUPERTYPES = new Set(["legendary", "basic", "snow", "world", "ongoing"]);
/** ABILITY WORDS (CR 207.2c) ride in `characteristics.keywords` but "have no special rules meaning": "+ alliance" says nothing a reader can act on. Verbatim from the rule. */
const ABILITY_WORDS = new Set(("adamant, addendum, alliance, battalion, bloodrush, celebration, channel, chroma, cohort, constellation, converge, council's dilemma, coven, delirium, descend 4, descend 8, disappear, domain, eerie, eminence, enrage, fateful hour, fathomless descent, ferocious, flurry, formidable, grandeur, hellbent, heroic, imprint, infusion, inspired, join forces, kinship, landfall, lieutenant, magecraft, metalcraft, morbid, opus, pack tactics, paradox, parley, radiance, raid, rally, renew, repartee, revolt, secret council, spell mastery, strive, survival, sweep, tempting offer, threshold, undergrowth, valiant, vivid, void, will of the council")
  .split(", ").map((w) => w.replace("’", "'")));
const TIER_RANK: Record<SimilarTier, number> = { same: 0, close: 1, output: 2, outcome: 3 };
const KIND_LABEL: Record<FactKind, string> = {
  spell: "when cast", triggered: "a triggered ability", activated: "an activated ability",
  static: "a static ability", replacement: "a replacement effect",
};
const REPEAT_LABEL: Record<string, string> = {
  once: "once only", "per-cycle": "once each turn of yours", "per-turn": "once each player's turn",
  repeatable: "every time it happens", continuous: "always on",
};

/** Verbs whose recipient the key does not carry. A token created or entering is the same question: whose it is. */
const RECIPIENT_VERBS = new Set(["gain-life", "lose-life", "draw", "discard", "mill", "non-combat-damage", "create-token", "sacrifice", "search", "shuffle", "dies", "exiled", "leaves", "gains-control"]);
// `dies` rides with `sacrifice` (every sacrifice also emits it): whose creature dies is the edict-versus-drawback question. `exiled`/`leaves`: returning YOUR creature is not bounce removal. `gains-control`: the subject is who ends up controlling it (Threaten `you`, Donate `opp`).
/** The verbs whose chip noun reads "opponent X" ("opponent life loss"); the rest of RECIPIENT_VERBS name the recipient differently. */
const OPP_NOUN_VERBS = new Set(["lose-life", "draw", "discard", "mill", "non-combat-damage", "create-token"]);
/** `enters` always has a whose: a token you create and a land an opponent puts onto the battlefield are different outputs. */
const hasRecipient = (e: GameEvent): boolean => RECIPIENT_VERBS.has(e.verb) || e.verb === "enters";
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

/** SELF COSTS AND SELF-MOVES never open the gate: "sacrifice this creature", "this card dies", "return this Aura to hand". Any other
 *  self verb ("put a +1/+1 counter on this creature", "this untaps", "transform this") is what the card IS FOR and gates, but only
 *  against another self output of that verb (`<verb>@self`, a counter's kind in the key). */
const COST_SELF_VERBS = new Set(["sacrifice", "dies", "leaves", "exiled", "discard", "shuffle"]);
/** SHUFFLE IS A BY-PRODUCT of a search: it gates only when it is all both cards do, and never counts as an extra or missing effect. */
const WEAK_VERBS = new Set(["shuffle"]);
/** A COST THE PLAYER PAYS (discard to activate, sacrifice another creature, pay life, "as an additional cost to cast ... sacrifice a creature")
 *  and an EFFECT-KIND PSEUDO-OUTPUT (an ability that emits nothing: pump, debuff, mana) never open the gate. */
const COST_SUFFIX = "~cost";
const EFFECT_PREFIX = "effect:";
/** Per-key facts, computed once: `rank` asks them for every key of every candidate, and a regex split per ask was the build's hot spot. */
const keyMeta = new Map<string, { verb: string; gate: Gate; weak: boolean }>();
type Gate = "open" | "never" | "alone";
function metaOf(key: string): { verb: string; gate: Gate; weak: boolean } {
  let m = keyMeta.get(key);
  if (!m) {
    const verb = key.split(/[|@:~]/)[0]!;
    const weak = WEAK_VERBS.has(verb);
    m = { verb, weak, gate: key.endsWith(COST_SUFFIX) || key.startsWith(EFFECT_PREFIX) || (key.endsWith("@self") && COST_SELF_VERBS.has(verb)) ? "never" : weak ? "alone" : "open" };
    keyMeta.set(key, m);
  }
  return m;
}
const gateOfKey = (key: string): Gate => metaOf(key).gate;
const isWeakKey = (key: string): boolean => metaOf(key).weak;

function outputOf(e: GameEvent, key: string, cost = false): Output {
  // A SEARCH FOR THE CARD'S OWN NAME ("up to three cards named Squadron Hawk") is not a tutor for anything.
  if (e.verb === "search" && e.subject.named === "~") return { key: "search@named-self", who: null, scope: null, event: e };
  if (e.subject.self === true) {
    // By VERB (and counter kind) alone: a creature and a land sacrificing themselves are the same cost; the type is the type chip's business.
    const counter = e.verb === "counter-added" && e.subject.counter !== undefined ? `:${String(e.subject.counter)}` : "";
    return { key: `${e.verb}${counter}@self`, who: null, scope: null, event: e };
  }
  // THE COUNTER'S KIND IS PART OF THE OUTPUT: +1/+1, -1/-1, stun, poison and energy are different jobs.
  if (e.verb === "counter-added" && e.subject.counter !== undefined) key = `${key}:${String(e.subject.counter)}`;
  const scope = SCOPE_VERBS.has(e.verb) ? (e.subject.scope === "each" || e.subject.scope === "all" ? "many" : "one") : null;
  const sfx = cost ? COST_SUFFIX : "";
  if (!hasRecipient(e)) return { key: `${key}${sfx}`, who: null, scope, event: e };
  const c = e.subject.control;
  const who: Who = c === "you" ? "you" : c === "opp" ? "opp" : "any";
  return { key: `${key}@${who === "you" ? "you" : "other"}${sfx}`, who, scope, event: e };
}

/** The output as a noun phrase for a chip, with no article: "life loss", "Spirit token", "death", "exile". */
/** Effect kinds the same card also emits as events in a sibling ability (a drain emits life loss and gain): a pseudo-output would count them twice. */
const EMITTED_ELSEWHERE = new Set(["drain", "draw-card", "mill", "bounce"]);
const EFFECT_NOUN: Record<string, string> = {
  pump: "pump", debuff: "debuff", "keyword-grant": "keyword grant", "mana-generation": "mana", "speed-increase": "speed boost",
  animate: "animation", evasion: "evasion", "cost-reduction": "cost reduction", search: "library search", restriction: "restriction",
  drain: "drain", "ability-loss": "ability loss", "to-hand": "return to hand", "top-set": "top-of-library setup", tax: "tax",
  "type-grant": "type change", emblem: "emblem", "damage-multiplier": "damage multiplier", "counter-placement": "counters",
  "extra-turn": "extra turn", "extra-combat": "extra combat", "trigger-doubling": "trigger doubling", "win-game": "winning the game",
  "token-doubling": "token doubling", retarget: "retargeting", "extra-loyalty": "extra loyalty activation", "extra-phase": "extra phase",
  "draw-card": "card draw", bounce: "bounce", "play-from-top": "playing from the top", "graveyard-recursion": "recursion",
  mill: "mill", "exile-processing": "exile processing", flicker: "flicker",
};

function outputNoun(e: GameEvent): string {
  const s = e.subject;
  if (e.verb === "create-token" || (e.verb === "enters" && s.token === true)) {
    const w = list(s.subtype)[0] ?? list(s.type)[0] ?? "";
    return `${w ? `${w.charAt(0).toUpperCase()}${w.slice(1)} ` : ""}token`;
  }
  if (e.verb === "enters") return "entering the battlefield";
  if (e.verb.startsWith(EFFECT_PREFIX)) { const k = e.verb.slice(EFFECT_PREFIX.length); return EFFECT_NOUN[k] ?? k.replace(/-/g, " "); }
  const base = NOUN[e.verb] ?? e.verb.replace(/-/g, " ");
  return s.control === "opp" && OPP_NOUN_VERBS.has(e.verb) ? `opponent ${base}` : base;
}

function amountOf(a: Ability): Amount {
  if (a.replacement === true && a.change) return { kind: a.change.op, value: a.change.value };
  return factAmountOf(a.amount);
}

export function signatureOf(card: SimilarCard): AbilitySig[] {
  return sigOf(card).abilities;
}

/** THE VERBS OF THIS ABILITY THAT ARE A COST: what an activation's `payment` consumes (a non-self discard or sacrifice, life), and an
 *  on-cast ability that only sacrifices/discards/pays life of yours with no effect of its own beside another on-cast ability
 *  ("as an additional cost to cast this spell, sacrifice a creature" is encoded that way: Bone Splinters, Village Rites). */
function costVerbsOf(a: Ability, onCastCount: number): Set<string> {
  const v = new Set<string>();
  const p = a.payment;
  if (p?.discard?.some((o) => o.subject?.self !== true)) v.add("discard");
  if (p?.sacrifice?.some((o) => o.subject?.self !== true)) { v.add("sacrifice"); v.add("dies"); }
  if (p?.life) v.add("lose-life");
  if (a.kind === "on-cast" && onCastCount > 1 && !a.effect?.kind && a.emits?.every((e) => ["sacrifice", "dies", "discard", "lose-life"].includes(e.verb) && e.subject.control === "you" && e.subject.self !== true)) {
    for (const e of a.emits ?? []) v.add(e.verb);
  }
  return v;
}

const sigCache = new WeakMap<object, CardSig>();
function sigOf(card: SimilarCard): CardSig {
  const key = card.tags ?? card;
  const hit = sigCache.get(key);
  if (hit) return hit;
  const abilities: AbilitySig[] = [];
  const outputs = new Map<string, GameEvent>();
  const all = card.tags?.abilities ?? [];
  const onCast = all.filter((x) => x.kind === "on-cast").length;
  for (const a of all) {
    if (isRefusedTrigger(a)) continue;
    // AN ABILITY THAT EMITS NOTHING still does something (pump, debuff, mana): its effect kind rides along as a pseudo-output that
    // never gates but counts as an extra or missing effect.
    if (!a.emits || a.emits.length === 0) {
      const kind = a.effect?.kind;
      if (kind && !EMITTED_ELSEWHERE.has(kind)) { const k = `${EFFECT_PREFIX}${kind}`; if (!outputs.has(k)) outputs.set(k, { verb: k, subject: { control: "any", token: null } } as unknown as GameEvent); }
      continue;
    }
    const costVerbs = costVerbsOf(a, onCast);
    const own = new Map<string, Output>();
    for (const e of a.emits) for (const k of splitKey(eventKey(e))) { const o = outputOf(e, k, e.subject.self !== true && costVerbs.has(e.verb)); if (!own.has(o.key)) own.set(o.key, o); }
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
    keywords: [...new Set((ch?.keywords ?? []).map((k) => k.toLowerCase()).filter((k) => !ABILITY_WORDS.has(k)))].sort(),
    types: [...(ch?.types ?? [])].filter((t) => !SUPERTYPES.has(t)).sort(),
    identity: ch?.identity ?? [],
    strong: [...outputs.keys()].filter((k) => gateOfKey(k) === "open").length,
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

const COLOUR: Record<string, string> = { W: "white", U: "blue", B: "black", R: "red", G: "green", C: "colourless" };
const COUNT_WORD: Record<string, string> = { multi: "multicoloured", mono: "monocoloured", all: "all-coloured", "exactly-two": "two-coloured", colored: "coloured" };
/** The colour words of a subject: "white", "white or blue", "multicoloured", "nonblack". Empty when it states none. */
function colourWords(s: SubjectFilter): string {
  const parts: string[] = [];
  if (s.colors?.length) parts.push(s.colors.map((c) => COLOUR[c] ?? c).join(" or "));
  if (s.allColors?.length) parts.push(s.allColors.map((c) => COLOUR[c] ?? c).join(" and "));
  if (s.colorCount) parts.push(COUNT_WORD[s.colorCount] ?? s.colorCount);
  if (s.notColors?.length) parts.push(s.notColors.map((c) => `non${COLOUR[c] ?? c}`).join(" "));
  return parts.join(" ");
}
const colourKey = (s: SubjectFilter): string => colourWords(s);
const articled = (w: string): string => `${/^[aeiou]/i.test(w) ? "an" : "a"} ${w}`;

function subjectWords(s: SubjectFilter, pl: boolean): string {
  const subs = list(s.subtype).map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  const words = subs.length > 0 ? subs : list(s.type);
  const nouns = (words.length > 0 ? words : ["permanent"]).map((w) => (pl ? plural(w) : w)).join(" or ");
  const col = colourWords(s);
  return `${s.token === true ? "token " : s.token === false ? "nontoken " : ""}${col ? `${col} ` : ""}${nouns}`;
}

/** THE CANDIDATE'S ACTUAL SCOPE, not "only" the difference: "any creature", "your creatures", "your Goblins". */
function subjectLabel(s: SubjectFilter): string {
  if (s.self === true) return s.control === "you" || s.control === undefined ? "itself" : `itself (${s.control})`;
  if (s.control === "you") return `your ${subjectWords(s, true)}`;
  if (s.control === "opp") return `an opponent's ${subjectWords(s, true)}`;
  return `any ${subjectWords(s, false)}`;
}

/** A PLAYER'S EVENT, not a permanent's: [you, opponent, any player]. "A permanent you control draws a card" is not a sentence. */
const PLAYER_EVENT: Record<string, [string, string, string]> = {
  draw: ["when you draw a card", "when an opponent draws a card", "when a player draws a card"],
  discard: ["when you discard a card", "when an opponent discards a card", "when a player discards a card"],
  mill: ["when you mill a card", "when an opponent mills a card", "when a player mills a card"],
  scry: ["when you scry", "when an opponent scries", "when a player scries"],
  surveil: ["when you surveil", "when an opponent surveils", "when a player surveils"],
  "gain-life": ["when you gain life", "when an opponent gains life", "when a player gains life"],
  "lose-life": ["when you lose life", "when an opponent loses life", "when a player loses life"],
  search: ["when you search a library", "when an opponent searches a library", "when a player searches a library"],
  "land-play": ["when you play a land", "when an opponent plays a land", "when a player plays a land"],
  // CR: these are the beginnings of steps ("beginning-of-combat" is what `begin-combat` is normalised from).
  upkeep: ["at the beginning of your upkeep", "at the beginning of an opponent's upkeep", "at the beginning of each upkeep"],
  "end-step": ["at the beginning of your end step", "at the beginning of an opponent's end step", "at the beginning of each end step"],
  "begin-combat": ["at the beginning of combat on your turn", "at the beginning of combat on an opponent's turn", "at the beginning of each combat"],
};

function triggerLabel(sig: AbilitySig): string {
  if (!sig.verbs || !sig.subject) return KIND_LABEL[sig.kind];
  const s = sig.subject;
  const phrase = sig.verbs.length === 1 ? PLAYER_EVENT[sig.verbs[0]!] : undefined;
  const typed = list(s.subtype).length > 0 || list(s.type).some((t) => t !== "spell" && t !== "player");
  if (phrase && s.self !== true && !typed) return phrase[s.control === "you" ? 0 : s.control === "opp" ? 1 : 2];
  // CAST NAMES THE SPELL: its colour and its type ("when you cast a white creature spell"), not just "a spell".
  if (sig.verbs.length === 1 && sig.verbs[0] === "cast" && s.self !== true) {
    const kinds = list(s.subtype).length > 0 ? list(s.subtype).map((w) => w.charAt(0).toUpperCase() + w.slice(1)) : list(s.type).filter((t) => t !== "spell" && t !== "player");
    const noun = [colourWords(s), kinds.join(" or "), "spell"].filter((w) => w !== "").join(" ");
    return s.control === "you" ? `when you cast ${articled(noun)}` : s.control === "opp" ? `when an opponent casts ${articled(noun)}` : `when ${articled(noun)} is cast`;
  }
  const noun0 = s.self === true ? "this card" : (emitSubjectNoun(s) ?? "a permanent");
  const col = s.self === true ? "" : colourWords(s);
  const base = col ? articled(`${col} ${noun0.replace(/^(a|an) /, "")}`) : noun0;
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
  return (a.control !== b.control ? 1 : 0) + (colourKey(a) !== colourKey(b) ? 1 : 0) + ((a.token ?? null) !== (b.token ?? null) ? 1 : 0)
    + (sameSet(sorted(a.type), sorted(b.type)) ? 0 : 1) + (sameSet(sorted(a.subtype), sorted(b.subtype)) ? 0 : 1);
}

/** Verbs that move an object between zones. A creature entering, dying or leaving is one KIND of event; casting a spell is another. */
// CEILING: the distances below (2 for a different verb, +1 per subject facet, +2 across the zone-change line, 6 for triggered
// against untriggered) are hand-tuned on the Soul Warden fixture and unmeasured against the corpus.
const ZONE_CHANGE = new Set(["enters", "dies", "leaves", "exiled", "sacrifice", "discard", "mill"]);

/** HOW FAR APART TWO DIFFERENT TRIGGERS ARE (output tier only). A triggered ability against an untriggered one is the
 *  far step (6). Two triggers with different verbs start at 2, plus one per differing facet of the trigger SUBJECT
 *  (creature vs creature, same control: 0), plus 2 when one is a zone change and the other is not: Soul Warden's
 *  "another creature enters" is nearer Blood Artist's "a creature dies" than to "a player casts a white spell". */
function verbDistance(a: AbilitySig, b: AbilitySig): number {
  if (!a.verbs || !b.verbs || !a.subject || !b.subject) return 6;
  const zone = (v: string[]): boolean => v.every((x) => ZONE_CHANGE.has(x));
  return 2 + subjectFacets(a.subject, b.subject) + (zone(a.verbs) === zone(b.verbs) ? 0 : 2);
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
  } else score += verbDistance(a, b);
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
  if (amountDistance(a.amount, b.amount) > 0) chips.push({ dim: "amount", label: amountLabel(b.amount, (p.shared.orig ?? p.shared.event).verb) });
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
        const g = gateOfKey(mine.key);
        if (g === "never" || (g === "alone" && (a.strong > 0 || b.strong > 0))) continue;
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
  for (const k of b.outputs.keys()) if (!a.outputs.has(k) && !isWeakKey(k)) extras++;
  for (const k of a.outputs.keys()) if (!b.outputs.has(k) && !isWeakKey(k)) extras++;
  for (const kw of b.keywords) if (!a.keywords.includes(kw)) extras++;
  for (const kw of a.keywords) if (!b.keywords.includes(kw)) extras++;
  // A card with something extra or missing is not the same job; the difference never moves it between close and output.
  if (extras > 0 && tier === "same") tier = "close";
  return { tier, score: score + extras, pairs };
}

/** WHAT DIFFERS IN CARD TYPE, by name: the candidate's types the seed lacks ("enchantment"), else the seed's the candidate lacks ("not an enchantment"). */
function typeLabel(seed: string[], cand: string[]): string {
  const added = cand.filter((t) => !seed.includes(t));
  if (added.length > 0) return added.join(" ");
  const gone = seed.filter((t) => !cand.includes(t));
  return gone.map((t) => `not ${/^[aeiou]/.test(t) ? "an" : "a"} ${t}`).join(" ");
}

function chipsOf(a: CardSig, b: CardSig, r: Ranked): Chip[] {
  const sameTypes = sameSet(a.types, b.types);
  const typeChip = typeLabel(a.types, b.types);
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
  // AT MOST ONE `extra` AND ONE `missing` CHIP PER ROW: a multi-ability seed lacks something of nearly every candidate (Heliod:
  // "no counters", "no indestructible" on every row), and a wall of them hides the chips that explain the tier. More than one
  // collapses to a count; trigger/amount/repeats/type/kind/recipient/scope chips are never capped.
  const extra: string[] = [];
  const missing: string[] = [];
  for (const [k, e] of b.outputs) if (!a.outputs.has(k) && !isWeakKey(k) && once("extra", e)) extra.push(`+ ${outputNoun(e)}`);
  for (const kw of b.keywords) if (!a.keywords.includes(kw)) extra.push(`+ ${kw}`);
  for (const [k, e] of a.outputs) if (!b.outputs.has(k) && !isWeakKey(k) && once("missing", e)) missing.push(`no ${outputNoun(e)}`);
  for (const kw of a.keywords) if (!b.keywords.includes(kw)) missing.push(`no ${kw}`);
  if (extra.length === 1) add({ dim: "extra", label: extra[0]! });
  else if (extra.length > 1) add({ dim: "extra", label: `+ ${extra.length} other effects` });
  if (missing.length === 1) add({ dim: "missing", label: missing[0]! });
  else if (missing.length > 1) add({ dim: "missing", label: `lacks ${missing.length} other effects` });
  return chips;
}

const DRAIN_SWAP: Record<string, string> = { "lose-life": "non-combat-damage", "non-combat-damage": "lose-life" };
/** The verb prefix of an `@other` key swapped to its counterpart, null for any other key. Keys are `verb|...|...|...@recipient`
 *  (`outputOf`); `@you` is damage to you / you losing life, a drawback and not a drain, and `~cost` (pay life) is a cost. */
function drainSwapKey(key: string): string | null {
  if (!key.endsWith("@other")) return null;
  const bar = key.indexOf("|");
  const to = bar < 0 ? undefined : DRAIN_SWAP[key.slice(0, bar)];
  return to === undefined ? null : `${to}${key.slice(bar)}`;
}

const swappedCache = new WeakMap<CardSig, CardSig | null>();
/** THE CANDIDATE AS IF ITS LIFE LOSS WERE DAMAGE (and the reverse), or null when it has no such output. Only the key and the event's verb
 *  change, so the amount, trigger and extras compare exactly as they would for a plain match; labels read the real events (`orig`).
 *  CEILING: the swap is tried only when the plain comparison is null, and for the whole card, not per ability. A pair that also shares
 *  another output (both make a token) keeps its plain tier with "no damage" / "+ life loss" chips and gets no drain credit. */
function drainSwapped(b: CardSig): CardSig | null {
  if (swappedCache.has(b)) return swappedCache.get(b)!;
  const swap = (o: Output): Output => {
    const k = drainSwapKey(o.key);
    return k === null ? o : { ...o, key: k, orig: o.event, event: { ...o.event, verb: DRAIN_SWAP[o.event.verb] ?? o.event.verb } as GameEvent };
  };
  let any = false;
  const outputs = new Map<string, GameEvent>();
  for (const [k, e] of b.outputs) {
    const nk = drainSwapKey(k);
    if (nk === null) { outputs.set(k, e); continue; }
    any = true;
    outputs.set(nk, e); // the real event: extra/missing nouns read it
  }
  const sig: CardSig | null = any ? { ...b, outputs, abilities: b.abilities.map((x) => ({ ...x, outputs: x.outputs.map(swap) })) } : null;
  swappedCache.set(b, sig);
  return sig;
}

export interface CompareOptions {
  /** A DECK ASKS WHETHER DAMAGE AND LIFE LOSS ARE ONE JOB (#1342). When the plain comparison finds nothing, retry with the
   *  candidate's opponent-facing life loss read as damage (and the reverse); a match is tier `outcome` with an `outcome` chip. */
  drainIsDamage?: boolean;
}

/** The outcome chip labels: the candidate swaps the seed's damage for life loss, or the reverse. */
export const OUTCOME_LOSS_LABEL = "life loss, not damage";
export const OUTCOME_DAMAGE_LABEL = "damage, not life loss";
/** A card's colour identity as the engine reads it (empty for colourless or untagged). */
export function identityOf(card: SimilarCard): readonly string[] { return sigOf(card).identity; }
/** Reusable by the deck context (#1342): how `cand` differs from `seed`, null when it does not do the same job at all. */
export function compareCards(seed: SimilarCard, cand: SimilarCard, opts: CompareOptions = {}): Comparison | null {
  const a = sigOf(seed);
  const b = sigOf(cand);
  const r = rank(a, b);
  if (r) return { tier: r.tier, score: r.score, chips: chipsOf(a, b, r) };
  if (!opts.drainIsDamage) return null;
  const sw = drainSwapped(b);
  const rs = sw && rank(a, sw);
  if (!sw || !rs) return null;
  // The pair that matched carries the swapped verb: damage there means the candidate's own output is life loss.
  const candLoses = rs.pairs.some(([, , p]) => p.shared.event.verb === "non-combat-damage");
  return { tier: "outcome", score: rs.score, chips: [{ dim: "outcome", label: candLoses ? OUTCOME_LOSS_LABEL : OUTCOME_DAMAGE_LABEL }, ...chipsOf(a, sw, rs)] };
}

/** ONE EVENT-INDEX BUCKET THE SEED'S OUTPUTS DRAW CANDIDATES FROM (#1342): `key` is the raw `eventKey` (what `events/` shards are keyed by),
 *  `facts` what the seed's abilities that emit it do (kind, how often, size), for pre-ranking members by `pf` closeness. `swapped` marks the
 *  drain counterpart (lose-life <-> non-combat-damage), which `compareCards` reads as the `outcome` tier. */
export interface SeedBucket { key: string; facts: { kind: FactKind; repeats: Ability["repeats"]; amount: Amount }[]; swapped: boolean }
/** The seed's gate-eligible output buckets, exactly the keys `similarIndex` buckets a seed by (`never` skipped, `alone` only with no strong output).
 *  Outputs that are not an event key (`@self`, `effect:`, the named-self search) have no bucket. */
export function seedBuckets(seed: SimilarCard, opts: { drainIsDamage?: boolean } = {}): SeedBucket[] {
  const sig = sigOf(seed);
  const out = new Map<string, SeedBucket>();
  const rawOf = (k: string): string => {
    let r = k.replace(/~cost$/, "").replace(/@(?:you|other)$/, "");
    if (r.startsWith("counter-added|")) r = r.replace(/^((?:[^|]*\|){3}[^|:]*):.*$/, "$1");
    return r;
  };
  for (const x of sig.abilities) {
    for (const o of x.outputs) {
      const g = gateOfKey(o.key);
      if (g === "never" || (g === "alone" && sig.strong > 0)) continue;
      if (o.key.endsWith("@self") || o.key.startsWith(EFFECT_PREFIX) || o.key === "search@named-self") continue;
      const fact = { kind: x.kind, repeats: x.repeats, amount: x.amount };
      const add = (key: string, swapped: boolean): void => {
        const b = out.get(key) ?? { key, facts: [], swapped };
        b.facts.push(fact);
        out.set(key, b);
      };
      add(rawOf(o.key), false);
      if (opts.drainIsDamage) { const sw = drainSwapKey(o.key); if (sw !== null) add(rawOf(sw), true); }
    }
  }
  return [...out.values()];
}

/** A CHIP EVERY ROW CARRIES SAYS NOTHING about any one row (Heliod: "lacks 2 other effects" on all 13): it describes the
 *  seed, not the difference. Dropped from the final list, only when there are at least 3 rows to be universal across. */
function dropUniversalChips<T extends { chips: Chip[] }>(rows: T[]): T[] {
  if (rows.length < 3) return rows;
  const key = (c: Chip): string => `${c.dim}:${c.label}`;
  // ONLY `extra`/`missing`: they describe the SEED (it has more abilities than every candidate). A trigger, amount or type chip
  // on every row is the whole difference of that list ("your creatures" on every close row) and must stay.
  const everywhere = rows[0]!.chips.filter((c) => c.dim === "extra" || c.dim === "missing").map(key).filter((k) => rows.every((r) => r.chips.some((c) => key(c) === k)));
  if (everywhere.length === 0) return rows;
  return rows.map((r) => ({ ...r, chips: r.chips.filter((c) => !everywhere.includes(key(c))) }));
}

/** NEVER `outcome`: that tier is deck-context only (#1342), so a card page's index cannot produce it. */
const TIER_NAMES: readonly SimilarTier[] = ["same", "close", "output"];

export interface SimilarOptions {
  /** Maximum hits; default 24. Ignored when `perTier` is given. */
  limit?: number;
  /** A CAP PER TIER instead of one cap, so a tier the page must show is never crowded out by a bigger one above it
   *  (Soul Warden's 24 `same`/`close` rows left no room for Blood Artist's `output`). A tier not named gets 0. */
  perTier?: Partial<Record<SimilarTier, number>>;
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
      const g = gateOfKey(k);
      if (g === "never" || (g === "alone" && sigs[i]!.strong > 0)) continue;
      const b = buckets.get(k);
      if (b) b.push(i); else buckets.set(k, [i]);
    }
  });
  return {
    similarTo(seedId: number, opts: SimilarOptions = {}): SimilarHit[] {
      const si = at.get(seedId);
      if (si === undefined) return [];
      const limit = opts.limit ?? 24;
      const capOf = (tier: SimilarTier): number => (opts.perTier ? opts.perTier[tier] ?? 0 : limit);
      if (opts.perTier ? TIER_NAMES.every((t) => capOf(t) <= 0) : limit <= 0) return [];
      const seed = cards[si]!;
      const allowed = opts.identityWithin ? new Set(opts.identityWithin) : null;
      const seen = new Set<number>([si]);
      const tops: Record<SimilarTier, { ci: number; tier: SimilarTier; score: number; name: string; r: Ranked }[]> = { same: [], close: [], output: [], outcome: [] };
      for (const k of sigs[si]!.outputs.keys()) {
        const g = gateOfKey(k);
        if (g === "never" || (g === "alone" && sigs[si]!.strong > 0)) continue;
        for (const ci of buckets.get(k) ?? []) {
          if (seen.has(ci)) continue;
          seen.add(ci);
          const cand = cards[ci]!;
          if (cand.name === seed.name) continue;
          if (allowed && !sigs[ci]!.identity.every((c) => allowed.has(c))) continue;
          const r = rank(sigs[si]!, sigs[ci]!);
          if (!r) continue;
          const item = { ci, tier: r.tier, score: r.score, name: cand.name, r };
          const cap = capOf(r.tier);
          if (cap <= 0) continue;
          // `item.tier` is `r.tier`; each tier keeps its own bounded list.
          const top = opts.perTier ? tops[r.tier] : tops.same;
          if (top.length >= cap && order(item, top[top.length - 1]!) >= 0) continue;
          let at2 = top.length;
          while (at2 > 0 && order(item, top[at2 - 1]!) < 0) at2--;
          top.splice(at2, 0, item);
          if (top.length > cap) top.pop();
        }
      }
      const rows = [...tops.same, ...tops.close, ...tops.output].map((t) => ({ id: cards[t.ci]!.id, name: t.name, tier: t.tier, score: t.score, chips: chipsOf(sigs[si]!, sigs[t.ci]!, t.r) }));
      return dropUniversalChips(rows);
    },
  };
}
