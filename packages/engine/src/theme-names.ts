import { tagFamily, type Tag } from "./tags.js";

/** WHAT A PLAYER CALLS THIS DECK, as against what the engine measured about it (roadmap T2).
 *
 *  `describeTag` names a MECHANISM and has to keep doing so: it writes the sentences under every
 *  edge ("enchantments entering" is why those two cards are joined), and an edge reason saying
 *  "Enchantress" would be a category error. This map is used only where the deck is NAMED -- the
 *  recognition headline, the identity panel, the CLI's theme line -- and nowhere a reason is built.
 *
 *  THE OWNER'S FINDING, ON THEIR OWN DECK: *"enchantments entering, no MTG player will understand
 *  that, for them the deck would be 'Enchantress' like the theme names on EDHREC"*. The engine's
 *  phrase is precise and is not vocabulary anyone uses at a table.
 *
 *  A TABLE PLUS TWO RULES, not 38 hand-written names. Measured over the 71 calibration decks: 38
 *  distinct theme phrases across 67 named decks, and most of the long tail is `enters:<creature
 *  type>` -- walls, elementals, constructs, dinosaurs, rats, shapeshifters -- which a player names
 *  the same way every time, by the tribe. So the type-line cases are listed, everything else
 *  entering is tribal, and a deck making one kind of token is named for the token. Together those
 *  name 67 of 67 named decks. A tag that reaches none of them keeps its mechanical phrase, which is
 *  the conservative direction: a wrong name for a deck is worse than an unglamorous true one. */
export const THEME_NAMES: Record<string, string> = {
  // The named archetypes a player would recognise from EDHREC's own theme list.
  "dies:creature": "Aristocrats",
  "enters:enchantment": "Enchantress",
  "enters:artifact": "Artifacts",
  "cast:artifact": "Artifacts",
  "cast:spell": "Spellslinger",
  "cast:-creature": "Spellslinger",
  "create-token:creature": "Tokens",
  "enters:land": "Landfall",
  "counter-added:creature": "+1/+1 counters",
  "counter-added:any": "Counters",
  "proliferate:any": "Proliferate",
  "enters:planeswalker": "Superfriends",
  "enters:legendary": "Legends matter",
  "enters:aura": "Auras",
  "enters:equipment": "Equipment",
  "enters:vehicle": "Vehicles",
  "enters:saga": "Sagas",
  "enters:curse": "Curses",
  "enters:creature": "Creatures matter",
  "sacrifice:artifact": "Artifact sacrifice",
  "sacrifice:creature": "Sacrifice",
  "lose-life:any": "Life loss",
  "gain-life:any": "Lifegain",
  "draw:any": "Card draw",
  "discard:any": "Discard",
  "mill:any": "Mill",
  "combat-damage:creature": "Combat damage",
  "upkeep:any": "Upkeep triggers",
  // THE NAMES A DECK TECH USES (owner, 2026-09-27, #616: "no magic player uses phrasing like
  // 'Creatures Entering', 'Wizard typal'"). The same words the report's group names use
  // (`groupName` in the web client), so a theme and its group are called one thing.
  "static:pump": "Anthems",
  "fodder:creature": "Sac fodder",
  "graveyard-recursion:creature": "Reanimator",
  "cast:instant-sorcery": "Spellslinger",
  "scales:creature": "Go wide",
  "scales:land": "Lands matter",
  // A deck built to make its entry triggers happen more than once. EDHREC files the effects that do
  // it under Blink; the engine's own phrase, "re-firing entry triggers", says the mechanism.
  "etb-refire": "Blink",
};

/** Subjects of `enters:` and `scales:` that are NOT creature types, so the tribal rule must not
 *  claim them. Every one of these is a card type, a supertype, a non-creature subtype or a class the
 *  engine counts (a party, what you donated) -- this list exists so a subject the table has never
 *  seen falls to the tribal rule only when it really is a tribe. */
const NOT_A_TRIBE = new Set([
  "creature", "artifact", "enchantment", "land", "planeswalker", "instant", "sorcery", "battle",
  "legendary", "token", "permanent", "aura", "equipment", "vehicle", "saga", "curse", "any",
  "spell", "instant-sorcery", "basic", "historic", "card", "party", "donated",
]);

/** Title case for a tribe as it is printed in a name: "time lord" -> "Time Lord". */
const titleCase = (s: string): string =>
  s.split(" ").map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1))).join(" ");

/** The player's name for a deck whose primary theme is `tag`, or `fallback` when there is none.
 *
 *  `fallback` is the caller's `describeTag` output rather than something recomputed here, so the two
 *  cannot drift and this module never needs to know how a mechanism reads. */
export function themeName(tag: Tag, fallback: string): string {
  const named = THEME_NAMES[tag];
  if (named !== undefined) return named;
  const family = tagFamily(tag);
  if (family !== "enters" && family !== "create-token" && family !== "scales") return fallback;
  const subject = tag.slice(family.length + 1);
  // A NEGATION IS NOT A TRIBE. `themeSubjectKey` writes one as `-creature`, and "Non-Creature tribal"
  // is not a deck anyone has built. Nor is anything that is not a plain word or two.
  if (subject.startsWith("-") || NOT_A_TRIBE.has(subject) || !/^[a-z]+( [a-z]+)*$/.test(subject)) return fallback;
  // A deck making one KIND of token is named for the token, not for the act: "goblins created" was
  // the last mechanical phrase left standing over the 71 calibration decks.
  // "TRIBAL", NOT "TYPAL" (#616): Wizards of the Coast renamed the card type, and players did not.
  // A deck that counts its Clerics (`scales:cleric`) is a Cleric tribal deck like one that watches
  // them enter; it read "counts your Clerics".
  return family === "create-token" ? `${titleCase(subject)} tokens` : `${titleCase(subject)} tribal`;
}
