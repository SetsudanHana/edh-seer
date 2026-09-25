import { expect, test } from "vitest";
import { loadTaggerConfig, MEASURED_MODEL } from "./config.js";

test("defaults to the measured model and reads the key", () => {
  const cfg = loadTaggerConfig({ ANTHROPIC_API_KEY: "sk-test" });
  expect(cfg.model).toBe(MEASURED_MODEL);
  expect(cfg.model).toBe("claude-haiku-4-5");
  expect(cfg.anthropicApiKey).toBe("sk-test");
  expect(cfg.anthropicBaseUrl).toBe("https://api.anthropic.com");
});

test("model + max tokens overridable by env", () => {
  const cfg = loadTaggerConfig({ ANTHROPIC_MODEL: "claude-sonnet-5", ANTHROPIC_MAX_TOKENS: "800" });
  expect(cfg.model).toBe("claude-sonnet-5");
  expect(cfg.maxTokens).toBe(800);
});

test("TAGGER_CONCURRENCY sets concurrency; invalid clamps to default", () => {
  expect(loadTaggerConfig({ TAGGER_CONCURRENCY: "10" }).concurrency).toBe(10);
  expect(loadTaggerConfig({ TAGGER_CONCURRENCY: "0" }).concurrency).toBe(4);
  expect(loadTaggerConfig({ TAGGER_CONCURRENCY: "nope" }).concurrency).toBe(4);
});
