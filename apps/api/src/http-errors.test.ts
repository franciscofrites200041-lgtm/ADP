import { Writable } from "node:stream";
import { PersistenceError } from "@middleware/adapters";
import { AliasTakenError, NotFoundError } from "@middleware/core";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createErrorHandler } from "./http-errors.ts";
import { createLogger } from "./logger.ts";

const LEAK = "sk-leaked-in-a-driver-message";

class DriverError extends Error {
  readonly code = "23502";
}

function setup(error: unknown) {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      lines.push(String(chunk));
      done();
    },
  });
  const app = new Hono();
  app.onError(createErrorHandler(createLogger(stream)));
  app.get("/api/things/:id", () => {
    throw error;
  });
  return { app, log: () => lines.join("") };
}

async function failWith(error: unknown) {
  const { app, log } = setup(error);
  const res = await app.request("/api/things/1?apiKey=x");
  return { status: res.status, body: await res.text(), log: log() };
}

describe("error mapper", () => {
  it.each([
    [new AliasTakenError(LEAK), 409, "alias_taken"],
    [new NotFoundError(LEAK), 404, "not_found"],
    [z.string().safeParse(1).error, 400, "invalid_request"],
    [new PersistenceError("23505"), 500, "unknown"],
    [new DriverError(LEAK), 500, "unknown"],
    [new TypeError(LEAK), 500, "unknown"],
  ])("maps %o to %i %s with a Spanish message", async (error, status, code) => {
    const res = await failWith(error);

    expect(res.status).toBe(status);
    const body: unknown = JSON.parse(res.body);
    expect(body).toEqual({
      error: { code, message: expect.any(String) },
    });
    expect(res.body).not.toContain(LEAK);
    expect(res.body).not.toContain("Expected");
  });

  it("logs unexpected errors with only name, code and route", async () => {
    const res = await failWith(new DriverError(LEAK));

    const entry: unknown = JSON.parse(res.log);
    expect(entry).toMatchObject({
      level: 50,
      errorName: "Error",
      errorCode: "23502",
      method: "GET",
      route: "/api/things/:id",
    });
    expect(res.log).not.toContain(LEAK);
    expect(res.log).not.toContain("stack");
    expect(res.log).not.toContain("apiKey");
  });

  it("does not log expected domain errors", async () => {
    const res = await failWith(new NotFoundError());

    expect(res.log).toBe("");
  });
});
