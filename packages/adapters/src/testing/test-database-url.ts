import { z } from "zod";

/**
 * `DATABASE_URL_TEST`, read once for every Postgres-backed test suite (one
 * place to change, ADR-0006): validated at the boundary with Zod exactly like
 * `apps/api/src/testing/integration-harness.ts` does — `postgres(ql)://`
 * only, loopback host, disposable `middleware_test` database.
 */
const testDatabaseUrlSchema = z.url({ protocol: /^postgres(ql)?$/ }).refine(
  (value) => {
    const parsed = new URL(value);
    const isLoopback = parsed.hostname === "127.0.0.1";
    return isLoopback && parsed.pathname === "/middleware_test";
  },
  { message: "Refusing to run against a non-disposable database" },
);

/** A value that is set but not a disposable database: fail the file, loudly. */
class UnsafeTestDatabaseError extends Error {
  readonly code = "UNSAFE_TEST_DATABASE";

  constructor() {
    super("Refusing to run against a non-disposable database");
    this.name = "UnsafeTestDatabaseError";
  }
}

/** Validates an already-resolved candidate URL (a test with its own default). */
export function assertTestDatabaseUrl(value: string): string {
  const parsed = testDatabaseUrlSchema.safeParse(value);
  if (!parsed.success) throw new UnsafeTestDatabaseError();
  return parsed.data;
}

/** The opt-in URL: `undefined` when absent, a typed error when unsafe. */
export function testDatabaseUrl(): string | undefined {
  const raw = process.env.DATABASE_URL_TEST;
  if (raw === undefined || raw.trim() === "") return undefined;
  return assertTestDatabaseUrl(raw);
}
