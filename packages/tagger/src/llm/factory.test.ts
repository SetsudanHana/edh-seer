import { expect, test } from "vitest";
import { createProvider } from "./factory.js";
import { AnthropicProvider } from "./anthropic.js";
import { loadTaggerConfig } from "../config.js";

test("a config with a key builds an AnthropicProvider", () => {
  const llm = createProvider(loadTaggerConfig({ ANTHROPIC_API_KEY: "sk-test" }));
  expect(llm).toBeInstanceOf(AnthropicProvider);
  expect(llm.model).toBe("claude-haiku-4-5");
});

test("a config without a key throws", () => {
  expect(() => createProvider(loadTaggerConfig({}))).toThrow(/ANTHROPIC_API_KEY/);
});
