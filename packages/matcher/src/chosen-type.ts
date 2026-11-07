import type { CardTags, SubjectFilter } from "@edh-seer/tagger";
import type { DeckCard, Hierarchy } from "./types.js";
import { impliesType } from "./hierarchy.js";
import { CREATURE_SUBTYPES } from "@edh-seer/tagger/subtypes";

const CREATURE_SUBTYPE_SET: ReadonlySet<string> = new Set(CREATURE_SUBTYPES.map((x) => x.toLowerCase()));

/** A subtype guaranteed absent from every card, so an unresolved chooser matches nothing. */
const NO_MATCH = "__none__";

/** Count how many deck cards carry each characteristic subtype.
 *
 *  ONE VOTE PER DISTINCT CARD, NOT PER SLOT -- the same ruling `analyzeDeckStructured` already
 *  applies to relations ("one node per card, with its count", 2026-08-15), and here it is not a
 *  tidiness preference but the difference between a right and a wrong answer. `inputs` is one entry
 *  per COPY, so a deck's basic lands vote as many times as it runs them, and BASIC LAND TYPES ARE
 *  SUBTYPES: measured across the 71 calibration decks, `island` was the top subtype in six of them
 *  and beat the tribe the deck is actually built on --
 *
 *    draguns              island 24 > dragon 22
 *    vnwxt-blue-aggro     island 27 > rogue 10
 *    mono-blue-tribal     island 12 > wizard 12 (lexical tie-break, and a tie is already wrong)
 *
 *  -- so every "choose a creature type" card in those decks chose a LAND type, matched nothing, and
 *  formed no edges. Banner of Kinship, Urza's Incubator, Herald's Horn, Patchwork Banner and
 *  Kindred Discovery between them lost 137 reasons on `draguns` alone. Deduping is enough because
 *  the thing that overwhelmed the count was multiplicity; a singleton tribe is unaffected.
 *
 *  NOT FIXED BY CONSTRAINING TO CREATURE TYPES, which would be the other half of this and is a
 *  separate question: `topSubtype` already filters to the subject's `type` when it has one, and the
 *  choosers that went wrong here carry no type constraint at all. That is a normalization gap, and
 *  it costs money to close; this does not. */
export function deckSubtypeCounts(inputs: DeckCard[]): Map<string, number> {
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  for (const { card, tags } of inputs) {
    if (!tags || seen.has(card.name)) continue;
    seen.add(card.name);
    for (const sub of new Set(tags.characteristics.subtypes.map((s) => s.toLowerCase()))) {
      counts.set(sub, (counts.get(sub) ?? 0) + 1);
    }
  }
  return counts;
}

const arr = (v: string | string[] | undefined): string[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];

/** Pick the deck's most-represented subtype (lexical tie-break); NO_MATCH if the deck has none.
 *  When `types` is non-empty, only subtypes that imply at least one of them (per `hierarchy`)
 *  are eligible candidates. */
function topSubtype(counts: Map<string, number>, hierarchy: Hierarchy, types: string[]): string {
  let best = NO_MATCH;
  let bestN = 0;
  for (const [sub, n] of counts) {
    if (types.length > 0 && !types.some((t) => impliesType(hierarchy, sub, t))) continue;
    if (n > bestN || (n === bestN && sub < best)) {
      best = sub;
      bestN = n;
    }
  }
  return best;
}

/** A CHOSEN COLOUR IS ONE THE DECK PLAYS (#1360). "Creatures you control of the chosen color" (Heraldic Banner) is not
 *  a creature type and not every creature: it is the creatures of one of the five colours, so a colourless one (Metallic
 *  Mimic, Canoptek Spyder) is never in it. With the deck's colour identity known the subject becomes `colors: identity`
 *  (any-of, as `subjectMatches` reads `colors`); a colourless deck can still choose a colour, so it becomes
 *  `colorCount: "colored"`; with no identity (a card page, no commander) it stays `chosenColor`, which `subjectMatches`
 *  reads as "has a colour".
 *  CEILING: the actual choice is ONE colour, and a multicolour deck's identity accepts any of its colours, so a Heraldic Banner
 *  in Esper pumps white, blue and black creatures alike where the game pumps one of them. */
