import ruleSet from "./rules.json" with { type: "json" };
import type { ManaLine, ManaLineSource } from "@edh-seer/tagger";
import type { SubjectFilter } from "@edh-seer/tagger";
import type { DeckCard } from "./types.js";
import { classifyLand } from "./land-conditions.js";
import { cardLines, isLoyaltyAbility, usableLoyalty } from "./mana-lines.js";
import { countsAsLand, transformsIntoLand as transformsIntoLandCard } from "./typeline.js";

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
      /** Refuse an ability whose subject is a spell THAT TARGETS THIS CARD (`subject.targets.self`): Spellwild Ouphe's "Spells that target this creature cost {2} less" cheapens
       *  spells aimed at the card itself, a discount for no other spell (`discountsOtherSpells`). */
      notSelfTargeted?: boolean;
      /** A `debuff` that can KILL: the amount's TOUGHNESS part is negative ("-5/-5", "-0/-3", "-X/-X, where X is ...", "-1/-1"). "-2/-0" shrinks power and kills nothing; an amount that
       *  is not a P/T pair at all does not match. A scaling or unreadable toughness ("-X") counts: the number is not printed, and the card states it as a lethal-shaped shrink. */
      toughnessDown?: true;
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
      /** Refuse an ability one of whose emits the VICTIM MAY DECLINE (`GameEvent.victimMay`): "unless that player exiles cards from their graveyard" (Axebane Ferox), "any player may exile a card from their graveyard" (Carrion Rats),
       *  "its controller may exile three cards ... to ignore this effect" (Lost in Thought) are a price the other player chooses to pay, not graveyard hate (#1266; the same refusal as the edict's `notVictimMay` on `emits`). */
      notVictimMay?: true;
      /** The effect's SUBJECT can be a PLAYER and is not you (#1266, burn): an untyped subject (any target, each opponent, each player), a `player` subject, or an `anyOf` with a player or an untyped
       *  branch ("target player or planeswalker", "each creature and each player"). A subject typed to permanents only ("target creature") is removal, not burn; control `you` ("deals 2 damage to you") is refused;
       *  a subject that is the card itself is refused. */
      reachesPlayer?: true;
      /** Refuse an ability one of whose emits is a damage REDIRECT (`GameEvent.redirect`, #1294): "the next 2 damage ... is dealt to any target instead" (Harm's Way, Glarecaster) deals no damage of its own. */
      notRedirect?: true;
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
      netZero?: true }
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
      /** Refuse an ability whose exile COMES BACK AT ONCE: another ability of the card, of the SAME `clause`, is a `flicker` with no `delayedUntil` whose subject is NOT an opponent's permanent ("Exile target creature, then
       *  return it to the battlefield": Flicker, Eldrazi Displacer). Owner ruling 2026-09-25: an IMMEDIATE flicker is no removal, a DELAYED return (Otherworldly Journey, Flickerwisp: back at the next end step) keeps
       *  its place, so a flicker with `delayedUntil` is not refused (that includes `source-leaves`, the "until this leaves the battlefield" return of Constable of the Realm and Mysterious Limousine, #1295 item 3). A
       *  flicker with `returnIf` is not refused either: the return is on one "If ..." branch and the other keeps the exile (Unyielding Gatekeeper, Vindictive Triumph). A flicker of an OPPONENT's permanent is the "until this leaves the battlefield" shape (Banisher Priest, Glass Casket, Portable Hole), which derive also
       *  reads as a `flicker` and which is the commonest removal there is, so it stays. */
      notFlickered?: true;
      /** Refuse an ability that is PAID by exiling or discarding THIS card from your hand ("{3}, Exile this card from your hand: Target land gains ...": Emrakul the Exigent Doom, Shattered Seraph, Spara's
       *  Adjudicators). Derive reads the exile in the cost as an exile of the target. */
      notFromHandCost?: true;
      /** Refuse an ability that acts on permanents YOU OWN: any ability of the same `clause` (this one, or a paired flicker, delayed or not) whose effect subject has `owner: "you"` ("Return one or two target creatures
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
      /** Refuse an emit the victim may decline (`GameEvent.victimMay`): "its controller may sacrifice it" (Star Athlete, Livio), "unless that player sacrifices it" (Enchanter's Bane). It is the opponent's choice with an
       *  alternative, which is not removal (#1295). */
      notVictimMay?: true;
      /** Refuse an emit about THE CARD ITSELF (`subject.self`): "Exile this card from your graveyard" (renew, channel-like costs) moves the card and is no exile of anything else (#1266, graveyardHate). */
      notSelf?: true;
      /** The ABILITY's effect kind is in this list, tested on the SAME ability as the emit. Manifest dread and "manifests the top card of that player's library" derive a `mill` EMIT under a kind-less
       *  ability (the card goes to the graveyard as a side effect), while a real mill carries the `mill` kind: `abilityKind: ["mill"]` is how `wincon.mill` tells the two apart (#1266). */
      abilityKind?: string[] }
  /** The card's `characteristics.enchants` (the Enchant line, #1315) can be a creature: the filter, or an `anyOf` branch of it ("creature or Vehicle", "artifact or creature"), names
   *  `creature` or `permanent`, and that branch's control is not `opp` (an Aura only an opponent's creature can wear is a curse). `control` narrows to the listed controls ("you":
   *  "Enchant creature you control"). */
  | { op: "enchants"; control?: string[] }
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
  /** A CREATURE WITH HEXPROOF PROTECTS ITSELF, NOT THE BOARD (roadmap I1). The `protection` pattern
   *  is matched anywhere in the oracle text, so Sylvan Caryatid — a mana dork whose printed keyword
   *  is hexproof — counted toward Interaction beside Lightning Greaves. True when EVERY protection
   *  word on the card is one of its own PRINTED KEYWORDS and nothing is granted away.
   *
   *  NARROW ON PURPOSE, and the measurement is why. Over the 71 decks the family splits 79 granted /
   *  20 self-keyword / 41 UNSPLITTABLE by any regex — "this spell can't be countered" and "phases
   *  out" are not keywords at all, and a card can grant with no cue this side of a parser
   *  (Delighted Halfling's "Legendary creature spells you cast can't be countered"). The honest fix
   *  for the residue is a derive-side read of the grant's SUBJECT, which is its own item; this
   *  clause takes only the cases the printed keyword list settles outright. SENTENCE-FORM SELF GRANTS ARE NOW READ (#1289): a sentence whose subject is the
   *  card ("This creature gains indestructible", "Kogla gains ...", an "It gains" after a card-naming sentence with no target) is stripped like
   *  an anti-protection sentence, so a card that also grants to something else keeps its role. */
  | { op: "protectionIsOwnKeyword" }
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

