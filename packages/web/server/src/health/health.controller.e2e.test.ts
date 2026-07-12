import "reflect-metadata";
import { afterAll, beforeAll, expect, test } from "vitest";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { HealthController } from "./health.controller.js";

let app: NestFastifyApplication;

beforeAll(async () => {
  // Use a minimal module (just HealthController) rather than AppModule: since Task 4,
  // AppModule imports DataModule, which connects Mongo at init — a liveness check
  // must not require a database.
  const moduleRef = await Test.createTestingModule({ controllers: [HealthController] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.setGlobalPrefix("api");
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

test("GET /api/health returns ok", async () => {
  const res = await app.inject({ method: "GET", url: "/api/health" });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ status: "ok" });
});
