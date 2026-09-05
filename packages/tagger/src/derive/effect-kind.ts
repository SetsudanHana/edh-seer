/** An action to one of the engine's closed 29 effect kinds, or nothing.
 *
 *  Two things make this more than a lookup. First, the origin zone is often the whole card: `exile`
 *  from a graveyard is graveyard hate, `exile` from the battlefield is removal. Second, the engine's
 *  vocabulary is payoff-centric and has NO removal kind, so `destroy` legitimately maps to nothing
 *  and reaches the graph through its `dies` emit instead. A near-miss kind is worse than null: it is
 *  consumed as if it were true. */
import type { Action } from "../canonicalize.js";
import type { EffectKind } from "../schema.js";
import { parseSubject } from "./subject.js";

/** Zone-sensitive rules, checked before the plain lookup. Order matters within this list.
 *  `from`/`to` omitted means "don't care"; `from: null` means the origin must be the verb's DEFAULT
 *  (canonicalAction nulls an unstated or `library` origin), which is how a self-mill is told apart
 *  from a card moved into a graveyard out of some other zone. */
const ZONE_RULES: { verb: string; from?: string | null; to?: string; kind: EffectKind }[] = [
  { verb: "exile", from: "graveyard", kind: "graveyard-hate" },
  { verb: "put", from: "graveyard", to: "battlefield", kind: "graveyard-recursion" },
  { verb: "return", from: "graveyard", to: "battlefield", kind: "graveyard-recursion" },
  { verb: "put", from: "graveyard", to: "hand", kind: "graveyard-recursion" },
  { verb: "return", from: "graveyard", to: "hand", kind: "graveyard-recursion" },
  // ...and to the LIBRARY, which had no row and so derived NOTHING — the whole effect vanished and
  // the card kept only its trigger. Getting a card back on top of your library is recovery from the
  // graveyard exactly as returning it to hand is; you draw it next turn. Found by
  // `bin/isolated-cards.ts`: Mystic Sanctuary floats unconnected in every deck that runs it, its
  // "put target instant or sorcery card from your graveyard on top of your library" claimed by
  // nothing. 8 clause actions (Cavalier of Thorns, Witch's Cottage, Noxious Revival, Perpetual
  // Timepiece), 79 corpus cards.
  { verb: "put", from: "graveyard", to: "library", kind: "graveyard-recursion" },
  { verb: "return", from: "graveyard", to: "library", kind: "graveyard-recursion" },
  // Muldrotha templates recursion as permission to PLAY/CAST out of the graveyard rather than to
  // move a card, so keying only on put/return lost the whole card.
  { verb: "play", from: "graveyard", kind: "graveyard-recursion" },
  { verb: "cast", from: "graveyard", kind: "graveyard-recursion" },
  // Exile-and-return-to-the-battlefield is the blink half of a flicker; the exile half states no
  // payoff of its own. Matched on the RETURN so one Ability carries the kind, as the live tags do.
  { verb: "return", from: "exile", to: "battlefield", kind: "flicker" },
  { verb: "put", from: "exile", to: "battlefield", kind: "flicker" },
  // Cards put into a graveyard from the LIBRARY are self-mill, the same payoff `mill` names.
  // `from: null` is load-bearing: "put target creature into its owner's graveyard" moves it off the
  // battlefield, which is removal, and calling that a top-manipulation payoff would mesh removal
  // with every mill deck. Listed last so the from:"graveyard" rules above win when both apply.
  { verb: "put", from: null, to: "graveyard", kind: "top-manipulation" },
];

/** Kinds whose whole meaning is the zone the subject sits in: `edges.ts` will not draw a
 *  reanimator edge unless `effect.subject.zone === "graveyard"`, so a recursion effect that loses
 *  the zone is a recursion no graveyard-filler can ever feed. */
export const ZONE_SCOPED_KINDS: ReadonlySet<string> = new Set(["graveyard-recursion", "graveyard-hate"]);

/** "enters with N counters on it" — the card's own entry, CR 614.1c. Anchored on "enters with" so a
 *  clause that merely mentions entering ("whenever a creature enters, put a counter on it") is not
 *  caught: that one really does place counters later and is ordinary `counter-placement`. */
const ENTERS_WITH = /\benters? with\b[^.]{0,40}\bcounters?\b/i;

