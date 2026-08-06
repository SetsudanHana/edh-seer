/** Canonical clauses to the Ability[] the engine already consumes. Pure: no model, no database.
 *
 *  One Ability per ACTION rather than per clause, because effect.kind is singular and a drain has
 *  to register on both the lifeloss and the lifegain axis. An action that yields neither a kind nor
 *  an emit is returned in `unclaimed` instead of vanishing -- a dropped clause that produces
 *  silence is indistinguishable from a card that does nothing, which is exactly how Bitterblossom
 *  sat in the corpus as a vanilla bear. */
import type { Action, ClauseRecord } from "../canonicalize.js";
import type { Ability, AbilityKind, CardTags, Characteristics, Control, Verb } from "../schema.js";
import { VERB_ALIASES, VERB_VOCAB } from "../schema.js";
import { ZONE_SCOPED_KINDS, actionEffectKind } from "./effect-kind.js";
import { actionEmits } from "./emits.js";
import { actionRecipients } from "./recipient.js";
import { parseSubject } from "./subject.js";
import { SUBTYPES } from "./subtypes.js";

/** Bump when derivation semantics change — a new effect kind, a changed emit, a new guard. Unlike
 *  NORMALIZE_VERSION this is FREE to bump: it only re-runs `derive-corpus`, which reads the stored
 *  clauses and calls no model. That asymmetry is the whole point of storing clauses separately. */
export const DERIVE_VERSION = 9;

/** Verbs that state no action at all; they are inert, not unclaimed. */
const INERT_VERBS = new Set(["none"]);

/** Proliferate is a keyword ACTION -- a discrete thing a player does -- so a STATIC clause naming
 *  it is modifying somebody else's proliferate, never performing one. Tekuthal ("if you would
 *  proliferate, proliferate twice instead") is the case: the segmenter's EFFECT_ACTIONS row already
 *  refuses the replacement templating, but the verb is in the clause vocabulary now and the model
 *  reaches for it anyway. Emitting the event here would make Tekuthal a proliferate SOURCE and mesh
 *  it with every proliferate payoff, which is the false-emit class of defect, not a missing edge. */
function keywordActionOnStaticClause(kind: AbilityKind, verb: string | undefined): boolean {
  return kind === "static" && verb === "proliferate";
}

/** segment.ts's clause-side vocabulary ("spell" | "activated" | "triggered" | "static") to the
 *  engine's AbilityKind. "spell" is the clause-side name for what the engine calls "on-cast" --
 *  every instant/sorcery clause is tagged "spell" (see segment.ts's `classify`), so mapping it to
 *  "static" instead makes every burn spell a static lord that matches every card in the deck via
 *  edges.ts's wildcard subjectMatches. Anything unrecognised defensively falls back to "static".
 */
const CLAUSE_TO_ABILITY_KIND: Record<string, AbilityKind> = {
  spell: "on-cast",
  activated: "activated",
  triggered: "triggered",
  static: "static",
  "on-cast": "on-cast",
};

function abilityKind(clause: ClauseRecord): AbilityKind {
  return CLAUSE_TO_ABILITY_KIND[clause.abilityType ?? ""] ?? "static";
}

/** VOCAB set for a fast legality check after alias normalization. */
const LEGAL_VERBS = new Set<string>(VERB_VOCAB);

/** normalize-prompt.ts's TRIGGERS vocabulary to the engine's Verb vocabulary. These are two
 *  independently closed sets, and where they name the same event they spell it differently: the
 *  clause side names the EVENT ("life-gained"), the engine side names the ACTION ("gain-life").
 *  Only exact identities belong here. `draw-step` was for a long time the clause vocabulary's only
 *  way to say "whenever you draw a card", and was mapped to `draw` — conflating the turn phase with
 *  the event, so a card triggering at the beginning of its draw step meshed with every draw payoff.
 *  `draw` became a TRIGGERS member in its own right once the persist gate refused Psychosis Crawler
 *  and Underworld Dreams for answering it (250 corpus cards carry such a trigger), and the bridge is
 *  now RETIRED: `draw-step` means the draw step and nothing consumes it.
 *  `damage-dealt`, `blocks`, `main-phase`, `chapter` and friends have no engine verb at all and
 *  are deliberately absent: they surface in `unknownTriggers` rather than pick a near-miss. */
