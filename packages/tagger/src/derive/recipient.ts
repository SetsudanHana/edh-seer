/** WHO an action's payout goes to, read mechanically off the clause text.
 *
 *  The normalizer records what an action DOES and what it does it to, but not who performs it. When
 *  the actor is also the object ("target player loses 1 life") nothing is lost, because `parseSubject`
 *  reads the control straight out of the object text. When the actor is the SUBJECT of the verb
 *  ("its controller creates a 3/3 green Ape") the object is the created thing and the actor is gone:
 *  Pongify's Ape derives control "any", and `any` matches `you` on either side (matcher/src/subject.ts),
 *  so a removal spell reads as a token producer for your own token payoffs.
 *
 *  Done here rather than by asking the model for a recipient field, for the same reason
 *  `effectActions` and `costActions` are: it is mechanical, so it is free, deterministic, and costs
 *  no re-buy of the corpus. It also reaches the cards the persist gate refuses, which a prompt change
 *  never would.
 *
 *  Measured over the 2,539 persisted clause docs: 86 actions across 80 cards name their own actor and
 *  drop it. 50 of those name a plain PLAYER and are already right — `any` is the true answer there,
 *  and claiming `opp` would be a wrong answer rather than a sharper one. This table speaks only for
 *  the other 36. */
import type { Control } from "../schema.js";

/** Every way the corpus names an actor before a verb. Kept as one alternation so the cue table below
 *  stays one line per verb. */
// COMBAT NAMES THE OPPONENT WITHOUT SAYING "OPPONENT" (the same fact `subject.ts` records for a
// subject): "defending player sacrifices an artifact of their choice" (Kibo, Uktabi Prince) is the
// OPPONENT sacrificing, and it derived `you` -- so Reaper King was "fodder" for Kibo's edict,
// owner-judged FALSE 2026-09-09. 25 corpus cards print "defending player sacrifices", the
// annihilator Eldrazi among them.
// ...AND SO DOES THE CONTROLLER OF AN OUTSIDE SOURCE (#1581): "Whenever a source deals damage to this creature, THAT SOURCE'S CONTROLLER sacrifices that many permanents" (Phyrexian Obliterator), "that spell or ability's controller
// sacrifices a land" (Lava Runner), "that spell's controller mills four cards" (Broken Ambitions). Unread, the sacrifice derived `you`. Read as an opponent for the reason "its controller" is: the corpus's uses are deterrents
// and answers pointed at an opponent, and being wrong here only removes an edge. CEILING: you can damage or counter your own permanent, and that controller is then you; "that creature's controller" is a different referent
// (Burning Sands: a creature of yours dying) and is not read.
const OUTSIDE_SOURCE = "(?:that|the) (?:source|spell|ability|spell or ability)['’]s controller";
/** Verbs that GIVE the outside source's controller something: the draw and the lifegain cues. */
const OUTSIDE_BENEFITS: ReadonlySet<string> = new Set(["draw", "gain-life"]);
const OUTSIDE_SOURCE_RE = new RegExp(`^${OUTSIDE_SOURCE}$`);
// THE SAME PLAYER IN OTHER WORDS, FOR WHAT A CARD GIVES (#1591): "That creature's controller gains life equal to its power" (Solitude, Captain Marvel), "Its owner gains 4 life" (Path of Peace, Misfortune's Gain), "That artifact's
// controller gains life" (Crumble), "that creature's controller draws X cards" (Nin, the Pain Artist; Nessian Boar; Fecundity), "The controller of each of those artifacts gains life" (Seeds of Innocence). Unread, the gain fell to
// the controller default: your removal gained YOU the life. Read as anyone (`controlOf`), an opponent only where the words before the phrase say one. "Its controller" itself keeps its older `opp` reading (Swords to Plowshares).
// CEILING: the gain-life and draw cues only (and, since #1824, "creates": Rapid Hybridization, Genesis Chamber, Funeral Pyre). The same words before "sacrifices" (Burning Sands, Animate Dead), "searches" (Verdant Succession) or "mills" (Mesmeric Orb) are
// still unread and default to you; "that creature's controller sacrifices" is pinned unread in recipient.test.ts.
// "The owner of up to one target creature draws two cards" (Unification, #1676 review): the owner of a chosen target is anyone (it may be you), so the draw is `any`, not the controller default. Bounded words after "target", no run of spaces to backtrack.
const GIVEN_TO = "(?:its|their) owners?|that [a-z]+['’]s (?:controller|owner)|the controllers? of each of those [a-z]+|the owners? of (?:up to \\w+|any number of) target [a-z]+(?: [a-z]+){0,3}";
const GIVEN_TO_RE = new RegExp(`^(?:${GIVEN_TO})$`, "i");
// THE ACTORS A SACRIFICE NAMES THAT OTHER VERBS DO NOT (#1808): "each foe" (Pir's Whim, Virtus's Maneuver: an opponent) and the controller of a permanent the clause points at ("that creature's controller sacrifices a land" Burning Sands, "target creature's
// controller sacrifices it" Mercy Killing, "enchanted creature's controller" Parasitic Implant, "target permanent's controller" Reweave, Maarika). Unread they derived `you`: an edict read as your own cost. The controller of a permanent that may be anyone's is `any`
// (`controlOf`, as "its controller" is after an untargeted trigger). Kept out of `WHO` so the other verbs' cues keep their reach (the draw and lifegain cues read "that creature's controller" through `GIVEN_TO`).
const SACRIFICE_CONTROLLER = "(?:that|target|enchanted|the) [a-z]+['’]s controller";
const SACRIFICE_CONTROLLER_RE = new RegExp(`^${SACRIFICE_CONTROLLER}$`, "i");
// "THE EXILED CARD'S OWNER CREATES" (#1824 review: Skyclave Apparition, Severance Priest) is the owner of the card the exile named: an opponent's where the exile says "you don't control" or names an opponent, otherwise anyone (read through the `GIVEN_TO` branch of `controlOf`, for a create only).
const EXILED_CARD_OWNER = "the [a-z]+ card['’]s owner";
const EXILED_CARD_OWNER_RE = new RegExp(`^${EXILED_CARD_OWNER}$`, "i");
const SACRIFICE_ACTORS = `each foe|${SACRIFICE_CONTROLLER}`;
const WHO = `its controller|their controller|${OUTSIDE_SOURCE}|target opponent|each opponent|each other player|defending player|attacking player|that player|target player|each player|those players`;

