import { expect, test } from "vitest";
import { normalizeScryfallCard, NON_GAMEPLAY_LAYOUTS } from "./scryfall.js";

test("normalizes a standard card", () => {
  const n = normalizeScryfallCard({
    oracle_id: "abc",
    name: "Krenko, Mob Boss",
    type_line: "Legendary Creature — Goblin Warrior",
    oracle_text: "Tap: Create tokens.",
    keywords: [],
    colors: ["R"],
    cmc: 4,
  });
  expect(n).not.toBeNull();
  expect(n!.oracleId).toBe("abc");
  expect(n!.card.name).toBe("Krenko, Mob Boss");
  expect(n!.card.manaValue).toBe(4);
  expect(n!.faceNames).toEqual([]);
});

test("joins DFC faces and merges face colors when top-level fields are absent", () => {
  const n = normalizeScryfallCard({
    oracle_id: "dfc",
    name: "Front // Back",
    type_line: "Creature — Werewolf // Creature — Werewolf",
    keywords: [],
    card_faces: [
      { oracle_text: "Front text", colors: ["R"] },
      { oracle_text: "Back text", colors: ["G"] },
    ],
  });
  expect(n!.card.oracleText).toBe("Front text\n//\nBack text");
  expect(n!.card.colors.sort()).toEqual(["G", "R"]);
  expect(n!.faceNames).toEqual(["Front", "Back"]);
});

test("treats empty oracle text as valid empty string", () => {
  const n = normalizeScryfallCard({
    oracle_id: "vanilla",
    name: "Grizzly Bears",
    type_line: "Creature — Bear",
    colors: ["G"],
    cmc: 2,
  });
  expect(n!.card.oracleText).toBe("");
});

test("skips records missing required fields", () => {
  expect(normalizeScryfallCard({ name: "No id or type" })).toBeNull();
  expect(normalizeScryfallCard({ oracle_id: "x", type_line: "y" })).toBeNull();
});

test("normalize captures color identity, power, toughness", () => {
  const n = normalizeScryfallCard({
    oracle_id: "abc",
    name: "Inalla, Archmage Ritualist",
    type_line: "Legendary Creature — Human Wizard",
    oracle_text: "…",
    colors: ["U", "B", "R"],
    color_identity: ["B", "R", "U"],
    power: "4",
    toughness: "5",
    cmc: 5,
  });
  expect(n).not.toBeNull();
  expect(n!.card.colorIdentity).toEqual(["B", "R", "U"]);
  expect(n!.card.power).toBe("4");
  expect(n!.card.toughness).toBe("5");
});

test("normalize leaves power/toughness null for non-creatures", () => {
  const n = normalizeScryfallCard({
    oracle_id: "def",
    name: "Kindred Discovery",
    type_line: "Enchantment",
    oracle_text: "…",
    colors: ["U"],
    color_identity: ["U"],
    cmc: 5,
  });
  expect(n!.card.power).toBeNull();
  expect(n!.card.toughness).toBeNull();
  expect(n!.card.colorIdentity).toEqual(["U"]);
});

test("rejects every non-gameplay layout", () => {
  for (const layout of NON_GAMEPLAY_LAYOUTS) {
    const n = normalizeScryfallCard({
      oracle_id: "junk",
      name: "Jetmir, Nexus of Revels // Jetmir, Nexus of Revels",
      type_line: "Card // Card",
      layout,
    });
    expect(n, `layout ${layout} should be rejected`).toBeNull();
  }
});

test("keeps a real transform DFC (gameplay layout)", () => {
  const n = normalizeScryfallCard({
    oracle_id: "real-dfc",
    name: "Front // Back",
    type_line: "Creature — Werewolf // Creature — Werewolf",
    layout: "transform",
    card_faces: [
      { oracle_text: "Front text", colors: ["R"] },
      { oracle_text: "Back text", colors: ["G"] },
    ],
  });
  expect(n).not.toBeNull();
  expect(n!.card.oracleText).toBe("Front text\n//\nBack text");
});

test("keeps a card with no layout field (defaults to gameplay)", () => {
  const n = normalizeScryfallCard({
    oracle_id: "no-layout",
    name: "Grizzly Bears",
    type_line: "Creature — Bear",
    oracle_text: "",
  });
  expect(n).not.toBeNull();
});

test("NON_GAMEPLAY_LAYOUTS contains exactly the five reject layouts", () => {
  expect([...NON_GAMEPLAY_LAYOUTS].sort()).toEqual(
    ["art_series", "double_faced_token", "emblem", "reversible_card", "token"],
  );
});

test("normalizeScryfallCard carries edhrec_rank through as edhrecRank", () => {
  const n = normalizeScryfallCard({
    oracle_id: "o1", name: "Sol Ring", type_line: "Artifact", oracle_text: "{T}: Add {C}{C}.",
    edhrec_rank: 1,
  });
  expect(n?.edhrecRank).toBe(1);
});

test("normalizeScryfallCard leaves edhrecRank undefined when Scryfall omits it", () => {
  const n = normalizeScryfallCard({
    oracle_id: "o2", name: "Obscure Card", type_line: "Sorcery", oracle_text: "Draw a card.",
  });
  expect(n?.edhrecRank).toBeUndefined();
});

