/** Layer-1 archetype taxonomy (the strategy layer) for Stage A1 of the deck-quality
 *  spec. Detects a deck's ranked strategy from each nonland card's OWN tight,
 *  mostly-disjoint defining-mechanism signal (ARCHETYPE_SIGNATURE, in `archetype-vocabulary.ts`)
 *  — NOT from mechanism-category edge groups. Edge groups (groupEdgesByArchetype/CATEGORY_MATCH)
 *  intentionally spread a card into every category any of its synergy edges touch and
 *  include broad shared effect-kinds (damage, draw-card, pump), so on real decks nearly
 *  every card lands in nearly every group and confidences inflate toward 1.0 without
 *  discriminating.
 *
 *  THE MEMBER LIST IS THE VOCABULARY (2026-09-06): EDHREC's theme list, classed and keyed there,
 *  with a signature for every member the derived corpus can carry and a declared-only entry for
 *  the rest. Control still has no signal (A17 refused the count); kindred is one parametrised
 *  member, `detectKindred` below. */

import { SUBTYPE_TYPES } from "@edh-seer/tagger/subtypes";
import { ARCHETYPE_LABELS, ARCHETYPE_SIGNATURE, type Archetype, type ArchetypeSignature } from "./archetype-vocabulary.js";
export {
  ARCHETYPE_LABELS, ARCHETYPE_SIGNATURE, ARCHETYPE_VOCABULARY, DETECTABLE, EXCLUDED_THEMES, KINDRED_TRIBES,
  type Archetype, type ArchetypeClass, type ArchetypeEntry, type ArchetypeSignature, type KindredTribe,
} from "./archetype-vocabulary.js";

export interface ArchetypeRanking {
  name: Archetype;
  label: string;
  confidence: number;
}

/** Share of the deck's nonland cards below which a MECHANISM-derived archetype is
 *  treated as noise rather than a real strategy (e.g. a 2-card minor theme shouldn't
 *  be reported as "the deck's archetype"). Applied independently per mechanism
 *  archetype — clearing it is not contingent on any other archetype's confidence.
 *  `combo` is exempt from this floor (see below): combos are binary, not
 *  density-based — a 2-card combo is a real plan regardless of deck size. Tunable. */
const ARCHETYPE_FLOOR = 0.08;

const GOODSTUFF: ArchetypeRanking = { name: "goodstuff", label: ARCHETYPE_LABELS.goodstuff, confidence: 0 };

/** Confidence the top archetype must reach before it may LEAD -- before a report says "this is a
 *  Tokens deck" rather than "these signals are present" (roadmap A15).
 *
 *  THE NAMING LAYERS ARE THE ONLY CODE IN THIS REPO THAT CANNOT SAY "I DON'T KNOW". The persist gate
 *  refuses a card, `unknownTriggers` refuses a near-miss, the tutor gate refuses a bare type -- but
 *  `detectArchetypes` always returns a top row (GOODSTUFF sits at confidence 0 and can never win a
 *  sort), so a deck with no positive identity in this vocabulary gets named whatever ranked second.
 *  Measured: cares-gating the aristocrats signature (roadmap A13) halved the false confidences on
 *  the six owner-named control decks -- zenos 0.43 -> 0.20 -- and moved not one of their labels,
 *  because argmax has nothing else to return.
 *
 *  0.25 comes from the distribution, not from tuning: over the 71 decks the top confidence runs
 *  median 0.19 / p75 0.31, the decks nobody disputes lead at 0.32-0.51 (smooth-criminal 0.32,
 *  rakdos-landfall 0.35, acererak-combo 0.44, naya-spellslinger 0.51), and five of the six control
 *  decks lead at 0.11-0.22. */
export const ARCHETYPE_LEAD_FLOOR = 0.25;

/** The archetype a report may NAME the deck after, or undefined when none is strong enough.
 *  `detectArchetypes`' ranked list is unchanged and every existing consumer keeps reading it --
 *  including `computeBuild`, whose target adjustment reads `strategies[0]` and is a SCORING
 *  question, not a naming one. */
export function dominantArchetype(ranked: readonly ArchetypeRanking[]): ArchetypeRanking | undefined {
  const top = ranked[0];
  return top && top.name !== "goodstuff" && top.confidence >= ARCHETYPE_LEAD_FLOOR ? top : undefined;
}

