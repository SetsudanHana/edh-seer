import type { Reason } from "@edh-seer/engine";
import type { CardTags, GameEvent, SubjectFilter } from "@edh-seer/tagger";
import { LAND_SUBTYPES } from "@edh-seer/tagger/subtypes";
/** The closed six, per CR 205.4a plus the un-set `host`/`elite`. A supertype is not a card type and
 *  must never be keyed as one -- see `impliedEntryThemeTags`. */
const SUPERTYPES: ReadonlySet<string> = new Set(["basic", "legendary", "ongoing", "snow", "world", "host", "elite"]);
import type { DeckCard, Hierarchy } from "./types.js";
import { subjectMatches, graveyardFillMatches, counterAddMatches } from "./subject.js";
import { enterAsCopyAbilities, impliedEvents, impliedGraveyardEvents, impliedCounterEvents, isHistoric, keywordAbilities, proliferateAbilities, selfFillTypes, selfLeavesTypes } from "./implied.js";
import { normalizeZoneEvent, zoneEventKey } from "./zones.js";
import { parseStat } from "./stats.js";
import { hasMediatingToken } from "./tokens.js";
import {
  copySentence, costReductionSentence, counterPresenceSentence, createsSentence,
  enterAsCopySentence, fetchSentence, proliferateSentence,
  boardCountFeedsScaling,
  effectTargetNoun,
  emitSubjectNoun, graveyardEnablesRecursion, graveyardFeedsScaling, meldSentence, reasonSentence,
  staticGrantSentence, typeGrantNoun, tutorSentence, winconSentence, doublesSentence, landConditionSentence,
} from "./sentence.js";
import { basicTypeDemand, classifyLand } from "./land-conditions.js";
import { parseTypeLineAllFaces } from "./typeline.js";
import { faceDeckCards } from "./faces.js";

const list = (v: string | string[] | undefined): string[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];

/** A short human/grouping key for a subject: its subtype, else its type, else "any". */
export function themeSubjectKey(s: Partial<SubjectFilter>): string {
  // A NEGATION outranks the list it resolves to. `type` holds the six types "noncreature spell"
  // leaves, and taking the first of them keyed Valley Floodcaller as `cast:artifact` -- a wrong tag
  // for a card that excludes creatures, not one that names artifacts -- and cardThemeTags grouped
  // it with artifact-cast decks on the theme axis. A subtype is more specific still, so it keeps
  // priority over both.
  // A NAME outranks everything below it — it identifies ONE card, which is as specific as a subject
  // gets. Only 10 clauses in the derived corpus carry one, so the theme fragmentation this could
  // cause is bounded, and a name really is its own theme where it appears.
  if (s.named !== undefined) return s.named;
  const negated = s.notType ?? [];
  // A DISJUNCTION holds its type/subtype in the branches, so a subject with `anyOf` has neither on
  // the outside and would key as "any" — turning Prowl's `enters:creature` into `enters:any` and
  // regrouping it with every untyped trigger. The first branch is the one the text names first.
  const first = s.anyOf?.[0];
  if (first !== undefined) return themeSubjectKey(first);
  // An UMBRELLA outranks the list it resolves to, for the same reason a negation does: "permanent
  // spell" resolves to five concrete types, and taking the first keyed Hylda's Crown of Winter --
  // an Artifact -- as `cast:creature`, a wrong tag naming a class the card is not. It ranks BELOW
  // the negation, because "nonland permanent" is more precisely named by what it excludes, and that
  // is the key the panel's verdicts already carry.
  return list(s.subtype)[0]
    ?? (negated.length ? `-${negated[0]}` : undefined)
    ?? s.umbrella
    ?? list(s.type)[0]
    ?? "any";
}

/** A card's set of theme tags (for deck-frequency ranking): one per trigger verb, emit, and
 *  static effect. Mirrors the flat engine's produces∪cares membership. */
/** The theme tags a card earns just by BEING a permanent that enters the battlefield.
 *
 *  `cardThemeTags` read a card's ABILITIES only, so a permanent's own entry contributed nothing:
 *  measured on `braids-mono-black-enchantress`, 36 of 75 nonlands ARE enchantments and only 8
 *  carried `enters:enchantment`, which is why that deck's cohesion read 0.14 once the fold stopped
 *  summing unrelated families into it.
 *
 *  Built off `impliedEvents` rather than re-derived, so the tag says exactly what the matcher
 *  claims -- one face at a time, no `cast` for a token (CR 111.7), a transform card's back face
 *  excluded. ENTRY ONLY: `impliedEvents` also pushes `cast` for every nonland and
 *  `attacks`/`combat-damage` for every creature, and adding those would make every nonland a
 *  `cast:` theme card and every creature an `attacks:` one -- a different and much larger claim.
 *
 *  Supply, never demand, so `cardCaresTags` does NOT get these and they enter `rankFreq` at
 *  `PRODUCER_SHARE` rather than at full weight.
 *
 *  KEYED AT THE SUBTYPE, not the card type, and the alternative was BUILT AND MEASURED rather than
 *  argued (spec §3). A type-level key LOST two subtype-level primaries -- `magar-spellslinger`
 *  `enters:treasure` and `rocket-the-mechanist` `enters:vehicle` both collapsing into
 *  `enters:artifact`, which is the exact collapse the family-ranking design was refused for -- and
 *  took distinct headlines to 20, under the incumbent 21. The subtype key loses none and takes
 *  distinct headlines to 29. Fragmentation is not a hazard here because `computeCohesion` FOLDS
 *  (`theme-fold.ts`), so a deck's Dragons are counted inside the creature family regardless. */
function impliedEntryThemeTags(tags: CardTags): string[] {
  // Absent characteristics (partial fixtures, and any caller holding a hand-built CardTags) yield
  // NO entry tags rather than throwing -- a missing answer, never a crash.
  if (!tags.characteristics) return [];
  // A LAND'S OWN ENTRY IS THE MANA BASE, NEVER A THEME -- the same ruling that keeps a fetchland
  // naming Swamp out of synergy, and that puts ramp and tax in `ROLE_NOT_SYNERGY`. MEASURED, not
  // assumed: without this the first cut of this function themed **38 of 71 decks** on a basic land
  // type -- "islands entering" on 13, "swamps entering" on 8, "mountains entering" on 5 -- because
  // ~35 basics per deck out-count every real theme. A landfall deck still themes `enters:land`
  // through the payoffs that TRIGGER on it and the ramp that AUTHORS it; what is excluded is a
  // Island claiming to be a theme by existing.
  if ((tags.characteristics.types ?? []).some((t) => t.toLowerCase() === "land")) return [];
  return impliedEvents(tags.characteristics)
    .filter((e) => e.verb === "enters")
    .flatMap((e) => {
      const n = normalizeZoneEvent(e);
      // ONE TAG PER SUBTYPE, not one keyed on the first (roadmap A9). `themeSubjectKey` returns a
      // single key and resolves subtypes with `list(subtype)[0]` -- the first as PRINTED -- so a
      // "Human Wizard" keyed `enters:human` and never `enters:wizard`, and printed order decided
      // which. Measured: `inalla`, a WIZARD deck, counted `enters:human` 15 against `enters:wizard`
      // 9, and `marchesa-legends-matter`, a LEGENDS deck, read the headline "humans entering".
      //
      // `themeSubjectKey` ITSELF IS NOT TOUCHED and must not be: it keys REASON tags, and the frozen
      // panel keys its cached verdicts on `producer|consumer|tag` -- the last attempt to compose
      // extra facts into that key cost 22 judging debt while changing no theme. Only the IMPLIED
      // entry fans out, and it has no Reason of its own. A card's AUTHORED emits keep first-subtype
      // keying above, so they stay consistent with the reason tags their edges carry.
      // A CHANGELING IS EVERY CREATURE TYPE, and fanning out over that is ~350 tags for one card.
      // `extractCharacteristics` replaces a changeling's subtypes with the whole CREATURE_SUBTYPES
      // list (printed ones FIRST), which is right for MATCHING -- a changeling really does satisfy
      // every typal payoff -- and nonsense as a THEME: measured, `tribal-tribal` went
      // "shapeshifters entering" -> "bears entering" and the corpus census nearly doubled,
      // 4,500 deck-tags -> 8,706. A changeling advertises its PRINTED type, which is subtypes[0].
      const changeling = (tags.characteristics.keywords ?? []).some((k) => k.toLowerCase() === "changeling");
      const subtypes = changeling
        ? [n.subject.subtype ?? []].flat().slice(0, 1).map((x) => String(x).toLowerCase())
        : [n.subject.subtype ?? []].flat().map((x) => String(x).toLowerCase());
      // A SUPERTYPE IS NOT A CARD TYPE, and `splitTypeLine` does not separate them -- so
      // `Characteristics.types` for "Legendary Creature -- Human Rogue" is ["legendary","creature"]
      // and `themeSubjectKey`'s `list(type)[0]` fallback named a subtypeless legendary permanent
      // `legendary` INSTEAD OF its card type. Stripping them here makes a Legendary Artifact key
      // `enters:artifact`, which is what it is (roadmap A11).
      const typed = { ...n.subject, type: [n.subject.type ?? []].flat().map((t) => String(t).toLowerCase()).filter((t) => !SUPERTYPES.has(t)) };
      const keys = subtypes.length > 0
        ? subtypes.map((sub) => themeSubjectKey({ ...typed, subtype: sub }))
        : [themeSubjectKey(typed)];
      // LEGENDS MATTER IS A THEME AND HAD NO KEY. `SubjectFilter.legendary` already carries the fact
      // (09ce98d sets it on `selfSubject`); only the theme key was missing, so a legends deck read
      // its most common creature type instead -- `marchesa-legends-matter` headlined "humans
      // entering" on `enters:human` 28 against `enters:legendary` 10. `basic` is the other supertype
      // `selfSubject` carries and is out of scope by construction: it appears only on LANDS, whose
      // own entry is already excluded above.
      if (n.subject.legendary === true) keys.push("legendary");
      // A PLANESWALKER'S SUBTYPE IS A CHARACTER NAME, AND THE DECK'S IDENTITY IS THE CARD TYPE
      // (roadmap M2, owner-reported 2026-08-23). The A9 fan-out above emits one key per subtype and
      // the card-type key only when there is NO subtype, which is right for a creature — a Wizard
      // deck wants `enters:wizard`, not `enters:creature` — and wrong for a planeswalker, whose
      // subtype is Chandra or Jace. MEASURED: `mono-blue-plainswalker-control` runs EIGHTEEN
      // walkers and split them `enters:jace` 7 / `enters:teferi` 3, headlining "jaces entering" at
      // cohesion 0.11 — a 7-card theme named over an 18-card deck.
      //
      // ADDITIVE, NEVER A REPLACEMENT. Planeswalker subtypes are real typal identities (the
      // vocabulary work emits them separately for exactly that reason, and Chandra tribal exists),
      // so `enters:chandra` survives beside `enters:planeswalker` and a payoff that names one still
      // finds it. What changes is that a deck of MIXED walkers now has one tag to count.
      //
      // PLANESWALKER-ONLY, and the restraint is the whole design. Pushing every card's type here
      // would give every creature `enters:creature`, which is the universal-bucket failure three
      // theme designs have already died on.
      if ((tags.characteristics.types ?? []).some((t) => t.toLowerCase() === "planeswalker")) {
        keys.push("planeswalker");
      }
      return [...new Set(keys)].map((k) => zoneEventKey(n.verb, n.subject.zone, k));
    });
}

/** WHAT A SELF-ETB TRIGGER ACTUALLY WANTS (roadmap G1, owner's ruling 2026-08-21).
 *
 *  "When THIS creature enters, draw a card" and "whenever ANOTHER Wizard you control enters" were
 *  keyed to the same tag, and they are two different facts: the second is a demand for Wizards, the
 *  first is a demand for something that makes this card enter AGAIN -- flicker, a copy, a
 *  Panharmonicon. Keyed as `enters:<class>` demand, the self trigger claimed the deck wanted its own
 *  card type, at FULL weight against `PRODUCER_SHARE` 0.35 for supply.
 *
 *  THE DEMAND IS ON THE RE-FIRER, NOT ON THE ETB CARD, and that is what makes the tag discriminate.
 *  Flickering a vanilla creature does nothing, so the flicker card is the one that WATCHES for ETB
 *  abilities; the ETB card SUPPLIES them. Measured over the 71 decks before it was written: keyed
 *  the other way round (ETB card cares) it headlines 11 decks including one with a single flicker
 *  effect, which is the universal-bucket failure three theme designs have already died on; keyed
 *  this way it headlines 5, every one carrying 7 or more re-firers. Corpus: 369 self-ETB cards and
 *  109 re-firers of 2,745, so the tag's idf is 1.75 -- it cannot win by rarity either.
 *
 *  Ceilings, both recorded rather than built: the tag carries no TYPE, so an enchantment's ETB and a
 *  creature-only flicker read as the same demand; and self-bounce (Whitemane Lion) and reanimation
 *  re-fire an ETB too, but they are not in the owner's three and reanimation has its own theme. */
export const ETB_REFIRE = "etb-refire";

/** Effect kinds that make a permanent's entry trigger fire again.
 *
 *  `trigger-doubling` USED TO OVER-CLAIM HERE and the ceiling was recorded in this comment: Isshin
 *  doubles ATTACK triggers and Tekuthal proliferate, and both counted as ETB re-firers, so a deck
 *  could headline `etb-refire` on a card that doubles no entry at all. `Ability.doubles` now records
 *  WHICH triggers a doubler doubles, so the kind is no longer consulted bare — a doubler qualifies
 *  only when it names `enters`.
 *
 *  A DOUBLER WHOSE QUALIFIER THE CLOSED MAP CANNOT READ (Veyran, Wayta, Harmonic Prodigy) records no
 *  `doubles` and therefore no longer counts. A deliberate narrowing in the under-claiming direction:
 *  it was counting them on no evidence before.
 *
 *  The copy family remains wider than the `clone` kind (C4 matches copies on a printed cue, because
 *  a copy derives `token-generation` byte-identically to a token maker) — still a ceiling on a
 *  109-card population, not a reason to widen the predicate here. */
const REFIRE_KINDS: ReadonlySet<string> = new Set(["flicker", "clone"]);

const refiresEntries = (tags: CardTags): boolean =>
  tags.abilities.some((a) =>
    (a.effect?.kind !== undefined && REFIRE_KINDS.has(a.effect.kind))
    || (a.effect?.kind === "trigger-doubling" && (a.doubles ?? []).includes("enters")));

const hasSelfEntryTrigger = (tags: CardTags): boolean =>
  tags.abilities.some((a) => a.trigger?.subject?.self === true && a.trigger.verbs.includes("enters"));

/** AN EVENT ON THE OPPONENT'S PERMANENT IS NOT THIS DECK'S THEME (roadmap K3a, owner-judged
 *  2026-08-23). Beast Within gives the destroyed permanent's controller a 3/3, and Archon of Cruelty
 *  makes an OPPONENT sacrifice — both were counted toward "creatures entering" and "creatures dying"
 *  in decks whose payoffs say "you control", and both were judged FALSE. They were 2 of the 2 falses
 *  in the whole draw.
 *
 *  THE FILTER IS AT THE READ, NEVER IN THE KEY. Composing control into `themeSubjectKey` was tried
 *  on 2026-08-14 and cost **22 judging debt while changing no theme** — the frozen panel keys its
 *  verdicts on `producer|consumer|tag`, so re-keying detaches them. `theme-fold.ts` set the
 *  precedent: read-time, never a re-key.
 *
 *  **IT MUST NAME A PERMANENT, AND A BLANKET CONTROL TEST WOULD BE A WORSE DEFECT THAN THE ONE IT
 *  CLOSES.** Measured over the 71 decks, 454 emits carry `control: "opp"` and they split 239 naming
 *  a permanent against 215 naming the PLAYER — lose-life 90, damage-to-a-player 74. **Draining an
 *  opponent IS the deck doing its thing**: Gray Merchant of Asphodel is in that second group, and
 *  excluding it would delete the drain theme from every aristocrats deck in the corpus.
 *
 *  Only the EMIT side is filtered. 107 triggers carry `control: "opp"` and no judged claim names
 *  one — a card that WATCHES an opponent's board may well be an opponent-facing theme in its own
 *  right, and there is no measurement yet either way. */
function opponentsPermanent(subject: SubjectFilter | undefined): boolean {
  if (!subject || subject.control !== "opp") return false;
  return subject.type !== undefined || subject.subtype !== undefined;
}

