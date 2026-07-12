import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";
import { MongoUnreachableFilter } from "./analyze/analyze.exception-filter.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
  app.setGlobalPrefix("api");
  app.useGlobalFilters(new MongoUnreachableFilter());
  app.enableCors({ origin: ["http://localhost:5173"] });
  await app.listen({ port: 3001, host: "0.0.0.0" });
  console.log("web server on http://localhost:3001");
}

void bootstrap();