/** The energy object as the clause layer writes it: a bare `E`, `{E}`, or the word itself. No mana
 *  symbol is ever `E` -- mana is WUBRGC, a number, or X -- so this cannot catch a real mana object.
 *
 *  IT WAS A REGEX AND CODEQL WAS RIGHT ABOUT IT. `/^\s*\{?\s*e\s*\}?\s*$/i` puts four `\s*` runs
 *  around two optional braces, so a long run of spaces that does not match backtracks quadratically
 *  (`js/polynomial-redos`, high). Stripping the braces and trimming asks the same question in one
 *  linear pass, and reads as what it means. */
const isEnergyObject = (object: string): boolean =>
  object.replaceAll("{", "").replaceAll("}", "").trim().toLowerCase() === "e";

const SIMPLE: Record<string, EffectKind> = {
  create: "token-generation",
  "deal-damage": "damage",
  draw: "draw-card",
  "add-mana": "mana-generation",
  "add-counter": "counter-placement",
  "modify-pt": "pump",
  untap: "untap",
  proliferate: "proliferate",
  animate: "animate",
  // `copy` alone is ambiguous and the object resolves it — see the copy-spell branch in
  // `actionEffectKind`. This row is the fallback: copying a PERMANENT is a clone.
  copy: "clone",
  "extra-combat": "extra-combat",
  // Named because the persist gate refused whole cards over their absence: Orcish Bowmasters
  // (amass), Cyclonus (extra-phase), Cyber Conversion and Ugin's Mastery (turn-face-up). amass puts
  // +1/+1 counters on an Army, creating one first if you have none; counter-placement is the half
  // every payoff in the engine actually reads. turn-face-up flips a manifested or morphed permanent
  // -- a state change of an existing permanent, which is what `animate` already names.
  amass: "counter-placement",
  "turn-face-up": "animate",
  "trigger-again": "trigger-doubling",
  // (The old note here said `copy-spell` could never fire because VERBS has only `copy`. True of the
  // VERB and false of the CLAUSE: the OBJECT says which is copied — "target spell" versus "target
  // creature" — exactly as it does for `double`. Resolved in `actionEffectKind`.)
  mill: "top-manipulation",
  emblem: "token-generation",
  // A tutor rearranges what you draw, which is the same payoff `mill` names. Demonic Tutor's live
  // flat tag is exactly this, so the kind is one the engine already consumes.
  search: "top-manipulation",
  // Same payoff again, from the other end of the library. Barrier of Bones' live flat tag for its
  // surveil is exactly this. Neither verb gets an EMIT: surveil does fill a graveyard, but flat
  // gives Barrier of Bones no emit either, and an invented emit is the change reverted from the
  // bounce/`leaves` work — a starving consumer count is not evidence.
  scry: "top-manipulation",
  surveil: "top-manipulation",
};

/** A restriction is a TAX only when it can be paid through. Propaganda and Ghostly Prison both
 *  carry a live flat tag of `tax`; Bedlam ("Creatures can't block") carries nothing, because no
 *  amount of mana lets you block. The difference is a price, and it is stated in the object. */
const PAYABLE = /\bunless\b[^.]*\bpay/i;

/** Keywords whose grant the engine has a kind for. `speed-increase` is what the FLAT tagger already
 *  assigns to Berserkers' Onslaught's double strike, and `mechanisms.ts` consumes it for
 *  attack-matters, so this feeds a rule that exists rather than inventing one.
 *
 *  Nothing else granted gets a kind, and that is deliberate. hexproof / indestructible / shroud /
 *  ward are the `protection` deck ROLE, which `build.ts:126` already derives from oracle text with
 *  no help from tags; flying, trample and menace are evasion, which has no kind at all. Giving them
 *  a near-miss would be worse than silence — it is consumed as if it were true. */
const SPEED_KEYWORDS = /\b(haste|double strike)\b/i;

/** Text that confers a TYPE rather than an ability. "in addition to its other types" is the
 *  templating for a one-off (Mockingbird, Tyrite Sanctum); "is every creature type" / "every land
 *  type" is the changeling-wide form (Maskwood Nexus, Omo, Planar Nexus). */
const TYPE_GRANT =
  /\bin addition to its other types\b|\bis every\b|\bevery (?:creature|land|artifact|nonbasic land) type\b|\b(?:is|becomes) also an? [A-Z]/;

