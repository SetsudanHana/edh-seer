import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../app.module.js";

const uri = process.env.MONGO_TEST_URI;
const suite = uri ? describe : describe.skip;

suite("POST /api/analyze against real Mongo", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    process.env.MONGO_URI = uri;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix("api");
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  test("resolves a known card and returns a report", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/analyze",
      payload: { decklist: "1 Sol Ring\n1 Impact Tremors", commanders: "1 Krenko, Mob Boss" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalCount).toBe(3);
    expect(Array.isArray(body.report.edges)).toBe(true);
    expect(Array.isArray(body.report.commanders)).toBe(true);
    expect(Array.isArray(body.report.cards)).toBe(true);
    expect(Array.isArray(body.missing)).toBe(true);
  });

  test("returns structured-engine synergy reasons, not flat-engine tags", async () => {
    // Krenko, Mob Boss creates goblin tokens (an "enters" event); Impact Tremors triggers
    // on a creature entering the battlefield. That maker/payoff relationship only exists in
    // the structured (oracle-text-tag-based) engine, whose reason tags are verb:subject-key
    // strings (e.g. "enters:creature") — a format the flat engine's produces/cares vocabulary
    // (e.g. "ramp", "card-draw") never produces. Asserting this tag shape proves the live
    // /api/analyze path is actually running analyzeDeckStructured, not the retired flat engine.
    const res = await app.inject({
      method: "POST",
      url: "/api/analyze",
      payload: { decklist: "1 Sol Ring\n1 Impact Tremors", commanders: "1 Krenko, Mob Boss" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const edges: Array<{ reasons: Array<{ tag: string }> }> = body.report.edges;
    expect(edges.length).toBeGreaterThan(0);
    const structuredTagPattern = /^[a-z-]+:[a-z-]+$/;
    const hasStructuredTag = edges.some((e) =>
      e.reasons.some((r) => structuredTagPattern.test(r.tag)),
    );
    expect(hasStructuredTag).toBe(true);
  });
});
