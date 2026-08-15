/** Canonical clauses to the Ability[] the engine already consumes. Pure: no model, no database.
 *
 *  One Ability per ACTION rather than per clause, because effect.kind is singular and a drain has
 *  to register on both the lifeloss and the lifegain axis. An action that yields neither a kind nor
 *  an emit is returned in `unclaimed` instead of vanishing -- a dropped clause that produces
 *  silence is indistinguishable from a card that does nothing, which is exactly how Bitterblossom
 *  sat in the corpus as a vanilla bear. */
import type { Action, ClauseRecord } from "../canonicalize.js";
import type { Ability, AbilityKind, CardTags, Characteristics, Control, SubjectFilter, Verb } from "../schema.js";
import { VERB_ALIASES, VERB_VOCAB } from "../schema.js";
import { ZONE_SCOPED_KINDS, actionEffectKind, extraPhaseName } from "./effect-kind.js";
import { actionEmits } from "./emits.js";
import { actionRecipients } from "./recipient.js";
import { actionScaling } from "./scaling.js";
import { parseSubject } from "./subject.js";
import { repeatsFor } from "./repeats.js";
import { thresholdFor } from "./threshold.js";
import { SUBTYPES } from "./subtypes.js";
import { triggerHasCue } from "../clause-store.js";

/** Bump when derivation semantics change — a new effect kind, a changed emit, a new guard. Unlike
 *  NORMALIZE_VERSION this is FREE to bump: it only re-runs `derive-corpus`, which reads the stored
 *  clauses and calls no model. That asymmetry is the whole point of storing clauses separately. */
export const DERIVE_VERSION = 42;

/** Verbs that state no action at all; they are inert, not unclaimed. */
const INERT_VERBS = new Set(["none"]);

/** Proliferate is a keyword ACTION -- a discrete thing a player does -- so a STATIC clause naming
 *  it is modifying somebody else's proliferate, never performing one. Tekuthal ("if you would
 *  proliferate, proliferate twice instead") is the case: the segmenter's EFFECT_ACTIONS row already
 *  refuses the replacement templating, but the verb is in the clause vocabulary now and the model
 *  reaches for it anyway. Emitting the event here would make Tekuthal a proliferate SOURCE and mesh
 *  it with every proliferate payoff, which is the false-emit class of defect, not a missing edge. */
function keywordActionOnStaticClause(kind: AbilityKind, verb: string | undefined): boolean {
  return kind === "static" && verb === "proliferate";
}

/** segment.ts's clause-side vocabulary ("spell" | "activated" | "triggered" | "static") to the
 *  engine's AbilityKind. "spell" is the clause-side name for what the engine calls "on-cast" --
 *  every instant/sorcery clause is tagged "spell" (see segment.ts's `classify`), so mapping it to
 *  "static" instead makes every burn spell a static lord that matches every card in the deck via
 *  edges.ts's wildcard subjectMatches. Anything unrecognised defensively falls back to "static".
 */
const CLAUSE_TO_ABILITY_KIND: Record<string, AbilityKind> = {
  spell: "on-cast",
  activated: "activated",
  triggered: "triggered",
  static: "static",
  "on-cast": "on-cast",
};

function abilityKind(clause: ClauseRecord): AbilityKind {
  return CLAUSE_TO_ABILITY_KIND[clause.abilityType ?? ""] ?? "static";
}

/** VOCAB set for a fast legality check after alias normalization. */
const LEGAL_VERBS = new Set<string>(VERB_VOCAB);

/** normalize-prompt.ts's TRIGGERS vocabulary to the engine's Verb vocabulary. These are two
 *  independently closed sets, and where they name the same event they spell it differently: the
 *  clause side names the EVENT ("life-gained"), the engine side names the ACTION ("gain-life").
 *  Only exact identities belong here. `draw-step` was for a long time the clause vocabulary's only
 *  way to say "whenever you draw a card", and was mapped to `draw` — conflating the turn phase with
 *  the event, so a card triggering at the beginning of its draw step meshed with every draw payoff.
 *  `draw` became a TRIGGERS member in its own right once the persist gate refused Psychosis Crawler
 *  and Underworld Dreams for answering it (250 corpus cards carry such a trigger), and the bridge is
 *  now RETIRED: `draw-step` means the draw step and nothing consumes it.
 *  `damage-dealt`, `blocks`, `main-phase`, `chapter` and friends have no engine verb at all and
 *  are deliberately absent: they surface in `unknownTriggers` rather than pick a near-miss. */
const CLAUSE_TRIGGER_TO_VERB: Record<string, Verb> = {
  "life-gained": "gain-life",
  "life-lost": "lose-life",
  sacrificed: "sacrifice",
  discarded: "discard",
  milled: "mill",
};

/** Normalize a trigger event through VERB_ALIASES, then check it against the closed VERB_VOCAB.
 *  A near-miss spelling that survives uncorrected (e.g. "die" instead of "dies") means the trigger
 *  silently never matches any producer event -- dead with no error, since triggers have no
 *  `unclaimed`-style safety net of their own. Returns null for anything illegal so the caller can
 *  omit the trigger rather than assert a verb the vocabulary doesn't recognise. */
function normalizeTriggerVerb(event: string): Verb | null {
  const normalized = CLAUSE_TRIGGER_TO_VERB[event] ?? VERB_ALIASES[event] ?? event;
  return LEGAL_VERBS.has(normalized) ? (normalized as Verb) : null;
}

/** A clause that takes life from an opponent AND gives it to you is a drain, which is its own kind
 *  in the engine's vocabulary and what aristocrats payoffs match on. Added ALONGSIDE the per-action
 *  abilities, not instead of them, so the card still registers on the lifeloss and lifegain axes.
 *  Without this, Zulaport Cutthroat and Blood Artist lose the kind their live tags carry today. */
