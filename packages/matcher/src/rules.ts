import ruleSet from "./rules.json" with { type: "json" };
import type { Ability, ManaLine, ManaLineSource } from "@edh-seer/tagger";
import type { SubjectFilter } from "@edh-seer/tagger";
import type { DeckCard } from "./types.js";
import { classifyLand } from "./land-conditions.js";
import { cardLines, isLoyaltyAbility, usableLoyalty } from "./mana-lines.js";
import { BASIC_LAND_TYPE_SET, countsAsLand, transformsIntoLand as transformsIntoLandCard } from "./typeline.js";
import { isTargetCondition } from "./target-condition.js";

/** A single test against one card. The operator set is CLOSED on purpose: `oracle`, `effectKind`,
 *  `typeLine` and an `anyOf` combinator cover every classifier that exists, and keeping it closed
 *  is what stops a config file mutating into a half-built query language. Anything graph-shaped
 *  (go-wide, recursion-in-the-dominant-chain, combo terminals) stays code and would arrive here as
 *  a named signature, not as more operators. */
export type RuleClause =
  | { op: "oracle"; pattern: string }
  /** `repeats` NARROWS the same operator rather than adding one (the set stays closed): when
   *  present, an ability counts only if its effect kind is in `in` AND its `Ability.repeats` label
   *  is in `repeats`, tested on the SAME ability -- a card with a one-shot draw and a repeatable
   *  sac outlet is not a draw engine. `null` names an ability `repeats.ts` refused to label. Owner,
   *  2026-09-05: "we count the one-off instant that draws 1 card the same way as Rhystic Study".
   *  `Ability.repeats` had sat on every derived ability since 2026-08-11 with no count reading it. */
  | { op: "effectKind"; in: string[]; repeats?: (string | null)[]; control?: string[];
      /** The effect's SUBJECT scope (`all`, `each`, `target`): present on the effect and in this list. An effect that names none does not match -- `cost-reduction` with scope `all`/`each` is a discount
       *  for OTHER spells (Sapphire Medallion), and one with no scope is the card's own cost ("This spell costs {1} less", Sunderflock). */
      scope?: string[];
      /** Let `scope` also accept a ONE-SIDED MASS at a targeted player's board (owner 2026-11-14: "Return all nonland permanents target player controls to their owner's hand" is a weaker board wipe, an answer to the classes it returns). The marker is on the ability's EMIT (`SubjectFilter.targetPlayer`, derive sets it on `leaves`); the effect subject of such a bounce is `scope: all, control: any` and carries none, so this reads the `leaves` emit (no other verb), and a symmetric mass (Evacuation, Aetherize: no marker) is not let through. A mass on LANDS ONLY is refused, as `notMassLand` refuses it for the kill rules (Ajani Vengeant: stax, not a land answer). */
      orTargetPlayerMass?: true;
      /** Refuse an ability whose subject is a spell THAT TARGETS THIS CARD (`subject.targets.self`): Spellwild Ouphe's "Spells that target this creature cost {2} less" cheapens
       *  spells aimed at the card itself, a discount for no other spell (`discountsOtherSpells`). */
      notSelfTargeted?: boolean;
      /** A `debuff` that can KILL: the amount's TOUGHNESS part is negative ("-5/-5", "-0/-3", "-X/-X, where X is ...", "-1/-1"). "-2/-0" shrinks power and kills nothing; an amount that
       *  is not a P/T pair at all does not match. A scaling or unreadable toughness ("-X") counts: the number is not printed, and the card states it as a lethal-shaped shrink. */
      toughnessDown?: true;
      /** Refuse an ability that only a BLOCK makes (see the `emits` option of the same name): "each creature blocking it gets -1/-1" (Plague Wight, Baneblade Scoundrel, Knight of Valor) (#1266). */
      notBlockCombat?: true;
      /** Refuse a TOKEN-ONLY effect subject ("Creature tokens get -2/-2": Bloodline Culling) (#1266). */
      notTokenOnly?: true;
      /** Refuse an ability that happens on one side of a coin flip (`Ability.onFlip`): Orcish Captain's "If you lose the flip, it gets -0/-2" shrinks your own Orc by chance, and is no removal (#1295 item 5). */
      notOnFlip?: true;
      /** Whose library a PRINTED search reads (`Ability.librarySearch`, #1266): present on the ability and in this list; absent never matches, which is how a typed dig (derive's `search` kind also covers
       *  digs, for edges) stays out of the tutor role (owner 2026-10-21). */
      librarySearch?: string[];
      /** Refuse an ability whose effect SUBJECT types are all `land` ("search for a basic land card": Farseek, Expedition Map). That is fixing, not a tutor. A subject with no type is NOT land-only. */
      notLandOnly?: true;
      /** Refuse an ability whose effect SUBJECT is owned by you (`subject.owner: "you"`): a graveyard-hate effect over your own graveyard ("exile that card from your graveyard") is delve, escape and recursion
       *  cost, not hate (#1266). An effect with no subject, or no owner, is not refused. */
      notOwnedByYou?: true;
      /** Refuse an ability whose effect SUBJECT is the card itself (`subject.self`): "Exile this card from your graveyard" derives a graveyard-hate effect over the card, which hates nothing (#1266). */
      notSelf?: true;
      /** Refuse a TAX ON THE CASTER'S OWN THINGS (#1266, `stax.effect`): the effect subject is `control: you` and the ability names no payer (`Ability.unless`). "Red spells you cast cost {R} more" (the Leeches) and
       *  "Creature spells you cast cost {1} more" (Geist-Fueled Scarecrow) are a drawback on the caster. The other `control: you` taxes, Onakke Oathkeeper and Heat Wave ("creatures can't attack planeswalkers you control unless their
       *  controller pays ..."), tax the opponent and name that payer in `unless`, which is what tells them apart: their subject types (`creature`, `planeswalker`) do not. Read per ability, so a card with a real tax beside the line keeps it. */
      notOwnTax?: true;
      /** The ABILITY's own kind (`Ability.kind`: `activated`, `triggered`, `static`, `on-cast` ...) is in this list. An activated flicker is at instant speed on any permanent (owner 2026-11-12, `protection.flicker`). */
      ofKind?: string[];
      /** A `targeting-ban` that PROTECTS SOMETHING OF YOURS, whoever bans (#1266, owner 2026-11-12). Any one of: the ban is against opponents' spells and abilities (`targetingBan.source.control: opp`: Vines of Vastwood,
       *  Canopy Cover, Tomik, Display of Dominance); its subject is yours (Autumn's Veil, Spellbane Centaur: "creatures you control"); the card is an AURA (the enchanted creature is one you can choose: Anti-Magic Aura,
       *  Spectral Shield, Artifact Ward); or it is global over every graveyard (Ground Seal, Silent Gravestone), every creature (Dense Foliage) or every permanent (Peace Talks). Refused whatever the source: a ban on the card itself (Thrun, Gaea's Revenge,
       *  Bartel Runeaxe) and one whose subject is only opponents' things. A global ban on every permanent counts too (owner 2026-11-13: Peace Talks protects everyone, opponents included). */
      banProtects?: true;
      /** A FLICKER THAT IS ONE (derive types "put a card exiled with this onto the battlefield" `flicker` too: Karn Liberated, Ashiok, Sisters of Stone Death, Ghost Vacuum, Profane Procession,
       *  and a loyalty or "activate only as a sorcery" exile): the card has an instant-speed `exiled` emit of a permanent from the battlefield (or from no stated zone: a model-read clause leaves it off, Angel of Condemnation) that is not the card itself, AND the flicker either
       *  returns it to its OWNER (the flicker's own enters emit is `control: any`: Eldrazi Displacer, Mistmeadow Witch) or the exile is of YOUR permanent (an exiled emit `control: you`: Cold Storage,
       *  Emiel). A return "under your control" of an opponent's creature is a steal, and is refused. CEILING: the pair is read across the whole card, not the clause, because Cold Storage and Synod Sanctum
       *  exile in one ability and return in another (#1266). */
      pairedInstantExile?: true;
      /** Refuse an ability one of whose emits the VICTIM MAY DECLINE (`GameEvent.victimMay`): "unless that player exiles cards from their graveyard" (Axebane Ferox), "any player may exile a card from their graveyard" (Carrion Rats),
       *  "its controller may exile three cards ... to ignore this effect" (Lost in Thought) are a price the other player chooses to pay, not graveyard hate (#1266; the same refusal as the edict's `notVictimMay` on `emits`). */
      notVictimMay?: true;
      /** The effect's SUBJECT can be a PLAYER and is not you (#1266, burn): an untyped subject (any target, each opponent, each player), a `player` subject, or an `anyOf` with a player or an untyped
       *  branch ("target player or planeswalker", "each creature and each player"). A subject typed to permanents only ("target creature") is removal, not burn; control `you` ("deals 2 damage to you") is refused;
       *  a subject that is the card itself is refused. */
      reachesPlayer?: true;
      /** Refuse an ability one of whose emits is a damage REDIRECT (`GameEvent.redirect`, #1294): "the next 2 damage ... is dealt to any target instead" (Harm's Way, Glarecaster) deals no damage of its own. */
      notRedirect?: true;
      /** Refuse an ability whose TARGET CREATURE only seeds a sweep (owner 2026-11-13, Rules 52): the target is a creature (typed `creature` and nothing else) and another ability of the SAME clause damages every creature (`scope` all or each) for the SAME amount,
       *  so the target is the anchor of the mass, not a second kill. "Cleansing Beam deals 2 damage to target creature and each other creature that shares a color with it" (the Radiance cards, Homing Lightning, Izzet Staticaster), Alpha Brawl.
       *  A different amount is two effects (Fear, Fire, Foes! X and 1, Flames of the Raze-Boar 4 and 2). A target that is a PLAYER or planeswalker is no anchor of this kind: its damage is a Lava Spike (owner 2026-10-22, removal at any amount), so "4 damage to target player or
       *  planeswalker and 4 to each creature that player controls" (Flame Wave, Lavalanche, Bonfire of the Damned) keeps it. CEILING: the equal amount is the cue, so a spell that deals the same damage to a target creature AND to a separate mass in one clause is read as an anchor too; none is known. */
      notAnchorsMass?: true;
      /** The effect TARGETS something (`scope: target`, so no `scope` option beside it) that can be a PERMANENT not only yours (#1294, the removal ruling of 2026-10-22: targeted damage is removal when its allowed target includes a permanent on the battlefield, at any amount):
       *  a typed subject that is not a player ("target creature", "creature or planeswalker", a battle), an UNTYPED one with no `player` flag ("any target"), or an `anyOf` with such a branch ("target player or planeswalker", Lava Spike).
       *  "Target player" and "target opponent" carry `player: true` since derive 381 and are refused; control `you` and the card itself are refused. An effect with no subject reads its targeted `non-combat-damage` emits instead (Aethertorch Renegade). */
      reachesPermanent?: true;
      /** A `to-hand` ability that is the IMPULSE LINE (#1302): one card chosen from a larger look (`Ability.chooses` with `amount` "1"). Owner 2026-10-02: choosing one of the top N is card selection, so
       *  `handFill.effect` lists it under `not`; a card whose conditional upgrade adds a second branch ("put each of those into your hand instead if ...", See the Truth) keeps its base case. */
      pickOne?: true;
      /** The ability is a DIG THAT PUTS CARDS FROM THE TOP OF YOUR LIBRARY INTO YOUR HAND while keeping its `search` kind for the edges (`Ability.toHand`, #1302): a dig for a class (Archghoul of Thraben, Eclipsed Flamekin). */
      toHand?: true;
      /** The ability REVEALS UNTIL A NAMED CARD (`Ability.named`, #1302): a tutor in effect with no printed search (Demonic Consultation, Spoils of the Vault). */
      named?: true;
      /** The ability NETS ZERO CARDS (`Ability.netZero`, #1302): it replaces a draw (Abundance, Underrealm Lich) or swaps with the top of the library (Scroll Rack). */
      netZero?: true;
      /** The ability HANDS OVER one of these keywords (`Ability.grants`, lowercased: "hexproof", "indestructible", "shroud", "protection"), tested on the SAME ability (#1266, `protection.text`). */
      grantsAny?: string[];
      /** Refuse a grant whose recipient is THE CARD ITSELF (`Ability.grantsSelf`, derive 515: "This creature gains indestructible", "Dragonlord Ojutai has hexproof as long as it's untapped"): a keyword the card
       *  gives itself protects nothing else (the Sylvan Caryatid rule, roadmap I1; #1289). */
      notGrantsSelf?: true;
      /** The effect SUBJECT can be a permanent of this ANSWER CLASS (`creature`, `artifact`, `enchantment`, `planeswalker`, `land`; #1266, the `answers.*` rules): a named type, a branch of an `anyOf`, or an unrestricted `permanent` (every class, but not `land` when
       *  the subject is "nonland": `notType`). A SUBTYPE alone names no class ("target Aura", "target Vehicle"), as the printed pattern's class table did not. */
      reachesClass?: string;
      /** With `reachesClass`: a BARE SUBTYPE ("Aura", "Equipment", "Saga") names its class, as on `emits` (`BARE_SUBTYPE_CLASS`). Opt-in; the bounce answers for the artifact and enchantment classes carry it (owner 2026-11-13: Seedling Charm). */
      bareSubtype?: true;
      /** The effect subject names NO type and is not a player: "any target" (Lightning Bolt). It reaches creatures and planeswalkers, which `reachesClass` cannot say of an untyped subject. */
      untyped?: true;
      /** The ability's amount is at least N, or is not a printed number at all (X, "its power", "that much": no number says it is a ping). A missing amount does not match. */
      amountAtLeast?: number }
  /** WHAT AN ABILITY EMITS, for the one family that has no effect kind by design: removal.
   *  `destroy`/`exile`/`bounce` derive as kindless abilities whose EMIT is `dies` or `leaves`
   *  (emits.ts: "`destroy` has no payoff kind in the engine's vocabulary, but without its `dies`
   *  emit no aristocrats edge ever forms"), so `effectKind` cannot name a removal ability and this
   *  can. Same per-ability `repeats` narrowing as `effectKind`. The set is still closed: this names
   *  a channel every derived ability already carries, not a new predicate language. */
  | { op: "emits"; verbs: string[]; repeats?: (string | null)[];
      /** Whose permanent the event happens to, and in which zone (`null` = the emit states none,
       *  i.e. the battlefield). A removal facet asks for `control: ["opp", "any"]` and
       *  `zone: [null]`: a card's OWN sacrifice emits `dies` under `you` (Trading Post, Grim
       *  Hireling) and a graveyard recursion emits `leaves` in the graveyard, and neither is removal. */
      control?: string[]; zone?: (string | null)[];
      /** The emit's subject TYPE (`land`) and the zone it comes FROM (`hand`, `graveyard`, `exile`, `library`). An emit that names no
       *  `fromZone` does not match a list: `ramp.landPut` asks for a land entering from somewhere other than play. A subject typed as SEVERAL types (Ghostly Flicker's creature, artifact or land) matches only when EVERY one is listed: a blink is not a land drop. */
      type?: string[]; fromZone?: (string | null)[];
      /** The counter a `counter-added`/`counter-removed` emit names (`-1/-1`, `+1/+1`, `stun`): the emit's `subject.counter` is in this list. An emit that names none does not match. */
      counter?: string[];
      /** The subject's scope (`all`, `each`, `target`); absent on the emit never matches a list. "Destroy all lands" is `dies` + type land + scope all. */
      scope?: (string | null)[];
      /** Let `scope` also accept a MASS at a targeted player's board (`SubjectFilter.targetPlayer`: "Destroy all creatures target player controls", Mogg Infestation; #1266): the answer rules read it as the target it was before derive scoped it `all` (owner 2026-11-13: a one-sided mass kill at a player is an answer). */
      orTargetPlayerMass?: true;
      /** Refuse an ability whose exile COMES BACK AT ONCE: another ability of the card, of the SAME `clause`, is a `flicker` with no `delayedUntil` whose subject is NOT an opponent's permanent ("Exile target creature, then
       *  return it to the battlefield": Flicker, Eldrazi Displacer). Owner ruling 2026-09-25: an IMMEDIATE flicker is no removal, a DELAYED return (Otherworldly Journey, Flickerwisp: back at the next end step) keeps
       *  its place, so a flicker with `delayedUntil` is not refused (that includes `source-leaves`, the "until this leaves the battlefield" return of Constable of the Realm and Mysterious Limousine, #1295 item 3). A
       *  flicker with `returnIf` is not refused either: the return is on one "If ..." branch and the other keeps the exile (Unyielding Gatekeeper, Vindictive Triumph). A flicker of an OPPONENT's permanent is the "until this leaves the battlefield" shape (Banisher Priest, Glass Casket, Portable Hole), which derive also
       *  reads as a `flicker` and which is the commonest removal there is, so it stays. */
      notFlickered?: true;
      /** Refuse an exile that COMES BACK, for the `exile` MARK (a blink is the least recursion-proof answer there is: Flickerwisp, Astral Slide, Long Road Home, Vizier of Deferment). `notFlickered` keeps a DELAYED return in the class count (owner 2026-09-25); the mark is stricter, and reads a `flicker` ability that
       *  returns the permanent and is not an opponent's, not a one-branch return (`returnIf`: Unyielding Gatekeeper, Vindictive Triumph keep the exile on the other branch) and not the "until this leaves the battlefield" return (`delayedUntil: "source-leaves"`: Banisher Priest, Constable of the Realm): an IMMEDIATE one in the
       *  SAME `clause` (the card's other mode keeps its exile: Settle Beyond Reality, Triad of Fates), or a return at the next end step or upkeep ANYWHERE on the card, because "At the beginning of the next end step, return ..." is a clause of its own (Long Road Home, Phelia). CEILING: the end-step return is read card-wide, so a card with a blink mode beside an
       *  until-leaves mode (Angel of Condemnation) carries no mark; the printed pattern vetoed the whole card too. */
      notBlinkedBack?: true;
      /** Refuse an ability that is PAID by exiling or discarding THIS card from your hand ("{3}, Exile this card from your hand: Target land gains ...": Emrakul the Exigent Doom, Shattered Seraph, Spara's
       *  Adjudicators). Derive reads the exile in the cost as an exile of the target. */
      notFromHandCost?: true;
      /** Refuse an ability that acts on permanents YOU OWN: an ability whose own effect subject has `owner: "you"`, or whose emit's subject does (a sibling ability in the same clause does not decide, #1366: Word of Undoing's other bounce is "Auras you own"; "Return one or two target creatures
       *  and/or enchantments you own": Get Out; "Exile another target creature you own. Return it ... at the beginning of the next end step": Charming Prince). Derive reads the emit's control as `opp`. The printed pattern
       *  refused "you own"; the delayed-return ruling (2026-09-25) is about an OPPONENT's permanent, not yours. */
      notOwnedByYou?: true;
      /** Refuse an emit whose target is a card the SAME ability also takes out of a graveyard: another ability of the SAME `clause` has an emit that targets a card `fromZone: graveyard` with the SAME control and type
       *  (Macabre Mockery reanimates an opponent's creature, then "sacrifices it"; Goblin Welder swaps an artifact for one in a graveyard). Derive reads the follow-up sacrifice as removal of a second target. A real
       *  kill that returns YOUR card (Lethal Protection: the graveyard card is `you`, the kill `opp`) is not refused. */
      notPairedTarget?: true;
      /** The emit is an EDICT (`SubjectFilter.edict`): the sacrifice or death is forced on a player the ability TARGETS ("Target player sacrifices a creature of their choice": Diabolic Edict, Chainer's Edict). The
       *  creature is not itself targeted, so such an emit carries no `scope: "target"` and this is how the role reads it (#1295: it replaces the printed `targetPlayerSacrifices` pattern). */
      edict?: true;
      /** Refuse an emit that is a CRAFT COST's exile of its materials (`SubjectFilter.viaCraft`, #1500): a separate optional activation (CR 702.167a), never the swap or destruction the rule guards against (Kaslem's Stonetree: Craft with Cave, beside its land drop). */
      notViaCraft?: true;
      /** Refuse an EDICT emit (`SubjectFilter.edict`): "Target player sacrifices two creatures" forces a choice on one named player and is not a wipe (#1266, `boardWipe.text`). */
      notEdict?: true;
      /** Refuse an emit that is aimed at a PLAYER'S LANDS, not at a land (owner 2026-11-13): a land-only subject whose ability states no count ("Destroy all lands target player controls": Ajani Vengeant -7) or a count of three or more (`stax.landDenial`'s threshold: Burning of Xinye's "target opponent destroys four lands"). A land answer is a TARGETED land kill; these are stax.
       *  CEILING: derive scopes "target player controls" as a target of the lands and gives no other cue, so the missing count is the signal; a mass kill that states a count below three, or a targeted land kill whose count derive drops, reads the other way. */
      notMassLand?: true;
      /** Refuse an emit whose subject is LANDS ONLY (`landOnlySubject`: "Destroy all lands", "each player sacrifices a land", "nonbasic lands"): mass land denial is stax, not a board wipe (owner 2026-11-06, `boardWipe.text`). A subject that also names another type ("artifacts, creatures, and lands": Jokulhaups) is not land-only. */
      notLandOnly?: true;
      /** Require an emit whose subject is LANDS ONLY (see `notLandOnly`): the shape `stax.landDenial` reads. */
      landOnly?: true;
      /** Require an emit whose subject INCLUDES lands (`includesLandSubject`): a type list naming land ("artifacts, creatures, and lands": Jokulhaups, Obliterate, Decree of Annihilation), a branch of an `anyOf` that does, or an UNRESTRICTED `permanent` (Apocalypse, Worldfire: "all permanents" names lands). A `permanent` narrowed by a colour, a selection, a negated type, a subtype ... (`NARROWS_PERMANENT`) is not (see `includesLandSubject`). Where `landOnly` needs lands and nothing else, this takes the combined subjects (owner 2026-11-06, #1554). */
      includesLand?: true;
      /** At least ONE of the subject's types is in this list, where `type` needs EVERY type in its list: "each creature and each planeswalker" passes `typeAny: [creature, permanent]`, a planeswalker-only subject ("each planeswalker they control": Kumano Faces Kakkazan) does not. */
      typeAny?: string[];
      /** Refuse an ability that only a BLOCK makes (#1266, `boardWipe.text`): it triggers on "blocks" / "becomes blocked" ("When this creature blocks a creature, destroy both creatures": Alaborn Zealot, Dead-Iron Sledge), or its subject is a creature
       *  `combat: blocking` / `combatWith` blocking ("each creature blocking it gets -1/-1": Plague Wight, Baneblade Scoundrel, Gomazoa). That is a combat result against the blocked creature, not a sweep. Read by `emits` and `effectKind`. */
      notBlockCombat?: true;
      /** Refuse a TOKEN-ONLY subject (`token: true`: "exile all other tokens created with this creature", Faerie Artisans; "Creature tokens get -2/-2", Bloodline Culling; "exile all tokens", Aether Snap). Read by `emits` and `effectKind`. */
      notTokenOnly?: true;
      /** Refuse an emit about the ATTACHMENTS of a target: a subject whose subtype is aura or equipment (type not `permanent`) when ANOTHER ability of the SAME clause has a TARGETED emit ("Blastfire Bolt deals 5 damage to target creature. Destroy all Equipment
       *  attached to that creature", Awaken the Sleeper). Derive keeps no attached-to link, so the subject alone cannot tell that from "Destroy all Auras" (Serene Heart, Pure // Simple), which is a mass removal and stays. CEILING: an attachment sweep with no
       *  other ability in its clause (Strip Bare, Corrosive Ooze) is not told apart and counts. */
      notAttachedTo?: true;
      /** Refuse a `dies` / `exiled` / `leaves` emit by an OPPONENT whose ability carries a plain NUMBER as its amount, or whose subject is a COUNTED pick (`selection: "counted"`, #1581: "that source's controller sacrifices that many permanents": Phyrexian Obliterator) that is not a HALF ("sacrifices half the creatures they control" stays a wipe, owner 2026-11-09: Vona's Hunger, Rakdos the Defiler; derive stores half as a counted pick with no amount, like "that many", so the printed "sacrifices half" is the cue. CEILING: a card that prints "sacrifices half" beside a separate "that many" is not told apart) ("each opponent sacrifices three creatures": Portal to Phyrexia; "... the creature with the greatest power": Crackling Doom; "exiles two permanents they control":
       *  Bane of Bala Ged; "each opponent returns a nonland permanent": Discovery // Dispersal). Derive scopes a plural, superlative or chosen object `all` or `each` all the same, and those are edicts of a fixed size. A sacrifice with no number ("sacrifices the rest":
       *  Cataclysm, Slaughter the Strong; "thirteen creatures": Blasphemous Edict), X (Death Cloud), or one by EVERY player (Barter in Blood, "two creatures each") keeps its number and stays. CEILING: Tectonic Hellion ("each player who controls the most lands
       *  sacrifices two") rides with the every-player case; being land-only, it lands in `stax.landDenial`, not `boardWipe.text` (#1551). */
      notCountedOppKill?: true;
      /** Under a `debuff` ability, keep only a ONE-SHOT shrink that lowers toughness (#1266, `boardWipe.text`): derive writes a `dies` emit for every "get -N/-N" including "-1/-0" (Cumber Stone, Hell Swarm),
       *  and a power-only shrink kills nothing; a CONTINUOUS one ("Other black creatures get -1/-1", Kaervek, Elesh Norn) is a static hoser, not a sweep. An emit under any other ability kind is not touched. */
      oneShotToughnessDebuff?: true;
      /** Refuse a MASS kill / exile / bounce emit (`scope` all or each; a damage emit is never refused) when another ability of the SAME clause carries a TARGETED dies / exiled / leaves: "Exile target nonland permanent ... and all other nonland permanents with the
       *  same name" (Banishment), "Destroy target artifact and all other artifacts with the same name", "Return target creature and all Auras attached to it" widen one target, they do not wipe a board (#1266). */
      notBesideTargetedKill?: true;
      /** The emitting ability's amount is a PRINTED NUMBER of at least N (X never matches: it may be one land): `effectKind.amountAtLeast` for an `emits` clause, but strict. A target land kill of FOUR lands is land denial (owner 2026-11-13, Burning of Xinye); one of ONE land (Stone Rain, amount "1") is not, and the in-between sizes ("two target lands", "X target lands") are NEEDS RULING. A missing amount does not match. */
      amountAtLeast?: number;
      /** Refuse an emit the victim may decline (`GameEvent.victimMay`): "its controller may sacrifice it" (Star Athlete, Livio), "unless that player sacrifices it" (Enchanter's Bane). It is the opponent's choice with an
       *  alternative, which is not removal (#1295).
       *  Pay-or-die is read too (#1628): Arcum's Whistle ("That player may pay {X} ... If they don't pay") and Winter's Chill ("its controller may pay {1} or {2}. If that player doesn't, destroy that creature"). */
      notVictimMay?: true;
      /** Refuse an emit about THE CARD ITSELF (`subject.self`): "Exile this card from your graveyard" (renew, channel-like costs) moves the card and is no exile of anything else (#1266, graveyardHate). */
      notSelf?: true;
      /** The ABILITY's effect kind is in this list, tested on the SAME ability as the emit. Manifest dread and "manifests the top card of that player's library" derive a `mill` EMIT under a kind-less
       *  ability (the card goes to the graveyard as a side effect), while a real mill carries the `mill` kind: `abilityKind: ["mill"]` is how `wincon.mill` tells the two apart (#1266). */
      abilityKind?: string[];
      /** The emit's subject can be a permanent of this ANSWER CLASS, as `effectKind.reachesClass`. */
      reachesClass?: string;
      /** With `reachesClass`: a BARE SUBTYPE ("Aura", "Equipment", "Saga") names its class (`BARE_SUBTYPE_CLASS`). Opt-in, on the artifact and enchantment rules of the destroy, exile, tuck and bounce answers (owner 2026-11-13: Seedling Charm). The damage answers have no artifact or enchantment rule, so there is nothing to turn on. */
      bareSubtype?: true;
      /** The emit is a TUCK (`GameEvent.tuck`: a put into a library from the battlefield; Condemn, Oust). A shuffle is its own verb. */
      tuck?: true }
  /** The card's `characteristics.enchants` (the Enchant line, #1315) can be a creature: the filter, or an `anyOf` branch of it ("creature or Vehicle", "artifact or creature"), names
   *  `creature` or `permanent`, and that branch's control is not `opp` (an Aura only an opponent's creature can wear is a curse). `control` narrows to the listed controls ("you":
   *  "Enchant creature you control"). */
  | { op: "enchants"; control?: string[] }
  /** The card has an ability carrying this DERIVED MARK (`Ability.impulse`, `Ability.looksAtTop`, #1266): a clause fact the clause layer has no verb for, stamped by derive from the clause's own words (`derive/top-reads.ts`). */
  | { op: "abilityMark"; mark: "impulse" | "looksAtTop" }
  /** An ability of the card whose effect lands on the ATTACHED permanent (`Ability.host`, #1315), tested on the SAME ability. `kinds` is the effect kind. Derive carries no polarity, so the
   *  rest narrows it: `raises` (a pump whose amount has a "+" before a non-zero value on either side: Dream Coat derives a pump with no amount); `grantsAny` (some `grants` keyword is
   *  in the list); `grantsNonEmpty`; `unlessPumpInClause` (refuse when another HOST pump shares this ability's `clause`: "+3/+3 as long as it's a Zombie. Otherwise -3/-3"). */
  | { op: "hostEffect"; kinds: string[]; raises?: true; grantsAny?: string[]; grantsNonEmpty?: true; unlessPumpInClause?: true;
      /** A `restriction` ability forbids one of these actions (`Ability.restricts`): "attack" is Pacifism, "block" alone is Mishra's Domination's "Otherwise, it can't block". */
      restricts?: string[];
      /** A QUOTED grant (owner 2026-10-22, "judge the quote"): the ability's `grants` is empty AND at least one ability of the card has `grantedBy` equal to this ability's `clause`
       *  (the quoted ability, which derive writes as its own ability) AND none of those is a curse. A grant with no child ability is never counted: nothing says what it hands over. */
      quoted?: { curse: { verbs: string[];
        /** The emit lands on the grantee or its controller: `subject.self`, or `control: you` (in a quote, "you" is the creature's controller). */
        aimedAtGrantee?: true }[] } }
  | { op: "typeLine"; contains: string }
  /** The card prints one of these KEYWORDS (Scryfall's `card.keywords`, compared case-insensitively). For a rule whose cue lives only in keyword reminder text, which derive does not read: Transmute and
   *  Transfigure search the library, and Typecycling does too (#1266). Compose with `not` to leave a keyword out (Landcycling fetches a land). */
  | { op: "keyword"; in: string[] }
  /** The card matches ANOTHER rule of the set, by id (match and `not` both). One definition of a role read by two rules: `removal.targeted` refuses a card that is both `boardWipe.text` and `stax.landDenial`. The id must name a rule; an unknown one throws, as an unknown pattern does. */
  | { op: "rule"; id: string }
  /** Card subtypes, from the tagged characteristics -- "equipment", "aura", a creature type. */
  | { op: "subtype"; in: string[] }
  /** Printed power minus mana value, at least this much. The one stat predicate the taxonomy needs
   *  (a creature bigger than it costs), written as a named comparison rather than an expression
   *  language: the moment this file can express arithmetic it stops being config and starts being
   *  a program nobody can gate. `*` power is not a number and never matches. */
  | { op: "powerOverMv"; atLeast: number }
  /** RAMP IS A NET GAIN (owner's rule, roadmap I4). A ONE-SHOT mana spell that adds no more than it
   *  costs is fixing, not acceleration: Dark Ritual is `{B}` for `{B}{B}{B}` and Manamorphose is two
   *  mana for two mana plus a cantrip. The second named comparison in this file, and written the
   *  same way `powerOverMv` is — the arithmetic lives in code and the config names only the
   *  threshold, because the moment this file can express arithmetic it stops being config.
   *
   *  IT JUDGES ONE-SHOTS ONLY, which is in the name because it is the whole subtlety. A PERMANENT
   *  mana source repeats, so Llanowar Elves nets 0 on the turn it lands and is ramp regardless —
   *  testing it would delete every mana dork in the format. */
  | { op: "oneShotNetsMana"; atLeast: number }
  /** The card is a land FOR THE DECK COUNT (`countsAsLand`, #1167): a modal DFC with a land face, else
   *  the front face. Replaces `typeLine contains land`, which read the whole "A // B" line and made
   *  a transform card with a land back (Treasure Map) a land to every `not` guard, so it earned no
   *  role while the land count called it a spell. */
  | { op: "countsAsLand" }
  /** A DERIVED MANA LINE (`CardTags.manaLines`, #1169; #1190): the card has at least one line, of the faces in play from the deck (`cardLines(dc, true)`: a transform card's NON-LAND
   *  back counts, as the Ramp role always read it; a land back never does, `ruleMatches` refuses it), satisfying EVERY filter given, tested on the SAME line. The Ramp role asked the
   *  ability list and printed text instead until #1190, which is how four Auras that make no mana anywhere else were ramp. `source` names the line's `ManaLineSource`; `repeats` its
   *  `repeats` label (`null` = the ability the line was read from states none); `producesToken` the lines that make a mana token (Treasure, Gold, Powerstone, Eldrazi Spawn). Closed
   *  like `effectKind`: a filter on a field of the line, never an expression. */
  | { op: "manaLine"; source?: ManaLineSource[]; repeats?: (string | null)[]; producesToken?: true; amountAtLeast?: number; bareTap?: true }
  /** The land ENTERS TAPPED, by the shared land classifier (`classifyLand`, land-conditions.ts: the one reader of that cue): its template is `unconditional` or `unclassified`. A land that is
   *  tapped only "unless" a condition the classifier READS (check, slow, fast, bfz, pod) is not; one whose "unless" it cannot read is `unclassified` and counts as tapped (the classifier's own
   *  default, the direction that does not flatter a deck). The printed pattern this replaced (`enters tapped(?!\s+unless)`) forgave every "tapped unless". */
  | { op: "landEntersTapped" }
  /** The card puts lands onto the battlefield FROM THE LIBRARY (`CardTags.landFetch`: Cultivate, Wood Elves, Wayfarer's Bauble). A fetch to hand only is no `landFetch`. */
  | { op: "landFetch" }
  | { op: "anyOf"; clauses: RuleClause[] }
  /** Every clause holds. With `not`, the two let one clause say "this AND NOT that" inside a rule's `not` list (ramp.landPut: an opponent-only land search). */
  | { op: "allOf"; clauses: RuleClause[] }
  | { op: "not"; clause: RuleClause };

