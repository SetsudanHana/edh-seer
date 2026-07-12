import "reflect-metadata";
import { expect, test, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { MongoUnreachableFilter } from "./analyze.exception-filter.js";

function mockHost() {
  const reply = { status: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() };
  const host = { switchToHttp: () => ({ getResponse: () => reply }) } as never;
  return { host, reply };
}

test("passes an HttpException through with its own status", () => {
  const { host, reply } = mockHost();
  new MongoUnreachableFilter().catch(new BadRequestException("bad"), host);
  expect(reply.status).toHaveBeenCalledWith(400);
});

test("maps a 'Cannot reach MongoDB' error to 503", () => {
  const { host, reply } = mockHost();
  new MongoUnreachableFilter().catch(new Error("Cannot reach MongoDB at mongodb://x"), host);
  expect(reply.status).toHaveBeenCalledWith(503);
});

test("maps any other error to 500", () => {
  const { host, reply } = mockHost();
  new MongoUnreachableFilter().catch(new Error("boom"), host);
  expect(reply.status).toHaveBeenCalledWith(500);
});
