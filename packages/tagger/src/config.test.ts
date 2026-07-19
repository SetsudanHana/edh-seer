import { expect, test } from "vitest";
import { loadTaggerConfig } from "./config.js";

test("defaults to the ollama provider with qwen model, json format on, think off", () => {
  const cfg = loadTaggerConfig({});
  expect(cfg.provider).toBe("ollama");
  expect(cfg.model).toBe("qwen2.5:14b");
  expect(cfg.ollamaHost).toBe("http://localhost:11434");
  expect(cfg.concurrency).toBe(4);
  expect(cfg.ollamaJsonFormat).toBe(true);
  expect(cfg.ollamaThink).toBe(false);
});

test("OLLAMA_FORMAT_JSON=false and OLLAMA_THINK=true flip the reasoning-model flags", () => {
  const cfg = loadTaggerConfig({ OLLAMA_FORMAT_JSON: "false", OLLAMA_THINK: "true" });
  expect(cfg.ollamaJsonFormat).toBe(false);
  expect(cfg.ollamaThink).toBe(true);
});

test("OLLAMA_PRESET=qwen3.5 sets the thinking precise-coding bundle", () => {
  const cfg = loadTaggerConfig({ OLLAMA_PRESET: "qwen3.5" });
  expect(cfg.ollamaThink).toBe(true);
  expect(cfg.ollamaJsonFormat).toBe(false);
  expect(cfg.ollamaTemperature).toBe(0.6);
  expect(cfg.ollamaTopP).toBe(0.95);
  expect(cfg.ollamaTopK).toBe(20);
  expect(cfg.ollamaMinP).toBe(0);
  expect(cfg.ollamaRepeatPenalty).toBe(1.05);
  expect(cfg.ollamaNumCtx).toBe(8192);
  expect(cfg.ollamaPreset).toBe("qwen3.5");
});

test("OLLAMA_PRESET=qwen2.5 sets non-thinking json bundle", () => {
  const cfg = loadTaggerConfig({ OLLAMA_PRESET: "qwen2.5" });
  expect(cfg.ollamaThink).toBe(false);
  expect(cfg.ollamaJsonFormat).toBe(true);
  expect(cfg.ollamaTemperature).toBe(0.7);
  expect(cfg.ollamaTopP).toBe(0.8);
});

test("an explicit env var overrides a preset field", () => {
  const cfg = loadTaggerConfig({ OLLAMA_PRESET: "qwen3.5", OLLAMA_TEMPERATURE: "0.2", OLLAMA_THINK: "false" });
  expect(cfg.ollamaTemperature).toBe(0.2); // env wins over preset 0.6
  expect(cfg.ollamaThink).toBe(false); // env wins over preset true
  expect(cfg.ollamaTopP).toBe(0.95); // preset field left intact
});

test("sampling/context options are read as numbers, or left undefined when absent/invalid", () => {
  const cfg = loadTaggerConfig({ OLLAMA_NUM_CTX: "8192", OLLAMA_TEMPERATURE: "0.6", OLLAMA_TOP_P: "0.95" });
  expect(cfg.ollamaNumCtx).toBe(8192);
  expect(cfg.ollamaTemperature).toBe(0.6);
  expect(cfg.ollamaTopP).toBe(0.95);

  const bare = loadTaggerConfig({ OLLAMA_TEMPERATURE: "nope" });
  expect(bare.ollamaNumCtx).toBeUndefined();
  expect(bare.ollamaTemperature).toBeUndefined();
});

test("ollama model/host/concurrency overridable by env", () => {
  const cfg = loadTaggerConfig({ OLLAMA_MODEL: "llama3.1:8b", OLLAMA_HOST: "http://x:1", OLLAMA_CONCURRENCY: "8" });
  expect(cfg.model).toBe("llama3.1:8b");
  expect(cfg.ollamaHost).toBe("http://x:1");
  expect(cfg.concurrency).toBe(8);
});

test("TAGGER_PROVIDER=anthropic selects the anthropic default model and reads the key", () => {
  const cfg = loadTaggerConfig({ TAGGER_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "sk-test" });
  expect(cfg.provider).toBe("anthropic");
  expect(cfg.model).toBe("claude-haiku-4-5");
  expect(cfg.anthropicApiKey).toBe("sk-test");
});

test("anthropic model + max tokens overridable by env", () => {
  const cfg = loadTaggerConfig({ TAGGER_PROVIDER: "anthropic", ANTHROPIC_MODEL: "claude-sonnet-5", ANTHROPIC_MAX_TOKENS: "800" });
  expect(cfg.model).toBe("claude-sonnet-5");
  expect(cfg.maxTokens).toBe(800);
});

test("TAGGER_CONCURRENCY overrides OLLAMA_CONCURRENCY; invalid clamps to default", () => {
  expect(loadTaggerConfig({ TAGGER_CONCURRENCY: "10", OLLAMA_CONCURRENCY: "2" }).concurrency).toBe(10);
  expect(loadTaggerConfig({ TAGGER_CONCURRENCY: "0" }).concurrency).toBe(4);
  expect(loadTaggerConfig({ OLLAMA_CONCURRENCY: "nope" }).concurrency).toBe(4);
});
