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

/** A player phrase as an actor: whose the event is. */
const ACTOR: Record<string, Control> = {
  "you": "you", "a player": "any", "each player": "any", "an opponent": "opp", "each opponent": "opp",
  "your opponents": "opp", "one or more opponents": "opp", "another player": "any", "that player": "any",
  "target opponent": "opp", "target player": "any", "one or more players": "any",
};
/** A phase trigger's subject: the player whose step it is. */
const ACTOR_PHRASE: Record<Control, string> = { you: "you", opp: "an opponent", any: "a player" };

/** "your upkeep", "each player's upkeep", "each upkeep", "the end step": whose phase. */
const PHASE_OWNER: Record<string, Control> = {
  "each player's": "any", "each opponent's": "opp", "an opponent's": "opp", "that player's": "any",
  "target opponent's": "opp", "each of your": "you", "your": "you", "each": "any", "the": "any",
  "enchanted player's": "any", "enchanted opponent's": "opp", "each other player's": "opp", "each of that player's": "any",
  "each of enchanted player's": "any",
};
const PHASE_OWNER_RE = new RegExp(`^(${Object.keys(PHASE_OWNER).join("|")}) (.+)$`);
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
const SELF_DISJUNCT = /^(?:~|this [a-z]+) (?:or|and\/or) (?=another |other |one or more other )/i;

/** An Aura's or Equipment's own host ("enchanted creature", "equipped creature") as its class. CEILING:
 *  no `SubjectFilter` field says "the one this card is attached to", so the host reads as its class
 *  -- as wide as derive reads it today. Whose: equip attaches only to a creature you control
 *  (CR 702.6a); an Aura can enchant anyone's. */
const HOST = /^(?:(?:~|this [a-z]+) or )?(enchanted|equipped) (creature|land|artifact|enchantment|permanent|planeswalker|player|opponent)$/;

/** A BACK-REFERENCE in a delayed trigger ("when THAT CREATURE dies this turn", "when it regenerates
 *  this way"): the object the effect before it named, not a class. `ref: "sentence"`, which the
 *  matcher refuses, so it claims nothing rather than every creature. */
const BACK_REF = /^(?:that|the exiled|the returned) ([a-z]+)$|^(it|they)$/;

