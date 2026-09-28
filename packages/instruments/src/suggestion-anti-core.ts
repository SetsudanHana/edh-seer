/** THE SUGGESTION ANTI-LIST, the tested half (owner 2026-09-28: a fix the compass, panel and
 *  anti-compass cannot see means the instruments lack that case). A DRAWBACK SUGGESTED AS SYNERGY
 *  (#567, #650) is invisible to every edge instrument: the edge itself is rules-true -- Tainted Aether
 *  does trigger on a creature entering -- and only the suggestion is wrong. So this checks the
 *  suggestion lists themselves. The build and answer lists are left out on purpose: there a wipe is
 *  what the player asked for (`killsOwnCreatures`' own doc). */
import type { DeckSuggestions } from "@edh-seer/matcher/suggest-static";

export interface Violation { card: string; list: string }

export function suggestionViolations(s: DeckSuggestions, never: readonly string[]): Violation[] {
  const shown: { card: string; list: string }[] = [
    ...s.plan.map((c) => ({ card: c.name, list: "plan" })),
    ...s.routes.map((c) => ({ card: c.name, list: "routes" })),
    ...s.pairs.map((p) => ({ card: p.add.name, list: "pairs" })),
    ...Object.entries(s.synergy).flatMap(([k, v]) => v.map((c) => ({ card: c.name, list: `synergy ${k}` }))),
  ];
  const banned = new Set(never);
  return shown.filter((x) => banned.has(x.card));
}
