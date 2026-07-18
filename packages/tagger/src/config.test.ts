import { expect, test } from "vitest";
import { loadTaggerConfig } from "./config.js";

test("defaults model, host, concurrency; overridable by env", () => {
  expect(loadTaggerConfig({})).toEqual({
    model: "qwen2.5:14b",
    ollamaHost: "http://localhost:11434",
    concurrency: 4,
  });
  expect(loadTaggerConfig({ OLLAMA_MODEL: "llama3.1:8b", OLLAMA_HOST: "http://x:1", OLLAMA_CONCURRENCY: "8" })).toEqual({
    model: "llama3.1:8b",
    ollamaHost: "http://x:1",
    concurrency: 8,
  });
});

test("clamps invalid concurrency to the default", () => {
  expect(loadTaggerConfig({ OLLAMA_CONCURRENCY: "0" }).concurrency).toBe(4);
  expect(loadTaggerConfig({ OLLAMA_CONCURRENCY: "nope" }).concurrency).toBe(4);
});
