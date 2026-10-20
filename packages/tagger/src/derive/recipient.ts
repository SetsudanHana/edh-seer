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
const WHO = "its controller|their controller|target opponent|each opponent|each other player|defending player|attacking player|that player|target player|each player|those players";

/** The actor must sit immediately against its OWN verb. "each opponent loses 1 life and you gain 1
 *  life" is the commonest drain wording in the corpus, and reading its recipient onto the gain would
 *  hand your own lifegain payoffs to the opponent — the exact false-edge shape this exists to remove.
 *  Only words that never change who acts may intervene -- see ADVERB. */
/** Words that may sit between the player and the verb: "each opponent ALSO discards a card"
 *  (Liliana's Triumph), "that player THEN draws". The cue missed "also" and the discard fell through
 *  to the controller default -- an opponent's discard read as yours. */
const ADVERB = "(?:(?:may|also|then|instead)\\s+)*";
const CUES: [string, RegExp][] = [
  ["create", new RegExp(`\\b(${WHO})\\s+${ADVERB}creates?\\b`, "i")],
  ["draw", new RegExp(`\\b(${WHO})\\s+${ADVERB}draws?\\b`, "i")],
  ["search", new RegExp(`\\b(${WHO})\\s+${ADVERB}searc(?:h|hes)\\b`, "i")],
  ["mill", new RegExp(`\\b(${WHO})\\s+${ADVERB}mills?\\b`, "i")],
  // The amount is OPTIONAL between the verb and "life": "its controller gains life equal to its
  // power" (Swords to Plowshares) has no word there, and demanding one handed Swords' lifegain to
  // YOU for the whole life of this table -- a lifegain payoff fed by your own removal spell
  // (owner-reported off the Arcane Denial card page, 2026-09-05).
  ["lose-life", new RegExp(`\\b(${WHO})\\s+${ADVERB}loses?\\s+(?:\\S+\\s+){0,2}?life\\b`, "i")],
  ["gain-life", new RegExp(`\\b(${WHO})\\s+${ADVERB}gains?\\s+(?:\\S+\\s+)?life\\b`, "i")],
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
  ["sacrifice", new RegExp(`\\b(${WHO})\\s+${ADVERB}sacrifices?\\b`, "i")],
  ["discard", new RegExp(`\\b(${WHO})\\s+${ADVERB}discards?\\b`, "i")],
  // Mind Funeral: "Target opponent reveals cards ... That player puts all cards revealed this way
  // into their graveyard" -- a mill written as a put, and the only verb the actor table did not
  // know, so the fill derived `any` and the delve pass had to read the printed "target opponent"
  // itself (`fillsOnlyOpponents`, PR #344). 54 corpus clauses put with a named actor; "that player"
  // 27, "each player" 11, "target opponent" 6. derive.ts fills only an UNSTATED control for this
  // verb: "puts a creature card ... onto the battlefield under your control" (Visions of Dread) is
  // the opponent acting and YOUR permanent entering, and the object text already says so.
  ["put", new RegExp(`\\b(${WHO})\\s+${ADVERB}puts?\\b`, "i")],
];

/** "THAT PLAYER'S GRAVEYARD" IN A COMBAT-DAMAGE TRIGGER IS THE DAMAGED PLAYER (#1250, Tinybones): when the
 *  damager is yours -- the card itself, "this Vehicle", "equipped creature" (CR 301.5b: equip attaches to a creature
 *  you control), anything "you control" -- the player it hit is an opponent's, and "to an opponent" says so
 *  outright. "A creature deals combat damage to a player" could hit you, so that stays `any`.
 *  CEILING: an equipped creature an opponent later gains control of (CR 301.5d: the Equipment's controller is
 *  separate from the creature's) could damage you, and "that player" would be you; not modelled. Likewise a
 *  non-combat "deals damage to a player" from your own creature (Marsh Viper, Pit Scorpion) is read as an opponent
 *  though a self-aimed ping could hit you.
 *  CEILING: residue still at `any`, which still feeds "whenever you ..." payoffs: "they" wordings after the card's own
 *  damage (Glowing One, Infesting Radroach, Unstoppable Slasher, Rex); a clause with two actions of one verb, where
 *  `actorFor` refuses (Sabertooth Cobra); and the "reveals ... puts into graveyard" mill (Mirko Vosk, Balshan Beguiler). */
