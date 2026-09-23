import { expect, test } from "vitest";
import { eventLabel, tagLabel, STATIC_KIND, MECHANISM, DEMAND_VERB, DEMAND_SUBJECTLESS, DEMAND_PHASE, eventKeySentence, eventKeyAction, eventKeyClause, eventMatches } from "./demand-sentence.js";

/** The graph's trace-event chips label a census key's VERB half. It reuses `DEMAND_VERB` rather
 *  than adding a second vocabulary — this repo has twice shipped an internal identifier rendered as
 *  English (`targetedRemoval`, `enters:type:land`), and both times the humane label already existed
 *  one file over. */
test("an event label is English, never a raw verb token", () => {
  expect(eventLabel("dies")).toBe("Dying");
  expect(eventLabel("enters")).toBe("Entering the battlefield");
});

test("a verb the map has never seen de-slugs rather than printing a token", () => {
  expect(eventLabel("bushido")).toBe("Bushido");
  expect(eventLabel("combat-damage")).not.toContain("-");
});

/** THE MEASURED MECHANISM VOCABULARY — a ratchet over what the engine actually produced.
 *
 *  `BuildBenchmarks.demand.test.ts` walks `DEMAND_VERB`/`DEMAND_PHASE`/`DEMAND_SUBJECTLESS` against
 *  `VERB_VOCAB`, which is authoritative for what a CONSUMER'S TRIGGER can watch. It cannot see this
 *  vocabulary: most of `edges.ts`'s passes write their own literal tag (`ramp-target:`, `creates:`,
 *  `land-condition:` …), and no exported list enumerates them. So the authority here is a
 *  MEASUREMENT — every mechanism that carried at least one reason across the 71 calibration decks on
 *  2026-08-27, with its reason count and deck count recorded beside it so a future reader can tell a
 *  stale entry from a rare one.
 *
 *  This is what stops the next pass shipping "Ramp target" to a reader: adding a literal without a
 *  label leaves this list stale rather than failing, which is the ceiling and is why the counts are
 *  written down — but every mechanism that HAS been seen is now pinned, and the two worst offenders
 *  were in 69 and 70 of 71 decks. */
const MEASURED: ReadonlyArray<[string, number, number]> = [
  // mechanism, reasons, decks
  ["static:cost-reduction", 4326, 59], ["static:pump", 1698, 34], ["ramp-target", 1543, 69],
  ["draw", 1021, 25], ["counter-added", 739, 9], ["creates", 662, 70], ["land-condition", 576, 45],
  ["leaves", 500, 32], ["tutor", 479, 27], ["static:keyword-grant", 425, 22],
  ["enters-graveyard", 381, 8], ["attacks", 306, 14], ["scales", 255, 16], ["doubles", 234, 7],
  ["static:type-grant", 229, 5], ["combat-damage", 228, 13], ["non-combat-damage", 184, 5],
  ["sacrifice", 119, 11], ["proliferate", 112, 1], ["create-token", 102, 6], ["gain-life", 89, 6],
  ["discard", 62, 7], ["static:speed-increase", 61, 5], ["static:untap", 45, 1],
  ["static:token-generation", 44, 1], ["clone", 44, 2], ["lose-life", 32, 5], ["wincon", 11, 2],
  ["untaps", 2, 1], ["taps", 2, 1], ["static:animate", 1, 1],
];

test("every mechanism the engine has actually produced reads as English, not as its own key", () => {
  const raw: string[] = [];
  for (const [mechanism] of MEASURED) {
    // The de-slugify branch is the fallback this map exists to remove, so reaching it IS the failure
    // -- asserting the exact label instead would pin wording nobody has agreed and break on a reword.
    const fallback = mechanism.replace(/-/g, " ");
    const label = eventLabel(mechanism);
    if (label.toLowerCase() === fallback.toLowerCase()) raw.push(mechanism);
  }
  expect(raw).toEqual([]);
});

