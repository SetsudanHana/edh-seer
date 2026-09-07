/** THE ARCHETYPE VOCABULARY: every strategy, mechanic, object class and resource an EDH deck is
 *  built around, keyed to EDHREC's own theme list (owner ruling 2026-09-06).
 *
 *  WHY EDHREC IS THE DICTIONARY. The detector's own list was 13 members and the owner named four
 *  decks it could not (Theft, Big Mana, Party, Dungeon) in one sentence. The vocabulary rule that
 *  binds `TRIGGERS`/`VERBS` binds this list too: size it against what the GAME expresses, never
 *  against the decks in hand today -- a gap found later is a gap the report carries silently.
 *  EDHREC's 401 themes (fetched 2026-09-06, `json.edhrec.com/pages/tags.json`, deck counts kept as
 *  `decks`) are the population's own taxonomy, and the population is what a template is derived
 *  from (roadmap W19), so the same key serves the report, the template row and the population pull.
 *
 *  WHAT IS IN, WHAT IS OUT, AND WHY (the membership rule):
 *    - strategy: what the deck wants to do (Control, Theft, Blink, Storm).
 *    - mechanic: a rules keyword or subsystem the deck is built around (Cascade, Party, Dungeon).
 *    - type: an object class the deck is about (Equipment, Sagas, Vehicles).
 *    - resource: a token or counter kind the deck accrues (Treasure, Energy, -1/-1 counters).
 *    - kindred: ONE member, parametrised by the deck's creature type; EDHREC's 135 tribe themes map
 *      onto it through `KINDRED_TRIBES` so the population pull and the report share the key.
 *    OUT, listed in `EXCLUDED_THEMES` with the reason: named-card builds (one card's text is not a
 *    strategy), roles (ramp, draw, counterspells -- the 2026-08-16 ruling that a deck role is not a
 *    synergy), format labels (cEDH, Old School), 60-card slang, and anything not EDH-legal.
 *
 *  DETECTION IS OURS; EDHREC ONLY NAMES. A member is DETECTED when `ARCHETYPE_SIGNATURE` has a row
 *  for it, and every row keys on what the derived corpus actually carries -- census of 21,317 derived
 *  cards, 2026-09-06: theme tags, cares tags, effect kinds, printed keywords, type-line words, token
 *  kinds. A member with no row is DECLARED (owner ruling 2026-09-06, option 1): it exists in the
 *  vocabulary, the template and the pull can key on it, and the engine says it cannot name it rather
 *  than guessing from a count. `DETECTABLE` is the set a caller may promise. The gaps a row would
 *  need are recorded beside the member they block, because each one is a normalize-vocabulary
 *  change (the one-way ratchet) and not a matcher patch.
 *
 *  Regenerate the rows from a fresh `tags.json` with the generator the 2026-09-06 log names; every
 *  EDHREC slug must land in exactly one of the table, `KINDRED_TRIBES` or `EXCLUDED_THEMES`, and
 *  `archetype-vocabulary.test.ts` holds the row count so a silent drop fails. */

export type ArchetypeClass = "strategy" | "mechanic" | "type" | "resource" | "kindred";

export interface ArchetypeEntry {
  /** Our key. Existing detector members keep the slug every consumer already reads (`tokens`,
   *  `counters`, `superfriends`, `goodstuff`); every newer member uses EDHREC's slug verbatim. */
  slug: string;
  label: string;
  class: ArchetypeClass;
  /** EDHREC's theme: url slug (`/tags/<slug>`), the tag its deck rows carry, deck count at pull. */
  edhrec?: { slug: string; tag: string; decks: number };
}

