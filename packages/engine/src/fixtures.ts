import type { Card } from "./card.js";

function card(name: string, typeLine: string, oracleText: string, extra: Partial<Card> = {}): Card {
  return { name, typeLine, oracleText, keywords: [], colors: [], manaValue: 0, ...extra };
}

export const FIXTURES: Record<string, Card> = {
  dockside: card(
    "Dockside Extortionist",
    "Legendary Creature — Goblin Pirate",
    "When Dockside Extortionist enters the battlefield, create a number of Treasure tokens equal to the number of artifacts and enchantments your opponents control.",
    { colors: ["R"], manaValue: 2 },
  ),
  fireweaver: card(
    "Reckless Fireweaver",
    "Creature — Human Artificer",
    "Whenever an artifact enters the battlefield under your control, Reckless Fireweaver deals 1 damage to each opponent.",
    { colors: ["R"], manaValue: 2 },
  ),
  krenko: card(
    "Krenko, Mob Boss",
    "Legendary Creature — Goblin Warrior",
    "Tap: Create a number of 1/1 red Goblin creature tokens equal to the number of Goblins you control.",
    { colors: ["R"], manaValue: 4 },
  ),
  impactTremors: card(
    "Impact Tremors",
    "Enchantment",
    "Whenever a creature enters the battlefield under your control, Impact Tremors deals 1 damage to each opponent.",
    { colors: ["R"], manaValue: 2 },
  ),
  ashnods: card(
    "Ashnod's Altar",
    "Artifact",
    "Sacrifice a creature: Add two colorless mana.",
    { manaValue: 3 },
  ),
  bloodArtist: card(
    "Blood Artist",
    "Creature — Vampire",
    "Whenever Blood Artist or another creature dies, target player loses 1 life and you gain 1 life.",
    { colors: ["B"], manaValue: 2 },
  ),
  cultivate: card(
    "Cultivate",
    "Sorcery",
    "Search your library for up to two basic land cards, reveal them, put one onto the battlefield tapped and the other into your hand, then shuffle.",
    { colors: ["G"], manaValue: 3 },
  ),
  lotusCobra: card(
    "Lotus Cobra",
    "Creature — Snake",
    "Landfall — Whenever a land enters the battlefield under your control, add one mana of any color.",
    { colors: ["G"], manaValue: 2 },
  ),
  swordsToPlowshares: card(
    "Swords to Plowshares",
    "Instant",
    "Exile target creature. Its controller gains life equal to its power.",
    { colors: ["W"], manaValue: 1 },
  ),
  divination: card(
    "Divination",
    "Sorcery",
    "Draw two cards.",
    { colors: ["U"], manaValue: 3 },
  ),
  // Combo pieces
  thassasOracle: card(
    "Thassa's Oracle",
    "Creature — Merfolk Wizard",
    "When Thassa's Oracle enters the battlefield, look at the top X cards of your library, where X is your devotion to blue. If your library and hand contain X or fewer cards, you win the game.",
    { colors: ["U"], manaValue: 2 },
  ),
  consultation: card(
    "Demonic Consultation",
    "Instant",
    "Name a card. Exile the top six cards of your library, then exile all cards with that name from your library. Put the rest into your hand.",
    { colors: ["B"], manaValue: 1 },
  ),
  goblinChieftain: card(
    "Goblin Chieftain",
    "Creature — Goblin",
    "Other Goblin creatures you control get +1/+1 and have haste.",
    { colors: ["R"], manaValue: 3 },
  ),
  goblinRecruiter: card(
    "Goblin Recruiter",
    "Creature — Goblin",
    "When Goblin Recruiter enters the battlefield, search your library for any number of Goblin cards.",
    { colors: ["R"], manaValue: 3 },
  ),
  lightningBolt: card(
    "Lightning Bolt",
    "Instant",
    "Lightning Bolt deals 3 damage to any target.",
    { colors: ["R"], manaValue: 1 },
  ),
  archmageEmeritus: card(
    "Archmage Emeritus",
    "Creature — Human Wizard",
    "Magecraft — Whenever you cast or copy an instant or sorcery spell, draw a card.",
    { colors: ["U"], manaValue: 4 },
  ),
  guardianOfFaith: card(
    "Guardian of Faith",
    "Creature — Spirit Cleric",
    "Creatures you control can't be sacrificed.",
    { colors: ["W"], manaValue: 3 },
  ),
  sacImmunity: card(
    "Sacrosanct Ward",
    "Enchantment",
    "Players can't sacrifice a creature.",
    {},
  ),
  stitchersSupplier: card(
    "Stitcher's Supplier",
    "Creature — Zombie",
    "When Stitcher's Supplier enters the battlefield or dies, mill three cards.",
    { colors: ["B"], manaValue: 1 },
  ),
  gravedigger: card(
    "Gravedigger",
    "Creature — Zombie",
    "When Gravedigger enters the battlefield, return target creature card from your graveyard to your hand.",
    { colors: ["B"], manaValue: 4 },
  ),
  soulWarden: card(
    "Soul Warden",
    "Creature — Human Cleric",
    "Whenever another creature enters the battlefield, you gain 1 life.",
    { colors: ["W"], manaValue: 1 },
  ),
  archangelOfThune: card(
    "Archangel of Thune",
    "Creature — Angel",
    "Whenever you gain life, put a +1/+1 counter on each creature you control.",
    { colors: ["W"], manaValue: 5, keywords: ["Flying", "Lifelink"] },
  ),
  ephemerate: card(
    "Ephemerate",
    "Instant",
    "Exile target creature you control, then return it to the battlefield under its owner's control.",
    { colors: ["W"], manaValue: 1 },
  ),
  mulldrifter: card(
    "Mulldrifter",
    "Creature — Elemental",
    "When Mulldrifter enters the battlefield, draw two cards.",
    { colors: ["U"], manaValue: 5, keywords: ["Flying"] },
  ),
  wildGrowth: card(
    "Wild Growth",
    "Enchantment — Aura",
    "Enchant land. Whenever enchanted land is tapped for mana, its controller adds an additional {G}.",
    { colors: ["G"], manaValue: 1 },
  ),
  enchantressPresence: card(
    "Enchantress's Presence",
    "Enchantment",
    "Whenever you cast an enchantment spell, draw a card.",
    { colors: ["G"], manaValue: 3 },
  ),
  bonesplitter: card(
    "Bonesplitter",
    "Artifact — Equipment",
    "Equipped creature gets +2/+0. Equip {1}.",
    { manaValue: 1 },
  ),
  puresteelPaladin: card(
    "Puresteel Paladin",
    "Creature — Human Soldier",
    "Whenever an Equipment you control becomes attached to a creature, draw a card. Metalcraft — Equipment you control have equip {0} as long as you control three or more artifacts.",
    { colors: ["W"], manaValue: 2 },
  ),
  arcboundRavager: card(
    "Arcbound Ravager",
    "Artifact Creature — Beast",
    "Sacrifice an artifact: Put a +1/+1 counter on Arcbound Ravager.",
    { manaValue: 2, keywords: ["Modular"] },
  ),
  evolutionSage: card(
    "Evolution Sage",
    "Creature — Elf Druid",
    "Landfall — Whenever a land enters the battlefield under your control, proliferate.",
    { colors: ["G"], manaValue: 4 },
  ),
  isshin: card(
    "Isshin, Two Heavens as One",
    "Legendary Creature — Human Samurai",
    "Double strike. If a creature entering the battlefield or attacking causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.",
    { colors: ["R", "W", "B"], manaValue: 3, keywords: ["Double strike"] },
  ),
  goblinRabblemaster: card(
    "Goblin Rabblemaster",
    "Creature — Goblin Warrior",
    "Other Goblin creatures you control attack each combat if able. At the beginning of combat on your turn, create a 1/1 red Goblin creature token with haste. Whenever Goblin Rabblemaster attacks, create a 1/1 red Goblin creature token that's tapped and attacking.",
    { colors: ["R"], manaValue: 3 },
  ),
  anathemancer: card(
    "Anathemancer",
    "Creature — Zombie Wizard",
    "When Anathemancer enters the battlefield, it deals damage to target player equal to the number of nonbasic lands that player controls.",
    { colors: ["B", "R"], manaValue: 3, keywords: ["Unearth"] },
  ),
};
