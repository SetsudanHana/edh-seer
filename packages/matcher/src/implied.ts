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
  // A card's own cast/enters event must advertise its COLOURS, or every colour-narrowed trigger
  // matches nothing: Aragorn, the Uniter watches white, blue, red and green spells and found none of
  // its own deck. Written even when EMPTY, because "colorless" is a real answer and an absent field
  // would be indistinguishable from "not recorded". 53 cast triggers across 44 corpus cards filter
  // on colour.
  out.colors = chars.colors;
  // A legendary card entering IS "another legendary creature you control enters" (Legolas, Gimli,
  // Tinybones Joins Up). Without this the supertype filter cut five real edges: the consumer demanded
  // legendary and the producer's own entry never advertised it, so a legend failed to be a legend.
  if (types.includes("legendary")) out.legendary = true;
  // Set on BOTH sides for the same reason legendary is: a producer that fetches "a basic land card"
  // must be satisfiable by the basic it actually fetches, and a demand nothing can meet is a
  // silently deleted edge rather than a refused one.
  if (types.includes("basic")) out.basic = true;
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
  // ONE FACE AT A TIME. A card is cast or played as a single face, so each playable face gets its
  // own events and they are never merged into one subject. Merging is what `types` does, and it is
  // right for what a permanent can BE and wrong for what enters or is cast: read as one subject,
  // "Instant // Land" is a land you cast and an instant that enters the battlefield, and
  // "Artifact // Land — Cave" is a land that supplies landfall while being unable to be cast at all.
  // A transform or flip card lists only its front face here, so its back contributes nothing.
  const faces = chars.faces ?? [{ types: chars.types, subtypes: chars.subtypes }];
  const out: GameEvent[] = [];
  const seen = new Set<string>();
  for (const face of faces) {
    const types = face.types.map((t) => t.toLowerCase());
    const isLand = types.includes("land");
    const isPermanent = types.some((t) => PERMANENT_TYPES.has(t));
    // Power and toughness belong to the CREATURE face and to no other. Marang River Regent //
    // Coil and Catch is a 4/4 Dragon and an Instant — Omen; without this the instant half advertises
    // a power of 4 to any stats-conditioned consumer. `cmc` cannot be split the same way — the face
    // mana costs are on the card document and not on `Characteristics` — so an adventure's spell
    // half still reports the creature's mana value. That is a known imprecision, unchanged from
    // when both faces shared one merged subject.
    const stats = types.includes("creature") ? {} : { power: null, toughness: null };
    const subject = selfSubject({ ...chars, ...face, ...stats });
    const push = (verb: GameEvent["verb"]): void => {
      const key = verb + JSON.stringify(subject);
      // Wear // Tear is Instant // Instant: two faces, one event.
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ verb, subject, implied: true });
    };
    if (!isLand) push("cast");
    if (isPermanent) push("enters");
    // A creature on the battlefield can attack and connect, exactly as a nonland card can be cast.
    // These only ever reach a consumer that filters on WHICH creature attacks -- see
    // `combatSelfSupplied` in edges.ts for why the generic case forms no edge. `implied: true`
    // marks them as synthetic so that gate applies only to these, never to a card's own AUTHORED
    // attacks/combat-damage emit (goad, Mage Slayer, Saskia).
    if (types.includes("creature")) {
      push("attacks");
      push("combat-damage");
    }
  }
  // Printed keywords are supply too, and were a dead channel until 2026-08-14. Appended once for the
  // whole card rather than per face: a keyword is printed on the card, not on a face.
  out.push(...keywordEvents(chars));
  return out;
}