/** The subject phrase as a filter, or null when the filter grammar cannot read it. */
function subjectOf(phrase: string): SubjectFilter | null {
  const t = phrase.trim();
  const host = HOST.exec(t);
  if (host) {
    const read = parse(`a ${host[2]}`) ?? parse(`an ${host[2]}`);
    return read && { ...read, control: host[1] === "equipped" ? "you" : host[2] === "opponent" ? "opp" : "any" };
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
  if (SELF_NOUN.test(t.toLowerCase())) {
    const noun = t.slice(5);
    const read = parse(`a ${noun}`) ?? parse(`an ${noun}`);
    return { ...(read ?? { token: null }), control: "you", self: true } as SubjectFilter;
  }
  return parse(t);
}

const reading = (event: string, subject: SubjectFilter, control: Control): TriggerReading =>
  ({ event, subject: { ...subject, control }, control });


/** Object verbs: "{S} <verb>", the subject's own controller. Plural and singular both print. A
 *  compound ("enters or attacks", "blocks or becomes blocked") is read part by part. */
/** What a template adds beyond its event. A named group `n` in the template is a narrowing. */
interface VerbPatch { zone?: string; fromZone?: string; damage?: "combat" | "noncombat"; withoutDying?: true }
const OBJECT_VERBS: [RegExp, string, VerbPatch?][] = [
  [/^(?:enters?|enter the battlefield|enters the battlefield)$/, "enters"],
  [/^enters? from (?:a|your) graveyard$/, "enters", { fromZone: "graveyard" }],
  [/^enters? from exile$/, "enters", { fromZone: "exile" }],
  [/^(?:dies|die)$/, "dies"],
  [/^attacks?$/, "attacks"],
  [/^blocks?(?: a creature)?$/, "blocks"],
  [/^blocks? (?<n>(?:a|an|one or more|two or more) .+)$/, "blocks"],
  // Only a creature can block (CR 509.1a), so "by a creature" narrows nothing.
  [/^becomes? blocked(?: by a creature)?$/, "becomes-blocked"],
  [/^becomes? blocked (?<n>by .+)$/, "becomes-blocked"],
  [/^(?:leaves?|leave) the battlefield$/, "leaves"],
  [/^(?:leaves?|leave) the battlefield without dying$/, "leaves", { withoutDying: true }],
  [/^attacks? (?<n>an opponent|one or more players|one of your opponents|defending player|the player with the most life or tied for most life|a player who .+)$/, "attacks"],
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
  [/^(?:is|are) put into (?:a|your|an opponent's|its owner's|their owners'|their owner's) graveyard from the battlefield$/, "dies"],
  [/^(?:is|are) put into (?:a|your|an opponent's|its owner's) graveyard from anywhere$/, "put-into-graveyard"],
  [/^(?:is|are) put into (?:a|your|an opponent's|its owner's) graveyard from (?:your|their|a) library$/, "put-into-graveyard", { fromZone: "library" }],
  [/^(?:is|are) put into exile from the battlefield$/, "exiled"],
  // Last, so a recipient the plain templates read is never a narrowing.
  [/^deals? (?<n>\d+ or more) (?:combat )?damage(?: to (?:a player|an opponent))?$/, "damage-dealt"],
  [/^deals? combat damage (?<n>to .+)$/, "damage-dealt", { damage: "combat" }],
  [/^deals? noncombat damage (?<n>to .+)$/, "damage-dealt", { damage: "noncombat" }],
  [/^deals? damage (?<n>to .+)$/, "damage-dealt"],
];

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
  [/^scry$/, "scry", false],
  [/^surveils?$/, "surveil", false],
  [/^commits? a crime$/, "crime", false],
  [/^expends? \d+$/, "expend", false],
  [/^rolls? (?:a die|one or more dice)$/, "roll-dice", false],
  [/^flips? a coin$/, "flip-coin", false],
  [/^proliferate$/, "proliferate", false],
  [/^searches? (?:their|your) library$/, "search", false],
  [/^(?:fully )?unlocks? (.+)$/, "unlocked", true],
  [/^(?:are|is|'re) dealt damage$/, "damaged", false],
];

/** Events with no subject at all. */
const SUBJECTLESS: [RegExp, string, Control][] = [
  [/^day becomes night or night becomes day$/, "day-night", "any"],
  [/^the ring tempts you$/i, "ring-tempts", "you"],
  [/^players finish voting$/, "vote", "any"],
];

/** A STATE TRIGGER (CR 603.8) watches a condition, not an event: named, and the condition rides as
 *  the narrowing so nothing claims it. */
const STATE = /^(?:(?:you|a player|an opponent) (?:control|controls|don't control|has|have) .+|there (?:are|is) .+|no .+ (?:are|is) on the battlefield|(?:~|this [a-z]+) (?:has|have) .+|(?:~|this [a-z]+)'s power is .+)$/;

function phaseTrigger(rest: string): TriggerReading | null {
  let m = /^combat on (your|each player's|each opponent's|an opponent's|enchanted player's|enchanted opponent's) turn$/.exec(rest);
  if (m) return actorReading("begin-combat", PHASE_OWNER[m[1]!]!);
  if (rest === "each combat") return actorReading("begin-combat", "any");
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
const NARROWING_TAIL = / (alone|tapped|to a planeswalker|an opponent|one or more players|one of your opponents|during combat|a battle|while .+|and isn't blocked|a player|you(?: or a planeswalker you control)?|during (?:your|an opponent's|each opponent's) turn|this turn|each turn|this way|untapped|with (?:two|three) or more creatures|a creature with [a-z]+|to (?:you|a creature|a creature or planeswalker|a permanent|an opponent or a permanent an opponent controls))$/;
/** "Your SECOND spell each turn", "their first noncreature spell": one spell of the class. */
const ORDINAL_OBJECT = /^(?:your|their) (?:first|second|third|fourth|fifth|first or second) (.+)$/;
/** Battalion's "this creature and at least two other creatures attack". */
const ALONG_WITH = /^(.+?) (and at least (?:one|two|three) (?:other )?[a-zA-Z ]+?) (attack)$/;

/** A verb phrase "V1 or V2" (or "V1, V2, or V3") in its parts. */
const verbParts = (v: string) => v.split(/,? or |, /);

function objectReading(rest: string): TriggerReading | TriggerReading[] | null {
  const words = rest.split(" ");
  for (let i = words.length - 1; i >= 1; i--) {
    const verb = words.slice(i).join(" ");
    // The whole phrase first: "becomes the target of a spell OR ability" is one event.
    const match = (part: string) => {
      for (const [re, event, patch] of OBJECT_VERBS) {
        const m = re.exec(part);
        if (m) return { event, patch, narrowing: m.groups?.n };
      }
      return undefined;
    };
    const whole = match(verb);
    const hits = whole ? [whole] : verbParts(verb).map(match);
    if (hits.some((h) => h === undefined)) continue;
    const subject = subjectOf(words.slice(0, i).join(" "));
    if (!subject) continue;
    const control = subject.self ? "you" : subject.control;
    // "blocks or becomes blocked BY A WHITE CREATURE": the narrowing printed last covers every part.
    const narrowing = hits.map((h) => h!.narrowing).find((n) => n !== undefined);
    const out = hits.map((h) => {
      const { event, patch } = h!;
      const patched = { ...subject, ...(patch?.zone ? { zone: patch.zone } : {}), ...(patch?.fromZone ? { fromZone: patch.fromZone } : {}), ...(patch?.withoutDying ? { withoutDying: true as const } : {}) };
      const r = reading(event, patched, control);
      return { ...r, ...(patch?.damage ? { damage: patch.damage } : {}), ...(narrowing ? { narrowing } : {}) };
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
      const subject = parse(`a ${noun}`) ?? parse(`an ${noun}`);
      if (subject) return { ...reading(event, subject, control), narrowing: v[1]! };
      continue;
    }
    const subject = hasObject ? subjectOf(v[1]!) : parse(phrase);
    if (subject) return reading(event, subject, subject.self ? "you" : control);
  }
  return null;
}

function actorReadings(rest: string): TriggerReading | TriggerReading[] | null {
  for (const [phrase, control] of Object.entries(ACTOR)) {
    const sep = phrase === "you" && rest.startsWith("you're ") ? "" : " ";
    if (!rest.startsWith(phrase + sep)) continue;
    const tail = rest.slice(phrase.length + sep.length);
    // "you NEXT cast": the first such event, a narrowing.
    if (tail.startsWith("next ")) {
      const read = actorVerb(phrase, control, tail.slice(5));
      if (read) return { ...read, narrowing: "next" };
    }
    if (tail.startsWith("win a coin flip") || tail.startsWith("wins a coin flip")) return actorVerb(phrase, control, "flip a coin") && { ...actorVerb(phrase, control, "flip a coin")!, narrowing: "win" };
    // "you roll a 6", "you roll a 4 or higher", "you roll your third die each turn": a result or an
    // ordinal of the roll.
    const roll = /^rolls? (a \d.*|a die's .+|your \w+ die each turn)$/.exec(tail);
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
  }
  return null;
}

/** "One or more +1/+1 counters are put on this creature", "you put one or more +1/+1 counters on a
 *  creature you control": the recipient is the subject, the kind is its `counter`. */
const COUNTERS_PUT = /^(?:you put )?(?:one or more|a|an|the (\w+)) ((?:(?:[+-]\d\/[+-]\d|[a-z]+) )?counters?) (?:(?:is|are) put )?on (.+)$/;
const COUNTERS_REMOVED = /^(?:one or more|a|an|the (last)) ((?:[+-]\d\/[+-]\d|[a-z]+) counters?) (?:is|are) removed from (.+)$/;

function countersRemoved(rest: string): TriggerReading | null {
  const m = COUNTERS_REMOVED.exec(rest);
  const kind = m && parseCounter(m[2]!);
  const subject = m && subjectOf(m[3]!);
  if (!kind || !subject) return null;
  const r = reading("counter-removed", { ...subject, counter: kind }, subject.self ? "you" : subject.control);
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
    return read && withNarrowing(read, along[2]!);
  }
  return countersPut(rest) ?? countersRemoved(rest) ?? damageReceived(rest) ?? actorReadings(rest) ?? objectReading(rest) ?? eitherTrigger(rest);
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

const withNarrowing = (read: TriggerReading | TriggerReading[], narrowing: string): TriggerReading | TriggerReading[] =>
  Array.isArray(read) ? read.map((r) => ({ ...r, narrowing })) : { ...read, narrowing };

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
const AND_TRIGGER = / and (?=(?:when|whenever|at the beginning of) )/;

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
  const text = preamble.trim().replace(/\s+/g, " ").replace(/(^| and )(When|Whenever|At)\b/g, (_w, a: string, b: string) => a + b.toLowerCase());
  const halves = text.split(AND_TRIGGER).map(body);
  if (halves.some((r) => r === null)) return null;
  const counted = text.split(AND_TRIGGER).map((t, i) => [halves[i]!].flat().map((r) => withCount(r, t)));
  const read = counted.length === 1 && counted[0]!.length === 1 ? counted[0]![0]! : counted.flat();
  if (condition === null) return read;
  const cond = { family: conditionFamily(condition), text: condition };
  return Array.isArray(read) ? read.map((r) => ({ ...r, condition: cond })) : { ...read, condition: cond };
}
