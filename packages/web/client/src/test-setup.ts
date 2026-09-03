import { afterEach, expect } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";

// Import matchers/expect explicitly (rather than the "@testing-library/jest-dom/vitest"
// auto-registration entrypoint) so `expect.extend` runs against the same `vitest` module
// instance this workspace resolves, avoiding a dual-package hazard where a hoisted
// jest-dom copy elsewhere in the monorepo binds to a different vitest major version.
expect.extend(matchers);

// jsdom implements no ResizeObserver at all (unlike most DOM globals it fakes), so any component
// that observes its own element -- GraphView's canvas, since task-11 fix round 2 -- throws
// `ResizeObserver is not defined` at mount under every test that renders it, not just the ones
// about resizing. A harmless no-op default here, same pattern as the localStorage stub below;
// tests that need to fire it themselves (GraphView.test.tsx) override this per-test with their own
// `vi.stubGlobal("ResizeObserver", ...)`, which the shared `afterEach`'s `vi.unstubAllGlobals()`
// reverts back to this default.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom implements no `scrollIntoView` at all (unlike most DOM methods it fakes), so any effect
// that calls it -- `BuildBenchmarks`' focus-follows-the-dial effect, whole-branch review fix,
// 2026-09-01 -- throws `scrollIntoView is not a function` at mount under every test that renders a
// focused group, not just the ones about scrolling. A harmless no-op default here, same pattern as
// the ResizeObserver stub above; a test asserting scrollIntoView was called overrides this with its
// own `vi.fn()`.
if (typeof Element !== "undefined" && typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = () => {};
}

// Node's own experimental global `localStorage` shadows jsdom's window.localStorage in
// this environment and resolves to undefined, so components/hooks that read it at module
// or effect time crash under test. Stub a minimal in-memory implementation.
if (typeof globalThis.localStorage === "undefined" || !globalThis.localStorage) {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  } satisfies Storage;
}

/** INVALID DOM NESTING FAILS THE TEST, IN EVERY FILE (roadmap U2).
 *
 *  `DeckIdentity` put an `Explain` -- a `<details>`, which is flow content -- inside a `<p>`, which
 *  may hold phrasing content only. The browser closes the paragraph early and reparents the
 *  disclosure as its SIBLING, so **the DOM the tests queried was not the DOM that shipped**, and
 *  the whole suite stayed green through six React errors on every report load. It was found by
 *  reading a live browser console, which is not a place a defect should have to be found.
 *
 *  React reports it through `console.error` and nothing was listening. This listens, in the one
 *  place every component's render routes through, so the next `<details>` in a `<p>` (or `<div>` in
 *  a `<p>`, or `<tr>` outside a table) fails the test that renders it rather than waiting for
 *  someone to open the console. Measured when it went in: exactly ONE offender in 907 tests.
 *
 *  Everything else console.error says is passed through untouched -- this is a filter, not a mute.
 */
const nestingWarnings: string[] = [];
const passThroughError = console.error;
console.error = (...args: unknown[]) => {
  const message = args.map(String).join(" ");
  if (/cannot be a descendant of|cannot contain a nested/.test(message)) {
    // The first line plus the tag names React appends as format arguments -- enough to name the
    // pair, without the component stack that follows it.
    nestingWarnings.push(message.split("\n")[0]!.slice(0, 200));
    return;
  }
  passThroughError(...(args as Parameters<typeof console.error>));
};

/** STORAGE OUTLIVES THE TEST THAT WROTE IT, and jsdom keeps one Storage per FILE rather than per
 *  test. So a test that runs a successful analysis leaves `mtg-synergy:last-deck` behind, and the
 *  next test to mount `App` finds a previous run and renders the COLLAPSED paste box -- an empty
 *  state that the test never asked for and cannot see the cause of.
 *
 *  Measured 2026-09-03: writing a key in one test and reading it in the next returns the value. It
 *  only became a failure when a new test file shifted the order in `App.integration.test.tsx`, and
 *  then on the Node 20 leg only, which is the worst shape of latent test pollution -- it looks like a
 *  flake and it is not one. Cleared here rather than in each file, because every test that mounts a
 *  component routes through this setup and none of them should inherit another one's session. */
afterEach(() => {
  for (const storage of [globalThis.sessionStorage, globalThis.localStorage]) {
    // Safari private mode throws on access and `run-diff.ts` already tolerates that, so a test
    // environment without storage must not fail here either.
    try {
      storage?.clear();
    } catch {
      /* no storage in this environment */
    }
  }

  const seen = nestingWarnings.splice(0);
  expect(
    seen,
    "React reported invalid DOM nesting: the browser reparents these, so the shipped DOM is not the one this test queried",
  ).toEqual([]);
});