function resolveColor(subject: SubjectFilter, identity: readonly string[] | undefined): SubjectFilter {
  if (subject.chosenColor !== true || identity === undefined) return subject;
  const { chosenColor, ...rest } = subject;
  if (rest.colors !== undefined || rest.colorCount !== undefined) return rest;
  return identity.length > 0 ? { ...rest, colors: [...identity] } : { ...rest, colorCount: "colored" };
}

function resolveSubject(subject: SubjectFilter, counts: Map<string, number>, hierarchy: Hierarchy, identity?: readonly string[]): SubjectFilter {
  if (subject.chosenColor === true) return resolveColor(subject, identity);
  if (subject.chosenType !== true) return subject;
  const { chosenType, ...rest } = subject;
  const top = topSubtype(counts, hierarchy, arr(subject.type));
  return { ...rest, subtype: top };
}

/** EVERY WRITTEN FORM OF A CREATURE SUBTYPE: the singular and its plural ("Elf"/"Elves", "Wolf"/"Wolves", "Fox"/"Foxes", "Faerie"/"Faeries", "Mouse"/"Mice"). Single words only (a multi-word subtype is one token in no oracle text this reads), and three letters or more. */
const SUBTYPE_FORMS: ReadonlySet<string> = (() => {
  const out = new Set<string>();
  for (const raw of CREATURE_SUBTYPE_SET) {
    if (raw.length < 3 || raw.includes(" ")) continue;
    out.add(raw);
    if (raw.endsWith("fe")) out.add(raw.slice(0, -2) + "ves");
    else if (raw.endsWith("f")) out.add(raw.slice(0, -1) + "ves");
    else if (/[^aeiou]y$/.test(raw)) out.add(raw.slice(0, -1) + "ies");
    else if (/(?:s|x|z|ch|sh)$/.test(raw)) out.add(raw + "es");
    else out.add(raw + "s");
  }
  out.add("mice"); out.add("fungi");
  return out;
})();

/** Blank (to spaces, length kept) every span that opens with `open` and ends at the first `close` within `reach` characters, and (by default) without a full stop in between. Linear: one pass, no backtracking. */
function blankSpans(text: string, lower: string, open: string, close: string, reach: number, sentence = true): string {
  const chars = text.split("");
  let from = 0;
  for (;;) {
    const at = lower.indexOf(open, from);
    if (at < 0) break;
    const end = lower.indexOf(close, at + open.length);
    if (end < 0 || end - at > reach || (sentence && lower.slice(at, end).includes("."))) { from = at + open.length; continue; }
    for (let i = at; i < end + close.length; i++) chars[i] = " ";
    from = end + close.length;
  }
  return chars.join("");
}

/** Blank every occurrence of `needle` (compared lower-case). */
function blankAll(text: string, lower: string, needle: string): string {
  if (needle.length < 3) return text;
  const chars = text.split("");
  const n = needle.toLowerCase();
  for (let at = lower.indexOf(n); at >= 0; at = lower.indexOf(n, at + n.length)) for (let i = at; i < at + n.length; i++) chars[i] = " ";
  return chars.join("");
}

/** Does the card's PRINTED text name a creature type? The fallback for what derive does not record: a type named only in a condition ("if you control a Wizard"), a trigger derive dropped ("whenever a Samurai or Warrior you
 *  control attacks alone"), a greatest-of count ("Elementals you control") or a reveal cost ("reveal a Vampire card"). Read after removing what is NOT the card caring:
 *  reminder text in parentheses; the card's own name (and its short name before a comma, and each face's); "this creature"; a token-creation phrase ("create ... token(s)", "amass Orcs"); and "except it's a ... in addition to
 *  its other types" (a copy's added type). The type line is not part of oracle text, so the card's own subtypes are not read at all.
 *  A type is a WORD that starts upper-case (printed subtypes are capitalised, "wall" and "head" are not) and is a singular or plural `CREATURE_SUBTYPES` entry. Linear throughout: indexOf scans and one character pass, no regex over the text.
 *  CEILING: a type named for any reason counts (protection from Clerics, "can't be blocked by Saprolings", "target Dragon"), as does one in another card's name ("named Arachnus Web" is no subtype, but "Sliver Hive" would be); and a
 *  sentence-initial capitalised ordinary word that is also a subtype ("Head", "Seal") reads as a type. */