test("a mechanism is labelled by exactly one map, so precedence never silently picks a winner", () => {
  const maps = { STATIC_KIND, MECHANISM, DEMAND_VERB, DEMAND_SUBJECTLESS, DEMAND_PHASE };
  const twice: string[] = [];
  for (const [mechanism] of MEASURED) {
    const found = Object.entries(maps).filter(([, m]) => mechanism in m).map(([n]) => n);
    if (found.length > 1) twice.push(`${mechanism}: ${found.join(" + ")}`);
  }
  expect(twice).toEqual([]);
});

/** THE CARD INSPECTOR'S TAG CHIPS. It rendered the raw tag inside an uppercasing chip, so a
 *  relationship read "ENTERS:CREATURE  GRAVEYARD-RECURSION:ANY" directly above the sentences that
 *  already said the same thing in words -- the third surface in this repo to ship an internal
 *  identifier as English, and it survived the previous sweep only because it sits in a panel the
 *  persona screenshots had cropped. */
test("a whole reason tag reads as English, keeping the subject that narrows it", () => {
  // The subject is what discriminates: same mechanism, two different claims.
  expect(tagLabel("enters:creature")).toBe("Entering the battlefield · creature");
  expect(tagLabel("enters:land")).toBe("Entering the battlefield · land");
  expect(tagLabel("enters:creature")).not.toBe(tagLabel("enters:land"));
  // `any` narrows nothing, so printing it would add a word and no fact.
  expect(tagLabel("graveyard-recursion:any")).toBe("Bringing cards back from a graveyard");
  // A static tag's second component IS the mechanism, so it has no subject half to append.
  expect(tagLabel("static:pump")).toBe("Boosting power and toughness");
  // And nothing reaches a reader as its own key.
  for (const t of ["enters:creature", "graveyard-recursion:any", "static:pump", "ramp-target:basic"]) {
    expect(tagLabel(t).toLowerCase()).not.toContain(":");
  }
});

/** TWO MECHANISMS MUST NOT READ AS ONE. `GETTING BIGGER 1` sat beside `BOOSTING POWER AND TOUGHNESS
 *  30` and three consecutive persona reviews said they name the same thing -- "two names, no
 *  distinction given", "I don't know which one a pump effect I care about lands in". They ARE
 *  different (`scales` is graveyard-driven by construction; `static:pump` is an ordinary power and
 *  toughness boost) and the labels have to carry that.
 *
 *  Asserted over the whole measured vocabulary rather than this one pair: any two mechanisms sharing
 *  a label is the same defect wherever it appears, and pinning only the pair that was reported would
 *  catch it once. */
test("no two mechanisms share a label", () => {
  const byLabel = new Map<string, string[]>();
  for (const [mechanism] of MEASURED) {
    const label = eventLabel(mechanism).toLowerCase();
    (byLabel.get(label) ?? byLabel.set(label, []).get(label)!).push(mechanism);
  }
  const collisions = [...byLabel].filter(([, ms]) => ms.length > 1)
    .map(([label, ms]) => `${label}: ${ms.join(" + ")}`);
  expect(collisions).toEqual([]);
});

/** AN ARTIFACT EVENT KEY IS ENGINE VOCABULARY, and the card pages print it as their main content.
 *  Until this read as English, 17,775 indexable pages served four pipe-separated tokens to a
 *  crawler. */
test("an artifact event key reads as English, keeping every dimension that narrows it", () => {
  expect(eventKeySentence("enters|creature|goblin|t"))
    .toBe("a Goblin creature token entering the battlefield");
  expect(eventKeySentence("enters|creature|-|-")).toBe("a creature entering the battlefield");
  expect(eventKeySentence("dies|creature|-|-")).toBe("a creature dying");
  expect(eventKeySentence("cast|instant|-|-")).toBe("an instant being cast");
});

/** THE TOKEN FLAG IS SAID ONLY WHEN IT NARROWS. A payoff that wants a token and one that refuses
 *  tokens are different cards and a reader has to see which; `-` means the trigger never mentioned
 *  tokens, and "token or not" is a word that changes no meaning. */
test("the token flag is spoken when it restricts and silent when it does not", () => {
  expect(eventKeySentence("enters|creature|-|n")).toBe("a nontoken creature entering the battlefield");
  expect(eventKeySentence("enters|creature|-|t")).toBe("a creature token entering the battlefield");
  expect(eventKeySentence("enters|creature|-|-")).not.toContain("token");
});

