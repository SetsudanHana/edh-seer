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
 *  each sentence: the permanent the counters go on, the token created, the thing damage is dealt TO.
 *  Capturing "a creature you control would deal damage" instead would compare a damage SOURCE against
 *  an emit describing its VICTIM — two different objects, and no edge would ever form. Where the
 *  sentence has no comparable half at all (mill names cards, proliferate names nothing) the subject
 *  is left EMPTY, which is a wildcard: for a multiplier that is the right reading, since it doubles
 *  every such event in the deck. */
import type { EffectKind, Verb } from "../schema.js";

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
   *  Gratuitous Violence doubles damage from A CREATURE YOU CONTROL, so a burn spell is not doubled;
   *  Uncivil Unrest narrows further to creatures with a +1/+1 counter; Bruvac doubles only what an
   *  OPPONENT mills, so your own self-mill is not it. A damage or mill emit's subject is the victim
   *  or the cards, never the dealer, so the engine cannot check the restriction — and a claim it
   *  cannot check is the wrong-answer direction this repo refuses. */
  restricted?: true;
}

/** Each entry: what the sentence must say, and what it means. Order matters only in that the first
 *  match wins; the templates are disjoint on the corpus. */
const TEMPLATES: {
  re: RegExp; verbs: Verb[]; kind: EffectKind; subject: number; counter?: number;
  /** Capture group holding the half the engine CANNOT check — the source that deals or the player
   *  who mills. Anything narrower than "a source" or "you" sets `restricted`. Omitted where the
   *  sentence has no such half: a counter template's "would be put on X" is passive and names only
   *  the receiving permanent, which IS the half emits record. */
  actor?: number;
}[] = [
  // "If one or more +1/+1 counters would be put on a creature you control, ... instead."
  // The kind stays `counter-placement`: the closed EFFECT_KINDS list has no counter-doubling, and
  // inventing one costs a matcher change for a label nothing reads yet.
  // ponytail: reuses counter-placement; give it its own kind when a consumer needs to tell a
  // doubler from a placer.
  {
    re: /\bif\s+(?:one or more|a|an)\s+([^.]{0,20}?)\s+counters?\s+would be (?:put|placed)\s+on\s+([^,.]+)/i,
    verbs: ["counter-added"], kind: "counter-placement", subject: 2, counter: 1,
  },
  // "If you would create one or more Treasure tokens, instead create ..."
  {
    re: /\bif\s+(?:you|a player|an opponent|one or more players)\s+would create\s+([^,.]+)/i,
    verbs: ["create-token"], kind: "token-doubling", subject: 1,
  },
  // "If a creature you control would deal damage TO a permanent or player, it deals double that
  // damage instead." BOTH damage verbs: the printed word is "damage", which covers combat and
  // noncombat alike, and the engine spells them separately. The capture is what damage is dealt TO,
  // per the subject rule above — the source phrase before "would" names the actor, which no emit
  // records.
  {
    re: /\bif\s+([^.]{0,60}?)\s+would deal\b[^.]{0,40}?\bdamage to\s+([^,.]+)/i,
    verbs: ["combat-damage", "non-combat-damage"], kind: "damage-multiplier", subject: 2, actor: 1,
  },
  // "If an opponent would mill one or more cards, they mill twice that many cards instead." A mill
  // emit's subject is the CARDS milled, which the sentence names only as a count, so no subject.
  {
    re: /\bif\s+([^.]{0,40}?)\s+would mill\b/i,
    verbs: ["mill"], kind: "top-manipulation", subject: 0, actor: 1,
  },
  // Tekuthal, the worked example in the normalize prompt itself.
  {
    re: /\bif you would proliferate\b/i,
    verbs: ["proliferate"], kind: "trigger-doubling", subject: 0,
  },
];

/** "a source", "a source you control", "you" — the whole of what your deck can do. Anything else
 *  ("a creature you control", "an opponent", "a creature you control with a +1/+1 counter on it")
 *  narrows the multiplier to a subset the emit cannot identify. */
const UNRESTRICTED_ACTOR = /^(?:a source(?: you control)?|you|any source)$/i;

export function replacementOf(clauseText: string): Replacement | null {
  if (!/\binstead\b/i.test(clauseText)) return null;
  for (const t of TEMPLATES) {
    const m = clauseText.match(t.re);
    if (!m) continue;
    const actor = t.actor !== undefined ? (m[t.actor] ?? "").trim() : "";
    return {
      verbs: t.verbs,
      kind: t.kind,
      subjectText: (t.subject === 0 ? "" : m[t.subject] ?? "").trim(),
      ...(t.counter !== undefined && m[t.counter] ? { counter: m[t.counter].trim() } : {}),
      ...(t.actor !== undefined && !UNRESTRICTED_ACTOR.test(actor) ? { restricted: true as const } : {}),
    };
  }
  return null;
}
