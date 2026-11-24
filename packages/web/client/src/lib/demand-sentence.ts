/** A CENSUS KEY, AS THE WORDS A PLAYER USES — extracted from `BuildBenchmarks.tsx` so the ranked
 *  diagnosis can reach it too.
 *
 *  `lib/findings.ts` began printing raw keys ("enters:type:land") in a finding's own sentence, which
 *  is the same class of defect as the `targetedRemoval` that escaped into prose one review earlier:
 *  an internal identifier rendered as English. The fix is one map, not a second copy — a duplicate
 *  of this vocabulary is how two surfaces start disagreeing about what a key means.
 *
 *  Moved rather than imported across the layer boundary: a lib module importing from a component is
 *  the wrong direction and would have made this a cycle the first time a component needed a finding.
 */
/** The event half of a census key (`enters`, `dies`, `cast`, `end-step`…) as the words a player
 *  would use, for every verb `@edh-seer/tagger`'s `VERB_VOCAB` can put in a consumer's trigger EXCEPT
 *  the three `availability.ts` calls `PHASE_VERBS` (those live in `DEMAND_PHASE` below, because a
 *  phase carries no subject to glue this onto) AND the eight `DEMAND_SUBJECTLESS` below (a player
 *  action has no permanent subject either). The completeness test below this component walks all
 *  three maps against `VERB_VOCAB`/`PHASE_VERBS` directly, so a verb the engine grows can no longer
 *  ship silently unmapped, unmapped twice, or glued to a subject that cannot perform it — see
 *  `demandSentence`'s fallback for what happens if one ever is.
 *
 *  Every remaining entry reads as a TRUE sentence once `${subject} ${event}` is glued: the subject
 *  is always the OBJECT the event happens to or the ACTOR performing it, and every verb below is
 *  true of a permanent in one of those two roles — `mill`/`discard`/`sacrifice`/`create-token` are
 *  PASSIVE ("a card being milled" is true regardless of who mills it) and `enters`/`dies`/`leaves`/
 *  `taps`/`untaps`/`attacks`/`cast`/`combat-damage`/`non-combat-damage`/`counter-added`/`land-play`
 *  are ACTIVE, naming a permanent or card as the thing that does it. Checked one at a time against
 *  review finding F1 (task 8 fix round 1), which is why this comment says so rather than leaving the
 *  reader to re-derive it: `draw`, `gain-life`, `lose-life`, `dice-rolled` and `proliferate` failed
 *  that check (CR pins all five to the CONTROLLER, never a permanent) and moved out.
 *
 *  One entry still needs a call rather than a lookup:
 *  - `counter-added`: the subject is what the counter lands ON ("a creature getting a counter"),
 *    not the counter's own kind — the field this reads is the consumer's demand, and a demand
 *    names a permanent, never a +1/+1. */
import { FILL_ACTION, verbEntry, type VerbEntry } from "@edh-seer/matcher/verbs";
import { OTHER_PLAYER_SUFFIX, WILDCARD_SUBJECT } from "@edh-seer/matcher/zones";

// THE VERB TABLES ARE GONE (#1170 PR 2). `DEMAND_VERB`, `DEMAND_PHASE`, `DEMAND_SUBJECTLESS`,
// `CLAUSE_VERB`, `SUBJECTLESS_CLAUSE`, `ACTION_VERB`, `SUBJECTLESS_ACTION` and the default objects are
// one record, `@edh-seer/matcher/verbs`, typed over every `VERB_VOCAB` verb so `tsc` refuses a gap. The
// reasoning each table carried -- a phase has no subject, a player action has no false actor, a verb
// nobody performs has no action -- is in that file's header, as the entry's shape.

/** The glued forms of an entry: a phase has neither, and a player action has them only where its object
 *  is the class ("a creature being drawn"). */
const gluedDemand = (e: VerbEntry | undefined): string | undefined => (e === undefined || e.shape === "phase" ? undefined : e.participle);
const gluedClause = (e: VerbEntry | undefined): string | undefined => (e === undefined || e.shape === "phase" ? undefined : e.clause);

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** A raw census key, de-slugified. Reached only when a verb or a subject shape has no entry above
 *  — which the completeness test says should never happen for a real `VERB_VOCAB` member, so this
 *  is the SAFETY NET for a verb the engine grows tomorrow, not the everyday path. `humanizeEvent`
 *  (edges.ts, deleted 0fb5e4d once `sentence.ts` took over reason-sentence rendering) shipped this
 *  exact idea as its own default case: colons and dashes are the only things distinguishing a raw
 *  key from an ordinary English sentence, so stripping them to spaces is still ugly and true, but
 *  it no longer LOOKS like engine internals — the failure this map has already shipped twice
 *  (`combat-damage`, `begin-combat`) was a raw identifier reaching a reader, not an English gap. */
