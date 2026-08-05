/** Canonical clauses to the Ability[] the engine already consumes. Pure: no model, no database.
 *
 *  One Ability per ACTION rather than per clause, because effect.kind is singular and a drain has
 *  to register on both the lifeloss and the lifegain axis. An action that yields neither a kind nor
 *  an emit is returned in `unclaimed` instead of vanishing -- a dropped clause that produces
 *  silence is indistinguishable from a card that does nothing, which is exactly how Bitterblossom
 *  sat in the corpus as a vanilla bear. */
import type { Action, ClauseRecord } from "../canonicalize.js";
import type { Ability, AbilityKind, CardTags, Characteristics, Verb } from "../schema.js";
import { VERB_ALIASES, VERB_VOCAB } from "../schema.js";
import { actionEffectKind } from "./effect-kind.js";
import { actionEmits } from "./emits.js";
import { parseSubject } from "./subject.js";

/** Verbs that state no action at all; they are inert, not unclaimed. */
const INERT_VERBS = new Set(["none"]);

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

/** Normalize a trigger event through VERB_ALIASES, then check it against the closed VERB_VOCAB.
 *  A near-miss spelling that survives uncorrected (e.g. "die" instead of "dies") means the trigger
 *  silently never matches any producer event -- dead with no error, since triggers have no
 *  `unclaimed`-style safety net of their own. Returns null for anything illegal so the caller can
 *  omit the trigger rather than assert a verb the vocabulary doesn't recognise. */
function normalizeTriggerVerb(event: string): Verb | null {
  const normalized = VERB_ALIASES[event] ?? event;
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
  const ability: Ability = { kind, effect: { kind: "drain", subject: parseSubject(loss.object ?? "") } };
  if (trigger) ability.trigger = trigger;
  return ability;
}

export function deriveAbilities(
  clauses: ClauseRecord[],
): { abilities: Ability[]; unclaimed: Action[]; unknownTriggers: string[] } {
  const abilities: Ability[] = [];
  const unclaimed: Action[] = [];
  const unknownTriggers: string[] = [];

  for (const clause of clauses) {
    const kind = abilityKind(clause);
    let trigger: { verbs: Verb[]; subject: ReturnType<typeof parseSubject> } | undefined;
    if (clause.trigger?.event) {
      const verb = normalizeTriggerVerb(clause.trigger.event);
      if (verb) {
        trigger = { verbs: [verb], subject: parseSubject(clause.trigger.subject ?? "") };
      } else {
        unknownTriggers.push(clause.trigger.event);
      }
    }

    for (const action of clause.actions ?? []) {
      if (INERT_VERBS.has(action.verb ?? "")) continue;
      const effectKind = actionEffectKind(action);
      const emits = actionEmits(action);
      if (!effectKind && emits.length === 0) { unclaimed.push(action); continue; }

      // A subject is attached ONLY when there is a kind. matcher's edges.ts emits a
      // `static:${effect.kind}` tag for any static ability that has a subject, so an empty kind
      // with a subject produces a junk `static:` tag that can match another card's junk tag and
      // form an edge that is not real.
      const ability: Ability = {
        kind,
        effect: effectKind
          ? { kind: effectKind, subject: parseSubject(action.object ?? "") }
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
  clauses: ClauseRecord[];
  characteristics: Characteristics;
}

/** Assemble the full CardTags document the matcher consumes. `characteristics` is printed data read
 *  from the card document -- derivation never asks a model for what the database already knows. */
export function deriveCardTags(input: DeriveInput): CardTags {
  const { abilities } = deriveAbilities(input.clauses);
  return {
    oracleId: input.oracleId,
    schemaVersion: 1,
    promptVersion: 0,
    model: "derived",
    characteristics: input.characteristics,
    abilities,
  };
}