const CLAUSE_TRIGGER_TO_VERB: Record<string, Verb> = {
  "life-gained": "gain-life",
  "life-lost": "lose-life",
  sacrificed: "sacrifice",
  discarded: "discard",
  milled: "mill",
};

/** Normalize a trigger event through VERB_ALIASES, then check it against the closed VERB_VOCAB.
 *  A near-miss spelling that survives uncorrected (e.g. "die" instead of "dies") means the trigger
 *  silently never matches any producer event -- dead with no error, since triggers have no
 *  `unclaimed`-style safety net of their own. Returns null for anything illegal so the caller can
 *  omit the trigger rather than assert a verb the vocabulary doesn't recognise. */
function normalizeTriggerVerb(event: string): Verb | null {
  const normalized = CLAUSE_TRIGGER_TO_VERB[event] ?? VERB_ALIASES[event] ?? event;
  return LEGAL_VERBS.has(normalized) ? (normalized as Verb) : null;
}

/** A clause that takes life from an opponent AND gives it to you is a drain, which is its own kind
 *  in the engine's vocabulary and what aristocrats payoffs match on. Added ALONGSIDE the per-action
 *  abilities, not instead of them, so the card still registers on the lifeloss and lifegain axes.
 *  Without this, Zulaport Cutthroat and Blood Artist lose the kind their live tags carry today. */
function drainAbility(clause: ClauseRecord, kind: AbilityKind, trigger: Ability["trigger"]): Ability | null {
  const actions = clause.actions ?? [];
  const loss = actions.find((a) => a.verb === "lose-life" && parseSubject(a.object ?? "").control !== "you");
  const gain = actions.find((a) => a.verb === "gain-life" && parseSubject(a.object ?? "").control === "you");
  if (!loss || !gain) return null;
  // Same wildcard-mesh guard as the per-action loop above: a static-typed drain clause with an
  // unconstrained subject would otherwise reproduce the whole-deck lord edge namesItsTargets exists
  // to prevent.
  const subject = parseSubject(loss.object ?? "");
  const keepSubject = kind !== "static" || namesItsTargets(subject);
  const ability: Ability = { kind, effect: keepSubject ? { kind: "drain", subject } : { kind: "drain" } };
  if (trigger) ability.trigger = trigger;
  return ability;
}

/** Does this TRIGGER subject name the card itself? "When THIS creature enters" watches one
 *  permanent -- its own -- while "whenever another creature you control enters" watches the deck,
 *  and `parseSubject` reduces both to {type: creature}. The clause text is the only place the
 *  difference survives, so it is recovered here.
 *
 *  A subject mentioning "another" or "other" is NOT self even when it opens with a self-reference:
 *  Zulaport Cutthroat's "this creature or another creature you control" is a real aristocrats
 *  payoff, and marking it self would delete the edge this engine most wants to find. */
function isSelfSubject(text: string, cardName?: string): boolean {
  const t = text.trim().toLowerCase();
  if (t === "") return false;
  if (/\banother\b|\bother\b/.test(t)) return false;
  // Bare "this" with no noun after it — how Bojuka Bog and Zhalfirin Void record their own entry.
  // Checked HERE rather than by widening SELF_REFERENCE, which effect subjects also use: a trigger
  // subject of "this" is unambiguous, while an effect object beginning "this turn ..." is not.
  if (/^this\b/.test(t)) return true;
  if (SELF_REFERENCE.test(t)) return true;
  if (!cardName) return false;
  const name = cardName.toLowerCase();
  // The model names the card either in full ("Urza, Lord High Artificer") or by the short name a
  // card's own text uses ("Urza"), which is everything before the first comma or face divider.
  if (t === name || t === name.split(/[,/]/)[0].trim()) return true;
  // A card with no comma in its name still shortens itself: Imskir Iron-Eater's own text says
  // "Imskir". Accept the FIRST WORD — but never when that word is a creature type, because
  // "whenever a Goblin enters" on a card named Goblin Bombardment is a real typal payoff and
  // marking it self would delete the edges a Goblin deck is made of.
  const first = name.split(/\s+/)[0];
  return t === first && !SUBTYPES.has(first);
}

