import { expect } from "vitest";
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