export interface Rule {
  id: string;
  /** The build category this rule fills, if any. */
  category?: string;
  /** A FACET of a build category rather than a category of its own: a sub-count reported beside
   *  `of`'s count (draw engines beside draw), never a leaf, never a target. A facet rule fills no
   *  category, so `detectBuildRules` skips it and no parent union or `buildScore` can move. Data
   *  rather than code so the same op serves removal and lifegain when they ask. */
  facet?: { of: string; name: string };
  /** The wincon class this rule marks: how the card moves the game toward winning (design §12.5).
   *  A separate axis again -- a Craterhoof is a wincon and not a build category. */
  winconClass?: string;
  /** A fixed answer class this rule contributes (graveyard hate). */
  answerClass?: string;
  /** A pattern name whose `class` capture group names the answer class -- one rule covering the
   *  six types the removal regex already enumerates, rather than six near-identical rules. */
  answerClassFrom?: string;
  /** What KIND of answer this rule contributes, where the kind changes whether it answers at all
   *  (design §3.1). Absent = an ordinary one-shot answer, which is most of them. */
  mode?: "exile" | "recurring";
  /** WEAK PRINTED WORDS (owner 2026-11-13, `NARROW_WEIGHT`): the rule's `oracle` pattern is `strong` plus `weak` (two named patterns), and a card that matches `weak` and NOT `strong` fills `category` weakly (`weakByOracle`). Only `stax.text` today. */
  weakOracle?: { weak: string; strong: string };
  /** ALL must hold. */
  match: RuleClause[];
  /** NONE may hold. */
  not?: RuleClause[];
  why?: string;
}