/** `cost-modify` is one verb because the clause states one action; the direction is in the object,
 *  and the two directions are OPPOSITE kinds the engine already consumes heavily (cost-reduction on
 *  610 cards, tax on 615). Foundry Inspector and Urza's Incubator carry live flat cost-reduction
 *  tags; Thalia carries tax.
 *
 *  Naming opponents is enough on its own to read `tax`: nobody writes a card that makes their own
 *  spells worse, so an opponent-scoped cost change is a tax however the direction is worded. With
 *  neither signal the answer is null — guessing between two opposites is the near-miss class this
 *  file exists to refuse. */
/** A clause talking about the cost of the spell it is printed on. Anchored on "this spell" and not
 *  on the card's name, because the clause layer has already rewritten self-references and the
 *  templating is fixed: CR 601.2f's additional costs, alternative costs and self-reductions all
 *  print it. */
const SELF_COST = /\bthis spell(?:'s)?\s+(?:mana\s+)?cost|\bthis spell costs\b/i;

function costDirection(object: string, clauseText = ""): EffectKind | null {
  const read = (t: string): EffectKind | null => {
    // Only the DIRECTION WORDS can conflict. The "cost {1}" proxy below matches "{1} more" and
    // "{1} less" alike, so testing it here would call every card ambiguous.
    const more = /\bmore\b/.test(t);
    const less = /\bless\b/.test(t);
    if (more && less) return null;
    if (more || /\bopponents?\b/.test(t)) return "tax";
    if (less || /\bcosts? \{?\d/.test(t)) return "cost-reduction";
    return null;
  };
  // The object is the action's OWN text and stays authoritative. The clause is the fallback for the
  // cards whose object carries only the SUBJECT: Sapphire Medallion's object is "Blue spells you
  // cast", with "cost {1} less to cast" left behind in the clause, so the direction never arrived
  // and the entire ability was dropped. 16 corpus cards derived NOTHING for this reason -- among
  // them Foundry Inspector and Etherium Sculptor, which this file's own comment above claims carry
  // live cost-reduction tags. Same shape, and same precedence, as exilesOwnGraveyard below.
  const own = read(object.toLowerCase());
  if (own) return own;
  const fallback = clauseText.toLowerCase();
  const direction = read(fallback);
  // A SENTENCE ABOUT THIS SPELL'S OWN COST CANNOT BE A TAX, and the fallback is where that goes
  // wrong because it reads a whole clause rather than the action (I2, 2026-08-25). Stax is a cost an
  // OPPONENT pays; an increase in what YOU pay for YOUR OWN spell is an additional cost, which
  // CR 601.2f adds before reductions subtract. Two cards, two different leaks, one guard:
  // **Call the Coppercoats** carries Strive ("This spell costs {1}{W} more to cast for each target
  // beyond the first") and read `more` -> tax; **Blasphemous Edict** carries an ALTERNATIVE cost
  // ("you may pay {B} rather than pay this spell's mana cost") whose clause happens to say
  // "each opponent", so the opponent cue fired on a sentence about neither cost nor opponents' costs.
  // A REDUCTION SURVIVES: "this spell costs {1} less" is still a discount to the caster, which is
  // the direction this file already models. Refusing the label rather than inventing one is the
  // standing rule here — guessing between two opposites is what `costDirection` exists to avoid.
  return direction === "tax" && SELF_COST.test(fallback) ? null : direction;
}


/** Whose graveyard an exile empties. Exiling YOUR OWN graveyard is a cost paid in your own
 *  resources — escape, delve, Mizzix's Mastery copying the spell it exiles — and is the opposite of
 *  hating someone else's. 25 of the 58 graveyard-hate actions in the corpus are that shape, so
 *  nearly half of every self-fuel card was reading as a graveyard-hate payoff.
 *
 *  The object is asked first because it is the action's own text; the clause is a fallback for the
 *  cards whose object is just "that card" or "it" (Necropotence, Cavalier of Thorns). A clause
 *  naming BOTH graveyards refuses to answer rather than guess, which leaves today's kind. */
const YOUR_YARD = /\byour graveyard\b/i;
const OTHER_YARD = /\b(?:target player'?s?|opponents?'?s?|each player'?s?|their)\s+graveyards?\b/i;

function exilesOwnGraveyard(object: string, clauseText: string): boolean {
  if (YOUR_YARD.test(object)) return true;
  if (OTHER_YARD.test(object)) return false;
  return YOUR_YARD.test(clauseText) && !OTHER_YARD.test(clauseText);
}

/** The win clause has no verb of its own. `VERBS` carries no win member, so every "you win the game"
 *  in the corpus arrives as `other` with the meaning intact in the object -- measured identical on
 *  Simic Ascendancy, Revel in Riches and Hellkite Tyrant. `other` is a wide door (15 such actions
 *  across the 13 clause-carrying win cards), so this object test is the entire gate.
 *
 *  Only the YOU-WIN direction. "Target opponent loses the game" is already refused into
 *  `unknownTriggers` by the LOSES_THE_GAME guard rather than being reinterpreted as life loss, and
 *  that refusal stays. */
const WINS = /\byou win the game\b/i;

/** A turn the card TAKES AWAY outright (Magosi's "Skip your next turn" drawback) or CUTS SHORT
 *  (Time Stop / Ultima's "End the turn.", which ends the CURRENT turn rather than granting one).
 *  Crediting either as activation supply is supply with the sign reversed -- strictly worse than
 *  none. Checked on the COMBINED object+clause text: the action's own object is sometimes empty
 *  (Savor the Moment) or names only the skipped/ended unit, not the drawback verb, so only the
 *  clause carries the word that disqualifies it. Round 1 fix (2026-08-14): `\bskips?\b` alone read
 *  Time Stop and Ultima as `extra-turn`, a near-miss label -- ending the turn is not granting one. */
const SKIPPED = /\bskips?\b/i;
const ENDS_TURN = /\bends?\s+the\s+turn\b/i;

/** Which unit the card adds, read from ONE text at a time -- object first, clause text only as a
 *  fallback when the object names nothing. Same precedence `costDirection` and `exilesOwnGraveyard`
 *  already use, for the same reason: the object is the action's OWN words, and the clause can carry
 *  a CONTEXTUAL turn mention that isn't what the action grants. Round 1 fix: reading the combined
 *  text let Paradox Haze's "each turn" (describing WHEN its upkeep-step trigger fires, not what it
 *  grants) and Y'shtola Rhul's "of the turn" (same shape) both misfire as `extra-turn`, when both
 *  objects ("additional upkeep step" / "additional end step") already name the real unit. `step` is
 *  folded into the phase branch, not given its own kind: the vocabulary has no `extra-step`, and an
 *  upkeep or end step is the same sub-turn unit the beginning-phase family already names. */
function readUnit(t: string): EffectKind | null {
  if (/\bphase\b|\bsteps?\b/.test(t)) return "extra-phase";
  if (/\bturns?\b/.test(t)) return "extra-turn";
  return null;
}

/** Combat is tested BEFORE the general phase branch, and on the COMBINED text rather than
 *  object-first: World at War's OBJECT is "main phase" (when the effect fires, not what it grants)
 *  while its CLAUSE names the real "additional combat phase" -- object-first alone would read it as
 *  a generic extra-phase and lose the more specific kind `pressure.ts` is meant to read.
 *
 *  Round 1 fix: requires the actual phrase "combat phase", not the bare word `combat`. The bare
 *  word matched Obeka's "deals COMBAT DAMAGE to a player" -- a combat-damage TRIGGER, not a combat
 *  phase GRANT -- and meshed it with Cyclonus and World at War, which genuinely add one. */
function extraUnitKind(object: string, clauseText: string): EffectKind | null {
  const combined = `${object} ${clauseText}`.toLowerCase();
  if (SKIPPED.test(combined) || ENDS_TURN.test(combined)) return null;
  if (/\bcombat phase\b/.test(combined)) return "extra-combat";
  return readUnit(object.toLowerCase()) ?? readUnit(clauseText.toLowerCase());
}

/** The closed CR phase/step vocabulary `SubjectFilter.phase` may name, per the owner's ruling
 *  (2026-08-14): a coarse `extra-phase` conflated units the game keeps apart -- an extra beginning
 *  phase brings an untap step and is activation supply (§6.4), an extra upkeep or end step brings
 *  none. Measured over the corpus, cards granting an additional NAMED phase/step, 61 total: combat
 *  52 (its own kind, `extra-combat`, never reaches this function) · beginning 4 · upkeep 3 · untap 1
 *  · end 1. `draw` and `main` are in the vocabulary because the Comprehensive Rules name them as
 *  turn structure, even though no corpus card in the extra-turn/extra-phase verb family names them
 *  as its OWN grant (World at War's object names "main phase" only as the timing anchor for its
 *  combat grant, per `extraUnitKind`'s own comment above). */
const PHASE_NAMES = ["untap", "upkeep", "draw", "main", "combat", "beginning", "end"] as const;

/** Anchored the same way `parseCounter` anchors on "counter": the phase word must immediately
 *  precede "phase" or "step", so a CONDITION mentioning combat ("deals combat damage") or a
 *  trigger's own timing ("at the beginning of your upkeep") isn't read as the granted unit. Object
 *  first, clause as fallback -- the same precedence `extraUnitKind` and `costDirection` use, for the
 *  same reason: the object is the action's own words. Unset (`undefined`) when neither text names a
 *  phase from the closed list -- refused, never defaulted, so a future phase family doesn't
 *  silently inherit today's list. */
export function extraPhaseName(object: string, clauseText: string): string | undefined {
  const read = (t: string): string | undefined =>
    PHASE_NAMES.find((p) => new RegExp(`\\b${p}\\s+(?:phase|step)s?\\b`).test(t));
  return read(object.toLowerCase()) ?? read(clauseText.toLowerCase());
}

export function actionEffectKind(action: Action, clauseText = ""): EffectKind | null {
  const verb = action.verb ?? "";
  // CR 614.1c — "this creature enters with three +1/+1 counters on it" is a REPLACEMENT EFFECT on
  // the card's own entry, not an ability that places counters later. The FACT already derived
  // correctly (a self `counter-added` emit with the right counter kind); what was missing is the
  // LABEL, which `mechanisms.ts:54` needs to see a counters deck. 635 corpus cards, 45 normalized.
  if (verb === "add-counter" && ENTERS_WITH.test(clauseText)) return "enters-with-counters";
  // A NEGATIVE modifier is not an anthem. `modify-pt` maps to `pump` below, which is right for
  // "+2/+2" and the exact opposite of the truth for "-2/-2": Massacre Wurm's static applied to every
  // creature the deck plays, and `wincon.ts` counted it as a go-wide finisher. The AMOUNT already
  // carried the sign and nothing read it.
  if (verb === "modify-pt" && /^\s*-/.test(String(action.amount ?? ""))) return "debuff";
  if (verb === "other" && WINS.test(`${action.object ?? ""} ${clauseText}`)) return "win-game";
  if (verb === "extra-turn" || verb === "extra-phase") {
    return extraUnitKind(String(action.object ?? ""), clauseText);
  }
  // 342 corpus cards carry a grant-ability action and the verb had no row here at all, so Lightning
  // Greaves and Swiftfoot Boots derived nothing whatsoever.
  if (verb === "grant-ability") {
    const o = action.object ?? "";
    if (SPEED_KEYWORDS.test(o)) return "speed-increase";
    // Granting a TYPE is not granting a keyword. Omo, Queen of Vesuva says each nonland creature
    // with an everything counter on it "is every creature type", and Maskwood Nexus says it of your
    // whole board -- a typal ENABLER that turns on every kindred payoff at once. Bucketing it with
    // Lightning Greaves' haste lost that entirely. 14 corpus grant-ability actions read this way.
    return TYPE_GRANT.test(o) ? "type-grant" : "keyword-grant";
  }
  // CR 701.10 / 701.11. `double` and `triple` joined VERBS on 2026-08-15; without a row here the
  // word would land nowhere, and the corpus shows exactly what happens then — Gratuitous Violence
  // ("if a creature you control would deal damage ... it deals DOUBLE that damage instead") had no
  // doubling verb to reach for, so the clause layer answered `modify-pt` and it derived `pump`.
  // Damage doubling read as a stat buff, on a card whose entire text is a damage multiplier.
  //
  // WHAT is doubled decides the kind, so the object is read rather than the verb alone. Three of the
  // seven never-produced EFFECT_KINDS are this family (`token-doubling`, `damage-multiplier`,
  // `enters-with-counters`) — the labels existed and nothing could emit them.
  if (verb === "double" || verb === "triple") {
    const o = `${action.object ?? ""} ${clauseText}`;
    if (/\btokens?\b/i.test(o)) return "token-doubling";
    if (/\bdamage\b/i.test(o)) return "damage-multiplier";
    if (/\bcounters?\b/i.test(o)) return "counter-placement";
    if (/\blife\b/i.test(o)) return "lifegain";
    if (/\bmana\b/i.test(o)) return "mana-generation";
    // Doubling something the object does not name is not guessable; refuse rather than pick.
    return null;
  }
  // COPYING A SPELL IS NOT CLONING A PERMANENT. `copy-spell` is one of the seven EFFECT_KINDS
  // derivation never produced, and `mechanisms.ts:47` requires it to see a spellslinger deck at all;
  // the FLAT population produces it and derived never did. The verb cannot tell them apart and the
  // object can, which is the `double` lesson one row up.
  if (verb === "copy") {
    const o = `${action.object ?? ""} ${clauseText}`;
    return /\bspells?\b|\binstant\b|\bsorcery\b|\bability\b/i.test(o) ? "copy-spell" : "clone";
  }
  // A SACRIFICE SOMEONE ELSE IS MADE TO PERFORM is `forced-sacrifice` — an edict. Required by
  // `mechanisms.ts:43` for aristocrats and `buckets.ts:10` as a win condition, and never produced.
  // Your OWN sacrifice is a cost or an outlet, not removal, so the control side decides: only a
  // sacrifice aimed at an opponent counts.
  if (verb === "sacrifice") {
    const control = parseSubject(action.object ?? "").control;
    return control === "opp" ? "forced-sacrifice" : null;
  }
  // "CREATURES LOSE ALL ABILITIES" is `cant | have abilities` after normalization, and it read as
  // nothing, so Dress Down derived its draw and its end-step sacrifice and never the static that
  // turns the board off -- and the engine claimed Grim Guardian drains when Dress Down enters
  // (owner, 2026-09-05). Layer 6 of CR 613: an ability-removing effect. 73 corpus cards print it.
  if (verb === "cant" && /\babilit(?:y|ies)\b/i.test(action.object ?? "")) return "ability-loss";
  if (verb === "cant") return PAYABLE.test(action.object ?? "") ? "tax" : null;
  if (verb === "cost-modify") return costDirection(action.object ?? "", clauseText);
  for (const r of ZONE_RULES) {
    if (r.verb !== verb) continue;
    if (r.from !== undefined && (action.fromZone ?? null) !== r.from) continue;
    if (r.to && (action.toZone ?? null) !== r.to) continue;
    // See exilesOwnGraveyard. Null rather than a kind of its own: the payoff this card actually has
    // is carried by the OTHER actions in the same clause, and a near-miss kind is consumed as if it
    // were true while null is honestly inert.
    if (r.kind === "graveyard-hate" && exilesOwnGraveyard(action.object ?? "", clauseText)) return null;
    return r.kind;
  }
  // Life change is one verb per direction, but which kind depends on whose life it is.
  if (verb === "gain-life") return "lifegain";
  if (verb === "lose-life" || verb === "set-life") {
    return parseSubject(action.object ?? "").control === "you" ? null : "player-life-loss";
  }
  // ENERGY IS NOT MANA, AND THE NORMALIZER CALLS IT MANA. "Whenever a creature you control enters,
  // you get {E} (an energy counter)" arrives from the clause layer as `{verb: "add-mana", object:
  // "E"}`, and `SIMPLE` below turned that into `mana-generation` -- so Decoction Module's page read
  // "adds 1 mana", a claim big enough to change a build and false. Both a deck tuner and a skeptic
  // refused to act on that row, independently, on 2026-09-04.
  //
  // MEASURED over the clause corpus: 35 of 2,263 `add-mana` actions carry the energy object, across
  // 32 cards -- Decoction Module, Aetherstorm Roc, Empyreal Voyager, Dr. Madison Li. The other 2,228
  // are real mana and are untouched.
  //
  // REFUSED RATHER THAN RELABELLED. Energy is a player resource with no member in `EFFECT_KINDS`,
  // and inventing one would be consumed downstream as if it were true by `impact.ts`, `buckets.ts`
  // and the castability model, none of which can spend it. A missing kind reads as "fixed", which is
  // the honest answer: the engine has no vocabulary for energy yet. Fixing it in the CLAUSE layer
  // would cost a re-normalisation; this is free.
  if (verb === "add-mana" && isEnergyObject(action.object ?? "")) return null;
  return SIMPLE[verb] ?? null;
}
