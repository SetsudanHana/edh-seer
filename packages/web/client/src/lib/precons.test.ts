// @vitest-environment node
import { expect, test } from "vitest";
import { loadPrecon, loadPreconIndex } from "./precons.js";

function site(files: Record<string, unknown>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const path = new URL(String(input), "http://x.local").pathname;
    return path in files ? new Response(JSON.stringify(files[path])) : new Response("no", { status: 404 });
  }) as typeof fetch;
}
const page = { slug: "a", setCode: "X" };
const files = { "/static/v-1/precons/p-abc/a.json": page, "/static/v-1/precons/p-abc/index.json": [{ slug: "a", setCode: "X" }] };

test("pages are read from the directory the manifest names", async () => {
  const f = site({ "/static/manifest.json": { version: "v-1", precons: "p-abc" }, ...files });
  expect((await loadPrecon("a", "/static", f))?.page).toEqual(page);
  expect(await loadPreconIndex("/static", f)).toEqual([{ slug: "a", setCode: "X" }]);
});

test("a manifest with no precons pointer has no precon pages", async () => {
  const f = site({ "/static/manifest.json": { version: "v-1" }, ...files });
  expect(await loadPrecon("a", "/static", f)).toBeNull();
  expect(await loadPreconIndex("/static", f)).toBeNull();
});
