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
 *  entering is typal, and a deck making one kind of token is named for the token. Together those
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
  // A deck built to make its entry triggers happen more than once. EDHREC files the effects that do
  // it under Blink; the engine's own phrase, "re-firing entry triggers", says the mechanism.
  "etb-refire": "Blink",
};

/** Subjects of `enters:` that are NOT creature types, so the typal rule must not claim them. Every
 *  one of these is a card type, a supertype or a non-creature subtype, and each already has its own
 *  entry above -- this list exists so a subject the table has never seen falls to the typal rule
 *  only when it really is a tribe. */
const NOT_A_TRIBE = new Set([
  "creature", "artifact", "enchantment", "land", "planeswalker", "instant", "sorcery", "battle",
  "legendary", "token", "permanent", "aura", "equipment", "vehicle", "saga", "curse", "any",
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
  if (family !== "enters" && family !== "create-token") return fallback;
  const subject = tag.slice(family.length + 1);
  // A NEGATION IS NOT A TRIBE. `themeSubjectKey` writes one as `-creature`, and "Non-Creature typal"
  // is not a deck anyone has built.
  if (subject.startsWith("-") || NOT_A_TRIBE.has(subject)) return fallback;
  // A deck making one KIND of token is named for the token, not for the act: "goblins created" was
  // the last mechanical phrase left standing over the 71 calibration decks.
  return family === "create-token" ? `${titleCase(subject)} tokens` : `${titleCase(subject)} typal`;
}
