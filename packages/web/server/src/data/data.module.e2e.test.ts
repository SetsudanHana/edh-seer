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
      payload: { decklist: "1 Sol Ring\n1 Krenko, Mob Boss\n1 Impact Tremors" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalCount).toBe(3);
    expect(Array.isArray(body.report.edges)).toBe(true);
    expect(Array.isArray(body.missing)).toBe(true);
  });
});