export const ARCHETYPE_VOCABULARY = [
  { slug: "tokens", label: "Tokens", class: "strategy", edhrec: { slug: "tokens", tag: "Tokens", decks: 201135 } },
  { slug: "counters", label: "+1/+1 Counters", class: "strategy", edhrec: { slug: "plus-1-plus-1-counters", tag: "+1/+1 Counters", decks: 164388 } },
  { slug: "artifacts", label: "Artifacts", class: "strategy", edhrec: { slug: "artifacts", tag: "Artifacts", decks: 119685 } },
  { slug: "combo", label: "Combo", class: "strategy", edhrec: { slug: "combo", tag: "Combo", decks: 118258 } },
  { slug: "aggro", label: "Aggro", class: "strategy", edhrec: { slug: "aggro", tag: "Aggro", decks: 99590 } },
  { slug: "spellslinger", label: "Spellslinger", class: "strategy", edhrec: { slug: "spellslinger", tag: "Spellslinger", decks: 88086 } },
  { slug: "lifegain", label: "Lifegain", class: "strategy", edhrec: { slug: "lifegain", tag: "Lifegain", decks: 85986 } },
  { slug: "reanimator", label: "Reanimator", class: "strategy", edhrec: { slug: "reanimator", tag: "Reanimator", decks: 83541 } },
  { slug: "aristocrats", label: "Aristocrats", class: "strategy", edhrec: { slug: "aristocrats", tag: "Aristocrats", decks: 71567 } },
  { slug: "control", label: "Control", class: "strategy", edhrec: { slug: "control", tag: "Control", decks: 69186 } },
  { slug: "burn", label: "Burn", class: "strategy", edhrec: { slug: "burn", tag: "Burn", decks: 65044 } },
  { slug: "voltron", label: "Voltron", class: "strategy", edhrec: { slug: "voltron", tag: "Voltron", decks: 58632 } },
  { slug: "enchantress", label: "Enchantress", class: "strategy", edhrec: { slug: "enchantress", tag: "Enchantress", decks: 58130 } },
  { slug: "midrange", label: "Midrange", class: "strategy", edhrec: { slug: "midrange", tag: "Midrange", decks: 53495 } },
  { slug: "mill", label: "Mill", class: "strategy", edhrec: { slug: "mill", tag: "Mill", decks: 50236 } },
  { slug: "blink", label: "Blink", class: "strategy", edhrec: { slug: "blink", tag: "Blink", decks: 37198 } },
  { slug: "sacrifice", label: "Sacrifice", class: "strategy", edhrec: { slug: "sacrifice", tag: "Sacrifice", decks: 37142 } },
  { slug: "discard", label: "Discard", class: "strategy", edhrec: { slug: "discard", tag: "Discard", decks: 33864 } },
  { slug: "wheels", label: "Wheels", class: "strategy", edhrec: { slug: "wheels", tag: "Wheels", decks: 32472 } },
  { slug: "graveyard", label: "Graveyard", class: "strategy", edhrec: { slug: "graveyard", tag: "Graveyard", decks: 32354 } },
  { slug: "clones", label: "Clones", class: "strategy", edhrec: { slug: "clones", tag: "Clones", decks: 30881 } },
  { slug: "group-slug", label: "Group Slug", class: "strategy", edhrec: { slug: "group-slug", tag: "Group Slug", decks: 24397 } },
  { slug: "storm", label: "Storm", class: "strategy", edhrec: { slug: "storm", tag: "Storm", decks: 23182 } },
  { slug: "stax", label: "Stax", class: "strategy", edhrec: { slug: "stax", tag: "Stax", decks: 23048 } },
  { slug: "infect", label: "Infect", class: "strategy", edhrec: { slug: "infect", tag: "Infect", decks: 21690 } },
  { slug: "self-mill", label: "Self-Mill", class: "strategy", edhrec: { slug: "self-mill", tag: "Self-Mill", decks: 21312 } },
  { slug: "extra-combats", label: "Extra Combats", class: "strategy", edhrec: { slug: "extra-combats", tag: "Extra Combats", decks: 21264 } },
  { slug: "theft", label: "Theft", class: "strategy", edhrec: { slug: "theft", tag: "Theft", decks: 21050 } },
  { slug: "big-mana", label: "Big Mana", class: "strategy", edhrec: { slug: "big-mana", tag: "Big Mana", decks: 20421 } },
  { slug: "goodstuff", label: "Goodstuff / Midrange", class: "strategy", edhrec: { slug: "good-stuff", tag: "Good Stuff", decks: 20003 } },
  { slug: "group-hug", label: "Group Hug", class: "strategy", edhrec: { slug: "group-hug", tag: "Group Hug", decks: 19750 } },
  { slug: "chaos", label: "Chaos", class: "strategy", edhrec: { slug: "chaos", tag: "Chaos", decks: 16821 } },
  { slug: "forced-combat", label: "Forced Combat", class: "strategy", edhrec: { slug: "forced-combat", tag: "Forced Combat", decks: 16731 } },
  { slug: "superfriends", label: "Superfriends", class: "strategy", edhrec: { slug: "planeswalkers", tag: "Planeswalkers", decks: 15980 } },
  { slug: "x-spells", label: "X Spells", class: "strategy", edhrec: { slug: "x-spells", tag: "X Spells", decks: 15710 } },
  { slug: "commander-matters", label: "Commander Matters", class: "strategy", edhrec: { slug: "commander-matters", tag: "Commander Matters", decks: 15380 } },
  { slug: "toolbox", label: "Toolbox", class: "strategy", edhrec: { slug: "toolbox", tag: "Toolbox", decks: 13647 } },
  { slug: "lifedrain", label: "Lifedrain", class: "strategy", edhrec: { slug: "lifedrain", tag: "Lifedrain", decks: 13425 } },
  { slug: "exile", label: "Exile", class: "strategy", edhrec: { slug: "exile", tag: "Exile", decks: 12912 } },
  { slug: "pillow-fort", label: "Pillow Fort", class: "strategy", edhrec: { slug: "pillow-fort", tag: "Pillow Fort", decks: 12622 } },
  { slug: "hatebears", label: "Hatebears", class: "strategy", edhrec: { slug: "hatebears", tag: "Hatebears", decks: 12055 } },
  { slug: "tempo", label: "Tempo", class: "strategy", edhrec: { slug: "tempo", tag: "Tempo", decks: 11788 } },
  { slug: "extra-turns", label: "Extra Turns", class: "strategy", edhrec: { slug: "extra-turns", tag: "Extra Turns", decks: 10759 } },
  { slug: "stompy", label: "Stompy", class: "strategy", edhrec: { slug: "stompy", tag: "Stompy", decks: 10574 } },
  { slug: "topdeck", label: "Topdeck", class: "strategy", edhrec: { slug: "topdeck", tag: "Topdeck", decks: 10453 } },
  { slug: "spell-copy", label: "Spell Copy", class: "strategy", edhrec: { slug: "spell-copy", tag: "Spell Copy", decks: 10287 } },
  { slug: "toughness-matters", label: "Toughness Matters", class: "strategy", edhrec: { slug: "toughness-matters", tag: "Toughness Matters", decks: 10244 } },
  { slug: "etb", label: "ETB", class: "strategy", edhrec: { slug: "etb", tag: "ETB", decks: 10053 } },
  { slug: "self-damage", label: "Self-Damage", class: "strategy", edhrec: { slug: "self-damage", tag: "Self-Damage", decks: 9740 } },
  { slug: "land-destruction", label: "Land Destruction", class: "strategy", edhrec: { slug: "land-destruction", tag: "Land Destruction", decks: 7892 } },
  { slug: "attack-triggers", label: "Attack Triggers", class: "strategy", edhrec: { slug: "attack-triggers", tag: "Attack Triggers", decks: 7740 } },
  { slug: "anthems", label: "Anthems", class: "strategy", edhrec: { slug: "anthems", tag: "Anthems", decks: 5470 } },
  { slug: "activated-abilities", label: "Activated Abilities", class: "strategy", edhrec: { slug: "activated-abilities", tag: "Activated Abilities", decks: 5203 } },
  { slug: "tap-untap", label: "Tap / Untap", class: "strategy", edhrec: { slug: "tap-untap", tag: "Tap / Untap", decks: 5187 } },
  { slug: "pingers", label: "Pingers", class: "strategy", edhrec: { slug: "pingers", tag: "Pingers", decks: 5167 } },
  { slug: "politics", label: "Politics", class: "strategy", edhrec: { slug: "politics", tag: "Politics", decks: 4925 } },
  { slug: "triggered-abilities", label: "Triggered Abilities", class: "strategy", edhrec: { slug: "triggered-abilities", tag: "Triggered Abilities", decks: 4335 } },
  { slug: "zoo", label: "Zoo", class: "strategy", edhrec: { slug: "zoo", tag: "Zoo", decks: 4311 } },
  { slug: "donate", label: "Donate", class: "strategy", edhrec: { slug: "donate", tag: "Donate", decks: 3341 } },
  { slug: "self-discard", label: "Self-Discard", class: "strategy", edhrec: { slug: "self-discard", tag: "Self-Discard", decks: 3212 } },
  { slug: "aikido", label: "Aikido", class: "strategy", edhrec: { slug: "aikido", tag: "Aikido", decks: 2940 } },
  { slug: "power", label: "Power", class: "strategy", edhrec: { slug: "power", tag: "Power", decks: 2873 } },
  { slug: "bounce", label: "Bounce", class: "strategy", edhrec: { slug: "bounce", tag: "Bounce", decks: 2775 } },
  { slug: "prison", label: "Prison", class: "strategy", edhrec: { slug: "prison", tag: "Prison", decks: 2698 } },
  { slug: "multicolor-matters", label: "Multicolor Matters", class: "strategy", edhrec: { slug: "multicolor-matters", tag: "Multicolor Matters", decks: 2353 } },
  { slug: "impulse-draw", label: "Impulse Draw", class: "strategy", edhrec: { slug: "impulse-draw", tag: "Impulse Draw", decks: 2335 } },
  { slug: "keywords", label: "Keywords", class: "strategy", edhrec: { slug: "keywords", tag: "Keywords", decks: 2261 } },
  { slug: "weenies", label: "Weenies", class: "strategy", edhrec: { slug: "weenies", tag: "Weenies", decks: 1675 } },
  { slug: "land-animation", label: "Land Animation", class: "strategy", edhrec: { slug: "land-animation", tag: "Land Animation", decks: 1493 } },
  { slug: "power-matters", label: "Power Matters", class: "strategy", edhrec: { slug: "power-matters", tag: "Power Matters", decks: 1492 } },
  { slug: "fling", label: "Fling", class: "strategy", edhrec: { slug: "fling", tag: "Fling", decks: 1465 } },
  { slug: "polymorph", label: "Polymorph", class: "strategy", edhrec: { slug: "polymorph", tag: "Polymorph", decks: 1261 } },
  { slug: "sneak-attack", label: "Sneak Attack", class: "strategy", edhrec: { slug: "sneak-attack", tag: "Sneak Attack", decks: 1161 } },
  { slug: "glass-cannon", label: "Glass Cannon", class: "strategy", edhrec: { slug: "glass-cannon", tag: "Glass Cannon", decks: 1106 } },
  { slug: "hand-size", label: "Hand Size", class: "strategy", edhrec: { slug: "hand-size", tag: "Hand Size", decks: 891 } },
  { slug: "extra-upkeeps", label: "Extra Upkeeps", class: "strategy", edhrec: { slug: "extra-upkeeps", tag: "Extra Upkeeps", decks: 855 } },
  { slug: "life-exchange", label: "Life Exchange", class: "strategy", edhrec: { slug: "life-exchange", tag: "Life Exchange", decks: 800 } },
  { slug: "vanilla", label: "Vanilla", class: "strategy", edhrec: { slug: "vanilla", tag: "Vanilla", decks: 540 } },
  { slug: "creatureless", label: "Creatureless", class: "strategy", edhrec: { slug: "creatureless", tag: "Creatureless", decks: 499 } },
  { slug: "ltb-effects", label: "LTB Effects", class: "strategy", edhrec: { slug: "ltb-effects", tag: "LTB Effects", decks: 401 } },
  { slug: "turbo-fog", label: "Turbo Fog", class: "strategy", edhrec: { slug: "turbo-fog", tag: "Turbo Fog", decks: 395 } },
  { slug: "saboteurs", label: "Saboteurs", class: "strategy", edhrec: { slug: "saboteurs", tag: "Saboteurs", decks: 366 } },
  { slug: "color-hack", label: "Color Hack", class: "strategy", edhrec: { slug: "color-hack", tag: "Color Hack", decks: 361 } },
  { slug: "type-hack", label: "Type Hack", class: "strategy", edhrec: { slug: "type-hack", tag: "Type Hack", decks: 324 } },
  { slug: "self-destruct", label: "Self-Destruct", class: "strategy", edhrec: { slug: "self-destruct", tag: "Self-Destruct", decks: 292 } },
  { slug: "lure", label: "Lure", class: "strategy", edhrec: { slug: "lure", tag: "Lure", decks: 286 } },
  { slug: "sneak", label: "Sneak", class: "strategy", edhrec: { slug: "sneak", tag: "Sneak", decks: 254 } },
  { slug: "flying", label: "Flying", class: "mechanic", edhrec: { slug: "flying", tag: "Flying", decks: 27618 } },
  { slug: "landfall", label: "Landfall", class: "mechanic", edhrec: { slug: "landfall", tag: "Landfall", decks: 23896 } },
  { slug: "cascade", label: "Cascade", class: "mechanic", edhrec: { slug: "cascade", tag: "Cascade", decks: 12967 } },
  { slug: "dredge", label: "Dredge", class: "mechanic", edhrec: { slug: "dredge", tag: "Dredge", decks: 10295 } },
  { slug: "populate", label: "Populate", class: "mechanic", edhrec: { slug: "populate", tag: "Populate", decks: 9382 } },
  { slug: "proliferate", label: "Proliferate", class: "mechanic", edhrec: { slug: "proliferate", tag: "Proliferate", decks: 9120 } },
  { slug: "energy", label: "Energy", class: "mechanic", edhrec: { slug: "energy", tag: "Energy", decks: 8935 } },
  { slug: "ninjutsu", label: "Ninjutsu", class: "mechanic", edhrec: { slug: "ninjutsu", tag: "Ninjutsu", decks: 8419 } },
  { slug: "affinity", label: "Affinity", class: "mechanic", edhrec: { slug: "affinity", tag: "Affinity", decks: 7513 } },
  { slug: "defenders", label: "Defenders", class: "mechanic", edhrec: { slug: "defenders", tag: "Defenders", decks: 6521 } },
  { slug: "monarch", label: "Monarch", class: "mechanic", edhrec: { slug: "monarch", tag: "Monarch", decks: 6498 } },
  { slug: "morph", label: "Morph", class: "mechanic", edhrec: { slug: "morph", tag: "Morph", decks: 6107 } },
  { slug: "cycling", label: "Cycling", class: "mechanic", edhrec: { slug: "cycling", tag: "Cycling", decks: 5992 } },
  { slug: "deathtouch", label: "Deathtouch", class: "mechanic", edhrec: { slug: "deathtouch", tag: "Deathtouch", decks: 5259 } },
  { slug: "devotion", label: "Devotion", class: "mechanic", edhrec: { slug: "devotion", tag: "Devotion", decks: 5120 } },
  { slug: "modified-creatures", label: "Modified Creatures", class: "mechanic", edhrec: { slug: "modified-creatures", tag: "Modified Creatures", decks: 5078 } },
  { slug: "mutate", label: "Mutate", class: "mechanic", edhrec: { slug: "mutate", tag: "Mutate", decks: 4634 } },
  { slug: "unblockable", label: "Unblockable", class: "mechanic", edhrec: { slug: "unblockable", tag: "Unblockable", decks: 4490 } },
  { slug: "dungeon", label: "Dungeon", class: "mechanic", edhrec: { slug: "dungeon", tag: "Dungeon", decks: 4410 } },
  { slug: "discover", label: "Discover", class: "mechanic", edhrec: { slug: "discover", tag: "Discover", decks: 4316 } },
  { slug: "prowess", label: "Prowess", class: "mechanic", edhrec: { slug: "prowess", tag: "Prowess", decks: 4086 } },
  { slug: "flash", label: "Flash", class: "mechanic", edhrec: { slug: "flash", tag: "Flash", decks: 3937 } },
  { slug: "fight", label: "Fight", class: "mechanic", edhrec: { slug: "fight", tag: "Fight", decks: 3896 } },
  { slug: "flashback", label: "Flashback", class: "mechanic", edhrec: { slug: "flashback", tag: "Flashback", decks: 3891 } },
  { slug: "haste", label: "Haste", class: "mechanic", edhrec: { slug: "haste", tag: "Haste", decks: 2828 } },
  { slug: "party", label: "Party", class: "mechanic", edhrec: { slug: "party", tag: "Party", decks: 2366 } },
  { slug: "earthbending", label: "Earthbending", class: "mechanic", edhrec: { slug: "earthbending", tag: "Earthbending", decks: 2183 } },
  { slug: "foretell", label: "Foretell", class: "mechanic", edhrec: { slug: "foretell", tag: "Foretell", decks: 2171 } },
  { slug: "coin-flip", label: "Coin Flip", class: "mechanic", edhrec: { slug: "coin-flip", tag: "Coin Flip", decks: 2117 } },
  { slug: "modular", label: "Modular", class: "mechanic", edhrec: { slug: "modular", tag: "Modular", decks: 2009 } },
  { slug: "amass", label: "Amass", class: "mechanic", edhrec: { slug: "amass", tag: "Amass", decks: 1865 } },
  { slug: "die-roll", label: "Die Roll", class: "mechanic", edhrec: { slug: "die-roll", tag: "Die Roll", decks: 1704 } },
  { slug: "madness", label: "Madness", class: "mechanic", edhrec: { slug: "madness", tag: "Madness", decks: 1520 } },
  { slug: "convoke", label: "Convoke", class: "mechanic", edhrec: { slug: "convoke", tag: "Convoke", decks: 1514 } },
  { slug: "the-ring", label: "The Ring", class: "mechanic", edhrec: { slug: "the-ring", tag: "The Ring", decks: 1485 } },
  { slug: "firebending", label: "Firebending", class: "mechanic", edhrec: { slug: "firebending", tag: "Firebending", decks: 1301 } },
  { slug: "connive", label: "Connive", class: "mechanic", edhrec: { slug: "connive", tag: "Connive", decks: 1228 } },
  { slug: "surveil", label: "Surveil", class: "mechanic", edhrec: { slug: "surveil", tag: "Surveil", decks: 1201 } },
  { slug: "devoid", label: "Devoid", class: "mechanic", edhrec: { slug: "devoid", tag: "Devoid", decks: 1104 } },
  { slug: "annihilator", label: "Annihilator", class: "mechanic", edhrec: { slug: "annihilator", tag: "Annihilator", decks: 1100 } },
  { slug: "crime", label: "Crime", class: "mechanic", edhrec: { slug: "crime", tag: "Crime", decks: 1083 } },
  { slug: "suspend", label: "Suspend", class: "mechanic", edhrec: { slug: "suspend", tag: "Suspend", decks: 1075 } },
  { slug: "explore", label: "Explore", class: "mechanic", edhrec: { slug: "explore", tag: "Explore", decks: 1065 } },
  { slug: "myriad", label: "Myriad", class: "mechanic", edhrec: { slug: "myriad", tag: "Myriad", decks: 982 } },
  { slug: "enrage", label: "Enrage", class: "mechanic", edhrec: { slug: "enrage", tag: "Enrage", decks: 889 } },
  { slug: "airbending", label: "Airbending", class: "mechanic", edhrec: { slug: "airbending", tag: "Airbending", decks: 753 } },
  { slug: "indestructible", label: "Indestructible", class: "mechanic", edhrec: { slug: "indestructible", tag: "Indestructible", decks: 703 } },
  { slug: "exalted", label: "Exalted", class: "mechanic", edhrec: { slug: "exalted", tag: "Exalted", decks: 702 } },
  { slug: "evoke", label: "Evoke", class: "mechanic", edhrec: { slug: "evoke", tag: "Evoke", decks: 590 } },
  { slug: "waterbending", label: "Waterbending", class: "mechanic", edhrec: { slug: "waterbending", tag: "Waterbending", decks: 569 } },
  { slug: "freerunning", label: "Freerunning", class: "mechanic", edhrec: { slug: "freerunning", tag: "Freerunning", decks: 532 } },
  { slug: "landwalk", label: "Landwalk", class: "mechanic", edhrec: { slug: "landwalk", tag: "Landwalk", decks: 460 } },
  { slug: "transform", label: "Transform", class: "mechanic", edhrec: { slug: "transform", tag: "Transform", decks: 455 } },
  { slug: "villainous-choice", label: "Villainous Choice", class: "mechanic", edhrec: { slug: "villainous-choice", tag: "Villainous Choice", decks: 439 } },
  { slug: "speed", label: "Speed", class: "mechanic", edhrec: { slug: "speed", tag: "Speed", decks: 436 } },
  { slug: "voting", label: "Voting", class: "mechanic", edhrec: { slug: "voting", tag: "Voting", decks: 424 } },
  { slug: "delirium", label: "Delirium", class: "mechanic", edhrec: { slug: "delirium", tag: "Delirium", decks: 406 } },
  { slug: "offspring", label: "Offspring", class: "mechanic", edhrec: { slug: "offspring", tag: "Offspring", decks: 381 } },
  { slug: "reach", label: "Reach", class: "mechanic", edhrec: { slug: "reach", tag: "Reach", decks: 381 } },
  { slug: "day-night", label: "Day / Night", class: "mechanic", edhrec: { slug: "day-night", tag: "Day / Night", decks: 314 } },
  { slug: "warp", label: "Warp", class: "mechanic", edhrec: { slug: "warp", tag: "Warp", decks: 297 } },
  { slug: "heroic", label: "Heroic", class: "mechanic", edhrec: { slug: "heroic", tag: "Heroic", decks: 270 } },
  { slug: "mayhem", label: "Mayhem", class: "mechanic", edhrec: { slug: "mayhem", tag: "Mayhem", decks: 255 } },
  { slug: "plot", label: "Plot", class: "mechanic", edhrec: { slug: "plot", tag: "Plot", decks: 248 } },
  { slug: "paradox", label: "Paradox", class: "mechanic", edhrec: { slug: "paradox", tag: "Paradox", decks: 238 } },
  { slug: "hellbent", label: "Hellbent", class: "mechanic", edhrec: { slug: "hellbent", tag: "Hellbent", decks: 233 } },
  { slug: "stun", label: "Stun", class: "mechanic", edhrec: { slug: "stun", tag: "Stun", decks: 228 } },
  { slug: "banding", label: "Banding", class: "mechanic", edhrec: { slug: "banding", tag: "Banding", decks: 227 } },
  { slug: "phasing", label: "Phasing", class: "mechanic", edhrec: { slug: "phasing", tag: "Phasing", decks: 224 } },
  { slug: "descend", label: "Descend", class: "mechanic", edhrec: { slug: "descend", tag: "Descend", decks: 221 } },
  { slug: "arcane", label: "Arcane", class: "mechanic", edhrec: { slug: "arcane", tag: "Arcane", decks: 214 } },
  { slug: "web-slinging", label: "Web-slinging", class: "mechanic", edhrec: { slug: "web-slinging", tag: "Web-slinging", decks: 201 } },
  { slug: "kicker", label: "Kicker", class: "mechanic", edhrec: { slug: "kicker", tag: "Kicker", decks: 194 } },
  { slug: "improvise", label: "Improvise", class: "mechanic", edhrec: { slug: "improvise", tag: "Improvise", decks: 181 } },
  { slug: "skulk", label: "Skulk", class: "mechanic", edhrec: { slug: "skulk", tag: "Skulk", decks: 174 } },
  { slug: "summons", label: "Summons", class: "mechanic", edhrec: { slug: "summons", tag: "Summons", decks: 101 } },
  { slug: "miracle", label: "Miracles", class: "mechanic", edhrec: { slug: "miracle", tag: "Miracles", decks: 94 } },
  { slug: "incubate", label: "Incubate", class: "mechanic", edhrec: { slug: "incubate", tag: "Incubate", decks: 92 } },
  { slug: "menace", label: "Menace", class: "mechanic", edhrec: { slug: "menace", tag: "Menace", decks: 91 } },
  { slug: "craft", label: "Craft", class: "mechanic", edhrec: { slug: "craft", tag: "Craft", decks: 85 } },
  { slug: "bloodthirst", label: "Bloodthirst", class: "mechanic", edhrec: { slug: "bloodthirst", tag: "Bloodthirst", decks: 82 } },
  { slug: "sunburst", label: "Sunburst", class: "mechanic", edhrec: { slug: "sunburst", tag: "Sunburst", decks: 80 } },
  { slug: "clash", label: "Clash", class: "mechanic", edhrec: { slug: "clash", tag: "Clash", decks: 80 } },
  { slug: "exploit", label: "Exploit", class: "mechanic", edhrec: { slug: "exploit", tag: "Exploit", decks: 77 } },
  { slug: "squad", label: "Squad", class: "mechanic", edhrec: { slug: "squad", tag: "Squad", decks: 48 } },
  { slug: "horsemanship", label: "Horsemanship", class: "mechanic", edhrec: { slug: "horsemanship", tag: "Horsemanship", decks: 43 } },
  { slug: "repartee", label: "Repartee", class: "mechanic", edhrec: { slug: "repartee", tag: "Repartee", decks: 31 } },
  { slug: "job-select", label: "Job Select", class: "mechanic", edhrec: { slug: "job-select", tag: "Job Select", decks: 23 } },
  { slug: "paradigm", label: "Paradigm", class: "mechanic", edhrec: { slug: "paradigm", tag: "Paradigm", decks: 22 } },
  { slug: "level-up", label: "Level Up", class: "mechanic", edhrec: { slug: "level-up", tag: "Level Up", decks: 17 } },
  { slug: "retrace", label: "Retrace", class: "mechanic", edhrec: { slug: "retrace", tag: "Retrace", decks: 17 } },
  { slug: "increment", label: "Increment", class: "mechanic", edhrec: { slug: "increment", tag: "Increment", decks: 11 } },
  { slug: "opus", label: "Opus", class: "mechanic", edhrec: { slug: "opus", tag: "Opus", decks: 11 } },
  { slug: "dash", label: "Dash", class: "mechanic", edhrec: { slug: "dash", tag: "Dash", decks: 6 } },
  { slug: "lands-matter", label: "Lands Matter", class: "type", edhrec: { slug: "lands-matter", tag: "Lands Matter", decks: 66051 } },
  { slug: "equipment", label: "Equipment", class: "type", edhrec: { slug: "equipment", tag: "Equipment", decks: 58446 } },
  { slug: "legends", label: "Legends", class: "type", edhrec: { slug: "legends", tag: "Legends", decks: 34380 } },
  { slug: "auras", label: "Auras", class: "type", edhrec: { slug: "auras", tag: "Auras", decks: 33934 } },
  { slug: "historic", label: "Historic", class: "type", edhrec: { slug: "historic", tag: "Historic", decks: 23852 } },
  { slug: "vehicles", label: "Vehicles", class: "type", edhrec: { slug: "vehicles", tag: "Vehicles", decks: 16004 } },
  { slug: "sagas", label: "Sagas", class: "type", edhrec: { slug: "sagas", tag: "Sagas", decks: 7649 } },
  { slug: "snow", label: "Snow", class: "type", edhrec: { slug: "snow", tag: "Snow", decks: 4908 } },
  { slug: "curses", label: "Curses", class: "type", edhrec: { slug: "curses", tag: "Curses", decks: 2045 } },
  { slug: "guildgates", label: "Guildgates", class: "type", edhrec: { slug: "guildgates", tag: "Guildgates", decks: 1910 } },
  { slug: "shrines", label: "Shrines", class: "type", edhrec: { slug: "shrines", tag: "Shrines", decks: 1180 } },
  { slug: "adventures", label: "Adventures", class: "type", edhrec: { slug: "adventures", tag: "Adventures", decks: 959 } },
  { slug: "deserts", label: "Deserts", class: "type", edhrec: { slug: "deserts", tag: "Deserts", decks: 946 } },
  { slug: "lessons", label: "Lessons", class: "type", edhrec: { slug: "lessons", tag: "Lessons", decks: 806 } },
  { slug: "spacecraft", label: "Spacecraft", class: "type", edhrec: { slug: "spacecraft", tag: "Spacecraft", decks: 726 } },
  { slug: "rooms", label: "Rooms", class: "type", edhrec: { slug: "rooms", tag: "Rooms", decks: 609 } },
  { slug: "battles", label: "Battles", class: "type", edhrec: { slug: "battles", tag: "Battles", decks: 231 } },
  { slug: "towns", label: "Towns", class: "type", edhrec: { slug: "towns", tag: "Towns", decks: 184 } },
  { slug: "bobbleheads", label: "Bobbleheads", class: "type", edhrec: { slug: "bobbleheads", tag: "Bobbleheads", decks: 133 } },
  { slug: "caves", label: "Caves", class: "type", edhrec: { slug: "caves", tag: "Caves", decks: 49 } },
  { slug: "books", label: "Books", class: "type", edhrec: { slug: "books", tag: "Books", decks: 13 } },
  { slug: "treasure", label: "Treasure", class: "resource", edhrec: { slug: "treasure", tag: "Treasure", decks: 44392 } },
  { slug: "minus-1-minus-1-counters", label: "-1/-1 Counters", class: "resource", edhrec: { slug: "minus-1-minus-1-counters", tag: "-1/-1 Counters", decks: 12898 } },
  { slug: "food", label: "Food", class: "resource", edhrec: { slug: "food", tag: "Food", decks: 7120 } },
  { slug: "clues", label: "Clues", class: "resource", edhrec: { slug: "clues", tag: "Clues", decks: 6076 } },
  { slug: "counters-matter", label: "Counters Matter", class: "resource", edhrec: { slug: "counters-matter", tag: "Counters Matter", decks: 3024 } },
  { slug: "experience-counters", label: "Experience Counters", class: "resource", edhrec: { slug: "experience-counters", tag: "Experience Counters", decks: 1356 } },
  { slug: "charge-counters", label: "Charge Counters", class: "resource", edhrec: { slug: "charge-counters", tag: "Charge Counters", decks: 1087 } },
  { slug: "rad-counters", label: "Rad Counters", class: "resource", edhrec: { slug: "rad-counters", tag: "Rad Counters", decks: 1084 } },
  { slug: "blood", label: "Blood", class: "resource", edhrec: { slug: "blood", tag: "Blood", decks: 1073 } },
  { slug: "time-counters", label: "Time Counters", class: "resource", edhrec: { slug: "time-counters", tag: "Time Counters", decks: 936 } },
  { slug: "spore-counters", label: "Spore Counters", class: "resource", edhrec: { slug: "spore-counters", tag: "Spore Counters", decks: 352 } },
  { slug: "oil-counters", label: "Oil Counters", class: "resource", edhrec: { slug: "oil-counters", tag: "Oil Counters", decks: 139 } },  // ONE MEMBER FOR EVERY TRIBE. "Tribal" is the old word; the type is Kindred (CR 205.2a, 2024).
  { slug: "kindred", label: "Kindred", class: "kindred" },
] as const satisfies readonly ArchetypeEntry[];

