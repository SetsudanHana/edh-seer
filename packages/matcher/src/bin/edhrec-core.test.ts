import { expect, test } from "vitest";
import {
  CATEGORY_EDHREC_TAG,
  parseHighSynergy,
  pairsFromCards,
  tagUrl,
} from "./edhrec-core.js";
import { MECHANISM_CATEGORIES } from "../mechanisms.js";

/** Minimal shape of an EDHREC tag payload (only what parseHighSynergy reads). */
const payload = {
  container: {
    json_dict: {
      cardlists: [
        { header: "Top Cards", cardviews: [{ name: "X", slug: "x", synergy: 0.9 }] },
        {
          header: "High Synergy Cards",
          cardviews: [
            { name: "Blood Artist", slug: "blood-artist", synergy: 0.41 },
            { name: "Viscera Seer", slug: "viscera-seer", synergy: 0.38 },
            { name: "Ashnod's Altar", slug: "ashnods-altar", synergy: 0.38 },
          ],
        },
      ],
    },
  },
};

test("parseHighSynergy pulls only the High Synergy Cards cardviews", () => {
  const cards = parseHighSynergy(payload);
  expect(cards.map((c) => c.name)).toEqual(["Blood Artist", "Viscera Seer", "Ashnod's Altar"]);
  expect(cards[0].synergy).toBeCloseTo(0.41);
});

test("parseHighSynergy returns [] when the list is missing", () => {
  expect(parseHighSynergy({})).toEqual([]);
});

test("pairsFromCards makes all unordered combinations of the top-K cards", () => {
  const cards = parseHighSynergy(payload);
  const pairs = pairsFromCards(cards, 3, "aristocrats");
  expect(pairs).toHaveLength(3); // C(3,2)
  expect(pairs[0]).toMatchObject({ a: "Blood Artist", b: "Viscera Seer" });
  expect(pairs[0].note).toContain("aristocrats");
});

test("pairsFromCards respects topK smaller than the list", () => {
  const cards = parseHighSynergy(payload);
  expect(pairsFromCards(cards, 2, "t")).toHaveLength(1); // C(2,2)
});

test("every mechanism category has an EDHREC tag slug", () => {
  for (const c of MECHANISM_CATEGORIES) {
    expect(CATEGORY_EDHREC_TAG[c]).toBeTruthy();
  }
});

test("tagUrl builds the confirmed EDHREC endpoint", () => {
  expect(tagUrl("aristocrats")).toBe("https://json.edhrec.com/pages/tags/aristocrats.json");
});
