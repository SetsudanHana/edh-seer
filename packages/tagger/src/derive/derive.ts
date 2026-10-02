/** Canonical clauses to the Ability[] the engine already consumes. Pure: no model, no database.
 *
 *  One Ability per ACTION rather than per clause, because effect.kind is singular and a drain has
 *  to register on both the lifeloss and the lifegain axis. An action that yields neither a kind nor
 *  an emit is returned in `unclaimed` instead of vanishing -- a dropped clause that produces
 *  silence is indistinguishable from a card that does nothing, which is exactly how Bitterblossom
 *  sat in the corpus as a vanilla bear. */
import type { Action, ClauseRecord } from "../canonicalize.js";
import type { Ability, Requirement, AbilityKind, CardTags, Characteristics, Control, SubjectFilter, Verb } from "../schema.js";
import { VERB_ALIASES, VERB_VOCAB } from "../schema.js";
import { ZONE_SCOPED_KINDS, actionEffectKind, bounceOrigin, exilesOwnGraveyard, extraPhaseName, extraLoyalty, playsFromTop } from "./effect-kind.js";
import { actionEmits, casualtySacrifice, LEAVES_SAME_TURN, TEMPORARY_TOKEN_REF } from "./emits.js";
import { interveningIfOf, conditionCares as conditionCares_ } from "./intervening-if.js";
import { requiresOf } from "./markers.js";
import { actionRecipients, sentenceNamesAPlayer } from "./recipient.js";
import { actionScaling, scalingSubject } from "./scaling.js";
import { namesAClass, parseSubject, parseCounter } from "./subject.js";
import { parse as parseFilter } from "../grammar/filter.js";
import { selfAsTilde } from "../grammar/self-as-tilde.js";
import { effectText, printedPreamble } from "../grammar/preamble.js";
import { alignVerbs, parseActions } from "../grammar/action.js";
import { parseTrigger, type TriggerReading } from "../grammar/trigger.js";
import { delayedTriggerRepeats, repeatsFor, withoutAbilityWord, type RawTrigger } from "./repeats.js";
import { replacementOf } from "./replacement.js";
import { countOf } from "./event-count.js";
import { reductionOf } from "./reduction.js";
import crKeywords from "./cr-keywords.json" with { type: "json" };
import { paymentOf } from "./payment.js";
import { doubledVerbs, doublesOf } from "./doubles.js";
import { thresholdFor, thresholdSubjectFor } from "./threshold.js";
import { eventAmountFor } from "./event-amount.js";
import { SUBTYPES } from "./subtypes.js";
import { isSelfSubject, SELF_REFERENCE, withoutArticle } from "./self-reference.js";
import { antecedentIsSelf as selfAntecedent, antecedentSource, antecedentText, boundedByEnchantLine, exiledAcrossClauses, PRONOUN_OBJECT, zoneAfterEvent } from "./references.js";
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
export const DERIVE_VERSION = 263;

/** "Whenever another creature you control attacks, IT gains trample" (Stonehoof Chieftain): a grant
 *  to the triggering object. "they" covers the batched "one or more creatures ... attack". */
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