/** The card talking about itself. Anchored at the start, because a self-reference anywhere else is
 *  part of a larger subject ("creatures other than this one"), and confined to the noun so the rest
 *  of the sentence cannot leak in. */
const SELF_REFERENCE =
  /^this (?:spell|card|creature|artifact|enchantment|permanent|land|planeswalker|equipment|vehicle|token)\b/i;

/** The effect's subject, with the origin zone restored for the kinds that are defined by it. The
 *  clause states the zone on the ACTION (`fromZone: "graveyard"`), never inside the object text, so
 *  `parseSubject` alone cannot recover it — and a graveyard-recursion whose subject has no zone is
 *  invisible to the reanimator edge in edges.ts, which tests `effect.subject.zone === "graveyard"`.
 */
function effectSubject(action: Action, kind: string): ReturnType<typeof parseSubject> {
  const object = action.object ?? "";
  // A self-referential effect applies to the card itself, and everything after the self-reference is
  // a CONDITION rather than a subject. Excalibur, Sword of Eden reads "This spell costs {X} less to
  // cast, where X is the total mana value of historic permanents you control": parsing the whole
  // string found permanents/spell/you-control, `namesItsTargets` passed on words the effect does not
  // apply to, and edges.ts fanned that one card out to 97 consumers -- the widest mesh in the
  // derived population. Parse only the self-reference, which names a bare singular and so keeps no
  // subject at all: the card holds its `static:cost-reduction` theme tag and forms no edges.
  const self = object.match(SELF_REFERENCE);
  const subject = parseSubject(self ? self[0] : object);
  if (ZONE_SCOPED_KINDS.has(kind) && action.fromZone) subject.zone = action.fromZone;
  return subject;
}

/** Does this subject name WHICH permanents it applies to? edges.ts turns a static ability's effect
 *  subject into an edge against the whole deck (`subjectMatches(otherCard.characteristics, subject)`),
 *  and every field a subject leaves unset is a wildcard — so a static subject with no type and no
 *  subtype matches EVERY card. Psychosis Crawler is the case: "its power and toughness are each
 *  equal to the number of cards in your hand" is a self-referential P/T definition, not an anthem,
 *  and it was deriving a `static:pump` lord over the entire deck. Same defect class as the
 *  `spell -> static` bug: an unconstrained static subject is a mesh, not a synergy.
 *
 *  Naming a type/subtype is not enough on its own: "enchanted creature" and "this creature" both
 *  name a type but pick out exactly one permanent, not the deck. `parseScope` already tells target
 *  singular apart from a mass effect ("creatures you control" -> scope "all"; a bare singular ->
 *  scope undefined), so require that too -- Animate Dead, All That Glitters and Storm-Kiln Artist
 *  ("this creature") were each meshing a single-target pump into an anthem over every creature. */
function namesItsTargets(subject: ReturnType<typeof parseSubject>): boolean {
  return (
    (subject.type !== undefined || subject.subtype !== undefined) &&
    (subject.scope === "all" || subject.scope === "each")
  );
}

/** The clause's own `control` field, which states whose permanents/players the trigger watches. The
 *  object text often does not repeat it ("whenever you cast a spell" normalizes to subject "a
 *  spell", control "you"), so reading only the text widened Consuming Aberration to every spell
 *  anyone casts. The clause vocabulary spells the opponent side "opponent"; the engine says "opp". */
const CLAUSE_CONTROL: Record<string, Control> = { you: "you", opponent: "opp", any: "any" };

