import { expect, test } from "vitest";
import { createProvider } from "./factory.js";
import { AnthropicProvider } from "./anthropic.js";
import { OllamaProvider } from "./ollama.js";
import { loadTaggerConfig } from "../config.js";

test("ollama config builds an OllamaProvider", () => {
  const llm = createProvider(loadTaggerConfig({}));
  expect(llm).toBeInstanceOf(OllamaProvider);
  expect(llm.model).toBe("qwen2.5:14b");
});

test("anthropic config with a key builds an AnthropicProvider", () => {
  const cfg = loadTaggerConfig({ TAGGER_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "sk-test" });
  const llm = createProvider(cfg);
  expect(llm).toBeInstanceOf(AnthropicProvider);
  expect(llm.model).toBe("claude-haiku-4-5");
});

test("anthropic config without a key throws", () => {
  const cfg = loadTaggerConfig({ TAGGER_PROVIDER: "anthropic" });
  expect(() => createProvider(cfg)).toThrow(/ANTHROPIC_API_KEY/);
});