const deslugify = (key: string): string => key.replace(/[:-]/g, " ");

/** Turn a census key into the sentence its own aria-label already implies — `enters:type:creature`
 *  is "a creature entering the battlefield", not a colon-separated identifier.
 *
 *  THE RAW KEY IS ENGINE VOCABULARY, and four separate player reviews read it as evidence the page
 *  was a template rather than a reading of their deck. It survives on the row's `title` for anyone
 *  who wants to match a report against `bin/deck-availability.ts`, which prints keys. */
export function demandSentence(key: string): string {
  const narrowed = key.endsWith(" (narrowed)");
  // A symmetric punisher's row (#1598, `census.ts`): the card wants ANOTHER player to do it. Never on a combat key, so one mark at most.
  const others = key.endsWith(OTHER_PLAYER_SUFFIX);
  const bare = narrowed ? key.slice(0, -" (narrowed)".length) : others ? key.slice(0, -OTHER_PLAYER_SUFFIX.length) : key;
  const [verb, ...rest] = bare.split(":");
  // A permanent is not entered BY a player: "an Island entering the battlefield (by another player)" read as a broken passive.
  const mark = narrowed ? " (a real one, not the game's own)"
    : !others ? ""
    : verb === "enters" ? " (under another player's control)" : " (by another player)";
  const subjectKey = rest.join(":");

  const entry = verbEntry(verb);
  if (entry?.shape === "phase" && subjectKey === WILDCARD_SUBJECT) return entry.bare.demand;

  // A player action has no permanent subject to glue this onto either -- same shape as the phase
  // check above, one rung down (the subject slot always resolves to "any" for these, since
  // nothing narrows WHO draws or gains life to a card type).
  if (entry?.shape === "player" && subjectKey === WILDCARD_SUBJECT) {
    return `${entry.bare.demand}${mark}`;
  }

  const event = gluedDemand(entry);
  // A player action or a phase named with a class has no glued form: say the whole phrase rather than
  // a raw key. A verb the record has never seen says the true ugly thing, de-slugified.
  if (!event) return entry && entry.shape !== "event" ? `${entry.bare.demand}${entry.shape === "player" ? mark : ""}` : deslugify(key);

  /** "artifact", "battle", "creature" -> "an artifact, battle or creature". */
  const oneOf = (members: string[]): string => {
    const rest = [...members];
    const last = rest.pop()!;
    const noun = rest.length > 0 ? `${rest.join(", ")} or ${last}` : last;
    return `${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`;
  };

  let subject: string;
  if (subjectKey === WILDCARD_SUBJECT) {
    subject = "anything";
  } else if (subjectKey.startsWith("subtype:")) {
    // Subtypes are proper nouns in Magic — a Wizard, not a wizard.
    subject = oneOf(subjectKey.slice("subtype:".length).split("+").map(capitalize));
  } else if (subjectKey.startsWith("type:")) {
    subject = oneOf(subjectKey.slice("type:".length).split("+"));
  } else {
    // A subject shape this function has no branch for — same failure mode as an unmapped verb,
    // same fallback for the same reason.
    return deslugify(key);
  }

  return `${subject} ${event}${mark}`;
}

/** AN ARTIFACT EVENT KEY (`verb|type|subtype|token`) AS THE WORDS A PLAYER USES.
 *
 *  The card and commander pages print these keys, and the Pages Function prints them into the HTML
 *  a crawler reads -- so until this existed, the main content of 17,775 indexable pages included
 *  four pipe-separated tokens. `enters|creature|goblin|t` is engine vocabulary; "a Goblin creature
 *  token entering the battlefield" is the same fact in the reader's language.
 *
 *  IT REUSES `DEMAND_VERB` AND ITS TWO SIBLINGS rather than adding a second vocabulary. That is the
 *  whole argument of this file's own header: a duplicate map is how two surfaces start disagreeing
 *  about what a key means, and the completeness test above walks these maps against `VERB_VOCAB`
 *  directly, so a verb the engine grows tomorrow cannot ship unmapped here either.
 *
 *  THE KEY SHAPE DIFFERS FROM A CENSUS KEY, which is why this is a second function and not a
 *  parameter on `demandSentence`: a census key is `verb:subject` with the subject already folded to
 *  one dimension, while an artifact key keeps type, subtype and the token flag apart -- and the
 *  token flag is a dimension no census key has ever carried.
 *
 *  THE TOKEN FLAG IS SAID ONLY WHEN IT NARROWS. `t` and `n` are real restrictions a reader must
 *  see -- a payoff that wants a token and one that refuses tokens are different cards -- while `-`
 *  means the trigger never mentioned tokens and printing "token or not" would add a word that
 *  changes no meaning. */