export function cardThemeTags(tags: CardTags): Set<string> {
  const out = new Set<string>();
  for (const t of impliedEntryThemeTags(tags)) out.add(t);
  // BOTH SIDES carry the tag, because `rankFreq` is only computed for tags present in `deckFreq`,
  // which this function feeds. The demand half is added to `cardCaresTags` as well; the supply half
  // is not, so it rides at `PRODUCER_SHARE` like any other supply.
  if (refiresEntries(tags) || hasSelfEntryTrigger(tags)) out.add(ETB_REFIRE);
  for (const a of tags.abilities) {
    // KEYED THE WAY A REASON TAG IS (zones.ts), so the theme axis and the edge agree on the string.
    // Byte-identical for every verb but one: `enters` was already `enters:`, `enters-graveyard` and
    // `dies` key on their own names, and a battlefield `leaves` stays `leaves:`. The exception is a
    // leave from a GRAVEYARD, which keys `leaves-graveyard:` -- and until 2026-09-05 (roadmap Y1b)
    // nothing emitted one, so this read `leaves:any` for 1,786 corpus recursion cards the moment
    // they did, and two of the 71 decks took "leaves the battlefield" as their headline theme on
    // the strength of their reanimation.
    if (a.trigger) for (const v of a.trigger.verbs) {
      const t = normalizeZoneEvent({ verb: v, subject: a.trigger.subject });
      out.add(zoneEventKey(t.verb, t.subject.zone, themeSubjectKey(t.subject)));
    }
    for (const e of a.emits ?? []) {
      if (opponentsPermanent(e.subject)) continue;
      const t = normalizeZoneEvent(e);
      out.add(zoneEventKey(t.verb, t.subject.zone, themeSubjectKey(t.subject)));
    }
    // No subject requirement here, unlike the static EDGE below. Membership asks "is this card a
    // <kind> card?", which does not depend on knowing WHICH permanents it applies to. Requiring a
    // subject silenced every static whose recipient is unrecoverable -- Rage Reflection's
    // grant-ability records "double strike", the thing granted, not who receives it -- and across
    // the 71 calibration decks that stripped derived decks of their static themes, letting whatever
    // tag had the most raw volume win the axis instead.
    if (a.kind === "static" && a.effect.kind) out.add(`static:${a.effect.kind}`);
  }
  return out;
}

/** The subset of `cardThemeTags` a card CARES about — its triggers, and nothing it merely does.
 *
 *  A deck's theme is what its payoffs watch for, not what its cards happen to emit. Measured on the
 *  owner's Sorin list: 20 cards emit life loss (mostly removal spells that drain incidentally)
 *  against 7 that trigger on casting a noncreature spell, so `cardThemeTags` — which counts triggers,
 *  emits and static effects indistinguishably — ranked the deck "lose life" while Charitable Levy,
 *  Sedgemoor Witch and Primal Amulet were the actual engine.
 *
 *  Deliberately a SEPARATE function rather than a flag on `cardThemeTags`: membership ("is this a
 *  lifegain card?") and identity ("is this a lifegain DECK?") are different questions, and the
 *  edge/theme-membership callers want the union. */
export function cardCaresTags(tags: CardTags): Set<string> {
  const out = new Set<string>();
  for (const a of tags.abilities) {
    // A SELF TRIGGER IS NOT A DEMAND FOR ITS OWN CLASS -- see `ETB_REFIRE` above. The `enters` case
    // has somewhere to go (the deck's re-firers); the others simply say nothing about what the deck
    // wants, so they are dropped rather than re-keyed. Left deliberately narrow: an extra combat is
    // the analogous supply for a self `attacks` trigger and is its own item.
    if (a.trigger && a.trigger.subject?.self !== true) {
      for (const v of a.trigger.verbs) out.add(`${v}:${themeSubjectKey(a.trigger.subject)}`);
    }
    // AN INTERVENING-IF CONDITION IS A DEMAND EVEN WHEN NO SINGLE CARD SATISFIES IT (owner,
    // 2026-08-20). "Whenever a permanent you control is put into a graveyard, IF IT HAD COUNTERS ON
    // IT" makes Yuna, Grand Summoner a counters payoff; "if a creature died this turn" makes Warlock
    // Class an aristocrats one. Neither fact reached the axis, because `cardCaresTags` read the
    // trigger's own verb and subject and nothing else — Yuna carried `counter-added:any` only as
    // SUPPLY (she places counters), never as demand.
    //
    // A cares tag forms NO edge, so this can only move the ranking layer: the acceptance test is
    // that population and panel stay byte-identical while themes and ratings move.
    for (const tag of a.conditionCares ?? []) out.add(tag);
  }
  // THE RE-FIRER IS THE PAYOFF THAT WATCHES: a flicker, a copy or a trigger doubler is worth nothing
  // beside vanilla creatures and everything beside a deck full of entry triggers.
  if (refiresEntries(tags)) out.add(ETB_REFIRE);
  return out;
}

/** The card's characteristics expressed as a concrete subject, for static-edge matching. */
function characteristicsSubject(tags: CardTags, name?: string): SubjectFilter {
  const c = tags.characteristics;
  const types = c.types.map((t) => t.toLowerCase());
  const subtypes = c.subtypes.map((t) => t.toLowerCase());
  return {
    // The deck fact, on BOTH sides. `characteristicsSubject` is the CONSUMER argument in the
    // self-trigger identity gate below, so a commander's own emit — which carries `commander` after
    // markCommander — was tested against a printed subject that lacked it and failed, dropping the
    // card's self-triggers. The same both-sides lesson `legendary` records at 09ce98d: a one-sided
    // stamp deletes real edges instead of narrowing false ones.
    ...(c.commander === true ? { commander: true as const } : {}),
    // The card's own NAME, so a subject demanding one can be satisfied. Threaded from the DeckCard
    // rather than read off the tags, because `CardTags` carries an oracleId and characteristics and
    // has never carried the printed name. Only the callers that judge a card's identity pass it.
    ...(name !== undefined ? { named: name } : {}),
    ...(isHistoric(types, subtypes) ? { historic: true as const } : {}),
    // The supertype is already in `types`, but `type` is an OR list on a consumer subject, so a
    // legendary demand cannot be expressed there. Lifted to its own flag, as historic is.
    ...(types.includes("legendary") ? { legendary: true as const } : {}),
    ...(types.includes("basic") ? { basic: true as const } : {}),
    // Printed keywords, for the static pass — this is the side a "creatures you control with flying"
    // anthem is matched AGAINST, so without it every such anthem either reaches everything (before
    // the filter existed) or nothing (after, if only one side were done).
    ...(c.keywords?.length ? { keyword: c.keywords.map((k) => k.toLowerCase()) } : {}),
    type: c.types.length ? c.types.map((t) => t.toLowerCase()) : undefined,
    subtype: c.subtypes.length ? c.subtypes.map((t) => t.toLowerCase()) : undefined,
    colors: c.colors.length ? c.colors : undefined,
    control: "you",
    token: c.token,
    power: parseStat(c.power),
    toughness: parseStat(c.toughness),
    manaValue: c.cmc,
  };
}

/** A producer's events BEFORE anything is derived from them -- authored emits plus the card's own
 *  implied cast/enters, zone-normalized. Split out of `producerEvents` so the proliferate demand
 *  below can ask `impliedCounterEvents` the same question over the same input, rather than rebuilding
 *  the list and drifting from it. */
function baseEvents(tags: CardTags): GameEvent[] {
  return [
    ...tags.abilities.flatMap((a) => a.emits ?? []),
    ...impliedEvents(tags.characteristics),
  ].map(normalizeZoneEvent);
}

/** A producer card's canonical events: authored emits + self-implied cast/enters, all zone-
 *  normalized and deduped, then unioned with the graveyard-fill events those emits imply. */
export function producerEvents(tags: CardTags): GameEvent[] {
  const base = selfLeavesTypes(baseEvents(tags), tags.characteristics);
  const derived = [
    ...selfFillTypes(impliedGraveyardEvents(base), tags.characteristics),
    ...impliedCounterEvents(base),
  ];
  const withDerived = [...base, ...derived];
  const seen = new Set<string>();
  const out: GameEvent[] = [];
  for (const e of withDerived) {
    const k = JSON.stringify(e);
    if (!seen.has(k)) { seen.add(k); out.push(e); }
  }
  return out;
}

/** Does a combat consumer subject filter on anything beyond "is a creature" -- i.e. does it
 *  narrow which creature satisfies it, rather than accepting any of them? A bare subject, or one
 *  whose only type is `creature` (every attacker is one, so that narrows nothing), does not
 *  narrow. Anything else -- a subtype, a stats predicate ("power 4 or greater"), a counter, a
 *  chosenType, or a colors filter, or a token filter that isn't wildcarded -- is a real typal or
 *  statistical condition and narrows. */
function combatConsumerNarrows(subject: SubjectFilter): boolean {
  return combatNarrowsByType(subject) || combatNarrowsOffType(subject);
}

/** Does this combat consumer narrow via its type line -- a non-creature type, or any subtype?
 *  Exported because the census keys rows on type and subtype, so a shape narrowing THIS way already
 *  lands in its own row and needs no further marking. */
export function combatNarrowsByType(subject: SubjectFilter): boolean {
  const types = list(subject.type);
  if (types.length > 0 && !types.every((t) => t === "creature")) return true;
  return list(subject.subtype).length > 0;
}

/** Does it narrow via a dimension OUTSIDE the type line -- a stats predicate ("power 4 or greater"),
 *  a counter, a chosenType, a colors filter, or a token filter? These are invisible to a
 *  type/subtype key, so two shapes can share a key and disagree about being self-supplied.
 *
 *  `token` narrows only when it demands a TOKEN. `token: false` means "nontoken", which nearly every
 *  creature already is -- treating it as a real condition let 14 triggers draw implied edges from the
 *  whole creature pool, a small copy of the mesh this gate exists to prevent. `token: true` is a
 *  genuine condition (Neyali, Temmet): a deck with no token makers never triggers it, and since
 *  `selfSubject` stamps `token: false` on every implied event, such a consumer correctly ends up with
 *  zero implied supply and surfaces in the census as a real hole -- we do not model a token attacking. */
function combatNarrowsOffType(subject: SubjectFilter): boolean {
  if ((subject.stats?.length ?? 0) > 0) return true;
  // A COMMANDER IS ONE OR TWO CARDS, so a combat consumer naming one is the narrowest shape there
  // is — the opposite of the deck-level state condition this gate exists to refuse. Without it
  // Kediss, Emberclaw Familiar's "whenever a commander you control deals combat damage" read as
  // generic combat, was judged self-supplied, and formed no edge at all — even to the commander.
  if (subject.commander === true) return true;
  if (subject.counter) return true;
  if (subject.chosenType) return true;
  if ((subject.colors?.length ?? 0) > 0) return true;
  return subject.token === true;
}

/** Is this combat producer/consumer pair satisfied by the game itself rather than by any card?
 *
 *  Attacking and dealing combat damage are normal game actions -- every creature does them, for
 *  free, in any deck that runs creatures. "Whenever a creature you control attacks" therefore
 *  needs no supplier: it is a deck-level state condition, not an event some other card provides.
 *  Supplying those consumers from every creature in the corpus would be a multi-million-edge mesh
 *  carrying no information -- the same failure `bea8dcd` removed for `cast:any`.
 *
 *  That only holds for the IMPLIED combat events `impliedEvents` synthesizes ("any creature can
 *  attack"), never for an AUTHORED attacks/combat-damage emit -- goad, Mage Slayer, Saskia and
 *  similar cards genuinely force or supply combat, and that is real information a generic combat
 *  consumer should receive. So the gate is keyed on the PRODUCER's `implied` flag, not just the
 *  consumer's shape.
 *
 *  A consumer that filters on WHICH creature attacks is a different thing: "whenever a Samurai or
 *  Warrior you control attacks" is a real typal payoff, and the creatures satisfying it are a real
 *  edge -- so is "whenever a creature with power 4 or greater attacks" (Garruk's Uprising). Note
 *  `type: creature` does NOT count as a filter here -- only creatures attack, so on a combat
 *  trigger it narrows nothing. */
export function combatSelfSupplied(producer: GameEvent, consumer: GameEvent): boolean {
  if (!COMBAT_VERBS.has(consumer.verb)) return false;
  if (!producer.implied) return false;
  return !combatConsumerNarrows(consumer.subject);
}

/** A consumer trigger that watches the card ITSELF, against a producer event that is only the
 *  producer existing. Sol Ring entering does not trigger "when Urza enters"; Lightning Bolt being
 *  cast does not trigger Nulldrifter's "when you cast THIS spell". Before this gate every permanent
 *  in the deck supplied every self-ETB and every spell supplied every self-cast -- 74% of all false
 *  edges in the 2026-08-05 precision measurement, in both tag populations.
 *
 *  Two producer events can never be the consumer entering:
 *    - an IMPLIED one — the producer merely being a permanent that entered. Same scoping as
 *      `combatSelfSupplied`, and for the same reason: an AUTHORED emit is a card that actually puts
 *      something onto the battlefield, and a blink or a reanimation genuinely does make the consumer
 *      re-enter and fire its own ETB, so dropping self-triggers outright would delete real edges.
 *    - a TOKEN one — `create` emits `enters`, but the thing that entered is a new object. However
 *      many tokens are made, none of them is the card watching its own entry. Authored, so the
 *      implied rule alone left 25 of these standing in the measured sample.
 *  Tokens remain real supply for every OTHER consumer: go-wide is the point of them. */
/** Effect kinds that describe what the DECK does rather than how two cards relate. A pairwise edge
 *  makes the same claim in every deck, which is exactly wrong for these: Sapphire Medallion in
 *  mono-red does nothing, and Ghostly Prison protects you the same however the other 99 are chosen.
 *  See the applies-to pass for the measured cost of leaving them in. */
// `win-game`, `extra-turn` and `extra-phase` join cost-reduction and tax for the same reason those
// two are here: they are deck ROLES, not pairwise claims. "This card wins the game" says the
// identical thing next to every other card in the deck, and an extra turn helps all 99 equally.
export const ROLE_NOT_SYNERGY: ReadonlySet<string> = new Set([
  "tax", "win-game", "extra-turn", "extra-phase",
]);

/** A SELF cost reduction reduces the card ITSELF, and its subject is the MEASURING STICK.
 *
 *  THE REVERSE EDGE WAS PROPOSED AND IS REFUSED, MEASURED 2026-08-19 (roadmap C2). "Big creatures
 *  make The Great Henge cheaper, so it is a `scales:`-family CONSUMER of power" is TRUE and it does
 *  not survive being counted: "greatest power among creatures you control" restricts NOTHING, so
 *  every creature satisfies the subject and the reverse edge reaches **33, 31 and 46 creatures** in
 *  the three calibration decks that run it — the IDENTICAL fan-out as the defect this guard was
 *  written to fix, where the Henge claimed to discount 45 creatures and became its deck's top card
 *  (129 false reasons). Reversing the arrow does not change the count, only the sentence.
 *
 *  The population is 10 self-reducers by the printed cue, and they share no shape: a board count
 *  including the OPPONENT's creatures (Blasphemous Act), a max-power (Great Henge) or max-mana-value
 *  (Sunderflock) reading, a stat THRESHOLD (Bolt Bend), event counts within a turn (Rowdy Research,
 *  Blood for the Blood God!), graveyard counts (Furygale Flocking, The Capitoline Triad) and a
 *  creature-TYPE-diversity count (Valiant Changeling). Three of the ten derive no subject at all.
 *
 *  WHAT WOULD DISCRIMINATE is a STAT-GATED reading — Bolt Bend's "if you control a creature with
 *  power 4 or greater" is a real claim about big creatures specifically, and `SubjectFilter.stats`
 *  already exists to say it. It is ONE card in 3 of the 71 decks and its threshold derives nowhere,
 *  so it is a roadmap item and not a line of code here.
 *
 *  The graveyard subset already has its channel and uses it: the scaling loop below forms
 *  `scales:` edges for any cost reducer whose count names a type.
 *
 *  The Great Henge reads "This spell costs {X} less to cast, where X is the greatest power among
 *  creatures you control" and derives `cost-reduction` with subject `{type: creature, control:
 *  you}` — the creatures whose power sets X, NOT a set of cards it makes cheaper. Read as an
 *  ordinary reducer it claimed to discount 45 creatures in one deck and became that deck's
 *  top-rated card. Owner caught it the day the family was admitted; measured at **129 false
 *  reasons across the 71 decks, all of them The Great Henge**, out of 5,596 cost-reduction reasons.
 *
 *  Corpus-wide the family is **11 of 64 cards deriving a cost reduction (17%)** — Blasphemous Act,
 *  Bolt Bend, Sunderflock, Rowdy Research, Valiant Changeling, Excalibur, Furygale Flocking, Blood
 *  for the Blood God!, The Capitoline Triad, Mutated Cultist and the Henge. Ten of the eleven match
 *  this cue; the eleventh (Mutated Cultist, "the NEXT SPELL you cast this turn costs {1} less") is
 *  genuinely other-reducing and must keep its edges, which is why the looser "costs {1} less to
 *  cast for each" phrasing is NOT a cue — it appears on both shapes.
 *
 *  THE RELATION IS REAL IN REVERSE and this guard does not capture it: big creatures make the Henge
 *  cheaper, so the Henge is a `scales:`-family CONSUMER of power, not a producer of discounts.
 *  Refusing the wrong direction beats stating it backwards; the reverse edge is its own item.
 *
 *  CEILING: card-scoped cue, so a card printing BOTH a self reduction and a real other-reduction
 *  loses the real one. None of the 64 does today. Clause scoping would need the clause text at
 *  match time, which the matcher does not carry. */
