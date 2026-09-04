import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, vi } from "vitest";

/** THE CODE THAT RUNS WHEN EVERYTHING ELSE IS BROKEN, so it is tested from the real `index.html`
 *  rather than from a copy: it recovers a browser whose HTTP cache holds an HTML response under a
 *  JavaScript URL, which is the one state in which nothing in the bundle can run.
 *
 *  Executed as a function with its globals injected. jsdom cannot navigate, so `location.reload` is
 *  a spy -- and a spy is the right assertion anyway: the question is whether it reloads exactly
 *  once after refetching, not what a reload does. */
const SHELL = readFileSync(join(import.meta.dirname, "..", "index.html"), "utf8");
const source = /<script>\s*(window\.addEventListener\("load"[\s\S]*?)<\/script>/.exec(SHELL)?.[1];

const run = (opts: { booted: boolean; retried?: boolean }) => {
  const listeners: Array<() => void> = [];
  const store = new Map<string, string>(opts.retried ? [["edh-boot-retry", "1"]] : []);
  const fetchSpy = vi.fn(async () => new Response("ok"));
  const reload = vi.fn();
  const deleted: string[] = [];
  const unregister = vi.fn(async () => true);
  const win = {
    __appBooted: opts.booted,
    addEventListener: (_: string, fn: () => void) => listeners.push(fn),
  };
  const doc = { querySelectorAll: () => [{ src: "https://x.test/assets/main-abc.js" }] };
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
  };
  const cacheApi = {
    keys: async () => ["edh-seer-shell-1"],
    delete: async (k: string) => { deleted.push(k); return true; },
  };
  const nav = { serviceWorker: { getRegistrations: async () => [{ unregister }] } };
  new Function("window", "document", "sessionStorage", "caches", "navigator", "location", "fetch", source!)(
    win, doc, storage, cacheApi, nav, { reload }, fetchSpy,
  );
  return { fire: async () => { for (const l of listeners) l(); await new Promise((r) => setTimeout(r, 0)); },
    fetchSpy, reload, deleted, unregister, store };
};

test("the shell carries a boot-recovery script at all", () => {
  expect(source, "index.html must still carry the recovery script").toBeTruthy();
});

/** THE HAPPY PATH IS SILENCE. Every normal load reaches this listener, so a recovery that fired on
 *  a working page would reload every visitor forever. */
test("a booted app is left alone", async () => {
  const r = run({ booted: true });
  await r.fire();
  expect(r.fetchSpy).not.toHaveBeenCalled();
  expect(r.reload).not.toHaveBeenCalled();
  expect(r.store.get("edh-boot-retry")).toBeUndefined();
});

/** THE REPAIR IS ONE FORCED REVALIDATION. `cache: "reload"` bypasses the HTTP cache AND replaces
 *  the stored entry, so the reload that follows reads a cache that has been fixed. */
test("a bundle that never executed is refetched past the cache, then the page reloads", async () => {
  const r = run({ booted: false });
  await r.fire();
  expect(r.fetchSpy).toHaveBeenCalledWith("https://x.test/assets/main-abc.js", { cache: "reload" });
  expect(r.reload).toHaveBeenCalledTimes(1);
  // Defensive, not causal: a service worker and Cache Storage were NOT the cause on 2026-09-04 (a
  // fresh profile with neither reproduced it) but they can hold the same poisoned bytes.
  expect(r.deleted).toEqual(["edh-seer-shell-1"]);
  expect(r.unregister).toHaveBeenCalled();
});

/** A RELOAD LOOP IS A WORSE FAILURE THAN A BROKEN PAGE: it burns a visitor's battery and hides the
 *  real error. If the second attempt fails too, the page stays broken and visibly so. */
test("it retries once per session and never again", async () => {
  const r = run({ booted: false, retried: true });
  await r.fire();
  expect(r.fetchSpy).not.toHaveBeenCalled();
  expect(r.reload).not.toHaveBeenCalled();
});