export function deriveAbilities(
  clauses: ClauseRecord[],
  cardName?: string,
  clauseTexts?: Record<number, string>,
): { abilities: Ability[]; unclaimed: Action[]; unknownTriggers: string[] } {
  const abilities: Ability[] = [];
  const unclaimed: Action[] = [];
  const unknownTriggers: string[] = [];

  for (const clause of clauses) {
    const kind = abilityKind(clause);
    // Who performs each action, when the clause names someone the object text does not carry. The
    // cue localises the actor to a VERB, not to an action, so a clause with two actions of that verb
    // is ambiguous and is left alone -- a missing answer beats a wrong one.
    const actors = clauseTexts?.[clause.id] ? actionRecipients(clauseTexts[clause.id]) : {};
    const actorFor = (verb?: string): Control | undefined =>
      (clause.actions ?? []).filter((a) => a.verb === verb).length === 1 ? actors[verb ?? ""] : undefined;
    let trigger: { verbs: Verb[]; subject: ReturnType<typeof parseSubject> } | undefined;
    if (clause.trigger?.event) {
      const verb = normalizeTriggerVerb(clause.trigger.event);
      if (verb) {
        const subject = parseSubject(clause.trigger.subject ?? "");
        const control = CLAUSE_CONTROL[clause.trigger.control ?? ""];
        if (control) subject.control = control;
        if (isSelfSubject(clause.trigger.subject ?? "", cardName)) subject.self = true;
        trigger = { verbs: [verb], subject };
      } else {
        unknownTriggers.push(clause.trigger.event);
      }
    }

    for (const action of clause.actions ?? []) {
      if (INERT_VERBS.has(action.verb ?? "")) continue;
      if (keywordActionOnStaticClause(kind, action.verb)) { unclaimed.push(action); continue; }
      const effectKind = actionEffectKind(action);
      const emits = actionEmits(action);
      if (!effectKind && emits.length === 0) { unclaimed.push(action); continue; }

      // A subject is attached ONLY when there is a kind. matcher's edges.ts emits a
      // `static:${effect.kind}` tag for any static ability that has a subject, so an empty kind
      // with a subject produces a junk `static:` tag that can match another card's junk tag and
      // form an edge that is not real. A STATIC ability additionally has to name its targets --
      // see namesItsTargets -- or the very same edge forms against the whole deck.
      const subject = effectKind ? effectSubject(action, effectKind) : undefined;
      const actor = actorFor(action.verb);
      if (actor) {
        for (const e of emits) e.subject.control = actor;
        if (subject) subject.control = actor;
      }
      const keepSubject = subject && (kind !== "static" || namesItsTargets(subject));
      const ability: Ability = {
        kind,
        effect: effectKind
          ? keepSubject ? { kind: effectKind, subject } : { kind: effectKind }
          : { kind: "" },
      };
      if (trigger) ability.trigger = trigger;
      if (clause.abilityType === "activated") ability.cost = "";
      if (emits.length) ability.emits = emits;
      abilities.push(ability);
    }

    const drain = drainAbility(clause, kind, trigger);
    if (drain) abilities.push(drain);
  }
  return { abilities, unclaimed, unknownTriggers };
}

export interface DeriveInput {
  oracleId: string;
  /** The card's own name, so a trigger naming itself ("Urza, Lord High Artificer") is recognised
   *  as self-referential rather than read as a subject the deck can supply. */
  name?: string;
  clauses: ClauseRecord[];
  characteristics: Characteristics;
  /** Clause id -> the clause's text, straight from `segment()`. Optional and free: segmentation is
   *  deterministic, so this is recomputed rather than stored, and an absent map only means the
   *  actor-recovery in `recipient.ts` says nothing. */
  clauseTexts?: Record<number, string>;
}

/** Assemble the full CardTags document the matcher consumes. `characteristics` is printed data read
 *  from the card document -- derivation never asks a model for what the database already knows. */
export function deriveCardTags(input: DeriveInput): CardTags {
  const { abilities } = deriveAbilities(input.clauses, input.name, input.clauseTexts);
  return {
    oracleId: input.oracleId,
    schemaVersion: 1,
    // WARNING: 0 will never equal PROMPT_VERSION (llm/prompt.ts), so `needsRetag`/`selectUntagged`
    // will see any persisted derived doc as permanently stale and re-queue it for LLM tagging
    // forever. Fine while derivation is not yet wired into the persistence path -- revisit this
    // the moment it is.
    promptVersion: 0,
    model: "derived",
    characteristics: input.characteristics,
    abilities,
  };
}