const reducesItself = (oracleText: string | undefined): boolean =>
  /\bthis spell costs\b|\bthis ability costs\b/i.test(oracleText ?? "");

/** A reduction on ACTIVATING an ability discounts a card that HAS one, and nothing else.
 *
 *  Forensic Gadgeteer's "activated abilities of artifacts you control cost {1} less to ACTIVATE"
 *  derives an ordinary `cost-reduction` over "artifacts you control", so it claimed to discount every
 *  artifact in the deck — including Servo Schematic, whose abilities are all TRIGGERED, and
 *  Stridehangar Automaton, whose abilities are all STATIC. Both judged FALSE.
 *
 *  **REFUSING THE WHOLE CARD WAS BUILT FIRST AND IS WRONG — measured, it deletes THREE REAL CLAIMS**
 *  (Thought Vessel, Transmutation Font, Dross Skullbomb, each judged real with the note "X is an
 *  artifact with activated abilities"). The discount is perfectly real; what it cannot reach is a
 *  consumer with no activated ability to pay for. So the printed cue selects the PRODUCER and the
 *  CONSUMER's own ability list decides, which is a fact the engine already carries.
 *
 *  Card-scoped cue, same ceiling as `reducesItself`: 2 in the derived corpus (Forensic Gadgeteer,
 *  Training Grounds) against **83 corpus cards** printing "less to activate". */
const reducesAnAbility = (oracleText: string | undefined): boolean =>
  /\bless to activate\b|\bactivated abilities .{0,40}\bcost\b/i.test(oracleText ?? "");

/** A cost reduction cannot take generic mana below zero (CR 118.7), so "spells you cast cost {1}
 *  less" does NOTHING to a card costing exactly `{U}`.
 *
 *  FOUND BY THE OWNER, from two `uncertain` verdicts on the panel debt (2026-08-19) and not by any
 *  instrument here: Serah Farron -> K-9, Mark I `{U}` and The Water Crystal -> Nashi. Measured
 *  across the 71 decks, **740 of 5,482 cost-reduction reasons** target a consumer with no generic
 *  mana, over 208 distinct cards -- Baleful Strix `{U}{B}`, Birds of Paradise `{G}`, Archmage's
 *  Charm `{U}{U}{U}`.
 *
 *  `X` COUNTS AS GENERIC: it is chosen, so there is something to reduce. A consumer with no recorded
 *  mana cost is not refused -- a missing answer, never a wrong one.
 *
 *  IT IS PAIRWISE, and that is the answer to the owner's own caveat: a TAX effect on the table adds
 *  generic and the reduction then bites, which is exactly why both witnesses are `uncertain` rather
 *  than `false`. But that is a THREE-card statement, and every claim this engine makes is about two.
 *  In the two-card case there is nothing to reduce. */
const hasGenericMana = (manaCost: string | undefined): boolean => {
  if (!manaCost) return true; // not recorded — refuse nothing
  for (const m of manaCost.matchAll(/\{([^{}]+)\}/g)) {
    // THE AMOUNT, NOT THE SHAPE. `{0}` is a numeric symbol carrying ZERO generic mana, and a
    // reduction cannot take it below zero either — the first cut tested for a digit and kept
    // Mishra's Bauble, Urza's Bauble and Everflowing Chalice, 19 claims the guard exists to refuse.
    if (/^\d+$/.test(m[1]) && Number(m[1]) > 0) return true;
    if (/^[XYZ]$/i.test(m[1])) return true; // chosen, so there is something to reduce
  }
  return false;
};

/** The distinct activation costs a consumer's abilities print, for the CR 118.7 check on the
 *  activated side. `Ability.cost` is the real string `segment.ts`'s `classify()` split out (1,494 of
 *  1,501 activated abilities carry one), and its absence is the schema's own "not activated" marker
 *  — so an activated ability with an EMPTY cost falls through `hasGenericMana`'s "not recorded,
 *  refuse nothing" branch, which is the right direction for a guard. */
const activationCosts = (tags: CardTags | undefined): (string | undefined)[] =>
  [...new Set((tags?.abilities ?? []).filter((a) => a.kind === "activated").map((a) => a.cost))];

/** Mana in an activation cost, for the printed floor below. Non-mana components ("Sacrifice this
 *  artifact", "{T}") contribute nothing, which is the point: the floor is stated about the MANA in
 *  that cost. A symbol this cannot read counts as one mana, so an unparsed cost reads BIGGER and
 *  survives the floor — a wrong refusal deletes a real claim, a wrong keep costs one. */
const manaInCost = (cost: string | undefined): number => {
  let n = 0;
  for (const m of cost?.matchAll(/\{([^{}]+)\}/g) ?? []) {
    if (/^\d+$/.test(m[1])) n += Number(m[1]);
    else if (m[1].toUpperCase() !== "T" && m[1].toUpperCase() !== "Q") n += 1;
  }
  return n;
};

/** Does the reducer print the one-mana floor? Both derived ability-reducers do — Forensic Gadgeteer
 *  and Training Grounds carry the identical sentence — but it is NOT part of "costs less to
 *  activate", so a future reducer without one must not inherit it. 90 corpus cards match the
 *  ability-reducer cue; this is the narrower question asked separately. */
const reducesToAFloor = (oracleText: string | undefined): boolean =>
  /can't reduce the mana in that cost to less than one mana/i.test(oracleText ?? "");

/** Does the reduction take a COLOURED pip rather than generic mana? A BLANKET GUARD WOULD BE WRONG
 *  and measuring is what showed it: Defiler of Flesh ("costs {B} less"), Defiler of Dreams, Eluge
 *  and Morophon ("costs {W}{U}{B}{R}{G} less") really do reduce a `{U}` spell — Morophon makes it
 *  free. Of the 740 zero-generic claims, **17 have a reducer of this shape and must be KEPT**. */
const reducesColouredMana = (oracleText: string | undefined): boolean =>
  /costs?\s+\{[WUBRGC]\}[^.]{0,40}?less/i.test(oracleText ?? "");

/** AN ADDITIONAL COST IS ADDED BEFORE A REDUCTION IS SUBTRACTED, so a card with one is not safe to
 *  refuse however small its printed cost (owner's correction, 2026-08-19). CR 601.2f: "The total
 *  cost is the mana cost or alternative cost …, PLUS all additional costs and cost increases, AND
 *  MINUS all cost reductions." Everflowing Chalice is `{0}` with **Multikicker {2}** — kicked twice
 *  it totals {4}, and a reducer takes it to {3}. The first cut refused it.
 *
 *  THE LIST IS THE 17 KEYWORDS CR 702.x DEFINES WITH AN ADDITIONAL COST, plus `offspring` and
 *  `tiered`, which the owner named and which postdate the rules file entirely. **Deliberately NOT
 *  split into mana and non-mana additional costs**: the CR states most of them with a `[cost]`
 *  placeholder, so the split is not verifiable from the rules text, and being lenient here costs a
 *  handful of claims that should go while being strict would DELETE REAL ONES. A wrong refusal is
 *  the worse error for a guard.
 *
 *  Measured: **120 of the 4,304 corpus cards with zero generic mana (2.8%)** carry one — led by
 *  spree 17, buyback 15, splice 7, gift 6, multikicker 5. */
const ADDITIONAL_COST_KEYWORDS: ReadonlySet<string> = new Set([
  "buyback", "kicker", "multikicker", "entwine", "splice", "offering", "replicate", "conspire",
  "retrace", "escalate", "jump-start", "casualty", "squad", "bargain", "spree", "gift", "tiered",
  "offspring",
]);

const hasAdditionalCost = (tags: CardTags | undefined): boolean =>
  (tags?.characteristics.keywords ?? []).some((k) => ADDITIONAL_COST_KEYWORDS.has(k.toLowerCase()));

/** Card types that are PLAYED, never cast (CR 305.1) — a land can never be the consumer of a cost
 *  reduction, however broadly the reducer is worded. Checked against the card's whole type union so
 *  an Instant // Land modal DFC, which really is castable as its instant face, keeps its edge. */
const isLandOnly = (tags: CardTags): boolean =>
  tags.characteristics.types.length > 0 && tags.characteristics.types.every((t) => t === "land");

/** Does this card return only cards IT exiled, and only ever exile an opponent's?
 *
 *  Two printed facts, both needed. "Exiled with <name>" says the returned set is one the engine
 *  cannot enumerate; "an opponent controls" says your own cards can never be in it. Either alone is
 *  not enough — Ghost Vacuum has the first and returns your graveyard's cards happily. */
const exilesOnlyOpponents = (oracleText: string | undefined): boolean =>
  /\bexiled with\b/i.test(oracleText ?? "") && /\ban opponent controls\b/i.test(oracleText ?? "");

