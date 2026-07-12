import { expect } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";

// Import matchers/expect explicitly (rather than the "@testing-library/jest-dom/vitest"
// auto-registration entrypoint) so `expect.extend` runs against the same `vitest` module
// instance this workspace resolves, avoiding a dual-package hazard where a hoisted
// jest-dom copy elsewhere in the monorepo binds to a different vitest major version.
expect.extend(matchers);