/** A LIST IS A DISJUNCTION. `enters|artifact,creature|-|-` fires on an artifact OR a creature, and
 *  "an artifact creature" would be a narrower claim than the card makes. */
test("a type list reads as a choice, not as one compound noun", () => {
  expect(eventKeySentence("enters|artifact,creature|-|-"))
    .toBe("an artifact or creature entering the battlefield");
  expect(eventKeySentence("cast|instant,sorcery|-|-")).toBe("an instant or sorcery being cast");
});

test("an untyped event names no noun it does not have", () => {
  expect(eventKeySentence("counter-added|-|-|-")).toBe("anything getting a counter");
  expect(eventKeySentence("enters|-|-|n")).toBe("anything that is not a token entering the battlefield");
});

/** A PHASE AND A PLAYER ACTION HAVE NO SUBJECT to glue a noun onto -- the same two escapes
 *  `demandSentence` makes. */
test("a phase and a player action are the whole sentence", () => {
  expect(eventKeySentence("upkeep|-|-|-")).toBe("an upkeep");
  expect(eventKeySentence("draw|-|-|-")).toBe("a card being drawn");
});

/** A VERB THE MAP HAS NEVER SEEN says the true ugly thing rather than inventing a phrase, which is
 *  the fallback every other function in this file takes. */
test("an unmapped verb de-slugs rather than printing a raw key", () => {
  const out = eventKeySentence("teleports|creature|-|-");
  expect(out).not.toContain("|");
  expect(out).toContain("teleports");
});

/** A BOARD COUNT IS NOT AN EVENT. "Goblins you control" is a standing fact about the board, not
 *  something that happens, so it gets the noun and the possession rather than a verb phrase --
 *  gluing one on would invent an event nothing fires. */
test("a board count reads as what you control, not as something happening", () => {
  expect(eventKeySentence("counts|-|goblin|-")).toBe("a Goblin you control");
  expect(eventKeySentence("counts|-|elf|-")).toBe("an Elf you control");
  // A card TYPE in the noun slot (the 2026-09-09 type-count ruling) is not a proper noun.
  expect(eventKeySentence("counts|-|artifact|-")).toBe("an artifact you control");
});

/** A STATIC'S REACH IS A KEY TOO, and it names the class the static applies to rather than an
 *  event nothing fires: Samut's discount reaches "a noncreature spell", her anthem "a creature". */
test("a static's reach reads as the class it applies to", () => {
  expect(eventKeySentence("applies:pump|creature|-|-")).toBe("a creature it boosts");
  expect(eventKeySentence("applies:cost-reduction|instant,sorcery|-|-")).toBe("an instant or sorcery it makes cheaper to cast");
  expect(eventKeySentence("applies:keyword-grant|creature|goblin|-")).toBe("a Goblin creature it grants abilities to");
});

test("the meld key reads as the other half of the pair", () => {
  expect(eventKeySentence("meld|-|-|-")).toBe("the other half of its meld pair");
});

/** A SELF TRIGGER NAMES THE CARD, not "anything": Burakos fires when HE attacks. */
test("a self trigger reads as this card doing the thing", () => {
  expect(eventKeySentence("attacks|-|-|-", "this card")).toBe("this card attacking");
  expect(eventKeySentence("dies|creature|-|-", "this card")).toBe("this card dying");
  expect(eventKeySentence("attacks|-|-|-")).toBe("anything attacking");
});

/** THE COLOUR THE KEY CANNOT CARRY (owner, 2026-09-08). Chandra, Fire of Kaladesh untaps on a red
 *  spell; the key says only "spell". */
test("a colour filter reads inside the noun", () => {
  expect(eventKeySentence("cast|spell|-|-", undefined, ["R"])).toBe("a red spell being cast");
  expect(eventKeySentence("cast|spell|-|-", undefined, ["R", "G"])).toBe("a red or green spell being cast");
  expect(eventKeySentence("enters|creature|-|-", undefined, ["W"])).toBe("a white creature entering the battlefield");
  expect(eventKeySentence("cast|spell|-|-", undefined, [])).toBe("a spell being cast");
});