/** WHAT A STATIC DOES TO WHAT IT REACHES, as the tail of "a creature …". The kinds `edges.ts`'s
 *  static pass claims; one it has never seen falls through to the kind's own name. */
const STATIC_REACH: Record<string, string> = {
  "pump": "it boosts",
  "cost-reduction": "it makes cheaper to cast",
  "keyword-grant": "it grants abilities to",
  "type-grant": "it grants types to",
  "trigger-doubling": "whose triggers it doubles",
  // PER KIND (like token-doubling): Doran makes a creature deal damage by toughness, Torbran adds to it, Fiery Emancipation triples it; the variant is on the effect, not the key (#1345).
  "damage-multiplier": "whose damage it changes",
  // PER KIND, SO TRUE FOR EVERY MODE (#1136): Xorn adds one, Divine Visitation swaps them at the same
  // count, and only a Doubling Season doubles. The mode is on the effect, not the key.
  "token-doubling": "whose tokens it adds to or replaces",
  "protection": "it protects",
};

/** Scryfall's colour letters, as a player says them. */
const COLOUR_WORD: Record<string, string> = { W: "white", U: "blue", B: "black", R: "red", G: "green", C: "colorless" };

const CARD_TYPE_WORDS = new Set(["artifact", "creature", "enchantment", "land", "planeswalker", "instant", "sorcery", "battle", "permanent", "kindred"]);

/** A PATTERN'S OPEN SLOTS READ AS THE ENGINE'S "ANY" (`event-pattern.ts`): `dies|*|*|*` is worded as
 *  `dies|-|-|-` and `sacrifice|*|*|t` as `sacrifice|-|-|t`, so every form of the sentence says a
 *  pattern the way it already says the key it unions. */
const openSlots = (key: string): string => key.replace(/\|\*(?=\||$)/g, "|-");

/** THE EIGHT CARD TYPES A STATIC CAN NAME (CR 205.2a), minus the ones no EDH card carries. A list
 *  covering five or more of them is a way of writing "anything", not a distinction. */
const PERMANENT_TYPES: ReadonlySet<string> = new Set(["artifact", "battle", "creature", "enchantment", "land", "planeswalker"]);