export interface CardSignal {
  name: string;
  /** The card's own theme tags (from cardThemeTags): "${verb}:${subjectKey}" / "static:${kind}". */
  themeTags: string[];
  /** The subset of `themeTags` the card CARES about -- its triggers and conditions (from
   *  `cardCaresTags`), never what it merely does. A DEMAND-DEFINED archetype (below) counts a card
   *  full when the signature matches here and at `PRODUCER_SHARE` when it matches only the supply
   *  side. Optional: a caller that does not compute it gets the old all-supply behaviour. */
  caresTags?: string[];
  /** The card's own ability effect kinds (ability.effect.kind). */
  effectKinds: string[];
  /** WHAT the card's `token-generation` abilities actually make, one entry per ability: the token's
   *  subtype, or `"creature"` when the subject says so outright. `effectKinds` says a card makes a
   *  token and cannot say whether it is a Zombie or a Treasure, which is the whole of T2b. Optional:
   *  a caller that does not compute it gets the old tag-only behaviour. */
  tokenKinds?: string[];
  /** Voltron-relevant card subtypes: "equipment" always; "aura" only when it enchants a creature. */
  subtypes: string[];
  /** The card's own CARD TYPES, lowercased. The one archetype defined by a type COUNT rather than by
   *  a mechanism needs it, and no tag can express it: `ARCHETYPE_SIGNATURE` keys on theme tags,
   *  effect kinds and subtypes, and "this deck runs 21 planeswalkers" is none of those. Optional so
   *  a caller that does not compute it simply matches no type-defined row. */
  cardTypes?: string[];
  /** PRINTED KEYWORDS, lowercased (`characteristics.keywords`, Scryfall's list). Keyword abilities
   *  and keyword actions alike; the named-mechanic rows of the vocabulary key on nothing else. */
  keywords?: string[];
  /** Every word of the type line, lowercased: types, supertypes, subtypes. The object-class rows
   *  (vehicle, saga, curse ...) read it; `cardTypes` stays the type count. */
  lineWords?: string[];
  /** The card's creature types when it is a creature; `["*"]` for a changeling. Kindred's supply. */
  creatureTypes?: string[];
  /** Creature types this card's abilities NAME in a subject that is not itself -- a lord's "Elves
   *  you control get +1/+1", a trigger's "whenever a Zombie enters". Kindred's demand: the cares
   *  tags carry a trigger's subject (`enters:elf`) but never an effect's, and the lord is the
   *  payoff every kindred deck is built around. */
  namedTypes?: string[];
}

/** A token that is MANA OR A CARD, not a board presence. Making a Treasure is ramp: the go-wide
 *  wincon already excludes these for the same reason (`wincon.ts`), and counting them made every
 *  incidental Treasure maker a Tokens card -- MEASURED, 227 of the 774 token matches across the 71
 *  decks are resource-only, 218 of them Treasure. `any` is NOT here: `create-token:any` is a named
 *  member of the signature, so an untyped token maker still counts. */
export const RESOURCE_TOKENS: ReadonlySet<string> = new Set([
  "treasure", "clue", "food", "blood", "map", "gold", "powerstone", "incubator", "junk",
  // NOT RESOURCES, AND NOT A GO-WIDE PLAN EITHER (roadmap T2b). A Role is an Aura the token layer
  // attaches to a creature -- "Cursed Role" is a debuff you put on THEIR creature -- and an Aura
  // token is the same shape. Neither is a body, and a deck making them is not a Tokens deck.
  "role", "aura",
]);

/** True when every token this card is known to create is one we can identify as NOT a body.
 *
 *  IT READS TWO SOURCES, AND FOR MOST CARDS ONLY THE SECOND ONE EXISTS (roadmap T2b). The guard used
 *  to look only at `create-token:<subtype>` theme tags -- and the Tokens row matches on the EFFECT
 *  KIND as well, which carries no token identity. Measured on the owner's Enchantress deck: `Curse
 *  of Opulence`, `Shiny Impetus`, `An Offer You Can't Refuse` and `Charming Scoundrel` carry no
 *  `create-token:` tag at all, matched on `token-generation`, and voted the deck 18% Tokens on the
 *  strength of Treasure and Gold. The identity was one field away the whole time:
 *  `ability.effect.subject.subtype`.
 *
 *  IT EXCLUDES ONLY WHAT IT CAN NAME, which is the direction this file already takes. Measured over
 *  the 71 calibration decks: of 477 token-generation abilities, 262 say `type: "creature"` outright
 *  and 166 carry a subtype alone -- and that subtype is a real tribe as often as not (thopter,
 *  servo, myr, construct, dalek). A "creature tokens only" rule would drop every one of those, so
 *  the test is the other way round: a card is excluded when every token it makes is on the
 *  non-creature list, and a token this cannot identify keeps its vote. */
