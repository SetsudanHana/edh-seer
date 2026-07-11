import { expect, test } from "vitest";
import { ENGINE_VERSION } from "./index.js";

test("engine package loads", () => {
  expect(ENGINE_VERSION).toBe("0.0.0");
});