export function eventKeySentence(key: string, subject?: string, colors?: string[]): string {
  key = openSlots(key);
  const [verb = "", type = "-", subtype = "-", token = "-"] = key.split("|");

  // A phase and a player action carry no subject to glue a noun onto -- the same two escapes
  // `demandSentence` makes, one rung up, and for the same reason.
  const entry = verbEntry(verb);
  if (type === "-" && subtype === "-" && entry && entry.shape !== "event") return entry.bare.demand;

  // MELD IS A CARD-NAME RELATION, and the key carries no class at all.
  if (verb === "meld") return "the other half of its meld pair";

  // A STATIC'S REACH IS NOT AN EVENT EITHER. "A creature it boosts" names the class the static
  // applies to; nothing fires, so the sentence is the noun and what the subject does to it.
  if (verb.startsWith("applies:")) {
    const kind = verb.slice("applies:".length);
    const does = STATIC_REACH[kind] ?? `it applies ${kind.replace(/-/g, " ")} to`;
    const nouns = [...(subtype === "-" ? [] : subtype.split(",").map(capitalize)), ...(type === "-" ? [] : type.split(","))];
    // A LIST OF NEARLY EVERY TYPE MEANS "ANYTHING", AND READS AS NOISE. 37 corpus keys enumerate
    // five or more of the eight card types -- "a creature, artifact, enchantment, planeswalker,
    // instant, sorcery or battle it makes cheaper to cast" is 99 characters that say "a spell",
    // and nine of them opened the event picker as nine near-identical rows (measured 2026-09-19).
    // Collapsed to the word the enumeration means; anything shorter still lists its types.
    if (subtype === "-" && type !== "-") {
      const types = type.split(",");
      if (types.length >= 5) {
        const permanentsOnly = types.every((t) => PERMANENT_TYPES.has(t));
        return `a ${permanentsOnly ? "permanent" : "permanent or spell"} ${does}`;
      }
    }
    const head = nouns.length <= 1 ? nouns.join(" ") : `${nouns.slice(0, -1).join(", ")} or ${nouns.at(-1)}`;
    // NO NOUN AT ALL IS A PATTERN'S BASE (`applies:pump|*|*|*`): what the static reaches, of any kind.
    const noun = subtype !== "-" && type !== "-" ? `${capitalize(subtype.split(",")[0]!)} ${type.split(",").join(" or ")}` : head || "permanent";
    return `${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun} ${does}`;
  }

  // A BOARD COUNT IS NOT AN EVENT AND HAS NO VERB PHRASE. "Goblins you control" is a standing fact
  // about the board, not something that happens, so the sentence is the noun and the possession --
  // gluing `DEMAND_VERB` onto it would invent an event nothing fires.
  // A FEEDER KEY CARRIES ITS NOUN IN THE SUBTYPE SLOT whether it is a subtype (Goblin) or, since the
  // type-count ruling of 2026-09-09, a card type (artifact). Subtypes are proper nouns; types are not.
  const feederNoun = (n: string): string => CARD_TYPE_WORDS.has(n) ? n : capitalize(n);
  if (verb === "counts") {
    const counted = subtype !== "-" ? feederNoun(subtype) : type !== "-" ? type : "permanent";
    return `${/^[aeiou]/i.test(counted) ? "an" : "a"} ${counted} you control`;
  }
  // THE OTHER TWO FEEDER SHAPES (2026-09-09): a copier wants a KIND of ability, an outlet wants
  // something to EAT. Neither is an event; both read as the thing wanted.
  if (verb === "copies") return subtype === "-" ? "an ability to copy" : `${/^[aeiou]/i.test(subtype) ? "an" : "a"} ${subtype} ability to copy`;
  if (verb === "fodder") {
    const eaten = subtype !== "-" ? feederNoun(subtype) : type !== "-" ? type : "permanent";
    return `${/^[aeiou]/i.test(eaten) ? "an" : "a"} ${eaten} to sacrifice`;
  }
  // A GRAVEYARD FILL WANTS A CARD IN THE YARD (`fills|<type>|<subtype>|-`, partners-core). It is
  // not an event either; the key read raw -- "fills creature" -- over every reanimator group.
  if (verb === "fills") {
    // Both slots set reads as a type line does, "a Goblin creature", the way the trigger nouns do.
    const wanted = [subtype !== "-" ? feederNoun(subtype) : "", type !== "-" ? type : ""].filter(Boolean).join(" ") || "card";
    return `${/^[aeiou]/i.test(wanted) ? "an" : "a"} ${wanted} in a graveyard`;
  }

  const event = gluedDemand(entry);
  // A player action or a phase named with a class has no glued form: its whole phrase, never a raw key.
  // A verb the record has never seen says the true ugly thing rather than inventing a phrase for it.
  if (!event) return entry && entry.shape !== "event" ? entry.bare.demand : deslugify(key.replace(/\|/g, " "));
  // A SELF TRIGGER NAMES THE CARD. "Whenever Burakos attacks" is not "anything attacking", and the
  // key cannot carry the self flag, so the caller hands the noun in.
  if (subject !== undefined) return `${subject} ${event}`;

  const noun = subjectNoun(type, subtype, token, colors);
  return noun === null
    ? `${token === "n" ? "anything that is not a token" : "anything"} ${event}`
    : `${noun.article} ${noun.phrase} ${event}`;
}

/** THE NOUN THE KEY NAMES, shared by every form of the sentence (roadmap AK4). One grammar, so the
 *  label, the clause and the action cannot disagree about what a key is ABOUT -- only about what
 *  happens to it. `null` is "the key names no class", which each form words its own way.
 *
 *  Subtypes are proper nouns in Magic -- a Goblin, not a goblin -- and they qualify the type rather
 *  than replacing it: "a Goblin creature", the way a type line reads.
 *  THE COLOUR THE KEY CANNOT CARRY (owner, 2026-09-08): "a red spell being cast", not "a spell
 *  being cast", when the caller hands the filter in. Two colours read as a choice, which is what a
 *  colour filter means. */
