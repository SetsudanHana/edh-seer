import type { Combo } from "@edh-seer/engine";
import type { DeckCard } from "./types.js";

/** A LOOP'S PAYOFF IS ITS WIN CONDITION (owner, 2026-09-29: "combos create infinite amount of event,
 *  so the payoff becomes wincondition").
 *
 *  The combo index says a loop exists and, in its result text, WHAT it repeats: "Infinite death
 *  triggers, Infinite creature ETB, Near-infinite lifegain". Every card in the deck with a trigger on
 *  one of those events and an effect that reaches the opponents turns the loop into a win, whether
 *  or not the index lists it as a piece -- Gravecrawler and Phyrexian Altar die forever, and the
 *  deck's Blood Artist is what ends the game.
 *
 *  Measured over the 71 calibration decks: 140 of their 156 known combos have at least one such
 *  card elsewhere in the deck.
 *
 *  THE LOOP ITSELF STILL COMES FROM THE INDEX. Deriving loops from this repo's own graph is #726,
 *  and the research behind it found the graph cannot yet hold one to the owner's rules without either
 *  missing most real loops or inventing thousands. This reads the graph only for the half it can
 *  answer: who eats what the loop makes. */

/** One event a loop repeats, as the tags spell a trigger verb, and the object type the result names
 *  when it names one ("creature ETB" -> enters, creature). */
export interface LoopEvent { verb: string; type?: string; token?: true }

/** WHAT A RESULT PHRASE REPEATS. Read from the index's own feature names; "Near-infinite" counts too,
 *  because the index uses it for loops bounded only by something like library size. Mana is left
 *  out: it pays for a win, it is not one. */
const PHRASES: [RegExp, (m: RegExpMatchArray) => LoopEvent[]][] = [
  [/death triggers/, () => [{ verb: "dies", type: "creature" }]],
  // LEAVING IS NOT DYING: a flicker loop's creatures leave through exile, so only "death triggers"
  // feeds a death payoff (Kardur read Dualcaster Mage + Ghostly Flicker as deaths before this).
  [/(?:(\w+) )?ltb/, (m) => [{ verb: "leaves", ...typeOf(m[1]) }]],
  [/(?:(\w+) )?etb/, (m) => [{ verb: "enters", ...typeOf(m[1]) }]],
  [/lifegain/, () => [{ verb: "gain-life" }]],
  [/lifeloss|life loss/, () => [{ verb: "lose-life" }]],
  [/sacrifice triggers/, () => [{ verb: "sacrifice" }]],
  [/card draw|draw triggers/, () => [{ verb: "draw" }]],
  // MAGECRAFT COUNTS COPIES, which are not cast: only a casting loop feeds a cast payoff.
  [/storm count|cast triggers/, () => [{ verb: "cast" }]],
  [/(?:(\w+) )?tokens?/, (m) => [{ verb: "create-token", token: true }, { verb: "enters", ...typeOf(m[1]), token: true }]],
  [/counters/, () => [{ verb: "counter-added" }]],
  [/\bmill\b/, () => [{ verb: "mill" }]],
  [/untap/, () => [{ verb: "untaps" }]],
];
const TYPES = new Set(["creature", "artifact", "enchantment", "land", "planeswalker"]);
function typeOf(word: string | undefined): { type?: string } {
  return word && TYPES.has(word) ? { type: word } : {};
}

export function loopEvents(result: string): LoopEvent[] {
  const out: LoopEvent[] = [];
  for (const raw of result.split(",")) {
    const phrase = raw.trim().toLowerCase();
    if (!/^(near-)?infinite\b/.test(phrase)) continue;
    for (const [rx, read] of PHRASES) {
      const m = phrase.match(rx);
      if (m) { out.push(...read(m)); break; }
    }
  }
  const seen = new Set<string>();
  return out.filter((e) => { const k = `${e.verb}|${e.type ?? ""}|${e.token ?? ""}`; return seen.has(k) ? false : (seen.add(k), true); });
}

/** Effects that end a game when they repeat without end, reaching an opponent. */
const WINS = new Set(["damage", "drain", "player-life-loss", "mill"]);
const UNLIMITED = new Set(["repeatable", "continuous"]);