export type Archetype = (typeof ARCHETYPE_VOCABULARY)[number]["slug"];

export const ARCHETYPE_LABELS: Record<Archetype, string> = Object.fromEntries(
  ARCHETYPE_VOCABULARY.map((r) => [r.slug, r.label]),
) as Record<Archetype, string>;

export interface KindredTribe {
  /** The creature type(s) on the type line, lowercased as the corpus stores them. Most tribes are
   *  one type; EDHREC's "Sea Creatures" and "Outlaws" are families and list every member. */
  types: readonly string[];
  label: string;
  edhrec: { slug: string; tag: string; decks: number };
}

/** EDHREC's tribe themes, each mapped to the creature type(s) the `kindred` member detects on.
 *  Every type here exists on at least one creature in the derived corpus (asserted by the
 *  generator against the corpus subtype census). */
export const KINDRED_TRIBES: readonly KindredTribe[] = [
  { types: ["dragon"], label: "Dragons", edhrec: { slug: "dragons", tag: "Dragons", decks: 24237 } },
  { types: ["elf"], label: "Elves", edhrec: { slug: "elves", tag: "Elves", decks: 19302 } },
  { types: ["zombie"], label: "Zombies", edhrec: { slug: "zombies", tag: "Zombies", decks: 18268 } },
  { types: ["vampire"], label: "Vampires", edhrec: { slug: "vampires", tag: "Vampires", decks: 15270 } },
  { types: ["human"], label: "Humans", edhrec: { slug: "humans", tag: "Humans", decks: 14407 } },
  { types: ["eldrazi"], label: "Eldrazi", edhrec: { slug: "eldrazi", tag: "Eldrazi", decks: 12313 } },
  { types: ["angel"], label: "Angels", edhrec: { slug: "angels", tag: "Angels", decks: 12172 } },
  { types: ["goblin"], label: "Goblins", edhrec: { slug: "goblins", tag: "Goblins", decks: 12122 } },
  { types: ["dinosaur"], label: "Dinosaurs", edhrec: { slug: "dinosaurs", tag: "Dinosaurs", decks: 11056 } },
  { types: ["wizard"], label: "Wizards", edhrec: { slug: "wizards", tag: "Wizards", decks: 8237 } },
  { types: ["pirate"], label: "Pirates", edhrec: { slug: "pirates", tag: "Pirates", decks: 6841 } },
  { types: ["demon"], label: "Demons", edhrec: { slug: "demons", tag: "Demons", decks: 6618 } },
  { types: ["cat"], label: "Cats", edhrec: { slug: "cats", tag: "Cats", decks: 6487 } },
  { types: ["faerie"], label: "Faeries", edhrec: { slug: "faeries", tag: "Faeries", decks: 5926 } },
  { types: ["merfolk"], label: "Merfolk", edhrec: { slug: "merfolk", tag: "Merfolk", decks: 5895 } },
  { types: ["sliver"], label: "Slivers", edhrec: { slug: "slivers", tag: "Slivers", decks: 5540 } },
  { types: ["knight"], label: "Knights", edhrec: { slug: "knights", tag: "Knights", decks: 5328 } },
  { types: ["assassin"], label: "Assassins", edhrec: { slug: "assassins", tag: "Assassins", decks: 5306 } },
  { types: ["phyrexian"], label: "Phyrexians", edhrec: { slug: "phyrexians", tag: "Phyrexians", decks: 5153 } },
  { types: ["rat"], label: "Rats", edhrec: { slug: "rats", tag: "Rats", decks: 5029 } },
  { types: ["bird"], label: "Birds", edhrec: { slug: "birds", tag: "Birds", decks: 4233 } },
  { types: ["spirit"], label: "Spirits", edhrec: { slug: "spirits", tag: "Spirits", decks: 4218 } },
  { types: ["hydra"], label: "Hydras", edhrec: { slug: "hydras", tag: "Hydras", decks: 4050 } },
  { types: ["ninja"], label: "Ninjas", edhrec: { slug: "ninjas", tag: "Ninjas", decks: 3948 } },
  { types: ["elemental"], label: "Elementals", edhrec: { slug: "elementals", tag: "Elementals", decks: 3944 } },
  { types: ["soldier"], label: "Soldiers", edhrec: { slug: "soldiers", tag: "Soldiers", decks: 3939 } },
  { types: ["horror"], label: "Horrors", edhrec: { slug: "horrors", tag: "Horrors", decks: 3735 } },
  { types: ["saproling"], label: "Saprolings", edhrec: { slug: "saprolings", tag: "Saprolings", decks: 3369 } },
  { types: ["shapeshifter"], label: "Shapeshifters", edhrec: { slug: "shapeshifters", tag: "Shapeshifters", decks: 3230 } },
  { types: ["warrior"], label: "Warriors", edhrec: { slug: "warriors", tag: "Warriors", decks: 3135 } },
  { types: ["kraken", "leviathan", "octopus", "serpent", "whale", "fish"], label: "Sea Creatures", edhrec: { slug: "sea-creatures", tag: "Sea Creatures", decks: 2986 } },
  { types: ["insect"], label: "Insects", edhrec: { slug: "insects", tag: "Insects", decks: 2846 } },
  { types: ["squirrel"], label: "Squirrels", edhrec: { slug: "squirrels", tag: "Squirrels", decks: 2761 } },
  { types: ["spider"], label: "Spiders", edhrec: { slug: "spiders", tag: "Spiders", decks: 2719 } },
  { types: ["frog"], label: "Frogs", edhrec: { slug: "frogs", tag: "Frogs", decks: 2697 } },
  { types: ["ally"], label: "Allies", edhrec: { slug: "allies", tag: "Allies", decks: 2650 } },
  { types: ["rogue"], label: "Rogues", edhrec: { slug: "rogues", tag: "Rogues", decks: 2546 } },
  { types: ["myr"], label: "Myr", edhrec: { slug: "myr", tag: "Myr", decks: 2403 } },
  { types: ["dwarf"], label: "Dwarves", edhrec: { slug: "dwarves", tag: "Dwarves", decks: 2191 } },
  { types: ["mutant"], label: "Mutants", edhrec: { slug: "mutants", tag: "Mutants", decks: 2085 } },
  { types: ["werewolf"], label: "Werewolves", edhrec: { slug: "werewolves", tag: "Werewolves", decks: 1993 } },
  { types: ["cleric"], label: "Clerics", edhrec: { slug: "clerics", tag: "Clerics", decks: 1961 } },
  { types: ["rabbit"], label: "Rabbits", edhrec: { slug: "rabbits", tag: "Rabbits", decks: 1937 } },
  { types: ["dog"], label: "Dogs", edhrec: { slug: "dogs", tag: "Dogs", decks: 1911 } },
  { types: ["bear"], label: "Bears", edhrec: { slug: "bears", tag: "Bears", decks: 1898 } },
  { types: ["snake"], label: "Snakes", edhrec: { slug: "snakes", tag: "Snakes", decks: 1856 } },
  { types: ["beast"], label: "Beasts", edhrec: { slug: "beasts", tag: "Beasts", decks: 1757 } },
  { types: ["god"], label: "Gods", edhrec: { slug: "gods", tag: "Gods", decks: 1736 } },
  { types: ["wolf"], label: "Wolves", edhrec: { slug: "wolves", tag: "Wolves", decks: 1672 } },
  { types: ["otter"], label: "Otters", edhrec: { slug: "otters", tag: "Otters", decks: 1412 } },
  { types: ["treefolk"], label: "Treefolk", edhrec: { slug: "treefolk", tag: "Treefolk", decks: 1410 } },
  { types: ["wraith"], label: "Wraiths", edhrec: { slug: "wraiths", tag: "Wraiths", decks: 1385 } },
  { types: ["artificer"], label: "Artificers", edhrec: { slug: "artificers", tag: "Artificers", decks: 1290 } },
  { types: ["hero"], label: "Heroes", edhrec: { slug: "heroes", tag: "Heroes", decks: 1180 } },
  { types: ["fungus"], label: "Fungi", edhrec: { slug: "fungi", tag: "Fungi", decks: 1147 } },
  { types: ["lizard"], label: "Lizards", edhrec: { slug: "lizards", tag: "Lizards", decks: 1131 } },
  { types: ["ooze"], label: "Oozes", edhrec: { slug: "oozes", tag: "Oozes", decks: 1119 } },
  { types: ["assassin", "mercenary", "pirate", "rogue", "warlock"], label: "Outlaws", edhrec: { slug: "outlaws", tag: "Outlaws", decks: 1084 } },
  { types: ["tyranid"], label: "Tyranids", edhrec: { slug: "tyranids", tag: "Tyranids", decks: 1067 } },
  { types: ["halfling"], label: "Halflings", edhrec: { slug: "halflings", tag: "Halflings", decks: 1055 } },
  { types: ["samurai"], label: "Samurai", edhrec: { slug: "samurai", tag: "Samurai", decks: 1051 } },
  { types: ["villain"], label: "Villains", edhrec: { slug: "villains", tag: "Villains", decks: 1050 } },
  { types: ["giant"], label: "Giants", edhrec: { slug: "giants", tag: "Giants", decks: 1045 } },
  { types: ["orc"], label: "Orcs", edhrec: { slug: "orcs", tag: "Orcs", decks: 1043 } },
  { types: ["bat"], label: "Bats", edhrec: { slug: "bats", tag: "Bats", decks: 1041 } },
  { types: ["mouse"], label: "Mice", edhrec: { slug: "mice", tag: "Mice", decks: 1006 } },
  { types: ["thopter"], label: "Thopters", edhrec: { slug: "thopters", tag: "Thopters", decks: 1006 } },
  { types: ["construct"], label: "Constructs", edhrec: { slug: "constructs", tag: "Constructs", decks: 907 } },
  { types: ["wurm"], label: "Wurms", edhrec: { slug: "wurms", tag: "Wurms", decks: 904 } },
  { types: ["ape"], label: "Apes", edhrec: { slug: "apes", tag: "Apes", decks: 898 } },
  { types: ["golem"], label: "Golems", edhrec: { slug: "golems", tag: "Golems", decks: 864 } },
  { types: ["sphinx"], label: "Sphinxes", edhrec: { slug: "sphinxes", tag: "Sphinxes", decks: 813 } },
  { types: ["scarecrow"], label: "Scarecrows", edhrec: { slug: "scarecrows", tag: "Scarecrows", decks: 811 } },
  { types: ["robot"], label: "Robots", edhrec: { slug: "robots", tag: "Robots", decks: 781 } },
  { types: ["raccoon"], label: "Raccoons", edhrec: { slug: "raccoons", tag: "Raccoons", decks: 738 } },
  { types: ["skeleton"], label: "Skeletons", edhrec: { slug: "skeletons", tag: "Skeletons", decks: 661 } },
  { types: ["minotaur"], label: "Minotaurs", edhrec: { slug: "minotaurs", tag: "Minotaurs", decks: 604 } },
  { types: ["necron"], label: "Necrons", edhrec: { slug: "necrons", tag: "Necrons", decks: 594 } },
  { types: ["turtle"], label: "Turtles", edhrec: { slug: "turtles", tag: "Turtles", decks: 556 } },
  { types: ["monk"], label: "Monks", edhrec: { slug: "monks", tag: "Monks", decks: 543 } },
  { types: ["devil"], label: "Devils", edhrec: { slug: "devils", tag: "Devils", decks: 513 } },
  { types: ["druid"], label: "Druids", edhrec: { slug: "druids", tag: "Druids", decks: 513 } },
  { types: ["lhurgoyf"], label: "Lhurgoyfs", edhrec: { slug: "lhurgoyfs", tag: "Lhurgoyfs", decks: 505 } },
  { types: ["time lord"], label: "Time Lords", edhrec: { slug: "time-lords", tag: "Time Lords", decks: 489 } },
  { types: ["crab"], label: "Crabs", edhrec: { slug: "crabs", tag: "Crabs", decks: 456 } },
  { types: ["plant"], label: "Plants", edhrec: { slug: "plants", tag: "Plants", decks: 409 } },
  { types: ["monkey"], label: "Monkeys", edhrec: { slug: "monkeys", tag: "Monkeys", decks: 405 } },
  { types: ["illusion"], label: "Illusions", edhrec: { slug: "illusions", tag: "Illusions", decks: 390 } },
  { types: ["phoenix"], label: "Phoenixes", edhrec: { slug: "phoenixes", tag: "Phoenixes", decks: 362 } },
  { types: ["nightmare"], label: "Nightmares", edhrec: { slug: "nightmares", tag: "Nightmares", decks: 344 } },
  { types: ["praetor"], label: "Praetors", edhrec: { slug: "praetors", tag: "Praetors", decks: 330 } },
  { types: ["horse"], label: "Horses", edhrec: { slug: "horses", tag: "Horses", decks: 328 } },
  { types: ["mount"], label: "Mounts", edhrec: { slug: "mounts", tag: "Mounts", decks: 323 } },
  { types: ["unicorn"], label: "Unicorns", edhrec: { slug: "unicorns", tag: "Unicorns", decks: 308 } },
  { types: ["archer"], label: "Archers", edhrec: { slug: "archers", tag: "Archers", decks: 302 } },
  { types: ["avatar"], label: "Avatars", edhrec: { slug: "avatars", tag: "Avatars", decks: 298 } },
  { types: ["advisor"], label: "Advisors", edhrec: { slug: "advisors", tag: "Advisors", decks: 293 } },
  { types: ["kithkin"], label: "Kithkin", edhrec: { slug: "kithkin", tag: "Kithkin", decks: 277 } },
  { types: ["detective"], label: "Detectives", edhrec: { slug: "detectives", tag: "Detectives", decks: 250 } },
  { types: ["rebel"], label: "Rebels", edhrec: { slug: "rebels", tag: "Rebels", decks: 237 } },
  { types: ["dalek"], label: "Daleks", edhrec: { slug: "daleks", tag: "Daleks", decks: 232 } },
  { types: ["gorgon"], label: "Gorgons", edhrec: { slug: "gorgons", tag: "Gorgons", decks: 184 } },
  { types: ["griffin"], label: "Griffins", edhrec: { slug: "griffins", tag: "Griffins", decks: 173 } },
  { types: ["cyberman"], label: "Cybermen", edhrec: { slug: "cybermen", tag: "Cybermen", decks: 171 } },
  { types: ["drake"], label: "Drakes", edhrec: { slug: "drakes", tag: "Drakes", decks: 171 } },
  { types: ["astartes"], label: "Astartes", edhrec: { slug: "astartes", tag: "Astartes", decks: 166 } },
  { types: ["satyr"], label: "Satyrs", edhrec: { slug: "satyrs", tag: "Satyrs", decks: 160 } },
  { types: ["gnome"], label: "Gnomes", edhrec: { slug: "gnomes", tag: "Gnomes", decks: 159 } },
  { types: ["shaman"], label: "Shamans", edhrec: { slug: "shamans", tag: "Shamans", decks: 157 } },
  { types: ["fox"], label: "Foxes", edhrec: { slug: "foxes", tag: "Foxes", decks: 156 } },
  { types: ["moonfolk"], label: "Moonfolk", edhrec: { slug: "moonfolk", tag: "Moonfolk", decks: 141 } },
  { types: ["atog"], label: "Atogs", edhrec: { slug: "atogs", tag: "Atogs", decks: 135 } },
  { types: ["mercenary"], label: "Mercenaries", edhrec: { slug: "mercenaries", tag: "Mercenaries", decks: 111 } },
  { types: ["whale"], label: "Whales", edhrec: { slug: "whales", tag: "Whales", decks: 105 } },
  { types: ["elder"], label: "Elders", edhrec: { slug: "elders", tag: "Elders", decks: 104 } },
  { types: ["elephant"], label: "Elephants", edhrec: { slug: "elephants", tag: "Elephants", decks: 100 } },
  { types: ["pegasus"], label: "Pegasi", edhrec: { slug: "pegasi", tag: "Pegasi", decks: 97 } },
  { types: ["goat"], label: "Goats", edhrec: { slug: "goats", tag: "Goats", decks: 95 } },
  { types: ["shark"], label: "Sharks", edhrec: { slug: "sharks", tag: "Sharks", decks: 84 } },
  { types: ["berserker"], label: "Berserkers", edhrec: { slug: "berserkers", tag: "Berserkers", decks: 84 } },
  { types: ["barbarian"], label: "Barbarians", edhrec: { slug: "barbarians", tag: "Barbarians", decks: 78 } },
  { types: ["kor"], label: "Kor", edhrec: { slug: "kor", tag: "Kor", decks: 60 } },
  { types: ["specter"], label: "Specters", edhrec: { slug: "specters", tag: "Specters", decks: 59 } },
  { types: ["servo"], label: "Servos", edhrec: { slug: "servos", tag: "Servos", decks: 55 } },
  { types: ["cephalid"], label: "Cephalids", edhrec: { slug: "cephalids", tag: "Cephalids", decks: 41 } },
  { types: ["symbiote"], label: "Symbiotes", edhrec: { slug: "symbiotes", tag: "Symbiotes", decks: 36 } },
  { types: ["minion"], label: "Minions", edhrec: { slug: "minions", tag: "Minions", decks: 33 } },
  { types: ["kavu"], label: "Kavu", edhrec: { slug: "kavu", tag: "Kavu", decks: 32 } },
  { types: ["bard"], label: "Bards", edhrec: { slug: "bards", tag: "Bards", decks: 29 } },
  { types: ["shade"], label: "Shades", edhrec: { slug: "shades", tag: "Shades", decks: 29 } },
  { types: ["ogre"], label: "Ogres", edhrec: { slug: "ogres", tag: "Ogres", decks: 28 } },
  { types: ["hippo"], label: "Hippos", edhrec: { slug: "hippos", tag: "Hippos", decks: 24 } },
  { types: ["noble"], label: "Nobles", edhrec: { slug: "nobles", tag: "Nobles", decks: 13 } },
  { types: ["crocodile"], label: "Crocodiles", edhrec: { slug: "crocodiles", tag: "Crocodiles", decks: 11 } },
  { types: ["toy"], label: "Toys", edhrec: { slug: "toys", tag: "Toys", decks: 11 } },];