export function manaAdded(object: string): number | undefined {
  if (/\bfor each\b|\bequal to\b|\bthat m(?:any|uch)\b|\bnumber of\b|\bX\b|\{E\}|\bE\b/.test(object)) return undefined;
  const counts = object.split(/\s*,?\s+or\s+/i).map((alt) => {
    const symbols = (alt.match(/\{[WUBRGC](?:\/[WUBRGCP])?\}/gi) ?? []).length;
    if (symbols > 0) return symbols;
    const word = /\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+mana\b/i.exec(alt)?.[1]?.toLowerCase();
    return word ? NUMBER_WORD[word] : undefined;
  });
  if (counts.some((n) => n === undefined)) return undefined;
  return Math.min(...(counts as number[]));
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
  const onIt = re.onIt.test(text) && !OTHER_OBJECT.test(text)
    && (triggerIsSelf || /^this (?:creature|permanent|artifact|enchantment|land|planeswalker|vehicle)\b/i.test(text));
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
  if (!ANTECEDENT_CONTROLLER.test(cardText) || !FROM_THEIR_LIBRARY.test(cardText)) return false;
  return !/under your control/i.test(cardText) && !/your librar(?:y|ies)/i.test(cardText);
}

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
    // AN ARTICLE IS NOT A NAME (DERIVE 172): "The Sackville-Bagginses" shortens by dropping "The",
    // and taking "The" as the short form deleted every "the" in the card's clause text.
    forms.add(withoutArticle(face));
    const first = face.split(/\s+/)[0];
    if (!SUBTYPES.has(first.toLowerCase()) && withoutArticle(face) === face) forms.add(first);
  }
  let out = text;
  for (const f of [...forms].filter((f) => f !== "").sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ");
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
  const text = objects.map(withoutQuotedAbilities).join(" ").toLowerCase();
  return KEYWORD_ABILITIES.filter((k) => new RegExp(`(?:^|[^a-z])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z])`).test(text)).sort();
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

function effectSubject(
  action: Action, kind: string, triggerIsSelf = false, clauseText = "", cardName?: string, cardText = "",
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
  if (kind === "ability-loss") {
    const who = recipientBefore(clauseText, LOSES_ABILITIES);
    return who && !UNEXPRESSIBLE_NARROWING.test(who) ? parseSubject(who) : parseSubject("");
  }
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
  const subject = subjectFrom(self ? self[0] : countTruncated(object), cardName, cardText);
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
 *  Every name is a `VERB_VOCAB` member (blocking has no verb; the transform verb is `transform`). */
const PERMANENT_EVENT_VERBS: ReadonlySet<string> = new Set([
  "dies", "enters", "leaves", "attacks", "taps", "untaps", "counter-added", "counter-removed",
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
const THAT_TYPED = /^(?:that|those) [a-z][a-z ]*$/i;
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
const DELAYED_RETURN = /\b(?:return|put)\b[^.]{0,120}?\bat the beginning of (?:the|your) next (?:end step|upkeep)\b|\bat the beginning of (?:the|your) next (?:end step|upkeep), (?:return|put)\b/i;
/** The sentence of `text` holding the k-th (0-based) whole-word `verb`; "" when there are fewer. */
function nthSentenceWith(text: string, verb: string, k: number): string {
  const word = new RegExp(`\\b${verb}\\b`, "gi");
  let seen = 0;
  for (const sentence of text.split(".")) {
    const n = (sentence.match(word) ?? []).length;
    if (seen + n > k) return sentence;
    seen += n;
  }
  return "";
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
/** "leave the battlefield WITHOUT DYING" (Dour Port-Mage), "if it didn't die" (Taeko): a `leaves`
 *  demand that refuses a death. 5 corpus cards. */
const WITHOUT_DYING = /\bwithout dying\b|\bdidn'?t die\b|\bdoesn'?t die\b/i;

/** "Activate only as a sorcery" (CR 307.5 timing on an activated ability) and its "only during
 *  your turn" cousin: an activation that cannot happen in combat. */
const SORCERY_SPEED = /\bactivate (?:this ability )?only as a sorcery\b|\bonly during your turn\b/i;
/** A loyalty symbol as a cost — "+1", "−3", "0" — the shape `segment.ts` hands over for a
 *  planeswalker ability, which CR 606.3 makes sorcery-speed. */
const LOYALTY_COST = /^[+\u2212-]?(?:\d+|X)$/;

/** "if none of them were cast", "if it wasn't cast", "no mana was spent to cast", "without being
 *  played" — the entry happened by some route other than casting. Card-scoped like every other
 *  printed cue here. */
const ARRIVED_WITHOUT_CASTING =
  /\b(?:wasn't|weren't) cast\b|\bnone of them were cast\b|\bno mana was spent\b|\bwithout being played\b/i;

/** WORDS ABOUT WHEN, NOT WHICH: "your NEXT upkeep", "dies THIS TURN", "this combat". A delayed or
 *  windowed trigger fires on the same class of event, as `oncePerTurn` does; `delayedBy` and
 *  `repeats` say how often. Only the words left after these are a narrowing. */
const TEMPORAL = /\b(?:next|this turn|this combat|each turn)\b/g;

/** Whether derive represents a trigger's intervening if (CR 603.4) or narrowing, so it may claim:
 *  a count (`threshold`), an entry that was no cast (`notCast`), "the first instant spell" (the
 *  class inside the if, #178), "enters tapped" (`entersTapped`), an event amount ("5 or more
 *  damage", `amount`). Anything else refuses the claim (owner, 2026-10-01). */
/** WHERE THE SOURCE IS, not which event: Inalla's eminence "if Inalla is in the command zone or on the
 *  battlefield", "if this card is in your graveyard". The ability only exists where it functions, so
 *  the condition narrows no event a producer supplies. */
const SOURCE_ZONE = /^(?:~|this \w+|it) is (?:in|on) (?:the command zone|the battlefield|your graveyard|exile|your hand)(?: or (?:in|on) (?:the command zone|the battlefield|your graveyard|exile|your hand))?$/i;

/** Guardian Project's "if it doesn't have the same name as another creature you control or a creature
 *  card in your graveyard": `uniqueName` (CR 903.5b; owner, 2026-10-01). */
const SAME_NAME = /^it doesn't have the same name as /i;

function conditionRepresented(condition: string, text: string): boolean {
  return thresholdFor(text) !== undefined || SAME_NAME.test(condition) || ARRIVED_WITHOUT_CASTING.test(condition) || WITHOUT_DYING.test(condition)
    || /\bthe first \w+ spell\b/i.test(condition) || SOURCE_ZONE.test(condition);
}
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
    "airbend", "waterbend", "blight", "behold", "extra-combat", "extra-phase", "trigger-again", "phase-out"].map((v) => [v, "tail"])),
};
const GRAMMAR_ACTION_VERBS: ReadonlySet<string> = new Set(Object.keys(ACTION_FAMILY));
/** Verbs whose OBJECT, on derive's string path, is the player it happens to ("target player mills two
 *  cards" -> object "target player"); see `RECIPIENT_VERBS` in emits.ts. */
const PLAYER_OBJECT_VERBS: ReadonlySet<string> = new Set(["draw", "mill", "discard", "scry", "surveil", "gain-life", "lose-life"]);

/** THE ACTION GRAMMAR WINS (owner, 2026-10-01): a clause's stored actions of a taken-over family are
 *  rewritten from the printed text where the grammar read the phrase completely -- object, amount,
 *  optional, zones and the kept condition. The rest of derive reads the rewritten record exactly as
 *  it read the stored one. CEILING: a phrase the store left out (the "reveal it" of a tutor) is not
 *  ADDED: an inserted action becomes the antecedent of the "it" after it, and the references
 *  resolver (#900) reads the revealed card's class off the text, not off an action. */
function withGrammarActions(clause: ClauseRecord, text: string | undefined, cost: string | undefined, cardName: string | undefined): ClauseRecord {
  if (!text || !clause.actions?.length) return clause;
  const readings = parseActions(effectText(text, cardName ?? ""), clause.abilityType ?? null, cost)
    .filter((r) => GRAMMAR_ACTION_VERBS.has(r.verb));
  if (readings.length === 0) return clause;
  const stored = clause.actions;
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
      : PLAYER_OBJECT_VERBS.has(r.verb) && r.verb !== "gain-life" && r.verb !== "lose-life"
        ? (named ? r.actor!.text : r.actor ? base.object : r.text ?? base.object)
        // The card itself keeps the stored object for the same reason ("sacrifice Endrek Sahr").
        // So does a stored object that is the printed one plus where it came from ("a land card" ->
        // "a land card from among the top four cards of your library", Planar Genesis).
        : (ACTION_FAMILY[r.verb] === "zone" || ACTION_FAMILY[r.verb] === "pump" || ACTION_FAMILY[r.verb] === "tail" || r.verb === "tap" || r.verb === "untap") && (r.object?.self === true || base.object === "~" || /^this\b/i.test(base.object ?? "")
          || (r.text !== undefined && (base.object ?? "").startsWith(`${r.text} from `))) ? base.object
        : r.text ?? base.object;
    out[i] = ({
      ...base,
      ...(object !== undefined ? { object } : {}),
      ...(r.amount !== undefined ? { amount: r.amount } : {}),
      ...(r.fromZone !== undefined ? { fromZone: r.fromZone } : {}),
      ...(r.toZone !== undefined ? { toZone: r.toZone } : {}),
      optional: r.optional === true,
      ...(r.condition ? { condition: r.condition } : {}),
    });
  });
  return { ...clause, actions: out };
}

