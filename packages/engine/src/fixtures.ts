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
};
