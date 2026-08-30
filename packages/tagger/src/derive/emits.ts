/** What other cards can trigger on. Distinct from effect.kind, which asks whether this action is a
 *  payoff — many actions answer only this question. `destroy` has no payoff kind in the engine's
 *  vocabulary, but without its `dies` emit no aristocrats edge ever forms. */
import type { Action } from "../canonicalize.js";
import type { GameEvent, SubjectFilter, Verb } from "../schema.js";
import { counterKindOf, parseSubject, COUNT_PHRASE } from "./subject.js";
import { LAND_SUBTYPES } from "./subtypes.js";
import { tokenTypeFor } from "./token-types.js";

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
]);

/** Does the text name a player at all? 226 of the 6,729 `any` objects do, and they are the ones the
 *  default must not touch: "target player" (92), "that player" (62 — an antecedent, genuinely
 *  ambiguous), "each player" (48), "players" (14), "a player" (7), "any player" (3). */
/** Where a COUNT begins — the same cue `derive/subject.ts` cuts on, exported from there so one
 *  edit moves both readers. */
const NAMES_A_PLAYER = /\b(?:each|target|another|any|that|those|a) player\b|\bplayers\b|\bopponents?\b/i;

/** Verbs whose object names WHO the thing happens to, not WHAT it happens to. The same list
 *  `CONTROLLER_DEFAULT` pins to the controller, for the same reason: the rules make the player the
 *  object of a draw, a mill or a life change. */
const RECIPIENT_VERBS: ReadonlySet<string> = new Set([
  "draw", "mill", "discard", "scry", "surveil", "gain-life", "lose-life",
]);

/** An object that IS a player. "target spell's controller", "that player's owner", "you", "each
 *  opponent" -- none of them describes a card, so none should become a typed subject. */
const PLAYER_OBJECT = /\b(?:controllers?|owners?|players?|opponents?)\b|^\s*you\s*$/i;

export function actionEmits(action: Action, clauseText?: string): GameEvent[] {
  const zoned = ZONE_EMITS.find((r) => r.verb === action.verb && r.to === (action.toZone ?? null));
  // A RECIPIENT IS NOT A SUBJECT (2026-08-22). `parseSubject` reads type words out of whatever text
  // it is given, so Arcane Denial's draw -- whose object the model records as "TARGET SPELL'S
  // CONTROLLER", correctly naming who draws -- yielded `type: spell` and the theme tag `draw:spell`.
  // A one-card tag then took a deck's headline outright, because `rankThemes` adds a tag's `:any`
  // sibling's strength to its own (subsumption), so `draw:spell` inherited all 29 cards of
  // `draw:any` and outranked it: `birb-control` read "draw" at cohesion 0.02, one card of 78.
  // Same shape on Ledger Shredder ("this creature connives") -> `draw:creature`.
  const subject = parseSubject(action.object ?? "");
  // A DRAW'S OBJECT IS ALMOST NEVER THE CARD DRAWN. It is the player ("target spell's controller",
  // Arcane Denial) or the permanent whose ability it is ("this creature connives", Ledger Shredder),
  // and `parseSubject` reads a type word out of either. A real typed draw says so -- "reveal cards
  // until you reveal a creature CARD, draw it" -- so the word `card` is the positive test rather
  // than a blocklist of the shapes seen so far.
  const verbs = zoned?.verbs
    ?? (action.verb === "play" ? landPlayVerbs(subject)
      : action.verb === "tap" ? tapVerbs(subject)
      : EMITS[action.verb ?? ""]);
  if (!verbs) return [];
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
  const head = clauseText?.split(COUNT_PHRASE)[0];
  const sentenceHead = head && head.trim().length > 0 ? head : clauseText;
  const control = !!clauseText
    && subject.control === "any"
    && CONTROLLER_DEFAULT.has(action.verb ?? "")
    && !NAMES_A_PLAYER.test(sentenceHead ?? "")
    ? "you" as const
    : subject.control;
  // ARRIVED TAPPED, the supply half of `SubjectFilter.entersTapped`. "Search your library for a land
  // card, put it onto the battlefield TAPPED" really does satisfy Amulet of Vigor and Tiller Engine,
  // which are the only two cards in the corpus that ask. Read from the clause text, which is where
  // the word sits — the object is just "it".
  const arrivesTapped = verbs.includes("enters")
    && /\b(?:battlefield|enters?|play)\b[^.]{0,30}?\btapped\b|\btapped\b[^.]{0,20}?\bunder\b/i.test(clauseText ?? "");
  // A CREATED TOKEN IS A TOKEN (CR 111.1), and 170 emits across 161 cards did not say so, because
  // the fact was never in the object text to read: `investigate` names no object at all (CR 701.36
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
  // `create-token` precisely because a manifested permanent is a CARD, not a token (CR 701.34a) --
  // keying on the emitted verbs keeps them out rather than needing a second exclusion list.
  const createsAToken = verbs.includes("create-token");
  return verbs.map((verb) => ({
    verb,
    subject: {
      ...subject,
      control,
      ...(createsAToken && subject.token !== true ? { token: true as const } : {}),
      ...(arrivesTapped && verb === "enters" ? { entersTapped: true as const } : {}),
      ...(from ? { fromZone: from } : {}),
      ...(counter ? { counter } : {}),
      ...(tokenType ? { type: tokenType } : {}),
      ...(landType ? { type: landType } : {}),
    },
    // WHO DEALT IT. A damage action's `object` is the VICTIM ("each opponent"), so `subject` above
    // cannot also be the source — and a damage TRIGGER names the source ("whenever another source
    // you control deals 1 damage"). Without this the two were compared against each other and the
    // authored damage channel formed no edges at all; see `GameEvent.dealer`.
    //
    // THE DEALER IS THE ABILITY'S OWN SOURCE, WHICH IS A RULES FACT AND NOT A GUESS: CR 609.7 makes
    // the source of an effect's damage the object that produced the effect, and that object is this
    // card, controlled by its controller. So `{control: "you"}` — the same reading `CONTROLLER_DEFAULT`
    // takes for every other verb whose actor the sentence leaves unstated.
    ...(DAMAGE_VERBS.has(verb) ? { dealer: { control: "you" as const, token: null } } : {}),
  }));
}
