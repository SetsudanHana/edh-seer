import { expect, test } from "vitest";
import * as data from "./index.js";

test("exposes the public API surface", () => {
  for (const name of [
    "loadConfig",
    "connect",
    "mongoLookup",
    "resolveNames",
    "parseDecklistText",
    "parseMoxfieldId",
    "fetchMoxfieldDeck",
    "normalizeName",
    "fetchFlavorNames",
    "ingestFlavorNames",
  ]) {
    expect(typeof (data as Record<string, unknown>)[name]).toBe("function");
  }
});
