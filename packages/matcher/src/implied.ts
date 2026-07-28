import type { Characteristics, GameEvent, SubjectFilter } from "@mtg/tagger";
import { parseStat } from "./stats.js";

const PERMANENT_TYPES = new Set(["creature", "artifact", "enchantment", "planeswalker", "battle", "land"]);

/** Collapse a string list to undefined (empty), a bare string (one), or the array (many) — the
 *  SubjectFilter convention so "x" and ["x"] compare equal downstream. */
function collapse(a: string[]): string | string[] | undefined {
  return a.length === 0 ? undefined : a.length === 1 ? a[0] : a;
}

/** The concrete subject for the card entering/being cast: its own characteristics. token:false
 *  because a printed card entering is never a token; control:"you" because it is yours. */
function selfSubject(chars: Characteristics): SubjectFilter {
  const types = chars.types.map((t) => t.toLowerCase());
  const subtypes = chars.subtypes.map((t) => t.toLowerCase());
  const out: SubjectFilter = { control: "you", token: false };
  const type = collapse(types);
  const subtype = collapse(subtypes);
  if (type !== undefined) out.type = type;
  if (subtype !== undefined) out.subtype = subtype;
  out.power = parseStat(chars.power);
  out.toughness = parseStat(chars.toughness);
  out.manaValue = chars.cmc;
  return out;
}

/** A card's own producer events, derived from its characteristics (not authored by the tagger):
 *  - any nonland card is CAST (instants/sorceries/permanents) -> emits { verb: "cast" };
 *  - any permanent (incl. lands) ENTERS the battlefield -> emits { verb: "enters" }.
 *  So a nonland permanent implies both; instant/sorcery implies cast only; a land implies
 *  enters only (landfall). Every subject carries the card's full types + subtypes. */
export function impliedEvents(chars: Characteristics): GameEvent[] {
  const types = chars.types.map((t) => t.toLowerCase());
  const isLand = types.includes("land");
  const isPermanent = types.some((t) => PERMANENT_TYPES.has(t));
  const subject = selfSubject(chars);
  const out: GameEvent[] = [];
  if (!isLand) out.push({ verb: "cast", subject });
  if (isPermanent) out.push({ verb: "enters", subject });
  return out;
}

/** Graveyard-fill events implied by a producer's (already-normalized) emits: mill/discard put an
 *  untyped card into a graveyard; a nontoken leaving the battlefield (a normalized `dies`) also
 *  enters the graveyard carrying its type. Tokens cease to exist, so they add no graveyard card. */
export function impliedGraveyardEvents(emits: GameEvent[]): GameEvent[] {
  const out: GameEvent[] = [];
  for (const e of emits) {
    if (e.verb === "mill" || e.verb === "discard") {
      out.push({ verb: "enters", subject: { control: e.subject.control, token: null, zone: "graveyard" } });
    } else if (e.verb === "leaves" && e.subject.zone === "battlefield" && e.subject.token !== true) {
      out.push({ verb: "enters", subject: { ...e.subject, zone: "graveyard" } });
    }
  }
  return out;
}

/** The counter-added event a proliferate implies: proliferate gives each chosen permanent another
 *  counter of each kind already there, so it adds counters of an UNKNOWN, board-state-dependent kind
 *  — an untyped counter-added (no `counter`, no type) that a permissive matcher wildcards onto any
 *  counter-matters payoff. control:"you" (you choose what to proliferate). Only `proliferate` implies
 *  it; all other verbs contribute nothing. */
export function impliedCounterEvents(emits: GameEvent[]): GameEvent[] {
  const out: GameEvent[] = [];
  for (const e of emits) {
    if (e.verb === "proliferate") {
      out.push({ verb: "counter-added", subject: { control: e.subject.control, token: null } });
    }
  }
  return out;
}
