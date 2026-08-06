import { expect, test } from "vitest";
import { buildMeld } from "./ingest-meld-core.js";

const mishra = {
  name: "Mishra, Claimed by Gix",
  all_parts: [
    { component: "meld_part", name: "Phyrexian Dragon Engine" },
    { component: "meld_part", name: "Mishra, Claimed by Gix" },
    { component: "meld_result", name: "Mishra, Lost to Phyrexia" },
  ],
};

test("each part points at the OTHER part, never at itself", () => {
  const m = buildMeld([mishra]);
  expect(m.get("Mishra, Claimed by Gix")?.meldPartner).toBe("Phyrexian Dragon Engine");
  expect(m.get("Phyrexian Dragon Engine")?.meldPartner).toBe("Mishra, Claimed by Gix");
});

test("both parts carry what they become", () => {
  const m = buildMeld([mishra]);
  expect(m.get("Mishra, Claimed by Gix")?.meldResult).toBe("Mishra, Lost to Phyrexia");
  expect(m.get("Phyrexian Dragon Engine")?.meldResult).toBe("Mishra, Lost to Phyrexia");
});

// Navigable from either end: the result names its parts, so a deck holding the melded card can be
// asked what produced it.
test("the result carries its parts and no partner", () => {
  const f = buildMeld([mishra]).get("Mishra, Lost to Phyrexia")!;
  expect(f.meldParts).toEqual(["Mishra, Claimed by Gix", "Phyrexian Dragon Engine"]);
  expect(f.meldPartner).toBeUndefined();
});

// Scryfall returns one entry per meld card, so the same relation arrives two or three times. It must
// not accumulate or contradict itself.
test("seeing the same meld set from every member is idempotent", () => {
  const once = buildMeld([mishra]);
  const thrice = buildMeld([mishra, { ...mishra, name: "Phyrexian Dragon Engine" }, { ...mishra, name: "Mishra, Lost to Phyrexia" }]);
  expect(thrice).toEqual(once);
});

test("a card with no meld_result is skipped rather than half-written", () => {
  expect(buildMeld([{ name: "X", all_parts: [{ component: "token", name: "Treasure" }] }]).size).toBe(0);
  expect(buildMeld([{ name: "X" }]).size).toBe(0);
});
