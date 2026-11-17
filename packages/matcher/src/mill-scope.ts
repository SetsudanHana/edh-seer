import type { Ability } from "@edh-seer/tagger";

/** WHOSE LIBRARY A MILL ABILITY EMPTIES (#721, owner 2026-11-17): `you` is a self-mill, `opp` an
 *  opponent mill, `any` can hit either side ("target player", "each player"). Undefined when derive
 *  kept no player at all (a replacement such as Bruvac's, which has no mill emit and no effect subject).
 *
 *  THE EMIT IS AUTHORITATIVE, the effect subject only a fallback. The emit's subject is the player
 *  whose cards move; the effect's is whatever the ability's own filter said, and the two part on 18
 *  of the 780 mill abilities in the corpus: Mesmeric Orb ("that permanent's controller mills") stores
 *  an `any` permanent as the effect subject and `you` as the milled player. */
export type MillScope = "you" | "opp" | "any";

export function millScopeOf(a: Pick<Ability, "effect" | "emits">): MillScope | undefined {
  if (a.effect.kind !== "mill") return undefined;
  const emitted = (a.emits ?? []).filter((e) => e.verb === "mill").map((e) => e.subject.control);
  const controls = new Set<string>(emitted.length > 0 ? emitted : a.effect.subject?.control !== undefined ? [a.effect.subject.control] : []);
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
