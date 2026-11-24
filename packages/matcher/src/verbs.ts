import type { Verb } from "@edh-seer/tagger/schema";

/** ONE RECORD FOR WHAT A VERB READS LIKE (#1170 PR 2). It replaces `VERB_PHRASES` (this package) and
 *  the web's `DEMAND_VERB`, `DEMAND_PHASE`, `DEMAND_SUBJECTLESS`, `CLAUSE_VERB`, `SUBJECTLESS_CLAUSE`,
 *  `ACTION_VERB` and `SUBJECTLESS_ACTION`: seven hand-kept tables over one vocabulary, which had
 *  drifted (the demand table lacked 34 of the 78 verbs, the action table 51) and whose fallback
 *  shipped raw identifiers.
 *
 *  `Record<Verb, VerbEntry>` IS CHECKED BY `tsc`: a verb added to `VERB_VOCAB`'s type without an entry
 *  here fails the typecheck, and the entry's SHAPE says which forms it must have. No test walks it.
 *
 *  THE THREE SHAPES, which the old tables expressed by which table a verb sat in:
 *  - `event`: something happens to a permanent, card or spell, and a subject can be glued on --
 *    "a creature dying", "a creature dies". `participle` and `clause` are required.
 *  - `player`: an action a PLAYER takes ("whenever you scry"). Nothing narrows who does it, so gluing a
 *    subject on would invent an actor ("anything drawing a card"); the whole phrase is `bare`, and a
 *    key that names a class still reads it (`participle` and `clause` are optional here, and only
 *    where the class is the object: a creature CARD being drawn).
 *  - `phase`: a step of the turn. The phrase IS the whole demand ("an upkeep"); no subject, no action:
 *    nothing in a deck supplies your upkeep.
 *
 *  `action` is what a CARD does to cause the event, in a player's words ("mill", "put a counter on").
 *  It is absent on purpose where nobody performs the event: nothing "deaths" a creature, and no card
 *  makes a creature attack the way it makes one die (`dies`, `leaves`, `attacks`, `blocks`,
 *  `becomes-blocked`, and the two combat-damage verbs). A test pins that list, so a verb cannot lose
 *  its action by accident. `{object}` marks where the object sits inside the phrase; the older
 *  `ONTO`/`INTO` markers are kept as they were. */
interface Core {
  /** "the verb after a card's name": "enters", "is cast", "makes a player lose life". */
  finite: string;
  /** What a card does to cause it. Absent: the caller falls back to the clause. */
  action?: string;
  /** The object a key that names no class implies: "untap a permanent", not "untap anything". */
  defaultObject?: string;
}
export interface EventVerb extends Core {
  shape: "event";
  /** Glued to a noun, as a label: "a creature dying". */
  participle: string;
  /** Present tense, inside a sentence: "a creature dies". */
  clause: string;
  /** Whole phrases for a key that names no class ("a card is milled"), where the verb has them. */
  bare?: { clause?: string; action?: string };
}
export interface PlayerVerb extends Core {
  shape: "player";
  participle?: string;
  clause?: string;
  bare: { demand: string; clause: string; action: string };
}
export interface PhaseVerb extends Core {
  shape: "phase";
  bare: { demand: string; clause: string; action?: undefined };
}
export type VerbEntry = EventVerb | PlayerVerb | PhaseVerb;

