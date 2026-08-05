/** What other cards can trigger on. Distinct from effect.kind, which asks whether this action is a
 *  payoff — many actions answer only this question. `destroy` has no payoff kind in the engine's
 *  vocabulary, but without its `dies` emit no aristocrats edge ever forms. */
import type { Action } from "../canonicalize.js";
import type { GameEvent, SubjectFilter, Verb } from "../schema.js";
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
  "deal-damage": ["non-combat-damage"],
  "add-counter": ["counter-added"],
  untap: ["untaps"],
  tap: ["taps"],
  proliferate: ["proliferate"],
  cast: ["cast"],
  fight: ["non-combat-damage"],
};

/** "play" only emits land-play when the thing played is actually a land. Ark of Hunger's "play
 *  that card" plays whatever was exiled -- not necessarily a land -- and an unconditional land-play
 *  emit there would wire a false landfall edge. Gated the way the ZONE_EMITS rows are gated: a
 *  predicate checked before the plain verb lookup, not a blanket entry in EMITS. */
function landPlayVerbs(subject: SubjectFilter): Verb[] | undefined {
  const { type } = subject;
  const isLand = type === "land" || (Array.isArray(type) && type.includes("land"));
  return isLand ? ["land-play"] : undefined;
}

/** Zone-conditioned emits, checked before EMITS. A move's events depend on where it lands, not on
 *  the verb: `return` is a flicker to the battlefield and a bounce to hand, `put` is reanimation to
 *  the battlefield and self-mill to a graveyard. Only the destination is read, because a card
 *  arriving somewhere is what other cards trigger on. */
const ZONE_EMITS: { verb: string; to: string; verbs: Verb[] }[] = [
  { verb: "put", to: "graveyard", verbs: ["enters-graveyard"] },
  { verb: "return", to: "battlefield", verbs: ["enters"] },
  { verb: "put", to: "battlefield", verbs: ["enters"] },
];

export function actionEmits(action: Action): GameEvent[] {
  const zoned = ZONE_EMITS.find((r) => r.verb === action.verb && r.to === (action.toZone ?? null));
  const subject = parseSubject(action.object ?? "");
  const verbs = zoned?.verbs ?? (action.verb === "play" ? landPlayVerbs(subject) : EMITS[action.verb ?? ""]);
  if (!verbs) return [];
  return verbs.map((verb) => ({ verb, subject: { ...subject } }));
}
