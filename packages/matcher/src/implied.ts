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
/** Historic is a printed fact: artifact, legendary, or Saga. `splitTypeLine` keeps supertypes in
 *  `types`, so "Legendary Creature — Human Noble" arrives as ["legendary","creature"] and the
 *  supertype needs no separate field. */
export function isHistoric(types: string[], subtypes: string[]): boolean {
  return types.includes("legendary") || types.includes("artifact") || subtypes.includes("saga");
}

function selfSubject(chars: Characteristics): SubjectFilter {
  const types = chars.types.map((t) => t.toLowerCase());
  const subtypes = chars.subtypes.map((t) => t.toLowerCase());
  const out: SubjectFilter = { control: "you", token: false };
  const type = collapse(types);
  const subtype = collapse(subtypes);
  if (type !== undefined) out.type = type;
  if (subtype !== undefined) out.subtype = subtype;
  if (isHistoric(types, subtypes)) out.historic = true;
  // A legendary card entering IS "another legendary creature you control enters" (Legolas, Gimli,
  // Tinybones Joins Up). Without this the supertype filter cut five real edges: the consumer demanded
  // legendary and the producer's own entry never advertised it, so a legend failed to be a legend.
  if (types.includes("legendary")) out.legendary = true;
  out.power = parseStat(chars.power);
  out.toughness = parseStat(chars.toughness);
  out.manaValue = chars.cmc;
  return out;
}

/** A card's own producer events, derived from its characteristics (not authored by the tagger):
 *  - any nonland card is CAST (instants/sorceries/permanents) -> emits { verb: "cast" };
 *  - any permanent (incl. lands) ENTERS the battlefield -> emits { verb: "enters" }.
 *  So a nonland permanent implies both; instant/sorcery implies cast only; a land implies
 *  enters only (landfall). Every subject carries the card's full types + subtypes.
 *  Every event this function returns carries `implied: true` — the marker that separates
 *  baseline supply (a card merely existing) from authored surplus. `directedReasons` (edges.ts)
 *  reads it on every reason it produces; `combatSelfSupplied` in edges.ts also reads it, but only
 *  for combat verbs; see the comment below. */
export function impliedEvents(chars: Characteristics): GameEvent[] {
  const types = chars.types.map((t) => t.toLowerCase());
  const isLand = types.includes("land");
  const isPermanent = types.some((t) => PERMANENT_TYPES.has(t));
  const subject = selfSubject(chars);
  const out: GameEvent[] = [];
  if (!isLand) out.push({ verb: "cast", subject, implied: true });
  if (isPermanent) out.push({ verb: "enters", subject, implied: true });
  // A creature on the battlefield can attack and connect, exactly as a nonland card can be cast.
  // These only ever reach a consumer that filters on WHICH creature attacks -- see
  // `combatSelfSupplied` in edges.ts for why the generic case forms no edge. `implied: true`
  // marks them as synthetic so that gate applies only to these, never to a card's own AUTHORED
  // attacks/combat-damage emit (goad, Mage Slayer, Saskia).
  if (types.includes("creature")) {
    out.push({ verb: "attacks", subject, implied: true });
    out.push({ verb: "combat-damage", subject, implied: true });
  }
  return out;
}

/** Graveyard-fill events implied by a producer's (already-normalized) emits: mill/discard put an
 *  untyped card into a graveyard; a nontoken leaving the battlefield (a normalized `dies`) also
 *  enters the graveyard carrying its type. Tokens cease to exist, so they add no graveyard card. */
export function impliedGraveyardEvents(emits: GameEvent[]): GameEvent[] {
  const out: GameEvent[] = [];
  for (const e of emits) {
    if (e.verb === "mill" || e.verb === "discard") {
      // Note: this (and authored token-generation emit subjects) carry no power/toughness/manaValue — a stats-conditioned consumer can't distinguish token/creature sizes here (Slice-1 limitation, not a bug).
      out.push({ verb: "enters", subject: { control: e.subject.control, token: null, zone: "graveyard" } });
    } else if (e.verb === "leaves" && e.subject.zone === "battlefield" && e.subject.token !== true) {
      out.push({ verb: "enters", subject: { ...e.subject, zone: "graveyard" } });
    }
  }
  return out;
}

/** Stamp the card's OWN printed types onto a graveyard fill that is the card itself.
 *
 *  `graveyardFillMatches` wildcards an UNTYPED fill onto any typed recursion consumer, and that is
 *  deliberate: a milled card's type is genuinely unknown. But a card sacrificing ITSELF is not
 *  unknown — Myriad Landscape, Buried Ruin and Inventors' Fair all record the object as a bare
 *  "this", so the fill arrived untyped and a LAND hitting the graveyard "supplied" Bloodline
 *  Necromancer's Vampire recursion and Archaeomancer's instant recursion.
 *
 *  Only fills already marked `self` are touched, and only where the fill states no type of its own. */
export function selfFillTypes(events: GameEvent[], chars: Characteristics): GameEvent[] {
  return events.map((e) => {
    if (!(e.verb === "enters" && e.subject.zone === "graveyard" && e.subject.self === true)) return e;
    if (e.subject.type !== undefined || e.subject.subtype !== undefined) return e;
    const types = chars.types.map((t) => t.toLowerCase());
    const subtypes = chars.subtypes.map((t) => t.toLowerCase());
    return { ...e, subject: {
      ...e.subject,
      ...(types.length ? { type: types } : {}),
      ...(subtypes.length ? { subtype: subtypes } : {}),
    } };
  });
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