/** THE OTHER TWO FEEDER SHAPES read as the thing wanted, like a board count (2026-09-09). */
test("a copy demand and a fodder demand read as what is wanted", () => {
  expect(eventKeySentence("copies|-|triggered|-")).toBe("a triggered ability to copy");
  expect(eventKeySentence("copies|-|activated|-")).toBe("an activated ability to copy");
  expect(eventKeySentence("fodder|-|artifact|-")).toBe("an artifact to sacrifice");
  expect(eventKeySentence("fodder|-|goblin|-")).toBe("a Goblin to sacrifice");
});

/** THE ARTICLE IS CHOSEN ON THE WHOLE PHRASE. "an nontoken artifact" (live on Ayara's page,
 *  2026-09-17) picked the article for "artifact" and then put "nontoken" between them. */
test("the article agrees with the first word said, token flag included", () => {
  expect(eventKeySentence("enters|artifact|-|n")).toBe("a nontoken artifact entering the battlefield");
  expect(eventKeySentence("enters|artifact|-|-")).toBe("an artifact entering the battlefield");
});

/** A GRAVEYARD FILL IS A DEMAND KEY (`fills|<type>|<subtype>|-`, partners-core) and it read as the
 *  raw key -- "fills creature" -- on every reanimator group. It is the thing wanted in the yard. */
test("a fill key reads as the card wanted in a graveyard", () => {
  expect(eventKeySentence("fills|creature|-|-")).toBe("a creature in a graveyard");
  expect(eventKeySentence("fills|-|goblin|-")).toBe("a Goblin in a graveyard");
  expect(eventKeySentence("fills|artifact|-|-")).toBe("an artifact in a graveyard");
  expect(eventKeySentence("fills|creature|goblin|-")).toBe("a Goblin creature in a graveyard");
  expect(eventKeySentence("fills|-|-|-")).toBe("a card in a graveyard");
});

// ---------------------------------------------------------------------------------------------
// THE TWO PLAYER-FACING FORMS (roadmap AK4, owner 2026-09-19).
// ---------------------------------------------------------------------------------------------

/** A CLAUSE READS INSIDE A SENTENCE, which is what the ability table needs and what it has never
 *  had: "when this card dying" and "when a card being drawn" shipped on every card page. */
test("a clause is present tense, and works after 'when'", () => {
  expect(eventKeyClause("dies|creature|-|-")).toBe("a creature dies");
  expect(eventKeyClause("enters|land|-|-")).toBe("a land enters the battlefield");
  expect(eventKeyClause("cast|spell|-|-")).toBe("a spell is cast");
  expect(eventKeyClause("draw|-|-|-")).toBe("a card is drawn");
  expect(eventKeyClause("mill|-|-|-")).toBe("a card is milled");
  expect(eventKeyClause("gain-life|-|-|-")).toBe("life is gained");
});

test("a self trigger names the card, and still conjugates", () => {
  expect(eventKeyClause("dies|creature|-|-", "this card")).toBe("this card dies");
  expect(eventKeyClause("enters|creature|-|-", "this card")).toBe("this card enters the battlefield");
  expect(eventKeyClause("attacks|creature|-|-", "Burakos")).toBe("Burakos attacks");
});

test("a clause keeps the noun grammar the label has", () => {
  expect(eventKeyClause("enters|creature|-|t")).toBe("a creature token enters the battlefield");
  expect(eventKeyClause("dies|creature|goblin|-")).toBe("a Goblin creature dies");
  expect(eventKeyClause("enters|artifact,creature|-|-")).toBe("an artifact or creature enters the battlefield");
});

/** AN ACTION IS WHAT A PLAYER SAYS THEY DO (owner: "draw a card"). */
test("an action is the verb a player would type", () => {
  expect(eventKeyAction("draw|-|-|-")).toBe("draw a card");
  expect(eventKeyAction("fodder|-|land|-")).toBe("provide a land to sacrifice");
  expect(eventKeyAction("fodder|-|token|-")).toBe("provide a Token to sacrifice");
  expect(eventKeyAction("mill|-|-|-")).toBe("mill a card");
  expect(eventKeyAction("cast|spell|-|-")).toBe("cast a spell");
  expect(eventKeyAction("search|-|-|-")).toBe("search your library");
  expect(eventKeyAction("counter-added|creature|-|-")).toBe("put a counter on a creature");
});

