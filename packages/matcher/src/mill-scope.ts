import type { Ability } from "@edh-seer/tagger";

/** WHOSE LIBRARY A MILL ABILITY EMPTIES (#721, owner 2026-11-17): `you` is a self-mill, `opp` an
 *  opponent mill, `any` can hit either side ("target player", "each player"). Undefined when derive
 *  kept no player at all.
 *
 *  THE EFFECT SUBJECT AND THE EMIT ARE JOINED, neither is authoritative (`you` + `any` = `any`). Since
 *  derive 556 (#1663) they agree on every corpus mill: the seven abilities whose emit read `you` where the
 *  effect subject said `any` (Mesmeric Orb, Riddlekeeper, Eye Spy, Draugr Thought-Thief, Lurking Informant,
 *  Dakra Mystic, Fraying Sanity) are read from the printed player now (derive/mill-owner.ts), and a mill REPLACEMENT
 *  ("if an opponent would mill", Bruvac the Grandiloquent, The Water Crystal) carries the miller on its effect
 *  subject, so it is `opp` with no emit. The join stays as the cheap guard for a stored answer or a reading that
 *  disagrees again; it is no longer what makes those cards right.
 *  CEILING: the emit and the effect subject are still two readings of one player; a card whose library the words
 *  do not resolve ("that player" with no opponent named and no combat damage; a clause that mills your library
 *  and an opponent's with no reveal per action) keeps `any` or the generic reading. */
export type MillScope = "you" | "opp" | "any";

export function millScopeOf(a: Pick<Ability, "effect" | "emits">): MillScope | undefined {
  if (a.effect.kind !== "mill") return undefined;
  const controls = new Set<string>((a.emits ?? []).filter((e) => e.verb === "mill").map((e) => e.subject.control));
  if (a.effect.subject?.control !== undefined) controls.add(a.effect.subject.control);
  const you = controls.has("you");
  const opp = controls.has("opp");
  if (controls.has("any") || (you && opp)) return "any";
  return you ? "you" : opp ? "opp" : undefined;
}

/** The scope of several mill abilities at once: the sides they hit together. */
export function joinMillScopes(scopes: readonly (MillScope | undefined)[]): MillScope | undefined {
  const set = new Set(scopes.filter((s): s is MillScope => s !== undefined));
  if (set.has("any") || (set.has("you") && set.has("opp"))) return "any";
  return set.has("you") ? "you" : set.has("opp") ? "opp" : undefined;
}
