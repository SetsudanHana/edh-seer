/** THE TRIGGER GRAMMAR (#896, task 5): a PRINTED trigger preamble ("Whenever a creature you control
 *  dies", the card's name written "~") read into the event, the subject and whose it is. Same contract
 *  as `filter.ts`: pure, and it answers only when it read EVERY word -- otherwise null, and derive keeps
 *  the stored trigger. Measured against the stored triggers by `instruments/src/trigger-diff.ts`.
 *
 *  - The EVENT is a closed table of printed templates, named in the clause vocabulary (`TRIGGERS`).
 *    A compound preamble ("enters or attacks") is one reading per event, as the store holds them.
 *  - The SUBJECT is the filter grammar's reading, so task 2's reviewed readings carry over; a self
 *    phrase ("this creature", "~") is `self`.
 *  - WHOSE (`control`): the actor's for an actor verb ("whenever YOU cast"), the subject phrase's for an
 *    object verb ("a creature you control dies"; "a creature dies" is anyone's), you for the card itself.
 *    It is written on the subject too, as derive does.
 *  - The INTERVENING IF (CR 603.4) is `condition`: its family and its printed text. The engine checks
 *    none of them, so a trigger carrying one claims nothing (owner, 2026-10-01).
 *  - A NARROWING of the event the subject cannot hold ("attacks ALONE", "your SECOND spell each turn",
 *    "attacks WHILE SADDLED") is `narrowing`, its printed words. Same rule as the condition: nothing
 *    checks it, so it refuses the claim rather than letting the trigger read wider than printed.
 *  - "When you do" is `reflexive` and goes no further: its event is the clause before it. */
import type { Control, SubjectFilter } from "../schema.js";
import { conditionFamily, type ConditionFamily } from "../derive/intervening-if.js";
import { parseCounter } from "../derive/subject.js";
import { SUBTYPES } from "../derive/subtypes.js";
import { parse } from "./filter.js";

export interface TriggerCondition { family: ConditionFamily; text: string }
export interface TriggerReading {
  event: string;
  subject?: SubjectFilter;
  control?: Control;
  condition?: TriggerCondition;
  narrowing?: string;
  /** "For the first time each turn": a cap on how often, not a narrowing of which events. */
  oncePerTurn?: true;
  /** Which damage a damage event is: the store's `damage-dealt` is both, and derive's verbs are not. */
  damage?: "combat" | "noncombat";
}

/** A player phrase as an actor: whose the event is, and a narrowing when the phrase picks out one
 *  player the matcher cannot ("the chosen player", "enchanted player" -- an Aura's host, see HOST). */
const ACTOR: Record<string, [Control, string?]> = {
  "you": ["you"], "a player": ["any"], "each player": ["any"], "an opponent": ["opp"], "each opponent": ["opp"],
  "your opponents": ["opp"], "one or more opponents": ["opp"], "another player": ["any"], "that player": ["any", "that player"],
  "target opponent": ["opp", "target opponent"], "target player": ["any", "target player"], "one or more players": ["any"],
  "enchanted player": ["any", "enchanted player"], "enchanted opponent": ["opp", "enchanted opponent"],
  "the chosen player": ["any", "chosen player"], "they": ["any", "that player"], "its controller": ["any", "its controller"],
  "an opponent who controls an artifact named ~": ["opp", "who controls an artifact named ~"],
};
const ACTOR_KEYS = Object.keys(ACTOR).sort((a, b) => b.length - a.length);
/** A phase trigger's subject: the player whose step it is. */
const ACTOR_PHRASE: Record<Control, string> = { you: "you", opp: "an opponent", any: "a player" };