/** The actor must sit immediately against its OWN verb. "each opponent loses 1 life and you gain 1
 *  life" is the commonest drain wording in the corpus, and reading its recipient onto the gain would
 *  hand your own lifegain payoffs to the opponent — the exact false-edge shape this exists to remove.
 *  Only words that never change who acts may intervene -- see ADVERB. */
/** Words that may sit between the player and the verb: "each opponent ALSO discards a card"
 *  (Liliana's Triumph), "that player THEN draws". The cue missed "also" and the discard fell through
 *  to the controller default -- an opponent's discard read as yours. */
const ADVERB = "(?:(?:may|also|then|instead)\\s+)*";
/** A later verb joined to an earlier one of the SAME player (#1722, #1735): "and"/"or", or ", then" ("that spell's controller reveals their hand, then discards"). No other actor may sit between (the guard); stops at a period or semicolon. */
const JOINED = `(?:(?:(?!\\b(?:you|each|target|that player|its controller|their controller)\\b)[^.;]){0,100}?(?:\\s(?:and|or)\\s+|,\\s+then\\s+)${ADVERB})?`;
/** A CHOOSER'S SACRIFICE (#1740): the player chooses what to keep, ", then sacrifices the rest". Bounded, one period-free sentence. */
const CHOOSES_THEN = `(?:chooses?\\b[^.;]{0,200}?,\\s+then\\s+${ADVERB})?`;
/** A LATER CREATE JOINED TO THE SAME PLAYER'S EARLIER VERB (#1740): "That player shuffles, then creates a 2/2 ... token" (Necromentia). Narrower than `JOINED`: the player STARTS its clause (after a sentence end, a comma, "then", "and" or "if") and is the SUBJECT of
 *  the earlier verb, whose word is not "who"/"controls" -- so "each opponent who drew ..., then create" (Smuggler's Share), "target creature defending player controls gets -3/-0 ..., then create" (Giant Space Amoeba) and "each opponent may draw a card and create"
 *  (Tempt with Bunnies, three creates) are not joined (`actionRecipients` also requires exactly one printed create). CEILING: one create per clause and the player is the subject of the earlier verb; "target creature's controller sacrifices it, then creates" (Mercy Killing) names its player by a phrase `WHO` does not hold. */
const CREATE_JOINED = new RegExp(`(?<=^|[.;:,]\\s*|\\b(?:then|and|if)\\s)(${WHO})\\s+${ADVERB}(?!(?:who|whose|controls?)\\b)\\w+(?=[\\s,])(?:(?!\\b(?:you|each|target|that player|its controller|their controller)\\b)[^.;]){0,100}?(?:\\s(?:and|or)\\s+|,\\s+then\\s+)${ADVERB}creates?\\b`, "i");
const CUES: [string, RegExp][] = [
  // THE PLAYER A CREATE NAMES BY HER PERMANENT OR CARD (#1824, the #1808 sibling): "Destroy target creature. THAT CREATURE'S CONTROLLER creates a 3/3 Frog Lizard" (Rapid Hybridization, Amphin Mutineer, Ovinomancer, Incubation // Incongruity) and "Exile target card from a graveyard. ITS OWNER
  // creates a 1/1 Spirit" (Funeral Pyre, Pharika) read `you` while "Its controller creates" (Beast Within, Pongify) read an opponent's, because only the latter was a create cue. `controlOf` reads the first as it reads "its controller" (a single target is an opponent's, an untargeted
  // entering creature's controller is anyone: Genesis Chamber, Bramble Sovereign) and the second through `GIVEN_TO` (the owner of a card from any graveyard is anyone; a card's own owner after its own trigger is you: Yes Man).
  ["create", new RegExp(`\\b(${WHO}|${SACRIFICE_CONTROLLER}|${GIVEN_TO}|${EXILED_CARD_OWNER})\\s+${ADVERB}creates?\\b`, "i")],
  ["draw", new RegExp(`\\b(${WHO}|${GIVEN_TO})\\s+${ADVERB}${JOINED}draws?\\b`, "i")],
  ["search", new RegExp(`\\b(${WHO})\\s+${ADVERB}searc(?:h|hes)\\b`, "i")],
  ["mill", new RegExp(`\\b(${WHO})\\s+${ADVERB}mills?\\b`, "i")],
  // The amount is OPTIONAL between the verb and "life": "its controller gains life equal to its
  // power" (Swords to Plowshares) has no word there, and demanding one handed Swords' lifegain to
  // YOU for the whole life of this table -- a lifegain payoff fed by your own removal spell
  // (owner-reported off the Arcane Denial card page, 2026-09-05).
  ["lose-life", new RegExp(`\\b(${WHO})\\s+${ADVERB}loses?\\s+(?:\\S+\\s+){0,2}?life\\b`, "i")],
  ["gain-life", new RegExp(`\\b(${WHO}|${GIVEN_TO})\\s+${ADVERB}gains?\\s+(?:\\S+\\s+)?life\\b`, "i")],
  // "that player GETS two poison counters" (Fynn, Marsh Viper, Vexing Radgull's rad): the recipient of a counter the
  // card gives, written as a get rather than a put (#1263). One entry, so the verb has one cue.
  ["add-counter", new RegExp(`\\b(${WHO})\\s+${ADVERB}(?:puts?\\b[^.]{0,40}?counters?\\s+on|gets?\\b[^.]{0,40}?counters?)\\b`, "i")],
  // "that player EXILES the top ten cards of their library" (Raven Guild Master, Bismuth Mindrender): the exile is THEIRS
  // (#1263). Anchored on the verb like every cue, so "exile target creature. That player ..." is not read. ONLY "that
  // player": "target player exiles a card from their graveyard" (Relic of Progenitus, Karn Liberated) is a graveyard/hand
  // exile the REMOVAL_VERBS default already reads as an opponent's, and a `any` cue here would override it.
  ["exile", new RegExp(`\\b(that player)\\s+${ADVERB}exiles?\\b`, "i")],
  // Dictate of Erebos, Szat's Will: "each opponent SACRIFICES a creature of their choice". The
  // object is the opponent's creature, but it parses to `any` -- "of their choice" names no
  // controller the vocabulary knows -- and `any` matched every payoff for YOUR creatures dying.
  // ...AND A CHOOSER'S ", THEN SACRIFICES THE REST" (#1740): "Each player chooses ... , then sacrifices the rest" (Magus of the Balance, Balancing Act), "that player chooses up to two creatures they control, then sacrifices the rest" (Archfiend of Depravity).
  ["sacrifice", new RegExp(`\\b(${WHO}|${SACRIFICE_ACTORS})\\s+${ADVERB}${CHOOSES_THEN}sacrifices?\\b`, "i")],
  // THE DISCARDER IS NAMED BEFORE ITS VERB, NOT ALWAYS AGAINST IT (#1722): "Any number of target players EACH discard ..." (Cabal Conditioning: the players, any of them you) and a verb joined to an earlier one of the same player, "each opponent loses 4 life unless that
  // player sacrifices a nonland permanent of their choice OR DISCARDS a card" (Rottenmouth Viper), "target opponent loses 2 life AND discards a card". Unread, the discard fell to the object's "you control" or the controller default and was yours, which fed no counter of cards in an
  // OPPONENT's graveyard (Wight of Precinct Six, Detritivore). The joined form stops at a period or semicolon, and a "you discard" between is no match (the `yours` test in `actionRecipients`).
  // ...AND ", THEN" JOINS THE SAME PLAYER'S NEXT VERB (#1735): "that spell's controller reveals their hand, THEN DISCARDS each card with the same name" (Minamo's Meddling) stored `discard {control: you}`; "defending player discards all the cards in their hand, THEN DRAWS that many cards"
  // (Robber Fly) read `any` for a draw that is the opponent's. The draw cue joins the same way. CEILING: the joined form reads the player before an "and"/"or"/", then" within 100 characters with no other actor (you, each, target, that player, its/their controller) between; a comma list
  // ("each opponent sacrifices a creature, discards a card, and loses 4 life", Dusk Mangler) is not joined by this cue (its discard is read `opp` off the object's "each"), and a ", then" join is read for discard and draw only: mill, search and exile after ", then" derive the
  // answer they already had (the sentence names a player, so `any` stands); create has its own narrower join (`CREATE_JOINED`, #1740: Necromentia) because JOINED on the create cue falsely joins Smuggler's Share, Giant Space Amoeba and Tempt with Bunnies; sacrifice reads a chooser's ", then sacrifices" (`CHOOSES_THEN`, Magus of the Balance, Archfiend of Depravity).
  ["discard", new RegExp(`\\b(${WHO}|(?:any number of )?target players)\\s+(?:each\\s+)?${ADVERB}${JOINED}discards?\\b`, "i")],
  // Mind Funeral: "Target opponent reveals cards ... That player puts all cards revealed this way
  // into their graveyard" -- a mill written as a put, and the only verb the actor table did not
  // know, so the fill derived `any` and the delve pass had to read the printed "target opponent"
  // itself (`fillsOnlyOpponents`, PR #344). 54 corpus clauses put with a named actor; "that player"
  // 27, "each player" 11, "target opponent" 6. derive.ts fills only an UNSTATED control for this
  // verb: "puts a creature card ... onto the battlefield under your control" (Visions of Dread) is
  // the opponent acting and YOUR permanent entering, and the object text already says so.
  ["put", new RegExp(`\\b(${WHO})\\s+${ADVERB}puts?\\b`, "i")],
  // "THAT OPPONENT MAY CAST THE EXILED CARD" (#1691, CR 601.2a: the player who proposes the cast becomes the spell's controller): Allure of the Unknown, Swindler's Scheme. A stored `cast` action has no actor field, so a
  // model-normalized row names its caster only in the clause text; the grammar's reading carries its own (`Action.actor`, Itazura, Cmdr. Troi). "That opponent" is read here and not in `WHO`: the other verbs' cues never needed it.
  // CEILING: the printed phrase only. "They may cast" after "its controller" / "that player" (Tibalt's Trickery, Audacious Swap) and "its owner may cast" (Release to the Wind, Aerial Extortionist) name a player who may be
  // you, so `any` stands; and "they may cast" is not linked back to the "its controller" before it even where that controller is stated as an opponent (Transforming Flourish: "target artifact or creature you don't control").
  ["cast", new RegExp(`\\b(${WHO}|that opponent)\\s+${ADVERB}casts?\\b`, "i")],
];