export const VERBS: Record<Verb, VerbEntry> = {
  enters: { finite: "enters", shape: "event", participle: "entering the battlefield", clause: "enters the battlefield", action: "put ONTO the battlefield" },
  "enters-graveyard": { finite: "hits the graveyard", shape: "event", participle: "going to a graveyard", clause: "goes to a graveyard", action: "put INTO a graveyard" },
  dies: { finite: "dies", shape: "event", participle: "dying", clause: "dies" },
  leaves: { finite: "leaves the battlefield", shape: "event", participle: "leaving the battlefield", clause: "leaves the battlefield" },
  // CR 701.5 (Cast): the event of a spell being cast, as against the cards that make it happen.
  cast: { finite: "is cast", shape: "event", participle: "being cast", clause: "is cast", action: "cast" },
  attacks: { finite: "attacks", shape: "event", participle: "attacking", clause: "attacks" },
  blocks: { finite: "blocks", shape: "event", participle: "blocking", clause: "blocks" },
  "becomes-blocked": { finite: "becomes blocked", shape: "event", participle: "becoming blocked", clause: "becomes blocked" },
  taps: { finite: "becomes tapped", shape: "event", participle: "becoming tapped", clause: "becomes tapped", action: "tap" , defaultObject: "a permanent" },
  "non-combat-damage": { finite: "deals noncombat damage", shape: "event", participle: "dealing noncombat damage", clause: "deals noncombat damage" },
  "combat-damage": { finite: "deals combat damage", shape: "event", participle: "dealing combat damage", clause: "deals combat damage" },
  damaged: { finite: "is dealt damage", shape: "event", participle: "being dealt damage", clause: "is dealt damage", action: "deal damage to" },
  exiled: { finite: "is exiled", shape: "event", participle: "being exiled", clause: "is exiled", action: "exile" , defaultObject: "a card" },
  draw: { finite: "draws a card", shape: "player", participle: "being drawn", clause: "is drawn", bare: { demand: "a card being drawn", clause: "a card is drawn", action: "draw a card" } },
  discard: { finite: "discards a card", shape: "event", participle: "being discarded", clause: "is discarded", action: "discard", bare: { clause: "a card is discarded", action: "discard a card" } },
  mill: { finite: "mills a card", shape: "event", participle: "being milled", clause: "is milled", action: "mill", bare: { clause: "a card is milled", action: "mill a card" } },
  "gain-life": { finite: "gains life", shape: "player", bare: { demand: "life being gained", clause: "life is gained", action: "gain life" } },
  "lose-life": { finite: "makes a player lose life", shape: "player", bare: { demand: "life being lost", clause: "life is lost", action: "make a player lose life" } },
  sacrifice: { finite: "sacrifices something", shape: "event", participle: "being sacrificed", clause: "is sacrificed", action: "sacrifice" , defaultObject: "a permanent" },
  "create-token": { finite: "makes a token", shape: "event", participle: "being created", clause: "is created", action: "create" , defaultObject: "a token" },
  "counter-added": { finite: "gets a counter", shape: "event", participle: "getting a counter", clause: "gets a counter", action: "put a counter on" },
  "land-play": { finite: "plays a land", shape: "event", participle: "being played", clause: "is played", action: "play" , defaultObject: "a land" },
  untaps: { finite: "untaps", shape: "event", participle: "untapping", clause: "untaps", action: "untap" , defaultObject: "a permanent" },
  proliferate: { finite: "proliferates", shape: "player", bare: { demand: "proliferating", clause: "you proliferate", action: "proliferate" } },
  unlock: { finite: "is fully unlocked", shape: "event", participle: "being fully unlocked", clause: "is fully unlocked", action: "unlock {object}" , defaultObject: "a Room" },
  upkeep: { finite: "reaches its upkeep", shape: "phase", bare: { demand: "an upkeep", clause: "an upkeep" } },
  "begin-combat": { finite: "enters combat", shape: "phase", bare: { demand: "the beginning of combat", clause: "the beginning of combat" } },
  "end-step": { finite: "reaches the end step", shape: "phase", bare: { demand: "an end step", clause: "an end step" } },
  "dice-rolled": { finite: "rolls a die", shape: "player", bare: { demand: "a die being rolled", clause: "a die is rolled", action: "roll a die" } },
  // CR 701.22 (Scry), 701.25 (Surveil) and 701.23 (Search): player actions, so the `player` shape. The
  // search phrase says the library because every consumer of this event names one.
  scry: { finite: "scries", shape: "player", bare: { demand: "scrying", clause: "you scry", action: "scry" } },
  surveil: { finite: "surveils", shape: "player", bare: { demand: "surveilling", clause: "you surveil", action: "surveil" } },
  search: { finite: "searches a library", shape: "player", bare: { demand: "a library being searched", clause: "a library is searched", action: "search your library" } },
  // CR 701.6 (Counter): the consumer sentence reads "When X counters a spell, Y ...". (The table this
  // replaced cited it as 701.5, which is Cast.)
  "counter-spell": { finite: "counters a spell", shape: "event", participle: "being countered", clause: "is countered", action: "counter" , defaultObject: "a spell" },
  "counter-removed": { finite: "loses a counter", shape: "event", participle: "losing a counter", clause: "loses a counter", action: "remove a counter from" },
  "loses-game": { finite: "makes a player lose the game", shape: "player", bare: { demand: "a player losing the game", clause: "a player loses the game", action: "make a player lose the game" } },
  shuffle: { finite: "shuffles a library", shape: "player", bare: { demand: "a library being shuffled", clause: "a library is shuffled", action: "shuffle a library" } },
  transform: { finite: "transforms", shape: "event", participle: "transforming", clause: "transforms", action: "transform" },
  "turned-face-up": { finite: "is turned face up", shape: "event", participle: "being turned face up", clause: "is turned face up", action: "turn {object} face up" , defaultObject: "a permanent" },
  copy: { finite: "is copied", shape: "event", participle: "being copied", clause: "is copied", action: "copy" },
  reveal: { finite: "is revealed", shape: "event", participle: "being revealed", clause: "is revealed", action: "reveal" , defaultObject: "a card" },
  attached: { finite: "becomes attached", shape: "event", participle: "becoming attached", clause: "becomes attached", action: "attach {object}" },
  unattached: { finite: "becomes unattached", shape: "event", participle: "becoming unattached", clause: "becomes unattached", action: "unattach {object}" },
  "gains-control": { finite: "changes control", shape: "event", participle: "changing control", clause: "changes control", action: "take control of" },
  "phases-out": { finite: "phases out", shape: "event", participle: "phasing out", clause: "phases out", action: "phase out {object}" , defaultObject: "a permanent" },
  regenerate: { finite: "regenerates", shape: "event", participle: "regenerating", clause: "regenerates", action: "regenerate" },
  prevented: { finite: "has damage prevented", shape: "player", bare: { demand: "damage being prevented", clause: "damage is prevented", action: "prevent damage" } },
  exchange: { finite: "is exchanged", shape: "player", bare: { demand: "an exchange", clause: "an exchange happens", action: "exchange something" } },
  double: { finite: "is doubled", shape: "player", bare: { demand: "doubling", clause: "something is doubled", action: "double something" } },
  triple: { finite: "is tripled", shape: "player", bare: { demand: "tripling", clause: "something is tripled", action: "triple something" } },
  goad: { finite: "goads a creature", shape: "event", participle: "being goaded", clause: "is goaded", action: "goad" },
  exert: { finite: "exerts a creature", shape: "event", participle: "being exerted", clause: "is exerted", action: "exert" },
  detain: { finite: "detains something", shape: "event", participle: "being detained", clause: "is detained", action: "detain" },
  suspect: { finite: "suspects a creature", shape: "event", participle: "being suspected", clause: "is suspected", action: "suspect" },
  harness: { finite: "harnesses something", shape: "event", participle: "being harnessed", clause: "is harnessed", action: "harness" },
  vote: { finite: "holds a vote", shape: "player", bare: { demand: "a vote", clause: "you vote", action: "vote" } },
  clash: { finite: "clashes", shape: "player", bare: { demand: "a clash", clause: "you clash", action: "clash" } },
  fateseal: { finite: "fateseals", shape: "player", bare: { demand: "fatesealing", clause: "you fateseal", action: "fateseal" } },
  behold: { finite: "beholds", shape: "player", bare: { demand: "beholding", clause: "you behold", action: "behold" } },
  heal: { finite: "heals", shape: "event", participle: "being healed", clause: "is healed", action: "heal" },
  convert: { finite: "converts", shape: "event", participle: "converting", clause: "converts", action: "convert {object}" },
  explore: { finite: "explores", shape: "event", participle: "exploring", clause: "explores", action: "have {object} explore" , defaultObject: "a creature" },
  endure: { finite: "endures", shape: "event", participle: "enduring", clause: "endures", action: "have {object} endure" , defaultObject: "a creature" },
  learn: { finite: "learns", shape: "player", bare: { demand: "learning", clause: "you learn", action: "learn" } },
  forage: { finite: "forages", shape: "player", bare: { demand: "foraging", clause: "you forage", action: "forage" } },
  "time-travel": { finite: "time travels", shape: "player", bare: { demand: "time travelling", clause: "you time travel", action: "time travel" } },
  "collect-evidence": { finite: "collects evidence", shape: "player", bare: { demand: "collecting evidence", clause: "you collect evidence", action: "collect evidence" } },
  "venture-into-the-dungeon": { finite: "ventures into the dungeon", shape: "player", bare: { demand: "venturing into the dungeon", clause: "you venture into the dungeon", action: "venture into the dungeon" } },
  "face-a-villainous-choice": { finite: "poses a villainous choice", shape: "player", bare: { demand: "a villainous choice", clause: "you face a villainous choice", action: "pose a villainous choice" } },
  airbend: { finite: "airbends", shape: "event", participle: "being airbent", clause: "is airbent", action: "airbend {object}" , defaultObject: "a permanent or spell" },
  waterbend: { finite: "waterbends", shape: "player", bare: { demand: "waterbending", clause: "you waterbend", action: "waterbend" } },
  foretell: { finite: "foretells", shape: "event", participle: "being foretold", clause: "is foretold", action: "foretell {object}" , defaultObject: "a card" },
  "flip-coin": { finite: "flips a coin", shape: "player", bare: { demand: "a coin being flipped", clause: "a coin is flipped", action: "flip a coin" } },
  monarch: { finite: "makes you the monarch", shape: "player", bare: { demand: "becoming the monarch", clause: "you become the monarch", action: "become the monarch" } },
  initiative: { finite: "gives you the initiative", shape: "player", bare: { demand: "taking the initiative", clause: "you take the initiative", action: "take the initiative" } },
  "city-blessing": { finite: "gives you the city's blessing", shape: "player", bare: { demand: "gaining the city's blessing", clause: "you gain the city's blessing", action: "gain the city's blessing" } },
  "ring-tempts": { finite: "has the Ring tempt you", shape: "player", bare: { demand: "the Ring tempting you", clause: "the Ring tempts you", action: "have the Ring tempt you" } },
  prepared: { finite: "becomes prepared", shape: "event", participle: "becoming prepared", clause: "becomes prepared", action: "prepare" },
  "face-a-dilemma": { finite: "poses a dilemma", shape: "player", bare: { demand: "a dilemma", clause: "you face a dilemma", action: "pose a dilemma" } },
};

/** The zone event a graveyard demand is keyed apart under (`zoneEventKey`): not a trigger verb, so not a
 *  `Verb`, but it reads like one. */
const ZONE_EXTRAS: Record<string, VerbEntry> = {
  // A `leaves` demand whose subject names the graveyard (Desecrated Tomb, Fang), keyed apart from a
  // battlefield leave so the sentence cannot say "battlefield" about a graveyard.
  "leaves-graveyard": { shape: "event", finite: "leaves a graveyard", participle: "leaving a graveyard", clause: "leaves a graveyard" },
};

/** A GRAVEYARD FILL (`fills|<type>|<subtype>|-`, partners-core) is not an event: it is what a reanimator
 *  waits for, and the card that puts it there is doing something a player calls filling the yard. */
export const FILL_ACTION = "put INTO a graveyard";

/** The entry for a verb or a zone-event key's verb; undefined for anything the engine has not named. */
export function verbEntry(verb: string): VerbEntry | undefined {
  if (Object.hasOwn(VERBS, verb)) return VERBS[verb as Verb];
  return Object.hasOwn(ZONE_EXTRAS, verb) ? ZONE_EXTRAS[verb] : undefined;
}