function subjectNoun(
  type: string, subtype: string, token: string, colors?: string[],
): { article: string; phrase: string } | null {
  const list = (raw: string, proper: boolean): string[] =>
    raw === "-" ? [] : raw.split(",").map((m) => proper ? capitalize(m) : m);
  const colour = colors?.length ? [colors.map((c) => COLOUR_WORD[c] ?? c.toLowerCase()).join(" or ")] : [];
  const words = [
    ...list(subtype, true),
    ...colour,
    ...list(type, false),
    ...(token === "t" ? ["token"] : []),
  ];
  if (words.length === 0) return null;
  // A LIST IS A DISJUNCTION, because that is what the key means: `enters|artifact,creature|-|-`
  // fires on an artifact OR a creature, and reading it as "an artifact creature" would be a
  // narrower claim than the card makes.
  const noun = words.length > 1 && (list(subtype, true).length > 1 || list(type, false).length > 1)
    ? oneOfWords(words)
    : words.join(" ");
  // THE ARTICLE AGREES WITH THE FIRST WORD SAID, which is "nontoken" when the flag is set: "an
  // nontoken artifact" was live on every artifact-sacrifice group (2026-09-17).
  const phrase = `${token === "n" ? "nontoken " : ""}${noun}`;
  return { article: /^[aeiou]/i.test(phrase) ? "an" : "a", phrase };
}

/** WHETHER THE RULES' OWN WORD FITS. `dies` is creature-and-token specific (CR 700.4), so the key
 *  may use it only when every type it names is a creature -- a self trigger ("this card dies") is
 *  the card's own, and the caller has already said it is a creature by keying `dies` on it. */
const diesProper = (type: string): boolean =>
  type === "creature" || type === "-" ? type === "creature" : type.split(",").every((t) => t === "creature");

/** THE EVENT AS A CLAUSE: "a creature dies", "a card is drawn", "this card enters the battlefield".
 *
 *  Use it wherever the words sit INSIDE a sentence -- after "when", in a list of what a deck wants
 *  -- and wherever the reader is waiting for the event rather than causing it. `eventKeySentence`
 *  is the label form and reads as a noun; this one reads as English.
 *
 *  It falls back to the label for the shapes that are not events at all: a board count ("a Goblin
 *  you control"), a static's reach, a graveyard fill. Those are standing facts, and conjugating
 *  them would invent an event nothing fires -- the same rule `eventKeySentence` already keeps. */
export function eventKeyClause(key: string, subject?: string, colors?: string[]): string {
  key = openSlots(key);
  const [verb = "", type = "-", subtype = "-", token = "-"] = key.split("|");

  const entry = verbEntry(verb);
  if (type === "-" && subtype === "-") {
    const whole = entry?.bare?.clause;
    if (whole) return whole;
  }
  // ONLY A CREATURE DIES (CR 700.4, owner 2026-09-19: "dies describes an event of creature moving
  // from battlefield to graveyard, and it is creature specific"). Everything else is PUT INTO a
  // graveyard, and the engine keys plenty of those: 14 of the 75 `dies` keys name a non-creature
  // type, including `dies|-|-|-` (4,661 suppliers), `dies|artifact|-|-` (1,059) and `dies|land|-|-`
  // (533). "A land dies" is not a sentence the rules can say.
  //
  // A MIXED LIST TAKES THE GENERAL WORDING, because it has to be true of every member: a creature
  // dying IS put into a graveyard, so "an artifact or creature is put into a graveyard" is right
  // for both halves where "dies" is right for only one.
  if (verb === "dies" && !diesProper(type)) {
    const noun = subjectNoun(type, subtype, token, colors);
    // FROM THE BATTLEFIELD, because CR 700.4 is what makes this dying rather than milling or
    // discarding. Without the origin the phrase describes three different events (review finding,
    // 2026-09-19) and the search would read as a graveyard-filler rather than a removal.
    const put = "is put into a graveyard from the battlefield";
    return noun === null ? `a permanent ${put}` : `${noun.article} ${noun.phrase} ${put}`;
  }
  const event = gluedClause(entry);
  // No clause form means this is not an event with a subject -- a feeder, a static, a count. The
  // label already words those correctly, so there is nothing to conjugate.
  if (!event) return eventKeySentence(key, subject, colors);
  if (subject !== undefined) return `${subject} ${event}`;
  const noun = subjectNoun(type, subtype, token, colors);
  return noun === null
    ? `${token === "n" ? "anything that is not a token" : "anything"} ${event}`
    : `${noun.article} ${noun.phrase} ${event}`;
}

