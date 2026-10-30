/** An action to one of the engine's closed 29 effect kinds, or nothing.
 *
 *  Two things make this more than a lookup. First, the origin zone is often the whole card: `exile`
 *  from a graveyard is graveyard hate, `exile` from the battlefield is removal. Second, the engine's
 *  vocabulary is payoff-centric and has NO removal kind, so `destroy` legitimately maps to nothing
 *  and reaches the graph through its `dies` emit instead. A near-miss kind is worse than null: it is
 *  consumed as if it were true. */
import type { Action } from "../canonicalize.js";
import type { EffectKind } from "../schema.js";
import { parseSubject, spellMove } from "./subject.js";
import { readToHand, type ToHandRead } from "./to-hand.js";
import { targetingBanOf, triggerSuppressionOf, untapDenialOf } from "./cant-kinds.js";

/** Zone-sensitive rules, checked before the plain lookup. Order matters within this list.
 *  `from`/`to` omitted means "don't care"; `from: null` means the clause STATED NO ORIGIN.
 *  CHANGED 2026-09-07: `null` used to also mean `library`, because canonicalAction collapsed the
 *  two. It no longer does (CR 400.1 — library is a zone; CR 400.7 — the move is the event), so a
 *  library origin is now written as `from: "library"` and says so. */
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
  // Cards put into a graveyard FROM THE LIBRARY are self-mill, the same payoff `mill` names. The
  // origin is load-bearing: "put target creature into its owner's graveyard" moves it off the
  // battlefield, which is removal, and calling that a self-mill payoff would mesh removal
  // with every mill deck. It says `library` outright since 2026-09-07; it used to say `null` and
  // rely on canonicalAction having folded library into it, which also swept up 11 actions that
  // stated no origin at all. Corpus: put->graveyard is library 148, exile 18, unstated 11 — the 11
  // are now unclassified, which is the honest answer for a clause that never said where from.
  // A SEARCHED PUT IS NOT ONE (CR 701.17a: milling is the TOP cards). Entomb and Buried Alive put
  // a card into a graveyard from the library too, and the origin alone cannot tell them from
  // Cavalier of Thorns -- the clause does, because a tutor states the search. Guarded below rather
  // than here so the row stays a plain zone rule; `searchedPut` is the predicate.
  { verb: "put", from: "library", to: "graveyard", kind: "mill" },
  // SETTING THE TOP OF YOUR LIBRARY. Sensei's Divining Top reorders the top three; Brainstorm and
  // Hidetsugu and Kairi put cards from hand on top. Both are the player choosing what they draw
  // next, and neither had a kind before 2026-09-07 -- which is why an entire top-of-library deck
  // read as `["draw-card", "player-life-loss", ""]` on its commander.
  //
  // THE ORIGIN IS THE GUARD. `put -> library` from the BATTLEFIELD is tuck REMOVAL (52 actions:
  // Aetherspouts, Spin into Myth, Jeskai Charm) and from the STACK is Approach of the Second Sun
  // (12). Only library and hand origins are the player stacking their own deck. Checked: of the 31
  // corpus cards that put something "Nth from the top", NONE has a library or hand origin.
  { verb: "put", from: "library", to: "library", kind: "top-set" },
  { verb: "put", from: "hand", to: "library", kind: "top-set" },
  // A CLASS-RESTRICTED DIG IS A TYPED SEARCH (owner ruling 2026-09-16, AF10 ruling 4; recall v6
  // #165 Eclipsed Flamekin -> Smoldering Marsh, first drawn as v3 #141). This row was added and
  // reverted on 2026-09-07 because it caught the wrong bucket: a REAL tutor states the `search`
  // verb, which VERB_KIND already maps, so the row bought nothing for Demonic Tutor or Entomb and
  // only tagged the 343 corpus actions that put a card from library to hand with NO search in the
  // clause -- DIGGING (Eclipsed Flamekin looks at the top four; Dig Through Time at the top seven).
  // The 09-07 reading was that a dig four cards deep cannot find the piece, so it is not a copy of
  // it. The owner's 09-16 ruling is that a dig restricted to a CLASS reaches the cards of that
  // class the way a class-restricted search does. So the row is gated in `actionEffectKind` on the
  // object naming a class: "an Elemental, Island, or Mountain card" is a search, "two of them"
  // (Dig Through Time) and "a card" are not, and the matcher's tutor pass keeps its own bar on what
  // narrows (a whole-board type still forms no edge).
  //
  // The corpus splits on the `search` verb: WITH search -- put->battlefield 311 (Farseek),
  // put->hand 258 (Demonic Tutor), put->library 58 (Worldly Tutor), put->graveyard 25 (Entomb).
  // WITHOUT -- put->library 348 (Sensei's Divining Top, Brainstorm-shaped, not a tutor), put->hand
  // 343, of which the typed ones are what this row admits.
  { verb: "put", from: "library", to: "hand", kind: "search" },
  // BOUNCE (#802): to hand from the battlefield or the stack. The graveyard origin is recursion,
  // above; an unstated origin stays unclassified.
  { verb: "return", from: "battlefield", to: "hand", kind: "bounce" },
  { verb: "put", from: "battlefield", to: "hand", kind: "bounce" },
  { verb: "return", from: "stack", to: "hand", kind: "bounce" },
  { verb: "put", from: "stack", to: "hand", kind: "bounce" },
];

/** WHERE A RETURN TO HAND COMES FROM WHEN THE CLAUSE DID NOT SAY (#802): 268 corpus actions state
 *  no origin, and most are plain bounces ("another target creature you control", "target nonland
 *  permanent", "this enchantment"). A permanent noun is on the battlefield and a spell on the
 *  stack; both at once ("target spell or permanent") is a bounce with no one zone. A CARD is in a
 *  hidden zone or a graveyard ("a creature card you own from outside the game"), and a bare pronoun
 *  names nothing, so those stay unclassified. */
const PERMANENT_NOUN = /\b(?:permanents?|creatures?|lands?|artifacts?|enchantments?|planeswalkers?|battles?|vehicles?|auras?|equipment)\b/i;
const SPELL_NOUN = /\bspells?\b/i;
/** "TARGET NONLAND PERMANENT OR SUSPENDED CARD" (Venser's Diffusion) is a permanent on the battlefield OR a card in exile; `parseSubject` already reads
 *  only the permanent half, so the origin test reads the same half. CEILING: the suspended-card half (a card in exile with a time counter) is not modelled; the
 *  bounce emit is the battlefield one alone. Only this exact tail is cut: "creature or artifact card" is a list of card types, not a second zone. */
