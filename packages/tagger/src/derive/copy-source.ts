import type { SubjectFilter } from "../schema.js";

/** WHOSE ABILITY A TRIGGERED COPIER COPIES (#1648), read off its trigger's subject: "Whenever you activate an ability of an artifact" (Kurkesh), "a loyalty ability of
 *  a Chandra planeswalker" (Chandra's Regulator), "an ability of equipped creature" (the Bracers), "of enchanted planeswalker" (Rowan's Talent). The effect's own object is the pronoun
 *  "that ability", so the source lives only here. A targeted copier ("copy target ability you control from an artifact source") carries its `abilityOf` on the effect subject already.
 *
 *  A HOST (`equipped` / `enchanted`) is the status of the source creature or permanent, which the filter grammar refuses in an ability's source on purpose (every other card that
 *  says it, Imprison and Wizard's Staff, keeps its old reading); it is read here, for the copy family only, so no other card's derived subject moves.
 *  The tail "that isn't a mana ability" is a statement about the KIND, which `abilityKind` carries, and is cut before the source is read (Ashnod the Uncaring).
 *  CEILING: a source phrase the grammar does not read, or a property of the ABILITY rather than its source ("that targets a creature or player" -- Ertha Jo, Radiant Performer, Agrus Kos; "a backup
 *  ability", "if life was paid", "with {X} in its cost"), stays unrestricted: no producer states what its abilities target or cost, so nothing here can be checked. */
const HOST = /^(?:an? )?(?:(?:activated|triggered|loyalty) )?abilit(?:y|ies) (?:of|from) (equipped|enchanted) ([a-z]+)$/i;
const NOT_MANA_TAIL = / that isn'?t a mana ability$/i;

export function copySourceOf(
  triggerSubject: string | undefined,
  parseFilter: (text: string) => SubjectFilter | null,
): Partial<SubjectFilter> | undefined {
  if (triggerSubject === undefined) return undefined;
  const text = triggerSubject.trim().replace(NOT_MANA_TAIL, "");
  const host = HOST.exec(text);
  if (host) {
    // The grammar reads a bare "equipped creature" as a reference and returns null; its noun alone is a class ("a creature") it does read.
    const noun = parseFilter(`a ${host[2]!}`);
    if (noun === null || (noun.type === undefined && noun.subtype === undefined)) return undefined;
    const { token: _t, scope: _s, ...of } = noun;
    return { ...of, status: [host[1]!.toLowerCase()] };
  }
  const of = parseFilter(text)?.abilityOf;
  return of && Object.keys(of).length > 0 ? of : undefined;
}