/** "THAT PLAYER'S GRAVEYARD" IN A COMBAT-DAMAGE TRIGGER IS THE DAMAGED PLAYER (#1250, Tinybones): when the
 *  damager is yours -- the card itself, "this Vehicle", "equipped creature" (CR 301.5b: equip attaches to a creature
 *  you control), anything "you control" -- the player it hit is an opponent's, and "to an opponent" says so
 *  outright. "A creature deals combat damage to a player" could hit you, so that stays `any`.
 *  CEILING: an equipped creature an opponent later gains control of (CR 301.5d: the Equipment's controller is
 *  separate from the creature's) could damage you, and "that player" would be you; not modelled. Likewise a
 *  non-combat "deals damage to a player" from your own creature (Marsh Viper, Pit Scorpion) is read as an opponent
 *  though a self-aimed ping could hit you.
 *  The "they" / "the player" wordings of the same damaged player are read by `damagedPlayerRead`, and a clause with two actions of one verb that
 *  the damaged player does every time by `damagedPlayerActsEveryTime` (#1269). The "reveals ... puts into their graveyard" mill (Mirko Vosk,
 *  Balshan Beguiler) was already an opponent's since #1663 (`mill-owner.ts`). */
export function damagedPlayerIsOpponent(clauseText: string, triggerIsSelf: boolean, cardName?: string): boolean {
  // SCANNED, NOT MATCHED: `^\s*(?:whenever|when)\s+(.+?)\s+deals?\s+combat damage…` backtracks
  // polynomially on runs of spaces (CodeQL js/polynomial-redos), so the shape is read with string search.
  const text = clauseText.trimStart();
  const lower = text.toLowerCase();
  // ...and the replacement frame "If a Zombie you control would deal combat damage to a player, instead that player mills" (#1465).
  const start = lower.startsWith("whenever ") ? 9 : lower.startsWith("when ") ? 5 : lower.startsWith("if ") ? 3 : -1;
  if (start < 0) return false;
  // "deals combat damage to a player / an opponent", or damage of ANY kind to either (Atemsis, #1252; Marsh Viper, #1263).
  const combatAt = lower.indexOf(" combat damage to ", start);
  const anyAt = combatAt < 0 ? lower.indexOf(" damage to ", start) : -1;
  const at = combatAt >= 0 ? combatAt : anyAt;
  if (at < 0) return false;
  const target = lower.slice(at + (combatAt >= 0 ? " combat damage to " : " damage to ").length);
  const toOpponent = /^an opponent\b/.test(target);
  if (!toOpponent && !/^a player\b/.test(target)) return false;
  const head = text.slice(start, at).trimEnd();
  const verbAt = head.toLowerCase().endsWith(" deals") ? head.length - 6 : head.toLowerCase().endsWith(" deal") ? head.length - 5 : -1;
  if (verbAt < 0) return false;
  if (toOpponent) return true;
  const who = head.slice(0, verbAt).replace(/\s+would\s*$/i, "").trim();
  return triggerIsSelf || /\byou control\b/i.test(who) || /^(?:this |equipped creature$)/i.test(who)
    || (cardName !== undefined && (who === cardName || who.toLowerCase() === cardName.split(",")[0]!.toLowerCase()));
}