function drainAbility(clause: ClauseRecord, kind: AbilityKind, trigger: Ability["trigger"], cost: string): Ability | null {
  const actions = clause.actions ?? [];
  const loss = actions.find((a) => a.verb === "lose-life" && parseSubject(a.object ?? "").control !== "you");
  const gain = actions.find((a) => a.verb === "gain-life" && parseSubject(a.object ?? "").control === "you");
  if (!loss || !gain) return null;
  // Same wildcard-mesh guard as the per-action loop above: a static-typed drain clause with an
  // unconstrained subject would otherwise reproduce the whole-deck lord edge namesItsTargets exists
  // to prevent.
  const subject = parseSubject(loss.object ?? "");
  const keepSubject = kind !== "static" || namesItsTargets(subject);
  const ability: Ability = { kind, effect: keepSubject ? { kind: "drain", subject } : { kind: "drain" } };
  if (trigger) ability.trigger = trigger;
  // No `amount`: a drain merges two source actions (the loss and the gain), and no single amount is
  // attributable to the merged ability -- guessing one would be the wrong-sentence-dressed-as-data
  // failure this project refuses everywhere else (see threshold.ts's header).
  if (clause.abilityType === "activated") ability.cost = cost;
  return ability;
}

/** Does this TRIGGER subject name the card itself? "When THIS creature enters" watches one
 *  permanent -- its own -- while "whenever another creature you control enters" watches the deck,
 *  and `parseSubject` reduces both to {type: creature}. The clause text is the only place the
 *  difference survives, so it is recovered here.
 *
 *  A subject mentioning "another" or "other" is NOT self even when it opens with a self-reference:
 *  Zulaport Cutthroat's "this creature or another creature you control" is a real aristocrats
 *  payoff, and marking it self would delete the edge this engine most wants to find. */
function isSelfSubject(text: string, cardName?: string): boolean {
  const t = text.trim().toLowerCase();
  if (t === "") return false;
  if (/\banother\b|\bother\b/.test(t)) return false;
  // Bare "this" with no noun after it — how Bojuka Bog and Zhalfirin Void record their own entry.
  // Checked HERE rather than by widening SELF_REFERENCE, which effect subjects also use: a trigger
  // subject of "this" is unambiguous, while an effect object beginning "this turn ..." is not.
  if (/^this\b/.test(t)) return true;
  if (SELF_REFERENCE.test(t)) return true;
  if (!cardName) return false;
  const name = cardName.toLowerCase();
  // The model names the card either in full ("Urza, Lord High Artificer") or by the short name a
  // card's own text uses ("Urza"), which is everything before the first comma or face divider.
  if (t === name || t === name.split(/[,/]/)[0].trim()) return true;
  // A card with no comma in its name still shortens itself: Imskir Iron-Eater's own text says
  // "Imskir". Accept the FIRST WORD — but never when that word is a creature type, because
  // "whenever a Goblin enters" on a card named Goblin Bombardment is a real typal payoff and
  // marking it self would delete the edges a Goblin deck is made of.
  const first = name.split(/\s+/)[0];
  return t === first && !SUBTYPES.has(first);
}

/** "this creature or another artifact you control" — a trigger that watches the card's OWN entry and,
 *  separately, a class the deck supplies. `isSelfSubject` already declines to call this self (the
 *  Zulaport case), but `parseSubject` then UNIONS the type tokens on both sides, so Kappa Cannoneer's
 *  artifact-entering trigger read as "creature OR artifact" and Arcane Signet, a mana rock,
 *  "supplied" a creature entering.
 *
 *  The self half is dropped because nothing but the card itself can supply it — that is what
 *  `subject.self` and the self-supplied gates exist for. What is left is the only half a deck can
 *  feed, and it is the half the edge should be matched on.
 *
 *  26 trigger subjects in the corpus have this shape; 14 name different types on the two sides, seven
 *  of those being the constellation template ("this creature or another enchantment you control"),
 *  where the union made every creature entering trigger Eidolon of Blossoms. */
const SELF_DISJUNCT =
  /^this (?:spell|card|creature|artifact|enchantment|permanent|land|planeswalker|equipment|vehicle|token)\b[^,]*?\bor (?=another\b|other\b)/i;

/** A card's NAME is not a type line. `parseSubtypes` tokenises the subject against the closed
 *  SUBTYPES list, so a proper noun that happens to contain a type word invents a subtype the card
 *  does not have: "Expedition Map" derived `map`, "Mount Doom" derived `mount`, "Stone of Erech"
 *  derived `stone`, and Donna Noble — a Legendary Creature — Human — derived `noble`. 14 subjects
 *  across 11 corpus cards.
 *
 *  A wrong subtype does not widen an edge, it DELETES it (see subject.ts), so every one of these was
 *  a card quietly unable to match anything. Printed characteristics come from Scryfall's type line;
 *  the text parser must never manufacture them out of a name.
 *
 *  The name is REMOVED rather than the subtype suppressed, so the rest of the subject still parses:
 *  "Donna Noble or a creature it's paired with" keeps the creature half a deck can actually supply.
 *  Longest form first — the full name before the short one, or "Omnath" would strip out of
 *  "Omnath, Locus of the Roil" and leave ", Locus of the Roil" still carrying `locus`. */
function stripCardName(text: string, cardName?: string): string {
  if (!cardName || text === "") return text;
  const forms = new Set<string>();
  for (const face of cardName.split(" // ")) {
    forms.add(face);
    forms.add(face.split(/[,/]/)[0].trim());
    // A card with no comma still shortens itself ("Imskir Iron-Eater" says "Imskir"), but never when
    // that first word is a real creature type: Goblin Bombardment watching Goblins is a typal payoff,
    // and stripping the word would delete the deck it is built for.
    const first = face.split(/\s+/)[0];
    if (!SUBTYPES.has(first.toLowerCase())) forms.add(first);
  }
  let out = text;
  for (const f of [...forms].filter((f) => f !== "").sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ");
  }
  return out.replace(/\s+/g, " ").trim();
}