/** EDHREC themes deliberately NOT in the vocabulary, with the reason. Kept so the generator can
 *  prove every one of the 401 was classified on purpose rather than dropped. */
export const EXCLUDED_THEMES: Readonly<Record<string, string>> = {
  "ramp": "role, not a plan",
  "cedh": "format or meta label",
  "card-draw": "role, not a plan",
  "birthing-pod": "named-card build",
  "cantrips": "role, not a plan",
  "counterspells": "role, not a plan",
  "unnatural": "60-card slang or unidentified",
  "ad-nauseam": "named-card build",
  "rat-colony": "named-card build",
  "eggs": "named-card build",
  "dragons-approach": "named-card build",
  "sunforger": "named-card build",
  "scry": "role, not a plan",
  "cheerios": "named-card build",
  "rock": "named-card build",
  "shadowborn-apostles": "named-card build",
  "tron": "named-card build",
  "persistent-petitioners": "named-card build",
  "attractions": "not EDH-legal (CLAUDE.md legality rule)",
  "primal-surge": "named-card build",
  "kaheera-companion": "named-card build",
  "delver": "named-card build",
  "relentless-rats": "named-card build",
  "looting": "role, not a plan",
  "slime-against-humanity": "named-card build",
  "hare-apparent": "named-card build",
  "jegantha-companion": "named-card build",
  "keruga-companion": "named-card build",
  "mana-dorks": "role, not a plan",
  "blue-moon": "named-card build",
  "obosh-companion": "named-card build",
  "stoneblade": "named-card build",
  "old-school": "format or meta label",
  "umori-companion": "named-card build",
  "lurrus-companion": "named-card build",
  "rube-goldberg": "named-card build",
  "turbo": "60-card slang or unidentified",
  "all-spells": "named-card build",
  "gyruda-companion": "named-card build",
  "tempest-hawk": "named-card build",
  "stickers": "not EDH-legal (CLAUDE.md legality rule)",
  "mana-rocks": "role, not a plan",
  "templar-knights": "named-card build",
  "zirda-companion": "named-card build",
  "doomsday": "named-card build",
  "custom-cards": "format or meta label",
  "cid": "named-card build",
  "premodern": "format or meta label",
  "european-highlander": "format or meta label",
  "value-vintage": "format or meta label",
  "planechase": "format or meta label",
  "dandan": "named-card build",};