/** "...deals 3 damage to THAT PLAYER": an opponent when the sentence names one before the phrase ("a spell or ability an opponent
 *  controls ... that player", Thunderbreak Regent) or when the card's own damage hit the player (#1263). Otherwise unknown. */
export function thatPlayerIsOpponent(clauseText: string, triggerIsSelf: boolean, cardName?: string): boolean {
  const lower = clauseText.toLowerCase();
  const at = lower.lastIndexOf("that player");
  if (at < 0) return false;
  return /\bopponents?\b/.test(lower.slice(0, at)) || damagedPlayerIsOpponent(clauseText, triggerIsSelf, cardName);
}

/** An actor phrase to the control it states, or undefined when it states nothing sharper than "any".
 *
 *  "its controller" is a DECISION, not a reading: the rules let you point Pongify at your own
 *  creature, so the honest rules answer is "any". It is called `opp` because these are removal spells
 *  and that is where they get pointed. Since #1666 that is NOT harmless: a token's `opp` emit makes the matcher build an opponent's node for it, and a wrong `opp` there invents false edges instead of
 *  only removing one, so a wipe that hands a token to every controller (untargeted "destroy all", "for each player") reads `any` below. */
function controlOf(phrase: string, text: string, at: number, ctx: ActorContext, verb = ""): Control | undefined {
  const p = phrase.toLowerCase();
  // "THAT CREATURE'S CONTROLLER CREATES" (#1824) IS "ITS CONTROLLER CREATES": the same removal decision, the same wipe and trigger exceptions.
  // ...EXCEPT WHERE YOU PAY TO COPY (#1824 review, Bramble Sovereign: "Whenever another nontoken creature enters, you may pay {1}{G}. If you do, that creature's controller creates a token that's a copy of that creature"): nobody pays to copy an opponent's creature, so by primary use the
  // entering creature is yours and so is the copy. A DECISION, not a reading, as "its controller" is `opp`: the rule is an untargeted "whenever another ... creature enters" with a "you may pay" before the phrase; Genesis Chamber (no payment) stays `any`.
  if (verb === "create" && SACRIFICE_CONTROLLER_RE.test(p)) {
    const before = text.slice(0, at);
    if (/^\s*whenever another [a-z -]{0,30}creature enters\b/i.test(before) && /\byou may pay\b/i.test(before) && !/\btarget\b/i.test(before)) return "you";
    return controlOf("its controller", text, at, ctx, verb);
  }
  // "OTHER THAN ITS CONTROLLER" IS NOT ITS CONTROLLER (#1666 review): "each player other than its controller creates a token that's a copy of it" (Fractured Identity) and "target player other than its controller create a token" (Lucy MacLean) name the players
  // who are NOT the controller, which is any of them, you included.
  if ((p === "its controller" || p === "their controller") && /\bother than\s*$/i.test(text.slice(0, at))) return "any";
  // "WHENEVER A PLAYER ATTACKS ..., THAT ATTACKING PLAYER" IS ANY PLAYER (#1666 review): Jolene, Combat Calligrapher, Ellie and Curse of Shallow Graves give the token to whoever attacked, you included. Any other "attacking player" is the attacker of your
  // permanent or of you ("Souls of the Faultless", "Contested Game Ball"), an opponent.
  if (p === "attacking player" && /\bwhenever a player attacks\b/i.test(text.slice(0, at))) return "any";
  // "FOR EACH CREATURE TOKEN ON THE BATTLEFIELD, ITS CONTROLLER" IS EVERY TOKEN'S CONTROLLER (#1666 review, Parallel Evolution): yours among them.
  if ((p === "its controller" || p === "their controller") && /\bfor each (?:[a-z-]+ )*token on the battlefield\b/i.test(text.slice(0, at))) return "any";
  // "DESTROY ALL ..., ITS CONTROLLER" IS EVERYONE'S (#1666 round 3): after an untargeted "destroy / exile all" (March of Souls, The Phasing of Zhalfir, Rampage of the Clans), or a "for each player ... that player controls" (The Curse of Fenric), the creatures that
  // went are the controllers' of every board, yours included. A wipe of TARGETS you pick ("destroy any number of target creatures", Descent of the Dragons) keeps the removal decision below.
  if (p === "its controller" || p === "their controller") {
    const before = text.slice(0, at);
    const wipe = /\b(?:destroy|exile) all\b/ig;
    let w: RegExpExecArray | null, last = -1;
    while ((w = wipe.exec(before)) !== null) last = w.index;
    if (last >= 0 && !/\btarget\b/i.test(before.slice(last))) return "any";
    if (/\bfor each player\b[^.]*\bthat player controls\b/i.test(before)) return "any";
    // "FOR EACH CREATURE DESTROYED THIS WAY, ITS CONTROLLER" HAS NO ONE CONTROLLER (#1666 round 3): several objects, each its own controller's (Descent of the Dragons, Hour of Need, Curse of the Swine, Soul of Emancipation, Terastodon: Terastodon's are
    // usually your own lands). A single target ("Its controller creates", Beast Within) keeps the removal decision below.
    // ...unless the objects are named as an opponent's ("for each opponent, exile up to one target permanent that player controls. For each permanent exiled this way, its controller draws a card", King Solomon's Frogs).
    if (/\bfor each\b[^.]*\b(?:this way|of those (?:permanents|creatures))\b/i.test(before) && !/\bfor each opponent\b|\bopponents? controls?\b|\byou don'?t control\b/i.test(before)) return "any";
  }
  // AFTER AN UNTARGETED TRIGGER SUBJECT IT IS ANYONE (#650): "Whenever a creature enters, its
  // controller sacrifices ..." (Tainted Aether) points at the creature that entered, which can be
  // yours. A target or an opponent named first keeps the removal reading, as does a bare fragment.
  // GIVEN LIFE OR CARDS (#1591, `GIVEN_TO`): anyone, as a benefit to an outside source's controller is below -- Nin, the Pain Artist is aimed at your own creature to draw, and Solitude's life goes to whoever controlled the
  // exiled creature. An opponent only where the words before say one ("target creature an opponent controls"), you where the last target is one "you control".
  if (p === "each foe") return "opp";
  // "WHENEVER THIS CREATURE BECOMES BLOCKED BY A CREATURE, THAT CREATURE'S CONTROLLER SACRIFICES IT" (Basalt Golem, #1808 review) is the defending player's: a blocker is chosen by the defending player from the creatures THEY control (CR 509.1a), an opponent of the attacker's controller.
  if (verb === "sacrifice" && SACRIFICE_CONTROLLER_RE.test(p) && /\bbecomes blocked by (?:a|an|another) [a-z ]{0,30}creature\b/i.test(text.slice(0, at))) return "opp";
  if ((GIVEN_TO_RE.test(p) || (verb === "create" && EXILED_CARD_OWNER_RE.test(p)) || (verb === "sacrifice" && SACRIFICE_CONTROLLER_RE.test(p))) && !OUTSIDE_SOURCE_RE.test(p)) {
    const before = text.slice(0, at);
    const lastTarget = before.toLowerCase().lastIndexOf("target ");
    const since = lastTarget < 0 ? "" : before.slice(lastTarget).split(/\b(?:with|equal to|for each|where|the number of)\b/i)[0]!;
    if (/\byou control\b/i.test(since) && !/\byou don'?t control\b|\bopponents?\b/i.test(since)) return "you";
    // THE CARD'S OWN OWNER IS YOU: "When this creature dies, ... its owner draws that many cards" (Oft-Nabbed Goat) is a card of your deck, whoever controls it when it dies (#1395).
    const ownTrigger = ctx.triggerIsSelf === true || /^\s*when(?:ever)? this [a-z]+ /i.test(text) || (ctx.cardName !== undefined && text.trimStart().toLowerCase().startsWith(`when ${ctx.cardName.toLowerCase()} `));
    if (p === "its owner" && ownTrigger && lastTarget < 0) return "you";
    // The exiled card sits in another clause of the card (Skyclave Apparition's enters clause names "a permanent you don't control", Severance Priest's "target opponent reveals their hand"): read the whole text.
    const named = verb === "create" && EXILED_CARD_OWNER_RE.test(p) ? ctx.cardText ?? before : before;
    return /\bopponents?\b|\byou don'?t control\b/i.test(named) ? "opp" : "any";
  }
  if (p === "its controller" || p === "their controller") {
    const before = text.slice(0, at);
    // The opponent in other words: a creature that "attacks you" (MacCready), "if you don't control it"
    // (Auntie Ool) -- found by checking the flipped cards one by one.
    // CEILING: `before` is the whole clause up to the phrase, not the antecedent's own sentence, so an
    // unrelated target or opponent earlier in the clause keeps `opp` -- it only ever under-claims.
    // ...EXCEPT WHEN THE ANTECEDENT IS A TARGET YOU CONTROL (#1295): "Target creature you control gets +3/+3 until end
    // of turn. Its controller sacrifices it at the beginning of the next end step" (Celestial Sword) says "its" about
    // YOUR creature, and the removal reading turned your own sacrifice into an opponent's. The antecedent is the LAST
    // target named before the pronoun; it counts as yours only when "you control" follows it and no opponent or
    // "you don't control" intervenes.
    const lastTarget = before.toLowerCase().lastIndexOf("target ");
    if (lastTarget >= 0) {
      // Up to where the phrase turns into a COUNT or a qualifier: "Exile target creature with mana value less than or equal to the number of Plains you control. Its controller gains 3 life" (Lay Down Arms) counts YOUR Plains.
      const since = before.slice(lastTarget).split(/\b(?:with|equal to|for each|where|the number of)\b/i)[0]!;
      if (/\byou control\b/i.test(since) && !/\byou don'?t control\b|\bopponents?\b|\bdefending player\b|\bthat player\b/i.test(since)) return "you";
    }
    if (!/^\s*(?:when|whenever)\b/i.test(before) || /\b(?:target|opponents?)\b|\battacks? you\b|\byou don'?t control\b/i.test(before)) return "opp";
    // A creature YOU control has you as its controller (review): `any` would satisfy an opponent's side too.
    return /\byou control\b/i.test(before) ? "you" : "any";
  }
  // ...EXCEPT WHEN THEY ARE GIVEN SOMETHING (review of #1581): "The source's controller draws cards equal to the damage prevented" (Swans of Bryn Argoll) pays your own Niv-Mizzet's damage out to YOU, and "that spell's controller may draw a card"
  // (Vex) can be your own spell. A benefit to an untyped outside source's controller is `any`; a source or spell "an opponent controls" stays `opp` whatever the verb.
  if (OUTSIDE_SOURCE_RE.test(p)) return OUTSIDE_BENEFITS.has(verb) && !/\bopponents?\b/i.test(text.slice(0, at)) ? "any" : "opp";
  if (p === "target opponent" || p === "that opponent" || p === "each opponent" || p === "each other player" || p === "defending player" || p === "attacking player") return "opp";
  // "that player" points back at whoever the clause already named. The antecedent is in the same
  // clause, so this one needs no judgment: Massacre Wurm's "a creature an opponent controls dies,
  // that player..." is an opponent, while "choose target player. That player..." is not.
  // ...or the player the card's own combat damage hit (#1263): an opponent, see damagedPlayerIsOpponent.
  if (p === "that player") {
    if (/\bopponents?\b/i.test(text.slice(0, at))) return "opp";
    return damagedPlayerIsOpponent(text, ctx.triggerIsSelf ?? false, ctx.cardName) ? "opp" : "any";
  }
  // target player, each player, those players: "any" is the right answer -- and it is RETURNED,
  // not left silent, because silence now means "no player was named at all", which derive.ts reads
  // as the card's controller (CR 111.2 / the panel's Priest of Forgotten Gods -> Orcish Bowmasters:
  // "draw a card" is YOU drawing, and an ownerless draw met "whenever an opponent draws").
  return "any";
}

/** Verb -> the control its actor states, for the verbs whose actor the clause names. Absent verbs are
 *  left exactly as the object text parsed them. */
/** Verb stems, for `sentenceNamesAPlayer`: the sentence that holds the verb is the one whose
 *  player words matter. */
const STEMS: Record<string, string> = {
  draw: "draw", cast: "cast", play: "play", discard: "discard", mill: "mill", create: "creat",
  search: "search", sacrifice: "sacrific", "gain-life": "gain", "lose-life": "los", put: "put",
};
const PLAYER_WORD = /\b(?:opponents?|players?|controllers?|owners?)\b/i;

/** Does the sentence containing this verb name any player at all? The controller default in
 *  derive.ts fills in `you` only when the answer is no: a sentence that names a player the cue
 *  regexes could not attach ("each opponent, if able, discards") is UNCERTAIN, and `any` stands.
 *  Sentence-local, not clause-local, because a clause is often several sentences and "target
 *  player loses 2 life. You draw a card" names a player in the sentence that is not the draw's. */
export function sentenceNamesAPlayer(clauseText: string, verb: string): boolean {
  const stem = STEMS[verb];
  if (!stem) return PLAYER_WORD.test(clauseText);
  const stemRe = new RegExp(`\\b${stem}`, "i");
  const sentences = clauseText.split(/(?<=[.!?])\s+/);
  const holding = sentences.filter((s) => stemRe.test(s));
  return (holding.length ? holding : sentences).some((s) => PLAYER_WORD.test(s));
}

/** WHICH OF A CLAUSE'S SEVERAL CREATES NAME NO PLAYER (#1728). A tempting offer opens with an imperative create ("Create a token that's a copy of that creature. Each opponent may create ... For each opponent who does, create ...";
 *  "Draw a card and create a 1/1 ... Then each opponent may draw a card and create ...") and the clause stores three creates, so the one-create controller default refused all of them and the caster's own read `any`. Misfortune
 *  Teller ("If it was a creature card, create a 2/2 ... If it was a land card, create a Treasure token.") is the same refusal with no player in sight.
 *  The k-th create is paired with the k-th printed "create"/"creates" and answered by ITS OWN sentence, with the same two tests the single-create default makes (`sentenceNamesAPlayer`, `pronounActs`) -- so a sentence with a player word
 *  ("Each opponent may create", "unless any opponent has you draw") is never the caster's. Answers `null` unless the printed creates are exactly as many as the stored ones: a model that stored a create twice for one printed (Fertile
 *  Imagination) or a clause that prints "create" in a sentence of its own count is not guessed at.
 *  CEILING: the verb "create" only; draw, discard, search, sacrifice and the rest are left on the one-action default because every census case of them with a repeated verb names a player ("each player draws", "target player
 *  discards two cards ... that player discards"), so there is no unstated actor to fill (2026-11-21 census, #1728). The sentence split is the one `sentenceNamesAPlayer` uses. */
export function unstatedCreates(clauseText: string, storedCreates: number): boolean[] | null {
  const sentences = clauseText.split(/(?<=[.!?])\s+/);
  const makers: boolean[] = [];
  for (const s of sentences) {
    const n = s.match(/\bcreates?\b/gi)?.length ?? 0;
    // One printed create per sentence; two in one sentence ("create X, then create Y") are not told apart.
    if (n > 1) return null;
    if (n === 1) makers.push(!sentenceNamesAPlayer(s, "create") && !pronounActs(s, "create"));
  }
  return makers.length === storedCreates ? makers : null;
}

/** ANOTHER PLAYER, NAMED BY A PRONOUN, DOES IT (#1591): "Its controller mills that many cards ... THEY MAY CAST that card" (Tibalt's Trickery), "they may cast it" (Audacious Swap), "Choose target player ... Then THEY DRAW a card"
 *  (Mishra's Command), "they discard" (Stinging Vitriol). "They" is never the controller, and the sentence holds no player word, so the controller default (`ACTOR_DEFAULTS_TO_YOU`, derive.ts) made it yours. Derive leaves the
 *  control as parsed (`any`) instead. Not when "you <verb>" is printed too: the default is then right for that one. */
export function pronounActs(clauseText: string, verb: string): boolean {
  const stem = STEMS[verb];
  if (!stem) return false;
  return new RegExp(`\\b(?:they|he or she)\\s+${ADVERB}${stem}`, "i").test(clauseText) && !new RegExp(`\\byou\\s+${ADVERB}${stem}`, "i").test(clauseText);
}

/** What the caller knows about the clause's trigger, for "that player" after damage (#1263). */
/** `cardText`: the card's whole printed text, for an actor whose antecedent sits in ANOTHER clause ("When this creature leaves the battlefield, the exiled card's owner creates": the exile is the enters clause, #1824 review). */
export interface ActorContext { triggerIsSelf?: boolean; cardName?: string; cardText?: string }

/** THE DAMAGED PLAYER BY ANOTHER NAME (#1269): after the card's own damage to a player, "they lose half their life" (Unstoppable Slasher, Glowing One, Infesting Radroach, Rex) and "The player gets another poison counter" (Sabertooth Cobra) name the
 *  same player "that player" does. Returns the clause text with those words written "that player", so every cue and `controlOf` read them as they read #1263's: an opponent. Unchanged unless the clause is a damage trigger of ours (`damagedPlayerIsOpponent`):
 *  "a creature deals combat damage to a player, they ..." can be you, and keeps `any`.
 *  A "they" counts only when (a) a cue verb follows it (not "They have", "they pay"), (b) it sits outside parentheses (reminder text), (c) no more than one sentence end lies between the damage phrase and it ("... that player gets a poison counter. The player gets
 *  another"), and (d) nothing between names another actor: you, each, target, an opponent, a player other than "that player" / "the player" ("you may pay {X}. If you do, they ...", "each player ... they"), or a controller.
 *  CEILING: the one damaged player; a "they" that follows a second sentence, or an actor named between, stays `any`, as does "they" before a verb that has no cue (exile, pay). A cue-verb "they" that means PERMANENTS ("create two tokens. They get a +1/+1 counter"), with no actor named between, is read as the player (0 corpus lines today; pinned in damaged-they-1269.test.ts). */
const DAMAGE_TO_PLAYER = / damage to (?:a player|an opponent)\b/i;
const THEY_ACTS = new RegExp(`\\b(?:they|the player)(?=\\s+${ADVERB}(?:creates?|draws?|searc(?:h|hes)|mills?|loses?|gains?|gets?|puts?|sacrifices?|discards?|casts?)\\b)`, "gi");
const OTHER_ACTOR = /\b(?:you|your|each|target|opponents?|players?|controllers?)\b/i;
export function damagedPlayerRead(clauseText: string, ctx: ActorContext = {}): string {
  if (!/\b(?:they|the player)\b/i.test(clauseText) || !damagedPlayerIsOpponent(clauseText, ctx.triggerIsSelf ?? false, ctx.cardName)) return clauseText;
  const dmg = DAMAGE_TO_PLAYER.exec(clauseText);
  if (!dmg) return clauseText;
  const head = clauseText.slice(0, dmg.index + dmg[0].length);
  const tail = clauseText.slice(head.length);
  const read = tail.replace(THEY_ACTS, (word, at: number) => {
    const between = tail.slice(0, at);
    if ((between.match(/\(/g)?.length ?? 0) !== (between.match(/\)/g)?.length ?? 0)) return word;
    if ((between.match(/[.!?](?=\s)/g)?.length ?? 0) > 1) return word;
    if (OTHER_ACTOR.test(between.replace(/\b(?:that|the) player\b/gi, " "))) return word;
    return "that player";
  });
  return head + read;
}

/** TWO ACTIONS OF ONE VERB, EVERY ONE THE DAMAGED PLAYER'S (#1269): Sabertooth Cobra's "that player gets a poison counter. The player gets another poison counter at the beginning of their next upkeep" stores two counter placements, which `actorFor` refuses.
 *  When the clause is a damage trigger of ours and every cue match of the verb names "that player" (after `damagedPlayerRead`), at least as many as the clause stores, and no "you <verb>" is printed, each stored action is that player's.
 *  CEILING: counted over the printed words; a cue the grammar cannot match is not counted, and the clause is refused. */
export function damagedPlayerActsEveryTime(clauseText: string, verb: string, stored: number, ctx: ActorContext = {}): boolean {
  const cue = CUES.find(([v]) => v === verb)?.[1];
  const stem = STEMS[verb];
  if (!cue || !damagedPlayerIsOpponent(clauseText, ctx.triggerIsSelf ?? false, ctx.cardName)) return false;
  const text = damagedPlayerRead(clauseText, ctx);
  if (stem && new RegExp(`\\byou\\s+${ADVERB}${stem}`, "i").test(text)) return false;
  let n = 0;
  for (const m of text.matchAll(new RegExp(cue.source, "gi"))) {
    if (m[1]!.toLowerCase() !== "that player") return false;
    n++;
  }
  return n >= stored;
}

export function actionRecipients(printed: string, ctx: ActorContext = {}): Record<string, Control> {
  const clauseText = damagedPlayerRead(printed, ctx);
  const out: Record<string, Control> = {};
  for (const [verb, re] of CUES) {
    const m = re.exec(clauseText) ?? (verb === "create" && (clauseText.match(/\bcreates?\b/gi)?.length ?? 0) === 1 ? CREATE_JOINED.exec(clauseText) : null);
    // "YOU DRAW" IS A STATED ACTOR, NOT AN UNSTATED ONE (owner-reported 2026-09-17, Scrawling
    // Crawler <- Y'shtola, Night's Blessed): "if a player lost 4 or more life this turn, you draw a
    // card" names a player in the condition, so the controller default below refused to fill `you`
    // and the draw derived `any` -- which met "whenever an OPPONENT draws". 350 of the 671 corpus
    // draw emits at `any` had the same shape. The printed "you" outranks a player word elsewhere in
    // the sentence; it yields only to an opponent cue written BEFORE it on the same verb.
    const stem = STEMS[verb];
    // A CAST SPEAKS ONLY WHEN IT NAMES AN OPPONENT (#1691): "you may cast" is left to the object's own reading (a stated `you` here changed the cast's scope and owner, Lady Loki, Covetous Urge), and a player who may be
    // you stays `any`. Not when "you cast" is printed first: that is the one cast of a clause that names two.
    if (verb === "cast") {
      const yoursCast = new RegExp(`\\byou\\s+${ADVERB}cast`, "i").exec(clauseText);
      if (m && !(yoursCast && yoursCast.index < m.index) && controlOf(m[1]!, clauseText, m.index, ctx, verb) === "opp") out[verb] = "opp";
      continue;
    }
    const yours = stem ? new RegExp(`\\byou\\s+${ADVERB}${stem}`, "i").exec(clauseText) : null;
    // Contested -- yours first, then an opponent's on the same verb (Braids) -- stays unstated.
    if (yours && m && yours.index < m.index) continue;
    if (yours && !m) { out[verb] = "you"; continue; }
    // "UNLESS THEY SACRIFICE" (#1808, Torment of Venom): "they" is the player the clause named last before it ("Its controller loses 3 life unless they sacrifice ..."), so the sacrifice is that player's. CEILING: the nearest earlier actor phrase of `WHO`, read as for its own verb; none, or "you sacrifice", leaves it unread.
    if (verb === "sacrifice" && !m) {
      const they = /\bunless they sacrifices?\b/i.exec(clauseText);
      if (they) {
        let last: RegExpExecArray | null = null;
        for (const w of clauseText.slice(0, they.index).matchAll(new RegExp(`\\b(${WHO}|${SACRIFICE_ACTORS})\\b`, "gi"))) last = w;
        const control = last ? controlOf(last[1]!, clauseText, last.index, ctx, verb) : undefined;
        if (control) out[verb] = control;
      }
      continue;
    }
    if (!m) continue;
    const control = controlOf(m[1], clauseText, m.index, ctx, verb);
    // An exile cue speaks only when it states an opponent: "that player exiles the top card of one of their
    // OPPONENTS' libraries" (Shared Fate) is another player's library, which the object already says.
    if (control && !(verb === "exile" && control !== "opp")) out[verb] = control;
  }
  return out;
}


/** ONE PLAYER DOES EVERY SACRIFICE OF THE CLAUSE (#1579). `actorFor` refuses a verb the clause stores twice, since "Target player sacrifices X. You sacrifice Y." has two actors. An edict repeated for a bigger number or another type has one: "Each opponent sacrifices a creature of their choice. If you have the
 *  city's blessing, instead each opponent sacrifices half the creatures ..." (Vona's Hunger), "Target opponent sacrifices ... that player sacrifices two of those creatures instead" (Gideon's Triumph), "Target opponent sacrifices a creature. ... Then repeat this process for an enchantment" (Invoke Despair).
 *  The test: the text has at least one cue-named sacrifice and as many of them as it has sacrifice verbs, and no "you sacrifice". Counted over the printed words, linear scans of one clause.
 *  CEILING: the cue's WHO decides the control as for a single sacrifice ("target player" stays `any`); a repeat with the SAME verb count but another actor between ("each opponent sacrifices X, then you sacrifice Y") is refused by the "you sacrifice" test only. */
export function oneSacrificer(clauseText: string): boolean {
  const verbs = clauseText.match(/\bsacrifices?\b/gi)?.length ?? 0;
  const cued = clauseText.match(new RegExp(`\\b(?:${WHO})\\s+${ADVERB}${CHOOSES_THEN}sacrifices?\\b`, "gi"))?.length ?? 0;
  return cued > 0 && cued === verbs && !/\byou\s+sacrifice\b/i.test(clauseText);
}

/** EVERY PLAYER CHOOSES, THEN EVERY PLAYER SACRIFICES THE REST (#1740): "Each player chooses a number of lands they control equal to ..., then sacrifices the rest. Players discard cards and sacrifice creatures the same way." (Magus of the Balance, after its own
 *  "Sacrifice this creature" cost). The stored object says "lands you control" and the several sacrifices refuse the cue (`actorFor`), so the sacrifice read `you`: the cue's `any` stands for this shape. The chooser printed is "each player" and the repeats are "players ... the same way".
 *  CEILING: the one chain shape, read over the printed words; the cost's own sacrifice is the one verb that is not the chooser's, and a clause with another sacrifice verb is refused. */
export function everyPlayerChoosesThenSacrifices(clauseText: string): boolean {
  if (!/\b(?:each|every) player chooses?\b[^.;]{0,200}?, then sacrifices?\b/i.test(clauseText)) return false;
  const rest = clauseText.replace(/^[^:]{0,80}\bsacrifice\b[^:]{0,80}:\s*/i, "");
  const verbs = rest.match(/\bsacrifices?\b/gi)?.length ?? 0;
  const chooser = rest.match(/\b(?:each|every) player chooses?\b[^.;]{0,200}?, then sacrifices?\b/gi)?.length ?? 0;
  const same = rest.match(/\bplayers\b[^.;]{0,80}?\bsacrifice\b[^.;]{0,60}?\bthe same way\b/gi)?.length ?? 0;
  return chooser > 0 && chooser + same === verbs;
}

/** THE PLAYER IS THE TARGET, NOT THE CREATURE (#1295): "Target player sacrifices a creature of their choice" (Diabolic
 *  Edict), "target opponent sacrifices ..." (Chainer's Edict, Sudden Edict). The first sacrifice sentence is read, as
 *  `actionRecipients` reads it. PLURAL targets and a verb after "and" count ("Any number of target players each lose 2 life and sacrifice a creature of their choice", Priest of Forgotten Gods; Will of the Abzan). `may` is NOT an adverb here: "target opponent MAY sacrifice" is the victim's option
 *  (`victimDeclines`), not an edict. "Each player", "each opponent" and "defending player" name no target. */
const TARGETED_SACRIFICER = /\btarget (?:players?|opponents?) (?:each )?(?:[^.,;]{0,120}? and )?(?:(?:also|then|instead) )*sacrifices?\b/i;
export function sacrificerIsTargeted(clauseText: string): boolean {
  return TARGETED_SACRIFICER.test(clauseText);
}

/** THE VICTIM MAY DECLINE (#1295): the action's own verb is handed to the player whose permanent it is, as an option.
 *  "Its controller MAY sacrifice it" (Star Athlete, Livio), "its controller may exile it" (Disorienting Choice), and
 *  "UNLESS that player sacrifices it" (Enchanter's Bane) / "unless they sacrifice a nonland permanent" (Thornplate
 *  Intimidator). Read against the action's OWN verb so "its controller may search their library" (Path to Exile) and
 *  "unless you pay" (an upkeep cost) never match. */
const DECLINE_VERBS: Record<string, string> = { sacrifice: "sacrifices?", exile: "exiles?", destroy: "destroys?" };
const DECLINER = "(?:(?:its|their|that [a-z]+'s) controller|that player|they|target (?:player|opponent)|each opponent|its owner|the player|he or she)";
export function victimDeclines(clauseText: string, verb: string): boolean {
  // DAMAGE THE VICTIM MAY HAVE DEALT (#1294): "That creature's controller may have this artifact deal 1 damage to it" (Requiem Monolith) is the creature's controller's option, not damage anyone aims. Only damage back to the decliner ("to it", "to them"): Pandemonium's "may have it deal damage equal to its power to any target" is the controller choosing a target.
  if (verb === "deal-damage") return new RegExp(`\\b${DECLINER}\\s+may\\s+have\\s+[^.]{0,40}?\\bdeals?\\b[^.]{0,40}?\\bdamage to (?:it|them|him|her)\\b`, "i").test(clauseText);
  const stem = DECLINE_VERBS[verb];
  if (!stem) return false;
  // "ANY PLAYER MAY EXILE a card from their graveyard" (Carrion Rats, Carrion Wurm), "EACH PLAYER MAY exile any number" (Grave Consequences): the exile is every player's option (#1266, graveyardHate).
  const anyPlayer = verb === "exile" ? "|\\b(?:any|each) player may exiles?\\b" : "";
  // PAY OR DIE (#1628): "That player may pay {X}. If they don't pay, ... destroy it" (Arcum's Whistle), "its controller may pay {1} or {2}. If that player doesn't, destroy that creature" (Winter's Chill). The payment is the victim's option and the kill is what it declines.
  const payOrDie = verb === "destroy" && new RegExp(`\\b${DECLINER}\\s+may\\s+pay\\b[^.]*\\.\\s*if\\s+${DECLINER}\\s+(?:don't|doesn't|do not|does not)\\b[^.]*\\b${stem}\\b`, "i").test(clauseText);
  return payOrDie || new RegExp(`\\b${DECLINER}\\s+may\\s+(?:(?:also|then)\\s+)*${stem}\\b|\\bunless\\s+${DECLINER}\\s+${stem}\\b`, "i").test(clauseText) || (anyPlayer !== "" && new RegExp(anyPlayer.slice(1), "i").test(clauseText));
}

/** THE SACRIFICE FALLS ON EVERY PLAYER (#1579, owner ruling 2026-11-09: "edicts on everyone" are mass removal): "Each player sacrifices a creature of their choice" (Innocent Blood, Fleshbag Marauder), "each opponent sacrifices ..." (Liliana's Triumph), "each player ... sacrifices X creatures"
 *  (Death Cloud, Pox), and "at the beginning of each player's upkeep, that player sacrifices ..." (Call to the Grave). Not "target player" (it can be aimed at one: `sacrificerIsTargeted`), not "each opponent MAY sacrifice" (an option: Braids), and not "unless that player sacrifices" (a price: Demanding Dragon).
 *  CEILING: read over the printed words of the clause; a clause that also has a targeted or optional edict is read on its first cue only. */
const EVERYONE_SACRIFICES = /\b(?:each|every) (?:other )?(?:player|opponent)\b(?!'s)[^.]{0,200}?\bsacrifices?\b|\beach (?:player|opponent)'s [^.]{0,80}?,\s*that player (?:(?:also|then) )*sacrifices?\b/i;
const EVERYONE_MAY = /\b(?:each|every) (?:other )?(?:player|opponent) may\b/i;
export function sacrificeFallsOnEveryone(clauseText: string): boolean {
  return EVERYONE_SACRIFICES.test(clauseText) && !EVERYONE_MAY.test(clauseText);
}
