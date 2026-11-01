/** CR 614 multipliers: a replacement effect MODIFIES occurrences of an event and is not a source of
 *  it. Read from the clause text, because the clause layer records the verb the sentence uses and
 *  nothing about the "would ... instead" frame around it — so Hardened Scales answered `add-counter`
 *  and advertised a counter it never places, Bruvac answered `mill`, Academy Manufactor `create`.
 *  Measured over the clause corpus: 12 of the 16 cards carrying one of these templates emitted the
 *  event they only modify.
 *
 *  The shape is the one `prompt.ts` already documents for Tekuthal and `derive.ts:30` already
 *  refuses an emit for: a CONSUMER whose trigger is the replaced event, with no emit of its own.
 *  `effect-class.ts` calls the same family REPLACEMENT, and the Fable review's §4 rubric rules that
 *  a modifier over another card's event is a consumer edge, with the multiplier's magnitude left to
 *  scoring. This module is that rubric, applied to the templates the corpus actually prints.
 *
 *  ANCHORED ON "instead", the word CR 614 hangs on. Without it, Angel of Suffering's "prevent that
 *  damage and mill twice that many cards" reads as a modified mill when it is a prevention plus a
 *  real mill it really performs.
 *
 *  THE SUBJECT IS THE ONE THE PRODUCER'S EMIT WILL CARRY, which is the action's OBJECT and never its
 *  actor (`actionEmits` parses `action.object`). So the phrase captured here is the RECEIVING half of
 *  each sentence: the permanent the counters go on, the token created. Where the sentence has no
 *  comparable half at all (mill names cards, proliferate names nothing) the subject is left EMPTY,
 *  which is a wildcard: for a multiplier that is the right reading, since it doubles every such
 *  event in the deck.
 *
 *  DAMAGE IS THE EXCEPTION, AND IT IS THE DEALER (recall v4 #120, 2026-09-09). A damage emit carries
 *  BOTH participants since 2026-08-27 -- `subject` is the victim and `GameEvent.dealer` the source --
 *  and `eventMatches` compares a damage trigger against the DEALER, because every damage trigger
 *  names its source ("whenever a source you control deals damage"). This module was written before
 *  that field existed and captured the victim, so Fiery Emancipation's trigger read `permanent` and
 *  Khalni Ambush's fight -- dealer `{control: you}`, no type -- could never satisfy it. The source
 *  phrase before "would" is now the half the matcher checks, so it is the subject. */
import type { DamageChange, EffectKind, ReplacementChange, TokenMultiplier, Verb } from "../schema.js";