export interface ArchetypeSignature {
  /** Theme tags (`verb:subjectKey`, `static:kind`); a trailing colon matches the verb family. */
  tags?: string[];
  effectKinds?: string[];
  /** Voltron's two: "equipment" always, "aura" only when it enchants a creature. */
  subtypes?: string[];
  /** Card types the archetype is DEFINED BY, matched against `CardSignal.cardTypes`. The first row
   *  using it was superfriends, and it exists because that archetype is a type COUNT and nothing
   *  else — see the row for the measurement. */
  cardTypes?: string[];
  /** PRINTED KEYWORDS, lowercased as Scryfall lists them -- keyword abilities AND keyword actions
   *  ("cascade", "venture into the dungeon", "investigate"). The census shows 791 distinct, and for a
   *  named mechanic the keyword IS the card's membership: no derive verb says "this card cascades".
   *  Evergreen keywords (flying, haste, flash, trample ...) are deliberately never a signal: 2,143
   *  fliers corpus-wide means every deck clears the floor on them, and the payoff that would gate
   *  it ("creatures with flying you control get +1/+1") is an effect subject, not a cares tag. */
  keywords?: string[];
  /** Any word on the type line, lowercased: types, supertypes and every subtype. `cardTypes` is the
   *  type count; this is for the object classes a subtype names (vehicle, saga, curse, shrine). */
  lineWords?: string[];
  /** What the card's token-generation makes (`CardSignal.tokenKinds`): the resource rows. */
  tokenKinds?: string[];
  /** EVERY tag listed must be present. A wheel is a discard AND a draw on one card; either alone is
   *  a discard spell or a cantrip. The only conjunction in the grammar, added for exactly that. */
  allTags?: string[];
  /** Tags read on the CARES side only. `tags` names both the supply and the demand of one event;
   *  a row whose supply is a conjunction (wheels) or a keyword has no supply tag to name, and its
   *  payoff still has to be found somewhere -- "whenever you draw" is `draw:any` in the cares tags
   *  and a cantrip in the theme tags, and only the first is a wheels payoff. */
  demandTags?: string[];
  /** The archetype is its PAYOFFS, so a card matching only on the supply side counts at
   *  `PRODUCER_SHARE` rather than full. Set per row, with the measurement in the comment beside it
   *  -- most archetypes are supply-defined (a token maker MAKES tokens, a reanimation spell DOES
   *  the recursion) and `create-token` is not even a trigger event anywhere in the corpus, so
   *  `tokens` is 0 cares-backed by construction and could never be gated this way. */
  demandDefined?: boolean;
  /** THE ARCHETYPE DOES NOT EXIST WITHOUT A PAYOFF IN THE DECK (roadmap T2c, owner's correction
   *  2026-09-03): *"if you have 30 enchantments and no cards that actually care about enchantments
   *  you are not Enchantress deck"*.
   *
   *  `demandDefined` alone cannot say that. It only WEIGHTS the supply side down to
   *  `PRODUCER_SHARE`, and a type count is large enough to clear `ARCHETYPE_FLOOR` on weight
   *  0.35 by itself: thirty enchantments in a sixty-card nonland deck is 0.17, twice the floor,
   *  with not one card caring. This gate drops the row outright unless at least one card in the
   *  deck matches on the DEMAND side, so the type count can only ever amplify a payoff that is
   *  really there.
   *
   *  NOT SET ON `superfriends`, and the difference is the point: a deck running 21 planeswalkers IS
   *  a superfriends deck whether or not anything pays them off. Thirty enchantments is not an
   *  Enchantress deck; it is a deck with enchantments in it. */
  requiresDemand?: boolean;
}

