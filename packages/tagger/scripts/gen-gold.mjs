// Generates the Stage 1 gold set: one JSON file per card in packages/tagger/gold/.
// Card oracleId + oracleText are the real Scryfall values (pulled from Mongo).
// Characteristics are derived by the SAME logic as extractCharacteristics (Task 3)
// so the deterministic chars layer stays internally consistent; the meaningful
// accuracy signal is ability precision/recall/F1. Abilities are hand-authored.
//
// Run: node packages/tagger/scripts/gen-gold.mjs   (from repo root)
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLD_DIR = join(HERE, "..", "gold");

// ---- characteristics derivation (mirrors packages/tagger/src/characteristics.ts) ----
const SEP = " — ";
const words = (s) => s.trim().split(/\s+/).filter(Boolean).map((w) => w.toLowerCase());
function chars(card) {
  const [left, right = ""] = card.typeLine.split(SEP);
  return {
    types: words(left),
    subtypes: words(right),
    colors: card.colors,
    identity: card.colorIdentity,
    cmc: card.manaValue,
    power: card.power ?? null,
    toughness: card.toughness ?? null,
    token: false,
    keywords: card.keywords.map((k) => k.toLowerCase()),
  };
}

// ---- subject / ability / event builders ----
const subj = (o) => ({ control: "you", token: false, ...o });
const ev = (verb, subject) => ({ verb, subject });
// A produced token subject (concrete): token true.
const tok = (o) => ({ control: "you", token: true, ...o });
// emits for a token maker: create-token + enters, same concrete token subject.
const tokenEmits = (t) => [ev("create-token", t), ev("enters", t)];
// emits for a "Sacrifice a creature" cost/effect: sacrifice + dies (a sacrificed
// creature dies). Sacrificing a noncreature would emit only sacrifice.
const sacEmits = (control = "you") => [
  ev("sacrifice", { type: "creature", control, token: null }),
  ev("dies", { type: "creature", control, token: null }),
];
// a counter-added event carrying the counter kind (+1/+1 etc.) on the recipient.
const counterAdded = (kind, subject = { type: "creature", control: "you", token: null }) =>
  ev("counter-added", { ...subject, counter: kind });

