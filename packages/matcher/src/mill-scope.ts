import type { Ability } from "@edh-seer/tagger";

/** WHOSE LIBRARY A MILL ABILITY EMPTIES (#721, owner 2026-11-17): `you` is a self-mill, `opp` an
 *  opponent mill, `any` can hit either side ("target player", "each player"). Undefined when derive
 *  kept no player at all (a replacement such as Bruvac's, which has no mill emit and no effect subject).
 *
 *  THE EFFECT SUBJECT AND THE EMIT ARE JOINED, neither is authoritative. They part on 7 abilities
 *  (Mesmeric Orb, Riddlekeeper, Eye Spy, Draugr Thought-Thief, Lurking Informant, Dakra Mystic, Fraying
 *  Sanity): "that player" / "target player" is stored as an `any` effect subject but the emit misreads it
 *  as `you`. The effect subject is right there, so a join (`you` + `any` = `any`) keeps both sides.
 *  CEILING: an ability with neither a mill subject nor a mill emit (Bruvac the Grandiloquent, The Water
 *  Crystal: replacements whose text names opponents) has an undefined scope and earns no win-condition
 *  credit. Riddlekeeper reads too wide: "that creature's controller" after a creature attacks you is
 *  always an opponent, but the join can only say `any`, so it also joins graveyard-matters. Follow-up #1663. */
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