/** What a PRINTED KEYWORD supplies, keyed by the keyword and justified by its printed reminder text.
 *
 *  `Characteristics.keywords` arrives free on the Scryfall payload and MTGJSON's 220 keyword
 *  abilities are already generated into `vocabulary.json`, but until now the only reader anywhere in
 *  the matcher was `graph.ts`, drawing keyword nodes for the graph view — nothing in edge formation
 *  looked at it. Measured on the normalized corpus: 23 cards carry Lifelink and never say "gain" in
 *  their own text, and NOT ONE emitted `gain-life`, against 7 corpus consumers watching exactly that.
 *
 *  Each mapping quotes the reminder it comes from. Reminder text is PRINTED DATA mined from the
 *  corpus, which is the same discipline the "never state what a card does from memory" invariant
 *  demands — nothing here is recalled.
 *
 *  DELIBERATE OMISSIONS, so the next reader does not "fix" them:
 *  - **storm** — "copy it for each spell cast before it". A copy put onto the stack is NOT cast, so a
 *    `cast` emit would be a wrong sentence rather than a missing one.
 *  - **prowess, exalted** — "gets +1/+1 until end of turn" is a pump EFFECT, not an emitted event.
 *  - **unearth, persist's and undying's RETURN half** — "return this card ... to the battlefield"
 *    would be a second `enters` on top of the card's own implied one, and double-counting a card's
 *    entry is worse than missing its recursion. Their counters are kept; the re-entry is deferred. */
const KEYWORD_EMITS: Record<string, { verb: GameEvent["verb"]; counter?: string; control?: "you" | "opp"; token?: true; self?: true }[]> = {
  // "Damage dealt by this creature also causes you to gain that much life."
  lifelink: [{ verb: "gain-life" }],
  // "each opponent loses 1 life and you gain that much life."
  extort: [{ verb: "gain-life" }, { verb: "lose-life", control: "opp" }],
  // "Whenever this creature becomes blocked, defending player loses 4 life."
  afflict: [{ verb: "lose-life", control: "opp" }],
  // "defending player sacrifices two permanents of their choice."
  annihilator: [{ verb: "sacrifice", control: "opp" }],
  // "you may sacrifice any number of creatures. It enters with three times that many +1/+1 counters"
  devour: [{ verb: "sacrifice" }, { verb: "counter-added", counter: "+1/+1" }],
  // "exile a nonland card that costs less. You may cast it without paying its mana cost."
  cascade: [{ verb: "cast" }],
  // Every one of these says +1/+1 in its own reminder.
  modular: [{ verb: "counter-added", counter: "+1/+1" }],
  evolve: [{ verb: "counter-added", counter: "+1/+1" }],
  mentor: [{ verb: "counter-added", counter: "+1/+1" }],
  training: [{ verb: "counter-added", counter: "+1/+1" }],
  graft: [{ verb: "counter-added", counter: "+1/+1" }],
  riot: [{ verb: "counter-added", counter: "+1/+1" }],
  bloodthirst: [{ verb: "counter-added", counter: "+1/+1" }],
  undying: [{ verb: "counter-added", counter: "+1/+1" }],
  // "return it to the battlefield ... with a -1/-1 counter on it."
  persist: [{ verb: "counter-added", counter: "-1/-1" }],
  // "damage to creatures in the form of -1/-1 counters and to players in the form of poison counters"
  infect: [{ verb: "counter-added", counter: "-1/-1" }, { verb: "counter-added", counter: "poison" }],
  // "Players dealt combat damage by this creature also get three poison counters."
  toxic: [{ verb: "counter-added", counter: "poison" }],
  // "Put a +1/+1 counter on an Army you control. ... create a 0/0 black Zombie Army creature token"
  amass: [{ verb: "counter-added", counter: "+1/+1" }, { verb: "create-token", token: true },
          { verb: "enters", token: true }],
  // "put two +1/+1 counters on it OR create two 1/1 colorless Servo artifact creature tokens."
  fabricate: [{ verb: "counter-added", counter: "+1/+1" }, { verb: "create-token", token: true },
              { verb: "enters", token: true }],
  // "Create a token that's a copy of it, except it's a white Zombie ... with no mana cost."
  embalm: [{ verb: "create-token", token: true }, { verb: "enters", token: true }],
  eternalize: [{ verb: "create-token", token: true }, { verb: "enters", token: true }],
  // "To populate, create a token that's a copy of a creature token you control."
  populate: [{ verb: "create-token", token: true }, { verb: "enters", token: true }],
  // "you may create a token copy that's tapped and attacking that player"
  myriad: [{ verb: "create-token", token: true }, { verb: "enters", token: true }],
  // "Cycling {3} ({3}, Discard this card: Draw a card.)" — the largest single keyword gap in the
  // corpus at 393 printed cards, of which only 3 of the 33 present in the derived corpus emitted a
  // `draw`. The discard also reaches recursion payoffs, via `impliedGraveyardEvents`.
  cycling: [{ verb: "discard", self: true }, { verb: "draw" }],
  // "Plainscycling {2} ({2}, Discard this card: Search your library for a Plains card, reveal it,
  // put it into your hand, then shuffle.)" — the discard is shared with plain cycling, the draw is
  // NOT. A library search is no emitted event, so the discard is all of it. See `keywordEvents` for
  // why this entry has to SUPPRESS the umbrella rather than merely sit beside it.
  typecycling: [{ verb: "discard", self: true }],
};

