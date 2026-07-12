import "reflect-metadata";
import { afterAll, beforeAll, expect, test } from "vitest";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AnalyzeController } from "./analyze.controller.js";
import { AnalyzeService, ANALYZE_DEPS, type AnalyzeDeps } from "./analyze.service.js";
import type { DeckReport } from "@mtg/engine";

const report: DeckReport = { edges: [], combos: [], themes: [], roles: { ramp: 0, draw: 0, removal: 0 } };

const deps: AnalyzeDeps = {
  parseDecklistText: (t) => t.split("\n").map((s) => s.trim()).filter(Boolean),
  makeLookup: () => ({}),
  resolveNames: async (names) => ({ cards: names.map((n) => ({ name: n })), combos: [], missing: [] }),
  analyze: () => report,
};

let app: NestFastifyApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [AnalyzeController],
    providers: [AnalyzeService, { provide: ANALYZE_DEPS, useValue: deps }],
  }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.setGlobalPrefix("api");
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

test("POST /api/analyze returns a report", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/api/analyze",
    payload: { decklist: "1 Sol Ring" },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(body.totalCount).toBe(1);
  expect(body.report).toEqual(report);
});

test("POST /api/analyze with empty decklist returns 400", async () => {
  const res = await app.inject({ method: "POST", url: "/api/analyze", payload: { decklist: "   " } });
  expect(res.statusCode).toBe(400);
});