export function printedTextNamesCreatureType(name: string, oracleText: string | undefined): boolean {
  if (!oracleText) return false;
  let text = oracleText;
  let lower = text.toLowerCase();
  if (lower.length !== text.length) return false;
  // reminder text
  const chars = text.split("");
  let depth = 0;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]!;
    if (c === "(") depth++;
    if (depth > 0) chars[i] = " ";
    if (c === ")" && depth > 0) depth--;
  }
  text = chars.join(""); lower = text.toLowerCase();
  const needles = new Set<string>(["this creature", "this spell", "this permanent"]);
  for (const face of name.split(" // ")) { needles.add(face); needles.add(face.split(",")[0]!); }
  for (const nd of needles) { text = blankAll(text, lower, nd); lower = text.toLowerCase(); }
  text = blankSpans(text, lower, "create", "token", 200); lower = text.toLowerCase();
  text = blankSpans(text, lower, "amass ", " ", 30, false); lower = text.toLowerCase();
  text = blankSpans(text, lower, "except it's", "other types", 120); lower = text.toLowerCase();
  const isWordChar = (c: string): boolean => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "'" || c === "\u2019" || c === "-";
  let i = 0;
  while (i < text.length) {
    if (!isWordChar(text[i]!)) { i++; continue; }
    let j = i;
    while (j < text.length && isWordChar(text[j]!)) j++;
    const first = text[i]!;
    if (first >= "A" && first <= "Z" && SUBTYPE_FORMS.has(lower.slice(i, j))) return true;
    i = j;
  }
  return false;
}

/** DOES THIS CARD CARE ABOUT A CREATURE TYPE? (owner ruling 2026-11-07, #1526 part 2, no-deck view). Read off DERIVED data, never a name: some ability of the card has a subject that names a creature subtype
 *  (`subtype`, or one `anyOf` branch's) or is itself a chosen type -- a trigger subject ("whenever another Elf enters"), a class it acts on (Elvish Archdruid's "Other Elf creatures you control get +1/+1",
 *  a tutor's "search for a Goblin card"), or the class whose triggers it doubles. Left out: a `self` subject (the card's own type line), and the token a `token-generation` / `clone` makes (a Goblin that MAKES a
 *  Goblin token cares about nothing). A land or equipment subtype ("Forest", "Equipment") is not a creature type: the tagger's `CREATURE_SUBTYPES` says which are.
 *  Census 2026-11-07 over 18,040 non-token creature cards: 1,647 care (54 of them changelings; the rest by a trigger, effect, scaling or doublesOf subject, an emit naming a type -- a cost to tap or sacrifice one -- or a chosen type), so Llanowar Elves and Grizzly Bears do not.
 *  CEILING: a tutor or reveal that merely names a type (Boggart Harbinger, Priest of the Wakening Sun) counts as caring, as does a card that names a type it is not itself a member of; both are wider than "lord".
 *  CEILING: the other way, derive does not record a type named only in a CONDITION, a cost REVEAL or a greatest-of count (Akki Ronin's "a Samurai or Warrior attacks alone", Academy Journeymage's "if you control a Wizard", Sunderflock's "Elementals you control",
 *  Sadistic Skymarcher's "reveal a Vampire"), so those kindred payoffs read as not caring and lose the pair. Roughly 560 of the 16,500 losing consumers print one of their own subtypes outside a token or a self reference (a text census, not a count).
 *  Read by `staticEdges` only for an UNRESOLVED chosen type, i.e. with no deck. */
export function caresAboutCreatureType(tags: CardTags, card: { name: string; oracleText?: string }): boolean {
  const hit = caresCache.get(tags);
  if (hit !== undefined) return hit;
  const out = caresFromTags(tags) || printedTextNamesCreatureType(card.name, card.oracleText);
  caresCache.set(tags, out);
  return out;
}

const caresCache = new WeakMap<CardTags, boolean>();

