/** THE ONE PARSE OF A GATE (#1191; an effect's trailing "if" reads through it too, #1357): the verbatim lowercase condition ("you control a dragon") becomes a `Gate` (a mana line's `ManaGate` is the same type), once, in derive. Before this three regex grammars read the
 *  string (gate.ts, goldfish.ts, and the verge branch of land-conditions.ts); a gate one of them missed was unmet everywhere (the five "...or if you control a basic land" lands were a source
 *  of no colour in any deck). The matcher's gate.ts is the only EVALUATOR of the result; nothing outside this file parses the words of a gate.
 *  CEILING: "this land entered this turn or if you control a basic land" (Gleaming Bastion) reads only its second alternative: the entry-turn alternative is dropped, which under-claims the
 *  turn the land enters and nothing after it (the safe direction).
 *  THREE KINDS A DECKLIST CAN ESTIMATE (#1267, owner 2026-10-17): a count of cards in your graveyard (`threshold`), counters on the card itself (`counter`) and something that happened earlier this turn
 *  (`turn-event`). Each is read by its WORDING, never by a card name, with one bounded regex apiece (no nested quantifier, no `\s*...$` tail: CodeQL's polynomial-ReDoS rule).
 *  CEILING: a gate that is anything else (a game state, "a land named wastes", a trigger, "it was bargained") is `unknown`, which every consumer treats as unmet.
 *  A graveyard gate reads "N cards", of the supertype, type or subtype it names: The Grey Havens's "there is a legendary creature card in your graveyard" keeps all of it. A qualifier it cannot read (a colour, "nonland")
 *  is `unknown`, never an untyped count. */
import type { Gate, TurnEvent } from "../schema.js";

const COUNT: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
/** "you control a dragon", "you control three or more artifacts", "you control a plains or a swamp". */
const CONTROL = /^you control (?:(an?)|(\w+) or more) (.+)$/;
const SAME_NAME = /^you control (?:(an?)|(\w+) or more) lands with the same name$/;
const BASIC = /^(?:this land entered this turn or if )?you control a basic land$/;
const POWER = /^you control a creature with power (\d+) or greater$/;
/** "you control an urza's mine and an urza's tower" -- two named lands; the subtype is printed with a hyphen ("urza's power-plant"). Only the Urza's lands (#1357): an effect's "if you control an artifact and an enchantment"
 *  (Okiba Salvage) names two kinds of permanent, not two lands, and read as this it was a tron gate. */
const TRON = /^you control (?:an?|the) (urza's .{1,40}?) and (?:an?|the) (urza's .{1,40})$/;