/** WHAT A CARD DOES, IN A PLAYER'S WORDS: "draw a card", "sacrifice a creature", "kill a creature".
 *
 *  `undefined` when the event has no actor -- nothing makes "a creature attack" the way it makes
 *  one die -- and the caller falls back to the clause. Inventing a verb for every key would give
 *  every row a phrase and give some of them a lie. */
export function eventKeyAction(key: string, colors?: string[]): string | undefined {
  key = openSlots(key);
  const [verb = "", type = "-", subtype = "-", token = "-"] = key.split("|");

  // AN OUTLET EATS SOMETHING, and "sacrifice a creature" is the phrase a player uses for it. The
  // feeder key is the one shape whose LABEL is already about the action ("a creature to sacrifice").
  if (verb === "fodder") {
    // A FODDER KEY IS A DEMAND, AND THE CAUSING SIDE IS THE ONE THAT FEEDS IT (owner-reported
    // 2026-09-19, on the deployed site). `fodderDemandsOf` says what a sacrifice OUTLET eats, so
    // the cards that SUPPLY the key are the ones providing the meal -- Staff of Titania and Awaken
    // the Woods make land tokens, and "sacrifice a land" described the outlet instead of them.
    // Searching "sacrifice a land" returned eight cards, not one of which sacrifices a land.
    //
    // THE FEEDER NOUN RULE, not the trigger one: a card TYPE sitting in the subtype slot (the
    // type-count ruling of 2026-09-09) is not a proper noun, so "a creature" and "a Goblin" are
    // both right and "a Creature" is not.
    const eaten = subtype !== "-"
      ? (CARD_TYPE_WORDS.has(subtype) ? subtype : capitalize(subtype))
      : type !== "-" ? type : "permanent";
    return `provide ${/^[aeiou]/i.test(eaten) ? "an" : "a"} ${eaten} to sacrifice`;
  }
  // A static names a CLASS, and its suppliers are the members of that class. See the note above.
  if (verb.startsWith("applies:")) return undefined;
  const entry = verbEntry(verb);
  if (type === "-" && subtype === "-") {
    const whole = entry?.bare?.action;
    if (whole) return whole;
  }
  const action = verb === "fills" ? FILL_ACTION : entry?.action;
  if (!action) return undefined;
  const noun = subjectNoun(type, subtype, token, colors);
  // A FILL'S OBJECT IS A CARD when the key names no type, the same known object `mill` and
  // `discard` have: you put a CARD into a graveyard, not "anything".
  // A NONTOKEN FLAG WITH NO CLASS still narrows the object: "sacrifice a nontoken permanent", not the
  // "sacrifice a permanent" a search narrowed to "not a token" read as (2026-09-29).
  const object = noun === null
    ? (token === "n" ? "a nontoken permanent" : verb === "fills" ? "a card" : entry?.defaultObject ?? "anything")
    : `${noun.article} ${noun.phrase}`;
  // `put ONTO the battlefield` -- the object belongs inside the phrase, not after it.
  // `{object}` marks it the same way for the verbs the old table did not have.
  if (action.includes("{object}")) return action.replace("{object}", object);
  const around = action.match(/^(.*)\b(ONTO|INTO)\b(.*)$/);
  return around
    ? `${around[1]}${object} ${around[2]!.toLowerCase()}${around[3]}`
    : `${action} ${object}`;
}

/** WHAT A PLAYER TYPES, AGAINST WHAT THE ENGINE CALLS IT (roadmap AK4, owner-reported: searching
 *  "sacrifice token" found nothing, and so did "dies", "etb" and "tutor").
 *
 *  Three faults were stacked. The match was a raw substring, so word ORDER decided it. It was
 *  literal, so "dies" missed "dying" and "draw" missed "drawn". And no amount of either turns
 *  "etb" into "entering the battlefield" -- that needs saying out loud, which is what this map is.
 *
 *  Kept deliberately small and only for terms a player would actually type at a search box. A
 *  synonym that reaches the wrong event is worse than one that is missing, because the reader has
 *  no way to see that it went wrong. */
