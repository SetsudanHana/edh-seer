/** Canonical clauses to the Ability[] the engine already consumes. Pure: no model, no database.
 *
 *  One Ability per ACTION rather than per clause, because effect.kind is singular and a drain has
 *  to register on both the lifeloss and the lifegain axis. An action that yields neither a kind nor
 *  an emit is returned in `unclaimed` instead of vanishing -- a dropped clause that produces
 *  silence is indistinguishable from a card that does nothing, which is exactly how Bitterblossom
 *  sat in the corpus as a vanilla bear. */
import { GUARDED_VERBS, guardExempt, verbPrint } from "./verb-words.js";
import type { Action, ClauseRecord } from "../canonicalize.js";
import type { Ability, UnclaimedAction, Requirement, AbilityKind, CardTags, Characteristics, Control, SubjectFilter, Verb, EventCount } from "../schema.js";
import { VERB_ALIASES, VERB_VOCAB } from "../schema.js";
import { graveyardReplacement } from "./graveyard-replacement.js";
import { targetingBanOf, targetingBanSubjectInObject, triggerSuppressionOf, untapDenialFor } from "./cant-kinds.js";
import { ZONE_SCOPED_KINDS, actionEffectKind, handFillRead, restrictedActions, bounceOrigin, exileNamesOnlyGraveyards, exilesFromYourGraveyard, exilesOwnGraveyard, extraPhaseName, extraLoyalty, playsFromTop, retargetObject } from "./effect-kind.js";
import { actionEmits, casualtySacrifice, millsOwnLibrary, COPY_TOKEN_HEAD, LEAVES_SAME_TURN, narrowSelfExiledSpell, TEMPORARY_TOKEN_REF } from "./emits.js";
import { interveningIfOf, activationConditionOf, classifyCondition, conditionTestsObject, conditionCares as conditionCares_, ARRIVED_WITHOUT_CASTING, SAME_NAME, WITHOUT_DYING } from "./intervening-if.js";
import { requiresOf } from "./markers.js";
import { hostEffect } from "./host.js";
import { librarySearchOwner, printsSearch } from "./library-search.js";
import { creatureDamageSource, damageHitsSelf, damageRecipient, playerOnlyRecipient } from "./damage-recipient.js";
import { actionRecipients, damagedPlayerIsOpponent, sacrificerIsTargeted, sentenceNamesAPlayer, thatPlayerIsOpponent, victimDeclines } from "./recipient.js";
import { actionScaling, scalingSubject } from "./scaling.js";
import { namesAClass, parseSubject, parseCounter } from "./subject.js";
import { parse as parseFilterRaw, stableJson } from "../grammar/filter.js";
import { memoizeCloned } from "../memo.js";
import { selfAsTilde } from "../grammar/self-as-tilde.js";
import { effectText, printedPreamble } from "../grammar/preamble.js";
import { alignVerbs, parseActions, type ActionReading } from "../grammar/action.js";
import { parseTrigger, readBlocker, type TriggerReading } from "../grammar/trigger.js";
import { conditionalReturn, delaysIn, flipBranch, returnDelay, untilSourceLeaves } from "./delay.js";
import { branchesAlike, counterIsTheCardsOwn, effectGates, FLIP_VERB_WORDS, isOtherwiseGate, nthSentenceMatching, printedVerbWord } from "./effect-gate.js";
import { parseGate } from "./gate.js";
import { delayedTriggerRepeats, repeatsFor, withoutAbilityWord, type RawTrigger } from "./repeats.js";
import { replacementOf } from "./replacement.js";
import { countOf } from "./event-count.js";
import { reductionOf } from "./reduction.js";
import crKeywords from "./cr-keywords.json" with { type: "json" };
import { paymentOf } from "./payment.js";
import { doubledVerbs, doublesOf } from "./doubles.js";
import { stationThresholdFor, thresholdFor, thresholdSubjectFor } from "./threshold.js";
import { addsManaText, deriveMana, production } from "./mana-lines.js";
import { eventAmountFor } from "./event-amount.js";
import { SUBTYPES } from "./subtypes.js";
import { isSelfSubject, SELF_REFERENCE, withoutArticle } from "./self-reference.js";
import { antecedentIsSelf as selfAntecedent, antecedentSource, antecedentText, boundedByEnchantLine, exiledAcrossClauses, PLURAL_BACKREF, pluralAntecedent, PRONOUN_OBJECT, zoneAfterEvent } from "./references.js";
import { triggerHasCue } from "../clause-store.js";
import { emblemRecipient } from "../emblem.js";

/** Bump when derivation semantics change — a new effect kind, a changed emit, a new guard. Unlike
 *  NORMALIZE_VERSION this is FREE to bump: it only re-runs `derive-corpus`, which reads the stored
 *  clauses and calls no model. That asymmetry is the whole point of storing clauses separately. */
// 113: scry, surveil and search become engine events (CR 701.22 / 701.25 / 701.23) -- new triggers
// on the consumer side, new emits on the producer side.
// 114: top-manipulation retired; scry, surveil, mill, search and top-set replace it (CR 701.22 /
// 701.25 / 701.17 / 701.23), and the tutor gate in edges.ts now reads `search` directly.
// 115: emblem is its own effect kind, its control is the recipient the sentence names, and a
// granted clause on a card with an Emblem part derives on the emblem's own row (spec 2026-09-08).
// 116: "her" and "him" are pronouns, so a planeswalker's own re-entry is a self emit, not a wildcard.
// 131: a damage multiplier's trigger subject is the DEALER ("a source you control"), the half
// `GameEvent.dealer` records and `eventMatches` compares; "a creature you control" is no longer
// `restricted`, because the matcher checks it (recall v4 #120).
// 132: a More Than Meets the Eye card is playable from either face (CR 702.162), so its back face
// implies its own cast and enters (recall v4 #151).
// 133: a granted trigger's self emits and its "you" are the recipient's (CR 113.8), the recipient may be a
// permanent, and a card that exiles what would hit an opponent's graveyard AND plays it is a
// graveyard-recursion over their fills (recall v4 #28).
// 134: "defending player" and "attacking player" are an opponent as an ACTOR too, so Kibo's edict is
// the opponent's sacrifice and not a demand for your artifacts (owner-judged FALSE 2026-09-09).
// 135: what you PUT onto the battlefield enters under your control (CR 110.2a), so a fetched land
// no longer satisfies "lands enter under an opponent's control" (Misty Rainforest -> Deep Gnome
// Terramancer, owner-judged FALSE 2026-09-09). Emit only; a recursion's effect subject keeps `any`.
// 136: a trigger doubler records WHOSE triggers it doubles (`doublesOf`, the class named in "a
// triggered ability of another Elemental you control"), the axis `doubles` had no slot for (recall
// v5 #196, Cavalier of Thorns -> Twinflame Travelers). Eight corpus cards.
// 137: a grant to a TYPE-narrowed class keeps its recipient (owner ruling 2026-09-10, recall v5 #2:
// Cybermen Squadron's "nonlegendary artifact creatures you control have myriad"); board state
// (attacking, tapped, equipped) and the whole board stay refused.
// 138: a -X/-X or -N/-N sweep on all or each creatures emits `dies`, control as printed (owner
// ruling 2026-09-10; recall v5 #156, Toxic Deluge). A targeted debuff still says nothing.
// 139: "if you descended this turn" cares about `dies:any` (CR 700.11) -- a deck demand, no edge
// (recall v5 #179, Scalding Tarn -> Brass's Tunnel-Grinder).
// 143: a class-restricted DIG ("look at the top four, reveal an Elemental, Island, or Mountain
// card and put it into your hand") is a `search` (owner ruling 2026-09-16, AF10 ruling 4; recall v6
// #165 Eclipsed Flamekin -> Smoldering Marsh). An untyped dig ("two of them") stays kindless.
// 144: "puts all cards they exiled this way onto the battlefield" (Living Death, Living End) is
// exile-then-use, so a mass reanimation derives `graveyard-recursion` (recall v7 #187).
// 145: the class inside an intervening-if is the trigger's class when the trigger subject is the bare
// `spell` -- Alania's "if it's the first instant spell, the first sorcery spell, or the first Otter
// spell" (owner, 2026-09-16, recall v7 #178); the once-per-turn condition is dropped.
// 146: the threshold moves from the trigger to the ABILITY and is read on every kind -- Chrome
// Steed's "as long as", Urza's Workshop's "activate only if", Gadrak's "can't attack unless" (recall
// v6 #77, v7 #79); a typed count keeps a kindless ability alive the way a trigger does; the count's
// controller is read from the words before the number, and an event count refuses.
// 147: `characteristics.enchants` -- an Aura's printed Enchant line as a subject, so the matcher
// can let the host's death carry the Aura to the graveyard (CR 704.5m; recall v6 #57 Chime of Night).
// 148: a `put` reads its named actor ("that player puts all cards revealed this way into their
// graveyard", Mind Funeral) -- the fill is the opponent's, not `any`; an object that states its own
// controller ("under your control") keeps it.
// 149: `damaged`, the receiving side of damage, is an engine verb (AF7d): "whenever this creature is
// dealt damage" derives a trigger, from the clause word and from the older `damage-dealt` spelling.
// 150: `exiled` is an engine verb emitted by every exile action (AF7b), and a from-exile move whose
// object names an opponent as owner is the `exile-processing` kind (Ulamog's Nullifier, 22 cards).
// 151: a graveyard card count is a threshold subject with the zone and the owner (AF7c): "seven or
// more cards in your graveyard", "an opponent has eight or more cards in their graveyard".
// 152: a printed "you draws/gains/loses/..." is a stated actor (Y'shtola, Night's Blessed's draw read
// `any` because the condition named "a player", and met "whenever an opponent draws").
// 153: a counter put on the card itself is a `self` emit (Primal Amulet's charge counter, a creature's
// own +1/+1), read off the clause text since an add-counter's object names only the counter.
// 154: a passive own-counter trigger ("whenever counters are put on this creature") is self, read off
// the trigger phrase; the model's subject there is the counter, never the recipient.
// 155: an active-voice counter trigger ("whenever you put one or more +1/+1 counters on X") records
// the kind from the trigger phrase (Exemplar of Light <- Sorin's lifelink counter); `parseCounter`
// needs a word start, so "one or more counters" is no longer an ore counter (Shadow Urchin).
// 156: a counter on the card's SHORT name is self ("on Lonis" for Lonis, Genetics Expert), a replacement
// on the card's own counters is self (Mowu), and the printed {E} symbol is an energy counter
// (Territorial Gorger, whose reminder text the segmenter strips).
// 157: a counter emit whose object names the recipient takes the ONE kind its sentence names (Argent
// Dais's oil, Shelinda's +1/+1); "you get {E}" emits an energy counter on a player (CR 107.14) even
// though the normalizer called it mana; `{E}{E}` counts as energy too.
// 158: a counter REMOVED from the card itself is self ("removed from Chandra", "from this card while
// it's exiled"), and a recipient-comma-kind object ("this, oil") names its kind; a counter removed
// from the card itself, in the text or in an activation cost ("remove twelve time counters from
// Trenzalore Clocktower"), is a self emit -- "on" for a placement, "from" for a removal, so Forgotten
// Ancient's move onto other creatures stays theirs; a GRANTED counter trigger ("creatures you control
// have 'whenever counters are put on this creature'", Danny Pink) is the recipients', never self.
// 159: the payment that stops an effect ("draw a card unless that player pays {1}", CR 118.12a)
// rides onto the ability as `unless` {cost, payer}, verbatim from the clause; the prompt learned
// the field at NORMALIZE_VERSION 21 and the ~550 cards that state one were re-asked (2026-09-17).
// 160: a mana ability's amount is the mana it adds, read off the action's object when the clause
// states none: "{C}{C}" is 2, "one mana of any color" is 1, "{U} or {B}" is 1 (the smallest
// alternative), "three mana of any one color" is 3; a counted or X object stays unset, as does
// energy. The cost-to-effect rate's mana family reads it (roadmap X2; 2,528 add-mana actions,
// 94% of them without an amount before this).
// 161: a counted action's amount is read off its object when the clause states none (the census
// 2026-09-17: 754 draws, 1,505 discards, 1,118 searches, 2,701 returns without one): "a card" is
// 1, "two cards" 2, "up to two basic land cards" 2 (the rate's condition list puts the floor at
// 0), "X target creatures" X; for a verb whose object IS the thing counted (return, untap, copy,
// exile, put, tap, sacrifice, destroy) "target creature", "this", "it", "another" are 1; "all",
// "each", "the", "those", "that many", "cards equal to" stay unset. Scry and surveil carry the
// number as the object. This retires the paid `dropsUnitAmount` refresh.
// 162: a put from your hand that offers top OR bottom is top manipulation (Dream Cache), so the
// ability exists and the rate can net it; an Exhaust ability repeats once (CR 702.177a).
// 165: the copy-ability family reads WHICH KIND and WHOSE. A pronoun object ("copy that ability")
// takes the kind from its trigger subject and not only from an `activate` trigger, so Aboleth
// Spawn and Firebender Ascension stop claiming activated copies they cannot make; and a clone's
// "except it has this ability" tail stops making the clone an ability copier (Dimir Doppelganger,
// Cryptoplasm, Unstable Shapeshifter, Mizzium Transreliquat). The matcher refuses an `opp` copier
// in the same PR -- Aboleth Spawn copies an opponent's trigger and has no feeder in your deck.
// 164: every derived ability carries the id of the clause that printed it (roadmap AJ4), so the
// card page can read down the card instead of zipping two lists that do not line up. An IMPLIED
// ability -- read off characteristics, not rules text -- carries none, which is how the page tells
// them apart.
// 163: a put from the LIBRARY into a graveyard emits `mill`, not `enters-graveyard`, UNLESS the
// clause searched -- Entomb and Buried Alive tutor a card into the yard and never mill (CR
// 701.17a: milling is the top cards). Both layers make that test now (roadmap AK1).
// `effect-kind` has read the origin since 2026-09-07 and `emits` did not, so 211 abilities derived
// as kind `mill` while emitting the Entomb verb -- Cavalier of Thorns, Shigeki, Shadow Prophecy.
// `supplyForms` bridges mill to the enters-graveyard forms, so no payoff that asks for a graveyard
// put loses its supplier.
// 166: a STATIC graveyard-recursion keeps its subject. The whole-deck-lord refusal dropped a
// singular one ("cast one permanent spell with mana value 2 or less from your graveyard"), and
// edges.ts skips a subjectless recursion, so 66 corpus cards -- Lurrus, Karador, Gisa and Geralf,
// Gravecrawler -- formed no recursion edge.
// 167: a LOYALTY ability repeats once per round (CR 606.3). It has neither mana nor {T} in its
// cost, so it fell through to `repeatable` and every planeswalker read as a free, unbounded
// ability -- Grist, Liliana and Garruk among the sacrifice outlets (roadmap AN3).
// 168: a trigger on ONE object repeats once or once a combat, not at will (roadmap AN7): "when
// that/enchanted/equipped/fortified creature dies" is once, its attacks and combat damage once a
// combat -- 358 corpus cards read `repeatable`, and Make Your Mark ranked beside Midnight Reaper.
// And an Aura whose Enchant line names an opponent's creature gives its "enchanted creature"
// trigger the opponent's side (Nurgle's Rot claimed your own creatures' deaths).
// 169: an EQUIPPED or FORTIFIED host's death repeats once a round, not once: the Equipment stays
// (CR 301.5c) and re-equips for its paid cost. 168 read it once and dropped Skullclamp from 22nd to
// 2,010th on the draw list; an Aura's host death stays once (CR 704.5m).
// 170: a damage trigger records the size of the event it watches (`trigger.amount`, read off the
// printed head): Ghyrson Starn's "exactly 1 damage", Dragonborn Champion's "5 or more". Seven corpus
// cards; the engine had joined Ghyrson to every pinger whatever it dealt.
// 171: an `enters` trigger whose subject says "enters transformed" is refused (`enters-transformed`),
// not read as every permanent entering. One corpus card, Corruption of Towashi: 23 deck cards had
// "reached Alandra through it" on the Ghyrson route list.
// 172: energy the clause layer spells with spaces ("E E E") is energy, not mana -- 9 cards read as
// ramp (Chthonian Nightmare, Bristling Hydra, ...). And a leading article is not a name: "The
// Sackville-Bagginses" is self as "Sackville-Bagginses" (its ETB had joined Kindred Discovery), and
// stripCardName no longer deletes every "the" from a "The ..." card's clause text.
// 173: overview persona rounds 2026-09-25. A temporary token LEAVES (exile) or DIES (sacrifice) on
// the ability that made it (item 4: Inalla -> Dour Port-Mage). Counters put on the card by its own
// name are on itself, and a quantified recipient ("on each other Moogle you control") types a
// counter emit (item 8: The Earth Crystal fed by The Ozolith and Mog). A flash grant ("cast spells
// as though they had flash") is a permission, not a cast (Najal, High Fae Trickster).
// 174: a delayed trigger ("When you next cast a creature spell this turn") fires as often as what
// made it -- a chapter or a spell once, an activation at its cost's rate, recorded as `delayedBy`
// (issue #500: Summon: Fenrir's chapter II and Yuna, Grand Summoner's {T} read EVERY TIME).
// 175: a next-end-step cleanup clause ("sacrifice those tokens") is the previous clause's token
// maker going temporary, not a sacrifice outlet; a "for each X, create" preamble is the create's
// board count (issue #502: Redoubled Stormsinger, fodder for every Treasure, fed by no token maker).
// 176: an ordinal excluded by "other than the" is no per-turn cap (issue #518): Curse of Shaken Faith
// fires on every spell after the first. Two corpus cards.
// 177: a fight that names the card first ("this creature fights another target creature") damages
// the other creature, not the card itself (issue #562: Brash Taunter supplied no damaged payoff).
// 17 corpus cards; on the 71 decks edges 45,023 -> 45,044, panel and compass unchanged.
// 178: "a spell that shares a creature type with this creature" names the host's creature types, and
// a grant to commander creatures names the COMMANDER'S (`sharesTypeWith`, issue #559: Folk Hero drew
// "when Nalia de'Arnise is cast").
// 179: a Background's "Commander creatures you own have '...'" makes every "this creature"/"it" in
// the grant the commander, and "share a creature type with it" the commander's types (issue #625:
// 26 Backgrounds read their granted text as the Background itself; Haunted One never fired).
// 180: "whenever an enchanted/equipped creature ..." is a `modified` creature (issue #565: Hateful
// Eidolon drew for every death). 3 corpus cards.
// 181: Reality Fracture. `empower-jace` is amass's shape (kind `counter-placement`); `prepare` /
// `unprepare` are words with no engine verb yet; CR 205.3's artifact types union into SUBTYPES
// (Heartwood, Lander, Mutagen, Vibranium were unread), and a CR 111.10 token keeps its rule's type.
// 182: Prepared forms edges (owner ruling 2026-09-27): `prepare` emits `prepared`, and "enters
// prepared" is a self-entry trigger.
// 183: a `grant-ability` whose clause "becomes prepared" is a prepare (Codie, Ravenous Codex).
// 184: "permanents you own that your opponents control" is a board count with `owner: "you"`, not
// per-opponent (issue #681: Zedruu the Greathearted linked to none of Political Puppets).
// 185: a grant to the spells you cast names that class (owner ruling 2026-09-28, #681): Anhelo's
// "first instant or sorcery spell you cast each turn has casualty", Yidris's "as you cast spells
// from your hand this turn, they gain cascade". A creature anthem stays refused.
// 186: casualty N is a sacrifice outlet for a creature with power N or greater (CR 702.153a; owner
// 2026-09-28), granted (Anhelo, Silverquill) or printed as a keyword line (Make Disappear).
// 187: "its controller" after an untargeted trigger subject is anyone, not an opponent (issue #650:
// Tainted Aether's "whenever a creature enters, its controller sacrifices" hits your own board).
// 188: an "or" trigger limb the clause layer cannot hold derives a twin trigger (compass misses:
// Syr Konrad's "or put into a graveyard from anywhere", "or leaves your graveyard").
// 189: "each creature assigns combat damage equal to its toughness" is a static damage-multiplier over
// creatures whose toughness exceeds their power (owner ruling 2026-09-28, Doran).
// 190: a static grant to "(other) (colour) creatures you control" keeps its recipient (owner ruling
// 2026-09-28, #711): Anger's haste and Unctus's loot link to every creature they apply to.
// 191: #711 part 2 -- a static clause with no action that reads `<recipient> have "<ability>"` is a
// grant (Enduring Vitality); "you may cast <class> spells as though they had flash" is a static
// grant to that class (Shimmer Myr); doubling power and toughness is a pump (Unnatural Growth).
// 192: #715 -- "reveal until you reveal a <class> card ... put that card onto the battlefield" types
// the put with that class (Descendants' Fury); a zone-less "return it to the battlefield" after an
// exile in the same clause is a flicker (Jill, Shiva's Dominant).
// 193: #716 -- a targeted destroy whose controller gets copies back is aimed at your own creature
// (Saw in Half, owner ruling #513); an object naming "in/from ... graveyard" sets a missing fromZone
// (Emry, Lurker of the Loch's cast from your graveyard is recursion).
// 194: #717 -- a cost reduction over "spell(s) you cast" is your class, with a stat-vs-stat narrowing
// read (Doran, Besieged by Time); "if you would draw a card ... instead" is a draw replacement, a
// payoff for draws (Alhammarret's Archive).
// 195: a CR 614 multiplier's synthesized trigger is marked `replacement` (owner 2026-09-29: the
// edge runs from the replacement to the card whose effect it improves).
// 196: an intervening if on the life you gained or the spells you cast this turn is a demand
// (owner 2026-09-29: Resplendent Angel -> gain-life:any; "cast a noncreature spell" -> cast:-creature).
// 197: #715 -- a self re-entry "returned to the battlefield transformed" is marked `transformed`, so
// the matcher types it with the back face (Jill, Shiva's Dominant -> Setessan Champion).
// 198: #713 -- "a spell with an odd/even mana value" is a parity stat on mana value, so the cast
// trigger narrows (Soundwave, Superior Captain) instead of reading as every spell.
// 199: edge magnitude -- an ability records how many events one use supplies (`count`: a number,
// "up to N", X per mana, "for each <class>", a board-wide emit), and a "one or more" trigger is
// `batched` (CR 603.2c). Display data; no claim changes.
// 200: owner's edge-magnitude sheet -- a pronoun's antecedent skips a zone object ("your
// library"), and a pronoun put inherits the count its antecedent states (The Five Doctors: up to
// five Doctors, no longer an untyped entry; Canoptek Wraith: up to two lands).
// 201: #798 -- "draw a card if it was attacking. Otherwise, ..." puts the combat state on the
// conditioned action's trigger only (Garna, Bloodfist of Keld; Zurgo Stormrender).
// 202: #801 -- a return "at the beginning of the next end step / your next upkeep" is `delayedUntil`
// on the returning ability (Shirei, Shizo's Caretaker): it cannot close a loop this turn.
// 203: #803 -- an ability on an instant or sorcery beyond its on-cast effect (a granted "when this
// creature dies, return it", Undying Malice) repeats once: the spell is gone once it resolves.
// 204: #804 -- a cost reduction records what it takes off (`reduces.mana`, from the printed "costs {2}
// less", else the clause amount) and whether it discounts only its own card (`reduces.self`).
// 205: #802 -- a return to hand from the battlefield or the stack is `bounce`, with the zone on its
// subject (Boomerang, Hullbreaker Horror, Narset's Reversal, Remand). A fact, not a synergy.
// 206: #846 -- a triggered mode bullet with no trigger of its own takes its "choose" header's
// (Hullbreaker Horror's bounces fire on every spell you cast).
// 207: #806 -- an activation cost is read into `payment` beside the raw `cost` (mana, {T}/{Q},
// loyalty, life, sacrifice, discard, exile, tapping another, counters; an unread part kept verbatim).
// 208: #856 -- a static permission to play or cast from the top of your library is `play-from-top`
// (Mystic Forge, Crystal Skull, Bolas's Citadel), and a card putting itself back on top is a self
// `top-set` (Sensei's Divining Top).
// 209: #858 -- "tokens would be created ... instead" and "an effect would create ... instead" are CR 614
// token multipliers hearing another card's token creation (Stridehangar Automaton, Doubling Season).
// 210: #859 -- "you may activate ... loyalty abilities" twice, as though none were activated, or at
// instant speed is `extra-loyalty`, read off the printed sentence (The Chain Veil, Oath of Teferi).
// 211: a quoted or emblem-granted loyalty permission is the emblem's, not the card's (Teferi,
// Temporal Archmage's -10 claimed every planeswalker beside its own emblem node).
// 212: #860 -- "the exiled card" in a later clause is what an earlier clause exiled, and "cast the copy"
// is what the copy copied: Isochron Scepter's copy is a spell copy and its cast names "an instant card
// with mana value 2 or less".
// 213: #857 -- a keyword grant names its keywords (`grants`), and "other non-Human creatures you
// control get +1/+1 and have undying" keeps its recipient (Mikaeus, the Unhallowed).
// 214: a keyword named INSIDE a quoted ability is not a granted keyword (Way of the Wildspeaker's
// "[-4]: Create a 4/4 ... Beast token with trample" grants no trample).
// 215: #886 -- a return that marks what it returns (finality counter, or a keyword counter the trigger
// excludes) is `oncePerObject` (Meathook Massacre II, Luminous Broodmoth); #887 -- a flicker's "return
// that card" takes its subject from the exile (Displacer Kitten: nonland permanent you control).
// 216: #896 task 4 -- a reference to the triggering object is `ref: "trigger"` and takes the zone the
// event left it in (Mari, the Killing Quill exiles from a graveyard); a trigger subject that names a
// player or a time is no referent (Galvanoth); "the exiled cards" crosses clauses like the singular (Petradon).
// 217: #896 task 3 -- trigger subjects, replacement subjects and action objects are read by the filter
// grammar first, `parseSubject` answering what it refuses.
// 218: ...and the gates see `anyOf` (namesAClass), a count the grammar reads past keeps parseSubject,
// a card's owner is its `control`, copies keep the class their reference names, and a card with no
// rules text carries `noAbilities`.
// 219: "named ~" is the card's own name.
// 220: a gate sees through `anyOf` only on a subject the grammar produced.
// 221: a copy records what it copies (`copyOf`) beside what it becomes.
// 222: #900 -- a pronoun after a reveal or a look means the revealed card, typed by the clause's own
// condition ("if it's a land card"); with none stated it is unresolved, never the trigger.
// 223: ...and "a spell" / "a card" alone states no class.
// 224: #896 task 5 -- the trigger grammar reads the printed preamble and WINS for event, subject and
// control; an intervening if or a narrowing derive cannot represent REFUSES the claim (owner
// 2026-10-01). The stored path stays for clauses with no printed trigger word and "when you do".
// 225: ...a compound kept as ONE stored clause claims every reading (Bilbo's "enters or leaves"); the
// graveyard named is the card's owner (CR 400.3); "this creature or equipped creature" is the card.
// 226: ...a condition on where the SOURCE is (Inalla's eminence) and Bowmasters' "except the first
// one they draw in each of their draw steps" narrow no event a card supplies, so they claim.
// 227: Guardian Project's "doesn't have the same name" is `uniqueName` (CR 903.5b, owner 2026-10-01).
// 228: #896 task 6 -- the action grammar takes draw/search (draw, discard, mill, scry, surveil,
// search, reveal): a stored action of those verbs is rewritten from the printed phrase it reads.
// 229: ...a back-referenced actor ("that player mills") keeps the stored object.
// 230: ...wider phrasing: "X cards, where X is ...", "each player who ...", "you and X each".
// 231: ..."up to X" is the amount X, as the store wrote it (Harvest Season's scaling).
// 232: ...a cost left inline after an ability word reads (Power-up: "each opponent discards").
// 233: ...and damage and life (deal-damage, gain-life, lose-life, set-life); families align apart.
// 234: ...the actor carries past an unread phrase; "X, where X is" keeps the counted thing; a
// back-reference keeps derive's own antecedent.
// 235: ...a phrase after a subject the grammar cannot name is not read (Bounty Board's opponents gain).
// 236: ..."you and those players each draw, then discard" is both players' (Zurzoth).
// 237: ...and counters (add-counter, remove-counter, proliferate): the recipient is written in front
// of the kind, so a placement's subject is its target, not "a permanent" (#731).
// 238: ...and tokens (create, populate, amass, investigate, incubate); a quoted ability is one atom.
// 239: ...a token's text is the token alone; an X/X keeps its "where X is"; a copy of "that" keeps the store's.
// 240: ..."tapped and attacking" is not the token's; a verb read more often than stored stays stored.
// 241: ...except a search, whose extra readings are its zones (Tower Winder).
// 242: ...and zone moves (destroy, exile, sacrifice, return, put, shuffle); the count stays in the text.
// 243: ...and pumps and grants (modify-pt, grant-ability): a grant's object is the ability granted.
// 244: ...and mana, tapping and restrictions (add-mana, tap, untap, cant).
// 245: ...and the long tail (counter-spell, gain-control, fight, goad, regenerate, transform, attach,
// copy, keyword actions).
// 246: ...coverage push: predicate lists, "the same is true for", keyword lines, restrictions in
// lists, "loses <ability>", the tap a move or a creation carries, counters on several recipients.
// 247: ...push 2: object and recipient lists, "you control enchanted X", clones; cast, play, prevent,
// cost-modify, double, animate.
// 248: ...push 3: the rest of the keyword and game actions (dice, coins, extra turns and phases,
// emblems, win/lose the game, phasing, clash, exert, manifest, convert, the benders, blight, behold).
// 249: ...fragments 1: a back-referenced controller ("that player controls", "they control") and a set
// the sentence made ("revealed this way") are read; the object stays as stored.
// 250: ...fragments 2: a leading "Until end of turn, ...", "becomes ... with base power and toughness",
// "loses ...", "cast this spell only ...", casting modifiers, "enters with" on a class and "and with".
// 251: a keyword grant to the triggering object marks its subject `ref: "trigger"`.
// 252: #896 fragments 3: a copy's exceptions ("enter as" / "become a copy of ..., except ..."), an
// alternative cost and strive, mana by shape, a prevention shield, "a number of" counters, "then double".
// 253: fragments 4: damage redirections, block requirements, an Aura's host animated, counters moved
// or improved, a target's controller, quoted abilities ending a sentence, cost items after "and".
// 254: fragments 5: ", then" before any subject, coloured and ability cost changes, copies N times,
// "~ becomes a copy of", animated lands, stacked openers, "would deal" is no dealer.
// 255: fragments 6: readings align by verb in either order (stored gain, lose; printed lose, gain);
// "it deals double that damage" is a double; "those creatures gain" is a joint; copies that change P/T;
// "into that player's graveyard"; milled sets. Keyword actions the derive switch does not take over
// (prepare, empower, recruit, cloak, vote, ...) are read for the census only.
// 256: fragments 7: characteristic-defining abilities ("Titania's power and toughness are each equal
// to ..."), quoted grants kept whole, several targets pumped in one sentence, self-copies, improved
// damage ("that much damage plus 2"), a trailing "as long as" kept as the condition.
// 257: fragments 8: two subjects in one pump sentence, improved life, library puts by position, sets
// exiled with the card, "fight each other", a predicate with no subject of its own as a back-reference.
// 258: fragments 9: inner triggers as openers, a player's life total set, toughness CDAs, counted
// entries, "twice that many", ordinal and next-spell subjects kept as stored, graveyard sets.
// 259: fragments 10: 31 named counter kinds the vocabulary lacked (loot, tower, arrow, necrodermis,
// ...), "another" counter, a coloured cost per count, base P/T with a list of abilities.
// 260: fragments 11: pump and grant predicates (toughness as combat damage, attacking past defender,
// "all activated abilities of", either P/T, base P/T X/X, "~ and other X", protection by choice).
// 261: fragments 12: attack and block requirements, activated abilities that can't be activated,
// "that Hero" / "either of them", moved counters, puts of several objects, "the player puts".
// 262: fragments 13: an opponent's dig until a card, "from it", face-down piles, "the top card" in a
// list, returns to their hand, X/X and plural animations, "it deals 4 damage instead".
// 263: fragments 14: "and" before "this creature gets" / blight / convert, labels with "~", "those
// permanents", delayed spell copies, named copies' pronouns, "the next spell ... has convoke".
// 264: fragments 15: equipped creatures you control (kept as stored), "this card's other abilities",
// plays from the top, combat-damage shields, exchanged life totals, a card's own counters removed as a
// cost, +X/+Y counters, Torpor Orb, alternative costs for a class, cast from that player's graveyard.
// 265: a counter-removal outlet on other permanents is read (owner 2026-10-02: "you need counters to
// remove counters"): "remove a counter from a permanent you control", "... from among creatures".
// 266: "life you lost this turn" is the `per-life-lost` scaling basis, and a life payment the store
// left out (Toxic Deluge's additional cost) is added from the grammar (owner 2026-10-02, Rowan).
// 267: fragments 16: "triple", plays and casts of "one of them", casts paid by a sacrifice, lists with
// "those", entering tapped and with counters.
// 268: task 7 step 2: "phases out" names what phases; "spend this mana only ..." is the store's other.
// 269: task 7 step 3: "becomes a 3/1 ... creature" carries its P/T, a card's own cost reduction keeps its
// whole phrase, "you may pay 4 life rather than pay this spell's mana cost" is a life payment too.
// 270: #896 task 7, the card-by-card switch: a card the grammar reads completely derives from its
// printed text alone when that matches the stored answer or a "grammar right" group (derive-corpus).
// 271: #896 task 7, labelling round 1: grammar records read phase control by whose turn, keep self
// subject actions, payments of a "can't ... unless", stated counts, and six more groups are labelled.
// 272: #896 task 7, labelling round 2: pronoun antecedents, "on top" back-references, hands and
// graveyards split, transformed returns, and six more groups labelled.
// 273: #896 task 7, labelling round 3: every difference group of ten or more cards labelled; zones,
// players and self references the sentence implies.
// 274: #962, the polymorph family (a creature traded for one its controller reveals) reads as played
// on your own creature; Proteus Staff's tuck states the creature it trades away.
// 275: #963, CR 110.2a -- a put onto the battlefield with no player named enters under YOUR control,
// even beside a second put of the rest to the library (Nissa, Leyline Tamer; Cultivate).
// 276: #713, "a spell that targets only a single creature you control" is read as what it targets
// (`SubjectFilter.targets`), no longer refused wholesale as `restricted`.
// 277: #713, the same in the filter grammar, which refused "that targets only" ahead of 276's rule.
// 278: #794, "would create a Clue, Food, or Treasure token" reads all three; investigate's token is a
// Clue (CR 701.16a), so it is an artifact token.
// 279: #794, investigate's Clue also says it is a token, so its artifact type is filled (278 named the
// Clue but left `token` for later, and the type fill reads it first).
// 280/281: #971, amass reads as the Army the rules describe (CR 701.47a) in the action grammar, yours
// even in a clause naming an opponent, and emits create-token, enters and its +1/+1 counter.
// 282: #697, a draw, mill, scry or surveil the grammar reads with no actor is yours (CR 608.2c), even in a
// sentence naming an opponent (Esper Sentinel, Veil of Summer).
// 283: #797, a card whose own static says it isn't a creature under a condition (the Theros gods) is
// marked `creatureOnlyIf`, read by the action grammar.
// 284: S-T1, a landwalk grant names its landwalk (CR 702.14): "islandwalk" is an instance, not a name on
// the keyword list, so Lord of Atlantis's grant named no keyword.
// 285: a Curse's enchanted player is an opponent (owner 2026-10-07): "whenever enchanted player casts"
// keeps its trigger as an opponent's, where any other Aura's still refuses as a narrowing (Maddening Hex).
// 286: #1079, a speed grant (haste, double strike) records its keywords in `grants`, as a keyword grant
// does, so Chocobo Knights' double strike stops reading "grants haste".
// 287: #1083, the synthesized opponent-graveyard recursion (Dauthi Voidwalker, Valgavoth) carries
// `intercepted`, so its reason stops saying the card is brought back from a graveyard it never reached.
// 288: #729, a card that USES a card from an opponent's graveyard (Gruesome Encore, Espers to Magicite,
// Flawless Forgery, Saruman, Kefka, Hedonist's Trove) derives graveyard-recursion over `opp` (owner
// ruling 2026-10-09); Uchuulon, which copies itself, stays hate.
// 289: #729, exile from THEIR graveyard after combat damage to a player is an opponent's graveyard
// (Soundwave, Froghemoth).
// 290: #1136, a token replacement says how it changes the tokens (`Effect.tokenMultiplier`): twice, thrice,
// additional (Xorn, Chatterfang), one-of-each (Academy Manufactor), replaced (Divine Visitation).
// 291: #1141, a doubling verb reads what is doubled from its OBJECT first (counters, damage, life), so a
// clause that merely mentions a token (Paradox Zone, Elvish Vatkeeper, Arna) is no token doubler, and
// "gains double strike" is a speed-increase (as on the grant path), not the verb double (Akim and 20 more).
// 292: #1088, "if you attacked this turn" cares about `attacks:creature` (CR 508.1a: only creatures attack), not
// `attacks:any`, which named the same event twice.
// 293: #1166, "if you descended this turn" cares about `dies:permanent` (CR 700.11: a permanent card), not `dies:any`.
// An untyped trigger subject now keys as the class its verb implies (`VERB_IMPLIED_CLASS`) at read time, so no
// stored tag for those verbs is `:any`.
// 294: #1169, a card's mana production is read once: `manaLines` (per face: source, cost, colours, amount, net,
// restriction, gate, timing) plus `staticFixer`, `landFetch`, `isOneShot`, `suspendOnly`. Additive; no consumer reads it yet.
// 295: #1169 review: scaling read from `action.amount`, fetches need a printed "search your library", `gate` for conditional
// lines, `cost.counters` / `cost.tapOther`, `unread`, `tap-ability` renamed `activated`.
// 296: #1169 review 2: number words are fixed amounts, "instead" / "as long as" / conditional-fetch gates, each-player fetches.
// 297: #1169 review 3: "if you do" is a cost not a gate, intervening-if and "instead add" gates, "for as long as" is no gate, one trigger add read once.
// 298: #1169 review 4: "Then if <cond>, <cost>. If you do, ..." gates on the condition and takes the cost after the comma.
// 299: #1169 task 2a review: anyColour `among` (colours among what you control / the exiled card's colours), "different colors" is any colour,
// exiling the card itself in a cost is `sacrificeSelf`.
// 300: #1169 task 2a review 2: `among` also covers "any of this creature's colors" and "a color of a permanent you control / a card in your graveyard";
// "Choose a color. Add ... of that color" is any colour; "circled colors" is chosen.
// 301: #1169 task 2a review 3: a colour chosen in the same clause ("{T}: Choose a color. Add one mana of that color") is any colour; a granted
// "this creature's colors" (Katilda) is `grantee`, no colour of the deck's.
// 302: #1169 task 2b-1: a `trigger` / `aura-trigger` mana line names the event that fires it (`ManaLine.trigger`, `triggerSubject`), so the goldfish can tell
// landfall and beginning-of-phase mana (priced) from a cast trigger (Birgi: ramp, not a dork) without reading oracle text. "N mana in any combination
// of {U}, {B}, and/or {R}" (Relic of Sauron) is an amount of N, not 1; an ability word's requirement ("Max speed — {T}: Add {C}{C}", Muraganda Raceway) gates the line.
// 303: #1169 task 2b-1 review: a mana grant made by a TRIGGERED parent is gated by that trigger ("when princess yue dies"), not standing: Princess Yue's
// Moon, Hydro-Man's end step, Song of Freyalise's chapter, Vraska the Silencer's returned Treasure (4 cards). "As long as", a Saga chapter with no
// duration (Urza's Saga) and a token a trigger creates are unchanged.
// 304: #1169 task 2b-1 review round 2: `ManaLine.startLoyalty` (a planeswalker's printed loyalty on each line that costs loyalty, so a consumer can tell
// "−1: Add {R}{R}" is playable the turn the walker is cast); an Aura's mana is dropped when the Aura is removal (enchants an opponent's permanent, or
// "loses all other card types": Honest Work, Imprisoned in the Moon) and a granted TRIGGER is no static-grant (Mark of Sakiko).
// 305: #1169 task 2b-1 review round 3: `startLoyalty` is read from the card document (Scryfall `loyalty`, carried by ingest) and not from a checked-in MTGJSON table
// (the same numbers, plus the six walkers the table lacked); an Aura whose text says the enchanted creature "can't attack or block" is removal and makes no
// static-grant line (Utopia Vow, owner 2026-10-13).
// 306: #1169 task 2b-2 follow-up: "Until end of turn, whenever a player taps an Island for mana, that player adds an additional {U}" (High Tide, Bubbling Muck) is a one-turn
// tap-bonus line (`untilEndOfTurn`, trigger `tapped-for-mana`), not a net-0 add; a spell whose tap trigger is not that shape banks no line; an add inside a token's quoted
// ability is not the spell's own (Eldrazi Confluence).
// 307: #1169 task 2b-2 fix round 2: the one-turn tap bonus is also read when the model filed its add under `effectActions` (which the canonical clause record drops): Pyre Rhymer //
// Molten Tide, "Until end of turn, whenever you tap a Mountain for mana, add an additional {R}" (owner 2026-10-13: High Tide-shape cards are ramp).
// 308: #1190 (owner 2026-10-13): a Lander token is a land-fetch token line; a Treasure in a choice of tokens, beside another token, in a clause the abilities mistyped, or made by "that attacking player"
// is a token-maker line; a token only an OPPONENT creates is none (Ingenious Mastery, Erestor of the Council); a land put onto the battlefield in a LATER clause (Caravan Vigil, Druid of the Emerald
// Grove, Omenpath Journey) is a fetch; Piracy's "tap lands you don't control for mana" is an unread one-shot line.
// 309: #1197 (owner 2026-10-14): a creation replacement that ADDS a Treasure to another token's creation is a token-maker line (Bilbo, Fellow Conspirator; Academy Manufactor); a pure Treasure doubler
// (Xorn, Jolene's second sentence) stays none.
// 310: #1191: ManaLine.gate is a typed ManaGate (control / same-name / tron / speed / initiative / unknown), parsed once by parseGate. New classes: "...or if you control a basic land" (Gleaming Bastion cycle) and "a creature with power N or greater" are control gates, no longer unknown.
// 311: #1193 / #1187: ONE reader of "how much mana it adds" (`production()` in mana-lines.ts): `ManaLine.amount` and `Ability.amount` of a mana add are one reading. A clause's own count is the amount of a lone
// alternative that states none ("{R}" + 6, Chandra Heart of Fire / The Flux; "mana of any one color" + 10, The Aetherspark), "seven {R}" is 7, a list joined by "and" is a sum (Terra), "N mana in any combination
// of {U}, {B}, and/or {R}" is N (Relic of Sauron, Orcish Lumberjack), a rider after a comma ("..., spendable only to ...", Shang-Chi) is no alternative, the model's symbols on `amount` are the mana (Valleymaker),
// a bare "mana" adds no amount (Piracy), and an ability's number word is a number (Cosmic Crucible "four" -> "4").
// 312: #1193 task 2 (Fable finding 5): ManaLine states what the matcher used to re-parse. `cost.loyalty` (signed, parsed once), `cost.consumes` (what the cost uses up: energy, discard, exile, return-to-hand, forage,
// collect-evidence, unknown; {Q} untap, exert and mill consume nothing, so Pili-Pala's {Q} line is no longer "paid"), `restriction.minManaValue`, and `trigger: {event, subject: SubjectFilter, text}` replacing `trigger` + `triggerSubject`.
// 313: #1210 grammar reads 14 underived cards (punctuated ability words, opening-hand reveals, energy costs, "as ~ enters or is
// turned face up", look-at-top, "who doesn't", "after you roll a die", phase-in, Pulse of Llanowar); bought cards take the new
// readings where the grammar now reads them (36 cards, each checked against oracle text); staticFixer gains `covers: "basics"`;
// "As this creature enters, … counters on it" is the card itself (10 bought cards gain `self`).
// 314: #1210 tasks 5-6: a stored record whose event has no printed cue in its own segment keeps its stored trigger (`misplaced` guard: Astrid Peth, Sidisi, Huntmaster of the Fells and others) and, when the sentence that carries the cue is no same-event record's, reads THAT sentence (Kratos) or is dropped as its twin; a
// back-reference after "look at the top ... of your library" is the looked-at card (fromZone library; 32 cards read complete again, 15 grammar-only), "if it's a X card" is its object (\"a X card from the top card of your library\": the mill emit is control you), Discover the Impossible
// puts from exile, and a spell returning itself leaves the stack (13 spells).
// 315: #1205 parseSubject stops dropping qualifiers the schema already carries: nonbasic (basic:false), nonlegendary (legendary:false), snow/nonsnow, tapped/untapped as an adjective before the noun (not "enters tapped"), multicolored/monocolored (colorCount).
// 316: #1215 the arrives-tapped suppression of a `taps` emit reads the clause's EFFECT only (effectText), never its trigger: "Whenever this creature enters or becomes tapped, tap up to one target creature" (Champions of the Shoal) lost its tap to the trigger's "enters ... tapped"; and a token CREATED tapped (or tapped and attacking: Mobilize) emits no taps for the companion `tap` on it (CR 603.2e).
// 317: #1188 mana lines state what a tap depends on: a "for each ..., add" / "add ... for each" amount SCALES (Selvala, Explorer Returned), an activated ability that targets is gated on a legal target (Deathrite Shaman,
// Red Death, Shipwrecker; CR 602.2b), and a colour taken from "a card in your graveyard" is gated on one (Corrupted Grafstone). The gates are `unknown` (unmet everywhere), so rampGrade and the colour audit drop them.
// 318: #1188 follow-up: a "for each" add keeps its printed fixed floor in `net` ("Add {R}{R}, then add {R} for each ...", Rite of Flame: net 1, not 0); `amount` is unchanged (fixed null, scales set).
// 319: #1188 whole-branch review: "for each color among permanents you control" on a permanent nets the card's OWN colours (Faeburrow Elder 2, Bloom Tender 1; the card is a permanent you control); a colour taken from "among ... cards in your graveyard" (The Grey Havens) is gated on a card there.
// 320: #1250 an emit of an action that happens on a delayed trigger ("Sacrifice it at the beginning of the next end step", Reflection of Kiki-Jiki; "return it at the beginning of the next end step") is not `instantSpeed`: no player can aim it at an attacker, so Fable -> Kardur (owner-judged FALSE) no longer forms.
// 321: #1250 review: the delayed-action guard covers an instant/flash spell's emits too ("Sacrifice it at the beginning of the next end step" on a reanimation instant), not only activated abilities.
// 322: #1250 task 2 -- a self `dies` trigger with "if it was a creature" (the Enduring cycle, Harold and Bob, Tom Bert and William) is read, not refused: its triggerless recursion read "return it" as ANY graveyard card (Smoke Bomb -> Enduring Curiosity, owner-judged FALSE).
// 323: #1250 review -- WAS_A_CREATURE is admitted only on a card whose type line includes Creature; Weatherseed Totem (an animated Artifact) keeps its refusal, its intervening if is not vacuous (it formed dies:artifact with Krark-Clan Ironworks and Deadly Dispute).
// 324: #1250 task 3 -- "from that player's graveyard" in a combat-damage trigger whose damager is yours (or "to an opponent") is an OPPONENT's graveyard, on the recursion subject and its cast/leaves emits (Tinybones, Ink-Eyes, Scion of Darkness, Zareth San, Skullsnatcher, Zombie Cannibal, Wrexial, Whispersteel Dagger, Deluxe Dragster, Shark Shredder, Fire Nation Salvagers); it read `any` and so matched a graveyard filler of your own (Lively Dirge -> Tinybones).
// 325: #1250 task 3 review -- only the `leaves` emit of that graveyard recursion is an opponent's; the cast and enters emits keep their reading (you cast it, it enters under your control).
// 326: #1250 task 5 -- "if you didn't cast it from your hand" on an enters trigger is the entry's HOW (`notCast`), no longer dropped silently: Chainer, Nightmare Adept was fed by every creature cast from hand (Braids, owner-judged FALSE); Phage the Untouchable's self trigger carries it too.
// 327: #1250 branch review -- "at end of combat" is no longer a delayed action: the creature is still attacking (CR 511.2/511.3), so Goblin Sappers' destroy keeps instantSpeed and feeds Kardur's attacking-creature death.
// 329: #1253 owner ruling -- triggerRefused only when the refused trigger's object is class-less or the refusal is an `if:` (a timing/count refusal keeps the exact class and the claim); the damager of a refused "deals damage to you" is an opponent's.
// 328: #1253 an ability of a REFUSED trigger that points back at the trigger object (`ref: "trigger"` in its emits or effect, no `trigger`) is `triggerRefused`: it keeps its kind and the matcher claims nothing from it ("return it" was any card); where the refused trigger is about THIS card ("this creature blocks"), "it" is the card itself (`self`) and nothing is withdrawn.
// 330: #1253 the stored trigger subject of "a spell or ability an opponent controls causes X to ..." is X, not the cause plus half the event: Sacred Ground's land is YOURS (its return read `control: opp`).
// 331: #1253 review -- a refused trigger's class is copied onto a keyword grant's ref'd subject ("it gains X" over "a creature you control attacks alone" is a creature you control); an `if:` flags only when it tests the object; "them" after a cast/draw/discard trigger is the player, and "put it" under "if this card is exiled" is the card (Scytheclaw Raptor, Adrenaline Jockey, Senu); a recursion of the trigger's own object takes its class (Sacred Ground); "in your graveyard" is yours (Victimize); an inherited "It gains" bullet reads the header's object.
// 332: #1253 final review -- a grant's class is copied only when the trigger subject precedes the event (Hedron Blade's blockers are not "it"); "in your graveyard" is read off the action's object first (Neyam Shai Murad's "their graveyard" is not yours); Sacred Ground's recursion is of a card put into the graveyard FROM THE BATTLEFIELD; Senu's flicker effect is self.
// 333: #1252 "that player loses the game" after damage to a player/opponent is the DAMAGED player, an opponent (Phage the Untouchable, Vorpal Sword, Atemsis): the grammar dropped the actor so the loss read `you`; damage of any kind "to an opponent" now counts for the damaged-player reading.
// 334: #1263 "that player <verb>" after combat damage to a player dealt by the card itself, its equipped creature or a creature you control is the DAMAGED player, an opponent, for every cued verb (Chilling Apparition discard, Quietus Spike lose-life, Anowon mill, the poison and exile givers), not only lose-game and the graveyard owner; "a creature deals ..." stays `any`.
// 335: #1264 one stored `claimsNothing` field replaces `triggerRefused: true` ("refused-trigger") and adds "self-loss" (#1252: every emit is `loses-game` of `control: you`), read after the last control fill; the matcher no longer recomputes it. No reading changes.
// 336: #1265 a mana add's `Ability.amount` is ONLY `production()`'s reading: a scaling add (Faeburrow Elder, Bloom Tender, Charmed Pendant, Selvala) keeps its scaling text, never the clause's per-unit "1" that readers took for the whole amount; the token-maker mana lines' unread amounts are read.
// 337: #1265 task 1 (owner ruling 2026-10-17): a scaling mana add carries an INTERVAL, never a fake fixed 1 and never nothing -- `ManaLine.amount` gains `floor` / `ceiling` / `bound` (colours among permanents: the card's own colours up to 5; the printed fixed part; the card's own contribution to its count), and `Ability.count` of that add IS the interval (it was computed from the stale amount before the stamp). A fixed sibling add keeps its number (Rite of Flame's {R}{R}, a Battery's first {W}). One case for the scale text (lowercase, as the line keeps it). A text that adds no mana ("pay {X}", energy) is neither stamped nor given an interval.
// 338: #1265 task 1 review -- a prototype card's "this creature's power" floor is the smaller power (Cradle Clearcutter: printed 3/6, Prototype 1/3, floor 1 not 3). Recorded from 337: "Add X mana" read as a bare X on the model path gives `effect.scaling: "x-cost"` to 16 mana abilities (Arbor Adherent, Klauth, Metamorphosis, Doc Samson, Food Chain, Helga, Haruspex, Accomplished Alchemist, Dreadship Reef, Redshift, Crucible of the Spirit Dragon, Mona Lisa, Calciform Pools, Vivi Ornitier, Plasm Capture, Woodland Weavemaster) -- parity with the grammar path, which already said it. CEILING: the label means an X the player chose as a cost, and it is knowingly loose where X is defined by the card (Doc Samson's X is its power, Metamorphosis's a sacrificed creature's mana value); the grammar path said the same before.
// 339: #1265 a scaling mana add counting PLAYERS has a ceiling: the table is you plus three opponents (`table.ts`, owner speed ruling 2026-10-06), each making the mana the add prints -- Selvala, Explorer Returned 4, Belbe 6 (`bound: "players"`).
// 340: #1267 (owner 2026-10-17) three mana-gate kinds become estimable from the decklist instead of `unknown`: `threshold` (N cards in your graveyard, typed by card type or subtype), `counter` (counters on the card itself, with where they come from: its own ability `readyTurn`, the opening hand, or the deck) and `turn-event` (opponent lost life / entered / creature died / permanent left / attacked / land played this turn). Parsed by wording in `parseGate`; every other gate stays `unknown` (unmet). CEILING: The Grey Havens' stored gate is "there is a card in your graveyard" (its real condition is a legendary creature card); the estimate counts any card.
// 341: #1267 review -- an over-claim fix. A graveyard gate KEEPS its qualifier (The Grey Havens: "there is a legendary creature card in your graveyard", `ManaGate.threshold.supertypes`); a counter gate's `put` also reads the keyword actions that put +1/+1 counters on the card (Adapt, Monstrosity, Outlast; Incubation Druid's Adapt is ready when {3}{G}{G} can be paid, turn 5); the matcher no longer counts the deck's supply of counters.
// 342: #1267 review 2 -- a counter gate's `put` is priced by the cost of the put itself and never by a trigger: Pyramid of the Pantheon (`{2}, {T}` per brick) is ready turn 5, not 4; Charitable Levy's put is a TRIGGER on every noncreature spell and has none (unmet); Outlast is one counter per {T} activation; Evolve needs a larger creature to enter and has none (`selfPutReady`).
// 343: #1267 review 3 -- "add three mana of that type instead" (Incubation Druid) reads the type from the sentence before it ("any type that a land you control could produce"): the gated line is no longer `unread`, so the goldfish can play it by the turn.
// 344: #1267 review 4 -- Adapt and Monstrosity put their counters when the activation RESOLVES, so a `put` from them is ready the turn AFTER the cost is paid (first + 1): Incubation Druid readyTurn 5 -> 6. A counter gate's readyTurn is relative to an on-curve cast; the goldfish counts it from the permanent's own cast turn.
// 345: #1279 (owner ruling 2026-10-20) a counter gate's self `put` carries `activation` {mana, refund, taps, activations}: what ONE activation of the put costs, the mana it adds back, whether it taps, and how many reach `need` (Druid 5/0/no/1, Pyramid 2/1/tap/3, Tablet 0/0/tap/2), so the goldfish can pay for the gate. `readyTurn` is unchanged.
// 346: #1282 the mana-token lists are ONE table (`token-kinds.ts`, `line` + `manaToken`): Vibranium (CR 111.10w, Powerstone's line) and Heartwood (CR 111.10x, {R} or {G}) makers now carry a token-maker mana line, and a creation replacement that adds either is a maker; quality.ts ramp ingredients read the same table (Eldrazi Spawn/Scion included).
// 347: #1285 + #1291 the scaling floor reads the card's own contribution ("for each X on the battlefield", "your devotion to <colour>" from its own mana cost, "<name>'s toughness", "creature with power N or greater", "different power"), and a fetch of "a X card and a Y card" counts two lands (Krosan Verge).
// 348: #1295 removal-shaped emits read the SENTENCE: an edict ("target player sacrifices") marks `SubjectFilter.edict` and no target scope; "its controller may sacrifice it" / "unless that player sacrifices it" marks `GameEvent.victimMay`; "you own" is `owner: you` (control you), not an opponent's; a possessive in a condition ("since your last turn ended", "your life total") or "attacking you" / "crewed it" no longer sets the target's control; "its controller sacrifices it" after "target creature you control" is yours; a cleave spell reads with its bracketed words removed (CR 702.148).
// 349: #1295 item 3 -- a return paired with an "until this leaves the battlefield" exile is `delayedUntil: "source-leaves"` (Constable of the Realm, Mysterious Limousine), and a return on one "If ..." branch is `returnIf` (Unyielding Gatekeeper, Vindictive Triumph): neither is an immediate blink for `notFlickered`.
// 350: #1295 two anaphors resolved to the wrong object. "destroy THAT CREATURE" after a targeted "Target creature gets -3/-0" inherits the antecedent's target scope (Depressurize was lost to `removal.targeted`); a token that is a copy ("Create two tokens that are copies of target permanent an opponent controls", Venser, Fervent Forger) takes its creator's control and no target scope, not the original's (CR 111.2), and "sacrifice them" is those tokens.
// 351: #1295 item 3 review -- a return's "If <anyone> do/does/don't/doesn't" is a cost confirmation, never `returnIf` (Meathook Massacre II's "If they don't, return that card").
// 352: #1295 item 4 -- two grammar-complete removal spells derived NOTHING: "Put target nonland permanent into its owner's library third from the top" (Teferi, Hero of Dominaria -3; also Oust, Spin into Myth, Terminus) is a `leaves` off the battlefield, and "Return target nonland permanent or suspended card to its owner's hand" (Venser's Diffusion) is a bounce of the permanent half.
// 353: #1295 review of the anaphor scope: "that card" taken from a library or hand (Transmogrify, Polymorph) is not the exiled target; a player or token antecedent scopes nothing.
// 354: #1295 item 5 -- an action on one side of a coin flip ("If you win the flip, ...", "If you lose the flip, ...", "If it comes up heads, ...") is `onFlip`, so Orcish Captain's losing-side -0/-2 on your own Orc is not `removal.targeted`.
// 355: #1295 item 4 review -- the `leaves` emit of a put into a library (a tuck) carries `tuck: true`, so the quality ladder (exile > destroy > bounce > tuck) scores Condemn, Oust, Teferi -3 below a bounce.
// 356: #1295 item 5 review -- an onFlip action takes the k-th sentence carrying its verb's printed word, not the first sentence holding its amount (Winter Sky's draw is the lose side, Bangchuckers' two "2 damage" are opposite sides, Chaotic Strike's unconditional draw is unmarked).
// 357: #1295 item 4 review -- "the owner of <target> puts it on their choice of the top or bottom of their library" tucks THAT target (the grammar named no object, so the record writer read "it" as the trigger's subject: Plan for All Outcomes derived a false self tuck of "this enchantment").
// 358: #1299 task 2 -- `CardTags.unclaimed` is persisted (every action no rule claimed, with its clause id), as `unknownTriggers` is. No ability changes.
// 359: #1301 -- a `put` that is another effect's destination is claimed: `Ability.toZone` on the search it follows ("put it into your hand / onto the battlefield") and on the counter-spell it follows ("put it on top of its owner's library"); a dig's "put the rest on the bottom" is claimed as the remainder. No emit changes.
// 360: #1301 review -- `toZone` is also set from a put that derives its own `enters` (Rampant Growth, Farseek); "one" counts as the searched card; the zone-tail strip is linear. No claim changes.
// 361: #1266 -- `Ability.librarySearch` ("yours" | "other") on a `search` ability read off a printed search action naming a library; a typed dig carries none; a stored search of a bare library takes the card of the put after it (Tempt with Discovery's third search gets type land, its one claim change). No emit changes.
// 362: #1266 -- a new effect kind `retarget` (CR 115.7), read off an action whose object changes the target of / chooses new targets for a TARGET spell or ability (Misdirection, Redirect, Bolt Bend, Willbender, Reroute, Deflecting Swat, Divert; the model's `other`, and its `cost-modify` / `exchange` misfiles read from the clause: Shunt, Silver Wyvern, Spellskite, Meddle). Subject: `scope: "target"`, `type: "spell"` and/or `abilityKind`. Those actions leave `unclaimed`. Your own copy's new targets ("choose new targets for the copy", #491) and "that spell" stay unclaimed. Also (#1266 task 2): a spell moved, returned, exiled or taken is an emit with `fromZone: "stack"` (the grammar no longer calls a returned spell a battlefield leave; "target spell or permanent" is two emits, the spell and the permanent half), a noncreature spell is `type: spell` + `notType`, and "that spell" / "the chosen spell" is `scope: target` only when the ability earlier says "target ... spell" (Swallowed by Leviathan, Invert Polarity, Mages' Contest).
// 363: #1266 (graveyardHate) -- an `exiled` emit from a graveyard says whose graveyard it is: `owner: "you"` when the printed words make it yours ("exile that card from your graveyard": Necropotence, Bag of Holding, Toluz, Moonstone, Leonardo da Vinci; a discard by you; a card "put into your graveyard", Purgatory, Colfenor's Urn, Grolnok; a cost exiling "another card from your graveyard", Helbrute, Squee; each player's OWN graveyard with the cards coming back, Living Death, Living End, Scrap Mastery). Another player's, or any graveyard, stays unmarked. An exile whose object names only graveyards ("target cards from graveyards", "from a single graveyard", "all graveyards", "that player's graveyard", "from defending player's graveyard") takes `fromZone: graveyard` when the model stored none (Erebos's Intervention, Blue Mage's Cane, Hive of the Eye Tyrant, Nurgle's Conscription, Abstergo Entertainment, Burn Away, Strategic Betrayal, Crabomination). "That player's graveyard" after a card taken "from an opponent's graveyard" is `opp` (Nurgle's Conscription). Replacement effects ("would be put into a graveyard ... exile it instead") and the cast-from-graveyard riders are left to #1306 (a rider's pronoun exile takes no owner and no new zone).
// 364: #1266 -- (review of 363) a graveyard-only exile zoning refuses "the battlefield or" and a self-exile list ("this artifact and all cards from all graveyards") on the MODEL path; the grammar path still zones Savior of Ollenbock and Silent Gravestone to the graveyard (grammarClauseRecords sets fromZone first): follow-up issue #1309. The rider guard covers "a spell cast from your graveyard this way" (Gale). (task 2) "If <X> would be put into a graveyard, exile it instead" is ONE shape per kind: an opponent's or any graveyard "from anywhere" (Leyline of the Void, Rest in Peace, Dryad Militant, Valgavoth, Sanctifier en-Vec) is a graveyard-hate exile whose effect subject and emits say `opp` or `any`; your own graveyard (Magus of the Will, Walk-In Closet) is no hate and no owner; a SPELL rider ("If that spell / a spell cast this way would be put into a graveyard": Kess, Chandra, Mavinda, ...) exiles the spell FROM THE STACK (CR 614), #1306. Graveyard cards typed `spell` by a possessive (Grip of Amnesia, Bloodbond March) are typed as cards.
// 365: #1266 review of 364 -- a graveyard-hate REPLACEMENT (Leyline of the Void, Rest in Peace, Sanctifier en-Vec, Anafenza, Dauthi Voidwalker, Valgavoth) emits `exiled` with no graveyard origin and NO `leaves` (CR 614.6: the replaced event never happens, so no "leaves your graveyard" payoff is fed; the graveyard-hate effect and its subject control are kept); a card's own NAMED exile ("Exile Sins of the Past", Invoke Calamity) is never taken for the spell rider; only "exile it / that card / them ... instead" is an exile replacement (Yawgmoth's Testament is not). Bloodbond March's returned cards are typed `creature` (the cast creature spell's type), so an artifact-creature ETB payoff is a safe under-claim. CEILING in graveyard-replacement.ts: Samurai of the Pale Curtain (permanents only, no "from anywhere") is left unread.
// 366: #1266 task 3 -- the card a trigger exiles from a graveyard (`ref: trigger`) is in the graveyard of whoever the trigger names: a trigger of yours or the card's own ("Whenever a creature you control dies, exile it": Promise of Tomorrow, Cyclopean Mummy, Eater of Virtue, Bag of Devouring, the Rectors) is `owner: you`, an opponent's (Mari, Patron of the Vein) or an any-player one (Planar Void, Mimic Vat, Koh) is not. And "any player may exile" / "each player may exile" a card from their graveyard (Carrion Rats, Carrion Wurm, Grave Consequences) marks the exile `victimMay` like "unless that player exiles" (Axebane Ferox) and "its controller may exile" (Lost in Thought). A graveyard-hate effect whose emits are all yours carries `owner: you` too (Nightmare Shepherd, Brenard), and "your hand or graveyard" (Mairsil) is your graveyard, so it is no graveyard-hate.
// 367: #1266 (burn) -- WHO A DAMAGE OR LIFE LOSS HITS reads off the printed recipient, on the effect subject AND the emits. A recipient that LISTS a player beside a permanent kept only the permanent: "each opponent and each creature they control" (Wildfire Cerberus), "... each planeswalker they control" (Kumano Faces Kakkazan), "target player and each creature that player controls" (Chandra's Flame Wave), "that permanent or player" (Erratic Explosion) and the EMIT of "target player or planeswalker" (Lava Spike: typed planeswalker, the player dropped; the effect already read it through the filter grammar). The effect keeps an `anyOf` with a player branch; the emits are one event per half (the matcher's `damaged` test reads a victim's top-level type, so one `anyOf` event would meet neither side). "X's controller" / "its owner" / "enchanted player" / "they" is the PLAYER, untyped, never X's type nor `you` (Repercussion, Banewasp Affliction, Curse of Leeches; a lose-life emit read `you` there and fed "whenever you lose life"). "that player" after an opponent's spell or the card's own damage is `opp`, not the trigger's `you` (Thunderbreak Regent, Megrim, Underworld Dreams). "any target that isn't a Dragon" is any target. A damage's "it" is the object the trigger names, as its emit already read it (Caltrops: effect subject creature, was untyped). A life total SET (CR 119.5: "your life total becomes 1", "each player's life total becomes the highest"; The Golden Throne, Arbiter of Knollridge, 17 clauses) is neither damage nor life loss: no kind. 465 cards' abilities changed (337 gained a player-shaped untyped half or took the controller as the player, 49 "that player" -> `opp`, 22 life loss `you` -> `any`, 45 effect only). Census over 3,869 damage / life-loss clauses (printed recipient class against the stored subject, clause level): 833 disagreements -> 286, the rest classifier artifacts, model-labelled `static` clauses (Duggan, Herald of Hadar: no subject kept by the static guard) and Braids's Frightful Return ("If they don't, they lose 3 life" reads `you`).
// 368: #1266 (wincon) -- "you win the game" is the clause VERB `win-game` (Epic Struggle, Thassa's Oracle, Laboratory Maniac, Coalition Victory, Mortal Combat ...) and only the `other` escape hatch ever reached the `win-game` effect kind (CR 104.2b: an effect may state that a player wins the game): 1 corpus card derived it, now 39 of the 40 that print it (residue: see the commit); "can't win/lose" is the verb `cant` and derives none. And "exiles the top N cards of their library" is not a MILL (CR 701.17a: top cards into the GRAVEYARD): a `mill` action whose own sentence says exile and never says mill or graveyard is dropped where the clause already exiles from the library (Lidless Gaze, Plargg and Nassari) and rewritten to an exile from the library otherwise (Sire of Stagnation, Ulamog, Black Widow, Possibility Storm, and the own-library impulse cards Reckless Impulse, Seize Opportunity, Embrace the Unknown, Inspired Tinkering, Opera Love Song, Crossover Collaboration, Heroes' Hangout, Ecstatic Beauty, Atsushi, Lady Loki, Bre of Clan Stoutarm, The Infamous Cruelclaw, Chandra, Heart of Fire, which fed "enters your graveyard" payoffs as self-mill). Side effect of the card-by-card grammar switch: Halo Fountain, Bre of Clan Stoutarm and 7 impulse cards now derive from the grammar.
// 369: #1315 -- a new effect kind `evasion` (CR 509.1b), read off `cant | be blocked ...` (Aqueous Form, Cloak of Mists, Invisibility, Seeker, Kithkin Armor, Field of Reality, Canopy Cover; "this creature can't be blocked", "... this turn", "... as long as ..."). Subject: whoever cannot be blocked (`self` for "this creature"; a static keeps one only through `namesItsTargets`, so an Aura's "enchanted creature" stays unnamed). The model's `cant | not be blocked ...` / `be blocked by fewer than ...` is "MUST be blocked" (Gorm, The Foretold Soldier, Frodo Baggins): a drawback, not read. "Can't block" is not read; Awesome Presence's payable stays `tax`. A fact kind (edges.ts FACT_KINDS): no edge moves. Measured: 520 commander-legal cards derive an evasion (0 before); `unclaimed` 6604 -> 6067 entries, cards with any 5803 -> 5331. 15 cards matching "can't be blocked" derive none (12 token/granted quotes made by create or grant-ability, Awesome Presence's tax, Kang Dynasty, Jasmine Boreal of the Seven).
// 370: #1315 -- `Ability.host`: the effect applies to the permanent the card is attached to (an Aura's "enchanted creature / permanent", CR 303.4; an Equipment's "equipped creature", CR 301.5), set on pump, debuff, keyword-grant, speed-increase, type-grant, ability-loss, animate and evasion when the printed recipient is the host (derive/host.ts): the object ("enchanted creature +2/+0"), the clause head for a bare-object grant ("Enchanted creature has double strike"), a condition ahead of it ("During your turn, equipped creature has ..."), and "it" in a clause that opens on the host ("As long as enchanted creature is black, it gets ...", the "Otherwise, it gets -3/-3" half of Clutch of Undeath). Not another class on the card (Inner Demon's board -2/-2, Vampirism's other creatures, the Magemarks' creatures that are enchanted, "enchanted creature's controller", "enchanted player", "enchanted creatures you control"). A MARKER, not `effect.subject.status`: a static with a subject forms `static:<kind>` tags and whole-deck edges, so `effect.subject` is untouched and no edge code reads `host`. Measured over the 31,998 commander-legal cards: 1,437 cards / 2,208 abilities carry it (Aura 829 cards / 1,238 abilities; Equipment 555 / 885; other 53 / 85, the bestow, Licid, reconfigure and equipment-creature cards), and with `host` stripped every stored 369 row re-derives byte-identical (32,006 same, 2 not: Plan for All Outcomes and Overwrite the Multiverse, whose empower rows differ at 369 too). 59 Auras / Equipment print "enchanted|equipped X gets|has|gains|loses|can't ..." and derive no host ability: the commonest cause is a regex hit that is not a recipient (a player gains or loses life off the host's trigger, 21); a trigger's "it" (Thunderous Might, Razorfield Ripper, Reaper's Talisman, Writ of Passage, Wand of Orcus, Cocoon) is left unmarked; the rest derive no host-kind effect at all (Venarian Gold, Aettir and Priwen, Belt of Giant Strength, Mammoth Harness's "loses flying", Blossombind, Lithoform Blight) or are another class (Goblin Caves, the Magemarks).
// 371: #1315 -- `Ability.host` also reads "it" after a TRIGGER on the host ("Whenever enchanted creature attacks, it gets +X/+0": Thunderous Might; "Whenever equipped creature attacks, it gains deathtouch": Reaper's Talisman; "..., if its power is 2 or less, it can't be blocked": Writ of Passage, two heads stripped). Not "this creature or equipped creature" (Razorfield Ripper) and not a list ("equipped creature and Zombies you control", Wand of Orcus). Measured: 1,442 cards / 2,216 abilities carry host (Aura 831 / 1,242, Equipment 557 / 889, other 53 / 85; 370 read 1,437 / 2,208), residue 59 -> 56; with host stripped the 369 rows are still identical (32,006; the same 2 differ). The unread shapes are now CEILING comments in derive/host.ts.
// 372: #1315 review -- `Ability.host` no longer marks: a plural head or "... you control" (Kor Blademaster's "Equipped Warriors you control have double strike"); a grant whose clause hands it to another class (Gemcutter Buccaneer's Treasures, quoting "Equipped creature gets +2/+0"); a LOSS filed as a grant (Earthbind's "Enchanted creature loses flying", Observed Stasis's "loses all abilities": still derived as keyword-grant, the kind is wrong, the mark is withheld). `Ability.host` documents that it carries no polarity. Measured: 1,437 cards / 2,209 abilities carry host (Aura 829 / 1,237, Equipment 557 / 889, other 51 / 83; 371 read 1,442 / 2,216), residue 56 -> 58 (Earthbind, Observed Stasis); identity with host stripped unchanged (32,006; the same 2 differ).
// 373: #1315 -- (1) `Ability.grantedBy`: the id of the clause that grants a quoted ability, on every ability derived from a `granted` clause (segment()'s `parentId`, `DeriveInput.clauseGrants`; both clause sources): Sunbond's counter trigger (clause 3) names clause 2, Dragon Mantle's pump 3, Pendrell Flux's sacrifice, Splinter Twin's token copy. Additive, read by no edge code. (2) a new effect kind `restriction` (CR 508.1c, 509.1b) with `Ability.restricts` ("attack" | "block"), read off `cant | attack or block` / `attack` / `block` (+ "this turn", "until your next turn", or the subject kept in the object: Mishra's Domination's "Otherwise, it can't block"): Pacifism, Arrest, Utopia Vow, Pillory of the Sleepless, Compulsory Rest, Bedlam, Moat, Gravecrawler. A FACT kind (edges.ts FACT_KINDS, impact 0.2): the pair channels read it blank. `host.ts` HOST_KINDS lists it, so a host's "can't attack or block" is `host`. Not read: "can't be blocked" (evasion), "can't attack you" (Propaganda's tax, Vow of Flight), requirements ("attacks each combat if able"), narrowed blocks ("block creatures without flying"), "alone", "unless" conditions (CEILING in effect-kind.ts). Measured: 759 abilities / 594 cards carry grantedBy; of 157 commander-legal Auras with a host keyword-grant of empty `grants`, 138 have a grantedBy child of that clause and 19 none; 367 commander-legal cards (376 abilities) derive a restriction (0 before): attack+block 68, block 269, attack 39, 71 on the host (69 commander-legal cards); unclaimed 6118 -> 5730 actions, 5378 -> 5036 cards; with the new fields and restriction abilities stripped every stored 372 row re-derives identical (32,006; the same 2 differ).
// 374: #1315 review of 373 -- `restriction` refuses a CONDITIONAL "can't attack|block": a trailing condition (unless / if / as long as / only / alone / except / while) and a leading one in the same sentence ("As long as seven or more cards are in your graveyard, this creature gets +2/+2 and can't block": Childhood Horror; "If you control a creature with power 4 or greater, creatures can't block this turn": Barrage of Boulders; Aragorn, King of Gondor's monarch sentence); an "Otherwise, it can't block" sentence is kept (Mishra's Domination, Bonds of Faith: the either-or Aura's other half), and a trigger head alone is not a condition. When the model stores the same `cant` object twice, the n-th stored action reads the n-th printed "can't ..." (Aragorn's two identical abilities, the second with the first's `scope: target` subject, become one). The 373 `opensOnHost` change is part of this line too: a pronoun recipient after "As long as you control enchanted creature, it gets +2/+2. Otherwise, it can't block." (Mishra's Domination) is the host. Quality counts no `restriction` as extra value (quality.ts) and the partner page reads it as no relation (partners-core.ts kindNotARelation). Measured: restriction 367 cards / 376 abilities -> 333 / 338 (the 34 cards' 38 conditional abilities refused; commander-legal Auras/Equipment with a host restriction 69 -> 68, Clawing Torment, whose debuff stays host); unclaimed 5730 -> 5768 actions. CEILING: a same-sentence leading "As long as enchanted creature is red, it gets +1/+1 and can't block" on an Aura is refused too.
// 375: #1318 -- a `gain-control` action derives a `gains-control` emit only when its PRINTED clause states a control change (`printsControlChange`, emits.ts: gain(s)/take(s)/exchange control, "under <someone>'s control", "controls enchanted/equipped/target ...", "controls your opponents" / "the second player", CR 723.1); the model had filed other sentences as `gain-control`, and the action now goes to `unclaimed`. Crown of Awe ("gain protection from black and from red") loses the phantom steal and regains `wincon:voltron`. Measured: gains-control emit events 395 -> 390, abilities with one 382 -> 377 clauses, cards 372 -> 367 (Berserker's Frenzy, Crown of Awe, Fabrication Module, Gollum Scheming Guide, Misleading Signpost; research/tagger/gains-control-census.ts); unclaimed 5773 -> 5777 actions, 5069 -> 5072 cards; role-ratchet gained 1 (Crown of Awe +wincon:voltron), lost 0; event-match diff for gains-control: 34 pairs -> 34, 0 new, 0 lost. Kept: Opposition Agent and Cruel Entertainment (a player controlled, CR 723.1). (The guard reads the whole clause, not the action's own sentence: see emits.ts.)
// 376: #1321 -- the printed-verb guard (derive/verb-words.ts, `verbPrint`) is on for `add-mana`: an add-mana action whose clause AND whole card never print "add" or mana (Evereth, Caustic Exhale, Dutiful Replicator, Hurska Sweet-Tooth, Wildborn Preserver, Bogslither's Embrace, Go-Shintai of Boundless Vigor, Labyrinth Adversary: "you may pay {1}" read as a mana producer; Roil Cartographer, Peema Trailblazer, Scurry of Gremlins, Blaster Hulk: an energy or payment the energy test does not recognise) goes to `unclaimed`. An energy add-mana ({E}, 63 actions) is exempt: derive already reads it as the `counter-added` energy emit (CR 107.14). Measured: 12 actions dropped, 8 kept as clause mix-ups; unclaimed 5736 -> 5748 actions, 5034 -> 5046 cards; mana-generation abilities 2449 -> 2437; emits unchanged; counter-added pairs 163976 -> 163976, 0 new, 0 lost; role-ratchet gained 0, lost 0; panel PRECISION 100.0%, RETENTION 98.4% (428 held, 7 lost, ratchet ok); theme-stats unchanged.
// 377: #1321 -- the printed-verb guard is on for `goad` (CR 701.15, Goad): a goad action whose clause and whole card never print "goad" goes to `unclaimed`. The model filed "attacks this turn if able" / "blocks this turn if able" under it (Dulcet Sirens, Incite War, Instigator, Maddening Imp, Siren's Call, Heckling Fiends, Rage Nimbus, Shipwreck Singer, Imaginary Threats, Gideon Jura, Nahiri the Unforgiving, Ravener, Trench Behemoth, Kookus, Howlsquad Heavy, Aggravate, Berserker's Frenzy): a forced attack is a combat requirement, not a goad, which also makes the creature attack a player other than the goader. Measured: 17 actions dropped, 0 clause mix-ups; goad emits 99 -> 82; unclaimed 5748 -> 5765 actions, 5046 -> 5059 cards; goad has no consumer so event-match pairs 0 -> 0; role-ratchet gained 0, lost 0; panel PRECISION 100.0%, RETENTION 98.4% (7 lost, ratchet ok).
// 378: #1321 -- the printed-verb guard is on for `shuffle`, `scry`, `mill` and `search` (library operations): the model filed a DIG ("look at the top N cards ... put the rest on the bottom of your library in a random order") under scry (Basic Conjuration, Board the Weatherlight, Commune with Beavers, Storm the Festival, Zimone's Experiment, Water Tribe Rallier, Wilfred Mott, Devourer of Destiny, Nahiri's Warcrafting) and under shuffle (the same text, Planar Genesis, Torsten, Adewale, Animist's Awakening, United Battlefront, Elvish Rejuvenator, Michelangelo's Technique, Arcane Infusion, The Mana Rig, Break Out, Search for Survivors); a dig is neither a scry (CR 701.22) nor a shuffle (CR 701.24), and "whenever you scry" / "whenever a player shuffles" payoffs joined them. The action goes to `unclaimed` and stays in the clause's action list so a later "those cards" keeps its antecedent (Nahiri's Warcrafting). Measured: emits shuffle 1234 -> 1220, scry 449 -> 440, mill 820 -> 819, search 1019 -> 1018; unclaimed 5765 -> 5787 actions, 5059 -> 5074 cards (six dig cards now equal their grammar reading and switch to it); event-match pairs shuffle 274 -> 262 (12 lost: six dig cards x Cosi's Trickster, Psychic Surgery), scry 8160 -> 7989 (171 lost: nine dig cards x 19 scry payoffs), mill 483 -> 483, search 456 -> 456, exiled 17050 -> 17050; 0 new; role-ratchet gained 0, lost 0; panel PRECISION 100.0%, RETENTION 98.4% (7 lost, ratchet ok); theme-stats: scry:any 445 -> 436, shuffle:any 1163 -> 1149, mill:any 745 -> 744, static:scry 9 -> 7, search:assassin 1 -> 0.
// 379: #1321 -- the printed-verb guard is on for `trigger-again`, `gain-life`, `add-counter` and `remove-counter`. trigger-again: "repeat this process" (13 actions: Sphinx's Tutelage, Grist, Demonlord Belzenlok, Cultivator Colossus, Insatiable Frugivore, Primal Surge, Crooked Scales, Tyrant of Discord, Zimone and Dina, Hoarder's Greed, Grindstone, Countryside Crusher, Scalpelexis) is a loop, not a second trigger (Panharmonicon-style doubling). gain-life: "you get {E}" is energy, not life (7: Aether Hub, Conversion Apparatus, HELIOS One, Brotherhood Scribe, Wrath of the Skies, Solar Transformer, Deadlock Trap). add-counter: "gains toxic 1" (Skrelv), "has vanishing 3" (Flesh Duplicate: its reminder DOES state "enters with three time counters", so this is a true counter placement dropped), "You get {TK}" (Blorbian Buddy: a ticket counter, also a true placement dropped). CEILING: both are true counter placements left unread, because the card text the guard and the table see has its reminder stripped and the table has no {tk} word; dropping them loses fewer true facts than the old emits carried wrong ones (an "energy" counter on a ticket, a conditional keyword). remove-counter: "no longer suspected" (Airtight Alibi); a paid {E} stays (CR 107.14: paying energy removes the counters). The verb-words matcher also accepts a keyword line whose reminder sits on the card's raw line (Awaken puts the +1/+1 counters: Coastal Discovery, Sheer Drop, Rush of Ice, Ondu Rising keep theirs) and no longer needs a word-start in front of "{E}"/"+1/+1". Measured: emits gain-life 1837 -> 1830, counter-added 4591 -> 4588, counter-removed 639 -> 638; trigger-doubling abilities 54 -> 41; unclaimed 5787 -> 5810 actions, 5074 -> 5091 cards; event-match pairs gain-life 182248 -> 181618 (630 lost: seven energy cards x 90 lifegain payoffs), counter-added 163976 -> 163810 (166 lost: Flesh Duplicate, Skrelv, Blorbian Buddy), counter-removed 193 -> 190 (3 lost: Airtight Alibi), 0 new; role-ratchet gained 0, lost 0; panel PRECISION 100.0%, RETENTION 98.4% (7 lost, ratchet ok); theme-stats: gain-life:any 1777 -> 1770, counter-added:any 2703 -> 2700, counter-removed:any 491 -> 490, static:counter-placement 146 -> 145, static:keyword-grant 2101 -> 2102.
// 380: #1321 -- the printed-verb guard is on for `transform`, `prevent`, `return`, `roll-dice`, `vote` and `city-blessing`. transform: "becomes a Forest / an Island / Swamps" (Gaea's Liege, Tidal Warrior, Nightcreep, The Irencrag) is a type change, not a transform; 28+3 transform payoffs ("whenever this transforms") had joined them. prevent: "this creature assigns no combat damage this turn" (Bone Dancer, Stromgald Spy, Pygmy Hippo, Delif's Cone) is not a prevention ("protection from" and "would be dealt" stay). return: "Remove target attacking creature from combat" (Illusionist's Gambit, Reconnaissance) is no return; a put into a hand, library, graveyard or onto the battlefield stays a return (Flamewar, Worlds Within Worlds, Blight Herder, Glyph of Reincarnation). roll-dice: Ral, Monsoon Mage flips a coin (CR 705, not 706). vote: Bitter Feud, Day of the Moon only "choose". city-blessing: Court of Ire and Starscream become the monarch (a different designation). Measured: 15 actions dropped; emits transform 346 -> 342, prevented 596 -> 592, enters 6298 -> 6296, dice-rolled 92 -> 91, vote 34 -> 32, city-blessing 2 -> 0; unclaimed 5810 -> 5823 actions, 5091 -> 5101 cards; event-match pairs transform 643 -> 609, prevented 2855 -> 2835, dice-rolled 890 -> 880, vote 128 -> 120, leaves 198927 -> 198927, 0 new, all lost pairs are false; role-ratchet gained 0, lost 0; panel PRECISION 100.0%, RETENTION 98.4% (7 lost, ratchet ok). NOT enabled: deal-damage (Unholy Annex's "each opponent loses 2 life" is its only burn, role:burn + wincon:burn would go), create (the one misfile, Cybership, is also its only go-wide: it does put two creatures onto the battlefield per hit), investigate ("open an Attraction" enters an Attraction, a true fact with no verb of its own), lose-life (Orcish Cannonade's damage to you is a life loss), fight (Grim Contest), draw, exile, destroy, sacrifice, discard (0 misfiled, only clause mix-ups), and the noise verbs.
// 381: #1294 -- damage to "target player" / "target opponent" / "that player" / "that opponent" (player-only) carries `player: true` on the effect subject AND the `non-combat-damage` emit (it was byte-identical to "any target": untyped, control any/opp, scope target), so a role asking "can this damage reach a permanent?" can tell Pyroclastic Elemental from Lightning Bolt. "Any target" stays untyped. Measured: see the commit message.
// 382: #1294 -- a damage REDIRECT ("the next 2 damage that a source of your choice would deal to you ... is dealt to any target instead": Harm's Way, Shining Shoal, Captain's Maneuver, Glarecaster, Mirrorwood Treefolk, Ward of Piety, Zhalfirin Crusader) marks its non-combat-damage emits `redirect`, and damage the victim may have dealt ("That creature's controller may have this artifact deal 1 damage to it": Requiem Monolith) marks them `victimMay`, so the removal role refuses both (owner ruling 2026-10-22). Measured: see the commit message.
// 383: #1302 (owner ruling 2026-10-22) -- a new effect kind `to-hand` (CR 121.5: cards moved from your library to your hand without the word "draw" are not drawn): an UNTYPED `put` from the top of your own library into your hand with no search in the clause (Dark Confidant, Ad Nauseam, Fact or Fiction, Impulse, Dig Through Time, Browse, Akal Pakal, Expressive Iteration, Coiling Oracle's hand branch, Bloodline Shaman, Demonic Consultation, Dark Tutelage, Darkstar Augur), read in `to-hand.ts`. `Ability.amount` is how many reach the hand ("1", "2", "X", `pile`, `all`; "up to two" is its upper bound) and `Ability.chooses` marks a pick from a larger look (Impulse line). A typed dig stays `search` (2026-09-16); a clause with a search, a clause that does not say "top" and "your library" (Guided Passage), and another player's hand or library (Goblin Guide, Duskmantle Seer, Petra Sphinx, Keen Duelist's second put) stay unclaimed. A fact kind (edges.ts FACT_KINDS): no edge moves (the draw event-match pair set is identical, 202696 -> 202696). Measured: 268 `to-hand` abilities on 253 cards (0 before): amount 1 x204 (126 chooses, 78 not), 2 x20, 3 x2, X x4 (3 chooses), all x24, pile x14; unclaimed `put library>hand` 282 actions on 271 cards -> 29 on 29 (all searches, another player's hand or library, Guided Passage); all unclaimed 5859 -> 5606 actions, 5134 -> 4922 cards. 10 cards switch from the grammar reading to the stored model answer because the grammar misreads "reveal the top card of your library and put it into your hand" as `put this creature -> hand` (Caustic Bronco, Neurok Familiar: a false self-bounce, gone) or types a one-card look (Dryad Greenseeker, Traveling Botanist, Vivien's Grizzly, Territory Culler, Archghoul of Thraben, Sarinth Steelseeker, Bison Whistle: `search` -> `to-hand`) and Genesis Ultimatum.
// 384: #1302 review -- `to-hand` refuses a dig the card's TEXT types (2026-09-16 ruling: a class-restricted dig is a typed search, or unclaimed), even when the stored put object is just "it" / "that card": the put's own sentence holds "If it's a <X> card" or "a <X> card from among them" (Archghoul of Thraben, Dryad Greenseeker, Traveling Botanist, Vivien's Grizzly, Territory Culler, Sarinth Steelseeker, Bison Whistle, Nessian Wanderer, Adventurous Impulse). Those return to what they derived at 382 (search from the grammar's typed object, or unclaimed), so the grammar -> model source switch of 383 undoes itself for all but Caustic Bronco (the grammar's `put this creature -> hand` self-bounce stays on the model reading). Measured against 382 (derive-identity): 211 cards differ, 210 purely add `to-hand` and drop the unclaimed put, Caustic Bronco loses a false self-bounce, plus the 2 known drift cards. `to-hand` 268 abilities on 253 cards -> 220 on 210 (amount 1 x161, 2 x20, 3 x2, X x3, all x20, pile x14; chooses 130, not 90); unclaimed `put library>hand` 29 -> 66 actions (the typed pointer digs, as at 382); all unclaimed 5859 -> 5643 actions. Tutor/search event pairs 456 -> 456 (new 0, lost 0); draw 202696 -> 202696.
// 385: #1302 (owner rulings 2026-10-22) -- (1) a TYPED dig is hand-fill AND stays `search` for the tutor edges ("take a Wizard from the top 4 is better the more Wizards you run"): `Ability.toHand` carries the count ("1", "2", "X", `pile`, `all`) on a `search` ability that puts cards from the top of YOUR library into your hand without a printed search (`librarySearch` is absent, so the tutor role is untouched), and `chooses` marks a pick from a larger look. The typing is read from the card's TEXT, not the stored object's spelling: "If it's a/an <X> card" (commas inside: "a noncreature, nonland card"), "a card of the chosen type", "shares a card type", "If a planeswalker card is revealed this way", "<X> card(s) [with ...] from among them" and its pointer ("put that card / the revealed cards"), a predicate pick ("a card with a kicker ability"), "until you reveal a/an <class> card" (an Elf or Elemental card, a card of the chosen kind); the class becomes the dig's subject ("a Zombie card from the top card of your library") so "digs for Zombie" edges form whatever the spelling (Archghoul of Thraben, Narset Transcendent, Gathering Stone, Amareth, Urza Assembles the Titans, For the Ancestors, Thunderous Debut, Knight-Errant of Eos, Yuna's Whistle, Heirloom Blade, Nissa Resurgent Animist, An Unearthly Child, Part in Friendship, Songbirds' Blessing, Sacred Guide, Abundant Harvest). "Otherwise, ..." / "If you don't, ..." branches and "the rest" keep the untyped `to-hand`. (2) `Ability.netZero`: a put that replaces a draw ("If you would draw a card ... instead": Abundance, Underrealm Lich, Tomorrow, Sages of the Anima) or swaps with the top of the library (Scroll Rack) is card selection, not hand-fill. (3) `Ability.named`: "reveal cards ... until you reveal a card with the chosen name" (Demonic Consultation, Divining Witch, Spoils of the Vault) is a tutor; "put all of them with that name" (Desperate Research, Tamiyo, Wood Sage) stays hand-fill. (4) `chooses` means YOU choose: an opponent's pick or split (Karn, Scion of Urza; Truth or Tale) is not, and "reveal a number of cards" is a look at many (Eye of Yawgmoth). (5) Atraxa, Grand Unifier / Hurkyl: "for each <X> ... put a card" is count `X`. Measured against 382 (derive-identity, Mongo --force at 385): 247 cards differ; every base `search` ability keeps an equal-subject successor (0 lost); search and draw event-match pairs 456 -> 456 and 202696 -> 202696 (new 0, lost 0). `to-hand` 197 abilities on 188 cards (count 1 x143, 2 x20, 3 x2, X x4, all x14, pile x14; chooses 125); typed digs carrying `toHand` 250 abilities on 238 cards (1 x205, 2 x5, 3 x1, X x7, all x32). grammar-only-triage.json: four keys for the typed one-card looks (Territory Culler, Sarinth Steelseeker, Traveling Botanist, Archghoul of Thraben, Bison Whistle) are "grammar right" again; Caustic Bronco, Neurok Familiar (the grammar's `put this creature -> hand` self-bounce) and Genesis Ultimatum (group "both wrong") stay on the stored model reading.
// 386: #1302 review of 385 -- the COUNT and the CHOICE of a hand-fill are read from the PICK SENTENCE, not from the stored object's spelling (`to-hand.ts` `readToHand`): "You may reveal an instant or sorcery card from among them and put it into your hand" is one pick of a larger look whatever the object says (Augur of Bolas, Boughside Wanderers, Calix, Break Out, Follow the Lumarets' base case: now chosen -> card selection); "a creature card and/or a land card" is two cards (Kiora, Benefaction of Rhonas, In the Presence of Ages, Relentless Pursuit, Gift of the Gargantuan), "a Cleric card, a Rogue card, a Warrior card, and/or a Wizard card" four (Harper Recruiter), "a land card or a card with {X}" one; "any number of <class>" is all (Karumonix, Lead the Stampede, Forging the Anchor, You Meet in a Tavern, Torsten); "until you reveal three nonland cards" is 3 (Fathom Trawl), a reveal-until that lists classes still takes one (An Unearthly Child); the k-th hand-put reads the k-th hand sentence (Follow the Lumarets: one, or two instead); a plural pointer at "each opponent chooses a card" stays all (Manifold Insights). A SEQUENCE of hand-puts with no alternative between them (Memories Returning: one, then one, then the other) is not a pick. An opponent who picks the PILE leaves YOU the pick of a card from it (Truth or Tale: chosen -> card selection); an opponent who picks the CARD does not (Karn). A predicate pick "with the chosen name" is no class (Tamiyo, Collector of Tales is untyped `to-hand` again); a list of classes is one class list (Harper Recruiter: Cleric, Rogue, Warrior, or Wizard); "choose a card that's exactly those colors from among them" has an unreadable class (Niv-Mizzet Reborn). A fallback hand-put points back at the pick sentence it falls back from, nearest "from among" / "until you reveal" within three sentences (Break Out, Songbirds' Blessing, Part in Friendship: now typed digs). All regexes in `to-hand.ts` are linear (bounded classes, `indexOf`): CodeQL js/polynomial-redos, 40k characters in under 200 ms. Measured against 385 (derive-identity): 35 cards differ, all of them the changes above plus the 2 known drift cards.
// 387: #1302 review of 386 -- a hand-fill (`to-hand`, or a typed dig's `search`) never has a `self` subject: a library card is not the permanent that entered (Niv-Mizzet Reborn's "the chosen cards" read as the card itself and the dig "dug for itself"); and the stored object's trailing "into your hand" is stripped without a quadratic `\s+` regex (ReDoS). Measured: derive-identity against 386 differs on Niv-Mizzet Reborn alone (plus the 2 known drift cards).
// 388: (owner 2026-10-24) a CR 614 replacement records what it does to the event it hears: `Ability.change` {op: plus|times, value}, read by `replacement.ts` `changeOf` off the matched clause -- triple/three times/thrice x3, double/twice x2, "plus N" / "plus one" / "plus an additional" +N (Fiery Emancipation x3, Anointed Procession x2, Tekuthal x2, Pyromancer's Gauntlet +2, Hardened Scales +1, Xorn +1). Only a stated number: "plus that many Squirrels" and Alhammarret's Archive's "draw two cards instead" stay unset. Set only beside `replacement: true`, so a restricted replacement (Bruvac) carries none.
// 389: #1349 -- the grammar reads modal intros, short-name/pronoun self-reference and ability restrictions (riders read off the printed text); "Activate only if <condition>" feeds conditionCares like a trigger's intervening if (owner 2026-10-26), negated/poison/loyalty/player counters demand none; "as though it didn't have defender" grants none; the switch keeps a stored animate's type/subtype/stats. Whole-branch review fixes: "becomes blocked" is no animate (Trap Runner, Curtain of Light, Choking Vines, Fog Patch; GH #1353); a grant in a self-animate sentence is the card's own (Skinshifter, Paragon of the Amesha, Dragonsoul Knight); a counter put as a cost names its permanent in the cost (Jessica Jones, Mazemind Tome; a granted ability's, Sinking Feeling, is excluded); a modal header's every trigger reaches each mode (Captain Kirk, Appa, Galadriel, Oracle of Tragedy); a mode's trailing "if" is no unconditional effect (Federation Field Medic).
// 390: #1349 part 2 -- Saga chapters (event "chapter") and Station rows: an "N+ |" bar gates every ability in its striation with threshold {atLeast: N} (CR 721.2/721.2a), on both paths; set mechanics composed per owner 2026-10-26 (Beam me up = graveyard cast + own-creature bounce, Assimilate = put + counter + Borg artifact creature) and the new `face-a-dilemma` event, emitted once per modal header; kind-less counter replacements ("if one or more counters would be put", "if you would put one or more counters") carry replacement + change (Doubling Season, Winding Constrictor, Vorinclex, Pir), a temporary one stays unread; "on the bottom in a random order" is no top-set; time travel is yours, "they lose the game" the damaged opponent; the switch refuses a reading that loses a trigger's `batched`, or that changes any mana field (manaDiffers: Gauntlet of Power lost its chosen-color filter). Goad (unmerged 390, no bump): the plural "are goaded" is a goad like "is goaded" (grammar/action.ts), so Koloth, Tribble Hunter's "All Tribbles get +1/+0 and are goaded" emits goad instead of reading as an animate (whole-corpus grammar diff: Koloth and Baeloth Barrityl only; Baeloth's derived tags are unchanged, only its clauseSource moves model to grammar).
// 391: #1352 -- a SELF animate carries its becomes-phrase in its subject (type, subtype, stats, colours, keywords), as the store writes it (Jade Statue, the Keyrune/Monument/Opal/Hidden cycles, Vehicles); a target or class animate keeps its target class alone (spellTargeting would read the result as the target; #1364); the switch gate `lostSubjectFields` pairs by clause and effect kind on any kind (Goddric, the Aura bounces), `lostScaledAmount` refuses a dropped scaling amount; `stripCardName` is word-bound (Command Tower, Dino DNA).
// 392: #1357 -- an effect's trailing gating "if <condition>" is `Ability.gate`, parsed by the one gate parser (gate.ts: control / threshold / counter / turn-event / unknown), attached per conjunct (an "except ... if" rider never gates the clone); a suppliable condition adds `conditionCares` (no counter demand for a counter the card places on itself); the grammar reads a gated mode instead of refusing it (What Must Be Done keeps its return); TRON needs two Urza's lands. The matcher weighs gated contributions by deck likelihood (owner 2026-10-27).
// 393: #1357 part 2 -- a LEADING condition gates its own sentence ("If X, A and B" gates both; ", then if" / "Then if"); "Otherwise," / "If not," carry an unknown gate negating the earlier condition(s) (gate.otherwise), with `otherwiseAlike` when the stored reading lost a same-effect sibling; reflexive follow-ups, "instead", replacements, alternative costs, the trigger-doubler frame and shuffle-after-search are no gate; triggers' intervening ifs stay the trigger path's.
// 394: #1373 (owner ruling 2026-10-27) -- `blocks` is an engine verb (CR 509.1a: only creatures block): a "whenever ... blocks" trigger derives instead of being dropped (192 stored rows carried the clause event, 249 corpus cards print it), a modal header's "attacks or blocks" (Elder Gargaroth) gives its modes the blocks visit as well as the attacks one, and the blocking state of a blocks trigger's subject is the event (as the attacking state is on an attack). `blocks` joins PERMANENT_EVENT_VERBS; a self blocks trigger refuses a bare clause `you` the way attacks does.
// 395: #1373 review -- a textless `blocks` record beside the record whose grammar reading already covers "attacks or blocks" (Howling Golem, Jedit Ojanen, Sapphire Dragon, Goblin Psychopath: 46 cards, all pure removals) is folded into it, all or nothing per clause, when EVERY ability it derives is covered by one of the covering clause's (`identicalTwinOf`: identical apart from the clause and the amount's spelling, the covering one carrying an amount / count wherever the twin does), instead of a second blocks ability.
// 396: #1375 (owner ruling 2026-10-27) -- `becomes-blocked` is an engine verb (CR 509.1h: an attacking creature with blockers declared for it becomes blocked), consumed from card text with NO producer: a "whenever ... becomes blocked" trigger derives instead of being dropped (168 stored rows carried the clause event, 233 corpus cards print it) and the second half of "blocks or becomes blocked" (55 cards print "blocks or becomes blocked" outside reminder text: Goblin Cadets, Aisling Leprechaun, Goblin Flotilla, Engulfing Slagwurm) derives beside the blocks half. `becomes-blocked` joins PERMANENT_EVENT_VERBS; "an attacking creature becomes blocked" states the event, so the attacking state is dropped as it is on an attack. repeats: a self / equipped / enchanted creature becomes blocked once a combat (CR 509.3c), "becomes blocked by <creatures>" once per blocker (CR 509.3d).
// 397: #1381 -- a "becomes blocked by <creatures>" trigger carries the blocker: `Ability.trigger.blocker` is the filter on the BLOCKING creatures ("by an artifact creature", Ogre Leadfoot; "by a creature" is `{type: creature}`), read by `readBlocker` (grammar/trigger.ts) on both paths. "By one or more <class>" and a threshold ("by two or more creatures") set `batched` (once a combat, CR 603.2c / 509.3e); "by a/an <class>" is once per blocker (CR 509.3d). A phrase it cannot read exactly (the card or its host as blocker, a dropped negation, a relative stat, a state) still refuses as `narrowing:becomes-blocked`. repeats reads the fields, no longer the clause text.
// 398: #1383 -- a negated card type beside a head type is recorded: "nonartifact creature" is `{type: creature, notType: [artifact]}` (was a bare creature), "noncreature artifact" `{type: artifact, notType: [creature]}`. `resolveTypes` dropped a negation that removed nothing from the base on the reasoning that the matcher could not apply it; 8cdb0d7b made the matcher apply `notType` as an exclusion five hours later (Phyrexian Scriptures' "destroy all nonartifact creatures" no longer hits your artifact creatures). themeSubjectKey and loneTypeNarrows treat a negation beside ONE type as that type (keys unchanged).
// 399: #1385 -- type words inside a token's QUOTED ability are not the token's types: `parseSubject` cuts double-quoted spans (not a quoted name) before any sweep. The Prydwen's Human Knight was `[creature, artifact]`, an Equipment artifact token `[creature, artifact]` ("Equipped creature gets +1/+0"), Ka-Zar's Zabu `[creature, land]`.
// 400: #1380 -- the blocks twin fold compares amount VALUES, not their presence: equal after normalising (sign kept, "-1/-1" is not "+1/+1") or the twin plus a trailing "where X is ...", or the twin as the whole of that explanation (Freelance Muscle) (Mana-Charged Dragon's "X/0" inside "+X/+0, where X is ..." still folds; "1" beside "2" or "+1/+1" no longer does); count by equality.
// 401: #1376 -- the textless-twin fold runs on every event and on split ids (Korvold's 2.1), not only blocks / becomes-blocked on integer ids, and compares abilities key-order-insensitively (Primeval Herald's twin carried the same effect.subject keys in another order); `deriveRow`'s switch also takes the grammar reading when the stored answer is it with exact duplicates. Measured (derive-identity ALL=1 vs stored 400): 226 cards change; 2 are stale before the change (Plan for All Outcomes, Overwrite the Multiverse); 202 are pure removals; 21 switch to the grammar reading; 1 (Mage Hunter) stays unfolded because its twin is richer. In the model path itself the fold adds 0 lines on all 24 non-pure cards.
// 402: #1391 -- a clause with several grant-ability actions (Colossus of Akros' trample + "can attack as though it didn't have defender"; Silverquill Pledgemage's flying + lifelink; the model store's one action per keyword) derived one keyword-grant / speed-increase ability per action, each carrying the whole clause's union of `grants`, so JSON-identical twins; derive keeps the first of each (`foldGrantTwins`, applied last by deriveCardTags; derive-worker's switch decides on the UNFOLDED readings and folds the winner, because folding first changed its count keys and moved 39 cards model -> grammar into labels judged on other cards). Measured (full re-derive): cards with exact-duplicate abilities 557 -> 153 (grammar 361 -> 50, model 196 -> 103); switch decisions identical to 401 (0 cards move); panel precision 100.0% / retention 98.4% (428 held, 7 lost) unchanged; role-ratchet gained 0 lost 0; dropped-clauses 5178 actions / 4530 cards unchanged.
// 403: #1391 part 2 -- two stored records that share one id (the model's "X or Y" trigger: Duggan's enters + attacks, Derevi's enters + combat damage, Goldspan Dragon's attacks + becomes-target; 62 stored cards) are each other's split siblings: each takes its own event's grammar reading instead of every reading, so each limb's ability appears once (was twice) and Goldspan's becomes-target half is refused, as a refused-only record is, not a second attacks. Measured (full re-derive): cards with exact-duplicate abilities 153 -> 129 (model 103 -> 79, grammar 50); 24 cards lose 54 doubled abilities (Derevi 9 -> 5, Sephiroth 15 -> 11, Rocco 9 -> 5, Eluge 10 -> 6); Kaya the Inexorable's ghostform `exiled` record no longer borrows the `dies` return (graveyard-recursion on exile was the double reading); Goldspan's refused becomes-target half derives a trigger-less token-generation, as a refused-only record does (was a second `attacks`); Ultron's Auxiliary keeps both limbs (a record whose event the text does not read takes the readings no sibling claims). Also: a modal header stored as two same-id records is one header group (`modeVisits`, header state keyed by id + event): Balor's modes derive under attacks AND dies (402: attacks only; the only such corpus card). Octavia's limbs are cast + copy (was cast twice), Mystic Barrier's enters + upkeep (was enters twice); Desert Warfare, Curator of Mysteries and Protector of the Wastes' unread second limb is refused rather than borrowing a live trigger; Cryoshatter (a different-id split) reads `damaged` for clause 4 (was `taps`). Grammar-only cards: 0 change. Switch: 3 cards move -- Shrine of Loyal Legions and Shrine of Piercing Vision to the model reading (now clean, the grammar's has an extra cast), Treacherous Vampire to the grammar reading (same abilities plus an empty keyword-grant for its quoted ability; dropped-clauses +5:spliced, banked). Panel precision 100.0% / retention 98.4% (428 held, 7 lost) unchanged; role-ratchet gained 0 lost 0; dropped-clauses 5178 -> 5179.
// 404: #1391 part 2 F2 -- "you and <player> each <verb>" (Farsight Adept, Thran Spider, Cait, Bloodroot Apothecary; 16 cards change, below) reads the first pass as YOU and the second as the named player (`action.ts` `both`), not two JSON-identical `any` actors: a stored draw / discard pair takes the player's own object, and a `create` pair carries the player on `Action.actor` so the token-generation subject is yours and theirs. A store that wrote ONE action for the pair is unchanged (the grammar reads more draws than it holds, so it is left as stored). Measured (full re-derive): cards with exact-duplicate abilities 129 -> 115 (model 79 -> 72, grammar 50 -> 43); 16 cards change (full-corpus deriveRow diff, 31,667 cards). 5 are single-actor creates, intentionally widened (`Action.actor` applies to any `create` with a named, non-back-referenced actor): Kamber, the Plunderer, Lotho, Corrupt Shirriff, Rocco, Street Chef, Seize the Spotlight (you) and Ingenious Mastery (opp), each `any` before. 11 lose a false twin: Farsight Adept, Teyo, Love Song of Night and Day (draw you + target opponent), Thran Spider, Bloodroot Apothecary, Oath of the Grey Host (token you + opponent), Cait, Cage Brawler (the defending player's draw and discard were `you`), Karazikar, Tempt with Bunnies / Reflections / Vengeance (the opponents' tokens are theirs; the "for each opponent who does" repeat stays). A back-referenced player ("that player": Diviner Spirit, Sergeant John Benton, Xyris, Black Widow) keeps the 403 pair, both `any`. Switch: 7 cards move model -> grammar, each because the two readings are now identical (Flumph, Loran of the Third Path, Sky Crier, Secret Rendezvous, Joined Researchers, Your Temple Is Under Attack, Karazikar). Panel precision 100.0% / retention 98.4% (428 held, 7 lost) unchanged; role-ratchet gained 0 lost 0; dropped-clauses 5179 unchanged. Still a `you` for another player (same at 403, #1395): Angel of Destiny, Benevolent Offering, Eumidian Wastewaker, Twist Allegiance, Reins of Power.
// 405: #1391 part 2 F3 -- one printed search over several zones ("Search its owner's graveyard, hand, and library for ...": Eradicate, Extirpate, Kassandra, Gate to the Afterlife, ~27 cards) is ONE search ability, not one per zone (the graveyard and hand ones were JSON-identical, no emits): `collapseZoneSearches` merges a run of same-object searches that differ only in `fromZone`, keeping the library member so the `search` emit and `librarySearch` survive. Measured (full re-derive): cards with exact-duplicate abilities 115 -> 93 (model 72 -> 56, grammar 43 -> 37). 77 cards change, each a search-count drop (no mana or unclaimed field moves): the "graveyard, hand, and library" hate and named-card searches 3 -> 1 (Extirpate, Eradicate, Surgical Extraction, Memoricide, Deadly Cover-Up ... librarySearch "other", subject `any`; Kassandra, Gate to the Afterlife, Shaun & Rebecca "yours"), ~40 "library and/or graveyard" searches 2 -> 1 (Ethereal Elk, The First Doctor, Chandra's Outburst ...); Vraska's Scorn, Jace's Ruse, Liberating Combustion 3 -> 2 and Nissa's Encouragement 6 -> 5 (CEILING). The kept "yours" search's subject reads `you` (was `any`), and on Chandra's Flame Wave, Vraska's Scorn, Ecological Appreciation and Turtles Forever its `search` emit too: every corpus consumer of a search event is an opponent's (River Song, Archivist of Oghma, Ob Nixilis, Unshackled, Wan Shi Tong, Librarian), so `any` matched them -- a false edge, now gone: with one search action left, a stated-nowhere searcher defaults to you (`ACTOR_DEFAULTS_TO_YOU`); "other" searches stay `any`. The card-by-card switch decides with both dedupes off (`collapseZoneSearches: false`, `foldGrantTwins: false`): 0 cards move (collapsing first moved 5, Finale of Devastation onto a library-only reading). Panel precision 100.0% / retention 98.4% (428 held, 7 lost) unchanged; role-ratchet gained 0 lost 0; dropped-clauses 5179 unchanged (measured after a forced re-derive at this code: the first measurement read a same-version derive that had not re-run).
// 406: #1391 part 2 F4 -- the post-switch twin fold also drops an ability JSON-identical to an earlier one of the SAME clause when that clause's printed text (reminder text stripped) says "instead": an alternative branch that repeats the base branch (Grow from the Ashes' and Primal Growth's shuffle, Bane's Contingency's counter-spell, Academy Manufactor's token-doubling, Galadriel's Dismissal, Wildfire Howl, Bilbo) is one either/or effect. Measured (derive-corpus --force): cards with exact-duplicate abilities 93 -> 77 (model 56 -> 49, grammar 37 -> 28). 17 cards change, each only losing an identical either/or twin (oracle read for all 17): Academy Manufactor 3 -> 1 token-doubling, Bilbo, Fellow Conspirator, Szadek, Lord of Secrets, Bane's Contingency (counter-spell), Galadriel's Dismissal (phases-out), River of Tears and A-Town (mana-generation), Finale of Revelation and Careful Consideration (the shared draw; Careful Consideration's 3 vs 2 discards stay), Wildfire Howl (the shared 2 damage to each creature), Grow from the Ashes, Primal Growth, Entish Restoration, Sadistic Sacrament (the shared shuffle; the searches differ and stay), Burning Curiosity (exiled), Ceta Sanctuary (discard; grammar-only, no stored answer), Goblin Psychopath 4 -> 2 (its two stored limbs derived as clause 1 each doubled; one attacks and one blocks remain). Switch: 0 cards move. Panel precision 100.0% / retention 98.4% (428 held, 7 lost) unchanged; role-ratchet gained 0 lost 0; dropped-clauses 5179 unchanged.
// 407: #1391 part 2 F5-F7 -- (F7) "can't attack or block, and its activated abilities can't be activated" (Arachnus Web, Volrath's Curse, Faith's Fetters, Realmbreaker's Grasp): a stored bare combat action the grammar's "attack or block" already covers is dropped before alignment (it took the activated-abilities phrase's place: restriction + TWO ability-loss), the "unless they're mana abilities" rider scopes to the abilities phrase, and `restrictedActions` ignores it; (F5) two counter placements in one clause read their own "counter on <X>" phrase, so "on that creature and on this creature" (Juniper Order Ranger, Sumala Sentry) is one on the trigger's permanent and one on self; (F6) the post-switch twin fold treats "your choice of" like "instead" (Primal Clay, Primal Plasma, Corrupted Shapeshifter, Aquamorph Entity: one animate per alternative on the grammar path). Measured (derive-corpus --force): cards with exact-duplicate abilities 77 -> 63 (model 49 -> 46, grammar 28 -> 17). 19 cards change (full deriveRow diff, tokens and grammar-only included; reviewer re-ran it): F7 Arachnus Web, Volrath's Curse, Academic Probation lose a duplicate ability-loss; Faith's Fetters, Realmbreaker's Grasp gain the restriction and lose the duplicate; Bound in Gold loses the duplicate (its "attack, block, or crew Vehicles" stays unread: dropped-clauses +2:cant, banked); F6 Primal Clay, Primal Plasma, Corrupted Shapeshifter 3 -> 1 animate, Aquamorph Entity 2 -> 1; F5 the self counter: Juniper Order Ranger, Captain America, Team Leader, X-23, Deadly Weapon (second), Sumala Sentry (was both self), Drillworks Mole, Trygon Prime, Ich-Tekik, Serrated Biskelion (first), Claim the Kingdom (plan counter). Switch: Arachnus Web moves model -> grammar (its readings are now identical). Panel precision 100.0% / retention 98.4% (428 held, 7 lost) unchanged; role-ratchet gained 0 lost 0; dropped-clauses 5179 -> 5180.
// 408: #1395 -- another player's half of a printed action is no longer yours: a reading's named actor rides on every verb (was `create` only), "you and X each" splits or-alternatives, "each other player" / "defending player" stop the controller default, a player back-reference never inherits `you`, and a control change of something you control is another player's gain. Measured (derive-corpus --force; whole cardTagsDerived snapshot 407 vs 408, 32,797 rows): 103 rows change, none added or removed -- 101 stored cards (derive-identity vs 407 rows; the stale pair Plan for All Outcomes / Overwrite the Multiverse unchanged), Kaito Shizuki Emblem (own-library search any -> you) and Wernog, Rider's Chaplain (grammar-only: its own investigate any -> you; its textless leaves twin takes the enters limb's reading when that sentence names the twin's event, so the twin fold holds, 6 abilities; Tomebound Lich's and MACH-1's textless limbs read you the same way, their older duplicate limbs as at 407). The #1395 cards: Angel of Destiny gain-life you,you -> you,any; Benevolent Offering you,you -> you,opp; Eumidian Wastewaker the defending player's discard + sacrifice you -> opp; Twist Allegiance and Reins of Power gains-control you,you -> you,opp; Shattergang Brothers each other player's sacrifice you -> opp; also Words of Wisdom and Savra. The rest, each another player's half: sacrifice edicts any -> opp (Desecration Demon, Fatal Grudge, Will of the Abzan ...), the Tempt cycle's opponent halves, control changes of what you control (Iroh, Juxtapose, Stardew Valley, Hithlain Rope ...; `scales:donated` skips an until-end-of-turn/combat gift), and any -> you pins (a cost discard you pay, a search of your own library whose sentence names another player). Corpus event-match diff (branch review, every changed row x every card, pairReasonsAcrossFaces BASE vs HEAD, at the pre-review-fix head): 40,456 claims lost, every sampled family a false edge removed (recursion from YOUR graveyard of an opponent's card 17,908; self dies/ETB/leaves fed by an opponent's edict ~15,400; 'creature you control dies' 1,817), 487 gained, at least 19 false (Oft-Nabbed Goat 13; loans counted as gifts, Reins of Power / Twist Allegiance / Assault Suit / Tahngarth into Zedruu and Iroh 8, of which Assault Suit and Tahngarth -> Iroh certainly false). After the review fixes (c1727419 -> fixed head): 0 gained, 51 lost (Goat draw 13, Tomebound Lich 13, MACH-1 15, scales:donated loans 10 incl. Domineering Will), 2 text changes. Panel precision 100.0% [99.2, 100.0] / retention 98.4% (428 held, 7 lost) unchanged; role-ratchet gained 0 lost 0; dropped-clauses 5180 unchanged.
// 409: #1403 -- the grammar no longer reads a card complete while dropping a printed action: a "you and X each" phrase it cannot read is unread (was silently dropped), "each gain control of <X> the other controls" reads as two control changes (yours of theirs, theirs of yours: Twist Allegiance, gains-control you then opp), and a phrase splits before "and <player> <verb>" (Khârn the Betrayer's swallowed gain of control, Haunted Angel, Oft-Nabbed Goat). Also "that opponent" is a player actor, "decides whether" a phrase joint, "unless that opponent pays N life" stays the main action's unless (Prince of Thralls), a back-referenced amount ("that many", "that much") no longer replaces a stored amount that resolves it, on the model path or (carryStoredAmounts) on a grammar winner, a trigger quantifier ("one or more") excepted, and a prevention of damage to the card itself marks the prevented emit `self` (Khârn the Betrayer, the Phantom cycle, Wall of Vapor) (not a granted or quoted "this creature", whose recipient is another permanent), which no "damage to you" payoff hears. Measured (derive-corpus --force; whole cardTagsDerived snapshot 408 vs 409, 32,797 rows): 86 rows change, none added or removed; 7 more move model -> grammar with identical tags (Twist Allegiance, Tomik, Norn's Decree, Fungal Shambler, Haunted Angel, Zhang Liao, Oft-Nabbed Goat); derive-identity identical 32006, different 2 (the stale pair). Emits: Khârn the Betrayer gains-control you -> opp ("an opponent of your choice gains control of it", pairs gained: scales:donated into Zedruu and Iroh); 52 rows' prevented emit gains `self` (prevention of damage to the card itself), which removes their false prevented -> Selfless Squire reason (50 of 52 probed lost it, 0 other reasons moved). Amount/count: the stored amount and its scaling restored over "that many" on Black Panther, Spider-Man New Champion, Basri Ket (batched attacks trigger kept), Dragonspark Reactor, Last-Ditch Effort, Kaya Orzhov Usurper, Sawblade Skinripper and more (pair reasons re-magnituded, none lost); Rogue Skycaptain removes "all" wage counters. Grammar: complete 28,417 -> 28,423 of 34,740; grammar-complete cards printing "gain(s) control" with no gain-control record 2 -> 0. Panel precision 100.0% [99.2, 100.0] / retention 98.4% (428 held, 7 lost) unchanged; role-ratchet gained 0 lost 0; dropped-clauses 5180 unchanged.
// 410: #1401 -- tap it and up to one target keeps the card's own tap; counter on it / on this creature across two sentences
// 411: #1401 -- #1401 part 2: a zone list keeps each limb's own zone (moveList: Decree of Annihilation, Crabomination, Shadows' Verdict) and an emit reads a comma card name whole (38 cards: Vraska's Scorn, Jace's Ruse, Liberating Combustion, ...)
// 412: #1401 -- #1401 part 3 family B -- identical abilities of one clause fold to the number of times the clause prints their verb (sacrifice, copy, shuffle): Chimeric Coils, Ether, Thunderous Debut, Phyrexian Portal lose one duplicate each; This Is How It Ends, Telling Time, Ransack stay. Measured: 4 rows change, pair membership +0/-0, role-ratchet 0/0, dropped-clauses 5181 unchanged.
// 413: #1401 -- #1401 part 4 family A -- counter actions map to recipient phrases by group: Arwen's two pairs (the other creature, then the card), Sinister Concierge's two time counters (the card exiled, then the target exiled), Invasion of New Capenna's second counter reads 'each other creature you control'. Measured: 3 rows change, pair membership +68/-0, role-ratchet 0/0, dropped-clauses 5181 unchanged.
// 414: #1401 -- part 5 (family E): a cant is ability-loss only when the abilities are the subject's own. 'Abilities' as the SOURCE of targeting (Peace Talks, Ground Seal, Canopy Cover, Wall of Shadows), of triggers (Torpor Orb, Hushbringer, Nowhere to Run), of mana spending (Guidelight Optimizer, Ronin) or of blocking (Jasmine Boreal, Staff of the Ages) no longer reads as ability-loss, and the grammar's merged 'untap during its controller's untap step and its activated abilities can't be activated' (Hold for Questioning, Encrust, Stuck in Summoner's Sanctum) is no longer a second ability-loss next to the stored abilities limb. 39 rows change (38 lose a false ability-loss; Jasmine Boreal gains evasion, True Believer shroud), source flips 5, dropped-clauses 5181 -> 5219, role-ratchet gained 2 (Artifact Ward, Canopy Cover wincon:voltron)
// 415: #1423 -- three effect kinds for the `cant` lines #1401 part 5 stopped reading as ability-loss and left unread (owner ruling 2026-10-30), all FACT kinds (edges.ts FACT_KINDS, impact 0.2, quality.ts counts none as extra value, sentence.ts / similar.ts words): (1) `targeting-ban` (CR 115.1; hexproof CR 702.11 and shroud CR 702.18 are its keyword forms) -- `effect.subject` is who is protected (self, a class, a target; an Aura host is `host`; a list unnamed), `Ability.targetingBan` is `{by: spell | ability | activated-ability, source: SubjectFilter}` (opponents control, colours / non-colours, a card type, Aura): Shielding Plax, Canopy Cover, Vines of Vastwood, Thrun, Gaea's Revenge, Spellbane Centaur, Artifact Ward, Bartel Runeaxe, Ground Seal, Peace Talks; 28 cards (29 abilities) read, Wall of Shadows / Lurker (narrowed, conditional) and Kaya, Bane of the Dead (a PERMISSION to target through hexproof, stored as a `cant`) not. (2) `trigger-suppression` (CR 603.2, 603.6a, 603.6c) -- `Ability.suppresses` is `{events: enters | dies | attacks | leaves | any, controller}`, `effect.subject` the muted class: Torpor Orb, Hushbringer, Hushwing Gryff, Doorkeeper Thrull, Tocatli Honor Guard, Karn Argent Defender, Elesh Norn Mother of Machines (her doubling half stays trigger-doubling); 7 cards, "backup" / "ward" abilities and conditions refused. (3) `untap-denial` (CR 502.3) -- `Ability.untapDenial` is `{duration: continuous | next-untap-step | as-long-as, steps?}`; host.ts HOST_KINDS lists it and the targeting ban, and "doesn't" joins RECIPIENT_VERB so an Aura's "Enchanted creature doesn't untap" is `host`; 280 of the 328 corpus cards printing a negated untap read, 276 of them inside the derive scope (42 unread: 32 conditional, 9 "can't untap more than N" limits, Leviathan; 6 not derived). Read off the printed sentence by whitelist (cant-kinds.ts), so a condition, a permission or a narrowed class stays unread. ALSO: a stored `untap` whose printed clause only negates untapping is the denial (Energy Storm, Melancholy, Thirst, Fogwalker, Galvanic Juggernaut, Leviathan, Reveka), emits no `untaps`, and a stored `untap` beside its own `cant | untap` is one ability (Glacial Grasp, Illithid Harvester); `claimsNothing: "mana-rider"` on a targeting-ban / trigger-suppression / untap-denial ability that shares a clause with a mana-generation ability (Cinder Marsh and 9 more lands), which `abilityIsKind` counts as no ability to copy. Measured (derive-impact vs 049f7607, final): 312 rows changed, 4 model->grammar source flips (Energy Storm, Fogwalker, Melancholy, Thirst; Dread Wight no longer flips), dropped-clauses 5,219 -> 4,914 (322 fixed: 305 `cant`; 19 new keys, none a new drop: 18 re-flagged `:partial` plus Tamiyo, Upriser Crowned 3:tap:partial), role-ratchet gained 0 / lost 0 (31,223 -> 31,223), pair reasons of changed rows +197 / -4,060 (gained: copies +188 on cards whose real activated or triggered ability was invisible, static cost-reduction +9; lost: the false `static:untap` / `untaps` / `cast` families of the misfiled untap, 3,604 of them Energy Storm's, and 82 `taps` of Tamiyo, Upriser Crowned), matcher sample +2 / -34. "Tap those creatures" after a combat-defined class (Dread Wight, Tamiyo, Upriser Crowned) emits no `taps`. Three CEILING markers are new: two in cant-kinds.ts, one in derive.ts.
// 416: #1426 -- Any rider of an activated mana ability (painland and Talisman damage, counters, Astrolabe's delayed draw) is stamped mana-rider: 314 abilities on 297 cards stop forming copies:activated pairs (-13,244 pair reasons, +765 copies:triggered that the false activated reading had hidden); a clause that targets, holds a loyalty ability or moves a card to or from a library by its cost or effect (CR 605.1a: Chromatic Sphere, the Eggs, Selvala, Millikin, Deranged Assistant, Charmed Pendant) is no mana ability and stays copyable; a draw in a delayed trigger (CR 603.7a: Astrolabe, Barbed Sextant) is not the ability's own effect and stays stamped. Emits unchanged.
// 417: #1427 -- A plural back-reference ("untap those creatures", "each of those creatures") is the set its antecedent action named in the same clause (controller, target scope, power cut, keyword, attacking), or nothing: refused when the antecedent is a trigger's batched creatures, a zone class (return/put), a counter with no recipient, an ability, a combat role (Dread Wight) or two different sets (Twist Allegiance). Replaces the #1423 combat-only tap refusal. Measured (derive-impact vs bdfa6878): 40 rows changed, 7 source flips (3 tags-identical: Champions from Beyond, Marsh Casualties, The Fifth Doctor; Ever After, Garruk Curse Breaker, Random Encounter, Send to Sleep), role-ratchet gained 0 / lost 0, dropped-clauses 4,914 -> 4,935 (new 23, fixed 2), pair reasons of changed rows +254 / -80,456 (gained: heroic-style cast on Domineering Will, Harness by Force, Mass Mutiny whose untap is now of TARGETED creatures, Tears of Rage attacking). Thundermaw Hellkite now taps opponents' flying creatures; Mob Rule untaps the power-cut class. ALSO (review): parseControl no longer reads the opponent of "attacking one of your opponents" as the controller (the defender, not the owner; Garruk Curse Breaker's model reading was `opp`, now `any`; Blast-Furnace Hellkite, Roar of Resistance move opp -> any; Scriv, Martial Impetus, Seifer unmoved), final run: 42 rows changed, pair reasons of changed rows +254 / -80,459. KNOWN IMPRECISION, narrower than before and the right direction: "all creatures target opponent controls" parses scope `target` (Call for Aid); "that didn't attack or enter" qualifiers are dropped (The Fifth Doctor); "that player controls" is not carried into control (Hideous Taskmaster, Worf, Mass Mutiny, Molten Primordial).
export const DERIVE_VERSION = 417;

/** "Whenever another creature you control attacks, IT gains trample" (Stonehoof Chieftain): a grant
 *  to the triggering object. "they" covers the batched "one or more creatures ... attack". */
/** The same, for a MODE BULLET that inherited a trigger (#1253): its text is the bare "It gains indestructible
 *  until end of turn.", the trigger sits on the header. */
const GRANT_BULLET_TO_TRIGGER = /^(?:until end of turn,\s*)?(?:it|they)\s+(?:each\s+)?gains?\b/i;
const GRANT_TO_TRIGGER = /\b(?:whenever|when)\b[^.]*?,\s*(?:until end of turn,\s*)?(?:it|they)\s+(?:each\s+)?gains?\b/i;

/** THE MANA A MANA ABILITY ADDS, from the action's object (CR 605.1a), when the clause states no
 *  amount: mana symbols count one each (a hybrid is one), a number word before "mana" is the
 *  number, alternatives joined by "or" take the smallest. Unset on a counted, X, or "that much"
 *  object -- `scaling` says how those grow -- and on energy, which is not mana (CR 107.14). */
const NUMBER_WORD: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
/** THE VERBS WHOSE OBJECT IS THE THING COUNTED, so a single reference ("target creature card",
 *  "this", "it", "another") is one of it. A draw's or a discard's object is the count itself ("a
 *  card") or a player, so only a number head counts there. */
const OBJECT_IS_COUNTED = new Set(["return", "untap", "copy", "exile", "put", "tap", "sacrifice", "destroy", "flicker"]);
/** The verbs a unit amount is read for at all: the rate families and the unit effects behind
 *  them. Counters are not here -- an `add-counter` object is the counter's KIND, and "a +1/+1
 *  counter on each creature you control" is not one counter. */
const UNIT_VERBS = new Set(["draw", "discard", "mill", "search", "create-token", "scry", "surveil", ...OBJECT_IS_COUNTED]);
const UNIT_HEAD = /^(?:up to )?(a|an|one|two|three|four|five|six|seven|eight|nine|ten|x)\b/;
/** THE AMOUNT A COUNTED ACTION STATES IN ITS OBJECT, when the clause put none on `amount`. `undefined`
 *  where the object counts nothing this can read: "all", "each", "the top card", "those", "that
 *  many", "cards equal to", "any number of". A search counts what comes after "for", or its whole
 *  object when the normalizer dropped the library ("a card", Vampiric Tutor); a bare "your library"
 *  counts nothing. */
export function unitAmount(verb: string, object: string): string | undefined {
  if (!UNIT_VERBS.has(verb)) return undefined;
  let o = object.trim().toLowerCase();
  if (verb === "search") { const m = /\bfor (.+)$/.exec(o); if (m) o = m[1]!; else if (/^(?:your|their|its|his|her) /.test(o)) return undefined; }
  if (verb === "scry" || verb === "surveil") return /^\d+$/.test(o) ? o : /^x$/.test(o) ? "X" : undefined;
  if (/^(?:that many|any number|those|all|each|the|your|their|cards? equal)\b/.test(o)) return undefined;
  const head = UNIT_HEAD.exec(o)?.[1];
  if (head) return head === "x" ? "X" : head === "a" || head === "an" ? "1" : String(NUMBER_WORD[head]);
  if (OBJECT_IS_COUNTED.has(verb) && /^(?:target|this|it|that|another|enchanted|equipped)\b/.test(o)) return "1";
  return undefined;
}

/** HOW MUCH MANA AN ADD-MANA ACTION ADDS, as a number: `production()`'s fixed amount, the SAME read `ManaLine.amount` is (#1193). `undefined` where it scales
 *  (X, "for each", "that much") or the object names no amount. `amountText` is the clause action's `amount`. */
export function manaAdded(object: string, amountText = ""): number | undefined {
  return production(object, amountText).amount.fixed ?? undefined;
}

/** WHERE A COUNTER LANDS, read from the clause text: on this card ("on this creature", "on it"
 *  when nothing else in the clause could be "it", "on <its own name>"), or on some other permanent
 *  ("on target creature", "on each creature you control", "on that creature"). Adapt and monstrosity
 *  put their counters on the card by definition (CR 701.46, CR 701.37). A clause naming BOTH
 *  recipients states nothing here: "put a +1/+1 counter on target creature and a charge counter on
 *  this artifact" is two counters and one emit, and the honest answer is the one it had. */
// "ON" for a counter placed, "FROM" for one removed (DERIVE 158): "remove twelve time counters from
// Trenzalore Clocktower" is the card's own counters leaving, and read as a class it fed every
// vanishing and suspend payoff in the deck.
// THE PREPOSITION FOLLOWS THE VERB: a counter is put ON and removed FROM. Read together they broke
// Forgotten Ancient -- "move any number of +1/+1 counters FROM this creature ONTO other creatures" is
// a removal from itself AND an addition to others, and "from this creature" made the addition self.
const counterRegexes = (prep: "on" | "from") => ({
  onThis: new RegExp(`\\bcounters?\\s+${prep}\\s+this\\s+(?:creature|permanent|artifact|enchantment|land|planeswalker|vehicle|card)\\b`, "i"),
  onIt: new RegExp(`\\bcounters?\\s+${prep}\\s+(?:it|itself)\\b`, "i"),
  onOther: new RegExp(`\\bcounters?\\s+${prep}\\s+(?:(?:up to \\w+ |any number of )?(?:target|each|another|any|all|those|that)\\b|(?:a|an|the)\\s+(?!(?:creature|permanent|artifact|enchantment|land|planeswalker)\\s+(?:you control )?(?:that|with)\\b)[a-z]+\\b(?!\\s+you control\\b)|(?:creatures|permanents|artifacts|lands)\\s+you control\\b)`, "i"),
});
const COUNTER_ON = counterRegexes("on");
const COUNTER_FROM = counterRegexes("from");
const OTHER_OBJECT = /\b(?:target|another|each other|any other)\b/i;
/** A counter PUT as a cost ("{T}, Put a stun counter on Jessica Jones:", #1349 review) is the activated clause's add-counter, and its permanent is
 *  named in the cost, not in the effect text; used only when the effect text states no counter placement of its own, and never in a granted
 *  ability (Sinking Feeling), whose "this creature" is the grantee. */
const COUNTER_PUT_AS_COST = /\bput (?:an?|one|two|three|x) [^,:]*?counters? on\b/i;
const COUNTER_PREP = /\bcounters?\s+on\b/i;
/** ONE COUNTER PLACEMENT PER RECIPIENT (#1391 F5): "put a +1/+1 counter on that creature and a +1/+1 counter on this creature" (Juniper Order Ranger, Sumala Sentry) stores two add-counter actions whose objects name no
 *  recipient, and the clause text read whole made both "on that" (Juniper) or both "on this creature" (Sumala: the first "it" is the face-up permanent). When the clause has as many `counter(s) on <X>` phrases as
 *  add-counter actions, the nth action reads the text with the OTHER actions' phrases cut out, so each recipient is judged alone and the lead-in ("This creature enters with ...") still counts.
 *  CEILING: only a clause with exactly two add-counter actions and two counter phrases, joined by \"and a\", or apart with the second on \"this <card>\" (#1401) (Communal Brewing's three, with a where-clause, reads the whole text); "a counter on each of two creatures" or a list the store split otherwise reads the whole text, as before. */
function ownCounterText(action: Action, actions: Action[], text: string, forEmits = false): string {
  if (action.verb !== "add-counter") return text;
  const mine = actions.filter((a) => a.verb === "add-counter");
  if (mine.length < 2) return text;
  const own = mine.indexOf(action);
  // Index scanning, no lazy runs (CodeQL js/polynomial-redos): every "counter(s) on", and the sentence delimiter after it.
  const starts = [...text.matchAll(/\bcounters?\s+on\s/gi)].map((m) => m.index!);
  const stop = (from: number): number => { const i = text.slice(from).search(/[,.;]/); return i < 0 ? text.length : from + i; };
  if (starts.length === 1 && mine.length === 2) return splitOneRecipientList(text, starts[0]!, stop(starts[0]!), own);
  // The EMIT reads the cut text only for a one-phrase recipient list (it names the recipient class: "each other creature you control"); the two-phrase splits above keep the emit on the whole text, as before (#1391 F5 counter kinds and recipients are unchanged).
  if (starts.length !== 2 || forEmits) return text;
  // ...and the two are joined by the FIRST "and <a / a number>" between them, in one sentence (a third phrase in a where-clause, Communal Brewing, or a sentence break reads the whole text).
  const [a, b] = starts as [number, number];
  // ...or the phrases are apart (a sentence break, "then"): split only when the SECOND names the card outright ("on this creature") (#1401, Sanctuary Wall: "You may put a stun counter on it. If you do, put a stun counter on this creature.").
  // A pronoun cannot point forward, so the first is judged without it: its "it" is whatever the text before it named (the tapped target). A second phrase that is itself a pronoun
  // (Elder Cathar's "... on target creature you control. If that creature is a Human, put two counters on it instead", Communal Brewing's "on this enchantment, then ... on it") takes its antecedent
  // from the phrase before it, which cutting out would lose, so those read the whole text as before. The exception is a pronoun whose nearest preceding ACTION is not a counter placement
  // (#1401 part 4, Sinister Concierge: "exile it and put three time counters on it. If you do, exile up to one target creature and put three time counters on it"): it is that action's object.
  const apart = stop(a) < b;
  let joinAt = -1;
  if (!apart) {
    const join = /(?<=\s)and\s+(?=(?:an?|one|two|three|four|five|x|\d+)\s)/i.exec(text.slice(a, b));
    if (!join) return text;
    joinAt = a + join.index;
  }
  const first = apart ? text.slice(a, stop(a)) : text.slice(a, joinAt).trimEnd();
  const second = text.slice(b, stop(b));
  if (apart && !/^counters?\s+on\s+(?:this\s+(?:creature|permanent|artifact|enchantment|land|planeswalker|vehicle|card)|it)$/i.test(second.trimEnd())) return text;
  // How many of the actions each phrase covers: the counter words from the start of its sentence (or after the join) up to and including its own "counter(s) on". Two actions are one each, as before.
  const counterWords = (span: string): number => span.split(/\s+/).filter((w) => /^counters?$/i.test(w)).length;
  const sentenceStart = Math.max(text.lastIndexOf(".", a), text.lastIndexOf(":", a), text.lastIndexOf(";", a)) + 1;
  const g1 = mine.length === 2 ? 1 : counterWords(text.slice(sentenceStart, a)) + 1;
  const g2 = mine.length === 2 ? 1 : counterWords(text.slice(apart ? stop(a) + 1 : joinAt + 3, b)) + 1;
  if (g1 + g2 !== mine.length) return text;
  const phraseOf = own < g1 ? 0 : 1;
  const phrases = [first, second];
  // The nearest preceding action of the phrase's first counter: a pronoun phrase takes that action's object when it names the card or a target.
  const recipient = (ph: string, firstAction: Action): string => {
    if (!/^counters?\s+on\s+it$/i.test(ph.trimEnd())) return ph;
    const before = actions[actions.indexOf(firstAction) - 1];
    const obj = (before?.object ?? "").trim();
    if (!before || before.verb === "add-counter" || !(/^this (?:creature|permanent|artifact|enchantment|land|planeswalker|vehicle|card)$/i.test(obj) || /^(?:up to \w+ )?target\b/i.test(obj))) return ph;
    // Start-anchored (an unanchored leading `\s+` before a literal tail is CodeQL js/polynomial-redos, #1358).
    return ph.replace(/^(counters?\s+on\s+)it$/i, (_m, head: string) => `${head}${obj}`);
  };
  if (apart && /^counters?\s+on\s+it$/i.test(second.trimEnd()) && (actions[actions.indexOf(mine[g1]!) - 1]?.verb === "add-counter" || recipient(second, mine[g1]!) === second)) return text;
  const rewritten = recipient(phrases[phraseOf]!, mine[phraseOf === 0 ? 0 : g1]!);
  return phrases.reduce((t, ph, i) => (i === phraseOf ? t.replace(ph, rewritten) : t.replace(ph, "")), text);
}
/** "put a +1/+1 counter on that creature and each other creature you control that shares a creature type with it" (#1401 part 4, Invasion of New Capenna): ONE counter phrase whose recipient list
 *  names two objects, and two add-counter actions. The nth action reads the text with the other recipient cut out. CEILING: exactly two actions and one phrase, split at the first "and" that
 *  starts a second recipient ("each", "all", "another", "target", "up to", "other"); a qualifier on the second recipient ("shares a creature type") stays in its words and is not a field. */
function splitOneRecipientList(text: string, a: number, end: number, own: number): string {
  const head = /^counters?\s+on\s+/i.exec(text.slice(a))![0].length;
  const words = text.slice(a + head, end).split(" ");
  const RECIPIENT_HEAD = new Set(["each", "all", "another", "target", "up", "other"]);
  const k = words.findIndex((w, i) => i > 0 && w === "and" && RECIPIENT_HEAD.has(words[i + 1] ?? ""));
  if (k < 0) return text;
  const firstLen = words.slice(0, k).join(" ").length;
  const tailStart = a + head + firstLen + " and ".length;
  return own === 0 ? text.slice(0, a + head + firstLen) + text.slice(end) : text.slice(0, a + head) + text.slice(tailStart);
}
function counterOnSelf(verb: string | undefined, text: string, cardName?: string, triggerIsSelf = false): boolean {
  if (verb === "adapt" || verb === "monstrosity") return true;
  if ((verb !== "add-counter" && verb !== "remove-counter") || !text) return false;
  const prep = verb === "remove-counter" ? "from" : "on";
  const re = verb === "remove-counter" ? COUNTER_FROM : COUNTER_ON;
  // Every face, by the SHORT name the card's own text uses ("on Lonis", never "on Lonis, Genetics
  // Expert") -- the same miss `counterTriggerOnSelf` had until DERIVE 156.
  const named = (cardName ?? "").split(" // ").some((face) => {
    const short = face.split(",")[0]!.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return short !== "" && new RegExp(`\\bcounters?\\s+${prep}\\s+${short}\\b`, "i").test(text);
  });
  const onThis = re.onThis.test(text) || named;
  // "on it" is the card only when nothing else in the clause could be "it": "This creature enters
  // with two +1/+1 counters on it" is self, and so is a self-triggered "when this creature attacks,
  // put a counter on it"; "whenever a nontoken creature you control enters, put a +1/+1 counter
  // on it" (The Great Henge) is that creature -- the panel's Henge -> Dusk Legion Duelist REAL
  // pair was unjoined by reading it as self on the first derive-153 run.
  // "As this creature enters [or is turned face up], put X +1/+1 counters on it": the lead-in names the card, so "it" is the card (Crowd-Control Warden).
  const lead = text.replace(/^as (?:this (?:creature|permanent|artifact|enchantment|land|planeswalker|vehicle)|~) enters(?: or is turned face up)?, /i, "");
  const onIt = re.onIt.test(text) && !OTHER_OBJECT.test(text)
    && (triggerIsSelf || lead !== text || /^this (?:creature|permanent|artifact|enchantment|land|planeswalker|vehicle)\b/i.test(text));
  if (!onThis && !onIt) return false;
  // THE CARD'S OWN NAME IS NOT "THE OTHER ONE" (DERIVE 173, overview item 8): `onOther` reads "counters
  // on THE Ozolith" as "on the <something>", so The Ozolith's own counters went kindless and fed The
  // Earth Crystal's creature-only doubler. The own-name phrase is taken out before that test.
  const rest = named
    ? (cardName ?? "").split(" // ").reduce((t, face) => {
        const short = face.split(",")[0]!.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return short === "" ? t : t.replace(new RegExp(`\\bcounters?\\s+${prep}\\s+${short}\\b`, "gi"), " ");
      }, text)
    : text;
  return !re.onOther.test(rest);
}

/** A permanent that ENTERS under a controller named only by REFERENCE — "the owner of target
 *  permanent … THEY put it onto the battlefield", "ITS CONTROLLER may search THEIR library" — off
 *  ANOTHER PLAYER'S library (roadmap I7).
 *
 *  WHY IT IS A REFUSAL AND NOT A BETTER `control` VALUE. `SubjectFilter.control` is {you, opp, any}
 *  and the printed fact is "whoever owns the target", which is none of them — Chaos Warp aimed at
 *  your own permanent gives YOU the new one. `any` is the worst of the three, because
 *  `matcher/subject.ts` reads it as a PERMISSION: it satisfies a `you` demand and an `opp` demand
 *  alike, so Chaos Warp claimed to put every creature in your deck onto the battlefield. Measured on
 *  `eggman`: thirteen rows of the shape "When Coalstoke Gearhulk enters thanks to Chaos Warp, it
 *  brings a card back", which is false twice over — the card that enters is a RANDOM top card, and
 *  it enters under the target owner's control. Same resolution `replacement.restricted` and C7's
 *  `SubjectFilter.restricted` both reached: keep the ability, claim no cards.
 *
 *  TWO EXCLUSIONS, EACH FOUND BY READING A CARD THAT WOULD OTHERWISE LOSE A REAL CLAIM:
 *  - "under your control" — Curse of Unbinding reveals off the ENCHANTED PLAYER's library and then
 *    says "Put that card onto the battlefield under your control". The creature really is yours.
 *  - "your library" — Demolition Field and Tempt with Discovery each have TWO puts, one off an
 *    opponent's library and one off yours, and the clause layer records no owner per action, so a
 *    card-level refusal would delete the real half. Over-claiming on one card beats deleting a true
 *    claim, which is the correct direction when REMOVING.
 *  "Each player searches their library" (Field of Ruin) falls out for free: it names no antecedent
 *  controller, so the first cue never fires on it.
 *
 *  MEASURED: 73 corpus cards match the library half and 8 are derived; the exclusions take it to
 *  FIVE — Chaos Warp, Cleansing Wildfire, Assassin's Trophy, Sundering Eruption and Path to Exile —
 *  sitting in 26, 1, 2, 21 and 6 of the 71 decks. */
const ANTECEDENT_CONTROLLER =
  /\b(?:the owner of|its owner|its controller|that (?:land's |permanent's |creature's )?controller|that player)\b/i;
const FROM_THEIR_LIBRARY =
  /their librar(?:y|ies)[^.]{0,120}?\.?[^.]{0,120}?puts? (?:it|them|that card|those cards) onto the battlefield/i;

export function entersUnderAnotherPlayer(cardText: string): boolean {
  if (!ANTECEDENT_CONTROLLER.test(cardText) || !FROM_THEIR_LIBRARY.test(cardText) || POLYMORPH_REVEAL.test(cardText)) return false;
  return !/under your control/i.test(cardText) && !/your librar(?:y|ies)/i.test(cardText);
}

/** THE POLYMORPH FAMILY IS READ AS PLAYED (owner ruling 2026-10-02, #962): "you would primarily use
 *  it for that". A target creature traded for a creature its controller REVEALS (Polymorph,
 *  Transmogrify, Proteus Staff, Chaos Mutation, Divergent Transformations) is played on your own
 *  creature, so the creature removed and the creature put down are both yours. Removal-first shapes
 *  print something else and stay refused above: Chaos Warp reveals ONE card of any permanent type,
 *  Path to Exile hands over a basic land, Blessed Reincarnation names "an opponent controls".
 *  CEILING: the opponent use is real and dropped, the way Path to Exile's self-ramp is. */
const POLYMORPH_REVEAL = /\b(?:its|that creature's) controller reveals cards from the top of their library until they reveal a creature card\b/i;

/** "your library", "their library", "that player's library": a search object that names a library and no card. */
const BARE_LIBRARY = /^(?:your|their|its|that player's|target opponent's) library$/i;
/** A pronoun-ish object that points back at the card a search found or the spell a counter countered ("it", "them", "that card", "those cards", "the card", "that spell"; "it into your hand" is how some clauses are stored). */
const FOUND_OBJECT = /^(?:it|them|one|that card|those cards|the card|that spell)$/i;
/** The zone phrase the stored object sometimes carries: "it into your hand", "up to two basic land cards onto the battlefield tapped", "those cards on top in any order". */
// Cut at the FIRST " onto/into/on/in ", found by a bounded search and sliced. `.replace(/ (?:on|in)\s.*$/)` rescanned to the end from every
// " in ", which CodeQL flagged as polynomial (#1304); `\s+` before it was quadratic on a run of spaces (#1301 review).
const ZONE_WORD = / (?:onto|into|on|in)\s/i;
const withoutZoneTail = (s: string): string => { const at = s.search(ZONE_WORD); return at < 0 ? s : s.slice(0, at); };
/** "put a card named Ezio into your hand": the searched card, by name (the planeswalker-named wizards, "search your library and/or graveyard"). */
const NAMED_FOUND = /^(?:an? )?card named /i;
/** "The rest", "the other(s)", "the remaining cards": what a dig leaves after the part it took. */
const DIG_REMAINDER = /^the (?:rest|others?|remaining cards?)\b/i;

/** THE PUT THAT IS ANOTHER EFFECT'S DESTINATION (#1301). Called for every `put`; sets `toZone` on the search or counter it follows, and returns true when an
 *  ORPHAN put (`unclaimed`: it derived no event of its own) is claimed here:
 *  - SEARCH or COUNTER DESTINATION. "Search your library for a card, reveal it, put it into your hand" and "Counter target spell. If that spell is countered
 *    this way, put it on top of its owner's library instead": the put's object refers back (`antecedentSource`) to a search or counter-spell action of the
 *    same clause that made an ability, and the put's zones are that effect's (library>X for a search, stack>library for a counter). A search's put may leave its origin unstated
 *    (the stored model answer often does where the grammar reads library), and a NAMED put ignores it (Ral's Dispersal: hand>hand); a card that differs between the two
 *    readings stays on the model answer (derive-worker's switch). An exile>hand put (Distant Memories) is not a search's destination and is left alone. The ability gets
 *    `toZone`; the put is its destination and not a second event. A second put naming the same search with a DIFFERENT destination is claimed
 *    too and leaves the first destination in the field. Boseiju's opponent-owned search sets it too: the field says where
 *    the card goes, and `subject`/emits keep whose search it is.
 *  - DIG REMAINDER. "Look at the top five cards, put one into your hand, put the rest on the bottom of your library": a library>library put of "the
 *    rest" beside another action out of the library is the dig's remainder. It carries no event of its own (the bottom is not an event anything
 *    watches; a top put is `top-set` and never reaches here), so it is claimed with no emit and no field.
 *  CEILING: a search that splits its cards over two destinations (Cultivate: one onto the battlefield, the other into your hand; Gifts Ungiven) holds the FIRST destination
 *  only; the second put is claimed (when it derives nothing) with no field. A conditional alternative ("Otherwise, put it into your hand",
 *  "... onto the battlefield instead") holds the first PRINTED destination too: Archdruid's Charm and Treasure Chest read `battlefield`, Celestial
 *  Reunion `hand`, though the other branch is the common one.
 *  CEILING: the remainder needs a sibling action from the library, not a derived ability: Impulse derives nothing (its "put one into your hand" is untyped) and
 *  its remainder is claimed all the same, so the card still reports the put that matters. A remainder with no such sibling stays unclaimed. */
function claimedAsDestination(action: Action, actions: readonly Action[], source: { to: string; action?: number }, owners: ReadonlyMap<number, Ability[]>, unclaimed: boolean): boolean {
  const object = withoutZoneTail((action.object ?? "").trim());
  const at = actions.indexOf(action);
  // The searched card named or described again: "put a card named Ezio into your hand", "put a basic land card onto the battlefield" (the search's own "a basic land card").
  // The nearest earlier search is its search.
  const lastSearch = actions.slice(0, at).map((o) => o.verb).lastIndexOf("search");
  const byName = lastSearch >= 0 && NAMED_FOUND.test(object);
  const named = byName || (lastSearch >= 0 && object.length > 4 && (actions[lastSearch]!.object ?? "").toLowerCase().includes(object.toLowerCase())) ? lastSearch : -1;
  const target = FOUND_OBJECT.test(object) && source.to === "action" && source.action !== undefined ? source.action : named;
  if (target >= 0) {
    const from = actions[target];
    // "Search your library AND/OR graveyard" is two search actions (one per zone) of ONE search: the run of searches ending at the target.
    let first = target;
    while (from?.verb === "search" && first > 0 && actions[first - 1]?.verb === "search") first--;
    const found: Ability[] = [];
    for (let i = first; i <= target; i++) found.push(...(owners.get(i) ?? []));
    const zoneOk = from?.verb === "search"
      ? (byName || !action.fromZone || action.fromZone === "library") && (action.toZone === "hand" || action.toZone === "battlefield" || action.toZone === "graveyard" || action.toZone === "library")
      : (action.fromZone === "stack" || !action.fromZone) && action.toZone === "library";
    if (found.length > 0 && zoneOk) {
      // The FIRST destination is what the field holds; a later put with another one (Guidelight Pathmaker's "otherwise, put it into your hand") is still the search's destination, claimed with no field.
      for (const a of found) a.toZone ??= action.toZone as NonNullable<Ability["toZone"]>;
      return unclaimed;
    }
    return false;
  }
  return unclaimed && DIG_REMAINDER.test(object) && action.fromZone === "library" && action.toZone === "library"
    && actions.some((o) => o !== action && o.fromZone === "library" && !DIG_REMAINDER.test((o.object ?? "").trim()));
}

/** Verbs that state no action at all; they are inert, not unclaimed. */
export const INERT_VERBS: ReadonlySet<string> = new Set(["none"]);

/** The persisted shape of an unclaimed action (`CardTags.unclaimed`): the clause, the verb, the object and the zones it states. */
function unclaimedRecord(clause: number | string, a: Action): UnclaimedAction {
  return { clause, verb: a.verb ?? "?", ...(a.object ? { object: a.object } : {}), ...(a.fromZone ? { fromZone: a.fromZone } : {}), ...(a.toZone ? { toZone: a.toZone } : {}) };
}

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

/** Does the ability's effect or any emit carry `ref: "trigger"` -- the object a trigger's event was
 *  about? Only a trigger can define it, so on an ability with no trigger it points at nothing. */
function namesTriggerObject(a: Ability): boolean {
  const has = (o: unknown): boolean => o !== null && typeof o === "object"
    && ((o as { ref?: unknown }).ref === "trigger" || Object.values(o as object).some(has));
  return has(a.effect) || has(a.emits);
}

/** Does some `ref: "trigger"` subject of the ability name NO class -- nothing beyond who controls it,
 *  whether it is a token, a count scope and its zone? "it gains deathtouch" over a refused "attacks
 *  alone" is `{control: any}`: every permanent. A subject that keeps a type, subtype, keyword, counter
 *  or the like has an exact class, and a refusal that only read timing or a count ("second spell each
 *  turn", "deals damage to you") leaves that class intact (owner ruling, #1253). */
const CLASSLESS_KEYS: ReadonlySet<string> = new Set(["ref", "control", "token", "scope", "zone", "fromZone"]);
function triggerObjectClassless(a: Ability): boolean {
  const found: object[] = [];
  const walk = (o: unknown): void => {
    if (o === null || typeof o !== "object") return;
    if ((o as { ref?: unknown }).ref === "trigger") found.push(o);
    for (const v of Object.values(o as object)) walk(v);
  };
  walk(a.effect); walk(a.emits);
  return found.some((o) => Object.keys(o).every((k) => CLASSLESS_KEYS.has(k)));
}

/** Is the trigger subject the thing the event happens TO, standing before the event verb in the printed
 *  sentence? Hedron Blade's stored subject is "one or more colorless creatures" -- the BLOCKERS, after
 *  "becomes blocked by" -- while its "it" is the equipped creature, so the subject's class must not be copied
 *  onto the grant (#1253). A subject that does not appear in the text at all is not trusted either. */
function triggerSubjectPrecedesEvent(text: string, subject: string): boolean {
  const lower = text.toLowerCase(), at = lower.indexOf(subject.trim().toLowerCase());
  if (at < 0) return false;
  const by = lower.search(/\b(?:blocked by|blocks)\b/);
  return by < 0 || at < by;
}


/** "Whenever a creature deals damage to YOU, destroy it": the damager is an opponent's (owner ruling,
 *  #1253). CEILING: your own creature can deal you damage (a Fireblast-style self-hit). */
const DEALS_DAMAGE_TO_YOU = /\bdeals (?:combat |noncombat )?damage to you\b/i;

function abilityKind(clause: ClauseRecord): AbilityKind {
  return CLAUSE_TO_ABILITY_KIND[clause.abilityType ?? ""] ?? "static";
}

/** A clause that states a trigger and nothing else: a modal ability's header ("Whenever X enters or attacks, choose one —"). */
const triggerHeaderOnly = (c: ClauseRecord): boolean => abilityKind(c) === "triggered" && !!c.trigger?.event && (c.actions ?? []).every((a) => !a.verb || a.verb === "none");
/** A mode bullet: triggered, and stating no trigger of its own. */
const modeBullet = (c: ClauseRecord): boolean => abilityKind(c) === "triggered" && !c.trigger?.event;
interface ClauseVisit { clause: ClauseRecord; /** The header clauses a mode is read under, one visit each; absent for a single-trigger header. */ group?: ClauseRecord[]; k?: number }
/** The order clauses are derived in, and how often. A modal header with more than one trigger ("enters or attacks": Captain Kirk, Appa, Galadriel,
 *  Elder Gargaroth) is several header-only records. The grammar appends the second AFTER the card's last clause, so it is moved up beside its first
 *  (found by having no text of its own in `segment()`'s numbering, as the grammar's overflow records have none); then every mode bullet that follows
 *  is visited once per header, the way a non-modal "enters or attacks" ability splits into one ability per trigger (#1349 review). */
function modeVisits(clauses: ClauseRecord[], clauseTexts?: Record<number, string>): ClauseVisit[] {
  const ordered = [...clauses];
  if (clauseTexts) {
    // CEILING: a twin is found by having NO text in `segment()`'s numbering (the grammar's overflow records have none), so a grammar change that
    // gave them text stops the grouping silently. Twins are paired to modal headers IN ORDER (the grammar appends overflow in header order); when the
    // counts disagree (a single-trigger modal header beside a multi-trigger one) nothing is moved, and the mode reads under its nearest header only.
    const modalHead = (i: number): boolean => {
      if (!triggerHeaderOnly(clauses[i]!) || clauseTexts[clauses[i]!.id as number] === undefined) return false;
      let j = i + 1;
      while (j < clauses.length && triggerHeaderOnly(clauses[j]!) && clauseTexts[clauses[j]!.id as number] === undefined) j++;
      return j < clauses.length && modeBullet(clauses[j]!);
    };
    const heads = clauses.filter((_, i) => modalHead(i));
    const textless = (c: ClauseRecord): boolean => triggerHeaderOnly(c) && clauseTexts[c.id as number] === undefined;
    const besideHead = (i: number): boolean => { let j = i - 1; while (j >= 0 && textless(clauses[j]!)) j--; return j >= 0 && j < i - 0 && triggerHeaderOnly(clauses[j]!) && j !== i; };
    const twins = clauses.filter((c, i) => textless(c) && !besideHead(i));
    if (twins.length > 0 && twins.length === heads.length) {
      twins.forEach((twin, n) => {
        const head = heads[n]!;
        if (head.trigger?.event === twin.trigger?.event) return;
        ordered.splice(ordered.indexOf(twin), 1);
        let to = ordered.indexOf(head) + 1;
        while (to < ordered.length && triggerHeaderOnly(ordered[to]!) && clauseTexts[ordered[to]!.id as number] === undefined) to++;
        ordered.splice(to, 0, twin);
      });
    }
  }
  const out: ClauseVisit[] = [];
  let group: ClauseRecord[] = [];
  let previousWasHeader = false;
  for (const c of ordered) {
    // A twin has no text of its own; two headers that each print a sentence ("..., you may pay {1}. When you do, choose one") are not one trigger's limbs.
    // ...or two records of ONE id with different events (the model's "attacks or dies" header, Balor: both limbs have the sentence's text, #1391).
    if (triggerHeaderOnly(c)) { group = previousWasHeader && (clauseTexts?.[c.id as number] === undefined || (group.at(-1)!.id === c.id && group.at(-1)!.trigger?.event !== c.trigger?.event)) ? [...group, c] : [c]; previousWasHeader = true; out.push({ clause: c }); continue; }
    previousWasHeader = false;
    if (modeBullet(c) && group.length > 1) { for (let k = 0; k < group.length; k++) out.push({ clause: c, group, k }); continue; }
    if (!modeBullet(c)) group = [];
    out.push({ clause: c });
  }
  return out;
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
 *  `damage-dealt`, `main-phase`, `chapter` and friends have no engine verb at all and
 *  are deliberately absent: they surface in `unknownTriggers` rather than pick a near-miss. */
const CLAUSE_TRIGGER_TO_VERB: Record<string, Verb> = {
  "life-gained": "gain-life",
  "life-lost": "lose-life",
  sacrificed: "sacrifice",
  discarded: "discard",
  milled: "mill",
  // The eerie half: "whenever you fully unlock a Room". 35 clause docs carry it; every Room supplies
  // it by being one (`impliedEvents`).
  unlocked: "unlock",
  // ORIGIN-BLIND BY DESIGN (CR 703/116 sweep, 2026-08-20). `dies`, `milled` and `discarded` split
  // one event by where the card came FROM; "put into a graveyard from anywhere" is the union, which
  // is precisely what `enters-graveyard` already means to the matcher — `normalizeZoneEvent` derives
  // it for all three origins. Mapping it to any one of them would be a narrower claim than the card
  // makes: Syr Konrad, the Grim watches the battlefield, the library AND the graveyard's exits.
  "put-into-graveyard": "enters-graveyard",
  // CR 701.7. The clause layer names the ACTION ("create"), the engine names the EVENT the matcher
  // keys on -- and `create-token` is the verb every token maker already emits, so a payoff watching
  // creation and a card creating one meet on the same tag. Added 2026-08-21 with the TRIGGERS entry;
  // without this the event would derive to nothing and land in `unknownTriggers`.
  create: "create-token",
  // CR 701.5, 2026-09-09 (AC7). The clause word is the passive `countered`; the engine event is the
  // action's own name, which the 361 counterspells emit.
  countered: "counter-spell",
  // AC11 batch 2: the passive clause words for the CR 4xx/7xx object events.
  shuffled: "shuffle",
  // Two clause spellings of one event (both legal since 2026-08-15); the engine has one name.
  "roll-dice": "dice-rolled",
  // THE RECEIVING SIDE OF DAMAGE (AF7d, 2026-09-16). The clause word has existed since the 09-09
  // trigger walk; the engine verb is the same word. The older `damage-dealt` spelling of the same
  // fact is split by `DAMAGE_RECEIVED` in the branch below.
  damaged: "damaged",
  // A card put into exile (AF7b, 2026-09-16); every exile action emits it.
  exiled: "exiled",
};

/** "Whenever this creature IS DEALT damage" (Hornet Nest, Flumph, Boros Reckoner) — the receiving
 *  side, stored under `damage-dealt` before the clause word `damaged` existed. 20 of the 180
 *  `damage-dealt` clauses; the engine verb is `damaged` since 2026-09-16. */
const DAMAGE_RECEIVED = /\b(?:is|are|becomes?) dealt\b/i;
/** "At the beginning of the next end step, sacrifice those tokens." as a clause of its own. */
const NEXT_END_STEP_CLEANUP = /^at the beginning of the next end step, (sacrifice|exile) (?:those tokens|them|it|that token|the tokens?|those copies|the cop(?:y|ies)|that copy)\.?$/i;
/** A token that LEAVES THE SAME TURN IT ARRIVED — see `Ability.temporary`. Three printed shapes,
 *  and the third is only reachable by NAME.
 *
 *  1. END STEP / END OF TURN — "Exile it at the beginning of the next end step" (Inalla, Cogwork
 *     Assembler, Flameshadow Conjuring), "Exile them" (Chandra, Flamecaller). 227 corpus cards.
 *  2. END OF COMBAT — "Sacrifice that token at end of combat" (Geist of Saint Traft, Kavaron
 *     Harrier, Phantom Steed, Mirror Match, Altaïr Ibn-La'Ahad, Mirror Mockery). 20 corpus cards
 *     survive reminder-stripping with an explicit cue. Several more in that population sacrifice
 *     THEMSELVES rather than a token (Mardu Blazebringer, Keldon Battlewagon); the
 *     `token-generation` gate at the call site excludes them.
 *  3. DECAYED (CR 702.147) — "can't block. When it attacks, sacrifice it at end of combat." OWNER'S
 *     CATCH, 2026-08-22: the family is wider than the end-step wording, and decayed is the sharp
 *     case because **`segment.ts` STRIPS REMINDER TEXT**, so the sentence that says what decayed
 *     MEANS is gone by the time derive sees the clause. What survives is the keyword's NAME, so the
 *     name is what this matches — the same move `keywordEvents` makes for cycling, where the
 *     reminder text IS the ability. 19 corpus cards, 16 of them token makers.
 *
 *  Anchored on the token pronoun in shapes 1 and 2 so a clause that exiles something ELSE at end of
 *  turn cannot match. "sacrifice" sits beside "exile" because the family splits on the MANNER and
 *  what undermines a go-wide plan is the LEAVING, not how it happens. */
// LIVES IN emits.ts since 2026-09-16 (AF7b): the same rider must also refuse an `exiled` emit.
/** Shape 3, matched on the keyword's NAME because its reminder text is stripped before derive. */
const DECAYED = /\bwith decayed\b/i;
/** Combat vs noncombat, read off the clause the trigger sits in. Plural "deal combat damage" counts:
 *  "whenever one or more creatures you control deal combat damage" is the same event. */
const COMBAT_DAMAGE = /\bcombat damage\b/i;

/** Normalize a trigger event through VERB_ALIASES, then check it against the closed VERB_VOCAB.
 *  A near-miss spelling that survives uncorrected (e.g. "die" instead of "dies") means the trigger
 *  silently never matches any producer event -- dead with no error, since triggers have no
 *  `unclaimed`-style safety net of their own. Returns null for anything illegal so the caller can
 *  omit the trigger rather than assert a verb the vocabulary doesn't recognise. */
export function normalizeTriggerVerb(event: string): Verb | null {
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
  const subject = damageRecipient(loss.object ?? "") ?? parseSubject(loss.object ?? "");
  const keepSubject = kind !== "static" || namesItsTargets(subject);
  const ability: Ability = { kind, effect: keepSubject ? { kind: "drain", subject } : { kind: "drain" } };
  if (trigger) ability.trigger = trigger;
  // No `amount`: a drain merges two source actions (the loss and the gain), and no single amount is
  // attributable to the merged ability -- guessing one would be the wrong-sentence-dressed-as-data
  // failure this project refuses everywhere else (see threshold.ts's header).
  if (clause.abilityType === "activated") ability.cost = cost;
  return ability;
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
export function stripCardName(text: string, cardName?: string): string {
  if (!cardName || text === "") return text;
  const forms = new Set<string>();
  for (const face of cardName.split(" // ")) {
    forms.add(face);
    forms.add(face.split(/[,/]/)[0].trim());
    // A card with no comma still shortens itself ("Imskir Iron-Eater" says "Imskir"), but never when
    // that first word is a real creature type: Goblin Bombardment watching Goblins is a typal payoff,
    // and stripping the word would delete the deck it is built for.
    // AN ARTICLE IS NOT A NAME (DERIVE 172): "The Sackville-Bagginses" shortens by dropping "The",
    // and taking "The" as the short form deleted every "the" in the card's clause text.
    forms.add(withoutArticle(face));
    const first = face.split(/\s+/)[0];
    if (!SUBTYPES.has(first.toLowerCase()) && withoutArticle(face) === face) forms.add(first);
  }
  let out = text;
  for (const f of [...forms].filter((f) => f !== "").sort((a, b) => b.length - a.length)) {
    // WORD-BOUND (#1352 review): "Command Tower" stripped "Command" out of "commander's" ("er's"), "Me, the Immortal" took the "me" out of "menace", "Chant of the Skifsang" the
    // "en" out of "enchanted", "I Am Iron Man" every "i" out of "artifact". A name is whole words, as `selfAsTilde` bounds it, and its possessive ("Beast of Burden's") is still the name.
    out = out.replace(new RegExp(`(?<![\\w'])${f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\w|'(?!s\\b))`, "gi"), " ");
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Both corrections above, at the one place a subject becomes structured.
 *
 *  THE FILTER GRAMMAR FIRST (#896 task 3). It answers only when it read every word, on the shape it
 *  was measured on -- the card's name written "~", as the phrase census writes it -- and `parseSubject`
 *  answers whatever it refuses, on the name-stripped text as before. Every phrase where the two
 *  differ was read and labelled (`packages/tagger/grammar-triage.json`). */
/** Subjects the filter grammar produced. A gate that asks "does this name a class" sees through `anyOf`
 *  only for these: the grammar's alternatives are reviewed readings, while an `anyOf` `parseSubject`
 *  builds out of a clause ("enchanted creature or Vehicle loses all other card types", Swift
 *  Reconfiguration) is a misread the gates refused before and still refuse. */
const FROM_GRAMMAR = new WeakSet<object>();
const namesAClassHere = (s: SubjectFilter): boolean => s.type !== undefined || s.subtype !== undefined || (FROM_GRAMMAR.has(s) && namesAClass(s));

/** MEMOIZED (G-T3): a dual derive (stored answer, then a grammar-complete card's own records)
 *  calls `subjectFrom` with the same trigger-subject text twice, each time reaching the filter
 *  grammar's `parse()`. Cloned on every hit: `subjectFrom` below writes `.named`, `.notNamed` and
 *  `.control` onto whatever `parse()` hands it, and a shared cached object would leak one card's
 *  edit into the next lookup of the same text. */
const parseFilter = memoizeCloned(parseFilterRaw, (text) => text);

function subjectFrom(text: string, cardName?: string, cardText = ""): ReturnType<typeof parseSubject> {
  const bounded = boundedByEnchantLine(text, cardText).replace(SELF_DISJUNCT, "");
  const read = parseFilter(cardName ? selfAsTilde(bounded.trim(), cardName) : bounded.trim());
  // A COUNT the grammar reads past leaves no class ("cards equal to the greatest power among creatures
  // you control"): the amount is scaling's (task 6), and `parseSubject`'s reading of it stays.
  const grammar = read && !namesAClass(read) && read.token !== true && /\b(?:equal to|for each)\b/i.test(bounded) ? null : read;
  const subject = grammar ?? parseSubject(stripCardName(bounded, cardName));
  if (grammar) FROM_GRAMMAR.add(subject);
  // "named ~" is the card's own name (Gary Clone's "each creature you control named Gary Clone").
  if (cardName && subject.named === "~") subject.named = cardName.split(" // ")[0]!.toLowerCase();
  if (cardName && subject.notNamed === "~") subject.notNamed = cardName.split(" // ")[0]!.toLowerCase();
  // A CARD has an owner and no controller (CR 108.3, CR 108.4): derive and the matcher say whose a card
  // off the battlefield is with `control`, as `parseSubject` always did ("two cards your opponents
  // own" -> control opp). The grammar keeps `owner`, and the card's owner is also its `control` here.
  if (grammar?.owner && grammar.control === "any" && /\bcards?\b/i.test(bounded) && !/\bpermanents?\b/i.test(bounded)) subject.control = grammar.owner;
  // "this creature OR another creature you control" includes the card: once the self half is
  // stripped the remainder reads as `other`, and it is not.
  if (SELF_DISJUNCT.test(text)) delete subject.other;
  return subject;
}

/** Verbs whose object is the thing being multiplied, so a narrowing inside it decides WHICH cards
 *  the multiplier touches. */
const MULTIPLIER_VERBS: ReadonlySet<string> = new Set(["double", "triple"]);

/** Printed narrowings no `SubjectFilter` can hold: a counter PRESENCE (CR 700.9's `modified` is
 *  demand-only and names no kind) and an ATTACHMENT (the Equipment's own host). Both are checkable
 *  by a player and not by this engine. */
const UNEXPRESSIBLE_NARROWING = /\bwith counters on (?:them|it)\b|\bequipped creature\b|\benchanted creature\b/i;

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
  // "THEIR" AFTER COMBAT DAMAGE TO A PLAYER IS THE DAMAGED PLAYER, an opponent (#729): Soundwave and
  // Froghemoth exile "from their graveyard". Only when the clause EXILES (a taking): "that player returns
  // a card from their graveyard" (Neyam Shai Murad) gives their own card back to them. Other "their"
  // wordings (each player, target player) name no one and stay `any`.
  [/\bcombat damage to a player\b[^.]*?,\s*exile\b[^.]*?\bfrom their/i, "opp"],
];

/** An object that names whose zone it is in: "from their graveyard", "from that player's graveyard". */
const OBJECT_NAMES_AN_OWNER = /\b(?:from|in) (?:your|their|that player's|target (?:player|opponent)'s|an opponent's|each opponent's|its owner's)\b/i;

function zoneOwner(clauseText: string, zone: string | null | undefined, triggerIsSelf = false, cardName?: string, objectText?: string): Control | undefined {
  if (!zone || clauseText === "") return undefined;
  if (zone === "graveyard" && /\bfrom that player's graveyard\b/i.test(clauseText) && damagedPlayerIsOpponent(clauseText, triggerIsSelf, cardName)) return "opp";
  if (zone === "graveyard" && graveyardReplacement(clauseText)?.kind === "hate" && graveyardReplacement(clauseText)?.whose === "opp") return "opp";
  for (const [re, control] of ZONE_OWNER) {
    // Anchored on the ZONE the action names, so "return it to your hand" cannot be read as a claim
    // about whose graveyard was searched.
    const m = clauseText.match(new RegExp(`${re.source}\\s+${zone}`, "i"));
    if (m) return control;
  }
  // "Choose two target creature cards IN your graveyard" (Victimize, #1253): the same owner, said with "in".
  // Read off the ACTION'S OBJECT first (Daretti, Wake to Slaughter carry it there); the clause only when the
  // object names no owner of its own ("the chosen cards"), so Neyam Shai Murad's "that player returns a card
  // from THEIR graveyard" does not borrow the "in your graveyard" of its second action.
  const inYour = new RegExp(`\\bin your\\s+${zone}`, "i");
  if (objectText !== undefined && (inYour.test(objectText) || (!OBJECT_NAMES_AN_OWNER.test(objectText) && inYour.test(clauseText)))) return "you";
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
/** `(.*?\S)` rather than `(.*?)`: a lazy `.` matches a space and so does the `\s+` after it, so
 *  every space was a fork the engine paid for on a clause that never reaches "have". Forcing the
 *  recipient to end on a non-space removes the overlap. The capture is unchanged — lazy already
 *  preferred the shortest recipient, which is the one ending on a non-space. */
const GRANTED_TO = /^(.*?\S)\s+\b(?:have|has|gain|gains)\b/i;
/** A single card type that is the whole board rather than a class of it. "Creatures you control"
 *  reaches every creature in the deck (the ordinary-card claim), "permanents" and "spells" wider
 *  still; every other lone type -- artifact, enchantment, land, planeswalker, battle -- names a
 *  class the deck can be searched for. */
const WHOLE_BOARD_TYPES: ReadonlySet<string> = new Set(["creature", "permanent", "spell", "card"]);
/** Does a grant's recipient name a CLASS of the deck, or the whole board? A subtype, a commander, a
 *  token class (the three the gate has always admitted), a legendary supertype, a conjunction of
 *  types ("artifact creatures"), or a lone type outside WHOLE_BOARD_TYPES. */
function boundedGrantClass(s: SubjectFilter): boolean {
  if (s.subtype !== undefined || s.commander === true || s.token === true) return true;
  if (s.legendary === true) return true;
  if ((s.allTypes?.length ?? 0) >= 2) return true;
  const types = Array.isArray(s.type) ? s.type : s.type ? [s.type] : [];
  return types.length === 1 && !WHOLE_BOARD_TYPES.has(types[0]!);
}
/** EVERY CREATURE YOU CONTROL IS A CLASS OF THE DECK FOR A STATIC GRANT (owner ruling 2026-09-28,
 *  #711): Anger's haste, Unctus's granted loot link to each creature they apply to -- the #561
 *  go-wide shape, and the #681 spell-grant one. A colour narrowing ("other blue creatures") counts.
 *  Read from the recipient TEXT, not the parsed subject, because "nontoken", "tapped" and "attacking"
 *  creatures parse to the same bare creature and stay refused; so do "all creatures" (anyone's
 *  board) and a one-shot grant, which the ruling does not cover.
 *
 *  STATIC BY ITS VERB, not by a list of durations (review): a static grant says "have"/"has", a
 *  one-shot one "gain(s)" whatever follows it -- "until end of turn", "until end of combat", or no
 *  duration at all on an activated "{T}: Creatures you control gain haste". Singular or plural:
 *  "each other creature you control has ward". One colour only; a colour LIST is left refused. */
// A HYPHENATED NEGATED SUBTYPE NARROWS TOO (#857): Mikaeus, the Unhallowed's "other non-Human
// creatures you control ... have undying" -- `parseSubject` keeps it as `notSubtype`. The unhyphenated
// "nontoken" stays refused, per the note above. And the grant may follow the anthem in one sentence:
// "get +1/+1 and have undying".
const EVERY_CREATURE_YOU_CONTROL = /^(?:each )?(?:other )?(?:non-[a-z]+ )?(?:(?:white|blue|black|red|green|colorless) )?creatures? you control$/i;
const STATIC_GRANT_VERB = /\bcreatures? you control (?:get [+-][\dX]+\/[+-][\dX]+ and )?(?:have|has)\b/i;
function everyCreatureYouControl(who: string, clauseText: string): boolean {
  return EVERY_CREATURE_YOU_CONTROL.test(who.trim()) && STATIC_GRANT_VERB.test(clauseText);
}
/** The words left of "can't be blocked" / "be blocked": the one that cannot be blocked (#1315). */
const CANT_BE_BLOCKED = /^(.*?\S)\s+(?:(?:can['\u2019]t|cannot)\s+)?be blocked\b/i;
/** Who cannot attack or block (#1315): the words ahead of "can't attack|block". */
const CANT_ATTACK_OR_BLOCK = /^(.*?\S)\s+(?:can['\u2019]t|cannot)\s+(?:attack|block)\b/i;
/** Who can't be targeted (#1423): the words ahead of "can't be the target(s) of". */
const CANT_BE_TARGETED = /^(.*?\S)\s+(?:(?:can['\u2019]t|cannot)\s+)?be the targets? of\b/i;
/** An Aura's or Equipment's host by any noun ("enchanted permanent", "enchanted land", "equipped creature"): the host is `Ability.host`, never a class (#1423). */
const HOST_WORD = /^(?:enchanted|equipped)\b/i;
/** A recipient that is a LIST ("players and permanents", "lands on the battlefield and land cards in graveyards") or holds another sentence's verb: the filter reads one class, so it is left unnamed. */
const RECIPIENT_LIST = /,| (?:and|or) |\b(?:can['\u2019]t|cannot)\b/i;
/** Who LOSES abilities: "Creatures lose all abilities", "Enchanted creature loses all abilities". */
const LOSES_ABILITIES = /^(.*?\S)\s+\bloses?\s+all\s+abilities\b/i;
/** The same defect one verb over. `copy` records the copy SOURCE as its object -- Shapesharer's
 *  "Target Shapeshifter becomes a copy of TARGET CREATURE" -- so the recipient, the half that names
 *  the subtype, is lost the way a grant's was. 122 corpus clauses carry a `copy` action. */
const COPIED_INTO = /^(.*?\S)\s+\bbecomes?\s+(?:a\s+copy|copies)\s+of\b/i;
// THE COST PREAMBLE NEVER CONTAINS A QUOTE. Springleaf Parade's "Creature tokens you control have
// \"{T}: Add one mana of any color.\"" matched the cost branch at the {T}: inside the GRANTED
// ability, which threw the recipient away with it (AC13, 2026-09-09).
const CLAUSE_PREAMBLE = /^(?:when|whenever|at)\b[^,]*,\s*|^[^:."\u201c]{1,60}:\s*/i;

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

/** Who a quoted ability was handed to. `target creature you control gains "When this creature
 *  dies, ..."`: the clause AFTER the quote is the granted ability, and the words BEFORE `gains "`
 *  on the same sentence name its recipient. Only a creature-shaped recipient is returned; a token
 *  or an emblem recipient is handled elsewhere (`grantedToOwnToken`, the emblem row). */
/** "…shares a creature type with this creature" / "…with <card name>": the class is the host's types. */
function sharesTypeWithHost(subjectText: string, cardName?: string): boolean {
  const m = /\bshares? a creature type with (.+)$/i.exec(subjectText);
  if (!m) return false;
  const who = m[1]!.trim().toLowerCase();
  return who === "this creature" || (cardName !== undefined && who === cardName.toLowerCase());
}
/** A Background's grant: "Commander creatures you own have '…'" (Folk Hero). */
const GRANTED_TO_COMMANDER = /\bcommander creatures? you (?:own|control) (?:have|has|gains?) "/i;

function grantedRecipientOf(cardText: string, clauseText: string): string | undefined {
  const head = clauseText.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // "gains" for a one-shot grant, "has"/"have" for a static one: Danny Pink's "Creatures you control
  // have 'Whenever one or more counters are put on this creature ...'" (2026-09-17).
  const m = new RegExp(`([^."\\n]{1,80}?)\\s+(?:gains?|has|have)\\s+"${head}`, "i").exec(cardText);
  if (!m) return undefined;
  const who = m[1]!.replace(/^.*?\b(?:until end of turn|this turn),\s*/i, "").trim();
  // A creature- or PERMANENT-shaped recipient. Hellish Rebuke hands "when this permanent deals
  // damage ... sacrifice this permanent" to PERMANENTS YOUR OPPONENTS CONTROL, so its sacrifice is
  // an opponent's permanent dying into THEIR graveyard, not the instant's own (recall v4 #28).
  if (!/\b(?:target|that|each|another)\b.*\b(?:creatures?|permanents?)\b|\b(?:creatures?|permanents?) (?:you|your opponents|an opponent) controls?\b/i.test(who)) return undefined;
  return who.replace(/^(?:choose )?/i, "");
}

function grantRecipient(clauseText: string): string | undefined {
  // "AS YOU CAST <spells> THIS TURN, THEY GAIN …" (Yidris, Maelstrom Wielder): the recipient is the
  // spells, and the pronoun the grant verb follows only points back at them (#681).
  const asYouCast = AS_YOU_CAST.exec(clauseText.replace(CLAUSE_PREAMBLE, ""))?.[1]?.trim();
  // "this turn" stripped with a string op, not an optional regex tail: a lazy capture beside an
  // optional `\s+this turn` is the polynomial shape CodeQL fails a PR on.
  if (asYouCast) return `${asYouCast.endsWith(" this turn") ? asYouCast.slice(0, -" this turn".length) : asYouCast} you cast`;
  const who = recipientBefore(clauseText, GRANTED_TO);
  // AN ANTHEM BEFORE THE GRANT IS NOT THE RECIPIENT (#857): "Other non-Human creatures you control get
  // +1/+1 and have undying" hands the grant to the creatures, not to "... get +1/+1 and". String ops.
  const at = who?.toLowerCase().lastIndexOf(" get ") ?? -1;
  return who && at > 0 && /^[+-][\dX]+\/[+-][\dX]+ and$/i.test(who.slice(at + " get ".length)) ? who.slice(0, at) : who;
}
/** "EACH CREATURE ... ASSIGNS COMBAT DAMAGE EQUAL TO ITS TOUGHNESS" (owner ruling 2026-09-28: Doran,
 *  the Siege Tower relates to creatures whose toughness exceeds their power). Read from the clause
 *  TEXT, because the 24 corpus cards store it as `other`, `modify-pt` or nothing. A static
 *  damage-multiplier over that stat line -- the shape the compass's `toughness-matters` asks for.
 *  Only a whole-board recipient is a class: "this creature", "target creature" and an Aura's or
 *  Equipment's host are not, and derive nothing here. */
const TOUGHNESS_DAMAGE = /^(?:during your turn, )?each creature( you control)?(?: with (defender|toughness greater than (?:its|their) power))? assigns? combat damage equal to (?:its|their) toughness rather than (?:its|their) power\b/i;
function toughnessDamageAbility(text: string): Ability | undefined {
  for (const sentence of text.split(/\.\s+/)) {
    const m = TOUGHNESS_DAMAGE.exec(sentence.trim());
    if (!m) continue;
    const subject: SubjectFilter = {
      type: "creature", control: m[1] ? "you" : "any", token: null,
      stats: [{ metric: "toughness", op: "gt", vs: "power" }],
      ...(m[2]?.toLowerCase() === "defender" ? { keyword: ["defender"] } : {}),
    };
    return { kind: "static", repeats: "continuous", effect: { kind: "damage-multiplier", subject } };
  }
  return undefined;
}

/** `<recipient> have "<ability>"`: a granted ability, quoted -- which `segment()` rewrites to "have
 *  that ability", the quote moving to a child clause of its own. */
const QUOTED_GRANT = /\b(?:have|has) (?:"|that ability\b)/i;
/** The CR keyword abilities (702.x) a grant's objects name, lowercased and sorted: "hexproof and haste"
 *  -> ["haste", "hexproof"]. A word that is no keyword ability ("a +1/+1 counter") names nothing. */
const KEYWORD_ABILITIES: readonly string[] = (crKeywords as { abilities: string[] }).abilities.map((k) => k.toLowerCase());
// A QUOTED ABILITY'S OWN WORDS ARE NOT GRANTED KEYWORDS: Way of the Wildspeaker hands planeswalkers
// "[-4]: Create a 4/4 green Beast creature token with trample" -- the trample is the token's. A quote
// that is only keywords ("Cascade, cascade.", Zhulodok) is kept. A quote is an ability when it has a
// colon (activated, loyalty) or opens with a trigger word.
const OPEN_QUOTE = new Set(['"', "\u201c"]);
const CLOSE_QUOTE = new Set(['"', "\u201d"]);
const quotedAbility = (q: string): boolean => q.includes(":") || /^\s*(?:when|whenever|at)\b/i.test(q);
/** The text with every quoted ABILITY blanked, by a character scan -- a quote regex whose open and body
 *  classes overlap is the polynomial shape CodeQL fails the required check on. */
function withoutQuotedAbilities(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    if (!OPEN_QUOTE.has(text[i]!)) { out += text[i]; continue; }
    let j = i + 1;
    while (j < text.length && !CLOSE_QUOTE.has(text[j]!)) j++;
    const body = text.slice(i + 1, j);
    out += quotedAbility(body) ? " " : body;
    i = j;
  }
  return out;
}
function grantedKeywords(objects: string[]): string[] {
  // "can attack as though it didn't have defender", "can block creatures with shadow as though they didn't have shadow" name a keyword the
  // thing does NOT have, never one it is handed: Walking Bulwark, Mobile Fort and Glade Watcher read "grants defender" (#1349).
  const text = objects.map(withoutQuotedAbilities).join(" ").toLowerCase().replace(/(?:creatures with \w+ )?as though (?:it|they) (?:didn't|did not) have \w+/g, " ");
  const named = KEYWORD_ABILITIES.filter((k) => new RegExp(`(?:^|[^a-z])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z])`).test(text));
  // LANDWALK IS ONE KEYWORD WITH A LAND TYPE (CR 702.14): "islandwalk" and "swampwalk" are instances,
  // not names on the list, so 47 grants named no keyword (S-T1, 2026-10-06).
  // A LAND TYPE OR "land" BEFORE IT (review of #1050): "sidewalk" and "boardwalk" are no keyword.
  const walks = [...text.matchAll(/(?:^|[^a-z])((?:plains|island|swamp|mountain|forest|desert|land)walk)(?=$|[^a-z])/g)].map((m) => m[1]!);
  return [...new Set([...named, ...walks])].sort();
}

/** "YOU MAY CAST ARTIFACT SPELLS AS THOUGH THEY HAD FLASH" (Shimmer Myr, #711): a spell-side grant to a
 *  class you cast, which the clause layer records as a bare `cast` and derive mapped to nothing. The
 *  owner's ruling links it to each card of that class, as #681 does for a spell grant. Only the
 *  unconditional hand-cast shape; "from your graveyard", "during your turn" and a cost rider stay
 *  unread. The type line sits in no zone, so the subject is the class, controlled by you. */
// A CLASS IS REQUIRED: "you may cast spells as though they had flash" (Vedalken Orrery, High Fae
// Trickster) would link every nonland card, and the ruling named a class. It stays unread (review).
const CAST_AS_FLASH = /^you may cast (artifact|creature|enchantment|planeswalker|instant|sorcery|legendary|green|blue|black|red|white|colorless) spells as though they had flash$/i;
function castAsFlashAbility(text: string): Ability | undefined {
  for (const sentence of text.split(/\.\s*/)) {
    const m = CAST_AS_FLASH.exec(sentence.trim());
    if (!m) continue;
    const subject: SubjectFilter = { ...parseSubject(`${m[1]} spells`), control: "you", scope: "all" };
    delete subject.fromZone;
    return { kind: "static", repeats: "continuous", effect: { kind: "speed-increase", subject } };
  }
  return undefined;
}

// Bounded captures that end on a fixed word: no lazy group beside an optional whitespace tail
// (the polynomial shape CodeQL fails a PR on).
const OR_PUT_INTO_GRAVEYARD = /,\s?or (?:a|an) ([a-z ]{1,40}) (?:is|are) put into (a|your) graveyard from anywhere\b/i;
const OR_LEAVES_GRAVEYARD = /,\s?or (?:a|an|one or more) ([a-z ]{1,40}) leaves? your graveyard\b/i;
/** THE TRIGGER PREAMBLE ONLY (review of #708): the clause text runs on into the effect, and an "or" in
 *  the effect is not a trigger limb. The preamble ends at the first comma that does not open another
 *  "or" limb: "Whenever A, or B, or C, <effect>". */
const triggerPreamble = (text: string): string => (/^\s*(?:when|whenever)\b/i.test(text) ? text.split(/,(?!\s?or\b)/)[0]! : "");
function orLimbTriggers(clauseText: string): { verbs: Verb[]; subject: SubjectFilter }[] {
  const out: { verbs: Verb[]; subject: SubjectFilter }[] = [];
  const text = `${triggerPreamble(clauseText)},`;
  const put = OR_PUT_INTO_GRAVEYARD.exec(text);
  if (put) out.push({ verbs: ["enters-graveyard"], subject: { ...parseSubject(put[1]!.replace(/ cards?$/i, "")), control: put[2]!.toLowerCase() === "your" ? "you" : "any" } });
  const leaves = OR_LEAVES_GRAVEYARD.exec(text);
  if (leaves) out.push({ verbs: ["leaves"], subject: { ...parseSubject(leaves[1]!.replace(/ cards?$/i, "")), control: "you", zone: "graveyard" } });
  return out;
}
const AS_YOU_CAST = /\bas you cast ([^,]{1,80}), ?(?:they|it) (?:gain|gains|have|has)\b/i;
/** SPELLS YOU CAST ARE A CLASS OF THE DECK (owner ruling 2026-09-28, #681): a grant to them links to
 *  every matching spell, the shape a cost reducer's "instant and sorcery spells you cast" already has
 *  -- Anhelo's casualty, Yidris's cascade. Only a SPELL class you cast; a grant to every creature on
 *  the board stays refused. The zone ("from your hand") is dropped: a type line sits in no zone. */
const YOU_CAST = /\byou cast\b/i;
const SPELL_TYPES: ReadonlySet<string> = new Set(["spell", "instant", "sorcery"]);
/** A CLASS THE FILTER CANNOT HOLD (audit of all 39 spell grants, #681): a zone other than the hand
 *  (Hoarding Broodlord "from exile"), a colour COUNT (Fallaji Wayfarer "multicolored", Threefold
 *  Signal "exactly three colors"), spent mana (Shadow the Hedgehog, Rain of Riches) or a variable
 *  mana value (Abaddon). Admitting those would link every spell -- refused, as a grant always was. */
const SPELL_NARROWING = /\bfrom (?:exile|among|anywhere other than|a graveyard|your graveyard)\b|\bmulticolou?red\b|\bexactly (?:one|two|three|four|five) colou?rs?\b|\bmana from (?:a|an)\b[^.]*\bspent\b|\bmana value x\b/i;
function spellsYouCast(s: SubjectFilter, who: string, clauseText: string): SubjectFilter | undefined {
  const types = Array.isArray(s.type) ? s.type : s.type ? [s.type] : [];
  if (!YOU_CAST.test(who) || types.length === 0 || !types.every((t) => SPELL_TYPES.has(t))) return undefined;
  if (SPELL_NARROWING.test(clauseText)) return undefined;
  const { fromZone: _zone, ...rest } = s;
  return { ...rest, control: "you" };
}

/** Creatures that "can't attack you" are, by construction, an OPPONENT's — in a single-deck analysis
 *  no card in the deck can be the subject. Propaganda derived `control: "any"` and Sphere of Safety
 *  derived `"you"` (the possessive leaked out of "planeswalkers you control"), so both taxed the
 *  deck's own creatures. */
const ATTACKS_YOU = /\battacks? you\b/i;

/** The effect kinds whose recipient is a PLAYER or a permanent, so the printed recipient decides who is hit. */
/** "The next 2 damage that ... would deal to you ... is dealt to any target instead", "damage would be dealt to this creature, that damage is dealt to any target instead". NOT "excess damage is dealt to that creature's controller instead" (Ram Through): that card still deals damage first. */
const DAMAGE_REDIRECT = /\bwould (?:be dealt|deal)\b[^.]{0,160}?\b(?:is|are) dealt to [^.]{0,80}?\binstead\b/i;
const BURN_RECIPIENT_KINDS: ReadonlySet<string> = new Set(["damage", "player-life-loss", "drain"]);

function effectSubject(
  action: Action, kind: string, triggerIsSelf = false, clauseText = "", cardName?: string, cardText = "", cantOccurrence = 0,
): ReturnType<typeof parseSubject> {
  // A GRANT's object is the ability handed over, never the thing receiving it, so the subject has to
  // come from the clause text. Falls back to the object when the text states no recipient, which
  // leaves the behaviour it had before.
  // A COPY's object is the thing copied FROM, never the thing that becomes it, so the same recovery
  // and the same typal guard apply: "target Shapeshifter becomes a copy of target creature" is a
  // synergy with the deck's Shapeshifters, while "each other creature you control becomes a copy"
  // reaches the whole board and is an ordinary card doing an ordinary thing.
  // AN ABILITY LOSS NAMES WHO LOSES THEM IN THE CLAUSE, never in its object ("have abilities"). A
  // type-only class is KEPT here, unlike a grant's: a grant with no subtype is refused because the
  // whole-deck lord edge it would form is a false claim, and an ability loss forms no claim at all
  // -- it is a silence the matcher applies to the class it names. "Enchanted creature" and other
  // narrowings the filter cannot hold stay unnamed, so an Aura silences nothing class-wide.
  // WHAT A RETARGET REDIRECTS is the spell and/or ability its object names (CR 115.7): the head words are not the subject.
  if (kind === "retarget") {
    const phrase = retargetObject(action.object ?? "", action.verb ?? "", clauseText) ?? "";
    const s = parseSubject(phrase);
    if (/\b(?:spells? (?:or|and\/or) abilit)/.test(phrase) && !s.abilityKind) s.abilityKind = ["activated", "triggered"];
    return s;
  }
  // WHO CANNOT BE BLOCKED (#1315, CR 509.1b) is stated to the left of "can't be blocked": in the object when the model kept it
  // ("this creature can't be blocked", "creatures can't be blocked"), else in the clause ("Enchanted creature can't be blocked ...").
  // A "gets +1/+0 and" ahead of it is not the subject. "enchanted creature" and the other narrowings the filter cannot hold stay unnamed.
  // CEILING: "enchanted / equipped creature" and the other narrowings stay unnamed, and a STATIC keeps no subject (`namesItsTargets`): 328 of the 541
  // derived evasion abilities carry no type, subtype or self. WHOSE it is, an Aura's / Equipment's host, is `Ability.host` (derive 370), not the subject.
  // WHO IS PROTECTED from a `targeting-ban` (#1423, CR 115.1): "Enchanted creature" is the host (unnamed here, `Ability.host`), "this creature" / the card's name is `self`, a list is unnamed rather than half read.
  if (kind === "targeting-ban") {
    const left = targetingBanSubjectInObject(action.object ?? "") ?? recipientBefore(clauseText, CANT_BE_TARGETED);
    const who = left?.split(/\s(?=(?:gets?|gains?|has|have|loses?)\b)/i)[0]?.trim().replace(/ and$/i, "");
    const tail = who?.includes(", and ") ? who.slice(who.lastIndexOf(", and ") + 6) : who;
    const granted = /["\u201c][^"\u201c\u201d]*\b(?:can['\u2019]t|cannot) be the targets? of/i.test(clauseText);
    if (!tail || granted || UNEXPRESSIBLE_NARROWING.test(tail) || HOST_WORD.test(tail) || RECIPIENT_LIST.test(tail) || /^(?:it|that creature|they|them|players?)$/i.test(tail)) return parseSubject("");
    const s = subjectFrom(tail, cardName, cardText);
    if (SELF_REFERENCE.test(tail) || isSelfSubject(tail, cardName)) s.self = true;
    return s;
  }
  // THE CLASS WHOSE EVENT IS MUTED by a `trigger-suppression` (#1423, CR 603.2): "creatures" for Torpor Orb, "artifacts and creatures" for Karn, "permanents" for Elesh Norn.
  if (kind === "trigger-suppression") {
    const who = triggerSuppressionOf(action.object ?? "", clauseText, cantOccurrence)?.who;
    return who ? parseSubject(who) : parseSubject("");
  }
  // WHAT STAYS TAPPED (#1423, CR 502.3): "Islands", "this land", a target; "Enchanted creature" is the host (unnamed here, `Ability.host`); a pronoun or a list is unnamed.
  if (kind === "untap-denial") {
    const who = untapDenialFor(action.verb ?? "", action.object ?? "", clauseText, cantOccurrence)?.who;
    const granted = /["\u201c][^"\u201c\u201d]*\b(?:doesn['\u2019]t|don['\u2019]t|can['\u2019]t|cannot) untap/i.test(clauseText);
    if (!who || granted || UNEXPRESSIBLE_NARROWING.test(who) || HOST_WORD.test(who)) return parseSubject("");
    const s = subjectFrom(who, cardName, cardText);
    if (SELF_REFERENCE.test(who) || isSelfSubject(who, cardName)) s.self = true;
    return s;
  }
  if (kind === "evasion" || kind === "restriction") {
    const object = action.object ?? "";
    const re = kind === "evasion" ? CANT_BE_BLOCKED : CANT_ATTACK_OR_BLOCK;
    // The recipient ends at the first "gets|gains|has|have|loses". A SPLIT at a single space, not `\s+(...)\b.*$` (quadratic on a long run of spaces: 556 ms on "a" + 40,000 spaces, 0 ms now).
    const who = (re.exec(object)?.[1] ?? recipientBefore(clauseText, re))
      ?.split(/\s(?=(?:gets?|gains?|has|have|loses?)\b)/i)[0]?.trim().replace(/ and$/i, "");
    // A GRANTED ability's "this creature" is the grantee, not the card (Rime Transfusion's Aura): unnamed, never `self`.
    const granted = (kind === "evasion" ? /["\u201c][^"\u201c\u201d]*\b(?:can['\u2019]t|cannot) be blocked/i : /["\u201c][^"\u201c\u201d]*\b(?:can['\u2019]t|cannot) (?:attack|block)/i).test(clauseText);
    if (!who || granted || UNEXPRESSIBLE_NARROWING.test(who) || /^(?:it|that creature|they|them)$/i.test(who)) return parseSubject("");
    const s = subjectFrom(who, cardName, cardText);
    if (SELF_REFERENCE.test(who) || isSelfSubject(who, cardName)) s.self = true;
    return s;
  }
  // WHOSE HAND (#1302): `putsTopCardsIntoYourHand` only lets YOUR hand through, so the subject is you; the cards themselves are `Ability.amount` / `Ability.chooses`, not a class.
  if (kind === "to-hand") return { ...parseSubject(""), control: "you" };
  if (kind === "ability-loss") {
    const who = recipientBefore(clauseText, LOSES_ABILITIES);
    return who && !UNEXPRESSIBLE_NARROWING.test(who) ? parseSubject(who) : parseSubject("");
  }
  if (action.verb === "grant-ability" || action.verb === "copy") {
    const who = action.verb === "copy"
      ? recipientBefore(clauseText, COPIED_INTO)
      : grantRecipient(clauseText);
    if (who) {
      // A GRANT IN A SELF-ANIMATE SENTENCE IS THE CARD'S OWN (#1349 review): "this creature becomes a Rhino with base power and
      // toughness 4/4 and gains trample" hands the trample to the card, not to a Rhino class (Skinshifter, Paragon of the Amesha,
      // Dragonsoul Knight). The recipient text is the animate's own subject, so it inherits the animate's `self`.
      const becomesLead = action.verb === "grant-ability" ? /^(.*?\S)\s+becomes?\b/i.exec(who)?.[1] : undefined;
      if (becomesLead !== undefined && (SELF_REFERENCE.test(becomesLead) || isSelfSubject(becomesLead, cardName))) {
        return { ...subjectFrom(becomesLead, cardName, cardText), self: true };
      }
      const s = parseSubject(who);
      // A grant EARNS an edge only when it is typal. "Creatures you control gain haste until end of
      // turn" reaches every creature in the deck -- the ordinary-card claim the rubric calls false,
      // and the mesh that made `static` the engine's worst family. Naming a SUBTYPE is what makes it
      // a synergy: "other Merfolk you control have ward {1}" picks out particular cards.
      //
      // A COMMANDER NARROWING DISCRIMINATES AS HARD AS A SUBTYPE, AND HARDER (roadmap J12). "Commander
      // creatures you own" is ONE card, or two — the opposite of the whole-deck claim this gate
      // refuses — and `combatNarrowsOffType` already ships that exact reasoning for the same field.
      // Without the carve-out a Background, whose entire printed purpose is buffing the other
      // commander, reads as synergising with nothing: measured over the 71 decks, exactly 4 run two
      // commanders, all four run a Background, and the edges between the pair read 0 · 0 · 0 · 1.
      // The one that worked (Cultist of the Absolute) got there by `modify-pt`, which never passes
      // through this gate at all.
      // A TOKEN CLASS IS BOUNDED TOO (roadmap AC13, 2026-09-09). "Creature tokens you control have
      // '{T}: Add one mana of any color'" (Springleaf Parade) reaches the deck's TOKEN NODES, which
      // exist only because a card in the deck makes them -- so the edge is to each token maker,
      // which is exactly the synergy the card is played for. Tokens have been nodes since
      // 2026-08-16; this gate predates them and read "creature tokens" as "creatures". Found by the
      // recall draw's one token-family miss that was not the instrument's own shape.
      // A TYPE IS A CLASS TOO (owner ruling 2026-09-10, recall v5 #2: Cybermen Squadron's
      // "nonlegendary artifact creatures you control have myriad" reached nothing). It extends the
      // 2026-09-07 tutor ruling -- a tutor limited to a TYPE is a real edge to every card of that
      // type -- to grants: artifact, enchantment, land, planeswalker and legendary narrowings pick
      // out particular cards the way a subtype does. Board STATE dressed as a class does not:
      // "attacking", "tapped", "equipped" and "face-down" all parse to a bare creature and stay
      // refused with the whole board, and "nontoken creatures" is the whole board minus tokens.
      if (action.verb === "grant-ability") {
        const spells = spellsYouCast(s, who, clauseText);
        if (spells) return spells as ReturnType<typeof parseSubject>;
      }
      if (!boundedGrantClass(s) && !(action.verb === "grant-ability" && everyCreatureYouControl(who, clauseText))) return parseSubject("");
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
  // A MULTIPLIER'S SUBJECT CARRIES A NARROWING THE FILTER CANNOT HOLD (2026-08-21). Same shape as
  // the Excalibur case above: the parser reads the nouns and drops the condition after them, and the
  // static applies-to pass then claims every card matching the nouns.
  //
  // MEASURED: re-normalizing the corpus gave Raphael, the Muscle ("Double all damage that creatures
  // you control WITH COUNTERS ON THEM would deal") the subject {creature, you, all} and Mjolnir,
  // Hammer of Thor ("Double all damage EQUIPPED CREATURE would deal") the subject {creature, any,
  // all}. Together they took MESHED 288 -> 405 -- 60 + 57, the whole regression. A counter presence
  // and an attachment are both real, printed and unrepresentable here, and CR 614's own rule in
  // `replacement.ts` already says what to do: keep the KIND, claim nothing about which cards it
  // applies to. Scoped to the multiplier verbs, because that is what was measured to break; the
  // aura/equipment host read as a class is a wider standing defect with its own item.
  if (MULTIPLIER_VERBS.has(action.verb ?? "") && UNEXPRESSIBLE_NARROWING.test(object)) return parseSubject("");
  const self = object.match(SELF_REFERENCE);
  const parsed = subjectFrom(self ? self[0] : countTruncated(object), cardName, cardText);
  // WHO A DAMAGE OR LIFE LOSS HITS (#1266, burn): a player beside a permanent ("each opponent and each creature they
  // control", "target player and each creature that player controls") keeps its player half, and "that creature's
  // controller" is the player, not the creature. The filter grammar's own `anyOf` with a player branch stands.
  const recipient = BURN_RECIPIENT_KINDS.has(kind) ? (damageRecipient(object) ?? (kind === "damage" ? playerOnlyRecipient(object) : undefined)) : undefined;
  const subject = recipient && !parsed.anyOf?.some((b) => b.player === true) ? recipient as ReturnType<typeof parseSubject> : parsed;
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
  else if (BURN_RECIPIENT_KINDS.has(kind) && damageHitsSelf(object, clauseText)) subject.self = true;
  if (ATTACKS_YOU.test(object)) subject.control = "opp";
  // A COST REDUCTION OVER "SPELL(S) YOU CAST" IS A CLASS OF YOUR DECK (#717): Doran, Besieged by Time's
  // "Each creature spell you cast with toughness greater than its power costs {1} less" came back as
  // the singular "creature spell you cast ...", parsed to `{creature, any}` with no scope, and the
  // static guard dropped it -- so Bedrock Tortoise, a 0/6, got no discount. The plural ("artifact
  // spells you cast", Foundry Inspector) already worked; the class is the same either way.
  if (kind === "cost-reduction" && SPELLS_YOU_CAST.test(object) && !COST_NARROWING_UNHELD.test(object)) {
    subject.control = "you";
    subject.scope ??= "all";
    const cmp = STAT_VS_STAT.exec(object);
    // The filter grammar reads the comparison itself; add it only when the subject lacks it.
    if (cmp && !subject.stats?.some((p) => p.vs !== undefined)) subject.stats = [...(subject.stats ?? []), { metric: cmp[1]!.toLowerCase() as "power" | "toughness", op: "gt", vs: cmp[2]!.toLowerCase() as "power" | "toughness" }];
  }
  if (kind === "play-from-top") {
    subject.zone = "library";
    delete subject.fromZone;
  }
  if (kind === "bounce" && !action.fromZone) {
    const zone = bounceOrigin(action);
    if (zone) subject.zone = zone;
  }
  if (ZONE_SCOPED_KINDS.has(kind) && action.fromZone) {
    subject.zone = action.fromZone;
    // Only when the object text stated no owner of its own -- an explicit one is more specific.
    const owner = zoneOwner(clauseText, action.fromZone, triggerIsSelf, cardName, object);
    if (owner && subject.control === "any") subject.control = owner;
  }
  // A MILL MADE BY A PUT names whose library, as its emit does (emits.ts `millsOwnLibrary`, #1401 part 2): the grammar and the stored answer must agree, or the model/grammar switch flips on the difference.
  if (kind === "mill" && subject.control === "any" && millsOwnLibrary(action, clauseText)) subject.control = "you";
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
    namesAClassHere(subject) &&
    (subject.scope === "all" || subject.scope === "each")
  );
}

/** The clause's own `control` field, which states whose permanents/players the trigger watches. The
 *  object text often does not repeat it ("whenever you cast a spell" normalizes to subject "a
 *  spell", control "you"), so reading only the text widened Consuming Aberration to every spell
 *  anyone casts. The clause vocabulary spells the opponent side "opponent"; the engine says "opp". */
const CLAUSE_CONTROL: Record<string, Control> = { you: "you", opponent: "opp", any: "any" };

/** Verbs whose subject is a PERMANENT, so its controller is the permanent's and not the ability's.
 *  See the trigger branch: a clause `you` with nothing printed behind it is refused on these only.
 *  Every name is a `VERB_VOCAB` member (the transform verb is `transform`). */
const PERMANENT_EVENT_VERBS: ReadonlySet<string> = new Set([
  "dies", "enters", "leaves", "attacks", "blocks", "becomes-blocked", "taps", "untaps", "counter-added", "counter-removed",
  "enters-graveyard", "sacrifice", "transform", "turned-face-up", "phases-out",
]);
/** Subjects that are the card's own business whatever the printed phrase says: an attached
 *  permanent, a back-reference at the head, a counter on this card. Not a bare "this" -- "a
 *  creature dealt damage by this creature THIS TURN" (Wight) is a class, and any player's. */
const KEEPS_CLAUSE_CONTROL = /^(?:the |that |this )?(?:equipped|enchanted)\b|^(?:it|them|the|that|this)\b|\bon this\b|\bcounters?\b/i;
/** The printed trigger phrase: the clause text up to the comma that ends it. A list subject
 *  carries commas of its own -- "Whenever another Frog, Rabbit, Raccoon, or Squirrel you control
 *  enters" (Valley Mightcaller) -- so as many commas as the clause's subject text holds are
 *  skipped before the cut, and "you control" stays inside the phrase. */
function printedTriggerPhrase(text: string, subjectText: string): string {
  const skip = (subjectText.match(/,/g) ?? []).length;
  let cut = -1;
  for (let i = 0; i <= skip; i++) {
    cut = text.indexOf(",", cut + 1);
    if (cut < 0) return text;
  }
  return text.slice(0, cut);
}

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
/** Same words as `rules.json`'s `controllerGetsCopies` (matcher), which the tagger cannot import. */
const CONTROLLER_GETS_COPIES = /its controller creates [^.]{0,40}tokens? that (?:are|is a) cop(?:y|ies) of/i;

/** AN ACTION WITH NO PLAYER NAMED IS THE CONTROLLER'S (CR 111.2; `subject.ts` already says this is
 *  where "you draw" comes from, and never applied it). "Draw a card", "you may cast that card",
 *  "sacrifice two other creatures", "create a token": the actor is you, and the object text carries
 *  no controller because the sentence had no need to say one. Derived `any`, every one of them met
 *  the OPPONENT-watching payoffs -- the panel's Priest of Forgotten Gods -> Orcish Bowmasters
 *  ("whenever an opponent draws") and Impulsivity -> Nezahal ("whenever an opponent casts"), both
 *  owner-judged FALSE. `actionRecipients` now answers `any` when a player IS named, so silence from
 *  it means no player was named at all. Only these verbs: the subject of a counter placement or a
 *  removal is the RECIPIENT, not the actor, and the rule must not touch them. */
const ACTOR_DEFAULTS_TO_YOU = new Set(["draw", "cast", "play", "discard", "mill", "create", "search", "sacrifice", "gain-life", "lose-life"]);

/** "That creature", "those cards": a back-reference that NAMES A TYPE and so is not a pronoun
 *  (`PRONOUN_OBJECT` keeps it parsing as itself, deliberately) -- but the controller it refers back
 *  to is on the antecedent, not on it. The Sibsig Ceremony: "whenever a creature YOU control enters,
 *  destroy THAT CREATURE" derived `dies creature/any` and fed Massacre Wurm's "whenever a creature
 *  an opponent controls dies" (owner-judged FALSE). The type stays the pronoun's own; only an
 *  unstated controller is inherited. */
const DEATH_REPLACEMENT = /\bwould (?:die|be destroyed|be put into a graveyard)\b[^.]*\binstead\b/i;
const THAT_TYPED = /^(?:that|those) [a-z][a-z ]*$/i;
const THAT_PLAYER = /^that (?:player|opponent)$/i;
/** A PLAYER back-reference: never the controller themself, so it never inherits `you` from the nearest earlier object (Angel of Destiny: "you and that player each gain that much life"). */
const PLAYER_BACKREF = /^(?:that (?:player|opponent)|those (?:players|opponents))$/i;
/** The count an antecedent object states up front: "up to five Doctor cards", "two basic land cards". */
// Never an open threshold: "two or more creature cards" is no fixed two (review).
const ANTECEDENT_COUNT = /^(?:up to )?(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|x|\d+)\b(?! or (?:more|fewer|less|greater))/i;
/** "<action> if it was attacking": the combat state a sentence's condition names (#798). */
const COMBAT_IF = /\bif (?:it|that creature) was (attacking|blocking)\b(?! or)/i;
/** "…spell(s) you cast" as a cost reducer's object (#717, Doran). */
const SPELLS_YOU_CAST = /\bspells? you cast\b/i;
/** A reducer narrowing no field holds -- "the FIRST spell you cast each turn" (Baral), "from exile",
 *  "that targets" -- stays unread rather than widened to every such spell (review). */
const COST_NARROWING_UNHELD = /\bfirst\b|\bfrom (?:exile|a graveyard|your graveyard|anywhere other than)\b|\bthat targets?\b|\beach turn\b/i;
/** "with toughness greater than its power" -- one stat against another on the same card (#717). */
const STAT_VS_STAT = /\bwith (power|toughness) greater than (?:its|their) (power|toughness)\b/i;
/** "…card in your graveyard" / "…from a graveyard": an object that names its zone (#716, Emry). */
const ZONE_MOVING_VERBS: ReadonlySet<string> = new Set(["cast", "play", "return", "put", "exile"]);
/** A replacement rider ("If a spell cast this way would be put into a graveyard, exile it instead", #1306) is no graveyard exile: its zone is left to that work. */
const WOULD_BE_PUT_INTO = /\bwould be put into\b/i;
/** The rider's own object: "exile IT instead", "exile that spell / that card", "exile a spell cast this way". */
const RIDER_OBJECT = /^(?:it|them|that (?:card|spell|creature)|those cards)$|\bcast (?:from your graveyard )?this way$/i;
/** "...from an opponent's graveyard ... that player's graveyard": the opponent's card was named before the pronoun that points back at it. Two index scans, no backtracking. */
function opponentYardBefore(text: string): boolean {
  const lower = text.toLowerCase();
  const named = lower.indexOf("from an opponent's graveyard");
  return named >= 0 && named < lower.indexOf("that player's graveyard");
}
const OBJECT_IN_GRAVEYARD = /\b(?:in|from) (?:your|a|an opponent's|target player's|their) graveyard\b/i;
/** "…, then return it to the battlefield…" after an exile in the same clause (#715, Jill). */
/** "...with a finality counter on it" -- the counter rides on the returned object itself (#886). */
const RETURNED_WITH_COUNTER = /\bwith an? ([a-z]+) counter on (?:it|them|him|her)\b/i;
const RETURN_TO_BATTLEFIELD = /\breturn (?:it|them|him|her|this card|that card|those cards) to the battlefield\b/i;
/** "…return it to the battlefield transformed…": the back face enters (CR 712.14a, #715). Every
 *  corpus phrasing: him/her (Ajani, Tamiyo), "this card", "put … onto", "from your graveyard" and
 *  "tapped and transformed" (Ojer Taq). */
/** "return ... at the beginning of the next end step" / "at the beginning of your next upkeep, return"
 *  (#801). Bounded and anchored on literals: no quantifier overlap for CodeQL's ReDoS check. */
/** The sentence of `text` holding the k-th (0-based) whole-word `verb`; "" when there are fewer. */
function nthSentenceWith(text: string, verb: string, k: number): string {
  return nthSentenceMatching(text, `\\b${verb}\\b`, k);
}
// FLIP_VERB_WORDS, nthSentenceMatching and the printed-word lookup moved to effect-gate.ts (#1357): the gate of an effect and `onFlip` find an action's sentence by one table.
export { FLIP_VERB_WORDS };
function flipVerbWord(verb: string): string {
  return printedVerbWord(verb);
}
/** "Whenever ONE OR MORE ...": one firing per batch (CR 603.2c; edge magnitude). */
const BATCHED = /\bone or more\b/i;
const RETURNS_TRANSFORMED = /\b(?:return|put) (?:it|them|him|her|this card|that card|those cards)(?: from [a-z' ]+?)?(?: (?:to|onto) the battlefield)?(?: tapped and)? transformed\b/i;
/** "…until you reveal a creature card…": the class a reveal-until dig puts somewhere (#715). */
const REVEAL_UNTIL = /\buntil you reveal (an? [a-z ]{1,40}?) card\b/i;
const REVEAL_UNTIL_ALL = /\buntil you reveal\b/gi;

/** The recipient of a counter, when it is the card itself. Anchored at the END of the trigger
 *  subject so "on this creature" is the recipient and not a stray mention. */
const COUNTER_ON_SELF = /\b(?:on|from) this (?:creature|permanent|artifact|enchantment|land|planeswalker|card)$/i;
/** The trigger PHRASE (text before the first comma) says the counter lands on this card. */
function counterTriggerOnSelf(text: string, cardName?: string): boolean {
  const phrase = text.split(",")[0] ?? "";
  // A COUNTER COMES OFF THE CARD THE SAME WAY IT WENT ON (DERIVE 158): "whenever one or more loyalty
  // counters are removed FROM Chandra", "when the last time counter is removed from this card while
  // it's exiled" (Riftmarked Knight, Dinosaurs on a Spaceship). 4 of the 19 corpus counter-removed
  // triggers read as a class without it, and Argent Dais's own oil counters fed all four.
  if (/\b(?:on|from)\s+this\s+(?:creature|permanent|artifact|enchantment|land|planeswalker|vehicle|card)\b/i.test(phrase)) return true;
  if (!cardName) return false;
  // EVERY FACE NAMES ITSELF, BY ITS SHORT NAME (DERIVE 156): the card's own text says "on Lonis",
  // never "on Lonis, Genetics Expert", and the whole first face was compared here, so Lonis, Berta
  // and Aragorn read their own counters as a class (Exemplar of Light fed Lonis's investigate).
  return cardName.split(" // ").some((face) => {
    const short = face.split(",")[0]!.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return short !== "" && new RegExp(`\\b(?:on|from)\\s+${short}\\b`, "i").test(phrase);
  });
}

/** "Whenever one or more creature cards leave YOUR GRAVEYARD" (Desecrated Tomb, Fang, Chalk Outline
 *  -- 32 of the 71 corpus leaves-payoffs). The model's trigger subject dropped the zone on every one
 *  of them, so they derived identically to The Ozolith's battlefield leave and every death in the
 *  deck fed them (panel: Fang x3, Soul Enervation, Defiled Crypt, all FALSE). Read from the clause
 *  text, which is exactly the channel the subject string lost. */
const LEAVES_GRAVEYARD = /\bleaves? (?:your|a|an opponent'?s|their|each player'?s|its owner'?s|the|that player'?s)? ?graveyard\b/i;

/** AN ACTION THAT HAPPENS ON A DELAYED TRIGGER IS NOT AT INSTANT SPEED (#1250). "Sacrifice it at the
 *  beginning of the next end step" (Reflection of Kiki-Jiki) is a delayed triggered ability (CR 603.7),
 *  so no player can aim it at an attacker. Read on the action's OWN sentence, and only when no later
 *  action in that sentence carries the delay ("exile it, then return it at the next end step" delays
 *  the return, not the exile). "At end of combat" is NOT a delay past combat: the ability triggers as the
 *  end of combat step begins (CR 511.2) and creatures leave combat only as that step ends (CR 511.3), so
 *  "destroy it at end of combat" (Goblin Sappers, Silent Assassin, Winter's Chill) still kills an attacker.
 *  CEILING: the verb is found by its own word in the sentence. */
function delayedAction(text: string, action: { verb?: string }, actions: readonly { verb?: string }[]): boolean {
  if (!action.verb) return false;
  const k = actions.slice(0, actions.indexOf(action as never)).filter((x) => x.verb === action.verb).length;
  // A clause that lists the verb's action twice (Chimeric Coils) prints it once: past the last, use the last.
  const printed = (text.match(new RegExp(`\\b${action.verb}\\b`, "gi")) ?? []).length;
  const sentence = nthSentenceWith(text, action.verb, Math.max(0, Math.min(k, printed - 1)));
  if (!delaysIn(sentence).some((d) => d.kind === "step")) return false;
  const at = sentence.search(new RegExp(`\\b${action.verb}\\b`, "i"));
  return !actions.some((o) => o !== action && o.verb && o.verb !== action.verb && sentence.search(new RegExp(`\\b${o.verb}\\b`, "i")) > at);
}
/** "Activate only as a sorcery" (CR 307.5 timing on an activated ability) and its "only during
 *  your turn" cousin: an activation that cannot happen in combat. */
const SORCERY_SPEED = /\bactivate (?:this ability )?only as a sorcery\b|\bonly during your turn\b/i;
// A loyalty symbol as a cost ("+1", "−3", "0"; CR 606.3 makes it sorcery-speed) is read once, by `paymentOf` (`Payment.loyalty`).


/** WORDS ABOUT WHEN, NOT WHICH: "your NEXT upkeep", "dies THIS TURN", "this combat". A delayed or
 *  windowed trigger fires on the same class of event, as `oncePerTurn` does; `delayedBy` and
 *  `repeats` say how often. Only the words left after these are a narrowing. */
const TEMPORAL = /\b(?:next|this turn|this combat|each turn)\b/g;

/** Whether derive represents a trigger's intervening if (CR 603.4) or narrowing, so it may claim:
 *  a count (`threshold`), an entry that was no cast (`notCast`), "the first instant spell" (the
 *  class inside the if, #178), "enters tapped" (`entersTapped`), an event amount ("5 or more
 *  damage", `amount`). Anything else refuses the claim (owner, 2026-10-01). */
function narrowingRepresented(r: TriggerReading, text: string): boolean {
  const left = (r.narrowing ?? "").replace(TEMPORAL, "").replace(/\s+/g, " ").trim();
  if (left === "") return true;
  if (left === "tapped" && r.event === "enters") return true;
  if (left === "without being played" && r.event === "enters") return true;
  // Orcish Bowmasters: "EXCEPT THE FIRST ONE THEY DRAW IN EACH OF THEIR DRAW STEPS" leaves out the
  // turn-based draw (CR 504.1), which no card supplies: every draw a producer makes still counts.
  if (r.event === "draw" && /^except the first one (?:they|you) draws? in each of (?:their|your) draw steps$/.test(left)) return true;
  return eventAmountFor(text) !== undefined && /^(?:exactly )?\d+(?: or (?:more|greater))?(?: damage)?(?: to (?:a player|an opponent|a permanent or player|any target))?$/.test(left);
}

/** THE TRIGGER GRAMMAR'S READING OF A CLAUSE (#896 task 5, DERIVE 224): the printed preamble read by
 *  `grammar/trigger.ts`, which WINS over the stored event, subject and control when it reads every
 *  word (owner, 2026-10-01). Null keeps the stored path: no printed trigger word, an unread
 *  preamble, or a reflexive "when you do", which the stored path already handles. A compound
 *  ("enters or attacks") is one stored clause per event, so the reading naming the clause's own
 *  event is taken. CEILING: a compound stored as ONE clause keeps only that event. */
/** THE VERB FAMILIES THE ACTION GRAMMAR HAS TAKEN OVER (#896 task 6), one per PR in the owner's order
 *  (2026-10-01): draw and search first. */
const ACTION_FAMILY: Record<string, string> = {
  draw: "draw-search", discard: "draw-search", mill: "draw-search", scry: "draw-search", surveil: "draw-search", search: "draw-search", reveal: "draw-search",
  "deal-damage": "damage-life", "gain-life": "damage-life", "lose-life": "damage-life", "set-life": "damage-life",
  "add-counter": "counters", "remove-counter": "counters", proliferate: "counters",
  create: "tokens", populate: "tokens", amass: "tokens", investigate: "tokens", incubate: "tokens",
  destroy: "zone", exile: "zone", sacrifice: "zone", return: "zone", put: "zone", shuffle: "zone",
  "modify-pt": "pump", "grant-ability": "pump",
  "add-mana": "mana-tap", tap: "mana-tap", untap: "mana-tap", cant: "mana-tap",
  ...Object.fromEntries(["counter-spell", "gain-control", "fight", "goad", "regenerate", "transform", "attach", "copy", "detain", "suspect",
    "bolster", "adapt", "monstrosity", "support", "discover", "collect-evidence", "venture-into-the-dungeon", "manifest-dread", "learn",
    "monarch", "initiative", "ring-tempts", "explore", "connive", "endure", "cast", "play", "prevent", "cost-modify", "double", "animate",
    "roll-dice", "flip-coin", "extra-turn", "emblem", "exchange", "win-game", "lose-game", "clash", "exert", "manifest", "convert", "earthbend",
    "airbend", "waterbend", "blight", "behold", "extra-combat", "extra-phase", "trigger-again", "phase-out", "phase-in"].map((v) => [v, "tail"])),
};
const GRAMMAR_ACTION_VERBS: ReadonlySet<string> = new Set(Object.keys(ACTION_FAMILY));
/** Verbs whose OBJECT, on derive's string path, is the player it happens to ("target player mills two
 *  cards" -> object "target player"); see `RECIPIENT_VERBS` in emits.ts. */
/** The recipient of the damage a "prevent" clause prevents is the card itself: "If damage would be dealt to ~, prevent that damage ...", "prevent all damage that would be dealt to this creature". */
function preventHitsSelf(text: string, cardName?: string): boolean {
  const m = /\bdamage would be dealt to ([^,.]+)|\bprevent (?:all |that |the next [\dx]+ )?damage(?: that would be dealt)? to ([^,.]+)/i.exec(text);
  // A recipient inside a QUOTED ability is the grantee's own "this creature" (Caduceus: equipped creature has "Prevent all damage that would be dealt to this creature"), never the card's.
  if (m && (text.slice(0, m.index).match(/"/g) ?? []).length % 2 === 1) return false;
  const who = (m?.[1] ?? m?.[2] ?? "").trim().replace(/ this turn$/i, "");
  return who !== "" && (SELF_REFERENCE.test(who) || isSelfSubject(who, cardName));
}

/** An amount that points back at an earlier one rather than counting. */
/** A trigger's quantifier stored as an amount ("one or more", Cryptcaller Chariot): it counts events, not the thing made, so it resolves nothing. */
export const QUANTIFIER_AMOUNT = /^(?:one or more|any number(?: of)?|at least one)\b/i;
export const BACK_REF_AMOUNT = /^(?:that (?:many|much)(?: [a-z]+)?|the same(?: amount| number)?|it)$/i;

/** Verbs that move a card from one place to another: the player who does them need not own the card (see `withGrammarActions`' reading fill, #1395). */
const CARD_MOVING_VERBS: ReadonlySet<string> = new Set(["exile", "destroy", "return", "put"]);
const PLAYER_OBJECT_VERBS: ReadonlySet<string> = new Set(["draw", "mill", "discard", "scry", "surveil", "gain-life", "lose-life"]);
/** ...of which these name only a COUNT of cards, so a reading with no actor is the controller's own
 *  ("Draw a card": CR 608.2c, the controller follows its instructions). Not discard: "discard a creature card" names
 *  the card's class, which its object carries. */
const UNNAMED_IS_YOU: ReadonlySet<string> = new Set(["draw", "mill", "scry", "surveil"]);

/** ONE PRINTED SEARCH OVER SEVERAL ZONES IS ONE SEARCH ABILITY (#1391 F3). "Search its owner's graveyard, hand, and library for all cards with that name" (Eradicate, Extirpate, Kassandra) is stored as one `search` action per zone,
 *  same object, differing only in `fromZone`; the model's store and the grammar's own records both write it so. A run of CONSECUTIVE searches with the same object, amount and optionality and pairwise-different zones collapses
 *  to one, keeping the library member (its `search` emit and `librarySearch` are the event "whenever you search your library" hears), else the first. Two separately printed searches never match: they differ in object, or
 *  repeat a zone (Increasing Ambition, Tempt with Discovery).
 *  CEILING: the graveyard and hand zones are not carried on the collapsed action (nothing reads a zone list). The fold depends on `withGrammarActions` having rewritten the per-zone stored objects to the ONE printed object
 *  first (Deadly Cover-Up writes each zone's own phrase; Ethereal Elk "your library" / "your graveyard"): a clause with no printed text keeps per-zone objects and is not folded. Not folded either: Vraska's Scorn, Jace's Ruse,
 *  Liberating Combustion (model path: the `put` of the found card derives a second `search` kind, 3 -> 2 abilities) and Nissa's Encouragement (three named cards, one pair of six folds: 6 -> 5).
 */
function collapseZoneSearches(clause: ClauseRecord): ClauseRecord {
  const acts = clause.actions ?? [];
  const out: Action[] = [];
  for (let i = 0; i < acts.length;) {
    const a = acts[i]!;
    if (a.verb !== "search") { out.push(a); i++; continue; }
    let j = i + 1;
    const zones = new Set([a.fromZone ?? ""]);
    while (j < acts.length && acts[j]!.verb === "search" && acts[j]!.object === a.object && (acts[j]!.amount ?? null) === (a.amount ?? null) && (acts[j]!.optional ?? false) === (a.optional ?? false) && !zones.has(acts[j]!.fromZone ?? "")) { zones.add(acts[j]!.fromZone ?? ""); j++; }
    out.push(j - i > 1 ? (acts.slice(i, j).find((x) => x.fromZone === "library") ?? a) : a);
    i = j;
  }
  return out.length === acts.length ? clause : { ...clause, actions: out };
}

/** THE ACTION GRAMMAR WINS (owner, 2026-10-01): a clause's stored actions of a taken-over family are
 *  rewritten from the printed text where the grammar read the phrase completely -- object, amount,
 *  optional, zones and the kept condition. The rest of derive reads the rewritten record exactly as
 *  it read the stored one. CEILING: a phrase the store left out (the "reveal it" of a tutor) is not
 *  ADDED: an inserted action becomes the antecedent of the "it" after it, and the references
 *  resolver (#900) reads the revealed card's class off the text, not off an action. */
function withGrammarActions(clause: ClauseRecord, text: string | undefined, cost: string | undefined, cardName: string | undefined, precomputed?: ActionReading[]): ClauseRecord {
  if (!text || !clause.actions?.length) return clause;
  // PRECOMPUTED READINGS (G-T3): `grammarClauseRecords` already ran `parseActions` on this exact
  // `(effect, type, cost)` while building `clause` itself (the grammar path's own records) -- reuse
  // them rather than parsing the same text again. Absent on the model path, where `clause` is the
  // stored answer and no grammar reading of it exists yet.
  const readings = (precomputed ?? parseActions(effectText(text, cardName ?? ""), clause.abilityType ?? null, cost))
    .filter((r) => GRAMMAR_ACTION_VERBS.has(r.verb));
  if (readings.length === 0) return clause;
  // THE STORE WRITES "can't attack or block" AS TWO ACTIONS (attack, block) where the grammar reads ONE phrase (#1391 F7, Arachnus Web: attack, block, activated abilities against attack-or-block, activate): aligned by
  // position the grammar's second phrase took the BLOCK action's place and the real activated-abilities action was left over, so one restriction and TWO ability-loss derived. A stored bare "block" / "attack"
  // that an earlier stored bare combat action's reading already covers ("attack or block") is dropped before the alignment.
  const combatWords = (o: string | undefined): string[] => (/^(?:attack|block)(?: or (?:attack|block))?$/i.exec((o ?? "").trim()) ? (o ?? "").toLowerCase().match(/attack|block/g)! : []);
  // Only a reading that covers BOTH words ("attack or block") makes the second stored bare action redundant; two separate restrictions ("can't attack. ... can't block.") keep both.
  const coveredByReading = new Set(readings.filter((r) => r.verb === "cant").map((r) => combatWords(r.text)).filter((w) => w.length === 2).flat());
  let seenCombat = false;
  const stored = clause.actions.filter((a) => {
    if (a.verb !== "cant" || !/^(?:attack|block)$/i.test((a.object ?? "").trim())) return true;
    const dup = seenCombat && coveredByReading.has((a.object ?? "").trim().toLowerCase());
    seenCombat = true;
    return !dup;
  });
  // The store files "becomes prepared" as a grant of "prepared" (Codie): a prepare, not a grant, so it
  // takes no grant's reading ("becomes prepared and gains hexproof" would hand it "hexproof").
  const verbOf = (a: Action): string => (a.verb === "grant-ability" && /^prepared$/i.test((a.object ?? "").trim()) ? "prepare" : a.verb ?? "");
  // Aligned family by family, so a life reading cannot take a draw's place in the sequence. A verb the
  // grammar reads MORE times than the store holds is left as stored: the store wrote a list as one
  // action ("create a Treasure token and a 2/2 Bird token", Song of Eärendil), and rewriting it with
  // the first item would drop the rest.
  // Not a SEARCH: its extra readings are the zones of one search ("your library and/or graveyard"),
  // and the first is the library, which is what a search emit needs.
  // A ZONE verb takes the grammar only where both hold the same number of it: the store writes a
  // "look at the top X" as a put of its own (Belisarius Cawl), and aligning two readings to three
  // stored puts by verb alone hands one put's destination to its neighbour.
  const count = (v: string) => [readings.filter((r) => r.verb === v).length, stored.filter((a) => verbOf(a) === v).length] as const;
  const more = new Set(readings.map((r) => r.verb).filter((v) => v !== "search" && (ACTION_FAMILY[v] === "zone" ? count(v)[0] !== count(v)[1] : count(v)[0] > count(v)[1])));
  const aligned = new Map<number, number>();
  for (const fam of new Set(readings.map((r) => ACTION_FAMILY[r.verb]))) {
    const si = stored.flatMap((a, i) => (ACTION_FAMILY[verbOf(a)] === fam ? [i] : []));
    const ri = readings.flatMap((r, j) => (ACTION_FAMILY[r.verb] === fam ? [j] : []));
    for (const [i, j] of alignVerbs(si.map((i) => verbOf(stored[i]!)), ri.map((j) => readings[j]!.verb))) aligned.set(ri[j]!, si[i]!);
  }
  const out: Action[] = [...stored];
  readings.forEach((r, j) => {
    const i = aligned.get(j);
    if (i === undefined || more.has(r.verb)) return;
    const base = stored[i]!;
    // A BACK-REFERENCED actor ("that player mills X cards", Geth) keeps the stored object: derive's
    // antecedent reading of who "that player" is beats the grammar's "any player".
    const named = r.actor?.text !== undefined && r.actor.scope !== "that";
    // Life verbs carry their player in `text` already ("you" when no one is named). A COUNTER's stored
    // object is its kind; the recipient goes in front, "target creature, +1/+1" -- the store's own
    // two-part form, which `counterKindOf` reads the kind back out of (#731). The card itself or a
    // back-reference keeps the stored object: derive's self logic reads it.
    const object = r.counter !== undefined
      ? (r.text !== undefined && r.object?.self !== true ? `${r.text}, ${r.counter}` : base.object)
      // A BACK-REFERENCED life reading ("that player gains 2 life", Benevolent Offering) keeps a stored "chosen opponent" / "chosen player" rather than the grammar's "that player" (the choice is the antecedent, Benevolent Offering).
      // CEILING: only the chosen-player wording. Any other stored object (a pronoun, "that player") keeps the grammar text: keeping "they" typed a life loss as a spell (Rug of Smothering), measured and reverted.
      : (r.verb === "gain-life" || r.verb === "lose-life") && r.actor?.scope === "that" && /^(?:the )?chosen (?:opponent|player)$/i.test((base.object ?? "").trim()) ? base.object
      : PLAYER_OBJECT_VERBS.has(r.verb) && r.verb !== "gain-life" && r.verb !== "lose-life"
        // NO ACTOR IS YOU (#697): Esper Sentinel's "Whenever an opponent casts ..., draw a card unless
        // that player pays {X}" and Veil of Summer's "Draw a card if an opponent has cast ..." name an
        // opponent elsewhere in the sentence, which kept the draw `any` -- each player's, like Howling Mine.
        ? (named ? r.actor!.text : r.actor ? base.object : UNNAMED_IS_YOU.has(r.verb) ? "you" : r.text ?? base.object)
        // The card itself keeps the stored object for the same reason ("sacrifice Endrek Sahr").
        // So does a stored object that is the printed one plus where it came from ("a land card" ->
        // "a land card from among the top four cards of your library", Planar Genesis).
        : (ACTION_FAMILY[r.verb] === "zone" || ACTION_FAMILY[r.verb] === "pump" || ACTION_FAMILY[r.verb] === "tail" || r.verb === "tap" || r.verb === "untap") && (r.object?.self === true || base.object === "~" || /^this\b/i.test(base.object ?? "")
          || (r.text !== undefined && (base.object ?? "").startsWith(`${r.text} from `))) ? base.object
        : r.text ?? base.object;
    // A NAMED PLAYER RIDES ON THE READING (a token maker's stored object is only the token, #1391 F2; and `actorFor` refuses a clause with two actions of one verb, so the other player's
    // half of "you and defending player each discard ..." / an edict after a sacrifice cost was left to the controller default, #1395). Only "you" and an opponent. An opponent is carried
    // for every verb; CEILING: "you" only for a create, or where the same verb is read for an opponent too (the pair's own half) -- a lone named "you" ("you may cast ...") already defaults to you.
    // "each other player" is the players OTHER THAN the one the sentence is about: yours when you act, but "Whenever a player casts ..., each other player copies that spell" (Hive Mind) and
    // "Whenever enchanted player casts ..." (Curse of Echoes) leave YOU among them, so a trigger that is not yours keeps it `any`. A gain of control is the later "who gains it" task.
    // CEILING: "each other player" is "other than the sentence's subject", and only a trigger that is not yours is guarded. "Target player draws two cards. Each other player discards a card." reads the
    // second half `opp` although you can be in that set (no corpus card is shaped so, 2026-10-29). A gain of control is deferred to its own task (#1395), not read here.
    const otherThanSomeoneElse = /\bother player\b/i.test(r.actor?.text ?? "") && clause.trigger != null && clause.trigger.control !== "you";
    const named1 = r.actor?.text !== undefined && r.actor.scope !== "that" && !otherThanSomeoneElse && r.verb !== "gains-control" && (r.actor.control === "you" || r.actor.control === "opp") ? r.actor.control : undefined;
    const namedActor: "you" | "opp" | undefined = named1 === "opp" || (named1 === "you" && (r.verb === "create" || readings.some((o) => o.verb === r.verb && o.actor?.text !== undefined && o.actor.scope !== "that" && o.actor.control === "opp"))) ? named1 : undefined;
    out[i] = ({
      ...base,
      ...(namedActor ? { actor: namedActor } : {}),
      ...(object !== undefined ? { object } : {}),
      // A BACK-REFERENCED amount ("that many", "that much life", "the same amount") names an earlier count the stored amount already resolves ("the number of -1/-1 counters on it", Oft-Nabbed Goat): it never replaces one.
      ...(r.amount !== undefined && !(BACK_REF_AMOUNT.test(r.amount) && base.amount != null && !BACK_REF_AMOUNT.test(base.amount) && !QUANTIFIER_AMOUNT.test(base.amount)) ? { amount: r.amount } : {}),
      ...(r.fromZone !== undefined ? { fromZone: r.fromZone } : {}),
      ...(r.toZone !== undefined ? { toZone: r.toZone } : {}),
      optional: r.optional === true,
      ...(r.condition ? { condition: r.condition } : {}),
    });
  });
  // A LIFE PAYMENT THE STORE LEFT OUT IS ADDED (owner 2026-10-02, the Rowan ruling): "As an additional
  // cost to cast this spell, pay X life" (Toxic Deluge) was stored as no action, so the life it
  // costs fed no life-loss payoff. Only a lose-life reading, only when the clause stores none: it
  // names no object a later "it" could take as its antecedent, which is the CEILING above.
  // Only where the store recorded NOTHING for the clause: added beside real actions (Meathook Massacre
  // II's "they may pay 3 life. If they don't, return ...") it became the clause's claim, "makes each
  // opponent lose 3 life" -- measured on 71 decks, refused.
  if (stored.every((a) => a.verb === "none" || a.verb === "other")) {
    for (const r of readings) {
      if (r.verb !== "lose-life" || r.amount === undefined || (r.actor && r.actor.control !== "you")) continue;
      out.push({ verb: "lose-life", object: r.text ?? "you", amount: r.amount, optional: r.optional === true, fromZone: null, toZone: null } as Action);
    }
  }
  return { ...clause, actions: out };
}

type GrammarTrigger = { verbs: Verb[]; subject: SubjectFilter; blocker?: SubjectFilter; batched?: true } | { refused: string; subject?: SubjectFilter };

function grammarTriggersOf(text: string, cardName: string | undefined, storedEvent: string, cardText: string, enchantText: string, siblingEvents: string[], precomputed?: TriggerReading[], curse?: boolean, creatureCard?: boolean, textlessSibling?: boolean): GrammarTrigger[] | null {
  // An Aura's "enchanted permanent" is the class its own face's Enchant line names (see subjectFrom).
  const bounded = boundedByEnchantLine(text, enchantText);
  const preamble = printedPreamble(bounded, cardName ?? "");
  if (!preamble) return null;
  // PRECOMPUTED READINGS (G-T3): `grammarClauseRecords` already ran `parseTrigger` on this exact
  // preamble while building the grammar's own records -- reuse it rather than parsing again. Only
  // when the enchant-line bounding above was a no-op: `grammarClauseRecords` reads the preamble off
  // the plain clause text, with no `boundedByEnchantLine` step, so a precomputed reading is only the
  // SAME computation when bounding changed nothing.
  // The condition with the card's name as "~", as the preamble: "if INALLA is on the battlefield".
  const read = precomputed && bounded === text
    ? precomputed
    : parseTrigger(preamble, interveningIfOf(cardName ? selfAsTilde(text, cardName) : text));
  if (!read) return null;
  const readings = [read].flat();
  // A compound the store SPLIT into one clause per event (Inferno Titan: two clauses, one text) takes
  // the readings of this clause's own event, of which there can be several ("this creature dies OR
  // another artifact you control is put into a graveyard from the battlefield", Scrap Trawler). One
  // the store kept as ONE clause takes every reading: Bilbo's "enters or leaves the battlefield" was
  // a single `enters` clause, and its leave was lost.
  // Events compare as NORMALIZED verbs: the store's `put-into-graveyard` is the grammar's `enters-graveyard`.
  const verbOf = (e: string): string => normalizeTriggerVerb(e) ?? e;
  const split = siblingEvents.length > 0;
  const mine = readings.filter((x) => verbOf(x.event) === verbOf(storedEvent));
  // A split record whose own event the grammar did not read takes the readings NO sibling record claims (Ultron's Auxiliary: stored `dies` + `exiled`, the grammar reads dies and the
  // graveyard limb), never a sibling's: borrowing `readings[0]` made the second record a second `dies` and lost the other limb (#1391). When every reading is claimed by a
  // sibling (a non-same-id split whose events all matched elsewhere) the old fallback, the first reading, stands.
  const claimedBySibling = new Set(siblingEvents.map(verbOf));
  const unclaimed = readings.filter((x) => !claimedBySibling.has(verbOf(x.event)));
  const chosen = !split ? readings : mine.length > 0 ? mine : unclaimed.length > 0 ? unclaimed : [readings[0]!];
  if (chosen.some((r) => r.event === "reflexive")) return null;
  const out = chosen.map((r) => grammarTriggerFrom(r, text, preamble, cardName, cardText, curse, creatureCard));
  // "Blocks or becomes blocked by <class>" stored as TWO records (#1381): the blocks half is refused (its class is a narrowing) while the becomes-blocked half is read. Taking every
  // reading on the first record would make it the live becomes-blocked ability and lose the blocks half's own (refused) ability, which the sibling record then folds away as
  // a twin. With a blocks / becomes-blocked sibling record (textless, or numbered into this sentence: Gorgon Recluse) and a MIXED answer, each record keeps its own event's reading, as a split compound does.
  if (!split && textlessSibling && mine.length > 0 && mine.length < readings.length && out.some((g) => "refused" in g) && out.some((g) => !("refused" in g))) {
    return mine.map((r) => grammarTriggerFrom(r, text, preamble, cardName, cardText, curse, creatureCard));
  }
  return out;
}

/** "...becomes blocked by this creature / by it / by equipped creature / by enchanted creature / by <the card's name>": the card (or its host) is the BLOCKER, not the creature the trigger watches. */
/** "Whenever ONE OR MORE creatures you control become blocked BY a creature" (#1381): `batched` would mean both the subject's batch and the blocker's, and one flag cannot say which, so the trigger is refused
 *  like an unreadable "by" phrase (0 corpus cards, 2026-10-27). Read off the printed trigger phrase: a "one or more" ahead of "becomes blocked by", before the first comma. */
const BATCHED_SUBJECT_BLOCKED_BY = /^[^,]*\bone or more\b[^,]*?\bbecomes? blocked by\b/i;
/** The printed "by ..." of a "becomes blocked by ..." trigger, up to the comma that ends the trigger phrase (#1381). */
const BLOCKED_BY_PHRASE = /\bbecomes? blocked (by [^,.;]+)/i;
function blockedBySelf(text: string, cardName?: string): boolean {
  const name = cardName ? cardName.split(" // ")[0]!.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "";
  return new RegExp(`\\bbecomes? blocked by (?:this creature|it|equipped creature|enchanted creature${name ? `|${name}` : ""})(?![\\w'])`, "i").test(text);
}

function grammarTriggerFrom(r: TriggerReading, text: string, preamble: string, cardName: string | undefined, cardText: string, curse?: boolean, creatureCard?: boolean): GrammarTrigger {
  // A CURSE'S ENCHANTED PLAYER IS AN OPPONENT (owner 2026-10-07): Maddening Hex's "whenever enchanted
  // player casts a noncreature spell" was refused as a narrowing to one player, so its damage had
  // no trigger. A Curse goes on an opponent in play, so the one player reads as an opponent; on any
  // other Aura the narrowing still refuses the claim (ruling 2026-10-01).
  if (curse && r.narrowing && /^enchanted (?:player|opponent)$/.test(r.narrowing)) {
    r = { ...r, narrowing: undefined, control: "opp", ...(r.subject ? { subject: { ...r.subject, control: "opp" } } : {}) };
  }
  const subject: SubjectFilter = { ...(r.subject ?? { control: r.control ?? "any", token: null }) };
  FROM_GRAMMAR.add(subject);
  // A refused EVENT is named before any condition: the event is the first thing the claim lacks.
  const verb = r.event === "damage-dealt"
    ? (r.damage === "combat" || (r.damage === undefined && COMBAT_DAMAGE.test(preamble)) ? "combat-damage" : "non-combat-damage") as Verb
    : r.event === "play" && subject.type === "land" ? "land-play" as Verb
    : r.event === "tapped-for-mana" ? null
    : normalizeTriggerVerb(r.event);
  if (!verb) return { refused: r.event === "tapped-for-mana" ? "taps-for-mana" : r.event };
  // Entering TRANSFORMED keeps the name the stored path gave it.
  if (verb === "enters" && /\btransformed\b/.test(r.narrowing ?? "")) return { refused: "enters-transformed", subject };
  if (r.condition && !classifyCondition(r.condition.text, { threshold: thresholdFor(text) !== undefined, selfDiesOnCreatureCard: verb === "dies" && subject.self === true && creatureCard === true }).represented) return { refused: `if:${r.event}`, subject };
  if (r.narrowing && !narrowingRepresented(r, text)) return { refused: `narrowing:${r.event}`, subject };
  // "Whenever a creature with deathtouch blocks or becomes blocked BY THIS CREATURE" (Mirror Shield, granted to the host): the watched creature is the OPPOSING one and the named blocker is the host or the card, so the
  // stored subject "this creature" would be a live self trigger on the wrong object. Refused rather than guessed (#1375 review).
  if (verb === "becomes-blocked" && blockedBySelf(text, cardName)) return { refused: "blocked-by-self", subject };
  if (verb === "becomes-blocked" && r.blocker && BATCHED_SUBJECT_BLOCKED_BY.test(text)) return { refused: "narrowing:becomes-blocked", subject };
  if (verb === "leaves" && WITHOUT_DYING.test(text)) subject.withoutDying = true;
  if (r.condition && SAME_NAME.test(r.condition.text)) subject.uniqueName = true;
  // "An enchanted / equipped creature" is CR 700.9's `modified`, the field producers state.
  if (subject.status?.some((x) => x === "enchanted" || x === "equipped")) {
    const rest = subject.status.filter((x) => x !== "enchanted" && x !== "equipped");
    if (rest.length > 0) subject.status = rest; else delete subject.status;
    subject.modified = true;
  }
  // The filter grammar's own post-steps, as `subjectFrom` applies them: "named ~" is the card, and a
  // CARD's owner is its `control` (CR 108.3).
  if (cardName && subject.named === "~") subject.named = cardName.split(" // ")[0]!.toLowerCase();
  if (subject.owner && subject.control === "any" && /\bcards?\b/i.test(preamble) && !/\bpermanents?\b/i.test(preamble)) subject.control = subject.owner;
  // On an attack the state is the event (see the stored path).
  if (verb === "attacks" && subject.combat === "attacking") delete subject.combat;
  if (verb === "blocks" && subject.combat === "blocking") delete subject.combat;
  // Only an attacking creature becomes blocked (CR 509.1h): "an attacking creature becomes blocked" states the event, not a narrowing.
  if (verb === "becomes-blocked" && subject.combat === "attacking") delete subject.combat;
  if (subject.sharesTypeWith === "self" && GRANTED_TO_COMMANDER.test(cardText)) subject.sharesTypeWith = "commander";
  return { verbs: [verb], subject, ...(verb === "becomes-blocked" && r.blocker ? { blocker: r.blocker, ...(r.batched ? { batched: true as const } : {}) } : {}) };
}

/** "those tokens" / "the token": not a PRONOUN_OBJECT, so it never resolves and emitted a wildcard token tap (Dog Walker). */
const CREATED_TOKEN_REF = /^(?:the|that|those|these) tokens?$/i;
const TAPPED_WORD = /\btapped\b/i;
/** An imperative tap of the created thing ("create a token, then tap it"): that one IS a tap event. */
const TAPS_IT = /\btap (?:it|them|that token|those tokens|the tokens?)\b/i;
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

/** A counter trigger whose SUBJECT says the counters came off. Read on the subject and not on the
 *  clause text, deliberately: a planeswalker's text names both directions in different sentences
 *  ("counters are removed" in the trigger, "put a loyalty counter" in a loyalty ability), so a
 *  card-scoped test would refuse the ADDING half too. The subject is the one string that describes
 *  THIS trigger. */
const COUNTER_REMOVED = /\bremoved?\b/i;

/** An `enters` trigger whose SUBJECT says the permanent enters TRANSFORMED (Corruption of Towashi,
 *  the one corpus card, 2026-09-25). Not an enters event any permanent supplies, and no engine
 *  verb names it (CR 701.27a), so it is refused like `taps-for-mana`. */
const ENTERS_TRANSFORMED = /\benters?\s+(?:the\s+battlefield\s+)?transformed\b/i;

/** THE TEXT THIS CLAUSE WAS WRITTEN FROM, when the normalizer's clause id is not one the segmenter
 *  produced.
 *
 *  THE DEFECT, measured 2026-08-23 (roadmap K3c): the model SPLITS an or-trigger into two clauses
 *  while `segment()` produces one, so the second clause carries an id no segmenter clause has and
 *  `clauseTexts[id]` is undefined. Archon of Cruelty is the witness -- one printed sentence,
 *  "Whenever this creature enters OR ATTACKS, target opponent sacrifices a creature", derived
 *  `control: "opp"` on the enters branch and `control: "any"` on the attacks branch, because
 *  `actionRecipients` never ran for the branch with no text. It is why K3a's filter could not reach
 *  that card.
 *
 *  IT IS NOT ONLY ABOUT CONTROL. Six derive rules read this text -- recipients, the controller
 *  default, `arrivesTapped`, the intervening-if, the threshold and the replacement frame -- and
 *  every one of them silently degrades to "say nothing" for an orphan clause. Measured: 40 of 2,667
 *  clause documents (1.5%) carry one, Mirkwood Bats among them, which is the same card the
 *  or-trigger family (G2c) is filed on.
 *
 *  TWO RESOLVABLE SHAPES AND NO GUESSING BEYOND THEM:
 *   - a DECIMAL sub-id ("2.1") is the model numbering a split of segment 2, so the base id is the
 *     answer and is read directly;
 *   - an INTEGER sibling is matched by the one thing that distinguishes it -- its TRIGGER EVENT.
 *     `triggerHasCue` is the predicate the phantom-trigger guard already uses, so if exactly ONE
 *     segmented text carries a printed cue for this clause's event, that text is the sentence the
 *     clause was split out of.
 *
 *  AMBIGUITY RETURNS THE EMPTY STRING, which is today's behaviour: a missing answer beats a wrong
 *  one, and adopting the wrong sentence would let a recipient or a controller default fire on words
 *  from a DIFFERENT ability. */
export function textForClause(
  clause: { id: number | string; trigger?: { event?: string } | null },
  clauseTexts?: Record<number, string>,
): string {
  if (!clauseTexts) return "";
  const own = clauseTexts[clause.id as number];
  if (own) return own;
  // "2.1" -> 2. `Number.parseInt` stops at the dot, which is exactly the base id.
  const base = Number.parseInt(String(clause.id), 10);
  if (Number.isFinite(base) && clauseTexts[base]) return clauseTexts[base];
  const event = clause.trigger?.event;
  if (!event) return "";
  const hits = Object.values(clauseTexts).filter((t) => t && triggerHasCue(event, t));
  return hits.length === 1 ? hits[0] : "";
}

/** A clause that reveals or looks at cards: its pronouns may mean a card no action records (#896 task 4). */
const REVEALS = /\b(?:reveals?|looks? at)\b/i;
const ENTERS_PREPARED = /\benters prepared\b/i;
const BECOMES_PREPARED = /\bbecomes? prepared\b/i;

/** The sentence a record numbered into the WRONG one belongs to. Its own text carries no printed cue for its event but another clause's text
 *  does. Returns that sentence when exactly one such text is not already the text of a record with the same event (a mode bullet repeating
 *  its header's trigger keeps its own text: its header IS the same-event owner); `""` when several are, so no printed text is read at all;
 *  `undefined` when the record is not misplaced or only a same-event owner carries the cue. */
/** A reflexive sentence ("When you do", "When they do", "Whenever a card is drawn this way"): its event is the previous sentence's verb by the store's convention. */
// One to four words between "when" and "do", each word then one space: no overlap between the parts, so no backtracking (CodeQL polynomial-redos).
// CEILING: a reflexive opening of five or more words ("Whenever one or more of them do") or with a double space is not matched; over the
// corpus's 109198 sentences the four-word form matches the same 407 as the unbounded one did (2026-10-15).
const REFLEXIVE_OPENING = /^\s*(?:when|whenever)\s(?:[\w']+\s){1,4}(?:do|does)\b/i;
function isReflexiveText(text: string): boolean {
  const t = withoutAbilityWord(text);
  return REFLEXIVE_OPENING.test(t) || /\bthis way\b/i.test(t.split(",")[0] ?? "");
}

function homeOfMisplaced(
  clause: { id: number | string; trigger?: { event?: string } | null },
  clauses: readonly { id: number | string; trigger?: { event?: string } | null }[],
  clauseTexts?: Record<number, string>,
): string | undefined {
  const event = clause.trigger?.event;
  if (!event || !clauseTexts) return undefined;
  const own = textForClause(clause, clauseTexts);
  if (!own || triggerHasCue(event, own)) return undefined;
  // A REFLEXIVE "When you do" sentence is numbered the previous sentence's verb as its event -- the store's convention, not drift (Curious Forager).
  if (isReflexiveText(own)) return undefined;
  const hits = [...new Set(Object.values(clauseTexts).filter((t) => t && t !== own && triggerHasCue(event, t)))];
  const orphans = hits.filter((t) => !clauses.some((c) => c !== clause && c.trigger?.event === event && textForClause(c, clauseTexts) === t));
  return orphans.length === 0 ? undefined : orphans.length === 1 ? orphans[0] : "";
}

/** A sentence of the clause says EXILE ... TOP ... LIBRARY, in that order. LINEAR: split on the full stop, then three single scans (the first exile, the first top after it, a library after that); the
 *  first match of each is the widest remainder, so this answers exactly what `/\bexiles?\b[^.]*\btop\b[^.]*\blibrar/i` did, which was polynomial on "exile top exile top ..." (CodeQL, #1266). */
export function exilesTopOfLibrary(text: string): boolean {
  for (const sentence of text.split(".")) {
    const ex = /\bexiles?\b/i.exec(sentence);
    if (ex === null) continue;
    const afterExile = sentence.slice(ex.index + ex[0].length);
    const top = /\btop\b/i.exec(afterExile);
    if (top !== null && /librar/i.test(afterExile.slice(top.index + top[0].length))) return true;
  }
  return false;
}

/** An ability apart from its clause, amount and count, as JSON whose object keys are sorted: the same ability built with its keys in another order (Primeval Herald's twin) compares equal. */
export function abilityKey(x: Ability): string { const { clause: _c, amount: _a, count: _n, ...rest } = x; return stableJson(JSON.parse(JSON.stringify(rest))); }

/** AN AMOUNT SPELLING, NORMALISED FOR THE TWIN FOLD (#1380): lower-case, `+` deleted, `-` kept (the sign of a pump is its meaning), every other non-alphanumeric a space.
 *  "+X/+0, where X is" -> "x 0 where x is"; "-1/-1" -> "-1 -1"; "+1/+1" -> "1 1". */
const normaliseAmount = (t: string): string => t.toLowerCase().replace(/\+/g, "").replace(/[^a-z0-9-]+/g, " ").trim();
/** A twin's amount is covered when absent, or equal to the covering one after normalising, or the covering one is the twin plus a trailing "where X is ..." explanation
 *  (Mana-Charged Dragon's "X/0" inside "+X/+0, where X is ..."), or the twin is the whole of that explanation (Freelance Muscle's "the greatest power and/or
 *  toughness among ..." beside "+X/+X, where X is the greatest power and/or toughness among ..."). Never a mere sub-run: "1" is not inside "+1/+1", "12" does not hold "1". */
export function amountCovered(twin: string | undefined, covering: string | undefined): boolean {
  if (twin === undefined) return true;
  if (covering === undefined) return false;
  const t = normaliseAmount(String(twin)), c = normaliseAmount(String(covering));
  return t === c || c.startsWith(`${t} where `) || c.endsWith(` where x is ${t}`);
}
/** A twin's count is covered when absent, or equal to the covering one. */
export function countCovered(twin: EventCount | undefined, covering: EventCount | undefined): boolean {
  return twin === undefined || JSON.stringify(twin) === JSON.stringify(covering);
}

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
  /** Clause ids whose ability was granted to a token the same clause creates — `segment.ts`'s
   *  `grantedToOwnToken`. They derive NOTHING here: the token carries the ability on its own row,
   *  so deriving it on the card as well states the relation twice. Absent disables the guard rather
   *  than guessing, the same contract `oracleText` and `clauseTexts` have. */
  grantedToken?: ReadonlySet<number>,
  /** Clause id -> which face prints it, from `segment()`. Stamped onto every ability the clause
   *  derives, so a back-face ability stops being indistinguishable from a front-face one. */
  clauseFaces?: Record<number, number>,
  /** The card is cast at instant speed -- an Instant, or a spell with flash -- so its on-cast emits
   *  are `instantSpeed`. Read off characteristics by `deriveCardTags`; absent means no. */
  castAtInstantSpeed?: boolean,
  /** Clause id -> a game-state requirement, attached to every ability the clause produces. */
  clauseRequires?: Record<number, Requirement>,
  /** Clause id -> the grammar's own readings (G-T3), from `DeriveInput.readings`. Passed to
   *  `withGrammarActions` / `grammarTriggersOf` below so a clause the grammar already read does not
   *  get re-parsed on the grammar path's own derive. */
  readings?: Record<number, { trigger?: TriggerReading[]; actions?: ActionReading[] }>,
  /** The card is a Curse: its enchanted player is an opponent (owner 2026-10-07). */
  curse?: boolean,
  /** The card's printed type line includes Creature (WAS_A_CREATURE reads only then). */
  creatureCard?: boolean,
  /** Granted clause id -> the clause that grants it (`DeriveInput.clauseGrants`): a quoted ability's own "this creature" is the grantee. */
  clauseGrants?: Record<number, number>,
  /** Clause ids that are a modal spell's or ability's header (`derive/modal.ts`): each is supplied the `face-a-dilemma` event once (Star Trek, #1349). Absent: none is. */
  modalHeads?: ReadonlySet<number>,
  /** Collapse one printed search over several zones into one action (`collapseZoneSearches`). Off only for the grammar switch's DECISION (derive-worker.ts). */
  collapseSearches = true,
): { abilities: Ability[]; unclaimed: Action[]; unclaimedAt: UnclaimedAction[]; unknownTriggers: string[]; twinOf: ReadonlyMap<number | string, number | string>; spliced: ReadonlySet<number | string>; folded: ReadonlyMap<number | string, number | string> } {
  const abilities: Ability[] = [];
  /** Every action nothing claimed, with the clause that printed it (#1299). `unclaimed` is the same list as bare actions. */
  const unclaimedHere: { clause: number | string; action: Action }[] = [];
  let clauseId: number | string = 0;
  const unclaimed = { push(action: Action): void { unclaimedHere.push({ clause: clauseId, action }); } };
  const unknownTriggers: string[] = [];
  // CLEAVE (CR 702.148): "if you cast this spell for its cleave cost, remove the words in square brackets". The model keeps
  // the bracketed words as if they were printed ("Return target nonland permanent [you control]" -> "...you control"), so
  // Alchemist's Retrieval read as a bounce of YOUR permanent. The bracketed words are optional and the unbracketed reading
  // is the cast with cleave, which is the wider one: any nonland permanent (#1295). CEILING: the card's NORMAL cast, with
  // the words, is the narrower reading and is not modelled; a derive says one thing about a card.
  const cleaveWords = /\bcleave\b/i.test(oracleText ?? "") ? [...(oracleText ?? "").matchAll(/\[([^[\]]+)\]/g)].map((m) => m[1]!) : [];
  if (cleaveWords.length > 0) {
    // No `\s*` before the bracket (CodeQL js/polynomial-redos): cut the bracket, then close the gap it leaves.
    const unbracketed = (t: string): string => t.replace(/\[[^[\]]*\]/g, "").replace(/ {2,}/g, " ").replace(/ ([.,;:])/g, "$1");
    // An action's object is the model's paraphrase, with the brackets already gone: remove the words the CLAUSE's own text brackets.
    const words = (id: number | string): string[] => cleaveWords.filter((w) => (clauseTexts?.[id as number] ?? "").includes(`[${w}]`));
    const drop = (object: string, ws: string[]): string => ws.reduce((acc, w) => acc.replace(new RegExp(`\\s*${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"), ""), object);
    clauses = clauses.map((c) => ({ ...c, actions: (c.actions ?? []).map((a) => (typeof a.object === "string" ? { ...a, object: drop(a.object, words(c.id)) } : a)) }));
    if (clauseTexts) clauseTexts = Object.fromEntries(Object.entries(clauseTexts).map(([id, t]) => [id, unbracketed(t)]));
    oracleText = unbracketed(oracleText ?? "");
  }
  // EXILING THE TOP OF A LIBRARY IS NOT A MILL (CR 701.17a: milling puts the top cards of a library into the GRAVEYARD; #1266). The model files "that player exiles the top two cards of their
  // library" (Sire of Stagnation), "defending player exiles the top twenty cards" (Ulamog, the Ceaseless Hunger) and "exiles cards from the top of their library until they exile a nonland card" (Black
  // Widow, Plargg and Nassari, Possibility Storm, Lidless Gaze) under the verb `mill`. Where the clause's own sentence says exile and never says mill or graveyard, the action is an EXILE from the
  // library: it is dropped when the clause already carries that exile as an action of its own (Lidless Gaze, Plargg), and rewritten to one otherwise.
  const MILL_WORDS = /\bmills?\b|\bgraveyards?\b/i;
  clauses = clauses.map((c) => {
    const text = clauseTexts?.[c.id as number] ?? "";
    if (!exilesTopOfLibrary(text) || MILL_WORDS.test(text) || !(c.actions ?? []).some((a) => a.verb === "mill")) return c;
    const hasOwnExile = (c.actions ?? []).some((a) => a.verb === "exile" && a.fromZone === "library");
    // The model's follow-up "exile those cards" / "exile cards exiled this way" (Atsushi, Chandra, Heart of Fire) restates the exile the rewritten action now IS: kept, it would exile the cards a second time
    // with no zone and no owner.
    const restates = (a: Action): boolean => !hasOwnExile && a.verb === "exile" && a.fromZone === null && /^(?:those cards|them|cards exiled this way|the exiled cards)$/i.test((a.object ?? "").trim());
    const actions = (c.actions ?? []).filter((a) => !restates(a)).flatMap((a): Action[] => {
      if (a.verb !== "mill") return [a];
      if (hasOwnExile) return [];
      // WHOSE LIBRARY: the object's own phrase when it names one ("top three cards of your library", "the top card of each player's library"), else the player it names ("that player" -> "that player's
      // library"), else "their library". A fixed "their library" read an exile from YOUR library as any player's (Chandra, Heart of Fire; Atsushi).
      const object = typeof a.object !== "string" || a.object === "" ? "cards from the top of their library"
        : /librar/i.test(a.object) ? a.object : `cards from the top of ${a.object}'s library`;
      return [{ ...a, verb: "exile", object, fromZone: "library", toZone: "exile" }];
    });
    return { ...c, actions };
  });
  // The whole card's text, for the phantom-trigger guard below. CARD-scoped on purpose and never
  // per clause -- see `triggerHasCue`, where scoping it to the clause was measured and refuses 18
  // real modal triggers to catch 1 phantom. Absent `clauseTexts` disables the guard rather than
  // guessing, the same contract `recipient.ts` has.
  const cardText = oracleText ?? "";
  /** The nearest earlier clause's own trigger event, for a trigger-less continuation to inherit.
   *  See `rawTrigger` below. */
  let inheritedRaw: RawTrigger | undefined;
  /** The nearest earlier clause's whole trigger, for a mode bullet that states none (#846). */
  let inheritedTrigger: (typeof clauses)[number]["trigger"];
  /** ...and the trigger the header DERIVED, which the bullet takes verbatim. */
  let headerTrigger: Ability["trigger"];
  /** ...and what the header's trigger REFUSED (`if:attacks`, `narrowing:...`), which each of its modes records again
   *  instead of re-reading the raw trigger against its own bullet (it has no "if" there: Jin Sakai's modes heard every attack). */
  let headerRefused: string[] = [];

  /** EVERY TRIGGER OF A MODAL HEADER (#1349 review): "Whenever Captain Kirk enters or attacks, choose one" is two header records (the
   *  grammar's second is appended at the END of the card; a stored answer has it beside the first), and a bullet inherits the nearest one
   *  only, so the modes read as firing on entering alone. Each header's own derived state, by clause id, for the visits below. */
  /** By id AND event: a header stored as two same-id records (Balor) must not collide. */
  const headerKey = (c: ClauseRecord): string => `${c.id}|${c.trigger?.event ?? ""}`;
  const headerStates = new Map<string, { inheritedTrigger: typeof inheritedTrigger; headerTrigger: Ability["trigger"]; headerRefused: string[] }>();
  /** The mark at which a duplicate mode visit began: what it pushed to `unclaimed` / `unknownTriggers` repeats its first visit's, so it is cut back. */
  let dupMark: { unclaimed: number; unknown: number } | undefined;
  const visits = modeVisits(clauses, clauseTexts);
  /** The last header visited was a modal one: a textless twin right after it (the grammar's "enters or attacks" overflow record) is the same modal ability under its other trigger. */
  let modalOpen = false;

  /** What an earlier clause exiled, for "the exiled card" in a later one (#860). */
  let lastExiled: string | undefined;
  /** Per clause text, the trigger verbs a record has already read off it (see `misplaced`). */
  const grammarCovered = new Map<string, Map<string, number | string>>();
  /** Re-homed records dropped-if-redundant: clause id -> the id of the record that already read their event off the same sentence. */
  const twinOf = new Map<number | string, number | string>();
  /** Textless records whose event another clause's grammar reading of the same sentence covers; folded only where an ability is identical (#1373 review). */
  const identicalTwinOf = new Map<number | string, number | string>();
  for (const visit of visits) {
    if (dupMark) { unclaimedHere.length = dupMark.unclaimed; unknownTriggers.length = dupMark.unknown; dupMark = undefined; }
    if (visit.k) dupMark = { unclaimed: unclaimedHere.length, unknown: unknownTriggers.length };
    let clause = visit.clause;
    // FACE A DILEMMA (Star Trek, #1349): a modal header, or the textless twin of one, supplies the event once per trigger.
    const modalTwin: boolean = modalOpen && !visit.k && triggerHeaderOnly(clause) && clauseTexts?.[clause.id as number] === undefined;
    const facesDilemma: boolean = !visit.k && (modalHeads?.has(clause.id as number) === true || modalTwin);
    if (!visit.k) modalOpen = facesDilemma;
    // A mode of a multi-trigger header is visited once per header trigger, each time under that trigger's own derived state.
    const headerState = visit.group ? headerStates.get(headerKey(visit.group[visit.k ?? 0]!)) : undefined;
    if (headerState) ({ inheritedTrigger, headerTrigger, headerRefused } = headerState);
    clauseId = clause.id;
    const refusedBefore = unknownTriggers.length;
    // "THE EXILED CARD" IS WHAT AN EARLIER CLAUSE EXILED (#860): see `exiledAcrossClauses`.
    ({ clause, lastExiled } = exiledAcrossClauses(clause, lastExiled, cardName));
    // The whole clause goes, not just its trigger. What is quoted on a created token is a complete
    // ability -- Vivi's Persistence's Wizard both watches the cast AND deals the damage -- so
    // keeping the effect and dropping the trigger would leave the card claiming to do a thing it
    // never does. The token's own derived row carries both halves.
    // SILENT BY DESIGN, NOT UNCLAIMED (#1299): the token's or emblem's own derived row carries this clause.
    if (grantedToken?.has(clause.id)) continue;
    // A MISPLACED RECORD READS NO TEXT BUT ITS OWN SENTENCE. The stored numbering drifts from `segment()`'s when the model splits a compound
    // (Astrid Peth) or merges two sentences (Kratos): a record whose event has NO printed cue in the text numbered to it, but does in other
    // clauses' texts, was numbered into the wrong sentence. EXACTLY ONE other text carrying the cue re-homes it there (trigger kept as stored,
    // effect read off that sentence); none-or-several leave it NO printed text (the stored reading alone). Mixing the stored trigger with another
    // sentence's effect was Kratos at 314: a `dies` trigger carrying the end-step's +1/+1 counters.
    const rehomed = homeOfMisplaced(clause, clauses, clauseTexts);
    // A TEXTLESS TWIN TAKES ITS PARTNER'S READING (#1395, Wernog): the grammar's "enters or leaves" records are two with IDENTICAL actions, the reading keyed to the first only. Unread, the twin kept
    // the stored `any` actor beside its partner's `you`, the identical-twin fold (exact abilityKey) no longer matched, and the card grew duplicate abilities. Only an identical-action sibling whose own sentence names THIS record's event is used (Tome of Legends' attacks record is not a twin of its page-counter sentence).
    const twinSource = rehomed === undefined && clauseTexts?.[clause.id] === undefined && readings?.[clause.id] === undefined && clause.trigger?.event
      ? clauses.find((c) => c.id !== clause.id && readings?.[c.id] !== undefined && clauseTexts?.[c.id] !== undefined && triggerHasCue(clause.trigger!.event!, clauseTexts[c.id]!) && JSON.stringify(c.actions) === JSON.stringify(clause.actions))
      : undefined;
    clause = twinSource
      ? withGrammarActions(clause, clauseTexts![twinSource.id], clauseCosts?.[twinSource.id], cardName, readings![twinSource.id]?.actions)
      : withGrammarActions(clause, rehomed ?? clauseTexts?.[clause.id], clauseCosts?.[clause.id], cardName, readings?.[clause.id]?.actions);
    if (collapseSearches) clause = collapseZoneSearches(clause);
    // WHICH FACE PRINTS THIS CLAUSE. Stamped onto every ability the clause derives below, so the
    // matcher can stop reading a back-face ability against the card's UNION of types.
    const face = clauseFaces?.[clause.id];
    // THE ENCHANT LINE IS READ OFF THIS CLAUSE'S OWN FACE when faces are known (review, 2026-09-06):
    // `cardText` is the whole card, and a card with an Aura on each face has two Enchant lines.
    const enchantText = face !== undefined && clauseTexts
      ? Object.entries(clauseTexts).filter(([id]) => clauseFaces?.[Number(id)] === face).map(([, t]) => t).join("\n")
      : cardText;
    const kind = abilityKind(clause);
    // A MODE TAKES ITS HEADER'S TRIGGER (#846). "Whenever you cast a spell, choose up to one —"
    // segments into a trigger clause and one clause per bullet, and the model repeats the trigger on
    // some bullets (Kairi, the Swirling Sky) and not on others (Hullbreaker Horror, 306 corpus
    // clauses). A bullet without one derived an ability with no trigger that never fires, so it
    // takes the nearest earlier triggered clause's, by the same adjacency rule as the raw event
    // below. The header keeps its own blank ability, so no edge the header formed is lost.
    // THE DERIVED TRIGGER IS COPIED, NOT RE-READ: the header's subject is read against the header's
    // text (Teval's Judgment: "cards leave YOUR GRAVEYARD" -> zone graveyard), and a bullet's text
    // ("Draw a card.") would lose it and read a graveyard exit as a battlefield one.
    // A CR 614 BULLET KEEPS ITS OWN: Rankle and Torbran's "if a source would deal damage ... instead"
    // synthesizes the damage trigger it hears (`replacementOf`), and the header's would erase it.
    const inherits = kind === "triggered" && !clause.trigger?.event && inheritedTrigger !== undefined
      && !replacementOf(textForClause(clause, clauseTexts));
    // ...unless the header's trigger was REFUSED: the mode keeps the clause's trigger for the SUBJECT it reads ("It gains X"
    // is the creature you control), says the same refusal, and derives no trigger below.
    // ...and not at all under a header trigger the engine has no verb for (a refused trigger such as "becomes-target"): it would derive a mode that never fires.
    if (visit.k && (!inherits || !headerTrigger)) continue;
    if (inherits) { clause = { ...clause, trigger: inheritedTrigger }; unknownTriggers.push(...headerRefused); }
    else if (!clause.trigger?.event && kind !== "triggered") { inheritedTrigger = undefined; headerTrigger = undefined; headerRefused = []; }
    // THE RAW TRIGGER EVENT, FOR THE LABELLER ONLY (`repeatsFor`). An event outside the `Verb`
    // union reaches `unknownTriggers` below and the ability derives with no trigger, so this is the
    // one channel through which "at the beginning of your first main phase" can still say it is a
    // phase. A TRIGGERED clause that states no trigger of its own is a mode or a continuation of
    // the nearest earlier trigger on the card -- "choose one or more --" segments into clauses that
    // repeat no trigger (Black Market Connections, 306 such clauses corpus-wide) -- so it inherits
    // that event. CEILING: adjacency, not a parsed modal tree; a static or activated clause in
    // between ends the inheritance, so a later stray continuation cannot claim an unrelated trigger.
    const rawTrigger: RawTrigger | undefined = clause.trigger?.event
      ? { event: clause.trigger.event, ...(clause.trigger.control ? { control: clause.trigger.control } : {}) }
      : kind === "triggered" ? inheritedRaw : undefined;
    inheritedRaw = clause.trigger?.event ? rawTrigger : kind === "triggered" ? inheritedRaw : undefined;
    // Who performs each action, when the clause names someone the object text does not carry. The
    // cue localises the actor to a VERB, not to an action, so a clause with two actions of that verb
    // is ambiguous and is left alone -- a missing answer beats a wrong one.
    const clauseText = rehomed ?? textForClause(clause, clauseTexts);
    // "EACH CREATURE YOU CONTROL BECOMES PREPARED" IS A PREPARE, NOT A GRANT (CR 722.3a). Codie,
    // Ravenous Codex's activated ability came back from the model as `grant-ability` even with
    // `prepare` in the vocabulary, so the one card that prepares a whole board prepared nothing.
    // Read off the clause text, narrowly: only a grant whose clause says the thing becomes prepared.
    // ONE GRANT, NEVER EVERY GRANT (review of #669): the grant whose own object says "prepared", or the
    // clause's ONLY grant -- Codie's object is "each creature you control" -- so "becomes prepared and
    // gains hexproof" keeps its hexproof.
    const grants = (clause.actions ?? []).filter((a) => a.verb === "grant-ability");
    if (grants.length > 0 && BECOMES_PREPARED.test(clauseText)) {
      const named = grants.filter((a) => /\bprepared\b/i.test(a.object ?? ""));
      const which = new Set(named.length > 0 ? named : grants.length === 1 ? grants : []);
      if (which.size > 0) clause = { ...clause, actions: (clause.actions ?? []).map((a) => which.has(a) ? { ...a, verb: "prepare" } : a) };
    }
    // "EXILE JILL, THEN RETURN IT TO THE BATTLEFIELD TRANSFORMED" (#715): the model gave the return no
    // zones, so the flicker read as an exile and nothing more, and the re-entry fed no enter payoff.
    // Filled from the clause's own words, only when an exile precedes it in the same clause.
    const acts = clause.actions ?? [];
    // ONE return only (review): with two, nothing says which one the words describe.
    if (acts.some((a) => a.verb === "exile") && acts.filter((a) => a.verb === "return").length === 1 && RETURN_TO_BATTLEFIELD.test(clauseText)) {
      clause = { ...clause, actions: acts.map((a) => a.verb === "return" && !a.fromZone && (!a.toZone || a.toZone === "battlefield") ? { ...a, fromZone: "exile", toZone: "battlefield" } : a) };
    }
    // THE ZONE THE OBJECT NAMES WHEN THE MODEL GAVE NONE (#716): Emry, Lurker of the Loch's "cast
    // target artifact card IN YOUR GRAVEYARD" came back with `fromZone: null`, so the cast from a
    // graveyard -- recursion -- read as a plain cast and Mnemonic Sphere's self-sacrifice fed nothing.
    // Only a verb that MOVES a card out of a zone (review): a count ("for each card in your
    // graveyard") names the graveyard without taking anything from it.
    // ...AND AN EXILE WHOSE OBJECT NAMES ONLY GRAVEYARDS (#1266): "target cards from graveyards" (Erebos's Intervention), "from a single graveyard", "all
    // graveyards", "that player's graveyard", "from defending player's graveyard" came back with no origin, so the exile was no graveyard exile at all.
    const zoneless = (a: { verb?: string; fromZone?: string | null; object?: string }) =>
      !a.fromZone && ZONE_MOVING_VERBS.has(a.verb ?? "") && (OBJECT_IN_GRAVEYARD.test(a.object ?? "") || (a.verb === "exile" && exileNamesOnlyGraveyards(a.object ?? "") && !WOULD_BE_PUT_INTO.test(clauseText)));
    // THE REPLACEMENT "IF <X> WOULD BE PUT INTO A GRAVEYARD, EXILE IT INSTEAD" (#1266 task 2, #1306), read off the printed clause, one shape for every card:
    //   a SPELL rider ("If that spell would be put into your graveyard", Kess, Chandra, Mavinda) exiles the spell FROM THE STACK (CR 614: it never reaches the graveyard);
    //   an opponent's or any graveyard ("from anywhere": Leyline of the Void, Rest in Peace, Dryad Militant, Valgavoth) is a graveyard-hate exile whose emit says whose;
    //   YOUR graveyard (Magus of the Will, Walk-In Closet) is no graveyard exile and no hate.
    // The replacement is the clause's LAST exile (the model sometimes also misreads the cast it follows as an exile of the same object: Mavinda, dropped).
    const replacing = graveyardReplacement(clauseText);
    if (replacing) {
      const acts = clause.actions ?? [];
      // The card's own exile ("Exile this Saga", a flicker's, a cost's) is no replacement.
      // ...nor its own NAME ("Exile Sins of the Past", "Exile Invoke Calamity").
      const ownName = (o: string): boolean => { const n = (cardName ?? "").toLowerCase(), x = o.trim().toLowerCase(); return n !== "" && x !== "" && n.split(" // ").some((f) => f === x || f.split(",")[0] === x); };
      const last = acts.map((a, i) => a.verb === "exile" && !/^this\b/i.test((a.object ?? "").trim()) && !ownName(a.object ?? "") ? i : -1).reduce((m, i) => Math.max(m, i), -1);
      if (last >= 0) {
        const cast = new Set(acts.filter((a) => a.verb === "cast" || a.verb === "play").map((a) => (a.object ?? "").trim().toLowerCase()));
        clause = { ...clause, actions: acts.flatMap((a, i): Action[] => {
          if (i !== last) return replacing.kind === "rider" && a.verb === "exile" && cast.has((a.object ?? "").trim().toLowerCase()) ? [] : [a];
          if (replacing.kind === "rider") return a.fromZone === "stack" ? [a] : [{ ...a, object: "a spell cast this way", fromZone: "stack", toZone: "exile" } as Action];
          if (replacing.kind === "hate") return [{ ...a, fromZone: "graveyard", toZone: "exile" } as Action];
          return [{ ...a, fromZone: null, toZone: "exile" } as Action];
        }) };
      }
    }
    if ((clause.actions ?? []).some(zoneless)) {
      clause = { ...clause, actions: (clause.actions ?? []).map((a) => zoneless(a) ? { ...a, fromZone: "graveyard" } : a) };
    }
    // A STORED SEARCH OF A BARE LIBRARY TAKES ITS CARD FROM THE PUT THAT FOLLOWS (#1266): Tempt with Discovery's third search is stored as `your library`, then `put a land card`,
    // because the grammar left that sentence unread; the first two were read as "a land card". The card the search finds is the put's, as the grammar's own reading has it, so
    // "your library for a land card" is what the search says (the owner stays in the object). A put of a pronoun names nothing. 7 stored clauses have the shape.
    const bareSearchFound = (a: Action, i: number, all: readonly Action[]): string => {
      const next = all[i + 1], found = (next?.object ?? "").trim();
      return a.verb === "search" && BARE_LIBRARY.test((a.object ?? "").trim()) && next?.verb === "put" && found !== "" && !FOUND_OBJECT.test(found) ? found : "";
    };
    if ((clause.actions ?? []).some((a, i, all) => bareSearchFound(a, i, all) !== "")) {
      clause = { ...clause, actions: (clause.actions ?? []).map((a, i, all) => bareSearchFound(a, i, all) !== "" ? { ...a, object: `${(a.object ?? "").trim()} for ${bareSearchFound(a, i, all)}` } : a) };
    }
    // A QUOTED GRANT THE MODEL LEFT WITHOUT AN ACTION (#711): Enduring Vitality's `Creatures you
    // control have "{T}: Add one mana of any color."` came back as a static clause with no actions,
    // the quoted ability segmented as a clause of its own -- so nothing said who receives it. The
    // grant is on the text; the recipient gate is the ordinary grant path's.
    // No action, or only the placeholder `none` the canonical record stores (Enduring Vitality's).
    if (clause.abilityType === "static" && (clause.actions ?? []).every((a) => !a.verb || a.verb === "none") && QUOTED_GRANT.test(clauseText)) {
      clause = { ...clause, actions: [{ verb: "grant-ability", object: "that ability" }] };
    }
    // LAZY (#1263): "that player" after the card's own combat damage needs the trigger's `self`, which is
    // read further down; actorFor is only called once the trigger is settled.
    let actors: Record<string, Control> | undefined;
    const actorFor = (verb?: string): Control | undefined => {
      if ((clause.actions ?? []).filter((a) => a.verb === verb).length !== 1) return undefined;
      actors ??= clauseText ? actionRecipients(clauseText, { triggerIsSelf: trigger?.subject.self === true, cardName }) : {};
      return actors[verb ?? ""];
    };
    const text = clauseText;
    const cost = clauseCosts?.[clause.id] ?? "";
    // A CLEANUP OF THE TOKENS THE PREVIOUS CLAUSE MADE is that maker's own temporary departure, not
    // a sacrifice outlet (issue #502). `segment()` splits Redoubled Stormsinger's "At the beginning
    // of the next end step, sacrifice those tokens." into a clause of its own, so the same-clause
    // rider above never saw it and every token in the deck read as its fodder. Only when the clause
    // before made tokens; "sacrifice it" after a reanimation stays what it was.
    const cleanup = text ? NEXT_END_STEP_CLEANUP.exec(text.trim()) : null;
    const prior = cleanup ? abilities.filter((a) => a.clause === clause.id - 1) : [];
    // A clause that ALSO puts a nontoken onto the battlefield gives "sacrifice it" two antecedents;
    // refused rather than guessed.
    const ambiguous = prior.some((a) => (a.emits ?? []).some((e) => e.verb === "enters" && e.subject.token !== true));
    const maker = ambiguous ? undefined : prior.find((a) => a.effect.kind === "token-generation");
    if (cleanup && maker) {
      const made = (maker.emits ?? []).find((e) => e.verb === "create-token");
      maker.temporary = true;
      if (made && !(maker.emits ?? []).some((e) => e.verb === "leaves" || e.verb === "dies")) {
        maker.emits = [...(maker.emits ?? []), { verb: /^sacrifice$/i.test(cleanup[1]) ? "dies" : "leaves", subject: { ...made.subject } }];
      }
      // SILENT BY DESIGN, NOT UNCLAIMED (#1299): the cleanup's home is the maker's `temporary` flag and its leave/die emit above.
      continue;
    }
    // WHAT A REFERENCE OBJECT POINTS AT: see `references.ts`.
    const sourceOf = (idx: number) => antecedentSource(clause.actions ?? [], idx, clause.trigger?.subject, cardName, text);
    const antecedentFor = (idx: number): string | undefined =>
      antecedentText(clause.actions ?? [], sourceOf(idx), clause.trigger?.subject, enchantText);
    const antecedentIsSelf = (idx: number): boolean => selfAntecedent(clause.actions ?? [], idx, cardName);
    /** CR 614 multiplier, read off the clause text — the "would ... instead" frame the clause layer
     *  does not record. Bound per CLAUSE because that is where the sentence sits: verified against
     *  all 16 corpus cards carrying one of the templates, and in every case `segment()` gives the
     *  replacement sentence a clause of its own, including Rankle and Torbran's fifth mode. */
    const replacement = replacementOf(text);
    let trigger: Ability["trigger"];
    let grammarExtra: { verbs: Verb[]; subject: SubjectFilter }[] = [];
    let grammarRead = false;
    /** Does this clause fire on the card's own LEAVING? See the sacrifice filter below. */
    let selfLeavesTrigger = false;
    /** Who a granted clause belongs to, when the grant sentence names them. A self emit inside the
     *  granted ability ("sacrifice this permanent", "return it to the battlefield") is the
     *  RECIPIENT's, for the same reason its trigger is. */
    let grantedTo: { control: SubjectFilter["control"]; token: null; type?: SubjectFilter["type"]; subtype?: SubjectFilter["subtype"] } | undefined;
    // A GRANTED TRIGGER BELONGS TO THE RECIPIENT (recall v4 #194/#199, 2026-09-09). Not Dead
    // After All and Malakir Rebirth print `target creature ... gains "When this creature dies,
    // return it"`: the quoted ability's "this creature" is the TARGET, not the card, so the
    // trigger watches a creature you control dying -- which a sacrifice outlet supplies -- and
    // not the instant's own death, which nothing does. Read off the card text: the sentence
    // that hands the clause over names who gets it. Called from BOTH trigger branches: the
    // damage-dealt branch sits above the general one, and Hellish Rebuke's granted trigger is a
    // damage trigger (recall v4 #28).
    const adoptGrantedRecipient = (subject: SubjectFilter): void => {
      const recipient = grantedRecipientOf(cardText, text);
      if (subject.self !== true || !recipient) return;
      const r = parseSubject(recipient);
      delete subject.self;
      subject.type = r.type ?? "creature";
      if (r.subtype) subject.subtype = r.subtype;
      // CEILING: the recipient's COLOUR is not carried ("other BLUE creatures you control have ...",
      // Unctus, Grand Metatect). `subjectMatches` reads a producer with no colours as satisfying no
      // coloured filter, and a "tap target permanent" emit (Merrow Reejerey) has none, so carrying the
      // colour deleted a real edge (measured 2026-09-17). Carry it once the matcher tells an unknown
      // colour from a colourless one.
      subject.control = r.control === "any" && /\byou control\b/i.test(recipient) ? "you" : r.control;
      grantedTo = { control: subject.control, token: null, type: subject.type, ...(subject.subtype ? { subtype: subject.subtype } : {}) };
    };
    // THE PRINTED TRIGGER MUST BE THIS RECORD'S OWN. The stored numbering is the model's and `segment()`'s is the segmenter's; they drift when the
    // model splits a compound ("enters or attacks") into two records (Astrid Peth: stored 1 enters, 2 attacks, 3 the Brand-new Sky trigger; segment()
    // has 2 for that sentence). A record whose event has NO printed cue in this text but does in another clause's text was numbered into the wrong
    // sentence: it keeps its stored trigger, as before an ability word stopped hiding the preamble.
    const misplaced = rehomed !== undefined || (clause.trigger?.event !== undefined && !isReflexiveText(text) && !triggerHasCue(clause.trigger.event, text)
      && Object.values(clauseTexts ?? {}).some((t) => t !== text && triggerHasCue(clause.trigger!.event!, t)));
    // A re-homed record whose event the sentence's own record already read (Kratos 2 `dies` on the attack-or-dies sentence record 1 claims;
    // Astrid 2 `attacks` on the enters-or-attacks sentence) is that record's twin, not a second ability.
    const partner = misplaced && rehomed ? grammarCovered.get(rehomed)?.get(normalizeTriggerVerb(clause.trigger!.event!) ?? "") : undefined;
    if (partner !== undefined) twinOf.set(clause.id, partner);
    // A TEXTLESS RECORD (#1373 review) that adopted a sentence an earlier record's grammar reading already read this record's event off ("attacks or blocks" stored as two
    // records: Howling Golem, Jedit Ojanen) is that record's twin too -- but only an ability IDENTICAL to one of the covering clause's is folded (`identicalTwin`, below),
    // so a record that says more than its partner (a sibling sentence's effect numbered here) is never lost.
    // CEILING: all-or-nothing per clause (see the fold below: a twin with one richer ability keeps all its duplicates), a twin covered when the covering ability is the same apart from the clause (compared key-order-insensitively, `abilityKey`) and its amount / count are covered by the covering ability's VALUES (`amountCovered`: equal after case and punctuation, sign kept, or the twin plus a trailing "where X is ...", or the twin as the whole of that explanation (Freelance Muscle); `countCovered`: equal), never by mere presence (#1380). A respelling outside those ("one" beside "1", "where X equals" beside "where X is") is refused, and the duplicate stays. Runs on every event and on split ids (Korvold's 2.1: `clauseTexts` has only the integer key) since #1376; measured over the stored 400 with derive-identity: 226 cards change, 202 pure removals, 21 more switch to the grammar reading in `deriveRow`, Mage Hunter stays (its twin is richer: control opp vs any).
    else if (!misplaced && text && clause.trigger?.event && clauseTexts && clauseTexts[clause.id as number] === undefined) {
      const covering = grammarCovered.get(text)?.get(normalizeTriggerVerb(clause.trigger.event) ?? "");
      if (covering !== undefined && covering !== clause.id) identicalTwinOf.set(clause.id, covering);
    }
    // A sibling is another record of the sentence with a different id OR (same id, #1391) a different event: the model stores "X or Y" as two records under one id.
    const grammarAll = clause.trigger?.event && text && !misplaced ? grammarTriggersOf(text, cardName, clause.trigger.event, cardText, enchantText,
      clauses.filter((c) => (c.id !== clause.id || c.trigger?.event !== clause.trigger?.event) && c.trigger?.event && clauseTexts?.[c.id] === clauseText).map((c) => c.trigger!.event!),
      readings?.[clause.id]?.trigger, curse, creatureCard,
      (clause.trigger.event === "blocks" || clause.trigger.event === "becomes-blocked") && clauses.some((c) => c.id !== clause.id && (c.trigger?.event === "blocks" || c.trigger?.event === "becomes-blocked") && c.trigger.event !== clause.trigger!.event)) : null;
    const claimed = (grammarAll ?? []).filter((g): g is { verbs: Verb[]; subject: SubjectFilter } => !("refused" in g));
    if (text && claimed.length > 0) {
      const covered = grammarCovered.get(text) ?? new Map<string, number | string>();
      for (const g of claimed) for (const v of g.verbs) if (!covered.has(v)) covered.set(v, clause.id);
      grammarCovered.set(text, covered);
    }
    /** The clause's further readings of its own event, each a twin of the first (pushed below). */
    grammarExtra = claimed.slice(1);
    if (grammarAll) {
      grammarRead = true;
      for (const g of grammarAll) if ("refused" in g) unknownTriggers.push(g.refused);
      for (const g of claimed) adoptGrantedRecipient(g.subject);
      // A refused GRANTED trigger still hands its self emits to the recipient ("sacrifice this
      // permanent" is THEIR permanent): the recipient is read either way.
      if (claimed.length === 0) for (const g of grammarAll) if ("refused" in g && g.subject) adoptGrantedRecipient({ ...g.subject });
      if (claimed[0]) {
        selfLeavesTrigger = claimed[0].subject.self === true && claimed[0].verbs.includes("leaves");
        trigger = claimed[0];
      }
    } else if (clause.trigger?.event) {
      // THE STORED PATH, for a clause the grammar does not read: no printed trigger word (the
      // model's trigger is then the phantom guard's business), or a reflexive "when you do".
      const mapped = normalizeTriggerVerb(clause.trigger.event);
      // READ BACK INTO THE EVENT THE CARD MEANS (AC11 batch 1, 2026-09-09). Two near-misses this
      // branch used to REFUSE now have an engine verb of their own, so a doc that banked them is
      // read as what it says: "loses the game" on a lose-life trigger is `loses-game` (CR 104.3),
      // and a counter-added trigger whose subject says "removed" is `counter-removed` (CR 122;
      // Chandra, Fire Artisan). The refusal was right while the words did not exist -- a visible
      // refusal beats a banked near-miss -- and reinterpretation is right only now that the
      // reading has a name. `taps-for-mana` stays refused: no engine event exists for it yet.
      // "Whenever you play a land" is `land-play`, the event every land in the deck implies; a
      // card played from exile is a different event with no engine verb yet, so it stays refused.
      const playsALand = clause.trigger.event === "play" && /\bland\b/i.test(clause.trigger.subject ?? "");
      const verb = mapped === "lose-life" && LOSES_THE_GAME.test(text) ? "loses-game" as const
        : mapped === "counter-added" && COUNTER_REMOVED.test(clause.trigger.subject ?? "") ? "counter-removed" as const
        : playsALand ? "land-play" as const
        : mapped;
      if (verb === "taps" && TAPPED_FOR_MANA.test(text)) {
        unknownTriggers.push("taps-for-mana");
      } else if (verb === "enters" && ENTERS_TRANSFORMED.test(clause.trigger.subject ?? "")) {
        unknownTriggers.push("enters-transformed");
      } else if (clause.trigger.event === "damage-dealt") {
        // DIRECTION IS NOT IN THE EVENT NAME. `damage-dealt` covers both "deals combat damage to a
        // player" and "is dealt damage", which are opposite facts, so the clause TEXT decides —
        // the same move the two rules above make for taps-for-mana and loses-the-game.
        //
        // Measured over the 180 clauses carrying it: 92 lines say "deals COMBAT damage", 26 "deals
        // damage", and only 20 say "IS dealt damage". So ~118 of them name an event the engine
        // ALREADY HAS a verb for and were dropped whole for want of a table row.
        //
        // RECEIVING damage is its own verb (`damaged`, AF7d): the opposite direction, and handing
        // it `combat-damage` would make Hornet Nest and Boros Reckoner claim they DEAL it.
        if (DAMAGE_RECEIVED.test(text)) {
          const subject = subjectFrom(clause.trigger.subject ?? "", cardName, enchantText);
          const control = CLAUSE_CONTROL[clause.trigger.control ?? ""];
          if (control) subject.control = control;
          if (isSelfSubject(clause.trigger.subject ?? "", cardName)) subject.self = true;
          adoptGrantedRecipient(subject);
          trigger = { verbs: ["damaged"], subject };
        } else if (text === "") {
          // No clause text, no way to tell. Refusing matches today's behaviour exactly, since
          // `damage-dealt` maps to nothing at all right now — so this can only add, never regress.
          unknownTriggers.push("damage-dealt");
        } else {
          const damageVerb = COMBAT_DAMAGE.test(text) ? "combat-damage" : "non-combat-damage";
          // THIS BRANCH USED TO BYPASS THE PHANTOM GUARD, because it sits ABOVE it in the chain and
          // returns a verb of its own. `damage-dealt` is the event the normalizer reaches for when it
          // cannot spell a trigger, so it is exactly where an invented one hides: PATH OF ANCESTRY
          // triggers on "that mana is spent to cast a creature spell that shares a creature type with
          // your commander" and derived "whenever a creature commander you control deals noncombat
          // damage" — a card whose text never says damage at all. 3 of the 180 `damage-dealt` clauses
          // are this shape (also Ultima, Origin of Oblivion and Professor Hojo).
          //
          // Their real triggers are inexpressible — no verb covers "mana is spent", "becomes the
          // target of an activated ability" — so refusing leaves honest silence rather than a wrong
          // answer, which is the same call `unknownTriggers` records everywhere else.
          if (!triggerHasCue(damageVerb, cardText)) {
            unknownTriggers.push(`phantom:${damageVerb}`);
          } else {
            const subject = subjectFrom(clause.trigger.subject ?? "", cardName, enchantText);
            const control = CLAUSE_CONTROL[clause.trigger.control ?? ""];
            if (control) subject.control = control;
            if (isSelfSubject(clause.trigger.subject ?? "", cardName)) subject.self = true;
            adoptGrantedRecipient(subject);
            trigger = { verbs: [damageVerb], subject };
          }
        }
      } else if (verb && !triggerHasCue(verb, cardText)) {
        // THE NORMALIZER INVENTED THIS TRIGGER: nothing in the card's own text names the event.
        // Parnesse, the Subtle Brush triggers on being TARGETED and on COPYING a spell, neither of
        // which the vocabulary can spell, and its stored clauses answered `enters` and `cast` --
        // which made this deck's own commander claim 17 synergies, every one false. Refusing here
        // is free and works even when the money fix cannot: a re-ask whose answer the persist gate
        // REFUSES leaves the older, wrong doc standing, so the clause layer alone cannot fix it.
        unknownTriggers.push(`phantom:${verb}`);
      } else if (verb === "becomes-blocked" && isSelfSubject(clause.trigger.subject ?? "", cardName) && blockedBySelf(cardText, cardName)) {
        // CEILING: reads the whole card text, because the stored record can be numbered into another sentence (Mirror Shield: clause 3 is "Equip {2}"); there the stored "this creature" is the BLOCKER (#1375 review). A card with a real self becomes-blocked trigger AND a "blocked by this creature" sentence elsewhere would be refused (0 in the corpus, 2026-10-27); a refusal, never a wrong edge.
        unknownTriggers.push("blocked-by-self");
      } else if (verb === "becomes-blocked" && BLOCKED_BY_PHRASE.test(text) && (!readBlocker(BLOCKED_BY_PHRASE.exec(text)![1]!) || BATCHED_SUBJECT_BLOCKED_BY.test(text))) {
        // The printed "by ..." names a blocker `readBlocker` cannot read exactly (the grammar's own refusal, #1381): the stored subject can be the blocker itself, so no guess.
        unknownTriggers.push("narrowing:becomes-blocked");
      } else if (verb) {
        const subject = subjectFrom(clause.trigger.subject ?? "", cardName, enchantText);
        const control = CLAUSE_CONTROL[clause.trigger.control ?? ""];
        if (control) subject.control = control;
        // A PERMANENT-EVENT TRIGGER WHOSE PRINTED PHRASE NAMES NO CONTROLLER IS `any` (recall v6
        // #62, #104, 2026-09-10). The clause's `you` is right for an ACTOR verb ("whenever you cast
        // a spell" normalizes to subject "a spell"), but on dies / enters / attacks the controller
        // is the permanent's, and Morbid Opportunist's "whenever one or more other creatures die"
        // carried `you` from the normalizer with nothing printed to back it -- so Feed the Swarm
        // and Braids fed it nothing. Read off the printed trigger phrase (up to the first comma):
        // "you control" or "your" there keeps the clause's answer; a self trigger, an attached
        // permanent ("equipped creature"), a back-reference and a counter on this card all keep
        // it too. 44 corpus triggers flip, 259 keep.
        if (control === "you" && PERMANENT_EVENT_VERBS.has(verb) && text !== ""
          // Only a CLASS flips: a bare name the self test does not know ("Jumblebones", a token)
          // has no type to widen, and `any` on an untyped subject is everyone's board.
          && (namesAClassHere(subject) || subject.keyword !== undefined)
          && !isSelfSubject(clause.trigger.subject ?? "", cardName)
          && !KEEPS_CLAUSE_CONTROL.test(clause.trigger.subject ?? "")
          && !/\b(?:you|your)\b/i.test(printedTriggerPhrase(text, clause.trigger.subject ?? ""))) subject.control = "any";
        if (isSelfSubject(clause.trigger.subject ?? "", cardName)) subject.self = true;
        adoptGrantedRecipient(subject);
        // "Whenever one or more +1/+1 counters are put ON THIS CREATURE" (Evolution Witness): the
        // subject is the counter, the recipient is the card itself, and `isSelfSubject` reads only
        // the head of the phrase. Without the flag, Incubation Druid adapting ITSELF fed the
        // Witness's own-counter trigger (owner-judged FALSE, 2026-08-22); with it, edges.ts's
        // self-on-both-sides gate refuses the pair.
        // NOT ON A GRANTED CLAUSE: Danny Pink's "creatures you control have 'whenever one or more counters
        // are put on THIS CREATURE ... draw a card'" is every creature you control, and `adoptGrantedRecipient`
        // has already said so; re-reading "this creature" as self here made every self-grower miss it.
        if (!grantedTo && (verb === "counter-added" || verb === "counter-removed") && COUNTER_ON_SELF.test(clause.trigger.subject ?? "")) subject.self = true;
        // THE PASSIVE FORM NAMES THE RECIPIENT IN THE TEXT, NOT IN THE MODEL'S SUBJECT: "whenever one
        // or more +1/+1 counters are put on this creature" (Fathom Mage, Herd Baloth, Basking
        // Broodscale) normalizes to subject "a +1/+1 counter", so the check above never saw the
        // card. 22 of the 50 corpus own-counter triggers (2026-09-17). Read off the trigger phrase
        // -- the text up to the first comma -- so an emit's "on this creature" later in the same
        // sentence is not mistaken for the trigger's.
        if (!grantedTo && (verb === "counter-added" || verb === "counter-removed") && counterTriggerOnSelf(text, cardName)) { subject.self = true; subject.control = "you"; }
        // THE ACTIVE FORM NAMES THE KIND IN THE TEXT, NOT IN THE MODEL'S SUBJECT (DERIVE 155): "whenever
        // you put one or more +1/+1 counters on this creature" (Exemplar of Light) normalizes to
        // subject "this creature", so the kind the passive form's subject carries ("a +1/+1 counter",
        // Fathom Mage) was never recorded, and Sorin's -6 lifelink counter fed Exemplar's +1/+1 draw.
        // 15 of the 45 kindless corpus counter triggers name one in the trigger phrase.
        if ((verb === "counter-added" || verb === "counter-removed") && subject.counter === undefined) {
          const kind = parseCounter(printedTriggerPhrase(text, clause.trigger.subject ?? "").toLowerCase());
          if (kind) subject.counter = kind;
        }
        // ON AN `attacks` TRIGGER THE STATE IS THE EVENT: "a creature you control attacking" (Arni
        // Metalbrow, Seifer) is every attacker, and the implied `attacks` producer never states
        // the state, so keeping it here would delete every real edge these have. Kept on every
        // other verb -- "an attacking creature DIES" narrows a death the way the verb cannot.
        if (verb === "attacks" && subject.combat === "attacking") delete subject.combat;
        // The same for a blocker: "a blocking creature you control blocks" is every blocker.
        if (verb === "blocks" && subject.combat === "blocking") delete subject.combat;
        if (verb === "becomes-blocked" && subject.combat === "attacking") delete subject.combat;
        // A LEAVE HAS A ZONE. CR 603.6c is about the battlefield; "leave your graveyard" is a
        // different event that shares nothing with a death, and "without dying" is a battlefield
        // leave minus `dies`. Both are read off the TEXT because the trigger subject dropped them.
        if (verb === "leaves" && LEAVES_GRAVEYARD.test(text)) subject.zone = "graveyard";
        if (verb === "leaves" && WITHOUT_DYING.test(text)) subject.withoutDying = true;
        // "A SPELL THAT SHARES A CREATURE TYPE WITH THIS CREATURE" (DERIVE 178, #559): the clause
        // subject kept only "creature", so Folk Hero's draw heard every creature spell -- the
        // commander's own cast included. The class is the host's creature types: this card's own,
        // or, for a grant to commander creatures, the commander's (resolved per deck).
        // "WHENEVER AN ENCHANTED / EQUIPPED CREATURE DIES" (DERIVE 180, #565) watches a creature
        // wearing an Aura or Equipment -- CR 700.9's `modified`, which the clause subject dropped:
        // Hateful Eidolon heard every death, so Doomwake Giant's -1/-1 "drew" it cards. The ARTICLE
        // is the tell: "an enchanted creature" is a class; an Aura's "enchanted creature" is its
        // own host, and is not touched. 3 corpus cards (Hateful Eidolon, Stone Haven Outfitter,
        // Rhuk, Hexgold Nabber).
        if (/^an? (?:enchanted|equipped) (?:creature|permanent)\b/i.test((clause.trigger.subject ?? "").trim())) subject.modified = true;
        if (sharesTypeWithHost(clause.trigger.subject ?? "", cardName)) {
          subject.sharesTypeWith = GRANTED_TO_COMMANDER.test(cardText) ? "commander" : "self";
        }
        selfLeavesTrigger = subject.self === true && verb === "leaves";
        const blockedBy = verb === "becomes-blocked" ? readBlocker(BLOCKED_BY_PHRASE.exec(text)?.[1] ?? "") : null;
        trigger = { verbs: [verb], subject, ...(blockedBy ? { blocker: blockedBy.blocker, ...(blockedBy.batched ? { batched: true as const } : {}) } : {}) };
      } else {
        unknownTriggers.push(clause.trigger.event);
      }
    }
    // THE MULTIPLIER'S CONSUMER SIDE. A replacement clause states no trigger of its own, so nothing
    // connected Hardened Scales to the counters it doubles or Academy Manufactor to the tokens it
    // widens. The replaced event IS the trigger — the shape `prompt.ts` encodes for Tekuthal and
    // `effect-class.ts` calls REPLACEMENT — and the ability carries no emit, so a doubler can never
    // become a source of what it multiplies. Only when the clause has no authored trigger: Rankle
    // and Torbran's mode inherits the parent's combat-damage trigger and must keep it.
    if (replacement && !replacement.restricted && !trigger) {
      const subject = subjectFrom(replacement.subjectText, cardName, enchantText);
      if (replacement.counter) subject.counter = replacement.counter;
      // "If one or more +1/+1 counters would be put on MOWU" (Mowu, Loyal Companion) multiplies only
      // its own counters; without the flag every +1/+1 placer in the deck fed it (DERIVE 156).
      if (isSelfSubject(replacement.subjectText, cardName)) subject.self = true;
      trigger = { verbs: replacement.verbs, subject };
    }

    const before = abilities.length;
    /** The abilities (the ability and its twins) a `search` or `counter-spell` action made, by action index: the put that follows names its destination (#1301). */
    const destinationOwners = new Map<number, Ability[]>();
    // AN ACTION WHOSE VERB THE PRINTED TEXT NEVER STATES IS NOT THAT ACTION (#1321): see `verbPrint`. For a verb in GUARDED_VERBS it goes to `unclaimed` and derives nothing; printed on ANOTHER clause of the
    // card it is a clause mix-up and is kept. It stays in the clause's action list, so a later action's "those cards" still finds its antecedent (Nahiri's Warcrafting: dropping the misread scry left the exile
    // naming the damage target).
    // CEILING: a mix-up is kept whole (its clause's own sentence is not searched for the right one), so a verb the card prints once can still feed two clauses.
    const misfiled = new Set<Action>();
    if (GUARDED_VERBS.size > 0) {
      for (const a of clause.actions ?? []) {
        if (GUARDED_VERBS.has(a.verb ?? "") && !guardExempt(a) && verbPrint(a.verb ?? "", clauseText, clauseCosts?.[clause.id as number], oracleText) === "none") misfiled.add(a);
      }
    }
    // "UNTAP THOSE CREATURES" IS THE SET AN EARLIER ACTION NAMED (#1427): see `pluralAntecedent`. Resolved, the object becomes that text; unresolved, the action is
    // refused below (missing beats wrong -- it read as every creature).
    const refusedPlural = new Set<Action>();
    if ((clause.actions ?? []).some((a) => PLURAL_BACKREF.test((a.object ?? "").trim()))) {
      const rewritten = [...(clause.actions ?? [])];
      rewritten.forEach((a, i) => {
        if (!PLURAL_BACKREF.test((a.object ?? "").trim())) return;
        const t = pluralAntecedent(rewritten, i);
        if (t === undefined) refusedPlural.add(a); else rewritten[i] = { ...a, object: t };
      });
      clause = { ...clause, actions: rewritten };
    }
    // The trailing "if" of each action's sentence (#1357), read once per clause from the effect body (the text after the trigger preamble, an intervening if and an ability word).
    const gateReads = clauseText ? effectGates(effectText(clauseText, cardName ?? ""), (clause.actions ?? []).map((a) => a.verb ?? "")) : undefined;
    const alike = clauseText ? branchesAlike(effectText(clauseText, cardName ?? ""), (clause.actions ?? []).map((a) => a.verb ?? "")) : undefined;
    for (const action of clause.actions ?? []) {
      // A PRINTED "Casualty N" keyword line is the spell's own sacrifice outlet (Make Disappear):
      // Scryfall's keyword list drops the N, so the line itself is read. See `casualtySacrifice`.
      const printedCasualty = action.verb === "none" ? /^casualty (\d+)$/i.exec((action.object ?? "").trim()) : null;
      if (printedCasualty) {
        abilities.push({ kind: "on-cast", repeats: "once", effect: { kind: "" }, emits: [casualtySacrifice(Number(printedCasualty[1]))] });
        continue;
      }
      // Inert: states no action (`INERT_VERBS`), so there is nothing to report. A printed casualty line above has its own ability.
      if (INERT_VERBS.has(action.verb ?? "")) continue;
      if (misfiled.has(action) || refusedPlural.has(action)) { unclaimed.push(action); continue; }
      if (keywordActionOnStaticClause(kind, action.verb)) { unclaimed.push(action); continue; }
      // See antecedentFor: a pronoun object inherits the thing named earlier in the same clause.
      // "Whenever a player casts a spell, if it's not their turn, this creature deals 4 damage to THEM"
      // (Scytheclaw Raptor, Adrenaline Jockey): the pronoun is the player who acted, not the spell the
      // trigger subject names (#1253). "if THIS CARD is exiled, put IT onto the battlefield" (Senu) is
      // the card itself, not the attacker the trigger watches.
      const actorPronoun = !trigger && /^(?:them|him|her)$/i.test((action.object ?? "").trim())
        && /^(?:cast|play|draw|discard|activate)$/.test(clause.trigger?.event ?? "")
        && sourceOf((clause.actions ?? []).indexOf(action)).to === "trigger";
      const selfByIf = /^it$/i.test((action.object ?? "").trim()) && /\bif (?:this (?:card|creature|permanent)|~) is exiled\b/i.test(text)
        && sourceOf((clause.actions ?? []).indexOf(action)).to === "trigger";
      const antecedent = actorPronoun ? "a player" : selfByIf ? undefined : PRONOUN_OBJECT.test((action.object ?? "").trim())
        ? antecedentFor((clause.actions ?? []).indexOf(action))
        : undefined;
      // "Return THIS card to the battlefield" (Reassembling Skeleton, Drownyard Temple) emits an
      // entry of the card ITSELF. The emit is kept -- a Skeleton returning is a real creature
      // entering for anything watching creatures -- but it is marked, because a card's own re-entry
      // can never be some OTHER card's ETB, and an untyped subject would satisfy every one of them.
      //
      // NEVER A FIGHT (issue #562). "This creature fights another target creature" names the card
      // FIRST, as the fighter, and the prefix test above would read the whole pair as self. But the
      // fight's emit is the OTHER creature being dealt damage (emits.ts, CR 701.14a) -- Brash Taunter
      // supplied no "a creature is dealt damage" payoff. 17 corpus cards.
      const emitsSelf = action.verb !== "fight" && (selfByIf || SELF_REFERENCE.test((action.object ?? "").trim())
        || /^this$/i.test((action.object ?? "").trim())
        || isSelfSubject(action.object ?? "", cardName)
        || (action.verb === "deal-damage" && damageHitsSelf(action.object ?? "", text))
        // "prevent that damage" aimed at the card ("If damage would be dealt to Khârn the Betrayer, prevent that damage ..."): the damage prevented is dealt to the card, so the emit is a self reference (#1403).
        // The object may be the grammar's "that damage", so the recipient is read off the printed text. CEILING: one recipient phrase before a comma or full stop.
        || (action.verb === "prevent" && clauseGrants?.[clause.id] === undefined && preventHitsSelf(text, cardName))
        // A COUNTER PUT ON THE CARD ITSELF (owner-reported 2026-09-17, Primal Amulet -> Exemplar of
        // Light). An add-counter's object is the COUNTER ("charge counter", "+1/+1"), never the
        // permanent receiving it, so the object could never say "this artifact" and 4,240 of the
        // 4,321 corpus counter emits carried no `self` -- every self-growing creature "fed" every
        // "whenever you put counters on THIS creature" payoff. The recipient is in the clause text.
        // A COUNTER REMOVED AS A COST names its permanent in the cost, not in the effect text.
        || counterOnSelf(action.verb, (action.verb === "remove-counter" && /\bcounters?\b/i.test(cost)) || (action.verb === "add-counter" && COUNTER_PUT_AS_COST.test(cost) && !COUNTER_PREP.test(text) && clauseGrants?.[clause.id as number] === undefined) ? cost : ownCounterText(action, clause.actions ?? [], text), cardName, isSelfSubject(clause.trigger?.subject ?? "", cardName))
        // A pronoun standing in for the card itself. Tested on the RESOLVED antecedent, because the
        // raw object is "it" and matches none of the spellings above.
        || (PRONOUN_OBJECT.test((action.object ?? "").trim())
          && antecedentIsSelf((clause.actions ?? []).indexOf(action))));
      // CR 614: a MULTIPLIER modifies occurrences of an event and is not a source of it. The clause
      // layer records the verb the sentence uses and nothing about the "would ... instead" frame, so
      // Hardened Scales answered `add-counter` and advertised a counter it never places. The kind
      // names the multiplication, and the emits go — see `replacement.ts` and the consumer trigger
      // below, which is the shape `prompt.ts` already documents for Tekuthal.
      // A STEAL'S RIDER IS NOT A RETARGET: "Gain control of target spell. You may choose new targets for it." (Aethersnatch) redirects the spell you now
      // control. Read off the sibling action, because the model words the rider "choose new targets for target spell" on some cards and "for it" on others.
      const stealsASpell = (clause.actions ?? []).some((x) => x.verb === "gain-control" && /\bspells?\b/i.test(x.object ?? ""));
      // The n-th identical `cant` of a clause is the n-th printed "can't attack|block" (Aragorn, King of Gondor stores one object twice).
      const sameCant = action.verb === "cant" ? (clause.actions ?? []).slice(0, (clause.actions ?? []).indexOf(action)).filter((x) => x.verb === "cant" && x.object === action.object).length : 0;
      const read = replacement?.kind ?? actionEffectKind(action, text, sameCant);
      const effectKind = read === "retarget" && stealsASpell ? null : read;
      // THE MODEL FILES ONE PRINTED DENIAL TWICE (#1423): a stored `untap` beside a stored `cant | untap during ...` of the same clause (Glacial Grasp, Illithid Harvester) is that `cant`'s twin, one ability.
      if (action.verb === "untap" && effectKind === "untap-denial" && (clause.actions ?? []).some((x) => x.verb === "cant" && untapDenialFor("cant", x.object ?? "", text, 0))) continue;
      // A tap the clause states as an ARRIVAL state is not an event. See ARRIVES_TAPPED.
      // THE TEMPORARY-TOKEN RIDER IS NOT AN EVENT. "Exile it at the beginning of the next end step"
      // resolves its pronoun to the token the clause just made, so the emit builder would see a
      // typed exile; tested on the RAW object here, before the antecedent, the way emits.ts tests
      // it for a direct call. The fact is `temporary` on the maker's own ability (below).
      const temporaryRider = action.verb === "exile" && LEAVES_SAME_TURN.test(text) && TEMPORARY_TOKEN_REF.test((action.object ?? "").trim());
      // THE TRIGGERING OBJECT ITSELF (#896 task 4, #823): "whenever a creature an opponent controls dies,
      // exile IT" is that card, in the graveyard the event put it in -- not another creature, and not
      // on the battlefield. The emit keeps the trigger's class, takes the zone, and says it is `ref`.
      // NOT AFTER A REVEAL OR A LOOK: "When Matter Reshaper dies, reveal the top card of your library. You
      // may put IT onto the battlefield" means the revealed card, which the clause records no action for.
      // 124 of 671 trigger references sit in such a clause; they keep their old reading, unmarked.
      const refersToTrigger = antecedent !== undefined && !actorPronoun && !emitsSelf && !REVEALS.test(text)
        && sourceOf((clause.actions ?? []).indexOf(action)).to === "trigger";
      // The EVENT outranks a "battlefield" the model wrote on the action: a card that died is not there
      // (Hofri Ghostforge, Eater of Virtue, Chaos Shrine's Black Crystal wrote it; review of S3).
      const zone = refersToTrigger && (!action.fromZone || action.fromZone === "battlefield") ? zoneAfterEvent(clause.trigger?.event) : undefined;
      // A TOKEN CREATED TAPPED IS NOT TAPPED BY ANYTHING (CR 603.2e: "becomes tapped" does not trigger for a
      // permanent that enters in that state; Mobilize, 702.181a, is the same). The grammar writes a companion
      // `tap` on a created "tapped" token and the stored model writes `tap: them / this / the token(s) / the
      // created phrase`; resolved through the antecedent that is a scoped tap of the token. A tap that names
      // a target, or says "tap it/them" in the effect, is a real event and keeps its emit.
      const actionIdx = (clause.actions ?? []).indexOf(action);
      const tapObject = (action.object ?? "").trim().toLowerCase();
      const tapMadeHere = action.verb === "tap" && actionIdx > 0 && (clause.actions ?? []).slice(0, actionIdx).some((a, i) =>
        a.verb === "create" && (tapObject === (a.object ?? "").trim().toLowerCase()
          || ((PRONOUN_OBJECT.test(tapObject) || CREATED_TOKEN_REF.test(tapObject)) && sourceOf(actionIdx).to === "action" && (sourceOf(actionIdx) as { action: number }).action === i)
          || (CREATED_TOKEN_REF.test(tapObject) && sourceOf(actionIdx).to !== "action")));
      // CEILING: a token created tapped is recognised by the word "tapped" ANYWHERE in the effect text, not by
      // the create action's own object. A tap of the created thing phrased other than TAPS_IT is read as the
      // creation tap (0 corpus cards hit this today). "Create two 1/1 Dog tokens. Tap those tokens." (no
      // "tapped") still emits the wildcard `{token:true, scope:all}` tap, because CREATED_TOKEN_REF only
      // resolves when "tapped" is present.
      const tapsCreated = tapMadeHere && TAPPED_WORD.test(effectText(text, cardName ?? "")) && !TAPS_IT.test(effectText(text, cardName ?? ""));
      const emits = temporaryRider ? [] : narrowSelfExiledSpell(actionEmits(antecedent ? { ...action, object: antecedent, ...(zone ? { fromZone: zone } : {}) } : action, ownCounterText(action, clause.actions ?? [], text, true), { self: emitsSelf }), text, cardText)
        .filter((e) => !(e.verb === "taps" && (tapsCreated || ARRIVES_TAPPED.test(effectText(text, cardName ?? "")))))
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
        .filter(() => !(action.verb === "sacrifice" && selfLeavesTrigger))
        // A multiplier performs nothing. Every emit of the clause goes, not only the one matching
        // the replaced event: Academy Manufactor's clause answers `create` three times and creates
        // a token on its own none of those times.
        .filter(() => replacement === null)
        // A DENIED UNTAP IS NO UNTAP EVENT (#1423): the model's `untap` verb for "doesn't untap" (Melancholy, Reveka) would otherwise emit `untaps` and feed every untap watcher.
        .filter(() => effectKind !== "untap-denial")
        // ROADMAP I7. The permanent arrives under a controller the schema cannot name, so the emit
        // claims nothing rather than claiming everyone. See `entersUnderAnotherPlayer`.
        .filter((e) => !(e.verb === "enters" && entersUnderAnotherPlayer(cardText)));
      // THE CARD ITSELF HIT BY A FIGHT-BACK is bare `self` (Garruk's "him" kept the antecedent "target creature": a planeswalker typed creature, scope target) (#1266, burn).
      const selfDamage = action.verb === "deal-damage" && damageHitsSelf(action.object ?? "", text);
      if (selfDamage) for (const e of emits) e.subject = { control: "any", token: null, self: true };
      // A CREATURE DEALS IT when the sentence says "target creature (you control) deals damage ...": the dealer is that creature, so a damage trigger hears "a creature ... thanks to <card>" (Rabid Bite), not the spell.
      // CEILING: only a clause with ONE damage action (Garruk's two read the card as dealer of both).
      const creatureSource = action.verb === "deal-damage" && !selfDamage && (clause.actions ?? []).filter((x) => x.verb === "deal-damage").length === 1 ? creatureDamageSource(text) : undefined;
      if (creatureSource !== undefined) for (const e of emits) if (e.dealer !== undefined) e.dealer = { control: creatureSource, token: null, type: "creature" };
      if (emitsSelf) for (const e of emits) {
        if (!grantedTo) { e.subject.self = true; continue; }
        // The granted ability's "this permanent"/"it" is the recipient -- see `grantedTo`.
        const { self: _self, ...rest } = e.subject;
        e.subject = { ...rest, ...grantedTo };
      }
      // AND "YOU" IN A GRANTED ABILITY IS THE RECIPIENT'S CONTROLLER (CR 113.8: an ability's
      // controller is the controller of the object it is on). Hellish Rebuke's "You lose 2 life"
      // is the opponent whose permanent carries it, so the emit reads `opp` -- the same seat
      // swap `flipPerspective` makes for an opponent's emblem.
      if (grantedTo) for (const e of emits) if (e.subject.control === "you" && e.subject.self !== true) e.subject.control = grantedTo.control;
      // A REFUSED TRIGGER ABOUT THIS CARD'S OWN SELF names the card (#1253): "Whenever this creature blocks
      // or becomes blocked, target opponent gains control of IT" (Goblin Cadets) -- the grammar reads the
      // same "sacrifice it" under a refused "this creature becomes the target" as the card itself
      // (Phantasmal Bear), and a `ref: "trigger"` over a trigger that is gone is a class with no trigger
      // to bound it. With no trigger left to point at, it is `self`. Any other refused trigger keeps the
      // ref and the ability is marked `claimsNothing: "refused-trigger"` below.
      if (refersToTrigger) for (const e of emits) {
        if (!trigger && clause.trigger?.subject && isSelfSubject(clause.trigger.subject, cardName)) e.subject.self = true;
        else {
          e.subject.ref = "trigger";
          // The damager of a refused "deals damage to you" is an opponent's (No Mercy, Mikaeus, Dread).
          if (!trigger && e.subject.control === "any" && DEALS_DAMAGE_TO_YOU.test(text)) e.subject.control = "opp";
        }
      }
      // THE VICTIM MAY DECLINE (#1295): "its controller may sacrifice it", "unless that player sacrifices it". The event
      // is real when it happens, and not removal: see `GameEvent.victimMay`.
      if (victimDeclines(text, action.verb ?? "")) for (const e of emits) e.victimMay = true;
      // A DAMAGE REDIRECT (#1294, owner ruling 2026-10-22): "the next 2 damage ... is dealt to any target instead" (Harm's Way, Glarecaster) hands damage that was coming at you to a target; the card deals none of its own, so it is no
      // removal. "Prevent the next 3 damage ... Refraction Trap deals that much damage to any target" has no "is dealt to ... instead" and stays a deal.
      if (action.verb === "deal-damage" && DAMAGE_REDIRECT.test(text)) for (const e of emits) e.redirect = true;
      // THE DESTINATION OF A SEARCH OR COUNTER IS READ OFF ITS PUT whether the put derives an event of its own (Rampant Growth's `enters`, left as it is) or nothing
      // (Path to Exile's land for the opponent, Abzan Monument's card): the field is set either way and only the second case is claimed here (#1301).
      const orphan = !effectKind && emits.length === 0;
      const claimedHere = action.verb === "put" && claimedAsDestination(action, clause.actions ?? [], sourceOf((clause.actions ?? []).indexOf(action)), destinationOwners, orphan);
      if (orphan) {
        if (claimedHere) continue;
        unclaimed.push(action); continue;
      }

      // A subject is attached ONLY when there is a kind. matcher's edges.ts emits a
      // `static:${effect.kind}` tag for any static ability that has a subject, so an empty kind
      // with a subject produces a junk `static:` tag that can match another card's junk tag and
      // form an edge that is not real. A STATIC ability additionally has to name its targets --
      // see namesItsTargets -- or the very same edge forms against the whole deck.
      // A FLICKER'S "return THAT CARD" means what the exile named (#887): Displacer Kitten's
      // "nonland permanent you control" was read off the pronoun as any permanent anyone controls.
      // The emits already resolve it; the subject now does too. Flicker only: measured, not assumed.
      // Only an exile IN THIS CLAUSE is the antecedent: a cross-clause "the exiled cards" (Petradon) falls
      // back to the trigger's subject, which names the card and not what it exiled (review).
      const exiledHere = (clause.actions ?? []).slice(0, (clause.actions ?? []).indexOf(action)).some((x) => x.verb === "exile");
      // A DAMAGE'S "IT" / "THEM" is the object the trigger names (Caltrops: "deals 1 damage to it" is the attacking creature), not any target (#1266 burn): the emit already read it so.
      // A HAND-FILL OF THE TOP OF YOUR LIBRARY (#1302): `to-hand`, or a dig the clause restricts to a class and so stays `search`. The class a clause states ("If it's a Zombie card") is the dig's subject when the stored
      // object is only "it" / "that card" -- the same subject the grammar's "a Zombie card from the top card of your library" reads, so the tutor edges ("digs for Zombie") do not depend on the spelling.
      // WHICH hand-put of the clause this is (Follow the Lumarets: one, or two instead): the k-th `put library -> hand` action reads the k-th "into your hand" sentence.
      const handNth = (clause.actions ?? []).filter((x) => x.verb === "put" && x.fromZone === "library" && x.toZone === "hand").indexOf(action);
      const handRead = effectKind === "to-hand" || effectKind === "search" ? handFillRead(action, text, Math.max(0, handNth)) : undefined;
      const typedDig = handRead?.typed && !handRead.typed.fromObject && handRead.typed.cls !== "" ? { ...action, object: `a ${handRead.typed.cls} card from the top card of your library` } : undefined;
      const subjectAction = typedDig ?? ((effectKind === "flicker" && antecedent && exiledHere && !emitsSelf) || (effectKind === "damage" && refersToTrigger) ? { ...action, object: antecedent } : action);
      const subject = effectKind
        ? effectSubject(subjectAction, effectKind, trigger?.subject.self === true, text, cardName, enchantText, sameCant)
        : undefined;
      if (subject && selfByIf) subject.self = true;
      // A CARD PUT INTO YOUR HAND FROM THE TOP OF YOUR LIBRARY IS NEVER THE PERMANENT THAT ENTERED (#1302, self-reference): "the chosen cards" / "it" in a self-ETB clause (Niv-Mizzet Reborn) read as the card itself
      // through the pronoun inheritance, and the dig "dug for itself". The hand-fill's subject is whose hand (to-hand) or the class dug for (typed), never `self`.
      if (subject && handRead && subject.self) delete subject.self;
      // A RECURSION OF THE TRIGGER'S OWN OBJECT HAS THAT OBJECT'S CLASS (#1253, Sacred Ground): its emits say
      // "land you control" and its effect subject said "a card in any graveyard", so every graveyard filler
      // in the deck "enabled" it. Copy the ref'd emit's class and controller onto the effect subject.
      if (subject && effectKind === "graveyard-recursion" && refersToTrigger && !trigger) {
        const made = emits.find((e) => e.subject.ref === "trigger");
        if (made) {
          const src = made.subject as unknown as Record<string, unknown>, dst = subject as unknown as Record<string, unknown>;
          for (const [k, v] of Object.entries(src)) {
            if (!CLASSLESS_KEYS.has(k) && k !== "self" && v !== undefined && dst[k] === undefined) dst[k] = v;
          }
          if (subject.control === "any" && made.subject.control !== "any") subject.control = made.subject.control;
          // The recursion is of a card that was put into the graveyard FROM THE BATTLEFIELD: a mill or a
          // discard (from the library or the hand) cannot be what it returns (Glimpse the Unthinkable).
          if (/\binto (?:your|a|an opponent's) graveyard from the battlefield\b/i.test(text)) subject.fromZone = "battlefield";
          // CEILING: "a spell or ability AN OPPONENT CONTROLS causes ..." is not expressible on the producer
          // side, so your own Armageddon, Strip Mine and Wasteland still feed this recursion.
        }
      }
      // #1250: the same damaged-player reading reaches the `leaves` emit -- it is THEIR graveyard the card
      // leaves. Only that emit: YOU cast the card / put it onto the battlefield under your control, so the
      // cast and enters emits keep their own reading (review).
      if (action.fromZone === "graveyard" && /\bfrom that player's graveyard\b/i.test(text)
        && damagedPlayerIsOpponent(text, trigger?.subject.self === true, cardName)) {
        for (const e of emits) if (e.verb === "leaves" && e.subject.control === "any" && e.subject.zone === "graveyard") e.subject.control = "opp";
      }
      // #1306 shape 2: "all cards from target spell's controller's graveyard" (Grip of Amnesia), "all cards with the same name as that spell from their graveyard" (Bloodbond March) move
      // CARDS in a graveyard; the word "spell" is only whose they are / what they are named after, so the emit is not typed `spell`.
      if (action.fromZone === "graveyard" && /^(?:all )?cards?\b/i.test((action.object ?? "").trim())) {
        // ...but "with the same name as THAT spell" after "casts a creature spell" is a card of the spell's own type (Bloodbond March returns creature cards).
        const named = /\bsame name as that spell\b/i.test(action.object ?? "") && trigger?.subject.type !== undefined && trigger.subject.type !== "spell" ? trigger.subject.type : undefined;
        for (const e of emits) if (e.subject.type === "spell") { if (named !== undefined) e.subject.type = named; else delete e.subject.type; }
      }
      // #1266: THE CARD A TRIGGER EXILES is in the graveyard of whoever the trigger names: "Whenever a creature YOU control dies, exile it" (Promise of Tomorrow), "When this creature dies, exile it"
      // (Cyclopean Mummy), "Whenever you discard" are YOUR yard, so the emit is `owner: you`; an opponent's trigger (Mari) and an any-player one (Planar Void, Mimic Vat) stay unmarked.
      // CEILING: a creature you control that you do not own goes to its owner's graveyard; read as yours (a stolen creature, 0 corpus cards judged).
      if (action.verb === "exile" && trigger?.subject.control === "you" && !(RIDER_OBJECT.test((action.object ?? "").trim()) && WOULD_BE_PUT_INTO.test(text))) {
        for (const e of emits) if (e.verb === "exiled" && e.subject.ref === "trigger" && e.subject.fromZone === "graveyard" && e.subject.self !== true && e.subject.owner === undefined) e.subject.owner = "you";
      }
      // #1306: the spell a rider exiles is the one YOU cast ("cast this way"), whoever's graveyard it came from, so its stack emits are yours.
      if (action.verb === "exile" && action.fromZone === "stack" && graveyardReplacement(text)?.kind === "rider" && /\bcast\b/i.test(action.object ?? "")) {
        for (const e of emits) if ((e.verb === "exiled" || e.verb === "leaves") && e.subject.fromZone === "stack" && e.subject.control === "any") e.subject.control = "you";
      }
      // #1266 task 2: an opponent's-graveyard replacement says so on its emits too (Leyline of the Void, Valgavoth); "a graveyard" stays `any`.
      // CR 614.6: "If an event is replaced, it never happens": the card never entered (or left) a graveyard, so there is no `leaves`, and the `exiled` emit names no graveyard origin
      // (the graveyard-hate EFFECT, built from the action's graveyard zone, is what says whose graveyard it hits).
      const hateReplacement = action.verb === "exile" && action.fromZone === "graveyard" ? graveyardReplacement(text) : undefined;
      if (hateReplacement?.kind === "hate") {
        for (let i = emits.length - 1; i >= 0; i--) if (emits[i]!.verb === "leaves" && emits[i]!.subject.fromZone === "graveyard") emits.splice(i, 1);
        for (const e of emits) if (e.verb === "exiled" && e.subject.fromZone === "graveyard") { delete e.subject.fromZone; if (hateReplacement.whose === "opp") e.subject.control = "opp"; }
      }
      // #1266: "that player's graveyard" AFTER a card taken "from an opponent's graveyard" in the same clause is THAT opponent's (Nurgle's Conscription), so the
      // exile and its graveyard leave say `opp` and no "leaves YOUR graveyard" payoff is fed by it. A bare "that player" (Go Blank's target player) stays `any`.
      if (action.verb === "exile" && action.fromZone === "graveyard" && /^that player's graveyard$/i.test((action.object ?? "").trim()) && opponentYardBefore(text)) {
        for (const e of emits) if ((e.verb === "exiled" || e.verb === "leaves") && e.subject.control === "any" && e.subject.fromZone === "graveyard") e.subject.control = "opp";
      }
      // #1266: WHOSE GRAVEYARD AN EXILE TAKES FROM, when the printed words say it is yours: the `exiled` emit carries `owner: "you"` (Necropotence, Bag of Holding,
      // Helbrute's cost, Purgatory, Living Death's round trip), so a graveyard-HATE rule can refuse it. Another player's, or any, stays unmarked. "This card"
      // from your graveyard is `self` already and keeps it.
      if (action.verb === "exile" && !(RIDER_OBJECT.test((action.object ?? "").trim()) && WOULD_BE_PUT_INTO.test(text)) && exilesFromYourGraveyard(action.object ?? "", text)) {
        for (const e of emits) if (e.verb === "exiled" && e.subject.fromZone === "graveyard" && e.subject.self !== true && e.subject.owner === undefined) e.subject.owner = "you";
      }
      // #1252: "that player loses the game" after damage the card's side deals to a player is the damaged
      // player -- an opponent (Phage, Vorpal Sword, Atemsis). Unresolved ("a creature deals ...") stays `any`.
      if (action.verb === "lose-game" && /^(?:that player|they)$/i.test((action.object ?? "").trim())
        && damagedPlayerIsOpponent(text, trigger?.subject.self === true, cardName)) {
        for (const e of emits) if (e.verb === "loses-game" && e.subject.control === "any") e.subject.control = "opp";
      }
      // A GRANT TO THE TRIGGERING OBJECT says so (Stonehoof Chieftain: "whenever another creature you
      // control attacks, IT gains trample"), so the matcher can see a keyword that object already
      // has is no gift (owner 2026-10-02: "flying flying gives you nothing additional").
      // The clause records only the keyword as the object, so the recipient is read off the text: "it"
      // or "they" after the trigger, with no target in the sentence and a trigger that is not the card.
      if (subject && effectKind === "keyword-grant" && clause.trigger?.subject
        && !isSelfSubject(clause.trigger.subject, cardName) && !/\btarget\b/i.test(text)
        && (GRANT_TO_TRIGGER.test(text) || (inherits && GRANT_BULLET_TO_TRIGGER.test(text.trim())))) {
        subject.ref = "trigger";
        if ((!trigger || inherits) && triggerSubjectPrecedesEvent(inherits ? (cardText || text) : text, clause.trigger.subject)) {
        // THE REFUSED TRIGGER STILL NAMES THE CLASS (#1253): "Whenever a creature you control attacks alone,
        // IT gains X" is a creature you control, as No Mercy's "destroy it" is a creature. Copy what the
        // trigger subject says onto the ref'd subject so only a truly class-less object is withdrawn.
        const named = subjectFrom(clause.trigger.subject, cardName, enchantText) as unknown as Record<string, unknown>;
        for (const [k, v] of Object.entries(named)) {
          if (!CLASSLESS_KEYS.has(k) && k !== "self" && k !== "batched" && v !== undefined && (subject as unknown as Record<string, unknown>)[k] === undefined) (subject as unknown as Record<string, unknown>)[k] = v;
        }
        }
      }
      // See THAT_TYPED. Read BEFORE the actor, which is a stronger statement and overrides it.
      const objectText = (action.object ?? "").trim();
      // "...this creature deals 3 damage to THAT PLAYER" (Thunderbreak Regent) is the player the clause named, not the controller of the
      // trigger's creature: it took the trigger's `you` below and read as damage to yourself (#1266, burn). An opponent when the sentence says so.
      const thatPlayerHit = BURN_RECIPIENT_KINDS.has(effectKind ?? "") && THAT_PLAYER.test(objectText);
      if (thatPlayerHit && thatPlayerIsOpponent(text, trigger?.subject.self === true, cardName)) {
        for (const e of emits) if (e.subject.control === "any" || e.subject.control === "you") e.subject.control = "opp";
        if (subject) subject.control = "opp";
      }
      // ...and "that permanent or player" / "that player or a planeswalker that player controls" (Erratic Explosion, Vial Smasher) keep their own
      // player branch: the trigger's `you` is not the controller of what they hit.
      const playerList = BURN_RECIPIENT_KINDS.has(effectKind ?? "") && subject?.anyOf?.some((b) => b.player === true) === true;
      if (THAT_TYPED.test(objectText) && !PRONOUN_OBJECT.test(objectText) && !thatPlayerHit && !playerList) {
        const ante = antecedentFor((clause.actions ?? []).indexOf(action));
        const inherited = ante ? subjectFrom(ante, cardName, enchantText).control : undefined;
        if (inherited && inherited !== "any" && !(inherited === "you" && PLAYER_BACKREF.test(objectText))) {
          for (const e of emits) if (e.subject.control === "any") e.subject.control = inherited;
          if (subject && subject.control === "any") subject.control = inherited;
        }
        // ...AND ITS TARGET SCOPE (#1295): "Target creature gets -3/-0 until end of turn. Then if that creature's power is 0 or
        // less, destroy THAT CREATURE" (Depressurize) kills the creature the first sentence targeted, and without the scope
        // `removal.targeted` lost the card. Only when the antecedent is a target of a compatible type; "this creature" and a
        // card's own name carry no target scope, so a self-reference is never read as one.
        const anteSubject = ante ? subjectFrom(ante, cardName, enchantText) : undefined;
        // ...NOT A COPY TOKEN (it takes its creator's control, see actionEmits) and NOT AN ABILITY ("counter target activated ability ... destroy that permanent", Green Slime).
        // ...NOR A PLAYER ("destroy target creature an opponent controls. That player loses 3 life", Suspended Sentence).
        // ...NOR A DEATH REPLACEMENT RIDING ON DAMAGE ("If that creature would die this turn, exile it instead", Smite the Deathless, Burn from Within): the damage is the removal.
        // CEILING: read off the clause text, so a clause that also destroys the antecedent elsewhere loses the scope on that destroy too; owner ruling #1294 (damage) is still open.
        // ...NOR A CARD TAKEN FROM A LIBRARY OR HAND (Transmogrify: "puts THAT CARD onto the battlefield" is the revealed creature card, not the exiled target), NOR A PLAYER OR A TOKEN ANTECEDENT
        // ("target player mills a card... exile that creature"; a Role "attached to target creature" is never itself the target).
        // CEILING: "Create a token that's a copy of target creature an opponent controls. Destroy that creature." loses the scope (the anaphor means the copied target); the copy-token exclusion is wholesale.
        const fromElsewhere = action.fromZone === "library" || action.fromZone === "hand";
        const anteIsPlayer = !!ante && /^\s*(?:up to \w+ )?(?:another )?target (?:players?|opponents?)\b/i.test(ante);
        if (ante && !fromElsewhere && !anteIsPlayer && anteSubject?.token !== true && !DEATH_REPLACEMENT.test(text) && !/\b(?:players?|opponents?)\b/i.test(objectText) && anteSubject?.scope === "target" && anteSubject.self !== true && !COPY_TOKEN_HEAD.test(ante.trim()) && !/\babilit/i.test(ante)) {
          const anteTypes = [anteSubject.type ?? []].flat();
          for (const e of emits) {
            if (e.subject.scope !== undefined || e.subject.self === true || e.subject.edict === true) continue;
            const types = [e.subject.type ?? []].flat();
            if (types.length === 0 || (anteTypes.length > 0 && !types.some((t) => anteTypes.includes(t) || anteTypes.includes("permanent")))) continue;
            e.subject.scope = "target";
          }
        }
      }
      // "REVEAL CARDS ... UNTIL YOU REVEAL A CREATURE CARD ... PUT THAT CARD ONTO THE BATTLEFIELD"
      // (Descendants' Fury, #715): a class-restricted dig (AF10 ruling 4) whose class is named by the
      // REVEAL, which is no action, so "that card" had no antecedent and every creature's own entry
      // trigger went unfed. Types an untyped emit only; a named class on the put itself stands.
      // ONE reveal, and a put onto the battlefield only (review): two reveals leave "that card"
      // ambiguous, and a card put into a hand triggers no entry.
      const oneReveal = (text.match(REVEAL_UNTIL_ALL) ?? []).length === 1;
      const revealed = oneReveal && action.fromZone === "library" && action.toZone === "battlefield" && /^that card$/i.test(objectText)
        ? REVEAL_UNTIL.exec(text)?.[1] : undefined;
      const revealedClass = revealed ? parseSubject(revealed) : undefined;
      if (revealedClass && (revealedClass.type !== undefined || revealedClass.subtype !== undefined)) {
        for (const e of emits) {
          if (e.subject.type !== undefined || e.subject.subtype !== undefined) continue;
          if (revealedClass.type !== undefined) e.subject.type = revealedClass.type;
          if (revealedClass.subtype !== undefined) e.subject.subtype = revealedClass.subtype;
        }
      }
      // "RETURN IT TO THE BATTLEFIELD TRANSFORMED" (#715): the card re-enters as its BACK face (CR
      // 712.14a), and only the matcher knows that face's types -- so the emit says which face it is.
      // ONE return/put in the clause (review): with two, nothing says which the word describes.
      if ((action.verb === "return" || action.verb === "put") && RETURNS_TRANSFORMED.test(text)
        && (clause.actions ?? []).filter((x) => x.verb === "return" || x.verb === "put").length === 1) {
        for (const e of emits) if (e.verb === "enters" && e.subject.self === true) e.subject.transformed = true;
      }
      // "Whenever you activate an ability ... copy THAT ability" (Rings of Brighthearth): the object
      // is a pronoun and the kind lives in the trigger. `activate` itself is refused as a trigger
      // (no producer), so the fact is carried here instead of lost (AC12).
      //
      // AND `activate` WAS ONLY THE FIRST SHAPE OF THAT. "Whenever a creature ... causes a TRIGGERED
      // ability of that creature to trigger, copy that ability" (Aboleth Spawn, Firebender
      // Ascension) says the kind in its trigger SUBJECT, which `parseSubject` already reads. Left
      // on the trigger, the effect carried none and the matcher fell back to BOTH kinds, claiming
      // activated copies neither card can make (measured 2026-09-20). Read the derived trigger
      // first, then the raw clause subject -- an event outside the `Verb` union ("a creature you
      // control ATTACKING causes...") derives no trigger at all, and the string still says it.
      if (effectKind === "copy-ability" && subject && !subject.abilityKind) {
        const fromTrigger = trigger?.subject.abilityKind
          ?? (clause.trigger?.subject ? parseSubject(clause.trigger.subject).abilityKind : undefined);
        if (fromTrigger?.length) subject.abilityKind = fromTrigger;
        else if (clause.trigger?.event === "activate") subject.abilityKind = ["activated"];
      }
      // CEILING: read off the derived trigger's `you` alone, so "Whenever a creature attacks you, destroy target attacking creature" (an opponent's attacker) keeps `opp`,
      // but a "you" trigger whose attacking creature is somehow an opponent's (a goaded or stolen attacker in a multiplayer combat) reads as yours.
      // ONLY THE ACTIVE PLAYER'S CREATURES ATTACK (CR 508.1a), so "target attacking creature" in a trigger of YOUR attack is yours
      // (Scrappy Bruiser: "up to one target attacking creature gets +2/+0... Return that creature to its owner's hand"). Not "attacking or
      // blocking" (a blocker is the defender's), not a spell, not a trigger on anyone else's attack.
      if (trigger?.verbs.includes("attacks") && trigger.subject.control === "you") {
        const named = antecedent ?? (THAT_TYPED.test(objectText) ? antecedentFor((clause.actions ?? []).indexOf(action)) : undefined) ?? action.object ?? "";
        // Only a CREATURE emit: "the player or planeswalker it's attacking" is the defender's, and a token made "for each attacking creature" is no attacker.
        if (/\battacking\b/i.test(named) && !/\b(?:blocking|planeswalker|player|opponents?|don'?t control|for each|equal)\b/i.test(named)) {
          for (const e of emits) {
            const types = [e.subject.type ?? []].flat();
            if (e.subject.control !== "any" || e.subject.self === true || e.verb === "create-token" || e.verb === "enters" || types.includes("planeswalker")) continue;
            e.subject.control = "you";
          }
        }
      }
      // A COST SACRIFICE IS THE CONTROLLER'S (CR 701.17a): "{T}, Sacrifice two other creatures" eats
      // your creatures whatever the effect goes on to do to "any number of target players". The
      // sentence-wide actor default below refuses when the clause names another player, which is
      // exactly Priest of Forgotten Gods' shape, so the cost's own sacrifice -- the FIRST sacrifice
      // action, since the clause lists cost actions first -- is pinned here (recall v4, 2026-09-09).
      // CEILING: unlike `costDiscard`, this pin does not look at WHO may activate ("Any player may activate this ability") -- an opponent's cost sacrifice reads `you`; left as it was (#1395).
      const costSacrifice = action.verb === "sacrifice" && /\bsacrifice\b/i.test(cost)
        && (clause.actions ?? []).find((x) => x.verb === "sacrifice") === action;
      if (costSacrifice) {
        for (const e of emits) if (e.subject.control === "any") e.subject.control = "you";
        if (subject && subject.control === "any") subject.control = "you";
      }
      // A COST DISCARD IS THE CONTROLLER'S TOO ("{2}{B}, {T}, Discard a card: Each other player loses 2 life", Urborg Syphon-Mage), pinned like the cost sacrifice above: the clause-wide
      // `NAMES_A_PLAYER` guard reads the effect's "other player" and would leave it `any`. CEILING: the FIRST discard only, and only when the cost text holds a discard.
      // NOT where someone else pays it: "Only your opponents may activate this ability" (Soul Ransom) and "Any player may activate" (Lightning Storm, Saproling Cluster) leave the payer `any`.
      const costDiscard = action.verb === "discard" && /\bdiscard\b/i.test(cost) && (clause.actions ?? []).find((x) => x.verb === "discard") === action
        && !/\b(?:only your opponents|any player|any opponent|an opponent) may activate\b/i.test(clauseText);
      // A SEARCH OF YOUR OWN LIBRARY is yours whatever player the sentence also names ("if defending player controls more lands than you, search your library", Aerial Surveyor, Loyal Warhound, Tithe): the
      // same `librarySearchOwner` reading that sets `Ability.librarySearch`, so the emit and that field agree.
      const ownSearch = action.verb === "search" && clauseText !== "" && printsSearch(clauseText)
        && librarySearchOwner(action, clauseText, (clause.actions ?? []).slice(0, (clause.actions ?? []).indexOf(action)).filter((x) => x.verb === "search").length) === "yours";
      if (costDiscard || ownSearch) {
        for (const e of emits) if (e.subject.control === "any") e.subject.control = "you";
        if (subject && subject.control === "any") subject.control = "you";
      }
      // AN EDICT NAMES ITS PLAYER, NOT ITS CREATURE (#1295): "Target player sacrifices a creature of their choice"
      // targets the player, so the sacrifice and the death carry `edict` instead of a `target` scope they never had.
      // Not read through `actorFor`, which refuses a clause with two sacrifices -- and an edict has two when it asks for
      // "an artifact and a land" (Structural Collapse) or follows a sacrifice COST (Rakdos Riteknife). The cost's own
      // sacrifice and the card's own are never the victim's. CEILING: "Target player sacrifices X. You sacrifice Y." marks
      // Y's emits too; no corpus card is shaped so.
      if (action.verb === "sacrifice" && !costSacrifice && sacrificerIsTargeted(clauseText) && !victimDeclines(clauseText, "sacrifice")) for (const e of emits) if (e.subject.self !== true) e.subject.edict = true;
      // A STATED "you" INSIDE A GRANTED ABILITY IS THE RECIPIENT'S CONTROLLER (Hellish Rebuke: "You
      // lose 2 life" is said by the opponent's permanent), the same flip line 1154 applied to the
      // object's own "you" -- the actor cue runs after it and must not undo it.
      const cued = actorFor(action.verb);
      // THE ACTOR OWNS WHAT IT ACTS ON only for sacrifice, discard, draw, mill, search, counters and life. For a verb that MOVES a card between zones, "an opponent exiles a nonland card from among
      // them" (Allure of the Unknown) chooses, and the card is still yours: the reading's player is written only where the object or zone names theirs ("from their hand", "that player controls").
      // CEILING: a word list on the stored object / zone, not a parse; a chooser whose phrase names no owner stays `any`.
      const mover = action.verb !== undefined && CARD_MOVING_VERBS.has(action.verb);
      const namesTheirs = /\b(?:their|that player'?s|his or her|opponents?'s?|they control|that player controls)\b/i.test(action.object ?? "") || action.fromZone === "hand" || action.fromZone === "graveyard" || action.fromZone === "library";
      const viaReading = cued === undefined && action.actor !== undefined && action.verb !== "create";
      const readingOk = !viaReading || !mover || namesTheirs;
      const stated = cued ?? (readingOk ? action.actor : undefined);
      // The grammar's named player FILLS what is unknown and never overrides a stated one (a `create` keeps its F2 override): "an opponent chooses a permanent YOU control and exiles it" (Wormfang Crab)
      // exiles your permanent, which the object already said.
      const readingFills = viaReading && readingOk;
      const actor = stated === "you" && grantedTo ? grantedTo.control : stated;
      if (actor) {
        // A PUT'S OBJECT MAY NAME ITS OWN CONTROLLER, and that outranks the actor: Visions of Dread's
        // "target opponent puts a creature card ... onto the battlefield under your control" is the
        // opponent acting and YOUR creature entering. The other cued verbs never state one on the
        // object ("each opponent draws a card"), so for them the actor stands as before.
        // AND A STATED "YOU" ON A PUT NEVER REACHES THE SUBJECT: "you may put up to one target
        // creature card from that player's graveyard onto the battlefield under your control"
        // (Sepulchral Primordial, Ink-Eyes) is you acting on THEIR card -- the subject is whose
        // graveyard it leaves, and writing `you` there turned the recursion into one over your own
        // graveyard (10 pairs lost on the first derive-152 diff). The enters emit still takes it:
        // the card lands under your control, which is the fact the actor states.
        const fillOnly = action.verb === "put" || readingFills;
        for (const e of emits) if (!fillOnly || e.subject.control === "any") e.subject.control = actor;
        if (subject && (!fillOnly || (subject.control === "any" && (stated !== "you" || (readingFills && action.verb !== "put"))))) subject.control = actor;
      } else if (ACTOR_DEFAULTS_TO_YOU.has(action.verb ?? "") && clauseText !== ""
        && (clause.actions ?? []).filter((a) => a.verb === action.verb).length === 1
        && !sentenceNamesAPlayer(clauseText, action.verb ?? "")) {
        // See ACTOR_DEFAULTS_TO_YOU. The clause TEXT was read and named no player for this verb --
        // without the text nothing is known and `any` stands, and a clause with two actions of the
        // verb ("target opponent draws a card. You draw two") is the ambiguity `actorFor` already
        // refuses. Only an UNSTATED controller is filled in: "sacrifice a creature you control"
        // already says you, and "an opponent's creature" (parsed `opp`) is kept.
        for (const e of emits) if (e.subject.control === "any") e.subject.control = "you";
        if (subject && subject.control === "any") subject.control = "you";
      } else if (action.verb === "put" && action.toZone === "battlefield" && clauseText !== ""
        && (clause.actions ?? []).filter((a) => a.verb === "put" && a.toZone === "battlefield").length === 1
        && !sentenceNamesAPlayer(clauseText, "put")) {
        // CR 110.2a: AN OBJECT PUT ONTO THE BATTLEFIELD ENTERS UNDER THE CONTROL OF THE PLAYER WHO PUT
        // IT. With no player named the putter is you (#963): Nissa, Leyline Tamer's "Put that card onto
        // the battlefield and the rest on the bottom of your library" read `any`, because its second
        // put (the rest, to the library) made `actorFor` refuse, and `any` fed every payoff watching an
        // OPPONENT's creature enter. Only the enters emit: the subject is whose library it left.
        for (const e of emits) if (e.verb === "enters" && e.subject.control === "any") e.subject.control = "you";
      } else if (REMOVAL_VERBS.has(action.verb ?? "") || emits.some((e) => e.verb === "leaves" && e.subject.zone !== "graveyard")) {
        // See REMOVAL_VERBS. Only a TARGETED removal with no stated controller. A targeted BOUNCE
        // ("return target creature to its owner's hand") joins the rule for its `leaves` emit: it is
        // aimed at an opponent's creature exactly as a targeted destroy is, and without this it read
        // `any` and fed "whenever a creature YOU control leaves". A leave from a GRAVEYARD does not
        // join it: "put target creature card from a graveyard onto the battlefield" (Reanimate) is
        // aimed at your own graveyard as readily as theirs, so recursion keeps `any`. An `exile` from
        // a graveyard is still a REMOVAL_VERB and reads `opp` -- Bojuka Bog -> Desecrated Tomb is the
        // accepted cost, the same one Saw in Half -> Bloodchief pays.
        // ...EXCEPT AN EXILE FROM YOUR OWN GRAVEYARD (recall v6 #172): Lazotep Quarry's "exile
        // target creature card ... from your graveyard" is aimed at nothing but yours.
        const own = action.fromZone === "graveyard" && exilesOwnGraveyard(action.object ?? "", clauseText);
        // ...AND A DESTROY WHOSE CONTROLLER GETS COPIES BACK (owner ruling 2026-09-27, #513/#716): Saw
        // in Half is played on your own creature, so the creature that dies is yours and Vengeful
        // Bloodwitch drains. Read off the whole card, the copies being the next sentence -- the same
        // test `rules.json`'s `controllerGetsCopies` makes for the removal role.
        // THE CLAUSE, not the card (review): a modal card's other destroy mode stays removal.
        // ...AND A PERMANENT YOU OWN (#1295): "exile target creature you own" (Become Anonymous, Northampton Farm, Sword of Hearth and
        // Home) is aimed at nothing but yours, not at an opponent's, which is what the default would say.
        const yours = own || CONTROLLER_GETS_COPIES.test(clauseText);
        for (const e of emits) {
          if (e.subject.control === "any" && e.subject.scope === "target") e.subject.control = yours || e.subject.owner === "you" ? "you" : "opp";
        }
      }
      // WHAT YOU PUT ONTO THE BATTLEFIELD ENTERS UNDER YOUR CONTROL (CR 110.2a: "If an effect
      // instructs a player to put an object onto the battlefield, that object enters the battlefield
      // under that player's control unless the effect states otherwise"). "Search your library for a
      // Forest or Island card, put it onto the battlefield" names no player for the put, so the
      // `enters` emit read `any` -- and `any` satisfies "whenever one or more lands enter under an
      // OPPONENT's control": Misty Rainforest -> Deep Gnome Terramancer, owner-judged FALSE
      // (2026-09-09, "some of those effects care about opponents actually searching"). 1,479 of the
      // corpus's 1,860 authored from-zone entries carried `any`. Only the emit moves: the EFFECT
      // subject of a recursion keeps `any` for "from a graveyard", the reading the matcher's
      // kill-theirs-take-it rule depends on (Feed the Swarm -> Animate Dead, owner-judged REAL).
      // "Under its owner's control" and every other stated controller is untouched, and
      // `entersUnderAnotherPlayer` still refuses the I7 shapes.
      if ((action.verb === "put" || action.verb === "return") && clauseText !== ""
        && (clause.actions ?? []).filter((a) => a.verb === action.verb).length === 1
        && !sentenceNamesAPlayer(clauseText, action.verb ?? "")) {
        for (const e of emits) if (e.verb === "enters" && e.subject.control === "any") e.subject.control = "you";
      }
      // WHO GETS THE EMBLEM (CR 114.2) is read off the sentence, not the object: the object says
      // "an emblem with that ability" and nothing more on 20 of the 86 corpus grants. The recipient
      // becomes the node's CONTROLLER in the matcher (`collectTokenNodes` flips the emblem's own
      // abilities to the opponent's perspective when this says `opp`), so it has to be right here.
      if (effectKind === "emblem" && subject) subject.control = clauseText ? emblemRecipient(clauseText) : "you";
      // A `clone` reaches edges.ts's applies-to pass whatever its ability kind, so it answers to the
      // same discipline a static does: name WHO becomes the copy, or form no edge. "Each other
      // creature you control becomes a copy of that creature" is the whole board, and a subject that
      // names nothing is a wildcard that matches every card in the deck.
      // AN ABILITY LOSS KEEPS ITS CLASS SUBJECT. It is a silence the matcher applies, never a
      // claim, so the whole-deck-lord refusal in `namesItsTargets` does not apply to it.
      // NOR DOES IT APPLY TO A RECURSION. "Cast one permanent spell with mana value 2 or less from
      // your graveyard" (Lurrus) is singular, so the refusal dropped it, and both recursion passes in
      // edges.ts skip a subjectless recursion: 66 corpus cards, Lurrus, Karador and Gisa and Geralf
      // among them, formed no recursion edge. The kept subject carries `zone: graveyard`, which no
      // printed card matches, so it cannot reach the applies-to pass either (Muldrotha, measured).
      const keepSubject = subject
        && (kind !== "static" || namesItsTargets(subject) || effectKind === "ability-loss"
          // A RETARGET'S SUBJECT IS A TARGET (scope "target"), never a whole-deck class, and a fact kind claims nothing pairwise: Emissary of Grudges' activated ability is stored `static`.
          || effectKind === "retarget"
          // ...and so is a targeting ban's (#1423): a fact kind, the pair channels read it blank, and WHO is protected is the point of the line.
          || effectKind === "targeting-ban"
          || effectKind === "trigger-suppression"
          || effectKind === "untap-denial"
          || (effectKind === "graveyard-recursion" && subject.zone === "graveyard")
          // A STATIC GRAVEYARD-HATE REPLACEMENT (Leyline of the Void, Rest in Peace, #1266) keeps whose graveyard it hits; the `zone: graveyard` matches no printed card, like the recursion above.
          || (effectKind === "graveyard-hate" && subject.zone === "graveyard" && graveyardReplacement(text)?.kind === "hate"))
        && (effectKind !== "clone" || subject.subtype !== undefined);
      // What the payoff's magnitude counts. Already consumed by edges.ts, impact.ts and buckets.ts;
      // derivation had simply never set it, so the channel was dark under TAGS_SOURCE=derived.
      // "Add X mana of any one color" is a bare X the model files on the OBJECT and the grammar files on `amount` ("X"); read the same, or the two paths disagree on `scaling` for every such card
      // (#1265 task 1: Kami of Whispered Hopes, Haruspex) and the per-card grammar switch moves on a difference that is only where the X was written.
      const bareXAdd = action.verb === "add-mana" && effectKind === "mana-generation" && (action.amount == null || action.amount === "") && /^x\b/i.test(action.object ?? "");
      const scaling = actionScaling(bareXAdd ? { ...action, amount: "X" } : action, text);
      // WHAT the count counts, beside the basis — see `scalingSubject`. Graveyard and battlefield
      // counts both carry one: those are the two `edges.ts` can judge against something it already
      // has, a fill it can match and a card's own printed characteristics.
      const countedSubject = scalingSubject(action, text);
      const effect = effectKind
        ? keepSubject ? { kind: effectKind, subject } : { kind: effectKind }
        : { kind: "" as const };
      const scaled = scaling ? { ...effect, scaling } : effect;
      const ability: Ability = {
        kind,
        effect: countedSubject ? { ...scaled, scalingSubject: countedSubject } : scaled,
      };
      if (replacement?.tokenMultiplier) ability.effect = { ...ability.effect, tokenMultiplier: replacement.tokenMultiplier };
      if (trigger) ability.trigger = trigger;
      // The effect lands on the permanent this card is attached to (#1315): a marker, never a subject -- see `Ability.host`.
      if (hostEffect(action, effectKind, text)) ability.host = true;
      if (effectKind === "restriction") { const r = restrictedActions(action.object ?? "", text, sameCant); if (r) ability.restricts = r; }
      if (effectKind === "untap-denial") { const u = untapDenialFor(action.verb ?? "", action.object ?? "", text, sameCant); if (u) ability.untapDenial = u.denial; }
      if (effectKind === "trigger-suppression") { const t = triggerSuppressionOf(action.object ?? "", text, sameCant); if (t) ability.suppresses = t.suppression; }
      if (effectKind === "targeting-ban") { const b = targetingBanOf(action.object ?? "", text, sameCant); if (b) ability.targetingBan = b; }
      // "DRAW A CARD IF IT WAS ATTACKING. OTHERWISE, ..." (#798, Garna; Zurgo Stormrender): the
      // condition narrows the action its own sentence names to a death IN COMBAT, which is the
      // trigger subject's combat state; the "Otherwise" branch keeps every other death.
      // CEILING: "attacking or blocking alone" (Thijarian Witness) is two states the field cannot hold.
      // CEILING: the verb id's first part must be the printed word ("draw", "deal"); an id whose word
      // differs ("gains-control" vs "gain control") never gets the state -- missing, never wrong.
      const verbWord = (action.verb ?? "").split("-")[0];
      for (const sentence of ability.trigger && verbWord ? text.split(".") : []) {
        const cond = COMBAT_IF.exec(sentence);
        if (!cond || !new RegExp(`\\b${verbWord}`, "i").test(sentence.slice(0, cond.index))) continue;
        ability.trigger = { ...ability.trigger!, subject: { ...ability.trigger!.subject, combat: cond[1]!.toLowerCase() as "attacking" | "blocking" } };
        break;
      }
      // The REAL cost, not "". It has been in scope since line 522 and threaded to repeatsFor at
      // line 680 for as long as `repeats` has existed; only this assignment threw it away, which is
      // why `Ability.cost` could sit empty corpus-wide with every test green. Sub-project B needs it
      // to tell a loop that pays for itself from one that costs {2} an iteration.
      if (clause.abilityType === "activated") ability.cost = cost;
      // The amount belongs to the ACTION, not the clause: Kaya's -2 is one clause whose two actions
      // each carry their own. Assigned here, in the per-action loop, for that reason.
      // A MANA ADD READS ITS AMOUNT THROUGH `production()` ALONE (#1193), the reader the mana line uses: a number is "6", never the clause's own word ("four", Cosmic
      // Crucible). What scales keeps the clause's text, and nothing when it states none.
      const manaAdd = action.verb === "add-mana" && effectKind === "mana-generation";
      if (manaAdd && (text === "" || addsManaText(text))) {
        // #1265: NEVER the clause's own `action.amount` for a mana add -- on a scaling line it is the per-unit "1" ("for each color among permanents you control, add ONE mana of that
        // color", Faeburrow Elder), which every reader took for the whole amount. A fixed read is "n"; what scales is the scaling text `production()` found, in ONE case (lowercase, as the line
        // keeps it; `deriveMana` then stamps the sentence's own scale and the interval over it); an unread amount stores nothing.
        const read = production(action.object ?? "", typeof action.amount === "string" ? action.amount : "").amount;
        if (read.fixed !== null) ability.amount = String(read.fixed);
        else if (read.scales !== null) ability.amount = read.scales;
      } else if (manaAdd) {
        // A "mana-generation" the model typed from text that ADDS no mana ("you may pay {X}", Halo Forager; energy, Aetherflux Conduit) keeps its pre-#1265 reading and gets no interval.
        const added = manaAdded(action.object ?? "", typeof action.amount === "string" ? action.amount : "");
        if (added !== undefined) ability.amount = String(added);
        else if (action.amount != null && action.amount !== "") ability.amount = action.amount;
      } else if (action.amount != null && action.amount !== "") {
        ability.amount = action.amount;
      } else {
        const unit = unitAmount(action.verb ?? "", action.object ?? "");
        if (unit !== undefined) ability.amount = unit;
        // A PRONOUN COUNTS WHAT ITS ANTECEDENT COUNTED: "search for up to two basic land cards ...
        // put them onto the battlefield" puts up to two (edge magnitude; Canoptek Wraith).
        else if (antecedent) {
          const n = ANTECEDENT_COUNT.exec(antecedent.trim());
          if (n) ability.amount = n[0].toLowerCase();
        }
      }
      // HOW MANY CARDS REACH YOUR HAND, whether they are a pick from a larger look, and the three riders hand-fill roles read (#1302, CR 121.5): read off the put's own object and clause, never the clause's `amount`.
      // A `to-hand` ability keeps the count on `amount`; a typed dig (`search`) keeps `amount` as it was (edges read it) and carries the count on `toHand`, which is also what marks it as hand-fill.
      if (handRead) {
        if (effectKind === "to-hand") ability.amount = handRead.amount; else ability.toHand = handRead.amount;
        if (handRead.chooses) ability.chooses = true;
        if (handRead.named) ability.named = true;
        if (handRead.netZero) ability.netZero = true;
      }
      // The payment that stops the effect (CR 118.12a), verbatim: the floor the rate axis reads.
      if (action.unless?.cost) ability.unless = { cost: action.unless.cost, payer: action.unless.payer as "you" | "opponent" | "controller" | "any" };
      // WHICH triggers a doubler doubles, read off the printed text — the clause layer records only
      // the object and drops the qualifier, so Panharmonicon (entering), Isshin (attacking) and
      // Drivnod (dying) were byte-identical before this. Empty for a doubler whose qualifier names
      // no event the closed map holds, which keeps that card silent rather than guessing.
      // The token this ability makes leaves at the next end step. Read off the clause text because
      // the clause layer records the exile as a bare `exile: "it"` action whose object cannot say
      // WHEN — the timing is only in the sentence.
      if (effectKind === "token-generation" && (LEAVES_SAME_TURN.test(text) || DECAYED.test(text))) {
        ability.temporary = true;
        // AND THE TOKEN LEAVES, ON THIS SAME ABILITY (DERIVE 173, overview persona rounds 2026-09-25,
        // item 4): Dour Port-Mage never heard of Inalla's copy leaving. An emit here, never a second
        // ability -- that doubled every trigger reason (+187 rows, 2026-09-16). Exiled tokens LEAVE;
        // sacrificed ones (end of combat, decayed) DIE, CR 700.4.
        // (The emit is added below, once this ability's emits are attached.)
      }
      if (effectKind === "trigger-doubling") {
        const doubles = doubledVerbs(text);
        if (doubles.length) ability.doubles = doubles;
        // WHOSE, the other axis (recall v5 #196): "a triggered ability of another Elemental you
        // control". Read off the same text, refused unless it names a class -- see doubles.ts.
        const of = doublesOf(text);
        if (of) ability.doublesOf = of;
      }
      // TIMING, the smallest model that holds a ruling: an activated ability is used in combat, a
      // sorcery is not, so "a sac outlet can eat an attacking creature" (owner, Ayara -> Death
      // Tyrant, upheld 2026-08-22) and Blasphemous Edict -> Kardur is refused. Loyalty abilities
      // (CR 606.3) and "activate only as a sorcery" are sorcery-speed activations.
      const instantSpeed = kind === "activated"
        ? !SORCERY_SPEED.test(clauseText ?? "") && paymentOf(cost, cardName)?.loyalty === undefined
        : kind === "on-cast" && castAtInstantSpeed === true;
      if (instantSpeed && !delayedAction(text, action, clause.actions ?? [])) for (const e of emits) e.instantSpeed = true;
      // #1266: a graveyard-hate effect whose every exiled-from-graveyard emit is YOURS is owned by you too (an own-trigger exile: Nightmare Shepherd, Brenard), so a role rule refusing your own yard sees it on the effect.
      if (ability.effect.subject && effectKind === "graveyard-hate") {
        const taken = emits.filter((e) => e.verb === "exiled" && e.subject.fromZone === "graveyard");
        if (taken.length > 0 && taken.every((e) => e.subject.owner === "you")) ability.effect.subject.owner = "you";
      }
      if (emits.length) ability.emits = emits;
      // A COIN-FLIP SIDE (CR 705, #1295 item 5), read on THIS action's own sentence: the k-th action of a verb takes the k-th sentence carrying that verb's printed word (`FLIP_VERB_WORDS`).
      // CEILING: a verb whose printed word is not in the table or the verb's own name (`other`, ...) finds no sentence and is unmarked; a word that also appears for another job ("gains flying" beside a `modify-pt` "gets") can shift a later action's sentence.
      if (action.verb) {
        const clauseActions = clause.actions ?? [];
        const k = clauseActions.slice(0, clauseActions.indexOf(action)).filter((x) => x.verb === action.verb).length;
        const onFlip = flipBranch(nthSentenceMatching(text, flipVerbWord(action.verb), k), clauseActions.some((x) => x.verb === "flip-coin"));
        if (onFlip) ability.onFlip = onFlip;
      }
      // THE CONDITION THIS EFFECT IS GATED ON (#1357, owner 2026-10-27): an "if <condition>" that governs the action (trailing, in its own conjunct, or leading its sentence, #1357 part 2), parsed by the one `parseGate` and carried by THIS ability only (an ungated action of the
      // same clause has none). The deck demand it makes is the existing `conditionCares`, set on the ability itself: an instant has no trigger for the clause-level pass below to hang it on. See effect-gate.ts for what is no gate.
      const gateText = gateReads?.gates[(clause.actions ?? []).indexOf(action)];
      if (gateText) {
        const otherwise = isOtherwiseGate(gateText);
        // THE FACE THE ABILITY IS PRINTED ON names itself: "~" in a back face's ability is the back face (Bruce Banner // The Incredible Hulk), never the front.
        const faceNames = (cardName ?? "").split(" // ");
        // CEILING: an ADVENTURE half carries `face === undefined` (segment() records a face index for a transforming/modal card, not for the Adventure), so a "~" in an Adventure-half gate resolves to the creature's name; no corpus Adventure gate holds a name today.
        const selfName = faceNames[face ?? 0] ?? faceNames[0] ?? "";
        const parsedGate = otherwise ? { kind: "unknown" as const, text: gateText.replaceAll("~", selfName).toLowerCase(), otherwise: true as const } : parseGate(gateText.replaceAll("~", selfName));
        // A counter the card places on itself is no counters demand (#1357 review): no deck supplies a "phyresis" or "hunger" counter, and the false demand reached edges.ts' dies-trigger guard.
        // The OTHER branch of an "if" asks nothing of the deck: the demand is the condition's, and this branch is its opposite (#1357 part 2).
        const gateCares = otherwise ? [] : conditionCares_(gateText).filter((tag) => !(tag === "counter-added:any" && counterIsTheCardsOwn(gateText, cardText)));
        // The gate's OWN demand rides on the gate (the weigher reads only this); `conditionCares` below is the merged themes/ratings field, which also takes the trigger's intervening-if demand.
        ability.gate = parsedGate.kind === "unknown" && gateCares.length > 0 ? { ...parsedGate, cares: gateCares } : parsedGate;
        if (gateCares.length > 0) ability.conditionCares = gateCares;
        if (!otherwise && alike?.[(clause.actions ?? []).indexOf(action)]) ability.otherwiseAlike = true;
      }
      // A RETURN THAT LANDS LATER (#801, Shirei): read on THIS action's own sentence, so an immediate
      // return beside a delayed one stays immediate (Gift of Immortality, Swift Warkite; review). The
      // k-th return/put action is the k-th "return"/"put" in the text. CEILING: a counter "put" in the
      // text that derived as `add-counter` would shift a later put's sentence.
      if ((action.verb === "return" || action.verb === "put") && ability.effect.kind !== "token-generation") {
        const k = (clause.actions ?? []).slice(0, (clause.actions ?? []).indexOf(action)).filter((x) => x.verb === action.verb).length;
        const delay = returnDelay(nthSentenceWith(text, action.verb, k));
        if (delay) ability.delayedUntil = delay;
        // #1295 item 3: an O-ring return waits for its source ("until this creature leaves the battlefield"; the model-synthesized return has no "return" word, so it is
        // read off the clause text), and a return on one "If ..." branch is marked, not a blink.
        // CEILING: `untilSourceLeaves` reads the whole clause, so every return beside an "until this leaves" exile is marked, not only the paired one (Mysterious Limousine's immediate second return).
        else if (action.verb === "return" && untilSourceLeaves(text)) ability.delayedUntil = "source-leaves";
        if (conditionalReturn(nthSentenceWith(text, action.verb, k))) ability.returnIf = true;
      }
      // A RETURN THAT MARKS WHAT IT RETURNS happens once per object (#886): a finality counter exiles
      // it the next time it would die (CR 122.1h, Meathook Massacre II), and a keyword counter the
      // trigger excludes takes it out of the trigger (Luminous Broodmoth's flying counter on a
      // creature "without flying"). Still repeatable -- every OTHER creature returns once too.
      // Read on the return's OWN sentence, "with a <kind> counter on it", so a counter put on some other
      // object in the clause marks nothing (review).
      if ((action.verb === "return" || action.verb === "put") && action.toZone === "battlefield") {
        const k = (clause.actions ?? []).slice(0, (clause.actions ?? []).indexOf(action)).filter((x) => x.verb === action.verb).length;
        const mark = RETURNED_WITH_COUNTER.exec(nthSentenceWith(text, action.verb, k))?.[1]?.toLowerCase();
        if (mark && (mark === "finality" || (trigger?.subject.notKeyword ?? []).includes(mark))) ability.oncePerObject = true;
      }
      const made = ability.temporary ? emits.find((e) => e.verb === "create-token") : undefined;
      if (made) {
        const rider = LEAVES_SAME_TURN.exec(text)?.[0] ?? "";
        const dies = DECAYED.test(text) || /\bsacrifice\b/i.test(rider);
        // A TOKEN SACRIFICED AT END OF COMBAT DIES ATTACKING (#798): it leaves combat only as the
        // end-of-combat step ends, so Garna's "if it was attacking" draws for Echoing Assault's copy
        // and a decayed Zombie (sacrificed at end of combat after it attacks). "Next end step" does not.
        const inCombat = DECAYED.test(text) || /\bat end of combat\b/i.test(rider);
        ability.emits = [...emits, { verb: dies ? "dies" : "leaves", subject: { ...made.subject, ...(inCombat ? { combat: "attacking" as const } : {}) } }];
      }
      if (face) ability.face = face;
      const firstOfAction = abilities.length;
      abilities.push(ability);
      // A SELF-OR-CLASS TRIGGER IS TWO TRIGGERS (recall v4 #144, 2026-09-09). "Whenever this
      // creature or another enchantment you control enters" (Fear of Sleep Paralysis, and every
      // constellation card) had its self half STRIPPED so the class half could not union with it
      // (Kappa Cannoneer, above) -- and with it went the card's own ETB, which is exactly what a
      // flicker re-fires. The class half stays as it was; a twin carries the self half, subject
      // `{self: true}` typed by the word after "this", the same shape a plain "when this creature
      // enters" derives. Essence Flux -> Fear now joins on the twin.
      const rawTrigger = clause.trigger?.subject ?? "";
      const selfWord = trigger && SELF_DISJUNCT.test(rawTrigger) ? /^this (\w+)/i.exec(rawTrigger)?.[1] : undefined;
      if (selfWord && selfWord !== "spell" && selfWord !== "card") {
        // The zone qualifier belongs to BOTH halves: River Kelpie's "this creature or another
        // permanent enters from a graveyard" is a from-graveyard trigger for Kelpie too, and a twin
        // without it re-made two panel FALSEs (Phantasmal Image -> Kelpie) on the first derive.
        const own = parseSubject(`this ${selfWord}`);
        const zone = trigger!.subject.fromZone !== undefined ? { fromZone: trigger!.subject.fromZone } : {};
        // The combat state this action's own condition set (#798) holds for the self half too (review).
        const combat = ability.trigger?.subject.combat ? { combat: ability.trigger.subject.combat } : {};
        abilities.push({ ...ability, trigger: { ...trigger!, subject: { ...own, control: "you", self: true, ...zone, ...combat } } });
      }
      // AN "OR" LIMB THE CLAUSE LAYER CANNOT HOLD IS A TWIN TOO (compass misses, 2026-09-28). A
      // ClauseRecord trigger holds ONE event, so Syr Konrad's "Whenever another creature dies, OR a
      // creature card is put into a graveyard from anywhere other than the battlefield, OR a creature
      // card leaves your graveyard" was stored as its first limb only, and every mill card lost its
      // link. Each extra limb derives a twin with the same effect, in the shape a single-limb card of
      // that event derives (Skola Grovedancer, Desecrated Tomb). 2 corpus cards print the shape.
      for (const extra of grammarExtra) abilities.push({ ...ability, trigger: extra });
      const limbCombat = ability.trigger?.subject.combat ? { combat: ability.trigger.subject.combat } : {};
      // The grammar reads every limb itself (above); these twins are the stored path's.
      if (trigger && !grammarRead) for (const limb of orLimbTriggers(text)) abilities.push({ ...ability, trigger: { ...trigger, verbs: limb.verbs, subject: { ...limb.subject, ...limbCombat } } });
      if (action.verb === "search") {
        // #1266: a PRINTED search says whose library; a `search` ability read off a `put` (a dig) never gets here with this verb.
        // A model-written dig also says `search`; with the printed text in hand, the text must say it too.
        // CEILING: with NO clause text (1 corpus card, Heaped Harvest, 2 actions, both real searches, measured at DERIVE 361) the verb is trusted, so a model-written dig with no
        // recoverable text would read `yours`. Gating it would drop that real tutor.
        const nth = (clause.actions ?? []).slice(0, (clause.actions ?? []).indexOf(action)).filter((x) => x.verb === "search").length;
        const owner = clauseText === "" || printsSearch(clauseText) ? librarySearchOwner(action, clauseText, nth) : undefined;
        if (owner) for (const made of abilities.slice(firstOfAction)) if (made.effect.kind === "search") made.librarySearch = owner;
      }
      if (action.verb === "search" || action.verb === "counter-spell") destinationOwners.set((clause.actions ?? []).indexOf(action), abilities.slice(firstOfAction));
    }

    // A RESTRICTION THE ENGINE CANNOT CHECK MAKES THE STATIC LABEL-ONLY TOO, not just the trigger
    // (2026-08-21). `replacement.restricted` already suppressed the synthesized consumer trigger for
    // exactly this reason -- "a claim it cannot check is the wrong-answer direction this repo
    // refuses" -- but the ability's own SUBJECT survived, and the static applies-to pass in
    // `edges.ts` reads that subject and claims every card matching it.
    //
    // MEASURED, and it is why this exists: re-normalizing the corpus gave Raphael, the Muscle
    // ("Double all damage that creatures you control WITH COUNTERS ON THEM would deal") the subject
    // `{creature, you, all}` and Mjolnir, Hammer of Thor ("Double all damage EQUIPPED CREATURE would
    // deal") the subject `{creature, any, all}`. Together they took MESHED 288 -> 405: 60 + 57 = the
    // whole +117. The narrowing is real, printed, and unrepresentable -- a counter presence and an
    // attachment -- so the honest answer is to keep the KIND (the product classifiers want it) and
    // claim nothing about which cards it applies to.
    if (replacement?.restricted) {
      for (let i = before; i < abilities.length; i++) {
        if (abilities[i].kind === "static" && abilities[i].effect?.subject) delete abilities[i].effect.subject;
      }
    }

    const drain = drainAbility(clause, kind, trigger, cost);
    if (drain) { if (face) drain.face = face; abilities.push(drain); }
    // THE MODAL HEADER SUPPLIES THE EVENT ITSELF (`derive/modal.ts`): "you face a dilemma as you choose one or more modes for a spell or ability" is no verb a clause
    // instructs, so it is pushed here with the header's own kind, trigger and cost, and the labelling below stamps its clause, repeats and count like any other. A spell's
    // header carries no ability type of its own (static, or none), and a modal spell is cast: on-cast. A triggered header whose trigger was REFUSED derives no trigger
    // and would claim an event that never fires, so it emits nothing (a missing edge, never a wrong one).
    // CEILING: that refusal leaves genuinely modal cards with no dilemma emit: 14 of 758 headers (Black Market Connections "first main phase", Hylda of the Icy Crown and Voltstorm
    // Angel "When you do" reflexives, Life of Toshiro Umezawa's chapter, Jin Sakai and Tetsuo "if" riders, "second spell each turn"). Their modes are still derived; the dilemma is not.
    if (facesDilemma && !(kind === "triggered" && !trigger)) {
      const dilemmaKind: AbilityKind = kind === "static" || clause.abilityType === "none" || clause.abilityType === undefined ? "on-cast" : kind;
      // The same instant-speed rule as the emits beside it (above): an activated ability not limited to sorcery speed, or an instant's / flash spell's cast.
      const dilemmaInstant = dilemmaKind === "activated"
        ? !SORCERY_SPEED.test(clauseText ?? "") && paymentOf(cost, cardName)?.loyalty === undefined
        : dilemmaKind === "on-cast" && castAtInstantSpeed === true;
      abilities.push({ kind: dilemmaKind, effect: { kind: "" }, ...(trigger ? { trigger } : {}),
        emits: [{ verb: "face-a-dilemma", subject: { control: "you", token: null }, ...(dilemmaInstant ? { instantSpeed: true as const } : {}) }], ...(kind === "activated" ? { cost } : {}), ...(face ? { face } : {}) });
    }
    const toughnessDamage = toughnessDamageAbility(text);
    if (toughnessDamage) { if (face) toughnessDamage.face = face; abilities.push(toughnessDamage); }
    // THE MODEL LEFT BOLAS'S CITADEL'S PERMISSION EMPTY (verb `none`); the printed sentence still says
    // it (#856). Only when the clause derived no play-from-top of its own.
    if (kind === "static" && playsFromTop(text) && !abilities.slice(before).some((a) => a.effect.kind === "play-from-top")) {
      abilities.push({ kind: "static", repeats: "continuous", effect: { kind: "play-from-top", subject: { control: "you", token: null, zone: "library" } }, ...(face ? { face } : {}) });
    }
    // ANOTHER LOYALTY ACTIVATION (#859), off the printed sentence: the model answers `other`.
    const extra = extraLoyalty(text);
    if (extra && !abilities.slice(before).some((a) => a.effect.kind === "extra-loyalty")) {
      const subject: SubjectFilter = extra === "self"
        ? { control: "you", token: null, self: true }
        : { control: "you", token: null, type: "planeswalker", scope: "all" };
      abilities.push({ kind, effect: { kind: "extra-loyalty", subject }, ...(trigger ? { trigger } : {}),
        ...(kind === "activated" ? { cost } : {}), ...(face ? { face } : {}) });
    }
    const castAsFlash = kind === "static" ? castAsFlashAbility(text) : undefined;
    if (castAsFlash) { if (face) castAsFlash.face = face; abilities.push(castAsFlash); }

    // A TRIGGER is a consumer signal in its own right, independent of what the effect does. Geode
    // Rager's "Landfall — whenever a land you control enters, GOAD each creature target player
    // controls" maps `goad` to no kind and no emit, so every action was unclaimed, the clause pushed
    // nothing, and the landfall trigger went with it: every land in the deck stopped feeding it.
    // 83 corpus clauses lose a legal `enters` trigger this way, plus cast 23, sacrificed 22,
    // attacks 18 and dies 12.
    //
    // The effect stays honestly EMPTY — we know when it triggers, not what it does — and the actions
    // remain in `unclaimed`, so the derivation gap is still visible rather than papered over.
    // THE COUNT THE ABILITY IS GATED ON, read from the clause TEXT (the same channel repeatsFor
    // reads for its once-each-turn rule) and stamped on every ability the clause derives, whatever
    // its kind: a trigger's intervening if, a static's "as long as", an activation's "only if", a
    // restriction's "unless". Once per clause, so `thresholdFor` and `thresholdSubjectFor` cannot
    // disagree between two abilities of one sentence.
    const printedThreshold = thresholdFor(text);
    const threshold = printedThreshold ?? stationThresholdFor(text, cardText);
    const thresholdSubject = printedThreshold ? thresholdSubjectFor(text) : undefined;
    // A TYPED COUNT IS A DEMAND IN ITS OWN RIGHT, as a trigger is (recall v6 #77, v7 #79). Gadrak
    // "can't attack unless you control four or more artifacts" is a `cant` static whose action maps
    // to no kind, so the clause pushed nothing and the one thing the card asks of its deck --
    // artifacts -- went with it. Kept only when the count NAMES a class: a bare number gates nothing
    // the matcher can join, and a kindless ability with nothing on it is noise.
    if ((trigger || thresholdSubject) && abilities.length === before) {
      // A multiplier reaches here when its action was refused upstream — Tekuthal's `proliferate` on
      // a static clause, which `keywordActionOnStaticClause` drops precisely so it never becomes a
      // proliferate source. The KIND is known even though the action was refused, so the ability is
      // labelled rather than left empty.
      abilities.push({ kind, effect: replacement ? { kind: replacement.kind, ...(replacement.tokenMultiplier ? { tokenMultiplier: replacement.tokenMultiplier } : {}) } : { kind: "" as const },
        ...(trigger ? { trigger } : {}), ...(face ? { face } : {}) });
    }

    // Label everything this clause produced, in ONE place rather than at each of the three push
    // sites above (the main action loop, `drainAbility`, and the trigger-only fallback). A fourth
    // push site added later cannot silently skip labelling this way.
    // The DEMAND an intervening-if condition makes on the deck, recorded in the same one place. Only
    // an ability with a TRIGGER can carry one (CR 603.4 checks the condition when the trigger would
    // fire), so a static or on-cast clause is skipped even if the sentence happens to say "if".
    // An ACTIVATION RESTRICTION's condition is a demand too ("Activate only if you've cast a noncreature spell this turn", Doctor Strange), read by the
    // same `conditionCares` as a trigger's intervening if, so one wording gives one answer. A pure count ("control three or more artifacts") names no
    // tag there and so demands nothing; "at least 10 life more than your starting life total" keeps its lifegain demand beside its threshold.
    const activationIf = kind === "activated" ? activationConditionOf(text ?? "") : null;
    const conditionCares = interveningIfOf(text) ? conditionCares_(interveningIfOf(text)!) : activationIf ? conditionCares_(activationIf) : [];
    // HOW THE OBJECT ARRIVED. The condition "if none of them were cast or no mana was spent"
    // (Satoru) and the trigger phrase "enters tapped" (Amulet of Vigor, Tiller Engine) are both
    // properties of the ENTRY, so they narrow the trigger's own subject rather than needing a
    // condition evaluator. "Without being played" is the land wording of the same fact.
    const arrivalNotCast = ARRIVED_WITHOUT_CASTING.test(text);
    const arrivalTapped = /\benters tapped\b/i.test(text);
    // EXHAUST IS ONCE PER GAME (CR 702.177a). The segmenter strips "Exhaust —" as an ability
    // word, so the clause text cannot say it; the printed line that starts with it and this
    // ability's own cost can. Loot, the Pathfinder amortised a once-per-game draw (2026-09-17).
    const delayed = kind === "triggered" ? delayedTriggerRepeats(text ?? "", cardText) : undefined;
    const exhaust = cost !== "" && new RegExp(`^Exhaust — ${cost.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:`, "m").test(cardText);
    for (let i = before; i < abilities.length; i++) {
      // WHICH CLAUSE PRINTED IT (roadmap AJ4, spec C2). Stamped in the same one place as the rest,
      // for the same reason: a fourth push site cannot silently skip it. The card page reads down
      // the card, and without this it could only ZIP the clause list against the ability list --
      // which is wrong on every row of any card whose first clause derives nothing (Samut: 4
      // clauses, 3 abilities, every zipped row a lie).
      abilities[i] = { ...abilities[i], clause: clause.id };
      if (inherits && headerTrigger && abilities[i].trigger) abilities[i] = { ...abilities[i], trigger: headerTrigger };
      else if (inherits && headerRefused.length > 0 && abilities[i].trigger) { const { trigger: _t, ...untriggered } = abilities[i]; abilities[i] = untriggered; }
      const repeats = exhaust ? "once" : delayed?.repeats ?? repeatsFor(abilities[i], text, cost, rawTrigger);
      if (repeats) abilities[i] = { ...abilities[i], repeats };
      if (delayed && abilities[i].trigger) abilities[i] = { ...abilities[i], delayedBy: delayed.delayedBy };
      if (threshold) abilities[i] = { ...abilities[i], threshold, ...(thresholdSubject ? { thresholdSubject } : {}) };
      // A REFUSED trigger still says what the card needs around it (owner 2026-08-20): the cares
      // tags ride on every ability of a triggered clause, claimed or not.
      if (conditionCares.length > 0 && (abilities[i].trigger || clause.trigger?.event || activationIf)) {
        // ...beside the demand of the effect's own gate (#1357), when the ability has one.
        abilities[i] = { ...abilities[i], conditionCares: [...new Set([...(abilities[i].conditionCares ?? []), ...conditionCares])] };
      }
      // THE MULTIPLIER'S OWN TRIGGER, the one synthesized from the "would ... instead" frame -- see
      // `Ability.replacement`. Matched on the verbs so a clause's other trigger is never marked.
      const heard = abilities[i].trigger?.verbs ?? [];
      if (replacement && !replacement.restricted && replacement.verbs.some((v) => heard.includes(v))) {
        // AND WHAT IT DOES TO THE EVENT, when a number is printed (`Ability.change`, DERIVE 388).
        abilities[i] = { ...abilities[i], replacement: true, ...(replacement.change ? { change: replacement.change } : {}) };
      }
      // EDGE MAGNITUDE (spec 2026-09-29): how many events one use supplies, and whether the
      // consumer hears a batch once. Read after `replacement` is known, which changes the reading.
      // CEILING: `batched` reads this clause's own trigger subject, so a continuation clause that
      // inherits its trigger is never batched, and an or-limb twin shares its clause's reading.
      const count = countOf(abilities[i].amount, abilities[i].emits?.[0], text, abilities[i].replacement === true);
      if (count) abilities[i] = { ...abilities[i], count };
      const payment = abilities[i].cost !== undefined ? paymentOf(abilities[i].cost, cardName) : undefined;
      if (payment) abilities[i] = { ...abilities[i], payment };
      // WHICH KEYWORDS A GRANT HANDS OUT (#857): read off the clause's grant objects against the CR
      // keyword-ability list. A clause with two grants gives each ability the union, which is why the
      // twins are folded at the end (`foldGrantTwins`).
      // A SPEED GRANT TOO (#1079): haste and double strike share `speed-increase`, and without its
      // keywords Chocobo Knights' double strike read "grants haste".
      if (abilities[i].effect?.kind === "keyword-grant" || abilities[i].effect?.kind === "speed-increase") {
        const granted = grantedKeywords((clause.actions ?? []).filter((a) => a.verb === "grant-ability").map((a) => a.object ?? ""));
        // A "gains double strike" the normalizer filed as the verb `double` (#1141) has no grant-ability
        // action to read, so the speed keywords come off the clause text -- and are ADDED to any the
        // clause's grant-ability actions name: Assault on Osgiliath stores `double` + grant-ability
        // (haste), and reading the actions alone kept haste and lost the double strike it prints.
        // CEILING: haste and double strike only, and only when effect-kind routed a `double` action here.
        const doubled = abilities[i].effect?.kind === "speed-increase" && /\bdouble strike\b/i.test(text ?? "")
          && (clause.actions ?? []).some((a) => a.verb === "double" || a.verb === "triple")
          ? grantedKeywords([text ?? ""]).filter((k) => k === "haste" || k === "double strike") : [];
        const grants = [...new Set([...granted, ...doubled])];
        if (grants.length > 0) abilities[i] = { ...abilities[i], grants };
      }
      const reduces = abilities[i].effect?.kind === "cost-reduction" ? reductionOf(text ?? "", abilities[i].amount) : undefined;
      if (reduces) abilities[i] = { ...abilities[i], reduces };
      // A becomes-blocked trigger's stored subject can be the BLOCKER (Ogre Leadfoot: "an artifact creature"), so a trigger with a `blocker` has its `batched` read off the printed "by ...", never off the stored subject (#1381). A plain "one or more creatures you control become blocked" (Hezrou) keeps it.
      if (abilities[i].trigger && !abilities[i].trigger!.blocker && BATCHED.test(clause.trigger?.subject ?? "")) {
        abilities[i] = { ...abilities[i], trigger: { ...abilities[i].trigger!, batched: true } };
      }
      // A GAME-STATE REQUIREMENT: from the ability word the segmenter stripped ("Max speed —"),
      // else from a condition that governs the whole clause text (roadmap W18).
      const requires = clauseRequires?.[clause.id] ?? requiresOf(text);
      if (requires) abilities[i] = { ...abilities[i], requires };
      // A REFUSED TRIGGER CLAIMS NOTHING (#1253). Every way a triggered clause loses its trigger funnels
      // here: the grammar's refusal and its narrowing/if: refusals (`grammarAll`), the stored path's
      // `unknownTriggers` branches, a phantom guard, and a mode that inherited a header the grammar
      // refused. Whatever the cause, an ability of kind `triggered` with NO trigger whose emits or effect
      // say `ref: "trigger"` is pointing at an object nothing defines, and over a `control: any` subject
      // that is every card. Marked, not dropped: roles and counts keep its kind.
      // ONLY WHEN THE OBJECT'S CLASS IS GONE (owner ruling, #1253): the ref names no class at all, or the
      // refusal is an `if:` that TESTS THE OBJECT ("if it was enchanted or equipped", "if it was cast",
      // "if it's exiled"). A refusal that read only timing or a count ("if it's not their turn", "if it's
      // the first time ... this turn") leaves "a creature you control" exact, and the ability keeps claiming it.
      if (kind === "triggered" && !abilities[i].trigger && namesTriggerObject(abilities[i])
        && (triggerObjectClassless(abilities[i]) || unknownTriggers.slice(refusedBefore).some((r) => r.startsWith("if:")) && conditionTestsObject(text))) {
        abilities[i] = { ...abilities[i], claimsNothing: "refused-trigger" as const };
      }
      const trig = abilities[i].trigger;
      // THE CLASS INSIDE THE IF IS THE TRIGGER'S CLASS (owner, 2026-09-16, recall v7 #178): "whenever
      // you cast a spell, if it's the first instant spell, the first sorcery spell, or the first
      // Otter spell ... this turn" (Alania, Divergent Storm) is a trigger on instants, sorceries and
      // Otters; the once-per-turn half is dropped ("skip the if part"). Only when the trigger's own
      // subject is the bare `spell`, so a narrowed trigger keeps its narrowing. One corpus card.
      if (trig && trig.verbs.includes("cast") && trig.subject.type === "spell" && trig.subject.subtype === undefined && trig.subject.anyOf === undefined) {
        const classes = [...text.matchAll(/\bthe first (\w+) spell\b/gi)].map((m) => m[1]!);
        if (classes.length > 0) {
          const { type: _t, ...shared } = trig.subject;
          abilities[i] = { ...abilities[i], trigger: { ...trig, subject: { ...shared,
            anyOf: classes.map((cls) => { const { control: _c, token: _k, ...b } = parseSubject(`a ${cls} spell`); return b; }) } } };
        }
      }
      if (trig && trig.verbs.includes("enters") && (arrivalNotCast || arrivalTapped)) {
        abilities[i] = { ...abilities[i], trigger: { ...trig, subject: {
          ...trig.subject,
          ...(arrivalNotCast ? { notCast: true as const } : {}),
          ...(arrivalTapped ? { entersTapped: true as const } : {}),
        } } };
      }
      // THE SIZE OF THE EVENT A DAMAGE TRIGGER WATCHES ("exactly 1 damage", "5 or more damage"),
      // read after every rewrite above so none of them drops it. See `event-amount.ts`.
      const damageTrigger = abilities[i].trigger;
      const eventAmount = damageTrigger?.verbs.some((v) => v.includes("damage")) ? eventAmountFor(text) : undefined;
      if (damageTrigger && eventAmount) abilities[i] = { ...abilities[i], trigger: { ...damageTrigger, amount: eventAmount } };
    }
    // A clause that states its own trigger is the header any following bullets inherit (#846).
    if (!inherits && clause.trigger?.event) {
      inheritedTrigger = clause.trigger;
      headerTrigger = abilities.slice(before).find((a) => a.trigger)?.trigger;
      headerRefused = headerTrigger === undefined ? unknownTriggers.slice(refusedBefore) : [];
      headerStates.set(headerKey(clause), { inheritedTrigger, headerTrigger, headerRefused });
    }
  }
  if (dupMark) { unclaimedHere.length = dupMark.unclaimed; unknownTriggers.length = dupMark.unknown; }
  // AN OPPONENT'S GRAVEYARD, TAKEN ON THE WAY IN (recall v4 #28, 2026-09-09). Valgavoth, Terror
  // Eater and Dauthi Voidwalker exile what would go to an opponent's graveyard and let you play it,
  // so the card is a recursion payoff over THEIR graveyard fills -- an edict you cast feeds it. Two
  // sentences, two clauses, so it is read off the card text. The replacement alone is Leyline of
  // the Void (hate, no payoff), which `replacementOf` refuses on purpose. Two corpus cards.
  if (OPP_GRAVEYARD_TAKER.test(cardText) && PLAYS_WHAT_IT_EXILED.test(cardText)) {
    abilities.push({
      kind: "static", repeats: "continuous",
      effect: { kind: "graveyard-recursion", subject: { control: "opp", token: null, zone: "graveyard" }, intercepted: true },
    });
  }
  // THE USE IN ANOTHER SENTENCE (#729, owner ruling 2026-10-09). Espers to Magicite exiles every
  // opponent's graveyard in one sentence and copies a creature card "exiled this way" in the next;
  // Hedonist's Trove exiles one in a trigger and plays "cards exiled with this enchantment" in two
  // static clauses. `actionEffectKind` sees one clause at a time, so the hate stays and the use is
  // added here: the card is BOTH, and the recursion over their yard is what joins an opponent mill.
  // Only when no clause already derived the opponent recursion.
  if (OPP_YARD_EXILED_THEN_USED.test(cardText)
    && !abilities.some((a) => a.effect.kind === "graveyard-recursion" && a.effect.subject?.control === "opp")) {
    const type = cardText.match(/\btarget (\w+) card exiled this way\b/i)?.[1]?.toLowerCase();
    abilities.push({
      kind: "static", repeats: "continuous",
      effect: { kind: "graveyard-recursion", subject: { control: "opp", token: null, ...(type ? { type } : {}), zone: "graveyard" } },
    });
  }
  // "THIS CREATURE ENTERS PREPARED" IS ITS OWN ENTRY PREPARING IT (CR 722.3a; owner ruling 2026-09-27:
  // "blink synergizes with creatures that enter prepared"). The clause is static and emits `prepared`
  // on the card itself; read as a self-entry trigger, a flicker re-entering it joins through the same
  // self-ETB path every other ETB creature uses, and nothing else changes.
  for (let i = 0; i < abilities.length; i++) {
    const a = abilities[i]!;
    if (a.trigger || a.clause === undefined || !ENTERS_PREPARED.test(clauseTexts?.[a.clause] ?? "")) continue;
    if (!(a.emits ?? []).some((e) => e.verb === "prepared" && e.subject.self === true)) continue;
    abilities[i] = { ...a, kind: "triggered", repeats: "once", trigger: { verbs: ["enters"], subject: { control: "you", token: null, self: true } } };
  }
  if (POLYMORPH_REVEAL.test(cardText)) {
    // A TUCK HAS NO EMIT OF ITS OWN (Proteus Staff puts the creature on the bottom of the library), so
    // the creature traded away is stated here, on the ability that puts the new one down.
    for (const a of abilities) {
      const clause = clauses.find((c) => c.id === a.clause);
      const tucks = (clause?.actions ?? []).some((x) => x.verb === "put" && x.fromZone === "battlefield" && x.toZone === "library");
      const removes = (a.emits ?? []).some((e) => e.verb !== "enters" && POLYMORPH_VERBS.has(e.verb));
      if (tucks && !removes && (a.emits ?? []).some((e) => e.verb === "enters" && e.subject.fromZone === "library")) {
        a.emits = [...(a.emits ?? []), { verb: "leaves", subject: { control: "you", token: null, type: "creature", scope: "target" } }];
      }
    }
    for (const e of abilities.flatMap((a) => a.emits ?? [])) {
      const types = Array.isArray(e.subject.type) ? e.subject.type : [e.subject.type];
      if (POLYMORPH_VERBS.has(e.verb) && e.subject.self !== true && types.includes("creature")) e.subject.control = "you";
    }
  }
  // A TWIN IS DROPPED ONLY WHEN IT SAYS NOTHING ITS PARTNER DOES NOT: same trigger, same effect kind, and every emit (verb, type, subtype, counter, self) is on one
  // of the partner's abilities of that trigger. A twin carrying more (Champions of the Shoal's `taps` emit, Borborygmos' typed `discard land`) stays, re-homed.
  // CEILING: a cue heuristic -- a twin is "the same verb already claimed on that sentence", and a re-homed record is "the one orphan sentence that
  // prints its cue". A card whose record numbering drifts in a way neither sees keeps its stored trigger over the sentence its own text prints.
  const spliced = new Set<number | string>();
  /** The textless twins the identical-twin fold removed (a subset of `spliced`), each with its covering clause; `deriveMana` must not rebuild their lines from the clause's actions (#1376). */
  const folded = new Map<number | string, number | string>();
  if (identicalTwinOf.size > 0) {
    // `b` COVERS `a` when they are the same ability apart from the clause, and `b`'s amount / count COVERS `a`'s: removing `a` then loses nothing (a twin that is POORER than its covering
    // clause, as the grammar's reading of Dusk Urchins' blocks half is, is covered; a RICHER one is never). COMPARE THE VALUES, NOT THEIR PRESENCE (#1380): "1" beside "2" was folded and the
    // "1" lost. An amount is covered when absent on the twin, or equal after case and punctuation are dropped (sign kept), or the twin plus a trailing "where X is ..." (Mana-Charged Dragon's "X/0"
    // beside "+X/+0, where X is ..."), or the twin as the whole of that explanation (Freelance Muscle). Never a sub-run: "1" is not covered by "+1/+1". A count is covered
    // when absent on the twin or equal. See `amountCovered`.
    const sameAbility = (a: Ability, b: Ability): boolean => abilityKey(a) === abilityKey(b) && amountCovered(a.amount, b.amount) && countCovered(a.count, b.count);
    // ALL OR NOTHING PER CLAUSE (#1373 review): a textless clause is folded only when EVERY one of its abilities has an exact match among its covering clause's, so a fold is
    // always a pure removal. A per-ability fold dropped Velukan Dragon's identical dice-rolled copy while its pump (read without the covering clause's comma) stayed.
    for (const [twin, covering] of identicalTwinOf) {
      const mine = abilities.filter((a) => a.clause === twin);
      const theirs = abilities.filter((b) => b.clause === covering);
      if (mine.length === 0 || !mine.every((a) => theirs.some((b) => sameAbility(a, b)))) continue;
      for (let i = abilities.length - 1; i >= 0; i--) if (abilities[i]!.clause === twin) abilities.splice(i, 1);
      spliced.add(twin);
      folded.set(twin, covering);
    }
  }
  if (twinOf.size > 0) {
    const emitKey = (e: { verb: string; subject: SubjectFilter }): string => [e.verb, JSON.stringify(e.subject.type ?? null), e.subject.subtype ?? "", e.subject.counter ?? "", e.subject.self ?? ""].join("|");
    const verbsKey = (a: Ability): string => (a.trigger?.verbs ?? []).join(",");
    const redundant = (a: Ability, partnerId: number | string): boolean => abilities.some((b) => b !== a && b.clause === partnerId && verbsKey(b) === verbsKey(a)
      && b.effect.kind === a.effect.kind && (a.emits ?? []).every((e) => (b.emits ?? []).some((f) => emitKey(f) === emitKey(e))));
    for (let i = abilities.length - 1; i >= 0; i--) {
      const a = abilities[i]!;
      const partnerId = a.clause !== undefined ? twinOf.get(a.clause) : undefined;
      // SILENT BY DESIGN (#1299): `redundant` proves the partner clause's ability already says all of this one does.
      if (partnerId !== undefined && redundant(a, partnerId)) { abilities.splice(i, 1); spliced.add(a.clause!); }
    }
  }
  return { abilities, unclaimed: unclaimedHere.map((u) => u.action), unclaimedAt: unclaimedHere.map((u) => unclaimedRecord(u.clause, u.action)), unknownTriggers, twinOf, spliced, folded };
}
const POLYMORPH_VERBS: ReadonlySet<string> = new Set(["dies", "exiled", "leaves", "enters"]);

/** "If a card ... would be put into an opponent's graveyard from anywhere, exile it instead." */
const OPP_YARD_EXILED_THEN_USED = /\bexile (?:each|target) opponent'?s? graveyard\b[\s\S]*?(?:\bcopy of that card\b|\b(?:play|cast) [^.]*?\bfrom among cards exiled with\b)/i;
const OPP_GRAVEYARD_TAKER = /\bwould be put into an opponent's graveyard\b[^.]*\bexile\b/i;
/** Valgavoth: "you may play cards exiled with Valgavoth"; Dauthi Voidwalker: "Choose an exiled card
 *  an opponent owns with a void counter on it. You may play it". */
const PLAYS_WHAT_IT_EXILED = /\bplay cards exiled with\b|\ban exiled card an opponent owns\b/i;

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
  /** Clause id -> the face that clause is printed on, straight from `segment()`. Same shape and
   *  same reason as `clauseTexts`: deterministic, so recomputed rather than stored. Absent leaves
   *  every ability faceless, which is what every single-face card wants anyway. */
  clauseFaces?: Record<number, number>;
  /** Clause id -> the game-state requirement its printed ability word carries (`markers.ts`). */
  clauseRequires?: Record<number, Requirement>;
  /** Clause id -> the clause's activation cost, straight from `segment()`. Same shape and same
   *  reason as `clauseTexts`: free to recompute, so nothing is stored. `repeatsFor` reads this, not
   *  `clauseTexts`, for the self-sacrifice and tap-cost rules -- the cost is split OUT of the body
   *  text by `segment.ts`'s `classify()`, so it never appears in `clauseTexts`. */
  clauseCosts?: Record<number, string>;
  /** The card's printed oracle text, read ONLY by the phantom-trigger guard. Absent disables it. */
  oracleText?: string;
  /** Clause ids granted to a token the same clause creates, from `segment.ts`'s `grantedToOwnToken`.
   *  Same free-to-recompute contract as `clauseTexts`; absent disables the guard. */
  grantedToken?: ReadonlySet<number>;
  /** Clause id -> the grammar's own trigger and action readings (G-T3, F2), from
   *  `grammarClauseRecords`'s `GrammarRecords.readings` -- set only when `clauses` IS that function's
   *  own `records` (the grammar path, `derive-worker.ts` / `derive-corpus.ts`). `withGrammarActions`
   *  and `grammarTriggersOf` use the entry for a clause instead of calling `parseActions` /
   *  `parseTrigger` again when it is present; absent (the model path) parses as before. */
  readings?: Record<number, { trigger?: TriggerReading[]; actions?: ActionReading[] }>;
  /** Granted clause id -> the clause that grants it (`segment()`'s `parentId` on a `granted` clause): Chromatic Lantern's
   *  quoted "{T}: Add one mana of any color" -> "Lands you control have that ability". Read by `manaLines`. */
  clauseGrants?: Record<number, number>;
  /** Clause ids that are a modal spell's or ability's header, from `segment()` (`modalHeaderIds`): the `face-a-dilemma` event is emitted from each, once (Star Trek, #1349). */
  modalHeads?: ReadonlySet<number>;
  /** The printed mana cost of each face, index = face, "" when it prints none (Mox Tantalite). Read by `manaLines` for the
   *  cost of a spell and for `suspendOnly`. Absent: only `characteristics.cmc` is known. */
  manaCosts?: string[];
  /** The printed starting loyalty of each face (index = face, null for a face with none), from the card document (`faceLoyalties`). Read by `manaLines`. */
  startLoyalty?: (number | null)[];
}

/** A SELF "YOU LOSE THE GAME" ABILITY CLAIMS NOTHING (#1252, #1264): emits non-empty and every one a `loses-game` of
 *  `control: "you"`. A reason already set stands -- a refused trigger keeps "refused-trigger" (the matcher's precedence). */
/** A RIDER OF AN ACTIVATED MANA ABILITY CLAIMS NOTHING (#1423, #1426, `Ability.claimsNothing` "mana-rider"): Cinder Marsh's "This land doesn't untap during your next untap step" and Llanowar Wastes'
 *  "This land deals 1 damage to you" share the clause of their `{T}: Add ...`. CR 605.1a: an activated ability that adds mana, needs no target, is no loyalty ability and its cost and effect move no
 *  card to or from a library IS a mana ability, and everything the one printed ability does is part of it; CR 605.3b: it never uses the stack, so it cannot be targeted or copied. The engine models the
 *  rider as a second `activated` ability, which a copier would be offered (`copies:activated`). Stamped on any ability that is not itself mana-generation, shares the clause, face AND activation cost of a
 *  mana-generation ability. The WHOLE group is refused (no member stamped, it is a copyable ability) when anything in it targets (Deathrite Shaman, Soulbright Flamekin), is a loyalty ability, or moves a
 *  card to or from a library (CR 605.1a: a draw or mill in the effect -- Chromatic Sphere, the Eggs, Selvala -- or a mill in the cost -- Millikin, Deranged Assistant, Charmed Pendant).
 *  EXEMPT: a draw in a DELAYED triggered ability (CR 603.7a: created during resolution, so not the ability's own effect; the mana-ability rules say nothing of it) -- Astrolabe's and Barbed Sextant's "Draw a card at the
 *  beginning of the next turn's upkeep" -- when every sentence naming a draw / mill / search opens a delayed trigger ("at the beginning of").
 *  The rider's emits stay (the damage still happens). A reason already set stands.
 *  CEILING: ACTIVATED only. A triggered mana ability is one only when it triggers from mana (CR 605.1b), and Carnival of Souls' "Whenever a creature enters, you lose 1 life and add {B}" does not, so the
 *  trigger would have to be read first; no triggered rider is stamped. A target is read off the clause's printed text (`target`) and `scope: "target"` subjects, either one refuses; a clause with two
 *  printed abilities and a target in the other is left unstamped. */
const LIBRARY_KINDS: ReadonlySet<string> = new Set(["draw-card", "mill", "search"]);
const LIBRARY_VERBS: ReadonlySet<string> = new Set(["draw", "mill", "search"]);
const targetsAnything = (a: Ability, printed: string): boolean =>
  /\btargets?\b/i.test(printed) || a.effect.subject?.scope === "target" || (a.emits ?? []).some((e) => e.subject?.scope === "target");
/** CR 605.1a's library criterion: the group's cost or effect moves a card to or from a library, unless every effect sentence that does is a delayed trigger (CR 603.7a). */
const movesLibraryCard = (group: readonly Ability[], printed: string): boolean => {
  if (group.some((o) => /\b(?:mill|library|draw|search)/i.test(o.cost ?? ""))) return true;
  if (!group.some((o) => LIBRARY_KINDS.has(o.effect.kind) || (o.emits ?? []).some((e) => LIBRARY_VERBS.has(e.verb)))) return false;
  const movers = printed.split(/\.\s/).filter((sentence) => /\b(?:draws?|mills?|search)/i.test(sentence));
  return movers.length === 0 || movers.some((sentence) => !/\bat the beginning of\b/i.test(sentence));
};
export function stampManaRider(a: Ability, all: readonly Ability[], clauseTexts?: Record<number, string>): Ability {
  if (a.claimsNothing !== undefined || a.kind !== "activated" || a.effect.kind === "mana-generation") return a;
  const group = all.filter((o) => o.kind === "activated" && o.clause === a.clause && o.face === a.face && o.cost === a.cost);
  const printed = a.clause === undefined ? "" : clauseTexts?.[Math.trunc(Number(a.clause))] ?? "";
  return group.some((o) => o.effect.kind === "mana-generation")
    && !group.some((o) => o.payment?.loyalty !== undefined || targetsAnything(o, printed))
    && !movesLibraryCard(group, printed)
    ? { ...a, claimsNothing: "mana-rider" as const } : a;
}
export function stampSelfLoss(a: Ability): Ability {
  const emits = a.emits ?? [];
  return a.claimsNothing === undefined && emits.length > 0 && emits.every((e) => e.verb === "loses-game" && e.subject.control === "you")
    ? { ...a, claimsNothing: "self-loss" as const } : a;
}
/** Assemble the full CardTags document the matcher consumes. `characteristics` is printed data read
 *  from the card document -- derivation never asks a model for what the database already knows. */
/** `deriveAbilities` called the way `deriveCardTags` calls it. Exported so an instrument reads `twinOf` (which clause a spliced twin
 *  was folded into) from the SAME run, not a re-implementation of the twin detection. */
export function deriveAbilitiesOf(input: DeriveInput, opts: { collapseZoneSearches?: boolean } = {}): ReturnType<typeof deriveAbilities> {
  const chars = input.characteristics;
  const castAtInstantSpeed = chars.types.some((t) => t.toLowerCase() === "instant")
    || (chars.keywords ?? []).some((k) => k.toLowerCase() === "flash");
  return deriveAbilities(
    input.clauses, input.name, input.clauseTexts, input.clauseCosts, input.oracleText, input.grantedToken,
    input.clauseFaces, castAtInstantSpeed, input.clauseRequires, input.readings,
    chars.subtypes.some((t) => t.toLowerCase() === "curse"), chars.types.some((t) => t.toLowerCase() === "creature"), input.clauseGrants, input.modalHeads, opts.collapseZoneSearches !== false);
}
/** THE UNION MAKES THE TWINS (#1391): derive makes one ability per action and every keyword-grant /
 *  speed-increase ability carries the UNION of its clause's grant-ability actions, so two grants on one
 *  subject and trigger (Colossus of Akros' trample + "can attack as though it didn't have defender";
 *  Silverquill Pledgemage's flying + lifelink, once per trigger reading) came out JSON-identical. Keeps
 *  the first of each. The JSON includes `clause`, so a global pass equals a per-clause one. Only these
 *  two kinds. CEILING: grants that differ by trigger reading stay, each still carrying the clause's union.
 *  Run LAST (`deriveCardTags`), and by `deriveRow` on the tags the card-by-card switch picked: the
 *  switch itself compares UNFOLDED readings. */
export function foldGrantTwins(abilities: Ability[], clauseTexts?: Record<number, string>): Ability[] {
  const seen = new Set<string>();
  const once = abilities.filter((a) => {
    const k = a.effect?.kind;
    if (k !== "keyword-grant" && k !== "speed-increase" && !(a.clause !== undefined && hasInstead(clauseTexts?.[Math.trunc(Number(a.clause))]))) return true;
    const key = stableJson(JSON.parse(JSON.stringify(a)));
    return !seen.has(key) && !!seen.add(key);
  });
  return foldRepeatedVerbTwins(once, clauseTexts);
}
/** The printed word forms of the verbs `foldRepeatedVerbTwins` can count. A verb absent from this table is never folded (a missing fold beats a wrong one). */
const TWIN_VERB_FORMS: Record<string, readonly string[]> = {
  sacrifice: ["sacrifice", "sacrifices", "sacrificed", "sacrificing"],
  copy: ["copy", "copies", "copied", "copying"],
  shuffle: ["shuffle", "shuffles", "shuffled", "shuffling"],
};
/** A word before "copy" / "sacrifice" / "shuffle" that makes it a NOUN ("for the copy", "a copy of"): not a second printed action. */
const NOUN_MARKERS: ReadonlySet<string> = new Set(["the", "a", "an", "that", "this", "its", "their", "your", "his", "her", "each", "new", "another", "any", "one"]);
/** How many times the clause text prints `verb` as a verb. Words are scanned, not matched by pattern. A word after a determiner or a possessive is a noun and does not count; an
 *  ambiguous word ("two copies") counts, which can only make a fold rarer. */
function printedVerbCount(text: string, verb: string): number {
  const forms = TWIN_VERB_FORMS[verb]!;
  const words = text.replace(/\([^()]*\)/g, " ").toLowerCase().split(/[^a-z']+/).filter((w) => w !== "");
  let n = 0;
  for (let i = 0; i < words.length; i++) {
    if (!forms.includes(words[i]!)) continue;
    const prev = i > 0 ? words[i - 1]! : "";
    if (NOUN_MARKERS.has(prev) || prev.endsWith("'s") || prev.endsWith("s'")) continue;
    n++;
  }
  return n;
}
/** A bought record that writes ONE printed action twice (Chimeric Coils' two sacrifices, Ether's two copies, Thunderous Debut's and Phyrexian Portal's two shuffles; #1401 family B) derives
 *  JSON-identical abilities in one clause. They fold to as many as the clause's printed text names the verb (`printedVerbCount`), keeping the first ones. A repeat the text prints
 *  (This Is How It Ends' two shuffles) stays.
 *  CEILING: only the verbs in `TWIN_VERB_FORMS`; an ability counts when exactly one of its emits is such a verb; a clause that prints the verb zero times (another spelling) folds nothing. */
function foldRepeatedVerbTwins(abilities: Ability[], clauseTexts?: Record<number, string>): Ability[] {
  if (!clauseTexts) return abilities;
  const groups = new Map<string, number[]>();
  const verbOf = new Map<string, string>();
  abilities.forEach((a, i) => {
    if (a.clause === undefined) return;
    const verbs = (a.emits ?? []).map((e) => e.verb).filter((v) => v in TWIN_VERB_FORMS);
    if (verbs.length !== 1) return;
    const key = stableJson(JSON.parse(JSON.stringify(a)));
    verbOf.set(key, verbs[0]!);
    groups.set(key, [...(groups.get(key) ?? []), i]);
  });
  const drop = new Set<number>();
  for (const [key, idx] of groups) {
    if (idx.length < 2) continue;
    const text = clauseTexts[Math.trunc(Number(abilities[idx[0]!]!.clause))];
    if (text === undefined) continue;
    const printed = printedVerbCount(text, verbOf.get(key)!);
    if (printed >= 1 && printed < idx.length) for (const i of idx.slice(printed)) drop.add(i);
  }
  return drop.size === 0 ? abilities : abilities.filter((_, i) => !drop.has(i));
}
/** A clause whose printed text says "instead" or "your choice of" OUTSIDE its reminder text (#1391 F4, F6: Primal Clay's "it becomes your choice of A, B, or C", one animate action per alternative on the grammar path): an alternative branch ("If this spell was kicked, instead search ...", "If you would create a Clue, Food, or Treasure token, instead
 *  create one of each") that derives an ability JSON-identical to the base branch's is one either/or effect, folded like a grant twin. `segment()` already drops reminder text (Wicked Slumber's "(... remove one from it
 *  instead.)" never reaches a clause text, and its two stun counters are a real repeat); parenthesised text is stripped here too, for a text handed in directly.
 *  CEILING: only an IDENTICAL twin folds; a branch that differs (Grow from the Ashes' two basic lands against one, a kicked amount) stays, and the alternative still counts as a second ability. An "instead"
 *  inside a quoted granted ability is not excluded (15 corpus cards, none with an identical twin at 406). */
const hasInstead = (text: string | undefined): boolean => text !== undefined && /\b(?:instead|your choice of)\b/i.test(text.replace(/\([^()]*\)/g, ""));
export function deriveCardTags(input: DeriveInput, opts: { foldGrantTwins?: boolean; collapseZoneSearches?: boolean } = {}): CardTags {
  const chars = input.characteristics;
  const derived = deriveAbilitiesOf(input, opts);
  const { unknownTriggers, unclaimedAt } = derived;
  // AN AURA ON AN OPPONENT'S CREATURE WATCHES THE OPPONENT'S CREATURE (owner 2026-09-23, AN7).
  // Nurgle's Rot prints "Enchant creature an opponent controls / When enchanted creature dies": the
  // clause subject "enchanted creature" carries no controller and derived `you`, so the report
  // claimed "When Viscera Seer dies, Nurgle's Rot triggers". The Enchant line is the only place the
  // side is printed. Only `opp` is taken from it: "Enchant creature" can go on either side, and
  // whether that host is yours is an open ruling (One with the Kami), not a derive fact.
  // Text through `textForClause`, which recovers a normalizer-split clause's sentence (a "2.1" id
  // the segmenter never produced), and past a printed ability-word label.
  const clauseById = new Map(input.clauses.map((c) => [c.id as number | string, c] as const));
  const abilities = chars.enchants?.control !== "opp" ? derived.abilities : derived.abilities.map((a) => {
    const clause = a.clause !== undefined ? clauseById.get(a.clause) : undefined;
    const text = clause ? withoutAbilityWord(textForClause(clause, input.clauseTexts)) : "";
    return a.trigger && /^(?:when|whenever)\s+enchanted\s/i.test(text)
      ? { ...a, trigger: { ...a.trigger, subject: { ...a.trigger.subject, control: "opp" as const } } }
      : a;
  });
  // A BACKGROUND'S GRANT IS THE COMMANDER'S ABILITY (DERIVE 179, #625). "Commander creatures you own
  // have '...'" hands every clause after the grant to your commander, so each "this creature" / "it"
  // in them is the commander -- 26 Backgrounds read it as the Background itself, and Haunted One's
  // "whenever this creature becomes tapped" waited on an enchantment that never taps. And "other
  // creatures you control that share a creature type with it" is the commander's types (#559's
  // mechanism, on an effect this time). CEILING: card-scoped, which holds because a Background's
  // only text outside the quotes is the grant sentence itself.
  // ENFORCED, not assumed: all 26 corpus matches are Backgrounds with nothing outside the quotes
  // (measured 2026-09-27), and the subtype check keeps a future card that is not from rewriting its
  // own self-references.
  const grantsToCommander = GRANTED_TO_COMMANDER.test(input.oracleText ?? "")
    && chars.subtypes.some((x) => x.toLowerCase() === "background");
  const COMMANDER: SubjectFilter = { control: "you", token: null, type: "creature", commander: true };
  const toCommander = (sub: SubjectFilter): SubjectFilter => {
    if (sub.self !== true) return sub;
    const { self: _self, ...rest } = sub;
    return { ...rest, ...COMMANDER };
  };
  const hosted = !grantsToCommander ? abilities : abilities.map((a) => {
    const clause = a.clause !== undefined ? clauseById.get(a.clause) : undefined;
    const text = clause ? textForClause(clause, input.clauseTexts) : "";
    const sharesWithIt = /\bshares? a creature type with it\b/i.test(text);
    const effectSubject = a.effect.subject
      // The printed class is "other creatures YOU CONTROL that share a creature type with it"; a subject
      // the parser left broad (Haunted One's undying grant: `control: any`, no type) gets that floor.
      ? (sharesWithIt && a.effect.subject.self !== true
        ? { ...a.effect.subject, type: a.effect.subject.type ?? "creature", control: a.effect.subject.control === "any" ? "you" as const : a.effect.subject.control, sharesTypeWith: "commander" as const }
        : toCommander(a.effect.subject))
      : undefined;
    return {
      ...a,
      ...(a.trigger ? { trigger: { ...a.trigger, subject: toCommander(a.trigger.subject) } } : {}),
      effect: effectSubject ? { ...a.effect, subject: effectSubject } : a.effect,
      ...(a.emits ? { emits: a.emits.map((e) => ({ ...e, subject: toCommander(e.subject) })) } : {}),
    };
  });
  // THE CARD'S OWN CREATURE TYPES, pinned here where the characteristics are known (#559). A card
  // with none keeps the marker, which matches nothing: silence over "any creature".
  // CREATURE FACES ONLY: `subtypes` is the union over every face, and a creature // land's land type
  // is not a creature type the card can share.
  const creatureFaces = (chars.faces ?? [{ types: chars.types, subtypes: chars.subtypes }])
    .filter((f) => f.types.some((t) => t.toLowerCase() === "creature"));
  const own = [...new Set(creatureFaces.flatMap((f) => f.subtypes.map((x) => x.toLowerCase())))];
  const pinned = own.length === 0 ? hosted : hosted.map((a) => a.trigger?.subject.sharesTypeWith !== "self" ? a : {
    ...a,
    trigger: { ...a.trigger, subject: (({ sharesTypeWith: _s, ...rest }) => ({ ...rest, subtype: own }))(a.trigger.subject) },
  });
  // AN INSTANT OR SORCERY IS GONE ONCE IT RESOLVES (#803): what it sets up -- Undying Malice's
  // granted "when this creature dies, return it" -- happens once, not every time. Its on-cast effect
  // is already once. CEILING: a spell that comes back (rebound, buyback) repeats and is read once.
  // ON THE ABILITY'S OWN FACE (review): an adventure or modal DFC unions its faces' types, and
  // Bonecrusher Giant's creature trigger is no spell's. A face that is not playable (a transform
  // back) has no entry in `faces` and is never read as a spell.
  const isSpellFace = (face: number | undefined): boolean =>
    (chars.faces ? chars.faces[face ?? 0]?.types ?? [] : chars.types).some((t) => /^(?:instant|sorcery)$/i.test(t));
  const spellOnce = pinned.map((a) => a.kind === "on-cast" || a.repeats === "once" || !isSpellFace(a.face) ? a : { ...a, repeats: "once" as const })
    // A SELF "YOU LOSE THE GAME" ABILITY CLAIMS NOTHING (#1252, #1264), decided on the FINAL emits: every control fill above has run.
    .map(stampSelfLoss)
    .map((a, _i, all) => stampManaRider(a, all, input.clauseTexts))
    // THE CLAUSE THAT GRANTS A QUOTED ABILITY (#1315): `segment()`'s granted clause and its parent, from `DeriveInput.clauseGrants` (both clause sources).
    .map((a) => { const by = a.clause !== undefined ? input.clauseGrants?.[a.clause as number] : undefined; return by === undefined ? a : { ...a, grantedBy: by }; });
  // A CREATURE ONLY UNDER A CONDITION (#797): the action grammar reads "As long as your devotion to red
  // is less than five, Purphoros isn't a creature" as the card itself that "can't be a creature".
  // Read off the printed text, which reaches the Theros gods the store filed as something else.
  const creatureOnlyIf = chars.types.some((t) => t.toLowerCase() === "creature") && input.clauses.some((c) =>
    c.abilityType === "static" && parseActions(effectText(textForClause(c, input.clauseTexts), input.name ?? ""), "static")
      .some((r) => r.verb === "cant" && r.object?.self === true && /^be a creature\b/i.test(r.text ?? "")));
  return {
    oracleId: input.oracleId,
    schemaVersion: 1,
    // WARNING: 0 will never equal PROMPT_VERSION (llm/prompt.ts), so `needsRetag`
    // would see any persisted derived doc as permanently stale and re-queue it for LLM tagging
    // forever. Fine while derivation is not yet wired into the persistence path -- revisit this
    // the moment it is.
    promptVersion: 0,
    model: "derived",
    characteristics: creatureOnlyIf ? { ...input.characteristics, creatureOnlyIf: true } : input.characteristics,
    abilities: opts.foldGrantTwins === false ? spellOnce : foldGrantTwins(spellOnce, input.clauseTexts),
    // MANA PRODUCTION, read once (#1169). Each key is written only when the card has it.
    ...deriveMana({
      clauses: input.clauses, abilities: spellOnce, chars, name: input.name, foldedClauses: derived.folded,
      textOf: (clause) => withoutAbilityWord(textForClause(clause, input.clauseTexts)),
      ...(input.clauseCosts ? { clauseCosts: input.clauseCosts } : {}),
      ...(input.clauseFaces ? { clauseFaces: input.clauseFaces } : {}),
      ...(input.clauseGrants ? { clauseGrants: input.clauseGrants } : {}),
      ...(input.grantedToken ? { grantedToken: input.grantedToken } : {}),
      ...(input.manaCosts ? { manaCosts: input.manaCosts } : {}),
      ...(input.oracleText ? { oracleText: input.oracleText } : {}),
      ...(input.startLoyalty ? { startLoyalty: input.startLoyalty } : {}),
    }),
    // Written only when there is something to surface, so a clean card stays byte-identical.
    ...(unknownTriggers.length ? { unknownTriggers } : {}),
    ...(unclaimedAt.length ? { unclaimed: unclaimedAt } : {}),
  };
}