/** Each DETECTED archetype's defining own-card signal. Deliberately tight and mostly disjoint:
 *  it EXCLUDES broad shared kinds (damage, draw-card, pump) that would make every card
 *  match every archetype (the bug this replaces). Tag strings mirror the validated ones
 *  already used in mechanisms.ts CATEGORY_MATCH. Voltron keys on subtypes (equipment,
 *  creature-enchanting auras) rather than tags/effect-kinds. Tunable.
 *
 *  A member ABSENT here is declared, not detected -- see the file header. The rows added 2026-09-06
 *  each cite the corpus census count of the signal they key on, so a row resting on a signal the
 *  derive layer never emits cannot be written by accident; the test checks every tag verb and
 *  effect kind against the tagger's vocabulary for the same reason. */
export const ARCHETYPE_SIGNATURE: Partial<Record<Archetype, ArchetypeSignature>> = {
  tokens: { tags: ["create-token:any"], effectKinds: ["token-generation", "token-doubling"] },
  // death/sacrifice events define aristocrats; forced-sacrifice dropped — edict engines land
  // via their dies:/sacrifice: emits, and dropping it sheds the destroy→forced-sacrifice mislabel.
  // DEMAND-DEFINED (2026-08-21). An aristocrats deck is its PAYOFFS -- Zulaport Cutthroat, Blood
  // Artist, Mayhem Devil -- not the removal spell that happens to emit `sacrifice:creature`.
  // Counting supply and demand alike made a control deck's removal package into its aristocrats
  // confidence: MEASURED over the 71 decks, 815 of the 974 matches are supply-only against 159
  // cares-backed, and Aristocrats topped 4 of the 6 decks the owner named "Control" -- decks with
  // no Zulaport and no Blood Artist in them. The Sorin defect (`analyze.ts:590`) one layer up.
  aristocrats: { tags: ["dies:", "sacrifice:"], effectKinds: ["drain"], demandDefined: true },
  lifegain: { tags: ["gain-life:any"], effectKinds: ["lifegain"] },
  landfall: { tags: ["enters:land"] },
  spellslinger: { tags: ["cast:instant", "cast:sorcery"], effectKinds: ["copy-spell"] },
  reanimator: { effectKinds: ["graveyard-recursion", "animate"] },
  counters: { tags: ["proliferate:any"], effectKinds: ["counter-placement", "enters-with-counters", "proliferate"] },
  voltron: { subtypes: ["equipment", "aura"] },
  // SUPERFRIENDS IS A CARD TYPE COUNT AND NOTHING ELSE (roadmap M1, owner-reported 2026-08-23). A
  // 21-planeswalker deck read as "wins by damage or drain" with no planeswalker label in existence,
  // because every other row here keys on a MECHANISM and this archetype has none: what makes a deck
  // superfriends is that a third of it is planeswalkers.
  //
  // NO NEW THRESHOLD, and that is the measurement rather than a convenience. Planeswalkers per deck
  // across the 71 are 0 on FIFTY decks, 1 on fourteen, 2 on five — and then 18 and 21. The most any
  // non-superfriends deck runs is 2 (3.4% of its nonlands) against 28.1% and 32.8% for the two real
  // ones, so every threshold between them gives the identical answer and `ARCHETYPE_FLOOR` (0.08)
  // already separates them by a factor of eight. The A11 tripwire — cap how many of the 71 it may
  // top, then measure — is satisfied with the widest margin any archetype here has.
  superfriends: { cardTypes: ["planeswalker"] },
  // ENCHANTRESS AND ARTIFACTS ARE TYPE COUNTS WITH A PAYOFF ROW (roadmap T2c, owner-reported
  // 2026-09-03). This file's header has deferred both since it was written -- "the heuristic ones
  // (tribal, enchantress, artifacts, group slug/hug) ... land in follow-on plans" -- and the cost of
  // that gap is that on an Enchantress deck the panel ranks the six things the deck ALSO does while
  // the one thing it IS cannot appear at any percentage. The owner hit exactly that.
  //
  // DEMAND-DEFINED, which is what keeps them from being type counts alone. The payoff -- a card that
  // CARES about an enchantment entering, i.e. Enchantress's Presence, Setessan Champion, Sythis --
  // counts full; a card that is merely an enchantment counts at `PRODUCER_SHARE`. Without that a
  // deck holding a dozen incidental enchantments would read as an Enchantress deck, which is the
  // universal-bucket failure this file has refused four times on the theme line.
  enchantress: {
    cardTypes: ["enchantment"], tags: ["enters:enchantment"],
    demandDefined: true, requiresDemand: true,
  },
  artifacts: {
    cardTypes: ["artifact"], tags: ["enters:artifact"],
    demandDefined: true, requiresDemand: true,
  },

  // ---- strategies (2026-09-06; census counts are corpus-wide over 21,317 derived cards) ----
  // A burn deck is the payoff that watches noncombat damage (cares `non-combat-damage:any` 32,
  // Torbran's `damage-multiplier` 66), amplified by the 963 "any target" sources. Gated, because
  // the sources alone are every red deck's removal.
  burn: { tags: ["non-combat-damage:any"], effectKinds: ["damage-multiplier"], demandDefined: true, requiresDemand: true },
  // `mill:any` 477 emits, and the keyword action itself on 451 cards (Scryfall lists "mill").
  mill: { tags: ["mill:any"], keywords: ["mill"] },
  // The payoff is what watches cards ENTER the graveyard (cares 13 + 12); dredge is the supply
  // that only a self-mill deck runs. `mill-self` in mechanisms.ts keys on the same tags.
  "self-mill": { tags: ["enters-graveyard:"], keywords: ["dredge"], demandDefined: true, requiresDemand: true },
  // NOT `graveyard-recursion` AND NOT `leaves-graveyard:`: both are reanimator's own signal, and a
  // row that is a superset of another always outranks it -- measured on the EDHREC population,
  // Graveyard topped 7 of the 10 Reanimator decks. What is left is the graveyard AS A RESOURCE:
  // the keywords that cast from it and the payoffs that watch cards enter it.
  graveyard: {
    tags: ["enters-graveyard:"],
    keywords: ["flashback", "escape", "unearth", "delve", "dredge", "embalm", "eternalize", "scavenge", "aftermath", "disturb", "encore", "jump-start"],
  },
  // The re-firer is the payoff (cares `etb-refire` 390: flicker, copy, trigger doublers); the 3,321
  // entry-trigger creatures are its supply at PRODUCER_SHARE.
  blink: { effectKinds: ["flicker"], tags: ["etb-refire"], demandDefined: true, requiresDemand: true },
  // A wheel discards AND draws on the one card: Windfall, Wheel of Fortune, Anje all carry both --
  // and so does every loot and rummage, which is why the row is gated on a payoff that watches the
  // draw or the discard (cares `draw:any` 118, `discard:any` 54: Niv-Mizzet, Waste Not). Measured
  // ungated: four of the 71 flipped to Wheels on their loot spells, one a spellslinger at 27%.
  // CEILING: connive derives the same pair, so a Raffine deck reads as wheels too.
  wheels: { allTags: ["discard:any", "draw:any"], demandTags: ["draw:any", "discard:any"], demandDefined: true, requiresDemand: true },
  storm: { keywords: ["storm"] },
  "extra-turns": { effectKinds: ["extra-turn"] },
  "extra-combats": { effectKinds: ["extra-combat"] },
  "forced-combat": { keywords: ["goad"] },
  infect: { keywords: ["infect", "toxic", "poisonous"] },
  // Cares `discard:any` 54 is the payoff; the 954 discard emits are supply. Controller is not in
  // the key, so self-discard cannot be told from opponent discard here -- `self-discard` is declared.
  discard: { tags: ["discard:any"], demandDefined: true, requiresDemand: true },
  lifedrain: { effectKinds: ["drain"] },
  clones: { effectKinds: ["clone"] },
  "spell-copy": { effectKinds: ["copy-spell"] },
  fling: { allTags: ["sacrifice:creature", "non-combat-damage:any"] },
  anthems: { tags: ["static:pump"] },
  // Cares `attacks:creature` 248 / `attacks:any` 159 are the payoffs; the 1,933 attack triggers
  // themselves are supply.
  "attack-triggers": { tags: ["attacks:"], demandDefined: true, requiresDemand: true },
  sneak: { keywords: ["sneak"] },

  // ---- mechanics: the keyword IS the membership ----
  proliferate: { tags: ["proliferate:any"], keywords: ["proliferate"] },
  populate: { keywords: ["populate"] },
  ninjutsu: { keywords: ["ninjutsu", "commander ninjutsu"] },
  morph: { keywords: ["morph", "megamorph", "disguise", "manifest", "manifest dread", "cloak"] },
  cycling: { keywords: ["cycling", "typecycling", "landcycling", "basic landcycling", "plainscycling", "islandcycling", "swampcycling", "mountaincycling", "forestcycling"] },
  affinity: { keywords: ["affinity"] },
  mutate: { keywords: ["mutate"] },
  modular: { keywords: ["modular"] },
  foretell: { keywords: ["foretell"] },
  convoke: { keywords: ["convoke"] },
  amass: { keywords: ["amass"] },
  connive: { keywords: ["connive"] },
  surveil: { keywords: ["surveil"] },
  explore: { keywords: ["explore"] },
  suspend: { keywords: ["suspend"] },
  myriad: { keywords: ["myriad"] },
  enrage: { keywords: ["enrage"] },
  exalted: { keywords: ["exalted"] },
  evoke: { keywords: ["evoke"] },
  freerunning: { keywords: ["freerunning"] },
  delirium: { keywords: ["delirium"] },
  descend: { keywords: ["descend", "fathomless descent"] },
  plot: { keywords: ["plot"] },
  kicker: { keywords: ["kicker", "multikicker"] },
  improvise: { keywords: ["improvise"] },
  skulk: { keywords: ["skulk"] },
  craft: { keywords: ["craft"] },
  miracle: { keywords: ["miracle"] },
  incubate: { keywords: ["incubate"] },
  sunburst: { keywords: ["sunburst"] },
  exploit: { keywords: ["exploit"] },
  squad: { keywords: ["squad"] },
  "level-up": { keywords: ["level up"] },
  retrace: { keywords: ["retrace"] },
  dash: { keywords: ["dash"] },
  flashback: { keywords: ["flashback"] },
  madness: { keywords: ["madness"] },
  cascade: { keywords: ["cascade"] },
  discover: { keywords: ["discover"] },
  dredge: { keywords: ["dredge"] },
  dungeon: { keywords: ["venture into the dungeon"] },
  "day-night": { keywords: ["daybound", "nightbound"] },
  speed: { keywords: ["start your engines!", "max speed"] },
  "die-roll": { tags: ["dice-rolled:any"] },
  voting: { keywords: ["will of the council", "council's dilemma", "will of the planeswalkers", "secret council"] },
  offspring: { keywords: ["offspring"] },
  warp: { keywords: ["warp"] },
  mayhem: { keywords: ["mayhem"] },
  "web-slinging": { keywords: ["web-slinging"] },
  earthbending: { keywords: ["earthbend"] },
  firebending: { keywords: ["firebending"] },
  waterbending: { keywords: ["waterbend"] },
  airbending: { keywords: ["airbend"] },
  heroic: { keywords: ["heroic"] },
  hellbent: { keywords: ["hellbent"] },
  prowess: { keywords: ["prowess"] },
  fight: { keywords: ["fight"] },
  devoid: { keywords: ["devoid"] },
  annihilator: { keywords: ["annihilator"] },
  transform: { keywords: ["transform"] },
  landwalk: { keywords: ["landwalk", "swampwalk", "islandwalk", "forestwalk", "mountainwalk", "plainswalk"] },
  horsemanship: { keywords: ["horsemanship"] },
  banding: { keywords: ["banding"] },
  phasing: { keywords: ["phasing"] },
  defenders: { keywords: ["defender"] },
  bloodthirst: { keywords: ["bloodthirst"] },
  clash: { keywords: ["clash"] },
  arcane: { lineWords: ["arcane"], keywords: ["splice"] },
  "modified-creatures": { keywords: ["backup", "reconfigure"], effectKinds: ["counter-placement"], demandDefined: true, requiresDemand: true },

  // ---- object classes: the type-line word, gated on a payoff where a cares tag exists ----
  equipment: { lineWords: ["equipment"], tags: ["enters:equipment"], demandDefined: true, requiresDemand: true },
  auras: { lineWords: ["aura"], tags: ["enters:aura"], demandDefined: true, requiresDemand: true },
  vehicles: { lineWords: ["vehicle"], keywords: ["crew"], tags: ["enters:vehicle"], demandDefined: true, requiresDemand: true },
  sagas: { lineWords: ["saga"], tags: ["enters:saga"], demandDefined: true, requiresDemand: true },
  // Lands are not in the signals (`isLand` filter), so this is the payoff side only: cares
  // `enters:land` 173, `dies:land` (Titania), land-play.
  "lands-matter": { tags: ["enters:land", "dies:land", "sacrifice:land", "land-play:land"], demandDefined: true, requiresDemand: true },
  legends: { lineWords: ["legendary"], tags: ["enters:legendary"], demandDefined: true, requiresDemand: true },
  battles: { lineWords: ["battle"] },
  rooms: { lineWords: ["room"], tags: ["unlock:"] },
  curses: { lineWords: ["curse"], tags: ["enters:curse"], demandDefined: true, requiresDemand: true },
  shrines: { lineWords: ["shrine"] },
  spacecraft: { lineWords: ["spacecraft"], keywords: ["station"] },
  adventures: { lineWords: ["adventure"] },
  lessons: { lineWords: ["lesson"], keywords: ["learn"] },
  snow: { lineWords: ["snow"] },
  bobbleheads: { lineWords: ["bobblehead"] },

  // ---- resources: what the token-generation MAKES, gated on something caring about it ----
  treasure: { tokenKinds: ["treasure"], keywords: ["treasure"], tags: ["enters:treasure", "sacrifice:treasure", "create-token:treasure"], demandDefined: true, requiresDemand: true },
  food: { tokenKinds: ["food"], keywords: ["food"], tags: ["enters:food", "sacrifice:food", "create-token:food"], demandDefined: true, requiresDemand: true },
  clues: { tokenKinds: ["clue"], keywords: ["investigate"], tags: ["enters:clue", "sacrifice:clue", "create-token:clue"], demandDefined: true, requiresDemand: true },
  blood: { tokenKinds: ["blood"], tags: ["enters:blood", "sacrifice:blood", "create-token:blood"], demandDefined: true, requiresDemand: true },
  // The counter KIND is not in the derived data (`counter-added:any` 2,623 says nothing about
  // which counter), so -1/-1 rides on the keywords that only place them. `counters-matter` (the
  // generic kind: charge, experience, oil) stays declared for the same reason -- a row on
  // `counter-added:` is a superset of `counters` and topped all ten +1/+1 decks when it was tried.
  "minus-1-minus-1-counters": { keywords: ["wither", "persist", "infect"] },
};