export interface RuleSet {
  version: number;
  patterns: Record<string, string>;
  answerClassAliases: Record<string, string[]>;
  rules: Rule[];
}

/** `rules.json`, IMPORTED RATHER THAN READ FROM DISK so the analysis path bundles for a browser
 *  (roadmap P2). It stays a plain editable artifact either way -- what changes is that an edit is
 *  picked up at build time rather than at the next process start. The cache went with the read. */
export function loadRules(): RuleSet {
  return ruleSet as RuleSet;
}

/** The rule set's version, bumped when `rules.json` changes semantics. Free to bump -- build
 *  categories are computed at analysis time and never stored, so there is no cache to invalidate
 *  and nothing to re-buy.
 *
 *  Declared AFTER `loadRules`, not beside the other exports. The temporal-dead-zone hazard this
 *  guarded against is gone with the `let cached` binding it named -- a JSON import is hoisted -- but
 *  the order costs nothing and the next `let` added above this line brings the hazard back. */
export const RULES_VERSION: number = loadRules().version;

const compiled = new Map<string, RegExp>();

/** Patterns are compiled once and case-insensitively, matching how every detector in build.ts was
 *  written and tested. Throws on an unknown name: a typo in a rule must fail loudly at load rather
 *  than silently never matching, which is the `hierarchy.json` failure mode this whole layer is
 *  supposed to avoid. */