export interface ComboPayoff {
  /** The payoff card. */
  name: string;
  /** Which of the loop's events it eats, as trigger verbs ("dies", "enters", "gain-life"). */
  on: string[];
  /** What it does to the opponents each time: the effect kind ("drain", "damage", ...). */
  effect: string;
}

type Ability = NonNullable<DeckCard["tags"]>["abilities"][number];

const triggerTypes = (a: Ability): string[] => {
  const t = a.trigger?.subject?.type;
  if (!t) return [];
  return (Array.isArray(t) ? t : [t]).map((x) => String(x).toLowerCase());
};

/** A trigger that fires on the event: same verb, and when both name an object type, the same one.
 *  "Whenever an artifact enters" does not eat a loop of creatures entering. A trigger on what an
 *  OPPONENT does (Massacre Wurm's "a creature an opponent controls dies", Orcish Bowmasters' "an
 *  opponent draws") never eats the deck's own loop. */
function eats(a: Ability, e: LoopEvent): boolean {
  if (!(a.trigger?.verbs ?? []).includes(e.verb as never)) return false;
  if (a.trigger?.subject?.control === "opp") return false;
  // A TOKEN-ONLY TRIGGER (Nadier's Nightblade: "whenever a token you control leaves") eats only a loop
  // that makes tokens, never one that moves a real card.
  if (a.trigger?.subject?.token === true && !e.token) return false;
  const types = triggerTypes(a);
  return !e.type || types.length === 0 || types.includes(e.type) || types.includes("permanent");
}

/** Reaches an opponent: the effect is not aimed at its own controller. */
const reachesOpponent = (a: Ability): boolean => a.effect.subject?.control !== "you";

/** THE CARDS THAT TURN A KNOWN LOOP INTO A WIN, beyond the loop's own pieces.
 *
 *  Two shapes:
 *  - A TRIGGER on one of the loop's events that repeats without a cap and damages, drains, makes an
 *    opponent lose life or mills (Blood Artist on deaths, Impact Tremors on creatures entering).
 *  - A LIFE-TO-DAMAGE SINK (Aetherflux Reservoir): an unlimited ability that pays life to deal damage
 *    or make a player lose life, when the loop gains life -- or when the card itself gains life off
 *    one of the loop's events, which is how Aetherflux eats a casting loop. */
export function comboPayoffs(deck: readonly DeckCard[], combo: Combo): ComboPayoff[] {
  const events = loopEvents(combo.result);
  if (events.length === 0) return [];
  const pieces = new Set(combo.cards);
  const loopGainsLife = events.some((e) => e.verb === "gain-life");
  const out = new Map<string, ComboPayoff>();
  for (const dc of deck) {
    const name = dc.card.name;
    if (pieces.has(name) || out.has(name) || !dc.tags) continue;
    const abilities = dc.tags.abilities;
    for (const a of abilities) {
      if (a.kind !== "triggered" || !UNLIMITED.has(a.repeats ?? "") || !WINS.has(a.effect.kind) || !reachesOpponent(a)) continue;
      const on = events.filter((e) => eats(a, e)).map((e) => e.verb);
      if (on.length > 0) { out.set(name, { name, on: [...new Set(on)], effect: a.effect.kind }); break; }
    }
    if (out.has(name)) continue;
    const sink = abilities.find((a) => a.kind === "activated" && UNLIMITED.has(a.repeats ?? "")
      && (a.effect.kind === "damage" || a.effect.kind === "player-life-loss") && /pay \d+ life/i.test(a.cost ?? ""));
    if (!sink) continue;
    const gainsOn = abilities
      .filter((a) => a.kind === "triggered" && a.effect.kind === "lifegain")
      .flatMap((a) => events.filter((e) => eats(a, e)).map((e) => e.verb));
    if (loopGainsLife || gainsOn.length > 0) {
      out.set(name, { name, on: loopGainsLife ? ["gain-life"] : [...new Set(gainsOn)], effect: sink.effect.kind });
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}