/** DECLARED MEMBERS AND THE SIGNAL EACH ONE WAITS FOR. Every one is a normalize-vocabulary gap or
 *  a subject the theme key drops, i.e. not a matcher patch; recorded here so the next vocabulary
 *  run buys the right words. Census 2026-09-06.
 *
 *  - theft, donate, life-exchange, polymorph: no `gain-control` / `exchange` verb reaches the derived
 *    corpus (Control Magic derives `enters:aura` and nothing else).
 *  - big-mana, x-spells: no `x-cost` or mana-doubling kind is derived; `mana-generation` is ramp.
 *  - group-hug, group-slug, self-damage, pingers: the theme key keeps the verb and the subject's
 *    type, never its CONTROLLER, so "each opponent" and "you" read alike.
 *  - control, stax, aggro, midrange, tempo, hatebears, pillow-fort, prison, politics, chaos,
 *    toolbox, aikido, glass-cannon, stompy, weenies, zoo, creatureless, saboteurs, bounce: build
 *    shapes, not card texts; A17 (2026-08-21) measured the interaction count and refused it.
 *  - party, devotion, energy, monarch, the-ring, crime, villainous-choice, coin-flip, commander-
 *    matters, multicolor-matters, exile, impulse-draw, topdeck, extra-upkeeps, hand-size,
 *    power/toughness-matters, ltb-effects, activated/triggered-abilities, tap-untap, keywords,
 *    vanilla, color/type-hack, lure, self-discard, land-animation, self-destruct, power, sacrifice,
 *    sneak-attack, historic, guildgates/deserts/caves/towns (lands are outside the signals), books,
 *    counters-matter, charge/rad/oil/spore/time/experience counters, stun (no counter kind is derived), etb
 *    (named "blink" here), turbo-fog (`prevent` never derives), land-destruction (`dies:land` is
 *    what every fetchland emits too), flying/haste/reach/menace/deathtouch/unblockable/
 *    indestructible/flash (evergreen, see `keywords`), paradox/repartee/job-select/paradigm/
 *    increment/opus/summons (keywords the corpus has not seen five times). */
export const DETECTABLE: ReadonlySet<Archetype> = new Set<Archetype>([
  ...(Object.keys(ARCHETYPE_SIGNATURE) as Archetype[]),
  "combo",   // detected from the combo finder, not a signature
  "kindred", // detected by `detectKindred`
]);
