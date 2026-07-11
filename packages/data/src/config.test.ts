import { expect, test } from "vitest";
import { loadConfig } from "./config.js";

test("defaults when env is empty", () => {
  const c = loadConfig({});
  expect(c.mongoUri).toBe("mongodb://localhost:27017");
  expect(c.dbName).toBe("mtg");
});

test("reads MONGO_URI and MONGO_DB overrides", () => {
  const c = loadConfig({ MONGO_URI: "mongodb://x:1", MONGO_DB: "test" });
  expect(c.mongoUri).toBe("mongodb://x:1");
  expect(c.dbName).toBe("test");
});