function makesOnlyResourceTokens(signal: CardSignal): boolean {
  const made = [
    ...signal.themeTags
      .filter((t) => t.startsWith("create-token:"))
      .map((t) => t.slice("create-token:".length)),
    ...(signal.tokenKinds ?? []),
  ];
  return made.length > 0 && made.every((m) => RESOURCE_TOKENS.has(m));
}

function matchesSignature(signal: CardSignal, sig: ArchetypeSignature): boolean {
  const tagHit =
    sig.tags?.some((t) =>
      t.endsWith(":") ? signal.themeTags.some((tt) => tt.startsWith(t)) : signal.themeTags.includes(t),
    ) ?? false;
  const kindHit = sig.effectKinds?.some((k) => signal.effectKinds.includes(k)) ?? false;
  const subtypeHit = sig.subtypes?.some((s) => signal.subtypes.includes(s)) ?? false;
  const typeHit = sig.cardTypes?.some((t) => (signal.cardTypes ?? []).includes(t)) ?? false;
  const keywordHit = sig.keywords?.some((k) => (signal.keywords ?? []).includes(k)) ?? false;
  const lineHit = sig.lineWords?.some((w) => (signal.lineWords ?? []).includes(w)) ?? false;
  const tokenHit = sig.tokenKinds?.some((k) => (signal.tokenKinds ?? []).includes(k)) ?? false;
  const allHit = sig.allTags !== undefined && sig.allTags.every((t) => signal.themeTags.includes(t));
  const demandHit = sig.demandTags?.some((t) => (signal.caresTags ?? []).includes(t)) ?? false;
  return tagHit || kindHit || subtypeHit || typeHit || keywordHit || lineHit || tokenHit || allHit || demandHit;
}

/** Whether the signature is satisfied by what the card WANTS, as opposed to what it supplies. */
function matchesDemand(signal: CardSignal, sig: ArchetypeSignature): boolean {
  if (signal.caresTags === undefined) return true; // caller computed no demand side: old behaviour
  return [...(sig.tags ?? []), ...(sig.demandTags ?? [])].some((t) =>
    t.endsWith(":") ? signal.caresTags!.some((tt) => tt.startsWith(t)) : signal.caresTags!.includes(t),
  );
}

/** The weight a supply-only card carries toward a DEMAND-DEFINED archetype. The same constant the
 *  theme ranking uses for the same reason (`analyze.ts`'s `PRODUCER_SHARE`): a card that supplies
 *  the event is evidence, and a card that watches for it is the archetype. */
const PRODUCER_SHARE = 0.35;

export function detectArchetypes(
  cardSignals: CardSignal[],
  comboCards: string[],
  nonlandCount: number,
): ArchetypeRanking[] {
  const weightByArchetype = new Map<Archetype, Map<string, number>>();
  // WHICH ARCHETYPES THE DECK ACTUALLY PAYS OFF, for the `requiresDemand` rows below. A type count
  // amplifies a payoff; it never stands in for one.
  const hasPayoff = new Set<Archetype>();
  for (const signal of cardSignals) {
    for (const [archetype, sig] of Object.entries(ARCHETYPE_SIGNATURE) as [Archetype, ArchetypeSignature][]) {
      if (!matchesSignature(signal, sig)) continue;
      if (archetype === "tokens" && makesOnlyResourceTokens(signal)) continue;
      const demand = matchesDemand(signal, sig);
      if (demand) hasPayoff.add(archetype);
      const weight = sig.demandDefined && !demand ? PRODUCER_SHARE : 1;
      const byCard = weightByArchetype.get(archetype) ?? new Map<string, number>();
      byCard.set(signal.name, Math.max(byCard.get(signal.name) ?? 0, weight));
      weightByArchetype.set(archetype, byCard);
    }
  }

  // Signal-derived archetypes must independently clear ARCHETYPE_FLOOR to be listed.
  const ranked = [...weightByArchetype.entries()]
    // A deck with thirty enchantments and nothing caring about them is not an Enchantress deck.
    .filter(([name]) => !ARCHETYPE_SIGNATURE[name]?.requiresDemand || hasPayoff.has(name))
    .map(([name, byCard]) => ({
      name,
      label: ARCHETYPE_LABELS[name],
      confidence: nonlandCount > 0 ? [...byCard.values()].reduce((a, b) => a + b, 0) / nonlandCount : 0,
    }))
    .filter((r) => r.confidence >= ARCHETYPE_FLOOR);

  const kindred = detectKindred(cardSignals, nonlandCount);
  if (kindred) ranked.push(kindred);

  // combo is floor-exempt: a 2+ card combo is real regardless of deck size.
  if (comboCards.length >= 2) {
    ranked.push({
      name: "combo",
      label: ARCHETYPE_LABELS.combo,
      confidence: nonlandCount > 0 ? new Set(comboCards).size / nonlandCount : 0,
    });
  }

  ranked.sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name));
  return ranked.length > 0 ? ranked : [GOODSTUFF];
}

