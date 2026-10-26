/** CR 603.4's INTERVENING IF: "Whenever X, **if Y**, do Z." The condition is checked when the
 *  ability would trigger and again on resolution, so it constrains the event INSTANCE — not the
 *  subject class, which is what `SubjectFilter` records, and not the effect.
 *
 *  The engine has no slot for it. `trigger.threshold` holds the numeric `{atLeast}` subset and
 *  everything else is dropped silently, so a trigger derives WIDER than printed: Yuna, Grand
 *  Summoner's "whenever another permanent you control is put into a graveyard from the battlefield,
 *  IF IT HAD ONE OR MORE COUNTERS ON IT" derives as a bare sacrifice watcher. Her three producers in
 *  her own deck are all Sagas and all correct — because a Saga always has lore counters when it dies
 *  — so the engine is right BY COINCIDENCE, and the first counterless sacrifice outlet in that deck
 *  turns those claims false with nothing watching.
 *
 *  This module is the instrument, not the fix: `bin/intervening-if-audit.ts` counts what is
 *  unrepresented and `intervening-if-ratchet.test.ts` stops the count growing.
 *  → `specs/2026-08-15-fable-gap-review.md` §3.1 */

/** A trigger sentence, so a bare "if" inside an effect body is not mistaken for one. */
const TRIGGER_OPENER = /^\s*(?:whenever|when|at the beginning of|at end of)\b/i;

/** The condition itself: a comma, then "if", then everything up to the next comma that ends it.
 *  Anchored on the COMMA on both sides because that is what CR 603.4's template prints. */
const CONDITION = /,\s*if\s+([^,.]+)/i;

/** "If" that is not a condition on the trigger.
 *   - "if you do" / "if you don't" — the follow-up to an optional cost inside the effect.
 *   - "if able" — a rules qualifier on an instruction.
 *   - "if it would" — a replacement clause (CR 614), which `replacement.ts` owns.
 *   - "if that spell" / "if this creature" — a rider on the effect, not on the event. */