const PLAYER_TERMS: Record<string, string[]> = {
  etb: ["enters"],
  "enters the battlefield": ["enters"],
  blink: ["leaves", "enters"],
  flicker: ["leaves", "enters"],
  bounce: ["leaves"],
  sac: ["fodder", "sacrifice"],
  "sac outlet": ["fodder"],
  "death trigger": ["dies"],
  deathtrigger: ["dies"],
  removal: ["dies"],
  // DESTROY AND KILL ARE HOW A PLAYER ASKS FOR THIS, and neither is what the key MEANS (owner,
  // 2026-09-19: "kill is not a word in magic, you have destroy"). CR 700.4 defines `dies` as
  // going to the graveyard from the battlefield; CR 701.8 defines `destroy` as one way that
  // happens, and a sacrificed creature dies without being destroyed. The suppliers of this key do
  // both -- Come Back Wrong destroys, Victimize sacrifices -- so the label stays the rules word
  // and these two only find it.
  destroy: ["dies"],
  kill: ["dies"],
  tutor: ["search"],
  "card draw": ["draw"],
  cantrip: ["draw"],
  "self mill": ["mill"],
  selfmill: ["mill"],
  // BACK OUT OF THE YARD (owner's friend, 2026-09-27: a reanimator deck searching "leaves the
  // graveyard" and "return from graveyard" found nothing). A card that returns or exiles a card
  // from a graveyard causes `leaves-graveyard`; "return" also finds a bounce, which leaves play.
  reanimate: ["fills", "enters-graveyard", "leaves-graveyard"],
  reanimator: ["fills", "leaves-graveyard"],
  reanimation: ["fills", "enters-graveyard", "leaves-graveyard"],
  return: ["leaves-graveyard", "leaves"],
  recursion: ["leaves-graveyard"],
  exile: ["leaves-graveyard"],
  "graveyard hate": ["leaves-graveyard"],
  graveyard: ["fills", "enters-graveyard"],
  yard: ["fills", "enters-graveyard"],
  counters: ["counter-added"],
  "+1/+1": ["counter-added"],
  lifegain: ["gain-life"],
  drain: ["lose-life"],
  ping: ["non-combat-damage"],
  "combat trigger": ["attacks"],
  // THE SEARCH SWEEP (2026-09-27): words players type for a whole strategy, each onto the event
  // that strategy is made of. Madness is cast-from-discard; the spell words are all "a spell is cast".
  madness: ["discard"],
  spellslinger: ["cast"],
  prowess: ["cast"],
  magecraft: ["cast", "copy"],
  storm: ["cast"],
  counterspell: ["counter-spell"],
  "go wide": ["create-token"],
  aristocrats: ["fodder", "dies"],
};

/** A CRUDE STEM, and deliberately crude: it has to make "dies" find "dying" and "draw" find
 *  "drawn" without a stemmer library, over a vocabulary of about sixty verbs. Trailing inflections
 *  come off, and three irregular pairs the maps actually contain are named. */
const STEM_PAIRS: Record<string, string> = { dies: "die", dying: "die", died: "die", drawn: "draw", cast: "cast", milled: "mill", milling: "mill", lost: "lose", loses: "lose", loss: "lose" };
const stem = (word: string): string =>
  STEM_PAIRS[word] ?? word.replace(/(ing|ed|es|s)$/, "").replace(/([^aeiou])\1$/, "$1");

/** WORDS A PLAYER TYPES THAT NAME NO EVENT: "leaves THE graveyard" missed "leaves A graveyard",
 *  and "gain 1 life" missed "gain life", because every typed word had to hit. They still count in
 *  the whole-phrase test below. */
const FILLER = new Set([
  "the", "a", "an", "of", "from", "to", "into", "onto", "my", "your", "their", "its", "any", "one",
  // HOW A PLAYER FRAMES THE ASK, not the event (search sweep, 2026-09-27): "cares about artifacts",
  // "artifacts matter", "whenever you gain life", "opponent loses life" all found nothing.
  "whenever", "when", "you", "cares", "care", "about", "matter", "matters", "opponent", "opponents", "player", "players", "each",
]);

/** A WORD THAT NAMES A NARROWER QUESTION THAN ANY ONE EVENT VERB: landfall is a LAND entering, not
 *  anything entering (it found all 104 enters events); an enchantress casts enchantments. The word
 *  is read as the words it stands for. */
const ALIASES: Record<string, string[]> = { landfall: ["land", "enters"], enchantress: ["enchantment", "cast"] };

