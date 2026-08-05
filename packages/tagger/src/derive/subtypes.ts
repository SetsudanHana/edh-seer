/** Every creature, artifact, enchantment and land subtype, lowercased.
 *
 *  A CLOSED list rather than a head-noun heuristic: `parseSubject` reads free text, and any word it
 *  guesses to be a subtype becomes a filter `edges.ts` matches against another card's type line —
 *  so a wrong guess silently deletes an edge. Regenerate from Scryfall when Wizards adds types:
 *    for c in creature artifact enchantment land; do curl -s https://api.scryfall.com/catalog/${c}-types; done
 *
 *  Planeswalker and spell types are deliberately excluded: planeswalker types are proper names
 *  ("will", "dark") that collide with ordinary words, and no engine subject filters on a spell type.
 */
export const SUBTYPES: ReadonlySet<string> = new Set([
  "advisor", "aetherborn", "alien", "ally", "angel", "antelope", "ape", "archer",
  "archon", "armadillo", "army", "artificer", "assassin", "assembly-worker", "astartes", "atog",
  "attraction", "aura", "aurochs", "automaton", "avatar", "azra", "background", "badger",
  "balloon", "barbarian", "bard", "basilisk", "bat", "bear", "beast", "beaver",
  "beeble", "beholder", "berserker", "bird", "bison", "blinkmoth", "blood", "boar",
  "bobblehead", "book", "borg", "brainiac", "bringer", "brushwagg", "c'tan", "camarid",
  "camel", "capybara", "caribou", "carrier", "cartouche", "case", "cat", "cave",
  "centaur", "chicken", "child", "chimera", "citizen", "class", "cleric", "cloud",
  "clown", "clue", "cockatrice", "construct", "contraption", "coward", "coyote", "crab",
  "crocodile", "curse", "custodes", "cyberman", "cyclops", "dalek", "dauthi", "demigod",
  "demon", "desert", "deserter", "detective", "devil", "dinosaur", "djinn", "doctor",
  "dog", "dragon", "drake", "dreadnought", "drix", "drone", "druid", "dryad",
  "dwarf", "echidna", "efreet", "egg", "elder", "eldrazi", "elemental", "elephant",
  "elf", "elk", "employee", "equipment", "eternal", "eye", "faerie", "ferret",
  "fish", "flagbearer", "food", "forest", "fortification", "fox", "fractal", "frog",
  "fungus", "gamer", "gamma", "gargoyle", "gate", "germ", "giant", "giraffe",
  "gith", "glimmer", "gnoll", "gnome", "goat", "goblin", "god", "gold",
  "golem", "gorgon", "graveborn", "gremlin", "griffin", "guest", "hag", "halfling",
  "hamster", "harpy", "head", "hedgehog", "hellion", "hero", "hippo", "hippogriff",
  "homarid", "homunculus", "horror", "horse", "human", "hydra", "hyena", "illusion",
  "imp", "incarnation", "incubator", "infinity", "inhuman", "inkling", "inquisitor", "insect",
  "island", "jackal", "jellyfish", "juggernaut", "junk", "kangaroo", "kavu", "kirin",
  "kithkin", "klingon", "knight", "kobold", "kor", "kraken", "kree", "lair",
  "lamia", "lammasu", "leech", "lemur", "leviathan", "lhurgoyf", "licid", "lizard",
  "llama", "lobster", "locus", "manticore", "map", "masticore", "mercenary", "merfolk",
  "metathran", "mine", "minion", "minotaur", "mite", "mole", "monger", "mongoose",
  "monk", "monkey", "moogle", "moonfolk", "mount", "mountain", "mouse", "mutant",
  "myr", "mystic", "naga", "nautilus", "necron", "nephilim", "nightmare", "nightstalker",
  "ninja", "noble", "noggle", "nomad", "nymph", "octopus", "officer", "ogre",
  "ooze", "orb", "orc", "orgg", "otter", "ouphe", "ox", "oyster",
  "pangolin", "peasant", "pegasus", "pentavite", "performer", "pest", "phelddagrif", "phoenix",
  "phyrexian", "pilot", "pincher", "pirate", "plains", "plan", "planet", "plant",
  "platypus", "porcupine", "possum", "power-plant", "powerstone", "praetor", "primarch", "prism",
  "processor", "q", "qu", "rabbit", "raccoon", "ranger", "rat", "rebel",
  "reflection", "reveler", "rhino", "rigger", "robot", "rogue", "role", "room",
  "rukh", "rune", "sable", "saga", "salamander", "samurai", "sand", "saproling",
  "satyr", "scarecrow", "scientist", "scion", "scorpion", "scout", "sculpture", "seal",
  "serf", "serpent", "servo", "shade", "shaman", "shapeshifter", "shard", "shark",
  "sheep", "shi'ar", "shrine", "siren", "skeleton", "skrull", "skunk", "slith",
  "sliver", "sloth", "slug", "snail", "snake", "soldier", "soltari", "sorcerer",
  "spacecraft", "spawn", "specter", "spellshaper", "sphere", "sphinx", "spider", "spike",
  "spirit", "splinter", "sponge", "spy", "squid", "squirrel", "starfish", "stone",
  "surrakar", "survivor", "swamp", "symbiote", "synth", "teddy", "tentacle", "terminus",
  "tetravite", "thalakos", "thopter", "thrull", "tiefling", "time lord", "tosk", "tower",
  "town", "toy", "treasure", "treefolk", "trilobite", "triskelavite", "troll", "turtle",
  "tyranid", "unicorn", "urza's", "urzan", "utrom", "vampire", "varmint", "vedalken",
  "vehicle", "villain", "volver", "vulcan", "wall", "walrus", "warlock", "warrior",
  "weasel", "weird", "werewolf", "whale", "wizard", "wolf", "wolverine", "wombat",
  "worm", "wraith", "wurm", "yeti", "zombie", "zubera",
]);
