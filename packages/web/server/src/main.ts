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
  // Loopback only: this is a development server, and nothing on the network needs to reach it.
  await app.listen({ port: 3001, host: "127.0.0.1" });
  console.log("web server on http://localhost:3001");
}

void bootstrap();