/** The `protection` pattern's own alternatives, as a global matcher, so `protectionIsOwnKeyword`
 *  can ask which of them a card actually says. Kept beside the op rather than read out of
 *  `rules.json` because the op's whole question is about THESE words against a printed keyword
 *  list, and a pattern edit that silently changed the question would be invisible. */
const PROTECTION_WORDS = /hexproof|indestructible|protection from|can't be countered|shroud|phases? out/gi;

/** Protection handed to something else. The templating is fixed enough to read — "creatures you
 *  control GAIN hexproof", "equipped creature HAS indestructible" — and this is the half that IS
 *  Interaction. */
/** Protection the card states about ITSELF in words that are not a printed keyword.
 *
 *  `protectionIsOwnKeyword` asks whether every protection word on a card is one of its OWN, and it
 *  answered that against the printed keyword list — so it could see "hexproof" on a Sylvan Caryatid
 *  and could not see **"This spell can't be countered"**, which is the same fact in a sentence.
 *  Measured over the 71 decks: **13 of the 113 cards the protection rule fires on say only this** —
 *  10 "this spell can't be countered" (Nezahal, Niv-Mizzet Parun, Hullbreaker Horror, Toski, Chandra
 *  Awakened Inferno, Rise of the Eldrazi, Glen Elendra's Answer, Commence the Endgame, Hexing
 *  Squelcher, Inferno of the Star Mounts) and 3 Myojin entering with an indestructible counter ON
 *  THEMSELVES. A creature that cannot be countered protects nothing but itself, and counting it as
 *  one of a deck's ten Interaction cards is the Sylvan Caryatid defect in a different sentence.
 *
 *  IT IS STRIPPED, NOT MATCHED, so a card that says both keeps its other half: the remaining words
 *  still have to clear the printed-keyword test, and a GRANT still wins before any of this runs. */
const SELF_PROTECTION =
  /\bthis spell can'?t be countered\b|\benters with an indestructible counter on it\b/gi;