/** FUZZY (owner, 2026-09-27: "right now you need to type in exactly what you want" -- "I would do
 *  contains instead of starts with and bold out the matched substring"). A typed word hits a word
 *  of the event that CONTAINS it ("grave" finds graveyard, "reanim" reanimate), and the row bolds
 *  what matched (`matchSpans`), so a looser hit shows why it is there.
 *
 *  A HIT AT A WORD'S START RANKS ABOVE ONE INSIDE IT: "tap" puts "a creature becomes tapped" above
 *  "untap", "elf" puts "an Elf you control" above "self mill". 2 for a whole word or its start, 1
 *  for inside, 0 for none.
 *
 *  SLIPS ARE A FALLBACK (`typos`), asked only when nothing matches without them: one edit from four
 *  letters, two from ten ("graveyrd", "artifcat"). Allowed always, "treasure" found every
 *  "creature" event (286 rows for 14) and "mill" found "kill". */
function wordHit(w: string, raw: readonly string[], typos: boolean): 0 | 1 | 2 {
  if (/[^a-z]/.test(w)) return 0;
  if (raw.some((r) => r.startsWith(w))) return 2;
  if (w.length >= 3 && raw.some((r) => r.includes(w))) return 1;
  if (!typos || w.length < 4) return 0;
  const k = w.length >= 10 ? 2 : 1;
  return raw.some((r) => r.length >= 4 && Math.abs(r.length - w.length) <= k && editDistance(w, r, k) <= k) ? 1 : 0;
}

/** The typed words, as matching reads them. */
function typedWords(query: string): string[] {
  return query.toLowerCase().split(/\s+/).flatMap((w) => ALIASES[w] ?? [w])
    .filter((w) => w.length > 0 && !FILLER.has(w) && !/^\d+$/.test(w));
}

/** WHERE TO BOLD: the stretches of `text` that contain a typed word, merged, case-insensitive. */
export function matchSpans(text: string, query: string): { text: string; hit: boolean }[] {
  const lower = text.toLowerCase();
  const on = new Array<boolean>(text.length).fill(false);
  for (const w of typedWords(query)) {
    if (w.length < 2) continue;
    for (let i = lower.indexOf(w); i >= 0; i = lower.indexOf(w, i + 1)) for (let j = i; j < i + w.length; j++) on[j] = true;
  }
  const out: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = out.at(-1);
    if (last && last.hit === on[i]) last.text += text[i];
    else out.push({ text: text[i]!, hit: on[i]! });
  }
  return out;
}

/** Optimal string alignment distance (a swap of two neighbours is one edit), stopped past `max`. */
function editDistance(a: string, b: string, max: number): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length]![b.length]!;
}

/** HOW WELL this event answers what the reader typed: null when it does not; otherwise higher is a
 *  better hit (a word's start over its inside). Every typed word must hit SOMETHING -- the label,
 *  the clause, the action or a synonym -- so extra words narrow rather than widen. */
export function eventMatchRank(key: string, query: string, typos = false): number | null {
  key = openSlots(key);
  const typed = typedWords(query);
  if (typed.length === 0) return 0;
  const verb = key.split("|")[0] ?? "";
  const synonyms = Object.entries(PLAYER_TERMS)
    .filter(([, verbs]) => verbs.some((v) => verb === v || verb.startsWith(`${v}:`)))
    .map(([term]) => term);
  const haystack = [eventKeySentence(key), eventKeyClause(key), eventKeyAction(key) ?? "", ...synonyms]
    .join(" ").toLowerCase();
  const raw = haystack.split(/[^a-z0-9+/]+/).filter(Boolean);
  const words = new Set(raw.map(stem));
  // THE WHOLE PHRASE, AT WORD EDGES, answers a multi-word synonym typed whole ("sac outlet").
  const phrase = query.toLowerCase().trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (phrase.length > 0 && new RegExp(`(^|[^a-z])${phrase}($|[^a-z])`).test(haystack)) return 2 * typed.length;
  let rank = 0;
  for (const w of typed) {
    // "+1/+1" cannot be a word; it is matched as written.
    const hit = words.has(stem(w)) ? 2 : /[^a-z]/.test(w) ? (haystack.includes(w) ? 2 : 0) : wordHit(w, raw, typos);
    if (hit === 0) return null;
    rank += hit;
  }
  return rank;
}

/** Does this event answer what the reader typed? */
export function eventMatches(key: string, query: string, typos = false): boolean {
  return eventMatchRank(key, query, typos) !== null;
}

/** "artifact, creature or enchantment" -- the same joining `demandSentence` does inline, kept here
 *  because two callers now need it and a second copy of a comma rule is a second thing to get
 *  wrong. */
const oneOfWords = (members: string[]): string => {
  const rest = [...members];
  const last = rest.pop()!;
  return rest.length > 0 ? `${rest.join(", ")} or ${last}` : last;
};
