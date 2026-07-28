import { expect, test } from "vitest";
import { buildAbilityMessages, PROMPT_VERSION } from "./prompt.js";

const card = {
  name: "Impact Tremors",
  typeLine: "Enchantment",
  oracleText: "Whenever a creature enters the battlefield under your control, Impact Tremors deals 1 damage to each opponent.",
  keywords: [],
  colors: ["R"],
  manaValue: 2,
};

/** Flatten the message turns into one string for content assertions. */
function flat(): string {
  return buildAbilityMessages(card)
    .map((m) => `${m.role}:${m.content}`)
    .join("\n");
}

test("prompt version is 23", () => {
  expect(PROMPT_VERSION).toBe(23);
});

test("messages teach the flicker/untap/animate vocab with a few-shot each", () => {
  const p = flat();
  expect(p).toContain("flicker");
  expect(p).toContain("untap");
  expect(p).toContain("animate");
  expect(p).toContain("Restoration Angel"); // flicker few-shot anchor
});

test("first message is the system instruction, last is the card under test", () => {
  const msgs = buildAbilityMessages(card);
  expect(msgs[0].role).toBe("system");
  expect(msgs.at(-1)?.role).toBe("user");
  expect(msgs.at(-1)?.content).toContain(card.oracleText);
});

test("messages include the closed verb list and the abilities key", () => {
  const p = flat();
  expect(p).toContain("create-token");
  expect(p).toContain("enters");
  expect(p).toContain('"abilities"');
});

test("messages include the emits invariant and a few-shot example", () => {
  const p = flat();
  expect(p.toLowerCase()).toContain("cast");
  expect(p).toContain("Inalla"); // few-shot anchor
});

test("messages include the closed effect.kind label set", () => {
  expect(flat()).toContain("player-life-loss");
});

test("PROMPT_VERSION is 23", () => {
  expect(PROMPT_VERSION).toBe(23);
});

test("instructions teach the stats predicate", () => {
  const text = buildAbilityMessages({ name: "X", typeLine: "Creature", oracleText: "" } as never)
    .map((m) => m.content).join("\n");
  expect(text.toLowerCase()).toContain("stats");
  expect(text).toContain("power"); // predicate metric mentioned
});
