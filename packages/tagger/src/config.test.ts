import { expect, test } from "vitest";
import { loadTaggerConfig } from "./config.js";

test("defaults model and host, overridable by env", () => {
  expect(loadTaggerConfig({})).toEqual({ model: "qwen2.5:14b", ollamaHost: "http://localhost:11434" });
  expect(loadTaggerConfig({ OLLAMA_MODEL: "llama3.1:8b", OLLAMA_HOST: "http://x:1" })).toEqual({
    model: "llama3.1:8b",
    ollamaHost: "http://x:1",
  });
});