/** "another creature or Vehicle you control" (Prowl, Pursuit Vehicle) is a DISJUNCTION, but `type`
 *  and `subtype` are separate SubjectFilter fields the matcher ANDs, so it derived "a creature that
 *  is also a Vehicle" and the plain creature entering that the oracle plainly triggers on matched
 *  nothing. Three clauses on two corpus cards.
 *
 *  The schema has no way to say OR across the two slots — an array means OR only WITHIN one — so the
 *  subtype branch is dropped rather than invented as an AND. That loses the Vehicles that are not
 *  creatures, which is a MISSING edge; keeping the AND is a WRONG one, and a silent wrong answer is
 *  worse than a missing one.
 *
 *  Only fires when the OR genuinely separates the slots: one side naming a type and no subtype, the
 *  other a subtype and no type. "A Faerie or Wizard permanent spell" is an OR inside the subtype
 *  array and keeps both; "an Eldrazi creature spell with mana value 7 or greater" is not a subject
 *  OR at all; "another Dragon creature you control" is a genuine compound AND. */
function dropsCrossSlotOr(text: string): boolean {
  const parts = text.split(/\bor\b/i).map((p) => p.trim()).filter((p) => p !== "");
  if (parts.length < 2) return false;
  const slots = parts.map((p) => {
    const s = parseSubject(p);
    return { type: s.type !== undefined, subtype: s.subtype !== undefined };
  });
  const typeOnly = slots.some((s) => s.type && !s.subtype);
  const subtypeOnly = slots.some((s) => s.subtype && !s.type);
  return typeOnly && subtypeOnly;
}

/** Both corrections above, at the one place a subject becomes structured. */
function subjectFrom(text: string, cardName?: string): ReturnType<typeof parseSubject> {
  const stripped = stripCardName(text.replace(SELF_DISJUNCT, ""), cardName);
  const subject = parseSubject(stripped);
  if (subject.type !== undefined && subject.subtype !== undefined && dropsCrossSlotOr(stripped)) {
    const branches = orBranches(stripped);
    if (branches.length >= 2) {
      // The AND was never asserted by the text. Both halves move into the disjunction and the outer
      // subject keeps only what is shared, which is what "you control" governs.
      delete subject.type;
      delete subject.subtype;
      subject.anyOf = branches;
    } else {
      // Fallback to the older, lossy behaviour: a missing branch is a missing edge, an invented AND
      // is a wrong one.
      delete subject.subtype;
    }
  }
  return subject;
}

/** The type/subtype alternatives of a cross-slot OR, in text order.
 *
 *  Only the differing halves are kept — a branch carrying neither a type nor a subtype says nothing
 *  and is dropped, and everything else (control, scope, colours) belongs on the outer subject where
 *  it binds every alternative. */
function orBranches(text: string): Partial<SubjectFilter>[] {
  const out: Partial<SubjectFilter>[] = [];
  for (const part of text.split(/\bor\b/i)) {
    const p = parseSubject(part.trim());
    const branch: Partial<SubjectFilter> = {
      ...(p.type !== undefined ? { type: p.type } : {}),
      ...(p.subtype !== undefined ? { subtype: p.subtype } : {}),
    };
    if (Object.keys(branch).length > 0) out.push(branch);
  }
  return out;
}

/** The card talking about itself. Anchored at the start, because a self-reference anywhere else is
 *  part of a larger subject ("creatures other than this one"), and confined to the noun so the rest
 *  of the sentence cannot leak in. */
const SELF_REFERENCE =
  /^this (?:spell|card|creature|artifact|enchantment|permanent|land|planeswalker|equipment|vehicle|token)\b/i;

/** The "your library for ..." preamble a search object always carries; stripping it leaves the thing
 *  actually searched for, which is the subject the pronoun that follows refers to. */
const PRONOUN_SOURCE = /^(?:your |their |a |an )?librar(?:y|ies)(?: for)?\s*/i;

/** Objects that name no thing of their own and inherit one from earlier in the clause. A closed list,
 *  read off the 107 untyped `enters` emits in the corpus rather than guessed: "that creature" names a
 *  type and must keep parsing as itself, so only bare back-references belong here. */
const PRONOUN_OBJECT =
  /^(?:(?:the |that |those )?(?:searched|exiled|chosen) cards?|that cards?|those cards|it|them|the cards?|one|one of those cards)$/i;

/** The effect's subject, with the origin zone restored for the kinds that are defined by it. The
 *  clause states the zone on the ACTION (`fromZone: "graveyard"`), never inside the object text, so
 *  `parseSubject` alone cannot recover it — and a graveyard-recursion whose subject has no zone is
 *  invisible to the reanimator edge in edges.ts, which tests `effect.subject.zone === "graveyard"`.
 */
/** An effect object that is EXACTLY "this" — the card, with no noun after it. `SELF_REFERENCE`
 *  demands the noun because an object beginning "this turn ..." is a condition, not a subject; an
 *  object that is the bare word has no such ambiguity. Reassembling Skeleton and Optimus Prime both
 *  record their own return this way, and without it the self-recursion gate in edges.ts never fired
 *  for them: every graveyard fill in the deck "enabled" a card that only ever returns itself. */
const SELF_BARE = /^this$/i;

/** Whose zone the effect reads, when the ZONE PHRASE says. "Return target creature card from YOUR
 *  graveyard" states the owner in the phrase the normalizer collapses into `fromZone: "graveyard"`,
 *  so the possessive was dropped and every recursion derived control "any" — which
 *  `graveyardFillMatches` wildcards. Noxious Gearhulk, Pongify and Sheoldred's Edict all fill an
 *  OPPONENT's graveyard, and every one of them then "enabled" every reanimation in the deck.
 *
 *  "A graveyard" stays a wildcard on purpose: Reanimate and Necromancy really do reach an opponent's,
 *  which is how Feed the Swarm feeds Grave Researcher. Only a stated owner narrows. */