/** "there are seven or more cards in your graveyard", "there is an elf card in your graveyard", "there are two or more instant and/or sorcery cards in your graveyard". Your graveyard only. */
const GRAVEYARD = /^there (?:is|are) (?:(an?)|(\w+) or more) (?:(legendary|basic|snow) )?(?:([a-z]+(?: and\/or [a-z]+)?) )?cards? in your graveyard$/;
/** Words a graveyard gate's qualifier can be that are neither a card type nor a subtype: a count of these is not read (unknown), never taken for a subtype. */
const NOT_A_TYPE: ReadonlySet<string> = new Set(["white", "blue", "black", "red", "green", "multicolored", "colorless", "colourless", "historic", "nonland", "noncreature", "nontoken", "permanent", "nonbasic"]);
/** "there are three or more brick counters on this artifact" / "there are three or more collection counters on it". */
const COUNTERS_THERE = /^there (?:is|are) (?:(an?)|(\w+) or more) (\S{1,20}) counters? on (?:it|this [a-z]+)$/;
/** "this creature has a +1/+1 counter on it", "gemstone caverns has a luck counter on it": the holder is the card (`this <type>`, `it` or its own name), never another object. */
const COUNTERS_HAS = /^([a-z][a-z' ,-]{0,40}?) has (?:(an?)|(\w+) or more) (\S{1,20}) counters? on (?:it|this [a-z]+)$/;
const NOT_THE_CARD = /^(?:enchanted|equipped|target|that|those|each|another|an?|you|your|its|the)\b/;
const TURN_EVENTS: ReadonlyMap<string, TurnEvent> = new Map<string, TurnEvent>(Object.entries({
  "an opponent lost life this turn": "opponent-lost-life", "a creature died this turn": "creature-died", "you attacked this turn": "attacked",
  "a permanent left the battlefield under your control this turn": "permanent-left", "you played a land this turn": "land-played",
}) as [string, TurnEvent][]);
const ENTERED = /^this [a-z]+ entered this turn$/;
/** "an opponent has cast a blue or black spell this turn" (Veil of Summer), "an opponent cast a blue spell this turn": a spell an OPPONENT cast, which no decklist supplies. The colours are one or two words (bounded). */
const OPPONENT_CAST = /^an opponent (?:has )?cast an? [a-z]{1,20}(?: or [a-z]{1,20})? spell this turn$/;
/** The card types a graveyard gate can name; anything else it names is a subtype ("an elf card"). */
const CARD_TYPES: ReadonlySet<string> = new Set(["artifact", "battle", "creature", "enchantment", "instant", "kindred", "land", "planeswalker", "sorcery"]);

const countOf = (w: string): number | undefined => (Object.hasOwn(COUNT, w) ? COUNT[w] : undefined);
const singular = (w: string): string => (w.endsWith("s") && !w.endsWith("ss") && w !== "plains" ? w.slice(0, -1) : w);

export function parseGate(raw: string): Gate {
  const text = raw.trim().toLowerCase();
  const unknown: Gate = { kind: "unknown", text };
  if (text === "speed 4") return { kind: "speed", n: 4, text };
  if (text === "you have the initiative") return { kind: "initiative", text };
  if (BASIC.test(text)) return { kind: "control", need: 1, nouns: ["land"], basic: true, text };
  const power = POWER.exec(text);
  if (power) return { kind: "control", need: 1, nouns: ["creature"], minPower: Number(power[1]), text };
  const same = SAME_NAME.exec(text);
  if (same) {
    const need = same[1] ? 1 : COUNT[same[2]!];
    return need === undefined ? unknown : { kind: "same-name", need, text };
  }
  const m = CONTROL.exec(text);
  if (m) {
    const need = m[1] ? 1 : COUNT[m[2]!];
    const phrase = m[3]!;
    if (need !== undefined && !/ and /.test(phrase)) {
      const nouns = phrase.split(/ or (?:an? )?/).map((w) => w.replace(/^an? /, "").trim()).map((w) => (m[1] ? w : singular(w)));
      if (nouns.every((w) => w !== "" && !/\s/.test(w))) return { kind: "control", need, nouns, text };
    }
  }
  const tron = TRON.exec(text);
  if (tron) return { kind: "tron", names: [tron[1]!.trim(), tron[2]!.trim()], text };
  const yard = GRAVEYARD.exec(text);
  if (yard) {
    const need = yard[1] ? 1 : countOf(yard[2]!);
    if (need === undefined) return unknown;
    const words = yard[4] === undefined ? [] : yard[4].split(" and/or ");
    if (words.some((w) => NOT_A_TYPE.has(w))) return unknown;
    const types = words.filter((w) => CARD_TYPES.has(w));
    const subtypes = words.filter((w) => !CARD_TYPES.has(w));
    return { kind: "threshold", zone: "graveyard", need, ...(types.length > 0 ? { types } : {}), ...(subtypes.length > 0 ? { subtypes } : {}), ...(yard[3] !== undefined ? { supertypes: [yard[3]] } : {}), text };
  }
  const there = COUNTERS_THERE.exec(text);
  const has = there ? null : COUNTERS_HAS.exec(text);
  if (there || (has && !NOT_THE_CARD.test(has[1]!))) {
    const [a, n, counter] = there ? [there[1], there[2], there[3]!] : [has![2], has![3], has![4]!];
    const need = a ? 1 : countOf(n!);
    return need === undefined ? unknown : { kind: "counter", counter, need, text };
  }
  const event = TURN_EVENTS.get(text) ?? (ENTERED.test(text) ? "entered-this-turn" : OPPONENT_CAST.test(text) ? "opponent-cast" : undefined);
  if (event) return { kind: "turn-event", event, text };
  return unknown;
}