export function permanentHalf(object: string): string {
  return object.replace(/ or suspended cards?$/i, "");
}
export function bounceOrigin(action: Action): "battlefield" | "stack" | undefined {
  if (action.fromZone === "battlefield" || action.fromZone === "stack") return action.fromZone;
  const object = permanentHalf(action.object ?? "");
  if (action.fromZone || /\bcards?\b/i.test(object)) return undefined;
  // BOTH AT ONCE ("target spell or permanent", Venser) is a bounce whose effect subject is the PERMANENT half (the filter drops the spell): the battlefield, as it has always read.
  const spells = spellMove(object);
  if (spells === "only") return "stack";
  return spells === "mixed" || PERMANENT_NOUN.test(object) ? "battlefield" : undefined;
}
function bouncesUnstated(action: Action): boolean {
  if (action.fromZone || action.toZone !== "hand" || (action.verb !== "return" && action.verb !== "put")) return false;
  const object = permanentHalf(action.object ?? "");
  return !/\bcards?\b/i.test(object) && (PERMANENT_NOUN.test(object) || SPELL_NOUN.test(object));
}

/** "YOU MAY cast artifact spells ... FROM THE TOP OF YOUR LIBRARY" (#856): the permission and the phrase
 *  after it in one sentence. Not a cascade's "When you cast this spell, exile cards from the top of
 *  your library" (no "you may"), nor its "You may cast it" (a sentence of its own). String search. */
export function playsFromTop(text: string): boolean {
  return text.toLowerCase().split(".").some((sentence) => {
    const at = sentence.indexOf("from the top of your library");
    return at > 0 && /\byou may (?:play|cast)\b/.test(sentence.slice(0, at));
  });
}

/** "YOU MAY ACTIVATE ... LOYALTY ABILITIES" again or at instant speed (#859): whose they are -- your
 *  planeswalkers, or the card's own. A cost increase (Carth the Lion) names no permission. String
 *  search per sentence, no regex over the text. */