test("captures the widened gameplay fields", () => {
  const n = normalizeScryfallCard({
    oracle_id: "krenko",
    id: "printing-krenko",
    name: "Krenko, Mob Boss",
    type_line: "Legendary Creature — Goblin Warrior",
    oracle_text: "{T}: Create X 1/1 red Goblin creature tokens.",
    keywords: [],
    colors: ["R"],
    cmc: 4,
    mana_cost: "{2}{R}{R}",
    layout: "normal",
    legalities: { commander: "legal", modern: "legal" },
    released_at: "2024-11-15",
    game_changer: false,
    reserved: false,
    all_parts: [
      { id: "tok-goblin", component: "token", name: "Goblin", type_line: "Token Creature — Goblin" },
      { id: "printing-krenko", component: "combo_piece", name: "Krenko, Mob Boss", type_line: "Legendary Creature — Goblin Warrior" },
    ],
  })!;
  expect(n.manaCost).toBe("{2}{R}{R}");
  expect(n.layout).toBe("normal");
  expect(n.legalities).toEqual({ commander: "legal", modern: "legal" });
  expect(n.releasedAt).toBe("2024-11-15");
  expect(n.gameChanger).toBe(false);
  expect(n.reserved).toBe(false);
  // The self-reference Scryfall includes is dropped; the token survives.
  expect(n.allParts).toEqual([
    { component: "token", name: "Goblin", typeLine: "Token Creature — Goblin" },
  ]);
});

test("captures produced_mana only when present", () => {
  const birds = normalizeScryfallCard({
    oracle_id: "birds", name: "Birds of Paradise", type_line: "Creature — Bird",
    keywords: [], colors: ["G"], cmc: 1, produced_mana: ["B", "G", "R", "U", "W"],
  })!;
  expect(birds.producedMana).toEqual(["B", "G", "R", "U", "W"]);

  const bear = normalizeScryfallCard({
    oracle_id: "bear", name: "Grizzly Bears", type_line: "Creature — Bear",
    keywords: [], colors: ["G"], cmc: 2,
  })!;
  // Absent, NOT []. "Produces no mana" and "we don't know" must stay distinguishable.
  expect(bear.producedMana).toBeUndefined();
  expect("producedMana" in bear).toBe(false);
});

test("captures per-face data for a double-faced card", () => {
  const n = normalizeScryfallCard({
    oracle_id: "delver",
    name: "Delver of Secrets // Insectile Aberration",
    type_line: "Creature — Human Wizard // Creature — Human Insect",
    layout: "transform",
    keywords: [],
    card_faces: [
      { name: "Delver of Secrets", type_line: "Creature — Human Wizard", oracle_text: "front", mana_cost: "{U}", power: "1", toughness: "1", colors: ["U"] },
      { name: "Insectile Aberration", type_line: "Creature — Human Insect", oracle_text: "back", mana_cost: "", power: "3", toughness: "2", colors: ["U"], color_indicator: ["U"] },
    ],
  })!;
  expect(n.faces).toHaveLength(2);
  expect(n.faces![0]).toMatchObject({ name: "Delver of Secrets", typeLine: "Creature — Human Wizard", power: "1" });
  expect(n.faces![1]).toMatchObject({ name: "Insectile Aberration", typeLine: "Creature — Human Insect", power: "3", colorIndicator: ["U"] });
});

test("a bulk entry carrying none of the new fields still normalizes", () => {
  const n = normalizeScryfallCard({
    oracle_id: "plain", name: "Plain Card", type_line: "Artifact", keywords: [], colors: [], cmc: 1,
  })!;
  expect(n.oracleId).toBe("plain");
  for (const k of ["manaCost", "producedMana", "layout", "legalities", "releasedAt", "gameChanger", "reserved", "allParts", "faces", "artCrop"]) {
    expect(k in n).toBe(false);
  }
});

test("captures art_crop when present", () => {
  const n = normalizeScryfallCard({
    oracle_id: "art1", name: "Sol Ring", type_line: "Artifact", keywords: [], colors: [], cmc: 1,
    image_uris: { art_crop: "https://cards.scryfall.io/art_crop/sol-ring.jpg" },
  })!;
  expect(n.artCrop).toBe("https://cards.scryfall.io/art_crop/sol-ring.jpg");
});

test("leaves artCrop absent when Scryfall omits image_uris", () => {
  const n = normalizeScryfallCard({
    oracle_id: "no-art", name: "Grizzly Bears", type_line: "Creature — Bear", keywords: [], colors: ["G"], cmc: 2,
  })!;
  expect(n.artCrop).toBeUndefined();
  expect("artCrop" in n).toBe(false);
});

test("captures per-face art_crop for a double-faced card", () => {
  const n = normalizeScryfallCard({
    oracle_id: "delver-art",
    name: "Delver of Secrets // Insectile Aberration",
    type_line: "Creature — Human Wizard // Creature — Human Insect",
    layout: "transform",
    keywords: [],
    card_faces: [
      { name: "Delver of Secrets", type_line: "Creature — Human Wizard", oracle_text: "front", colors: ["U"], image_uris: { art_crop: "https://cards.scryfall.io/art_crop/delver.jpg" } },
      { name: "Insectile Aberration", type_line: "Creature — Human Insect", oracle_text: "back", colors: ["U"], image_uris: { art_crop: "https://cards.scryfall.io/art_crop/aberration.jpg" } },
    ],
  })!;
  expect(n.faces![0].artCrop).toBe("https://cards.scryfall.io/art_crop/delver.jpg");
  expect(n.faces![1].artCrop).toBe("https://cards.scryfall.io/art_crop/aberration.jpg");
});