export interface Replacement {
  /** The event this modifies — what a consumer trigger fires on. */
  verbs: Verb[];
  kind: EffectKind;
  /** The subject phrase as printed, for `parseSubject` to read. */
  subjectText: string;
  /** Counter kind, when the template names one. */
  counter?: string;
  /** The sentence restricts WHICH source the multiplier applies to, and the restriction is on a half
   *  no emit records. Label only: the kind is still true and the product classifiers want it, but no
   *  consumer trigger is synthesized, because the edge would claim more than the card says.
   *
   *  Bruvac doubles only what an OPPONENT mills, so your own self-mill is not it, and a mill emit's
   *  subject is the cards, never the miller -- a claim the engine cannot check is the wrong-answer
   *  direction this repo refuses. DAMAGE IS NO LONGER HERE: Gratuitous Violence's "a creature you
   *  control" is the dealer, the emit records the dealer, and `subjectMatches` refuses a burn spell's
   *  typeless dealer against a `creature` demand on its own. */
  restricted?: true;
  /** Token replacements only: how the tokens change. See `Effect.tokenMultiplier`. */
  tokenMultiplier?: TokenMultiplier;
  /** What the replacement does to the event's number, when the sentence states one. See
   *  `Ability.change`. */
  change?: ReplacementChange;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

/** HOW A REPLACEMENT CHANGES THE EVENT'S NUMBER (owner, 2026-10-24: "fix the derive so it can catch
 *  the amount on replacement effects"), read from the clause the template already matched.
 *
 *  Multiplying first: "triple" / "three times" / "thrice" is x3, "double" / "twice" x2 (Fiery
 *  Emancipation, Anointed Procession, Tekuthal's "proliferate twice"). Then adding: "plus 2", "plus
 *  one", and "plus an additional ..." as one more (Pyromancer's Gauntlet, Hardened Scales, Xorn).
 *
 *  ONLY A STATED NUMBER. "Plus that many Squirrels" adds a count that is itself variable, and
 *  "draw two cards instead" (Alhammarret's Archive) replaces one draw with two without naming a
 *  multiple of "that many"; both stay unset, which a consumer reads as "not on record".
 *  CEILING: "half that damage" (a prevention-side divide) is not read; nothing searches for it. */
export function changeOf(clauseText: string): ReplacementChange | undefined {
  if (/\b(?:triple|three times|thrice)\b/i.test(clauseText)) return { op: "times", value: 3 };
  if (/\b(?:double|twice)\b/i.test(clauseText)) return { op: "times", value: 2 };
  const plus = clauseText.match(/\bplus\s+(an?\s+additional|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i);
  if (!plus) return undefined;
  const word = plus[1]!.toLowerCase();
  const value = /^an?\s/.test(word) ? 1 : /^\d+$/.test(word) ? Number(word) : NUMBER_WORDS[word];
  return value === undefined ? undefined : { op: "plus", value };
}

/** WHAT A DAMAGE MULTIPLIER DOES TO THE DAMAGE (#1345), read off the clause text. `changeOf` cannot say it: it
 *  is set only beside `replacement` and only for a stated number, so Collective Inferno's "Double all damage ...",
 *  an on-cast or an activated rider, and "plus X" carry none. Triples before doubles, then "plus".
 *  UNDEFINED means the clause does NOT multiply or add (#1456): an empty text, a reduction (Benevolent Unicorn "minus 1",
 *  Ghosts of the Innocent "half"), a fixed number ("deals 3 damage instead"), a redirect, a mill or counters. The caller refuses
 *  the `damage-multiplier` kind then (`isDamageMultiplication`), so burn demand never counts such a card.
 *  CEILING: a refused replacement gets no kind of its own (prevention, mill, counter placement): on a replacement a mill or
 *  counter-placement kind reads as a doubler to the templates and would mislead. The action stays in `unclaimed`.
 *  CEILING: a clause stating two different changes (Desperate Gambit's double, then prevention) reads the first. */
export function damageChangeOf(clauseText: string): DamageChange | undefined {
  if (clauseText.trim() === "") return undefined;
  if (/\b(?:minus|half)\b/i.test(clauseText)) return undefined;
  if (/\b(?:triple|three times|thrice)\b/i.test(clauseText)) return "thrice";
  if (/\b(?:double|twice)\b/i.test(clauseText)) return "twice";
  if (/\bplus\b/i.test(clauseText)) return "plus";
  return undefined;
}

/** True when a `damage-multiplier` read off this clause really multiplies or adds. An empty text carries no
 *  evidence either way, so it is not refused (the kind was read without the clause at hand). */
export function isDamageMultiplication(clauseText: string): boolean {
  return clauseText.trim() === "" || damageChangeOf(clauseText) !== undefined;
}

/** HOW A TOKEN REPLACEMENT CHANGES THE COUNT (#1136). Of the 34 corpus cards deriving `token-doubling`
 *  only 14 print "twice that many"; 11 ADD tokens ("plus an additional Treasure"), Academy Manufactor
 *  makes "one of each", Ojer Taq triples, and the rest (Divine Visitation, Draconic Visitor, Jinnie
 *  Fay, Fisher's Talent) keep the count and change WHICH token. Order matters: "those tokens plus
 *  that many Squirrels" (Chatterfang) holds "that many" and is an addition, not a replacement.
 *  CEILING: "create a Food token and a Treasure token" (Bilbo) is the only 'and' addition recognised. */
export function tokenMultiplierOf(text: string): TokenMultiplier {
  if (/\bthree times that many\b/i.test(text)) return "thrice";
  if (/\btwice that many\b/i.test(text)) return "twice";
  if (/\bone of each\b/i.test(text)) return "one-of-each";
  if (/\bplus\b|\badditional\b|\bin addition\b|\binstead create an? [^.]*?\btokens? and an? /i.test(text)) return "additional";
  return "replaced";
}

/** Each entry: what the sentence must say, and what it means. Order matters only in that the first
 *  match wins; the templates are disjoint on the corpus. */
const TEMPLATES: {
  re: RegExp; verbs: Verb[]; kind: EffectKind; subject: number; counter?: number;
  /** Capture group holding the half the engine CANNOT check — the player who mills. Anything
   *  narrower than "a source" or "you" sets `restricted`. Omitted where the sentence has no such
   *  half: a counter template's "would be put on X" is passive and names only the receiving
   *  permanent, which IS the half emits record; a damage template's source IS its subject. */
  actor?: number;
}[] = [
  // "If one or more +1/+1 counters would be put on a creature you control, ... instead."
  // The kind stays `counter-placement`: the closed EFFECT_KINDS list has no counter-doubling, and
  // inventing one costs a matcher change for a label nothing reads yet.
  // CEILING: reuses counter-placement; give it its own kind when a consumer needs to tell a
  // doubler from a placer.
  {
    // The KIND IS OPTIONAL: "if one or more counters would be put on ..." (Winding Constrictor, Pir) names none, meaning any kind, and then the ability carries no `counter`.
    // The receiving class runs to the end of the sentence and is cut at the comma that opens the replacement (`classOf`) ("a creature, Spacecraft, or Planet you control, twice that many ...", Loading Zone).
    re: /\bif (?:one or more|a|an) (?:([^.]{1,20}?) )?counters? would be (?:put|placed) on ([^.]+)/i,
    verbs: ["counter-added"], kind: "counter-placement", subject: 2, counter: 1,
  },
  // The ACTIVE frame of the same replacement: "If you would put one or more counters on a creature you control, put twice that many of each of those kinds of counters on that creature
  // instead" (Dr. Joseph M'Benga, Vorinclex), "If an effect would put one or more counters on a permanent you control, it puts twice that many ..." (Doubling Season). The actor is
  // the half the engine cannot check: an opponent's counters (Vorinclex's halving) make it `restricted`.
  // CEILING: the receiving class is the permanents or players the sentence names first; Lae'zel's "or on yourself" (a creature or planeswalker you control OR yourself) is read as the permanents alone, an under-claim.
  {
    re: /\bif (you|an effect|an opponent|a player|a source) would put (?:one or more|a|an) (?:([^.]{1,20}?) )?counters? on ([^.]+)/i,
    verbs: ["counter-added"], kind: "counter-placement", subject: 3, counter: 2, actor: 1,
  },
  // "If you would create one or more Treasure tokens, instead create ..."
  // ...and "If an effect would create ..." (Doubling Season, Parallel Lives, Anointed Procession, #858).
  // THE TOKEN PHRASE RUNS TO "token(s)", commas and all (#794): "a Clue, Food, or Treasure token"
  // (Academy Manufactor) was cut at its first comma and read as Clues alone. "under your control"
  // after it stays on the subject, as before.
  {
    re: /\bif\s+(?:you|a player|an opponent|one or more players|an effect|a spell or ability)\s+would create\s+([^.]*?\btokens?\b(?:\s+under\s+[^,.]+)?|[^,.]+)/i,
    verbs: ["create-token"], kind: "token-doubling", subject: 1,
  },
  // THE PASSIVE FRAME (#858): "If one or more artifact tokens would be created under your control,
  // those tokens plus an additional Thopter ... are created instead" (Stridehangar Automaton, 18
  // corpus cards). It derived a static `token-generation` whose emit never fires, and nothing heard
  // another card's token being made.
  {
    re: /\bif\s+((?:one or more|a|an)\s+[a-z0-9/ ,-]{0,40}?\btokens?)\s+would be created\b/i,
    verbs: ["create-token"], kind: "token-doubling", subject: 1,
  },
  // "If a creature you control would deal damage TO a permanent or player, it deals double that
  // damage instead." BOTH damage verbs: the printed word is "damage", which covers combat and
  // noncombat alike, and the engine spells them separately. The capture is the SOURCE before
  // "would" -- the dealer, per the damage exception above; the victim after "to" is not compared.
  {
    re: /\bif\s+([^.]{0,60}?)\s+would deal\b[^.]{0,40}?\bdamage to\b/i,
    verbs: ["combat-damage", "non-combat-damage"], kind: "damage-multiplier", subject: 1,
  },
  // "If an opponent would mill one or more cards, they mill twice that many cards instead." A mill
  // emit's subject is the CARDS milled, which the sentence names only as a count, so no subject.
  {
    re: /\bif\s+([^.]{0,40}?)\s+would mill\b/i,
    verbs: ["mill"], kind: "mill", subject: 0, actor: 1,
  },
  // "If you would draw a card except the first one you draw in each of your draw steps, draw two
  // cards instead" (Alhammarret's Archive, #717): a payoff for every draw you make, not a draw of
  // its own. The subject is the DRAWER. CEILING: the first-draw exception is not modelled.
  {
    // THE DOUBLED DRAW IS REQUIRED (42 corpus cards say "if you would draw a card ... instead", and
    // only ~8 double it): dredge, Laboratory Maniac, Underrealm Lich and Abundance REPLACE a draw
    // with something else and are no draw payoff.
    re: /\bif\s+(you)\s+would draw (?:a card|one or more cards)\b[^.]{0,80}?\b(?:draw (?:two|three) cards|draw that many cards plus one|you draw two cards)\b/i,
    verbs: ["draw"], kind: "draw-card", subject: 1,
  },
  // Tekuthal, the worked example in the normalize prompt itself.
  {
    re: /\bif you would proliferate\b/i,
    verbs: ["proliferate"], kind: "trigger-doubling", subject: 0,
  },
];

/** "a source", "a source you control", "you" — the whole of what your deck can do. Anything else
 *  ("an opponent") narrows the multiplier to a subset the emit cannot identify. */
const UNRESTRICTED_ACTOR = /^(?:a source(?: you control)?|you|any source|an effect)$/i;

/** The receiving class of a counter replacement, cut at the comma that opens what happens to the counters ("a creature, Spacecraft, or Planet you control, twice that many ..."). By search, not a lazy regex (CodeQL polynomial-redos). */
function classOf(rest: string): string {
  const at = rest.search(/, (?:that many|twice|three times|put |it puts|they put|you get|those counters|each of)/);
  return at >= 0 ? rest.slice(0, at) : rest;
}

export function replacementOf(clauseText: string): Replacement | null {
  if (!/\binstead\b/i.test(clauseText)) return null;
  for (const t of TEMPLATES) {
    const m = clauseText.match(t.re);
    if (!m) continue;
    // A TEMPORARY counter replacement ("Whenever ~ becomes tapped, until end of turn, if one or more counters would be put on ...", Brad Boimler) holds only after its trigger, and the
    // derive drops that trigger; read as a standing replacement it would multiply every counter the deck places. Left to the old reading.
    // CEILING: only the counter templates are guarded; no other temporary frame is in the corpus on a replacement template.
    if (t.kind === "counter-placement" && /\buntil (?:end of turn|your next turn)\b/i.test(clauseText.slice(0, m.index))) continue;
    const actor = t.actor !== undefined ? (m[t.actor] ?? "").trim() : "";
    return {
      verbs: t.verbs,
      kind: t.kind,
      subjectText: (t.subject === 0 ? "" : t.kind === "counter-placement" ? classOf(m[t.subject] ?? "") : m[t.subject] ?? "").trim(),
      ...(t.kind === "token-doubling" ? { tokenMultiplier: tokenMultiplierOf(clauseText) } : {}),
      ...(() => { const change = changeOf(clauseText); return change ? { change } : {}; })(),
      ...(t.counter !== undefined && m[t.counter] ? { counter: m[t.counter].trim() } : {}),
      ...(t.actor !== undefined && !UNRESTRICTED_ACTOR.test(actor) ? { restricted: true as const } : {}),
    };
  }
  return null;
}