/** Title case for a creature type as a label prints it: "time lord" -> "Time Lord". */
const titleCase = (s: string): string =>
  s.split(" ").map((w) => (w.length === 0 ? w : w[0]!.toUpperCase() + w.slice(1))).join(" ");

/** THE ONE KINDRED MEMBER, parametrised by the deck's creature type (vocabulary 2026-09-06).
 *
 *  THE TYPE IS THE ONE THE PAYOFFS NAME, not the one the bodies happen to share. Humans are on
 *  2,761 corpus cards and a deck can hold twenty of them incidentally; three Elf lords over twelve
 *  Elves is an Elves deck. So the type is the most-named in `namedTypes` and the cares tags, and
 *  the body count only breaks a tie (then alphabetical, so the answer is stable). No payoff, no row
 *  -- the same `requiresDemand` rule as Enchantress: thirty Zombies with nothing caring is a deck
 *  with Zombies in it.
 *
 *  Weight follows every demand-defined row: a payoff counts full, a body at `PRODUCER_SHARE`, a
 *  changeling is a body of every type. CEILING: a family theme (EDHREC's Sea Creatures, Outlaws)
 *  splits across its member types and each is scored alone; `KINDRED_TRIBES` lists the members so a
 *  later pass can pool them. */
export function detectKindred(cardSignals: CardSignal[], nonlandCount: number): ArchetypeRanking | undefined {
  const named = new Map<string, number>();
  const bodies = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const s of cardSignals) {
    for (const t of new Set(s.namedTypes ?? [])) bump(named, t);
    for (const c of s.caresTags ?? []) {
      const i = c.indexOf(":");
      if (i > 0 && !c.slice(i + 1).startsWith("-")) bump(named, c.slice(i + 1));
    }
    for (const t of new Set(s.creatureTypes ?? [])) if (t !== "*") bump(bodies, t);
  }
  // Only a CREATURE type some creature in the deck actually has can be the tribe: a cares subject
  // like `creature`, `land` or `permanent` is a class, not a kindred -- and a reconfigure creature
  // is an Equipment, a Gingerbrute is a Food, a Go-Shintai is a Shrine, and none of those is a
  // tribe either (measured: "Kindred: Equipment" led four Voltron decks before this filter).
  const candidates = [...bodies.keys()].filter(
    (t) => (named.get(t) ?? 0) > 0 && (SUBTYPE_TYPES[t] ?? []).includes("creature"),
  );
  if (candidates.length === 0) return undefined;
  candidates.sort((a, b) => (named.get(b)! - named.get(a)!) || (bodies.get(b)! - bodies.get(a)!) || a.localeCompare(b));
  const type = candidates[0]!;
  let weight = 0;
  for (const s of cardSignals) {
    const payoff = (s.namedTypes ?? []).includes(type) || (s.caresTags ?? []).some((c) => c.endsWith(`:${type}`));
    const body = (s.creatureTypes ?? []).some((t) => t === type || t === "*");
    if (payoff) weight += 1;
    else if (body) weight += PRODUCER_SHARE;
  }
  const confidence = nonlandCount > 0 ? weight / nonlandCount : 0;
  if (confidence < ARCHETYPE_FLOOR) return undefined;
  return { name: "kindred", label: `${ARCHETYPE_LABELS.kindred}: ${titleCase(type)}`, confidence };
}
