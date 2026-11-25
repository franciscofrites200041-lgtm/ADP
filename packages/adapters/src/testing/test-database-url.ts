import { z } from "zod";

/**
 * `DATABASE_URL_TEST`, read once for every Postgres-backed test suite (one
 * place to change, ADR-0006): validated at the boundary with Zod —
 * `postgres(ql)://` only, loopback host, disposable `middleware_test`
 * database.
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

/** Validates an already-resolved candidate URL (a test's own default). */
function assertTestDatabaseUrl(value: string): string {
  const parsed = testDatabaseUrlSchema.safeParse(value);
  if (!parsed.success) throw new UnsafeTestDatabaseError();
  return parsed.data;
}

/**
 * The opt-in URL for every Postgres-backed suite (one place to change,
 * ADR-0006). Unset means "skip this suite" for local convenience — but a CI
 * pipeline has no local convenience to protect: there a missing or blank
 * variable is a misconfigured run, and a skipped suite is not a green suite,
 * so the cross-tenant assertions would silently vanish. In CI it fails
 * loudly instead of skipping.
 */
export function testDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const raw = env.DATABASE_URL_TEST;
  if (raw === undefined || raw.trim() === "") {
    if (env.CI !== undefined && env.CI.trim() !== "") {
      throw new Error(
        "DATABASE_URL_TEST must be set when CI is set: a skipped suite is " +
          "not a green suite. Expected a disposable database like " +
          "postgres://mw_test@127.0.0.1:55432/middleware_test.",
      );
    }
    return undefined;
  }
  return assertTestDatabaseUrl(raw);
}