const NOT_A_CONDITION = /^(?:you (?:do|don't|didn't|can't)|able|it would|they do)\b/i;

/** The condition phrase of a trigger's intervening if, or null. Reads ONE sentence: pass the clause
 *  text, which `segment()` has already split. */
export function interveningIfOf(text: string): string | null {
  if (!TRIGGER_OPENER.test(text)) return null;
  const m = text.match(CONDITION);
  if (!m) return null;
  const cond = m[1].trim();
  return NOT_A_CONDITION.test(cond) ? null : cond;
}

/** The families the corpus prints, so the audit can say WHICH conditions a slot would have to
 *  express rather than reporting one undifferentiated pile. `other` is honest: an unlabelled
 *  condition is one nobody has looked at yet. */
export type ConditionFamily = "counter-presence" | "cast-entry" | "was-a-type" | "zone-or-state"
  | "count-threshold" | "life" | "control" | "turn-timing" | "other";

const FAMILIES: { family: ConditionFamily; re: RegExp }[] = [
  { family: "counter-presence", re: /\bcounters?\b/i },
  // "if you cast it" — the entry was a CAST, not a token, a reanimation or a blink. The engine
  // already spells the distinction on the producer side (`impliedEvents` pushes a `cast` for every
  // nonland card), so this family is the one most likely to be cheap.
  { family: "cast-entry", re: /\byou cast (?:it|this|that)\b/i },
  // "if it was a creature" — the Enduring cycle, a condition on what the object WAS in a zone it has
  // already left. Not expressible by any subject filter, which describes what a card IS.
  { family: "was-a-type", re: /\bit was an? \b/i },
  { family: "count-threshold", re: /\b(?:one or more|two or more|three or more|\d+ or (?:more|greater|fewer|less)|at least)\b/i },
  { family: "life", re: /\blife\b/i },
  { family: "turn-timing", re: /\b(?:your turn|this turn|first|second|during)\b/i },
  { family: "control", re: /\b(?:you control|an opponent controls|control (?:no|a|an))\b/i },
  { family: "zone-or-state", re: /\b(?:in your graveyard|on the battlefield|in exile|in your hand|tapped|untapped|face)\b/i },
];

export function conditionFamily(condition: string): ConditionFamily {
  return classifyCondition(condition, { threshold: false, selfDiesOnCreatureCard: false }).family;
}

// ---- WHAT DERIVE REPRESENTS (#1268 F6) ----------------------------------------------------------
// One classifier: the audit ratchet reads `.family`, derive reads `.represented`; `conditionTestsObject` reads the whole clause.

export /** "leave the battlefield WITHOUT DYING" (Dour Port-Mage), "if it didn't die" (Taeko): a `leaves`
 *  demand that refuses a death. 5 corpus cards. */
const WITHOUT_DYING = /\bwithout dying\b|\bdidn'?t die\b|\bdoesn'?t die\b/i;

/** "if none of them were cast", "if it wasn't cast", "no mana was spent to cast", "without being
 *  played", "if you didn't cast it from your hand" (Chainer, Nightmare Adept; Phage the Untouchable) — the
 *  entry happened by some route other than casting. CEILING: the last cue also holds for a cast from
 *  another zone (a flashback from the graveyard), which `notCast` refuses as a cast; only the hand
 *  is the implied cast, so the miss is a creature cast from the graveyard entering. Card-scoped like
 *  every other printed cue here. */
export const ARRIVED_WITHOUT_CASTING =
  /\b(?:wasn't|weren't) cast\b|\bnone of them were cast\b|\bno mana was spent\b|\bwithout being played\b|\byou didn't cast (?:it|them) from your hand\b/i;

/** WHERE THE SOURCE IS, not which event: Inalla's eminence "if Inalla is in the command zone or on the
 *  battlefield", "if this card is in your graveyard". The ability only exists where it functions, so
 *  the condition narrows no event a producer supplies. */
const SOURCE_ZONE = /^(?:~|this \w+|it) is (?:in|on) (?:the command zone|the battlefield|your graveyard|exile|your hand)(?: or (?:in|on) (?:the command zone|the battlefield|your graveyard|exile|your hand))?$/i;

/** Guardian Project's "if it doesn't have the same name as another creature you control or a creature
 *  card in your graveyard": `uniqueName` (CR 903.5b; owner, 2026-10-01). */
export const SAME_NAME = /^it doesn't have the same name as /i;

/** The Enduring cycle's "When ~ dies, if it was a creature, return it ... It's an enchantment" (#1250): the card is a creature
 *  card, so it dies as one and the condition narrows nothing a producer supplies. Admitted ONLY for a self `dies` trigger on a
 *  card whose printed type line includes Creature; Weatherseed Totem (an Artifact that is a creature only once animated) keeps
 *  the refusal, its if is not vacuous (CR 603.4). CEILING: reads the printed type line; a creature card that stops being a
 *  creature before it dies (Enduring Curiosity after it returns as an enchantment) is not modelled. */
const WAS_A_CREATURE = /^(?:it was|they were) an? creature$/i;

/** AN `if:` THAT TESTS THE TRIGGER'S OBJECT, not the turn or a count: "if it was enchanted or equipped" (Koll),
 *  "if it was cast" (Mirror of Life Trapping), "if it was attacking or blocking alone" (Thijarian Witness),
 *  "if it's exiled" (Alaundo). A predicate outside this list ("if it's not their turn", "if it's the first
 *  time that creature has become tapped this turn") is a timing or a count and keeps the class. */
const TESTS_THE_OBJECT = /\bif (?:it|that (?:creature|card|permanent|land)|those cards|they)(?:['\u2019]s| (?:was|is|were|are|had|has))(?: not| n['\u2019]t)? (?:an? |the )?(?:enchanted|equipped|cast|attacking|blocking|tapped|untapped|exiled|legendary|nontoken|token|face[- ]down|modified|historic|multicolored|colorless|creature|artifact|land|permanent)\b/i;

const FIRST_SPELL = /\bthe first \w+ spell\b/i;

/** Does the clause carry an `if` that tests the trigger's OBJECT (not the turn or a count)? */
export function conditionTestsObject(text: string): boolean {
  return TESTS_THE_OBJECT.test(text);
}

export interface ConditionContext {
  /** `thresholdFor(text) !== undefined`: derive holds a count for this clause. */
  threshold: boolean;
  /** A self `dies` trigger on a card whose printed type line includes Creature (see WAS_A_CREATURE). */
  selfDiesOnCreatureCard: boolean;
}
export interface ConditionClass {
  family: ConditionFamily;
  /** Derive represents the condition (a count, an entry that was no cast, the first spell, a source zone, ...), so the trigger may claim. */
  represented: boolean;
}

/** THE ONE CLASSIFIER OF AN INTERVENING IF: its audit family and whether derive represents it. */
export function classifyCondition(condition: string, context: ConditionContext): ConditionClass {
  const represented = context.threshold || SAME_NAME.test(condition) || ARRIVED_WITHOUT_CASTING.test(condition) || WITHOUT_DYING.test(condition)
    || FIRST_SPELL.test(condition) || SOURCE_ZONE.test(condition)
    || (context.selfDiesOnCreatureCard && WAS_A_CREATURE.test(condition));
  return { family: FAMILIES.find((f) => f.re.test(condition))?.family ?? "other", represented };
}

/** THE DEMAND A CONDITION MAKES ON THE DECK, as ordinary `cares` tags.
 *
 *  Owner's framing, 2026-08-20: an intervening if forms no edge, but it still says what the card
 *  NEEDS around it — "Yuna should score more in a counters deck", Warlock Class is an aristocrats
 *  payoff, Alesha cares about attacking. The condition is a CONSUMING side even when no single
 *  producer satisfies it, and `cardCaresTags` is exactly the channel: it feeds `rankFreq` at full
 *  weight, then the axis, then `axisWeight` and the rating.
 *
 *  **A CLOSED MAP, NOT AN EVALUATOR.** The 2026-08-15 refusal stands — the corpus prints 241 distinct
 *  conditions and a slot general enough to EVALUATE them is a second rules engine. This does not
 *  evaluate anything: it recognises four printed shapes and emits a tag the theme layer already
 *  speaks. Everything else returns nothing, which is the honest answer for "it was kicked".
 *
 *  DELIBERATELY OMITTED: `control` and most `life` conditions ("you control a red permanent", "the
 *  player with the most life"). The life YOU GAINED is the exception, since 2026-09-29: lifegain
 *  cards supply it. They are real DECK-FIT facts — Oath of Liliana in a deck with no
 *  planeswalkers is a bad card, measured at 1 of 33 such slots across the 71 decks — but a colour or
 *  a player's life total is not a theme any card supplies, so a cares tag would be a category error.
 *  That belongs on the cut list, not the axis. Also omitted: `cast-entry` ("if you cast it"), which
 *  narrows the EVENT rather than naming a deck demand. */
const GAINED_LIFE = /\byou(?:'ve| have)? gained\b[^,.]{0,30}\blife\b|\blife more than your starting life total\b|\byou have \d+ or more life\b/i;
const CAST_NONCREATURE = /\byou(?:'ve| have)? cast\b[^,.]{0,30}\bnoncreature spells?\b/i;
const CAST_INSTANT_SORCERY = /\byou(?:'ve| have)? cast\b[^,.]{0,30}\binstant (?:or|and\/or) sorcery spells?\b/i;
export function conditionCares(condition: string): string[] {
  const out: string[] = [];
  // "if it had one or more counters on it" (Yuna, Iron Apprentice), "if The Ozolith has counters on
  // it". The kind is not read: a subject key of `any` is what the counter theme already uses, and
  // guessing "+1/+1" would claim more than the text says.
  if (/\bcounters?\b/i.test(condition)) out.push("counter-added:any");
  // "if a creature died this turn" (Warlock Class) — the aristocrats demand.
  if (/\b(?:a|another|one or more) creatures? (?:died|has died|have died)\b/i.test(condition)) out.push("dies:creature");
  // "if you attacked this turn" (Alesha) — the aggro demand. `creature`, not `any`: only creatures attack
  // (CR 508.1a), so the untyped key named one event twice (#1088).
  if (/\byou(?:'ve)? attacked\b|\byou have attacked\b/i.test(condition)) out.push("attacks:creature");
  // "if a planeswalker entered the battlefield under your control this turn" (Oath of Liliana,
  // Oath of Chandra).
  const entered = condition.match(/\ban? (planeswalker|creature|artifact|enchantment|land) entered\b/i);
  if (entered) out.push(`enters:${entered[1].toLowerCase()}`);
  // "if you descended this turn" (Brass's Tunnel-Grinder; 12 commander-legal cards print the
  // word). CR 700.11: a permanent card was put into your graveyard FROM ANYWHERE this turn -- so
  // the demand is every fill family, one tag each: a death or sacrifice from the battlefield
  // (`dies`), a mill from the library, a discard from the hand, and `enters-graveyard` for the
  // rest. All four are tags the theme layer already speaks (corpus supply 452 / 595 / 1,534 /
  // 226). Recall v5 #179, Scalding Tarn -> Tunnel-Grinder, 2026-09-10: a DEMAND, not an edge --
  // an intervening if forms none (owner, 2026-08-20), so that pair stays refused by design.
  // "Descend 4" / "descend 8" cards word their condition as "N or more permanent cards in your
  // graveyard" and never say "descended"; they are a count-threshold, not covered here.
  if (/\bdescended\b/i.test(condition)) out.push("dies:permanent", "mill:any", "discard:any", "enters-graveyard:any");
  // THE LIFE YOU GAINED IS SUPPLIED (owner, 2026-09-29: Resplendent Angel, in the Hatsune Miku
  // precon, never appeared among token makers that care about lifegain). "If you gained 5 or more
  // life this turn", "if you have at least 7 life more than your starting life total", "if you have
  // 40 or more life" -- every lifegain card feeds these. "The player with the most life" stays out:
  // no card supplies it.
  if (GAINED_LIFE.test(condition)) out.push("gain-life:any");
  // "if you've cast a noncreature spell this turn", "if you cast two or more instant and/or sorcery
  // spells this turn" -- the spellslinger demand the same ruling names.
  if (CAST_NONCREATURE.test(condition)) out.push("cast:-creature");
  if (CAST_INSTANT_SORCERY.test(condition)) out.push("cast:instant", "cast:sorcery");
  return [...new Set(out)];
}

/** THE CONDITION OF AN ACTIVATION RESTRICTION: "Activate only if you've cast a noncreature spell this turn" (Doctor Strange),
 *  "Activate only as a sorcery and only if ...", "Activate this ability only if ...". CR 602.5 makes it a restriction on
 *  the activated ability; like an intervening if it names a deck demand, so it feeds the same `conditionCares`. Null when the
 *  text prints none. Reads one sentence at a time: the "only if" must sit in a sentence that opens "Activate". */
export function activationConditionOf(text: string): string | null {
  for (const sentence of text.split(/(?<=\.)\s+/)) {
    if (!/^activate\b/i.test(sentence.trim())) continue;
    const m = /\bonly if ([^.]+)/i.exec(sentence);
    if (m) return m[1]!.trim();
  }
  return null;
}