export function damagedPlayerIsOpponent(clauseText: string, triggerIsSelf: boolean, cardName?: string): boolean {
  // SCANNED, NOT MATCHED: `^\s*(?:whenever|when)\s+(.+?)\s+deals?\s+combat damage…` backtracks
  // polynomially on runs of spaces (CodeQL js/polynomial-redos), so the shape is read with string search.
  const text = clauseText.trimStart();
  const lower = text.toLowerCase();
  const start = lower.startsWith("whenever ") ? 9 : lower.startsWith("when ") ? 5 : -1;
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
  const who = head.slice(0, verbAt).trim();
  return triggerIsSelf || /\byou control\b/i.test(who) || /^(?:this |equipped creature$)/i.test(who)
    || (cardName !== undefined && (who === cardName || who.toLowerCase() === cardName.split(",")[0]!.toLowerCase()));
}

/** An actor phrase to the control it states, or undefined when it states nothing sharper than "any".
 *
 *  "its controller" is a DECISION, not a reading: the rules let you point Pongify at your own
 *  creature, so the honest rules answer is "any". It is called `opp` because these are removal spells
 *  and that is where they get pointed, and because being wrong here only ever removes an edge. */
function controlOf(phrase: string, text: string, at: number, ctx: ActorContext): Control | undefined {
  const p = phrase.toLowerCase();
  // AFTER AN UNTARGETED TRIGGER SUBJECT IT IS ANYONE (#650): "Whenever a creature enters, its
  // controller sacrifices ..." (Tainted Aether) points at the creature that entered, which can be
  // yours. A target or an opponent named first keeps the removal reading, as does a bare fragment.
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
  if (p === "target opponent" || p === "each opponent" || p === "each other player" || p === "defending player" || p === "attacking player") return "opp";
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

/** What the caller knows about the clause's trigger, for "that player" after damage (#1263). */
export interface ActorContext { triggerIsSelf?: boolean; cardName?: string }

export function actionRecipients(clauseText: string, ctx: ActorContext = {}): Record<string, Control> {
  const out: Record<string, Control> = {};
  for (const [verb, re] of CUES) {
    const m = re.exec(clauseText);
    // "YOU DRAW" IS A STATED ACTOR, NOT AN UNSTATED ONE (owner-reported 2026-09-17, Scrawling
    // Crawler <- Y'shtola, Night's Blessed): "if a player lost 4 or more life this turn, you draw a
    // card" names a player in the condition, so the controller default below refused to fill `you`
    // and the draw derived `any` -- which met "whenever an OPPONENT draws". 350 of the 671 corpus
    // draw emits at `any` had the same shape. The printed "you" outranks a player word elsewhere in
    // the sentence; it yields only to an opponent cue written BEFORE it on the same verb.
    const stem = STEMS[verb];
    const yours = stem ? new RegExp(`\\byou\\s+${ADVERB}${stem}`, "i").exec(clauseText) : null;
    // Contested -- yours first, then an opponent's on the same verb (Braids) -- stays unstated.
    if (yours && m && yours.index < m.index) continue;
    if (yours && !m) { out[verb] = "you"; continue; }
    if (!m) continue;
    const control = controlOf(m[1], clauseText, m.index, ctx);
    // An exile cue speaks only when it states an opponent: "that player exiles the top card of one of their
    // OPPONENTS' libraries" (Shared Fate) is another player's library, which the object already says.
    if (control && !(verb === "exile" && control !== "opp")) out[verb] = control;
  }
  return out;
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
  const stem = DECLINE_VERBS[verb];
  if (!stem) return false;
  return new RegExp(`\\b${DECLINER}\\s+may\\s+(?:(?:also|then)\\s+)*${stem}\\b|\\bunless\\s+${DECLINER}\\s+${stem}\\b`, "i").test(clauseText);
}