/** A recursion restricted to cards the consumer's OWN earlier action put in the graveyard. */
const recursionIsSelfSupplied = (oracleText: string | undefined): boolean =>
  /\bfrom among (?:those|them)\b|\bput into (?:a|your|their|its owner's) graveyard this way\b|\bput there [^.]{0,30}this turn\b|\bfrom the battlefield this turn\b/i
    .test(oracleText ?? "");

/** An UNTYPED recursion on an ability that carries its own graveyard-entry trigger: it returns the
 *  object that trigger saw, never an arbitrary card someone else put there. Reached only AFTER the
 *  trigger-match skip above, so by here the fill is one the trigger does NOT see. */
const GRAVEYARD_ENTRY_VERBS = new Set(["dies", "milled", "discarded", "sacrificed", "enters-graveyard"]);
function returnsWhatItsOwnTriggerSaw(a: CardTags["abilities"][number]): boolean {
  const s = a.effect.subject;
  if (!s || s.type !== undefined || s.subtype !== undefined) return false;
  return (a.trigger?.verbs ?? []).some((v) => GRAVEYARD_ENTRY_VERBS.has(v));
}

export function selfEtbSelfSupplied(producer: GameEvent, consumer: GameEvent): boolean {
  if (consumer.verb !== "enters" && consumer.verb !== "cast") return false;
  // Only the GRAVEYARD variant is excluded (it has its own matcher). `normalizeZoneEvent` stamps
  // zone "battlefield" on every enters event, so testing for an unset zone here would exclude
  // everything and make the gate dead code.
  if (consumer.subject.zone === "graveyard") return false;
  if (consumer.subject.self !== true) return false;
  return producer.implied === true || producer.subject.token === true;
}

/** Does a cast consumer filter on WHICH spell, or does every card in the deck satisfy it?
 *
 *  Only the bare umbrella counts as unconstrained. `spell` expands (PSEUDO_TYPE_SETS) to every
 *  nonland type, so it narrows nothing — but `permanent` excludes instants and sorceries, a named
 *  type excludes the rest, and a subtype/colour/stat/counter/token filter all narrow for real. */
function castConsumerNarrows(subject: SubjectFilter): boolean {
  if (subject.subtype !== undefined || subject.colors !== undefined) return true;
  if (subject.stats !== undefined || subject.chosenType === true) return true;
  if (subject.historic === true) return true;
  if (subject.token !== null && subject.token !== undefined) return true;
  const types = Array.isArray(subject.type) ? subject.type : subject.type ? [subject.type] : [];
  return types.length > 0 && !(types.length === 1 && types[0] === "spell");
}

/** Is this cast pair satisfied by playing Magic rather than by any card?
 *
 *  Casting spells is what a deck does. "Whenever you cast a spell" (Aetherflux Reservoir, Birgi,
 *  Arjun, Managorger Hydra, Liberator) and "whenever you cast your SECOND spell each turn" (Ledger
 *  Shredder, Taigam, Tomb of Horrors Adventurer, Dreamtide Whale, Rammas Echor) are deck-level state
 *  conditions, not events another card supplies — every nonland card in the deck answers them, so
 *  the claim excludes nothing and carries no information. It is the registered rubric rule ("a claim
 *  that applies to a card merely for being an ordinary card is false") and 27 of the frozen panel's
 *  33 `generic` false claims are this one shape.
 *
 *  The same rule `combatSelfSupplied` applies to attacking, and keyed the same way: on the PRODUCER's
 *  `implied` flag. An AUTHORED cast emit is a card genuinely putting spells on the stack — Bolas's
 *  Citadel, Abstract Performance, Impulsivity — and that is real supply a spell-count payoff should
 *  receive.
 *
 *  A consumer that names WHICH spell keeps every supplier it has: magecraft, storm, a creature-spell
 *  or artifact-spell watcher. Note this also gates Glóin's "historic spell" — the engine cannot
 *  express historic, so its subject really is unconstrained today, and forming an edge with every
 *  spell in the deck was a wrong answer rather than a partial one. */
export function castSelfSupplied(producer: GameEvent, consumer: GameEvent): boolean {
  if (consumer.verb !== "cast") return false;
  if (!producer.implied) return false;
  return !castConsumerNarrows(consumer.subject);
}

/** The verbs `combatSelfSupplied` governs -- the ones a creature performs for free. Exported so the
 *  census can ask "is this row one of the ones that gate applies to" without restating the list. */
export const COMBAT_VERBS: ReadonlySet<string> = new Set(["attacks", "combat-damage"]);

/** Does the producer's event come from where the consumer's trigger demands?
 *
 *  ONE-DIRECTIONAL on purpose. A trigger that names no origin means "however it got there" and must
 *  keep matching everything it matches today — that is most triggers, so stamping origins onto
 *  producer emits costs nothing. A trigger that DOES name one ("enters from a graveyard",
 *  "casts a spell from your hand") is only satisfied by a producer that states the same origin: a
 *  producer that states none is not proof of anything, and admitting it is how River Kelpie ended up
 *  claiming Phantasmal Image and Omni-Changeling, which enter from hand, plus Trade Routes, which
 *  puts nothing onto the battlefield at all. Three of the frozen panel's false claims, one card.
 *
 *  The cost of the strictness is real and accepted: a genuine reanimation whose clause never recorded
 *  a `fromZone` loses its edge to these consumers. A missing answer beats a wrong one. */
/** CR 700.4: dies means "is put into a graveyard from the battlefield", so a death IS a leave and a
 *  `leaves` demand is met by a `dies` supply. Not the reverse -- a flicker, a bounce or an exile
 *  leaves without dying, and Ephemerate feeding Blood Artist is the wrong claim this exists to
 *  refuse. Two demands refuse the subsumption too: "leaves the battlefield WITHOUT DYING" (Dour
 *  Port-Mage, Taeko's "if it didn't die") and a leave from a GRAVEYARD (Desecrated Tomb, Fang), which
 *  shares no zone with a death. Measured 2026-09-05: 32 of the 71 corpus leaves-payoffs are the
 *  graveyard kind, and every death in their decks fed them. */
function verbSatisfies(producer: GameEvent, consumer: GameEvent): boolean {
  if (producer.verb === consumer.verb) return true;
  return consumer.verb === "leaves" && producer.verb === "dies"
    && consumer.subject.zone !== "graveyard" && consumer.subject.withoutDying !== true;
}

function originMatches(producer: SubjectFilter, consumer: SubjectFilter): boolean {
  if (consumer.fromZone === undefined) return true;
  return producer.fromZone === consumer.fromZone;
}

/** Does a normalized producer event satisfy a normalized consumer trigger event? Verb equality
 *  plus the subject test the verb calls for -- graveyard fills and counter adds have their own
 *  matchers, everything else is plain subsumption. Shared by `directedReasons` and the event
 *  census so the two cannot drift: a census that counted supply differently from the matcher
 *  would report holes the engine does not actually have. */
export function eventMatches(producer: GameEvent, consumer: GameEvent, h: Hierarchy): boolean {
  if (!verbSatisfies(producer, consumer)) return false;
  // A TARGETING RESTRICTION IS A DEMAND NOTHING HERE CAN CHECK, so the trigger claims no producer.
  // `replacement.restricted` one layer over: keep the ability and its kind, claim no cards. Read on
  // the CONSUMER only — a producer's emit never states how a spell was targeted, so the field can
  // only ever be a demand, and reading it on the producer would be the `entersTapped` mistake (a
  // field describing the event, used to identify a card, silently deleting 29 real claims).
  //
  // MEASURED: 108 reasons across the 71 decks, from 3 cards — Leyline of Resonance 59 `cast:creature`
  // (it triggers on instants and sorceries; the `creature` is LEAKED out of the relative clause),
  // Vesuvan Duplimancy 36 `cast:creature` (head noun "a spell", so its whole type list is leaked),
  // Exterminator Magmarch 13 `cast:instant` (right noun, unchecked restriction). Seven cached panel
  // verdicts on these cards are FALSE against one REAL, and the REAL one is knowingly lost — see
  // `SubjectFilter.restricted`.
  if (consumer.subject.restricted === true) return false;
  // AN INSTANT-SPEED PRODUCER MEETS A COMBAT-STATE DEMAND WITHOUT NAMING IT -- when ITS CONTROLLER
  // PICKS THE VICTIM. Ayara's sac outlet eats your attacking creature in combat (owner ruling,
  // upheld 2026-08-22); a targeted kill at instant speed aims at the attacker. An edict at instant
  // speed does neither: "each opponent sacrifices a creature of their choice" lets the opponent
  // spare their attacker, and the owner judged Liliana's Triumph and Szat's Will -> Death Tyrant
  // FALSE on exactly that. So: your own permanent, or a target. The demand is dropped for this
  // comparison only; `subjectMatches` itself stays strict.
  const producerChooses = producer.subject.control === "you" || producer.subject.scope === "target";
  if (producer.instantSpeed === true && producerChooses && consumer.subject.combat !== undefined) {
    const { combat: _c, ...rest } = consumer.subject;
    consumer = { ...consumer, subject: rest };
  }
  if (!originMatches(producer.subject, consumer.subject)) return false;
  if (combatSelfSupplied(producer, consumer)) return false;
  if (castSelfSupplied(producer, consumer)) return false;
  if (selfEtbSelfSupplied(producer, consumer)) return false;
  if (producer.verb === "enters" && producer.subject.zone === "graveyard") {
    return graveyardFillMatches(producer.subject, consumer.subject, h);
  }
  if (producer.verb === "counter-added") return counterAddMatches(producer.subject, consumer.subject, h);
  // A DAMAGE EVENT HAS TWO PARTICIPANTS, AND A DEALER MUST BE COMPARED AGAINST A DEALER.
  //
  // A damage TRIGGER always names the source — "whenever another source you control deals exactly 1
  // damage" — because the receiving direction ("is dealt damage") is routed to `unknownTriggers` in
  // derive and never reaches here. The emit side was inconsistent: the IMPLIED combat event's
  // subject is the creature (the dealer), while an AUTHORED damage emit's subject is
  // `parseSubject(action.object)` — the victim, "each opponent". So the authored half was checking a
  // victim against a dealer and could never match.
  //
  // MEASURED WITNESS (owner's own case, 2026-08-27): Impact Tremors "deals 1 damage to each
  // opponent" takes 10 incoming `enters:creature` edges and formed ZERO outgoing ones in a deck
  // holding six cards that trigger on damage, Ghyrson Starn among them.
  //
  // `dealer ?? subject` is what makes this additive: only an authored damage emit sets `dealer`, so
  // the implied combat case falls back to exactly the comparison it makes today.
  if (producer.verb === "non-combat-damage" || producer.verb === "combat-damage") {
    return subjectMatches(producer.dealer ?? producer.subject, consumer.subject, h);
  }
  return subjectMatches(producer.subject, consumer.subject, h);
}

/** Repeatability of a triggered CONSUMER: a bare self-ETB (trigger names neither a type nor a
 *  subtype — "when this enters") is only satisfied by its own single entry, so it is one-time; any
 *  typed/subtyped trigger fires each time such a permanent recurs, so it is a repeatable engine. */
function triggerRepeatability(subject: SubjectFilter): "triggered" | "oneshot" {
  const bare = list(subject.type).length === 0 && list(subject.subtype).length === 0;
  return bare ? "oneshot" : "triggered";
}

/** Drop reasons identical in every field a reader or a score can see. `impliedProducer` is excluded
 *  from the key because it is provenance rather than content — two reasons that say the same thing
 *  are one reason whether or not one of them came from an implied event.
 *
 *  Needed in BOTH entry points, not just `pairReasons`: the card-synergy view calls
 *  `directedReasons` directly, so a producer with two graveyard-fill events feeding a consumer with
 *  two recursion abilities printed the same line four times. It also stops those repeats inflating
 *  `reasons.length`, which is the edge score. */
export function dedupeReasons(reasons: Reason[]): Reason[] {
  const seen = new Set<string>();
  const out: Reason[] = [];
  for (const r of reasons) {
    const k = JSON.stringify({ ...r, impliedProducer: undefined });
    if (!seen.has(k)) { seen.add(k); out.push(r); }
  }
  return out;
}

/** How many DISTINCT CLAIMS a reason set makes — the edge score, and not `reasons.length`.
 *
 *  ONE TRIGGER WITH A CHAIN OF EFFECTS IS ONE CLAIM. Archon of Cruelty's single entry trigger
 *  ("target opponent sacrifices a creature, discards a card and loses 3 life; you draw a card and
 *  gain 3 life") derives SIX reasons that are byte-identical in tag and text and differ only in
 *  `effectKind` — forced-sacrifice, (none), player-life-loss, draw-card, lifegain, drain — so every
 *  reanimation spell in the deck scored 6 against it while a one-payoff creature off the identical
 *  trigger scored 1. Measured across the 71 decks: **9,268 of 40,563 reasons (22.8%) sit in a
 *  duplicate (tag, text) group**, 4,010 groups over 3,985 edges (12.4%), sized 2x 3,012 · 3x 808 ·
 *  4x 160 · 6x 30 — and **64 of 71 decks re-order their top ten edges** when the duplicates stop
 *  counting. That is chain LENGTH driving the ranking, which is the magnitude axis wearing a
 *  disguise; magnitude belongs to `impactEdgeWeight` (max per distinct tag, already immune to this)
 *  and to the open edge-magnitude work, not to how many sentences one trigger generates.
 *
 *  THE REASONS THEMSELVES ARE NOT COLLAPSED, deliberately — `dedupeReasons` cannot merge them
 *  because `effectKind` is LOAD-BEARING for archetype detection: `mechanisms.ts` matches an
 *  archetype on a reason's kind, and Archon's six carry aristocrats' `forced-sacrifice`, `drain` and
 *  `player-life-loss` alongside `draw-card` and `lifegain`. Dropping five of six would silently
 *  narrow every detector that reads them. So the objects stay and only the COUNT collapses. */
export function claimCount(reasons: Reason[]): number {
  return new Set(reasons.map((r) => `${r.tag}\u0000${r.text}`)).size;
}

/** Records which SIDE of a reason is a token node. A NAME IS NOT AN IDENTITY: 92 of the corpus's
 *  661 distinct token names are also a real card (Llanowar Elves, Mutavault, Sacred Cat), and a card
 *  that makes a token copy of itself puts both names in one deck. Every downstream reader keys on
 *  `producer`/`consumer` strings, so without this the two collapse into a single node and the
 *  token's relations are attributed to the card.
 *
 *  Stamped at the three CHOKE POINTS where the sides are still known objects -- this function's
 *  callers are `directedReasons`, `createsReasons` and `meldReason` -- rather than at each of the
 *  fifteen places a reason literal is built. Doing it later, off the names alone, is exactly the
 *  ambiguity this exists to remove.
 *
 *  The strings themselves are deliberately UNCHANGED: `pairs.json` keys the whole judged panel on
 *  `producer|consumer|tag`, so decorating a name would invalidate every cached verdict. */
function stampSides(r: Reason, producer: DeckCard, consumer: DeckCard): Reason {
  return {
    ...r,
    ...(producer.isToken ? { producerIsToken: true } : {}),
    ...(consumer.isToken ? { consumerIsToken: true } : {}),
    // A FACE NODE CARRIES THE FACE'S NAME so the by-name maps in `analyze.ts` stay collision-free —
    // two faces of one card would otherwise share a `dir` key. The REASON carries the physical
    // card's name, because the panel keys on it. Rewritten here, in the one place every reason
    // literal already passes through, rather than at the fifteen sites that build one.
    ...(producer.parentName ? { producer: producer.parentName } : {}),
    ...(consumer.parentName ? { consumer: consumer.parentName } : {}),
    // `producer.face` rather than `!== undefined`: face 0 is the front and stamps nothing, which
    // keeps a front-face reason byte-identical to what this engine produced before faces were nodes.
    ...(producer.face ? { producerFace: producer.face } : {}),
    ...(consumer.face ? { consumerFace: consumer.face } : {}),
  };
}

/** Directional reasons from producer P to consumer C: event edges (P.emits ↔ C.triggers) and
 *  static edges (P.static effect ↔ C.characteristics). */
/** THE PRINTED TEMPLATES OF THE COPY FAMILY. `enters` is the subset that puts a NEW object onto the
 *  battlefield; "becomes a copy" changes one already there. */
const COPY_ENTERS_CUE = /tokens? that(?:'s| is| are) (?:a )?cop(?:y|ies) of|enters? as a copy of/i;
const COPY_BECOMES_CUE = /becomes? a copy of/i;
/** "Except it's a 3/3 Dragon", "except it loses all other card types" -- a copy whose CARD TYPES are
 *  rewritten, where the derived subject describes what the token BECOMES and not what it copies.
 *  Astral Dragon copies a NONCREATURE permanent and derives `{type: creature, subtype: dragon}`;
 *  reading that as its target made it claim every Dragon in a Dragon deck. Additive wording is left
 *  alone on purpose -- Phantasmal Image's "except it's an Illusion IN ADDITION TO its other types"
 *  is still a copy of the creature -- as is a stat-only change (Saw in Half's halved power). */
const COPY_REPLACES_TYPE_CUE = /loses all other card types|except (?:it|they)(?:'s|'re| is| are) \d+\/\d+/i;
/** A populate effect copies a TOKEN, never the commander -- refused rather than claimed, on the
 *  same rule as everything else here: a wrong claim costs more than a missing one. */
const COPY_OF_TOKEN_CUE = /copy of (?:a |an |another |target |that )*(?:\w+ )?token/i;
/** "Another target NONLEGENDARY creature you control" -- a copy ability that explicitly excludes
 *  legendary permanents from what it copies. CR gives no way around a printed restriction, so a
 *  legendary consumer can never be the thing this ability copies.
 *
 *  This is the reopening condition `copySubject`'s own CEILING comment named on 2026-08-19
 *  (`8831688d`): "gate on control only if a measurement finds the family bigger than that." It just
 *  did -- Reflection of Kiki-Jiki's back-face copy ability reaching Kardur, Doomscourge (a
 *  legendary creature) once face-scoping (2026-08-27) let `typed[0]` resolve to the RIGHT ability
 *  instead of an unrelated earlier one. MEASURED 2026-08-27: 12 corpus cards print a copy cue
 *  alongside the literal word "nonlegendary", 3 in the derived corpus.
 *
 *  Read off the printed cue, not a derived field -- none records it, and adding one is a schema and
 *  re-derive question this fix does not need to answer for three cards. */
const COPY_EXCLUDES_LEGENDARY_CUE = /\bnonlegendary\b/i;

/** Board state and provenance a copy claim must not carry into the type test: `token` means opposite
 *  things on the two shapes of the family, and `control`/`zone`/`counter` describe the object being
 *  copied, not the card whose printed characteristics this is matched against. */
const strip = (s: Partial<SubjectFilter>): Partial<SubjectFilter> => {
  const { token: _t, zone: _z, counter: _c, control: _ctl, ...rest } = s;
  return rest;
};

/** What a copy effect can copy, or undefined when the card copies no permanent.
 *
 *  The TYPE comes from the derived effect subject, which is the half the printed cue cannot give:
 *  Relm's Sketching copies an artifact, creature or land, Replication Technique a permanent, and a
 *  `clone` static that derived no subject defaults to creature -- every member of the family copies
 *  a creature at minimum. `token` is DROPPED because the field means opposite things on the two
 *  shapes: on "create a token that's a copy of target creature" it describes what is CREATED, on a
 *  populate effect what is COPIED, and only the printed cue tells them apart.
 *
 *  CEILING (`CEILING:` -- read before trusting a claim): `control` is ignored, so a card making an
 *  OPPONENT copy something over-claims, and Coiling Rebirth's copy is conditioned on "that creature
 *  isn't legendary" -- an intervening-if the engine has refused generally, not the literal word
 *  `notLegendary` catches. Both single cards; gate on control only if a measurement finds the
 *  family bigger than that. */
function copySubject(
  p: DeckCard,
): { subject: SubjectFilter; enters: boolean; notLegendary: boolean } | undefined {
  const oracle = p.card.oracleText ?? "";
  if (COPY_OF_TOKEN_CUE.test(oracle)) return undefined;
  const enters = COPY_ENTERS_CUE.test(oracle);
  if (!enters && !COPY_BECOMES_CUE.test(oracle)) return undefined;
  if (COPY_REPLACES_TYPE_CUE.test(oracle)) return undefined;
  // A TYPED subject first, and a `clone` static only as the fallback. Court of Vantress derives TWO
  // token-generation abilities -- an untyped one and the real `["artifact","enchantment"]` one --
  // and taking the first made it claim to copy a creature. A `clone` static (Stunt Double) derives
  // no subject at all, and creature is the honest default there: every printed member of that
  // family copies a creature at minimum. Anything else untyped is REFUSED, not widened.
  const abilities = p.tags?.abilities ?? [];
  const typed = abilities
    .filter((a) => (a.effect.kind === "clone" || a.effect.kind === "token-generation")
      && (a.effect.subject?.type !== undefined || a.effect.subject?.subtype !== undefined))
    .map((a) => a.effect.subject as Partial<SubjectFilter>);
  // THE FIRST typed branch, not all of them. Merging every branch into an `anyOf` was built and
  // MEASURED: it recovers Saheeli's Artistry's creature mode (its artifact mode derives first) and
  // costs a FALSE claim on the frozen panel -- 86.4% -> 86.2%, false 63 -> 64. Under-claiming is the
  // correct failure direction, so the wider read is refused, not tuned.
  const raw: Partial<SubjectFilter> | undefined = typed[0]
    ?? (abilities.some((a) => a.effect.kind === "clone") ? { type: "creature" } : undefined);
  if (raw === undefined) return undefined;
  // SCOPED TO THE EXPLICIT TYPED ABILITY ONLY (`typed.length > 0`), never the untyped `clone`-static
  // fallback -- Naga Fleshcrafter is why. Its "nonlegendary" sits on a SEPARATE ability (Renew, kind
  // `copy-spell`, never a `typed` candidate) from the one that actually supplies this card's copy
  // subject ("may have this creature enter as a copy of ANY creature", genuinely unrestricted, read
  // through the fallback). A card-wide test with no such scoping would have refused that real claim.
  const notLegendary = typed.length > 0 && COPY_EXCLUDES_LEGENDARY_CUE.test(oracle);
  return { subject: { ...strip(raw), control: "any", token: null } as SubjectFilter, enters, notLegendary };
}

/** Could the producer ITSELF be the object its own emit describes?
 *
 *  A creature emitting `dies: {type: creature}` might well be the creature that dies, so
 *  "When <producer> dies" is true and stays. A Sorcery emitting the same thing is describing the
 *  creatures it destroys, and that sentence becomes a claim that a sorcery dies.
 *
 *  Reuses `characteristicsSubject` + `subjectMatches` — the same pair the self-trigger gate uses —
 *  and strips the same event-only fields for the same reason: `zone`, `counter` and `entersTapped`
 *  describe the EVENT, not the card, and comparing them against a type line is the mistake this file
 *  has now recorded four times. An UNTYPED subject matches anything and therefore keeps the old
 *  wording, which is the conservative direction: no noun is invented for an emit naming no class. */
/** The noun for a graveyard-fill event that is not the card itself: its emitted type, or "a card"
 *  for an untyped mill/discard -- never "a permanent", which a milled card need not be. Undefined
 *  for anything that is not a non-self fill, so every other sentence is untouched. */
function fillNoun(e: GameEvent): string | undefined {
  if (!(e.verb === "enters" && e.subject.zone === "graveyard") || e.subject.self === true) return undefined;
  return emitSubjectNoun(e.subject) === "a permanent" && list(e.subject.type).length === 0 ? "a card" : emitSubjectNoun(e.subject);
}

function producerCanBeSubject(p: DeckCard, subject: SubjectFilter, h: Hierarchy): boolean {
  // No derived tags means no characteristics to compare, so nothing can be ruled out — keep the
  // old wording rather than invent a noun on a card the engine has not read.
  if (!p.tags) return true;
  const { zone: _z, counter: _c, entersTapped: _t, self: _s, ...printed } = subject;
  return subjectMatches(characteristicsSubject(p.tags, p.card.name), printed, h);
}

/** WHO IS ASKING. The default is the deck report, and every field here has to leave it unchanged.
 *
 *  `tokensMediate` is the token suppression below: a maker's own "a Treasure enters" event and the
 *  Treasure NODE's implied "it enters" state the same fact twice, so the direct edge is dropped in
 *  favour of the two-hop path through the token. THAT PATH ONLY EXISTS WHERE TOKEN NODES DO. A card
 *  page has one card on it, so suppression there deletes the relation and receives nothing back --
 *  which is the trade `hasMediatingToken` already refuses to make when a card has no token to
 *  mediate with. Same argument, one step further out. */
export interface ReasonOptions {
  /** False where no token node will exist to carry the second hop. Default true (the deck report,
   *  the graph, the compass -- everything that builds token nodes). */
  tokensMediate?: boolean;
}

/** The five basic land types, which a board count may name and which never form an edge -- see the
 *  board-count channel for why. */
const BASIC_LAND_TYPES = new Set(["plains", "island", "swamp", "mountain", "forest"]);

export function directedReasons(p: DeckCard, c: DeckCard, h: Hierarchy, opts: ReasonOptions = {}): Reason[] {
  if (!p.tags || !c.tags) return [];
  const reasons: Reason[] = [];
  const pEvents = producerEvents(p.tags);

  // Event edges: normalized producer event ↔ normalized consumer trigger.
  // A printed KEYWORD can be a triggered ability too, and its reminder text is inert at the clause
  // layer, so `tags.abilities` never holds it — see `keywordAbilities`. The demand half of the same
  // channel `keywordEvents` supplies.
  // A PROLIFERATE HAS A DEMAND AS WELL AS A SUPPLY. `impliedCounterEvents` has made a proliferate
  // SUPPLY an untyped counter-added since it shipped, and nothing made it ASK for one -- so Radstorm
  // and Virulent Silencer were two producers with no edge between them. Same channel shape as the
  // keyword line above: a synthetic consumer ability this loop already knows how to read.
  // AN ENTER-AS-A-COPY REPLACEMENT IS A REASON TO BE BLINKED. Read off the FACE's own printed text
  // (`faceDeckCards` gives each face its own `oracleText`), so a modal DFC's land back is not handed
  // a clone demand. See `enterAsCopyAbilities`.
  const cAbilities = [
    ...c.tags.abilities,
    ...keywordAbilities(c.tags.characteristics),
    ...proliferateAbilities(c.tags),
    ...enterAsCopyAbilities(c.card.oracleText, c.tags.characteristics),
  ];
  // A PROLIFERATE MULTIPLIES A COUNTER THAT IS ALREADY THERE (CR 701.29); IT CANNOT BE THE ORIGIN OF
  // ONE. Without this, the producer's own proliferate-implied counter-added satisfies the consumer's
  // proliferate demand and two proliferate cards edge to each other over a counter neither of them
  // made. Computed only when the consumer actually asks, so an ordinary pair pays nothing.
  //
  // IMPLIED MINUS AUTHORED, not implied alone: 6 of the 24 proliferate cards ALSO author a real
  // counter-added (Sword of Truth and Justice, Yawgmoth, Lulu, Tidus, Tromell, Patrolling
  // Peacemaker), and those are genuine origins another proliferate should reach. No authored emit
  // collides with its own card's implied one in today's corpus (measured: 0 of 24) -- but the shape
  // is printable, `producerEvents` dedupes identical events, and a rule that is right only by luck
  // would delete a real origin the first time one is printed.
  const asksToProliferate = cAbilities.some(
    (a) => a.effect.kind === "proliferate" && (a.trigger?.verbs ?? []).includes("counter-added"),
  );
  const notAnOrigin = new Set<string>();
  if (asksToProliferate) {
    const base = baseEvents(p.tags);
    const authored = new Set(base.filter((e) => e.verb === "counter-added").map((e) => JSON.stringify(e)));
    for (const e of impliedCounterEvents(base)) {
      const k = JSON.stringify(e);
      if (!authored.has(k)) notAnOrigin.add(k);
    }
  }
  for (const e of pEvents) {
    for (const a of cAbilities) {
      if (!a.trigger) continue;
      if (a.effect.kind === "proliferate" && notAnOrigin.has(JSON.stringify(e))) continue;
      for (const rawVerb of a.trigger.verbs) {
        const t = normalizeZoneEvent({ verb: rawVerb, subject: a.trigger.subject });
        if (!eventMatches(e, t, h)) continue;
        // TOKENS MEDIATE (Task 7, tokens-as-nodes, 2026-08-16). A maker's own "a Treasure enters"
        // event and the Treasure NODE's own implied "it enters" event (Task 6 -- `selfSubject` in
        // implied.ts now reads `chars.token` instead of hardcoding false) state the identical fact
        // twice: once as a direct maker->payoff edge, once as the two-hop maker->token->payoff path
        // the token node already supplies on its own (it rides the same `pairPool` every other card
        // does, per `analyze.ts`). Drop the shortcut; the two-hop path stands.
        //
        // TWO EXEMPTIONS, both required for the design to hold together and both PROVEN by a test in
        // edges.test.ts rather than assumed:
        //  - the PRODUCER must not itself be a token node. A token's own implied `enters` ALSO
        //    carries `subject.token === true` -- that is exactly what lets it supply the second hop --
        //    so a token-blind rule would delete that hop along with the first and leave no path at
        //    all between the maker and its payoffs.
        //  - `create-token` is never suppressed. It is not a legal TRIGGERS member the clause layer
        //    can produce (normalize-prompt.ts's TRIGGERS has no such event), so the only ability in
        //    the corpus with `trigger.verbs` including it is a CR 614 multiplier
        //    (derive/replacement.ts) -- and a token never "creates a token" by existing, so there is
        //    no second hop for that verb to duplicate. The owner's ruling: a multiplier consumes the
        //    MAKER's action, never the token's, and this is why the generic rule needs no special case
        //    for it once the verb is excluded.
        //  - the producer must actually HAVE a token a node can be built from. Suppression trades a
        //    direct edge for a two-hop path; if the trade receives nothing, the relation is simply
        //    deleted. Second Harvest's only token part is the placeholder "Copy" (type line
        //    `Token`, no card type, its own oracle text calling itself a stand-in), so its
        //    "for each token you control, create a copy" claimed NOTHING -- 0.3 rating, one
        //    partner, invisible to a Caretaker's Talent in the same deck. See
        //    `hasMediatingToken` in tokens.ts.
        //  - and the CALLER must be somewhere the second hop can exist. MEASURED 2026-09-04 on the
        //    partner artifact, which has no token nodes: the gate deleted 7,266 of 117,946 sampled
        //    token-only candidate pairs outright, and left 6,407 more rows describing the maker's
        //    own BODY entering, because the body was the only supply left to write a sentence from
        //    ("When Krenko, Mob Boss enters, Quest for the Goblin Lord puts counters on it" -- the
        //    one-shot reading of a repeatable engine). See `ReasonOptions.tokensMediate`.
        if (
          e.subject.token === true && t.verb !== "create-token" && !p.isToken && !c.isToken
          && (opts.tokensMediate ?? true) && hasMediatingToken(p.card)
        ) continue;
        // A SELF trigger watches ONE permanent — its own. `selfEtbSelfSupplied` excludes implied and
        // token producers, but an AUTHORED emit that puts some OTHER object onto the battlefield
        // survived it, because a self subject names no type and so checks nothing: Windswept Heath
        // fetching a Forest "triggered" The Grey Havens' own ETB.
        //
        // The test is whether the producer's event could BE this card, not whether it was authored —
        // Bloodstained Mire really does fetch Raucous Theater (Land — Swamp Mountain) and fire its
        // ETB, and a rule that deleted that would be the mistake the taps work already caught once.
        // `zone` is dropped for the same reason as in the reanimator gate below: printed
        // characteristics sit in no zone.
        if (t.subject.self === true) {
          // "EXILED WITH THIS CARD" IS A SET ONLY THE PRODUCER CAN ENUMERATE, and the emit drops the
          // restriction: Gisa, Glorious Resurrector and The Darkness Crystal both emit a bare
          // `enters: creature` for "put all creature cards exiled with <me> onto the battlefield",
          // so they claimed to fire the self-ETB of every creature in the deck. Both judged FALSE.
          //
          // GATED ON THE OPPONENT CUE, and measuring is what forced it: **185 corpus cards say
          // "exiled with", 10 of them derive an enters/cast emit**, and refusing all ten would delete
          // real claims — Ghost Vacuum exiles from ANY graveyard and Colfenor's Urn exiles YOUR OWN
          // dying creatures, so both really can return a deck-mate and fire its trigger. Gisa and
          // The Darkness Crystal are replacement effects on a creature AN OPPONENT CONTROLS dying,
          // so the set can never hold a card of yours. Card-scoped printed cue, the same shape and
          // the same ceiling as `reducesItself`.
          if (exilesOnlyOpponents(p.card.oracleText)) continue;
          const { zone: _eventZone, ...identity } = e.subject;
          // The producer re-entering ITSELF (Reassembling Skeleton, Drownyard Temple) is a real
          // entry for anything watching creatures, but it is never the CONSUMER entering, which is
          // the only event a self trigger watches.
          if (identity.self === true) continue;
          // An UNTYPED producer subject is left alone deliberately, and it is the residual this gate
          // cannot close. Refusing it looks right -- "something entered" is not evidence that THIS
          // card entered -- but the suite already holds the counterexample: Bolas's Citadel's
          // authored cast emit names nothing and genuinely does cast Nulldrifter off the top. The
          // same argument holds for enters. An untyped emit is a DERIVATION gap to fix upstream
          // (see the pronoun antecedent in tagger's derive.ts), not something to paper over here.
          // `counter` is dropped for the same reason `zone` is dropped in the self-recursion gate
          // below: this compares against a card's PRINTED characteristics, and a counter is a board
          // state no type line carries. Keeping it made The Great Henge unable to put a +1/+1
          // counter on Dusk Legion Duelist, whose trigger watches exactly that.
          // ARRIVAL STATE IS NOT A PRINTED CHARACTERISTIC, and this gate compares against a type
          // line. `entersTapped` rides on an emit as SUPPLY ("put it onto the battlefield tapped"),
          // but here the emit is the FILTER, so keeping it demanded that the consumer card BE
          // tapped — which no card is — and silently deleted 29 real self-ETB claims the moment the
          // field existed: Eldrazi Confluence blinking Solemn Simulacrum, Fungal Fortitude returning
          // Gray Merchant of Asphodel. The fourth time this exact shape has bitten (`zone`,
          // `counter`, `commander`): **a field that describes the EVENT must be stripped wherever an
          // emit is used to identify a CARD.**
          const { counter: _stateOnly, entersTapped: _arrival, ...printedMatchable } = identity;
          if (!subjectMatches(characteristicsSubject(c.tags, c.card.name), printedMatchable, h)) continue;
        }
        const key = zoneEventKey(t.verb, t.subject.zone, themeSubjectKey(t.subject));
        // A PROLIFERATE DEMAND NEEDS ITS OWN PROSE. The generic grammar below would render this as
        // "When <producer> gets a counter, <consumer> triggers" — the producer does not get the
        // counter, it MAKES one, and a sorcery that proliferates never triggers. See
        // `proliferateSentence`.
        const proliferateDemand = a.effect.kind === "proliferate" && t.verb === "counter-added";
        // A CLONE DOES NOT TRIGGER ON ENTERING, IT REPLACES ITS OWN ENTRY (CR 614.1c). The generic
        // self grammar would say "it triggers", which is the wrong mechanism for the one thing this
        // demand exists to state. See `enterAsCopySentence`.
        const clonesOnEntry = a.effect.kind === "clone" && t.verb === "enters" && t.subject.self === true;
        reasons.push({
          tag: key,
          text: proliferateDemand ? proliferateSentence(p.card.name, c.card.name)
            : clonesOnEntry ? enterAsCopySentence(p.card.name, c.card.name)
            : reasonSentence({
            producer: p.card.name, consumer: c.card.name, eventKey: key,
            effectKind: a.effect.kind, amount: a.amount, self: t.subject.self === true,
            // WHERE THE COUNTERS GO. "puts counters on it" had two live antecedents in every row --
            // the entering creature the sentence opens with, and the enchantment the counters
            // actually land on. The consumer's own effect subject knows which.
            effectTarget: effectTargetNoun(a.effect.subject),
            effectRecipient: a.effect.subject?.control,
            // CAN THE PRODUCER BE THE THING THIS HAPPENS TO? That is the whole question, and
            // naming the class unconditionally was the wrong answer to it.
            //
            // "When Austere Command dies" is a sentence about a `{4}{W}{W}` SORCERY, printed on the
            // deck's four highest-rated rows and flagged independently by three personas on
            // 2026-08-27. Austere Command emits four `dies` events whose subjects are classes it
            // DESTROYS; it is not, and can never be, the thing that dies.
            //
            // BUT NAMING THE CLASS EVERY TIME BREAKS A DELIBERATE INVARIANT. `sentence.ts` drops the
            // subject on purpose so Scrap Trawler's `dies:creature` and `dies:artifact` rows read as
            // one line, and so a producer satisfying one trigger by BOTH its baseline and an
            // authored emit collapses to a single claim — `claimCount` keys on (tag, text), so prose
            // that varies by type silently double-counts and inflates the score. Both are covered by
            // tests, and both failed the first cut of this fix.
            //
            // So the noun appears only when the producer's own printed characteristics CANNOT
            // satisfy its own emit. A Reanimator creature whose emit is `{type: creature}` really
            // might be the creature entering, and keeps the old wording; a Sorcery whose emit is
            // `{type: creature}` cannot, and gets the class named instead. Same predicate the
            // self-trigger gate above uses, so the two cannot disagree about what a card can be.
            //
            // A GRAVEYARD FILL IS NEVER THE PRODUCER ITSELF unless the emit says `self`. "Each
            // player mills a card" (Syr Konrad) is an UNTYPED fill, so `producerCanBeSubject` was
            // satisfied by anything and the drawer read "When Syr Konrad, the Grim hits the
            // graveyard" -- a sentence about the wrong card, seen live on Bloodchief Ascension's
            // whole producer list (owner, 2026-09-05). The producer is the SOURCE of a fill; the
            // thing filled is a card of the emitted type, or just "a card" when the type is unknown.
            subjectNoun: fillNoun(e) ?? (producerCanBeSubject(p, e.subject, h) ? undefined : emitSubjectNoun(e.subject)),
          }),
          effectKind: a.effect.kind,
          repeatability: triggerRepeatability(t.subject),
          scaling: a.effect.scaling,
          hasStatPredicate: (t.subject.stats?.length ?? 0) > 0 || undefined,
          consumer: c.card.name,
          producer: p.card.name,
          impliedProducer: e.implied || undefined,
        });
      }
    }
  }

  // Reanimator-consumer edge: a producer graveyard fill enables C's graveyard-recursion effect.
  for (const e of pEvents) {
    if (!(e.verb === "enters" && e.subject.zone === "graveyard")) continue;
    for (const a of c.tags.abilities) {
      if (a.effect.kind !== "graveyard-recursion" || a.effect.subject?.zone !== "graveyard") continue;
      // Skip if the event-edge loop already credited this fill via a graveyard-entry trigger on the same ability.
      if (a.trigger && a.trigger.verbs.some((v) => {
        const t = normalizeZoneEvent({ verb: v, subject: a.trigger!.subject });
        return t.verb === "enters" && t.subject.zone === "graveyard" && graveyardFillMatches(e.subject, t.subject, h);
      })) continue;
      // THE SET IS DEFINED BY THE CONSUMER'S OWN EARLIER ACTION, so no other card's fill can put
      // anything in it. Three printed templates, each measured over the whole corpus:
      // "from among those" (Ripples of Undeath mills three and returns one OF THOSE; Nashi the
      // same), "put into a graveyard this way" (Necromantic Selection destroys all creatures and
      // returns one IT killed — 24 corpus cards) and "put there this turn" (Gerrard's Hourglass
      // Pendant returns what hit your graveyard FROM THE BATTLEFIELD this turn — 49 corpus cards).
      // Card-scoped printed cue, the same shape and ceiling as `reducesItself`.
      if (recursionIsSelfSupplied(c.card.oracleText)) continue;
      // AN UNTYPED RECURSION ON AN ABILITY WITH ITS OWN GRAVEYARD-ENTRY TRIGGER RETURNS WHAT THAT
      // TRIGGER SAW — "whenever a creature you control with a +1/+1 counter on it dies, return THAT
      // CARD" — so a fill that does NOT satisfy the trigger enables nothing. **21 derived cards share
      // the shape**: Marchesa, Kaya's Ghostform, Feign Death, Luminous Broodmoth, Optimus Prime,
      // Shirei. The skip above already drops the fills that DO satisfy the trigger, because the
      // event-edge loop states them; this drops the rest, which is the wildcard an untyped recursion
      // subject would otherwise wave through — Kefka milling a creature for Marchesa, whose trigger
      // needs a +1/+1 counter.
      //
      // A BLANKET VERSION OF THIS WAS BUILT FIRST AND WAS WRONG, and the correction is worth keeping:
      // it also refused fills that DO satisfy the trigger, costing 3 REAL claims on Meathook Massacre
      // II, whose trigger is UNRESTRICTED ("whenever a creature you control dies, return that card")
      // so a sacrifice outlet really does enable it. The first diagnosis of that cost — "a gap in the
      // `dies` channel" — was ALSO wrong: it compared pairs against decks that do not contain the
      // producer at all. `smooth-criminal` is the only deck holding those three pairs and the
      // `dies:creature` edge carries every one of them. **Check that a deck contains both cards
      // before reading a missing claim as a missing channel.**
      if (returnsWhatItsOwnTriggerSaw(a)) continue;
      if (!graveyardFillMatches(e.subject, a.effect.subject, h)) continue;
      // A SELF-scoped recursion returns the card ITSELF ("return this card from your graveyard"), so
      // a fill enables it only if that fill could contain THAT card. Reassembling Skeleton is a real
      // payoff for a sacrifice outlet that can eat it; Metalwork Colossus is not a payoff for Buried
      // Ruin sacrificing itself, because a land in the graveyard is not the Colossus.
      //
      // Without this, every one of the 160 graveyard-recursion effects in the corpus was enabled by
      // every graveyard fill in the deck: the recursion subject of a self-recursion names no type,
      // and `graveyardFillMatches` wildcards an untyped subject on purpose.
      //
      // `zone` is dropped from the fill before the test: a card's printed characteristics sit in no
      // zone, so keeping it would fail every card and silently delete the whole family.
      if (a.effect.subject.self === true) {
        // A fill that is ITSELF self-scoped puts the PRODUCER into the graveyard, and the producer is
        // never the consumer in a pair. `self` rode along in fillIdentity below, where subjectMatches
        // does not read it, so the fill looked untyped and wildcarded through the very check that
        // exists to demand proof: Necromancy sacrificing itself "enabled" Eye of Nidhogg returning
        // itself.
        if (e.subject.self === true) continue;
        const { zone: _fillZone, entersTapped: _fillArrival, ...fillIdentity } = e.subject;
        if (!subjectMatches(characteristicsSubject(c.tags, c.card.name), fillIdentity, h)) continue;
      }
      const repeatability =
        a.kind === "static" ? "static" : a.kind === "activated" ? "activated" : a.kind === "on-cast" ? "oneshot" : "triggered";
      reasons.push({
        tag: `graveyard-recursion:${themeSubjectKey(a.effect.subject)}`,
        text: graveyardEnablesRecursion(p.card.name, c.card.name),
        effectKind: a.effect.kind,
        repeatability,
        scaling: a.effect.scaling,
        consumer: c.card.name,
        producer: p.card.name,
      });
    }
  }

  // Scaling edge: a producer graveyard fill makes C's per-graveyard payoff BIGGER. Not a trigger —
  // nothing fires — which is why the channel had no edge despite `effect.scaling` being derived,
  // copied onto every Reason and read by impact.ts, buckets.ts and wincon.ts. Bonehoard is a 0/0
  // Germ until something dies.
  //
  // GATED ON WHAT IS COUNTED, never on the basis alone. `per-graveyard` covers Cavalier of Flame's
  // LAND cards, Glamdring's instants and sorceries and Bonehoard's creatures alike, and the basis
  // would claim all three are fed by milling anything — 676 candidate pairs across the 71 decks.
  // `effect.scalingSubject` carries the counted type and whose graveyard, so the fill goes through
  // `graveyardFillMatches` exactly as a reanimator demand does. A payoff whose count derived no
  // subject forms nothing rather than everything.
  for (const e of pEvents) {
    if (!(e.verb === "enters" && e.subject.zone === "graveyard")) continue;
    for (const a of c.tags.abilities) {
      if (a.effect.scaling !== "per-graveyard" || !a.effect.scalingSubject) continue;
      // AN UNTYPED COUNT IS A WILDCARD, and `graveyardFillMatches` passes an untyped demand on
      // purpose, so this is where it has to be refused. Rite of Flame counts "cards NAMED Rite of
      // Flame in each graveyard" — a name, which no SubjectFilter can express — and it parsed to
      // nothing and claimed all 61 fills in its decks. Riverchurn Monument's "cards in their
      // graveyard" is honestly untyped and goes the same way: 49 claims the engine cannot justify.
      // A missing answer beats a wrong one, and the two are 110 of the 273 this loop first made.
      //
      // For RITE OF FLAME the refusal is the whole answer, not a stopgap: EDH is singleton, so a
      // card counting its own name finds at most one other copy, in an opponent's graveyard.
      // BUT THE `named` GAP ITSELF IS REAL HERE, and singleton is not the argument against it
      // (owner, 2026-08-15): **13 corpus cards say "a deck can have any number of cards named …"
      // and all 13 count their own name** — Dragon's Approach, Slime Against Humanity, Shadowborn
      // Apostle, Rat Colony, Hare Apparent, Persistent Petitioners. A Dragon's Approach deck runs 30
      // copies and the engine cannot see the archetype at all. 35 cards count a name anywhere, 19 of
      // them in a graveyard. That is a roadmap item, not a line of code here.
      const counted = a.effect.scalingSubject;
      // HISTORIC IS A NARROWING, and refusing it was the one wrong refusal here (roadmap C2b,
      // measured 2026-08-20). Artifact-legendary-or-Saga is a printed class, not a wildcard, so a
      // count restricted to it is not the Riverchurn shape. The population is EXACTLY THREE untyped
      // scaling subjects in the whole derived corpus: Riverchurn Monument (honestly untyped, still
      // refused), Rite of Flame (`named`, refused on purpose — the `named` gap is its own item) and
      // The Capitoline Triad, which is a calibration deck's own COMMANDER and could state nothing
      // about the graveyard its cost reduction reads.
      //
      // KEYED `scales:any`, deliberately. `themeSubjectKey` has no `historic` branch and adding one
      // would re-key two OTHER live subjects (Abstergo Entertainment, Samwise Gamgee), risking
      // frozen-panel debt for a cosmetic gain. The guard above is what refuses a wildcard; the key
      // is a grouping label and the reason text names both cards.
      if (list(counted.type).length === 0 && list(counted.subtype).length === 0 && counted.historic !== true) continue;
      // A deck ROLE is not a pairwise synergy. CORRECTED 2026-08-19: this comment used to say
      // "cost-reduction is the rule's own first member" and cite The Capitoline Triad — both parts
      // are now false. `cost-reduction` LEFT `ROLE_NOT_SYNERGY` on 2026-08-18 (the owner overturned
      // the 2026-08-06 ruling: "your cost reducing card is as good as many cards it can reduce"),
      // so this gate has not excluded it since, and a scaling cost reducer whose count names a type
      // DOES form edges today — Furygale Flocking earns 11 `scales:instant` reasons in
      // `izzet-big-mana`. The Capitoline Triad is refused by the untyped-count guard ABOVE, not by
      // this one: its `scalingSubject` is `{historic: true, zone: graveyard}` with no type or
      // subtype. The set is now {tax, win-game, extra-turn, extra-phase}.
      if (ROLE_NOT_SYNERGY.has(a.effect.kind)) continue;
      if (!graveyardFillMatches(e.subject, a.effect.scalingSubject, h)) continue;
      reasons.push({
        tag: `scales:${themeSubjectKey(a.effect.scalingSubject)}`,
        text: graveyardFeedsScaling(p.card.name, c.card.name),
        effectKind: a.effect.kind,
        repeatability: a.kind === "static" ? "static" : a.kind === "activated" ? "activated" : "triggered",
        scaling: a.effect.scaling,
        consumer: c.card.name,
        producer: p.card.name,
      });
    }
  }

  // BOARD-COUNT EDGE: the producer IS one of the things the consumer counts. Krenko, Mob Boss makes
  // a Goblin token per Goblin you control, so every other Goblin in the deck makes him bigger --
  // and no event says so. Nothing fires, nothing enters, nothing dies; the relation is that the
  // producer's PRINTED CHARACTERISTICS are inside the consumer's count. Owner-reported 2026-09-04
  // as the fourth case a Krenko page should answer, after goblin-entering, token-entering and
  // creature-entering, and the only one with no channel at all.
  //
  // THE SAME SHAPE AS THE GRAVEYARD SCALING EDGE ABOVE, one zone over: same `effect.scaling`, same
  // `scalingSubject`, same `ROLE_NOT_SYNERGY` gate. What differs is what it compares the count
  // against -- a fill there, a type line here.
  for (const a of c.tags.abilities) {
    const counted = a.effect.scalingSubject;
    if (!counted || counted.zone !== "battlefield") continue;
    if (ROLE_NOT_SYNERGY.has(a.effect.kind)) continue;
    // A BARE CARD TYPE IS A MESH, NOT A SYNERGY, and this is the gate that keeps the channel honest.
    // "Creatures you control" is satisfied by every creature in the deck: forty edges saying the
    // same nothing, which is the engine's own "playing Magic is not a synergy" rule. MEASURED
    // 2026-09-04: 685 battlefield counts are derived and 248 name a subtype -- those are the ones
    // that say something about a DECK rather than about Magic.
    const subtype = Array.isArray(counted.subtype) ? counted.subtype[0] : counted.subtype;
    if (subtype === undefined) continue;
    // A BASIC LAND TYPE IS THE MANA BASE. 20 corpus cards count Swamps and 13 count Mountains; a
    // mono-black deck runs thirty Swamps, and thirty edges into one payoff is the same mesh wearing
    // a different costume. The partial reversal for fetchlands and Urza's Saga is about a land that
    // FINDS something, not about a basic being counted.
    if (BASIC_LAND_TYPES.has(subtype)) continue;
    // AN OPPONENT'S BOARD IS NOT FED BY YOUR CARD.
    if (counted.control === "opp") continue;
    // `zone` IS DROPPED BEFORE THE COMPARISON and `control` IS KEPT, which is the opposite of what
    // the first cut did. A type line sits in no zone -- the fifth time this file records that
    // lesson -- but an ABSENT `control` on the consumer side is not a wildcard: `subjectMatches`
    // fails it against a producer that states one, so stripping it made every board count match
    // nothing at all and the channel silently produced zero edges.
    const { zone: _z, ...printed } = counted;
    if (!subjectMatches(characteristicsSubject(p.tags, p.card.name), printed, h)) continue;
    reasons.push({
      tag: `scales:${themeSubjectKey(counted)}`,
      text: boardCountFeedsScaling(p.card.name, c.card.name, a.effect.kind),
      effectKind: a.effect.kind,
      repeatability: a.kind === "static" ? "static" : a.kind === "activated" ? "activated" : "triggered",
      scaling: a.effect.scaling,
      consumer: c.card.name,
      producer: p.card.name,
    });
  }

  // A WIN CONDITION THAT NAMES WHAT IT COUNTS IS A RELATION, NOT A ROLE. `win-game` sits in
  // ROLE_NOT_SYNERGY because "this card wins the game" says the identical thing next to every card —
  // true of Laboratory Maniac, false of Revel in Riches, which wins on ten TREASURES and is
  // therefore a claim about Treasure producers. Gated on `thresholdSubject`: an untyped win
  // condition stays a role, exactly as before.
  for (const a of c.tags.abilities) {
    if (a.effect.kind !== "win-game") continue;
    const counted = a.trigger?.thresholdSubject;
    if (!counted) continue;
    if (!subjectMatches(characteristicsSubject(p.tags, p.card.name), counted, h)) continue;
    reasons.push({
      tag: `wincon:${themeSubjectKey(counted)}`,
      text: winconSentence(p.card.name, c.card.name),
      effectKind: a.effect.kind,
      repeatability: "static",
      consumer: c.card.name,
      producer: p.card.name,
    });
  }

  // Static edges: P is a lord whose effect subject C's characteristics satisfy. (UNCHANGED)
  //
  // Plus one non-static kind. A `clone` states WHICH permanent becomes the copy — "target
  // Shapeshifter becomes a copy of target creature" — and derive keeps that subject only when it
  // names a SUBTYPE, so the shape is typal by construction and cannot mesh the way an untyped lord
  // does. Shapesharer is an ACTIVATED ability, so this pass never saw it and Universal Automaton, a
  // Shapeshifter in the same deck, got no edge. Nothing else is widened: `token-generation` and the
  // other 500-odd non-static subjects with a subtype name what the card MAKES, not what it applies
  // to, and they are already carried by their emit.
  //
  // The subtype test lives HERE and not only in derive because both tag sources reach this pass:
  // measured, admitting every clone subject added 7,622 derived edges, a `clone:any` mesh 99 cards
  // wide on Mizzix's Mastery and Lithoform Engine. "Copy target instant" names no permanent it
  // applies to, and an untyped subject matches the whole deck.
  // ONE CLAIM PER PHYSICAL CARD, AND THE FIRST FACE THAT SATISFIES KEEPS IT. A permanent shows one
  // face at a time (CR 712.3a), so a card-wide static relates to it ONCE -- but faces-as-nodes
  // (2026-08-27) pairs the producer with each printed face separately, and `stampSides` rewrites
  // both rows back to the same physical name. Measured on the 71 decks: 217 duplicate rows
  // (cost-reduction 154, pump 60, type-grant 3), and MESHED 287 -> 332 sat ENTIRELY inside five
  // (deck, producer, tag) groups whose FAN-OUT never moved -- the extra rows were one claim said
  // twice, not a wider claim.
  //
  // NEITHER ROW IS FALSE, which is why this is a collapse and not a refusal: each is true of the
  // face it names. What is wrong is counting them as two claims about one card.
  //
  // KEPT ON THE FIRST SATISFYING FACE, never on face 0 unconditionally -- a modal DFC with a
  // Sorcery front and a Creature back is reached only by its back face, and anchoring on the front
  // would DELETE that claim rather than collapse it.
  //
  // THE CONSUMER SIDE ONLY. Two producer faces printing their own statics are two distinct printed
  // abilities, and collapsing those would be an under-claim of a different kind. Measured after this
  // fix, that residue is 75 rows, ALL `static:cost-reduction` and ALL one card (Serah Farron //
  // Crystallized Serah, which prints a reducer on each face) -- and cost-reduction is exempt from
  // the mesh census, so it moves no gate. Left alone deliberately.
  //
  // CEILING: re-splits the parent per claim rather than caching the faces. Only runs for a
  // multi-face consumer past face 0 that already formed a claim, which is 217 rows in 45,246.
  // The parameter SHADOWS the pair's own `c` on purpose: every guard below must judge the FACE it
  // is asked about, and a body that reached past it to the pair's consumer would answer the
  // sibling-face question with the original face's answer.
  const staticClaim = (c: DeckCard, a: CardTags["abilities"][number]): Reason | undefined => {
    if (!c.tags) return undefined;

    const appliesTo = a.kind === "static"
      || (a.effect.kind === "clone" && a.effect.subject?.subtype !== undefined);
    if (!appliesTo || !a.effect.subject) return undefined;
    // DECK ROLES ARE NOT PAIRWISE SYNERGIES (user rulings, 2026-08-06) — WITH `cost-reduction`
    // REMOVED FROM THAT SET BY THE OWNER, 2026-08-18: "your cost reducing card is as good as many
    // cards it can reduce."
    //
    // The 2026-08-06 argument was that a Medallion makes the identical claim in every deck, since
    // Sapphire Medallion in mono-red does nothing. The overturning argument is that it does nothing
    // there BECAUSE there is nothing to reduce, which a pairwise edge states correctly by forming
    // zero edges in that deck and forty in a mono-blue one. The colour and type restrictions are
    // already on the subject, so `subjectMatches` does that work for free.
    //
    // The measured cost is fan-out, and it is real: admitting this family takes edges 32,220 ->
    // 36,607, reasons 40,612 -> 46,219 and MESHED 288 -> 3,420, with Ugin, the Ineffable reaching
    // 74 cards in one deck. Fan-out is the POINT here (the count is the value), so `mesh.ts` exempts
    // this one tag from the mesh census rather than letting a deliberate width drown the instrument
    // that exists to catch accidental ones.
    //
    // `tax` is INTERACTION / PROTECTION. Propaganda and Ghostly Prison make opponents attack you
    // less. That is a role the deck plays against the table, not a relation to a card you chose to
    // run — Ghostly Prison protects you exactly as much whatever else is in the 99.
    //
    // Both still DERIVE: the kinds remain on the card and stay available as role signals for
    // `build.ts`. They simply stop claiming an edge.
    if (ROLE_NOT_SYNERGY.has(a.effect.kind)) return undefined;
    // A DEBUFF IS NOT AN ANTHEM, and this pass says "P's static applies to C" — a sentence that
    // claims C is IMPROVED. A negative modifier never improves the card it reaches, so relabelling
    // `pump` -> `debuff` at derive is only half the fix: measured, it left Curse of Death's Hold ->
    // Entity Tracker standing with a new tag and turned a judged FALSE into judging debt. The claim
    // has to go, not get renamed. What these cards really relate to is the OPPONENT'S board, which
    // is not in the deck and has no node.
    if (a.effect.kind === "debuff") return undefined;
    // A STATIC THAT DESCRIBES THE CARD ITSELF CLAIMS NO OTHER CARD. Planar Nexus prints "This land
    // is every nonbasic land type", derives `{type: land, scope: each, self: true}` -- the
    // self-reference recorded CORRECTLY -- and this pass rendered "Planar Nexus's type grant applies
    // to Swamp" 21 TIMES IN ONE DECK. Derive was innocent; `printedMatchable` strips `counter` and
    // `self` rides through into `subjectMatches`, WHICH DOES NOT READ `self` AT ALL (a fact this
    // repo first recorded on 2026-08-06, when a self-marked fill rode through the same way).
    //
    // FOUND BY THE SKEPTIC PERSONA FROM THE FAN-OUT ALONE, without reading the card: "the same claim
    // shape repeated on ~13 lands is the signature of a claim earned by being a land rather than by
    // anything about this deck." No gate in this repo could see it -- population, panel and mesh all
    // read normal.
    //
    // MEASURED AT ONE CARD: 1 of 172 derived statics carrying a subject has `self: true`. The gate
    // is worth one line and no more -- but it IS worth that line, because self-reference is the
    // largest defect family this engine has had (74% of all false edges at its peak) and the next
    // printed "this permanent is ..." walks straight into it.
    //
    // DO NOT TEACH `subjectMatches` ABOUT `self` INSTEAD. It is the identity predicate the
    // self-trigger gate depends on, and widening it there is exactly how the `entersTapped` strip
    // silently deleted 29 real claims.
    if (a.effect.subject.self === true) return undefined;
    // A counter-presence condition ("creatures you control WITH a +1/+1 counter") is a BOARD STATE,
    // not a printed characteristic, and this pass matches against the type line. Demanding it here
    // deletes the edge outright -- Sludge Monster's anthem stopped reaching anything. The dedicated
    // counter-presence pass below is what supplies that state.
    const { counter: _stateOnly, ...printedMatchable } = a.effect.subject;
    if (!subjectMatches(characteristicsSubject(c.tags, c.card.name), printedMatchable, h)) return undefined;
    if (a.effect.kind === "cost-reduction") {
      // A SELF REDUCTION'S SUBJECT IS WHAT MEASURES IT, NOT WHAT IT DISCOUNTS — see `reducesItself`.
      if (reducesItself(p.card.oracleText)) return undefined;
      // A LAND IS PLAYED, NOT CAST (CR 305.1). "Spells you cast cost {1} less" reaches no land, and
      // the type union keeps a modal DFC's castable face.
      if (isLandOnly(c.tags)) return undefined;
      // AND A TOKEN IS PUT ONTO THE BATTLEFIELD, NEVER CAST (CR 111.1) — the same rule as the land
      // one above, one object over. Found on the Jodah deck 2026-08-27: Serah Farron prints "the
      // first legendary creature SPELL you cast each turn costs {2} less", and the engine claimed it
      // discounted **Ravage**, a `Token Legendary Artifact Creature — Robot` that Soundwave creates.
      //
      // IT SURVIVES BECAUSE `hasGenericMana`'s LENIENT DEFAULT MEETS A CASE WHERE ABSENCE IS A FACT.
      // That guard answers `true` for a missing cost on purpose — "not recorded, refuse nothing",
      // which is right for a card whose cost the corpus failed to store. A token has no mana cost
      // because it is never cast, so the same silence means the opposite thing and the lenient
      // branch turns a missing answer into a wrong one. Gated HERE rather than in `hasGenericMana`,
      // which is also read by the ACTIVATED side, where a token's abilities really can be discounted.
      //
      // THE PAIR OFTEN SURVIVES, AND ONLY THIS REASON GOES. Serah Farron also prints "Legendary
      // creatures you control get +2/+2", and Ravage is one — so the edge keeps its `static:pump`
      // and loses only the claim that was false.
      if (c.isToken) return undefined;
      // "Spells your OPPONENTS cast cost less" is not a relation to a card you chose to run — it is
      // the tax family pointing the other way, and tax stays in ROLE_NOT_SYNERGY.
      if (a.effect.subject.control === "opp") return undefined;
      if (reducesAnAbility(p.card.oracleText)) {
        // AN ABILITY DISCOUNT IS ABOUT THE ABILITY'S COST AND NEVER THE CARD'S. The two are
        // different strings and reading the wrong one is wrong in BOTH directions: Thought Vessel
        // costs `{2}` and its only ability is `{T}: Add {C}`, so the card looks discountable and the
        // ability is not; Executioner's Capsule costs `{B}` and its ability costs `{1}{B}, {T},
        // Sacrifice this artifact`, so the card looks undiscountable and the ability is not.
        const costs = activationCosts(c.tags);
        // An ability discount needs an ability to discount — see `reducesAnAbility`.
        if (!costs.length) return undefined;
        // CR 118.7 ON THE ACTIVATED SIDE. Owner's ruling 2026-08-23, OVERTURNING a cached REAL:
        // "the consumer has activated abilities" is necessary and not sufficient. `{T}: Add {C}` has
        // no mana in its cost at all, so `{1} less to activate` removes nothing.
        if (!costs.some(hasGenericMana) && !reducesColouredMana(p.card.oracleText)) return undefined;
        // AND THE PRINTED FLOOR, which BOTH derived reducers carry: "can't reduce the mana in that
        // cost to less than one mana". An ability costing one mana cannot be reduced at all, so a
        // Signet (`{1}, {T}: Add …`) is not discounted however much generic it prints. Gated on the
        // producer's own cue, because a reducer WITHOUT a floor really would take that ability to
        // zero. Read as "some ability survives the floor", so Executioner's Capsule (`{1}{B}` = two
        // mana, reduced to one) keeps its claim and its owner-era verdict with it.
        if (reducesToAFloor(p.card.oracleText)
          && !costs.some((cost) => hasGenericMana(cost) && manaInCost(cost) >= 2)) return undefined;
      } else if (!hasGenericMana(c.card.manaCost)
        // A REDUCTION CANNOT TAKE GENERIC MANA BELOW ZERO (CR 118.7) — see `hasGenericMana`. Both
        // exemptions are checked because both are real: a coloured-pip reduction discounts a `{U}`
        // spell, and an ADDITIONAL COST adds to the total before reductions subtract from it.
        && !reducesColouredMana(p.card.oracleText)
        && !hasAdditionalCost(c.tags)) return undefined;
    }
    return {
      // A non-static ability keeps the `${kind}:${subject}` shape the graveyard-recursion and
      // counter-presence passes use; `static:` stays reserved for what cardThemeTags calls static.
      tag: a.kind === "static"
        ? `static:${a.effect.kind}`
        : `${a.effect.kind}:${themeSubjectKey(a.effect.subject)}`,
      text: a.effect.kind === "cost-reduction"
        ? costReductionSentence(p.card.name, c.card.name)
        : staticGrantSentence(p.card.name, c.card.name, a.effect.kind,
          typeGrantNoun(a.effect.subject?.type, c.tags.characteristics.types)),
      effectKind: a.effect.kind,
      repeatability:
        a.kind === "static" ? "static" : a.kind === "activated" ? "activated" : a.kind === "on-cast" ? "oneshot" : "triggered",
      scaling: a.effect.scaling,
      hasStatPredicate: (a.effect.subject?.stats?.length ?? 0) > 0 || undefined,
      consumer: c.card.name,
      producer: p.card.name,
    };
  };
  for (const a of p.tags.abilities) {
    const claim = staticClaim(c, a);
    if (!claim) continue;
    const earlier = c.face && c.parent ? faceDeckCards(c.parent).slice(0, c.face) : [];
    if (earlier.some((f) => staticClaim(f, a))) continue;
    reasons.push(claim);
  }

  // TRIGGER-DOUBLING edges: P makes C's triggered ability fire twice. Panharmonicon + Solemn
  // Simulacrum is the relation; Panharmonicon + a vanilla creature is not.
  //
  // THIS IS A TRIGGER-TO-TRIGGER PASS AND IT IS THE FIRST ONE. Every other pass here runs a
  // producer's EVENT against a consumer's TRIGGER. A doubler emits no event -- it modifies an
  // ability -- so the consumer side is matched on what it TRIGGERS ON, and nothing is synthesized on
  // the producer side. (Fable's review, 2026-08-22, refuted the two obvious alternatives: applying
  // the CR 614 precedent mechanically would synthesize `trigger: enters` and pair Panharmonicon with
  // every artifact's and creature's IMPLIED ENTRY -- every vanilla body in the deck; and pairing with
  // a TOKEN MAKER is a three-card claim, since tokens entering fire nothing unless some third card
  // carries the ability, which is the shape B3 refused for the tax interaction.)
  //
  // `a.doubles` IS READ, NEVER `a.effect.subject` -- a subject stamped for this family would flow
  // into the static applies-to pass above, which matches against TYPE LINES, and claim
  // "Panharmonicon's static applies to Arcane Signet" about every vanilla artifact in the deck.
  //
  // A SELF TRIGGER COUNTS, and it is the headline case: Solemn Simulacrum's own ETB is exactly what
  // Panharmonicon doubles. This pass therefore does NOT apply the self-reference gates the event
  // passes need -- there is no class-vs-self ambiguity when the consumer's own printed trigger is
  // the thing being doubled.
  for (const a of p.tags?.abilities ?? []) {
    if (a.effect?.kind !== "trigger-doubling" || !a.doubles?.length) continue;
    for (const ca of c.tags?.abilities ?? []) {
      const verb = (ca.trigger?.verbs ?? []).find((v) => a.doubles!.includes(v));
      if (!verb) continue;
      // A doubler says "a triggered ability of a permanent YOU CONTROL". A consumer whose trigger
      // watches an OPPONENT's board is not doubled by it.
      if (ca.trigger?.subject?.control === "opp") continue;
      reasons.push({
        tag: `doubles:${verb}`,
        text: doublesSentence(p.card.name, c.card.name, verb),
        effectKind: "trigger-doubling",
        repeatability: "static",
        consumer: c.card.name,
        producer: p.card.name,
      });
      break; // one claim per consumer ability, not one per matching verb
    }
  }
  // TUTOR edges: P can SEARCH UP C. "My search can find you" is not a producer-event to
  // consumer-trigger relation, which is why the recall measurement filed the family as
  // `miss-inexpressible` — wrongly, Commander Salt models it. Flamekin Harbinger searching for an
  // Elemental card genuinely relates to every Elemental in the deck.
  //
  // GATED ON A SUBTYPE, for exactly the reason the clone gate is. Of 115 corpus search actions,
  // "a card" (Demonic Tutor, Grim Tutor, Gamble) reaches all 99 others, "a creature card" (Worldly
  // Tutor) reaches the whole creature base, "an artifact card" (Fabricate) the whole artifact base.
  // A bare TYPE is not a relation to any particular card. A SUBTYPE is.
  //
  // LAND subtypes are excluded on top of that: a fetchland naming Swamp is the MANA BASE, and the
  // cost-reduction and tax rulings already settled that a deck property is not a pairwise synergy.
  // 60 of the 115 search actions are land fetches, and every one would edge to every dual.
  //
  // `top-manipulation` is shared with scry, surveil and mill — none of which carry a narrowing
  // subject, so the same gate keeps them out without needing to know the verb.
  for (const a of p.tags.abilities) {
    if (a.effect.kind !== "top-manipulation" || !a.effect.subject) continue;
    // A SUBTYPE or a STAT PREDICATE narrows; a bare type does not. `combatNarrowsOffType` has said
    // the same about stats all along — Imperial Recruiter's "power 2 or less" and Spellseeker's
    // "mana value 2 or less" pick out particular cards, not a whole type.
    // A disjunction keeps its subtypes in the branches: Magda's "an artifact or Dragon card" is
    // `anyOf: [{type: artifact}, {subtype: dragon}]`, and reading only the outer subject would miss
    // the Dragon half that makes her a typal tutor at all.
    const subs = [
      ...list(a.effect.subject.subtype),
      ...(a.effect.subject.anyOf ?? []).flatMap((b) => list(b.subtype)),
    ];
    // A NAME narrows harder than any subtype: it picks out one card. The First Doctor searches for
    // "a card named TARDIS" and derived a bare `top-manipulation` the gate refused as unnarrowed, so
    // the most specific tutor in the corpus was the one that formed nothing.
    const narrows = subs.length > 0 || (a.effect.subject.stats?.length ?? 0) > 0
      || a.effect.subject.named !== undefined;
    // A LAND FINDER IS ITS OWN RELATION, and it is the one the ramp diagnostic is built on (owner's
    // ruling, 2026-08-15, reversing the blanket land exclusion above). Farseek relates to the Plains,
    // Islands, Swamps and Mountains it can actually fetch — including every dual carrying one of
    // those basic types — and Rampant Growth to the basics. That relation is what lets a report say
    // "your ramp finds 4 targets for this colour and 11 for that one", which is a deckbuilding fact
    // no other channel in the engine can state. `bin/ramp-coverage.ts` is its consumer.
    //
    // TWO SHAPES, because the cards say it two ways: a BASIC LAND TYPE list (Farseek, the fetchlands)
    // and the `basic` supertype (Rampant Growth, Cultivate, Evolving Wilds). A bare "a land card"
    // (Expedition Map, Sowing Mycospawn — 2 cards) stays refused: every land answers it, so it names
    // no particular card, which is the same bar the typal tutors clear.
    //
    // CONTROL IS LOAD-BEARING HERE. Path to Exile and Assassin's Trophy search for a basic land too —
    // for the OPPONENT, as compensation for removal — and derive `control: "opp"`. Claiming they ramp
    // YOUR mana base is a wrong sentence. `any` is kept: it is the parser's "could not tell", and
    // Cultivate and Evolving Wilds both land there.
    const landSubtypes = subs.length > 0 && subs.every((s) => LAND_SUBTYPES.has(s));
    const basicLand = a.effect.subject.basic === true && list(a.effect.subject.type).includes("land");
    const found = characteristicsSubject(c.tags, c.card.name);
    if (landSubtypes || basicLand) {
      if (a.effect.subject.control === "opp") continue;
      if (!subjectMatches(found, a.effect.subject, h)) continue;
      reasons.push({
        tag: `ramp-target:${landSubtypes ? themeSubjectKey(a.effect.subject) : "basic"}`,
        text: fetchSentence(p.card.name, c.card.name),
        effectKind: a.effect.kind,
        repeatability:
          a.kind === "static" ? "static" : a.kind === "activated" ? "activated" : a.kind === "on-cast" ? "oneshot" : "triggered",
        scaling: a.effect.scaling,
        consumer: c.card.name,
        producer: p.card.name,
      });
      continue;
    }
    if (!narrows) continue;
    if (!subjectMatches(found, a.effect.subject, h)) continue;
    // Key on the branch that MATCHED. "An artifact or Dragon card" keyed as `tutor:artifact` would
    // report a Dragon as an artifact — the same defect themeSubjectKey documents for negations.
    const { anyOf, ...shared } = a.effect.subject;
    const matched = anyOf?.find((b) => subjectMatches(found, { ...shared, ...b }, h));
    reasons.push({
      tag: `tutor:${themeSubjectKey(matched ?? a.effect.subject)}`,
      text: tutorSentence(p.card.name, c.card.name),
      effectKind: a.effect.kind,
      repeatability:
        a.kind === "static" ? "static" : a.kind === "activated" ? "activated" : a.kind === "on-cast" ? "oneshot" : "triggered",
      consumer: c.card.name,
      producer: p.card.name,
    });
  }

  // Counter-presence edges: C has an ability whose effect subject is filtered on a counter kind
  // ("creatures you control WITH a +1/+1 counter"), which is a cares-signal with no emit behind
  // it — the card benefits from a board state rather than reacting to an event. P supplies that
  // state. Tagged into the existing counter-added family so the tag pays off where it's actually
  // read: buildAxis/maxAxisWeight (axis.ts) do exact-tag lookup against the deck's axis, so a
  // `counter-added:*` Reason here counts on-axis alongside the event-edge ones. It does NOT
  // change deckFreq/themes/rankThemes/cohesion — those come from cardThemeTags (analyze.ts),
  // which reads triggers/emits/static kinds and never sees a Reason tag.
  //
  // Walks producerEvents(p.tags), not raw pa.emits: producerEvents adds proliferate-derived
  // counter events on top of authored ones, and its dedup means two abilities that emit the
  // identical event don't each spawn their own (byte-identical) Reason here.
  for (const emit of pEvents) {
    if (emit.verb !== "counter-added" || !emit.subject.counter) continue;
    for (const ca of c.tags.abilities) {
      const want = ca.effect.subject;
      if (!want?.counter || want.counter !== emit.subject.counter) continue;
      // an ability that emits the same event is already covered by the event-edge pass above
      if ((ca.emits ?? []).some((e) => e.verb === "counter-added")) continue;
      if (ca.trigger?.verbs.includes("counter-added")) continue;
      if (!subjectMatches(emit.subject, want, h)) continue;
      reasons.push({
        tag: `counter-added:${themeSubjectKey(want)}`,
        text: counterPresenceSentence(p.card.name, c.card.name, want.counter),
        effectKind: ca.effect.kind,
        repeatability: ca.kind === "static" ? "static" : ca.kind === "activated" ? "activated" : ca.kind === "on-cast" ? "oneshot" : "triggered",
        scaling: ca.effect.scaling,
        consumer: c.card.name,
        producer: p.card.name,
      });
    }
  }

  // THE COPY FAMILY, AND THE RULE NOBODY PRINTS (CR 707.2 + CR 704.5j).
  //
  // A copy effect puts a second Hidetsugu and Kairi onto the battlefield. Two facts follow, and the
  // engine could state neither. The copy has the copied card's abilities (CR 707.2), so the copied
  // card's OWN entry trigger fires again -- and if it is LEGENDARY, CR 704.5j immediately puts one
  // of the two into its owner's graveyard, firing its own death trigger. The legend rule is a
  // STATE-BASED ACTION printed on no card, so no clause layer can ever reach it: the same shape as
  // a Saga's own sacrifice (`sagaEvents` in implied.ts), except a Saga at least prints a reminder.
  //
  // Measured on `hidetsugu-and-kairi-like-to-multiply`, the deck built to abuse exactly this: 28
  // cards carry a permanent-copy cue and 18 of them had degree <= 1, their only edge a medallion.
  //
  // WHY THE PRINTED CUE AND NOT AN EFFECT KIND. The derived kinds do not separate the family. Rite
  // of Replication derives `token-generation` byte-identically to a 1/1 Soldier maker, and the one
  // structural marker (`scope: "target"` with `token: true`) reads 38 corpus cards of which 4 are
  // Role/Aura tokens ATTACHED to a target, not copies of it. The three templates are printed and
  // nothing else uses them.
  const copy = copySubject(p);
  if (copy && !c.isToken) {
    const legendary = c.tags.characteristics.types.includes("legendary");
    // A copy ability that prints "nonlegendary" cannot ever copy a legendary consumer, by ANY verb
    // -- CR gives no way around a printed restriction. See `COPY_EXCLUDES_LEGENDARY_CUE`.
    if (!(copy.notLegendary && legendary)) {
      for (const a of c.tags.abilities) {
        if (!a.trigger?.subject.self) continue;
        for (const rawVerb of a.trigger.verbs) {
          // The RAW verb, not the normalized one: `normalizeZoneEvent` rewrites `dies` to
          // `leaves`@battlefield, which a plain "when this leaves the battlefield" trigger also
          // becomes -- and a bounce is not a death the legend rule causes.
          if (rawVerb !== "enters" && rawVerb !== "dies") continue;
          // ENTERS is claimed only by the cues that put a NEW object onto the battlefield. "Becomes
          // a copy" (Sakashima's Will) rewrites a permanent already in play -- no entry, still two
          // legends. DIES needs the legend rule, so it needs a legendary consumer and nothing else.
          if (rawVerb === "enters" && !copy.enters) continue;
          if (rawVerb === "dies" && !legendary) continue;
          const t = normalizeZoneEvent({ verb: rawVerb, subject: a.trigger.subject });
          if (!subjectMatches(characteristicsSubject(c.tags, c.card.name), copy.subject, h)) continue;
          const key = zoneEventKey(t.verb, t.subject.zone, themeSubjectKey(t.subject));
          reasons.push({
            tag: key,
            text: copySentence(p.card.name, c.card.name, key, rawVerb === "dies"),
            effectKind: a.effect.kind,
            repeatability: triggerRepeatability(t.subject),
            scaling: a.effect.scaling,
            consumer: c.card.name,
            producer: p.card.name,
          });
        }
      }
    }
  }

  // A CONDITIONAL LAND IS A DEPENDENCY ON YOUR MANA BASE'S SHAPE (roadmap I9, owner's ruling
  // 2026-08-22: "Cinder Glade will never come in untapped if you do not have any basics in the
  // deck"). Rootbound Crag enters untapped only while you control a Mountain or a Forest, and
  // Thornspire Verge's second mana ability is switched off without one. That is a pairwise relation
  // the engine had no channel for, and it is PRINTED — so it is read here rather than derived,
  // free, the `sagaEvents` shape.
  //
  // THE CONSUMER IS THE LAND. It demands; the card carrying the type supplies. Reading it the other
  // way round would say a Mountain "does something" to the Crag, which is backwards — the Crag is
  // the card whose value moves.
  //
  // ONLY `check` AND `verge`, both of which name a basic land SUBTYPE. `bfz` demands the SUPERTYPE
  // `basic` as a COUNT ("two or more basic lands"), so every basic contributes equally and it names
  // no member — the registered "a claim that applies to a card merely for being an ordinary card is
  // false". It is a deck-level fact, the `deckSlack` shape, and forms nothing here. Everything the
  // classifier could not read is `unclassified` and forms nothing either.
  const landCond = classifyLand(c.card);
  // THE G FAMILY IS THE SAME DEMAND ON A CARD THAT IS NOT A LAND (roadmap I9): Summit Apes wants a
  // Mountain exactly as Rootbound Crag does, so it takes the same SUBTYPE edge. A land's own
  // condition is asked first, so a card can never claim both.
  const wantedSubtypes = landCond.template === "check" || landCond.template === "verge"
    ? landCond.subtypes
    : basicTypeDemand(c.card);
  if (wantedSubtypes.length > 0 && p.card.name !== c.card.name) {
    // The PRINTED type line, every face — an "Instant // Land — Mountain" really is a Mountain when
    // you play its land half. Basics and nonbasics alike: Steam Vents carries Mountain, and 233
    // nonbasic land slots across the 71 decks do the same.
    const supplied = new Set(parseTypeLineAllFaces(p.card.typeLine).subtypes);
    const match = wantedSubtypes.find((t) => supplied.has(t));
    if (match !== undefined) {
      reasons.push({
        tag: `land-condition:${match}`,
        text: landConditionSentence(p.card.name, c.card.name, match,
          landCond.template === "check" || landCond.template === "verge" ? landCond.template : "basic-type-demand"),
        repeatability: "static",
        consumer: c.card.name,
        producer: p.card.name,
      });
    }
  }

  return dedupeReasons(reasons.map((r) => stampSides(r, p, c)));
}

/** All reasons for the unordered pair {a,b}: union of a→b and b→a directional reasons, deduped
 *  by byte-identical shape modulo `impliedProducer` (e.g. an authored counter-added emit and a
 *  proliferate-derived counter-added emit can independently satisfy the same consumer trigger,
 *  producing two Reason objects that differ only in provenance — collapse those since dedup must
 *  not change edge score). `impliedProducer` is excluded from the key so a baseline-supplied match
 *  of the same tag/producer/consumer collapses into its authored counterpart instead of doubling
 *  the score. This relies on `producerEvents` (edges.ts) ordering authored emits before implied
 *  ones: keep-first here means the surviving copy has `impliedProducer: undefined`, which is also
 *  the copy `themeMembership` (themes.ts) wants for surplus credit. If that ordering ever changes,
 *  this dedup silently starts keeping the implied copy instead. */
/** MELD: the one relation here that is card NAME to card NAME.
 *
 *  Mishra, Claimed by Gix names "a creature named Phyrexian Dragon Engine" outright. Everything else
 *  in this file matches a producer EVENT to a consumer TRIGGER, so that shape had nowhere to land —
 *  the recall measurement filed the pair `miss-inexpressible`, which was wrong: Commander Salt
 *  models it as a `named` qualifier, MTGJSON as `cardParts`, and `docToCard` (data/docs.ts) derives
 *  `meldPartner` from Scryfall's `allParts` on every read -- a stored field was erased by the first
 *  full re-ingest after it was written, and this edge drew nothing for a month.
 *
 *  Emitted from `pairReasons` rather than `directedReasons` because the relation is SYMMETRIC and the
 *  pair is one fact: both halves must be on the battlefield, so neither is the producer. Emitting it
 *  per direction would double every meld pair in the report.
 *
 *  There is no `effectKind`: the closed 30 are payoff kinds, and melding is not one of them. The
 *  field is optional for exactly this sort of case. */
export function meldReason(a: DeckCard, b: DeckCard): Reason[] {
  const partnered = a.card.meldPartner === b.card.name || b.card.meldPartner === a.card.name;
  if (!partnered) return [];
  return [stampSides({
    tag: "meld",
    text: meldSentence(a.card.name, b.card.name),
    repeatability: "oneshot",
    producer: a.card.name,
    consumer: b.card.name,
  }, a, b)];
}

/** Token creation edges: a producer's own AUTHORED create-token emit, matched against the token
 *  NODE's characteristics (Task 6, tokens-as-nodes). A dedicated pass because every other reason in
 *  this file requires the CONSUMER to carry an ability (a trigger, an effect subject) -- a token
 *  node commonly has none: 59 of the 94 derived tokens are vanilla (a plain Flying Bird), and
 *  without this a maker card and its own token would form no edge at all despite the token sitting
 *  on the node set.
 *
 *  RESTRICTED TO AUTHORED emits (`ability.emits`), never `producerEvents`'s keyword-implied ones
 *  (Amass, Fabricate, Embalm, ...). A keyword-implied create-token event carries no type filter --
 *  `KEYWORD_EMITS` records `{verb:"create-token", token:true}` and nothing else -- so matching it
 *  through `subjectMatches` would claim a Fabricate creature makes every OTHER token type in the
 *  deck too, since every token satisfies a filter that only checks control and token-ness.
 *
 *  Callers must gate this to pairs where `p` is structurally known to create `c`
 *  (`createdTokenRefs`, matcher/tokens.ts -- the exact printingId join Task 3/4a built) before
 *  calling: that is what stops an untyped authored emit (rare, but present) from wildcarding onto a
 *  token this card never actually makes. `subjectMatches`/`themeSubjectKey` here only pick the best
 *  reason tag/text among the card's own emits, never decide the relationship itself. */
/** Does `p` create token `c` UNDER OUR CONTROL? Beast Within and Generous Gift make their Beast/
 *  Elephant for the permanent's controller -- "Its controller creates a 3/3 green Beast" -- and the
 *  clause layer already records that, `control: "opp"` on the `create-token` emit.
 *
 *  Separate from `createsReasons` on purpose, and the graph edge deliberately keeps ignoring it: "this
 *  card makes that token exist" is TRUE for Beast Within, which is why the token is on its board at
 *  all. What is false is the RATINGS claim built on top of it -- that Beast Within supports your
 *  token payoff -- because a payoff says "tokens YOU control". So the traversal gates, the edge does
 *  not. `control: "any"` counts as ours: a card that says only "create a 4/4 Dragon" (Elemental
 *  Eruption) creates it under its own controller, and refusing those would delete nearly every real
 *  token maker in the corpus. */
export function createsForYou(p: DeckCard, c: DeckCard, h: Hierarchy): boolean {
  if (!p.tags || !c.tags || c.tags.characteristics.token !== true) return false;
  const consumerSubject = characteristicsSubject(c.tags, c.card.name);
  return p.tags.abilities.some((pa) =>
    (pa.emits ?? []).some((e) =>
      e.verb === "create-token" && e.subject.control !== "opp" && subjectMatches(consumerSubject, e.subject, h)));
}

export function createsReasons(p: DeckCard, c: DeckCard, h: Hierarchy): Reason[] {
  if (!p.tags || !c.tags || c.tags.characteristics.token !== true) return [];
  const consumerSubject = characteristicsSubject(c.tags, c.card.name);
  const reasons: Reason[] = [];
  for (const pa of p.tags.abilities) {
    for (const e of pa.emits ?? []) {
      if (e.verb !== "create-token") continue;
      if (!subjectMatches(consumerSubject, e.subject, h)) continue;
      reasons.push({
        tag: `creates:${themeSubjectKey(e.subject)}`,
        text: createsSentence(p.card.name, c.card.name),
        effectKind: "token-generation",
        repeatability:
          pa.kind === "static" ? "static" : pa.kind === "activated" ? "activated" : pa.kind === "on-cast" ? "oneshot" : "triggered",
        consumer: c.card.name,
        producer: p.card.name,
      });
    }
  }
  return dedupeReasons(reasons.map((r) => stampSides(r, p, c)));
}

export function pairReasons(a: DeckCard, b: DeckCard, h: Hierarchy): Reason[] {
  return dedupeReasons([
    ...directedReasons(a, b, h),
    ...directedReasons(b, a, h),
    ...meldReason(a, b),
  ]);
}

/** TWO CARDS AS THE SHIPPED ENGINE SEES THEM: every printed FACE of one against every printed face
 *  of the other.
 *
 *  `pairReasons` takes two `DeckCard`s and reads whatever type line, text and ability list they
 *  carry -- which for a multi-face card is the COMBINED card. `analyzeDeckStructured` has not asked
 *  it that question since faces-as-nodes (2026-08-27): it splits every card with `faceDeckCards`
 *  first, so each face is matched with only the abilities IT prints and its own type line. The
 *  difference is not cosmetic -- CLAUDE.md records `copySubject`'s `typed[0]` picking a different
 *  ability once the list is face-scoped, which changed a real claim.
 *
 *  So any caller asking "what does the engine say about these two cards" must ask through here, or
 *  it describes an engine that no longer ships. Both such callers do: the pair-judging tool, and the
 *  offline ratchet that gates its verdicts -- and those two disagreeing is the specific failure this
 *  exists to prevent, since one writes the fixture the other reads.
 *
 *  A pair of single-faced cards takes the plain path, so the overwhelmingly common case is exactly
 *  `pairReasons` and nothing here can change it. Reasons are deduped on (tag, text): two faces of
 *  one card can produce the same sentence, and `stampSides` has already rewritten both endpoints to
 *  the PHYSICAL card name (`parentName`), so such rows really are one claim said twice. */
export function pairReasonsAcrossFaces(a: DeckCard, b: DeckCard, h: Hierarchy): Reason[] {
  const fa = faceDeckCards(a);
  const fb = faceDeckCards(b);
  if (fa.length === 1 && fb.length === 1) return pairReasons(a, b, h);
  const out: Reason[] = [];
  const seen = new Set<string>();
  for (const x of fa) {
    for (const y of fb) {
      for (const r of pairReasons(x, y, h)) {
        const key = `${r.tag} ${r.text}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(r);
      }
    }
  }
  return out;
}
