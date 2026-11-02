import { describe, expect, it } from "vitest";

/**
 * The integration suites (cross-tenant, secret redaction, repositories) skip
 * themselves when `DATABASE_URL_TEST` is missing. A silent skip is a false
 * green: on a clean machine or in CI they would vanish while the run reports
 * success. This test makes the absence visible and forces an explicit opt-out.
 */
describe("integration test environment", () => {
  it("has DATABASE_URL_TEST, or an explicit opt-out", () => {
    const missing = !process.env.DATABASE_URL_TEST;
    const optedOut = process.env.MW_SKIP_INTEGRATION === "1";

    expect(
      missing && !optedOut,
      "DATABASE_URL_TEST is not set, so the integration suites (cross-tenant, secret redaction) would be skipped. " +
        "Point it at a disposable PostgreSQL (infra/compose.dev.yaml creates middleware_test) or set MW_SKIP_INTEGRATION=1 to skip them on purpose.",
    ).toBe(false);
  });
});
