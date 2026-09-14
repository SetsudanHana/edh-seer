// vitest 5 gave `Assertion` a second type parameter, so jest-dom 7's own augmentation
// (`interface Assertion<T = any>` in @testing-library/jest-dom/types/vitest.d.ts) no longer
// merges with it and every jest-dom matcher disappears from the type system -- 708 TS2339s,
// with the suite still green, because `expect.extend` in test-setup.ts is a runtime call that
// types never gated. Augment `Matchers`, which is the extension point vitest 5 documents.
import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

declare module "vitest" {
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown>
    extends TestingLibraryMatchers<T, R> {}
}
