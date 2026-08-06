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

/** A permanent that ENTERS tapped causes no tap event — by the rules nothing triggers on it, and
 *  the prompt records that state as `verb: "tap"` on the thing arriving ("Enters tapped" -> object
 *  "this"). 192 of the 295 corpus cards carrying a tap action are exactly that shape, with "it",
 *  "that land" and "the token" covering Farseek and Evolving Wilds on top. Emitting a taps event for
 *  them made `taps:any` a pseudo-event on 12% of derived docs against 0.1% of flat, and because the
 *  theme axis ranks by volume it won the top slot in decks with nothing to do with tapping.
 *
 *  A tap aimed at permanents already on the battlefield IS an event, and the vocabulary marks those
 *  with a SCOPE — "target creature", "all creatures your opponents control". An entry-state tap
 *  names the single thing arriving and has none. That is the whole discriminator, and it separates
 *  all fourteen object shapes the corpus actually contains. */
function tapVerbs(subject: SubjectFilter): Verb[] | undefined {
  return subject.scope ? ["taps"] : undefined;
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
  const verbs = zoned?.verbs
    ?? (action.verb === "play" ? landPlayVerbs(subject)
      : action.verb === "tap" ? tapVerbs(subject)
      : EMITS[action.verb ?? ""]);
  if (!verbs) return [];
  // The ORIGIN zone, for the consumers that demand one (River Kelpie's "enters from a graveyard",
  // Rivaz's "casts a Dragon spell from your graveyard"). Taken from the action rather than the object
  // text because the text usually does not repeat it -- "return it to the battlefield" states the
  // origin only in `fromZone`. Harmless where nothing asks: an unset trigger `fromZone` matches any
  // origin, so this adds a fact without narrowing a single existing edge.
  const from = action.fromZone ?? subject.fromZone;
  return verbs.map((verb) => ({
    verb,
    subject: { ...subject, ...(from ? { fromZone: from } : {}) },
  }));
}