type GrammarTrigger = { verbs: Verb[]; subject: SubjectFilter } | { refused: string; subject?: SubjectFilter };

function grammarTriggersOf(text: string, cardName: string | undefined, storedEvent: string, cardText: string, enchantText: string, split: boolean): GrammarTrigger[] | null {
  // An Aura's "enchanted permanent" is the class its own face's Enchant line names (see subjectFrom).
  const preamble = printedPreamble(boundedByEnchantLine(text, enchantText), cardName ?? "");
  if (!preamble) return null;
  // The condition with the card's name as "~", as the preamble: "if INALLA is on the battlefield".
  const read = parseTrigger(preamble, interveningIfOf(cardName ? selfAsTilde(text, cardName) : text));
  if (!read) return null;
  const readings = [read].flat();
  // A compound the store SPLIT into one clause per event (Inferno Titan: two clauses, one text) takes
  // the readings of this clause's own event, of which there can be several ("this creature dies OR
  // another artifact you control is put into a graveyard from the battlefield", Scrap Trawler). One
  // the store kept as ONE clause takes every reading: Bilbo's "enters or leaves the battlefield" was
  // a single `enters` clause, and its leave was lost.
  const mine = readings.filter((x) => x.event === storedEvent);
  const chosen = !split ? readings : mine.length > 0 ? mine : [readings[0]!];
  if (chosen.some((r) => r.event === "reflexive")) return null;
  return chosen.map((r) => grammarTriggerFrom(r, text, preamble, cardName, cardText));
}

