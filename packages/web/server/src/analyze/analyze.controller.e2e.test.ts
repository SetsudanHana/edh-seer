import "reflect-metadata";
import { afterAll, beforeAll, expect, test } from "vitest";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AnalyzeController } from "./analyze.controller.js";
import { AnalyzeService, ANALYZE_DEPS, type AnalyzeDeps } from "./analyze.service.js";
import type { DeckReport } from "@mtg/engine";

const report: DeckReport = {
  commanders: [],
  cards: [],
  edges: [],
  combos: [],
  themes: [],
  roles: { ramp: 0, draw: 0, removal: 0 },
  cohesion: null,
  manaCurve: [
    { value: 0, count: 0 },
    { value: 1, count: 0 },
    { value: 2, count: 0 },
    { value: 3, count: 0 },
    { value: 4, count: 0 },
    { value: 5, count: 0 },
    { value: 6, count: 0 },
    { value: 7, count: 0 },
  ],
  landCount: 0,
  avgManaValue: 0,
  medianManaValue: 0,
};

const deps: AnalyzeDeps = {
  parseDecklistSections: (t) => ({ commanders: [], deck: t.split("\n").map((s) => s.trim()).filter(Boolean) }),
  parseLines: (t) => t.split("\n").map((s) => s.trim()).filter(Boolean),
  makeLookup: () => ({}),
  resolveDeck: async (commanderNames, deckNames) => ({
    cards: [...commanderNames, ...deckNames].map((n) => ({ name: n })),
    combos: [],
    missing: [],
    commanderResolved: commanderNames,
    commanderColorIdentity: [],
  }),
  graph: async (_cardNames, _rolesByName) => ({ nodes: [], edges: [], undirectedReasons: 0, offDeckReasons: 0 }),
  analyze: async () => report,
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
  const res = await app.inject({ method: "POST", url: "/api/analyze", payload: { decklist: "1 Sol Ring" } });
  expect(res.statusCode).toBe(200);
  expect(res.json().totalCount).toBe(1);
});

test("POST /api/analyze accepts a commanders field", async () => {
  const res = await app.inject({ method: "POST", url: "/api/analyze", payload: { decklist: "1 Sol Ring", commanders: "1 Krenko, Mob Boss" } });
  expect(res.statusCode).toBe(200);
  expect(res.json().totalCount).toBe(2); // 1 commander + 1 deck card
});

test("POST /api/analyze with empty decklist returns 400", async () => {
  const res = await app.inject({ method: "POST", url: "/api/analyze", payload: { decklist: "   " } });
  expect(res.statusCode).toBe(400);
});
