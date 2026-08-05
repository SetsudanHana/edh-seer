/** What other cards can trigger on. Distinct from effect.kind, which asks whether this action is a
 *  payoff — many actions answer only this question. `destroy` has no payoff kind in the engine's
 *  vocabulary, but without its `dies` emit no aristocrats edge ever forms. */
import type { Action } from "../canonicalize.js";
import type { GameEvent, Verb } from "../schema.js";
import { parseSubject } from "./subject.js";

/** Action verb -> the events it makes available, in order. Verbs absent from this table emit
 *  nothing; a guessed event is worse than silence because it forms edges that are not real. */
const EMITS: Record<string, Verb[]> = {
  destroy: ["dies"],
  sacrifice: ["sacrifice", "dies"],
  create: ["create-token", "enters"],
  draw: ["draw"],
  discard: ["discard"],
  mill: ["mill"],
  "gain-life": ["gain-life"],
  "lose-life": ["lose-life"],
  "set-life": ["lose-life"],
  "deal-damage": ["non-combat-damage"],
  "add-counter": ["counter-added"],
  untap: ["untaps"],
  tap: ["taps"],
  proliferate: ["proliferate"],
  cast: ["cast"],
  play: ["land-play"],
  fight: ["non-combat-damage"],
};

export function actionEmits(action: Action): GameEvent[] {
  const verbs = EMITS[action.verb ?? ""];
  if (!verbs) return [];
  const subject = parseSubject(action.object ?? "");
  return verbs.map((verb) => ({ verb, subject }));
}