/** The events a card's PRINTED KEYWORDS supply. Marked `implied: true` like every other synthetic
 *  event, so the self-supply gates in edges.ts treat them as baseline rather than authored surplus. */
export function keywordEvents(chars: Characteristics): GameEvent[] {
  const out: GameEvent[] = [];
  // Keywords arrive with their argument attached ("Ward {2}", "Annihilator 2", "Protection from
  // Demons"), so match on the FIRST word — the same shape `isKeywordLine` uses in the segmenter.
  const keys = (chars.keywords ?? []).map((raw) => String(raw).toLowerCase().split(/[\s{]/)[0]);
  // ONE KEYWORD NARROWS ANOTHER, so the map alone cannot decide this. Scryfall stamps the umbrella
  // `Cycling` on every typecycling card as well as its specific name, but their printed reminder
  // SEARCHES the library where plain cycling draws — Eternal Dragon carries Plainscycling,
  // Landcycling, Typecycling and Cycling at once. 90 of the 393 printed cycling cards are this
  // shape, so honouring the umbrella too would hand every one of them a draw it does not have.
  const emitKeys = keys.includes("typecycling") ? keys.filter((k) => k !== "cycling") : keys;
  for (const k of emitKeys) {
    for (const spec of KEYWORD_EMITS[k] ?? []) {
      out.push({
        verb: spec.verb,
        subject: {
          control: spec.control ?? "you",
          token: spec.token ?? null,
          ...(spec.counter ? { counter: spec.counter } : {}),
          ...(spec.self ? { self: true } : {}),
          // A token this card makes is a creature it did not print on its own type line, so the
          // subject says only what the reminder guarantees: it is a token, and it is a creature.
          ...(spec.token ? { type: "creature" } : {}),
        },
        implied: true,
      });
    }
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
      //
      // `self` is the one thing carried through, because it changes what the fill IS. A discard
      // normally takes an unknown card out of your hand, so an untyped fill is the honest answer and
      // `graveyardFillMatches` wildcards it onto any typed recursion consumer on purpose. A card
      // discarding ITSELF is not unknown — cycling is 303 corpus cards of exactly that shape, plus 9
      // authored self-discards — and `selfFillTypes` downstream stamps its printed types on. Left
      // untyped, Deceptive Landscape (a Land) "enabled" World Breaker returning World Breaker.
      // Mill is never marked self and is left alone: a milled card's type really is unknown.
      out.push({ verb: "enters", subject: {
        control: e.subject.control, token: null, zone: "graveyard",
        ...(e.subject.self === true ? { self: true } : {}),
      } });
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