/** THE OBJECT SITS INSIDE THE PHRASE for the two "put" verbs, not after it. */
test("put reads around its object", () => {
  expect(eventKeyAction("enters|land|-|-")).toBe("put a land onto the battlefield");
  expect(eventKeyAction("enters|creature|-|t")).toBe("put a creature token onto the battlefield");
  expect(eventKeyAction("enters-graveyard|creature|-|-")).toBe("put a creature into a graveyard");
});

/** NOT EVERY EVENT HAS AN ACTION, and inventing one would be worse than having none: nobody
 *  "attacks" a creature into attacking, and a board count is a standing fact rather than a deed.
 *  The caller falls back to the clause. */
test("an event with no actor has no action", () => {
  // `dies` has no honest verb: CR 700.4 dying covers destruction, sacrifice, damage and state-based
  // death, and CR 701.8 destroy is only one of them (owner, 2026-09-19: "kill is not a word in
  // magic, you have destroy"). The rules word is the clause, and both terms find it.
  expect(eventKeyAction("dies|creature|-|-")).toBeUndefined();
  expect(eventKeyClause("dies|creature|-|-")).toBe("a creature dies");
  expect(eventMatches("dies|creature|-|-", "destroy")).toBe(true);
  expect(eventMatches("dies|creature|-|-", "kill")).toBe(true);
  expect(eventKeyAction("attacks|creature|-|-")).toBeUndefined();
  expect(eventKeyAction("leaves|-|-|-")).toBeUndefined();
  expect(eventKeyAction("counts|-|goblin|-")).toBeUndefined();
});

/** A STATIC HAS NO ACTION, AND THE ONE IT HAD WAS BACKWARDS (engine review, 2026-09-19). The
 *  suppliers of `applies:pump|creature|-|-` are the 15,005 cards the anthem REACHES -- Llanowar
 *  Elves is in that list and Glorious Anthem is not -- so "boost a creature" named the wrong side
 *  of every `applies:*` key. A static is a standing fact about a class, like `counts` and
 *  `copies`, and the label already reads correctly from both ends. */
test("a static has no action, because its suppliers are the class it reaches", () => {
  expect(eventKeyAction("applies:keyword-grant|creature|cleric|-")).toBeUndefined();
  expect(eventKeyAction("applies:pump|creature|-|-")).toBeUndefined();
  expect(eventKeyClause("applies:pump|creature|-|-")).toBe("a creature it boosts");
});

/** A FILL PUTS CARDS IN THE YARD, and its object is a card when the key names no type. */
test("a graveyard fill is an action on the causing side", () => {
  expect(eventKeyAction("fills|-|-|-")).toBe("put a card into a graveyard");
  expect(eventKeyAction("fills|creature|-|-")).toBe("put a creature into a graveyard");
});

/** THE SEARCH HAS TO FIND WHAT A PLAYER TYPES (owner-reported: "sacrifice token" found nothing).
 *  Every typed word, in any order, on stems, across both forms and the player synonyms. */
test("a query matches in any order, on stems", () => {
  expect(eventMatches("fodder|-|token|-", "sacrifice token")).toBe(true);
  expect(eventMatches("fodder|-|token|-", "token sacrifice")).toBe(true);
  expect(eventMatches("dies|creature|-|-", "dies")).toBe(true);
  expect(eventMatches("dies|creature|-|-", "dying")).toBe(true);
  expect(eventMatches("draw|-|-|-", "draw")).toBe(true);
  expect(eventMatches("draw|-|-|-", "card draw")).toBe(true);
  expect(eventMatches("dies|creature|-|-", "land")).toBe(false);
});

test("the words a player uses reach the event the engine names", () => {
  expect(eventMatches("enters|creature|-|-", "etb")).toBe(true);
  expect(eventMatches("dies|creature|-|-", "death trigger")).toBe(true);
  expect(eventMatches("fodder|-|creature|-", "sac outlet")).toBe(true);
  expect(eventMatches("enters|land|-|-", "landfall")).toBe(true);
  expect(eventMatches("search|-|-|-", "tutor")).toBe(true);
  expect(eventMatches("leaves|-|-|-", "blink")).toBe(true);
  expect(eventMatches("draw|-|-|-", "wheel")).toBe(false);
});