function pattern(set: RuleSet, name: string): RegExp {
  let re = compiled.get(name);
  if (!re) {
    const src = set.patterns[name];
    if (src === undefined) throw new Error(`rules.json: unknown pattern "${name}"`);
    re = new RegExp(src, "i");
    compiled.set(name, re);
  }
  return re;
}

/** The card prints "sacrifices half": a half-of-the-board sacrifice, which the owner counts as a wipe (#1581). Linear: two lowercase substring tests, no regex. */
function sacrificesHalf(oracleText: string | undefined): boolean {
  const t = (oracleText ?? "").toLowerCase();
  return t.includes("sacrifices half ") || t.includes("sacrifice half ");
}

/** A mana line's cost is exactly `{T}`: it taps the card itself and pays nothing else (`manaLine.bareTap`). Every payment field of `ManaLine.cost` is read. */
function isBareTap(c: ManaLine["cost"]): boolean {
  return c.tap && c.mana === 0 && !c.sacrificeSelf && !c.sacrificeOther && c.life === 0 && c.counters === null && !c.tapOther && c.loyalty === null && c.consumes.length === 0 && c.other.length === 0;
}

/** THE MOST A ONE-SHOT SPELL NETS, from its DERIVED MANA LINES (`CardTags.manaLines`, #1169 task 2b-2; it was a regex over the oracle text), or
 *  `undefined` when the card states no number to judge: no mana line at all, a line derive could not read, an amount that scales ("Add {R} for
 *  each card in target opponent's hand", Jeska's Will, Rite of Flame's second sentence), or a TAP BONUS FOR THE TURN (High Tide: "Until end of turn, whenever a
 *  player taps an Island for mana, that player adds an additional {U}", owner 2026-10-13: ramp). That bonus is one mana PER TAP, so its yield is the sources tapped that
 *  turn and no number on the line says it; `ManaLine.untilEndOfTurn` names it.
 *
 *  THE NET IS PRODUCTION LESS THE CARD'S MANA VALUE, for every line: `ManaLine.net` is production less the line's OWN cost, which is the face's mana value only on a
 *  `one-shot-spell` line (a spell pays its cost on the line); a trigger or a grant pays none there, so its `net` is its raw production (Reckless Blaze, mana value 5,
 *  "add {R}" when a creature dies; Divergent Growth, mana value 1, lands tap for a colour until end of turn: neither nets). So a line that is not a spell's is
 *  `net + cost.mana - manaValue`.
 *
 *  THE MAXIMUM, not the sum: Cabal Ritual's second sentence is "Add {B}{B}{B}{B}{B} INSTEAD" and is a gated line of its own. Taking the largest
 *  keeps the card whenever any branch of it accelerates, which is the lenient direction a refusal-shaped rule wants. Token makers and land fetches are
 *  not "added" mana (a Treasure maker, Cultivate): they state no number here, as before. */
function oneShotNet(dc: DeckCard): number | undefined {
  const adds = cardLines(dc).filter((l) => l.source !== "token-maker" && l.source !== "fetch");
  if (adds.length === 0 || adds.some((l) => l.unread || l.amount.scales !== null || l.untilEndOfTurn === true)) return undefined;
  return Math.max(...adds.map((l) => (l.source === "one-shot-spell" ? l.net : l.net + l.cost.mana - dc.card.manaValue)));
}

/** THE CARD'S OWN TEXT: an ability quoted inside a sentence that creates a token is the TOKEN'S
 *  (owner ruling 2026-09-27, #533). Mage's Attendant "create[s] a 1/1 blue Wizard creature token with
 *  "{1}, Sacrifice this token: Counter target noncreature spell ..."" -- the counterspell is the
 *  token's role, and the Attendant sat on the Counterspells shelf for it. A quoted GRANT to your own
 *  permanents ("creatures you control have "{T}: Add {G}"") stays: that sentence creates no token.
 *
 *  THE PARENTHESISED REMINDER THAT DESCRIBES THE TOKEN is the token's too (#1289): Shuri's Fabricator's "(They're artifacts with indestructible and "{T}: Add {C}...")"
 *  read as the card's own indestructible. Same ruling as the quote above (#533): a token's abilities are the token's roles, never the maker's. Junk, Shard and
 *  Wicked Role reminders escaped only because the reminder is its own sentence, so the quote's head had no "create ... token". Only a reminder that directly follows a
 *  create-token sentence is touched, and only by what it SAYS (`TOKEN_OPENER`: "It's", "She's", "They're", "It has", "A Food token is", a Role's "If you control another
 *  Role on it", "Enchanted creature gets"). One that OPENS as a token description is blanked whole, quote and all. One that opens with the card's own action (discover,
 *  mill, scry, an Adventure's "Then exile this card") stays, minus any LATER sentence that opens as a token description ("... A Treasure token is an artifact with "...""),
 *  so Greedy Freebooter keeps "To scry 1, ..." and loses the Treasure's text. Decayed and keyword reminders ("It can't block. When it attacks...") follow "create ... token with
 *  decayed" and describe the TOKEN's keyword, but do not open as a token description, so they are kept; the head sentence's "token with hexproof" is a separate known read.
 *  Cached, because every rule reads it. */
