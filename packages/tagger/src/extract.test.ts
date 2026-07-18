import { expect, test, vi } from "vitest";
import { extractCardTags } from "./extract.js";
import type { LlmProvider } from "./llm/provider.js";

const card = {
  name: "Impact Tremors",
  typeLine: "Enchantment",
  oracleText: "Whenever a creature enters the battlefield under your control, Impact Tremors deals 1 damage to each opponent.",
  keywords: [],
  colors: ["R"],
  colorIdentity: ["R"],
  power: null,
  toughness: null,
  manaValue: 2,
};

function provider(responses: string[]): LlmProvider {
  const complete = vi.fn();
  responses.forEach((r) => complete.mockResolvedValueOnce(r));
  return { model: "test-model", complete };
}

test("assembles characteristics + abilities + provenance", async () => {
  const llm = provider([
    JSON.stringify({
      abilities: [
        {
          kind: "triggered",
          trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } },
          effect: { kind: "player-damage", subject: { control: "opp", token: null } },
        },
      ],
    }),
  ]);
  const tags = await extractCardTags("oid-1", card, llm);
  expect(tags.oracleId).toBe("oid-1");
  expect(tags.model).toBe("test-model");
  expect(tags.schemaVersion).toBe(1);
  expect(tags.promptVersion).toBe(10);
  expect(tags.characteristics.types).toEqual(["enchantment"]);
  expect(tags.abilities).toHaveLength(1);
});

test("retries once on invalid JSON then succeeds", async () => {
  const llm = provider(["garbage", '{"abilities":[]}']);
  const tags = await extractCardTags("oid-2", card, llm);
  expect(tags.abilities).toEqual([]);
  expect((llm.complete as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
});

test("throws if still invalid after retry", async () => {
  const llm = provider(["garbage", "still bad"]);
  await expect(extractCardTags("oid-3", card, llm)).rejects.toThrow();
});