/** "your upkeep", "each player's upkeep", "each upkeep", "the end step": whose phase. */
const PHASE_OWNER: Record<string, Control> = {
  "each player's": "any", "each opponent's": "opp", "an opponent's": "opp", "that player's": "any",
  "target opponent's": "opp", "each of your": "you", "your": "you", "each": "any", "the": "any",
  "enchanted player's": "any", "enchanted opponent's": "opp", "each other player's": "opp", "each of that player's": "any",
  "each of enchanted player's": "any",
};
const PHASE_OWNER_RE = new RegExp(`^(${Object.keys(PHASE_OWNER).sort((a, b) => b.length - a.length).join("|")}) (.+)$`);
/** One player's step the matcher cannot pick out: anyone's, narrowed. */
const PHASE_ONE: [RegExp, string, Control, string][] = [
  [/^the chosen player's upkeep$/, "upkeep", "any", "chosen player"],
  [/^the monarch's end step$/, "end-step", "any", "the monarch"],
  [/^that turn's end step$/, "end-step", "any", "that turn"],
  [/^the end step of that player's next turn$/, "end-step", "any", "that player's next turn"],
  [/^the end step on your next turn$/, "end-step", "you", "next turn"],
  [/^enchanted player's first upkeep each turn$/, "upkeep", "any", "enchanted player's first"],
  [/^(?:that combat|the next combat|the next combat phase this turn)$/, "begin-combat", "any", "that combat"],
];
const PHASES: [RegExp, string][] = [
  [/^upkeeps?$/, "upkeep"],
  [/^end step$/, "end-step"],
  [/^draw step$/, "draw-step"],
  [/^(?:precombat |postcombat |first |second )?main phases?$/, "main-phase"],
  [/^untap step$/, "untap-step"],
];

/** "this creature", "this Aura", "this Spacecraft", "this door": the card itself, of its printed class. */
const SELF_NOUN = /^this [a-z]+$/;

/** "THIS CREATURE OR ANOTHER Ally you control": the card is in the class, so the remainder is not
 *  `other`. Derive reads the self half as a twin of its own (#295); this is the class half. */
const SELF_DISJUNCT = /^(?:~|this [a-z]+|\p{Lu}[\p{L}'-]*(?: \p{Lu}[\p{L}'-]*)*) (?:or|and\/or) (?=another |other |one or more other )/u;

/** An Aura's or Equipment's own host ("enchanted creature", "equipped creature") as its class. CEILING:
 *  no `SubjectFilter` field says "the one this card is attached to", so the host reads as its class
 *  -- as wide as derive reads it today. Whose: equip attaches only to a creature you control
 *  (CR 702.6a); an Aura can enchant anyone's. */
const HOST = /^(?:(?:~|this [a-z]+) or )?(enchanted|equipped) (creature|land|artifact|enchantment|permanent|planeswalker|player|opponent|Forest|Island|Mountain|Plains|Swamp)$/;
/** "Enchanted creature OR ANOTHER modified creature you control": the class half, as SELF_DISJUNCT. */
const HOST_DISJUNCT = /^(?:enchanted|equipped) creature or (?=another )/;

/** A BACK-REFERENCE in a delayed trigger ("when THAT CREATURE dies this turn", "when it regenerates
 *  this way"): the object the effect before it named, not a class. `ref: "sentence"`, which the
 *  matcher refuses, so it claims nothing rather than every creature. */
const BACK_REF = /^(?:that|the exiled|the returned) ([a-z]+)$|^(it|they)$/;
/** A wider back-reference: "the creature", "the token", "the chosen creature", "the targeted
 *  creature", "the creature an opponent controls", "either of those creatures", "target creature" in a
 *  delayed trigger. The class is its head noun. */
const BACK_REF_WIDE = /^(?:the|that|those|either of those|target)\b.*?\b(creature|token|permanent|artifact|land|card|Equipment)s?\b/;

/** The subject phrase as a filter, or null when the filter grammar cannot read it. */
function subjectOf(phrase: string): SubjectFilter | null {
  const t = phrase.trim();
  const host = HOST.exec(t);
  if (host) {
    const read = parse(`a ${host[2]}`) ?? parse(`an ${host[2]}`);
    return read && { ...read, control: host[1] === "equipped" ? "you" : host[2] === "opponent" ? "opp" : "any" };
  }
  if (HOST_DISJUNCT.test(t)) {
    const read = parse(t.replace(HOST_DISJUNCT, ""));
    if (!read) return null;
    const { other: _other, ...rest } = read;
    return rest as SubjectFilter;
  }
  const ref = BACK_REF.exec(t);
  if (ref) {
    const read = ref[1] ? parse(`a ${ref[1]}`) ?? parse(`an ${ref[1]}`) : { control: "any" as const, token: null };
    return read && { ...read, ref: "sentence" } as SubjectFilter;
  }
  if (SELF_DISJUNCT.test(t)) {
    const read = parse(t.replace(SELF_DISJUNCT, ""));
    if (!read) return null;
    const { other: _other, ...rest } = read;
    return rest as SubjectFilter;
  }
  if (t === "~" || /^this$/i.test(t)) return { control: "you", token: null, self: true };
  // A plain class before any back-reference: "target creature" alone is still a target.
  const plain = /^(?:the|that|those|either)\b/.test(t) ? null : parse(t);
  if (plain) return plain;
  // A NAME the census did not write "~" (a token's, "Jumblebones"; another card's, "General Kudro"):
  // every word capitalised and none a type. `named`, which only that card matches.
  if (/^\p{Lu}[\p{L}'-]*(?: \p{Lu}[\p{L}'-]*)*$/u.test(t) && !t.split(" ").some((w) => SUBTYPES.has(w.toLowerCase()) || /^(?:Forest|Island|Mountain|Plains|Swamp)$/.test(w))) {
    return { control: "any", token: null, named: t.toLowerCase() };
  }
  const wide = BACK_REF_WIDE.exec(t);
  if (wide) {
    const read = parse(`a ${wide[1]!.toLowerCase()}`);
    return read && { ...read, ref: "sentence" } as SubjectFilter;
  }
  if (SELF_NOUN.test(t.toLowerCase())) {
    const noun = t.slice(5);
    const read = parse(`a ${noun}`) ?? parse(`an ${noun}`);
    return { ...(read ?? { token: null }), control: "you", self: true } as SubjectFilter;
  }
  return parse(t);
}

const reading = (event: string, subject: SubjectFilter, control: Control): TriggerReading =>
  ({ event, subject: { ...subject, control }, control });

/** Where a subject phrase can be cut into a class the filter grammar reads and a qualifier it does
 *  not ("a creature you control WITH A MANA ABILITY", "a spell THEY DON'T OWN"). The qualifier is a
 *  narrowing: the class alone would read wider than printed. */
const QUALIFIER = / (?=with |that |using |other than |during |named |they |you've |of the chosen |in its |of that type|from |without |entering |attacking |crewed |dealt |put onto |this creature haunts|it's paired|it haunts|an opponent owns|exiled with |except |of a turn)/g;

interface Loose { subject: SubjectFilter; narrowing?: string }
/** THE SECOND PASS. A preamble is read strictly first -- every subject whole, no catch-all template --
 *  and only a preamble that fails that is read again with subjects cut at a qualifier and the
 *  catch-all narrowing templates on. Without the order, "a creature you control of the chosen type
 *  enters or attacks" read as an attack by "a creature you control" narrowed by "of the chosen type
 *  enters or". */
let loosePass = false;
function looseSubject(phrase: string): Loose | null {
  const whole = subjectOf(phrase);
  if (whole) return { subject: whole };
  if (!loosePass) return null;
  // "the first noncreature spell of a turn": one of the class.
  const nth = /^the (first|second) (.+) of a turn$/.exec(phrase);
  const one = nth && (parse(`a ${nth[2]}`) ?? parse(`an ${nth[2]}`));
  if (one) return { subject: one, narrowing: `the ${nth![1]} of a turn` };
  for (const m of [...phrase.matchAll(QUALIFIER)].reverse()) {
    // A qualifier ending in a conjunction is half of a compound verb ("... other than ~ attacks OR
    // dies"), not a qualifier.
    if (/ (?:or|and)$|,$/.test(phrase)) break;
    const head = subjectOf(phrase.slice(0, m.index));
    if (head) return { subject: head, narrowing: phrase.slice(m.index + 1) };
  }
  return null;
}


/** Object verbs: "{S} <verb>", the subject's own controller. Plural and singular both print. A
 *  compound ("enters or attacks", "blocks or becomes blocked") is read part by part. */
/** What a template adds beyond its event. A named group `n` in the template is a narrowing. */
interface VerbPatch { zone?: string; fromZone?: string; damage?: "combat" | "noncombat"; withoutDying?: true; control?: Control }
const OBJECT_VERBS: [RegExp, string, VerbPatch?][] = [
  [/^(?:enters?|enter the battlefield|enters the battlefield)$/, "enters"],
  [/^enters? from (?:a|your) graveyard$/, "enters", { fromZone: "graveyard" }],
  [/^enters? from exile$/, "enters", { fromZone: "exile" }],
  [/^enters? from your hand$/, "enters", { fromZone: "hand" }],
  [/^enters?(?: the battlefield)? under your control$/, "enters", { control: "you" }],
  [/^enters?(?: the battlefield)? under an opponent's control$/, "enters", { control: "opp" }],
  [/^enters? (?<n>attacking|transformed|attached to a creature|from anywhere other than your hand)$/, "enters"],
  [/^(?:is|are) cast$/, "cast"],
  [/^(?:is|are) countered$/, "countered"],
  [/^(?:is|are) drawn$/, "draw"],
  [/^(?:is|are) sacrificed$/, "sacrificed"],
  // Destroyed has no word of its own; named only.
  [/^(?:is|are) destroyed$/, "other"],
  [/^(?:is|are) put onto the stack$/, "other"],
  [/^(?:is|are) championed with this creature$/, "other"],
  // A PERMANENT is on the battlefield, so "a permanent is put into a graveyard" is a death (CR 700.4).
  [/^(?:is|are) put into (?:a|your|an opponent's|a player's|its owner's) graveyard$/, "dies"],
  [/^(?:is|are) put into graveyards from anywhere$/, "put-into-graveyard"],
  [/^(?:is|are) put into (?:a|your) graveyard from (?<n>anywhere other than the battlefield|your hand or library)$/, "put-into-graveyard"],
  [/^(?:leaves?|leave) (?:an opponent's|a) graveyard$/, "leaves", { zone: "graveyard" }],
  [/^destroyed$/, "other"],
  [/^becomes? attached to (?<n>.+)$/, "attached"],
  [/^become attached to (?<n>.+)$/, "attached"],
  [/^enters?(?: the battlefield)? under an opponent's control (?<n>without being played)$/, "enters", { control: "opp" }],
  [/^(?:is|are) dealt (?<n>.+)$/, "damaged"],
  [/^deals? (?<n>(?:exactly \d+|excess) damage.*)$/, "damage-dealt"],
  [/^(?:echo cost|cumulative upkeep) is paid$/, "other"],
  [/^(?:is|are) put into (?:a|your) library from anywhere$/, "put-into-library"],
  [/^(?:is|are) put into exile (?<n>from .+)$/, "exiled"],
  [/^(?:is|are) exiled$/, "exiled"],
  [/^(?:is|are) put into your hand from your graveyard$/, "returned-to-hand", { fromZone: "graveyard" }],
  [/^(?:is|are) returned to hand$/, "returned-to-hand"],
  [/^(?:is|are) returned to your hand from the battlefield$/, "returned-to-hand"],
  [/^(?:is|are) put into the command zone(?: from anywhere)?$/, "other"],
  [/^becomes? saddled$/, "becomes-saddled"],
  [/^mentors? a creature$/, "mentors"],
  [/^(?:saddles a mount|crews a vehicle|saddles a mount or crews a vehicle|enlists a creature|trains)$/i, "other"],
  [/^attacks? (?<n>the monarch|enchanted player|different players)$/, "attacks"],
  [/^becomes? untapped (?<n>during your untap step)$/, "untaps"],
  [/^becomes? tapped (?<n>to pay a teamwork cost|for the first time during each of your turns)$/, "taps"],
  [/^(?:is|are) dealt damage (?<n>by .+)$/, "damaged"],
  [/^(?:is|are) dealt combat damage (?<n>by .+)$/, "damaged", { damage: "combat" }],
  [/^transforms? (?<n>into an? .+)$/, "transform"],
  [/^(?:is|are) tapped for (?<n>mana of the chosen color|\{C\})$/, "tapped-for-mana"],
  [/^(?:is|are) attacked$/, "attacks"],
  [/^(?:resolves|triggers)$/, "resolves"],
  [/^resolves (?<n>for the \w+ time this turn)$/, "resolves"],
  [/^has flying$/, "state"],
  [/^(?:dies|die)$/, "dies"],
  [/^attacks?$/, "attacks"],
  [/^blocks?(?: a creature)?$/, "blocks"],
  [/^blocks? (?<n>(?:a|an|one or more|two or more) .+)$/, "blocks"],
  // Only a creature can block (CR 509.1a), so "by a creature" narrows nothing.
  [/^becomes? blocked(?: by a creature)?$/, "becomes-blocked"],
  [/^becomes? blocked (?<n>by .+)$/, "becomes-blocked"],
  [/^(?:leaves?|leave) the battlefield$/, "leaves"],
  [/^(?:leaves?|leave) the battlefield without dying$/, "leaves", { withoutDying: true }],
  [/^attacks? (?<n>an opponent|one or more players|one of your opponents|defending player|the player with the most life or tied for most life|a player who .+|one or more of your opponents|another one of your opponents|you and\/or one or more planeswalkers you control|one or more planeswalkers you control|one of your opponents or a planeswalker (?:an opponent|they) controls?|a planeswalker you control with one or more creatures)$/, "attacks"],
  [/^attacks? (?<n>you and aren't blocked)$/, "attacks"],
  [/^(?:is|are) dealt (?<n>\d+ or more|excess|excess noncombat) damage$/, "damaged"],
  [/^explores? (?<n>a .+)$/, "explore"],
  [/^exploits? (?<n>a .+)$/, "exploit"],
  [/^deals? combat damage(?: to (?:a player|an opponent|a player or battle|one or more players|a player or planeswalker|one of your opponents))?$/, "damage-dealt", { damage: "combat" }],
  [/^deals? noncombat damage(?: to (?:a player|an opponent|a player or planeswalker))?$/, "damage-dealt", { damage: "noncombat" }],
  [/^deals? damage(?: to (?:a player|an opponent|a player or planeswalker))?$/, "damage-dealt"],
  [/^(?:is|are) dealt damage$/, "damaged"],
  [/^(?:is|are) dealt combat damage$/, "damaged", { damage: "combat" }],
  [/^(?:leaves?|leave) your graveyard$/, "leaves", { zone: "graveyard" }],
  [/^(?:is|are) milled$/, "milled"],
  [/^(?:is|are) dealt noncombat damage$/, "damaged", { damage: "noncombat" }],
  [/^(?:is|are) put into exile$/, "exiled"],
  [/^evolves?$/, "evolve"],
  [/^regenerates?$/, "regenerate"],
  [/^becomes? plotted$/, "plotted"],
  [/^becomes? renowned$/, "becomes-renowned"],
  [/^fights?$/, "fight"],
  [/^(?:is|are) returned to (?:its owner's|their owners'|your|a player's) hand$/, "returned-to-hand"],
  [/^(?:is|are) exiled from the battlefield$/, "exiled"],
  [/^becomes? attached to (?:a creature|a permanent)$/, "attached"],
  [/^connives?$/, "connive"],
  [/^becomes? unattached(?: from (?:a permanent|a creature))?$/, "unattached"],
  [/^(?:is|are) turned face up$/, "turned-face-up"],
  [/^becomes? the target of (?:a spell or ability|a spell|an ability)$/, "becomes-target"],
  [/^becomes? the target of (?<n>.+)$/, "becomes-target"],
  [/^becomes? tapped$/, "taps"],
  [/^becomes? untapped$/, "untaps"],
  [/^(?:is|are) tapped for mana$/, "tapped-for-mana"],
  [/^transforms?(?: into (?:~|[a-z' -]+))?$/, "transform"],
  [/^mutates?$/, "mutates"],
  [/^explores?$/, "explore"],
  [/^exploits? a creature$/, "exploit"],
  [/^becomes? monstrous$/, "becomes-monstrous"],
  [/^becomes? crewed$/, "becomes-crewed"],
  [/^becomes? level \d+$/, "level-up"],
  [/^phases? in$/, "phases-in"],
  [/^phases? out$/, "phases-out"],
  // CR 700.4: "dies" means "is put into a graveyard from the battlefield", whatever the card type.
  // "From anywhere" is never a leaves-the-battlefield trigger (CR 603.6c), so it keeps its own name.
  [/^(?:is|are) put into (?:a|your|an opponent's|a player's|its owner's|their owners'|their owner's) graveyard from the battlefield$/, "dies"],
  [/^(?:is|are) put into (?:a|your|an opponent's|its owner's) graveyard from anywhere$/, "put-into-graveyard"],
  [/^(?:is|are) put into (?:a|your|an opponent's|its owner's) graveyard from (?:your|their|a) library$/, "put-into-graveyard", { fromZone: "library" }],
  [/^(?:is|are) put into exile from the battlefield$/, "exiled"],
  // Last, so a recipient the plain templates read is never a narrowing.
  [/^deals? (?<n>\d+ or more) (?:combat )?damage(?: to (?:a player|an opponent))?$/, "damage-dealt"],
  [/^deals? combat damage (?<n>to .+)$/, "damage-dealt", { damage: "combat" }],
  [/^deals? noncombat damage (?<n>to .+)$/, "damage-dealt", { damage: "noncombat" }],
  [/^deals? damage (?<n>to .+)$/, "damage-dealt"],
];

/** A template that reads a narrowing (`(?<n>...)`) is tried only after every plain one, so a phrase a
 *  plain template reads in full is never narrowed. */
const OBJECT_VERBS_ORDERED = [...OBJECT_VERBS.filter(([re]) => !re.source.includes("(?<n>")), ...OBJECT_VERBS.filter(([re]) => re.source.includes("(?<n>"))];

/** Actor verbs: "{A} <verb> {S}?", the actor's control. `true` means an object phrase follows. */
const ACTOR_VERBS: [RegExp, string, boolean][] = [
  [/^casts? (.+)$/, "cast", true],
  [/^(?:copy|copies) (.+)$/, "copy", true],
  [/^mills? (.+)$/, "milled", true],
  [/^creates? (.+)$/, "create", true],
  [/^reveals? (.+)$/, "reveal", true],
  [/^loses? control of (.+)$/, "loses-control", true],
  [/^gains? control of (.+)$/, "gains-control", true],
  [/^(?:win|wins|lose|loses) the flip$/, "flip-coin", false],
  [/^spends? this mana to cast (.+)$/, "mana-spent", true],
  [/^attacks? with (.+)$/, "attacks", true],
  [/^puts? (.+) onto the battlefield$/, "enters", true],
  [/^exiles? (.+)$/, "exiled", true],
  [/^turns? (.+) face up$/, "turned-face-up", true],
  [/^foretells? (.+)$/, "foretell", true],
  [/^taps? (an untapped creature .+|one or more untapped creatures .+)$/, "taps", true],
  [/^untaps? (one or more permanents)$/, "untaps", true],
  [/^(?:discover|discovers)$/, "discover", false],
  [/^forages?$/, "forage", false],
  [/^manifests? dread$/, "manifest-dread", false],
  [/^gives? a gift$/, "give-gift", false],
  [/^investigates?$/, "investigate", false],
  [/^solves? a case$/i, "solved", false],
  [/^waterbends?$/, "waterbend", false],
  [/^earthbends?$/, "earthbend", false],
  [/^airbends?$/, "airbend", false],
  [/^firebends?$/, "firebend", false],
  [/^chooses? a creature as your ring-bearer$/i, "ring-tempts", false],
  // Attractions and stickers have no clause word; named only (owner 2026-09-27: never played).
  [/^(?:opens? an attraction|visits? an attraction|claims? the prize of an attraction|rolls? to visit your attractions|places? a sticker|puts? an? (?:name |ability |art )?sticker on .+)$/i, "other", false],
  [/^(?:pays? this cost one or more times|pays? this enchantment's cumulative upkeep|chooses? one or more targets)$/, "other", false],
  [/^becomes? the monarch$/, "monarch", false],
  [/^clash$/, "clash", false],
  [/^collects? evidence$/, "collect-evidence", false],
  [/^shuffles? (?:their|your) library$/, "shuffled", false],
  [/^completes? a dungeon$/, "dungeon-completed", false],
  [/^loses? the game$/, "loses-game", false],
  [/^attacks?$/, "attacks", false],
  [/^gains? life$/, "life-gained", false],
  [/^loses? life$/, "life-lost", false],
  [/^draws? (?:a card|one or more cards)$/, "draw", false],
  [/^draws? (.+)$/, "draw", true],
  [/^sacrifices? (.+)$/, "sacrificed", true],
  [/^discards? (.+)$/, "discarded", true],
  [/^cycles? (.+)$/, "cycled", true],
  [/^activates? (.+)$/, "activate", true],
  [/^plays? (.+)$/, "play", true],
  [/^exerts? (.+)$/, "exert", true],
  [/^taps? (.+) for mana$/, "tapped-for-mana", true],
  [/^adds? (?:one or more )?mana(?: .+)?$/, "tapped-for-mana", false],
  [/^(?:scry|scries)$/, "scry", false],
  [/^surveils?$/, "surveil", false],
  [/^commits? a crime$/, "crime", false],
  [/^expends? \d+$/, "expend", false],
  [/^rolls? (?:a die|one or more dice)$/, "roll-dice", false],
  [/^flips? a coin$/, "flip-coin", false],
  [/^proliferate$/, "proliferate", false],
  [/^search(?:es)? (?:their|your) library$/, "search", false],
  [/^(?:fully )?unlocks? (.+)$/, "unlocked", true],
  [/^(?:are|is|'re) dealt damage$/, "damaged", false],
  [/^(?:are|is|'re) dealt (?:non)?combat damage$/, "damaged", false],
];

/** Events with no subject at all. */
const SUBJECTLESS: [RegExp, string, Control][] = [
  [/^day becomes night or night becomes day$/, "day-night", "any"],
  [/^the ring tempts you$/i, "ring-tempts", "you"],
  [/^players finish voting$/, "vote", "any"],
  [/^chaos ensues$/, "other", "any"],
  [/^damage (?:from .+ )?is prevented(?: this way)?(?: this turn)?$/, "prevented", "any"],
  [/^damage that would be dealt to you is prevented$/, "prevented", "you"],
  [/^a player doesn't pay .+$/, "other", "any"],
  [/^.+ causes? a triggered ability (?:of that creature )?to trigger$/, "other", "any"],
];

/** A STATE TRIGGER (CR 603.8) watches a condition, not an event: named, and the condition rides as
 *  the narrowing so nothing claims it. */
const STATE = /^(?:(?:you|a player|an opponent) (?:control|controls|don't control|has|have) .+|there (?:are|is) .+|no .+ (?:are|is) on the battlefield|(?:~|this [a-z]+) (?:has|have) .+|(?:~|this [a-z]+)'s power is .+|a creature has .+|the chosen .+ isn't .+|a player other than .+ controls it|.+ are on the battlefield)$/;

function phaseTrigger(rest: string): TriggerReading | null {
  let m = /^combat on (your|each player's|each opponent's|an opponent's|enchanted player's|enchanted opponent's) turn$/.exec(rest);
  if (m) return actorReading("begin-combat", PHASE_OWNER[m[1]!]!);
  if (rest === "each combat") return actorReading("begin-combat", "any");
  for (const [re, event, control, narrowing] of PHASE_ONE) {
    const read = re.test(rest) ? actorReading(event, control) : null;
    if (read) return { ...read, narrowing };
  }
  // An Aura's host's controller, or an enchanted player: anyone's (see HOST).
  m = /^the (upkeep|end step|draw step) of enchanted (?:creature|permanent|artifact|enchantment|land)'s controller$/.exec(rest);
  if (m) return actorReading(PHASES.find(([re]) => re.test(m![1]!))![1], "any");
  m = PHASE_OWNER_RE.exec(rest);
  if (!m) return null;
  const whose = PHASE_OWNER[m[1]!]!;
  // "your NEXT upkeep" is one upkeep, a narrowing of the event.
  const next = /^next (.+)$/.exec(m[2]!);
  const phase = PHASES.find(([re]) => re.test(next?.[1] ?? m![2]!))?.[1];
  const read = phase ? actorReading(phase, whose) : null;
  return read && next ? { ...read, narrowing: "next" } : read;
}

function actorReading(event: string, control: Control): TriggerReading | null {
  const actor = parse(ACTOR_PHRASE[control]);
  return actor ? reading(event, actor, control) : null;
}

/** Printed qualifiers that narrow an event past what its template and subject say, peeled off the end
 *  of the preamble. "Attacks you" narrows the defender; "attacks a player" narrows it from a
 *  planeswalker or battle. */
const NARROWING_TAIL = / (except .+|this combat|during the declare attackers step|during your main phase|during their turn|under your control|in each of their draw steps|alone|tapped|to a planeswalker|an opponent|one or more players|one of your opponents|during combat|a battle|while .+|and isn't blocked|a player|you(?: or a planeswalker you control)?|during (?:your|an opponent's|each opponent's) turn|this turn|each turn|this way|untapped|with (?:two|three) or more creatures|a creature with [a-z]+|to (?:you|a creature|a creature or planeswalker|a permanent|an opponent or a permanent an opponent controls))$/;
/** "Your SECOND spell each turn", "their first noncreature spell": one spell of the class. */
const ORDINAL_OBJECT = /^(?:your|their) (?:first or second|first|second|third|fourth|fifth|next) (.+)$/;
/** Battalion's "this creature and at least two other creatures attack". */
const ALONG_WITH = /^(.+?) (and at least (?:one|two|three) (?:other )?[a-zA-Z ]+?|and another creature) (attack)(?: (different players))?$/;

/** A verb phrase "V1 or V2" (or "V1, V2, or V3") in its parts. */
const verbParts = (v: string) => v.split(/,? or (?=(?:enters?|enter|dies|die|attacks?|blocks?|becomes?|leaves?|is|are|deals?|transforms?|explores?|mutates?|phases?|destroyed)\b)|, (?=(?:or )?(?:enters?|dies|attacks?|blocks?|becomes?|leaves?|is|are|deals?)\b)/).map((p) => p.replace(/^or /, ""));

/** "THIS CREATURE OR A DRAGON YOU CONTROL", "~ or an enchanted creature you control": the card and a
 *  class it need not belong to, so two readings, the self one first. */
const SELF_OR_A = /^(~|this [a-z]+) or (an? .+)$/;

function subjectsOf(phrase: string): Loose[] | null {
  const pair = SELF_OR_A.exec(phrase);
  if (pair) {
    const self = subjectOf(pair[1]!), other = looseSubject(pair[2]!);
    return self && other ? [{ subject: self }, other] : null;
  }
  const one = looseSubject(phrase);
  return one && [one];
}

function objectReading(rest: string): TriggerReading | TriggerReading[] | null {
  const words = rest.split(" ");
  for (let i = words.length - 1; i >= 1; i--) {
    const verb = words.slice(i).join(" ");
    if (/^(?:or|and) /.test(verb)) continue;
    // The whole phrase first: "becomes the target of a spell OR ability" is one event.
    const match = (part: string) => {
      for (const [re, event, patch] of OBJECT_VERBS_ORDERED) {
        if (!loosePass && re.source.includes("(?<n>.+)")) continue;
        const m = re.exec(part);
        if (m) return { event, patch, narrowing: m.groups?.n };
      }
      return undefined;
    };
    const whole = match(verb);
    const hits = whole ? [whole] : verbParts(verb).map(match);
    if (hits.some((h) => h === undefined)) continue;
    const subjects = subjectsOf(words.slice(0, i).join(" "));
    if (!subjects) continue;
    // "blocks or becomes blocked BY A WHITE CREATURE": a blocker printed last covers every part. Any
    // other narrowing is its own part's ("enters or becomes the target of a spell AN OPPONENT CONTROLS").
    const shared = hits.map((h) => h!.narrowing).find((n) => n?.startsWith("by "));
    const out = subjects.flatMap(({ subject, narrowing: subjectNarrowing }) => {
      return hits.map((h) => {
        const narrowing = [subjectNarrowing, h!.narrowing ?? shared].filter(Boolean).join(" ");
        const { event, patch } = h!;
        const control = subject.self ? "you" : patch?.control ?? subject.control;
        const patched = { ...subject, ...(patch?.zone ? { zone: patch.zone } : {}), ...(patch?.fromZone ? { fromZone: patch.fromZone } : {}), ...(patch?.withoutDying ? { withoutDying: true as const } : {}) };
        const r = reading(event, patched, control);
        return { ...r, ...(patch?.damage ? { damage: patch.damage } : {}), ...(narrowing ? { narrowing } : {}) };
      });
    });
    return out.length === 1 ? out[0]! : out;
  }
  return null;
}

function actorVerb(phrase: string, control: Control, tail: string): TriggerReading | null {
  for (const [re, event, hasObject] of ACTOR_VERBS) {
    const v = re.exec(tail);
    if (!v) continue;
    const ordinal = hasObject ? ORDINAL_OBJECT.exec(v[1]!) : null;
    if (ordinal) {
      const noun = ordinal[1]!.replace(/ (?:each turn|in a turn|during (?:each opponent's|their|your) turn|during each of (?:your|their) (?:turns|draw steps))$/, "");
      const loose = looseSubject(`a ${noun}`) ?? looseSubject(`an ${noun}`);
      if (loose) return { ...reading(event, loose.subject, control), narrowing: v[1]! };
      continue;
    }
    if (!hasObject) {
      const subject = parse(phrase);
      const damage = /\bnoncombat damage$/.test(tail) ? "noncombat" as const : /\bcombat damage$/.test(tail) ? "combat" as const : undefined;
      if (subject) return { ...reading(event, subject, control), ...(damage ? { damage } : {}) };
      continue;
    }
    // "you attack with ~ and another legendary creature", "with this creature and/or your commander":
    // a creature you control, narrowed by the rest.
    if (event === "attacks" && !looseSubject(v[1]!)) {
      const yours = parse("a creature you control");
      if (yours) return { ...reading(event, yours, control), narrowing: `with ${v[1]}` };
    }
    const whole = subjectOf(v[1]!);
    const loose = whole ? { subject: whole } : (event === "activate" ? abilityObject(v[1]!) : null) ?? looseSubject(v[1]!);
    if (loose) {
      const r = reading(event, loose.subject, loose.subject.self ? "you" : control);
      return loose.narrowing ? { ...r, narrowing: loose.narrowing } : r;
    }
  }
  return null;
}

/** What an activation names: "an ability that isn't a mana ability" is an activated ability (CR
 *  605.1a's mana abilities aside); "a loyalty ability", "an exhaust ability", "an ability of an
 *  artifact" narrow it. */
const ABILITY_OBJECT = /^(?:an?|this creature's) ?(.*?) ?abilit(?:y|ies)(?: (of .+?))?(?: that isn't a mana ability)?$/;
function abilityObject(text: string): Loose | null {
  const m = ABILITY_OBJECT.exec(text);
  if (!m) return null;
  const kind = m[1]!.trim();
  const subject = parse(kind === "loyalty" ? "a loyalty ability" : "an activated ability");
  if (!subject) return null;
  const narrowing = [kind && kind !== "loyalty" ? kind : "", m[2] ?? "", /^this creature's/.test(text) ? "this creature's" : ""].filter(Boolean).join(" ");
  return narrowing ? { subject, narrowing } : { subject };
}

function actorReadings(rest: string): TriggerReading | TriggerReading[] | null {
  for (const phrase of ACTOR_KEYS) {
    const sep = phrase === "you" && rest.startsWith("you're ") ? "" : " ";
    if (!rest.startsWith(phrase + sep)) continue;
    const [control, who] = ACTOR[phrase]!;
    const read = actorTail(phrase === "you" || ACTOR_PLAIN.has(phrase) ? phrase : ACTOR_PHRASE[control], control, rest.slice(phrase.length + sep.length));
    if (read) return who ? withNarrowing(read, who, true) : read;
  }
  return null;
}

const ACTOR_PLAIN = new Set(["a player", "each player", "an opponent", "each opponent", "your opponents", "one or more opponents", "another player", "one or more players"]);

/** "Win a coin flip", "clash and win", "pay life" (paying life is losing it, CR 118.3b): an actor
 *  event the vocabulary names, narrowed by the words around it. */
const ACTOR_NARROWED: [RegExp, string, string][] = [
  [/^(?:win|wins) a coin flip$/, "flip a coin", "win"],
  [/^(?:lose|loses) a coin flip$/, "flip a coin", "lose"],
  [/^(?:clash and win|win a clash)$/, "clash", "win"],
  [/^pays? life$/, "lose life", "pay"],
  [/^gains? life (for the first time during each of (?:your|their) turns)$/, "gain life", "$1"],
  [/^loses? life (for the first time during each of (?:your|their) turns)$/, "lose life", "$1"],
  [/^each lose (exactly \d+) life$/, "lose life", "$1"],
  [/^choose to put one or more cards on the bottom of your library while scrying$/, "scry", "bottom"],
  [/^untap one or more permanents (during your untap step)$/, "untap one or more permanents", "$1"],
  [/^(?:tap|taps) (a land|a permanent) for (\{C\})$/, "tap $1 for mana", "for $2"],
  [/^kicks? (.+)$/, "cast $1", "kicked"],
];

function actorTail(phrase: string, control: Control, tail: string): TriggerReading | TriggerReading[] | null {
  for (const [re, as, narrowing] of ACTOR_NARROWED) {
    const m = re.exec(tail);
    const fill = (t: string) => t.replace(/\$(\d)/g, (_x, i: string) => m![Number(i)] ?? "");
    const read = m && actorVerb(phrase, control, fill(as));
    if (read) return narrow(read, fill(narrowing), true);
  }
  // "an opponent puts one or more counters on a creature they control".
  const put = /^puts? ((?:one or more|a|an) (?:[a-z+\-/\d]+ )?counters? on .+)$/.exec(tail);
  // "a creature THEY control" is the actor's.
  const counters = put && countersPut(put[1]!.replace(/ they control$/, control === "opp" ? " an opponent controls" : control === "you" ? " you control" : " they control"));
  if (counters) return counters;
  // "you attack A PLAYER with one or more creatures with power 4 or greater", "you attack enchanted
  // player": the defender narrows the attack.
  const defender = /^attacks? (a player or planeswalker|a player|enchanted player|enchanted opponent|the player who has the initiative|enchanted opponent or a planeswalker they control|you or a planeswalker you control)(?: with (.+))?$/.exec(tail);
  if (defender) {
    const read = actorVerb(phrase, control, defender[2] ? `attack with ${defender[2]}` : "attack");
    if (read) return { ...read, narrowing: [defender[1], read.narrowing].filter(Boolean).join(" ") };
  }
  // "you get one or more {E}": energy counters on you (CR 107.14).
  if (/^gets? one or more \{e\}$/i.test(tail)) {
    const you = parse(phrase);
    if (you) return reading("counter-added", { ...you, counter: "energy" }, control);
  }
  // "you remove a counter this way", "you remove the last intervention counter from this enchantment".
  const removed = /^removes? (?:a|one or more|the (last)) ((?:[a-z+\-/\d]+ )?counters?)(?: from (.+))?$/.exec(tail);
  if (removed) {
    const kind = /^counters?$/.test(removed[2]!) ? undefined : parseCounter(removed[2]!);
    const on = removed[3] ? subjectOf(removed[3]) : { control: "any" as const, token: null };
    if (on && (kind || /^counters?$/.test(removed[2]!))) {
      const r = reading("counter-removed", kind ? { ...on, counter: kind } : on, on.self ? "you" : control);
      return removed[1] ? { ...r, narrowing: removed[1] } : r;
    }
  }
  {
    // "you NEXT cast": the first such event, a narrowing.
    if (tail.startsWith("next ")) {
      const read = actorVerb(phrase, control, tail.slice(5));
      if (read) return narrow(read, "next", true);
    }
    if (tail.startsWith("win a coin flip") || tail.startsWith("wins a coin flip")) return actorVerb(phrase, control, "flip a coin") && { ...actorVerb(phrase, control, "flip a coin")!, narrowing: "win" };
    // "you roll a 6", "you roll a 4 or higher", "you roll your third die each turn": a result or an
    // ordinal of the roll.
    const roll = /^rolls? (a \d.*|a natural \d+|a die's .+|your \w+ die each turn)$/.exec(tail);
    if (roll) return actorVerb(phrase, control, "roll a die") && { ...actorVerb(phrase, control, "roll a die")!, narrowing: roll[1]! };
    const one = actorVerb(phrase, control, tail);
    if (one) return one;
    // "you cycle or discard a card", "you cast or copy a spell", "you play a land or cast a spell":
    // split at an "or" whose right side is a verb phrase; a bare left verb shares the right's object.
    for (let at = tail.indexOf(" or "); at >= 0; at = tail.indexOf(" or ", at + 1)) {
      const left = tail.slice(0, at), right = tail.slice(at + 4);
      const r = actorVerb(phrase, control, right);
      if (!r) continue;
      const l = actorVerb(phrase, control, left) ?? (!left.includes(" ") ? actorVerb(phrase, control, `${left} ${right.split(" ").slice(1).join(" ")}`) : null);
      if (l) return [l, r];
    }
    // "you waterbend, earthbend, firebend, or airbend", "an opponent scries, surveils, or searches their
    // library": a comma list of bare verbs.
    const list = tail.split(/, (?:or |and )?| or /);
    if (list.length > 2) {
      const out = list.map((v) => actorVerb(phrase, control, v));
      if (out.every((r) => r !== null)) return out as TriggerReading[];
    }
  }
  return null;
}

/** "One or more +1/+1 counters are put on this creature", "you put one or more +1/+1 counters on a
 *  creature you control": the recipient is the subject, the kind is its `counter`. */
const COUNTERS_PUT = /^(?:you put )?(?:one or more|a|an|the (\w+)) ((?:(?:[+-]\d\/[+-]\d|[a-z]+) )?counters?) (?:(?:is|are) put )?on (.+)$/;
const COUNTERS_REMOVED = /^(?:one or more|a|an|the (last)) ((?:(?:[+-]\d\/[+-]\d|[a-z]+) )?counters?) (?:is|are) removed from (.+)$/;

function countersRemoved(rest: string): TriggerReading | null {
  const m = COUNTERS_REMOVED.exec(rest);
  if (!m) return null;
  const bare = /^counters?$/.test(m[2]!);
  const kind = bare ? undefined : parseCounter(m[2]!);
  const subject = subjectOf(m[3]!);
  if ((!kind && !bare) || !subject) return null;
  const r = reading("counter-removed", kind ? { ...subject, counter: kind } : subject, subject.self ? "you" : subject.control);
  return m![1] ? { ...r, narrowing: m![1] } : r;
}

function countersPut(rest: string): TriggerReading | null {
  const m = COUNTERS_PUT.exec(rest);
  if (!m) return null;
  // No kind printed ("one or more counters") is any kind; a printed kind the counter list does not
  // know refuses.
  const kind = /^counters?$/.test(m[2]!) ? undefined : parseCounter(m[2]!);
  const subject = subjectOf(m[3]!);
  if ((kind === undefined && !/^counters?$/.test(m[2]!)) || !subject) return null;
  const r = reading("counter-added", kind ? { ...subject, counter: kind } : subject, subject.self ? "you" : subject.control);
  // "The FOURTH plan counter": that one, not every one.
  return m[1] ? { ...r, narrowing: m[1] } : r;
}

/** "A source deals damage to THIS CREATURE": the recipient's event. A dealer narrower than "a source"
 *  is a narrowing. */
const DEALT_TO = /^(.+?) deals? (combat |noncombat )?damage to (.+)$/;

function damageReceived(rest: string): TriggerReading | null {
  const m = DEALT_TO.exec(rest);
  if (!m) return null;
  const recipient = subjectOf(m[3]!) ?? (m[3] === "you" ? parse("you") : null);
  // The card itself, or you from any source. "A CREATURE deals combat damage to you" stays the dealer's
  // event (the generic template below), which is how the store and derive read it.
  if (!recipient || !(recipient.self || m[3] === "you" && m[1] === "a source")) return null;
  const r = reading("damaged", recipient, recipient.self ? "you" : "you");
  const kind = m[2]?.trim() as "combat" | "noncombat" | undefined;
  return { ...r, ...(kind ? { damage: kind } : {}), ...(m[1] !== "a source" ? { narrowing: `by ${m[1]}` } : {}) };
}

function bodyPlain(text: string): TriggerReading | TriggerReading[] | null {
  if (text === "when you do") return { event: "reflexive" };
  let m = /^at the beginning of (.+)$/.exec(text);
  if (m) return phaseTrigger(m[1]!);
  if (text === "at end of combat") return actorReading("end-of-combat", "any");
  if (text === "at end of combat on your turn") return actorReading("end-of-combat", "you");
  if (text === "when they do") return { event: "reflexive" };
  m = /^(?:when|whenever) (.+)$/.exec(text);
  if (!m) return null;
  const rest = m[1]!;
  for (const [re, event, control] of SUBJECTLESS) if (re.test(rest)) return { event, control };
  if (STATE.test(rest)) return { event: "state", control: "you", narrowing: rest };
  const along = ALONG_WITH.exec(rest);
  if (along) {
    const read = objectReading(`${along[1]} ${along[3]}`);
    return read && withNarrowing(read, along[4] ? `${along[2]} ${along[4]}` : along[2]!);
  }
  return special(rest) ?? countersPut(rest) ?? countersRemoved(rest) ?? damageReceived(rest) ?? actorReadings(rest) ?? objectReading(rest) ?? eitherTrigger(rest);
}

/** "A spell or ability an opponent controls CAUSES you to discard a card": the caused event, read as
 *  its own trigger, narrowed by its cause. */
const SPECIAL: [RegExp, (m: RegExpExecArray) => TriggerReading | TriggerReading[] | null][] = [
  // "That mana is spent to cast a red instant or sorcery spell" (a mana ability's own delayed trigger).
  [/^that mana is spent to cast (.+)$/, (m) => {
    const loose = looseSubject(m[1]!);
    return loose && { ...reading("mana-spent", loose.subject, "you"), narrowing: ["that mana", loose.narrowing].filter(Boolean).join(" ") };
  }],
  // "The final chapter ability of a Saga you control resolves / triggers" (CR 714.2b).
  [/^the final chapter ability of (.+) (?:resolves|triggers)$/, (m) => {
    const saga = subjectOf(m[1]!);
    return saga && { ...reading("chapter", saga, saga.control), narrowing: "final" };
  }],
  // "An ability of equipped creature is activated", "a mana ability of this creature resolves".
  [/^an ability of (.+) is activated$/, (m) => {
    const of = subjectOf(m[1]!), ability = parse("an activated ability");
    return of && ability && { ...reading("activate", ability, of.control), narrowing: `of ${m[1]}` };
  }],
  [/^a mana ability of (.+) resolves$/, (m) => {
    const of = subjectOf(m[1]!);
    return of && reading("tapped-for-mana", of, of.self ? "you" : of.control);
  }],
  // "A spell or ability you control counters a spell", "... destroys a noncreature permanent you control".
  [/^(a spell or ability(?: you control| an opponent controls)?) (counters|destroys) (.+)$/, (m) => {
    const loose = looseSubject(m[3]!);
    if (!loose) return null;
    const event = m[2] === "counters" ? "countered" : "dies";
    return { ...reading(event, loose.subject, loose.subject.self ? "you" : loose.subject.control), narrowing: [`${m[2] === "counters" ? "countered" : "destroyed"} by ${m[1]}`, loose.narrowing].filter(Boolean).join(" ") };
  }],
  [/^(?:combat )?damage is dealt to (you(?: or a planeswalker you control)?|one of the chosen players)$/, (m) => {
    const you = parse("you"), player = parse("a player");
    const r = m[1]!.startsWith("you") ? you && reading("damaged", you, "you") : player && reading("damaged", player, "any");
    const narrowing = [m[1] === "you" ? "" : m[1]!.startsWith("you") ? "or a planeswalker you control" : "one of the chosen players"].filter(Boolean).join(" ");
    return r && { ...r, ...(m[0]!.startsWith("combat") ? { damage: "combat" as const } : {}), ...(narrowing ? { narrowing } : {}) };
  }],
  [/^(.+?) causes? (.+?) to (.+)$/, (m) => {
    const caused = causedEvent(m[2]!, m[3]!);
    return caused && withNarrowing(caused, `caused by ${m[1]}`);
  }],
  [/^(excess )?damage is dealt to (.+)$/, (m) => {
    const loose = looseSubject(m[2]!);
    return loose && { ...reading("damaged", loose.subject, loose.subject.self ? "you" : loose.subject.control), ...(m[1] || loose.narrowing ? { narrowing: [m[1]?.trim(), loose.narrowing].filter(Boolean).join(" ") } : {}) };
  }],
  // "When this creature's echo cost is paid", "its power becomes 20 this way": named only.
  [/^((?:~|this [a-z]+)'s|its) (echo cost is paid|cumulative upkeep is paid|power becomes \d+)$/, (m) => {
    const self = m[1] === "its" ? { control: "any" as const, token: null, ref: "sentence" as const } : subjectOf(m[1]!.slice(0, -2));
    return self && { ...reading("other", self, self.self ? "you" : "any"), narrowing: m[2]! };
  }],
  // "it's put into a graveyard this turn": the contraction.
  [/^it's (.+)$/, (m) => objectReading(`it is ${m[1]}`)],
];

function special(rest: string): TriggerReading | TriggerReading[] | null {
  for (const [re, read] of SPECIAL) {
    const m = re.exec(rest);
    const r = m && read(m);
    if (r) return r;
  }
  return null;
}

/** "causes YOU TO DISCARD a card" -> "you discard a card"; "causes A LAND TO BE PUT into your
 *  graveyard" -> "a land is put into your graveyard". */
function causedEvent(who: string, verb: string): TriggerReading | TriggerReading[] | null {
  const passive = /^be (.+)$/.exec(verb);
  if (passive) return objectReading(`${who} is ${passive[1]}`);
  const third = who === "you" ? verb : verb.replace(/^(\w+?)(s|sh|ch)?\b/, (w) => /(?:s|sh|ch)$/.test(w) ? `${w}es` : `${w}s`);
  return actorReadings(`${who} ${third}`) ?? actorReadings(`${who} ${verb}`);
}

/** Two whole triggers joined by "or": "a player casts a spell or a creature attacks", "you cast a
 *  black spell or a Swamp you control enters", "~ enters or a planeswalker you control dies". */
function eitherTrigger(rest: string): TriggerReading[] | null {
  for (let at = rest.indexOf(" or "); at >= 0; at = rest.indexOf(" or ", at + 1)) {
    const left = bodyPlain(`when ${rest.slice(0, at).replace(/,$/, "")}`), right = bodyPlain(`when ${rest.slice(at + 4)}`);
    if (left && right) return [left, right].flat();
  }
  return null;
}

/** Add a narrowing to a reading, KEEPING what it already carries: "you NEXT cast a spell WITH {X} IN
 *  ITS MANA COST this turn" narrows three ways at once. */
const narrow = (r: TriggerReading, n: string, front = false): TriggerReading =>
  ({ ...r, narrowing: r.narrowing ? (front ? `${n} ${r.narrowing}` : `${r.narrowing} ${n}`) : n });
const withNarrowing = (read: TriggerReading | TriggerReading[], narrowing: string, front = false): TriggerReading | TriggerReading[] =>
  Array.isArray(read) ? read.map((r) => narrow(r, narrowing, front)) : narrow(read, narrowing, front);

const ONCE_PER_TURN = / for the first time each turn$/;

/** A whole trigger, peeling narrowings off the end until the rest reads. */
function body(text: string): TriggerReading | TriggerReading[] | null {
  if (ONCE_PER_TURN.test(text)) {
    const read = body(text.replace(ONCE_PER_TURN, ""));
    return read && (Array.isArray(read) ? read.map((r) => ({ ...r, oncePerTurn: true as const })) : { ...read, oncePerTurn: true });
  }
  const narrowed: string[] = [];
  for (let t = text; ;) {
    const read = bodyPlain(t);
    if (read) return narrowed.length ? withNarrowing(read, narrowed.reverse().join(" ")) : read;
    const tail = NARROWING_TAIL.exec(t);
    if (!tail) return null;
    narrowed.push(tail[1]!);
    t = t.slice(0, tail.index);
  }
}

/** Two triggers in one preamble: "when you cycle this card and when this creature dies", "when this
 *  creature enters and at the beginning of your upkeep". */
const AND_TRIGGER = / (?:and|or) (?=(?:when|whenever|at the beginning of) )/;

/** The trigger a printed preamble states, or null when any word of it is unread. `condition` is the
 *  intervening if's text (`interveningIfOf`), carried onto every reading. */
/** A COUNT of objects ("you attack with THREE OR MORE creatures"): the filter grammar reads the class
 *  and drops the number, so it rides as a narrowing rather than reading every attack. */
const COUNT = /\b(?:two|three|four|five|six|seven|eight|nine|ten|\d+) or more [a-z]+/i;

function withCount(read: TriggerReading, text: string): TriggerReading {
  const count = COUNT.exec(text)?.[0];
  if (!count || read.narrowing?.includes(count) || read.event === "state") return read;
  return { ...read, narrowing: read.narrowing ? `${read.narrowing} ${count}` : count };
}

export function parseTrigger(preamble: string, condition: string | null): TriggerReading | TriggerReading[] | null {
  // Template words are printed lower-case after the opener, so only the openers fold; subject words
  // keep their case for the filter grammar ("a Goblin").
  const text = preamble.trim().replace(/\s+/g, " ").replace(/(^| and | or )(When|Whenever|At)\b/g, (_w, a: string, b: string) => a + b.toLowerCase());
  loosePass = false;
  let halves = text.split(AND_TRIGGER).map(body);
  if (halves.some((r) => r === null)) {
    loosePass = true;
    halves = text.split(AND_TRIGGER).map(body);
    loosePass = false;
  }
  if (halves.some((r) => r === null)) return null;
  const counted = text.split(AND_TRIGGER).map((t, i) => [halves[i]!].flat().map((r) => withCount(r, t)));
  const read = counted.length === 1 && counted[0]!.length === 1 ? counted[0]![0]! : counted.flat();
  if (condition === null) return read;
  const cond = { family: conditionFamily(condition), text: condition };
  return Array.isArray(read) ? read.map((r) => ({ ...r, condition: cond })) : { ...read, condition: cond };
}