const TOKEN_PRONOUN = /^(?:(?:it|he|she|they)'s|they're|it is|they are|it has|each is) /i;
const TOKEN_OPENER = /^(?:an? [^.()"]{1,40}? token is|[^.()"]{1,40}? tokens are|(?:food|treasure|clue|blood)s? (?:tokens? )?(?:is|are)|the token |as the token enters|if you control another role on it|enchanted creature (?:gets|is|has) )/i;
/** A reminder `" (...)"` less its token-description sentences: whole when it OPENS as one, else only the later sentences that do (quote-aware split, a token's quote holds periods). */
function withoutTokenSentences(reminder: string): string {
  const inner = reminder.trim().slice(1, -1);
  const sentences = inner.match(/(?:[^."]|"[^"]*")+\.?\s*/g) ?? [];
  const opens = (x: string): boolean => TOKEN_OPENER.test(x.trim()) || TOKEN_PRONOUN.test(x.trim());
  if (sentences.length === 0 || opens(sentences[0]!)) return "";
  // A PRONOUN opener is a token description only as the FIRST sentence, or right after a sentence that itself creates a token (Chalk Outline "Create a Clue token. It's an
  // artifact with ..."); later it can be the card's own rule (Genevieve: "the party die is a d4. It's a d8 for 2").
  const kept = sentences.filter((x, n) => !(TOKEN_OPENER.test(x.trim())
    || (TOKEN_PRONOUN.test(x.trim()) && /create[^.]*token/i.test(sentences[n - 1] ?? "")))).join("").trim();
  return kept.length === inner.length ? reminder : kept === "" ? "" : ` (${kept})`;
}
const ownTextCache = new WeakMap<object, string>();
export function ownText(card: { oracleText?: string }): string {
  const cached = ownTextCache.get(card);
  if (cached !== undefined) return cached;
  const text = card.oracleText ?? "";
  const unquoted = text.replace(/"[^"]*"/g, (quote, at: number) => {
    const start = Math.max(text.lastIndexOf(".", at), text.lastIndexOf("\n", at)) + 1;
    const head = text.slice(start, at).toLowerCase();
    return head.includes("create") && head.includes("token") ? '""' : quote;
  });
  const out = unquoted.replace(/(?<=\.) \((?:[^()"]|"[^"]*")*\)/g, (reminder, at: number) => {
    const start = Math.max(unquoted.lastIndexOf(".", at - 2), unquoted.lastIndexOf("\n", at - 1)) + 1;
    const head = unquoted.slice(start, at).toLowerCase();
    return head.includes("create") && head.includes("token") ? withoutTokenSentences(reminder) : reminder;
  });
  ownTextCache.set(card, out);
  return out;
}

/** ...and the other half: the quoted abilities a card's create sentences give the token NAMED
 *  `tokenName`, which are that token's own text for role purposes (a token node carries none). */
export function tokenQuotes(card: { oracleText?: string }, tokenName: string): string {
  const text = card.oracleText ?? "";
  const want = tokenName.toLowerCase();
  const out: string[] = [];
  for (const sentence of text.split(/(?<=[.])\s+|\n/)) {
    const head = sentence.slice(0, Math.max(0, sentence.indexOf('"'))).toLowerCase();
    if (!head.includes("create") || !head.includes("token") || !head.includes(want)) continue;
    for (const m of sentence.matchAll(/"([^"]*)"/g)) out.push(m[1]!);
  }
  return out.join("\n");
}

/** A COST REDUCTION THAT REACHES OTHER SPELLS: the subject's scope is all/each AND it is not "spells that target this card" (`subject.targets.self`: Spellwild Ouphe, Elderwood Scion).
 *  ONE predicate for the rule `ramp.costReduction` and for `nonAccelerantRamp`'s cost-reducer class, so the Role and its class agree. */
export function discountsOtherSpells(effect: { kind: string; subject?: { scope?: string; targets?: { self?: boolean } } }): boolean {
  return effect.kind === "cost-reduction" && (effect.subject?.scope === "all" || effect.subject?.scope === "each") && effect.subject?.targets?.self !== true;
}

/** The TYPES an emit's subject names: its `type`, else -- for a subject written as an `anyOf` of kinds ("Destroy target creature or Vehicle": `[{type: creature}, {subtype: vehicle}]`) --
 *  each branch's type, a branch with only a SUBTYPE counting as "permanent" (a subtype names a kind of permanent: Vehicle, Spirit; so does a subject whose only type word is a subtype: "Destroy target Aura"). Empty when the subject names no type at all. */
function subjectTypes(subject: { type?: string | string[]; subtype?: unknown; anyOf?: { type?: string | string[]; subtype?: unknown }[] }): string[] {
  if (subject.type !== undefined) return [subject.type].flat();
  if (subject.subtype !== undefined && subject.anyOf === undefined) return ["permanent"];
  return (subject.anyOf ?? []).flatMap((b) => (b.type !== undefined ? [b.type].flat() : b.subtype !== undefined ? ["permanent"] : []));
}

/** Every ability granted by clause `clauseId` (`grantedBy`), at least one, and no emit of any of them a curse marker of `curse`. */
function quotedGrantIsBenign(
  abilities: readonly { clause?: number; grantedBy?: number; emits?: { verb: string; subject: { self?: boolean; control?: string } }[] }[],
  clauseId: number | undefined,
  curse: { verbs: string[]; aimedAtGrantee?: true }[],
): boolean {
  const children = clauseId === undefined ? [] : abilities.filter((c) => c.grantedBy === clauseId);
  return children.length > 0 && !children.some((c) => (c.emits ?? []).some((e) => curse.some((m) =>
    m.verbs.includes(e.verb)
    && (m.aimedAtGrantee !== true || e.subject.self === true || e.subject.control === "you"))));
}

/** A pump amount that RAISES power or toughness: a "+" before a non-zero value on either side of "+2/+0", "+0/+2", "+X/+X", "+1/+1 for each ...". "+0/+0" and no amount do not. */
const RAISES_STAT = /\+(?!0(?!\d))[0-9X]/i;
const raisesStat = (amount: string | undefined): boolean => amount !== undefined && RAISES_STAT.test(amount);

/** The land types, CR 205.3i ("Lands have their own unique set of subtypes; these subtypes are called land types"). */
const LAND_TYPES = new Set(["cave", "desert", "forest", "gate", "island", "lair", "locus", "mine", "mountain", "plains", "planet", "power-plant", "sphere", "swamp", "tower", "town", "urza's"]);
/** Can this ability's damage or life loss land on a player other than you? See `effectKind.reachesPlayer`. The effect subject decides; where derive kept NONE (a model-`static` clause: Granite Shard,
 *  Herald of Hadar, but also the damage REDIRECTS Pariah and Palisade Giant) the ability's own damage / life-loss EMITS decide, and an ability with neither reads as no. */
/** See `pairedInstantExile` on the `effectKind` clause. */
function pairedInstantExile(abilities: readonly Ability[], flicker: Ability): boolean {
  const exiled = abilities.flatMap((x) => x.emits ?? []).filter((e) => e.verb === "exiled" && e.instantSpeed === true && (e.subject.fromZone === undefined || e.subject.fromZone === "battlefield") && e.subject.self !== true);
  if (exiled.length === 0) return false;
  return exiled.some((e) => e.subject.control === "you") || (flicker.emits ?? []).some((e) => e.verb === "enters" && e.subject.control === "any");
}

function abilityReachesPlayer(a: { effect: { subject?: SubjectFilter }; emits?: { verb: string; subject: SubjectFilter }[] }): boolean {
  if (a.effect.subject !== undefined) return subjectReachesPlayer(a.effect.subject);
  return (a.emits ?? []).some((e) => (e.verb === "non-combat-damage" || e.verb === "lose-life") && subjectReachesPlayer(e.subject));
}

/** Can this subject be a player other than you? An untyped subject, a `player` one, or an `anyOf` with a player or an untyped branch; control `you` and the card itself are not. */
function subjectReachesPlayer(s: SubjectFilter): boolean {
  if (s.control === "you" || s.self === true) return false;
  // A branch inherits the parent's type: Sonar Strike's `{type: creature, anyOf: [{combat: attacking}, {tapped: true}]}` names creatures only.
  const typed = (b: Partial<SubjectFilter>): boolean => (b.type ?? s.type) !== undefined || (b.subtype ?? s.subtype) !== undefined;
  if (s.anyOf !== undefined && s.anyOf.length > 0) return s.anyOf.some((b) => b.control !== "you" && (b.player === true || !typed(b)));
  return s.player === true || !typed(s);
}

/** Can this subject be a permanent that is not only yours? See `effectKind.reachesPermanent`. A branch inherits the parent's type and control, as in `subjectReachesPlayer`. */
function subjectReachesPermanent(s: SubjectFilter): boolean {
  if (s.control === "you" || s.self === true) return false;
  // A branch counts when it is neither yours nor a player: a typed one ("planeswalker") and an untyped, non-player one both name something that is not a player.
  const branchOk = (b: Partial<SubjectFilter>): boolean => (b.control ?? s.control) !== "you" && (b.player ?? s.player) !== true;
  if (s.anyOf !== undefined && s.anyOf.length > 0) return s.anyOf.some(branchOk);
  return s.player !== true;
}

/** The subject names creatures and nothing else (a typed `creature`, never a player or a planeswalker): the target of a Radiance spell. */
const onlyCreatures = (subject: SubjectFilter | undefined): boolean => subject !== undefined && subjectTypes(subject).length > 0 && subjectTypes(subject).every((t) => t === "creature");

/** `effectKind.reachesPermanent` for one ability. The effect subject decides; where derive kept NONE (Aethertorch Renegade: the "Pay {E}{E}" cost leaves the effect subject-less) the ability's own TARGETED damage
 *  emits decide, as `abilityReachesPlayer` does. */
function abilityReachesPermanent(a: { effect: { subject?: SubjectFilter }; emits?: { verb: string; subject: SubjectFilter }[] }): boolean {
  if (a.effect.subject !== undefined) return a.effect.subject.scope === "target" && subjectReachesPermanent(a.effect.subject);
  return (a.emits ?? []).some((e) => e.verb === "non-combat-damage" && e.subject.scope === "target" && subjectReachesPermanent(e.subject));
}

/** A `targeting-ban` ability that protects something of YOURS whoever bans (`banProtects`, #1266, owner 2026-11-12). Never the card itself (`subject.self`) and never a subject that is only opponents'. */
function banProtectsYours(a: { targetingBan?: { source: { control?: string } }; effect: { subject?: SubjectFilter } }, typeLine: string): boolean {
  if (a.targetingBan === undefined) return false;
  const subject: SubjectFilter = a.effect.subject ?? { control: "any", token: null };
  if (subject.self === true || subject.control === "opp") return false;
  return a.targetingBan.source.control === "opp"
    || subject.control === "you"
    || /\baura\b/i.test(typeLine)
    || subject.zone === "graveyard"
    || (subject.scope === "all" && subjectTypes(subject).some((t) => t === "creature" || t === "permanent"));
}

/** A search SUBJECT that can only be a land (#1266): typed `land` ("a basic land card"), a LAND TYPE ("a Mountain card", "a basic Plains, Swamp, or Forest card", "a Gate card": Alpine Guide, Abzan Monument,
 *  District Guide), or an `anyOf` whose every branch is one of those ("a basic land card or Gate card"). Derive sometimes files a land type under `type` (The Cave of Two Lovers: ["mountain", "cave"]), so both
 *  fields take the same words. Nothing typed at all is NOT land-only ("a card named X", "a card"); a Shrine is no land. */
function landOnlySubject(subject: { type?: string | string[]; subtype?: unknown; anyOf?: { type?: string | string[]; subtype?: unknown }[] }): boolean {
  const landWord = (w: unknown): boolean => w === "land" || LAND_TYPES.has(String(w).toLowerCase());
  if (subject.type !== undefined) return [subject.type].flat().every(landWord);
  if (subject.subtype !== undefined) return [subject.subtype].flat().every(landWord);
  return subject.anyOf !== undefined && subject.anyOf.length > 0 && subject.anyOf.every(landOnlySubject);
}

/** The `SubjectFilter` fields that narrow WHICH permanents a bare `type: permanent` names (#1557): a colour, a chosen colour or type, a rule derive marks (`selection`: all-but, votes, pile, attached-to, chosen), a supertype, a status, a keyword, a counter, a stat, a subtype.
 *  A subject carrying any of them is not "all permanents". */
const NARROWS_PERMANENT: readonly string[] = ["chosenColor", "chosenType", "colors", "notColors", "colorCount", "allColors", "selection", "notType", "allTypes", "subtype", "notSubtype", "legendary", "basic", "snow", "tapped",
  "keyword", "notKeyword", "counter", "stats", "owner", "named", "combat", "modified", "historic", "outlaw", "commander", "relation"];

/** A subject that INCLUDES lands (#1554): its type list names `land` (or a land type), or a branch of its `anyOf` does ("artifacts, creatures, and lands": Jokulhaups, Obliterate; "creatures and lands": Devastation), or it is a genuinely UNRESTRICTED `permanent`
 *  (#1557: Apocalypse, Worldfire, Dimensional Breach: "all permanents" names lands, and no field narrows it -- see `NARROWS_PERMANENT`).
 *  CEILING: a bare `permanent` that derive still files without its restriction counts. Derive 468 marks "of the color of your choice" (Wash Out), "all but N" (Razia's Purification, Mount Doom), "the permanent with the most votes" (Council's Judgment), "attached to creatures" (End Hostilities),
 *  "colored permanents" (All Is Dust) and "the pile of their choice" (Liliana of the Veil); a restriction written some other way and not read stays an unrestricted `permanent` here; the pile (Whims of the Fates), "unless" (Selective Obliteration) and name-set (Apocalypse Chime) restrictions are read since derive 468 (`selection`) */
function includesLandSubject(subject: { type?: string | string[]; subtype?: unknown; notType?: string[]; anyOf?: { type?: string | string[]; subtype?: unknown; notType?: string[] }[] }): boolean {
  if ((subject.notType ?? []).includes("land")) return false;
  const types = subject.type !== undefined ? [subject.type].flat() : subject.subtype !== undefined ? [subject.subtype].flat() : [];
  if (types.some((t) => t === "land" || LAND_TYPES.has(String(t).toLowerCase()))) return true;
  if (types.includes("permanent") && !NARROWS_PERMANENT.some((k) => (subject as Record<string, unknown>)[k] !== undefined)) return true;
  return (subject.anyOf ?? []).some(includesLandSubject);
}

/** A debuff amount ("-5/-5", "-0/-3", "-X/-X, where X is the mana value of the exiled card") whose TOUGHNESS half is negative: the half after the slash opens with a minus
 *  and is not "-0". `+2/-2` counts (it kills a 2-toughness creature); "-2/-0" and "-2/+0" do not. */
function lowersToughness(amount: string | undefined): boolean {
  const m = /^\s*[+\-−]?\w+\s*\/\s*([+\-−])\s*(\w+)/.exec(amount ?? "");
  return m !== null && (m[1] === "-" || m[1] === "−") && m[2] !== "0";
}

/** The TYPES a subject names for ANSWER-CLASS purposes: its `type` and each `anyOf` branch's, never a subtype (unlike `subjectTypes`, which files a bare subtype under `permanent`). */
function classTypes(s: { type?: string | string[]; allTypes?: string[]; anyOf?: { type?: string | string[] }[] }): string[] {
  // A COMPOUND noun ("artifact creature": `allTypes`) names EVERY type it lists (owner 2026-11-13): Hearth Charm's "target artifact creature" reaches the creature class and the artifact class, both at NARROW_WEIGHT (`compoundSubject`, read by `colourLockedSubject`).
  if (s.allTypes?.includes("creature") === true) return [...s.allTypes];
  return [...[s.type ?? []].flat(), ...(s.anyOf ?? []).flatMap((b) => [b.type ?? []].flat())];
}
/** A COMPOUND NOUN: a subject that names two or more types at once ("artifact creature", "enchantment creature", "land creature"), which derive stores as `allTypes`. It is narrower than either class, and counts like a bare subtype or a colour lock (owner 2026-11-13).
 *  An "or" ("artifact or creature") is a type LIST, not a compound, and stays whole in both classes.
 *  CEILING: derive stores "land creature or nonbasic land" (Bumi Bash) and "enchanted creature or enchantment creature" (Feast of Dreams) as ONE compound subject, so the land row of the first and the "enchanted creature" half of the second are read as the compound. */
const compoundSubject = (b: { allTypes?: readonly string[] }): boolean => (b.allTypes ?? []).length > 1;

/** A BARE SUBTYPE NAMES ITS CLASS, NARROWLY (owner 2026-11-13, #1266): "Destroy target Aura attached to a creature" (Devout Harpist, Piety Charm) answers enchantments, and only the ones that are Auras. Included: Aura and Saga (enchantment), Equipment (artifact). A subject
 *  that names a type beside the subtype ("target artifact creature") is not bare. The class is the TARGET's: "attached to a creature" names the host and is no creature class. A bare subtype is marked like a colour lock, so it counts at NARROW_WEIGHT (`bareSubtypeSubject`). */
const BARE_SUBTYPE_CLASS: Record<string, string> = { aura: "enchantment", saga: "enchantment", equipment: "artifact" };
function bareSubtypeClasses(b: { type?: string | readonly string[]; subtype?: unknown; allTypes?: readonly string[] }, outerType?: string | readonly string[]): string[] {
  if ([b.type ?? outerType ?? []].flat().length > 0 || (b.allTypes ?? []).length > 0) return [];
  return [b.subtype ?? []].flat().flatMap((t) => BARE_SUBTYPE_CLASS[String(t).toLowerCase()] ?? []);
}
const bareSubtypeSubject = (b: { type?: string | readonly string[]; subtype?: unknown; allTypes?: readonly string[] }, outerType?: string | readonly string[]): boolean => bareSubtypeClasses(b, outerType).length > 0;

/** Can this subject be a permanent of answer class `cls`? A named type, or an unrestricted `permanent` (every class; "nonland permanent" is not a land).
 *  A subject with `umbrella: "permanent"` ("target spell or permanent": Venser, Shaper Savant, Jeskai Revelation) lists the types derive expands the umbrella to, and that list has no land; the umbrella itself is every permanent, so on the battlefield it reaches a land
 *  too (#1266). Not when something narrows it (`NARROWS_PERMANENT`: Aether Gust's colours, Divide by Zero's mana value 1 or greater, which a land has neither of), and "nonland permanent" is `notType: [land]`, no umbrella. */
function subjectReachesClass(bare: boolean, s: { type?: string | string[]; subtype?: unknown; allTypes?: string[]; notType?: string[]; umbrella?: string; zone?: string; fromZone?: string; anyOf?: { type?: string | string[]; subtype?: unknown }[] }, cls: string): boolean {
  const types = classTypes(s);
  // A BASIC LAND TYPE NAMES A LAND (owner 2026-11-13, #1266): "Destroy target Forest, green enchantment, or green planeswalker" (Nissa's Defeat), "Destroy target Scarecrow or Plains" (Boggart Arsonists). Whole subtype words; "forestwalk" is no subtype.
  if (cls === "land" && [s, ...(s.anyOf ?? [])].some((b) => [b.subtype ?? []].flat().some((t) => BASIC_LAND_TYPE_SET.has(String(t).toLowerCase())))) return true;
  if (bare && [s, ...(s.anyOf ?? [])].some((b) => bareSubtypeClasses(b, s.type).includes(cls))) return true;
  if (types.includes(cls) || (types.includes("permanent") && (cls !== "land" || !(s.notType ?? []).includes("land")))) return true;
  return cls === "land" && s.umbrella === "permanent" && (s.zone ?? s.fromZone ?? "battlefield") === "battlefield"
    && !NARROWS_PERMANENT.some((k) => (s as Record<string, unknown>)[k] !== undefined);
}
/** The subject the answer-class options read: the effect's, else -- where derive kept none (Aethertorch Renegade, Dynavolt Tower: the "Pay {E}{E}" cost leaves the effect subject-less) -- the subject of the ability's first TARGETED damage emit, as `abilityReachesPermanent` does. */
function answerSubject(a: { effect: { subject?: SubjectFilter }; emits?: { verb: string; subject: SubjectFilter }[] }): SubjectFilter | undefined {
  return a.effect.subject ?? (a.emits ?? []).find((e) => e.verb === "non-combat-damage" && e.subject.scope === "target")?.subject;
}
/** Is this ability's amount at least `n`, or no printed number (X, "its power")? See `effectKind.amountAtLeast`. */
function amountAtLeast(amount: string | undefined, n: number): boolean {
  return amount !== undefined && (!/^\d+$/.test(amount) || Number(amount) >= n);
}

const subtypesOf = (s: { subtype?: unknown }): string[] => (s.subtype === undefined ? [] : [s.subtype].flat().map((t) => String(t).toLowerCase()));
/** An ability that only a BLOCK makes: it triggers on "blocks" / "becomes blocked", or `subject` is a creature blocking (`combat`) or blocking WITH another (`combatWith`). See `notBlockCombat`. */
function blockCombat(a: { trigger?: { verbs?: string[] } }, subject: { combat?: string; combatWith?: { role?: string } }): boolean {
  return subject.combat === "blocking" || subject.combatWith?.role === "blocking" || (a.trigger?.verbs ?? []).some((v) => v === "blocks" || v === "becomes-blocked");
}
const KILL_VERBS: readonly string[] = ["dies", "exiled", "leaves"];

function clauseHolds(clause: RuleClause, dc: DeckCard, set: RuleSet): boolean {
  switch (clause.op) {
    case "oracle":
      return pattern(set, clause.pattern).test(ownText(dc.card));
    case "countsAsLand":
      return countsAsLand(dc.card);
    case "manaLine":
      return cardLines(dc, true).some((l) =>
        // A LOYALTY ABILITY THE WALKER CANNOT USE THE TURN IT IS CAST is no line of the Role (owner 2026-10-13, #1190: the loyalty test of the accelerants and the colour sources governs the role).
        (!isLoyaltyAbility(l) || usableLoyalty(l))
        && (clause.source === undefined || clause.source.includes(l.source))
        && (clause.repeats === undefined || clause.repeats.includes(l.repeats))
        && (clause.producesToken === undefined || l.producesToken !== null)
        // `amountAtLeast`: the line's FIXED amount is at least N. A scaling line (`fixed` null) never counts: the printed pattern this replaced needed a stated 2+.
        && (clause.amountAtLeast === undefined || (l.amount.fixed !== null && l.amount.fixed >= clause.amountAtLeast))
        // `bareTap`: the cost is exactly {T} -- it taps itself and pays nothing else (no mana, sacrifice of itself or another, life, counter, other tap, loyalty, consumed resource or other piece).
        && (clause.bareTap === undefined || isBareTap(l.cost)));
    case "landEntersTapped":
      return ["unconditional", "unclassified"].includes(classifyLand(dc.card, dc.tags).template);
    case "landFetch":
      // ...and the same for a walker's land fetch (Nissa, Worldwaker's -7 from loyalty 3): a fetch line that is a loyalty ability counts only if usable on the cast turn.
      return dc.tags?.landFetch !== undefined && (() => {
        const fetches = cardLines(dc, true).filter((l) => l.source === "fetch");
        return fetches.length === 0 || fetches.some((l) => !isLoyaltyAbility(l) || usableLoyalty(l));
      })();
    case "keyword": {
      const wanted = new Set(clause.in.map((k) => k.toLowerCase()));
      return (dc.card.keywords ?? []).some((k) => wanted.has(k.toLowerCase()));
    }
    case "rule": {
      const other = set.rules.find((r) => r.id === clause.id);
      if (other === undefined) throw new Error(`unknown rule: ${clause.id}`);
      return ruleMatches(other, dc, set);
    }
    case "enchants": {
      const e = dc.tags?.characteristics?.enchants as (Parameters<typeof subjectTypes>[0] & { control?: string; anyOf?: { control?: string }[] }) | undefined;
      if (e === undefined) return false;
      const branches = e.anyOf !== undefined && e.anyOf.length > 0 ? e.anyOf as (typeof e)[] : [e];
      return branches.some((b) => {
        // A branch that names only a SUBTYPE does not count ("Enchant Mountain": `subjectTypes` reads a bare subtype as "permanent", and a land type is no creature).
        const types = b.type === undefined ? [] : [b.type].flat();
        const control = b.control ?? e.control;
        return (types.includes("creature") || types.includes("permanent")) && control !== "opp"
          && (clause.control === undefined || (control !== undefined && clause.control.includes(control)));
      });
    }
    case "hostEffect": {
      const abilities = dc.tags?.abilities ?? [];
      return abilities.some((a) =>
        a.host === true && clause.kinds.includes(a.effect.kind)
        && (clause.raises !== true || raisesStat(a.amount))
        && (clause.grantsAny === undefined || (a.grants ?? []).some((g) => clause.grantsAny!.includes(g.toLowerCase())))
        && (clause.grantsNonEmpty !== true || (a.grants ?? []).length > 0)
        && (clause.restricts === undefined || (a.restricts ?? []).some((r) => clause.restricts!.includes(r)))
        && (clause.quoted === undefined || ((a.grants ?? []).length === 0 && quotedGrantIsBenign(abilities, a.clause, clause.quoted.curse)))
        && (clause.unlessPumpInClause !== true || !abilities.some((f) => f.host === true && f.effect.kind === "pump" && f.clause === a.clause)));
    }
    case "abilityMark":
      return (dc.tags?.abilities ?? []).some((a) => a[clause.mark] === true);
    case "typeLine":
      return (dc.card.typeLine ?? "").toLowerCase().includes(clause.contains);
    case "effectKind":
      return (dc.tags?.abilities ?? []).some((a) =>
        clause.in.includes(a.effect.kind)
        && (clause.repeats === undefined || clause.repeats.includes(a.repeats ?? null))
        // WHO IT HAPPENS TO, when the effect names one (#574): The Chain Veil's "you lose 2 life" is
        // `player-life-loss` too. An effect with no subject is not refused -- nothing says who.
        && (clause.control === undefined || a.effect.subject?.control === undefined || clause.control.includes(a.effect.subject.control))
        && (clause.scope === undefined || (a.effect.subject?.scope !== undefined && clause.scope.includes(a.effect.subject.scope))
          || (clause.orTargetPlayerMass === true && (a.emits ?? []).some((e) => e.verb === "leaves" && e.subject.targetPlayer === true && !landOnlySubject(e.subject)
            && (clause.control === undefined || clause.control.includes(e.subject.control as string))
            && (clause.notOwnedByYou !== true || e.subject.owner !== "you"))))
        && (clause.notSelfTargeted !== true || (a.effect.subject as { targets?: { self?: boolean } } | undefined)?.targets?.self !== true)
        && (clause.notOnFlip !== true || a.onFlip === undefined)
        && (clause.notOwnedByYou !== true || a.effect.subject?.owner !== "you")
        && (clause.notSelf !== true || a.effect.subject?.self !== true)
        && (clause.notOwnTax !== true || a.effect.subject?.control !== "you" || a.unless?.payer === "controller")
        && (clause.ofKind === undefined || clause.ofKind.includes(a.kind))
        && (clause.banProtects !== true || banProtectsYours(a, dc.card.typeLine ?? ""))
        && (clause.pairedInstantExile !== true || pairedInstantExile(dc.tags?.abilities ?? [], a))
        && (clause.notVictimMay !== true || !(a.emits ?? []).some((e) => e.victimMay === true))
        && (clause.librarySearch === undefined || (a.librarySearch !== undefined && clause.librarySearch.includes(a.librarySearch)))
        && (clause.notRedirect !== true || !(a.emits ?? []).some((e) => e.redirect === true))
        && (clause.notAnchorsMass !== true || a.amount === undefined || a.effect.subject?.scope !== "target" || !onlyCreatures(a.effect.subject) || !(dc.tags?.abilities ?? []).some((f) => f !== a && f.clause === a.clause && f.effect.kind === a.effect.kind
          && f.amount === a.amount && (f.effect.subject?.scope === "all" || f.effect.subject?.scope === "each")))
        && (clause.reachesPlayer !== true || abilityReachesPlayer(a))
        && (clause.reachesPermanent !== true || abilityReachesPermanent(a))
        && (clause.notLandOnly !== true || !(a.effect.subject !== undefined && landOnlySubject(a.effect.subject)))
        && (clause.toughnessDown !== true || lowersToughness(a.amount))
        && (clause.notBlockCombat !== true || !blockCombat(a, a.effect.subject ?? {}))
        && (clause.notTokenOnly !== true || a.effect.subject?.token !== true)
        // The count of a hand-fill: `amount` on a `to-hand` ability, `toHand` on a typed dig that kept its `search` kind (a `search` ability with neither is no hand-fill, so none of the three options below match it).
        && (clause.pickOne !== true || (a.chooses === true && (a.effect.kind === "to-hand" ? a.amount : a.toHand) === "1"))
        && (clause.toHand !== true || a.toHand !== undefined)
        && (clause.named !== true || a.named === true)
        && (clause.netZero !== true || a.netZero === true)
        && (clause.grantsAny === undefined || (a.grants ?? []).some((g) => clause.grantsAny!.includes(g.toLowerCase())))
        && (clause.notGrantsSelf !== true || a.grantsSelf !== true)
        && (clause.reachesClass === undefined || (answerSubject(a) !== undefined && subjectReachesClass(clause.bareSubtype === true, answerSubject(a)!, clause.reachesClass)))
        && (clause.untyped !== true || (answerSubject(a) !== undefined && classTypes(answerSubject(a)!).length === 0 && subjectReachesPermanent(answerSubject(a)!)))
        && (clause.amountAtLeast === undefined || amountAtLeast(a.amount, clause.amountAtLeast)));
    // CEILING: `removal.targeted` / `removal.land` read derived emits, and derive mislabels some cards, so the role is wrong on them by name.
    //   LOST (real removal, no usable emit): Polymorph, Transmogrify, Chaos Mutation, Divergent Transformations (derive reads the polymorph family as played on YOUR creature, `control: you`: owner ruling 2026-10-02 / #962,
    //   "primary use", so the opponent use is dropped on purpose; the role pays for it);
    //   Venser, the Sojourner (its removal is the −8 emblem's "exile target permanent", which lives on the emblem's own node by design, 2026-09-08 emblems-as-nodes; its +2 is a
    //   permanent you own, which its emit's `control: you` and `owner: you` both refuse). Ownership is read per ability (its effect subject, then its emit's), not across the clause (#1366): Word of Undoing's target bounce
    //   keeps the role though a second bounce in its clause is "Auras you own". A paired flicker's own emit carries `owner: you` and `control: you` (Charming Prince, Meneldor, Slip On the Ring), so nothing else moved.
    //   RIGHT FOR A WRONG REASON: Audacious Swap (its tuck counts because derive reads "If it's a land card, they put it onto the battlefield" -- a different card -- as a
    //   one-branch return of the target, `returnIf`, which `notFlickered` lets through).
    //   NOT A DEFECT, owner ruling 2026-10-20 (#1295): a kill decided by a coin flip (Mogg Assassin, Crooked Scales, Creepy Doll, Boompile, Plasma Caster) IS removal;
    //   only a losing-side shrink is refused (`notOnFlip`, Orcish Captain).
    case "emits":
      return (dc.tags?.abilities ?? []).some((a) =>
        (clause.notOwnedByYou !== true || a.effect.subject?.owner !== "you")
        && (clause.oneShotToughnessDebuff !== true || a.effect.kind !== "debuff" || (lowersToughness(a.amount) && a.repeats !== "continuous"))
        && (clause.notFromHandCost !== true || !/from your hand/i.test(a.cost ?? ""))
        && (clause.notFlickered !== true || !(dc.tags?.abilities ?? []).some((f) => f.effect.kind === "flicker" && f.clause === a.clause && f.delayedUntil === undefined && f.returnIf !== true && f.effect.subject?.control !== "opp"))
        && (a.emits ?? []).some((e) =>
          clause.verbs.includes(e.verb)
          && (clause.abilityKind === undefined || clause.abilityKind.includes(a.effect.kind))
          && (clause.edict !== true || e.subject.edict === true)
          && (clause.notViaCraft !== true || e.subject.viaCraft !== true)
          && (clause.notEdict !== true || e.subject.edict !== true)
          && (clause.notBlockCombat !== true || !blockCombat(a, e.subject))
          && (clause.notTokenOnly !== true || e.subject.token !== true)
          && (clause.notAttachedTo !== true || [e.subject.type].flat().includes("permanent") || !subtypesOf(e.subject).some((t) => t === "aura" || t === "equipment")
            || !(dc.tags?.abilities ?? []).some((f) => f !== a && f.clause === a.clause && (f.emits ?? []).some((g) => g.subject.scope === "target")))
          && (clause.notCountedOppKill !== true || e.subject.control !== "opp" || !KILL_VERBS.includes(e.verb) || ((a.amount === undefined || !/^\d+$/.test(a.amount)) && (e.subject.selection !== "counted" || sacrificesHalf(dc.card.oracleText))))
          && (clause.notBesideTargetedKill !== true || !KILL_VERBS.includes(e.verb) || !(dc.tags?.abilities ?? []).some((f) => f !== a && f.clause === a.clause
            && (f.emits ?? []).some((g) => g.subject.scope === "target" && KILL_VERBS.includes(g.verb))))
          && (clause.notBlinkedBack !== true || !(dc.tags?.abilities ?? []).some((f) => f.effect.kind === "flicker" && f.returnIf !== true && f.effect.subject?.control !== "opp"
            && (f.delayedUntil === undefined ? f.clause === a.clause : f.delayedUntil === "next-end-step" || f.delayedUntil === "next-upkeep")))
          && (clause.notVictimMay !== true || e.victimMay !== true)
          && (clause.amountAtLeast === undefined || (a.amount !== undefined && /^\d+$/.test(a.amount) && Number(a.amount) >= clause.amountAtLeast))
          && (clause.notOwnedByYou !== true || e.subject.owner !== "you")
          && (clause.notSelf !== true || e.subject.self !== true)
          && (clause.notPairedTarget !== true || !(dc.tags?.abilities ?? []).some((f) => f !== a && f.clause === a.clause
            && (f.emits ?? []).some((g) => g.subject.scope === "target" && g.subject.fromZone === "graveyard" && g.subject.control === e.subject.control
              && JSON.stringify(g.subject.type) === JSON.stringify(e.subject.type))))
          && (clause.control === undefined || clause.control.includes(e.subject.control))
          && (clause.zone === undefined || clause.zone.includes(e.subject.zone ?? null))
          && (clause.type === undefined || (subjectTypes(e.subject).length > 0 && subjectTypes(e.subject).every((t) => clause.type!.includes(t))))
          && (clause.notLandOnly !== true || !landOnlySubject(e.subject))
          && (clause.notMassLand !== true || !landOnlySubject(e.subject) || (a.amount !== undefined && !(/^\d+$/.test(a.amount) && Number(a.amount) >= 3)))
          && (clause.landOnly !== true || landOnlySubject(e.subject))
          && (clause.includesLand !== true || includesLandSubject(e.subject))
          && (clause.typeAny === undefined || subjectTypes(e.subject).some((t) => clause.typeAny!.includes(t)))
          && (clause.scope === undefined || clause.scope.includes(e.subject.scope ?? null) || (clause.orTargetPlayerMass === true && e.subject.targetPlayer === true))
          && (clause.fromZone === undefined || clause.fromZone.includes(e.subject.fromZone ?? null))
          && (clause.counter === undefined || (e.subject.counter !== undefined && clause.counter.includes(e.subject.counter)))
          && (clause.reachesClass === undefined || subjectReachesClass(clause.bareSubtype === true, e.subject, clause.reachesClass))
          && (clause.tuck !== true || e.tuck === true))
        && (clause.repeats === undefined || clause.repeats.includes(a.repeats ?? null)));
    case "subtype":
      return (dc.tags?.characteristics?.subtypes ?? []).some((s) => clause.in.includes(s.toLowerCase()));
    case "powerOverMv": {
      const power = Number(dc.card.power);
      // `*`, `1+*` and a missing power are all NaN, and a comparison against NaN is false -- which
      // is the answer we want: a creature whose power is defined by the board is not a beater whose
      // size can be read off the card.
      return power - dc.card.manaValue >= clause.atLeast;
    }
    case "oneShotNetsMana": {
      const line = (dc.card.typeLine ?? "").toLowerCase();
      // A card with a PERMANENT face is not a one-shot however its other half is typed. Bramble
      // Familiar // Fetch Quest is a Creature with a Sorcery Adventure and its `{T}: Add {G}` is a
      // mana DORK; Blazing Firesinger // Seething Song is the same shape. Reading the type-line
      // union alone cut both, which is the `isLand` mistake one card layout over.
      if (!/\b(instant|sorcery)\b/.test(line)) return true;
      if (/\b(creature|artifact|enchantment|land|planeswalker|battle)\b/.test(line)) return true;
      const net = oneShotNet(dc);
      // Unreadable means the card does not state a fixed number — "Add {R} for each card in target
      // opponent's hand" (Jeska's Will, Rousing Refrain, Path of the Pyromancer). Those are the most
      // explosive rituals in the format, so a missing answer must keep the card rather than cut it.
      if (net === undefined) return true;
      return net >= clause.atLeast;
    }
    case "anyOf":
      return clause.clauses.some((c) => clauseHolds(c, dc, set));
    case "allOf":
      return clause.clauses.every((c) => clauseHolds(c, dc, set));
    case "not":
      return !clauseHolds(clause.clause, dc, set);
  }
}

const transformsIntoLand = (dc: DeckCard): boolean => transformsIntoLandCard(dc.card);

/** Does this card fill the rule's category only through the rule's WEAK printed words (`Rule.weakOracle`)? Urza's Sylex for `stax.text`. False for a rule without one, and for a card that also reads a strong alternative. */
export function weakByOracle(rule: Rule, dc: DeckCard, set: RuleSet = loadRules()): boolean {
  const w = rule.weakOracle;
  if (w === undefined) return false;
  const text = ownText(dc.card);
  return pattern(set, w.weak).test(text) && !pattern(set, w.strong).test(text);
}

export function ruleMatches(rule: Rule, dc: DeckCard, set: RuleSet = loadRules()): boolean {
  // A CARD THAT TRANSFORMS INTO A LAND IS NEVER RAMP (owner 2026-10-10, #1174): "things that do
  // transform are not ramp" -- not even through its front, so Treasure Map's three Treasures on
  // transforming do not make it a Ramp card. Its other front-face roles stand.
  if (rule.category === "ramp" && transformsIntoLand(dc)) return false;
  return (
    rule.match.every((c) => clauseHolds(c, dc, set)) &&
    !(rule.not ?? []).some((c) => clauseHolds(c, dc, set))
  );
}

/** The type words a removal clause can name, and what each answers. `permanent` is not a class of
 *  its own -- it expands through `answerClassAliases`, because a card that destroys any permanent
 *  answers every class, and treating it as a sixth would report a Vindicate deck as having no
 *  enchantment removal. */
const KNOWN_CLASSES: Record<string, true> = {
  creature: true, permanent: true, artifact: true, enchantment: true, planeswalker: true, land: true,
  // Lightning Bolt's object: a creature or a planeswalker (issue #581), expanded by the aliases.
  "any target": true,
};

/** What a matched rule says about the KIND of answer it contributes, per class.
 *
 *  Both default to false, which is the ordinary case: a destroy is an answer that is not
 *  recursion-proof, and a one-shot graveyard exile answers a card rather than an engine. */
export interface AnswerMarks {
  /** The threat is EXILED. The owner's ruling (design §2.1): a tuck can be drawn or tutored again
   *  and a destroyed permanent can be reanimated, so exile is the only recursion-proof answer. */
  exile: boolean;
  /** The answer keeps answering -- a replacement effect, a static prohibition, or an activated
   *  ability that can be used again. Only graveyard hate carries this today, because it is the one
   *  class §12.3 says does not score on count at all. */
  recurring: boolean;
  /** EVERY CLAUSE THAT REACHES THE CLASS CARRIES A CONDITION ON ITS TARGET that is not a colour (Fatal Push, Prohibit): the card answers a narrow set of what the class names. Counts whole. */
  narrow: boolean;
  /** EVERY CLAUSE THAT REACHES THE CLASS IS RESTRICTED TO A COLOUR (Combust "white or blue creature", Pyroblast, Soul Rend, King Crab, Aether Gust; owner 2026-11-13): the card counts as an answer at `NARROW_WEIGHT`. A card with one
   *  unrestricted clause for the class (a modal Murder beside a Pyroblast mode) is not locked for it. A colour a card CHOOSES or EXCLUDES ("nonblack", `notColors`) is not a lock: Doom Blade answers nearly every creature. */
  colourLocked: boolean;
}

/** Does this subject name a colour the target must have? `colors` on the subject, or on EVERY branch of its `anyOf` (derive writes "white or blue creature" as `colors: [W, U]`). With `cls`, only the branches that can be a permanent of that answer class are judged: Nissa's Defeat
 *  ("target Forest, green enchantment, or green planeswalker") is locked for enchantment and planeswalker and not for land. "Colorless" is stored as colour C and LOCKS too (owner 2026-11-13: Infernal Reckoning, Goblin Cratermaker).
 *  CEILING: a CHOSEN colour (`chosenColor`) is not read as a lock. */
function colourLockedSubject(s: { colors?: readonly string[]; anyOf?: { type?: string | readonly string[]; subtype?: unknown; colors?: readonly string[]; allTypes?: readonly string[] }[]; type?: string | readonly string[]; subtype?: unknown; allTypes?: readonly string[] } | undefined, cls?: string): boolean {
  if (s === undefined) return false;
  // A BARE SUBTYPE ("Aura") is locked the same way, to weigh NARROW_WEIGHT (owner 2026-11-13).
  // A COMPOUND NOUN ("artifact creature") is narrower than either class and weighs the same (owner 2026-11-13).
  const coloured = (b: { type?: string | readonly string[]; subtype?: unknown; colors?: readonly string[]; allTypes?: readonly string[] }): boolean => (b.colors ?? []).length > 0 || bareSubtypeSubject(b, s.type) || compoundSubject(b);
  if (coloured(s)) return true;
  const branches = (s.anyOf ?? []).filter((b) => cls === undefined || subjectReachesClass(true, { ...b, type: (b.type ?? s.type) as string | string[] | undefined, allTypes: b.allTypes as string[] | undefined }, cls));
  return branches.length > 0 && branches.every(coloured);
}

/** A COLOUR CONDITION ON THE TARGET, read off the gate (Pyroblast "Destroy target permanent if it's blue", Soul Rend "if it's white"): derive keeps it as the ability's `gate` and puts no colour on the subject. */
const COLOUR_GATE = /^(?:it'?s|that (?:creature|permanent) is) (?:white|blue|black|red|green|colou?rless)\b/;
const colourGated = (dc: DeckCard, a: { gate?: { text: string } }): boolean => {
  if (a.gate === undefined) return false;
  const gate = a.gate.text.toLowerCase().replace(/\u2019/g, "'");
  if (!COLOUR_GATE.test(gate)) return false;
  if (isTargetCondition(ownText(dc.card), a.gate.text)) return true;
  // "that creature is black or red" (Inquisitor's Snare) points BACK at a target named in an earlier sentence ("Prevent all damage target attacking or blocking creature would deal this turn."). CEILING: any "target" before the gate in the card's own text counts as that antecedent.
  if (!gate.startsWith("that ")) return false;
  const text = ownText(dc.card).toLowerCase().replace(/\u2019/g, "'");
  const at = text.indexOf(gate);
  return at > 0 && /\btarget\b/.test(text.slice(0, at));
};

type TargetSubject = { type?: string | readonly string[]; colors?: readonly string[]; control?: string; anyOf?: TargetSubject[] };

/** The card with every ability taken out that `restricted` names. A DERIVED answer rule that still matches this card is not restricted (colour-locked, or narrow) for that class (owner 2026-11-13). Same card when nothing is restricted, so the usual case pays no second
 *  match. CEILING: the ability is taken out whole, so a card whose ONE ability carries a restricted emit beside an unrestricted answer emit reads as restricted, and an uncoloured target of the same types in the same clause is taken out with it. */
function withoutAbilities(dc: DeckCard, restricted: (a: NonNullable<DeckCard["tags"]>["abilities"][number]) => boolean, sameTarget: (s: TargetSubject) => boolean): { dc: DeckCard; any: boolean } {
  const abilities = dc.tags?.abilities ?? [];
  if (!abilities.some(restricted)) return { dc, any: false };
  const targets = (a: (typeof abilities)[number]): (TargetSubject & { scope?: string })[] =>
    ([a.effect.subject, ...(a.emits ?? []).map((e) => e.subject)] as (TargetSubject & { scope?: string } | undefined)[]).filter((s): s is TargetSubject & { scope?: string } => s?.scope === "target");
  // An ability in the SAME CLAUSE aimed at the same types is the same target again, by back-reference ("...that's red or white loses all abilities. Target creature you control deals damage to that permanent": Flourishing Grapple).
  const key = (a: (typeof abilities)[number], s: TargetSubject): string => `${a.clause ?? 0}|${JSON.stringify(s.type ?? null)}`;
  const restrictedKeys = new Set(abilities.filter(restricted).flatMap((a) => targets(a).filter(sameTarget).map((s) => key(a, s))));
  const sameTargetAgain = (a: (typeof abilities)[number]): boolean => {
    const ts = targets(a).filter((s) => s.control !== "you" && !sameTarget(s));
    return ts.length > 0 && ts.every((s) => restrictedKeys.has(key(a, s)));
  };
  return { dc: { ...dc, tags: { ...dc.tags!, abilities: abilities.filter((a) => !restricted(a) && !sameTargetAgain(a)) } }, any: true };
}

/** Which answer classes a card covers, per `answerClass` / `answerClassFrom`.
 *
 *  `permanent` is expanded through `answerClassAliases`: a card that destroys any permanent answers
 *  every class, and treating it as its own sixth class would report a Vindicate deck as having no
 *  enchantment removal. */
export function answerClassesOf(dc: DeckCard, set: RuleSet = loadRules()): Map<string, AnswerMarks> {
  const out = new Map<string, AnswerMarks>();
  // A class can be reached by several rules -- every exile removal matches both `answers.typed` and
  // `answers.typed.exile` -- so marks are OR-ed onto the existing entry, never overwritten.
  const mark = (cls: string, mode: Rule["mode"], narrow = false, colourLocked = false): void => {
    // NARROW, and COLOUR-LOCKED, only while every clause that reaches the class is conditional on its target / restricted to a colour.
    const m = out.get(cls) ?? { exile: false, recurring: false, narrow: true, colourLocked: true };
    m.narrow = m.narrow && narrow;
    m.colourLocked = m.colourLocked && colourLocked;
    if (mode === "exile") m.exile = true;
    if (mode === "recurring") m.recurring = true;
    out.set(cls, m);
  };
  for (const rule of set.rules) {
    if (!ruleMatches(rule, dc, set)) continue;
    if (rule.answerClass) {
      // DERIVED RULES: locked when the rule no longer matches once the colour-restricted abilities are taken out, narrow when it no longer matches once the abilities with a condition on their target are (owner 2026-11-13; refinement 2026-10-27).
      const cls = rule.answerClass;
      const colour = withoutAbilities(dc, (a) => colourGated(dc, a) || colourLockedSubject(a.effect.subject as never, cls)
        || (a.emits ?? []).some((e) => e.subject.scope === "target" && colourLockedSubject(e.subject as never, cls)), (t) => colourLockedSubject(t as never, cls));
      const conditioned = withoutAbilities(dc, (a) => a.gate !== undefined && isTargetCondition(ownText(dc.card), a.gate.text), () => true);
      mark(cls, rule.mode, conditioned.any && !ruleMatches(rule, conditioned.dc, set), colour.any && !ruleMatches(rule, colour.dc, set));
    }
    if (rule.answerClassFrom) {
      // THE ONE PRINTED CLASS READER LEFT: `answers.neutralise`, whose classes are the Aura's Enchant line (Imprisoned in the Moon: creature, land or planeswalker). Derive cannot tell "loses all abilities" from "its activated abilities can't be
      // activated" (both are `ability-loss`: Arrest would join, 33 creature gains) and reads "loses all abilities" as a keyword grant on 7 Auras (Mystic Subdual, Sugar Coat, Honest Work), so the Aura stays on its printed words (#1266).
      // The typed destroy / exile answers moved to derived rules (`answers.typed.*`, Rules 51).
      const re = new RegExp(set.patterns[rule.answerClassFrom], "gi");
      for (const m of ownText(dc.card).matchAll(re)) {
        // The capture is the whole OBJECT PHRASE: "Enchant creature, land, or planeswalker" answers three classes. Every class named anywhere in the phrase counts.
        const phrase = m.groups?.class?.toLowerCase();
        if (!phrase) continue;
        // An Aura only YOU can wear ("Enchant creature you control", "you own") answers nothing an opponent has.
        if (/\byou control\b/.test(phrase) || /\byou own\b/.test(phrase)) continue;
        for (const word of Object.keys(KNOWN_CLASSES)) {
          if (!new RegExp(`\\b${word}s?\\b`).test(phrase)) continue;
          for (const cls of set.answerClassAliases[word] ?? [word]) {
            if (cls === "land" && /\bnonland\b/.test(phrase)) continue;
            mark(cls, rule.mode);
          }
        }
      }
    }
  }
  return out;
}