// ---- the gold cards ----
// Each: [oracleId, name, typeLine, colors, colorIdentity, power, toughness, cmc, keywords, oracleText, abilities]
const CARDS = [
  // ============ Wizards / Inalla ============
  {
    oracleId: "21bdba6e-3f9d-4ead-8212-0cbb0ce7f8cc",
    name: "Inalla, Archmage Ritualist",
    typeLine: "Legendary Creature — Human Wizard",
    colors: ["B", "R", "U"], colorIdentity: ["U", "B", "R"], power: "4", toughness: "5", manaValue: 5, keywords: [],
    oracleText:
      "Eminence — Whenever another nontoken Wizard you control enters, if Inalla is in the command zone or on the battlefield, you may pay {1}. If you do, create a token that's a copy of that Wizard. The token gains haste. Exile it at the beginning of the next end step.\nTap five untapped Wizards you control: Target player loses 7 life.",
    abilities: [
      {
        kind: "triggered",
        trigger: { verbs: ["enters"], subject: subj({ subtype: "wizard", token: false }) },
        effect: { kind: "token-generation", subject: tok({ subtype: "wizard" }) },
        emits: tokenEmits(tok({ subtype: "wizard" })),
      },
      {
        kind: "activated",
        cost: "Tap five untapped Wizards you control",
        effect: { kind: "player-life-loss", subject: subj({ control: "opp", token: null }) },
      },
    ],
  },
  {
    oracleId: "f1ecb3d7-5ea0-45b2-b1b0-d7ae304db2a1",
    name: "Archmage of Echoes",
    typeLine: "Creature — Faerie Wizard",
    colors: ["U"], colorIdentity: ["U"], power: "3", toughness: "3", manaValue: 5, keywords: ["Flying", "Ward"],
    oracleText:
      "Flying, ward {2}\nWhenever you cast a Faerie or Wizard permanent spell, copy it. (The copy becomes a token.)",
    abilities: [
      {
        kind: "triggered",
        trigger: { verbs: ["cast"], subject: subj({ subtype: "wizard", token: false }) },
        effect: { kind: "copy-spell", subject: tok({ subtype: "wizard" }) },
        emits: tokenEmits(tok({ subtype: "wizard" })),
      },
    ],
  },
  {
    oracleId: "005ee549-1bf5-478f-bc3f-3e791bd7eecf",
    name: "Kindred Discovery",
    typeLine: "Enchantment",
    colors: ["U"], colorIdentity: ["U"], power: null, toughness: null, manaValue: 5, keywords: [],
    oracleText:
      "As this enchantment enters, choose a creature type.\nWhenever a creature you control of the chosen type enters or attacks, draw a card.",
    abilities: [
      {
        kind: "triggered",
        trigger: { verbs: ["enters", "attacks"], subject: subj({ type: "creature", token: null, chosenType: true }) },
        effect: { kind: "draw-card" },
      },
    ],
  },
  {
    oracleId: "cffb9b7f-d52c-43e0-a4a6-b06dea83eb53",
    name: "Naban, Dean of Iteration",
    typeLine: "Legendary Creature — Human Wizard",
    colors: ["U"], colorIdentity: ["U"], power: "2", toughness: "1", manaValue: 2, keywords: [],
    oracleText:
      "If a Wizard you control entering causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.",
    abilities: [
      { kind: "static", effect: { kind: "trigger-doubling", subject: subj({ subtype: "wizard", token: null }) } },
    ],
  },
  {
    oracleId: "850eb3c3-029b-49b0-91a9-6daeb1b3a9e8",
    name: "Adeliz, the Cinder Wind",
    typeLine: "Legendary Creature — Human Wizard",
    colors: ["R", "U"], colorIdentity: ["U", "R"], power: "2", toughness: "2", manaValue: 3, keywords: ["Flying", "Haste"],
    oracleText: "Flying, haste\nWhenever you cast an instant or sorcery spell, Wizards you control get +1/+1 until end of turn.",
    abilities: [
      {
        kind: "triggered",
        trigger: { verbs: ["cast"], subject: subj({ token: false }) },
        effect: { kind: "pump-tribe", subject: subj({ subtype: "wizard", token: null }) },
      },
    ],
  },
  {
    oracleId: "9242cd3e-1a71-4700-8182-9c1005616033",
    name: "Impact Tremors",
    typeLine: "Enchantment",
    colors: ["R"], colorIdentity: ["R"], power: null, toughness: null, manaValue: 2, keywords: [],
    oracleText: "Whenever a creature you control enters, this enchantment deals 1 damage to each opponent.",
    abilities: [
      {
        kind: "triggered",
        trigger: { verbs: ["enters"], subject: subj({ type: "creature", token: null }) },
        effect: { kind: "player-damage", subject: subj({ control: "opp", token: null }) },
      },
    ],
  },
  {
    oracleId: "4fdbbec2-e921-4b63-958d-f9ba1e417197",
    name: "Purphoros, God of the Forge",
    typeLine: "Legendary Enchantment Creature — God",
    colors: ["R"], colorIdentity: ["R"], power: "7", toughness: "6", manaValue: 4, keywords: ["Indestructible"],
    oracleText:
      "Indestructible\nAs long as your devotion to red is less than five, Purphoros isn't a creature.\nWhenever another creature you control enters, Purphoros deals 2 damage to each opponent.\n{2}{R}: Creatures you control get +1/+0 until end of turn.",
    abilities: [
      {
        kind: "triggered",
        trigger: { verbs: ["enters"], subject: subj({ type: "creature", token: null }) },
        effect: { kind: "player-damage", subject: subj({ control: "opp", token: null }) },
      },
      { kind: "activated", cost: "{2}{R}", effect: { kind: "pump-tribe", subject: subj({ type: "creature", token: null }) } },
    ],
  },
  // ============ Burn / Chandra ============
  {
    oracleId: "f8e17f4f-080d-4bba-bd05-ca27e94ccecc",
    name: "Terror of the Peaks",
    typeLine: "Creature — Dragon",
    colors: ["R"], colorIdentity: ["R"], power: "5", toughness: "4", manaValue: 5, keywords: ["Flying"],
    oracleText:
      "Flying\nSpells your opponents cast that target this creature cost an additional 3 life to cast.\nWhenever another creature you control enters, this creature deals damage equal to that creature's power to any target.",
    abilities: [
      {
        kind: "triggered",
        trigger: { verbs: ["enters"], subject: subj({ type: "creature", token: null }) },
        effect: { kind: "noncombat-damage", subject: subj({ control: "any", token: null }) },
      },
      { kind: "static", effect: { kind: "tax", subject: subj({ control: "opp", token: null }) } },
    ],
  },
  {
    oracleId: "52159875-354c-47f9-bb1c-cd65395fcc68",
    name: "Fiery Emancipation",
    typeLine: "Enchantment",
    colors: ["R"], colorIdentity: ["R"], power: null, toughness: null, manaValue: 6, keywords: [],
    oracleText:
      "If a source you control would deal damage to a permanent or player, it deals triple that damage to that permanent or player instead.",
    abilities: [{ kind: "static", effect: { kind: "damage-multiplier" } }],
  },
  {
    oracleId: "c6bdaf76-6a03-4695-9c4b-f040e73435af",
    name: "Guttersnipe",
    typeLine: "Creature — Goblin Shaman",
    colors: ["R"], colorIdentity: ["R"], power: "2", toughness: "2", manaValue: 3, keywords: [],
    oracleText: "Whenever you cast an instant or sorcery spell, this creature deals 2 damage to each opponent.",
    abilities: [
      {
        kind: "triggered",
        trigger: { verbs: ["cast"], subject: subj({ token: false }) },
        effect: { kind: "player-damage", subject: subj({ control: "opp", token: null }) },
      },
    ],
  },
  // ============ Aristocrats / Gisa ============
  {
    oracleId: "6f4ac4a4-53ec-4bc9-8f5c-d4b801d867b2",
    name: "Grave Pact",
    typeLine: "Enchantment",
    colors: ["B"], colorIdentity: ["B"], power: null, toughness: null, manaValue: 4, keywords: [],
    oracleText: "Whenever a creature you control dies, each other player sacrifices a creature of their choice.",
    abilities: [
      {
        kind: "triggered",
        trigger: { verbs: ["dies"], subject: subj({ type: "creature", token: null }) },
        effect: { kind: "forced-sacrifice", subject: subj({ control: "opp", token: null }) },
        emits: sacEmits("opp"),
      },
    ],
  },
  {
    oracleId: "76b003e0-15af-4f22-bdf2-1ade5430964a",
    name: "Zulaport Cutthroat",
    typeLine: "Creature — Human Rogue Ally",
    colors: ["B"], colorIdentity: ["B"], power: "1", toughness: "1", manaValue: 2, keywords: [],
    oracleText: "Whenever this creature or another creature you control dies, each opponent loses 1 life and you gain 1 life.",
    abilities: [
      {
        kind: "triggered",
        trigger: { verbs: ["dies"], subject: subj({ type: "creature", token: null }) },
        effect: { kind: "drain", subject: subj({ control: "opp", token: null }) },
      },
    ],
  },
  {
    oracleId: "09ff28b1-b6c9-48e6-b12e-2f0e644f709f",
    name: "Gravecrawler",
    typeLine: "Creature — Zombie",
    colors: ["B"], colorIdentity: ["B"], power: "2", toughness: "1", manaValue: 1, keywords: [],
    oracleText: "This creature can't block.\nYou may cast this card from your graveyard as long as you control a Zombie.",
    abilities: [
      { kind: "static", effect: { kind: "graveyard-recursion", subject: subj({ subtype: "zombie", token: null }) } },
    ],
  },
  {
    oracleId: "fd62ad01-601f-4250-bc2a-8ef3982e45c4",
    name: "Diregraf Colossus",
    typeLine: "Creature — Zombie Giant",
    colors: ["B"], colorIdentity: ["B"], power: "0", toughness: "0", manaValue: 3, keywords: [],
    oracleText:
      "This creature enters with a +1/+1 counter on it for each Zombie card in your graveyard.\nWhenever you cast a Zombie spell, create a tapped 2/2 black Zombie creature token.",
    abilities: [
      {
        // ETB scales with Zombie cards in the graveyard (cards = nontoken); also puts +1/+1
        // counters on itself. Cares about a graveyard-fill payoff; feeds counter payoffs.
        kind: "static",
        effect: {
          kind: "enters-with-counters",
          subject: { subtype: "zombie", zone: "graveyard", control: "you", token: false },
        },
        emits: [counterAdded("+1/+1")],
      },
      {
        kind: "triggered",
        trigger: { verbs: ["cast"], subject: subj({ subtype: "zombie", token: false }) },
        effect: { kind: "token-generation", subject: tok({ subtype: "zombie" }) },
        emits: tokenEmits(tok({ subtype: "zombie" })),
      },
    ],
  },
  {
    oracleId: "e8c7566d-7cc0-48af-a986-83223ec7e06c",
    name: "Midnight Reaper",
    typeLine: "Creature — Zombie Knight",
    colors: ["B"], colorIdentity: ["B"], power: "3", toughness: "2", manaValue: 3, keywords: [],
    oracleText: "Whenever a nontoken creature you control dies, this creature deals 1 damage to you and you draw a card.",
    abilities: [
      {
        kind: "triggered",
        trigger: { verbs: ["dies"], subject: subj({ type: "creature", token: false }) },
        effect: { kind: "draw-card" },
      },
    ],
  },
  {
    oracleId: "f82a4e85-526d-4456-b700-7760043a31be",
    name: "Viscera Seer",
    typeLine: "Creature — Vampire Wizard",
    colors: ["B"], colorIdentity: ["B"], power: "1", toughness: "1", manaValue: 1, keywords: [],
    oracleText: "Sacrifice a creature: Scry 1. (Look at the top card of your library. You may put that card on the bottom.)",
    abilities: [{ kind: "activated", cost: "Sacrifice a creature", effect: { kind: "scry" }, emits: sacEmits() }],
  },
  {
    oracleId: "a1cc5e37-b09a-4b7f-afd5-77c1c35aa425",
    name: "Carrion Feeder",
    typeLine: "Creature — Zombie",
    colors: ["B"], colorIdentity: ["B"], power: "1", toughness: "1", manaValue: 1, keywords: [],
    oracleText: "This creature can't block.\nSacrifice a creature: Put a +1/+1 counter on this creature.",
    abilities: [
      {
        kind: "activated",
        cost: "Sacrifice a creature",
        effect: { kind: "counter-placement", subject: subj({ type: "creature", counter: "+1/+1" }) },
        emits: [...sacEmits(), counterAdded("+1/+1")],
      },
    ],
  },
  // ============ Clone / tokens / Gogo ============
  {
    oracleId: "68418069-f615-40ef-ae0d-764192acae00",
    name: "Krenko, Mob Boss",
    typeLine: "Legendary Creature — Goblin Warrior",
    colors: ["R"], colorIdentity: ["R"], power: "3", toughness: "3", manaValue: 4, keywords: [],
    oracleText: "{T}: Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control.",
    abilities: [
      {
        kind: "activated",
        cost: "{T}",
        effect: { kind: "token-generation", subject: tok({ subtype: "goblin" }) },
        emits: tokenEmits(tok({ subtype: "goblin" })),
      },
    ],
  },
  {
    oracleId: "8dcb35e5-ae44-455f-86e3-4a77d496ff34",
    name: "Spark Double",
    typeLine: "Creature — Illusion",
    colors: ["U"], colorIdentity: ["U"], power: "0", toughness: "0", manaValue: 4, keywords: [],
    oracleText:
      "You may have this creature enter as a copy of a creature or planeswalker you control, except it enters with an additional +1/+1 counter on it if it's a creature, it enters with an additional loyalty counter on it if it's a planeswalker, and it isn't legendary.",
    abilities: [{ kind: "static", effect: { kind: "clone", subject: subj({ token: null }) } }],
  },
  // ============ Hidetsugu / combo-value ============
  {
    oracleId: "18591d9e-c9f5-4ae8-aee1-8580bc8fa600",
    name: "Hidetsugu and Kairi",
    typeLine: "Legendary Creature — Ogre Demon Dragon",
    colors: ["B", "U"], colorIdentity: ["U", "B"], power: "5", toughness: "5", manaValue: 5, keywords: ["Flying"],
    oracleText:
      "Flying\nWhen Hidetsugu and Kairi enters, draw three cards, then put two cards from your hand on top of your library in any order.\nWhen Hidetsugu and Kairi dies, exile the top card of your library. Target opponent loses life equal to its mana value. If it's an instant or sorcery card, you may cast it without paying its mana cost.",
    abilities: [
      {
        kind: "triggered",
        trigger: { verbs: ["enters"], subject: subj({ token: false }) },
        effect: { kind: "draw-card" },
      },
      {
        kind: "triggered",
        trigger: { verbs: ["dies"], subject: subj({ token: false }) },
        effect: { kind: "player-life-loss", subject: subj({ control: "opp", token: null }) },
      },
    ],
  },
  {
    oracleId: "180e1a7e-890d-477c-80a5-da8a5f2857b3",
    name: "Reckless Fireweaver",
    typeLine: "Creature — Human Artificer",
    colors: ["R"], colorIdentity: ["R"], power: "1", toughness: "3", manaValue: 2, keywords: [],
    oracleText: "Whenever an artifact you control enters, this creature deals 1 damage to each opponent.",
    abilities: [
      {
        kind: "triggered",
        trigger: { verbs: ["enters"], subject: subj({ type: "artifact", token: null }) },
        effect: { kind: "player-damage", subject: subj({ control: "opp", token: null }) },
      },
    ],
  },
  {
    oracleId: "697bcfe1-ecbf-42a1-bfc7-0766d48ca56b",
    name: "Dockside Extortionist",
    typeLine: "Creature — Goblin Pirate",
    colors: ["R"], colorIdentity: ["R"], power: "1", toughness: "2", manaValue: 2, keywords: [],
    oracleText:
      "When this creature enters, create X Treasure tokens, where X is the number of artifacts and enchantments your opponents control. (Treasure tokens are artifacts with \"{T}, Sacrifice this token: Add one mana of any color.\")",
    abilities: [
      {
        kind: "triggered",
        trigger: { verbs: ["enters"], subject: subj({ token: false }) },
        effect: { kind: "token-generation", subject: tok({ type: "artifact" }) },
        emits: tokenEmits(tok({ type: "artifact" })),
      },
    ],
  },
  // ============ Landfall / Samut ============
  {
    oracleId: "ee89c719-5ae8-4316-bfd0-cfe3684b5859",
    name: "Samut, the Driving Force",
    typeLine: "Legendary Creature — Human Warrior Cleric",
    colors: ["G", "R", "W"], colorIdentity: ["R", "G", "W"], power: "5", toughness: "5", manaValue: 6,
    keywords: ["First strike", "Vigilance", "Haste"],
    oracleText:
      "First strike, vigilance, haste\nStart your engines! (If you have no speed, it starts at 1. It increases once on each of your turns when an opponent loses life. Max speed is 4.)\nOther creatures you control get +X/+0, where X is your speed.\nNoncreature spells you cast cost {X} less to cast, where X is your speed.",
    abilities: [
      { kind: "static", effect: { kind: "pump-tribe", subject: subj({ type: "creature", token: null }) } },
      { kind: "static", effect: { kind: "cost-reduction", subject: subj({ token: false }) } },
    ],
  },
  {
    oracleId: "2d3e6549-6cc6-434f-a189-ba3b55e64c34",
    name: "Rampaging Baloths",
    typeLine: "Creature — Beast",
    colors: ["G"], colorIdentity: ["G"], power: "7", toughness: "7", manaValue: 6, keywords: ["Trample"],
    oracleText: "Trample\nLandfall — Whenever a land you control enters, create a 4/4 green Beast creature token.",
    abilities: [
      {
        kind: "triggered",
        trigger: { verbs: ["land-play"], subject: subj({ type: "land", token: null }) },
        effect: { kind: "token-generation", subject: tok({ subtype: "beast" }) },
        emits: tokenEmits(tok({ subtype: "beast" })),
      },
    ],
  },
  {
    oracleId: "aa854d50-444c-49d9-bfb1-5476b33c1c0b",
    name: "Scute Swarm",
    typeLine: "Creature — Insect",
    colors: ["G"], colorIdentity: ["G"], power: "1", toughness: "1", manaValue: 3, keywords: [],
    oracleText:
      "Landfall — Whenever a land you control enters, create a 1/1 green Insect creature token. If you control six or more lands, create a token that's a copy of this creature instead.",
    abilities: [
      {
        kind: "triggered",
        trigger: { verbs: ["land-play"], subject: subj({ type: "land", token: null }) },
        effect: { kind: "token-generation", subject: tok({ subtype: "insect" }) },
        emits: tokenEmits(tok({ subtype: "insect" })),
      },
    ],
  },
  {
    oracleId: "16629f59-bae8-4c19-bf50-443eb0ed6856",
    name: "Felidar Retreat",
    typeLine: "Enchantment",
    colors: ["W"], colorIdentity: ["W"], power: null, toughness: null, manaValue: 4, keywords: [],
    oracleText:
      "Landfall — Whenever a land you control enters, choose one —\n• Create a 2/2 white Cat Beast creature token.\n• Put a +1/+1 counter on each creature you control. Those creatures gain vigilance until end of turn.",
    abilities: [
      {
        kind: "triggered",
        trigger: { verbs: ["land-play"], subject: subj({ type: "land", token: null }) },
        effect: { kind: "token-generation", subject: tok({ subtype: "cat" }) },
        emits: tokenEmits(tok({ subtype: "cat" })),
      },
    ],
  },
  // ============ Anthems / terminals / negatives ============
  {
    oracleId: "7246d45b-2185-4cdd-981b-5419b7d52bce",
    name: "Anointed Procession",
    typeLine: "Enchantment",
    colors: ["W"], colorIdentity: ["W"], power: null, toughness: null, manaValue: 4, keywords: [],
    oracleText: "If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.",
    abilities: [{ kind: "static", effect: { kind: "token-doubling" } }],
  },
  {
    oracleId: "6ad8011d-3471-4369-9d68-b264cc027487",
    name: "Sol Ring",
    typeLine: "Artifact",
    colors: [], colorIdentity: [], power: null, toughness: null, manaValue: 1, keywords: [],
    oracleText: "{T}: Add {C}{C}.",
    abilities: [{ kind: "activated", cost: "{T}", effect: { kind: "mana-generation" } }],
  },
  {
    oracleId: "14c8f55d-d177-4c25-a931-ebeb9e6062a0",
    name: "Grizzly Bears",
    typeLine: "Creature — Bear",
    colors: ["G"], colorIdentity: ["G"], power: "2", toughness: "2", manaValue: 2, keywords: [],
    oracleText: "",
    abilities: [],
  },
  {
    oracleId: "310f141c-7f37-4729-aed6-dd9c09db448d",
    name: "Blood Artist",
    typeLine: "Creature — Vampire",
    colors: ["B"], colorIdentity: ["B"], power: "0", toughness: "1", manaValue: 2, keywords: [],
    oracleText: "Whenever this creature or another creature dies, target player loses 1 life and you gain 1 life.",
    abilities: [
      {
        kind: "triggered",
        trigger: { verbs: ["dies"], subject: subj({ type: "creature", control: "any", token: null }) },
        effect: { kind: "drain", subject: subj({ control: "opp", token: null }) },
      },
    ],
  },
  {
    oracleId: "edad60c6-80de-4033-af1b-a703ac332983",
    name: "Goblin Bombardment",
    typeLine: "Enchantment",
    colors: ["R"], colorIdentity: ["R"], power: null, toughness: null, manaValue: 2, keywords: [],
    oracleText: "Sacrifice a creature: This enchantment deals 1 damage to any target.",
    abilities: [
      {
        kind: "activated",
        cost: "Sacrifice a creature",
        effect: { kind: "noncombat-damage", subject: subj({ control: "any", token: null }) },
        emits: sacEmits(),
      },
    ],
  },
  {
    oracleId: "a784481f-eccb-4112-bb38-04a659319660",
    name: "Pitiless Plunderer",
    typeLine: "Creature — Human Pirate",
    colors: ["B"], colorIdentity: ["B"], power: "1", toughness: "4", manaValue: 4, keywords: [],
    oracleText:
      "Whenever another creature you control dies, create a Treasure token. (It's an artifact with \"{T}, Sacrifice this token: Add one mana of any color.\")",
    abilities: [
      {
        kind: "triggered",
        trigger: { verbs: ["dies"], subject: subj({ type: "creature", token: null }) },
        effect: { kind: "token-generation", subject: tok({ type: "artifact" }) },
        emits: tokenEmits(tok({ type: "artifact" })),
      },
    ],
  },
  {
    oracleId: "99024aa8-5687-4d38-8a4b-feef42d6c1ff",
    name: "Death Baron",
    typeLine: "Creature — Zombie Wizard",
    colors: ["B"], colorIdentity: ["B"], power: "2", toughness: "2", manaValue: 3, keywords: [],
    oracleText:
      "Skeletons you control and other Zombies you control get +1/+1 and have deathtouch. (Any amount of damage they deal to a creature is enough to destroy it.)",
    abilities: [
      { kind: "static", effect: { kind: "lord", subject: subj({ subtype: "zombie", token: null }) } },
    ],
  },
];

// ---- emit files ----
if (existsSync(GOLD_DIR)) {
  for (const f of readdirSync(GOLD_DIR)) if (f.endsWith(".json")) rmSync(join(GOLD_DIR, f));
} else {
  mkdirSync(GOLD_DIR, { recursive: true });
}

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
for (const c of CARDS) {
  const card = {
    name: c.name,
    typeLine: c.typeLine,
    oracleText: c.oracleText,
    keywords: c.keywords,
    colors: c.colors,
    colorIdentity: c.colorIdentity,
    power: c.power,
    toughness: c.toughness,
    manaValue: c.manaValue,
  };
  const gold = {
    oracleId: c.oracleId,
    card,
    expected: {
      oracleId: c.oracleId,
      schemaVersion: 1,
      promptVersion: 1,
      model: "gold",
      characteristics: chars(card),
      abilities: c.abilities,
    },
  };
  writeFileSync(join(GOLD_DIR, `${slug(c.name)}.json`), JSON.stringify(gold, null, 2) + "\n");
}
console.log(`wrote ${CARDS.length} gold files to ${GOLD_DIR}`);