const AGAIN = ["twice", "as though none", "any time you could cast an instant", "on any player's turn"];
export function extraLoyalty(text: string): "yours" | "self" | undefined {
  for (const sentence of text.toLowerCase().split(".")) {
    const at = sentence.indexOf("you may activate");
    if (at < 0 || sentence.indexOf("loyalty abilit", at) < 0 || !AGAIN.some((w) => sentence.includes(w))) continue;
    // A QUOTED PERMISSION BELONGS TO WHAT THE QUOTE IS ON: Teferi, Temporal Archmage's "You get an
    // emblem with 'You may activate ...'" is the EMBLEM's ability, and the emblem is its own node
    // (2026-09-08). Read on the card, it claimed every planeswalker a second time.
    if (sentence.includes("emblem") || /["“']/.test(sentence.slice(0, at))) continue;
    return sentence.includes("planeswalkers you control") || sentence.includes("planeswalker you control") ? "yours" : "self";
  }
  return undefined;
}

/** "CHANGE THE TARGET OF TARGET SPELL ..." / "CHOOSE NEW TARGETS FOR TARGET SPELL OR ABILITY" (CR 115.7, #1266): the noun phrase
 *  after the head ("target spell or ability"), cut at the first word that starts a condition or a destination, or undefined when the
 *  text redirects nothing a TARGET names -- your own copy ("choose new targets for the copy", #491), "that spell", a text change.
 *  Linear: fixed heads by `indexOf`, a split on sentence punctuation, then a word scan. */
const RETARGET_HEADS = ["change the target of ", "change the targets of ", "change a target of ", "change any targets of ", "choose new targets for ", "choose a new target for "];
const RETARGET_STOP: ReadonlySet<string> = new Set(["with", "that", "if", "to", "which", "unless"]);
/** A BLOCKING RESTRICTION THE CARD'S OWN ATTACKER CARRIES (CR 509.1b: "A restriction may be created by an evasion ability (a static
 *  ability an attacking creature has that restricts what can block it)"): "can't be blocked", "... except by Walls", "... by creatures with
 *  power 3 or greater", "... this turn", "... as long as ...". The model stores it as `cant | be blocked ...` (or with the subject kept in the
 *  object: "this creature can't be blocked"). It also files "MUST be blocked if able" (Gorm, The Foretold Soldier, Frodo Baggins, Maarika) as
 *  `cant | not be blocked ...` and "must be blocked by two or more creatures" as `be blocked by fewer than two creatures`: a drawback, not
 *  evasion, so a leading "not" and "fewer than" are refused (and the printed clause must say "can't be blocked").
 *  "Can't block" is the other restriction and never has "be blocked" in its object. A quoted grant ("a token with 'This token can't be blocked'")
 *  is a `create`/`grant-ability` verb and never reaches here. */
export function cantBeBlocked(object: string, clauseText = ""): boolean {
  if (!/\bbe blocked\b/i.test(object)) return false;
  if (/^\s*not\b/i.test(object) || /\bfewer than\b/i.test(object) || /\bas though\b|\bblock or be blocked\b/i.test(object)) return false;
  // THE PRINTED CLAUSE MUST SAY IT. The model also files other sentences as `cant | ... be blocked ...`: "Protection from Vampires" (Elite
  // Inquisitor: protection's own blocking clause, a keyword, not a printed evasion), "can attack as though it didn't have defender" (Krotiq
  // Nestguard, Colossus of Akros), "Creatures with swampwalk can be blocked as though ..." (Ur-Drago), "all creatures able to block target
  // creature this turn do so" (Taunting Arbormage). Where the clause text is known it has to print "can't be blocked".
  // CEILING: "can't block or be blocked by ..." (Sneaky Homunculus) is both a drawback and an evasion and is left unread; so is "can be blocked
  // only by creatures in the same sector" (Space Beleren), a restriction that does not print "can't be blocked".
  return clauseText === "" || /\b(?:can['\u2019]t|cannot) be blocked\b/i.test(clauseText);
}

/** A RESTRICTION ON ATTACKING OR BLOCKING (CR 508.1c: "effects that say a creature can't attack"; CR 509.1b: "effects that say a creature can't block"), and which of the two (#1315).
 *  The model stores `cant | attack or block` (Pacifism, Arrest), `cant | block` (Gravecrawler, Bedlam), `cant | attack` (Moat), `cant | block this turn`, or keeps its subject in the
 *  object ("enchanted creature can't block", Mishra's Domination). ONLY the bare forms read: "attack", "block", "attack or block", with "this turn" or "until your next turn".
 *  Not "can't attack you or planeswalkers you control" (Vow of Flight; Propaganda's tax is a payable and is read first), not a requirement ("not attack each combat if able",
 *  "doesn't attack"), not a narrowed block ("block creatures without flying", "block this creature"), not "alone" and not an "unless" condition, and never "be blocked" (evasion).
 *  CEILING: the narrowed and conditional forms are left unread -- 32 "block creatures without flying", 26 "attack unless defending player controls an island", 12 "... alone",
 *  11 "block this creature" stored objects (research/tagger/restriction-objects.ts, 2026-10-22); each is a real restriction that this kind would overclaim as total.
 *  CEILING: a CONDITION on the sentence is refused (derive 374): 38 abilities on 34 cards that read as total at 373 (Childhood Horror, Putrid Imp, Barrage of Boulders, Demoralize, Aragorn's
 *  monarch sentence, Clawing Torment's "As long as enchanted permanent is a creature, it gets -1/-1 and can't block" ...); a condition the clause text does not print is unseen.
 *  Where the clause text is known it must print "can't|cannot attack|block". Linear: one `search`, one anchored match. */
export function restrictedActions(object: string, clauseText = "", occurrence = 0): ("attack" | "block")[] | undefined {
  if (/\bbe blocked\b/i.test(object)) return undefined;
  const at = object.search(/\b(?:can['\u2019]t|cannot)\s/i);
  const rest = (at < 0 ? object : object.slice(object.indexOf(" ", at) + 1)).trim();
  const m = /^(attack|block)(?: or (attack|block))?(?: this turn| until your next turn)?$/i.exec(rest);
  if (!m) return undefined;
  if (clauseText !== "") {
    // WHICH PRINTED "can't attack|block" THIS ACTION IS: the n-th, when the model stored the same object twice (Aragorn, King of Gondor: "up to one target creature can't block
    // this turn. If you're the monarch, creatures can't block this turn"). A CONDITION on the sentence makes the restriction partial, so it is refused (#1315 review): a trailing one
    // ("can't block unless / if / as long as / only / alone / except / while ...") and a LEADING one in the same sentence ("As long as seven or more cards are in your graveyard, this
    // creature gets +2/+2 and can't block", "If you're the monarch, creatures can't block this turn"). A trigger head alone is not a condition ("Whenever Aragorn attacks, ..."), and an
    // "Otherwise, it can't block" sentence is NOT refused: it is the either-or Aura's other half (Mishra's Domination, Bonds of Faith), whose condition is the sentence before.
    // CEILING: a leading "As long as enchanted creature is red, it gets +1/+1 and can't block" on an Aura is refused too, like any same-sentence leading condition.
    const hits = [...clauseText.matchAll(/\b(?:can['\u2019]t|cannot) (?:attack|block)\b/gi)];
    const hit = hits[Math.min(occurrence, hits.length - 1)];
    if (!hit) return undefined;
    const from = clauseText.lastIndexOf(". ", hit.index) + 1;
    const head = clauseText.slice(from === 0 ? 0 : from + 1, hit.index);
    if (/\b(?:as long as|if|while)\b/i.test(head)) return undefined;
    const after = clauseText.slice(hit.index + hit[0].length);
    const end = after.indexOf(". ");
    // ...up to a trailing "and its activated abilities can't be activated unless they're mana abilities" (Faith's Fetters, #1391 F7): that rider is the OTHER phrase's, the ability-loss.
    const sentence = (end < 0 ? after : after.slice(0, end)).split(/,? and (?:its|their) activated abilities\b/i)[0]!;
    if (/\b(?:unless|if|as long as|only|alone|except|while)\b/i.test(sentence)) return undefined;
  }
  const out = [m[1]!.toLowerCase(), ...(m[2] ? [m[2].toLowerCase()] : [])] as ("attack" | "block")[];
  return [...new Set(out)];
}

function retargetPhrase(text: string): string | undefined {
  const lower = text.toLowerCase();
  for (const head of RETARGET_HEADS) {
    const at = lower.indexOf(head);
    if (at < 0) continue;
    let tail = lower.slice(at + head.length).split(/[.;,]/, 1)[0]!;
    if (tail.startsWith("the target ")) tail = tail.slice(4);
    if (!tail.startsWith("target ")) continue;
    const words: string[] = [];
    for (const word of tail.split(" ")) {
      if (RETARGET_STOP.has(word)) break;
      if (word !== "") words.push(word);
    }
    const phrase = words.join(" ");
    return /\b(?:spells?|abilit(?:y|ies))$/.test(phrase) ? phrase : undefined;
  }
  return undefined;
}
/** The target spell/ability an action redirects, or undefined. The model writes the head into an `other` object (Redirect, Misdirection, Willbender)
 *  and, on seven cards, files the words under another verb with the head left in the clause: `cost-modify` ("target spell with a single target" --
 *  Shunt; "the target of target spell or ability that targets only this creature" -- Silver Wyvern; "change that spell's target to another
 *  creature" -- Meddle, Quicksilver Dragon) and `exchange` ("a target of target spell or ability and this creature" -- Spellskite). Those read the CLAUSE
 *  text, and only when the action's own object names the spell or ability it found, so a sibling action of the same clause is not read twice.
 *  CEILING: "choose new targets for any number of other spells and/or abilities" (Boltbender) names no target, so it is not read. The same for the real
 *  redirects of the spell an opponent casts that name no TARGET spell: Speedball, New Warrior ("choose new targets for that spell"), Captured by the Consulate
 *  ("change the target to enchanted creature"), Psychic Battle ("change the target or targets"). They redirect "that spell" / the triggering spell, and a
 *  counter of "that spell" counts only after an earlier "target ... spell" in the same ability (owner ruling); the printed pattern missed them too. */
export function retargetObject(object: string, verb = "other", clauseText = ""): string | undefined {
  const own = retargetPhrase(object);
  if (own !== undefined || (verb !== "cost-modify" && verb !== "exchange")) return own;
  const lowerObject = object.toLowerCase();
  const fromClause = retargetPhrase(clauseText);
  if (fromClause !== undefined && lowerObject.includes(fromClause)) return fromClause;
  return lowerObject.startsWith("change that spell's target") && clauseText.toLowerCase().includes("target spell") ? "target spell" : undefined;
}

/** Does a dig's object name a class -- a type, subtype, stat predicate or name, on the subject or
 *  in an `anyOf` branch? "Two of them" and "a card" do not. See the `put library -> hand` row. */
/** The read of a `put library -> hand` that is the top of your own library going to your hand without a printed search (`to-hand.ts`), or `undefined`. One reading for the effect kind and for the ability's markers. */
export function handFillRead(action: Action, clauseText: string, nth = 0): ToHandRead | undefined {
  if (action.verb !== "put" || action.fromZone !== "library" || action.toZone !== "hand") return undefined;
  const object = String(action.object ?? "");
  return readToHand(object, clauseText, digNamesAClass(object), nth);
}
function digNamesAClass(object: string): boolean {
  const s = parseSubject(object);
  const has = (b: Partial<typeof s>): boolean =>
    b.type !== undefined || b.subtype !== undefined || (b.stats?.length ?? 0) > 0 || b.named !== undefined;
  return has(s) || (s.anyOf ?? []).some(has);
}

/** Kinds whose whole meaning is the zone the subject sits in: `edges.ts` will not draw a
 *  reanimator edge unless `effect.subject.zone === "graveyard"`, so a recursion effect that loses
 *  the zone is a recursion no graveyard-filler can ever feed. */
export const ZONE_SCOPED_KINDS: ReadonlySet<string> = new Set(["graveyard-recursion", "graveyard-hate", "bounce", "play-from-top"]);

/** "enters with N counters on it" — the card's own entry, CR 614.1c. Anchored on "enters with" so a
 *  clause that merely mentions entering ("whenever a creature enters, put a counter on it") is not
 *  caught: that one really does place counters later and is ordinary `counter-placement`. */
const ENTERS_WITH = /\benters? with\b[^.]{0,40}\bcounters?\b/i;

/** "…on the bottom of your library" — the disposal half of a dig, never a top-of-library supply. Also the library left unsaid, as the Star Trek digs print it
 *  ("Put the rest on the bottom in a random order", There's Coffee in that Nebula): read without it, that dig's rest was `top-set`. */
const ON_THE_BOTTOM = /on the bottom (?:of (?:your|their|its owner's|a|the) librar|in (?:any|a random) order)/i;
/** A CHOICE OF TOP OR BOTTOM IS TOP MANIPULATION: Dream Cache puts two cards from your hand "both
 *  on top of your library or both on the bottom", and the bottom guard alone dropped it (DERIVE
 *  162; the rate then read it as 3 cards for 3 mana with nothing to net). */
const ON_TOP = /on top of (?:your|their|its owner's|a|the) librar/i;

/** The energy object as the clause layer writes it: a bare `E`, `{E}`, or the word itself. No mana
 *  symbol is ever `E` -- mana is WUBRGC, a number, or X -- so this cannot catch a real mana object.
 *
 *  IT WAS A REGEX AND CODEQL WAS RIGHT ABOUT IT. `/^\s*\{?\s*e\s*\}?\s*$/i` puts four `\s*` runs
 *  around two optional braces, so a long run of spaces that does not match backtracks quadratically
 *  (`js/polynomial-redos`, high). Stripping the braces and trimming asks the same question in one
 *  linear pass, and reads as what it means. */
export const isEnergyObject = (object: string): boolean =>
  // Braces AND spaces go (DERIVE 172): the clause layer also writes "E E E", and trimming the ends
  // only left "e e e", which read as mana on 9 cards (Chthonian Nightmare, Bristling Hydra, ...).
  /^e+$/.test(object.replace(/[{}\s]/g, "").toLowerCase());

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
  // CR 701.71 empower Jace, Reality Fracture: loyalty counters on a Jace token, creating it first if
  // there is none -- amass's shape exactly, so amass's kind.
  "empower-jace": "counter-placement",
  "turn-face-up": "animate",
  "trigger-again": "trigger-doubling",
  // (The old note here said `copy-spell` could never fire because VERBS has only `copy`. True of the
  // VERB and false of the CLAUSE: the OBJECT says which is copied — "target spell" versus "target
  // creature" — exactly as it does for `double`. Resolved in `actionEffectKind`.)
  mill: "mill",
  // Its own kind. It read `token-generation` until 2026-09-08 and put "makes a token" on 86
  // planeswalkers; CR 114.1 says an emblem is an object in the command zone, not a permanent.
  emblem: "emblem",
  // A tutor rearranges what you draw, which is the same payoff `mill` names. Demonic Tutor's live
  // flat tag is exactly this, so the kind is one the engine already consumes.
  search: "search",
  // Same payoff again, from the other end of the library. Barrier of Bones' live flat tag for its
  // surveil is exactly this. Neither verb gets an EMIT: surveil does fill a graveyard, but flat
  // gives Barrier of Bones no emit either, and an invented emit is the change reverted from the
  // bounce/`leaves` work — a starving consumer count is not evidence.
  scry: "scry",
  surveil: "surveil",
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
    // "Opponents" in the COUNT is not who pays: Rakdos, Lord of Riots' creature spells cost less "for
    // each 1 life your opponents have lost this turn", a discount for you, not a tax on them.
    if (more || /\bopponents?\b/.test(t.split(/\bfor each\b|\bwhere x is\b/)[0]!)) return "tax";
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
/** The clause goes on to copy, play, cast or put onto the battlefield what it exiled -- read from
 *  the exile onward, so a use named BEFORE it is not this exile's. "exiled this way" alone is NOT a
 *  use -- "you gain 1 life for each card exiled this way" is still hate. */
// "puts all cards they exiled this way onto the battlefield" is Living Death and Living End (recall
// v7 #187, 2026-09-16): a mass reanimation that derived `graveyard-hate` + `flicker`, so no
// sacrifice outlet ever fed it. 2 corpus cards; the other 30 "exiled this way" wordings exile from
// a library, a hand or the battlefield and are not this row's.
const USES_THE_EXILED_CARD = /\bcopy of (?:it|them|that card|those cards)\b|\bplay (?:it|them|that card|those cards|a card from exile|cards? (?:exiled|from exile))\b|\bcast (?:it|them|that card|those cards)\b|\bputs? (?:it|them|that card|those cards|all cards (?:they|you) exiled this way) onto the battlefield\b/i;
// #729 (owner ruling 2026-10-09): taking a card OUT of an opponent's graveyard and using it is
// recursion over their yard. These are the wordings the first regex missed: "Copy that card" /
// "Copy the exiled card" (Flawless Forgery, Saruman of Many Colors; the imperative, not "a copy of"),
// and "cast any number of spells from among cards exiled this way" (Kefka). "a copy of THIS CREATURE"
// (Uchuulon) copies the card itself, uses nothing, and is deliberately not here.
const PUTS_FROM_YARD_ONTO_BATTLEFIELD = /\bputs? [^.]*?\bgraveyards? onto the battlefield\b/i;
const USES_THE_EXILED_CARD_2 = /\bcop(?:y|ies) (?:it|them|that card|those cards|the exiled cards?)\b|\b(?:play|cast) [^.]*?\bfrom among cards exiled (?:this way|with)\b/i;
// "your graveyard", and "your hand or graveyard" / "your hand and/or graveyard" (Mairsil): the graveyard half is still yours.
const YOUR_YARD = /\byour (?:(?:hand|library)(?: or| and\/or| and) )?graveyard\b/i;
const OTHER_YARD = /\b(?:target player'?s?|opponents?'?s?|each player'?s?|their)\s+graveyards?\b/i;

export function exilesOwnGraveyard(object: string, clauseText: string): boolean {
  if (YOUR_YARD.test(object)) return true;
  if (OTHER_YARD.test(object)) return false;
  return YOUR_YARD.test(clauseText) && !OTHER_YARD.test(clauseText);
}

/** WHOSE GRAVEYARD AN EXILE TAKES ITS CARDS FROM, as far as the printed words say it is YOURS (#1266, graveyardHate). A rule that wants graveyard HATE
 *  must tell "exile that card from your graveyard" (Necropotence, Bag of Holding, a delve-shaped cost, Purgatory) from "exile that player's graveyard"; the
 *  emit's `owner: "you"` is that answer (CR 400.3: a card goes to its OWNER's graveyard). Read off the object when it names a graveyard; off the clause when
 *  the object is a pronoun or a bare class ("that card", "another creature card"): the clause says "your graveyard", or the trigger is YOUR discard
 *  ("Whenever you discard a card, exile it": the card goes to your yard). An object naming "a graveyard" / "graveyards" / "that player's graveyard" is not.
 *  EACH PLAYER FROM THEIR OWN GRAVEYARD, THE CARDS COMING BACK (Living Death, Living End, Scrap Mastery: "puts all cards they exiled this way onto the
 *  battlefield") is every player's own yard and takes nothing from anyone: yours among them. Without the return (Grave Consequences, Curse of Oblivion)
 *  it is not. Word tests only, no backtracking shape. */
const ANY_YARD = /\bgraveyards?\b/i;
const YOU_DISCARD = /\b(?:whenever|when) you discard\b/i;
const EACH_PLAYER_EXILES = /\beach player exiles\b/i;
const THEIR_YARD = /\btheir graveyard\b/i;
const THEY_EXILED_THIS_WAY = /\bthey exiled this way\b/i;
const ONTO_THE_BATTLEFIELD = /\bonto the battlefield\b/i;
export function exilesFromYourGraveyard(object: string, clauseText: string): boolean {
  if (EACH_PLAYER_EXILES.test(clauseText) && THEIR_YARD.test(object) && THEY_EXILED_THIS_WAY.test(clauseText) && ONTO_THE_BATTLEFIELD.test(clauseText)) return true;
  if (ANY_YARD.test(object)) return YOUR_YARD.test(object) && !OTHER_YARD.test(object);
  if (YOU_DISCARD.test(clauseText) && !OTHER_YARD.test(clauseText)) return true;
  return exilesOwnGraveyard(object, clauseText);
}

/** An exile whose object names graveyards (and no other zone) takes its cards from one, though the model stored no origin: "up to twice X target cards from
 *  graveyards" (Erebos's Intervention), "from a single graveyard", "all graveyards", "that player's graveyard", "from defending player's graveyard"
 *  (#1266). A hand or library named beside it, a battlefield half ("all creatures and graveyards", "from the battlefield and/or creature cards from graveyards": Angel of Serenity; "put there from the battlefield" is only the history of a card in the yard), or a destination ("into that player's graveyard")
 *  keeps the model's reading: one `fromZone` cannot hold two zones. CEILING: Identity Crisis, Thought Distortion, Ashiok's -10 and Ultimate Nullification
 *  (a graveyard half beside a hand or the battlefield) stay unzoned. */
const OTHER_ZONE_WORD = /\b(?:hands?|librar(?:y|ies)|into|onto|instead)\b|\band graveyards?\b|\bthe battlefield (?:and|or)\b|\bon the battlefield\b|^this \w+ (?:and|or)\b/i;
export function exileNamesOnlyGraveyards(object: string): boolean {
  return ANY_YARD.test(object) && !OTHER_ZONE_WORD.test(object);
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

/** The verbs a processor uses on an opponent's exiled card: put/return it into a graveyard or
 *  onto the battlefield, exile it again (Cryptic Cruiser), cast it (Draugr Necromancer). */
const PROCESSES_EXILE: ReadonlySet<string> = new Set(["put", "return", "exile", "cast"]);
/** "a card an opponent owns", "two cards your opponents own", "land cards that player owns" -- the
 *  owner phrase that makes a from-exile move a processor rather than a flicker. */
const OPPONENT_OWNS = /\b(?:an opponent|your opponents|target opponent|that player|each opponent) owns?\b/i;

/** The kind a doubled/tripled THING names: damage, then counters, then tokens, life, mana. Counters
 *  precede tokens so "the number of +1/+1 counters on it" beats a token elsewhere in the text. */
function doubledKind(text: string): EffectKind | null {
  if (/\bdamage\b/i.test(text)) return "damage-multiplier";
  if (/\bcounters?\b/i.test(text)) return "counter-placement";
  if (/\btokens?\b/i.test(text)) return "token-doubling";
  if (/\blife\b/i.test(text)) return "lifegain";
  if (/\bmana\b/i.test(text)) return "mana-generation";
  return null;
}

// "ABILITIES" AS THE SOURCE OF SOMETHING DONE TO THE SUBJECT IS NOT ABILITY-LOSS (#1401 part 5, family E). Peace Talks' "players and permanents can't be the targets of spells or activated
// abilities" strips nobody's abilities -- the abilities are what would TARGET -- yet the bare word "abilit" made two ability-loss statics, which the matcher reads as a board-off effect
// (edges.ts). Same for "can't cause abilities to trigger" (Torpor Orb), "spend this mana only to ... activate an ability" and "can't be blocked by creatures with abilities". 39 model-path
// corpus cards (census 2026-10-30). A `cant` that is none of these keeps the old reading: the subject's own abilities removed or stopped (CR 613.1f layer 6; CR 602.5 "can't be activated").
const ABILITIES_AS_SOURCE = /\btargets? of\b|\btargeted by\b|\btargeting\b|\btargets? (?:spells?|abilit)|\bcaus(?:e|es|ing)\b|\bspend\b|\btrigger\b|blocked by\b|\bfrom \S+ sources?\b/i;
const ABILITIES_PHRASE = /\band (?:its|their) activated abilities\b/i;
function namesOwnAbilitiesStopped(object: string): boolean {
  if (!/\babilit(?:y|ies)\b/i.test(object)) return false;
  if (ABILITIES_AS_SOURCE.test(object)) return false;
  // ONE ACTION HOLDING TWO LIMBS: the grammar reads Hold for Questioning's "doesn't untap during its controller's untap step and its activated abilities can't be activated" as one `cant`
  // and aligns it over the stored "doesn't untap" limb, which then read as ability-loss next to the stored abilities limb (two identical statics). A head that is not itself about
  // abilities or combat is not ability-loss (the abilities limb is read from its own action); "can't attack or block and its activated abilities ..." (Edifice of Authority) keeps the old reading.
  const at = object.search(ABILITIES_PHRASE);
  if (at > 0) {
    const head = object.slice(0, at);
    if (!/\babilit(?:y|ies)\b|\b(?:attack|block)\b/i.test(head)) return false;
  }
  return true;
}

/** A sentence with "instead", a "would ..." frame and the action's OWN word ("damage" for a damage action, "lose"/"loses" for a life loss): it replaces that event rather than causing it.
 *  Sentence by sentence, so Flames of the Blood Hand's separate "if that player would gain life ... instead" does not take its real damage with it. */
function replacesDamageOrLife(clauseText: string, verb: string): boolean {
  const own = verb === "deal-damage" ? /\bdamage\b/i : /\bloses?\b/i;
  return clauseText.split(".").some((sentence) => /\binstead\b/i.test(sentence) && /\bwould (?:be dealt|deal|lose|gain|cause)\b/i.test(sentence) && own.test(sentence)
    // A REDIRECT WHOSE NEW RECIPIENT REACHES A PLAYER IS STILL BURN (#1266): "is dealt to any target instead" (Harm's Way, Shining Shoal, Glarecaster, Mirrorwood Treefolk), "to another target ... player"
    // (Captain's Maneuver), "to that source's controller" (Reflect Damage, Eye for an Eye), "to that creature's controller" (Megatron). A redirect onto the card or "its controller" (Treacherous Link,
    // Daughter of Autumn) and an amplifier ("plus 2") are not. Damage only: a life-loss replacement is never a new source.
    && !(verb === "deal-damage" && REDIRECT_TO_A_PLAYER.test(sentence)));
}
const REDIRECT_TO_A_PLAYER = /\bdealt to (?:any (?:other )?target|another target [^.]{0,60}\bplayer|that (?:source|creature)'s controller)\b|\bdamage to that source's controller\b/i;
const PAYS_LIFE = /\bpays? (?:\d+|x|any amount of) life\b/i;
const LOSES_LIFE = /\bloses? (?:\d+|x|that much|half|life)\b/i;
export function actionEffectKind(action: Action, clauseText = "", occurrence = 0): EffectKind | null {
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
  // A BASE POWER AND TOUGHNESS IS SET, NOT MODIFIED. "Non-Horror creatures with slime counters on
  // them have base power and toughness 2/2" (Sludge Monster) is removal aimed at the other side of
  // the table, and the clause layer records it as `modify-pt` with an unsigned "2/2", which mapped
  // to `pump` and fed Laboratory Maniac's anthem payoffs (owner-judged FALSE, 2026-08-15: "it is
  // removal, you always would target opponent creatures"). Neither a pump nor a debuff: no kind.
  if (verb === "modify-pt" && !/^\s*[+-]/.test(String(action.amount ?? "")) && /\bbase power\b/i.test(clauseText)) return null;
  // THE MODEL ANSWERS `other` FOR "change the target of" and misfiled it as `cost-modify` on some (Divert, Deflection, Shunt), so the words decide, not the verb.
  if (retargetObject(action.object ?? "", verb, clauseText) !== undefined) return "retarget";
  if (verb === "other" && WINS.test(`${action.object ?? ""} ${clauseText}`)) return "win-game";
  // THE VERB ITSELF (CR 104.2b: an effect may state that a player wins the game; #1266). The clause layer stores "you win the game" as `win-game` (Epic Struggle, Thassa's Oracle, Laboratory Maniac, 60 cards),
  // and only the `other` escape hatch above ever reached the kind: 1 corpus card derived it. "Can't win the game" is the verb `cant`, never this one.
  if (verb === "win-game") return "win-game";
  // A PROCESSOR takes from cards an OPPONENT OWNS in exile (AF7b, 2026-09-16): the owner phrase is
  // what tells Ulamog's Nullifier's "two cards your opponents own" from a flicker returning your
  // own exiled creature, and Oblivion Sower's "land cards that player owns from exile" from a
  // plain put onto the battlefield. 22 corpus cards, every one an owner phrase. Checked before the
  // zone rules, which would file the battlefield-bound ones as `flicker`.
  if (PROCESSES_EXILE.has(verb) && (action.fromZone === "exile" || /\bfrom exile\b/i.test(action.object ?? ""))
    && OPPONENT_OWNS.test(action.object ?? "")) return "exile-processing";
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
    // WHAT IS DOUBLED IS THE ACTION'S OBJECT, read first (#1141). The clause text is only a fallback
    // for an object that names nothing: reading both together made every clause that merely
    // MENTIONED a token a token doubler -- Paradox Zone ("double the number of growth counters ...
    // Then create a ... Fractal creature token"), Elvish Vatkeeper ("Transform target Incubator
    // token. Double the number of +1/+1 counters on it") and Arna Kennerud read "makes more tokens".
    const fromObject = doubledKind(action.object ?? "");
    // "double strike" is a KEYWORD (CR 702.4), not this verb; granting it is a speed-increase, the kind
    // the grant-ability path gives the same text (SPEED_KEYWORDS, #1079): the normalizer read Akim's "Creature
    // tokens you control gain double strike" as `double` with the tokens as object. The model made
    // that call (cardClauses, normalize v14), so the guard lives here rather than in the grammar.
    // CEILING: only when the object names no counters/damage/life/mana, i.e. nothing real is doubled.
    if (/\bdouble strike\b/i.test(clauseText) && (fromObject === null || fromObject === "token-doubling")) return "speed-increase";
    if (fromObject) return fromObject;
    const fromClause = doubledKind(clauseText);
    if (fromClause) return fromClause;
    // "Double the power and toughness of each creature you control" (Unnatural Growth, #711) is a
    // pump: it was refused as unguessable, so the clause claimed nothing at all. Read off the OBJECT
    // alone (review): "power" is a common word elsewhere in a clause ("creatures with power 4 or
    // greater"), and the thing doubled is what decides the kind.
    if (/\bpower\b/i.test(action.object ?? "")) return "pump";
    // Doubling something the object does not name is not guessable; refuse rather than pick.
    return null;
  }
  // COPYING A SPELL IS NOT CLONING A PERMANENT. `copy-spell` is one of the seven EFFECT_KINDS
  // derivation never produced, and `mechanisms.ts:47` requires it to see a spellslinger deck at all;
  // the FLAT population produces it and derived never did. The verb cannot tell them apart and the
  // object can, which is the `double` lesson one row up.
  // THE OBJECT DECIDES WHEN IT NAMES A THING; the clause text only stands in for a bare pronoun
  // ("copy it"). Reading the whole clause made Protean Thaumaturge -- "become a copy of another
  // target creature, except it has THIS ABILITY" -- a spell copier, and a nine-instant deck a
  // Spellslinger deck on the site's own example (UX sweep 2026-09-06, E2).
  if (verb === "copy") {
    // A CLONE'S EXCEPTION CLAUSE IS NOT ITS OBJECT. "becomes a copy of another target creature,
    // EXCEPT IT HAS THIS ABILITY" (CR 707.2) names a creature and keeps one ability of its own;
    // the tail made four corpus clones read as ability copiers -- Dimir Doppelganger, Cryptoplasm,
    // Unstable Shapeshifter, Mizzium Transreliquat -- each then claiming to copy an ability of
    // every activated-or-triggered card in the deck, with no type gate to narrow it (2026-09-20).
    // The head is what is copied; the tail only says what the copy differs in.
    const object = (action.object ?? "").split(/,\s*except\b/i)[0]!;
    const named = /\b(creature|permanent|artifact|enchantment|land|planeswalker|token|spells?|instant|sorcery|ability)\b/i.test(object);
    const o = named ? object : `${object} ${clauseText}`;
    // AN ABILITY IS THE THIRD COPYABLE OBJECT (CR 707.10; roadmap AC12). Read off the OBJECT only:
    // "copy that spell ... choose new targets for the copy of the ability" is still a spell copy.
    if (/\babilit(?:y|ies)\b/i.test(object)) return "copy-ability";
    return /\bspells?\b|\binstant\b|\bsorcery\b/i.test(o) ? "copy-spell" : "clone";
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
  if (verb === "cant" && namesOwnAbilitiesStopped(action.object ?? "")) return "ability-loss";
  // CEILING: "can't be blocked unless defending player pays {3}" (Awesome Presence) is an evasion by CR 509.1b and stays a `tax` -- the payable
  // reading is checked first, as it always was; one corpus card. Reading it as evasion would need a payable-evasion kind of its own.
  if (verb === "cant") {
    if (PAYABLE.test(action.object ?? "")) return "tax";
    if (cantBeBlocked(action.object ?? "", clauseText)) return "evasion";
    if (restrictedActions(action.object ?? "", clauseText, occurrence)) return "restriction";
    // A SCOPED BAN ON BEING TARGETED (CR 115.1; #1423): read after the attack/block restriction, which never holds "be the target of".
    if (targetingBanOf(action.object ?? "", clauseText, occurrence)) return "targeting-ban";
    // "CREATURES ENTERING DON'T CAUSE ABILITIES TO TRIGGER" (CR 603.2; #1423): the stored object is garbled, so the printed sentence decides.
    if (triggerSuppressionOf(action.object ?? "", clauseText, occurrence)) return "trigger-suppression";
    // "DOESN'T UNTAP DURING ITS CONTROLLER'S UNTAP STEP" (CR 502.3; #1423). A conditional one, or a permission ("you may choose not to untap"), is not read.
    if (untapDenialOf(action.object ?? "", clauseText, occurrence)) return "untap-denial";
    return null;
  }
  if (verb === "cost-modify") return costDirection(action.object ?? "", clauseText);
  // THE OBJECT SOMETIMES STATES THE ORIGIN THE FIELD OMITTED. Hidetsugu and Kairi reads "put two
  // cards FROM YOUR HAND on top of your library" and the normalizer left `fromZone` unset, so the
  // rows below could not see a hand origin -- and an entire top-of-library commander derived
  // nothing for its defining ability. Read from the clause's own words rather than assuming a
  // default, which is the mistake canonicalAction used to make.
  //
  // DELIBERATELY ONLY "from your hand", and only for put -> library. The other nine unstated cases
  // in the corpus are tuck removal (Commit // Memory, Submerge, Azorius Charm), a wish (The Raven's
  // Warning) or already bottom-guarded (House Cartographer). The real fix is normalize-side -- the
  // model should set `fromZone: "hand"` -- and this is the free half of it.
  if (verb === "put" && action.toZone === "library" && !action.fromZone
      && /\bfrom your hand\b/i.test(action.object ?? "") && (!ON_THE_BOTTOM.test(clauseText) || ON_TOP.test(clauseText))) {
    return "top-set";
  }
  if (bouncesUnstated(action)) return "bounce";
  if ((verb === "cast" || verb === "play") && (playsFromTop(`${verb} ${action.object ?? ""}`) || playsFromTop(clauseText))) return "play-from-top";
  // A CARD PUTTING ITSELF BACK ON TOP (#856): Sensei's Divining Top. Tucking ANOTHER permanent is
  // removal and stays unclassified -- see the `put -> library` note on ZONE_RULES.
  if (verb === "put" && action.fromZone === "battlefield" && action.toZone === "library"
      && /^this\b/i.test(action.object ?? "") && ON_TOP.test(clauseText)) return "top-set";
  for (const r of ZONE_RULES) {
    if (r.verb !== verb) continue;
    if (r.from !== undefined && (action.fromZone ?? null) !== r.from) continue;
    if (r.to && (action.toZone ?? null) !== r.to) continue;
    // The tutored put keeps the search's own kind instead of claiming a library event that never
    // ran; `emits.ts` makes the identical test, so the two layers agree on what a mill is.
    if (r.kind === "mill" && /\bsearch(?:es|ed|ing)?\b/i.test(clauseText)) continue;
    // See exilesOwnGraveyard. Null rather than a kind of its own: the payoff this card actually has
    // is carried by the OTHER actions in the same clause, and a near-miss kind is consumed as if it
    // were true while null is honestly inert.
    // AN EXILE THAT THEN USES THE CARD IS RECURSION (recall v6 #172, roadmap AF7a): Lazotep Quarry
    // copies what it exiled from your graveyard, Lara Croft plays what she exiled from any. The
    // graveyard is the source of the value, which is the recursion shape, whoever's it was.
    if (r.kind === "graveyard-hate" && USES_THE_EXILED_CARD.test(clauseText.slice(Math.max(0, clauseText.search(/\bexile/i))))) return "graveyard-recursion";
    // ...and the same exile that PUTS the card onto the battlefield (Gruesome Encore: the normalizer
    // writes "put target creature card from an opponent's graveyard onto the battlefield" as an
    // `exile` with toZone battlefield) or copies/casts it (#729).
    // The grammar's zone alignment can hand this exile the toZone of a LATER exile in the clause
    // ("Exile it at the beginning of the next end step"), so the printed "put ... from a graveyard
    // onto the battlefield" is read from the text as well.
    // NOT YOUR OWN YARD: the ruling is about taking from THEIRS; an own-graveyard exile stays as it
    // was (null), so this widening moves no card that only ever touched its owner's graveyard.
    if (r.kind === "graveyard-hate" && !exilesOwnGraveyard(action.object ?? "", clauseText) && (action.toZone === "battlefield" || PUTS_FROM_YARD_ONTO_BATTLEFIELD.test(clauseText)
      || USES_THE_EXILED_CARD_2.test(clauseText.slice(Math.max(0, clauseText.search(/\bexile/i)))))) return "graveyard-recursion";
    if (r.kind === "graveyard-hate" && exilesOwnGraveyard(action.object ?? "", clauseText)) return null;
    // THE BOTTOM IS NOT THE TOP. `toZone: "library"` says nothing about position and the canonical
    // action has no field for it, so the clause text decides. Of the 359 corpus cards with a
    // put library|hand -> library action, 311 say "on the bottom" -- Dig Through Time and
    // Descendants' Fury put the REST on the bottom, which is the discard half of card selection,
    // the opposite of a supply. Only 48 are real top manipulation. Negative rather than positive
    // because Sensei's Divining Top never says "on top": it says "put them BACK".
    // `r.to === "library"` is gone with the split. NOT because top-set owns that destination -- the
    // two graveyard-recursion rows above have it too -- but because the condition was only ever
    // standing in for "is this the top-of-library family?", which the kind now says outright.
    if (r.kind === "top-set" && ON_THE_BOTTOM.test(clauseText) && !ON_TOP.test(clauseText)) return null;
    // AN UNTYPED DIG FINDS NO PARTICULAR CARD. See the `put library -> hand` row.
    // ...and one that takes the top of your own library into your hand with no printed search is hand-fill (#1302, CR 121.5: card advantage that is neither a draw nor a tutor): `to-hand` when it names no class,
    // and STAYS `search` when the card restricts it to one -- the object ("a Zombie card") or the clause ("If it's a Zombie card", "until you reveal a creature card"; owner 2026-09-16 and 2026-10-22), because a
    // dig for a Zombie is worth more with Zombies. A typed dig the clause does not allow (Cultivate's put after its search) keeps its old reading.
    if (r.kind === "search" && verb === "put") {
      const read = handFillRead(action, clauseText);
      if (read) return read.typed ? "search" : "to-hand";
      return digNamesAClass(String(action.object ?? "")) ? "search" : null;
    }
    return r.kind;
  }
  // Life change is one verb per direction, but which kind depends on whose life it is.
  if (verb === "gain-life") return "lifegain";
  // A DAMAGE OR LIFE-LOSS REPLACEMENT IS NOT A NEW SOURCE (#1266, burn): "damage that would be dealt to enchanted creature is dealt to its controller instead" (Treacherous Link, Daughter of
  // Autumn), "it deals that much damage plus 2 ... instead" (Pyromancer's Gauntlet), "if an opponent would lose life ... twice that much instead" (Bloodletter of Aclazotz), "if an opponent would
  // gain life, that player loses that much instead" (Tainted Remedy, Plague Drone, Rain of Gore), "the next 2 damage ... would deal ... is dealt to any target instead" (Harm's Way). The sentence
  // that holds both "instead" and a "would ..." frame modifies an event another card makes; the emit stays, the burn kind goes.
  if ((verb === "deal-damage" || verb === "lose-life") && replacesDamageOrLife(clauseText, verb)) return null;
  if (verb === "lose-life" && /\bunspent mana\b/i.test(action.object ?? "")) return null;
  if (verb === "lose-life") {
    // PAYING LIFE IS A COST, NOT A LOSS DEALT (#1266, burn): "unless any player pays 5 life" (Aether Rift), "unless they pay 3 life" (Breathstealer's Crypt),
    // "Pay 1 life" (Decomposition), "pay X life" as an additional cost. The `lose-life` EMIT stays (a life payment is a loss: the Rowan ruling); only the
    // effect kind is refused, when the clause says "pay N life" and no one "loses" any. Bounded alternations, no backtracking.
    if (PAYS_LIFE.test(clauseText) && !LOSES_LIFE.test(clauseText)) return null;
    return parseSubject(action.object ?? "").control === "you" ? null : "player-life-loss";
  }
  // A LIFE TOTAL SET IS NEITHER DAMAGE NOR LIFE LOSS (#1266, burn; "your life total becomes 1", "each player's life total becomes the highest"):
  // the clause stores the number as the object, which read as a player-life-loss with no recipient. CR 119.5 makes the change a gain or a loss
  // as the total demands, so no one direction is claimed.
  if (verb === "set-life") return null;
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