function grammarTriggerFrom(r: TriggerReading, text: string, preamble: string, cardName: string | undefined, cardText: string): GrammarTrigger {
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
  if (r.condition && !conditionRepresented(r.condition.text, text)) return { refused: `if:${r.event}`, subject };
  if (r.narrowing && !narrowingRepresented(r, text)) return { refused: `narrowing:${r.event}`, subject };
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
  if (subject.sharesTypeWith === "self" && GRANTED_TO_COMMANDER.test(cardText)) subject.sharesTypeWith = "commander";
  return { verbs: [verb], subject };
}

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
): { abilities: Ability[]; unclaimed: Action[]; unknownTriggers: string[] } {
  const abilities: Ability[] = [];
  const unclaimed: Action[] = [];
  const unknownTriggers: string[] = [];
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

  /** What an earlier clause exiled, for "the exiled card" in a later one (#860). */
  let lastExiled: string | undefined;
  for (let clause of clauses) {
    // "THE EXILED CARD" IS WHAT AN EARLIER CLAUSE EXILED (#860): see `exiledAcrossClauses`.
    ({ clause, lastExiled } = exiledAcrossClauses(clause, lastExiled, cardName));
    // The whole clause goes, not just its trigger. What is quoted on a created token is a complete
    // ability -- Vivi's Persistence's Wizard both watches the cast AND deals the damage -- so
    // keeping the effect and dropping the trigger would leave the card claiming to do a thing it
    // never does. The token's own derived row carries both halves.
    if (grantedToken?.has(clause.id)) continue;
    clause = withGrammarActions(clause, clauseTexts?.[clause.id], clauseCosts?.[clause.id], cardName);
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
    if (inherits) clause = { ...clause, trigger: inheritedTrigger };
    else if (!clause.trigger?.event && kind !== "triggered") { inheritedTrigger = undefined; headerTrigger = undefined; }
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
    const clauseText = textForClause(clause, clauseTexts);
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
    const zoneless = (a: { verb?: string; fromZone?: string | null; object?: string }) =>
      !a.fromZone && ZONE_MOVING_VERBS.has(a.verb ?? "") && OBJECT_IN_GRAVEYARD.test(a.object ?? "");
    if ((clause.actions ?? []).some(zoneless)) {
      clause = { ...clause, actions: (clause.actions ?? []).map((a) => zoneless(a) ? { ...a, fromZone: "graveyard" } : a) };
    }
    // A QUOTED GRANT THE MODEL LEFT WITHOUT AN ACTION (#711): Enduring Vitality's `Creatures you
    // control have "{T}: Add one mana of any color."` came back as a static clause with no actions,
    // the quoted ability segmented as a clause of its own -- so nothing said who receives it. The
    // grant is on the text; the recipient gate is the ordinary grant path's.
    // No action, or only the placeholder `none` the canonical record stores (Enduring Vitality's).
    if (clause.abilityType === "static" && (clause.actions ?? []).every((a) => !a.verb || a.verb === "none") && QUOTED_GRANT.test(clauseText)) {
      clause = { ...clause, actions: [{ verb: "grant-ability", object: "that ability" }] };
    }
    const actors = clauseText ? actionRecipients(clauseText) : {};
    const actorFor = (verb?: string): Control | undefined =>
      (clause.actions ?? []).filter((a) => a.verb === verb).length === 1 ? actors[verb ?? ""] : undefined;
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
    const grammarAll = clause.trigger?.event && text ? grammarTriggersOf(text, cardName, clause.trigger.event, cardText, enchantText,
      clauses.some((c) => c.id !== clause.id && c.trigger?.event && clauseTexts?.[c.id] === clauseText)) : null;
    const claimed = (grammarAll ?? []).filter((g): g is { verbs: Verb[]; subject: SubjectFilter } => !("refused" in g));
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
        trigger = { verbs: [verb], subject };
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
    for (const action of clause.actions ?? []) {
      // A PRINTED "Casualty N" keyword line is the spell's own sacrifice outlet (Make Disappear):
      // Scryfall's keyword list drops the N, so the line itself is read. See `casualtySacrifice`.
      const printedCasualty = action.verb === "none" ? /^casualty (\d+)$/i.exec((action.object ?? "").trim()) : null;
      if (printedCasualty) {
        abilities.push({ kind: "on-cast", repeats: "once", effect: { kind: "" }, emits: [casualtySacrifice(Number(printedCasualty[1]))] });
        continue;
      }
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
      //
      // NEVER A FIGHT (issue #562). "This creature fights another target creature" names the card
      // FIRST, as the fighter, and the prefix test above would read the whole pair as self. But the
      // fight's emit is the OTHER creature being dealt damage (emits.ts, CR 701.14a) -- Brash Taunter
      // supplied no "a creature is dealt damage" payoff. 17 corpus cards.
      const emitsSelf = action.verb !== "fight" && (SELF_REFERENCE.test((action.object ?? "").trim())
        || /^this$/i.test((action.object ?? "").trim())
        || isSelfSubject(action.object ?? "", cardName)
        // A COUNTER PUT ON THE CARD ITSELF (owner-reported 2026-09-17, Primal Amulet -> Exemplar of
        // Light). An add-counter's object is the COUNTER ("charge counter", "+1/+1"), never the
        // permanent receiving it, so the object could never say "this artifact" and 4,240 of the
        // 4,321 corpus counter emits carried no `self` -- every self-growing creature "fed" every
        // "whenever you put counters on THIS creature" payoff. The recipient is in the clause text.
        // A COUNTER REMOVED AS A COST names its permanent in the cost, not in the effect text.
        || counterOnSelf(action.verb, action.verb === "remove-counter" && /\bcounters?\b/i.test(cost) ? cost : text, cardName, isSelfSubject(clause.trigger?.subject ?? "", cardName))
        // A pronoun standing in for the card itself. Tested on the RESOLVED antecedent, because the
        // raw object is "it" and matches none of the spellings above.
        || (PRONOUN_OBJECT.test((action.object ?? "").trim())
          && antecedentIsSelf((clause.actions ?? []).indexOf(action))));
      // CR 614: a MULTIPLIER modifies occurrences of an event and is not a source of it. The clause
      // layer records the verb the sentence uses and nothing about the "would ... instead" frame, so
      // Hardened Scales answered `add-counter` and advertised a counter it never places. The kind
      // names the multiplication, and the emits go — see `replacement.ts` and the consumer trigger
      // below, which is the shape `prompt.ts` already documents for Tekuthal.
      const effectKind = replacement?.kind ?? actionEffectKind(action, text);
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
      const refersToTrigger = antecedent !== undefined && !emitsSelf && !REVEALS.test(text)
        && sourceOf((clause.actions ?? []).indexOf(action)).to === "trigger";
      // The EVENT outranks a "battlefield" the model wrote on the action: a card that died is not there
      // (Hofri Ghostforge, Eater of Virtue, Chaos Shrine's Black Crystal wrote it; review of S3).
      const zone = refersToTrigger && (!action.fromZone || action.fromZone === "battlefield") ? zoneAfterEvent(clause.trigger?.event) : undefined;
      const emits = temporaryRider ? [] : actionEmits(antecedent ? { ...action, object: antecedent, ...(zone ? { fromZone: zone } : {}) } : action, text, { self: emitsSelf })
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
        .filter(() => !(action.verb === "sacrifice" && selfLeavesTrigger))
        // A multiplier performs nothing. Every emit of the clause goes, not only the one matching
        // the replaced event: Academy Manufactor's clause answers `create` three times and creates
        // a token on its own none of those times.
        .filter(() => replacement === null)
        // ROADMAP I7. The permanent arrives under a controller the schema cannot name, so the emit
        // claims nothing rather than claiming everyone. See `entersUnderAnotherPlayer`.
        .filter((e) => !(e.verb === "enters" && entersUnderAnotherPlayer(cardText)));
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
      if (refersToTrigger) for (const e of emits) e.subject.ref = "trigger";
      if (!effectKind && emits.length === 0) { unclaimed.push(action); continue; }

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
      const subjectAction = effectKind === "flicker" && antecedent && exiledHere && !emitsSelf ? { ...action, object: antecedent } : action;
      const subject = effectKind
        ? effectSubject(subjectAction, effectKind, trigger?.subject.self === true, text, cardName, enchantText)
        : undefined;
      // A GRANT TO THE TRIGGERING OBJECT says so (Stonehoof Chieftain: "whenever another creature you
      // control attacks, IT gains trample"), so the matcher can see a keyword that object already
      // has is no gift (owner 2026-10-02: "flying flying gives you nothing additional").
      // The clause records only the keyword as the object, so the recipient is read off the text: "it"
      // or "they" after the trigger, with no target in the sentence and a trigger that is not the card.
      if (subject && effectKind === "keyword-grant" && clause.trigger?.subject
        && !isSelfSubject(clause.trigger.subject, cardName) && !/\btarget\b/i.test(text)
        && GRANT_TO_TRIGGER.test(text)) subject.ref = "trigger";
      // See THAT_TYPED. Read BEFORE the actor, which is a stronger statement and overrides it.
      const objectText = (action.object ?? "").trim();
      if (THAT_TYPED.test(objectText) && !PRONOUN_OBJECT.test(objectText)) {
        const ante = antecedentFor((clause.actions ?? []).indexOf(action));
        const inherited = ante ? subjectFrom(ante, cardName, enchantText).control : undefined;
        if (inherited && inherited !== "any") {
          for (const e of emits) if (e.subject.control === "any") e.subject.control = inherited;
          if (subject && subject.control === "any") subject.control = inherited;
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
      // A COST SACRIFICE IS THE CONTROLLER'S (CR 701.17a): "{T}, Sacrifice two other creatures" eats
      // your creatures whatever the effect goes on to do to "any number of target players". The
      // sentence-wide actor default below refuses when the clause names another player, which is
      // exactly Priest of Forgotten Gods' shape, so the cost's own sacrifice -- the FIRST sacrifice
      // action, since the clause lists cost actions first -- is pinned here (recall v4, 2026-09-09).
      const costSacrifice = action.verb === "sacrifice" && /\bsacrifice\b/i.test(cost)
        && (clause.actions ?? []).find((x) => x.verb === "sacrifice") === action;
      if (costSacrifice) {
        for (const e of emits) if (e.subject.control === "any") e.subject.control = "you";
        if (subject && subject.control === "any") subject.control = "you";
      }
      // A STATED "you" INSIDE A GRANTED ABILITY IS THE RECIPIENT'S CONTROLLER (Hellish Rebuke: "You
      // lose 2 life" is said by the opponent's permanent), the same flip line 1154 applied to the
      // object's own "you" -- the actor cue runs after it and must not undo it.
      const stated = actorFor(action.verb);
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
        const fillOnly = action.verb === "put";
        for (const e of emits) if (!fillOnly || e.subject.control === "any") e.subject.control = actor;
        if (subject && (!fillOnly || (subject.control === "any" && stated !== "you"))) subject.control = actor;
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
        const yours = own || CONTROLLER_GETS_COPIES.test(clauseText);
        for (const e of emits) {
          if (e.subject.control === "any" && e.subject.scope === "target") e.subject.control = yours ? "you" : "opp";
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
          || (effectKind === "graveyard-recursion" && subject.zone === "graveyard"))
        && (effectKind !== "clone" || subject.subtype !== undefined);
      // What the payoff's magnitude counts. Already consumed by edges.ts, impact.ts and buckets.ts;
      // derivation had simply never set it, so the channel was dark under TAGS_SOURCE=derived.
      const scaling = actionScaling(action, text);
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
      if (trigger) ability.trigger = trigger;
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
      if (action.amount != null && action.amount !== "") ability.amount = action.amount;
      else if (action.verb === "add-mana" && effectKind === "mana-generation") {
        const added = manaAdded(action.object ?? "");
        if (added !== undefined) ability.amount = String(added);
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
        ? !SORCERY_SPEED.test(clauseText ?? "") && !LOYALTY_COST.test(cost)
        : kind === "on-cast" && castAtInstantSpeed === true;
      if (instantSpeed) for (const e of emits) e.instantSpeed = true;
      if (emits.length) ability.emits = emits;
      // A RETURN THAT LANDS LATER (#801, Shirei): read on THIS action's own sentence, so an immediate
      // return beside a delayed one stays immediate (Gift of Immortality, Swift Warkite; review). The
      // k-th return/put action is the k-th "return"/"put" in the text. CEILING: a counter "put" in the
      // text that derived as `add-counter` would shift a later put's sentence.
      if ((action.verb === "return" || action.verb === "put") && ability.effect.kind !== "token-generation") {
        const k = (clause.actions ?? []).slice(0, (clause.actions ?? []).indexOf(action)).filter((x) => x.verb === action.verb).length;
        const delay = DELAYED_RETURN.exec(nthSentenceWith(text, action.verb, k));
        if (delay) ability.delayedUntil = /upkeep/i.test(delay[0]) ? "next-upkeep" : "next-end-step";
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
    const threshold = thresholdFor(text);
    const thresholdSubject = threshold ? thresholdSubjectFor(text) : undefined;
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
      abilities.push({ kind, effect: replacement ? { kind: replacement.kind } : { kind: "" as const },
        ...(trigger ? { trigger } : {}), ...(face ? { face } : {}) });
    }

    // Label everything this clause produced, in ONE place rather than at each of the three push
    // sites above (the main action loop, `drainAbility`, and the trigger-only fallback). A fourth
    // push site added later cannot silently skip labelling this way.
    // The DEMAND an intervening-if condition makes on the deck, recorded in the same one place. Only
    // an ability with a TRIGGER can carry one (CR 603.4 checks the condition when the trigger would
    // fire), so a static or on-cast clause is skipped even if the sentence happens to say "if".
    const conditionCares = interveningIfOf(text) ? conditionCares_(interveningIfOf(text)!) : [];
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
      const repeats = exhaust ? "once" : delayed?.repeats ?? repeatsFor(abilities[i], text, cost, rawTrigger);
      if (repeats) abilities[i] = { ...abilities[i], repeats };
      if (delayed && abilities[i].trigger) abilities[i] = { ...abilities[i], delayedBy: delayed.delayedBy };
      if (threshold) abilities[i] = { ...abilities[i], threshold, ...(thresholdSubject ? { thresholdSubject } : {}) };
      // A REFUSED trigger still says what the card needs around it (owner 2026-08-20): the cares
      // tags ride on every ability of a triggered clause, claimed or not.
      if (conditionCares.length > 0 && (abilities[i].trigger || clause.trigger?.event)) {
        abilities[i] = { ...abilities[i], conditionCares };
      }
      // THE MULTIPLIER'S OWN TRIGGER, the one synthesized from the "would ... instead" frame -- see
      // `Ability.replacement`. Matched on the verbs so a clause's other trigger is never marked.
      const heard = abilities[i].trigger?.verbs ?? [];
      if (replacement && !replacement.restricted && replacement.verbs.some((v) => heard.includes(v))) {
        abilities[i] = { ...abilities[i], replacement: true };
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
      // keyword-ability list. CEILING: a clause with two grants gives each ability the union.
      if (abilities[i].effect?.kind === "keyword-grant") {
        const grants = grantedKeywords((clause.actions ?? []).filter((a) => a.verb === "grant-ability").map((a) => a.object ?? ""));
        if (grants.length > 0) abilities[i] = { ...abilities[i], grants };
      }
      const reduces = abilities[i].effect?.kind === "cost-reduction" ? reductionOf(text ?? "", abilities[i].amount) : undefined;
      if (reduces) abilities[i] = { ...abilities[i], reduces };
      if (abilities[i].trigger && BATCHED.test(clause.trigger?.subject ?? "")) {
        abilities[i] = { ...abilities[i], trigger: { ...abilities[i].trigger!, batched: true } };
      }
      // A GAME-STATE REQUIREMENT: from the ability word the segmenter stripped ("Max speed —"),
      // else from a condition that governs the whole clause text (roadmap W18).
      const requires = clauseRequires?.[clause.id] ?? requiresOf(text);
      if (requires) abilities[i] = { ...abilities[i], requires };
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
    }
  }
  // AN OPPONENT'S GRAVEYARD, TAKEN ON THE WAY IN (recall v4 #28, 2026-09-09). Valgavoth, Terror
  // Eater and Dauthi Voidwalker exile what would go to an opponent's graveyard and let you play it,
  // so the card is a recursion payoff over THEIR graveyard fills -- an edict you cast feeds it. Two
  // sentences, two clauses, so it is read off the card text. The replacement alone is Leyline of
  // the Void (hate, no payoff), which `replacementOf` refuses on purpose. Two corpus cards.
  if (OPP_GRAVEYARD_TAKER.test(cardText) && PLAYS_WHAT_IT_EXILED.test(cardText)) {
    abilities.push({
      kind: "static", repeats: "continuous",
      effect: { kind: "graveyard-recursion", subject: { control: "opp", token: null, zone: "graveyard" } },
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
  return { abilities, unclaimed, unknownTriggers };
}

/** "If a card ... would be put into an opponent's graveyard from anywhere, exile it instead." */
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
}

/** Assemble the full CardTags document the matcher consumes. `characteristics` is printed data read
 *  from the card document -- derivation never asks a model for what the database already knows. */
export function deriveCardTags(input: DeriveInput): CardTags {
  const chars = input.characteristics;
  const castAtInstantSpeed = chars.types.some((t) => t.toLowerCase() === "instant")
    || (chars.keywords ?? []).some((k) => k.toLowerCase() === "flash");
  const derived = deriveAbilities(
    input.clauses, input.name, input.clauseTexts, input.clauseCosts, input.oracleText, input.grantedToken,
    input.clauseFaces, castAtInstantSpeed, input.clauseRequires);
  const { unknownTriggers } = derived;
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
  const spellOnce = pinned.map((a) => a.kind === "on-cast" || a.repeats === "once" || !isSpellFace(a.face) ? a : { ...a, repeats: "once" as const });
  return {
    oracleId: input.oracleId,
    schemaVersion: 1,
    // WARNING: 0 will never equal PROMPT_VERSION (llm/prompt.ts), so `needsRetag`
    // would see any persisted derived doc as permanently stale and re-queue it for LLM tagging
    // forever. Fine while derivation is not yet wired into the persistence path -- revisit this
    // the moment it is.
    promptVersion: 0,
    model: "derived",
    characteristics: input.characteristics,
    abilities: spellOnce,
    // Written only when there is something to surface, so a clean card stays byte-identical.
    ...(unknownTriggers.length ? { unknownTriggers } : {}),
  };
}
