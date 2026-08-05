/** Canonical clauses to the Ability[] the engine already consumes. Pure: no model, no database.
 *
 *  One Ability per ACTION rather than per clause, because effect.kind is singular and a drain has
 *  to register on both the lifeloss and the lifegain axis. An action that yields neither a kind nor
 *  an emit is returned in `unclaimed` instead of vanishing -- a dropped clause that produces
 *  silence is indistinguishable from a card that does nothing, which is exactly how Bitterblossom
 *  sat in the corpus as a vanilla bear. */
import type { Action, ClauseRecord } from "../canonicalize.js";
import type { Ability, AbilityKind, CardTags, Characteristics, Verb } from "../schema.js";
import { actionEffectKind } from "./effect-kind.js";
import { actionEmits } from "./emits.js";
import { parseSubject } from "./subject.js";

/** Verbs that state no action at all; they are inert, not unclaimed. */
const INERT_VERBS = new Set(["none"]);

const ABILITY_KINDS = new Set<AbilityKind>(["triggered", "activated", "static", "on-cast"]);

function abilityKind(clause: ClauseRecord): AbilityKind {
  const k = clause.abilityType as AbilityKind | undefined;
  return k && ABILITY_KINDS.has(k) ? k : "static";
}

export function deriveAbilities(clauses: ClauseRecord[]): { abilities: Ability[]; unclaimed: Action[] } {
  const abilities: Ability[] = [];
  const unclaimed: Action[] = [];

  for (const clause of clauses) {
    const kind = abilityKind(clause);
    const trigger = clause.trigger?.event
      ? { verbs: [clause.trigger.event as Verb], subject: parseSubject(clause.trigger.subject ?? "") }
      : undefined;

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
  }
  return { abilities, unclaimed };
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