function caresFromTags(tags: CardTags): boolean {
  // THE CREATURE-SUBTYPE LIST, not the hierarchy: the hierarchy lists every card type a subtype appears under, so Forest, Equipment, Food, Shrine, Treasure and Spacecraft read as creature subtypes too.
  const isCreatureType = (sub: string): boolean => CREATURE_SUBTYPE_SET.has(sub.toLowerCase());
  const names = (s: SubjectFilter | undefined): boolean => {
    if (!s || s.self === true) return false;
    if (s.chosenType === true) return true;
    return [...arr(s.subtype), ...(s.anyOf ?? []).flatMap((b) => arr(b.subtype))].some(isCreatureType);
  };
  // A CHANGELING IS EVERY CREATURE TYPE, so it is in whatever type is chosen (deck mode pairs it with the deck's lord for the same reason: `extractCharacteristics` gives it every subtype).
  if ((tags.characteristics.keywords ?? []).some((k) => k.toLowerCase() === "changeling")) return true;
  // A TOKEN MAKER (token-generation, or any ability that emits a created token: "amass Orcs" is a counter-placement that creates an Army) names the type of what it makes, not one it cares about.
  const makesToken = (a: CardTags["abilities"][number]): boolean => a.effect.kind === "token-generation" || (a.emits ?? []).some((e) => e.verb === "create-token");
  return tags.abilities.some((a) => names(a.trigger?.subject) || names(a.doublesOf) || names(a.effect.scalingSubject)
    || (a.effect.kind !== "token-generation" && a.effect.kind !== "clone" && !makesToken(a) && names(a.effect.subject))
    // An EMIT names a type when the card does something to that class: a cost ("Tap five untapped Clerics": a `taps` emit), a sacrifice, a blank effect whose "dies" emit is the chosen type (Tsabo's Decree). Not the TOKEN it
    // makes (`create-token`, or any emit of a `token-generation` ability, or a token subject): an Elf that makes Elf tokens is a body, not a payoff.
    || (!makesToken(a) && (a.emits ?? []).some((e) => e.verb !== "create-token" && e.subject.token !== true && names(e.subject))));
}

/** An unresolved chosen CREATURE type: `chosenType` on a subject whose type is `creature`. Any other chosen-type subject (a card type, a land type, odd or even, "an opponent chooses") is not this. */
const chosenCreatureType = (s: SubjectFilter | undefined): s is SubjectFilter => s?.chosenType === true && arr(s.type).includes("creature");

/** THE NO-DECK READING OF "OF THE CHOSEN TYPE" (owner ruling 2026-11-07, #1526 part 2). With a deck `resolveChosenTypes` has already turned every chosen type into the deck's main creature type. With none (a card
 *  page, a partner suggestion, the compass's pair isolation) the type is unresolved, and `subjectMatches` does not read the flag, so Metallic Mimic paired with every creature (an anthem). The ruling: such a card pairs
 *  ONLY with creatures that care about a creature type (`caresAboutCreatureType`). This is the tags half of it: the card with every ability that DEMANDS an unresolved chosen creature type blanked, for
 *  `directedReasons` to use when the OTHER card does not care. Returns the same object when there is nothing to refuse; memoised, because event caches key on the tags object.
 *
 *  BLANKED, NOT RESOLVED TO "NO TYPE": the first cut gave the subject an unmatchable subtype (what `resolveChosenTypes` does for a deck with no subtypes) and it leaked -- an untyped graveyard fill
 *  (A.I.M. Scientists) is a wildcard on type AND subtype, so Haunting Voyage still paired with 1,126 creatures under a `graveyard-recursion:__none__` tag. The ability keeps its slot (ability indices are positions,
 *  as `withLiveKills` keeps them) and reads as the blank effect, with no trigger, emits or doubled class.
 *
 *  What is refused is the card's DEMAND for a typed creature: a trigger subject (Kindred Discovery, Vanquisher's Banner), an anthem / cost reduction / counters rider (Metallic Mimic, Herald's Horn), the class a
 *  recursion, a cheat or a copy reaches, the doubled class. What is NOT is the TOKEN a `token-generation` makes of the chosen type (Riptide Replicator, Kindred Charge): that is a supply, it pairs with whatever wants a
 *  token (a doubler), and the type of the token is no demand of anyone's. Molten Echoes keeps its token supply too and loses only the trigger that watches the chosen type.
 *
 *  SCOPE, by the card's printed text, because the derived subject cannot tell the choices apart: only a card that says "creature type" is read, and not one whose chosen type is a NEGATION ("creatures that aren't of the
 *  chosen type": Kindred Dominance, Crippling Fear, Raise the Palisade, Callous Oppressor) or is chosen by an opponent. "Odd or even" (Extinction Event, Zimone's Hypothesis) and a card-type choice have no
 *  "creature type" in them and are left as they were.
 *  CEILING: the scope is a text cue, and only subjects typed `creature` are refused. A chosen-type subject of another type (Cloud Key / Gathering Stone "spell", Ichormoon Gauntlet "permanent", an untyped one) is
 *  left the wildcard it was. A card that prints both a creature-type choice and a negated one would be read as the first. */
