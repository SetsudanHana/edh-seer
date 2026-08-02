import { expect, test } from "vitest";
import { edhrecPairSet, seededRandom } from "./edhrec-pairs.js";

test("returns null when every theme fetch fails", async () => {
  const failing: typeof fetch = async () => { throw new Error("network down"); };
  const result = await edhrecPairSet({ fetchImpl: failing, cacheDir: null });
  expect(result).toBeNull();
});

test("returns null when every theme responds non-OK", async () => {
  const notFound: typeof fetch = async () => new Response("nope", { status: 404 });
  const result = await edhrecPairSet({ fetchImpl: notFound, cacheDir: null });
  expect(result).toBeNull();
});

test("builds pairs from a theme payload and normalizes names", async () => {
  const payload = {
    container: {
      json_dict: {
        cardlists: [
          {
            header: "High Synergy Cards",
            cardviews: [
              { name: "Blood Artist", slug: "blood-artist", synergy: 0.9 },
              { name: "Viscera Seer", slug: "viscera-seer", synergy: 0.8 },
            ],
          },
        ],
      },
    },
  };
  const ok: typeof fetch = async () => new Response(JSON.stringify(payload), { status: 200 });
  const result = await edhrecPairSet({ fetchImpl: ok, cacheDir: null });
  expect(result).not.toBeNull();
  expect(result!.size).toBeGreaterThan(0);
});

test("seededRandom is deterministic for a given seed", () => {
  const a = seededRandom(42);
  const b = seededRandom(42);
  expect([a(), a(), a()]).toEqual([b(), b(), b()]);
});