const ZONE_OWNER: ReadonlyArray<readonly [RegExp, Control]> = [
  [/\bfrom (?:your|their) own\b/i, "you"],
  [/\bfrom your\b/i, "you"],
  [/\bfrom (?:an |each |target )?opponent'?s?\b/i, "opp"],
];

function zoneOwner(clauseText: string, zone: string | null | undefined): Control | undefined {
  if (!zone || clauseText === "") return undefined;
  for (const [re, control] of ZONE_OWNER) {
    // Anchored on the ZONE the action names, so "return it to your hand" cannot be read as a claim
    // about whose graveyard was searched.
    const m = clauseText.match(new RegExp(`${re.source}\\s+${zone}`, "i"));
    if (m) return control;
  }
  return undefined;
}

/** Where a COUNT begins. Everything after it is a magnitude, not a subject.
 *
 *  "This Spacecraft gets +1/+0 FOR EACH artifact you control" (Uthros Research Craft) pumps itself;
 *  the artifacts are the tally. The noun was being installed as the effect's subject, so Uthros
 *  derived a `static:pump` anthem over every artifact in the deck. Eight of the 25 false claims in
 *  the `static` slice are this shape — Uthros, Filigree Attendant, Elturel Survivors — and `static`
 *  is the engine's worst family at 52% precision.
 *
 *  Exactly the move `SELF_REFERENCE` already makes above: what follows the cue qualifies the effect,
 *  it is not the thing the effect applies to. A real anthem states its subject BEFORE the cue
 *  ("creatures you control get +1/+1 for each Zombie you control") and keeps it. */
const COUNT_CUE =
  /\bfor each\b|\bequal to the (?:number|total)\b|\bwhere [XYZ] is the (?:number|total)\b|\btimes the (?:number|total)\b/i;

function countTruncated(object: string): string {
  const m = object.match(COUNT_CUE);
  return m?.index === undefined ? object : object.slice(0, m.index);
}

/** Who RECEIVES a granted keyword. The clause records `grant-ability` with the thing GRANTED as its
 *  object ("ward {1}"), so the recipient is nowhere in the action — Svyelun of Sea and Sky derived no
 *  ability at all and Master of Waves, a Merfolk it grants ward to, got no edge. 467 corpus clauses
 *  carry a grant-ability action; this was the largest single defect the recall measurement (§26)
 *  found.
 *
 *  The clause text still has it, on the left of the verb that hands the ability over. A leading
 *  trigger or cost is stripped first, so "{T}: Creatures you control gain haste" does not read the
 *  cost as the recipient. */
const GRANTED_TO = /^(.*?)\s+\b(?:have|has|gain|gains)\b/i;
/** The same defect one verb over. `copy` records the copy SOURCE as its object -- Shapesharer's
 *  "Target Shapeshifter becomes a copy of TARGET CREATURE" -- so the recipient, the half that names
 *  the subtype, is lost the way a grant's was. 122 corpus clauses carry a `copy` action. */
const COPIED_INTO = /^(.*?)\s+\bbecomes?\s+(?:a\s+copy|copies)\s+of\b/i;
const CLAUSE_PREAMBLE = /^(?:when|whenever|at)\b[^,]*,\s*|^[^:.]{1,60}:\s*/i;

/** A leading SUBORDINATE clause, which states a condition or a setup and never the recipient.
 *  Anger's "As long as this card is in your graveyard and you control a MOUNTAIN, creatures you
 *  control have haste" was granting haste to Mountains. Wider than `CLAUSE_PREAMBLE`, which only
 *  knows trigger words, because the recipient search reads further into the sentence than a trigger
 *  strip does. */
const SUBORDINATE = /^(?:as long as|if|unless|while|during|whenever|when|at|for each|until)\b[^,]*,\s*/i;

/** The recipient stated to the LEFT of the verb that hands the ability over. A leading trigger or
 *  cost is stripped first, so "{T}: Creatures you control gain haste" does not read the cost as the
 *  recipient — then only the last SENTENCE is kept, because a clause may set something up first
 *  ("You may put an Elemental creature card onto the battlefield. That creature gains haste") and
 *  the setup is not who receives it.
 *
 *  Sentences, not commas: a recipient is allowed to LIST its types. Raphael, Fiendish Savior grants
 *  lifelink to "Other Demons, Devils, Imps, and Tieflings you control", and splitting on every comma
 *  left three of the four tribes without their lord. */
function recipientBefore(clauseText: string, re: RegExp): string | undefined {
  const body = clauseText.replace(CLAUSE_PREAMBLE, "");
  const left = body.match(re)?.[1];
  return left?.split(/[.;]/).pop()?.replace(SUBORDINATE, "").trim() || undefined;
}

function grantRecipient(clauseText: string): string | undefined {
  return recipientBefore(clauseText, GRANTED_TO);
}

/** Creatures that "can't attack you" are, by construction, an OPPONENT's — in a single-deck analysis
 *  no card in the deck can be the subject. Propaganda derived `control: "any"` and Sphere of Safety
 *  derived `"you"` (the possessive leaked out of "planeswalkers you control"), so both taxed the
 *  deck's own creatures. */
const ATTACKS_YOU = /\battacks? you\b/i;

function effectSubject(
  action: Action, kind: string, triggerIsSelf = false, clauseText = "", cardName?: string,
): ReturnType<typeof parseSubject> {
  // A GRANT's object is the ability handed over, never the thing receiving it, so the subject has to
  // come from the clause text. Falls back to the object when the text states no recipient, which
  // leaves the behaviour it had before.
  // A COPY's object is the thing copied FROM, never the thing that becomes it, so the same recovery
  // and the same typal guard apply: "target Shapeshifter becomes a copy of target creature" is a
  // synergy with the deck's Shapeshifters, while "each other creature you control becomes a copy"
  // reaches the whole board and is an ordinary card doing an ordinary thing.
  if (action.verb === "grant-ability" || action.verb === "copy") {
    const who = action.verb === "copy"
      ? recipientBefore(clauseText, COPIED_INTO)
      : grantRecipient(clauseText);
    if (who) {
      const s = parseSubject(who);
      // A grant EARNS an edge only when it is typal. "Creatures you control gain haste until end of
      // turn" reaches every creature in the deck -- the ordinary-card claim the rubric calls false,
      // and the mesh that made `static` the engine's worst family. Naming a SUBTYPE is what makes it
      // a synergy: "other Merfolk you control have ward {1}" picks out particular cards.
      if (s.subtype === undefined) return parseSubject("");
      return s;
    }
  }
  const object = action.object ?? "";
  // A self-referential effect applies to the card itself, and everything after the self-reference is
  // a CONDITION rather than a subject. Excalibur, Sword of Eden reads "This spell costs {X} less to
  // cast, where X is the total mana value of historic permanents you control": parsing the whole
  // string found permanents/spell/you-control, `namesItsTargets` passed on words the effect does not
  // apply to, and edges.ts fanned that one card out to 97 consumers -- the widest mesh in the
  // derived population. Parse only the self-reference, which names a bare singular and so keeps no
  // subject at all: the card holds its `static:cost-reduction` theme tag and forms no edges.
  const self = object.match(SELF_REFERENCE);
  const subject = subjectFrom(self ? self[0] : countTruncated(object), cardName);
  // ...and RECORD that it was self-referential. The match was already being used to avoid parsing
  // the condition after it, then discarded, so all 160 graveyard-recursion effects in the corpus
  // looked like recursion of a generic card. edges.ts then let any graveyard fill enable any of
  // them: Buried Ruin sacrificing ITSELF (a land) "enabled" Metalwork Colossus returning ITSELF.
  // Self-reference is the biggest defect family this engine has had, and the trigger side has
  // carried this marker since the self-ETB work; the effect side never did.
  if (self) subject.self = true;
  // A bare "this", and a bare PRONOUN whose trigger named the card itself. Enduring Curiosity's
  // "When Enduring Curiosity dies, ... return IT" means the card; Kaya's Ghostform's "that card"
  // follows a trigger that named the ENCHANTED permanent and must not be read this way, so the
  // inheritance follows the antecedent rather than assuming the card.
  else if (SELF_BARE.test(object.trim())) subject.self = true;
  else if (triggerIsSelf && PRONOUN_OBJECT.test(object.trim())) subject.self = true;
  // ...and the model writing the card's own NAME where the oracle said "it". Eye of Nidhogg returns
  // ITSELF from the graveyard; without this the effect looked like generic recursion and any
  // graveyard fill "enabled" it. The trigger side has carried this since the self-ETB work — the
  // effect side recognised every other spelling of self except the plain name.
  else if (isSelfSubject(object, cardName)) subject.self = true;
  if (ATTACKS_YOU.test(object)) subject.control = "opp";
  if (ZONE_SCOPED_KINDS.has(kind) && action.fromZone) {
    subject.zone = action.fromZone;
    // Only when the object text stated no owner of its own -- an explicit one is more specific.
    const owner = zoneOwner(clauseText, action.fromZone);
    if (owner && subject.control === "any") subject.control = owner;
  }
  // Owner's ruling 2026-08-14 (threshold-lines): a coarse extra-phase conflated units the game
  // keeps apart -- an extra beginning phase brings an untap step (activation supply, §6.4 of the
  // design spec) and an extra upkeep or end step brings none. Unset when the text names no phase
  // from the closed list -- refused, never defaulted.
  if (kind === "extra-phase") {
    const phase = extraPhaseName(object, clauseText);
    if (phase) subject.phase = phase;
  }
  return subject;
}

/** Does this subject name WHICH permanents it applies to? edges.ts turns a static ability's effect
 *  subject into an edge against the whole deck (`subjectMatches(otherCard.characteristics, subject)`),
 *  and every field a subject leaves unset is a wildcard — so a static subject with no type and no
 *  subtype matches EVERY card. Psychosis Crawler is the case: "its power and toughness are each
 *  equal to the number of cards in your hand" is a self-referential P/T definition, not an anthem,
 *  and it was deriving a `static:pump` lord over the entire deck. Same defect class as the
 *  `spell -> static` bug: an unconstrained static subject is a mesh, not a synergy.
 *
 *  Naming a type/subtype is not enough on its own: "enchanted creature" and "this creature" both
 *  name a type but pick out exactly one permanent, not the deck. `parseScope` already tells target
 *  singular apart from a mass effect ("creatures you control" -> scope "all"; a bare singular ->
 *  scope undefined), so require that too -- Animate Dead, All That Glitters and Storm-Kiln Artist
 *  ("this creature") were each meshing a single-target pump into an anthem over every creature. */
function namesItsTargets(subject: ReturnType<typeof parseSubject>): boolean {
  return (
    (subject.type !== undefined || subject.subtype !== undefined) &&
    (subject.scope === "all" || subject.scope === "each")
  );
}

/** The clause's own `control` field, which states whose permanents/players the trigger watches. The
 *  object text often does not repeat it ("whenever you cast a spell" normalizes to subject "a
 *  spell", control "you"), so reading only the text widened Consuming Aberration to every spell
 *  anyone casts. The clause vocabulary spells the opponent side "opponent"; the engine says "opp". */
const CLAUSE_CONTROL: Record<string, Control> = { you: "you", opponent: "opp", any: "any" };

/** A permanent ARRIVING tapped never becomes tapped, so nothing triggers on it (CR 614 — it is a
 *  replacement on the entry, not an event). `emits.ts` already refuses the entry-state tap the
 *  segmenter records as object "this", using SCOPE as the discriminator; that holds for the singular
 *  wordings and misses the mass ones, because "all land cards from your graveyard" has scope "all"
 *  and looks exactly like a real mass tap. Will of the Sultai, Mechtitan Core and The Darkness
 *  Crystal are the corpus cases, and the last of them was supplying a false becomes-tapped edge.
 *
 *  The clause text is the only place the distinction survives, so it is read here rather than in
 *  emits.ts, which sees one action and no context. */
/** Verbs that REMOVE a permanent someone else controls. A targeted one that states no controller
 *  ("destroy target creature with power 4 or greater") parses to `any`, and `any` matches `you` on
 *  either side — so Big Game Hunter and Bitter Triumph supplied The Meathook Massacre's payoff for
 *  creatures YOU control dying. Six rows of the 2026-08-07 sample.
 *
 *  This is a DECISION and not a reading (user, 2026-08-06): the card genuinely does not say whose
 *  creature dies. It is called `opp` because that is where removal gets pointed, on the same grounds
 *  as "its controller -> opp" and with the same property — being wrong only ever removes an edge.
 *  The stated cost is that a value line aimed at your own board (Saw in Half) loses its edge too.
 *
 *  Scoped tightly. MASS removal hits your board as well and stays `any`. A stated controller is never
 *  overridden. `sacrifice` is absent on purpose: a sacrifice outlet eats YOUR creatures, and that is
 *  the aristocrats edge this engine most wants to find. */
const REMOVAL_VERBS = new Set(["destroy", "exile"]);

const ARRIVES_TAPPED = /\b(?:battlefield|enters?|play)\b[^.]{0,30}?\btapped\b|\btapped\b[^.]{0,20}?\bunder\b/i;

/** "Whenever you tap a permanent for {C}" (Forsaken Monument), "whenever enchanted land is tapped for
 *  mana" (Wild Growth). Tapping something for mana is an act of playing the game, and the engine
 *  deliberately emits nothing for it — `costActions` drops tapping the source because nothing
 *  triggers on it. So NO producer can legitimately satisfy this trigger, and every match it forms is
 *  false: Drowner of Hope's "Tap target creature" is not a mana tap. Recorded as an unknown trigger
 *  rather than silently deleted, which is where every other unmatched event goes. */
/** "When the chosen player LOSES THE GAME, you win the game" (Shinryu, Transcendent Rival). The
 *  clause layer normalizes that into the `life-lost` event, but losing the game is not losing life:
 *  the trigger is simply wrong, and every life-loss card in the deck falsely feeds it. Surfaced by a
 *  judged-false panel claim, Disciple of the Vault -> Shinryu.
 *
 *  REFUSED rather than reinterpreted. The engine has no "loses the game" event, so the honest answer
 *  is an unknown trigger — a near-miss is consumed as if it were true. One corpus card has this
 *  shape, of the four life-lost triggers that exist. A prompt fix would cost money to re-normalize;
 *  this is free and reads the clause text the model already left behind. */
const LOSES_THE_GAME = /\blos(?:es|e|ing) the game\b/i;

const TAPPED_FOR_MANA = /\btapp?(?:ed|s|ing)?\b[^.]{0,30}?\bfor\s+(?:mana|\{)/i;

export function deriveAbilities(
  clauses: ClauseRecord[],
  cardName?: string,
  clauseTexts?: Record<number, string>,
  clauseCosts?: Record<number, string>,
  /** The card's own printed text, for the phantom-trigger guard. Joining `clauseTexts` is NOT a
   *  substitute: `segment()` strips reminder text, and an ability that lives only in its reminder
   *  (For Mirrodin!, cycling) would then look like a trigger the card never states. Absent disables
   *  the guard rather than guessing. */
  oracleText?: string,
): { abilities: Ability[]; unclaimed: Action[]; unknownTriggers: string[] } {
  const abilities: Ability[] = [];
  const unclaimed: Action[] = [];
  const unknownTriggers: string[] = [];
  // The whole card's text, for the phantom-trigger guard below. CARD-scoped on purpose and never
  // per clause -- see `triggerHasCue`, where scoping it to the clause was measured and refuses 18
  // real modal triggers to catch 1 phantom. Absent `clauseTexts` disables the guard rather than
  // guessing, the same contract `recipient.ts` has.
  const cardText = oracleText ?? "";

  for (const clause of clauses) {
    const kind = abilityKind(clause);
    // Who performs each action, when the clause names someone the object text does not carry. The
    // cue localises the actor to a VERB, not to an action, so a clause with two actions of that verb
    // is ambiguous and is left alone -- a missing answer beats a wrong one.
    const actors = clauseTexts?.[clause.id] ? actionRecipients(clauseTexts[clause.id]) : {};
    const actorFor = (verb?: string): Control | undefined =>
      (clause.actions ?? []).filter((a) => a.verb === verb).length === 1 ? actors[verb ?? ""] : undefined;
    const text = clauseTexts?.[clause.id] ?? "";
    const cost = clauseCosts?.[clause.id] ?? "";
    // A fetch is two actions: `search "your library for a Swamp or Mountain card"`, then
    // `put "that card" onto the battlefield`. The EMIT comes from the put, whose object is a
    // pronoun, so the enters event carried no type at all -- and an untyped producer subject is a
    // wildcard that satisfies every consumer filter in the matcher. Windswept Heath "supplied" every
    // enters trigger in its deck. The type is not missing, it is just on the other action.
    // Generalised past the fetch: "exile target creature you control, then return IT to the
    // battlefield" is the same shape, and a flicker whose emit is untyped is the same wildcard.
    // The antecedent is the nearest EARLIER action in the clause that names a thing of its own.
    const antecedentFor = (idx: number): string | undefined => {
      for (let i = idx - 1; i >= 0; i--) {
        const o = ((clause.actions ?? [])[i]?.object ?? "").trim();
        if (o === "" || PRONOUN_OBJECT.test(o) || SELF_REFERENCE.test(o)) continue;
        return o.replace(PRONOUN_SOURCE, "");
      }
      // Kaya's Ghostform: "When ENCHANTED PERMANENT dies, return THAT CARD to the battlefield." The
      // antecedent is the trigger's subject, not an earlier action -- there is no earlier action.
      const t = (clause.trigger?.subject ?? "").trim();
      return t === "" || PRONOUN_OBJECT.test(t) ? undefined : t;
    };
    /** ...and the case `antecedentFor` deliberately walks PAST: the nearest earlier action names the
     *  CARD, not a class. Necromancy reads `cast "this spell"` then `sacrifice "it"`, so the hunt for
     *  a class found nothing and the pronoun stayed untyped — a wildcard emit that satisfies every
     *  consumer filter, which is how a REANIMATION spell came to "fill the graveyard" for anything
     *  recursive. The antecedent is not missing here, it is the card. */
    const antecedentIsSelf = (idx: number): boolean => {
      for (let i = idx - 1; i >= 0; i--) {
        const o = ((clause.actions ?? [])[i]?.object ?? "").trim();
        if (o === "" || PRONOUN_OBJECT.test(o)) continue;
        return SELF_REFERENCE.test(o) || isSelfSubject(o, cardName);
      }
      return false;
    };
    let trigger: Ability["trigger"];
    /** Does this clause fire on the card's own LEAVING? See the sacrifice filter below. */
    let selfLeavesTrigger = false;
    if (clause.trigger?.event) {
      const verb = normalizeTriggerVerb(clause.trigger.event);
      if (verb === "taps" && TAPPED_FOR_MANA.test(text)) {
        unknownTriggers.push("taps-for-mana");
      } else if (verb === "lose-life" && LOSES_THE_GAME.test(text)) {
        unknownTriggers.push("loses-the-game");
      } else if (verb && !triggerHasCue(verb, cardText)) {
        // THE NORMALIZER INVENTED THIS TRIGGER: nothing in the card's own text names the event.
        // Parnesse, the Subtle Brush triggers on being TARGETED and on COPYING a spell, neither of
        // which the vocabulary can spell, and its stored clauses answered `enters` and `cast` --
        // which made this deck's own commander claim 17 synergies, every one false. Refusing here
        // is free and works even when the money fix cannot: a re-ask whose answer the persist gate
        // REFUSES leaves the older, wrong doc standing, so the clause layer alone cannot fix it.
        unknownTriggers.push(`phantom:${verb}`);
      } else if (verb) {
        const subject = subjectFrom(clause.trigger.subject ?? "", cardName);
        const control = CLAUSE_CONTROL[clause.trigger.control ?? ""];
        if (control) subject.control = control;
        if (isSelfSubject(clause.trigger.subject ?? "", cardName)) subject.self = true;
        selfLeavesTrigger = subject.self === true && verb === "leaves";
        // Read from the clause TEXT, not the trigger subject string: the count sits in the trigger
        // clause's prose ("when there are 1,000 or more time counters on ..."), which is the same
        // channel repeatsFor reads for its once-each-turn rule.
        const threshold = thresholdFor(text);
        trigger = threshold ? { verbs: [verb], subject, threshold } : { verbs: [verb], subject };
      } else {
        unknownTriggers.push(clause.trigger.event);
      }
    }

    const before = abilities.length;
    for (const action of clause.actions ?? []) {
      if (INERT_VERBS.has(action.verb ?? "")) continue;
      if (keywordActionOnStaticClause(kind, action.verb)) { unclaimed.push(action); continue; }
      // See antecedentFor: a pronoun object inherits the thing named earlier in the same clause.
      const antecedent = PRONOUN_OBJECT.test((action.object ?? "").trim())
        ? antecedentFor((clause.actions ?? []).indexOf(action))
        : undefined;
      // "Return THIS card to the battlefield" (Reassembling Skeleton, Drownyard Temple) emits an
      // entry of the card ITSELF. The emit is kept -- a Skeleton returning is a real creature
      // entering for anything watching creatures -- but it is marked, because a card's own re-entry
      // can never be some OTHER card's ETB, and an untyped subject would satisfy every one of them.
      const emitsSelf = SELF_REFERENCE.test((action.object ?? "").trim())
        || /^this$/i.test((action.object ?? "").trim())
        || isSelfSubject(action.object ?? "", cardName)
        // A pronoun standing in for the card itself. Tested on the RESOLVED antecedent, because the
        // raw object is "it" and matches none of the spellings above.
        || (PRONOUN_OBJECT.test((action.object ?? "").trim())
          && antecedentIsSelf((clause.actions ?? []).indexOf(action)));
      const effectKind = actionEffectKind(action, text);
      // A tap the clause states as an ARRIVAL state is not an event. See ARRIVES_TAPPED.
      const emits = actionEmits(antecedent ? { ...action, object: antecedent } : action)
        .filter((e) => !(e.verb === "taps" && ARRIVES_TAPPED.test(text)))
        // A SACRIFICE triggered by the card's own LEAVING is drawback, not supply. "When this
        // enchantment leaves the battlefield, that creature's controller sacrifices it" (Necromancy,
        // Animate Dead) is the price of a reanimation aura: the permanent that would be the outlet is
        // the thing departing, and it only happens because an opponent removed it. Emitting
        // sacrifice/dies there made Necromancy a sac outlet feeding Zulaport Cutthroat and Gixian
        // Puppeteer, both judged FALSE in the blind agreement draw.
        //
        // Keyed on `leaves`, NOT on the subject being self. Butcher of Malakir reads "whenever THIS
        // CREATURE or another creature you control dies" — it includes its own death, so self-vs-other
        // does not separate them. The EVENT does: a permanent leaving and undoing what it did is the
        // aura-drawback shape, while `dies` is the aristocrats shape. Only the sacrifice's own emits
        // are dropped; a leaves-trigger that makes tokens still supplies them.
        .filter((e) => !(action.verb === "sacrifice" && selfLeavesTrigger));
      if (emitsSelf) for (const e of emits) e.subject.self = true;
      if (!effectKind && emits.length === 0) { unclaimed.push(action); continue; }

      // A subject is attached ONLY when there is a kind. matcher's edges.ts emits a
      // `static:${effect.kind}` tag for any static ability that has a subject, so an empty kind
      // with a subject produces a junk `static:` tag that can match another card's junk tag and
      // form an edge that is not real. A STATIC ability additionally has to name its targets --
      // see namesItsTargets -- or the very same edge forms against the whole deck.
      const subject = effectKind
        ? effectSubject(action, effectKind, trigger?.subject.self === true, text, cardName)
        : undefined;
      const actor = actorFor(action.verb);
      if (actor) {
        for (const e of emits) e.subject.control = actor;
        if (subject) subject.control = actor;
      } else if (REMOVAL_VERBS.has(action.verb ?? "")) {
        // See REMOVAL_VERBS. Only a TARGETED removal with no stated controller.
        for (const e of emits) {
          if (e.subject.control === "any" && e.subject.scope === "target") e.subject.control = "opp";
        }
      }
      // A `clone` reaches edges.ts's applies-to pass whatever its ability kind, so it answers to the
      // same discipline a static does: name WHO becomes the copy, or form no edge. "Each other
      // creature you control becomes a copy of that creature" is the whole board, and a subject that
      // names nothing is a wildcard that matches every card in the deck.
      const keepSubject = subject
        && (kind !== "static" || namesItsTargets(subject))
        && (effectKind !== "clone" || subject.subtype !== undefined);
      // What the payoff's magnitude counts. Already consumed by edges.ts, impact.ts and buckets.ts;
      // derivation had simply never set it, so the channel was dark under TAGS_SOURCE=derived.
      const scaling = actionScaling(action);
      const effect = effectKind
        ? keepSubject ? { kind: effectKind, subject } : { kind: effectKind }
        : { kind: "" as const };
      const ability: Ability = {
        kind,
        effect: scaling ? { ...effect, scaling } : effect,
      };
      if (trigger) ability.trigger = trigger;
      // The REAL cost, not "". It has been in scope since line 522 and threaded to repeatsFor at
      // line 680 for as long as `repeats` has existed; only this assignment threw it away, which is
      // why `Ability.cost` could sit empty corpus-wide with every test green. Sub-project B needs it
      // to tell a loop that pays for itself from one that costs {2} an iteration.
      if (clause.abilityType === "activated") ability.cost = cost;
      // The amount belongs to the ACTION, not the clause: Kaya's -2 is one clause whose two actions
      // each carry their own. Assigned here, in the per-action loop, for that reason.
      if (action.amount != null && action.amount !== "") ability.amount = action.amount;
      if (emits.length) ability.emits = emits;
      abilities.push(ability);
    }

    const drain = drainAbility(clause, kind, trigger, cost);
    if (drain) abilities.push(drain);

    // A TRIGGER is a consumer signal in its own right, independent of what the effect does. Geode
    // Rager's "Landfall — whenever a land you control enters, GOAD each creature target player
    // controls" maps `goad` to no kind and no emit, so every action was unclaimed, the clause pushed
    // nothing, and the landfall trigger went with it: every land in the deck stopped feeding it.
    // 83 corpus clauses lose a legal `enters` trigger this way, plus cast 23, sacrificed 22,
    // attacks 18 and dies 12.
    //
    // The effect stays honestly EMPTY — we know when it triggers, not what it does — and the actions
    // remain in `unclaimed`, so the derivation gap is still visible rather than papered over.
    if (trigger && abilities.length === before) {
      abilities.push({ kind, effect: { kind: "" as const }, trigger });
    }

    // Label everything this clause produced, in ONE place rather than at each of the three push
    // sites above (the main action loop, `drainAbility`, and the trigger-only fallback). A fourth
    // push site added later cannot silently skip labelling this way.
    for (let i = before; i < abilities.length; i++) {
      const repeats = repeatsFor(abilities[i], text, cost);
      if (repeats) abilities[i] = { ...abilities[i], repeats };
    }
  }
  return { abilities, unclaimed, unknownTriggers };
}

export interface DeriveInput {
  oracleId: string;
  /** The card's own name, so a trigger naming itself ("Urza, Lord High Artificer") is recognised
   *  as self-referential rather than read as a subject the deck can supply. */
  name?: string;
  clauses: ClauseRecord[];
  characteristics: Characteristics;
  /** Clause id -> the clause's text, straight from `segment()`. Optional and free: segmentation is
   *  deterministic, so this is recomputed rather than stored, and an absent map only means the
   *  actor-recovery in `recipient.ts` says nothing. */
  clauseTexts?: Record<number, string>;
  /** Clause id -> the clause's activation cost, straight from `segment()`. Same shape and same
   *  reason as `clauseTexts`: free to recompute, so nothing is stored. `repeatsFor` reads this, not
   *  `clauseTexts`, for the self-sacrifice and tap-cost rules -- the cost is split OUT of the body
   *  text by `segment.ts`'s `classify()`, so it never appears in `clauseTexts`. */
  clauseCosts?: Record<number, string>;
  /** The card's printed oracle text, read ONLY by the phantom-trigger guard. Absent disables it. */
  oracleText?: string;
}

/** Assemble the full CardTags document the matcher consumes. `characteristics` is printed data read
 *  from the card document -- derivation never asks a model for what the database already knows. */
export function deriveCardTags(input: DeriveInput): CardTags {
  const { abilities } = deriveAbilities(input.clauses, input.name, input.clauseTexts, input.clauseCosts, input.oracleText);
  return {
    oracleId: input.oracleId,
    schemaVersion: 1,
    // WARNING: 0 will never equal PROMPT_VERSION (llm/prompt.ts), so `needsRetag`/`selectUntagged`
    // will see any persisted derived doc as permanently stale and re-queue it for LLM tagging
    // forever. Fine while derivation is not yet wired into the persistence path -- revisit this
    // the moment it is.
    promptVersion: 0,
    model: "derived",
    characteristics: input.characteristics,
    abilities,
  };
}