/** Protection TAKEN AWAY FROM OPPONENTS, which is the opposite of protecting anything of yours.
 *
 *  Shadowspear's *"Permanents your opponents control lose hexproof and indestructible"* and Nowhere
 *  to Run's *"as though they didn't have hexproof"* are removal ENABLERS — they exist so your removal
 *  connects — and both were counted as Interaction of the PROTECTION kind, which is a true category
 *  reached by a false sentence. **12 corpus cards, 3 in the 71 decks** (those two plus The Fire
 *  Nation Drill).
 *
 *  STRIPPED BY SENTENCE, not by phrase, and the difference is load-bearing: Shadowspear names TWO
 *  protection words in one clause and a phrase-level cut would leave "indestructible" standing.
 *
 *  A CARD THAT DOES BOTH KEEPS ITS OWN HALF, which is why this is a strip and not a refusal —
 *  **Archetype of Endurance** grants hexproof to your creatures in one sentence and strips it from
 *  theirs in the next, and only the second sentence goes. */
const ANTI_PROTECTION =
  /\byour opponents control\b[^.]{0,90}?\b(?:lose|don'?t have|can'?t have|didn'?t have)\b[^.]{0,40}?\b(?:hexproof|shroud|indestructible|ward|protection from)\b/i;

/** Drop every sentence that takes protection away from an opponent. */
function withoutAntiProtection(text: string): string {
  return text.split(/(?<=[.!?])\s+|\n/).filter((line) => !ANTI_PROTECTION.test(line)).join(" ");
}

/** SENTENCES WHOSE SUBJECT IS THE CARD ITSELF (#1289): "This creature gains indestructible until end of turn" (Falkenrath Aristocrat), "Dragonlord Ojutai has
 *  hexproof as long as it's untapped", "Kogla gains indestructible ...", and the "It gains ..." that follows a sentence naming the card and no target (Hungering
 *  Puppetbeast). Protection the card gives itself is the Sylvan Caryatid defect in sentence form. A SINGULAR verb is the cue the subject is one object ("this
 *  creature and other creatures you control gain" is plural and stays a grant). Stripped by sentence, so a card with a real grant too keeps its role. */
function withoutSelfGrants(text: string, cardName: string): string {
  const names = cardName.split(" // ").flatMap((face) => [face, face.split(",")[0]!])
    .map((n) => n.trim()).filter((n) => n.length > 0)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const thisCard = "this (?:creature|artifact|permanent|vehicle|enchantment|land|planeswalker)";
  const subject = `(?:${[thisCard, ...names].join("|")})`;
  const direct = new RegExp(`^(?:until end of turn, )?${subject}\\b(?:[^.]{0,60}?\\band)?\\s+(?:gains|gets|has)\\b`, "i");
  const named = new RegExp(`\\b${subject}\\b`, "i");
  const out: string[] = [];
  for (const line of text.split("\n")) {
    let previous = "";
    let quotes = 0;
    for (const sentence of line.split(/(?<=[.!?])\s+/)) {
      // INSIDE A QUOTED ABILITY "this creature" and "It" are the GRANTEE (Agent of the Shadow Thieves), never the card: such a sentence starts, or lies, inside an open quote.
      const quoted = quotes % 2 === 1 || sentence.includes('"');
      quotes += (sentence.match(/"/g) ?? []).length;
      const body = sentence.replace(/^[^:"]*:\s*/, "");
      const lead = /^(?:until end of turn, )?it\s+(?:gains|gets|has)\b/i.test(body);
      const self = (direct.test(body) || (lead && named.test(previous) && !/\btarget\b/i.test(previous)))
        && !/\b(?:gain|get|have)\b/i.test(body)
        && !/\b(?:gains|gets|has)\b[^.]*?\band\s+(?:target|each|all|other|another|creatures?|permanents?|equipped|enchanted|up to)\b/i.test(body);
      previous = sentence;
      if (!self || quoted) out.push(sentence);
    }
  }
  return out.join(" ");
}

const GRANTS_PROTECTION =
  /\b(?:gains?|have|has|get|grants?)\b[^.]{0,70}?(?:hexproof|indestructible|shroud|protection from|phases? out)/i;

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

/** `effectKind.reachesPermanent` for one ability. The effect subject decides; where derive kept NONE (Aethertorch Renegade: the "Pay {E}{E}" cost leaves the effect subject-less) the ability's own TARGETED damage
 *  emits decide, as `abilityReachesPlayer` does. */
function abilityReachesPermanent(a: { effect: { subject?: SubjectFilter }; emits?: { verb: string; subject: SubjectFilter }[] }): boolean {
  if (a.effect.subject !== undefined) return a.effect.subject.scope === "target" && subjectReachesPermanent(a.effect.subject);
  return (a.emits ?? []).some((e) => e.verb === "non-combat-damage" && e.subject.scope === "target" && subjectReachesPermanent(e.subject));
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

/** A debuff amount ("-5/-5", "-0/-3", "-X/-X, where X is the mana value of the exiled card") whose TOUGHNESS half is negative: the half after the slash opens with a minus
 *  and is not "-0". `+2/-2` counts (it kills a 2-toughness creature); "-2/-0" and "-2/+0" do not. */
function lowersToughness(amount: string | undefined): boolean {
  const m = /^\s*[+\-−]?\w+\s*\/\s*([+\-−])\s*(\w+)/.exec(amount ?? "");
  return m !== null && (m[1] === "-" || m[1] === "−") && m[2] !== "0";
}

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
    case "typeLine":
      return (dc.card.typeLine ?? "").toLowerCase().includes(clause.contains);
    case "effectKind":
      return (dc.tags?.abilities ?? []).some((a) =>
        clause.in.includes(a.effect.kind)
        && (clause.repeats === undefined || clause.repeats.includes(a.repeats ?? null))
        // WHO IT HAPPENS TO, when the effect names one (#574): The Chain Veil's "you lose 2 life" is
        // `player-life-loss` too. An effect with no subject is not refused -- nothing says who.
        && (clause.control === undefined || a.effect.subject?.control === undefined || clause.control.includes(a.effect.subject.control))
        && (clause.scope === undefined || (a.effect.subject?.scope !== undefined && clause.scope.includes(a.effect.subject.scope)))
        && (clause.notSelfTargeted !== true || (a.effect.subject as { targets?: { self?: boolean } } | undefined)?.targets?.self !== true)
        && (clause.notOnFlip !== true || a.onFlip === undefined)
        && (clause.notOwnedByYou !== true || a.effect.subject?.owner !== "you")
        && (clause.notSelf !== true || a.effect.subject?.self !== true)
        && (clause.notVictimMay !== true || !(a.emits ?? []).some((e) => e.victimMay === true))
        && (clause.librarySearch === undefined || (a.librarySearch !== undefined && clause.librarySearch.includes(a.librarySearch)))
        && (clause.notRedirect !== true || !(a.emits ?? []).some((e) => e.redirect === true))
        && (clause.reachesPlayer !== true || abilityReachesPlayer(a))
        && (clause.reachesPermanent !== true || abilityReachesPermanent(a))
        && (clause.notLandOnly !== true || !(a.effect.subject !== undefined && landOnlySubject(a.effect.subject)))
        && (clause.toughnessDown !== true || lowersToughness(a.amount))
        // The count of a hand-fill: `amount` on a `to-hand` ability, `toHand` on a typed dig that kept its `search` kind (a `search` ability with neither is no hand-fill, so none of the three options below match it).
        && (clause.pickOne !== true || (a.chooses === true && (a.effect.kind === "to-hand" ? a.amount : a.toHand) === "1"))
        && (clause.toHand !== true || a.toHand !== undefined)
        && (clause.named !== true || a.named === true)
        && (clause.netZero !== true || a.netZero === true));
    // CEILING: `removal.targeted` / `removal.land` read derived emits, and derive mislabels some cards, so the role is wrong on them by name.
    //   LOST (real removal, no usable emit): Polymorph, Transmogrify, Chaos Mutation, Divergent Transformations (derive reads the polymorph family as played on YOUR creature, `control: you`: owner ruling 2026-10-02 / #962,
    //   "primary use", so the opponent use is dropped on purpose; the role pays for it);
    //   Venser, the Sojourner (its removal is the −8 emblem's "exile target permanent", which lives on the emblem's own node by design, 2026-09-08 emblems-as-nodes; its +2 is a
    //   permanent you own, which the owner guard refuses).
    //   RIGHT FOR A WRONG REASON: Audacious Swap (its tuck counts because derive reads "If it's a land card, they put it onto the battlefield" -- a different card -- as a
    //   one-branch return of the target, `returnIf`, which `notFlickered` lets through).
    //   NOT A DEFECT, owner ruling 2026-10-20 (#1295): a kill decided by a coin flip (Mogg Assassin, Crooked Scales, Creepy Doll, Boompile, Plasma Caster) IS removal;
    //   only a losing-side shrink is refused (`notOnFlip`, Orcish Captain).
    case "emits":
      return (dc.tags?.abilities ?? []).some((a) =>
        (clause.notOwnedByYou !== true || !(dc.tags?.abilities ?? []).some((f) => f.clause === a.clause && f.effect.subject?.owner === "you"))
        && (clause.notFromHandCost !== true || !/from your hand/i.test(a.cost ?? ""))
        && (clause.notFlickered !== true || !(dc.tags?.abilities ?? []).some((f) => f.effect.kind === "flicker" && f.clause === a.clause && f.delayedUntil === undefined && f.returnIf !== true && f.effect.subject?.control !== "opp"))
        && (a.emits ?? []).some((e) =>
          clause.verbs.includes(e.verb)
          && (clause.abilityKind === undefined || clause.abilityKind.includes(a.effect.kind))
          && (clause.edict !== true || e.subject.edict === true)
          && (clause.notVictimMay !== true || e.victimMay !== true)
          && (clause.notOwnedByYou !== true || e.subject.owner !== "you")
          && (clause.notSelf !== true || e.subject.self !== true)
          && (clause.notPairedTarget !== true || !(dc.tags?.abilities ?? []).some((f) => f !== a && f.clause === a.clause
            && (f.emits ?? []).some((g) => g.subject.scope === "target" && g.subject.fromZone === "graveyard" && g.subject.control === e.subject.control
              && JSON.stringify(g.subject.type) === JSON.stringify(e.subject.type))))
          && (clause.control === undefined || clause.control.includes(e.subject.control))
          && (clause.zone === undefined || clause.zone.includes(e.subject.zone ?? null))
          && (clause.type === undefined || (subjectTypes(e.subject).length > 0 && subjectTypes(e.subject).every((t) => clause.type!.includes(t))))
          && (clause.scope === undefined || clause.scope.includes(e.subject.scope ?? null))
          && (clause.fromZone === undefined || clause.fromZone.includes(e.subject.fromZone ?? null))
          && (clause.counter === undefined || (e.subject.counter !== undefined && clause.counter.includes(e.subject.counter))))
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
    case "protectionIsOwnKeyword": {
      const txt = ownText(dc.card);
      // A GRANT WINS, always: a card can print a keyword AND hand it out, and handing it out is the
      // Interaction fact. Checked first so the keyword list can never overrule it.
      // THE GRANT TEST READS THE SAME TEXT THE WORD COUNT DOES. Shadowspear's "Permanents your
      // opponents control LOSE hexproof" has no grant verb, but a sentence like "creatures your
      // opponents control don't HAVE hexproof" does — and `GRANTS_PROTECTION` matches on "have".
      // Asking both questions of the same stripped text is what keeps them from disagreeing.
      const granting = withoutAntiProtection(withoutSelfGrants(txt, dc.card.name));
      if (GRANTS_PROTECTION.test(granting)) return false;
      const found = (t: string): Set<string> =>
        new Set([...t.matchAll(PROTECTION_WORDS)].map((m) => m[0].toLowerCase()));
      // NO PROTECTION AT ALL IS NOT SELF-PROTECTION. UNREACHABLE through the shipped rule — the op
      // only runs once the protection pattern has matched — and mutating it away changes no test,
      // which is stated rather than left for someone to discover. Kept because the op reads under
      // `not:`, so a wrong answer here SUPPRESSES the rule, and under-claiming is the direction.
      if (found(txt).size === 0) return false;
      // WHAT IS LEFT AFTER THE CARD'S CLAIMS ABOUT ITSELF. If nothing is, every cue was about the
      // card itself and it protects nothing else.
      const rest = found(granting.replace(SELF_PROTECTION, " "));
      if (rest.size === 0) return true;
      // "protection from Humans" is the printed keyword `protection`; the rest are their own word.
      const keywords = new Set((dc.tags?.characteristics?.keywords ?? []).map((k) => k.toLowerCase()));
      return [...rest].every((w) => keywords.has(w === "protection from" ? "protection" : w));
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

/** A COLOUR HOSER ANSWERS ONE COLOUR, NOT A KIND OF PERMANENT (issue #581). Pyroblast's "destroy
 *  target permanent if it's blue" read as an answer to every land, enchantment and planeswalker in
 *  the format; it answers only blue ones, which is a sideboard card's job, not a class this deck
 *  covers. "Nonblack" is not caught: Doom Blade answers nearly every creature. */
const COLOUR_HOSER = /\bif it'?s (?:white|blue|black|red|green)\b|^(?:white|blue|black|red|green)\b/;

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
  const mark = (cls: string, mode: Rule["mode"]): void => {
    const m = out.get(cls) ?? { exile: false, recurring: false };
    if (mode === "exile") m.exile = true;
    if (mode === "recurring") m.recurring = true;
    out.set(cls, m);
  };
  for (const rule of set.rules) {
    if (!ruleMatches(rule, dc, set)) continue;
    if (rule.answerClass) mark(rule.answerClass, rule.mode);
    if (rule.answerClassFrom) {
      // Global sweep, not a single test: "destroy target artifact or enchantment" and cards with
      // two removal sentences each cover several classes, and one match would keep only the first.
      const re = new RegExp(set.patterns[rule.answerClassFrom], "gi");
      for (const m of ownText(dc.card).matchAll(re)) {
        // The capture is the whole OBJECT PHRASE after "target", not one type word: "destroy
        // target artifact or enchantment" answers two classes, and a single-word capture keeps
        // whichever came first. Every class named anywhere in the phrase counts.
        const phrase = m.groups?.class?.toLowerCase();
        if (!phrase) continue;
        // An answer aims at something you do NOT control. "Exile target creature you control, then
        // return it" is a blink (Essence Flux, Ghostly Flicker) and reads as removal to every
        // pattern here; measured on the calibration decks it was inflating Inalla's creature
        // answers from 3 to 4. "you don't control" does not contain "you control", so the negation
        // survives this check without needing its own clause.
        if (/\byou control\b/.test(phrase)) continue;
        // "You own" is the same claim in different words -- a permanent can be controlled by
        // someone else while still owned by you, and a planeswalker's own-permanent blink says it
        // that way (Venser, the Sojourner's +2; Slip On the Ring). EVERY mode, not only exile (owner
        // ruling 2026-09-27, issue #531): Staff of Compleation's "destroy target permanent you own"
        // answers nothing an opponent has -- it is played to recur your own permanents. It used to be
        // kept as a "real self-destroy" in every class, which put it on the "Answers lands" shelf.
        if (/\byou own\b/.test(phrase)) continue;
        // AN IMMEDIATE FLICKER ANSWERS NOTHING (owner ruling 2026-09-25): "exile target X, then
        // return it to the battlefield" puts it straight back, so the clause is skipped -- per
        // CLAUSE, not per card, so a modal card's real removal mode still counts. A DELAYED return
        // ("At the beginning of the next end step, return ...") is its own sentence and keeps its
        // place in `count`, as the answer-modes spec rules: it answers the board for a turn.
        const sentence = ownText(dc.card).slice(m.index ?? 0).split(/[.\n]/)[0] ?? "";
        if (new RegExp(set.patterns.exileThenReturns, "i").test(sentence)) continue;
        // ...and a destroy whose CONTROLLER gets copies back answers nothing either (owner ruling
        // 2026-09-27, #513): Saw in Half is played on your own creature. The copies are the next
        // sentence, so the card's text is asked, not the clause. Fractured Identity hands the copies
        // to everyone ELSE and stays an answer.
        if (new RegExp(set.patterns.controllerGetsCopies, "i").test(dc.card.oracleText ?? "")) continue;
        if (COLOUR_HOSER.test(phrase)) continue;
        for (const word of Object.keys(KNOWN_CLASSES)) {
          // Plural too: "destroy two target creatures" (Curtains' Call) and "exile two target
          // permanents" (Ulamog) read as no answer at all when only the singular matched (issue #581).
          if (!new RegExp(`\\b${word}s?\\b`).test(phrase)) continue;
          for (const cls of set.answerClassAliases[word] ?? [word]) {
            // "nonland permanent" answers everything except a land, and `permanent` alone expands
            // to all five. Without this a Pongify reads as land interaction.
            if (cls === "land" && /\bnonland\b/.test(phrase)) continue;
            mark(cls, rule.mode);
          }
        }
      }
    }
  }
  return out;
}