/** A FODDER KEY IS A DEMAND, SO ITS CAUSING SIDE FEEDS THE OUTLET (owner-reported 2026-09-19).
 *  Searching Causes for "sacrifice a land" returned eight cards -- Staff of Titania, Awaken the
 *  Woods, Jyoti -- and every one of them MAKES land tokens. None sacrifices anything. The action
 *  form had described the consumer of the key while sitting on the producer's list. */
test("a fodder cause provides the meal, it does not eat it", () => {
  expect(eventKeyAction("fodder|-|land|-")).toBe("provide a land to sacrifice");
  expect(eventKeyAction("fodder|-|creature|-")).toBe("provide a creature to sacrifice");
  // And the asking side still reads as what the outlet wants.
  expect(eventKeyClause("fodder|-|land|-")).toBe("a land to sacrifice");
});

/** THE FEEDER FAMILY IS FOUR DEMAND SHAPES, and the direction trap is the same in all of them:
 *  `counts`, `copies`, `fodder` and `fills` say what a card WANTS, so whatever supplies one is
 *  providing it, never performing it. `fodder` shipped inverted; this pins all four so the next
 *  one cannot.
 *
 *  `counts` and `copies` have no action at all -- being a Goblin is not a deed -- and fall back to
 *  the label, which already reads from the supplier's side. */
test("every feeder shape's causing side provides rather than performs", () => {
  expect(eventKeyAction("fodder|-|creature|-")).toBe("provide a creature to sacrifice");
  expect(eventKeyAction("fills|creature|-|-")).toBe("put a creature into a graveyard");
  expect(eventKeyAction("counts|-|goblin|-")).toBeUndefined();
  expect(eventKeyAction("copies|-|activated|-")).toBeUndefined();
  // None of them may read as the outlet's own move.
  for (const key of ["fodder|-|creature|-", "fills|creature|-|-"]) {
    expect(eventKeyAction(key)!.startsWith("sacrifice")).toBe(false);
  }
});

/** ONLY A CREATURE DIES (CR 700.4, owner 2026-09-19: "dies describes an event of creature moving
 *  from battlefield to graveyard, and it is creature specific"). The engine keys plenty of
 *  non-creature ones -- 14 of the 75 `dies` keys, including `dies|-|-|-` with 4,661 suppliers and
 *  `dies|artifact|-|-` with 1,059 -- and "a land dies" is not a sentence the rules can say.
 *
 *  A MIXED LIST TAKES THE GENERAL WORDING because it must be true of every member: a creature
 *  dying IS put into a graveyard, so the general phrase is right for both halves. */
test("dies is creature-specific, and everything else is put into a graveyard", () => {
  expect(eventKeyClause("dies|creature|-|-")).toBe("a creature dies");
  expect(eventKeyClause("dies|creature|goblin|-")).toBe("a Goblin creature dies");
  // FROM THE BATTLEFIELD is what makes it dying rather than milling or discarding (CR 700.4).
  // Without the origin the phrase describes three different events.
  expect(eventKeyClause("dies|artifact|-|-")).toBe("an artifact is put into a graveyard from the battlefield");
  expect(eventKeyClause("dies|land|-|-")).toBe("a land is put into a graveyard from the battlefield");
  expect(eventKeyClause("dies|-|-|-")).toBe("a permanent is put into a graveyard from the battlefield");
  expect(eventKeyClause("dies|artifact,creature|-|-")).toBe("an artifact or creature is put into a graveyard from the battlefield");
});

/** A TOKEN DIES TOO (CR 700.4 names creature cards AND tokens), and the nontoken flag is a
 *  narrowing of the same noun, not a different event. */
test("a token creature still dies", () => {
  expect(eventKeyClause("dies|creature|-|t")).toBe("a creature token dies");
  expect(eventKeyClause("dies|creature|-|n")).toBe("a nontoken creature dies");
  expect(eventKeyClause("dies|creature|-|-", "this card")).toBe("this card dies");
});
