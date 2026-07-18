import { expect, test, vi } from "vitest";
import { OllamaProvider } from "./ollama.js";

test("posts prompt to ollama generate endpoint with json format, returns response", async () => {
  const fetchImpl = vi.fn(async () =>
    new Response(JSON.stringify({ response: '{"abilities":[]}' }), { status: 200 }),
  ) as unknown as typeof fetch;

  const p = new OllamaProvider({ model: "qwen2.5:14b", host: "http://localhost:11434", fetchImpl });
  const out = await p.complete("PROMPT");

  expect(out).toBe('{"abilities":[]}');
  const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
  expect(url).toBe("http://localhost:11434/api/generate");
  const body = JSON.parse((init as RequestInit).body as string);
  expect(body.model).toBe("qwen2.5:14b");
  expect(body.prompt).toBe("PROMPT");
  expect(body.stream).toBe(false);
  expect(body.format).toBe("json");
});

test("throws on non-ok response", async () => {
  const fetchImpl = vi.fn(async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
  const p = new OllamaProvider({ fetchImpl });
  await expect(p.complete("x")).rejects.toThrow(/ollama/i);
});
