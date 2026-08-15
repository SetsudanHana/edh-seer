/** What other cards can trigger on. Distinct from effect.kind, which asks whether this action is a
 *  payoff — many actions answer only this question. `destroy` has no payoff kind in the engine's
 *  vocabulary, but without its `dies` emit no aristocrats edge ever forms. */
import type { Action } from "../canonicalize.js";
import type { GameEvent, SubjectFilter, Verb } from "../schema.js";
import { counterKindOf, parseSubject } from "./subject.js";
import { tokenTypeFor } from "./token-types.js";

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

  // KEYWORD ACTIONS, EXPANDED INTO THE PRIMITIVES THEY ARE (owner's ruling 2026-08-15).
  //
  // A keyword is a NAME for a bundle of ordinary events, so the clause layer records what the card
  // says and derivation expands it into what the matcher can use — the same architecture
  // `KEYWORD_EMITS` (implied.ts) already uses for keyword ABILITIES. Recording only the keyword
  // would lose the events; recording only the primitives loses the card's own word. Both, and
  // nothing is lost either way.
  //
  // EVERY ROW IS THE COMPREHENSIVE RULES' OWN DEFINITION, quoted, from the cached rules text
  // (`bin/fetch-comp-rules.ts`) — not from memory and not from the community name for the pattern.
  //
  // A CONDITIONAL outcome is deliberately OMITTED rather than guessed, which is why several rows are
  // shorter than the rule: connive and recruit both hinge on "if a NONLAND card is discarded", and an
  // emit that fires only sometimes would be a wrong sentence in the cases it does not.

  // 701.50: "draws a card, then discards a card. If a nonland card is discarded this way, that player
  // puts a +1/+1 counter on the conniving permanent." Loot, in the community's name for it. The
  // counter is conditional and omitted.
  connive: ["draw", "discard"],
  // 701.70: "Draw a card, then discard a card. If you discarded a nonland card this way, create a
  // 1/1 white Human Soldier creature token." Same shape as connive; the token is conditional.
  recruit: ["draw", "discard"],
  // 701.39: "Put N +1/+1 counters on that creature."
  bolster: ["counter-added"],
  // 701.41: "Put a +1/+1 counter on each of up to N other target creatures."
  support: ["counter-added"],
  // 701.46: "If this permanent has no +1/+1 counters on it, put N +1/+1 counters on it."
  adapt: ["counter-added"],
  // 701.37: "If this permanent isn't monstrous, put N +1/+1 counters on it and it becomes monstrous."
  monstrosity: ["counter-added"],
  // 701.68: "To blight N means to put N -1/-1 counters on a creature you control." NOTE THE SIGN —
  // this is the one counter keyword that is not +1/+1, and an untyped counter emit would wildcard a
  // -1/-1 producer onto every +1/+1 payoff in the deck.
  blight: ["counter-added"],
  // 701.16: "Investigate means Create a Clue token."
  investigate: ["create-token", "enters"],
  // 701.36: "choose a creature token you control and create a token that's a copy of that token."
  populate: ["create-token", "enters"],
  // 701.53: "create an Incubator token that enters the battlefield with N +1/+1 counters on it."
  incubate: ["create-token", "enters", "counter-added"],
  // 701.40: "turn it face down ... Put that card onto the battlefield face down." A CARD, not a
  // token, so this is an `enters` and never a `create-token`.
  manifest: ["enters"],
  // 701.57: "Exile cards from the top of your library until you exile a nonland card ... You may
  // cast that card without paying its mana cost." Cascade is already mapped this way in
  // KEYWORD_EMITS on the identical "may cast without paying" wording, so this follows precedent.
  discover: ["cast"],
  // 701.42a: "put them onto the battlefield with their back faces up and combined." A zone change,
  // so a meld is an `enters`. Separate channel from the `meld` REASON edges.ts draws off
  // `meldPartner`, which is a printed characteristic rather than an event.
  meld: ["enters"],
  // 701.58a: "turn it face down ... Put that card onto the battlefield face down." Manifest's twin,
  // with ward {2}; a CARD again, so `enters` and never `create-token`.
  cloak: ["enters"],
  // 701.62a: "Look at the top two cards of your library. Manifest one of them, then put the cards
  // you looked at that were not manifested this way into your GRAVEYARD." The discard half is a
  // library-to-graveyard move, which is a mill.
  "manifest-dread": ["enters", "mill"],
  // 701.66a: "Target land you control becomes a 0/0 land creature with haste ... Put N +1/+1
  // counters on it." The animate half is an effect, not an event; the counters are the event.
  earthbend: ["counter-added"],
  // CR 706.1: "An effect that instructs a player to roll a die will specify what kind of die to roll
  // and how many." 162 corpus cards instruct a roll against 7 that trigger on one — supply is not
  // the scarce side here, it simply had no verb to arrive as.
  //
  // `flip-coin` is deliberately ABSENT: 81 corpus cards flip and none triggers on another card's
  // flip. A flip is self-contained ("flip a coin. If you win the flip, ..."), and even Okaun and
  // Zndrsplt flip and pay off on the same card. A word without an event, like goad and vote.
  "roll-dice": ["dice-rolled"],
};

/** The counter KIND a keyword action places, since its object names the RECIPIENT rather than the
 *  counter — "bolster 2" parses to the creature, not to "+1/+1". Without this these emit an untyped
 *  `counter-added` that wildcards onto any counter payoff, which is the exact defect 499d809 added
 *  `subject.counter` to prevent: a +1/+1 producer feeding a poison or time consumer.
 *
 *  `blight` is -1/-1 (CR 701.68) and is the reason this is a MAP and not a constant. */
const KEYWORD_COUNTER: Record<string, string> = {
  bolster: "+1/+1", support: "+1/+1", adapt: "+1/+1", monstrosity: "+1/+1", incubate: "+1/+1",
  earthbend: "+1/+1",
  blight: "-1/-1",
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
  // An add-counter's object IS the counter kind, not a permanent, so the emit can say WHICH counter
  // it adds. Without it every counter placer emitted an untyped counter-added that wildcarded onto
  // any counter payoff -- a +1/+1 producer "feeding" a poison or time consumer.
  const counter = action.verb === "add-counter"
    ? counterKindOf(action.object ?? "")
    : KEYWORD_COUNTER[action.verb ?? ""];
  // A NAMED token ("create two Treasure tokens") states a subtype and no type, because "token" is
  // not a type word -- and an emit with no type falls through to matcher's CARD hierarchy, which
  // answers `treasure -> artifact+creature` on the strength of Goldhound being an "Artifact Creature
  // -- Treasure Dog". The tokens collection is the right oracle and says flatly "Token Artifact --
  // Treasure". Only ever FILLS a missing type: an authored one is the card's own words and wins.
  const tokenType = subject.token === true && subject.type === undefined
    && typeof subject.subtype === "string"
    ? tokenTypeFor(subject.subtype)
    : undefined;
  return verbs.map((verb) => ({
    verb,
    subject: {
      ...subject,
      ...(from ? { fromZone: from } : {}),
      ...(counter ? { counter } : {}),
      ...(tokenType ? { type: tokenType } : {}),
    },
  }));
}