const refusedCache = new WeakMap<CardTags, CardTags>();
const NEGATED_OR_OPPONENT_CHOICE = /\b(?:aren't|isn't|not) of the chosen type|\bopponent chooses a creature type/i;
export function refuseUnresolvedChosenTypes(tags: CardTags, oracleText: string | undefined): CardTags {
  const hit = refusedCache.get(tags);
  if (hit) return hit;
  const touches = (a: CardTags["abilities"][number]): boolean => chosenCreatureType(a.trigger?.subject)
    || (a.effect.kind !== "token-generation" && (chosenCreatureType(a.doublesOf) || chosenCreatureType(a.effect.subject) || (a.emits ?? []).some((e) => chosenCreatureType(e.subject))));
  const inScope = /creature type/i.test(oracleText ?? "") && !NEGATED_OR_OPPONENT_CHOICE.test(oracleText ?? "");
  const out = !inScope || !tags.abilities.some(touches) ? tags : {
    ...tags,
    abilities: tags.abilities.map((a) => {
      if (!touches(a)) return a;
      const { trigger: _t, emits: _e, doublesOf: _d, ...rest } = a;
      // A token maker keeps its supply and loses only the trigger that watches the chosen type.
      return a.effect.kind === "token-generation" ? { ...rest, ...(a.emits ? { emits: a.emits } : {}) } : { ...rest, effect: { kind: "" as const } };
    }),
  };
  refusedCache.set(tags, out);
  return out;
}

/** Replace every chosenType:true subject in the card's abilities with the deck's top subtype
 *  among the subject's legal types (or the deck's global top subtype when the subject has no
 *  type constraint). Returns a new CardTags; the input is never mutated. */
export function resolveChosenTypes(tags: CardTags, counts: Map<string, number>, hierarchy: Hierarchy, identity?: readonly string[]): CardTags {
  return {
    ...tags,
    abilities: tags.abilities.map((a) => ({
      ...a,
      trigger: a.trigger
        ? { ...a.trigger, subject: resolveSubject(a.trigger.subject, counts, hierarchy, identity) }
        : a.trigger,
      effect: a.effect.subject
        ? { ...a.effect, subject: resolveSubject(a.effect.subject, counts, hierarchy, identity) }
        : a.effect,
      emits: a.emits?.map((e) => ({ ...e, subject: resolveSubject(e.subject, counts, hierarchy, identity) })),
      // Roaming Throne doubles "a triggered ability of another creature you control of the chosen
      // type": the class it doubles is chosen the same way, and it lives on its own field.
      ...(a.doublesOf ? { doublesOf: resolveSubject(a.doublesOf, counts, hierarchy, identity) } : {}),
    })),
  };
}

/** The land subtypes a deck's lands carry: every land, and the basics alone. */
export interface LandTypes { any: string[]; basic: string[] }

/** THE DECK'S LAND BASE, AS A FACT AN UNTYPED LAND PUT RESOLVES AGAINST (owner ruling 2026-09-16,
 *  recall v6 #197 PuPu UFO -> Valakut). "Put a land card onto the battlefield" promises no Mountain
 *  on its own; in a deck whose lands are Mountains it puts one. Read by `directedReasons` through
 *  `ReasonOptions.landTypes` -- the same deck-aware shape as a chosen type, and like it absent on a
 *  card page. `basic` is the subset a "basic land card" put can reach: Rampant Growth finds a basic
 *  Mountain, never a Smoldering Marsh. Every face of a modal DFC counts, as `impliedEvents` does. */
export function deckLandTypes(inputs: DeckCard[]): LandTypes {
  const any = new Set<string>();
  const basic = new Set<string>();
  for (const { tags } of inputs) {
    if (!tags) continue;
    const chars = tags.characteristics;
    for (const face of chars.faces ?? [{ types: chars.types, subtypes: chars.subtypes }]) {
      const types = face.types.map((t) => t.toLowerCase());
      if (!types.includes("land")) continue;
      for (const s of face.subtypes.map((x) => x.toLowerCase())) {
        any.add(s);
        if (types.includes("basic")) basic.add(s);
      }
    }
  }
  return { any: [...any].sort(), basic: [...basic].sort() };
}
