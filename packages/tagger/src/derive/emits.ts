/** What other cards can trigger on. Distinct from effect.kind, which asks whether this action is a
 *  payoff — many actions answer only this question. `destroy` has no payoff kind in the engine's
 *  vocabulary, but without its `dies` emit no aristocrats edge ever forms. */
import type { Action } from "../canonicalize.js";
import type { GameEvent, SubjectFilter, Verb } from "../schema.js";
import { controlFromRelation, counterKindOf, parseCounter, parseSubject, spellMove, COUNT_PHRASE } from "./subject.js";
import { LAND_SUBTYPES } from "./subtypes.js";
import { damageRecipient, isControllerPhrase, playerOnlyRecipient } from "./damage-recipient.js";
import { tokenTypeFor } from "./token-types.js";
import { isEnergyObject, permanentHalf } from "./effect-kind.js";
import { parse as parseFilter } from "../grammar/filter.js";

/** Action verb -> the events it makes available, in order. Verbs absent from this table emit
 *  nothing; a guessed event is worse than silence because it forms edges that are not real. */
/** The verbs whose events have TWO participants, so an emit has to say which one `subject` is. */
const DAMAGE_VERBS: ReadonlySet<string> = new Set(["non-combat-damage", "combat-damage"]);

const EMITS: Record<string, Verb[]> = {
  destroy: ["dies"],
  sacrifice: ["sacrifice", "dies"],
  create: ["create-token", "enters"],
  draw: ["draw"],
  discard: ["discard"],
  mill: ["mill"],
  // CR 701.22a: "look at the top N cards of your library, then put any number of them on the BOTTOM
  // of your library in any order and the rest on top". A scry moves cards between the top and the
  // bottom and never touches a graveyard, so there is no fill half to consider here.
  scry: ["scry"],
  // CR 701.25a: "put ANY NUMBER of them into your graveyard". The graveyard half is CONDITIONAL --
  // any number includes zero -- and this file's own rule, three blocks up, is that a conditional
  // outcome is omitted rather than guessed. Same call as connive's +1/+1 counter and recruit's
  // token. `manifest-dread` emits `mill` because ITS fill is unconditional; surveil's is not.
  //
  // THE COST, MEASURED AND STATED: 169 surveil cards stay invisible to the reanimator and
  // per-graveyard-scaling channels. They already are -- zero of the 169 record a graveyard fill of
  // any kind today -- so this neither opens nor closes that gap. If a measurement later shows the
  // family is worth it, that is a ruling with evidence, not a precedent argument.
  surveil: ["surveil"],
  // CR 701.23a/b. Searching is LOOKING; finding is optional ("isn't required to find some or all of
  // those cards even if they're present"). The event means a search HAPPENED, which is precisely
  // what the three opponent-watching consumers trigger on -- Archivist of Oghma, Ob Nixilis
  // Unshackled, Wan Shi Tong Librarian. Claiming a card was found is the fiction PR #240 reverted.
  search: ["search"],
  "gain-life": ["gain-life"],
  "lose-life": ["lose-life"],
  "deal-damage": ["non-combat-damage"],
  "add-counter": ["counter-added"],
  untap: ["untaps"],
  proliferate: ["proliferate"],
  cast: ["cast"],
  fight: ["non-combat-damage"],
  // CR 701.5. The action's object IS the countered spell, so the emit subject is that spell.
  "counter-spell": ["counter-spell"],
  // AC11 batch 1 (CR 122, 104.3). `remove-counter`'s object is the counter, like add-counter's, so
  // the emit carries the kind; `lose-game`'s object is the PLAYER (RECIPIENT_VERBS below).
  "remove-counter": ["counter-removed"],
  "lose-game": ["loses-game"],
  // AC11 batch 2 (CR 4xx/7xx objects, 2026-09-09): each action emits its own event. `play` is
  // not here -- it emits `land-play` only when the thing played is a land (landPlayVerbs).
  shuffle: ["shuffle"],
  transform: ["transform"],
  "turn-face-up": ["turned-face-up"],
  copy: ["copy"],
  reveal: ["reveal"],
  attach: ["attached"],
  unattach: ["unattached"],
  "gain-control": ["gains-control"],
  "phase-out": ["phases-out"],
  regenerate: ["regenerate"],
  prevent: ["prevented"],
  exchange: ["exchange"],
  double: ["double"],
  triple: ["triple"],
  // AC11 batch 3: the CR 701 keyword actions with no primitive emit their own name. (The ones WITH
  // a primitive — connive, bolster, investigate … — keep their primitive rows above.)
  goad: ["goad"],
  exert: ["exert"],
  detain: ["detain"],
  suspect: ["suspect"],
  harness: ["harness"],
  vote: ["vote"],
  clash: ["clash"],
  fateseal: ["fateseal"],
  behold: ["behold"],
  heal: ["heal"],
  convert: ["convert"],
  explore: ["explore"],
  endure: ["endure"],
  learn: ["learn"],
  forage: ["forage"],
  "time-travel": ["time-travel"],
  "collect-evidence": ["collect-evidence"],
  "venture-into-the-dungeon": ["venture-into-the-dungeon"],
  "face-a-villainous-choice": ["face-a-villainous-choice"],
  airbend: ["airbend"],
  waterbend: ["waterbend"],
  foretell: ["foretell"],
  // AC11 batch 4: the designations and the coin, each its own name.
  "flip-coin": ["flip-coin"],
  monarch: ["monarch"],
  // CR 722.3a: "becomes prepared" / "enters prepared". The subject is the object -- the card itself or
  // "target creature" -- and only a permanent with a prepare spell can take it (implied.ts).
  prepare: ["prepared"],
  initiative: ["initiative"],
  "city-blessing": ["city-blessing"],
  "ring-tempts": ["ring-tempts"],

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
  // 701.47a: "If you don't control an Army creature, create a 0/0 black [subtype] Army creature token.
  // Choose an Army creature you control. Put N +1/+1 counters on that creature." The token is
  // conditional, and kept (#971): unlike connive's counter it is the half that makes amass a token
  // maker, and KEYWORD_EMITS (implied.ts) already emits it for the amass keyword ability.
  // The Army itself is the action grammar's reading of the printed text (grammar/action.ts); see
  // the refusal in `actionEmits` for a clause the grammar never read.
  amass: ["create-token", "enters", "counter-added"],
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
  amass: "+1/+1", earthbend: "+1/+1",
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

/** A SWEEP DEBUFF IS A WIPE (owner ruling 2026-09-10; recall v5 #156, Toxic Deluge -> Espers to
 *  Magicite). "All creatures get -X/-X" derived `debuff` -- correctly not an anthem -- and emitted
 *  nothing, so it filled no graveyard and fed no death payoff, while "destroy all creatures" has
 *  always emitted `dies`. A negative modifier on ALL or EACH creatures emits the same death, with
 *  the control the text states: `any` for "all creatures" (yours die too), `opp` for "creatures
 *  your opponents control". A -1/-1 sweep counts the same as -5/-5; magnitude is not modelled. A
 *  targeted debuff is not a sweep and says nothing. 57 all-creature and 55 opponents-only cards. */
function sweepVerbs(action: Action, subject: SubjectFilter): Verb[] | undefined {
  // BOTH halves negative. "-1/+1" and "+X/-X" trade one stat for the other and kill nothing by
  // themselves; "-0/-1" is a death for every X/1, which is the magnitude question the ruling set
  // aside, so it counts. Stated as "starts negative and has no positive half" rather than as two
  // negative halves, because the clause layer writes Deluge of Doom's -X/-X as "-X, where X is
  // the number of card types among cards in your graveyard" -- one half, four corpus sweeps.
  const amount = String(action.amount ?? "");
  if (!/^\s*-/.test(amount) || /\/\s*\+/.test(amount)) return undefined;
  return subject.scope === "all" || subject.scope === "each" ? ["dies"] : undefined;
}

/** Zone-conditioned emits, checked before EMITS. A move's events depend on where it lands, not on
 *  the verb: `return` is a flicker to the battlefield and a bounce to hand, `put` is reanimation to
 *  the battlefield and self-mill to a graveyard. The destination is read because a card arriving
 *  somewhere is what other cards trigger on -- and, since 2026-09-05, the ORIGIN is read for the two
 *  rows that state a departure, because a permanent leaving the battlefield is what a leaves payoff
 *  triggers on (CR 603.6c) and the flicker's exile half stated nothing at all. */
/** A SEARCHED PUT IS NOT A MILL (CR 701.17a: milling is the TOP cards of a library). Entomb and
 *  Buried Alive put a card into the graveyard FROM the library, so the origin alone cannot tell
 *  them from Cavalier of Thorns -- and the origin alone made both of them mill suppliers on the
 *  first build of DERIVE 163, which would have joined Entomb to every "whenever you mill" payoff
 *  as a false edge. The clause says which it is: a tutor states the search. */
const SEARCHED = (text?: string): boolean => /\bsearch(?:es|ed|ing)?\b/i.test(text ?? "");

const ZONE_EMITS: { verb: string; to: string; verbs: Verb[]; when?: (a: Action, s: SubjectFilter, self: boolean, text?: string) => boolean }[] = [
  // A PUT FROM THE LIBRARY IS A MILL, AND THIS LAYER USED TO DISAGREE WITH THE OTHER ONE (roadmap
  // AK1). `effect-kind.ts` has read the ORIGIN since 2026-09-07 -- `put · from library · to
  // graveyard` is `kind: "mill"` -- while this row ignored it and emitted the Entomb verb for
  // every graveyard put. So 211 abilities derived as a mill and then emitted `enters-graveyard`,
  // which is why `mill|-|-|-` had 602 suppliers where 769 cards carry the mill kind, and why
  // Cavalier of Thorns, Shigeki and Shadow Prophecy were missing from every mill search.
  //
  // THE TWO LAYERS NOW READ THE SAME SIGNAL. What derive already calls a mill emits `mill`; a put
  // from anywhere else -- exile (Murk Strider), the battlefield, an unstated origin -- keeps
  // `enters-graveyard`, which is the row below.
  //
  // NOTHING LOSES AN EDGE: `supplyForms` bridges `mill` to the `enters-graveyard` forms the way it
  // bridges `dies` to `leaves`, so the 248 suppliers of `enters-graveyard|-|-|-` keep every payoff
  // that asks for a graveyard put by type.
  { verb: "put", to: "graveyard", verbs: ["mill"], when: (a, _s, _self, text) => a.fromZone === "library" && !SEARCHED(text) },
  { verb: "put", to: "graveyard", verbs: ["enters-graveyard"] },
  { verb: "return", to: "battlefield", verbs: ["enters"] },
  { verb: "put", to: "battlefield", verbs: ["enters"] },
  // THE EXILE HALF OF A FLICKER, AND EXILE REMOVAL. "Exile target creature you control, then return
  // it" (Ephemerate, 202 corpus clause pairs) left the battlefield and said nothing; Swords to
  // Plowshares the same. Measured on the 1,381 exiles with an UNSTATED origin: 429 name a "card"
  // (top of library, hand -- not on the battlefield), 342 are bare pronouns or the card's own name,
  // 265 "target creature", 53 the permanent list, 34 "permanent". So an unstated origin counts only
  // when the object is permanent-shaped: no "card", no origin zone of its own, and either a type or
  // the card itself. A bare "it" that derive could not resolve emits nothing -- silence over a
  // wildcard that would satisfy every leaves payoff in the deck.
  // EVERY EXILE PUTS SOMETHING INTO EXILE (CR 406.2), so `exiled` is unconditional (AF7b,
  // 2026-09-16); a battlefield exile ALSO left the battlefield. First row wins, so the conditional
  // one sits first.
  // A SPELL ON THE STACK (#1266): "Return target spell to its owner's hand" (Reprieve), "exile target spell" (Spell Queller) leave the stack, and the emit says so
  // (`fromZone: "stack"`, set in `actionEmits`). Not a battlefield leave: the zone on the subject is what keeps a leaves-the-battlefield payoff off it.
  { verb: "exile", to: "exile", verbs: ["exiled", "leaves"], when: fromTheStack },
  { verb: "return", to: "hand", verbs: ["leaves"], when: fromTheStack },
  { verb: "put", to: "hand", verbs: ["leaves"], when: fromTheStack },
  { verb: "put", to: "library", verbs: ["leaves"], when: fromTheStack },
  { verb: "exile", to: "exile", verbs: ["exiled", "leaves"], when: leftTheBattlefield },
  // ...but "exile it" with no antecedent left is a wildcard supply and stays silent, the refusal
  // every untyped pronoun emit gets; "the top card of your library" names its owner and origin.
  { verb: "exile", to: "exile", verbs: ["exiled"], when: (a, _s, self) => self || !BARE_PRONOUN.test((a.object ?? "").trim()) },
  // A BOUNCE. "Return target creature to its owner's hand" is a leave for exactly the same reason;
  // "return target creature card from your graveyard to your hand" is recursion and stays silent
  // here (its origin is stated and it is not the battlefield).
  { verb: "return", to: "hand", verbs: ["leaves"], when: leftTheBattlefield },
  // A TUCK. "Put target nonland permanent into its owner's library third from the top" (Teferi, Hero of Dominaria), Oust, Spin into Myth, Terminus: the permanent leaves the
  // battlefield. These derived NOTHING (the grammar read them completely, so no model clause backed them up, and `unclaimed` is not persisted). A stated graveyard or hand
  // origin is not this row (`leftTheBattlefield` refuses it; a graveyard origin has its own `leaves` below); `top-set` of a library or hand card is a different kind.
  { verb: "put", to: "library", verbs: ["leaves"], when: leftTheBattlefield },
];

/** An object that is nothing but a back-reference: "it", "them", "that card". */
const BARE_PRONOUN = /^(?:it|them|this|that|those|that card|those cards|that permanent|that creature|the exiled cards?)$/i;

/** A TOKEN THAT LEAVES THE SAME TURN IT ARRIVED -- "Exile it at the beginning of the next end step"
 *  (Inalla, Cogwork Assembler, Flameshadow Conjuring), "Sacrifice that token at end of combat"
 *  (Geist of Saint Traft), "exile the tokens/the copies" (Stormsplitter, Manaform Hellkite). The
 *  fact is `Ability.temporary` on the token-generation (derive.ts); the rider is NOT an exile event
 *  of its own -- read as one it gave every temporary-token maker a second, kindless ability
 *  carrying the clause's trigger, and every entering creature a second reason "...Flameshadow
 *  Conjuring triggers" beside "...makes a token" (+187 duplicate rows on the 71, 2026-09-16).
 *  Anchored on the token back-reference so a clause that exiles something ELSE at end of turn
 *  cannot match; "sacrifice" sits beside "exile" because the family splits on the MANNER. */
export const LEAVES_SAME_TURN =
  /\b(?:exile|sacrifice)\s+(?:it|them|that token|those tokens|the tokens?|the cop(?:y|ies)|that copy|those copies)\b[^.]{0,80}?\b(?:at the beginning of the next end step|at end of turn|at end of combat)\b/i;
/** The rider's own object: the token(s) the clause just made. */
export const TEMPORARY_TOKEN_REF = /^(?:it|them|that token|those tokens|the tokens?|the cop(?:y|ies)|that copy|those copies)$/i;

/** The verbs that move a card out of the zone `fromZone` names. See the `leftTheGraveyard` read in
 *  `actionEmits`. `search` is not one; neither is `none`, `modify-pt` or `copy`, which name a card in
 *  a graveyard without moving it (Animate Dead's enchant line, Body Double). */
const GRAVEYARD_MOVE_VERBS: ReadonlySet<string> = new Set(["return", "put", "exile", "cast", "play", "shuffle"]);

/** "Return target creature to its owner's hand" with the destination left out of the action. */
const RETURNS_TO_HAND = /\bto (?:its|their|that card's|the) owners?'s? hands?\b|\bto your hand\b/i;

/** "... counters on each other Moogle you control for each ..." -> "each other Moogle you control".
 *  The regex matches only the head; the tail is cut with string ops, because a lazy run ahead of
 *  `\s+for each` was polynomial ReDoS (CodeQL js/polynomial-redos, PR #498). */
function counterRecipient(clauseText: string, named = true): string | undefined {
  const head = /\bcounters?\s+on\s+(?=(?:each|all|target|another|up to \w+)\b)/i.exec(clauseText);
  if (!head) return named ? thatTarget(clauseText) : undefined;
  let tail = clauseText.slice(head.index + head[0].length);
  const stop = tail.search(/[.;,]/);
  if (stop >= 0) tail = tail.slice(0, stop);
  const forEach = tail.search(/\sfor each\b/i);
  return forEach >= 0 ? tail.slice(0, forEach).trimEnd() : tail;
}

/** "Another target creature gains indestructible. Put a +1/+1 counter ... on THAT CREATURE" (Arwen, Mortal Queen, #1421): "that creature" is the target the sentence named
 *  before the counters, so the emit says "target creature" and a consumer that wants a creature (Mossborn Hydra) sees a supply it can reach. The word "another" is dropped on
 *  purpose: it narrows away from the card, which `other` would carry onto the emit.
 *  CEILING: only the nearest "target <creature|permanent|artifact|land>" (plus a you/opponent control qualifier) earlier in the same clause text; a "that creature" bound to a trigger or an earlier choice stays untyped. */
function thatTarget(clauseText: string): string | undefined {
  const at = /\bcounters?\s+on\s+that\s+(?:creature|permanent|artifact|land)\b/i.exec(clauseText);
  if (!at) return undefined;
  const before = clauseText.slice(0, at.index);
  // The NEAREST target (Trickster's Stratagem names two), with its controller qualifier kept so "target creature an opponent controls" stays the opponent's (Protocol Knight).
  const all = [...before.matchAll(/\btarget\s+(creature|permanent|artifact|land)\b(\s+(?:you control|an opponent controls|you don't control|your opponents control))?/gi)];
  const m = all.at(-1);
  return m ? `target ${m[1]!.toLowerCase()}${m[2] ?? ""}` : undefined;
}

/** A move whose stated origin is the stack: a spell. */
function fromTheStack(a: Action): boolean {
  return a.fromZone === "stack" && spellMove(a.object ?? "") !== undefined;
}

/** The verbs whose object can be a spell on the stack: it is returned, put into a library, exiled, or taken. */
const STACK_MOVES: ReadonlySet<string> = new Set(["return", "put", "exile", "gain-control"]);
/** ...and the events of those moves that are ABOUT the spell (a flicker's `enters` is about the permanent that returns). */
const STACK_EVENTS: ReadonlySet<string> = new Set(["leaves", "exiled", "gains-control"]);
/** Words that end the permanent half of "target spell or permanent with mana value 1 or greater": what follows describes both halves. */
const HALF_ENDS: ReadonlySet<string> = new Set(["with", "an", "a", "you", "your", "that", "its", "their", "controlled", "of"]);

/** The text of the SPELL half of an object: "target spell or nonland permanent an opponent controls" -> "target spell an opponent controls", and the clause after "that" is cut
 *  ("target spell that targets only a single permanent or player" -> "target spell"; what a spell targets is not its class). */
function spellHalfText(object: string): string {
  const words = object.split(" ");
  const cut = words.indexOf("that");
  const head = cut < 0 ? words : words.slice(0, cut);
  const at = head.findIndex((w) => w === "spell" || w === "spells");
  const joins = (w: string | undefined): boolean => w === "or" || w === "and/or";
  if (at < 0 || spellMove(head.join(" ")) !== "mixed") return head.join(" ");
  if (joins(head[at - 1])) return "target spell";
  if (!joins(head[at + 1])) return head.join(" ");
  let j = at + 2;
  while (j < head.length && !HALF_ENDS.has(head[j]!)) j++;
  return [...head.slice(0, at + 1), ...head.slice(j)].join(" ");
}

/** The subject of an emit about a SPELL: its card types (noncreature = spell that is not a creature), `scope` when targeted, mana value, and `fromZone: "stack"` (#1266). */
function stackSubject(object: string, control: SubjectFilter["control"]): SubjectFilter {
  const half = parseSubject(spellHalfText(object));
  const out: SubjectFilter = { control, token: null };
  if (half.notType?.length) { out.type = "spell"; out.notType = half.notType; }
  else out.type = half.type ?? "spell";
  if (half.scope) out.scope = half.scope;
  if (half.stats) out.stats = half.stats;
  if (parseSubject(object).restricted) out.restricted = true;
  out.fromZone = "stack";
  return out;
}

/** "TARGET ... SPELL" EARLIER IN THE SAME ABILITY (the owner ruling, 2026-10-14): the spell "that spell" / "the chosen spell" names is a TARGET only when an earlier sentence
 *  says "target ... spell" (Swallowed by Leviathan's "Choose target spell", Mages' Contest's "target spell's controller"), within six sentences; a trigger on any cast ("whenever an opponent casts a
 *  spell, counter that spell") names none, and "becomes the target OF a spell" (Kira) is not one. Word scan, bounded gap of seven words. */
export function targetsASpellEarlier(text: string, anaphor: string): boolean {
  return earlierTargetSpell(text, anaphor) !== undefined;
}
/** The "target ... spell" phrase itself ("target artifact or enchantment spell"), so a back-reference keeps the card types it names (Defabricate's "exile that spell"). */
export function earlierTargetSpell(text: string, anaphor: string): string | undefined {
  // CEILING: the gap between the "target ... spell" and its back-reference is capped at six sentences, and the target phrase is looked for within seven words of "target". The corpus maximum
  // is 5 sentences (Mages' Contest, a bidding ability) on 2026-10-14; a longer ability would be missed silently, so re-measure with a corpus query when new cards print.
  const sentences = text.toLowerCase().split(".");
  let named = -1, phrase: string | undefined;
  for (let i = 0; i < sentences.length && named < 0; i++) {
    const words = sentences[i]!.split(/[ ,]+/);
    for (let w = 0; w < words.length; w++) {
      if (words[w] !== "target" || words[w + 1] === "of") continue;
      const end = words.slice(w + 1, w + 8).findIndex((x) => x.startsWith("spell"));
      if (end >= 0) { named = i; phrase = words.slice(w, w + 2 + end).join(" ").replace(/'s$/, ""); break; }
    }
  }
  if (named < 0) return undefined;
  for (let j = named; j < sentences.length && j <= named + 6; j++) if (sentences[j]!.includes(anaphor)) return phrase;
  return undefined;
}
/** The card types of "<types> spell is countered this way" ("an artifact or creature spell"), or undefined. A word scan from the phrase back to its determiner. */
function counteredCardTypes(text: string): SubjectFilter["type"] | undefined {
  const lower = text.toLowerCase();
  const at = lower.indexOf(" spell is countered");
  if (at < 0) return undefined;
  const words = lower.slice(0, at).split(/[ ,]+/);
  const det = Math.max(words.lastIndexOf("a"), words.lastIndexOf("an"));
  if (det < 0 || words.length - det > 6) return undefined;
  const type = parseSubject(`${words.slice(det + 1).join(" ")} spell`).type;
  return type === undefined || type === "spell" ? undefined : type;
}
/** A CARD NAME WITH A COMMA IS ONE NAME (#1401 part 2): `parseSubject`'s NAMED stops at a comma, so "a card named Vraska, Scheming
 *  Gorgon" read `named: "vraska"` plus `subtype: "gorgon"` (a filter nobody asked for) while the effect subject, which the filter grammar
 *  reads, held the whole name. The name is the grammar's reading; the rest of the phrase is `parseSubject`'s with the name cut out, so
 *  no word of the name can become a subtype or type. A token's name (`token named X`) is not a card name and is left alone. */
function parseSubjectWhole(text: string): SubjectFilter {
  const plain = parseSubject(text);
  if (plain.named === undefined || !/\bnamed\b/i.test(text)) return plain;
  const whole = parseFilter(text)?.named;
  if (whole === undefined || whole === plain.named || whole === "~" || !whole.startsWith(plain.named)) return plain;
  const at = text.toLowerCase().indexOf(whole);
  if (at < 0) return plain;
  const { named: _n, ...others } = parseSubject(`${text.slice(0, at)}${text.slice(at + whole.length)}`);
  return { ...others, named: whole };
}

/** WHO MANIFESTS DREAD is the subject of the verb right in front of it, not any player word in the clause (#1401 part 2): "Its controller manifests dread" / "the exiled card's owner manifests dread" is
 *  another player (the third-person -s), while "then manifest dread" / "At the beginning of each opponent's upkeep, manifest dread" / "you may manifest dread" is you. Every "manifest dread" in the text must be
 *  yours; no such phrase (an empty text) is unknown. A plural subject right before it ("each opponent may manifest dread" is not printed; an opponent word as the last word is refused) stays `any`. */
const DREAD_ACTOR = new Set(["opponent", "opponents", "player", "players", "they", "controller", "controllers", "owner", "owners"]);
function manifestsDreadYourself(text: string): boolean {
  const hits = [...text.matchAll(/\bmanifest(s?) dread\b/gi)];
  return hits.length > 0 && hits.every((m) => {
    if (m[1] !== "") return false;
    // The word right before the verb, skipping a "may": scanned word by word, not by a backtracking prefix regex (CodeQL js/polynomial-redos).
    const words = text.slice(0, m.index).toLowerCase().split(/\s+/).filter((w) => w !== "");
    const last = words.at(-1) === "may" ? words.at(-2) : words.at(-1);
    return last === undefined || !DREAD_ACTOR.has(last);
  });
}

/** A MILL MADE BY A PUT (OR A MANIFEST DREAD) NAMES WHOSE LIBRARY (#1401 part 2): "Reveal the top five cards of YOUR library ... Put the rest into your graveyard" (Benefaction of Rhonas, Hermit Druid,
 *  Fact or Fiction, Tower Geist) moves cards library -> graveyard, so it emits `mill`, but the put's object ("the rest") names no player and `CONTROLLER_DEFAULT` does not cover `put`, so the mill
 *  read `any` and satisfied the opponent-mill gate of a recursion over an opponent's graveyard (edges.ts reanimatorEdges, ruling #729). The clause says "your library" and no other player's library:
 *  that mill is yours. Manifest dread (CR 701.62) puts the other of the top two cards of YOUR library into the graveyard, unless a player is named doing it ("the exiled card's owner manifests dread").
 *  The verb `mill` itself is covered by CONTROLLER_DEFAULT ("target player mills" stays `any`), and only the `mill` event is read here: the same action's `enters` keeps its own reading.
 *  CEILING: clause-wide text, so a clause naming both "your library" and another player's library stays `any`; a clause with no text stays `any` (a text-less twin of the same put, Celestus Sanctifier).
 */
const OTHER_LIBRARY = /\b(?:their|its owner's|that player's|target (?:player|opponent)'s|each (?:player|opponent)'s|an opponent's|his or her|defending player's) librar(?:y|ies)\b/i;
export function millsOwnLibrary(action: Action, clauseText?: string): boolean {
  const text = clauseText ?? "";
  if (action.verb === "put") return /\byour library\b/i.test(text) && !OTHER_LIBRARY.test(text);
  return action.verb === "manifest-dread" && manifestsDreadYourself(text);
}

/** The back-references to a spell the clause named earlier. */
const SPELL_ANAPHORS = ["the chosen spell", "that spell", "the spell"];

/** Did this action move something OFF THE BATTLEFIELD? A stated battlefield origin says so; an
 *  unstated one says so only for a permanent-shaped object. See the `exile` row above. */
function leftTheBattlefield(a: Action, s: SubjectFilter, self: boolean): boolean {
  if (a.fromZone === "battlefield") return true;
  if (a.fromZone != null) return false;
  if (/\bcards?\b/i.test(permanentHalf(a.object ?? ""))) return false;
  if (s.fromZone !== undefined) return false;
  // A DISJUNCTION IS PERMANENT-SHAPED WHEN EVERY BRANCH IS (recall v6, 2026-09-10): "target creature
  // or Vehicle" has no outer type, and reading only the outer emptied Bounce Off and Gravkill.
  const branches = s.anyOf ?? [];
  const typedBranches = branches.length > 0 && branches.every((b) => b.type !== undefined || b.subtype !== undefined);
  return s.type !== undefined || s.subtype !== undefined || typedBranches || self;
}

/** Verbs whose object is NECESSARILY the ability's controller's when the text names no player.
 *
 *  `parseControl` returns "any" for anything it cannot read, and `matcher/subject.ts` treats "any"
 *  as a PERMISSION rather than an unknown — so an unstated controller satisfies a consumer that
 *  demands an OPPONENT. Measured 2026-08-20: **3,157 of 4,137 emits (76%) carry `any`**, against
 *  **108 triggers that demand an opponent**, and the frozen panel's largest genuinely-broken false
 *  family is exactly this — six of them "whenever an OPPONENT draws a card" (Orcish Bowmasters,
 *  Mind's Eye, Faerie Mastermind) fed by YOUR own draw.
 *
 *  **A BLANKET DEFAULT WOULD BE WRONG, which is why this is a verb list.** Of the 6,729 `any` action
 *  objects in the clause corpus, **6,503 (96.6%) name no player at all** — but "destroy target
 *  permanent" and "tap target creature" name no player either and are routinely aimed at an
 *  OPPONENT'S permanent. Only the verbs below are ones the rules pin to the controller: you may
 *  sacrifice only what you control (CR 701.17a), an unqualified draw/mill/discard/scry/surveil is
 *  the controller's, mana goes to the controller's pool, a created token is the controller's
 *  (CR 111.2), and a search is of your own library.
 *
 *  DELIBERATELY OUT: destroy · exile · tap · untap · deal-damage · counter-spell · add-counter ·
 *  attach · return (to hand — "return target creature to its owner's hand" is usually theirs) and
 *  `enters` (Chaos Warp's own text has the OWNER of the target put the revealed card onto the
 *  battlefield, so a fetchland and a Chaos Warp cannot share a default). */
const CONTROLLER_DEFAULT: ReadonlySet<string> = new Set([
  "draw", "mill", "discard", "sacrifice", "search", "scry", "surveil", "add-mana", "create",
  "gain-life", "lose-life",
  // A coin is flipped by the ability's controller (CR 705.1); "flip a coin" names nobody.
  "flip-coin",
]);

/** The object of a life loss itself names the player ("target opponent", "each opponent", "enchanted player") or points at one ("they lose 1 life", Curse of Leeches). */
const OBJECT_NAMES_A_PLAYER = /\b(?:controllers?|owners?|players?|opponents?)\b|^\s*(?:they|them|he or she)\s*$/i;

/** Does the text name a player at all? 226 of the 6,729 `any` objects do, and they are the ones the
 *  default must not touch: "target player" (92), "that player" (62 — an antecedent, genuinely
 *  ambiguous), "each player" (48), "players" (14), "a player" (7), "any player" (3). */
/** Where a COUNT begins — the same cue `derive/subject.ts` cuts on, exported from there so one
 *  edit moves both readers. */
// CEILING: clause-wide -- one player named anywhere in the sentence declines the controller default for EVERY action in it, so a cost the effect's player never touches ("Discard a card:
// Each other player loses 2 life") goes `any` unless derive pins it (`costDiscard`, `ownSearch`).
const NAMES_A_PLAYER = /\b(?:each|target|another|any|that|those|a|other|defending|the attacking) player\b|\bplayers\b|\bopponents?\b/i;

/** Verbs whose object names WHO the thing happens to, not WHAT it happens to. The same list
 *  `CONTROLLER_DEFAULT` pins to the controller, for the same reason: the rules make the player the
 *  object of a draw, a mill or a life change. */
/** Events whose PLAYER is the one performing the action, though the object names someone else:
 *  "gain control of target creature an opponent controls" is yours afterwards, "clash with an
 *  opponent" is your clash, "each opponent faces a villainous choice" is your effect. The consumer
 *  watches the actor ("whenever you clash"), so the emit says `you`. */
const ACTOR_IS_THE_EVENT: ReadonlySet<string> = new Set(["gains-control", "clash", "face-a-villainous-choice"]);
/** The object of a control change that IS something you control: its HEAD noun phrase (cut at the first " with ", " whose " or " that ") ends in "you control" ("all creatures you control", "any number
 *  of target permanents you control", "a creature you control of their choice", "the creature you control with the greatest mana value"). A "you control" inside a QUALIFIER ("target creature with power
 *  less than or equal to the number of creatures you control", Beguiler of Wills; Vedalken Shackles, Dominating Vampire) is a limit on what YOU take, so the head is "target creature" and the gain is yours.
 *  An exchange (Juxtapose) gives its "you control" half away, so that half is the opponent's gain and the half "target player controls" is yours. Not cut at " of ": "any number of target permanents". */
function yourOwnObject(object: string): boolean {
  const head = object.split(/ (?:with|whose|that) /i)[0]!.trim();
  return /\byou control(?: of their choice)?$/i.test(head);
}

/** A CONTROL CHANGE HANDED TO ANOTHER PLAYER: "target opponent gains control of", "target player
 *  gains control of" (Donate prints `player`; giving yourself your own permanent does nothing). */
const OTHER_GAINS_CONTROL = /\b(?:(?:target|an|each|that) (?:opponent|player)(?: of your choice)?|the player to your (?:left|right)) gains? control of\b/i;

const RECIPIENT_VERBS: ReadonlySet<string> = new Set([
  "draw", "mill", "discard", "scry", "surveil", "gain-life", "lose-life", "loses-game",
  // AC11 batch 4: "you become the monarch", "you take the initiative" — the object IS the player.
  "monarch", "initiative", "city-blessing", "ring-tempts",
]);

/** An object that IS a player. "target spell's controller", "that player's owner", "you", "each
 *  opponent" -- none of them describes a card, so none should become a typed subject. */
const PLAYER_OBJECT = /\b(?:controllers?|owners?|players?|opponents?)\b|^\s*you\s*$/i;


/** The one counter kind a sentence names, or undefined when it names none or several. */
export function soleCounterKind(text: string): string | undefined {
  const kinds = new Set<string>();
  for (const m of text.toLowerCase().matchAll(/(?:[+-]\d\/[+-]\d|\b[a-z]+(?: strike)?) counters?\b/g)) {
    const k = parseCounter(m[0]);
    if (k) kinds.add(k);
  }
  return kinds.size === 1 ? [...kinds][0] : undefined;
}

/** CASUALTY N IS A SACRIFICE OUTLET (CR 702.153a: "you may sacrifice a creature with power N or
 *  greater"). Owner, 2026-09-28: "casualty should link to creatures or tokens which have power X". One
 *  shape for the granted keyword (Anhelo, the Painter) and the printed one (Make Disappear). */
export const CASUALTY = /\bcasualty (\d+)\b/i;
export const casualtySacrifice = (n: number): GameEvent => ({
  verb: "sacrifice", subject: { type: "creature", control: "you", token: null, stats: [{ metric: "power", op: "gte", value: n }] },
});

/** The head naming a created token before "copy of": "token copies of ...", "a token that's a copy of ...". */
export const COPY_TOKEN_HEAD = /^((?:[a-z0-9]+ ){0,3}tokens?(?: that(?:'s| are| is))?(?: a)?)\s+cop(?:y|ies)\s+of\b/i;
/** What a copy copies, to the end of its sentence: not the actor's players. */
// CEILING: clause-wide, so a clause with several creates and one of them by a named player (Tempt with Reflections: "Each opponent may create...")
// leaves ALL its copy tokens `any`, including your own (it read `you` before only because the copied phrase leaked its control).
const PLAYER_CREATES = /\b(?:opponents?|players?|controllers?|owners?|friends?|foes?)\s+(?:may\s+)?creates?\b/i;
const COPIED_PHRASE = /\bcop(?:y|ies)\s+of\b[^.]*/i;

/** "cast any number of spells from among cards exiled with this artifact" (Rod of Absorption, Forger's Foundry): the phrase names the card that
 *  exiled them, not their class, so the subject is the umbrella `spell`, which feeds every creature-spell payoff. The class is what the card's OWN
 *  exile clause printed ("Whenever a player casts an instant or sorcery spell, exile it ..."). Taken only from a sentence that exiles and names a
 *  concrete type; a card whose exile clause names none (Knowledge Pool: "casts a spell ... exiles it") keeps the umbrella, which is correct for it. */
const SELF_EXILED = /\bexiled\s+(?:with|by)\s+this\b/i;
export function narrowSelfExiledSpell(emits: GameEvent[], clauseText: string, cardText: string): GameEvent[] {
  if (!SELF_EXILED.test(clauseText) || !emits.some((e) => e.subject.type === "spell")) return emits;
  const classes = new Set<string>();
  for (const sentence of cardText.split(/[.\n]/)) {
    if (SELF_EXILED.test(sentence) || !/\bexiles?\b/i.test(sentence)) continue;
    // Only the words that qualify "spell" ("an instant or sorcery spell"), never the card's own type ("exile this artifact") or an object ("creature card").
    for (const m of sentence.matchAll(/((?:\b(?:creature|artifact|enchantment|instant|sorcery|planeswalker|battle)\b[ ,]*(?:or |and )?)+)spells?\b/gi)) {
      for (const w of m[1]!.toLowerCase().match(/[a-z]+/g) ?? []) if (w !== "or" && w !== "and") classes.add(w);
    }
  }
  if (classes.size === 0) return emits;
  const type = [...classes];
  return emits.map((e) => e.subject.type === "spell" ? { ...e, subject: { ...e.subject, type: type.length === 1 ? type[0]! : type } } : e);
}

/** "FOR EACH OPPONENT, choose an artifact or land THAT PLAYER CONTROLS. Destroy the chosen permanents." (Ultimate Magic: Meteor, #1385 review): the distributive
 *  "that player" is the opponent, so what is chosen and destroyed is the opponents', and it goes to THEIR graveyards. The stored action reads "chosen artifacts or lands"
 *  with the controller left in the choose clause, so it came out `any`. Applies only when the clause distributes over opponents and the object is that chosen set or
 *  names "that player controls" itself. */
const FOR_EACH_OPPONENT = /\bfor each (?:opponent|other player)\b[^.]*?\bthat (?:player|opponent) controls\b/i;
function distributiveOpponent(object: string, clauseText: string): boolean {
  // "that player controls" must qualify the object's HEAD noun; after "for each" it is a COUNT ("create a Soldier token for each creature that player controls").
  const headNoun = object.split(/\b(?:for|on) each\b/i)[0]!;
  return FOR_EACH_OPPONENT.test(clauseText) && (/\bchosen\b/i.test(headNoun) || /\bthat (?:player|opponent) controls\b/i.test(headNoun));
}

/** Does this token copy a CREATURE? The clause names one ("Exile target creature card ... create a token that's a copy of it", Scarab God), or the
 *  copied phrase names the token's own creature subtype ("a copy of target Goblin you control", Grub's Command). Quoted abilities are not the copy. */
function copiesACreature(object: string, clauseText: string | undefined, subtype: string): boolean {
  const text = (clauseText ?? object).replace(/"[^"]*"/g, " ");
  const copied = COPIED_PHRASE.exec(object)?.[0] ?? COPIED_PHRASE.exec(text)?.[0];
  if (copied === undefined) return false;
  const head = copied.split(/,\s*except\b/i)[0]!;
  return /\bcreatures?\b/i.test(text) || new RegExp(`\\b${subtype}s?\\b`, "i").test(head);
}

/** A `gain-control` ACTION WHOSE PRINTED CLAUSE STATES A CONTROL CHANGE (#1318).
 *  The model sometimes files another sentence as `gain-control`: Crown of Awe's "... gain protection from black and from red" (so wincon.voltron refused a protection Aura),
 *  Misleading Signpost's "reselect which player or permanent ... is attacking". Where the clause text is known it has to print one of the control-change wordings:
 *  "gain(s)/gained/take(s) control", "exchange control", "under <someone>'s control" (Vraska the Silencer, Gather Specimens), "controls enchanted/equipped/target ..." (Fealty to the Realm's
 *  "The monarch controls enchanted creature"), "you control target player" (Opposition Agent). Anchored words and a bounded gap only: linear on any input.
 *  CEILING: any sentence of the clause may carry it, not the one the action came from; a clause that has both a real control change and a misread one keeps both. */
const CONTROL_CHANGE_PRINTED = [
  /\b(?:gains?|gained|takes?|took|taken|exchanges?|steals?)\s+control\b/i,
  /\bunder\s[^.,;:]{0,40}?\bcontrol\b/i,
  /\bcontrols?\s+(?:enchanted|equipped|target|that|those|each|all|another)\b/i,
  // A PLAYER YOU CONTROL (CR 723.1: one player controlling another): Opposition Agent's "You control your opponents".
  // NOT Cruel Entertainment's "The first player controls the second player" (#1401 G): CR 723.3 says only control of the PLAYER changes, every object keeps its controller, and neither
  // player is you -- an emit whose subject reads "you gain control" is a wrong answer there. CEILING: Mindslaver, Sorin Markov's -7 and Emrakul keep their player-control emit (the
  // `target` pattern above), which the matcher reads as a control change although CR 723.3 says no permanent changes hands; that is a wider ruling than this task.
  /\bcontrols?\s+your\s+opponents?\b/i,
];
export function printsControlChange(clauseText: string): boolean {
  return CONTROL_CHANGE_PRINTED.some((re) => re.test(clauseText));
}

export function actionEmits(action: Action, clauseText?: string, opts: { self?: boolean } = {}): GameEvent[] {
  // A `gain-control` THE PRINTED CLAUSE DOES NOT STATE IS NOT A CONTROL CHANGE (#1318): see `printsControlChange`. Dropped, so the action goes to `unclaimed`.
  if (action.verb === "gain-control" && clauseText !== undefined && clauseText !== "" && !printsControlChange(clauseText)) return [];
  const casualty = action.verb === "grant-ability" ? CASUALTY.exec(action.object ?? "") : null;
  if (casualty) return [casualtySacrifice(Number(casualty[1]))];
  // "YOU GET {E}{E}" IS A COUNTER ON A PLAYER (CR 107.14: the energy symbol represents one energy
  // counter). The normalizer wrote 57 of these as `add-mana`; the EFFECT KIND stays refused
  // (effect-kind.ts, 2026-09-04 -- nothing downstream can spend energy) but the EVENT is real, and
  // "whenever you get one or more {E}" (Territorial Gorger) waits for exactly it (DERIVE 157).
  // ONE ENERGY TEST, shared with the effect kind, so the two cannot disagree on "{E} {E}" (DERIVE 172).
  if (action.verb === "add-mana" && isEnergyObject(action.object ?? "")) {
    return [{ verb: "counter-added", subject: { control: "you", token: null, counter: "energy" } }];
  }
  // CR 701.22b AND 701.25c, both stated outright in the rules: "If a player is instructed to scry 0,
  // no scry event occurs. Abilities that trigger whenever a player scries won't trigger." A card
  // printing a literal 0 emits nothing rather than a phantom event.
  //
  // CEILING: only a LITERAL zero is caught. "Scry X" stores the symbol and not the resolved value,
  // so an X that resolves to zero still emits -- the same limit every {X} case in this repo waits on.
  if ((action.verb === "scry" || action.verb === "surveil")
    && (action.amount === "0" || action.object === "0")) return [];
  // A SEARCH EMITS ONLY WHERE THE CONSUMERS ARE LOOKING. CR 701.23a searches any zone, but all four
  // corpus consumers watch a LIBRARY search -- Archivist of Oghma, Ob Nixilis Unshackled and Wan Shi
  // Tong Librarian on an opponent's, Prishe's Wanderings on your own -- and a graveyard or hand
  // search satisfying a library demand would be a claim the card does not make.
  //
  // Measured 2026-09-07 over the 21,317 clause docs, search actions by origin: library 800,
  // unstated 29 (27 of which name a library in the object text), graveyard 21, hand 7, exile 1.
  // So this refuses 30 actions and keeps 828. It also keeps the existing "searching a graveyard,
  // or naming a card in one, moves nothing" test true rather than weakening it to accommodate a
  // new emit -- a graveyard search still moves nothing and now says nothing either.
  //
  // THE OBJECT TEXT IS READ WHATEVER THE STATED ORIGIN, not only when the origin is unstated. A
  // COMPOUND search names three zones and `fromZone` can hold only one of them: Deadly Cover-Up
  // searches "its owner's graveyard, hand, and library" and the origin was recorded `graveyard`,
  // so an unstated-only fallback would have dropped a real library search. Checked rather than
  // assumed -- of the 22 cards with a stated non-library search origin, that is the ONLY one whose
  // object names a library, so reading the text always costs one action and buys the case it exists
  // for. (Boonweaver Giant, the compound-search card `canonicalize.ts` cites, is not in the corpus.)
  if (action.verb === "search"
    && action.fromZone !== "library"
    && !/\blibrar/i.test(action.object ?? "")) return [];
  // A RECIPIENT IS NOT A SUBJECT (2026-08-22). `parseSubject` reads type words out of whatever text
  // it is given, so Arcane Denial's draw -- whose object the model records as "TARGET SPELL'S
  // CONTROLLER", correctly naming who draws -- yielded `type: spell` and the theme tag `draw:spell`.
  // A one-card tag then took a deck's headline outright, because `rankThemes` adds a tag's `:any`
  // sibling's strength to its own (subsumption), so `draw:spell` inherited all 29 cards of
  // `draw:any` and outranked it: `birb-control` read "draw" at cohesion 0.02, one card of 78.
  // Same shape on Ledger Shredder ("this creature connives") -> `draw:creature`.
  // The temporary-token rider ("exile it at the beginning of the next end step") is the token
  // leaving, already recorded as `temporary` on the maker's own ability -- not an exile event.
  if (action.verb === "exile" && LEAVES_SAME_TURN.test(clauseText ?? "") && TEMPORARY_TOKEN_REF.test((action.object ?? "").trim())) return [];
  // A FLASH GRANT IS A PERMISSION, NOT A CAST (DERIVE 173, overview persona rounds): "you may cast
  // spells as though they had flash" changes WHEN you may cast and causes no cast. As an authored cast
  // emit it made High Fae Trickster -- a creature -- feed noncreature-only prowess, and Najal read as
  // casting sorceries. 10 corpus clauses.
  if (action.verb === "cast" && /\bas though (?:it|they) had flash\b/i.test(clauseText ?? "")) return [];
  // WHERE A COUNTER GOES (DERIVE 173, overview item 8): when the object is the COUNTER ("+1/+1",
  // "those counters"), the recipient is only in the sentence -- "put two +1/+1 counters on each other
  // Moogle you control". Parsed from there so the emit says what gets them; a pronoun or the card
  // itself stays with the self logic in derive.
  const recipient = (action.verb === "add-counter" && counterKindOf(action.object ?? "") !== undefined)
    ? counterRecipient(clauseText ?? "", opts.self !== true)
    : undefined;
  // A BID THE MODEL STORED AS ONE `other` ("You and target spell's controller bid life ... If you win the bidding, counter that spell", Mages' Contest) still counters that spell.
  if (action.verb === "other" && (action.object ?? "").toLowerCase().includes("counter that spell")) {
    return [{ verb: "counter-spell", subject: { control: "any", token: null, type: "spell", ...(targetsASpellEarlier(action.object ?? "", "that spell") ? { scope: "target" as const } : {}) } }];
  }
  // A DAMAGE OR LIFE LOSS NAMES WHO IT HITS (#1266, burn): "target player or planeswalker" keeps the player (Lava Spike was typed
  // planeswalker), "each opponent and each creature they control" both halves, "that creature's controller" is the player.
  const listed = action.verb === "deal-damage" || action.verb === "lose-life" ? damageRecipient(action.object ?? "") : undefined;
  // ...and damage to "target player" / "target opponent" is player-only (#1294), no "any target".
  const playerOnly = action.verb === "deal-damage" && listed === undefined ? playerOnlyRecipient(action.object ?? "") : undefined;
  const subject = listed ?? playerOnly ?? parseSubjectWhole(recipient ?? action.object ?? "");
  // A TOKEN THAT IS A COPY IS CONTROLLED BY ITS CREATOR, NOT BY WHAT IT COPIES (#1295, CR 111.2: the player who creates a
  // token is its owner and it enters under that player's control unless the effect says otherwise). "Create two tokens
  // that are copies of target permanent an opponent controls" (Venser, Fervent Forger) parsed the original's control and
  // its target scope onto the token, and "sacrifice them" after it read as killing an opponent's permanent. The original's
  // words are cut: control and scope come from the head naming the token, and the player words of the copied phrase are
  // not the actor's. "Target opponent creates a token that's a copy of ..." keeps its head's player.
  const copyHead = COPY_TOKEN_HEAD.exec((recipient ?? action.object ?? "").trim());
  if (copyHead && !/\btarget\b/i.test(copyHead[1]!)) {
    const h = parseSubject(copyHead[1]!);
    // The creator is "you" unless the sentence has a player create it: "Whenever Donatello deals combat damage to a player,
    // create a token that's a copy of target artifact you control" names a player that is not the actor.
    subject.control = h.control === "any" && !PLAYER_CREATES.test(clauseText ?? "") ? "you" : h.control;
    delete subject.scope; // a created token is not targeted, and the effect subject already carries the plural
  }
  // A control the object's own words state without a control word (#1295): "attacking you" is theirs, "that crewed it" is yours.
  // "attacking you or a planeswalker you control" (Soul Snare) reads `you` off the planeswalker, so an attacker overrides any control; "crewed it" only fills a blank.
  const related = controlFromRelation(action.object ?? "");
  if (related === "opp" || (related && subject.control === "any")) subject.control = related;
  // AN AMASS THE GRAMMAR DID NOT READ EMITS NOTHING, as before #971: the stored object is the bare
  // subtype ("Orcs"), which would make an Orc that is no Army, for any player. CEILING: two cards on
  // 2026-10-04, both a compound trigger the store split in two whose second clause has no printed
  // text to read (Orcish Bowmasters, Mindless Conscription); the first clause carries the Army.
  if (action.verb === "amass" && ![subject.subtype].flat().includes("army")) return [];
  // INVESTIGATE NAMES ITS TOKEN IN THE RULES, NOT ON THE CARD (CR 701.16a: "Investigate" means "Create
  // a Clue token", #794). The emit carried no subtype, so `tokenTypeFor` below never filled the type
  // and an artifact-token payoff (Stridehangar Automaton) heard nothing from Forensic Gadgeteer.
  if (action.verb === "investigate" && subject.subtype === undefined && subject.type === undefined) { subject.subtype = "clue"; subject.token = true; }
  // EXILE'S DESTINATION IS IN THE VERB (CR 406.2: "exile" means put into the exile zone), and the
  // model writes it out less often than not -- Swords to Plowshares, Path to Exile and Deadly
  // Rollick all record `exile target creature` with `toZone: null`, while Ephemerate happened to
  // say "exile". Keyed on the stated destination alone, Y1's exile row caught the flicker and
  // missed the removal: 2026-09-05, every one of those spells derived its exile as UNCLAIMED and
  // emitted nothing, so no leaves payoff saw a Swords and the removal facet could not find the
  // removal. Measured on the 21,317 clause docs: 884 exile actions state no zone at all, 347 of
  // them permanent-shaped. A `return` with no destination is genuinely ambiguous (battlefield or
  // hand), so it takes the hand ONLY when the clause text says so -- 87 such actions corpus-wide,
  // 80 of them "to its owner's hand" (Otawara, Aether Spellbomb, Aethersnipe). A `put` with no
  // destination stays unknown.
  const toZone = action.toZone
    ?? (action.verb === "exile" ? "exile"
      : action.verb === "return" && RETURNS_TO_HAND.test(clauseText ?? "") ? "hand"
      : null);
  const zoned = ZONE_EMITS.find((r) =>
    r.verb === action.verb && r.to === toZone && (r.when === undefined || r.when(action, subject, opts.self === true, clauseText)));
  // A DRAW'S OBJECT IS ALMOST NEVER THE CARD DRAWN. It is the player ("target spell's controller",
  // Arcane Denial) or the permanent whose ability it is ("this creature connives", Ledger Shredder),
  // and `parseSubject` reads a type word out of either. A real typed draw says so -- "reveal cards
  // until you reveal a creature CARD, draw it" -- so the word `card` is the positive test rather
  // than a blocklist of the shapes seen so far.
  const destination = zoned?.verbs
    ?? (action.verb === "play" ? landPlayVerbs(subject)
      : action.verb === "tap" ? tapVerbs(subject)
      : action.verb === "modify-pt" ? sweepVerbs(action, subject)
      : EMITS[action.verb ?? ""]);
  // The ORIGIN zone, for the consumers that demand one (River Kelpie's "enters from a graveyard",
  // Rivaz's "casts a Dragon spell from your graveyard"). Taken from the action rather than the object
  // text because the text usually does not repeat it -- "return it to the battlefield" states the
  // origin only in `fromZone`. Harmless where nothing asks: an unset trigger `fromZone` matches any
  // origin, so this adds a fact without narrowing a single existing edge.
  const from = action.fromZone ?? subject.fromZone;
  // A CARD LEAVING A GRAVEYARD IS AN EVENT OF ITS OWN (roadmap Y1b, 2026-09-05). "Whenever one or
  // more creature cards leave your graveyard" (Desecrated Tomb, Fang, Chalk Outline -- 32 of the 71
  // corpus leaves-payoffs) demands `leaves@graveyard`, and after Y1 gave that demand its zone, nothing
  // supplied it: a reanimation emitted only its `enters`, an exile-from-graveyard nothing at all. The
  // supply was already in the clause. Measured on the 21,317 clause docs, actions with a graveyard
  // origin: return->battlefield 601, return->hand 566, exile 406, put->battlefield 129, cast 109,
  // put->library 74, put->hand 45, shuffle->library 18, play 7. Every one of them moves the card OUT,
  // so each emits a `leaves` alongside whatever its destination emits, and the emit carries
  // `zone: graveyard` so that `subjectMatches` (zone strict both ways) keeps it off The Ozolith's
  // battlefield leave. `search` is absent: searching a graveyard moves nothing until a later action does.
  const leftTheGraveyard = from === "graveyard" && GRAVEYARD_MOVE_VERBS.has(action.verb ?? "");
  const verbs: Verb[] = [...(destination ?? []), ...(leftTheGraveyard ? ["leaves" as const] : [])];
  if (verbs.length === 0) return [];
  // KEYED ON THE EMITTED VERB, NOT THE ACTION'S. A keyword expands to the events the rules say it
  // IS -- `connive` is a draw and a discard (CR 701.50) -- so Ledger Shredder's action verb is
  // `connive` while the emit that carries the bad subject is `draw`. Checking the action verb missed
  // it entirely and cost a re-derive to find out.
  const drawWithoutCard = verbs.includes("draw") && !/\bcards?\b/i.test(action.object ?? "");
  if (drawWithoutCard || (verbs.some((v) => RECIPIENT_VERBS.has(v)) && PLAYER_OBJECT.test(action.object ?? ""))) {
    // The player half is KEPT -- `lose-life` with `{control: "opp"}` is how a drain finds its
    // victim, and `lose-life:opp` is a real tag with real consumers. Only the card TYPE goes, since
    // it was never in the sentence: the words "spell" and "creature" arrived inside the phrase
    // naming the person, or inside the permanent whose ability it is.
    delete subject.type;
    delete subject.subtype;
    delete subject.self;
  }
  // An add-counter's object IS the counter kind, not a permanent, so the emit can say WHICH counter
  // it adds. Without it every counter placer emitted an untyped counter-added that wildcarded onto
  // any counter payoff -- a +1/+1 producer "feeding" a poison or time consumer.
  // WHEN THE OBJECT NAMES THE RECIPIENT INSTEAD ("put an oil counter on THIS ARTIFACT" arrives as
  // object "this artifact"; Shelinda's own counter as "Shelinda"), the kind is still in the sentence.
  // Taken only when the sentence names exactly ONE kind -- "a +1/+1 counter on target creature and a
  // charge counter on this artifact" stays unknown rather than guessed. 82 of the 253 kindless corpus
  // counter emits, 16 of them self (DERIVE 157; Argent Dais's oil fed Territorial Gorger's energy).
  const counter = action.verb === "add-counter" || action.verb === "remove-counter"
    ? (counterKindOf(action.object ?? "") ?? soleCounterKind(clauseText ?? ""))
    : KEYWORD_COUNTER[action.verb ?? ""];
  // A NAMED token ("create two Treasure tokens") states a subtype and no type, because "token" is
  // not a type word -- and an emit with no type falls through to matcher's CARD hierarchy, which
  // answers `treasure -> artifact+creature` on the strength of Goldhound being an "Artifact Creature
  // -- Treasure Dog". The tokens collection is the right oracle and says flatly "Token Artifact --
  // Treasure". Only ever FILLS a missing type: an authored one is the card's own words and wins.
  // THE TABLE IS A UNION ACROSS PRINTINGS (#1385): zombie is [artifact, creature, enchantment], goblin [artifact, creature]. Read as an OR a
  // multi-type fill admits what the token is not -- The Scarab God's Zombie copy of a CREATURE card paired with Builder's Talent
  // ("noncreature, nonland"). So a multi-type fill is only taken for a COPY, and then only as the copied object's class: `creature`
  // when the clause says the copied thing is one ("target creature card"), or when it names a creature subtype ("target Goblin you
  // control"); anything the text adds ("except it's an artifact in addition") is `allTypes`, stamped in `parseSubject`. CEILING: a multi-type union for a token that copies
  // nothing is dropped, leaving `type` unset. An unset type is a WILDCARD downstream (implied.ts: "an untyped producer subject is a wildcard that
  // satisfies every consumer filter"), so this is not obviously the missing edge: it can form a false one. It reaches 0 corpus cards at 399
  // (derive-identity: dropping it changes nothing), so the direction is unmeasured; the alternative, an OR over the union, is the false edge
  // this block exists to remove.
  const tableType = subject.token === true && subject.type === undefined
    && typeof subject.subtype === "string"
    ? tokenTypeFor(subject.subtype)
    : undefined;
  const tokenType = !Array.isArray(tableType) ? tableType
    : tableType.includes("creature") && copiesACreature(action.object ?? "", clauseText, subject.subtype as string) ? "creature"
    : undefined;
  // A CARD WITH A LAND TYPE IS A LAND (CR 205.3i), and an emit that named only the subtype left the
  // type to be guessed downstream. `subjectMatches` resolves a typeless subtype through the CARD
  // hierarchy, which is built from real type lines and therefore answers that a basic land type can
  // belong to a CREATURE — Dryad Arbor is "Land Creature — Forest Dryad". So Farseek's "search for a
  // Plains, Island, Swamp or Mountain card, put it onto the battlefield" satisfied Enduring
  // Courage's "whenever another CREATURE you control enters". Owner-reported off the board.
  //
  // LAND TYPES ONLY, AND THAT LIMIT IS THE POINT. The same fill from a CREATURE subtype would be
  // wrong: a Kindred card carries a creature subtype without being a creature, so `elf` does not
  // imply `creature` the way `plains` implies `land`. There is no Kindred Land — a land type appears
  // on lands and nowhere else — which is what makes this direction safe and the other not.
  const subtypeList = Array.isArray(subject.subtype) ? subject.subtype
    : typeof subject.subtype === "string" ? [subject.subtype] : [];
  const landType = subject.type === undefined && subtypeList.length > 0
    && subtypeList.every((st) => LAND_SUBTYPES.has(st))
    ? "land" as const
    : undefined;
  // See `CONTROLLER_DEFAULT`: an unstated controller on one of these verbs is the ability's
  // controller, not a wildcard that satisfies an opponent-facing trigger.
  // READ THE SENTENCE, NOT THE OBJECT — the first cut tested `action.object` alone and it cost two
  // REAL panel claims, both of them "each player draws": Dark Deal ("each player discards all the
  // cards in their hand, then draws that many cards") and Ruin Grinder ("each player draws seven
  // cards") derive an action whose object is just "cards", with the player named earlier in the
  // sentence. Both really do make an OPPONENT draw, which is exactly what Orcish Bowmasters and
  // Scrawling Crawler watch for. Falling back to the object when no clause text is supplied keeps
  // the guard conservative: an unreadable scope leaves `any`, i.e. today's behaviour.
  //
  // AND THE DEFAULT REQUIRES THE TEXT: with no clause text the answer is "say nothing", not "guess
  // you". Falling back to the object alone was measured wrong twice over — it cost the two REAL
  // claims above, and it broke the standing Pongify case, whose Ape token goes to the DESTROYED
  // permanent's controller and reads as yours from the object text alone. `deriveAbilities` always
  // supplies the text in production; a caller that does not gets today's behaviour unchanged.
  //
  // A PLAYER NAMED ONLY INSIDE A COUNT DOES NOT BLOCK THE DEFAULT (roadmap I2). "Create a Junk token
  // FOR EACH OPPONENT you attacked" names an opponent, so this guard declined and the tokens stayed
  // `any` — a PERMISSION, which satisfies an opponent-facing consumer as readily as your own token
  // payoff. The opponents are the multiplier; CR 111.2 makes the tokens the controller's. Same cut
  // `parseControl` makes one file over, so the two cannot disagree about where a sentence's head
  // ends. Four cards: Call the Coppercoats, Rose, Hylda's Crown of Winter, Kaito.
  const head = (copyHead ? clauseText?.replace(COPIED_PHRASE, "") : clauseText)?.split(COUNT_PHRASE)[0];
  const wholeHead = head && head.trim().length > 0 ? head : clauseText;
  // ANOTHER PLAYER'S PHRASE JOINED TO THIS ACTION'S OWN ("its owner draws that many cards AND EACH OTHER PLAYER loses that much life", Oft-Nabbed Goat) is not this action's actor: the named-player guard reads
  // the head up to that join, unless this action's verb is in the tail (then the tail is its own, "Draw a card and each other player discards a card" keeps the guard for the discard). The join is a
  // compound subject, which is what makes the cut principled: the clause is two predicates and the guard asks who does THIS one.
  // CEILING: the verb test is the first word of the action verb ("lose" for lose-life), and only "and / then each other / defending / the attacking player" is a join.
  // Single literal spaces and no tail group: the tail is sliced by index, so the match stays linear (CodeQL polynomial-redos).
  const otherPlayerJoin = /,? (?:and|then) (?:each other|defending|the attacking) player\b/i.exec(wholeHead ?? "");
  const joinTail = otherPlayerJoin ? wholeHead!.slice(otherPlayerJoin.index) : "";
  const sentenceHead = otherPlayerJoin && !new RegExp(`\\b${(action.verb ?? "").split("-")[0]}`, "i").test(joinTail) ? wholeHead!.slice(0, otherPlayerJoin.index) : wholeHead;
  const control = !!clauseText
    && subject.control === "any"
    && CONTROLLER_DEFAULT.has(action.verb ?? "")
    && !NAMES_A_PLAYER.test(sentenceHead ?? "")
    // "that creature's controller loses 2 life" names its player in the object, not as "player"/"opponent" (Banewasp Affliction).
    && !(action.verb === "lose-life" && (isControllerPhrase(action.object ?? "") || OBJECT_NAMES_A_PLAYER.test(action.object ?? "")))
    ? "you" as const
    : subject.control === "any" && distributiveOpponent(action.object ?? "", clauseText ?? "") ? "opp" as const
    : subject.control;
  // ARRIVED TAPPED, the supply half of `SubjectFilter.entersTapped`. "Search your library for a land
  // card, put it onto the battlefield TAPPED" really does satisfy Amulet of Vigor and Tiller Engine,
  // which are the only two cards in the corpus that ask. Read from the clause text, which is where
  // the word sits — the object is just "it".
  const arrivesTapped = verbs.includes("enters")
    && /\b(?:battlefield|enters?|play)\b[^.]{0,30}?\btapped\b|\btapped\b[^.]{0,20}?\bunder\b/i.test(clauseText ?? "");
  // A CREATED TOKEN IS A TOKEN (CR 111.1), and 170 emits across 161 cards did not say so, because
  // the fact was never in the object text to read: `investigate` names no object at all (CR 701.16
  // supplies the Clue), and `incubate`, `populate` and the plain `create` on an unreadable phrase
  // are the same shape.
  //
  // AN EMIT THAT NAMES NOTHING MATCHES EVERYTHING, which is what made this worth fixing rather than
  // tidying: The Rani's investigate emitted a bare `enters: any`, and a bare enters is the one
  // shape `selfEtbSelfSupplied` cannot refuse -- so it satisfied Sarevok's Tome's "when THIS
  // artifact enters", a permanent The Rani never puts onto the battlefield. Owner-reported off the
  // board. Saying `token: true` is enough on its own: that gate already excludes token producers
  // from a self-ETB, and a token payoff that demands one now correctly sees these.
  //
  // ONLY WHERE THE ABILITY REALLY CREATES ONE. `manifest` and `cloak` emit `enters` and no
  // `create-token` precisely because a manifested permanent is a CARD, not a token (CR 701.40a) --
  // keying on the emitted verbs keeps them out rather than needing a second exclusion list.
  const createsAToken = verbs.includes("create-token");
  const events: GameEvent[] = verbs.map((verb) => ({
    verb,
    subject: {
      ...subject,
      // A CONTROL CHANGE IS ABOUT THE GAINER. "Gain control of target creature an opponent
      // controls" names the opponent as the creature's controller BEFORE the event; the consumer
      // ("whenever you gain control of a permanent", Zidane) watches who has it AFTER. So the
      // emit says `you` -- unless the sentence hands it to someone else: "target opponent gains
      // control of ..." (Donate, Harmless Offering, Goblin Cadets) is the OPPONENT'S gain (#681).
      // YOU CANNOT GAIN CONTROL OF WHAT YOU ALREADY CONTROL: an object that literally says "you control" ("you and target opponent each gain control of all creatures the other controls",
      // Twist Allegiance's "all creatures you control"; Iroh's "target permanent you control") is handed to someone else, so the gainer is the opponent.
      // CEILING: a literal word match on the object, not a parse (a parse reads "cards in your graveyard" and "a creature of your choice that player controls" as yours, and they ARE gained by you);
      // "you own but don't control" does not match, and "each land they own that you control" goes to the opponent. A gift of an object that does not say so ("gain control of it") reads per clause.
      control: verb === "gains-control" && (OTHER_GAINS_CONTROL.test(clauseText ?? "") || yourOwnObject(action.object ?? "")) ? "opp" as const
        : ACTOR_IS_THE_EVENT.has(verb) ? "you" as const
        : verb === "mill" && control === "any" && millsOwnLibrary(action, clauseText) ? "you" as const : control,
      ...(createsAToken && subject.token !== true ? { token: true as const } : {}),
      ...(arrivesTapped && verb === "enters" ? { entersTapped: true as const } : {}),
      ...(leftTheGraveyard && verb === "leaves" ? { zone: "graveyard" } : {}),
      ...(from ? { fromZone: from } : {}),
      ...(counter ? { counter } : {}),
      ...(tokenType ? { type: tokenType } : {}),
      ...(landType ? { type: landType } : {}),
    },
    ...(verb === "leaves" && action.verb === "put" && toZone === "library" && !leftTheGraveyard ? { tuck: true as const } : {}),
    // WHO DEALT IT. A damage action's `object` is the VICTIM ("each opponent"), so `subject` above
    // cannot also be the source — and a damage TRIGGER names the source ("whenever another source
    // you control deals 1 damage"). Without this the two were compared against each other and the
    // authored damage channel formed no edges at all; see `GameEvent.dealer`.
    //
    // THE DEALER IS THE ABILITY'S OWN SOURCE, WHICH IS A RULES FACT AND NOT A GUESS: CR 609.7 makes
    // the source of an effect's damage the object that produced the effect, and that object is this
    // card, controlled by its controller. So `{control: "you"}` — the same reading `CONTROLLER_DEFAULT`
    // takes for every other verb whose actor the sentence leaves unstated. A FIGHT is the exception:
    // CR 701.14a, each creature deals damage equal to its power to the other, so the dealer is the
    // fighting creature and not the spell -- Gratuitous Violence's "a creature you control" can
    // check it (recall v4 #120).
    ...(DAMAGE_VERBS.has(verb) ? { dealer: { control: "you" as const, token: null, ...(action.verb === "fight" ? { type: "creature" } : {}) } } : {}),
  }));
  // A LISTED RECIPIENT IS ONE EVENT PER HALF (#1266, burn): the matcher's `damaged` test reads the VICTIM's top-level type ("a player and a permanent never meet"), so a
  // producer `anyOf` of [player, creature] would meet neither side's consumer. "Each opponent and each creature they control" is the opponent being dealt damage and
  // the creatures being dealt damage, which is how Pestilence's "each creature and each player" already derives. The effect subject keeps the `anyOf`.
  if (listed?.anyOf) {
    const halves: GameEvent[] = [];
    for (const e of events) {
      const { anyOf, ...outer } = e.subject;
      for (const b of anyOf ?? []) {
        // The player half keeps `player: true` (the sentence names it "a player", not the card or "a permanent"; the matcher reads a producer with no type as a player either way).
        halves.push({ ...e, subject: { ...outer, ...b } });
      }
    }
    events.splice(0, events.length, ...halves);
  }
  // Only a move that states no origin, or the stack: a spell named in a phrase that says graveyard, library or hand is a card there ("exile target instant or sorcery card from your graveyard, cast that spell").
  const spellMention = STACK_MOVES.has(action.verb ?? "") && (action.fromZone == null || action.fromZone === "stack") ? spellMove(action.object ?? "") : undefined;
  if (spellMention !== undefined && events.length > 0) {
    // ONLY A SPELL: the whole subject is that spell, on the stack. A MIXED object ("target spell or permanent", Venser) is two things: the permanent half stays as it was, off the
    // battlefield, and the spell half is an emit of its own.
    const about = events.filter((e) => STACK_EVENTS.has(e.verb));
    if (spellMention === "only") for (const e of about) e.subject = stackSubject(action.object ?? "", e.subject.control);
    else {
      const spells = about.map((e) => ({ ...e, subject: stackSubject(action.object ?? "", e.subject.control) }));
      // The permanent half is on the battlefield even when the model wrote `stack` for the whole phrase (Swat Away).
      for (const e of about) if (e.subject.fromZone === undefined || e.subject.fromZone === "stack") e.subject.fromZone = "battlefield";
      events.push(...spells);
    }
  }
  // "THAT SPELL", "THE CHOSEN SPELL": a target when the same ability says "target ... spell" earlier, never on a trigger that names none (Counterbalance, Kira).
  const anaphor = SPELL_ANAPHORS.find((a) => (action.object ?? "").trim().toLowerCase() === a);
  const antecedent = anaphor !== undefined && (STACK_MOVES.has(action.verb ?? "") || action.verb === "counter-spell") ? earlierTargetSpell(clauseText ?? "", anaphor) : undefined;
  if (antecedent !== undefined) {
    // The spell is the one the earlier "target ... spell" named, with the card types that phrase gives.
    for (const e of events) {
      const named = stackSubject(antecedent, e.subject.control);
      // A counter is of a spell on the stack by nature and carries no origin, as its own "counter target spell" does.
      if (action.verb === "counter-spell") delete named.fromZone;
      e.subject = named;
    }
  }
  // "IF AN ARTIFACT OR CREATURE SPELL IS COUNTERED THIS WAY, PUT THAT CARD ONTO THE BATTLEFIELD" (Desertion): what enters is the CARD, so it has the card types the sentence names, not `spell`.
  for (const e of events) if (e.verb === "enters" && e.subject.type === "spell") {
    const types = counteredCardTypes(clauseText ?? "");
    if (types !== undefined) e.subject.type = types;
  }
  // A FIGHT IS TWO DAMAGE EVENTS (CR 701.14a): each creature deals damage to the other, and the emit
  // above carries only the half where YOUR creature is the dealer -- the object parses to the
  // opponent's creature as the victim. The mirror is the half the receiving side needs: Khalni
  // Ambush makes your Stuffy Doll the VICTIM of their creature's damage (recall v7 #82, AF7d).
  // Only when the parsed victim is theirs; a fight among your own creatures (Savage Punch's
  // "another target creature") keeps one event, as before.
  if (action.verb === "fight") {
    const half = events.find((e) => e.verb === "non-combat-damage" && e.subject.control === "opp");
    if (half) events.push({ ...half, subject: { ...half.subject, control: "you" }, dealer: { control: "opp", token: null, type: "creature" } });
  }
  return events;
}
